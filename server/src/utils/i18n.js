'use strict';

const fs = require('fs');
const path = require('path');

class I18n {
  constructor() {
    this.translations = {};
    this.defaultLocale = 'en';
    this.loadTranslations();
  }

  loadTranslations() {
    // Try multiple possible paths for i18n files
    const possiblePaths = [
      path.join(__dirname, '../i18n'),           // Development: server/src/utils -> server/src/i18n
      path.join(__dirname, 'i18n'),              // Built: dist/server/utils -> dist/server/i18n
      path.join(__dirname, '../../i18n'),        // Alternative: go up two levels
    ];
    
    let localesDir = null;
    for (const tryPath of possiblePaths) {
      if (fs.existsSync(tryPath)) {
        localesDir = tryPath;
        break;
      }
    }
    
    if (!localesDir) {
      console.warn('[WARNING] [Magic-Link i18n] No i18n directory found, using fallback messages');
      // Set default English translations as fallback
      this.translations.en = {
        errors: {
          'plugin.disabled': 'Magic Link plugin is disabled',
          'token.invalid': 'Invalid or expired token',
          'wrong.email': 'Invalid email address',
          'wrong.user': 'User not found',
          'blocked.user': 'User account is blocked',
        }
      };
      return;
    }
    
    try {
      const files = fs.readdirSync(localesDir);
      
      files.forEach(file => {
        if (file.endsWith('.json')) {
          const locale = file.replace('.json', '');
          const filePath = path.join(localesDir, file);
          this.translations[locale] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
      });
    } catch {
      console.error('[ERROR] [Magic-Link i18n] Error loading translations');
    }
  }

  /**
   * Get translated message
   * @param {string} key - Translation key (e.g. 'errors.wrong.email')
   * @param {string} locale - Language code (e.g. 'en', 'de')
   * @param {object} params - Optional parameters for interpolation
   * @returns {string} Translated message
   */
  t(key, locale = null, params = {}) {
    const lang = locale && this.translations[locale] ? locale : this.defaultLocale;
    const lookup = (translation) => {
      if (!translation || typeof key !== 'string') return undefined;
      // Keys are stored flat inside a namespace: { errors: { "token.invalid": "..." } }.
      // Split only on the first dot; fall back to a nested walk for nested files.
      const dot = key.indexOf('.');
      if (dot > 0) {
        const namespace = translation[key.slice(0, dot)];
        const rest = key.slice(dot + 1);
        if (namespace && typeof namespace[rest] === 'string') return namespace[rest];
      }
      let value = translation;
      for (const part of key.split('.')) {
        if (!value || typeof value !== 'object') return undefined;
        value = value[part];
      }
      return typeof value === 'string' ? value : undefined;
    };

    const value = lookup(this.translations[lang]) ?? lookup(this.translations[this.defaultLocale]);
    if (typeof value !== 'string') {
      return key;
    }

    let result = value;
    Object.keys(params).forEach((param) => {
      result = result.split(`{${param}}`).join(String(params[param]));
    });
    return result;
  }

  /**
   * Get locale from request context. Only locales with a loaded translation
   * file are accepted; anything else falls back to the default locale.
   *
   * @param {object} ctx - Koa context
   * @returns {string} Locale code
   */
  getLocaleFromContext(ctx) {
    const isKnown = (value) =>
      typeof value === 'string' && /^[a-z]{2}$/.test(value) && Boolean(this.translations[value]);

    const queryLocale = typeof ctx?.query?.locale === 'string' ? ctx.query.locale.toLowerCase() : null;
    if (isKnown(queryLocale)) {
      return queryLocale;
    }

    const acceptLanguage = ctx?.request?.header?.['accept-language'];
    if (typeof acceptLanguage === 'string') {
      const primaryLang = acceptLanguage.split(',')[0].split(';')[0].split('-')[0].trim().toLowerCase();
      if (isKnown(primaryLang)) {
        return primaryLang;
      }
    }

    return this.defaultLocale;
  }

  /**
   * Sends a translated error in the standard Strapi error envelope. The
   * translation key is also exposed as `error.key` and `error.details.key`
   * so clients can localise on their side.
   *
   * @param {object} ctx - Koa context
   * @param {string} errorKey - Error key (e.g. 'wrong.email')
   * @param {number} statusCode - HTTP status code
   * @param {object} params - Optional parameters
   * @param {object} [details] - Extra, non-sensitive error details
   */
  sendError(ctx, errorKey, statusCode = 400, params = {}, details = {}) {
    const locale = this.getLocaleFromContext(ctx);
    const fullKey = errorKey.startsWith('errors.') ? errorKey : `errors.${errorKey}`;
    const message = this.t(fullKey, locale, params);
    const names = {
      400: 'ValidationError',
      401: 'UnauthorizedError',
      403: 'ForbiddenError',
      404: 'NotFoundError',
      429: 'RateLimitError',
      503: 'ServiceUnavailableError',
    };

    ctx.status = statusCode;
    ctx.body = {
      data: null,
      error: {
        status: statusCode,
        name: names[statusCode] || 'ApplicationError',
        message,
        key: errorKey,
        details: { key: errorKey, ...details },
      },
    };
    return ctx.body;
  }

  /**
   * Send translated success response
   * @param {object} ctx - Koa context
   * @param {string} successKey - Success key (e.g. 'token.created')
   * @param {object} data - Response data
   * @param {object} params - Optional parameters
   */
  sendSuccess(ctx, successKey, data = {}, params = {}) {
    const locale = this.getLocaleFromContext(ctx);
    const fullKey = successKey.startsWith('success.') ? successKey : `success.${successKey}`;
    const message = this.t(fullKey, locale, params);
    
    ctx.body = {
      ...data,
      message
    };
  }
}

// Create singleton instance
const i18n = new I18n();

module.exports = i18n;
