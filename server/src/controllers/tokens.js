'use strict';

const { nanoid } = require('nanoid');
const crypto = require('crypto');
const emailHelpers = require('../utils/email-helpers');
const cryptoUtils = require('../utils/crypto');

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

const buildEmailContent = (user, magicLink, baseLoginUrl, settings, token, expiryText) => {
  // Default email templates if not configured
  const defaultHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Your Magic Link</h2>
      <p>Hello${user.username ? ' ' + user.username : ''},</p>
      <p>Click the button below to log in securely:</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="{link}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Log In Now
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">This link expires in {expiry_text}.</p>
      <p style="color: #999; font-size: 12px;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;
  const defaultText = `Your Magic Link\n\nClick here to log in: {link}\n\nThis link expires in {expiry_text}.`;

  let htmlMessage = settings?.message_html || defaultHtml;
  let textMessage = settings?.message_text || defaultText;

  htmlMessage = htmlMessage
    .replace(/{link}/g, magicLink)
    .replace(/<%= URL %>/g, baseLoginUrl)
    .replace(/<%= CODE %>/g, token)
    .replace(/<%= EXPIRY_TEXT %>/g, expiryText)
    .replace(/{expiry_text}/gi, expiryText)
    .replace(/{username}/g, user.username || '')
    .replace(/{email}/g, user.email || '');

  textMessage = textMessage
    .replace(/{link}/g, magicLink)
    .replace(/<%= URL %>/g, baseLoginUrl)
    .replace(/<%= CODE %>/g, token)
    .replace(/<%= EXPIRY_TEXT %>/g, expiryText)
    .replace(/{expiry_text}/gi, expiryText)
    .replace(/{username}/g, user.username || '')
    .replace(/{email}/g, user.email || '');

  if (!htmlMessage.includes('<!DOCTYPE') && !htmlMessage.includes('<html')) {
    htmlMessage = emailHelpers.wrapEmailTemplate(htmlMessage, {
      title: settings?.object || 'Magic Link Login',
      preheader: 'Your secure login link is ready'
    });
  }

  if (!textMessage || textMessage.trim().length === 0) {
    textMessage = emailHelpers.createPlainTextVersion(htmlMessage);
  }

  const headers = emailHelpers.getEmailHeaders({
    replyTo: settings?.response_email
  });

  return { htmlMessage, textMessage, headers };
};

const sendStandardEmail = async (user, magicLink, baseLoginUrl, expiryText, settings, token) => {
  try {
    const { htmlMessage, textMessage, headers } = buildEmailContent(user, magicLink, baseLoginUrl, settings, token, expiryText);

    // Use defaults if settings are not configured
    const fromName = settings?.from_name || 'Magic Link';
    const fromEmail = settings?.from_email || strapi.config.get('plugin.email.settings.defaultFrom') || 'noreply@localhost';
    const emailSubject = settings?.object || 'Your Magic Link';
    const fromAddress = `${fromName} <${fromEmail}>`;
    
    strapi.log.debug(`[MagicLink] Sending email from: ${fromAddress}, subject: ${emailSubject}`);

    const validation = emailHelpers.validateEmailConfig({
      to: user.email,
      from: fromAddress,
      subject: emailSubject,
      text: textMessage,
      html: htmlMessage
    });

    if (!validation.valid) {
      strapi.log.error('Email validation errors:', validation.errors);
      throw new Error('Invalid email configuration: ' + validation.errors.join(', '));
    }

    if (validation.warnings.length > 0) {
      strapi.log.warn('Email validation warnings:', validation.warnings);
    }

    await strapi.plugin('email').service('email').send({
      to: user.email,
      from: fromAddress,
      replyTo: settings?.response_email || undefined,
      subject: emailSubject,
      html: htmlMessage,
      text: textMessage,
      headers
    });

    strapi.log.info(`Standard Magic Link Email an ${user.email} gesendet`);
  } catch (error) {
    strapi.log.error('Fehler beim Senden der Standard-E-Mail:', error);
    throw error;
  }
};

/**
 * Tokens controller
 */

