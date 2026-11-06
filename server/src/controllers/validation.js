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
const phoneSchema = z.string().trim().min(4).max(32).optional();
const usernameSchema = z.string().trim().min(1).max(128).optional();
const deliverySchema = z.enum(['email', 'whatsapp']).optional();

// Context from clients: bounded records, no functions / arbitrary objects.
const contextSchema = z
  .record(
    z.string().max(128),
    z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.record(z.string(), z.any())])
  )
  .optional();

const sendLinkSchema = z
  .object({
    email: emailSchema.optional(),
    username: usernameSchema,
    phoneNumber: phoneSchema,
    phone: phoneSchema,
    context: contextSchema,
    delivery: deliverySchema,
    via: deliverySchema,
  })
  .strict()
  .refine((v) => !!v.email || !!v.phoneNumber || !!v.phone, {
    message: 'Either email or phoneNumber is required',
  })
  .refine((v) => ![v.delivery, v.via].includes('whatsapp') || !!v.phoneNumber || !!v.phone, {
    message: 'A phone number is required for WhatsApp delivery',
  });

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
  })
  .strict();

const loginWithTotpSchema = z
  .object({
    email: emailSchema,
    totpCode: codeSchema,
  })
  .strict();

const totpTokenOnlySchema = z
  .object({
    token: codeSchema,
  })
  .strict();

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
  otp_type: z.enum(['email', 'sms', 'totp']),
  mfa_mode: z.enum(['disabled', 'optional', 'required']),
  otp_length: z.number().int().min(4).max(16),
  otp_expiry: z.number().int().min(30).max(86_400),
  otp_max_attempts: z.number().int().min(1).max(20),
  otp_resend_cooldown: z.number().int().min(0).max(86_400),
  rate_limit_max_attempts: z.number().int().min(1).max(1_000),
  rate_limit_window_minutes: z.number().int().min(1).max(10_080),
  totp_digits: z.number().int().refine((value) => value === 6 || value === 8),
  totp_period: z.number().int().min(15).max(300),
  sms_provider: z.string().max(128).nullable(),
  sms_api_key: z.string().max(4_096),
  sms_api_secret: z.string().max(4_096),
  sms_from_number: z.string().max(128),
  expire_period: z.number().int().min(10).max(31_536_000),
  token_length: z.number().int().min(5).max(512),
  max_login_attempts: z.number().int().min(1).max(1_000),
  confirmationUrl: z.string().max(2_048),
  callback_url: z.string().max(2_048),
  frontend_url: z.string().max(2_048),
  frontend_login_path: z.string().max(256),
  login_path: z.string().max(256),
  jwt_token_expires_in: z.string().max(16).regex(/^\d+[dh]$/),
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
  otpSendSchema,
  otpVerifySchema,
  otpResendSchema,
  mfaVerifyTotpSchema,
  loginWithTotpSchema,
  totpTokenOnlySchema,
  settingsUpdateSchema,
  parseBody,
};
