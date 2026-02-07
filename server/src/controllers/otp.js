'use strict';

/**
 * OTP Controller
 * Handles OTP code generation, verification, and resending
 */

module.exports = {
  /**
   * Generate and send OTP code after successful magic link click
   */
  async send(ctx) {
    try {
      const { email, magicLinkToken } = ctx.request.body;

      if (!email) {
        return ctx.badRequest('Email is required');
      }

      // Check if OTP is enabled
      const otpService = strapi.plugin('magic-link').service('otp');
      const otpSettings = await otpService.getOTPSettings();

      if (!otpSettings.enabled) {
        return ctx.badRequest('OTP is not enabled');
      }

      // Check if user has premium license for OTP feature
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const hasOTPFeature = await licenseGuard.hasFeature('otp-email');

      if (!hasOTPFeature) {
        return ctx.forbidden('OTP feature requires Premium license or higher');
      }

      // Check rate limiting for OTP requests
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      const ipAddress = ctx.request.ip;
      const emailRateCheck = await rateLimiter.checkRateLimit(email, 'otp');
      
      if (!emailRateCheck.allowed) {
        return ctx.tooManyRequests(`Too many OTP requests. Please try again in ${emailRateCheck.retryAfter} seconds.`);
      }

      // Create OTP code
      const otpEntry = await otpService.createOTP(email, otpSettings.type, {
        magicLinkToken,
        expirySeconds: otpSettings.expiry,
        codeLength: otpSettings.length,
        ipAddress,
        userAgent: ctx.request.headers['user-agent']
      });

      // Send OTP based on type
      if (otpSettings.type === 'email') {
        await otpService.sendOTPEmail(email, otpEntry.code, {
          subject: 'Your Verification Code',
          expiryMinutes: Math.floor(otpSettings.expiry / 60)
        });
      } else if (otpSettings.type === 'sms') {
        // SMS sending (requires phone number) using Document Service API
        const user = await strapi.documents('plugin::users-permissions.user').findMany({
          filters: { email: email.toLowerCase() },
          limit: 1
        });
        
        if (user && user[0]?.phoneNumber) {
          await otpService.sendOTPSMS(user[0].phoneNumber, otpEntry.code);
        } else {
          return ctx.badRequest('Phone number not found for user');
        }
      }

      ctx.send({
        success: true,
        message: 'OTP code sent successfully',
        expiresIn: otpSettings.expiry,
        type: otpSettings.type
      });
    } catch (error) {
      strapi.log.error('Error sending OTP:', error);
      return ctx.badRequest('Failed to send OTP code');
    }
  },

  /**
   * Verify OTP code
   */
  async verify(ctx) {
    try {
      const { email, code, magicLinkToken } = ctx.request.body;

      if (!email || !code) {
        return ctx.badRequest('Email and code are required');
      }

      // Check if OTP is enabled
      const otpService = strapi.plugin('magic-link').service('otp');
      const otpSettings = await otpService.getOTPSettings();

      if (!otpSettings.enabled) {
        return ctx.badRequest('OTP is not enabled');
      }

      // Verify the OTP code
      const verification = await otpService.verifyOTP(email, code, otpSettings.type);

      if (!verification.valid) {
        // Increment attempts if OTP entry exists
        return ctx.badRequest(verification.message);
      }

      // OTP is valid - now complete the magic link login
      // Find the user using Document Service API
      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { email: email.toLowerCase() },
        limit: 1
      });

      if (!users || users.length === 0) {
        return ctx.badRequest('User not found');
      }

      const user = users[0];

      // Retrieve context from the original magic link token
      let tokenContext = {};
      if (magicLinkToken) {
        try {
          const magicLinkService = strapi.plugin('magic-link').service('magic-link');
          const token = await magicLinkService.fetchToken(magicLinkToken);
          if (token && token.context) {
            tokenContext = token.context;
          }
        } catch (e) {
          strapi.log.warn('[OTP] Could not retrieve magic link token context:', e.message);
        }
      }

      // Sanitize context (same logic as auth.js login)
      const sensitiveKeys = ['password', 'secret', 'apiKey', 'token', 'resetPasswordToken', 'confirmationToken'];
      const sanitizedContext = {};
      for (const [key, val] of Object.entries(tokenContext)) {
        if (sensitiveKeys.includes(key)) continue;
        if (val === undefined) continue;
        if (typeof val === 'string') {
          sanitizedContext[key] = val.substring(0, 2000);
        } else if (typeof val === 'boolean') {
          sanitizedContext[key] = val;
        } else if (typeof val === 'number' && !isNaN(val)) {
          sanitizedContext[key] = val;
        } else if (typeof val === 'object' && val !== null) {
          try {
            const jsonStr = JSON.stringify(val).substring(0, 5000);
            sanitizedContext[key] = JSON.parse(jsonStr);
          } catch {
            // Skip values that cannot be serialized
          }
        }
      }

      // Generate JWT token with context
      const jwtService = strapi.plugin('users-permissions').service('jwt');
      const jwt = jwtService.issue({
        id: user.id,
        context: sanitizedContext
      });

      // Store login info if enabled
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      const settings = await pluginStore.get({ key: 'settings' }) || {};

      if (settings.store_login_info) {
        const magicLinkService = strapi.plugin('magic-link').service('magic-link');
        await magicLinkService.storeLoginInfo({
          userId: user.id,
          email: user.email,
          ipAddress: ctx.request.ip,
          userAgent: ctx.request.headers['user-agent'],
          loginMethod: 'magic-link-otp',
          success: true
        });
      }

      ctx.send({
        jwt,
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        },
        context: sanitizedContext
      });
    } catch (error) {
      strapi.log.error('Error verifying OTP:', error);
      return ctx.badRequest('Failed to verify OTP code');
    }
  },

  /**
   * Resend OTP code
   */
  async resend(ctx) {
    try {
      const { email, magicLinkToken } = ctx.request.body;

      if (!email) {
        return ctx.badRequest('Email is required');
      }

      // Check if OTP is enabled
      const otpService = strapi.plugin('magic-link').service('otp');
      const otpSettings = await otpService.getOTPSettings();

      if (!otpSettings.enabled) {
        return ctx.badRequest('OTP is not enabled');
      }

      // Check resend cooldown using Document Service API
      const lastOTP = await strapi.documents('plugin::magic-link.otp-code').findMany({
        filters: {
          email: email.toLowerCase(),
          type: otpSettings.type
        },
        sort: [{ createdAt: 'desc' }],
        limit: 1
      });

      if (lastOTP && lastOTP.length > 0) {
        const lastCreated = new Date(lastOTP[0].createdAt);
        const now = new Date();
        const secondsSinceLastSend = (now - lastCreated) / 1000;

        if (secondsSinceLastSend < otpSettings.resendCooldown) {
          const waitTime = Math.ceil(otpSettings.resendCooldown - secondsSinceLastSend);
          return ctx.tooManyRequests(`Please wait ${waitTime} seconds before requesting a new code`);
        }
      }

      // Mark old codes as used using Document Service API
      if (lastOTP && lastOTP.length > 0) {
        for (const code of lastOTP) {
          await strapi.documents('plugin::magic-link.otp-code').update({
            documentId: code.documentId,
            data: { used: true }
          });
        }
      }

      // Create new OTP code
      const otpEntry = await otpService.createOTP(email, otpSettings.type, {
        magicLinkToken,
        expirySeconds: otpSettings.expiry,
        codeLength: otpSettings.length,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.headers['user-agent']
      });

      // Send OTP
      if (otpSettings.type === 'email') {
        await otpService.sendOTPEmail(email, otpEntry.code, {
          subject: 'Your New Verification Code',
          expiryMinutes: Math.floor(otpSettings.expiry / 60)
        });
      } else if (otpSettings.type === 'sms') {
        // SMS sending using Document Service API
        const user = await strapi.documents('plugin::users-permissions.user').findMany({
          filters: { email: email.toLowerCase() },
          limit: 1
        });
        
        if (user && user[0]?.phoneNumber) {
          await otpService.sendOTPSMS(user[0].phoneNumber, otpEntry.code);
        } else {
          return ctx.badRequest('Phone number not found for user');
        }
      }

      ctx.send({
        success: true,
        message: 'New OTP code sent successfully',
        expiresIn: otpSettings.expiry
      });
    } catch (error) {
      strapi.log.error('Error resending OTP:', error);
      return ctx.badRequest('Failed to resend OTP code');
    }
  },

  /**
   * List all OTP codes (Admin)
   */
  async listCodes(ctx) {
    try {
      const { page = 1, pageSize = 10, email, type } = ctx.query;
      
      const filters = {};
      if (email) {
        filters.email = { $containsi: email };
      }
      if (type) {
        filters.type = type;
      }

      // Using Document Service API
      const codes = await strapi.documents('plugin::magic-link.otp-code').findMany({
        filters,
        sort: [{ createdAt: 'desc' }],
        offset: (page - 1) * pageSize,
        limit: pageSize
      });

      // Count total using Document Service API count() method
      const total = await strapi.documents('plugin::magic-link.otp-code').count({
        filters
      });

      ctx.send({
        codes,
        pagination: {
          page: parseInt(page),
          pageSize: parseInt(pageSize),
          total,
          pageCount: Math.ceil(total / pageSize)
        }
      });
    } catch (error) {
      strapi.log.error('Error listing OTP codes:', error);
      return ctx.badRequest('Failed to list OTP codes');
    }
  },

  /**
   * Delete OTP code (Admin)
   */
  async deleteCode(ctx) {
    try {
      const { id } = ctx.params; // This is now documentId

      // Using Document Service API
      await strapi.documents('plugin::magic-link.otp-code').delete({
        documentId: id
      });

      ctx.send({
        success: true,
        message: 'OTP code deleted successfully'
      });
    } catch (error) {
      strapi.log.error('Error deleting OTP code:', error);
      return ctx.badRequest('Failed to delete OTP code');
    }
  },

  /**
   * Cleanup expired OTP codes (Admin)
   */
  async cleanup(ctx) {
    try {
      const otpService = strapi.plugin('magic-link').service('otp');
      await otpService.cleanupExpiredCodes();

      ctx.send({
        success: true,
        message: 'Expired OTP codes cleaned up successfully'
      });
    } catch (error) {
      strapi.log.error('Error cleaning up OTP codes:', error);
      return ctx.badRequest('Failed to cleanup OTP codes');
    }
  },

  /**
   * Setup TOTP for current user (Admin)
   */
  async setupTOTP(ctx) {
    try {
      // Check license for TOTP feature (Advanced/Enterprise)
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const hasFeature = await licenseGuard.hasFeature('otp-totp');
      
      if (!hasFeature) {
        return ctx.forbidden('TOTP feature requires Advanced or Enterprise license');
      }

      const { email, id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      
      const setupData = await otpService.setupTOTP(userId, email);
      
      ctx.send({
        success: true,
        data: setupData
      });
    } catch (error) {
      strapi.log.error('Error setting up TOTP:', error);
      return ctx.badRequest('Failed to setup TOTP');
    }
  },

  /**
   * Verify TOTP code (Admin)
   */
  async verifyTOTP(ctx) {
    try {
      const { token } = ctx.request.body;
      
      if (!token) {
        return ctx.badRequest('TOTP token is required');
      }

      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      
      const result = await otpService.verifyTOTP(userId, token, true);
      
      if (result.valid) {
        ctx.send({
          success: true,
          enabled: result.enabled,
          message: 'TOTP code verified successfully'
        });
      } else {
        ctx.send({
          success: false,
          error: result.error,
          message: result.message
        });
      }
    } catch (error) {
      strapi.log.error('Error verifying TOTP:', error);
      return ctx.badRequest('Failed to verify TOTP');
    }
  },

  /**
   * Disable TOTP for current user (Admin)
   */
  async disableTOTP(ctx) {
    try {
      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      
      const success = await otpService.disableTOTP(userId);
      
      if (success) {
        ctx.send({
          success: true,
          message: 'TOTP disabled successfully'
        });
      } else {
        ctx.send({
          success: false,
          message: 'TOTP was not enabled or does not exist'
        });
      }
    } catch (error) {
      strapi.log.error('Error disabling TOTP:', error);
      return ctx.badRequest('Failed to disable TOTP');
    }
  },

  /**
   * Get TOTP status for current user (Admin)
   */
  async getTOTPStatus(ctx) {
    try {
      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      
      const status = await otpService.getTOTPStatus(userId);
      
      ctx.send({
        success: true,
        data: status
      });
    } catch (error) {
      strapi.log.error('Error getting TOTP status:', error);
      return ctx.badRequest('Failed to get TOTP status');
    }
  },

  /**
   * Generate backup codes (Admin - Enterprise feature)
   */
  async generateBackupCodes(ctx) {
    try {
      // Check license for backup codes (Enterprise only)
      const licenseGuard = strapi.plugin('magic-link').service('license-guard');
      const hasFeature = await licenseGuard.hasFeature('otp-backup-codes');
      
      if (!hasFeature) {
        return ctx.forbidden('Backup codes feature requires Enterprise license');
      }

      const { id: userId } = ctx.state.user;
      const otpService = strapi.plugin('magic-link').service('otp');
      
      const backupCodes = await otpService.generateBackupCodes(userId);
      
      ctx.send({
        success: true,
        codes: backupCodes,
        message: 'Backup codes generated. Store them securely!'
      });
    } catch (error) {
      strapi.log.error('Error generating backup codes:', error);
      return ctx.badRequest(error.message || 'Failed to generate backup codes');
    }
  }
};
