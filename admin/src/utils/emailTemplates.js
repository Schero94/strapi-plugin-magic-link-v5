/**
 * Built-in email templates for the Settings template gallery.
 *
 * Templates use the safe {{VARIABLE}} placeholder syntax that the server
 * renderer substitutes (values are HTML-escaped in HTML bodies; nothing is
 * executed). Variables used here:
 *   {{LOGIN_URL}}   - complete login link (frontend or confirmation URL + token)
 *   {{EXPIRY_TEXT}} - human readable link lifetime, e.g. "1 hour"
 */

export const EMAIL_TEMPLATES = {
  modern: {
    name: 'Modern Gradient',
    preview: 'Modern design with gradient header',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Magic Link Login</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);">
          <!-- Header with Gradient -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Magic Link Login
              </h1>
              <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0; font-size: 16px;">
                Secure passwordless authentication
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="color: #2d3748; margin: 0 0 20px; font-size: 22px; font-weight: 600;">
                Click to login
              </h2>
              <p style="color: #4a5568; line-height: 1.6; margin: 0 0 30px; font-size: 16px;">
                We received a login request for your account. Click the button below to securely sign in.
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="{{LOGIN_URL}}" 
                       style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 16px 48px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(102, 126, 234, 0.4);">
                      Sign In Securely
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #718096; line-height: 1.6; margin: 30px 0 0; font-size: 14px;">
                Or copy and paste this link into your browser:<br>
                <a href="{{LOGIN_URL}}" style="color: #667eea; word-break: break-all;">{{LOGIN_URL}}</a>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #f7fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #718096; margin: 0 0 10px; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                This link expires in {{EXPIRY_TEXT}}
              </p>
              <p style="color: #a0aec0; margin: 0; font-size: 12px;">
                If you didn't request this, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Magic Link Login\n\nClick to login:\n{{LOGIN_URL}}\n\nThis link expires in {{EXPIRY_TEXT}}.\n\nIf you didn't request this, you can safely ignore this email.`
  },

  minimal: {
    name: 'Clean Minimal',
    preview: 'Simple and elegant design',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Magic Link</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; padding: 60px 20px;">
    <tr>
      <td align="center">
        <table width="500" cellpadding="0" cellspacing="0">
          <tr>
            <td style="text-align: center; padding-bottom: 40px;">
              <div style="width: 64px; height: 64px; background: #0EA5E9; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
              </div>
            </td>
          </tr>
          <tr>
            <td style="text-align: center;">
              <h1 style="color: #111827; margin: 0 0 16px; font-size: 32px; font-weight: 700;">
                Your Magic Link
              </h1>
              <p style="color: #6B7280; line-height: 1.6; margin: 0 0 40px; font-size: 16px;">
                Click the button below to sign in to your account
              </p>
              
              <a href="{{LOGIN_URL}}" 
                 style="display: inline-block; background-color: #0EA5E9; color: #ffffff; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
                Sign In
              </a>
              
              <p style="color: #9CA3AF; margin: 40px 0 0; font-size: 14px;">
                Link expires in {{EXPIRY_TEXT}}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Your Magic Link\n\nClick to sign in:\n{{LOGIN_URL}}\n\nLink expires in {{EXPIRY_TEXT}}.`
  },

  professional: {
    name: 'Professional Blue',
    preview: 'Corporate and trustworthy',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Secure Login Request</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F3F4F6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <!-- Logo/Brand Area -->
          <tr>
            <td style="background-color: #1E40AF; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">
                SECURE ACCESS
              </h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 40px 30px;">
              <p style="color: #111827; margin: 0 0 20px; font-size: 16px; font-weight: 600;">
                Hello,
              </p>
              <p style="color: #4B5563; line-height: 1.6; margin: 0 0 30px; font-size: 15px;">
                You have requested secure access to your account. Please click the button below to proceed with authentication.
              </p>
              
              <!-- Button Container -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px;">
                <tr>
                  <td align="center" style="padding: 10px 0;">
                    <a href="{{LOGIN_URL}}" 
                       style="display: inline-block; background-color: #1E40AF; color: #ffffff; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">
                      Verify & Sign In
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Security Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #EFF6FF; border-left: 4px solid #3B82F6; padding: 16px; margin: 0 0 20px;">
                <tr>
                  <td>
                    <p style="color: #1E40AF; margin: 0; font-size: 13px; line-height: 1.5;">
                      <strong>Security Notice:</strong><br>
                      This link will expire in {{EXPIRY_TEXT}}. For your security, do not share this link with anyone.
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #6B7280; line-height: 1.6; margin: 0; font-size: 13px;">
                If you did not request this authentication, please disregard this email or contact support if you have concerns.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 40px; border-top: 1px solid #E5E7EB;">
              <p style="color: #9CA3AF; margin: 0; font-size: 12px; text-align: center;">
                This is an automated message. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `SECURE ACCESS\n\nHello,\n\nYou have requested secure access to your account.\n\nClick to verify and sign in:\n{{LOGIN_URL}}\n\nSecurity Notice:\nThis link will expire in {{EXPIRY_TEXT}}. Do not share this link.\n\nIf you did not request this, please disregard this email.`
  },

  dark: {
    name: 'Dark Mode',
    preview: 'Modern dark theme',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Magic Link</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0F172A; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #1E293B; border-radius: 16px; overflow: hidden; border: 1px solid #334155;">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 30px; text-align: center; background: linear-gradient(135deg, #312E81 0%, #1E293B 100%);">
              <h1 style="color: #E0E7FF; margin: 0; font-size: 28px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                Magic Link
              </h1>
              <p style="color: #A5B4FC; margin: 10px 0 0; font-size: 16px;">
                Passwordless Authentication
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="color: #E2E8F0; line-height: 1.6; margin: 0 0 24px; font-size: 16px;">
                Hey there!
              </p>
              <p style="color: #CBD5E1; line-height: 1.6; margin: 0 0 32px; font-size: 15px;">
                Click the magic button below to access your account. No passwords, no hassle.
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 20px 0;">
                    <a href="{{LOGIN_URL}}" 
                       style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%); color: #ffffff; padding: 16px 48px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                      Launch Access
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="color: #94A3B8; line-height: 1.6; margin: 32px 0 0; font-size: 13px; text-align: center;">
                Or paste this URL in your browser:<br>
                <span style="color: #818CF8; word-break: break-all;">{{LOGIN_URL}}</span>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #0F172A; padding: 24px 30px; text-align: center; border-top: 1px solid #334155;">
              <p style="color: #64748B; margin: 0 0 8px; font-size: 13px;">
                Expires in {{EXPIRY_TEXT}}
              </p>
              <p style="color: #475569; margin: 0; font-size: 12px;">
                Didn't request this? Just ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Magic Link\n\nHey there!\n\nClick the link below to access your account:\n{{LOGIN_URL}}\n\nExpires in {{EXPIRY_TEXT}}.\n\nDidn't request this? Just ignore this email.`
  },

  playful: {
    name: 'Playful & Fun',
    preview: 'Colorful and engaging',
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Magic Link is Ready!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #FEF3C7 0%, #FED7AA 50%, #FECACA 100%); padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);">
          <!-- Fun Header -->
          <tr>
            <td style="padding: 40px 30px 30px; text-align: center;">
              <div style="margin-bottom: 16px; display: inline-block;">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              </div>
              <h1 style="color: #DC2626; margin: 0; font-size: 32px; font-weight: 800;">
                Your Magic Link is Ready!
              </h1>
              <p style="color: #F59E0B; margin: 12px 0 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px;">
                Let's get you signed in
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 20px 40px 40px;">
              <p style="color: #374151; line-height: 1.7; margin: 0 0 30px; font-size: 16px; text-align: center;">
                Hey friend! We've prepared something special for you. Click the shiny button below to access your account!
              </p>
              
              <!-- Colorful Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 10px 0 30px;">
                    <a href="{{LOGIN_URL}}" 
                       style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #F59E0B 0%, #DC2626 100%); color: #ffffff; padding: 18px 54px; border-radius: 16px; text-decoration: none; font-weight: 700; font-size: 18px; box-shadow: 0 8px 16px rgba(245, 158, 11, 0.4); text-transform: uppercase; letter-spacing: 0.5px;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="8 12 12 16 16 12"></polyline><line x1="12" y1="8" x2="12" y2="16"></line></svg>
                      Click Here!
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- Fun Fact Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #DBEAFE 0%, #E0E7FF 100%); border-radius: 12px; padding: 20px; margin: 20px 0;">
                <tr>
                  <td style="text-align: center;">
                    <p style="color: #1E40AF; margin: 0; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                      Pro Tip: Save this email for quick access later!
                    </p>
                  </td>
                </tr>
              </table>
              
              <p style="color: #6B7280; line-height: 1.6; margin: 20px 0 0; font-size: 13px; text-align: center;">
                Can't click? Copy & paste: <span style="color: #F59E0B; word-break: break-all;">{{LOGIN_URL}}</span>
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background: linear-gradient(135deg, #FEF3C7 0%, #FECACA 100%); padding: 24px; text-align: center;">
              <p style="color: #B91C1C; margin: 0 0 8px; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; vertical-align: middle;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Hurry! Link expires in {{EXPIRY_TEXT}}
              </p>
              <p style="color: #DC2626; margin: 0; font-size: 12px;">
                Not you? No worries, just delete this email!
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Your Magic Link is Ready!\n\nLet's get you signed in!\n\nClick here:\n{{LOGIN_URL}}\n\nPro Tip: Save this email for quick access later!\n\nHurry! Link expires in {{EXPIRY_TEXT}}.\n\nNot you? No worries, just delete this email!`
  }
};

