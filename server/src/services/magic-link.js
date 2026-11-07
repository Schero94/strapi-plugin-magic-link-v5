'use strict';

/**
 * magic-link.js service
 *
 * Token lifecycle, login e-mail delivery, user resolution and the JWT
 * revocation list.
 *
 * Security properties:
 * - Login tokens are stored as salted hashes; only a short prefix is kept in
 *   clear for the indexed lookup. Legacy unsalted rows are never accepted.
 * - Second-factor state lives in the private `challenge` attribute, which only
 *   the server writes. Client context can never start or skip a challenge.
 * - Single use is enforced with conditional database updates, so parallel
 *   requests with one link cannot both log in.
 * - E-mail templates are rendered with an allow-listed placeholder renderer
 *   (no code execution).
 */

const createId = require('../utils/id');
const emailHelpers = require('../utils/email-helpers');
const cryptoUtils = require('../utils/crypto');
const { normalizeEmail } = require('../utils/email');
const { normalizeIpAddress } = require('../utils/ip-address');
const { filterContext } = require('../utils/context-policy');
const { buildLoginUrl } = require('../utils/login-url');
const {
  buildTemplateVariables,
  escapeHtml,
  renderTemplate,
} = require('../utils/template-renderer');
const { decodeJwtExpiry } = require('../utils/login-session');

const TOKEN_UID = 'plugin::magic-link.token';
const USER_UID = 'plugin::users-permissions.user';
const ROLE_UID = 'plugin::users-permissions.role';

const TOKEN_LENGTH = Object.freeze({ min: 22, max: 128, default: 32 });
const TOKEN_PREFIX_LENGTH = 8;
// Admin-created tokens of older releases may be 16 characters long; they are
// still accepted for lookup, new tokens are generated with TOKEN_LENGTH.min+.
const MIN_LOOKUP_LENGTH = 16;
// 'totp-setup': required MFA, the user enrols an authenticator during login.
const CHALLENGE_TYPES = ['otp', 'totp', 'totp-setup'];
const BLOCKLIST_KEY = 'blocked_jwt_tokens';
const SESSIONS_KEY = 'jwt_sessions';
// Fallback when a revoked token's expiry is unknown: keep the entry for one
// year rather than letting a still-valid token become usable again.
const UNKNOWN_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
const BLOCKLIST_CACHE_TTL_MS = 2000;

const DEFAULT_SUBJECT = 'Your login link';
const DEFAULT_HTML =
  '<p>Hello,</p><p><a href="{{LOGIN_URL}}">Click here to log in</a>.</p><p>This link expires in {{EXPIRY_TEXT}}.</p>';
const DEFAULT_TEXT =
  'Hello,\n\nUse this link to log in: {{LOGIN_URL}}\n\nThis link expires in {{EXPIRY_TEXT}}.';

/**
 * Clamps a configured token length into the secure range (>= 132 bits).
 *
 * @param {unknown} value - Configured length.
 * @returns {number} Effective token length.
 */
const clampTokenLength = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n)) return TOKEN_LENGTH.default;
  return Math.min(TOKEN_LENGTH.max, Math.max(TOKEN_LENGTH.min, n));
};

/**
 * Normalises a username candidate to the characters users-permissions
 * usernames commonly allow.
 *
 * @param {unknown} value - Candidate username.
 * @returns {string} Safe username base (may be empty).
 */
const toUsernameBase = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .slice(0, 48);

