'use strict';

/**
 * Zod validation schemas for magic-link public API controllers.
 *
 * All schemas are applied to ctx.request.body BEFORE the payload reaches
 * any service method. A `parseBody` helper converts Zod issues into the
 * standard Strapi error envelope via @strapi/utils ValidationError.
 *
 * Design notes:
 *  - Emails are lower-cased on parse (cheaper than re-doing it in every controller).
 *  - Generous upper bounds on strings keep memory usage predictable.
 *  - `.strict()` rejects unknown top-level keys to avoid smuggling of
 *    additional fields into downstream services.
 */

// Use the CommonJS entry so Plugin SDK bundling resolves Zod consistently.
const z = require('zod');
const { ValidationError } = require('@strapi/utils').errors;
const { LIMITS, findReservedKeys } = require('../utils/context-policy');
const { isAllowedLinkUrl } = require('../utils/login-url');

// Permissive email regex matching the one used in auth.js (avoids ReDoS).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .regex(EMAIL_REGEX, 'Invalid email')
  .transform((v) => v.toLowerCase());

const tokenSchema = z.string().min(1).max(512);
const codeSchema = z.string().trim().min(4).max(16);
// Usernames for auto-created accounts: letters, digits, dot, underscore and
// dash only, so no markup can reach e-mails or admin views.
const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N}._-]+$/u, 'Username may only contain letters, digits, ".", "_" and "-"')
  .optional();

const REMOVED_DELIVERY_FIELDS = ['phoneNumber', 'phone', 'via'];
const REMOVED_DELIVERY_MESSAGE = 'Only e-mail delivery is supported; WhatsApp and SMS delivery were removed in 6.0.0';

// Context from clients: small, bounded records. Reserved keys that carry
// authentication state are rejected outright (see utils/context-policy.js).
const contextValueSchema = z.union([
  z.string().max(LIMITS.maxStringLength),
  z.number(),
  z.boolean(),
  z.null(),
  z.record(z.string().max(LIMITS.maxKeyLength), z.unknown()),
  z.array(z.unknown()).max(50),
]);

const contextSchema = z
  .record(z.string().min(1).max(LIMITS.maxKeyLength), contextValueSchema)
  .superRefine((context, ctx) => {
    const keys = Object.keys(context);
    if (keys.length > LIMITS.maxKeys) {
      ctx.addIssue({ code: 'custom', message: `context may contain at most ${LIMITS.maxKeys} keys` });
    }
    for (const key of findReservedKeys(context)) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'This context key is reserved' });
    }
    try {
      if (JSON.stringify(context).length > LIMITS.maxJsonLength * 4) {
        ctx.addIssue({ code: 'custom', message: 'context is too large' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'context must be JSON serialisable' });
    }
  })
  .optional();

/**
 * Public send-link body. E-mail is the only delivery channel: WhatsApp and
 * SMS were removed in 6.0.0, so the former delivery fields are rejected with
 * an explicit message instead of being silently ignored.
 */
const sendLinkSchema = z
  .looseObject({})
  .superRefine((value, ctx) => {
    for (const key of REMOVED_DELIVERY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        ctx.addIssue({ code: 'custom', path: [key], message: REMOVED_DELIVERY_MESSAGE });
      }
    }
    if (value.delivery !== undefined && value.delivery !== 'email') {
      ctx.addIssue({ code: 'custom', path: ['delivery'], message: REMOVED_DELIVERY_MESSAGE });
    }
  })
  .pipe(
    z
      .object({
        email: emailSchema,
        username: usernameSchema,
        context: contextSchema,
        delivery: z.literal('email').optional(),
      })
      .strict()
  );

/** Body of POST /login (token exchange from the frontend landing page). */
const loginExchangeSchema = z
  .object({
    loginToken: tokenSchema,
    deviceId: z.string().min(1).max(255).optional(),
  })
  .strict();

const otpSendSchema = z
  .object({
    email: emailSchema,
    magicLinkToken: tokenSchema.optional(),
  })
  .strict();

const otpVerifySchema = z
  .object({
    email: emailSchema,
    code: codeSchema,
    magicLinkToken: tokenSchema.optional(),
  })
  .strict();

const otpResendSchema = otpSendSchema;

const mfaVerifyTotpSchema = z
  .object({
    loginToken: tokenSchema,
    totpCode: codeSchema,
    deviceId: z.string().min(1).max(255).optional(),
  })
  .strict();

const loginWithTotpSchema = z
  .object({
    email: emailSchema,
    totpCode: codeSchema,
    deviceId: z.string().min(1).max(255).optional(),
  })
  .strict();

const totpTokenOnlySchema = z
  .object({
    token: codeSchema,
  })
  .strict();

const linkUrlSchema = z
  .string()
  .max(2_048)
  .refine((value) => value === '' || isAllowedLinkUrl(value), {
    message: 'Must be an https URL (http is only allowed for localhost)',
  });

