'use strict';

/**
 * OTP service: e-mail one-time codes, authenticator (TOTP) enrolments and
 * backup codes.
 *
 * Security model:
 * - E-mail OTP codes are stored as peppered SHA-256 hashes. Only the newest
 *   code per (e-mail, type) is valid, attempts are counted with a
 *   compare-and-set update and codes are consumed atomically.
 * - Authenticator enrolments are namespaced by principal: `up:<id>` for
 *   users-permissions users and `admin:<id>` for admin users, so equal
 *   numeric ids can never share a second factor.
 * - TOTP secrets are AES-256-GCM encrypted. Algorithm, digits and period are
 *   stored with each enrolment, so changing the global settings only affects
 *   new enrolments.
 * - A new secret is staged in `pending` and only replaces the active secret
 *   after a valid code; the previous authenticator keeps working meanwhile.
 * - Every accepted TOTP time step is recorded with a compare-and-set update
 *   (replay protection).
 * - Backup codes have ~78 bits of entropy, are stored as owner-bound HMACs
 *   and are consumed once with a compare-and-set update.
 *
 * Query engine usage (strapi.db.query findMany/findOne/create/updateMany/
 * deleteMany with `where`, `orderBy`, `limit`, `$null`, `$in`) follows
 * docs.strapi.io/cms/api/query-engine (checked 2026-11-07); updateMany and
 * deleteMany return { count }. documentId is filled by the model default
 * (@strapi/core 5.61 transform-content-types-to-models.js createDocumentId).
 */

const crypto = require('node:crypto');
const QRCode = require('qrcode');
const emailHelpers = require('../utils/email-helpers');
const cryptoUtils = require('../utils/crypto');
const totpUtils = require('../utils/totp');
const i18n = require('../utils/i18n');
const { escapeHtml } = require('../utils/template-renderer');
const {
  getMagicMailRouter,
  isMagicMailPreSendFailure,
  describeMagicMailError,
  buildMagicMailSendOptions,
  sendViaMagicMail,
  isMagicMailQueuedResult,
  isMagicMailUncertain,
} = require('../utils/magic-mail-delivery');

const OTP_UID = 'plugin::magic-link.otp-code';
const TOTP_UID = 'plugin::magic-link.totp-config';
const ADMIN_USER_UID = 'admin::user';
const UP_USER_UID = 'plugin::users-permissions.user';

const PRINCIPAL_PREFIX = { 'users-permissions': 'up', admin: 'admin' };
const PENDING_TTL_MS = 15 * 60 * 1000;
const PENDING_ORIGINS = ['login', 'account', 'admin'];
// Database-backed second-factor guessing limit per enrolment, shared by all
// processes and independent of the rate-limiter backend: the 10th attempt
// without a success locks TOTP and backup codes for 15 minutes.
const MAX_FACTOR_ATTEMPTS = 10;
const FACTOR_LOCK_MS = 15 * 60 * 1000;
const RESERVE_RETRIES = 20;

/**
 * Normalises a principal reference. A bare id means a users-permissions
 * user (the public login flows); admin callers must pass { type: 'admin' }.
 *
 * @param {number|string|{type: string, id: number|string}} input - Principal.
 * @returns {{type: string, id: number, key: string}|null} Principal or null.
 */
const toPrincipal = (input) => {
  const raw = input && typeof input === 'object' ? input : { type: 'users-permissions', id: input };
  const prefix = PRINCIPAL_PREFIX[raw.type];
  const id = Number(raw.id);
  if (!prefix || !Number.isSafeInteger(id) || id <= 0) return null;
  return { type: raw.type, id, key: `${prefix}:${id}` };
};

const invalid = (error, message) => ({ valid: false, error, message });

