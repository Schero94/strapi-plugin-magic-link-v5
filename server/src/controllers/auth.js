'use strict';
/**
 * Auth.js controller
 *
 * @description: A set of functions called "actions" for managing `Auth`.
 */

const { sanitize } = require('@strapi/utils');
const _ = require('lodash');
const { nanoid } = require('nanoid');
const i18n = require('../utils/i18n');

// Email regex pattern - simplified to avoid ReDoS attacks
const emailRegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = {
  async login(ctx) {
    const { loginToken } = ctx.query;
    // Strapi v5 pattern für Service Zugriff
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const userService = strapi.plugin('users-permissions').service('user');
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    const isEnabled = await magicLink.isEnabled();

    if (!isEnabled) {
      return i18n.sendError(ctx, 'plugin.disabled', 400);
    }

    if (_.isEmpty(loginToken)) {
      return i18n.sendError(ctx, 'token.invalid', 400);
    }
    const token = await magicLink.fetchToken(loginToken);

    if (!token || !token.is_active) {
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    const isValid = await magicLink.isTokenValid(token);

    if (!isValid) {
      await magicLink.deactivateToken(token);
      return i18n.sendError(ctx, 'token.invalid', 400);
    }

    // Check if OTP is enabled
    const settings = await magicLink.settings();
    const licenseGuard = strapi.plugin('magic-link').service('license-guard');
    const hasOTPFeature = await licenseGuard.hasFeature('otp-email');

    // If OTP is enabled and available, require OTP verification
    if (settings.otp_enabled && hasOTPFeature) {
      // Mark token as requiring OTP using Document Service API
      await strapi.documents('plugin::magic-link.token').update({
        documentId: token.documentId,
        data: {
          // Store that this token requires OTP
          context: {
            ...(token.context || {}),
            requiresOTP: true,
            otpVerified: false
          }
        }
      });

      // Generate and send OTP
      const otpService = strapi.plugin('magic-link').service('otp');
      const otpEntry = await otpService.createOTP(token.email, 'email', {
        magicLinkToken: token.token,
        expirySeconds: settings.otp_expiry || 300,
        codeLength: settings.otp_length || 6,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.header['user-agent']
      });

      // Send OTP email
      await otpService.sendOTPEmail(token.email, otpEntry.code, {
        subject: 'Your Verification Code',
        expiryMinutes: Math.floor((settings.otp_expiry || 300) / 60)
      });

      // Return response indicating OTP is required
      return ctx.send({
        requiresOTP: true,
        message: 'OTP verification required',
        email: token.email,
        loginToken: token.token,
        expiresIn: settings.otp_expiry || 300
      });
    }

    // Check if MFA with TOTP is required (Szenario 1: Magic Link + TOTP)
    if (settings.mfa_require_totp) {
      const otpService = strapi.plugin('magic-link').service('otp');
      
      // Check if user has TOTP enabled using Document Service API
      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { email: token.email },
        limit: 1,
      });
      const user = users && users.length > 0 ? users[0] : null;
      
      if (user) {
        const totpStatus = await otpService.getTOTPStatus(user.id);
        
        // If user has TOTP configured and enabled, require verification
        if (totpStatus.configured && totpStatus.enabled) {
          // Mark token as requiring TOTP verification using Document Service API
          await strapi.documents('plugin::magic-link.token').update({
            documentId: token.documentId,
            data: {
              context: {
                ...(token.context || {}),
                requiresTOTP: true,
                totpVerified: false,
                userId: user.id,
                userDocumentId: user.documentId
              }
            }
          });
          
          // Return response indicating TOTP is required
          return ctx.send({
            requiresTOTP: true,
            message: 'TOTP verification required for MFA',
            email: token.email,
            loginToken: token.token,
            userId: user.id
          });
        }
      }
    }
    
    // No OTP or TOTP required, proceed with normal login
    // Collect request information for security logging
    const requestInfo = {
      userAgent: ctx.request.header['user-agent'],
      ipAddress: ctx.request.ip
    };

    await magicLink.updateTokenOnLogin(token, requestInfo);

    // Find user using Document Service API
    const users = await strapi.documents('plugin::users-permissions.user').findMany({
      filters: { email: token.email },
      limit: 1,
    });
    const user = users && users.length > 0 ? users[0] : null;

    if (!user) {
      return i18n.sendError(ctx, 'wrong.email', 400);
    }

    if (user.blocked) {
      return i18n.sendError(ctx, 'blocked.user', 403);
    }

    if (!user.confirmed) {
      await userService.edit(user.id, { confirmed: true });
    }
    
    // In Strapi v5, sanitization works differently
    // We need to handle it differently to avoid the "Missing schema" error
    const sanitizedUser = { ...user };
    delete sanitizedUser.password;
    delete sanitizedUser.resetPasswordToken;
    delete sanitizedUser.confirmationToken;
    delete sanitizedUser.roles;

    let context;
    try {
      context = token.context || {};
    } catch (e) {
      context = {};
    }
    
    // Sanitize context values (size limits) but pass ALL fields through.
    // Security-sensitive fields are already filtered by whitelist/blacklist
    // in the token creation step (tokens.js). No need to filter again here.
    const sensitiveKeys = ['password', 'secret', 'apiKey', 'token', 'resetPasswordToken', 'confirmationToken'];
    const sanitizedContext = {};
    for (const [key, val] of Object.entries(context)) {
      // Skip internal/sensitive keys as safety net
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
    
    // Generiere JWT-Token mit dem sanitierten Context
    // In Strapi v5, jwtService.issue() might be async
    let jwtToken = jwtService.issue({ 
      id: user.id,
      context: sanitizedContext
    });
    
    // Handle if it's a Promise
    if (jwtToken && typeof jwtToken.then === 'function') {
      jwtToken = await jwtToken;
    }
    
    // Debug logging
    strapi.log.debug('[magic-link] JWT Token generated:', typeof jwtToken, jwtToken ? 'has value' : 'empty');
    
    // Hole JWT-Konfiguration, um Ablaufzeit zu berechnen
    let expirationTime = settings.jwt_token_expires_in || '30d';
    
    // Parse die Ablaufzeit (z.B. "30d" -> 30 Tage)
    let expiresAt = new Date();
    if (expirationTime.endsWith('d')) {
      const days = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (expirationTime.endsWith('h')) {
      const hours = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setHours(expiresAt.getHours() + hours);
    } else if (expirationTime.endsWith('m')) {
      const minutes = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
    } else {
      // Fallback auf 30 Tage
      expiresAt.setDate(expiresAt.getDate() + 30);
    }
    
    try {
      // Speichere die JWT-Session im Plugin-Store
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      // Hole aktuelle JWT-Sessions oder initialisiere leere Liste
      const jwtSessions = (await pluginStore.get({ key: 'jwt_sessions' })) || { sessions: [] };
      
      // Erstelle eine neue Session mit einer eindeutigen ID (cryptographically secure)
      const sessionId = `session_${Date.now()}_${nanoid(12)}`;
      
      // Füge neue Session zur Liste hinzu
      jwtSessions.sessions.push({
        id: sessionId,
        userId: user.id,
        userEmail: user.email,
        username: user.username || user.email.split('@')[0],
        jwtToken: jwtToken,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        isRevoked: false,
        ipAddress: requestInfo.ipAddress,
        userAgent: requestInfo.userAgent,
        source: 'Magic Link Login',
        lastUsedAt: new Date().toISOString(),
        context: sanitizedContext  // Speichere den sanitierten Context auch in der Session
      });
      
      // Speichere aktualisierte Liste
      await pluginStore.set({ key: 'jwt_sessions', value: jwtSessions });
    } catch (error) {
      console.error("Fehler beim Speichern der JWT-Session:", error);
      // Hier nicht abbrechen, damit der Login trotzdem funktioniert
    }
    
    ctx.send({
      jwt: jwtToken,
      user: sanitizedUser,
      context: sanitizedContext,
      expires_at: expiresAt.toISOString(),
      expiry_formatted: new Intl.DateTimeFormat('de-DE', {
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).format(expiresAt)
    });
  },

  async sendLink(ctx) {
    // Strapi v5 pattern für Service Zugriff
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
    const whatsappService = strapi.plugin('magic-link').service('whatsapp');

    const isEnabled = await magicLink.isEnabled();

    if (!isEnabled) {
      return i18n.sendError(ctx, 'plugin.disabled', 400);
    }

    const params = _.assign(ctx.request.body);

    const email = params.email ? params.email.trim().toLowerCase() : null;
    const phoneNumber = params.phoneNumber || params.phone || null;
    const context = params.context || {};
    const username = params.username || null;
    const deliveryMethod = params.delivery || params.via || 'email'; // 'email' or 'whatsapp'

    const isEmail = emailRegExp.test(email);

    if (email && !isEmail) {
      return i18n.sendError(ctx, 'wrong.email', 400);
    }

    // Validate that we have either email or phone
    if (!email && !phoneNumber) {
      return ctx.badRequest('Either email or phoneNumber is required');
    }
    
    // Rate limiting check - both IP and email/phone
    const ipAddress = ctx.request.ip;
    const ipCheck = await rateLimiter.checkRateLimit(ipAddress, 'ip');
    
    if (!ipCheck.allowed) {
      return ctx.tooManyRequests(`Too many requests. Please try again in ${ipCheck.retryAfter} seconds.`);
    }
    
    if (email) {
      const emailCheck = await rateLimiter.checkRateLimit(email, 'email');
      
      if (!emailCheck.allowed) {
        return ctx.tooManyRequests(`Too many requests for this email. Please try again in ${emailCheck.retryAfter} seconds.`);
      }
    }

    let user;
    try {
      user = await magicLink.user(email, username);
    } catch (e) {
      return i18n.sendError(ctx, 'wrong.user', 400);
    }

    if (!user) {
      return i18n.sendError(ctx, 'wrong.email', 400);
    }

    if (email && user.email !== email) {
      return i18n.sendError(ctx, 'wrong.user', 400);
    }

    if (user.blocked) {
      return i18n.sendError(ctx, 'blocked.user', 403);
    }

    try {
      const token = await magicLink.createToken(user.email, context);
      
      // Check if WhatsApp delivery is requested and available
      const settings = await magicLink.settings();
      const useWhatsApp = (deliveryMethod === 'whatsapp' || phoneNumber) && 
                          settings?.whatsapp_enabled && 
                          phoneNumber;

      if (useWhatsApp) {
        // Send via WhatsApp
        const whatsappStatus = whatsappService.getStatus();
        
        if (!whatsappStatus.isConnected) {
          return ctx.badRequest('WhatsApp is not connected. Please connect WhatsApp in the admin panel first.');
        }

        const result = await magicLink.sendLoginLinkViaWhatsApp(token, phoneNumber);
        
        if (!result.success) {
          return ctx.badRequest(result.error || 'Failed to send WhatsApp message');
        }

        ctx.send({
          email,
          phoneNumber,
          username,
          sent: true,
          delivery: 'whatsapp',
        });
      } else {
        // Send via Email (default)
        await magicLink.sendLoginLink(token);
        ctx.send({
          email,
          username,
          sent: true,
          delivery: 'email',
        });
      }
    } catch (err) {
      return ctx.badRequest(err);
    }
  },

  /**
   * Verify TOTP after Magic Link (MFA Flow - Szenario 1)
   * User has clicked Magic Link and now needs to provide TOTP code
   */
  async verifyMFATOTP(ctx) {
    const { loginToken, totpCode } = ctx.request.body;
    
    if (!loginToken || !totpCode) {
      return ctx.badRequest('Missing loginToken or totpCode');
    }

    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const otpService = strapi.plugin('magic-link').service('otp');
    const userService = strapi.plugin('users-permissions').service('user');
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    
    // Fetch the magic link token
    const token = await magicLink.fetchToken(loginToken);
    
    if (!token || !token.is_active) {
      return ctx.badRequest('Invalid or expired token');
    }
    
    // Check if token requires TOTP
    const context = token.context || {};
    if (!context.requiresTOTP || !context.userId) {
      return ctx.badRequest('TOTP verification not required for this token');
    }
    
    // Verify TOTP code
    const verificationResult = await otpService.verifyTOTP(context.userId, totpCode, false);
    
    if (!verificationResult.valid) {
      return ctx.badRequest(verificationResult.message || 'Invalid TOTP code');
    }
    
    // Mark token as TOTP-verified using Document Service API
    await strapi.documents('plugin::magic-link.token').update({
      documentId: token.documentId,
      data: {
        context: {
          ...context,
          totpVerified: true
        }
      }
    });
    
    // Proceed with login
    const requestInfo = {
      userAgent: ctx.request.header['user-agent'],
      ipAddress: ctx.request.ip
    };
    
    await magicLink.updateTokenOnLogin(token, requestInfo);
    
    // Find user using Document Service API
    // Prefer documentId (Strapi v5), fallback to id for backward compatibility
    let user = null;
    if (context.userDocumentId) {
      user = await strapi.documents('plugin::users-permissions.user').findOne({
        documentId: context.userDocumentId,
      });
    } else if (context.userId) {
      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { id: context.userId },
        limit: 1,
      });
      user = users && users.length > 0 ? users[0] : null;
    }
    
    if (!user) {
      return ctx.badRequest('User not found');
    }
    
    if (user.blocked) {
      return ctx.badRequest('blocked.user');
    }
    
    if (!user.confirmed) {
      await userService.edit(user.id, { confirmed: true });
    }
    
    // Sanitize user data
    const sanitizedUser = { ...user };
    delete sanitizedUser.password;
    delete sanitizedUser.resetPasswordToken;
    delete sanitizedUser.confirmationToken;
    delete sanitizedUser.roles;
    
    // Sanitize context from token (pass all fields except sensitive ones)
    const mfaSensitiveKeys = ['password', 'secret', 'apiKey', 'token', 'resetPasswordToken', 'confirmationToken', 'requiresTOTP', 'totpVerified', 'userId'];
    const mfaSanitizedContext = {};
    for (const [key, val] of Object.entries(context)) {
      if (mfaSensitiveKeys.includes(key)) continue;
      if (val === undefined) continue;
      if (typeof val === 'string') {
        mfaSanitizedContext[key] = val.substring(0, 2000);
      } else if (typeof val === 'boolean') {
        mfaSanitizedContext[key] = val;
      } else if (typeof val === 'number' && !isNaN(val)) {
        mfaSanitizedContext[key] = val;
      } else if (typeof val === 'object' && val !== null) {
        try {
          const jsonStr = JSON.stringify(val).substring(0, 5000);
          mfaSanitizedContext[key] = JSON.parse(jsonStr);
        } catch {
          // Skip values that cannot be serialized
        }
      }
    }
    
    // Generate JWT with context
    const settings = await magicLink.settings();
    const jwtToken = jwtService.issue({ 
      id: user.id,
      mfaVerified: true,
      context: mfaSanitizedContext
    });
    
    // Calculate expiration
    let expirationTime = settings.jwt_token_expires_in || '30d';
    let expiresAt = new Date();
    if (expirationTime.endsWith('d')) {
      const days = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (expirationTime.endsWith('h')) {
      const hours = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setHours(expiresAt.getHours() + hours);
    }
    
    // Store JWT session
    try {
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      const jwtSessions = (await pluginStore.get({ key: 'jwt_sessions' })) || { sessions: [] };
      const sessionId = `session_${Date.now()}_${nanoid(12)}`;
      
      jwtSessions.sessions.push({
        id: sessionId,
        userId: user.id,
        userEmail: user.email,
        username: user.username || user.email.split('@')[0],
        jwtToken: jwtToken,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        isRevoked: false,
        ipAddress: requestInfo.ipAddress,
        userAgent: requestInfo.userAgent,
        source: 'Magic Link + TOTP (MFA)',
        lastUsedAt: new Date().toISOString(),
        mfaVerified: true,
        context: mfaSanitizedContext
      });
      
      await pluginStore.set({ key: 'jwt_sessions', value: jwtSessions });
    } catch (error) {
      strapi.log.error('Error storing JWT session:', error);
    }
    
    ctx.send({
      jwt: jwtToken,
      user: sanitizedUser,
      mfaVerified: true,
      context: mfaSanitizedContext,
      expires_at: expiresAt.toISOString()
    });
  },

  /**
   * Login with Email + TOTP Code directly (Szenario 2: TOTP as primary)
   * Requires Advanced license and totp_as_primary_auth setting
   */
  async loginWithTOTP(ctx) {
    const { email, totpCode } = ctx.request.body;
    
    if (!email || !totpCode) {
      return ctx.badRequest('Email and TOTP code are required');
    }
    
    const magicLink = strapi.plugin('magic-link').service('magic-link');
    const otpService = strapi.plugin('magic-link').service('otp');
    const licenseGuard = strapi.plugin('magic-link').service('license-guard');
    const userService = strapi.plugin('users-permissions').service('user');
    const jwtService = strapi.plugin('users-permissions').service('jwt');
    
    // Check if feature is enabled
    const settings = await magicLink.settings();
    if (!settings.totp_as_primary_auth) {
      return ctx.forbidden('TOTP login is not enabled');
    }
    
    // Check license (Advanced feature)
    const hasFeature = await licenseGuard.hasFeature('otp-totp');
    if (!hasFeature) {
      return ctx.forbidden('TOTP login requires Advanced license');
    }
    
    // Find user by email using Document Service API
    const users = await strapi.documents('plugin::users-permissions.user').findMany({
      filters: { email: email.trim().toLowerCase() },
      limit: 1,
    });
    const user = users && users.length > 0 ? users[0] : null;
    
    if (!user) {
      return ctx.badRequest('User not found');
    }
    
    if (user.blocked) {
      return ctx.badRequest('blocked.user');
    }
    
    // Check if user has TOTP enabled
    const totpStatus = await otpService.getTOTPStatus(user.id);
    
    if (!totpStatus.configured || !totpStatus.enabled) {
      return ctx.badRequest('TOTP is not configured for this user');
    }
    
    // Verify TOTP code
    const verificationResult = await otpService.verifyTOTP(user.id, totpCode, false);
    
    if (!verificationResult.valid) {
      return ctx.badRequest(verificationResult.message || 'Invalid TOTP code');
    }
    
    // User is verified, proceed with login
    if (!user.confirmed) {
      await userService.edit(user.id, { confirmed: true });
    }
    
    // Sanitize user data
    const sanitizedUser = { ...user };
    delete sanitizedUser.password;
    delete sanitizedUser.resetPasswordToken;
    delete sanitizedUser.confirmationToken;
    delete sanitizedUser.roles;
    
    // Generate JWT
    const jwtToken = jwtService.issue({ 
      id: user.id,
      totpLogin: true
    });
    
    // Calculate expiration
    let expirationTime = settings.jwt_token_expires_in || '30d';
    let expiresAt = new Date();
    if (expirationTime.endsWith('d')) {
      const days = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (expirationTime.endsWith('h')) {
      const hours = parseInt(expirationTime.slice(0, -1), 10);
      expiresAt.setHours(expiresAt.getHours() + hours);
    }
    
    // Store JWT session
    try {
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      const jwtSessions = (await pluginStore.get({ key: 'jwt_sessions' })) || { sessions: [] };
      const sessionId = `session_${Date.now()}_${nanoid(12)}`;
      
      jwtSessions.sessions.push({
        id: sessionId,
        userId: user.id,
        userEmail: user.email,
        username: user.username || user.email.split('@')[0],
        jwtToken: jwtToken,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        isRevoked: false,
        ipAddress: ctx.request.ip,
        userAgent: ctx.request.header['user-agent'],
        source: 'TOTP Login (Primary)',
        lastUsedAt: new Date().toISOString(),
        totpLogin: true
      });
      
      await pluginStore.set({ key: 'jwt_sessions', value: jwtSessions });
    } catch (error) {
      strapi.log.error('Error storing JWT session:', error);
    }
    
    ctx.send({
      jwt: jwtToken,
      user: sanitizedUser,
      loginMethod: 'totp',
      expires_at: expiresAt.toISOString()
    });
  },
}; 