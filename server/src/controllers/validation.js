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

const { z } = require('zod');
const { errors } = require('@strapi/utils');

const { ValidationError } = errors;

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
    z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.record(z.any())])
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
  parseBody,
};