/** Legacy lodash placeholders (5.x) mapped to the 6.0 syntax. */
const LEGACY_PLACEHOLDER = /<%=\s*([A-Za-z_]+)\s*%>/g;
const LEGACY_LINK = /<%=\s*URL\s*%>\?loginToken=<%=\s*CODE\s*%>/g;

/**
 * Converts 5.x templates (`<%= URL %>?loginToken=<%= CODE %>`, `<%= VAR %>`)
 * to the 6.0 placeholder syntax. Nothing is evaluated; unknown text is kept.
 *
 * @param {unknown} template - stored HTML or text template
 * @returns {string} template using {{VARIABLE}} placeholders
 */
export const toPlaceholderSyntax = (template) =>
  String(template ?? '')
    .replace(LEGACY_LINK, '{{LOGIN_URL}}')
    .replace(LEGACY_PLACEHOLDER, (_match, name) => `{{${name.toUpperCase()}}}`);

/**
 * Template options for the gallery select.
 * @returns {{value: string, label: string, preview: string}[]}
 */
export const getTemplateList = () =>
  Object.entries(EMAIL_TEMPLATES).map(([key, template]) => ({
    value: key,
    label: template.name,
    preview: template.preview,
  }));

/**
 * @param {string} key - template key from getTemplateList()
 * @returns {{name: string, preview: string, html: string, text: string}} the template, or "modern"
 */
export const getTemplate = (key) =>
  Object.hasOwn(EMAIL_TEMPLATES, key) ? EMAIL_TEMPLATES[key] : EMAIL_TEMPLATES.modern;