module.exports = ({ strapi }) => {
  // In-process serialisation of read-modify-write updates on store blobs.
  let storeQueue = Promise.resolve();
  const serialize = (task) => {
    const run = storeQueue.then(task, task);
    storeQueue = run.catch(() => {});
    return run;
  };
  let blocklistCache = null;

  const pluginStore = () => strapi.store({ type: 'plugin', name: 'magic-link' });

  return {
    async initialize() {},

    async settings() {
      return pluginStore().get({ key: 'settings' });
    },

    async userSettings() {
      const store = strapi.store({ type: 'plugin', name: 'users-permissions' });
      return store.get({ key: 'advanced' });
    },

    /**
     * Kept for API stability: the plugin is always active once installed.
     *
     * @returns {Promise<boolean>} Always true.
     */
    async isEnabled() {
      return true;
    },

    /**
     * Whether a magic-link request may create a new account. Requires the
     * plugin opt-in AND users-permissions "Enable sign-ups" (allow_register).
     *
     * @param {object} settings - Plugin settings.
     * @returns {Promise<boolean>} Whether auto-registration is allowed.
     */
    async canAutoRegister(settings) {
      if (settings?.createUserIfNotExists === false) return false;
      if (settings?.allow_magic_links_on_public_registration !== true) return false;
      const advanced = await this.userSettings();
      return advanced?.allow_register === true;
    },

    /**
     * Finds a free username derived from the request or the e-mail local part.
     *
     * @param {string} requested - Requested username (optional).
     * @param {string} email - Normalised e-mail.
     * @returns {Promise<string>} Unused username.
     */
    async resolveUsername(requested, email) {
      const base = toUsernameBase(requested) || toUsernameBase(email.split('@')[0]) || 'user';
      let candidate = base;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const existing = await strapi
          .documents(USER_UID)
          .findMany({ filters: { username: candidate }, limit: 1 });
        if (!existing || existing.length === 0) return candidate;
        candidate = `${base}-${createId(6)}`;
      }
      return `${base}-${createId(12)}`;
    },

    /**
     * Creates an unconfirmed users-permissions user with the default role.
     * The account is confirmed only when the first magic link is used, which
     * is the proof of e-mail ownership.
     *
     * @param {{email: string, username?: string}} data - New user data.
     * @returns {Promise<object>} Created user.
     */
    async createUser({ email, username }) {
      const advanced = await this.userSettings();
      if (!advanced?.default_role) {
        throw new Error('Default role not configured');
      }
      const roles = await strapi.documents(ROLE_UID).findMany({
        filters: { type: advanced.default_role },
        limit: 1,
      });
      const role = roles && roles.length > 0 ? roles[0] : null;
      if (!role) {
        throw new Error('Default role not found');
      }

      return strapi.documents(USER_UID).create({
        data: {
          email,
          username: await this.resolveUsername(username, email),
          provider: 'local',
          confirmed: false,
          blocked: false,
          role: role.id,
        },
      });
    },

    /**
     * Resolves a user by normalised e-mail and creates one when
     * auto-registration is allowed.
     *
     * @param {string} email - E-mail address.
     * @param {string} [username] - Requested username for new accounts.
     * @returns {Promise<object|null>} User or null.
     */
    async user(email, username) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return null;

      const users = await strapi.documents(USER_UID).findMany({
        filters: { email: normalizedEmail },
        limit: 1,
      });
      const existing = users && users.length > 0 ? users[0] : null;
      if (existing) return existing;

      const settings = (await this.settings()) || {};
      if (!(await this.canAutoRegister(settings))) return null;
      return this.createUser({ email: normalizedEmail, username });
    },

    /**
     * Handles a public send-link request. The controller answers with the
     * same generic response for every outcome and runs this in the
     * background, so neither status nor timing reveals whether an account
     * exists. Nothing here logs the e-mail address.
     *
     * @param {{email: string, username?: string, context?: object}} params - Validated request.
     * @returns {Promise<string>} Outcome code for tests and debug logs.
     */
    async requestLoginLink({ email, username, context = {} }) {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return 'invalid_email';
      const settings = (await this.settings()) || {};

      const lookup = await strapi.documents(USER_UID).findMany({
        filters: { email: normalizedEmail },
        limit: 1,
      });
      const existingUser = (lookup && lookup[0]) || null;

      let user = existingUser;
      if (!user) {
        if (!(await this.canAutoRegister(settings))) return 'unknown_user';
        user = await this.createUser({ email: normalizedEmail, username });
      }

      if (!user || normalizeEmail(user.email) !== normalizedEmail) return 'user_mismatch';
      if (user.blocked) return 'blocked_user';
      if (settings.verify_email === true && existingUser && !user.confirmed)
        return 'email_not_confirmed';

      const token = await this.createToken(user.email, context);
      await this.sendLoginLink(token, { username: user.username });

      if (!existingUser && settings.welcome_email === true) {
        try {
          await this.sendWelcomeEmail(user, settings);
        } catch {
          strapi.log.warn('[magic-link] Welcome e-mail could not be sent');
        }
      }
      return 'sent';
    },

    /**
     * Creates a login token. Only a salted hash and an 8-character lookup
     * prefix are stored. The context passes the same allow/deny policy as
     * admin-created tokens and never carries reserved keys.
     *
     * @param {string} email - User e-mail.
     * @param {object} [context] - Client context.
     * @returns {Promise<object>} Token record with `_plaintextToken` for delivery.
     */
    async createToken(email, context = {}) {
      const settings = (await this.settings()) || {};
      const token = createId(clampTokenLength(settings.token_length));

      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        throw new Error('createToken requires a non-empty email');
      }

      const expireSeconds =
        Number.isFinite(settings.expire_period) && settings.expire_period > 0
          ? settings.expire_period
          : 3600;
      const expires = new Date(Date.now() + expireSeconds * 1000);
      const { hash: tokenHash, salt: tokenSalt } = cryptoUtils.hashToken(token);

      const tokenObject = await strapi.documents(TOKEN_UID).create({
        data: {
          email: normalizedEmail,
          token: tokenHash,
          token_salt: tokenSalt,
          token_prefix: token.substring(0, TOKEN_PREFIX_LENGTH),
          expires_at: expires,
          is_active: true,
          is_used: false,
          context: filterContext(context, settings),
          challenge: null,
        },
      });

      // `token` is the plaintext value for backwards compatibility with callers
      // of 5.x; the stored row only contains the hash.
      return { ...tokenObject, token, _plaintextToken: token };
    },

    /**
     * Looks up an active token by its plaintext value: indexed prefix lookup,
     * then constant-time hash comparison. Legacy unsalted tokens are rejected.
     *
     * @param {string} token - Plaintext token from the login request.
     * @returns {Promise<object|null>} Token record or null.
     */
    async fetchToken(token) {
      if (typeof token !== 'string' || token.length < MIN_LOOKUP_LENGTH || token.length > 512) {
        return null;
      }

      const candidates = await strapi.documents(TOKEN_UID).findMany({
        filters: { is_active: true, token_prefix: token.substring(0, TOKEN_PREFIX_LENGTH) },
        sort: [{ createdAt: 'desc' }],
        limit: 10,
      });

      return (
        (candidates || []).find((candidate) => {
          if (!candidate.token_salt || !candidate.token) return false;
          try {
            return cryptoUtils.verifyToken(token, candidate.token, candidate.token_salt);
          } catch {
            return false;
          }
        }) || null
      );
    },

    async isTokenValid(token) {
      if (!token?.is_active) return false;
      const expiry = new Date(token.expires_at);
      if (Number.isNaN(expiry.getTime()) || Date.now() >= expiry.getTime()) return false;
      const settings = (await this.settings()) || {};
      if (!settings.stays_valid && token.is_used) return false;
      return true;
    },

    async deactivateToken(token) {
      return strapi.documents(TOKEN_UID).update({
        documentId: token.documentId,
        data: { is_active: false },
      });
    },

    /**
     * Builds the login-info fields that are stored when store_login_info is on.
     *
     * @param {object} settings - Plugin settings.
     * @param {object} requestInfo - IP and user agent.
     * @param {Date} at - Timestamp.
     * @returns {object} Update fields.
     */
    loginInfoData(settings, requestInfo = {}, at = new Date()) {
      if (settings?.store_login_info === false) return {};
      const data = { last_used_at: at };
      if (requestInfo.userAgent) data.user_agent = String(requestInfo.userAgent).slice(0, 1000);
      if (requestInfo.ipAddress) data.ip_address = requestInfo.ipAddress;
      return data;
    },

    /**
     * Atomically consumes a login token for a direct (no second factor)
     * login. Single-use tokens must still be unused; reusable tokens
     * (stays_valid) must still be active and unexpired.
     *
     * @param {object} token - Token record from fetchToken.
     * @param {object} [requestInfo] - IP and user agent.
     * @returns {Promise<boolean>} True only for the request that consumed it.
     */
    async consumeLoginToken(token, requestInfo = {}) {
      if (!token?.id) return false;
      const settings = (await this.settings()) || {};
      const staysValid = settings.stays_valid === true;
      const now = new Date();
      const where = { id: token.id, is_active: true, expires_at: { $gt: now } };
      if (!staysValid) where.is_used = false;

      const result = await strapi.db.query(TOKEN_UID).updateMany({
        where,
        data: {
          is_used: true,
          used_at: token.used_at || now,
          is_active: staysValid,
          ...this.loginInfoData(settings, requestInfo, now),
        },
      });
      return result?.count === 1;
    },

    /**
     * Kept for API compatibility. Prefer consumeLoginToken, which is atomic.
     *
     * @param {object} token - Token record.
     * @param {object} [requestInfo] - IP and user agent.
     * @returns {Promise<boolean>} Whether the token was consumed.
     */
    async updateTokenOnLogin(token, requestInfo = {}) {
      return this.consumeLoginToken(token, requestInfo || {});
    },

    /**
     * Starts (or refreshes) a server-side second-factor challenge on a token.
     * The state is written to the private `challenge` attribute only.
     *
     * @param {object} token - Token record.
     * @param {object} challenge - { type: 'otp'|'totp'|'totp-setup', userId, userDocumentId, otpSentAt? }.
     * @returns {Promise<boolean>} Whether the token was still usable.
     */
    async startChallenge(token, challenge) {
      if (!token?.id || !CHALLENGE_TYPES.includes(challenge?.type)) return false;
      const now = new Date();
      const result = await strapi.db.query(TOKEN_UID).updateMany({
        where: { id: token.id, is_active: true, expires_at: { $gt: now } },
        data: {
          challenge: {
            type: challenge.type,
            userId: challenge.userId,
            userDocumentId: challenge.userDocumentId,
            startedAt: token.challenge?.startedAt || now.toISOString(),
            ...(challenge.otpSentAt ? { otpSentAt: challenge.otpSentAt } : {}),
          },
        },
      });
      return result?.count === 1;
    },

    /**
     * Validates that a login token is the origin of a pending challenge of
     * the expected type for the claimed e-mail.
     *
     * @param {string} plaintextToken - Login token.
     * @param {string} email - E-mail the caller acts for.
     * @param {'otp'|'totp'|'totp-setup'} expectedChallenge - Challenge type.
     * @returns {Promise<object|null>} Token record or null.
     */
    async validateBindingForChallenge(plaintextToken, email, expectedChallenge = 'otp') {
      if (!plaintextToken || !email || !CHALLENGE_TYPES.includes(expectedChallenge)) return null;

      const token = await this.fetchToken(plaintextToken);
      if (!token || !token.is_active) return null;
      if (!(await this.isTokenValid({ ...token, is_used: false }))) return null;

      if (normalizeEmail(token.email) !== normalizeEmail(email)) return null;
      const challenge = token.challenge;
      if (!challenge || challenge.type !== expectedChallenge || challenge.verifiedAt) return null;
      return token;
    },

    /**
     * Atomically completes a pending challenge. The token is deactivated even
     * when reusable links are enabled, so one challenge yields one session.
     *
     * @param {object} token - Token record (with server challenge).
     * @param {'otp'|'totp'|'totp-setup'} challengeType - Expected challenge.
     * @param {object} [requestInfo] - IP and user agent.
     * @returns {Promise<boolean>} True only for the request that consumed it.
     */
    async consumeChallenge(token, challengeType, requestInfo = {}) {
      const challenge = token?.challenge;
      if (
        !token?.id ||
        !CHALLENGE_TYPES.includes(challengeType) ||
        challenge?.type !== challengeType ||
        challenge.verifiedAt
      ) {
        return false;
      }

      const now = new Date();
      const settings = (await this.settings()) || {};
      const result = await strapi.db.query(TOKEN_UID).updateMany({
        where: { id: token.id, is_active: true, expires_at: { $gt: now } },
        data: {
          is_active: false,
          is_used: true,
          used_at: token.used_at || now,
          challenge: { ...challenge, verifiedAt: now.toISOString() },
          ...this.loginInfoData(settings, requestInfo, now),
        },
      });
      return result?.count === 1;
    },

    /**
     * Resolves the sender: plugin setting, then the Strapi e-mail plugin
     * default sender, otherwise undefined so the provider default applies.
     *
     * @param {object} settings - Plugin settings.
     * @returns {string|undefined} From header.
     */
    resolveSender(settings) {
      const fromEmail =
        settings?.from_email ||
        strapi.config?.get?.('plugin::email.settings.defaultFrom') ||
        strapi.config?.get?.('plugin.email.settings.defaultFrom');
      if (!fromEmail) return undefined;
      const name = String(settings?.from_name || '')
        .replace(/[\r\n"<>]/g, '')
        .trim();
      return name ? `"${name}" <${fromEmail}>` : fromEmail;
    },

    /**
     * Renders the login e-mail with the shared safe renderer. Used for real
     * sends and available to the admin preview.
     *
     * @param {object} settings - Plugin settings.
     * @param {object} variables - Output of buildTemplateVariables.
     * @returns {{subject: string, html: string, text: string}} Rendered mail.
     */
    renderLoginEmail(settings, variables) {
      const subject =
        renderTemplate(settings?.object || DEFAULT_SUBJECT, variables)
          .replace(/[\r\n]+/g, ' ')
          .trim() || DEFAULT_SUBJECT;
      let html = renderTemplate(settings?.message_html || DEFAULT_HTML, variables, { html: true });
      let text = renderTemplate(settings?.message_text || DEFAULT_TEXT, variables);

      if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
        html = emailHelpers.wrapEmailTemplate(html, {
          title: escapeHtml(subject),
          preheader: 'Your secure login link is ready',
        });
      }
      if (!text || text.trim().length === 0) {
        text = emailHelpers.createPlainTextVersion(html);
      }
      return { subject, html, text };
    },

    /**
     * Sends the login e-mail through Magic Mail, Email Designer 5 or the
     * Strapi e-mail plugin (in that order of preference).
     *
     * @param {object} token - Token record with `_plaintextToken`.
     * @param {{username?: string}} [options] - Recipient details.
     * @returns {Promise<object>} The token.
     */
    async sendLoginLink(token, { username } = {}) {
      const settings = (await this.settings()) || {};
      const code = token._plaintextToken;
      if (!code) {
        throw new Error('sendLoginLink requires the plaintext token');
      }

      const { baseUrl, loginUrl } = buildLoginUrl(settings, code, strapi);
      const variables = buildTemplateVariables({
        loginUrl,
        baseUrl,
        code,
        email: token.email,
        username,
        expiresAt: token.expires_at,
        expirePeriodSeconds: settings.expire_period,
      });
      const { subject, html, text } = this.renderLoginEmail(settings, variables);
      const from = this.resolveSender(settings);
      const replyTo = settings.response_email || undefined;
      const headers = emailHelpers.getEmailHeaders({ replyTo });

      const validation = emailHelpers.validateEmailConfig({
        to: token.email,
        from: from || 'provider-default@localhost',
        subject,
        text,
        html,
      });
      if (!validation.valid) {
        strapi.log.error('[magic-link] Login e-mail configuration is invalid');
        throw new Error('Invalid email configuration');
      }

      // Variables for third-party template engines (Magic Mail, Email Designer).
      const templatePayload = {
        ...variables,
        url: baseUrl,
        loginUrl,
        magicLinkUrl: loginUrl,
        magicLink: loginUrl,
        code,
        token: code,
        email: token.email,
        expiryText: variables.EXPIRY_TEXT,
        expiresAt: variables.EXPIRES_AT || undefined,
        user: { email: token.email, username: username || undefined },
      };

      if (settings.use_magic_mail && strapi.plugin('magic-mail')) {
        try {
          let templateReferenceId = settings.magic_mail_template_reference_id || undefined;
          const numericTemplateId = settings.magic_mail_template_id
            ? Number(settings.magic_mail_template_id)
            : undefined;
          if (numericTemplateId && !templateReferenceId) {
            try {
              const record = await strapi
                .plugin('magic-mail')
                .service('email-designer')
                .findOne(numericTemplateId);
              templateReferenceId = record?.templateReferenceId || undefined;
            } catch {
              strapi.log.warn('[magic-link] Magic Mail template metadata could not be loaded');
            }
          }

          await strapi
            .plugin('magic-mail')
            .service('email-router')
            .send({
              to: token.email,
              from,
              replyTo,
              subject,
              text,
              html,
              headers,
              // Authentication mail: transactional routing, and neither an
              // open-tracking pixel nor rewritten (tracked) login links.
              type: 'transactional',
              enableTracking: false,
              skipLinkTracking: true,
              links: [{ original: loginUrl, label: 'Magic Link Login', track: false }],
              templateId: templateReferenceId || numericTemplateId,
              templateReferenceId,
              templateData: templatePayload,
              data: templatePayload,
            });
          strapi.log.debug('[magic-link] Login e-mail sent via Magic Mail');
          return token;
        } catch {
          strapi.log.error(
            '[magic-link] Magic Mail send failed, falling back to the next provider'
          );
        }
      }

      const wantsEmailDesigner = settings.use_email_designer && settings.email_designer_template_id;
      if (wantsEmailDesigner && strapi.plugin('email-designer-5')) {
        const templateId = parseInt(settings.email_designer_template_id, 10);
        if (!Number.isNaN(templateId) && templateId > 0) {
          try {
            await strapi
              .plugin('email-designer-5')
              .service('email')
              .sendTemplatedEmail(
                { to: token.email, from, replyTo },
                { templateReferenceId: templateId, subject },
                templatePayload
              );
            strapi.log.debug('[magic-link] Login e-mail sent via Email Designer 5');
            return token;
          } catch {
            strapi.log.error(
              '[magic-link] Email Designer 5 send failed, falling back to the e-mail plugin'
            );
          }
        } else {
          strapi.log.warn(
            '[magic-link] Invalid Email Designer template id, using the e-mail plugin'
          );
        }
      }

      await strapi
        .plugin('email')
        .service('email')
        .send({
          to: token.email,
          ...(from ? { from } : {}),
          ...(replyTo ? { replyTo } : {}),
          subject,
          text,
          html,
          headers,
        });
      strapi.log.debug('[magic-link] Login e-mail sent');
      return token;
    },

    /**
     * Sends the welcome e-mail for accounts created by a magic-link request.
     * All user-controlled values are HTML-escaped.
     *
     * @param {object} user - New user.
     * @param {object} settings - Plugin settings.
     * @returns {Promise<void>}
     */
    async sendWelcomeEmail(user, settings) {
      const name = user.username || user.email;
      const appName = String(settings?.from_name || '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
      const from = this.resolveSender(settings);
      await strapi
        .plugin('email')
        .service('email')
        .send({
          to: user.email,
          ...(from ? { from } : {}),
          ...(settings?.response_email ? { replyTo: settings.response_email } : {}),
          subject: appName ? `Welcome to ${appName}` : 'Welcome',
          text: `Hi ${name},\n\nThanks for joining. Your login link is on the way.`,
          html: `<p>Hi ${escapeHtml(name)},</p><p>Thanks for joining. Your login link is on the way.</p>`,
        });
    },

    /**
     * Deactivates legacy tokens that were stored without salt (plaintext)
     * by plugin versions before the hashed-token migration.
     *
     * @returns {Promise<number>} Number of deactivated rows.
     */
    async deactivateLegacyTokens() {
      const result = await strapi.db.query(TOKEN_UID).updateMany({
        where: { is_active: true, $or: [{ token_salt: { $null: true } }, { token_salt: '' }] },
        data: { is_active: false },
      });
      return result?.count || 0;
    },

    /**
     * Deletes login tokens that expired more than 30 days ago, so the token
     * table does not grow without bound. Recent history stays visible.
     *
     * @returns {Promise<number>} Number of deleted rows.
     */
    async cleanupExpiredTokens() {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const result = await strapi.db.query(TOKEN_UID).deleteMany({
        where: { expires_at: { $lt: cutoff } },
      });
      return result?.count || 0;
    },

    /**
     * Reads the blocklist, dropping entries that have expired.
     *
     * @returns {Promise<{tokens: Array}>} Live blocklist.
     */
    async readBlocklist() {
      const stored = (await pluginStore().get({ key: BLOCKLIST_KEY })) || { tokens: [] };
      const tokens = Array.isArray(stored.tokens) ? stored.tokens : [];
      const now = Date.now();
      return {
        tokens: tokens.filter((entry) => {
          const exp = new Date(entry?.expiresAt).getTime();
          return entry?.tokenHash && (!Number.isFinite(exp) || exp > now);
        }),
      };
    },

    /**
     * Finds the plugin session record for a JWT hash.
     *
     * @param {string} tokenHash - Hash of the JWT.
     * @returns {Promise<object|null>} Session record.
     */
    async findSessionByHash(tokenHash) {
      try {
        const stored = (await pluginStore().get({ key: SESSIONS_KEY })) || { sessions: [] };
        const sessions = Array.isArray(stored.sessions) ? stored.sessions : [];
        return sessions.find((session) => session?.jwtTokenHash === tokenHash) || null;
      } catch {
        return null;
      }
    },

    /**
     * Revokes the users-permissions refresh session behind a plugin session
     * (refresh mode), so the refresh token cannot mint new access tokens.
     *
     * @param {object} session - Plugin session record.
     * @returns {Promise<boolean>} Whether a session was revoked.
     */
    async revokeUpSession(session) {
      if (!session?.upSessionId || typeof strapi.sessionManager !== 'function') return false;
      try {
        return Boolean(
          await strapi
            .sessionManager('users-permissions')
            .revokeSessionById(String(session.userId), session.upSessionId)
        );
      } catch {
        strapi.log.error('[magic-link] users-permissions session could not be revoked');
        throw new Error('Failed to revoke users-permissions session');
      }
    },

    /**
     * Blocks a JWT until it expires.
     *
     * @param {string} token - JWT to block (hashed before storage).
     * @param {string|number} userId - Owner user id.
     * @param {string} [reason] - Reason.
     * @returns {Promise<{success: boolean}>}
     */
    async blockJwtToken(token, userId, reason = 'Manually revoked') {
      const expiresAt = decodeJwtExpiry(token);
      return this.blockJwtTokenByHash(cryptoUtils.hashJwt(token), userId, reason, { expiresAt });
    },

    /**
     * Blocks a JWT by hash until the token's own expiry (taken from the
     * option, the plugin session record, or one year when unknown) and
     * revokes the users-permissions refresh session in refresh mode.
     *
     * @param {string} tokenHash - SHA-256 hash of the JWT.
     * @param {string|number} userId - Owner user id.
     * @param {string} [reason] - Reason.
     * @param {{expiresAt?: Date|string|null}} [options] - Known expiry.
     * @returns {Promise<{success: boolean}>}
     */
    async blockJwtTokenByHash(tokenHash, userId, reason = 'Manually revoked', options = {}) {
      try {
        const session = await this.findSessionByHash(tokenHash);
        const known = options.expiresAt || session?.expiresAt;
        const knownTime = known ? new Date(known).getTime() : NaN;
        const expiresAt = new Date(
          Number.isFinite(knownTime) ? knownTime : Date.now() + UNKNOWN_EXPIRY_MS
        );

        await serialize(async () => {
          const blocklist = await this.readBlocklist();
          if (!blocklist.tokens.some((entry) => entry.tokenHash === tokenHash)) {
            blocklist.tokens.push({
              tokenHash,
              userId,
              reason,
              blockedAt: new Date().toISOString(),
              expiresAt: expiresAt.toISOString(),
            });
          }
          await pluginStore().set({ key: BLOCKLIST_KEY, value: blocklist });
          blocklistCache = null;
        });

        if (session) await this.revokeUpSession(session);
        return { success: true };
      } catch {
        blocklistCache = null;
        strapi.log.error('[magic-link] Error blocking JWT token');
        throw new Error('Failed to block JWT token');
      }
    },

    async unblockJwtToken(token, userId) {
      return this.unblockJwtTokenByHash(cryptoUtils.hashJwt(token), userId);
    },

    /**
     * Removes a JWT hash from the blocklist.
     *
     * @param {string} tokenHash - SHA-256 hash of the JWT.
     * @param {string|number} [userId] - Owner user id.
     * @returns {Promise<{success: boolean}>}
     */
    async unblockJwtTokenByHash(tokenHash, userId) {
      try {
        await serialize(async () => {
          const blocklist = await this.readBlocklist();
          blocklist.tokens = blocklist.tokens.filter(
            (entry) =>
              !(
                entry.tokenHash === tokenHash &&
                (!userId || String(entry.userId) === String(userId))
              )
          );
          await pluginStore().set({ key: BLOCKLIST_KEY, value: blocklist });
          blocklistCache = null;
        });
        return { success: true };
      } catch {
        blocklistCache = null;
        strapi.log.error('[magic-link] Error unblocking JWT token');
        throw new Error('Failed to unblock JWT token');
      }
    },

    /**
     * Checks whether a JWT is revoked. Uses a short-lived in-process cache
     * that is invalidated on every local revoke/unrevoke. Store failures
     * throw so the middleware can fail closed.
     *
     * @param {string} token - JWT to check.
     * @returns {Promise<boolean>} Whether the token is blocked.
     */
    async isJwtTokenBlocked(token) {
      try {
        if (!blocklistCache || blocklistCache.expiresAt <= Date.now()) {
          const blocklist = await this.readBlocklist();
          blocklistCache = {
            hashes: new Set(blocklist.tokens.map((entry) => entry.tokenHash)),
            expiresAt: Date.now() + BLOCKLIST_CACHE_TTL_MS,
          };
        }
        return blocklistCache.hashes.has(cryptoUtils.hashJwt(token));
      } catch {
        blocklistCache = null;
        strapi.log.error('[magic-link] JWT revocation lookup failed');
        throw new Error('Failed to verify JWT revocation status');
      }
    },

    /**
     * Returns all live blocklist entries and persists the pruned list.
     *
     * @returns {Promise<Array>} Blocked token entries.
     */
    async getBlockedJwtTokens() {
      try {
        return await serialize(async () => {
          const blocklist = await this.readBlocklist();
          await pluginStore().set({ key: BLOCKLIST_KEY, value: blocklist });
          return blocklist.tokens;
        });
      } catch {
        strapi.log.error('[magic-link] Error reading blocked JWT tokens');
        return [];
      }
    },

    /**
     * Checks the canonical request IP against the stored block list.
     * Storage errors are thrown so public authentication routes can fail closed.
     *
     * @param {string} ipAddress - Request IP to check.
     * @returns {Promise<boolean>} Whether the address is blocked.
     */
    async isIPBanned(ipAddress) {
      try {
        const normalizedIpAddress = normalizeIpAddress(ipAddress);
        if (!normalizedIpAddress) throw new Error('Invalid request IP address');

        const bannedIPs = (await pluginStore().get({ key: 'banned_ips' })) || { ips: [] };
        if (!Array.isArray(bannedIPs.ips)) throw new Error('Invalid IP block-list data');

        return bannedIPs.ips.some(
          (bannedIp) => normalizeIpAddress(bannedIp) === normalizedIpAddress
        );
      } catch {
        strapi.log.error('[Magic-Link] IP ban lookup failed');
        throw new Error('IP ban status could not be checked');
      }
    },
  };
};

module.exports.clampTokenLength = clampTokenLength;
module.exports.TOKEN_LENGTH = TOKEN_LENGTH;