module.exports = {
  /**
   * Get all tokens
   * @param {Object} ctx - The request context
   */
  async find(ctx) {
    try {
      // Query all tokens using Document Service API
      const tokens = await strapi.documents('plugin::magic-link.token').findMany({
        sort: [{ createdAt: 'desc' }],
      });

      // SQLite speichert Booleans als 0/1 - konvertiere zu echten Booleans
      // Also: Mask hashed tokens for security - only show first/last 4 chars
      const normalizedTokens = tokens.map(token => {
        // For security, mask the token hash (or legacy plaintext)
        // Since tokens are now hashed, we show a masked identifier
        const tokenDisplay = token.token_salt 
          ? `[hashed]••••${token.token.slice(-8)}` // Hashed token
          : (token.token?.length > 8 
              ? `${token.token.slice(0, 4)}••••${token.token.slice(-4)}` // Legacy plaintext
              : token.token); // Very short token (shouldn't happen)
        
        return {
        ...token,
          token: tokenDisplay, // Masked for display
          token_salt: undefined, // Don't expose salt
        is_active: !!token.is_active  // Konvertiere 0/1 zu false/true
        };
      });

      // Berechne den Sicherheitswert
      const securityScore = await this.calculateSecurityScore();
      
      // Füge den Sicherheitswert als Metadaten hinzu
      return {
        data: normalizedTokens,
        meta: {
          securityScore
        }
      };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  /**
   * Create a new token
   * @param {Object} ctx - The request context
   */
  async create(ctx) {
    try {
      const { email, send_email = true, context = {} } = ctx.request.body;

      if (!email) {
        return ctx.badRequest('Email is required');
      }
      
      // Rate limiting check
      const rateLimiter = strapi.plugin('magic-link').service('rate-limiter');
      const ipAddress = ctx.request.ip;
      const ipCheck = await rateLimiter.checkRateLimit(ipAddress, 'ip');
      
      if (!ipCheck.allowed) {
        return ctx.tooManyRequests(`Too many token creation requests. Please try again in ${ipCheck.retryAfter} seconds.`);
      }
      
      const emailCheck = await rateLimiter.checkRateLimit(email, 'email');
      
      if (!emailCheck.allowed) {
        return ctx.tooManyRequests(`Too many requests for this email. Please try again in ${emailCheck.retryAfter} seconds.`);
      }
      
      // Überprüfe, ob die Plugin-Einstellungen das Erstellen neuer Benutzer erlauben
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      let settings = await pluginStore.get({ key: 'settings' });
      
      // Reduce noise: only log at debug level
      strapi.log.debug('[MagicLink Controller - create function] Loaded settings from store:', settings);
      
      // Check if plugin is enabled
      if (!settings?.enabled) {
        return ctx.badRequest('Magic Link plugin is disabled. Enable it in settings first.');
      }
      
      // Find the user using Document Service API
      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { email },
        limit: 1,
      });
      let user = users && users.length > 0 ? users[0] : null;

      const settingCreateUser = settings?.createUserIfNotExists ?? false;
      const legacyCreateUser = settings?.create_new_user ?? false;
      strapi.log.debug(`[MagicLink Controller - create function] Checking user existence for: ${email}`);
      strapi.log.debug(`[MagicLink Controller - create function] User found: ${!!user}`);
      strapi.log.debug(`[MagicLink Controller - create function] Value of createUserIfNotExists from settings: ${settingCreateUser}`);
      strapi.log.debug(`[MagicLink Controller - create function] Value of legacy create_new_user from settings: ${legacyCreateUser}`);

      // Verwende den richtigen Einstellungsnamen: createUserIfNotExists anstatt create_new_user
      // Prüfe sowohl auf den neuen als auch auf den alten Namen für Abwärtskompatibilität
      const canCreateUser = Boolean(settingCreateUser || legacyCreateUser);

      // If user doesn't exist and automatic creation is not enabled, return error
      if (!user && !canCreateUser) {
        // --- DEBUG LOGGING START ---
        strapi.log.warn(`[MagicLink Controller - create function] User does not exist AND canCreateUser is false. Returning Bad Request.`);
        // --- DEBUG LOGGING END ---
        return ctx.badRequest('User does not exist and automatic user creation is disabled');
      }

      // If user doesn't exist, create a new one
      if (!user && canCreateUser) {
        // --- DEBUG LOGGING START ---
        strapi.log.info(`[MagicLink Controller - create function] User does not exist BUT canCreateUser is true. Attempting to create user...`);
        // --- DEBUG LOGGING END ---
        
        // Generate username based on user creation strategy
        // Strategy: 'email' = use email as username
        // Strategy: 'emailUsername' = use email prefix + random suffix for uniqueness
        // Strategy: 'manual' = don't auto-create users (handled above)
        const userCreationStrategy = settings.user_creation_strategy || 'email';
        let username;
        
        strapi.log.debug(`[MagicLink] User creation strategy: ${userCreationStrategy}`);
        
        if (userCreationStrategy === 'email' || userCreationStrategy === 'email-only') {
          // Use full email as username (default for magic-link)
          username = email;
        } else {
          // Generate a unique username based on the email prefix (emailUsername strategy)
          username = email.split('@')[0] + '_' + nanoid(8);
        }
        
        // Create a cryptographically secure random password
        const password = crypto.randomBytes(32).toString('hex');
        
        // Get the default role (authenticated) using Document Service API
        const roles = await strapi.documents('plugin::users-permissions.role').findMany({
          filters: { type: 'authenticated' },
          limit: 1,
        });
        const defaultRole = roles && roles.length > 0 ? roles[0] : null;
          
        if (!defaultRole) {
          return ctx.badRequest('Authenticated role not found');
        }
        
        // Create the user
        user = await strapi.plugin('users-permissions').service('user').add({
          username,
          email,
          password,
          provider: 'local', // Use 'local' so users can login with email/password AND magic-link
          confirmed: true, // Auto-confirm the user
          blocked: false,
          role: defaultRole.id,
        });
        
        strapi.log.info(`Created new user with email: ${email}`);
      }

      // Get token length from settings (default 32 for security)
      const tokenLength = Math.max(16, Math.min(64, settings?.token_length || 32));
      
      // Generate cryptographically secure random token
      const tokenValue = nanoid(tokenLength);
      strapi.log.debug(`[MagicLink] Generated token with length: ${tokenLength}`);
      
      // Hash the token for secure storage
      const { hash: tokenHash, salt: tokenSalt } = cryptoUtils.hashToken(tokenValue);
      
      // Validate and filter context based on whitelist/blacklist settings
      let filteredContext = { ...(typeof context === 'string' ? JSON.parse(context) : context) };
      
      // Apply context whitelist (if set, only allow these fields)
      if (settings?.context_whitelist && settings.context_whitelist.length > 0) {
        const whitelist = settings.context_whitelist.map(f => f.trim().toLowerCase());
        const newContext = {};
        for (const key of Object.keys(filteredContext)) {
          if (whitelist.includes(key.toLowerCase())) {
            newContext[key] = filteredContext[key];
          }
        }
        filteredContext = newContext;
        strapi.log.debug(`[MagicLink] Context filtered by whitelist: ${whitelist.join(', ')}`);
      }
      
      // Apply context blacklist (remove these fields)
      if (settings?.context_blacklist && settings.context_blacklist.length > 0) {
        const blacklist = settings.context_blacklist.map(f => f.trim().toLowerCase());
        for (const key of Object.keys(filteredContext)) {
          if (blacklist.includes(key.toLowerCase())) {
            delete filteredContext[key];
          }
        }
        strapi.log.debug(`[MagicLink] Context fields removed by blacklist: ${blacklist.join(', ')}`);
      }
      
      // Set expiration (TTL from context in hours, or expire_period from settings in seconds, or default 1 hour)
      // Priority: context.ttl (hours) > settings.expire_period (seconds) > default 3600 seconds
      let expirationSeconds;
      if (filteredContext.ttl) {
        // TTL from context is in hours, convert to seconds
        expirationSeconds = filteredContext.ttl * 3600;
      } else if (settings?.expire_period) {
        // expire_period from settings is already in seconds
        expirationSeconds = settings.expire_period;
      } else {
        // Default: 1 hour = 3600 seconds
        expirationSeconds = 3600;
      }
      
      const expiryText = formatExpiryText(Math.floor(expirationSeconds / 60));
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + expirationSeconds);
      
      strapi.log.debug(`[MagicLink] Token expiration set to ${expirationSeconds} seconds (${Math.round(expirationSeconds/3600)} hours)`);

      // Erweitere den Kontext mit Ablaufdatum und Benutzerinformationen
      const enrichedContext = {
        ...filteredContext,
        expires_at: expiresAt.toISOString(),
        expiry_formatted: new Intl.DateTimeFormat('de-DE', {
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).format(expiresAt),
        user: {
          id: user.id,
          email: user.email,
          username: user.username
        }
      };

      const tokenPrefix = tokenValue.substring(0, 8);

      const token = await strapi.documents('plugin::magic-link.token').create({
        data: {
          token: tokenHash,
          token_salt: tokenSalt,
          token_prefix: tokenPrefix,
          email: user.email,
          user_id: user.id,
          expires_at: expiresAt,
          is_active: true,
          is_used: false,
          ip_address: null,
          user_agent: null,
          context: enrichedContext,
        },
      });
      
      // Add plaintext token for display/email (NOT stored in DB)
      token._plaintextToken = tokenValue;
      token.token = tokenValue; // Override hash with plaintext for response

      // Sende eine E-Mail mit dem Magic-Link nur wenn send_email true ist
      if (send_email) {
        try {
          // Lade die Einstellungen aus dem Plugin-Store, falls nicht bereits geladen
          if (!settings) {
            settings = await pluginStore.get({ key: 'settings' });
          }
          
          strapi.log.debug(`[MagicLink] Email settings check: enabled=${settings?.enabled}, from_email=${settings?.from_email}, object=${settings?.object}`);
          
          // Check if we can send emails - use defaults if needed
          const canSendEmail = settings?.enabled !== false;
          const fromEmail = settings?.from_email || strapi.config.get('plugin.email.settings.defaultFrom') || 'noreply@localhost';
          const emailSubject = settings?.object || 'Your Magic Link';
          
          if (canSendEmail) {
            // Erstelle die Magic-Link-URL
            // Prioritaet: 1. frontend_url + frontend_login_path, 2. confirmationUrl, 3. server URL
            let baseUrl;
            if (settings.frontend_url) {
              // Frontend URL ist konfiguriert - nutze diese
              const frontendBase = settings.frontend_url.replace(/\/$/, ''); // Remove trailing slash
              const loginPath = settings.frontend_login_path || '/auth/magic-link';
              baseUrl = `${frontendBase}${loginPath}`;
              strapi.log.debug(`[MagicLink] Using frontend URL: ${baseUrl}`);
            } else {
              // Fallback auf confirmationUrl oder Server URL
              baseUrl = settings.confirmationUrl || process.env.URL || strapi.config.get('server.url') || 'http://localhost:1337/api/magic-link/login';
            }
            const magicLink = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}loginToken=${tokenValue}`;
            
            // Prüfen, ob wir Email Designer verwenden sollen
            const wantsEmailDesigner = settings.use_email_designer && settings.email_designer_template_id;
            const hasEmailDesigner = Boolean(strapi.plugin('email-designer-5'));

            if (wantsEmailDesigner && hasEmailDesigner) {
                // Konvertiere die Template-ID zu einer Zahl
                const templateId = parseInt(settings.email_designer_template_id, 10);
                
                // Stelle sicher, dass die Template-ID eine gültige Zahl ist
                if (!isNaN(templateId) && templateId > 0) {
                  // Email mit dem Email Designer Plugin versenden
                  try {
                    // Die korrekte Email Designer 5 API verwenden
                    await strapi
                      .plugin('email-designer-5')
                      .service('email')
                      .sendTemplatedEmail(
                        {
                          to: user.email,
                          from: settings.from_email ? `${settings.from_name} <${settings.from_email}>` : undefined,
                          replyTo: settings.response_email || undefined,
                        },
                        {
                          templateReferenceId: templateId,
                          subject: settings.object, // Optional: überschreibt den Betreff der Vorlage
                        },
                        {
                          // Variablen für die Vorlage
                          user: {
                            username: user.username,
                            email: user.email,
                          },
                          magicLink: magicLink,
                          token: tokenValue,
                          expiresAt: expiresAt.toISOString(),
                          expiryText,
                        }
                      );
                      
                    strapi.log.info(`Magic Link Email mit Email Designer (Template ID: ${templateId}) an ${user.email} gesendet`);
                  } catch (emailDesignerError) {
                    strapi.log.error('Fehler bei Email Designer:', emailDesignerError);
                    strapi.log.info('Fallback auf Standard-Email-Versand...');
                    await sendStandardEmail(user, magicLink, baseUrl, expiryText, settings, tokenValue);
                  }
                } else {
                  strapi.log.warn(`Ungültige Email Designer Template ID: '${settings.email_designer_template_id}', verwende Standard-Email`);
                  // Fallback auf Standard-Email wenn die Template-ID ungültig ist
                  await sendStandardEmail(user, magicLink, baseUrl, expiryText, settings, tokenValue);
                }
            } else if (wantsEmailDesigner && !hasEmailDesigner) {
              strapi.log.debug('Email Designer aktiviert, aber Plugin nicht installiert – automatischer Fallback auf Standard-Email');
              await sendStandardEmail(user, magicLink, baseUrl, expiryText, settings, tokenValue);
            } else {
              // Standard-Email-Versand
              await sendStandardEmail(user, magicLink, baseUrl, expiryText, settings, tokenValue);
            }
            
            strapi.log.info(`Magic Link Token erstellt und E-Mail an ${user.email} gesendet`);
          } else {
            strapi.log.info(`Magic Link Token erstellt, aber keine E-Mail-Einstellungen konfiguriert`);
          }
        } catch (emailError) {
          strapi.log.error('Fehler beim Senden der Magic Link Email:', emailError);
          // Wir werfen keinen Fehler, da der Token trotzdem erstellt wurde
        }
      }
      
      // Gebe den kompletten Token zurück (inkl. Token-Wert für Admin-Ansicht)
      return token;
    } catch (error) {
      strapi.log.error('Error creating token:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Block a token
   * @param {Object} ctx - The request context
   */
  async block(ctx) {
    try {
      const { id } = ctx.params; // Can be documentId or numeric ID

      // Try to find token - first by documentId, then by numeric id
      let token = await strapi.documents('plugin::magic-link.token').findOne({
        documentId: id,
      });

      // If not found and id looks numeric, try finding by id field
      if (!token && /^\d+$/.test(id)) {
        const tokens = await strapi.documents('plugin::magic-link.token').findMany({
          filters: { id: parseInt(id, 10) },
          limit: 1,
        });
        token = tokens && tokens.length > 0 ? tokens[0] : null;
      }

      if (!token) {
        return ctx.notFound('Token not found');
      }

      // Update the token to be inactive using Document Service API
      const updatedToken = await strapi.documents('plugin::magic-link.token').update({
        documentId: token.documentId,
        data: {
          is_active: false,
        },
      });

      // Sende strukturierte Response
      ctx.send({
        data: {
          ...updatedToken,
          status: 'blocked',
          message: 'Token successfully blocked'
        }
      });
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  /**
   * Delete a token
   * @param {Object} ctx - The request context
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params; // Can be documentId or numeric ID

      // Try to find token - first by documentId, then by numeric id
      let token = await strapi.documents('plugin::magic-link.token').findOne({
        documentId: id,
      });

      // If not found and id looks numeric, try finding by id field
      if (!token && /^\d+$/.test(id)) {
        const tokens = await strapi.documents('plugin::magic-link.token').findMany({
          filters: { id: parseInt(id, 10) },
          limit: 1,
        });
        token = tokens && tokens.length > 0 ? tokens[0] : null;
      }

      if (!token) {
        return ctx.notFound('Token not found');
      }

      // Delete the token using Document Service API
      await strapi.documents('plugin::magic-link.token').delete({
        documentId: token.documentId,
      });

      ctx.send({ 
        success: true,
        message: 'Token successfully deleted' 
      });
    } catch (error) {
      strapi.log.error('Error deleting token:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Activate a token
   * @param {Object} ctx - The request context
   */
  async activate(ctx) {
    try {
      const { id } = ctx.params; // Can be documentId or numeric ID

      // Try to find token - first by documentId, then by numeric id
      let token = await strapi.documents('plugin::magic-link.token').findOne({
        documentId: id,
      });

      // If not found and id looks numeric, try finding by id field
      if (!token && /^\d+$/.test(id)) {
        const tokens = await strapi.documents('plugin::magic-link.token').findMany({
          filters: { id: parseInt(id, 10) },
          limit: 1,
        });
        token = tokens && tokens.length > 0 ? tokens[0] : null;
      }

      if (!token) {
        return ctx.notFound('Token nicht gefunden');
      }

      // Aktualisiere den Token auf aktiv using Document Service API
      const updatedToken = await strapi.documents('plugin::magic-link.token').update({
        documentId: token.documentId,
        data: {
          is_active: true,
        },
      });

      // Sende strukturierte Response
      ctx.send({
        data: {
          ...updatedToken,
          status: 'active',
          message: 'Token successfully activated'
        }
      });
    } catch (error) {
      strapi.log.error('Fehler beim Aktivieren des Tokens:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Extend token validity
   * @param {Object} ctx - The request context
   */
  async extend(ctx) {
    try {
      const { id } = ctx.params; // Can be documentId or numeric ID
      const { days } = ctx.request.body;

      // Try to find token - first by documentId, then by numeric id
      let token = await strapi.documents('plugin::magic-link.token').findOne({
        documentId: id,
      });

      // If not found and id looks numeric, try finding by id field
      if (!token && /^\d+$/.test(id)) {
        const tokens = await strapi.documents('plugin::magic-link.token').findMany({
          filters: { id: parseInt(id, 10) },
          limit: 1,
        });
        token = tokens && tokens.length > 0 ? tokens[0] : null;
      }

      if (!token) {
        return ctx.notFound('Token nicht gefunden');
      }

      // Verarbeite die Anzahl der Tage
      const daysToAdd = parseInt(days) || 7; // Standard: 7 Tage
      
      // Berechne das neue Ablaufdatum
      let newExpiryDate;
      
      // Wenn der Token bereits abgelaufen ist, vom aktuellen Datum ausgehen
      if (new Date(token.expires_at) < new Date()) {
        newExpiryDate = new Date();
      } else {
        // Sonst vom aktuellen Ablaufdatum ausgehen
        newExpiryDate = new Date(token.expires_at);
      }
      
      // Tage hinzufügen
      newExpiryDate.setDate(newExpiryDate.getDate() + daysToAdd);

      // Aktualisiere den Token mit dem neuen Ablaufdatum using Document Service API
      const updatedToken = await strapi.documents('plugin::magic-link.token').update({
        documentId: token.documentId,
        data: {
          expires_at: newExpiryDate,
        },
      });

      // Sende die Response mit dem aktualisierten Token und dem neuen Ablaufdatum
      ctx.send({
        data: {
          ...updatedToken,
          expiresAt: newExpiryDate.toISOString(),
          extendedBy: `${daysToAdd} days`,
          message: `Token validity extended by ${daysToAdd} days`
        }
      });
    } catch (error) {
      strapi.log.error('Fehler beim Verlängern des Tokens:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Resend magic link email for an existing token
   * @param {Object} ctx - The request context
   */
  async resend(ctx) {
    try {
      const { id } = ctx.params;

      // Try to find token - first by documentId, then by numeric id
      let token = await strapi.documents('plugin::magic-link.token').findOne({
        documentId: id,
      });

      if (!token && /^\d+$/.test(id)) {
        const tokens = await strapi.documents('plugin::magic-link.token').findMany({
          filters: { id: parseInt(id, 10) },
          limit: 1,
        });
        token = tokens && tokens.length > 0 ? tokens[0] : null;
      }

      if (!token) {
        return ctx.notFound('Token nicht gefunden');
      }

      // Check if token is still active and not expired
      if (!token.is_active) {
        return ctx.badRequest('Token ist nicht aktiv');
      }

      if (token.is_used) {
        return ctx.badRequest('Token wurde bereits verwendet');
      }

      if (token.expires_at && new Date(token.expires_at) < new Date()) {
        return ctx.badRequest('Token ist abgelaufen');
      }

      // Get settings
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      const settings = await pluginStore.get({ key: 'settings' });

      if (!settings || !settings.enabled) {
        return ctx.badRequest('Magic Link ist nicht aktiviert');
      }

      // Unfortunately we can't resend the original token because it's hashed
      // We need to inform the user about this limitation
      // The best we can do is create a new token for this email
      return ctx.badRequest('Token kann nicht erneut gesendet werden - der Original-Token ist gehashed. Bitte erstelle einen neuen Token für diese E-Mail.');

    } catch (error) {
      strapi.log.error('Fehler beim erneuten Senden:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Find a user by email
   * @param {Object} ctx - The request context
   */
  async findUserByEmail(ctx) {
    try {
      const { email } = ctx.query;

      if (!email) {
        return ctx.badRequest('Email is required');
      }

      // Überprüfe, ob die Plugin-Einstellungen das Erstellen neuer Benutzer erlauben
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      const settings = await pluginStore.get({ key: 'settings' });
      
      // Find the user using Document Service API
      const users = await strapi.documents('plugin::users-permissions.user').findMany({
        filters: { email },
        limit: 1,
      });
      const user = users && users.length > 0 ? users[0] : null;

      if (!user) {
        // Mit createUserIfNotExists-Option kann die API weiterhin true zurückgeben
        if (settings && settings.createUserIfNotExists) {
          return { 
            exists: false, 
            canBeCreated: true,
            autoCreationEnabled: true
          };
        }
        
        return {
          exists: false,
          canBeCreated: false,
          autoCreationEnabled: false
        };
      }

      // Sicheres Benutzerobjekt ohne sensible Daten
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        documentId: user.documentId || null,
        exists: true
      };
    } catch (error) {
      console.error("Error finding user by email:", error);
      ctx.throw(500, error);
    }
  },

  /**
   * Validiert eine E-Mail (Alias für Frontend-Aufrufe)
   * @param {Object} ctx - The request context
   */
  async validateEmail(ctx) {
    return this.findUserByEmail(ctx);
  },

  /**
   * Ban an IP address
   * @param {Object} ctx - The request context
   */
  async banIP(ctx) {
    try {
      const { data } = ctx.request.body;
      
      if (!data || !data.ip) {
        return ctx.badRequest('IP address is required');
      }

      const ipAddress = data.ip;
      
      // Get plugin store to save banned IPs
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      // Get current banned IPs or initialize empty array
      const bannedIPs = (await pluginStore.get({ key: 'banned_ips' })) || { ips: [] };
      
      // Add new IP to the list if not already present
      if (!bannedIPs.ips.includes(ipAddress)) {
        bannedIPs.ips.push(ipAddress);
        
        // Save updated banned IPs list
        await pluginStore.set({ key: 'banned_ips', value: bannedIPs });
        
        // Deactivate all tokens associated with this IP using Document Service API
        const tokensToDeactivate = await strapi.documents('plugin::magic-link.token').findMany({
          filters: { ip_address: ipAddress, is_active: true },
        });
        
        if (tokensToDeactivate && tokensToDeactivate.length > 0) {
          for (const token of tokensToDeactivate) {
            await strapi.documents('plugin::magic-link.token').update({
              documentId: token.documentId,
              data: { is_active: false },
            });
          }
          strapi.log.info(`[SUCCESS] Deactivated ${tokensToDeactivate.length} token(s) for IP ${ipAddress}`);
        }
      }
      
      return { success: true, message: `IP ${ipAddress} has been banned` };
    } catch (error) {
      strapi.log.error('Error banning IP:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Ruft die Liste der gesperrten IP-Adressen ab
   * @param {Object} ctx - The request context
   */
  async getBannedIPs(ctx) {
    try {
      // Get plugin store to retrieve banned IPs
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      // Get current banned IPs or initialize empty array
      const bannedIPs = (await pluginStore.get({ key: 'banned_ips' })) || { ips: [] };
      
      return bannedIPs;
    } catch (error) {
      strapi.log.error('Error fetching banned IPs:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Entsperrt eine IP-Adresse
   * @param {Object} ctx - The request context
   */
  async unbanIP(ctx) {
    try {
      const { data } = ctx.request.body;
      
      if (!data || !data.ip) {
        return ctx.badRequest('IP address is required');
      }

      const ipAddress = data.ip;
      
      // Get plugin store
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      // Get current banned IPs
      const bannedIPs = (await pluginStore.get({ key: 'banned_ips' })) || { ips: [] };
      
      // Remove IP from the banned list
      bannedIPs.ips = bannedIPs.ips.filter(ip => ip !== ipAddress);
      
      // Save updated banned IPs list
      await pluginStore.set({ key: 'banned_ips', value: bannedIPs });
      
      return { success: true, message: `IP ${ipAddress} has been unbanned` };
    } catch (error) {
      strapi.log.error('Error unbanning IP:', error);
      ctx.throw(500, error);
    }
  },

  /**
   * Berechnet einen Sicherheitswert basierend auf verschiedenen Plugin-Metriken
   * @returns {Promise<number>} Sicherheitswert zwischen 0 und 100
   */
  async calculateSecurityScore() {
    try {
      let score = 0;
      const maxScore = 100;
      
      // Hol die Plugin-Einstellungen
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-link',
      });
      
      const settings = (await pluginStore.get({ key: 'settings' })) || {};
      
      // 1. Bewerte Token-Lebensdauer: max. 20 Punkte
      // (Kürzere Lebensdauer ist sicherer)
      let tokenLifetimePoints = 0;
      const tokenLifetime = settings.token_lifetime || 24; // Standardwert: 24 Stunden
      if (tokenLifetime <= 1) tokenLifetimePoints = 20; // 1 Stunde oder weniger
      else if (tokenLifetime <= 6) tokenLifetimePoints = 15; // 6 Stunden oder weniger
      else if (tokenLifetime <= 12) tokenLifetimePoints = 10; // 12 Stunden oder weniger
      else if (tokenLifetime <= 24) tokenLifetimePoints = 5; // 24 Stunden oder weniger
      
      // 2. Bewerte JWT-Lebensdauer: max. 20 Punkte
      let jwtLifetimePoints = 0;
      const jwtLifetime = settings.jwt_token_expires_in || '30d';
      const jwtDays = jwtLifetime.endsWith('d') ? parseInt(jwtLifetime) : 
                     jwtLifetime.endsWith('h') ? parseInt(jwtLifetime) / 24 : 30;
      
      if (jwtDays <= 1) jwtLifetimePoints = 20; // 1 Tag oder weniger
      else if (jwtDays <= 7) jwtLifetimePoints = 15; // 1 Woche oder weniger
      else if (jwtDays <= 14) jwtLifetimePoints = 10; // 2 Wochen oder weniger
      else if (jwtDays <= 30) jwtLifetimePoints = 5; // 1 Monat oder weniger
      
      // 3. Bewerte Sicherheitseinstellungen: max. 30 Punkte
      let configPoints = 0;
      
      // Ist das Auto-Create-User Feature deaktiviert? (sicherer)
      // Prüfe sowohl auf den neuen als auch auf den alten Namen für Abwärtskompatibilität
      if (settings.createUserIfNotExists === false && settings.create_new_user === false) configPoints += 10;
      
      // Ist das Email-Send Feature aktiviert? (sicherer)
      if (settings.enabled === true) configPoints += 5;
      
      // Ist Remember Me deaktiviert? (sicherer)
      if (settings.remember_me === false) configPoints += 5;
      
      // Ist stays_valid deaktiviert? (sicherer)
      if (settings.stays_valid === false) configPoints += 10;
      
      // 4. Bewerte Token-Status: max. 15 Punkte
      let tokenStatusPoints = 0;
      
      // Use count() for efficient token counting (Strapi v5 best practice)
      const [activeTokens, inactiveTokens] = await Promise.all([
        strapi.documents('plugin::magic-link.token').count({ filters: { is_active: true } }),
        strapi.documents('plugin::magic-link.token').count({ filters: { is_active: false } }),
      ]);
      const totalTokens = activeTokens + inactiveTokens;
      const tokenRatio = totalTokens > 0 ? inactiveTokens / totalTokens : 0;
      
      // Bewerte basierend auf dem Verhältnis (mehr inaktive = höhere Sicherheit)
      if (tokenRatio >= 0.8) tokenStatusPoints = 15;
      else if (tokenRatio >= 0.6) tokenStatusPoints = 10;
      else if (tokenRatio >= 0.4) tokenStatusPoints = 5;
      
      // 5. Bewerte gebannte IPs: max. 15 Punkte
      let bannedIPsPoints = 0;
      
      // Hole gebannte IPs
      const bannedIPsData = (await pluginStore.get({ key: 'banned_ips' })) || { ips: [] };
      const bannedIPsCount = bannedIPsData.ips?.length || 0;
      
      // Bewerte basierend auf Anzahl der gebannten IPs
      if (bannedIPsCount >= 10) bannedIPsPoints = 15;
      else if (bannedIPsCount >= 5) bannedIPsPoints = 10;
      else if (bannedIPsCount >= 1) bannedIPsPoints = 5;
      
      // Gesamtpunktzahl berechnen
      score = tokenLifetimePoints + jwtLifetimePoints + configPoints + tokenStatusPoints + bannedIPsPoints;
      
      // Stelle sicher, dass der Score im Bereich 0-100 liegt
      return Math.min(Math.max(score, 0), maxScore);
    } catch (error) {
      console.error('Fehler bei der Berechnung des Sicherheitswerts:', error);
      return 85; // Fallback auf den Standardwert
    }
  },

  /**
   * Get the security score
   * @param {Object} ctx - The request context
   */
  async getSecurityScore(ctx) {
    try {
      const score = await this.calculateSecurityScore();
      return { score };
    } catch (error) {
      ctx.throw(500, error);
    }
  },
}; 