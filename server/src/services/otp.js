'use strict';

const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const emailHelpers = require('../utils/email-helpers');
const cryptoUtils = require('../utils/crypto');

/**
 * OTP Service
 * Handles One-Time Password generation, validation, and delivery
 * Using Document Service API (strapi.documents) for Strapi v5
 * 
 * Security:
 * - OTP codes are hashed before storage (SHA256 + pepper)
 * - TOTP secrets are encrypted at rest (AES-256-GCM)
 * - Backup codes are hashed (SHA256)
 */
module.exports = ({ strapi }) => {
  // Store the strapi instance reference from module initialization
  const strapiInstance = strapi;

  // Helper to get strapi instance - prefers stored instance (more reliable in bundled plugins)
  const getStrapi = () => {
    // Primary: Use stored instance from module initialization (reliable in bundled plugins)
    if (strapiInstance) {
      return strapiInstance;
    }
    // Fallback: Try global.strapi
    if (global.strapi) {
      return global.strapi;
    }
    throw new Error('Strapi instance not available');
  };

  // Helper for safe logging (works in intervals/timeouts)
  const log = {
    info: (...args) => {
      try {
        getStrapi().log.info(...args);
      } catch (e) {
        console.log('[OTP Info]', ...args);
      }
    },
    error: (...args) => {
      try {
        getStrapi().log.error(...args);
      } catch (e) {
        console.error('[OTP Error]', ...args);
      }
    },
    warn: (...args) => {
      try {
        getStrapi().log.warn(...args);
      } catch (e) {
        console.warn('[OTP Warn]', ...args);
      }
    },
    debug: (...args) => {
      try {
        getStrapi().log.debug(...args);
      } catch (e) {
        console.debug('[OTP Debug]', ...args);
      }
    }
  };

  return {
  /**
   * Generate a random OTP code
   * @param {number} length - Length of the OTP code (default: 6)
   * @returns {string} The generated OTP code
   */
  generateCode(length = 6) {
    const digits = '0123456789';
    let code = '';
    
    // Use crypto for secure random generation
    const randomBytes = crypto.randomBytes(length);
    
    for (let i = 0; i < length; i++) {
      code += digits[randomBytes[i] % digits.length];
    }
    
    return code;
  },

  /**
   * Create and store an OTP code.
   *
   * SECURITY: Before creating the new code, every still-unused OTP of the
   * same (email, type) pair is invalidated (`used=true`). This prevents an
   * attacker from inflating the brute-force success probability by spamming
   * `/otp/send` to accumulate N concurrently-valid codes.
   *
   * @param {string} email - User email
   * @param {string} type - OTP type ('email', 'sms', 'totp')
   * @param {Object} options - Additional options
   * @returns {Object} The created OTP code entry (with plaintext code)
   */
  async createOTP(email, type = 'email', options = {}) {
    const {
      magicLinkToken = null,
      phoneNumber = null,
      expirySeconds = 300,
      codeLength = 6
    } = options;

    const normalizedEmail = email.toLowerCase();
    const activeStrapi = getStrapi();

    // Invalidate ALL previously-issued unused OTPs for this email+type
    // so only the newest code is valid at any time.
    await this.invalidateActiveOTPs(normalizedEmail, type);

    const code = this.generateCode(codeLength);
    const hashedCode = cryptoUtils.hashOTP(code);
    const expiresAt = new Date(Date.now() + (expirySeconds * 1000));

    const otpEntry = await activeStrapi.documents('plugin::magic-link.otp-code').create({
      data: {
        code: hashedCode,
        email: normalizedEmail,
        type,
        used: false,
        attempts: 0,
        expiresAt,
        magicLinkToken,
        phoneNumber,
        metadata: {
          createdAt: new Date().toISOString(),
          ipAddress: options.ipAddress || null,
          userAgent: options.userAgent || null
        }
      }
    });

    log.info(`OTP code created for ${normalizedEmail} (type: ${type}, expires in ${expirySeconds}s)`);

    return { ...otpEntry, code };
  },

  /**
   * Invalidates all currently unused OTPs for a given (email, type) pair.
   * Used by createOTP to enforce a single-active-code policy.
   *
   * @param {string} email - Lower-cased email
   * @param {string} type - OTP type
   * @returns {Promise<number>} Count of invalidated entries
   */
  async invalidateActiveOTPs(email, type) {
    const activeStrapi = getStrapi();
    const PAGE_SIZE = 100;
    let total = 0;

    while (true) {
      const batch = await activeStrapi.documents('plugin::magic-link.otp-code').findMany({
        filters: { email, type, used: false },
        limit: PAGE_SIZE,
      });
      if (!batch || batch.length === 0) break;

      for (const entry of batch) {
        await activeStrapi.documents('plugin::magic-link.otp-code').update({
          documentId: entry.documentId,
          data: { used: true },
        });
        total++;
      }
      if (batch.length < PAGE_SIZE) break;
    }

    if (total > 0) {
      log.debug(`[OTP] Invalidated ${total} prior unused OTP(s) for ${email}`);
    }
    return total;
  },

  /**
   * Verifies an OTP code against the active pool for an (email, type) pair.
   *
   * Security model:
   * 1. Load all unused, non-expired OTPs for the email+type
   * 2. Increment `attempts` on ALL candidates (any attempt counts)
   * 3. If aggregate attempts ≥ maxAttempts, burn the entire pool
   * 4. Try a timing-safe hash match only if attempts are still within budget
   * 5. On match: mark matched entry as used. All other entries stay as-is
   *    (already invalidated by createOTP's single-active-code policy).
   *
   * This closes the previous bug where `attempts` was never incremented on
   * mismatched codes, letting attackers brute-force within the rate-limit
   * window without tripping the per-code max-attempts counter.
   *
   * @param {string} email - User email
   * @param {string} code - Plaintext OTP code to verify
   * @param {string} type - OTP type
   * @returns {Promise<{valid: boolean, error?: string, message?: string, otpEntry?: object}>}
   */
  async verifyOTP(email, code, type = 'email') {
    const activeStrapi = getStrapi();
    const pluginStore = activeStrapi.store({ type: 'plugin', name: 'magic-link' });
    const settings = (await pluginStore.get({ key: 'settings' })) || {};
    const maxAttempts = settings.otp_max_attempts || 3;
    const normalizedEmail = String(email || '').toLowerCase();

    if (!normalizedEmail || !code) {
      return { valid: false, error: 'invalid_code', message: 'Invalid or expired OTP code' };
    }

    try {
      const now = new Date();

      const candidates = await activeStrapi.documents('plugin::magic-link.otp-code').findMany({
        filters: {
          email: normalizedEmail,
          type,
          used: false,
          expiresAt: { $gt: now },
        },
        sort: [{ createdAt: 'desc' }],
        limit: 10,
      });

      if (!candidates || candidates.length === 0) {
        return { valid: false, error: 'invalid_code', message: 'Invalid or expired OTP code' };
      }

      // Check the attempts budget BEFORE attempting a match.
      // We take the highest attempt count across all active candidates;
      // once it reaches maxAttempts, the whole pool is burned.
      const currentMax = candidates.reduce((m, c) => Math.max(m, c.attempts || 0), 0);

      if (currentMax >= maxAttempts) {
        // Burn the pool (mark every candidate as used).
        for (const entry of candidates) {
          await activeStrapi.documents('plugin::magic-link.otp-code').update({
            documentId: entry.documentId,
            data: { used: true },
          });
        }
        log.warn(`[OTP] Max attempts exceeded for ${normalizedEmail}, burned pool`);
        return { valid: false, error: 'max_attempts', message: 'Maximum verification attempts exceeded' };
      }

      // Increment attempts on ALL candidates for every try (correct or not).
      // This is the fix for the previous bug where only matching entries got incremented.
      const nextAttempts = currentMax + 1;
      for (const entry of candidates) {
        await activeStrapi.documents('plugin::magic-link.otp-code').update({
          documentId: entry.documentId,
          data: { attempts: (entry.attempts || 0) + 1 },
        });
      }

      // Timing-safe search for a matching entry.
      const matched = candidates.find((entry) => cryptoUtils.verifyOTP(code, entry.code));

      if (!matched) {
        // If this attempt exhausted the budget, burn the pool now.
        if (nextAttempts >= maxAttempts) {
          for (const entry of candidates) {
            await activeStrapi.documents('plugin::magic-link.otp-code').update({
              documentId: entry.documentId,
              data: { used: true },
            });
          }
          log.warn(`[OTP] Attempts exhausted on failed verification for ${normalizedEmail}, burned pool`);
        }
        return { valid: false, error: 'invalid_code', message: 'Invalid or expired OTP code' };
      }

      // Match found — mark only the matched entry as used.
      await activeStrapi.documents('plugin::magic-link.otp-code').update({
        documentId: matched.documentId,
        data: { used: true },
      });

      log.info(`OTP verified successfully for ${normalizedEmail}`);
      return { valid: true, otpEntry: matched };
    } catch (error) {
      log.error('Error verifying OTP:', error);
      return { valid: false, error: 'server_error', message: 'Error verifying OTP code' };
    }
  },

  /**
   * Send OTP via email
   * @param {string} email - Recipient email
   * @param {string} code - OTP code
   * @param {Object} options - Email options
   */
  async sendOTPEmail(email, code, options = {}) {
    const activeStrapi = getStrapi();
    const pluginStore = activeStrapi.store({
      type: 'plugin',
      name: 'magic-link',
    });
    const settings = await pluginStore.get({ key: 'settings' }) || {};

    const {
      subject = 'Your One-Time Password',
      expiryMinutes = 5
    } = options;

    // Create HTML email content
    const htmlContent = `
      <div style="text-align: center; padding: 20px;">
        <h1 style="color: #4F46E5; margin-bottom: 20px;">Your Verification Code</h1>
        <p style="font-size: 16px; color: #374151; margin-bottom: 30px;">
          Enter this code to complete your login:
        </p>
        <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); 
                    color: white; 
                    font-size: 32px; 
                    font-weight: bold; 
                    letter-spacing: 8px; 
                    padding: 20px 40px; 
                    border-radius: 12px; 
                    display: inline-block;
                    margin-bottom: 30px;
                    font-family: 'Courier New', monospace;">
          ${code}
        </div>
        <p style="font-size: 14px; color: #6B7280; margin-top: 20px;">
          This code will expire in <strong>${expiryMinutes} minutes</strong>.
        </p>
        <p style="font-size: 14px; color: #6B7280; margin-top: 10px;">
          If you didn't request this code, you can safely ignore this email.
        </p>
      </div>
    `;

    // Create plain text version
    const textContent = `
Your Verification Code

Enter this code to complete your login:

${code}

This code will expire in ${expiryMinutes} minutes.

If you didn't request this code, you can safely ignore this email.
    `.trim();

    // Wrap in email template
    const html = emailHelpers.wrapEmailTemplate(htmlContent, {
      title: subject,
      preheader: `Your verification code: ${code}`
    });

    // Get headers
    const headers = emailHelpers.getEmailHeaders({
      replyTo: settings.response_email
    });

    // Route through MagicMail when the admin opted in. The router exposes
    // only `send()` (there is no `sendEmail()`), so call that directly —
    // prior versions used the wrong method name, causing every attempt to
    // throw silently and fall through to the default Strapi email provider.
    if (settings.use_magic_mail && activeStrapi.plugin('magic-mail')) {
      try {
        await activeStrapi.plugin('magic-mail').service('email-router').send({
          to: email,
          from: settings.from_email ? `${settings.from_name} <${settings.from_email}>` : undefined,
          replyTo: settings.response_email || undefined,
          subject,
          html,
          text: textContent,
          headers,
          type: 'transactional',
        });

        log.info(`OTP email sent via MagicMail to ${email}`);
        return true;
      } catch (error) {
        log.error('MagicMail send failed, falling back to default provider:', error);
      }
    }

    // Send via default email provider
    await activeStrapi.plugin('email').service('email').send({
      to: email,
      from: settings.from_email ? `${settings.from_name} <${settings.from_email}>` : undefined,
      replyTo: settings.response_email || undefined,
      subject,
      html,
      text: textContent,
      headers
    });

    log.info(`OTP email sent to ${email}`);
    return true;
  },

  /**
   * Send OTP via SMS (requires SMS provider like Twilio)
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} code - OTP code
   * @returns {boolean} Success status
   */
  async sendOTPSMS(phoneNumber, code) {
    const activeStrapi = getStrapi();
    const pluginStore = activeStrapi.store({
      type: 'plugin',
      name: 'magic-link',
    });
    const settings = await pluginStore.get({ key: 'settings' }) || {};

    // TODO: Implement SMS sending with Twilio/Vonage
    // For now, log that this is a premium feature
    log.info(`SMS OTP to ${phoneNumber}: ${code} (SMS provider not yet implemented)`);
    
    return true;
  },

  /**
   * Deletes expired OTP codes in bounded batches.
   *
   * Called every 5 minutes from bootstrap. Operates in pages so a very
   * large backlog (e.g. after a long period without cleanups) can never
   * block the event loop on a single monster query / delete sweep.
   *
   * Hard stop after MAX_TOTAL per run to keep each run short; the next
   * interval tick will continue where this one left off.
   *
   * @returns {Promise<number>} Total entries deleted in this run
   */
  async cleanupExpiredCodes() {
    if (!strapiInstance) return 0;

    const PAGE_SIZE = 200;
    const MAX_TOTAL = 5000;
    let total = 0;

    try {
      while (total < MAX_TOTAL) {
        const batch = await strapiInstance.documents('plugin::magic-link.otp-code').findMany({
          filters: { expiresAt: { $lt: new Date() } },
          sort: [{ createdAt: 'asc' }],
          limit: PAGE_SIZE,
        });

        if (!batch || batch.length === 0) break;

        for (const code of batch) {
          await strapiInstance.documents('plugin::magic-link.otp-code').delete({
            documentId: code.documentId,
          });
          total++;
          if (total >= MAX_TOTAL) break;
        }

        if (batch.length < PAGE_SIZE) break;
      }

      if (total > 0) {
        strapiInstance.log.info(`[CLEANUP] Deleted ${total} expired OTP codes`);
      }
    } catch (error) {
      if (strapiInstance.log) {
        strapiInstance.log.debug('[CLEANUP] OTP cleanup skipped:', error.message);
      }
    }

    return total;
  },

  /**
   * Get OTP settings
   */
  async getOTPSettings() {
    const activeStrapi = getStrapi();
    const pluginStore = activeStrapi.store({
      type: 'plugin',
      name: 'magic-link',
    });
    const settings = await pluginStore.get({ key: 'settings' }) || {};

    return {
      enabled: settings.otp_enabled || false,
      type: settings.otp_type || 'email',
      length: settings.otp_length || 6,
      expiry: settings.otp_expiry || 300,
      maxAttempts: settings.otp_max_attempts || 3,
      resendCooldown: settings.otp_resend_cooldown || 60
    };
  },

  /**
   * Setup TOTP for a user.
   *
   * Reads the admin-controlled TOTP parameters from plugin settings and
   * encodes them into the otpauth URL so authenticator apps (Google
   * Authenticator, 1Password, Authy, …) pick up the desired algorithm,
   * digit count and period. Previously these settings lived only in the
   * UI — now they actually travel into the QR code.
   *
   * Accepted values:
   *   totp_algorithm: 'SHA1' | 'SHA256' | 'SHA512'   (default 'SHA1')
   *   totp_digits:    6 | 8                           (default 6)
   *   totp_period:    15–300 seconds                  (default 30)
   *
   * @param {number} userId
   * @param {string} email
   * @returns {Object} TOTP setup data with QR code
   */
  async setupTOTP(userId, email) {
    const activeStrapi = getStrapi();
    try {
      const pluginStore = activeStrapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      const settings = (await pluginStore.get({ key: 'settings' })) || {};

      const issuer = settings.totp_issuer || 'Magic Link';
      const algorithm = ['SHA1', 'SHA256', 'SHA512'].includes(settings.totp_algorithm)
        ? settings.totp_algorithm
        : 'SHA1';
      const digits = [6, 8].includes(Number(settings.totp_digits))
        ? Number(settings.totp_digits)
        : 6;
      const period = (() => {
        const raw = Number(settings.totp_period);
        if (!Number.isFinite(raw)) return 30;
        return Math.min(Math.max(Math.round(raw), 15), 300);
      })();

      // Generate secret with the admin-configured parameters. speakeasy
      // encodes `algorithm`, `digits` and `period` into the otpauth URL.
      const secret = speakeasy.generateSecret({
        name: `${issuer} (${email})`,
        issuer,
        length: 32,
        algorithm,
        digits,
        period,
      });

      // Encrypt the TOTP secret before storage
      const encryptedSecret = cryptoUtils.encrypt(secret.base32);

      // Check if user already has TOTP config
      const existing = await activeStrapi.documents('plugin::magic-link.totp-config').findMany({
        filters: { userId },
        limit: 1
      });

      if (existing && existing.length > 0) {
        // Update existing config
        await activeStrapi.documents('plugin::magic-link.totp-config').update({
          documentId: existing[0].documentId,
          data: {
            secret: encryptedSecret, // Store encrypted
            enabled: false, // Not enabled until first verification
            email
          }
        });
      } else {
        // Create new config
        await activeStrapi.documents('plugin::magic-link.totp-config').create({
          data: {
            userId,
            email,
            secret: encryptedSecret, // Store encrypted
            enabled: false
          }
        });
      }

      // Generate QR code
      const qrCodeDataURL = await QRCode.toDataURL(secret.otpauth_url);

      log.info(`TOTP setup initiated for user ${userId} (${email})`);

      // The plaintext secret is returned ONCE so the user can add it to their
      // authenticator app. Callers must display it ephemerally (no logs, no
      // local storage, no analytics). We return it under a single key to
      // minimize accidental duplication in logs.
      return {
        secret: secret.base32,
        qrCode: qrCodeDataURL,
        otpauthUrl: secret.otpauth_url,
      };
    } catch (error) {
      log.error('Error setting up TOTP:', error);
      throw error;
    }
  },

  /**
   * Verify TOTP code and enable TOTP if valid
   * @param {number} userId - User ID
   * @param {string} token - 6-digit TOTP code
   * @param {boolean} enableAfterVerify - Enable TOTP after successful verification
   * @returns {Object} Verification result
   */
  async verifyTOTP(userId, token, enableAfterVerify = true) {
    const activeStrapi = getStrapi();
    try {
      const configs = await activeStrapi.documents('plugin::magic-link.totp-config').findMany({
        filters: { userId },
        limit: 1
      });

      if (!configs || configs.length === 0) {
        return {
          valid: false,
          error: 'totp_not_setup',
          message: 'TOTP is not set up for this user'
        };
      }

      const config = configs[0];

      // Decrypt the secret before verification
      const decryptedSecret = cryptoUtils.decrypt(config.secret);

      // Pull the TOTP parameters from plugin settings so the verify side
      // matches whatever setupTOTP wrote into the QR code. Without this,
      // a user enabling SHA256/8-digit TOTP at setup time would be unable
      // to log in because the verify step still used SHA1/6-digit.
      const pluginStore = activeStrapi.store({ type: 'plugin', name: 'magic-link' });
      const settings = (await pluginStore.get({ key: 'settings' })) || {};
      const algorithm = ['SHA1', 'SHA256', 'SHA512'].includes(settings.totp_algorithm)
        ? settings.totp_algorithm
        : 'SHA1';
      const digits = [6, 8].includes(Number(settings.totp_digits))
        ? Number(settings.totp_digits)
        : 6;
      const period = (() => {
        const raw = Number(settings.totp_period);
        if (!Number.isFinite(raw)) return 30;
        return Math.min(Math.max(Math.round(raw), 15), 300);
      })();

      const verified = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token,
        algorithm,
        digits,
        step: period,
        window: 1, // ±1 step tolerance for clock drift
      });

      if (!verified) {
        return {
          valid: false,
          error: 'invalid_token',
          message: 'Invalid TOTP code'
        };
      }

      // Update config
      const updateData = {
        lastUsed: new Date()
      };

      if (enableAfterVerify && !config.enabled) {
        updateData.enabled = true;
        log.info(`TOTP enabled for user ${userId}`);
      }

      await activeStrapi.documents('plugin::magic-link.totp-config').update({
        documentId: config.documentId,
        data: updateData
      });

      return {
        valid: true,
        enabled: updateData.enabled || config.enabled
      };
    } catch (error) {
      log.error('Error verifying TOTP:', error);
      return {
        valid: false,
        error: 'server_error',
        message: 'Error verifying TOTP code'
      };
    }
  },

  /**
   * Disable TOTP for a user
   * @param {number} userId - User ID
   * @returns {boolean} Success status
   */
  async disableTOTP(userId) {
    const activeStrapi = getStrapi();
    try {
      const configs = await activeStrapi.documents('plugin::magic-link.totp-config').findMany({
        filters: { userId },
        limit: 1
      });

      if (!configs || configs.length === 0) {
        return false;
      }

      await activeStrapi.documents('plugin::magic-link.totp-config').delete({
        documentId: configs[0].documentId
      });
      
      log.info(`TOTP disabled for user ${userId}`);
      return true;
    } catch (error) {
      log.error('Error disabling TOTP:', error);
      return false;
    }
  },

  /**
   * Check if TOTP is enabled for a user
   * @param {number} userId - User ID
   * @returns {Object} TOTP status
   */
  async getTOTPStatus(userId) {
    const activeStrapi = getStrapi();
    try {
      const configs = await activeStrapi.documents('plugin::magic-link.totp-config').findMany({
        filters: { userId },
        limit: 1
      });

      if (!configs || configs.length === 0) {
        return {
          enabled: false,
          configured: false
        };
      }

      return {
        enabled: configs[0].enabled,
        configured: true,
        lastUsed: configs[0].lastUsed
      };
    } catch (error) {
      log.error('Error getting TOTP status:', error);
      return {
        enabled: false,
        configured: false
      };
    }
  },

  /**
   * Generate backup codes for TOTP (Enterprise feature)
   * @param {number} userId - User ID
   * @returns {Array} Backup codes
   */
  async generateBackupCodes(userId) {
    const activeStrapi = getStrapi();
    try {
      const configs = await activeStrapi.documents('plugin::magic-link.totp-config').findMany({
        filters: { userId },
        limit: 1
      });

      if (!configs || configs.length === 0) {
        throw new Error('TOTP not configured for this user');
      }

      // Generate 10 backup codes (8 characters each)
      const backupCodes = [];
      for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        backupCodes.push(code);
      }

      // Store hashed backup codes
      const hashedCodes = backupCodes.map(code => 
        crypto.createHash('sha256').update(code).digest('hex')
      );

      await activeStrapi.documents('plugin::magic-link.totp-config').update({
        documentId: configs[0].documentId,
        data: {
          backupCodes: hashedCodes
        }
      });

      log.info(`Backup codes generated for user ${userId}`);

      return backupCodes;
    } catch (error) {
      log.error('Error generating backup codes:', error);
      throw error;
    }
  }
};
};
