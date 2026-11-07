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
const REMOVED_DELIVERY_MESSAGE =
  'Only e-mail delivery is supported; WhatsApp and SMS delivery were removed in 6.0.0';

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
      ctx.addIssue({
        code: 'custom',
        message: `context may contain at most ${LIMITS.maxKeys} keys`,
      });
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

// Backup codes are XXXX-XXXX-XXXX-XXXX; the service normalises case and dashes.
const backupCodeSchema = z.string().trim().min(16).max(32);
const deviceIdSchema = z.string().min(1).max(255).optional();

/**
 * Requires exactly one of totpCode / backupCode.
 *
 * @param {object} value - Parsed body.
 * @param {object} ctx - Zod refinement context.
 */
const exactlyOneSecondFactor = (value, ctx) => {
  const count = Number(Boolean(value.totpCode)) + Number(Boolean(value.backupCode));
  if (count !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['totpCode'],
      message: 'Send either totpCode or backupCode',
    });
  }
};

/** POST /verify-mfa-totp: the second factor after a magic link. */
const mfaVerifyTotpSchema = z
  .object({
    loginToken: tokenSchema,
    totpCode: codeSchema.optional(),
    backupCode: backupCodeSchema.optional(),
    deviceId: deviceIdSchema,
  })
  .strict()
  .superRefine(exactlyOneSecondFactor);

const loginWithTotpSchema = z
  .object({
    email: emailSchema,
    totpCode: codeSchema,
    deviceId: deviceIdSchema,
  })
  .strict();

/** Admin self-service TOTP routes (legacy body field name `token`). */
const totpTokenOnlySchema = z
  .object({
    token: codeSchema,
  })
  .strict();

const adminTotpSetupSchema = z
  .object({
    token: codeSchema.optional(),
  })
  .strict();

/** POST /totp/enroll: start authenticator enrolment during a login. */
const totpEnrollStartSchema = z
  .object({
    loginToken: tokenSchema,
  })
  .strict();

/** POST /totp/enroll/confirm: finish enrolment during a login. */
const totpEnrollConfirmSchema = z
  .object({
    loginToken: tokenSchema,
    totpCode: codeSchema,
    deviceId: deviceIdSchema,
  })
  .strict();

/** POST /totp/setup (authenticated end user). */
const totpSetupSchema = z
  .object({
    // Required by the controller when an authenticator is already active.
    totpCode: codeSchema.optional(),
  })
  .strict();

/** POST /totp/confirm (authenticated end user). */
const totpConfirmSchema = z
  .object({
    totpCode: codeSchema,
    emailCode: codeSchema,
  })
  .strict();

/** POST /totp/disable (authenticated end user). */
const totpDisableSchema = z
  .object({
    totpCode: codeSchema.optional(),
    backupCode: backupCodeSchema.optional(),
  })
  .strict()
  .superRefine(exactlyOneSecondFactor);

/** POST /totp/backup-codes (authenticated end user). */
const totpBackupCodesSchema = z
  .object({
    totpCode: codeSchema,
  })
  .strict();

/** GET /otp/codes (admin) query string. */
const otpCodesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(1_000).default(10),
    email: z.string().trim().max(320).optional(),
    type: z.enum(['email', 'totp-setup']).optional(),
    status: z.enum(['active', 'expired', 'used']).optional(),
  })
  .strict();

// ─────────────────────── Admin token, session and IP-ban APIs ───────────────────────

/** Admin-chosen link lifetime in hours (create form). Mirrors admin tokenModel TTL_LIMITS. */
const TOKEN_TTL_HOURS = Object.freeze({ min: 1, max: 720 });
/** Extension in days. Mirrors admin tokenModel EXTEND_LIMITS. */
const TOKEN_EXTEND_DAYS = Object.freeze({ min: 1, max: 365 });

/**
 * Admin context may arrive as an object or (5.x clients) a JSON string.
 * Either way it must satisfy the same policy as public context.
 */
const adminContextSchema = z
  .union([
    z
      .string()
      .max(LIMITS.maxJsonLength * 4)
      .transform((value, ctx) => {
        if (value.trim() === '') return {};
        try {
          const parsed = JSON.parse(value);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
          // reported below
        }
        ctx.addIssue({ code: 'custom', message: 'context must be a JSON object' });
        return z.NEVER;
      }),
    z.record(z.string(), z.unknown()),
  ])
  .pipe(contextSchema.unwrap())
  .optional();

/** POST /tokens (admin). */
const adminTokenCreateSchema = z
  .object({
    email: emailSchema,
    ttl: z.coerce.number().int().min(TOKEN_TTL_HOURS.min).max(TOKEN_TTL_HOURS.max).optional(),
    send_email: z.boolean().default(true),
    context: adminContextSchema,
  })
  .strict();

/** POST /tokens/:id/extend (admin). */
const adminTokenExtendSchema = z
  .object({
    days: z.coerce.number().int().min(TOKEN_EXTEND_DAYS.min).max(TOKEN_EXTEND_DAYS.max).default(7),
  })
  .strict();

/** Route parameter for token actions: documentId or numeric id. */
const tokenIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** GET /tokens (admin) query string. Without page/pageSize the newest 1000 tokens are returned. */
const adminTokenListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(1_000).optional(),
  })
  .strict();

/** POST /ban-ip and /unban-ip (admin): `{ data: { ip } }`. */
const ipBanSchema = z
  .object({
    data: z.object({ ip: z.string().trim().min(2).max(64) }).strict(),
  })
  .strict();