module.exports = ({ strapi }) => {
  const log = {
    info: (message) => strapi?.log?.info?.(message),
    warn: (message) => strapi?.log?.warn?.(message),
    error: (message) => strapi?.log?.error?.(message),
    debug: (message) => strapi?.log?.debug?.(message),
  };

  const readSettings = async () =>
    (await strapi.store({ type: 'plugin', name: 'magic-link' }).get({ key: 'settings' })) || {};

  const otpQuery = () => strapi.db.query(OTP_UID);
  const totpQuery = () => strapi.db.query(TOTP_UID);

  /**
   * Loads the enrolment row of a principal (oldest row wins if a race ever
   * created two).
   *
   * @param {{key: string}} principal - Principal.
   * @returns {Promise<object|null>} Row.
   */
  const findConfig = async (principal) => {
    const rows = await totpQuery().findMany({
      where: { principalKey: principal.key },
      orderBy: { id: 'asc' },
      limit: 1,
    });
    return (rows && rows[0]) || null;
  };

  /**
   * Returns the enrolment parameters of a row. Rows written before 6.0.0
   * get them from the bootstrap migration; the settings are only a fallback.
   *
   * @param {object} row - Enrolment row.
   * @returns {Promise<{algorithm: string, digits: number, period: number}>}
   */
  const paramsOf = async (row) => {
    if (row?.algorithm && row?.digits && row?.period) return totpUtils.normalizeParams(row);
    return totpUtils.normalizeParams(await readSettings());
  };

  /**
   * Compare-and-set update on the enrolment revision.
   *
   * @param {object} row - Row as read.
   * @param {object} data - New values.
   * @returns {Promise<boolean>} True when this request won.
   */
  const updateIfUnchanged = async (row, data) => {
    const result = await totpQuery().updateMany({
      where: { id: row.id, revision: row.revision ?? null },
      data: { ...data, revision: (Number(row.revision) || 0) + 1 },
    });
    return result?.count === 1;
  };

  /**
   * Reserves one second-factor attempt before any code is compared. The
   * counter is increased with a compare-and-set update (retried on
   * contention), so parallel guesses on several processes are all counted.
   * Reaching MAX_FACTOR_ATTEMPTS locks the enrolment for FACTOR_LOCK_MS.
   *
   * @param {object} row - Enrolment row as read.
   * @returns {Promise<boolean>} Whether the attempt may proceed.
   */
  const reserveFactorAttempt = async (row) => {
    let current = row;
    for (let attempt = 0; attempt < RESERVE_RETRIES && current; attempt += 1) {
      const lockedUntil = current.lockedUntil ? new Date(current.lockedUntil).getTime() : 0;
      if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) return false;
      const failed = Number(current.failedAttempts) || 0;
      const next = failed + 1;
      const data =
        next >= MAX_FACTOR_ATTEMPTS
          ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + FACTOR_LOCK_MS) }
          : { failedAttempts: next };
      const result = await totpQuery().updateMany({
        where: { id: current.id, failedAttempts: current.failedAttempts ?? null },
        data,
      });
      if (result?.count === 1) return true;
      current = await totpQuery().findOne({ where: { id: current.id } });
    }
    return false;
  };

  /**
   * Clears the attempt counter after a correct code.
   *
   * @param {object} row - Enrolment row.
   * @returns {Promise<void>}
   */
  const resetFactorAttempts = async (row) => {
    await totpQuery().updateMany({
      where: { id: row.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  };

  const pendingIsUsable = (pending, now = Date.now()) =>
    Boolean(
      pending &&
      typeof pending === 'object' &&
      pending.secret &&
      PENDING_ORIGINS.includes(pending.origin) &&
      new Date(pending.expiresAt).getTime() > now
    );

  /**
   * Binding value stored on the enrolment e-mail code, so the code only
   * confirms this exact pending enrolment.
   *
   * @param {string} principalKey - Principal key.
   * @param {string} nonce - Pending nonce.
   * @returns {string} Keyed hash.
   */
  const setupBinding = (principalKey, nonce) =>
    cryptoUtils.keyedHash('totp-setup', `${principalKey}:${nonce}`);

  return {
    toPrincipal,

    // ───────────────────────────── E-mail OTP ─────────────────────────────

    /**
     * Generates a numeric code with an unbiased CSPRNG (crypto.randomInt).
     *
     * @param {number} [length] - Number of digits (4..16).
     * @returns {string} Code.
     */
    generateCode(length = 6) {
      const size = Math.min(Math.max(Number(length) || 6, 4), 16);
      let code = '';
      for (let i = 0; i < size; i += 1) {
        code += String(crypto.randomInt(0, 10));
      }
      return code;
    },

    /**
     * Creates and stores a code. All other unused codes of the same
     * (e-mail, type) are invalidated before and after the insert, so exactly
     * one code is valid even when two processes create codes at once.
     *
     * @param {string} email - Recipient.
     * @param {'email'|'totp-setup'} [type] - Purpose.
     * @param {object} [options] - { magicLinkToken, expirySeconds, codeLength, ipAddress, userAgent }.
     * @returns {Promise<object>} Stored entry plus the plaintext `code`.
     */
    async createOTP(email, type = 'email', options = {}) {
      const { magicLinkToken = null, expirySeconds = 300, codeLength = 6 } = options;
      const normalizedEmail = String(email || '')
        .trim()
        .toLowerCase();

      await this.invalidateActiveOTPs(normalizedEmail, type);

      const code = this.generateCode(codeLength);
      const entry = await otpQuery().create({
        data: {
          code: cryptoUtils.hashOTP(code),
          email: normalizedEmail,
          type,
          used: false,
          attempts: 0,
          expiresAt: new Date(Date.now() + expirySeconds * 1000),
          magicLinkToken,
          metadata: {
            createdAt: new Date().toISOString(),
            ipAddress: options.ipAddress || null,
            userAgent: options.userAgent ? String(options.userAgent).slice(0, 255) : null,
          },
        },
      });

      // A parallel createOTP (another process) may have inserted a code
      // between our invalidation and our insert. Invalidating every older
      // unused code afterwards keeps exactly one valid code: the newest.
      await otpQuery().updateMany({
        where: { email: normalizedEmail, type, used: false, id: { $lt: entry.id } },
        data: { used: true },
      });

      log.debug(`[magic-link] OTP code created (type: ${type}, expires in ${expirySeconds}s)`);
      return { ...entry, code };
    },

    /**
     * Invalidates all unused codes of an (e-mail, type) pair.
     *
     * @param {string} email - Lower-cased e-mail.
     * @param {string} type - Purpose.
     * @returns {Promise<number>} Number of invalidated codes.
     */
    async invalidateActiveOTPs(email, type) {
      const result = await otpQuery().updateMany({
        where: { email, type, used: false },
        data: { used: true },
      });
      return result?.count || 0;
    },

    /**
     * Verifies a code. Only the newest unused, unexpired code counts. The
     * attempt counter is increased with a compare-and-set update before the
     * comparison, so parallel guesses cannot exceed `otp_max_attempts`; a
     * request that loses the race is rejected without comparing.
     *
     * @param {string} email - E-mail.
     * @param {string} code - Submitted code.
     * @param {string} [type] - Purpose.
     * @param {string|null} [binding] - Stored binding (login token hash or
     *   enrolment binding). Omit only for the legacy unbound flow.
     * @returns {Promise<{valid: boolean, error?: string, message?: string}>}
     */
    async verifyOTP(email, code, type = 'email', binding = null) {
      const normalizedEmail = String(email || '')
        .trim()
        .toLowerCase();
      if (!normalizedEmail || !code) return invalid('invalid_code', 'Invalid or expired OTP code');

      try {
        const settings = await readSettings();
        const maxAttempts =
          Number.isInteger(settings.otp_max_attempts) && settings.otp_max_attempts > 0
            ? settings.otp_max_attempts
            : 3;
        const now = new Date();
        const where = {
          email: normalizedEmail,
          type,
          used: false,
          expiresAt: { $gt: now },
          ...(binding ? { magicLinkToken: binding } : {}),
        };

        const candidates = await otpQuery().findMany({ where, orderBy: { id: 'desc' }, limit: 1 });
        const entry = candidates && candidates[0];
        if (!entry) return invalid('invalid_code', 'Invalid or expired OTP code');

        const attempts = Number(entry.attempts) || 0;
        if (attempts >= maxAttempts) {
          await otpQuery().updateMany({ where: { id: entry.id }, data: { used: true } });
          return invalid('max_attempts', 'Maximum verification attempts exceeded');
        }

        const counted = await otpQuery().updateMany({
          where: { id: entry.id, used: false, attempts: entry.attempts ?? null },
          data: { attempts: attempts + 1 },
        });
        if (counted?.count !== 1) {
          return invalid('invalid_code', 'Invalid or expired OTP code');
        }

        if (!cryptoUtils.verifyOTP(String(code).trim(), entry.code)) {
          if (attempts + 1 >= maxAttempts) {
            await otpQuery().updateMany({ where: { id: entry.id }, data: { used: true } });
            log.warn('[magic-link] OTP attempts exhausted, code invalidated');
          }
          return invalid('invalid_code', 'Invalid or expired OTP code');
        }

        const consumed = await otpQuery().updateMany({
          where: { id: entry.id, used: false, expiresAt: { $gt: now } },
          data: { used: true },
        });
        if (consumed?.count !== 1) return invalid('invalid_code', 'Invalid or expired OTP code');

        return { valid: true };
      } catch {
        log.error('[magic-link] OTP verification failed');
        return invalid('server_error', 'Error verifying OTP code');
      }
    },

    /**
     * Sends a code by e-mail (MagicMail when enabled, else the Strapi e-mail
     * plugin). Neither the code nor the address is logged. The built-in
     * texts come from the server translations (server/src/i18n, mail.*) in
     * the requested locale (de, en, es, fr, pt; English otherwise).
     *
     * @param {string} email - Recipient.
     * @param {string} code - Numeric code.
     * With Magic Mail 4.4 a failed send can be captured in its outbox: it is
     * then retried until `expiresAt` (never later) and stored once per
     * `otpId`; no other provider sends the code.
     *
     * @param {object} [options] - { locale, purpose: 'login'|'setup', expiryMinutes, subject?, intro?,
     *   otpId?: OTP row id, expiresAt?: OTP expiry (both from createOTP) }.
     * @returns {Promise<boolean>} True when sent or queued by Magic Mail.
     */
    async sendOTPEmail(email, code, options = {}) {
      const settings = await readSettings();
      const locale = options.locale;
      const t = (key, params) => i18n.t(`mail.${key}`, locale, params);
      const setup = options.purpose === 'setup';
      const subject = options.subject || t(setup ? 'setup.subject' : 'otp.subject');
      const expiryMinutes = Math.max(1, Math.ceil(Number(options.expiryMinutes) || 5));
      const intro = options.intro || t(setup ? 'setup.intro' : 'otp.intro');
      const safeCode = String(code).replace(/[^0-9]/g, '');
      const minutesText = t(expiryMinutes === 1 ? 'unit.minute' : 'unit.minutes', {
        count: expiryMinutes,
      });
      const heading = t('otp.heading');
      const expiresText = t('otp.expires', { minutes: minutesText });
      const ignoreText = t('otp.ignore');

      const htmlContent = `
      <div style="text-align: center; padding: 20px;">
        <h1 style="color: #4F46E5; margin-bottom: 20px;">${escapeHtml(heading)}</h1>
        <p style="font-size: 16px; color: #374151; margin-bottom: 30px;">${escapeHtml(intro)}</p>
        <div style="background: #4F46E5; color: #ffffff; font-size: 32px; font-weight: bold;
                    letter-spacing: 8px; padding: 20px 40px; border-radius: 12px;
                    display: inline-block; margin-bottom: 30px; font-family: 'Courier New', monospace;">
          ${safeCode}
        </div>
        <p style="font-size: 14px; color: #4B5563; margin-top: 20px;">
          ${escapeHtml(expiresText)}
        </p>
        <p style="font-size: 14px; color: #4B5563; margin-top: 10px;">
          ${escapeHtml(ignoreText)}
        </p>
      </div>
    `;

      const textContent = [heading, '', intro, '', safeCode, '', expiresText, '', ignoreText].join(
        '\n'
      );

      const html = emailHelpers.wrapEmailTemplate(htmlContent, {
        title: subject,
        preheader: t('otp.preheader', { code: safeCode }),
      });
      const headers = emailHelpers.getEmailHeaders({ replyTo: settings.response_email });
      const fromName = String(settings.from_name || '')
        .replace(/[\r\n"<>]/g, '')
        .trim();
      const from = settings.from_email
        ? fromName
          ? `"${fromName}" <${settings.from_email}>`
          : settings.from_email
        : undefined;
      const message = {
        to: email,
        from,
        replyTo: settings.response_email || undefined,
        subject,
        html,
        text: textContent,
        headers,
      };

      const magicMailRouter = settings.use_magic_mail ? getMagicMailRouter(strapi) : null;
      if (magicMailRouter) {
        try {
          const sendOptions = buildMagicMailSendOptions(strapi, {
            purpose: 'otp',
            id: options.otpId,
            expiresAt: options.expiresAt,
          });
          // Codes are never tracked: no pixel, no rewritten links.
          const sent = await sendViaMagicMail(
            magicMailRouter,
            {
              ...message,
              type: 'transactional',
              enableTracking: false,
              skipLinkTracking: true,
            },
            sendOptions
          );
          if (isMagicMailQueuedResult(sent)) {
            log.warn(
              '[magic-link] Magic Mail queued the OTP e-mail for a retry; not using another provider'
            );
          }
          return true;
        } catch (error) {
          const reason = describeMagicMailError(error);
          if (isMagicMailUncertain(error)) {
            log.error(
              `[magic-link] Magic Mail recorded the OTP e-mail as uncertain in its outbox (${reason}); not retrying with another provider`
            );
            throw error;
          }
          if (!isMagicMailPreSendFailure(error)) {
            // A second provider could deliver the same code twice.
            log.error(
              `[magic-link] Magic Mail OTP delivery failed with an unknown outcome (${reason}); not retrying with another provider`
            );
            throw error;
          }
          log.warn(
            `[magic-link] Magic Mail could not send the OTP e-mail (${reason}); using the Strapi e-mail plugin`
          );
        }
      }

      await strapi.plugin('email').service('email').send(message);
      return true;
    },

    /**
     * Deletes expired codes.
     *
     * @returns {Promise<number>} Number of deleted codes.
     */
    async cleanupExpiredCodes() {
      try {
        const result = await otpQuery().deleteMany({ where: { expiresAt: { $lt: new Date() } } });
        const total = result?.count || 0;
        if (total > 0) log.info(`[magic-link] Deleted ${total} expired OTP code(s)`);
        return total;
      } catch {
        log.debug('[magic-link] OTP cleanup skipped');
        return 0;
      }
    },

    /**
     * Returns the e-mail OTP settings with defaults. E-mail is the only
     * delivery channel since 6.0.0.
     *
     * @returns {Promise<object>} OTP settings.
     */
    async getOTPSettings() {
      const settings = await readSettings();
      return {
        enabled: settings.otp_enabled === true,
        type: 'email',
        length: settings.otp_length || 6,
        expiry: settings.otp_expiry || 300,
        maxAttempts: settings.otp_max_attempts || 3,
        resendCooldown: Number.isFinite(settings.otp_resend_cooldown)
          ? settings.otp_resend_cooldown
          : 60,
      };
    },

    // ─────────────────────────── Authenticator (TOTP) ───────────────────────────

    /**
     * Returns the enrolment state of a principal.
     *
     * @param {number|object} principalInput - Principal (bare id = users-permissions).
     * @returns {Promise<object>} { configured, enabled, pendingSetup, lastUsed,
     *   backupCodesRemaining, algorithm?, digits?, period? }.
     */
    async getTOTPStatus(principalInput) {
      const principal = toPrincipal(principalInput);
      const empty = {
        configured: false,
        enabled: false,
        pendingSetup: false,
        backupCodesRemaining: 0,
      };
      if (!principal) return empty;
      try {
        const row = await findConfig(principal);
        if (!row) return empty;
        const active = Boolean(row.enabled && row.secret);
        const params = active ? await paramsOf(row) : null;
        return {
          configured: active,
          enabled: active,
          pendingSetup: pendingIsUsable(row.pending),
          lastUsed: row.lastUsed || null,
          backupCodesRemaining:
            active &&
            row.backupCodesVersion === totpUtils.BACKUP_HASH_VERSION &&
            Array.isArray(row.backupCodes)
              ? row.backupCodes.length
              : 0,
          ...(params || {}),
        };
      } catch {
        log.error('[magic-link] TOTP status lookup failed');
        return empty;
      }
    },

    /**
     * Stages a new authenticator secret. An active authenticator stays
     * active until the new one is confirmed. Callers must check a current
     * code before re-enrolment (see the controllers).
     *
     * @param {number|object} principalInput - Principal.
     * @param {string} email - Account e-mail (QR label).
     * @param {{origin?: 'login'|'account'|'admin', requireEmailProof?: boolean}} [options]
     * @returns {Promise<object>} { secret, qrCode, otpauthUrl, algorithm, digits,
     *   period, expiresAt, binding? }. The plaintext secret is returned once.
     */
    async beginSetup(principalInput, email, options = {}) {
      const principal = toPrincipal(principalInput);
      if (!principal) throw new Error('Invalid principal');
      const origin = PENDING_ORIGINS.includes(options.origin) ? options.origin : 'account';

      const settings = await readSettings();
      const params = totpUtils.normalizeParams(settings);
      const secret = totpUtils.generateSecret();
      const nonce = crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + PENDING_TTL_MS).toISOString();
      const pending = {
        secret: cryptoUtils.encrypt(secret),
        ...params,
        origin,
        nonce,
        requireEmailProof: options.requireEmailProof === true,
        createdAt: new Date().toISOString(),
        expiresAt,
      };

      const row = await findConfig(principal);
      if (row) {
        if (!(await updateIfUnchanged(row, { pending, email })))
          throw new Error('Concurrent TOTP update');
      } else {
        await totpQuery().create({
          data: {
            principalType: principal.type,
            principalKey: principal.key,
            userId: principal.id,
            email,
            enabled: false,
            pending,
            revision: 0,
          },
        });
        // A concurrent request (possibly on another process) may have
        // created a row as well: keep the oldest and remove the rest. The
        // surviving row must carry this request's nonce, also when the other
        // request already removed our row (then only one row is left), or
        // the returned secret would never have been stored.
        const rows = await totpQuery().findMany({
          where: { principalKey: principal.key },
          orderBy: { id: 'asc' },
        });
        if (Array.isArray(rows) && rows.length > 1) {
          await totpQuery().deleteMany({ where: { id: { $in: rows.slice(1).map((r) => r.id) } } });
        }
        if (!Array.isArray(rows) || rows.length === 0 || rows[0].pending?.nonce !== nonce) {
          throw new Error('Concurrent TOTP update');
        }
      }

      const otpauthUrl = totpUtils.buildUri({
        secret,
        issuer: settings.totp_issuer || 'Magic Link',
        label: email,
        totp: params,
      });
      const qrCode = await QRCode.toDataURL(otpauthUrl);

      return {
        secret,
        qrCode,
        otpauthUrl,
        ...params,
        expiresAt,
        ...(pending.requireEmailProof ? { binding: setupBinding(principal.key, nonce) } : {}),
      };
    },

    /**
     * Confirms a staged secret with a code from the new authenticator and
     * activates it. Returns fresh backup codes once.
     *
     * @param {number|object} principalInput - Principal.
     * @param {string} code - TOTP code from the new authenticator.
     * @param {{origin?: string, emailProof?: {email: string, code: string}}} [options]
     * @returns {Promise<{valid: boolean, backupCodes?: string[], error?: string}>}
     */
    async confirmSetup(principalInput, code, options = {}) {
      const principal = toPrincipal(principalInput);
      if (!principal) return invalid('totp_not_setup', 'No authenticator setup is pending');
      try {
        const row = await findConfig(principal);
        const pending = row?.pending;
        const origin = PENDING_ORIGINS.includes(options.origin) ? options.origin : 'account';
        if (!row || !pendingIsUsable(pending) || pending.origin !== origin) {
          return invalid('totp_not_setup', 'No authenticator setup is pending');
        }

        const params = totpUtils.normalizeParams(pending);
        const check = await totpUtils.verifyCode({
          secret: cryptoUtils.decrypt(pending.secret),
          code,
          totp: params,
        });
        if (!check.valid) return invalid('invalid_token', 'Invalid TOTP code');

        if (pending.requireEmailProof) {
          const proof = options.emailProof;
          if (!proof?.code || !proof?.email)
            return invalid('email_proof_required', 'E-mail code required');
          const emailCheck = await this.verifyOTP(
            proof.email,
            proof.code,
            'totp-setup',
            setupBinding(principal.key, pending.nonce)
          );
          if (!emailCheck.valid)
            return invalid('invalid_email_code', 'Invalid or expired e-mail code');
        }

        const backupCodes = totpUtils.generateBackupCodes();
        const ok = await updateIfUnchanged(row, {
          secret: pending.secret,
          algorithm: params.algorithm,
          digits: params.digits,
          period: params.period,
          enabled: true,
          pending: null,
          lastUsed: new Date(),
          lastUsedStep: check.timeStep,
          backupCodes: backupCodes.map((value) => totpUtils.hashBackupCode(principal.key, value)),
          backupCodesVersion: totpUtils.BACKUP_HASH_VERSION,
        });
        if (!ok) return invalid('totp_replayed', 'This setup was already completed');

        log.info('[magic-link] Authenticator enrolled');
        return { valid: true, enabled: true, backupCodes };
      } catch {
        log.error('[magic-link] TOTP setup confirmation failed');
        return invalid('server_error', 'Error confirming TOTP setup');
      }
    },

    /**
     * Verifies a code from the active authenticator. The matched time step
     * is recorded with a compare-and-set update, so a code (or an older one)
     * can never be used twice.
     *
     * @param {number|object} principalInput - Principal (bare id = users-permissions).
     * @param {string} token - TOTP code.
     * @returns {Promise<{valid: boolean, error?: string, message?: string}>}
     */
    async verifyTOTP(principalInput, token) {
      const principal = toPrincipal(principalInput);
      if (!principal) return invalid('totp_not_setup', 'TOTP is not set up for this user');
      try {
        const row = await findConfig(principal);
        if (!row || !row.enabled || !row.secret) {
          return invalid('totp_not_setup', 'TOTP is not set up for this user');
        }

        if (!(await reserveFactorAttempt(row))) {
          log.warn('[magic-link] TOTP attempts exhausted, authenticator temporarily locked');
          return invalid('invalid_token', 'Invalid TOTP code');
        }

        const params = await paramsOf(row);
        const check = await totpUtils.verifyCode({
          secret: cryptoUtils.decrypt(row.secret),
          code: token,
          totp: params,
        });
        if (!check.valid) return invalid('invalid_token', 'Invalid TOTP code');

        // Rows from before lastUsedStep existed: their last verification time
        // is a conservative lower bound.
        let lastUsedStep = null;
        if (row.lastUsedStep != null) {
          lastUsedStep = Number(row.lastUsedStep);
        } else if (row.lastUsed) {
          lastUsedStep = Math.floor(new Date(row.lastUsed).getTime() / 1000 / params.period);
        }
        if (
          lastUsedStep !== null &&
          (!Number.isFinite(lastUsedStep) || check.timeStep <= lastUsedStep)
        ) {
          return invalid('totp_replayed', 'This TOTP code has already been used');
        }

        const result = await totpQuery().updateMany({
          where: { id: row.id, enabled: true, lastUsedStep: row.lastUsedStep ?? null },
          data: { lastUsed: new Date(), lastUsedStep: check.timeStep },
        });
        if (result?.count !== 1)
          return invalid('totp_replayed', 'This TOTP code has already been used');

        await resetFactorAttempts(row);
        return { valid: true, enabled: true };
      } catch {
        log.error('[magic-link] TOTP verification failed');
        return invalid('server_error', 'Error verifying TOTP code');
      }
    },

    /**
     * Redeems a backup code once.
     *
     * @param {number|object} principalInput - Principal.
     * @param {string} code - Backup code.
     * @returns {Promise<{valid: boolean, remaining?: number, error?: string}>}
     */
    async consumeBackupCode(principalInput, code) {
      const principal = toPrincipal(principalInput);
      if (!principal) return invalid('invalid_backup_code', 'Invalid backup code');
      try {
        const candidate = totpUtils.hashBackupCode(principal.key, code);
        const row = await findConfig(principal);
        if (
          !candidate ||
          !row?.enabled ||
          row.backupCodesVersion !== totpUtils.BACKUP_HASH_VERSION ||
          !Array.isArray(row.backupCodes)
        ) {
          return invalid('invalid_backup_code', 'Invalid backup code');
        }
        if (!(await reserveFactorAttempt(row))) {
          log.warn('[magic-link] Backup code attempts exhausted, authenticator temporarily locked');
          return invalid('invalid_backup_code', 'Invalid backup code');
        }
        const index = totpUtils.findHashIndex(row.backupCodes, candidate);
        if (index === -1) return invalid('invalid_backup_code', 'Invalid backup code');

        const remaining = row.backupCodes.filter((_, i) => i !== index);
        if (!(await updateIfUnchanged(row, { backupCodes: remaining, lastUsed: new Date() }))) {
          return invalid('invalid_backup_code', 'Invalid backup code');
        }

        await resetFactorAttempts(row);
        log.info('[magic-link] Backup code redeemed');
        return { valid: true, remaining: remaining.length };
      } catch {
        log.error('[magic-link] Backup code verification failed');
        return invalid('server_error', 'Error verifying backup code');
      }
    },

    /**
     * Verifies either a TOTP code or a backup code.
     *
     * @param {number|object} principalInput - Principal.
     * @param {{totpCode?: string, backupCode?: string}} input - Submitted factor.
     * @returns {Promise<{valid: boolean, method?: 'totp'|'backup-code'}>}
     */
    async verifySecondFactor(principalInput, { totpCode, backupCode } = {}) {
      if (backupCode) {
        const result = await this.consumeBackupCode(principalInput, backupCode);
        return result.valid ? { ...result, method: 'backup-code' } : result;
      }
      const result = await this.verifyTOTP(principalInput, totpCode);
      return result.valid ? { ...result, method: 'totp' } : result;
    },

    /**
     * Runs a TOTP verification against a random secret, so requests for
     * unknown accounts take about as long as real verifications.
     *
     * @param {string} code - Submitted code.
     * @returns {Promise<void>}
     */
    async simulateVerification(code) {
      try {
        cryptoUtils.decrypt(cryptoUtils.encrypt('timing-equalisation'));
      } catch {
        // timing equalisation only
      }
      await totpUtils.verifyCode({
        secret: totpUtils.generateSecret(),
        code,
        totp: totpUtils.DEFAULT_PARAMS,
      });
    },

    /**
     * Replaces all backup codes. Callers must verify a current TOTP code first.
     *
     * @param {number|object} principalInput - Principal.
     * @returns {Promise<string[]>} New codes (shown once).
     */
    async regenerateBackupCodes(principalInput) {
      const principal = toPrincipal(principalInput);
      const row = principal ? await findConfig(principal) : null;
      if (!row?.enabled) throw new Error('TOTP not configured');
      const codes = totpUtils.generateBackupCodes();
      const ok = await updateIfUnchanged(row, {
        backupCodes: codes.map((value) => totpUtils.hashBackupCode(principal.key, value)),
        backupCodesVersion: totpUtils.BACKUP_HASH_VERSION,
      });
      if (!ok) throw new Error('Concurrent TOTP update');
      log.info('[magic-link] Backup codes regenerated');
      return codes;
    },

    /**
     * Removes the enrolment (active and pending). Callers must verify a
     * current TOTP or backup code first.
     *
     * @param {number|object} principalInput - Principal.
     * @returns {Promise<boolean>} True when something was removed.
     */
    async disableTOTP(principalInput) {
      const principal = toPrincipal(principalInput);
      if (!principal) return false;
      try {
        const result = await totpQuery().deleteMany({ where: { principalKey: principal.key } });
        if (result?.count > 0) log.info('[magic-link] Authenticator removed');
        return (result?.count || 0) > 0;
      } catch {
        log.error('[magic-link] TOTP disable failed');
        return false;
      }
    },

    /**
     * One-time, idempotent migration of enrolments written before 6.0.0:
     * - assigns a principal only where ownership is provable (the account
     *   with that id still has the enrolment e-mail); everything else is
     *   disabled (fail closed),
     * - stores the enrolment parameters (taken from the settings in force),
     * - drops unconfirmed secrets (setup must be redone),
     * - drops legacy unsalted backup-code hashes (they were never redeemable),
     * - re-encrypts secrets still encrypted with MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS.
     *
     * @returns {Promise<{assigned: number, disabled: number, reencrypted: number}>}
     */
    async migrateTotpConfigs() {
      const stats = { assigned: 0, disabled: 0, reencrypted: 0 };
      const params = totpUtils.normalizeParams(await readSettings());
      const sameEmail = (a, b) =>
        String(a || '')
          .trim()
          .toLowerCase() ===
        String(b || '')
          .trim()
          .toLowerCase();

      const legacy = await totpQuery().findMany({
        where: { principalKey: { $null: true } },
        orderBy: { id: 'asc' },
      });
      for (const row of legacy || []) {
        const [adminUser, upUser] = await Promise.all([
          strapi.db
            .query(ADMIN_USER_UID)
            .findOne({ where: { id: row.userId }, select: ['id', 'email'] }),
          strapi.db
            .query(UP_USER_UID)
            .findOne({ where: { id: row.userId }, select: ['id', 'email'] }),
        ]);
        const adminOwns = Boolean(adminUser && sameEmail(adminUser.email, row.email));
        const upOwns = Boolean(upUser && sameEmail(upUser.email, row.email));
        // Matching e-mails mean the same mailbox owner. When both match, the
        // users-permissions login is the only place the enrolment had effect.
        let type = null;
        if (upOwns) type = 'users-permissions';
        else if (adminOwns) type = 'admin';
        const principal = type ? toPrincipal({ type, id: row.userId }) : null;
        const taken = principal ? await findConfig(principal) : null;

        const data = {
          algorithm: params.algorithm,
          digits: params.digits,
          period: params.period,
          backupCodes: null,
          backupCodesVersion: null,
          revision: Number(row.revision) || 0,
        };
        if (principal && !taken) {
          Object.assign(data, { principalType: principal.type, principalKey: principal.key });
          if (!row.enabled) Object.assign(data, { secret: null, pending: null });
          stats.assigned += 1;
        } else {
          Object.assign(data, {
            principalType: 'legacy',
            principalKey: `legacy:${row.id}`,
            enabled: false,
            pending: null,
          });
          stats.disabled += 1;
        }
        await totpQuery().updateMany({
          where: { id: row.id, principalKey: { $null: true } },
          data,
        });
      }

      if (process.env.MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS) {
        const rows = await totpQuery().findMany({
          where: { secret: { $notNull: true } },
          select: ['id', 'secret'],
        });
        for (const row of rows || []) {
          try {
            const { value, usedPreviousKey } = cryptoUtils.decryptWithInfo(row.secret);
            if (usedPreviousKey) {
              await totpQuery().updateMany({
                where: { id: row.id, secret: row.secret },
                data: { secret: cryptoUtils.encrypt(value) },
              });
              stats.reencrypted += 1;
            }
          } catch {
            log.warn(
              '[magic-link] A TOTP secret could not be decrypted with the current or previous key'
            );
          }
        }
      }

      return stats;
    },

    // ─────────────────────────── Deprecated aliases ───────────────────────────

    /**
     * @deprecated since 6.0.0, use beginSetup().
     * @param {number|object} principalInput - Principal.
     * @param {string} email - E-mail.
     * @returns {Promise<object>} Setup data.
     */
    async setupTOTP(principalInput, email) {
      return this.beginSetup(principalInput, email, { origin: 'account' });
    },

    /**
     * @deprecated since 6.0.0, use regenerateBackupCodes().
     * @param {number|object} principalInput - Principal.
     * @returns {Promise<string[]>} Codes.
     */
    async generateBackupCodes(principalInput) {
      return this.regenerateBackupCodes(principalInput);
    },
  };
};

module.exports.toPrincipal = toPrincipal;
module.exports.FACTOR_ATTEMPT_LIMIT = Object.freeze({
  attempts: MAX_FACTOR_ATTEMPTS,
  lockMs: FACTOR_LOCK_MS,
});
