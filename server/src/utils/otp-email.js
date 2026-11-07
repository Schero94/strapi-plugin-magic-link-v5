'use strict';

const emailHelpers = require('./email-helpers');

/**
 * OTP Email Templates
 * Professional email templates for sending OTP codes
 */

/**
 * Generate OTP email HTML template
 * @param {string} code - OTP code
 * @param {Object} options - Template options
 * @returns {string} HTML email
 */
const generateOTPEmailHTML = (code, options = {}) => {
  const { appName = 'Magic Link', expiryMinutes = 5, userName = null } = options;

  const content = `
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding-bottom: 30px; text-align: center;">
          <h1 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700; color: #1f2937;">
            Your Verification Code
          </h1>
          ${userName ? `<p style="margin: 0; font-size: 16px; color: #6b7280;">Hello ${userName},</p>` : ''}
        </td>
      </tr>
      <tr>
        <td style="padding: 30px; background: linear-gradient(135deg, #f0f9ff 0%, #ede9fe 100%); border-radius: 12px; text-align: center;">
          <p style="margin: 0 0 20px 0; font-size: 16px; color: #374151; font-weight: 500;">
            Enter this code to complete your login:
          </p>
          <div style="
            display: inline-block;
            padding: 20px 40px;
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(79, 70, 229, 0.3);
          ">
            <span style="
              font-size: 36px;
              font-weight: 700;
              color: #ffffff;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            ">${code}</span>
          </div>
          <p style="margin: 20px 0 0 0; font-size: 14px; color: #6b7280;">
            [EXPIRES] This code expires in <strong>${expiryMinutes} minutes</strong>
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding-top: 30px;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.6;">
                  <strong>[SECURITY NOTICE]</strong> If you didn't request this code, please ignore this email. 
                  Your account is still secure.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-top: 30px; text-align: center; border-top: 1px solid #e5e7eb; margin-top: 30px;">
          <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.6;">
            This is an automated message from ${appName}<br/>
            Please do not reply to this email
          </p>
        </td>
      </tr>
    </table>
  `;

  return emailHelpers.wrapEmailTemplate(content, {
    title: 'Your Verification Code',
    preheader: `Your ${expiryMinutes}-minute verification code: ${code}`,
    backgroundColor: '#f9fafb',
  });
};

/**
 * Generate OTP email plain text
 * @param {string} code - OTP code
 * @param {Object} options - Template options
 * @returns {string} Plain text email
 */
const generateOTPEmailText = (code, options = {}) => {
  const { appName = 'Magic Link', expiryMinutes = 5, userName = null } = options;

  return `
Your Verification Code
${userName ? `\nHello ${userName},` : ''}

Enter this code to complete your login:

${code}

[EXPIRES] This code expires in ${expiryMinutes} minutes

[SECURITY NOTICE]
If you didn't request this code, please ignore this email.
Your account is still secure.

---
This is an automated message from ${appName}
Please do not reply to this email
`.trim();
};

/**
 * Send OTP email
 * @param {Object} otpEntry - OTP entry from database
 * @param {Object} settings - Plugin settings
 * @param {Object} user - User object (optional)
 */
const sendOTPEmail = async (otpEntry, settings, user = null) => {
  const expiryMinutes = Math.ceil((new Date(otpEntry.expires_at) - new Date()) / 1000 / 60);

  const html = generateOTPEmailHTML(otpEntry.code, {
    appName: settings.from_name || 'Magic Link',
    expiryMinutes,
    userName: user?.username || user?.firstname || null,
  });

  const text = generateOTPEmailText(otpEntry.code, {
    appName: settings.from_name || 'Magic Link',
    expiryMinutes,
    userName: user?.username || user?.firstname || null,
  });

  const headers = emailHelpers.getEmailHeaders({
    replyTo: settings.response_email,
  });

  // Validate email
  const validation = emailHelpers.validateEmailConfig({
    to: otpEntry.email,
    from: settings.from_email ? `${settings.from_name} <${settings.from_email}>` : undefined,
    subject: `Your verification code: ${otpEntry.code}`,
    text,
    html,
  });

  if (!validation.valid) {
    throw new Error('Invalid OTP email configuration: ' + validation.errors.join(', '));
  }

  // Send email
  await strapi
    .plugin('email')
    .service('email')
    .send({
      to: otpEntry.email,
      from: settings.from_email ? `${settings.from_name} <${settings.from_email}>` : undefined,
      replyTo: settings.response_email || undefined,
      subject: `Your verification code: ${otpEntry.code}`,
      text,
      html,
      headers,
    });

  strapi.log.info(`OTP email sent to ${otpEntry.email}`);
};

module.exports = {
  generateOTPEmailHTML,
  generateOTPEmailText,
  sendOTPEmail,
};
