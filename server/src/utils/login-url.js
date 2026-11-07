'use strict';

/**
 * One link builder for every magic-link e-mail (public send-link and admin
 * created tokens), plus the URL policy used by the settings validation.
 *
 * Precedence:
 *   1. frontend_url + frontend_login_path  (SPA landing page, recommended)
 *   2. confirmationUrl                      (custom backend or frontend URL)
 *   3. <server.url><api.rest.prefix>/magic-link/login   (API fallback)
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Returns true for absolute https URLs, and for http URLs that point at a
 * local development host. Credentials in the URL are rejected.
 *
 * @param {unknown} value - Candidate URL.
 * @returns {boolean} Whether the URL may be used in login e-mails.
 */
const isAllowedLinkUrl = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase();
    return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost');
  }
  return false;
};

/**
 * Joins a base URL and a path without doubling or dropping slashes.
 *
 * @param {string} base - Absolute base URL.
 * @param {string} path - Path to append.
 * @returns {string} Joined URL.
 */
const joinUrl = (base, path) => {
  const cleanBase = String(base || '').replace(/\/+$/, '');
  const cleanPath = String(path || '').trim();
  if (!cleanPath) return cleanBase;
  return `${cleanBase}/${cleanPath.replace(/^\/+/, '')}`;
};

/**
 * Builds the API fallback login URL from the Strapi server configuration.
 *
 * @param {object} [strapiInstance] - Strapi instance (defaults to global).
 * @returns {string} Absolute login endpoint URL.
 */
const defaultApiLoginUrl = (strapiInstance = global.strapi) => {
  const config = strapiInstance?.config;
  const serverUrl =
    config?.get?.('server.absoluteUrl') || config?.get?.('server.url') || 'http://localhost:1337';
  const prefix = config?.get?.('api.rest.prefix', '/api') || '/api';
  const base = /^https?:\/\//i.test(serverUrl) ? serverUrl : 'http://localhost:1337';
  return joinUrl(joinUrl(base, prefix), '/magic-link/login');
};

/**
 * Resolves the base login URL (without token) from the plugin settings.
 * Settings values that violate the URL policy are ignored so a malformed or
 * hostile value can never end up in an e-mail.
 *
 * @param {object} settings - Plugin settings.
 * @param {object} [strapiInstance] - Strapi instance (defaults to global).
 * @returns {string} Absolute base login URL.
 */
const resolveBaseLoginUrl = (settings = {}, strapiInstance = global.strapi) => {
  if (isAllowedLinkUrl(settings?.frontend_url)) {
    return joinUrl(settings.frontend_url.trim(), settings.frontend_login_path || '');
  }
  if (isAllowedLinkUrl(settings?.confirmationUrl)) {
    return settings.confirmationUrl.trim();
  }
  return defaultApiLoginUrl(strapiInstance);
};

/**
 * Builds the full login URL with the token as `loginToken` query parameter.
 * Uses the URL API, so an existing query string or fragment is preserved.
 *
 * @param {object} settings - Plugin settings.
 * @param {string} plaintextToken - Plaintext login token.
 * @param {object} [strapiInstance] - Strapi instance (defaults to global).
 * @returns {{ baseUrl: string, loginUrl: string }} Base and complete URL.
 */
const buildLoginUrl = (settings, plaintextToken, strapiInstance = global.strapi) => {
  const baseUrl = resolveBaseLoginUrl(settings, strapiInstance);
  const url = new URL(baseUrl);
  url.searchParams.set('loginToken', String(plaintextToken || ''));
  return { baseUrl, loginUrl: url.toString() };
};

/**
 * Removes query strings and fragments from a URL for log output so login
 * tokens never reach log files.
 *
 * @param {unknown} value - URL or path.
 * @returns {string} The URL without query string and fragment.
 */
const redactUrl = (value) => String(value ?? '').replace(/[?#].*$/, '');

module.exports = {
  buildLoginUrl,
  defaultApiLoginUrl,
  isAllowedLinkUrl,
  joinUrl,
  redactUrl,
  resolveBaseLoginUrl,
};
