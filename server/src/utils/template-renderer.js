'use strict';

/**
 * Safe e-mail template renderer.
 *
 * Templates are plain text with `{{VARIABLE}}` placeholders. Nothing in a
 * template is ever evaluated as code: the renderer performs a single regex
 * substitution against an allow-listed variable map, so an admin who can edit
 * the e-mail settings cannot run JavaScript on the server (the previous
 * lodash `_.template` implementation could).
 *
 * Supported syntaxes (all resolved through the same allow-list):
 *  - `{{ VARIABLE }}`            canonical syntax
 *  - `<%= VARIABLE %>`           legacy lodash syntax (rendered, never executed)
 *  - `{link}`, `{username}`, ... legacy single-brace aliases used by older
 *    admin-panel templates
 *
 * Any other `<% ... %>` block is left untouched as literal text (HTML-escaped
 * in HTML bodies), so it can never execute.
 */

/**
 * Canonical template variables. Every documented variable must be listed
 * here and provided by `buildTemplateVariables`.
 */
const TEMPLATE_VARIABLES = Object.freeze([
  'LOGIN_URL',
  'URL',
  'CODE',
  'EXPIRY_TEXT',
  'EXPIRES_AT',
  'EMAIL',
  'USER',
]);

/** Alias -> canonical variable (case-insensitive lookup). */
const VARIABLE_ALIASES = Object.freeze({
  LINK: 'LOGIN_URL',
  MAGIC_LINK_URL: 'LOGIN_URL',
  MAGICLINKURL: 'LOGIN_URL',
  LOGINURL: 'LOGIN_URL',
  BASE_URL: 'URL',
  TOKEN: 'CODE',
  EXPIRYTEXT: 'EXPIRY_TEXT',
  EXPIRESAT: 'EXPIRES_AT',
  USERNAME: 'USER',
  RECIPIENT: 'EMAIL',
});

/** Single-brace names that older admin templates used. */
const LEGACY_SINGLE_BRACE = ['link', 'username', 'email', 'expiry_text', 'code', 'url'];

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/**
 * Escapes a value for safe inclusion in HTML text and quoted attributes.
 *
 * @param {unknown} value - Value to escape.
 * @returns {string} The escaped string.
 */
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"'`]/g, (ch) => HTML_ESCAPES[ch]);

/**
 * Resolves a placeholder name to a canonical variable name.
 *
 * @param {string} name - Placeholder name as written in the template.
 * @returns {string|null} Canonical variable name or null when unknown.
 */
const resolveVariableName = (name) => {
  const upper = String(name || '').trim().toUpperCase();
  if (TEMPLATE_VARIABLES.includes(upper)) return upper;
  return VARIABLE_ALIASES[upper] || null;
};

// One combined pattern so substituted values are never re-scanned.
const PLACEHOLDER_PATTERN = new RegExp(
  [
    '\\{\\{\\s*([A-Za-z_][A-Za-z0-9_]{0,63})\\s*\\}\\}',
    '<%=\\s*([A-Za-z_][A-Za-z0-9_]{0,63})\\s*%>',
    `\\{(${LEGACY_SINGLE_BRACE.join('|')})\\}`,
  ].join('|'),
  'gi'
);

// The historical default joined base URL and token by hand, which produced a
// broken link whenever the URL already contained a query string.
const LEGACY_LINK_PATTERN =
  /(?:<%=\s*URL\s*%>|\{\{\s*URL\s*\}\})\?loginToken=(?:<%=\s*CODE\s*%>|\{\{\s*CODE\s*\}\})/g;

/**
 * Converts a legacy template to the canonical `{{VARIABLE}}` syntax.
 * `URL?loginToken=CODE` constructions become `{{LOGIN_URL}}` so the link
 * builder controls separators and encoding. Unknown `<%= %>` expressions
 * are left untouched (they render as literal text, never as code).
 *
 * @param {unknown} template - Stored template.
 * @returns {string} The converted template ('' for non-strings).
 */