/**
 * GET /jwt-sessions (admin). All parameters are optional: without them the
 * newest records are returned as before. The body stays an array; the total
 * is sent in the `X-Total-Count` header.
 */
const jwtSessionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(1_000).optional(),
    status: z.enum(['all', 'active', 'revoked', 'expired']).optional(),
    userId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

/** POST /revoke-jwt (admin): exactly one of sessionId / token. */
const jwtRevokeSchema = z
  .object({
    sessionId: z.string().min(1).max(128).optional(),
    token: z.string().min(10).max(8_192).optional(),
    // 5.x clients sent the owner id; it is ignored (taken from the server record).
    userId: z.union([z.string().max(64), z.number()]).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.sessionId) !== Boolean(value.token), {
    message: 'Send either sessionId or token',
    path: ['sessionId'],
  });

/** POST /unrevoke-jwt (admin). */
const jwtUnrevokeSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    // Ignored; see jwtRevokeSchema.
    userId: z.union([z.string().max(64), z.number()]).optional(),
  })
  .strict();

/**
 * POST /reset-data (admin, settings.update). The explicit confirmation keeps
 * a stray request from wiping tokens, sessions and bans; `resetSecurity`
 * also resets the MFA settings (otherwise they are kept).
 */
const adminResetSchema = z
  .object({
    confirm: z.literal('RESET'),
    resetSecurity: z.boolean().default(false),
  })
  .strict();

/** POST /license/store-key (admin, settings.update). */
const licenseStoreKeySchema = z
  .object({
    licenseKey: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9-]+$/, 'Invalid license key format'),
    email: emailSchema,
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
  totp_digits: z
    .number()
    .int()
    .refine((value) => value === 6 || value === 8),
  totp_period: z.number().int().min(15).max(300),
  expire_period: z.number().int().min(10).max(31_536_000),
  // >= 22 URL-safe characters = 132 bits of entropy.
  token_length: z.number().int().min(22).max(128),
  // Login links may only point at https URLs (http only for localhost).
  confirmationUrl: linkUrlSchema,
  callback_url: linkUrlSchema,
  frontend_url: linkUrlSchema,
  frontend_login_path: z
    .string()
    .max(256)
    .regex(/^(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/),
  login_path: z.string().max(256),
  jwt_token_expires_in: z
    .string()
    .max(16)
    .regex(/^[1-9]\d{0,5}[mhd]$/),
  user_creation_strategy: z.enum(['email', 'emailUsername', 'manual']),
  from_name: z.string().max(200),
  from_email: z
    .string()
    .max(320)
    .refine((value) => value === '' || EMAIL_REGEX.test(value)),
  response_email: z
    .string()
    .max(320)
    .refine((value) => value === '' || EMAIL_REGEX.test(value)),
  object: z.string().max(500),
  message_html: z.string().max(100_000),
  message_text: z.string().max(50_000),
  context_whitelist: z.array(z.string().max(128)).max(100).or(z.string().max(10_000)),
  context_blacklist: z.array(z.string().max(128)).max(100).or(z.string().max(10_000)),
  email_designer_template_id: z.union([z.string().max(128), z.number().int().nonnegative()]),
  magic_mail_template_id: z.union([z.string().max(128), z.number().int().nonnegative()]),
  magic_mail_template_reference_id: z.string().max(128),
  rate_limit_login_max_attempts: z.number().int().min(1).max(1_000),
  rate_limit_login_window_minutes: z.number().int().min(1).max(10_080),
  rate_limit_login_block_minutes: z.number().int().min(1).max(10_080),
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

/** Keys a settings update may persist. Anything else is dropped, never stored. */
const SETTINGS_KEYS = Object.freeze(Object.keys(settingsFieldSchemas));
const CONTEXT_LIST_KEYS = ['context_whitelist', 'context_blacklist'];

/**
 * Keeps only known settings keys and turns comma/newline separated context
 * lists into arrays, so every consumer sees one shape.
 *
 * @param {object} settings - Validated settings patch.
 * @returns {object} Patch that is safe to persist.
 */
const toKnownSettings = (settings) => {
  const known = {};
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) known[key] = settings[key];
  }
  for (const key of CONTEXT_LIST_KEYS) {
    if (typeof known[key] === 'string') {
      known[key] = known[key]
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 100)
        .map((entry) => entry.slice(0, 128));
    }
  }
  return known;
};

// `acknowledgeNoEnrolledUsers` confirms switching MFA to `required` while no
// end user has an authenticator yet (users then enrol during their next login).
// It is read by controller.updateSettings and never stored.
const settingsEnvelopeSchema = z
  .object({ settings: settingsRecordSchema, acknowledgeNoEnrolledUsers: z.boolean().optional() })
  .strict();
const settingsUpdateSchema = z
  .union([settingsEnvelopeSchema, settingsRecordSchema])
  .transform((value) => toKnownSettings('settings' in value ? value.settings : value));

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
  adminTotpSetupSchema,
  totpEnrollStartSchema,
  totpEnrollConfirmSchema,
  totpSetupSchema,
  totpConfirmSchema,
  totpDisableSchema,
  totpBackupCodesSchema,
  otpCodesQuerySchema,
  adminTokenCreateSchema,
  adminTokenExtendSchema,
  adminTokenListQuerySchema,
  tokenIdSchema,
  ipBanSchema,
  jwtRevokeSchema,
  jwtSessionsQuerySchema,
  jwtUnrevokeSchema,
  licenseStoreKeySchema,
  adminResetSchema,
  settingsUpdateSchema,
  SETTINGS_KEYS,
  TOKEN_TTL_HOURS,
  TOKEN_EXTEND_DAYS,
  parseBody,
};
