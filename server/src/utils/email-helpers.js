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
    'Importance': 'high',
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
    containerWidth = '600px'
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

/**
 * Creates a clean, plain text version from HTML
 * @param {string} html - HTML content
 * @returns {string} Plain text version
 */
const createPlainTextVersion = (html) => {
  let text = html
    // Remove HTML tags
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    // Replace HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  
  return text;
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
    warnings
  };
};

module.exports = {
  getEmailHeaders,
  wrapEmailTemplate,
  createPlainTextVersion,
  validateEmailConfig
};

