'use strict';

/**
 * Server-side plugin configuration (config/plugins.js):
 *
 *   'magic-link': {
 *     config: {
 *       // Optional allow-list of origins that login links may point at
 *       // (confirmationUrl, frontend_url, callback_url). Empty = any https
 *       // URL (http only for localhost). Admins cannot change this list.
 *       allowedLinkOrigins: ['https://app.example.test'],
 *
 *       // Optional bounce/complaint webhooks without Magic Mail
 *       // (POST /api/magic-link/delivery-webhooks/:provider). Each provider
 *       // stays off until its secret is set here or in the environment.
 *       deliveryWebhooks: {
 *         sendgrid: { publicKey: env('MAGIC_LINK_WEBHOOK_SENDGRID_PUBLIC_KEY') },
 *         mailgun: { signingKey: env('MAGIC_LINK_WEBHOOK_MAILGUN_SIGNING_KEY') },
 *         ses: { topicArns: ['arn:aws:sns:eu-west-1:123456789012:ses-feedback'] },
 *         postmark: { username: 'postmark', password: env('MAGIC_LINK_WEBHOOK_POSTMARK_PASSWORD') },
 *       },
 *     },
 *   },
 *
 * Docs checked (2026-11-07): docs.strapi.io/cms/plugins-development/server-configuration
 * (default + validator, deep merge, read via strapi.config.get('plugin::<name>.<key>')).
 */
/**
 * @param {unknown} webhooks - `deliveryWebhooks` config
 * @throws {Error} on a wrong shape (values are never echoed)
 */
const validateDeliveryWebhooks = (webhooks) => {
  if (webhooks === undefined || webhooks === null) return;
  if (typeof webhooks !== 'object' || Array.isArray(webhooks)) {
    throw new Error('magic-link: deliveryWebhooks must be an object');
  }
  const optionalString = (value, name) => {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error(`magic-link: deliveryWebhooks.${name} must be a string`);
    }
  };
  optionalString(webhooks.sendgrid?.publicKey, 'sendgrid.publicKey');
  optionalString(webhooks.mailgun?.signingKey, 'mailgun.signingKey');
  optionalString(webhooks.postmark?.username, 'postmark.username');
  optionalString(webhooks.postmark?.password, 'postmark.password');
  const password = webhooks.postmark?.password;
  if (typeof password === 'string' && password !== '' && password.length < 12) {
    throw new Error(
      'magic-link: deliveryWebhooks.postmark.password must have at least 12 characters'
    );
  }
  const arns = webhooks.ses?.topicArns;
  if (arns !== undefined && (!Array.isArray(arns) || arns.some((arn) => typeof arn !== 'string'))) {
    throw new Error(
      'magic-link: deliveryWebhooks.ses.topicArns must be an array of SNS topic ARNs'
    );
  }
};

module.exports = {
  default: { allowedLinkOrigins: [], deliveryWebhooks: {} },
  validator(config) {
    validateDeliveryWebhooks(config?.deliveryWebhooks);
    const origins = config?.allowedLinkOrigins;
    if (origins === undefined) return;
    if (!Array.isArray(origins)) {
      throw new Error('magic-link: allowedLinkOrigins must be an array of origins');
    }
    for (const origin of origins) {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error('magic-link: allowedLinkOrigins contains an invalid URL');
      }
      if (parsed.origin !== origin) {
        throw new Error(
          'magic-link: allowedLinkOrigins entries must be bare origins such as https://app.example.test'
        );
      }
    }
  },
};
