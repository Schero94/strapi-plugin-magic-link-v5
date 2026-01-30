'use strict';

/**
 * magic-link.js service
 *
 * @description: A set of functions similar to controller's actions to avoid code duplication.
 * 
 * Security:
 * - Magic Link tokens are hashed before storage
 * - Uses Document Service API (strapi.documents) for Strapi v5
 */

const _ = require('lodash');
const { nanoid } = require('nanoid');
const { sanitize } = require('@strapi/utils');
const emailHelpers = require('../utils/email-helpers');
const cryptoUtils = require('../utils/crypto');

// Helper to format expiry time in human-readable format
const formatExpiryText = (minutes) => {
  if (!minutes || Number.isNaN(minutes)) {
    return '1 hour';
  }
  const safeMinutes = Math.max(1, Math.round(minutes));
  if (safeMinutes >= 60) {
    const hours = Math.ceil(safeMinutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
};

module.exports = ({ strapi }) => ({
  async initialize() {
    // Initialization logic if needed
  },

  async settings() {
    const pluginStore = strapi.store({
      type: 'plugin',
      name: 'magic-link',
    });
    return pluginStore.get({ key: 'settings' });
  },

  async userSettings() {
    const pluginStore = strapi.store({
      type: 'plugin',
      name: 'users-permissions',
    });
    return pluginStore.get({ key: 'advanced' });
  },

  async isEnabled() {
    const settings = await this.settings();
    // Wenn keine Settings existieren oder enabled nicht gesetzt ist, standardmäßig true zurückgeben
    return settings ? (settings.enabled !== false) : true;
  },

  async createUser(user) {
    const userSettings = await this.userSettings();
    
    // Using Document Service API for role lookup
    const roles = await strapi.documents('plugin::users-permissions.role').findMany({
      filters: { type: userSettings.default_role },
      limit: 1,
    });
    const role = roles && roles.length > 0 ? roles[0] : null;

    if (!role) {
      throw new Error('Default role not found');
    }

    const newUser = {
      ...user,
      provider: 'local',
      confirmed: true,
      blocked: false,
      role: role.id,
    };

    // Using Document Service API
    const createdUser = await strapi.documents('plugin::users-permissions.user').create({
      data: newUser,
    });

    return createdUser;
  },

  async user(email, username) {
    const settings = await this.settings();
    const createUserIfNotExists = settings?.createUserIfNotExists !== false;
    
    strapi.log.debug(`[MagicLink Service] Checking user: ${email || username}, createUserIfNotExists: ${createUserIfNotExists}`);

    // Using Document Service API
    const users = await strapi.documents('plugin::users-permissions.user').findMany({
      filters: email ? { email } : { username },
      limit: 1,
    });
    const user = users && users.length > 0 ? users[0] : null;
    
    strapi.log.debug(`[MagicLink Service] User found: ${!!user}`);

    if (!user && !createUserIfNotExists) {
      strapi.log.warn(`[MagicLink Service] User not found AND createUserIfNotExists is false.`);
      throw new Error('User not found and auto-creation disabled.');
    }

    if (!user && createUserIfNotExists) {
      strapi.log.info(`[MagicLink Service] Creating new user for: ${email}`);
      const newUser = await this.createUser({
        email,
        username: username || email.split('@')[0],
      });
      return newUser;
    }

    return user;
  },

  async createToken(email, context = {}) {
    const settings = await this.settings();
    const tokenLength = settings?.token_length || 20;
    const token = nanoid(tokenLength);
    
    // Use expire_period from settings (in seconds), default 3600 (1 hour)
    const expireSeconds = settings?.expire_period || 3600;
    const expires = new Date();
    expires.setSeconds(expires.getSeconds() + expireSeconds);

    // Hash the token for secure storage
    const { hash: tokenHash, salt: tokenSalt } = cryptoUtils.hashToken(token);

    // Using Document Service API
    const tokenObject = await strapi.documents('plugin::magic-link.token').create({
      data: {
        email,
        token: tokenHash, // Store hashed token
        token_salt: tokenSalt, // Store salt for verification
        expires_at: expires,
        is_active: true,
        context: typeof context === 'string' ? JSON.parse(context) : context,
      },
    });

    // Return with plaintext token for URL (not stored in DB)
    return { ...tokenObject, token, _plaintextToken: token };
  },

  async fetchToken(token) {
    // Since tokens are now hashed, we need to find by comparing hashes
    // Get active tokens and find the matching one
    const tokens = await strapi.documents('plugin::magic-link.token').findMany({
      filters: { is_active: true },
      sort: [{ createdAt: 'desc' }],
      limit: 100, // Limit search for performance
    });
    
    // Find token with matching hash (timing-safe comparison)
    const matchedToken = tokens.find(t => {
      // Handle both old (plaintext) and new (hashed) tokens
      if (t.token_salt) {
        // New hashed token
        return cryptoUtils.verifyToken(token, t.token, t.token_salt);
      } else {
        // Legacy plaintext token (backwards compatibility)
        return t.token === token;
      }
    });
    
    return matchedToken || null;
  },

  async isTokenValid(token) {
    const { is_active, expires_at, is_used } = token;
    const settings = await this.settings();
    const staysValid = settings?.stays_valid || false;

    // Token must be active
    if (!is_active) {
      return false;
    }

    // Token must not be expired (always check, regardless of stays_valid)
    const currentTime = new Date();
    const expiryTime = new Date(expires_at);
    if (currentTime >= expiryTime) {
      return false;
    }

    // If stays_valid is false, token can only be used once
    // If stays_valid is true, token can be used multiple times until expiry
    if (!staysValid && is_used) {
      return false;
    }

    return true;
  },

  async deactivateToken(token) {
    // Using Document Service API
    return strapi.documents('plugin::magic-link.token').update({
      documentId: token.documentId,
      data: { is_active: false },
    });
  },

  async updateTokenOnLogin(token, requestInfo = null) {
    const settings = await this.settings();
    const staysValid = settings?.stays_valid || false;
    const storeLoginInfo = settings?.store_login_info !== false;

    // Prepare data to update
    const updateData = { 
      // Always mark token as used
      is_used: true,
      // Set first used_at if not already set
      used_at: token.used_at || new Date(),
      // If stays_valid is false, deactivate token after first use
      // If stays_valid is true, keep token active for multiple uses
      is_active: staysValid 
    };

    // Store login information if enabled
    if (storeLoginInfo && requestInfo) {
      updateData.last_used_at = new Date();
      
      if (requestInfo.userAgent) {
        updateData.user_agent = requestInfo.userAgent;
      }
      
      if (requestInfo.ipAddress) {
        updateData.ip_address = requestInfo.ipAddress;
      }
    }
    
    strapi.log.debug(`[MagicLink] Token ${token.documentId} used. stays_valid=${staysValid}, is_active=${updateData.is_active}`);

    // Using Document Service API
    return strapi.documents('plugin::magic-link.token').update({
      documentId: token.documentId,
      data: updateData
    });
  },

  async sendLoginLink(token) {
    const settings = await this.settings();
    const emailTemplate = {
      subject: settings?.object || 'Your Magic Link',
      text: settings?.message_text || 'Click here to login: <%= URL %>?loginToken=<%= CODE %>',
      html: settings?.message_html || '<a href="<%= URL %>?loginToken=<%= CODE %>">Click here to login</a>',
    };

    const emailConfig = {
      from: `${settings?.from_name || 'Magic Link'} <${settings?.from_email || 'noreply@example.com'}>`,
      response_email: settings?.response_email,
      object: settings?.object || 'Your Magic Link',
      message: settings?.message_text || 'Click here to login',
    };

    // Replace variables in the email template
    const url = settings?.confirmationUrl || `${process.env.URL || 'http://localhost:1337'}/api/magic-link/login`;
    // Use plaintext token for email (from _plaintextToken or legacy token field)
    const code = token._plaintextToken || token.token;

    // Calculate expiry text early for template replacement
    let expiryTextForTemplate = '1 hour'; // Default
    if (token.expires_at) {
      const expiresAt = new Date(token.expires_at);
      const now = new Date();
      const minutesUntilExpiry = Math.max(1, Math.floor((expiresAt - now) / (1000 * 60)));
      expiryTextForTemplate = formatExpiryText(minutesUntilExpiry);
    } else if (settings?.expire_period) {
      const minutes = Math.floor(settings.expire_period / 60);
      expiryTextForTemplate = formatExpiryText(minutes);
    }
    
    // Replace variables in the email template
    let html = _.template(emailTemplate.html)({
      URL: url,
      CODE: code,
      EXPIRY_TEXT: expiryTextForTemplate,
    });

    let text = _.template(emailTemplate.text)({
      URL: url,
      CODE: code,
      EXPIRY_TEXT: expiryTextForTemplate,
    });

    // Wrap HTML in email-client compatible template if not already wrapped
    if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
      html = emailHelpers.wrapEmailTemplate(html, {
        title: emailConfig.object,
        preheader: 'Your secure login link is ready'
      });
    }

    // Ensure plain text version exists
    if (!text || text.trim().length === 0) {
      text = emailHelpers.createPlainTextVersion(html);
    }

    // Get email headers for better deliverability
    const headers = emailHelpers.getEmailHeaders({
      replyTo: emailConfig.response_email
    });

    // Validate email configuration
    const validation = emailHelpers.validateEmailConfig({
      to: token.email,
      from: emailConfig.from,
      subject: emailConfig.object,
      text,
      html
    });

    if (!validation.valid) {
      strapi.log.error('Email validation errors:', validation.errors);
      throw new Error('Invalid email configuration: ' + validation.errors.join(', '));
    }

    if (validation.warnings.length > 0) {
      strapi.log.warn('Email validation warnings:', validation.warnings);
    }

    // Build the full login URL for click tracking
    const loginUrl = `${url}?loginToken=${code}`;
    
    const templatePayload = {
      URL: url,
      Url: url,
      url,
      BASE_URL: url,
      baseUrl: url,
      loginUrl,
      login_url: loginUrl,
      LOGIN_URL: loginUrl,
      magicLinkUrl: loginUrl,
      magic_link_url: loginUrl,
      MAGIC_LINK_URL: loginUrl,
      CODE: code,
      Code: code,
      code,
      token: code,
      TOKEN: code,
      email: token.email,
      recipient: token.email,
      // Expiry text for email templates
      EXPIRY_TEXT: expiryTextForTemplate,
      expiryText: expiryTextForTemplate,
      expiry_text: expiryTextForTemplate,
    };
    
    // Check if MagicMail should be used
    if (settings.use_magic_mail && strapi.plugin('magic-mail')) {
      try {
        strapi.log.info(`Sending Magic Link via MagicMail with click tracking...`);
        strapi.log.info(`[DEBUG] MagicMail settings - use_magic_mail: ${settings.use_magic_mail}, template_id: ${settings.magic_mail_template_id}`);
        
        // Warn if MagicMail is enabled but no template selected
        if (!settings.magic_mail_template_id) {
          strapi.log.warn('[WARNING] MagicMail is enabled but no template ID is set. Using fallback HTML/text content.');
        }

        const numericTemplateId = settings.magic_mail_template_id
          ? Number(settings.magic_mail_template_id)
          : undefined;
        let templateReferenceId = settings.magic_mail_template_reference_id || undefined;

        if (numericTemplateId) {
          try {
            const templateRecord = await strapi
              .plugin('magic-mail')
              .service('email-designer')
              .findOne(numericTemplateId);

            if (templateRecord?.templateReferenceId) {
              templateReferenceId = templateRecord.templateReferenceId;
              strapi.log.info(
                `[DEBUG] MagicMail template metadata resolved - id: ${numericTemplateId}, reference: ${templateReferenceId}, name: ${templateRecord.name}`
              );
            } else {
              strapi.log.warn(
                `[WARN] MagicMail template ${numericTemplateId} has no templateReferenceId. Rendering may fall back to raw HTML.`
              );
            }
          } catch (lookupError) {
            strapi.log.error(
              `[ERROR] Failed to load MagicMail template metadata for ID ${numericTemplateId}: ${lookupError.message}`,
              lookupError
            );
          }
        }

        const routerTemplateId = templateReferenceId || numericTemplateId;
        
        // IMPORTANT: Do NOT track magic link URLs!
        // Tracking replaces the login URL with an ugly tracking URL which:
        // 1. Breaks if tracking service is down
        // 2. Looks suspicious to users
        // 3. Can't be easily copied/shared
        // 4. Adds unnecessary latency to login flow
        //
        // Instead, we pass the magic link URL directly in the template data
        // so it renders as-is without modification.
        
        await strapi.plugin('magic-mail').service('email-router').send({
          to: token.email,
          from: emailConfig.from,
          replyTo: emailConfig.response_email,
          subject: emailConfig.object,
          text,
          html,
          headers,
          // CRITICAL: Skip link tracking for magic links!
          // Link tracking replaces URLs with ugly tracking URLs which:
          // 1. Look suspicious to users (phishing concern)
          // 2. Break if tracking service is down
          // 3. Can't be easily copied/shared
          // 4. Add unnecessary latency to login flow
          // Open tracking (pixel) is still enabled for analytics
          skipLinkTracking: true,
          links: [
            {
              original: loginUrl,
              label: 'Magic Link Login',
              track: false
            }
          ],
          // Optional: Use selected template
          templateId: routerTemplateId,
          templateReferenceId,
          templateData: templatePayload,
          data: templatePayload,
        });
        
        strapi.log.info(`Magic Link email sent via MagicMail to ${token.email}`);
        return token;
      } catch (error) {
        strapi.log.error('MagicMail send failed, falling back to default provider:', error);
        // Continue to fallback below
      }
    }

    // Send the email via default provider
    await strapi.plugin('email').service('email').send({
      to: token.email,
      from: emailConfig.from,
      replyTo: emailConfig.response_email,
      subject: emailConfig.object,
      text,
      html,
      headers
    });

    strapi.log.info(`Magic Link email sent to ${token.email}`);
    return token;
  },

  /**
   * Send Magic Link via WhatsApp
   * @param {object} token - Token object with email and _plaintextToken
   * @param {string} phoneNumber - Phone number to send to
   */
  async sendLoginLinkViaWhatsApp(token, phoneNumber) {
    const settings = await this.settings();
    const whatsappService = strapi.plugin('magic-link').service('whatsapp');

    // Build magic link URL
    const url = settings?.confirmationUrl || `${process.env.URL || 'http://localhost:1337'}/api/magic-link/login`;
    const code = token._plaintextToken || token.token;
    const magicLink = `${url}?loginToken=${code}`;

    // Calculate expiry text
    let expiryText = '1 hour';
    if (token.expires_at) {
      const expiresAt = new Date(token.expires_at);
      const now = new Date();
      const minutesUntilExpiry = Math.max(1, Math.floor((expiresAt - now) / (1000 * 60)));
      expiryText = formatExpiryText(minutesUntilExpiry);
    } else if (settings?.expire_period) {
      const minutes = Math.floor(settings.expire_period / 60);
      expiryText = formatExpiryText(minutes);
    }

    // Get custom message or use default
    const appName = settings?.whatsapp_app_name || settings?.from_name || 'Magic Link';
    const customMessage = settings?.whatsapp_message_template;

    // Send via WhatsApp service
    const result = await whatsappService.sendMagicLink(phoneNumber, magicLink, {
      appName,
      expiryText,
      customMessage,
    });

    if (result.success) {
      strapi.log.info(`Magic Link sent via WhatsApp to ${phoneNumber}`);
    } else {
      strapi.log.error(`Failed to send Magic Link via WhatsApp: ${result.error}`);
    }

    return result;
  },

  /**
   * Sperrt einen bestimmten JWT-Token vor seinem Ablauf
   * @param {string} token - Der zu sperrende JWT-Token
   * @param {string} userId - Die Benutzer-ID des Token-Inhabers
   * @param {string} reason - Grund für die Sperrung (optional)
   */
  async blockJwtToken(token, userId, reason = 'Manually revoked') {
    try {
      // Holen des aktuellen Sets gesperrter Tokens
      const pluginStore = strapi.store({
      type: 'plugin',
        name: 'magic-link',
      });
      
      const blockedTokens = (await pluginStore.get({ key: 'blocked_jwt_tokens' })) || { tokens: [] };
      
      // Standardablaufdatum (30 Tage ab jetzt) - wir verzichten auf die Verifizierung
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);
      
      // Hinzufügen des neuen Tokens zur Blacklist
      blockedTokens.tokens.push({
        token: token,
        userId: userId,
        reason: reason,
        blockedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString()
      });
      
      // Speichern der aktualisierten Liste
      await pluginStore.set({ key: 'blocked_jwt_tokens', value: blockedTokens });
      
      return { success: true };
    } catch (error) {
      strapi.log.error('Error blocking JWT token:', error);
      throw new Error('Failed to block JWT token');
    }
  },

  /**
   * Entsperrt einen bestimmten JWT-Token
   * @param {string} token - Der zu entsperrende JWT-Token
   * @param {string} userId - Die Benutzer-ID des Token-Inhabers
   */
  async unblockJwtToken(token, userId) {
    try {
      // Holen des aktuellen Sets gesperrter Tokens
      const pluginStore = strapi.store({
      type: 'plugin',
        name: 'magic-link',
      });
      
      const blockedTokensData = (await pluginStore.get({ key: 'blocked_jwt_tokens' })) || { tokens: [] };
      
      // Entfernen des Token aus der Blacklist
      blockedTokensData.tokens = blockedTokensData.tokens.filter(t => 
        !(t.token === token && (t.userId === userId || !userId))
      );
      
      // Speichern der aktualisierten Liste
      await pluginStore.set({ key: 'blocked_jwt_tokens', value: blockedTokensData });
      
      return { success: true };
    } catch (error) {
      strapi.log.error('Error unblocking JWT token:', error);
      throw new Error('Failed to unblock JWT token');
    }
  },

  /**
   * Prüft, ob ein JWT-Token gesperrt ist
   * @param {string} token - Der zu überprüfende JWT-Token
   * @returns {boolean} - True, wenn der Token gesperrt ist
   */
  async isJwtTokenBlocked(token) {
    try {
      const pluginStore = strapi.store({
      type: 'plugin',
        name: 'magic-link',
      });
      
      const blockedTokens = (await pluginStore.get({ key: 'blocked_jwt_tokens' })) || { tokens: [] };
      
      // Prüfen, ob der Token in der Blocklist ist
      return blockedTokens.tokens.some(blockedToken => blockedToken.token === token);
    } catch (error) {
      console.error('Error checking if JWT token is blocked:', error);
      return false;
    }
  },

  /**
   * Gibt alle gesperrten JWT-Tokens zurück
   * @returns {Array} - Liste aller gesperrten Tokens
   */
  async getBlockedJwtTokens() {
    try {
      const pluginStore = strapi.store({
      type: 'plugin',
        name: 'magic-link',
      });
      
      const blockedTokens = (await pluginStore.get({ key: 'blocked_jwt_tokens' })) || { tokens: [] };
      
      // Aufräumen abgelaufener Tokens
      const now = new Date();
      blockedTokens.tokens = blockedTokens.tokens.filter(token => 
        new Date(token.expiresAt) > now
      );
      
      // Aktualisierte Liste speichern
      await pluginStore.set({ key: 'blocked_jwt_tokens', value: blockedTokens });
      
      return blockedTokens.tokens;
    } catch (error) {
      console.error('Error getting blocked JWT tokens:', error);
      return [];
    }
  },

  /**
   * Prüft, ob eine IP-Adresse gebannt ist
   * @param {string} ipAddress - Die zu prüfende IP-Adresse
   * @returns {boolean} - True, wenn die IP gebannt ist
   */
  async isIPBanned(ipAddress) {
    try {
      const pluginStore = strapi.store({
      type: 'plugin',
        name: 'magic-link',
      });
      
      const bannedIPs = (await pluginStore.get({ key: 'banned_ips' })) || { ips: [] };
      
      // Prüfen, ob die IP in der Liste gebannter IPs ist
      return bannedIPs.ips.includes(ipAddress);
    } catch (error) {
      console.error('Error checking if IP is banned:', error);
      return false;
    }
  }
}); 