const settingsFieldSchemas = {
  enabled: z.boolean(),
  createUserIfNotExists: z.boolean(),
  stays_valid: z.boolean(),
  verify_email: z.boolean(),
  welcome_email: z.boolean(),
  use_jwt_token: z.boolean(),
  allow_magic_links_on_public_registration: z.boolean(),
  store_login_info: z.boolean(),
  use_email_designer: z.boolean(),
  use_magic_mail: z.boolean(),
  otp_enabled: z.boolean(),
  otp_strict_binding: z.boolean(),
  mfa_require_totp: z.boolean(),
  totp_as_primary_auth: z.boolean(),
  rate_limit_enabled: z.boolean(),
  passwordlessCompatibility: z.boolean(),
  emailDesignerCompatibility: z.boolean(),
  // E-mail is the only OTP channel since 6.0.0.
  otp_type: z.literal('email'),
  mfa_mode: z.enum(['disabled', 'optional', 'required']),
  otp_length: z.number().int().min(4).max(16),
  otp_expiry: z.number().int().min(30).max(86_400),
  otp_max_attempts: z.number().int().min(1).max(20),
  otp_resend_cooldown: z.number().int().min(0).max(86_400),
  rate_limit_max_attempts: z.number().int().min(1).max(1_000),
  rate_limit_window_minutes: z.number().int().min(1).max(10_080),
  totp_digits: z.number().int().refine((value) => value === 6 || value === 8),
  totp_period: z.number().int().min(15).max(300),
  expire_period: z.number().int().min(10).max(31_536_000),
  // >= 22 URL-safe characters = 132 bits of entropy.
  token_length: z.number().int().min(22).max(128),
  max_login_attempts: z.number().int().min(1).max(1_000),
  // Login links may only point at https URLs (http only for localhost).
  confirmationUrl: linkUrlSchema,
  callback_url: linkUrlSchema,
  frontend_url: linkUrlSchema,
  frontend_login_path: z.string().max(256).regex(/^(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/),
  login_path: z.string().max(256),
  jwt_token_expires_in: z.string().max(16).regex(/^[1-9]\d{0,5}[mhd]$/),
  user_creation_strategy: z.enum(['email', 'emailUsername', 'manual']),
  from_name: z.string().max(200),
  from_email: z.string().max(320).refine((value) => value === '' || EMAIL_REGEX.test(value)),
  response_email: z.string().max(320).refine((value) => value === '' || EMAIL_REGEX.test(value)),
  object: z.string().max(500),
  message_html: z.string().max(100_000),
  message_text: z.string().max(50_000),
  context_whitelist: z.array(z.string().max(128)).max(100).or(z.string().max(10_000)),
  context_blacklist: z.array(z.string().max(128)).max(100).or(z.string().max(10_000)),
  email_designer_template_id: z.string().max(128),
  magic_mail_template_id: z.string().max(128),
  totp_issuer: z.string().max(128),
  totp_algorithm: z.enum(['SHA1', 'SHA256', 'SHA512']),
  ui_language: z.enum(['de', 'en', 'es', 'fr', 'pt']),
};

const settingsRecordSchema = z
  .record(z.string().min(1).max(128), z.unknown())
  .superRefine((settings, ctx) => {
    const entries = Object.entries(settings);
    if (entries.length > 128) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many settings fields' });
    }

    for (const [key, value] of entries) {
      if (['__proto__', 'prototype', 'constructor', 'settings'].includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Unsupported settings field',
        });
        continue;
      }

      const fieldSchema = settingsFieldSchemas[key];
      if (fieldSchema && !fieldSchema.safeParse(value).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'Invalid setting value',
        });
      }
    }
  });

const settingsEnvelopeSchema = z.object({ settings: settingsRecordSchema }).strict();
const settingsUpdateSchema = z
  .union([settingsEnvelopeSchema, settingsRecordSchema])
  .transform((value) => ('settings' in value ? value.settings : value));

/**
 * Parses an input with a Zod schema and converts any error into a Strapi
 * ValidationError so the framework formats the response envelope correctly.
 * Empty/undefined bodies are coerced to `{}` so `.strict()` schemas can still
 * reject them with a useful message.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {unknown} input
 * @returns {any} Parsed, typed, normalized value
 * @throws {ValidationError}
 */
const parseBody = (schema, input) => {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.join('.') || '(root)';
    throw new ValidationError(`Invalid request body at '${path}': ${first.message}`);
  }
  return result.data;
};

module.exports = {
  sendLinkSchema,
  loginExchangeSchema,
  otpSendSchema,
  otpVerifySchema,
  otpResendSchema,
  mfaVerifyTotpSchema,
  loginWithTotpSchema,
  totpTokenOnlySchema,
  settingsUpdateSchema,
  parseBody,
};
