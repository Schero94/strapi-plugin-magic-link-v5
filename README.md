# Magic Link for Strapi 5

Passwordless login for Strapi 5. Users type their e-mail address, click the link in their inbox and are signed in with a normal users-permissions session. Optional second factors: an e-mailed one-time code (OTP) or an authenticator app (TOTP) with backup codes.

[![npm version](https://img.shields.io/npm/v/strapi-plugin-magic-link-v5.svg)](https://www.npmjs.com/package/strapi-plugin-magic-link-v5)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Strapi 5](https://img.shields.io/badge/Strapi-5.24%2B-4945FF.svg)](https://strapi.io)

**Project site:** [schero94.github.io/strapi-plugin-magic-link-v5](https://schero94.github.io/strapi-plugin-magic-link-v5/)

![Token dashboard](pics/token-dashboard.png)

## Contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Frontend integration](#frontend-integration)
- [Second factors: e-mail OTP, TOTP and backup codes](#second-factors-e-mail-otp-totp-and-backup-codes)
- [Refresh mode (users-permissions sessions)](#refresh-mode-users-permissions-sessions)
- [Public API](#public-api)
- [Admin API](#admin-api)
- [Permissions](#permissions)
- [Configuration reference](#configuration-reference)
- [E-mail templates](#e-mail-templates)
- [Security model](#security-model)
- [Running behind a proxy or in a cluster](#running-behind-a-proxy-or-in-a-cluster)
- [Migrating from strapi-plugin-passwordless](#migrating-from-strapi-plugin-passwordless)
- [Troubleshooting](#troubleshooting)
- [Upgrading from 5.x to 6.0.0](#upgrading-from-5x-to-600)
- [Languages, license and support](#languages-license-and-support)

## What you get

- **Magic links by e-mail.** One API call sends the link. Your landing page exchanges it for a JWT, the same session the native `/api/auth/local` login creates.
- **Optional second factors.**
  - E-mail OTP after the link click.
  - Authenticator apps (TOTP) as optional or required MFA, including enrolment during sign-in, self-service for logged-in users and one-time backup codes.
  - TOTP-only login.
- **Built for production.**
  - Links are hashed and single-use, and a link is consumed atomically.
  - Rate limits apply per IP and per address.
  - IP bans, a JWT session list with revocation, and an audit-friendly admin API.
- **Works with your stack.** Users & Permissions (legacy JWTs and refresh-token sessions), the Strapi e-mail plugin, Magic Mail, Email Designer 5, and a `strapi-plugin-passwordless` compatibility mode.
- **Admin panel.**
  - Pages for tokens, OTP codes, JWT sessions, IP bans, settings and license.
  - Light and dark mode, translated into English, German, French, Spanish and Portuguese.
  - Fine-grained RBAC.

Magic Link is **e-mail only**. WhatsApp and SMS delivery were removed in 6.0.0.

## Requirements

| Component           | Version                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Strapi              | 5.24.0 or newer (tested on 5.61.0). Use 5.33.3+ if you enable refresh mode.              |
| Node.js             | 22 to 26 (the range Strapi 5.61 supports)                                                |
| Users & Permissions | Installed (default in Strapi 5)                                                          |
| E-mail              | A configured Strapi e-mail provider, or Magic Mail                                       |
| Environment         | `MAGIC_LINK_ENCRYPTION_KEY` and `MAGIC_LINK_OTP_PEPPER`, 32+ characters each (see below) |

## Quick start (5 minutes)

### 1. Install

```bash
npm install strapi-plugin-magic-link-v5
```

### 2. Set the two required secrets

The plugin refuses to start without them, also in development:

```bash
# .env, generate each value with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
MAGIC_LINK_ENCRYPTION_KEY=<64 hex characters>
MAGIC_LINK_OTP_PEPPER=<64 hex characters>
```

For a throwaway local setup you can set `MAGIC_LINK_ALLOW_DEV_SECRETS=true` instead. It is ignored when `NODE_ENV=production`.

### 3. Configure e-mail

Any Strapi e-mail provider works. Example with Nodemailer in `config/plugins.js`:

```js
module.exports = ({ env }) => ({
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST'),
        port: env.int('SMTP_PORT', 587),
        auth: { user: env('SMTP_USERNAME'), pass: env('SMTP_PASSWORD') },
      },
      settings: {
        defaultFrom: 'login@example.com',
        defaultReplyTo: 'support@example.com',
      },
    },
  },
});
```

### 4. Build, start and point links at your frontend

```bash
npm run build && npm run develop
```

In the admin panel, open **Settings > Magic Link > Settings > General**:

- **Frontend base URL**: `https://app.example.com`
- **Frontend login path**: `/auth/magic-link`

Links now look like `https://app.example.com/auth/magic-link?loginToken=...`. URLs must use `https`; `http` is accepted only for `localhost`.

### 5. Send your first link

```bash
curl -X POST http://localhost:1337/api/magic-link/send-link \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com"}'
```

```json
{ "email": "ada@example.com", "username": null, "sent": true, "delivery": "email" }
```

The answer is the same whether or not the account exists, so it cannot be used to discover users. By default only existing users get a link; see [auto-registration](#auto-registration) to create accounts on first login.

The public routes need no role configuration. They are open by design and protected by rate limits and IP bans.

## Frontend integration

Your landing page receives `?loginToken=...`, sends it to Strapi with **POST** (so it never appears in access logs, caches or `Referer` headers), and then reacts to the answer.

```js
// /auth/magic-link page, framework-agnostic
const API = 'https://api.example.com/api/magic-link';

async function post(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // only needed for the httpOnly refresh cookie
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error?.message), { data });
  return data;
}

export async function completeMagicLink() {
  const loginToken = new URLSearchParams(location.search).get('loginToken');
  history.replaceState(null, '', location.pathname); // drop the token from the address bar

  const result = await post('/login', { loginToken });

  if (result.requiresOTP) {
    // An e-mailed code is required. Ask the user for it, then:
    const code = await askUser('Enter the code from your e-mail');
    return post('/otp/verify', { email: result.email, code, magicLinkToken: result.loginToken });
  }

  if (result.requiresTOTP) {
    // The user has an authenticator. A backup code works too: { loginToken, backupCode }
    const totpCode = await askUser('Enter the code from your authenticator app');
    return post('/verify-mfa-totp', { loginToken: result.loginToken, totpCode });
  }

  if (result.requiresTOTPSetup) {
    // MFA is required and the user has no authenticator yet: enrol now.
    const { data } = await post('/totp/enroll', { loginToken: result.loginToken });
    showQrCode(data.qrCode); // data URL; data.secret for manual entry
    const totpCode = await askUser('Scan the QR code and enter the code');
    const session = await post('/totp/enroll/confirm', { loginToken: result.loginToken, totpCode });
    showBackupCodesOnce(session.backupCodes);
    return session;
  }

  return result; // { jwt, user, context, expires_at, refreshToken? }
}
```

Store `jwt` like any users-permissions JWT and send it as `Authorization: Bearer <jwt>`.

`GET /api/magic-link/login?loginToken=...` still works. You can point `confirmationUrl` straight at it, but the token then ends up in server logs, so prefer the POST exchange.

### Where the link points

The link builder uses the first match:

1. `frontend_url` + `frontend_login_path` (recommended)
2. `confirmationUrl`
3. `<server.url><api prefix>/magic-link/login` (the API route itself)

Existing query strings are kept and `loginToken` is appended.

### Passing context through the link

`send-link` accepts a small `context` object, for example `{ "redirectTo": "/billing" }`. It comes back in the login response. Rules:

- at most 20 keys;
- the `context_whitelist` / `context_blacklist` settings apply;
- reserved keys that carry authentication state (`otpVerified`, `mfaVerified`, `userId`, `exp`, ...) are rejected with 400.

## Second factors: e-mail OTP, TOTP and backup codes

Choose the mode in **Settings > Magic Link > Settings > Sign-in modes and MFA**.

| Mode                  | Setting                      | What the user does after clicking the link                  |
| --------------------- | ---------------------------- | ----------------------------------------------------------- |
| Link only             | defaults                     | Nothing, the link logs them in                              |
| Link + e-mail OTP     | `otp_enabled: true`          | Enters a 6-digit code sent in a second e-mail               |
| Link + TOTP, optional | `mfa_mode: "optional"`       | Users with an authenticator enter a code; others log in     |
| Link + TOTP, required | `mfa_mode: "required"`       | Everyone enters a code; users without one enrol on the spot |
| TOTP only             | `totp_as_primary_auth: true` | Calls `POST /login-totp { email, totpCode }`, no e-mail     |

A user with an active authenticator always gets the TOTP step, even when e-mail OTP is also enabled.

### Authenticator self-service for logged-in users

These routes use the users-permissions JWT. Grant the **Magic-link > totp** actions (`status`, `setup`, `confirm`, `disable`, `backupCodes`) to the **Authenticated** role in _Settings > Users & Permissions > Roles_.

```js
const auth = { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' };

// 1. Start: returns the QR code and e-mails a confirmation code.
//    With an active authenticator, also send { totpCode } from the current app.
const { data } = await fetch(`${API}/totp/setup`, {
  method: 'POST',
  headers: auth,
  body: '{}',
}).then((r) => r.json());
// data: { qrCode, secret, otpauthUrl, algorithm, digits, period, expiresAt, emailCodeSent: true }

// 2. Confirm with a code from the app AND the e-mailed code.
await fetch(`${API}/totp/confirm`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ totpCode, emailCode }),
});
// { data: { enabled: true, backupCodes: [10 codes, shown once] } }

// Status, new backup codes (needs a current code), remove (TOTP or backup code)
await fetch(`${API}/totp/status`, { headers: auth });
await fetch(`${API}/totp/backup-codes`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ totpCode }),
});
await fetch(`${API}/totp/disable`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ totpCode }),
});
```

A stolen JWT alone cannot add, replace or remove an authenticator:

- Setup needs the e-mailed code.
- Re-setup and new backup codes need a current TOTP code.
- Removal needs a TOTP code or a backup code.

### Backup codes

- Ten 16-character codes (`XXXX-XXXX-XXXX-XXXX`), shown once.
- Stored as keyed hashes bound to their owner.
- Each code works once wherever a TOTP code is accepted after a magic link (`backupCode` instead of `totpCode`).
- The response reports `backupCodesRemaining`.

Algorithm, digits and period are stored with each enrolment, so changing the TOTP settings only affects new enrolments. Each accepted time step is recorded, so a code cannot be replayed.

## Refresh mode (users-permissions sessions)

With `jwtManagement: 'refresh'` in the users-permissions config, Magic Link logins behave exactly like `/api/auth/local`:

```js
// config/plugins.js
module.exports = {
  'users-permissions': {
    config: {
      jwtManagement: 'refresh',
      sessions: { accessTokenLifespan: 600, maxRefreshTokenLifespan: 1209600, httpOnly: false },
    },
  },
};
```

- The response contains a short-lived `jwt` and a `refreshToken`. With `sessions.httpOnly: true`, or the request header `x-strapi-refresh-cookie: httpOnly`, the refresh token is set as an httpOnly cookie instead.
- Renew with the native `POST /api/auth/refresh`.
- Revoking a session in **Magic Link > JWT Sessions** also revokes the users-permissions session.

In the default `legacy-support` mode the JWT lifetime comes from the plugin setting `jwt_token_expires_in` (for example `15m`, `12h`, `30d`).

## Public API

All routes are under `/api/magic-link`. Errors use the Strapi envelope with a stable key:

```json
{
  "data": null,
  "error": {
    "status": 400,
    "name": "ValidationError",
    "message": "Invalid or expired login link",
    "key": "token.invalid",
    "details": { "key": "token.invalid" }
  }
}
```

Messages are translated (`en`, `de`, `fr`, `es`, `pt`) from `?locale=` or `Accept-Language`. A rate-limited request gets `429` with `details.retryAfter` in seconds.

| Method | Path                   | Auth              | Body                                                       | Success response                                                                 |
| ------ | ---------------------- | ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `POST` | `/send-link`           | none              | `{ email, username?, context?, delivery? }`                | `{ email, username, sent: true, delivery: "email" }`                             |
| `POST` | `/login`               | none              | `{ loginToken }`                                           | session, or a challenge (`requiresOTP`, `requiresTOTP`, `requiresTOTPSetup`)     |
| `GET`  | `/login?loginToken=`   | none              | (query)                                                    | same as `POST /login`                                                            |
| `POST` | `/otp/send`            | none              | `{ email, magicLinkToken }`                                | `{ success, message, expiresIn, type: "email" }`                                 |
| `POST` | `/otp/resend`          | none              | `{ email, magicLinkToken }`                                | same as `/otp/send`, after `otp_resend_cooldown`                                 |
| `POST` | `/otp/verify`          | none              | `{ email, code, magicLinkToken }`                          | session with `otpVerified: true`                                                 |
| `POST` | `/verify-mfa-totp`     | none              | `{ loginToken, totpCode }` or `{ loginToken, backupCode }` | session with `mfaVerified: true`                                                 |
| `POST` | `/login-totp`          | none              | `{ email, totpCode }`                                      | session with `loginMethod: "totp"` (TOTP-only mode)                              |
| `POST` | `/totp/enroll`         | none (loginToken) | `{ loginToken }`                                           | `{ data: { qrCode, secret, otpauthUrl, algorithm, digits, period, expiresAt } }` |
| `POST` | `/totp/enroll/confirm` | none (loginToken) | `{ loginToken, totpCode }`                                 | session plus `backupCodes`                                                       |
| `GET`  | `/totp/status`         | users-permissions |                                                            | `{ data: { enabled, ..., mfaMode } }`                                            |
| `POST` | `/totp/setup`          | users-permissions | `{}` or `{ totpCode }` when already enrolled               | `{ data: { qrCode, secret, ..., emailCodeSent: true } }`                         |
| `POST` | `/totp/confirm`        | users-permissions | `{ totpCode, emailCode }`                                  | `{ data: { enabled: true, backupCodes } }`                                       |
| `POST` | `/totp/disable`        | users-permissions | `{ totpCode }` or `{ backupCode }`                         | `{ data: { enabled: false } }`                                                   |
| `POST` | `/totp/backup-codes`   | users-permissions | `{ totpCode }`                                             | `{ data: { backupCodes } }`                                                      |

Unknown body fields are rejected with 400. `phoneNumber`, `phone`, `via` and any `delivery` other than `"email"` return a clear "only e-mail delivery is supported" error.

**Session response** (every successful login):

```json
{
  "jwt": "eyJhbGciOi...",
  "user": {
    "id": 7,
    "documentId": "abc123",
    "username": "ada",
    "email": "ada@example.com",
    "confirmed": true,
    "blocked": false
  },
  "context": { "redirectTo": "/billing" },
  "expires_at": "2026-12-07T10:00:00.000Z",
  "refreshToken": "only in refresh mode"
}
```

The user object passes Strapi's content-API sanitizer, so private fields are never returned. With `use_jwt_token: false` no token is minted and the body carries `jwtIssued: false`.

**Challenge responses** from `/login`:

```json
{ "requiresOTP": true, "email": "ada@example.com", "loginToken": "...", "expiresIn": 300 }
{ "requiresTOTP": true, "email": "ada@example.com", "loginToken": "..." }
{ "requiresTOTPSetup": true, "email": "ada@example.com", "loginToken": "...", "enrollEndpoint": "/api/magic-link/totp/enroll" }
```

## Admin API

Admin routes live under `/magic-link` on the admin server. They require an admin JWT and the listed plugin permission. They are what the admin pages call; you rarely need them directly.

| Method   | Path                                  | Permission        | Purpose                                                                       |
| -------- | ------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `GET`    | `/magic-link/tokens`                  | `read`            | Newest 1000 tokens, or `?page=&pageSize=` (max 1000)                          |
| `POST`   | `/magic-link/tokens`                  | `manage`          | Create a link: `{ email, ttl?, send_email?, context? }` (ttl in hours, 1-720) |
| `POST`   | `/magic-link/tokens/:id/block`        | `manage`          | Deactivate a link                                                             |
| `POST`   | `/magic-link/tokens/:id/activate`     | `manage`          | Re-activate (refused for used single-use or expired links)                    |
| `POST`   | `/magic-link/tokens/:id/extend`       | `manage`          | `{ days }`, 1-365                                                             |
| `DELETE` | `/magic-link/tokens/:id`              | `manage`          | Delete a link                                                                 |
| `GET`    | `/magic-link/jwt-sessions`            | `read`            | Sessions issued by Magic Link                                                 |
| `POST`   | `/magic-link/revoke-jwt`              | `manage`          | `{ sessionId }` or `{ token }`                                                |
| `POST`   | `/magic-link/unrevoke-jwt`            | `manage`          | `{ sessionId }` (not for refresh-mode sessions)                               |
| `POST`   | `/magic-link/cleanup-sessions`        | `manage`          | Remove expired session records                                                |
| `GET`    | `/magic-link/banned-ips`              | `read`            | List bans                                                                     |
| `POST`   | `/magic-link/ban-ip`                  | `manage`          | `{ data: { ip } }`                                                            |
| `POST`   | `/magic-link/unban-ip`                | `manage`          | `{ data: { ip } }`                                                            |
| `GET`    | `/magic-link/otp/codes`               | `read`            | `?page=&pageSize=&email=&type=` (pageSize max 100 in the UI)                  |
| `DELETE` | `/magic-link/otp/codes/:id`           | `manage`          | Delete one code                                                               |
| `POST`   | `/magic-link/otp/cleanup`             | `manage`          | Remove expired codes                                                          |
| `GET`    | `/magic-link/settings`                | `settings.read`   | Read settings                                                                 |
| `PUT`    | `/magic-link/settings`                | `settings.update` | Save settings (only known keys, validated)                                    |
| `POST`   | `/magic-link/reset-data`              | `settings.update` | Restore default settings                                                      |
| `GET`    | `/magic-link/rate-limit/stats`        | `settings.read`   | Limiter statistics                                                            |
| `POST`   | `/magic-link/rate-limit/cleanup`      | `settings.update` | Drop expired limiter entries                                                  |
| `POST`   | `/magic-link/rate-limit/reset`        | `settings.update` | Reset all limits                                                              |
| `GET`    | `/magic-link/totp/enrollment-summary` | `settings.read`   | `{ data: { enrolled, enrollmentDuringLogin } }`                               |
| `GET`    | `/magic-link/license/status`          | `settings.read`   | License state; full key only with `settings.update`                           |
| `POST`   | `/magic-link/license/store-key`       | `settings.update` | Save a license key                                                            |
| `GET`    | `/magic-link/otp/totp/status`         | `read`            | The calling admin's own authenticator                                         |
| `POST`   | `/magic-link/otp/totp/setup`          | `read`            | Start setup (`{ token }` when one is active)                                  |
| `POST`   | `/magic-link/otp/totp/verify`         | `read`            | Confirm setup, returns backup codes                                           |
| `POST`   | `/magic-link/otp/totp/disable`        | `read`            | `{ token }`                                                                   |
| `POST`   | `/magic-link/otp/totp/backup-codes`   | `read`            | `{ token }`                                                                   |

**Creating a link without sending it** (`send_email: false`) returns `token` and `loginUrl` once, which lets the admin log in as that user. It therefore also needs the separate `tokens.issue` permission. Admin creation is limited to 60 per admin per 15 minutes.

## Permissions

### Admin roles (Settings > Administration Panel > Roles > Plugins > Magic Link)

| Action                               | Grants                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `plugin::magic-link.read`            | Menu entry and Tokens page: tokens, OTP codes, JWT sessions, IP bans     |
| `plugin::magic-link.manage`          | Create, block, extend, delete tokens; revoke sessions; ban IPs; cleanups |
| `plugin::magic-link.tokens.issue`    | Create links without e-mail (impersonation). Grant sparingly.            |
| `plugin::magic-link.settings.read`   | Settings and License pages                                               |
| `plugin::magic-link.settings.update` | Save settings, rate-limit actions, license changes                       |

The server enforces these on every route; the admin pages hide what a role cannot do. Super Admin has all of them.

### Users & Permissions roles

- **Public:** nothing to grant. The login routes are public (`auth: false`) and protected by rate limits and IP bans.
- **Authenticated:** grant the **Magic-link > totp** actions if users should manage their authenticator themselves.

## Configuration reference

### Settings (admin panel)

Stored in the plugin store and edited in **Settings > Magic Link > Settings**. Unknown keys are ignored.

| Key                                                           | Default                         | Meaning                                                               |
| ------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `enabled`                                                     | `true`                          | Master switch                                                         |
| `expire_period`                                               | `3600`                          | Link lifetime in seconds (10 to 31536000)                             |
| `token_length`                                                | `32`                            | Link token length, 22 to 128 characters                               |
| `stays_valid`                                                 | `false`                         | Allow a link to be used more than once until it expires               |
| `frontend_url`, `frontend_login_path`                         | `''`, `/auth/magic-link`        | Landing page for links (https; http only for localhost)               |
| `confirmationUrl`                                             | `''`                            | Alternative link target when no frontend URL is set                   |
| `createUserIfNotExists`                                       | `true`                          | Allow auto-registration (needs the next two as well)                  |
| `allow_magic_links_on_public_registration`                    | `false`                         | Send links to unknown addresses and create the account on first login |
| `user_creation_strategy`                                      | `email`                         | `email`, `emailUsername` or `manual` username for new accounts        |
| `use_jwt_token`, `jwt_token_expires_in`                       | `true`, `30d`                   | Issue a JWT; lifetime in legacy mode (`15m`, `12h`, `30d`)            |
| `store_login_info`                                            | `true`                          | Record IP address and user agent on the token                         |
| `context_whitelist`, `context_blacklist`                      | `[]`, `[password, ...]`         | Context keys allowed or always removed                                |
| `from_name`, `from_email`, `response_email`                   | see admin                       | Sender; an empty `from_email` uses the e-mail plugin `defaultFrom`    |
| `object`, `message_html`, `message_text`                      | built-in template               | Subject and bodies, see [E-mail templates](#e-mail-templates)         |
| `use_magic_mail`, `magic_mail_template_id`                    | `false`                         | Send through Magic Mail                                               |
| `use_email_designer`, `email_designer_template_id`            | `false`                         | Send through Email Designer 5                                         |
| `otp_enabled`                                                 | `false`                         | E-mail OTP after the link                                             |
| `otp_length`, `otp_expiry`                                    | `6`, `300`                      | Code length (4 to 16) and lifetime in seconds                         |
| `otp_max_attempts`, `otp_resend_cooldown`                     | `3`, `60`                       | Attempts per code; seconds before a resend                            |
| `otp_strict_binding`                                          | `true`                          | OTP routes need the `magicLinkToken` from `/login`. Keep it on.       |
| `mfa_mode`                                                    | `disabled`                      | `disabled`, `optional` or `required` TOTP after the link              |
| `totp_as_primary_auth`                                        | `false`                         | Enable `POST /login-totp`                                             |
| `totp_issuer`, `totp_algorithm`, `totp_digits`, `totp_period` | `Magic Link`, `SHA1`, `6`, `30` | Defaults for new enrolments                                           |
| `rate_limit_enabled`                                          | `true`                          | Rate limiting on the public routes                                    |
| `rate_limit_max_attempts`, `rate_limit_window_minutes`        | `5`, `15`                       | Requests per IP and per address in the window                         |
| `passwordlessCompatibility`                                   | `false`                         | Serve `/api/passwordless/*`                                           |

### Plugin config (`config/plugins.js`)

```js
module.exports = ({ env }) => ({
  'magic-link': {
    config: {
      // Shared rate limits for several Strapi instances (rate-limiter-flexible Redis store).
      rateLimit: { redis: { storeClient: redisClient, useRedisPackage: true } },
      // Disable all calls to the license server.
      license: { remoteLookup: false },
    },
  },
});
```

### Environment variables

| Variable                             | Required | Purpose                                                       |
| ------------------------------------ | -------- | ------------------------------------------------------------- |
| `MAGIC_LINK_ENCRYPTION_KEY`          | yes      | AES-256-GCM key for TOTP secrets, 32+ characters              |
| `MAGIC_LINK_OTP_PEPPER`              | yes      | Key for OTP code hashes and backup-code HMACs, 32+ characters |
| `MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS` | no       | Old key during rotation; secrets are re-encrypted at startup  |
| `MAGIC_LINK_ALLOW_DEV_SECRETS`       | no       | `true` allows derived development secrets outside production  |
| `MAGIC_LINK_LICENSE_LOOKUP`          | no       | `false` disables license-server calls                         |

**Rotating the encryption key:**

1. Put the new key in `MAGIC_LINK_ENCRYPTION_KEY` and the old one in `MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS`.
2. Restart Strapi. TOTP secrets are re-encrypted at startup.
3. Remove `MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS`.

Changing the pepper only invalidates pending e-mail codes and backup codes.

### Auto-registration

An unknown address gets an account only when all three are on:

- `createUserIfNotExists`
- `allow_magic_links_on_public_registration`
- users-permissions **Enable sign-ups** (`allow_register`)

New accounts start unconfirmed and are confirmed by their first magic-link login. If a username is already taken, a random suffix is added.

## E-mail templates

Subject, HTML and text bodies use `{{PLACEHOLDER}}` syntax. Values are HTML-escaped in the HTML body, and no template code is ever executed. The admin preview and real e-mails use the same renderer.

| Placeholder       | Value                                       |
| ----------------- | ------------------------------------------- |
| `{{LOGIN_URL}}`   | Full login link including the token         |
| `{{URL}}`         | Link target without the token               |
| `{{CODE}}`        | The login token on its own                  |
| `{{EXPIRY_TEXT}}` | Human-readable lifetime, such as "1 hour"   |
| `{{EXPIRES_AT}}`  | Expiry as an ISO date                       |
| `{{EMAIL}}`       | Recipient address                           |
| `{{USER}}`        | Username, or the address when there is none |

Templates from 5.x that use `<%= URL %>?loginToken=<%= CODE %>` are converted to `{{LOGIN_URL}}` at startup. Any other `<% ... %>` block is printed as plain text.

**Magic Mail and Email Designer 5** receive these variables: `magicLink`, `loginUrl`, `url`, `code`, `token`, `email`, `expiryText`, `expiresAt`, `user.email`, `user.username`. Choose the template in **Settings > E-mail**. If the provider fails, the plugin falls back to the Strapi e-mail plugin.

## Security model

- **Links**
  - Tokens have 132 or more bits of entropy and are stored salted and hashed.
  - A single-use link is consumed with a conditional update, so parallel clicks yield exactly one session.
  - Links expire after `expire_period`.
- **No account discovery.** `send-link` answers before any lookup or delivery: identical body, identical timing.
- **Server-side challenge state.**
  - Second-factor progress lives in a private token field, never in client-supplied context.
  - Reserved context keys are rejected.
  - Public and admin context pass the same allow/deny policy.
- **Second factors**
  - OTP attempts are counted atomically before the comparison.
  - Every accepted TOTP time step is recorded, so a code cannot be replayed.
  - TOTP secrets are encrypted with AES-256-GCM.
  - Backup codes are owner-bound HMACs.
  - Admin and end-user authenticators live in separate namespaces (`admin:<id>`, `up:<id>`).
- **Sessions**
  - The JWT lifetime is honoured, and a revoked token stays blocked until it would have expired.
  - In refresh mode, revocation also deletes the users-permissions session.
  - The `Authorization` header is parsed like users-permissions does it, and the revocation check fails closed (503) for API requests.
- **Transport and logs**
  - Login responses send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
  - Plugin logs contain no e-mail addresses, tokens or URLs with tokens.
- **Admin**
  - RBAC is enforced server-side on every route.
  - Impersonation needs its own permission.
  - The license key is masked for readers.
- **Templates.** Placeholder rendering only; there is no code execution.

Report vulnerabilities privately through [GitHub security advisories](https://github.com/Schero94/strapi-plugin-magic-link-v5/security/advisories/new).

## Running behind a proxy or in a cluster

Rate limits and IP bans need the real client IP. Behind nginx, Caddy, Traefik, a load balancer or a CDN, configure `config/server.js`:

```js
module.exports = ({ env }) => ({
  url: env('PUBLIC_URL', 'https://api.example.com'),
  proxy: { koa: true, maxIpsCount: 1 }, // number of proxies in front of Strapi
});
```

Without `maxIpsCount`, clients can spoof `X-Forwarded-For`. The plugin logs a warning at startup when `proxy.koa` is on and `maxIpsCount` is missing.

**Several instances:**

- Limits are in memory by default. For shared limits, set `rateLimit.redis` in the plugin config.
- The session list, the JWT blocklist and the ban list are stored in the plugin store. Writes are serialised within one process only, so concurrent writes from several instances can still overwrite each other.

## Migrating from strapi-plugin-passwordless

1. Install Magic Link and remove `strapi-plugin-passwordless`.
2. Enable **Passwordless compatibility** in **Settings > Advanced**.
3. Your existing calls to `POST /api/passwordless/send-link` and `GET /api/passwordless/login?loginToken=` keep working. They are rewritten to the Magic Link routes and honour `api.rest.prefix`.

When the setting is off, those paths are passed on to Strapi untouched.

## Troubleshooting

| Symptom                                                | Fix                                                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Strapi does not start: "MAGIC_LINK_ENCRYPTION_KEY ..." | Set both secrets (32+ characters) or `MAGIC_LINK_ALLOW_DEV_SECRETS=true` locally                                                         |
| `send-link` says sent but no e-mail arrives            | The address has no account (and auto-registration is off), or the e-mail provider failed. Check the Strapi log for `[magic-link]` lines. |
| Link opens but answers `token.invalid`                 | The link expired, was already used, was blocked, or the token was cut off by the mail client                                             |
| Settings refuse my URL                                 | Use `https://` (http only for `localhost`)                                                                                               |
| Everyone shares one rate limit / bans hit the proxy    | Configure `server.proxy` (see above)                                                                                                     |
| 403 `IP_ADDRESS_BLOCKED`                               | The IP is banned. Unban it in **Magic Link > IP Bans**.                                                                                  |
| 400 "Only e-mail delivery is supported"                | Remove `phoneNumber`, `phone`, `via` and non-e-mail `delivery` from the request                                                          |
| Users cannot reach `/totp/status` (403)                | Grant the **totp** actions to the Authenticated role                                                                                     |
| Admins see no Magic Link menu after upgrading          | Grant **Read** (and **Manage**) to their role; see the upgrade guide                                                                     |

## Upgrading from 5.x to 6.0.0

6.0.0 is a major release focused on security. Work through this list:

1. **Runtime.** Node.js 22+ and Strapi 5.24.0+.
2. **Secrets.** Set `MAGIC_LINK_ENCRYPTION_KEY` and `MAGIC_LINK_OTP_PEPPER` (32+ characters each). If your old encryption key was shorter, or you relied on the development fallback, put the old value in `MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS` for the first start. For the old fallback that value is your `ADMIN_JWT_SECRET`.
3. **E-mail only.** Remove WhatsApp/SMS fields from `send-link` calls. Delete a leftover `.whatsapp-auth` folder from releases up to 5.2.x.
4. **Admin roles.** `access` became `read`, `manage`, `settings.read` and `settings.update`, plus `tokens.issue` for impersonation.
   - On startup, roles holding `access` get **Read** and **Manage** automatically.
   - Check each role, and grant **Settings > Read** to roles that used the License page.
5. **Frontend.**
   - Exchange the token with `POST /login { loginToken }`.
   - Handle `requiresTOTPSetup` if you use required MFA.
   - Read `expires_at` instead of the removed `expiry_formatted`.
   - Read errors from `error.key`.
6. **Templates.** Replace JavaScript in templates with `{{PLACEHOLDERS}}`. Plain `<%= VAR %>` placeholders are converted automatically.
7. **URLs.** `frontend_url`, `confirmationUrl` and `callback_url` must be `https` (http only for localhost).
8. **Tokens.** `token_length` is now 22 to 128. Unhashed links from very old releases stop working.
9. **Authenticators.**
   - Existing enrolments keep working where ownership can be proven. The others are disabled and the users enrol again.
   - Old backup codes are dropped.
   - Grant the **totp** actions to the Authenticated role for self-service.
10. **Admin token API.** Send `ttl` (hours) as a top-level field. Creating links without e-mail needs `tokens.issue`. Several unused admin routes were removed.

The full list with every changed field is in [CHANGELOG.md](CHANGELOG.md#unreleased).

## Languages, license and support

- **Languages.** The admin panel follows the admin interface language: English, German, French, Spanish or Portuguese, with English as the fallback. Server error messages use the same five languages.
- **License.** MIT, see [LICENSE](LICENSE). The optional license key in the admin panel unlocks nothing, and every feature works without it. Disable license-server calls with `license.remoteLookup: false` or `MAGIC_LINK_LICENSE_LOOKUP=false`.
- **Support.** Report bugs and request features through [GitHub issues](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues).

### Contributing

```bash
npm ci --legacy-peer-deps
npm run lint && npm run format:check && npm test
npm run build && npm run verify
```

Commits follow Conventional Commits. Releases are published by semantic-release with npm provenance.

### Dependency maintenance

- Dependabot opens weekly grouped updates.
- Patch and minor updates merge automatically once lint, format check, tests, build and verify pass.
- Major updates wait for review.
- React, styled-components, react-intl, react-router-dom and `@strapi/*` majors are never proposed, because the Strapi admin host sets those versions.