const migrateLegacyTemplate = (template) => {
  if (typeof template !== 'string') return '';
  return template
    .replace(LEGACY_LINK_PATTERN, '{{LOGIN_URL}}')
    .replace(/<%=\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*%>/g, (match, name) => {
      const canonical = resolveVariableName(name);
      return canonical ? `{{${canonical}}}` : match;
    });
};

/**
 * Renders a template with allow-listed variables. No code execution is
 * possible. Unknown placeholders render as an empty string so an admin typo
 * can never break login delivery.
 *
 * @param {unknown} template - Template string.
 * @param {Record<string, unknown>} variables - Values keyed by canonical name.
 * @param {{ html?: boolean }} [options] - `html: true` escapes values and literal markup outside placeholders is kept.
 * @returns {string} The rendered string.
 */
const renderTemplate = (template, variables = {}, { html = false } = {}) => {
  if (typeof template !== 'string' || template.length === 0) return '';
  const source = migrateLegacyTemplate(template);

  return source.replace(PLACEHOLDER_PATTERN, (match, curly, legacy, single) => {
    const canonical = resolveVariableName(curly || legacy || single);
    if (!canonical) {
      // Unknown `{{x}}` / `<%= x %>`: drop it rather than leak template syntax.
      return '';
    }
    const raw = Object.prototype.hasOwnProperty.call(variables, canonical) ? variables[canonical] : '';
    const value = raw === null || raw === undefined ? '' : String(raw);
    return html ? escapeHtml(value) : value;
  }).replace(/<%[\s\S]*?%>/g, (block) => (html ? escapeHtml(block) : block));
};

/**
 * Formats a remaining lifetime in minutes as human readable English text.
 *
 * @param {number} minutes - Remaining minutes.
 * @returns {string} e.g. "1 hour", "15 minutes".
 */
const formatExpiryText = (minutes) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return '1 minute';
  const safeMinutes = Math.max(1, Math.round(minutes));
  if (safeMinutes >= 60 && safeMinutes % 60 === 0) {
    const hours = safeMinutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (safeMinutes >= 120) {
    const hours = Math.round(safeMinutes / 60);
    return `${hours} hours`;
  }
  return `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`;
};

/**
 * Builds the complete documented variable set for a login e-mail.
 *
 * @param {object} params
 * @param {string} params.loginUrl - Complete login URL including the token.
 * @param {string} params.baseUrl - Login URL without the token.
 * @param {string} params.code - Plaintext login token.
 * @param {string} params.email - Recipient address.
 * @param {string} [params.username] - Recipient username.
 * @param {Date|string|null} [params.expiresAt] - Token expiry.
 * @param {number} [params.expirePeriodSeconds] - Configured lifetime used for EXPIRY_TEXT.
 * @returns {Record<string, string>} Variables keyed by canonical name.
 */
const buildTemplateVariables = ({ loginUrl, baseUrl, code, email, username, expiresAt, expirePeriodSeconds }) => {
  const expiresDate = expiresAt ? new Date(expiresAt) : null;
  const validExpiry = expiresDate && !Number.isNaN(expiresDate.getTime()) ? expiresDate : null;
  let minutes;
  if (Number.isFinite(expirePeriodSeconds) && expirePeriodSeconds > 0) {
    minutes = expirePeriodSeconds / 60;
  } else if (validExpiry) {
    minutes = (validExpiry.getTime() - Date.now()) / 60_000;
  } else {
    minutes = 60;
  }

  return {
    LOGIN_URL: loginUrl || '',
    URL: baseUrl || '',
    CODE: code || '',
    EXPIRY_TEXT: formatExpiryText(minutes),
    EXPIRES_AT: validExpiry ? validExpiry.toISOString() : '',
    EMAIL: email || '',
    USER: username || email || '',
  };
};

module.exports = {
  TEMPLATE_VARIABLES,
  buildTemplateVariables,
  escapeHtml,
  formatExpiryText,
  migrateLegacyTemplate,
  renderTemplate,
};
