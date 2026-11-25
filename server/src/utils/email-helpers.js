'use strict';

/**
 * Email Helper Utilities
 * Ensures emails are compatible with all major email clients
 */

/**
 * Generates email headers that improve deliverability
 * @param {Object} options - Email options
 * @returns {Object} Headers object
 */
const getEmailHeaders = (options = {}) => {
  const headers = {
    'X-Mailer': 'Strapi Magic Link',
    'X-Priority': '1', // High priority
    Importance: 'high',
    'X-MSMail-Priority': 'High', // Outlook
  };

  // Add List-Unsubscribe header if reply-to exists
  if (options.replyTo) {
    headers['List-Unsubscribe'] = `<mailto:${options.replyTo}?subject=unsubscribe>`;
  }

  return headers;
};

/**
 * Wraps HTML content in a responsive, email-client compatible template
 * @param {string} content - The HTML content to wrap
 * @param {Object} options - Template options
 * @returns {string} Complete HTML email
 */
const wrapEmailTemplate = (content, options = {}) => {
  const {
    title = 'Magic Link Login',
    preheader = 'Your secure login link is ready',
    backgroundColor = '#f4f4f4',
    containerWidth = '600px',
  } = options;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <!--[if gte mso 9]>
  <xml>
    <o:OfficeDocumentSettings>
      <o:AllowPNG/>
      <o:PixelsPerInch>96</o:PixelsPerInch>
    </o:OfficeDocumentSettings>
  </xml>
  <![endif]-->
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title}</title>
  
  <!-- Preheader text (hidden but shows in inbox preview) -->
  <div style="display: none; max-height: 0px; overflow: hidden;">
    ${preheader}
  </div>
  
  <!-- Zero-width space hack for email clients -->
  <div style="display: none; max-height: 0px; overflow: hidden;">
    &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
  </div>
  
  <style type="text/css">
    /* Reset styles */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    
    /* Body styles */
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
      background-color: ${backgroundColor};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    
    /* Link styles */
    a {
      color: #4F46E5;
      text-decoration: underline;
    }
    
    /* Button styles */
    .button {
      display: inline-block;
      padding: 16px 32px;
      background-color: #4F46E5;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 16px;
      line-height: 1;
      text-align: center;
      mso-line-height-rule: exactly;
    }
    
    .button:hover {
      background-color: #4338CA !important;
    }
    
    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      .email-container {
        background-color: #1f2937 !important;
      }
      .email-content {
        color: #f3f4f6 !important;
      }
    }
    
    /* Mobile responsive */
    @media screen and (max-width: 600px) {
      .email-container {
        width: 100% !important;
        max-width: 100% !important;
      }
      .button {
        padding: 14px 24px !important;
        font-size: 14px !important;
      }
    }
  </style>
  
  <!--[if mso]>
  <style type="text/css">
    .button { padding: 16px 32px !important; }
  </style>
  <![endif]-->
</head>

<body style="margin: 0; padding: 0; background-color: ${backgroundColor};">
  <!-- Preview Text -->
  <span style="display:none !important; font-size:1px; color:${backgroundColor}; line-height:1px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide: all;">
    ${preheader}
  </span>
  
  <!-- Email Wrapper -->
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${backgroundColor}; padding: 20px 0;">
    <tr>
      <td align="center" style="padding: 0;">
        <!--[if mso]>
        <table align="center" border="0" cellspacing="0" cellpadding="0" width="${containerWidth.replace('px', '')}">
        <tr>
        <td align="center" valign="top" width="${containerWidth.replace('px', '')}">
        <![endif]-->
        
        <!-- Email Container -->
        <table class="email-container" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: ${containerWidth}; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td class="email-content" style="padding: 40px 30px; color: #374151; font-size: 16px; line-height: 1.6;">
              ${content}
            </td>
          </tr>
        </table>
        
        <!--[if mso]>
        </td>
        </tr>
        </table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/** Elements whose content is not text (dropped with their content). */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);
/** Entities the e-mail templates and escapeHtml() produce. */
const TEXT_ENTITIES = Object.freeze({
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#96': '`',
});
const MAX_TAG_NAME_LENGTH = 16;

/**
 * Lower-case element name right after `<` at `start`, or ''.
 *
 * @param {string} source - HTML.
 * @param {number} start - Index of the first character after `<`.
 * @returns {string} Element name.
 */
const tagNameAt = (source, start) => {
  let end = start;
  while (end < source.length && end - start < MAX_TAG_NAME_LENGTH) {
    const code = source.charCodeAt(end);
    const isLetter = (code | 0x20) >= 0x61 && (code | 0x20) <= 0x7a;
    const isDigit = code >= 0x30 && code <= 0x39;
    if (!isLetter && !isDigit) break;
    end += 1;
  }
  return source.slice(start, end).toLowerCase();
};

/**
 * Creates the plain-text part of an e-mail from its HTML part.
 *
 * One left-to-right scan instead of regex tag stripping (security audit
 * 2026-11-25, ML-SEC-02 / CodeQL js/incomplete-multi-character-sanitization,
 * js/bad-tag-filter, js/double-escaping): tags become spaces, `<script>` and
 * `<style>` are dropped with their content up to the matching end tag (also
 * `</script >`), an unterminated tag or raw-text element drops the rest, and
 * entities are decoded in a single pass, so `&amp;lt;` stays `&lt;`. The
 * result is only used as `text/plain`, never rendered as HTML. Every index
 * only moves forward, so it runs in linear time on any input.
 *
 * @param {string} html - HTML content.
 * @returns {string} Plain text version.
 */
const createPlainTextVersion = (html) => {
  const source = String(html ?? '');
  const lower = source.toLowerCase();
  const parts = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open === -1) {
      parts.push(source.slice(index));
      break;
    }
    parts.push(source.slice(index, open));
    const close = source.indexOf('>', open + 1);
    if (close === -1) break;
    parts.push(' ');
    index = close + 1;
    const name = tagNameAt(source, open + 1);
    if (RAW_TEXT_ELEMENTS.has(name)) {
      const end = lower.indexOf(`</${name}`, index);
      if (end === -1) break;
      const endClose = source.indexOf('>', end);
      if (endClose === -1) break;
      index = endClose + 1;
    }
  }
  return parts
    .join('')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#96);/g, (_entity, name) => TEXT_ENTITIES[name])
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Validates email configuration
 * @param {Object} emailConfig - Email configuration object
 * @returns {Object} Validation result
 */
const validateEmailConfig = (emailConfig) => {
  const errors = [];
  const warnings = [];

  if (!emailConfig.to || !emailConfig.to.includes('@')) {
    errors.push('Invalid recipient email address');
  }

  if (!emailConfig.from || !emailConfig.from.includes('@')) {
    errors.push('Invalid sender email address');
  }

  if (!emailConfig.subject || emailConfig.subject.trim().length === 0) {
    warnings.push('Empty subject line may trigger spam filters');
  }

  if (!emailConfig.text) {
    warnings.push('No plain text version provided');
  }

  if (!emailConfig.html) {
    warnings.push('No HTML version provided');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};

module.exports = {
  getEmailHeaders,
  wrapEmailTemplate,
  createPlainTextVersion,
  validateEmailConfig,
};
