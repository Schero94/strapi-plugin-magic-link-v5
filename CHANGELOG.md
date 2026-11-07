## [Unreleased]

Next release: **6.0.0** (major). Magic Link becomes e-mail only and is
hardened throughout. Every breaking change below has migration steps; the
short version is the upgrade guide.

### Upgrade guide (5.x to 6.0.0)

1. Run Node.js 22 or newer and Strapi 5.24.0 or newer (5.33.3+ when you use
   users-permissions refresh mode).
2. Set `MAGIC_LINK_ENCRYPTION_KEY` and `MAGIC_LINK_OTP_PEPPER` (32+ characters
   each) on every host. If the old encryption key was shorter, or you used the
   development fallback, also set `MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS` for the
   first start (see "Secrets are mandatory" below).
3. Remove WhatsApp/SMS fields from `send-link` calls and delete a leftover
   `.whatsapp-auth` directory.
4. Review admin roles: `access` became `read`, `manage`, `settings.read`,
   `settings.update` and `tokens.issue` (roles with `access` get Read and
   Manage automatically).
5. Frontend: exchange tokens with `POST /api/magic-link/login { loginToken }`,
   handle `requiresTOTPSetup` when MFA is required, use `expires_at` instead of
   `expiry_formatted`, and read errors from `error.key`.
6. Replace JavaScript in e-mail templates with `{{PLACEHOLDERS}}`.
7. Use `https` for `frontend_url`, `confirmationUrl` and `callback_url`
   (http only for localhost).
8. Grant the `totp` actions to the Authenticated role for authenticator
   self-service.
9. Admin token API clients: send `ttl` (hours) as a top-level field.

### BREAKING CHANGES (requirements)

* **Node.js 22 or newer** (`engines.node` is `>=22.0.0 <=26.x.x`, the range
  Strapi 5.61 declares). Node 18 and 20 are no longer supported.
* **Strapi 5.24.0 or newer** (`@strapi/strapi` and `@strapi/utils` peers
  `^5.24.0`). 5.24.0 is the first release with the users-permissions session
  manager that refresh-mode logins use.
* **E-mail only.** WhatsApp and SMS delivery are removed from the API, the
  settings, the admin panel, the translations and the documentation (details
  under "login core").

### BREAKING CHANGES (admin RBAC)

* **Admin RBAC split into read, manage and settings actions.** The single
  `plugin::magic-link.access` action is replaced by:
  * `plugin::magic-link.read`: view tokens, OTP codes, JWT sessions and IP bans (menu link and Tokens page)
  * `plugin::magic-link.manage`: create, block, extend and delete tokens, revoke sessions, ban and unban IPs, delete OTP codes, cleanups
  * `plugin::magic-link.settings.read`: view the Settings and License pages (License now needs this instead of `access`)
  * `plugin::magic-link.settings.update`: save settings, reset rate limits, change the license
  * `plugin::magic-link.tokens.issue` (new, *Tokens > Issue login links without
    e-mail*): needed for `POST /magic-link/tokens` with `send_email: false`,
    which hands a working login link for the user to the admin (impersonation)

  The server enforces these actions on every admin route.

  Migration: on startup, roles that still hold the 5.x `access` permission
  get **Read** and **Manage** automatically and the old permission is removed;
  `tokens.issue` is never granted automatically. If your roles show no Magic
  Link permission after the upgrade, open every role that had "Access the
  Magic Link plugin" in *Settings > Administration Panel > Roles* and grant
  **Read** (and **Manage** for roles that changed tokens, sessions, IP bans or
  OTP codes). Grant Settings **Read** to roles that used the License page and
  **Issue login links** only to roles that may log in as end users. Super
  Admin gets all actions automatically.

### BREAKING CHANGES (admin API)

* **Admin-created tokens.** `POST /magic-link/tokens` is validated
  (`email`, `ttl` in hours 1-720, `send_email`, `context` as object or JSON
  string; unknown fields and reserved context keys return 400). It uses the
  same renderer, link builder and providers (Magic Mail, Email Designer,
  e-mail plugin) as the public send-link. With `send_email: true` the
  response no longer contains the plaintext token; with `send_email: false`
  it contains `token` and `loginUrl` once and requires
  `plugin::magic-link.tokens.issue` (403 otherwise). A failed e-mail
  deactivates the new token and returns 503 instead of a silent success.
  Missing users are created only when `createUserIfNotExists` is on, and
  start unconfirmed. Admin creation is limited to 60 per admin and 15
  minutes and no longer uses the public per-IP/per-e-mail buckets. Each issue
  is logged with the admin id and token id (no e-mail, no token).
  Migration: send `ttl` as a top-level field (not in `context`); grant
  `tokens.issue` to roles that need copyable links.
* **Token list and actions.** `GET /magic-link/tokens` no longer returns the
  hash, salt, lookup prefix or `challenge`, and no `meta.securityScore`; it
  returns the newest 1000 tokens, or a page with `?page=&pageSize=`
  (`meta.pagination`). `extend` accepts `days` 1-365 (400 otherwise) and
  refuses used single-use links. `activate` refuses used single-use links,
  links that completed a second-factor challenge, expired links and links
  last used from a banned IP.
* **Removed admin routes** (unused by the admin UI): `GET /security-score`,
  `GET /validate-email`, `GET /user-by-email`, `POST /tokens/:id/resend`,
  `POST /license/auto-create`, `POST /license/create`, `POST /license/ping`.
* **JWT sessions.** `POST /revoke-jwt` needs exactly one of `sessionId` or
  `token`; a client-sent `userId` is ignored and the acting admin is recorded
  (`revokedBy`). Refresh-mode sessions cannot be restored with
  `/unrevoke-jwt` (the users-permissions session is deleted on revocation).
  Plaintext JWTs stored by older releases in the session list are replaced
  by their hash on startup; records are kept 7 days after expiry.
* **IP addresses.** IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`) are
  stored and matched as IPv4, so an IPv4 ban also blocks dual-stack
  requests. Rate limits key IPv6 clients by their /64 network. Banned or
  unverifiable requests now get a formatted 403 with `error.details.code`
  `IP_ADDRESS_BLOCKED` or `IP_BAN_CHECK_UNAVAILABLE` (was a generic
  "Policy Failed").
* **Settings API.** Only known settings keys are stored and returned; unknown
  and legacy keys (`create_new_user`, `remember_me`, `token_lifetime`, ...)
  are dropped on the next save. `context_whitelist`/`context_blacklist`
  strings are stored as arrays. `reset-data` writes the same defaults as a
  fresh install (API login URL, no `noreply@example.com`).
* **`POST /magic-link/reset-data` needs a confirmation.** The body must be
  `{ "confirm": "RESET" }` (400 otherwise, nothing is deleted). The MFA
  settings (`mfa_mode`, `mfa_require_totp`, `totp_as_primary_auth`,
  `otp_enabled`) are kept unless `"resetSecurity": true` is sent, so a reset
  never switches MFA off silently.
  Migration: scripts that call the route send the confirmation body.
* **License privacy.** The plugin no longer sends hostname, IP address, OS
  details, a device id or admin name/e-mail to the license server; only the
  license key is sent (on save and for the License page, cached 10 minutes).
  Set `license: { remoteLookup: false }` in the plugin config or
  `MAGIC_LINK_LICENSE_LOOKUP=false` to disable all license-server calls.
  `GET /license/status` returns `licenseKeyMasked` and `lookup`
  (`ok`, `not-found`, `unavailable`, `disabled`, `none`); the full key and
  holder name/e-mail are only returned to admins with `settings.update`.
  `POST /license/store-key` validates the key format.

### Security and fixes (admin API)

* Session-list and IP-ban updates are serialised, so parallel revocations,
  logins and bans no longer overwrite each other in one process.
* Saving settings keeps rate-limit counters unless a limit changed;
  `/rate-limit/stats` reports real rejection counts. Optional shared limits
  for clusters: `rateLimit: { redis: { storeClient } }` in the plugin config
  (rate-limiter-flexible Redis limiter with an in-memory fallback).
* A startup warning appears when `server.proxy.koa` is on without
  `server.proxy.maxIpsCount` (clients could spoof their IP).
* Bootstrap timers are cleared in `destroy()`, and failing background jobs
  are logged instead of causing unhandled rejections.
* Admin logs no longer contain settings objects, e-mail addresses or tokens.

### BREAKING CHANGES (login core)

* **E-mail only: WhatsApp and SMS delivery removed.** `POST /api/magic-link/send-link`
  now requires `email`. The fields `phoneNumber`, `phone`, `via` and
  `delivery` values other than `"email"` are rejected with a 400
  `ValidationError` ("Only e-mail delivery is supported ..."). The response no
  longer contains `phoneNumber` and never `delivery: "whatsapp"`; the 503
  `WhatsAppDeliveryError` is gone. Settings keys `whatsapp_*` and `sms_*` are
  deleted on startup, and `otp_type` only accepts `"email"` (stored `sms` or
  `totp` values are rewritten to `email`).
  Migration: send e-mail addresses only. Operators who used the built-in
  WhatsApp transport of releases up to 5.2.x should securely delete the
  `.whatsapp-auth` directory in the Strapi project root.
* **Reserved context keys are rejected.** `context` on send-link may not
  contain `requiresOTP`, `otpVerified`, `requiresTOTP`, `totpVerified`,
  `mfaVerified`, `totpLogin`, `userId`, `userDocumentId`, `user`,
  `expires_at`, `expiresAt`, `ttl` or JWT claim names (`id`, `iat`, `exp`,
  `nbf`, `iss`, `sub`, `aud`, `jti`, `sessionId`, `type`), at most 20 keys.
  Public context now passes the same `context_whitelist` /
  `context_blacklist` policy as admin-created tokens. Second-factor state is
  stored in the new private token attribute `challenge`; old tokens whose
  context still carries such flags cannot complete a challenge (open the link
  again to start a new one).
* **E-mail templates no longer execute code.** `message_html`,
  `message_text` and `object` are rendered with a placeholder renderer:
  `{{LOGIN_URL}}`, `{{URL}}`, `{{CODE}}`, `{{EXPIRY_TEXT}}`, `{{EXPIRES_AT}}`,
  `{{EMAIL}}`, `{{USER}}` (values are HTML-escaped in HTML bodies). Legacy
  `<%= VAR %>` placeholders still render and are converted on startup;
  `<%= URL %>?loginToken=<%= CODE %>` becomes `{{LOGIN_URL}}`. Any other
  `<% ... %>` block is printed as text. Unknown placeholders render empty
  instead of failing the send.
  Migration: replace JavaScript expressions in templates with placeholders.
* **Login links are built by one URL builder.** Precedence:
  `frontend_url` + `frontend_login_path`, then `confirmationUrl`, then
  `<server.url><api.rest.prefix>/magic-link/login`. Existing query strings
  are kept. `confirmationUrl`, `frontend_url` and `callback_url` must be
  `https` URLs (`http` only for localhost); invalid stored values are
  ignored when building links and rejected when saving settings. The old
  default `confirmationUrl` (the bare server URL) is cleared on startup.
* **`token_length` is 22 to 128** (132+ bits). Stored smaller values are
  raised to 22. Legacy unhashed login tokens are deactivated and no longer
  accepted.
* **Login responses changed.** The user object is sanitized with Strapi's
  content-API sanitizer (private attributes are no longer returned).
  `expiry_formatted` was removed (format `expires_at` on the client). With
  `use_jwt_token: false` no JWT is minted; the response carries
  `jwtIssued: false` instead of `tokenIssued: true`. The TOTP challenge
  response no longer includes `userId`. Errors use the Strapi envelope
  `{ data: null, error: { status, name, message, details: { key } } }`
  (`error.key` is kept) with translated messages.
* **JWT lifetime and refresh mode.** In users-permissions `legacy-support`
  mode the JWT now expires after `jwt_token_expires_in` (`15m`, `12h`,
  `30d`, ...). In `jwtManagement: 'refresh'` mode Magic Link logins issue a
  refresh session through the users-permissions session manager and return
  `refreshToken` (or set the refresh cookie when `sessions.httpOnly` or the
  `x-strapi-refresh-cookie: httpOnly` header asks for it), exactly like
  `/api/auth/local`; `context` is only in the response body there.
  Revoking a session in the plugin also revokes the users-permissions
  session, and revocation entries now live until the token expires (not a
  fixed 30 days).
* **MFA precedence.** A user with an enabled authenticator always gets the
  TOTP challenge after the link click, even when e-mail OTP is enabled
  (previously `optional` mode silently skipped TOTP). In `required` mode a
  user without an authenticator enrols one during the login (see "MFA"
  below).
* **Auto-registration** needs `allow_magic_links_on_public_registration`,
  `createUserIfNotExists` and users-permissions "Enable sign-ups"
  (`allow_register`). New accounts are created unconfirmed and confirmed on
  their first magic-link login; colliding usernames get a random suffix.
  `username` on send-link may only contain letters, digits, `.`, `_`, `-`.
  TOTP-only login no longer confirms accounts and honours users-permissions
  "email confirmation".
* **Passwordless compatibility** is served only by the
  `/<api prefix>/passwordless/{send-link,login}` rewrite (now honouring
  `api.rest.prefix`); the duplicate `/api/magic-link/passwordless/*` routes
  and the `compatibility-check` policy were removed. With the setting off,
  the path is passed on instead of answering 404.

### Security and fixes (login core)

* `POST /api/magic-link/login { loginToken }` added for frontend landing
  pages, so tokens stay out of access logs and Referer headers; `GET` keeps
  working. Login responses send `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`.
* Single-use links are consumed with a conditional update: parallel requests
  with one link yield exactly one session.
* Re-opening a link with a pending e-mail OTP no longer sends a new code
  while the current one is valid.
* send-link answers before any lookup or delivery, so neither status nor
  timing reveals whether an account exists; delivery errors are only logged.
* The JWT revocation check parses `Authorization` like users-permissions
  (any case, any whitespace) and runs only for Content API requests (REST
  under `api.rest.prefix` and the GraphQL endpoint), where it fails closed
  with 503. Admin API requests, including plugin admin routes such as
  `/content-manager/...`, are never checked, so a store problem cannot lock
  administrators out.
* Plugin logs no longer contain e-mail addresses, URLs with tokens or
  provider errors from the login core.
* Sender falls back to the e-mail plugin `defaultFrom` instead of
  `noreply@example.com`; the default expiry text reads "1 hour".
* Server error messages are translated (de, en, es, fr, pt); unknown
  `?locale=` values fall back to English.

### BREAKING CHANGES (MFA: e-mail OTP, TOTP, backup codes)

* **Secrets are mandatory and checked at startup.** `MAGIC_LINK_ENCRYPTION_KEY`
  and `MAGIC_LINK_OTP_PEPPER` must both be set and at least 32 characters
  long, also outside `NODE_ENV=production`. The only exception is
  `MAGIC_LINK_ALLOW_DEV_SECRETS=true` on non-production hosts, which uses a
  development fallback and logs a warning.
  Migration: generate both with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  If your current encryption key is shorter than 32 characters (or you used
  the development fallback), set the new key in `MAGIC_LINK_ENCRYPTION_KEY`
  and the old value in `MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS` (for the old
  development fallback: the value of `ADMIN_JWT_SECRET`). Startup re-encrypts
  stored TOTP secrets with the new key; remove the previous key afterwards.
  A new pepper only invalidates pending e-mail codes and backup codes.
* **Authenticator enrolments are namespaced by principal.** TOTP records now
  belong either to a users-permissions user (`up:<id>`) or to an admin user
  (`admin:<id>`); equal numeric ids no longer share a second factor (security
  review S-01). On startup, records from 5.x are assigned only where
  ownership is provable: the users-permissions user or admin user with that
  id must still have the enrolment e-mail. All other records are disabled.
  Unconfirmed setups and the old unsalted backup codes are dropped.
  Migration: users whose authenticator was disabled enrol again (see below).
* **End users manage their authenticator themselves.** New Content API
  routes (users-permissions JWT): `GET /api/magic-link/totp/status`,
  `POST /totp/setup` (sends an e-mail code; needs `totpCode` when an
  authenticator is already active), `POST /totp/confirm { totpCode, emailCode }`
  (returns 10 backup codes once), `POST /totp/disable { totpCode | backupCode }`,
  `POST /totp/backup-codes { totpCode }`. The README routes
  `/totp/verify` and `/totp/login` never existed; use `/totp/confirm` and
  `/login-totp`.
  Migration: grant the `totp` actions (status, setup, confirm, disable,
  backupCodes) to the **Authenticated** role in *Settings > Users &
  Permissions > Roles*.
* **Required MFA enrols during login.** With `mfa_mode: 'required'`, a user
  without an authenticator no longer gets 403 `mfa.setupRequired`. `/login`
  answers `{ requiresTOTPSetup: true, loginToken }`; the frontend calls
  `POST /api/magic-link/totp/enroll { loginToken }` (secret and QR code) and
  `POST /api/magic-link/totp/enroll/confirm { loginToken, totpCode }`, which
  returns the session plus `backupCodes`.
  Migration: handle `requiresTOTPSetup` in the frontend landing page.
* **TOTP parameters are stored per enrolment.** Algorithm, digits and period
  are saved when a user enrols; changing the settings only affects new
  enrolments. The QR code now carries issuer, algorithm, digits and period.
  Re-enrolment stages the new secret and keeps the current authenticator
  active until the new one is confirmed.
* **Backup codes work.** `verify-mfa-totp` accepts `{ loginToken, backupCode }`
  instead of `totpCode` (one-time use; the response carries
  `backupCodesRemaining`). Codes are 16 characters (`XXXX-XXXX-XXXX-XXXX`,
  about 78 bits), stored as owner-bound HMACs.
* **Admin TOTP routes** (`/magic-link/otp/totp/*`) manage only the calling
  admin user's own authenticator. `setup` needs `{ token }` (a current code)
  when one is active, `verify` confirms a pending setup and returns backup
  codes, `disable` and `backup-codes` need `{ token }`.
* **Unbound e-mail OTP is refused while MFA is active.** With
  `otp_strict_binding: false`, `/otp/send` and `/otp/verify` only work when
  `mfa_mode` is `disabled`.
* **`/otp/verify` issues sessions like every other login.** The response is
  the common login body (`jwt`, sanitized `user`, filtered `context`,
  `expires_at`, `refreshToken` in refresh mode, `otpVerified: true`); the
  session appears in the JWT sessions list and can be revoked. Invalid
  request bodies answer with Strapi's `ValidationError` instead of
  "Failed to send OTP code".
* **OTP codes:** the `sms` type and the `phoneNumber` attribute were removed
  from `otp-code`. The admin list (`GET /magic-link/otp/codes`) validates its
  query (`page`, `pageSize` up to 100, `email`, `type`), paginates on the
  server, returns `pagination.truncated` and no longer returns code hashes
  or token bindings.

### Security and fixes (MFA)

* TOTP uses otplib 13 instead of the unmaintained speakeasy 2.0.0. Existing
  base32 secrets stay valid (RFC 6238 test vectors pass).
* Every accepted TOTP time step is recorded with a compare-and-set update,
  also during setup confirmation, so a code cannot be used twice.
* E-mail OTP attempts are counted with a compare-and-set update before the
  comparison, so parallel guesses cannot exceed `otp_max_attempts`. Codes are
  drawn with `crypto.randomInt` (no modulo bias).
* TOTP-only login limits attempts per IP, per (account, IP) pair and per
  account, so one client cannot lock a victim out, and runs a dummy
  verification for unknown accounts (equal timing).
* Every second-factor code check (TOTP, backup code, e-mail OTP, enrolment
  confirmation, admin authenticator routes) also counts against a `verify`
  limit of 10 attempts per account and 15 minutes (then blocked for 15
  minutes). It stays on when `rate_limit_enabled` is off, so disabling send
  throttling never opens a brute-force path.
* OTP e-mails no longer read "0 minutes" for short expiries and the plugin no
  longer logs e-mail addresses or codes.
* Deleting an OTP code from the admin works with the numeric id and answers
  404 when nothing was deleted; the new `GET /magic-link/totp/enrollment-summary`
  (Settings read) returns the number of enrolled end users.

### Admin panel

* The Tokens, OTP codes, JWT sessions, IP bans, Settings and License pages
  were rebuilt on the Strapi design system with shared dialogs and theme
  tokens. They have correct dark-mode colours and contrast, a consistent
  spacing scale, labelled controls, keyboard-accessible tabs and pagination,
  and no emoji.
* Every page follows the new RBAC actions. Read-only roles see disabled or
  hidden controls, and destructive actions use confirmation dialogs instead
  of `window.confirm`.
* Settings:
  * saves only changed fields and guards unsaved changes;
  * validates URLs, JWT lifetimes and number ranges like the server;
  * no longer shows `login_path`, `callback_url`, `max_login_attempts` or the
    Email Designer compatibility switch;
  * the MFA mode is a single, lock-out safe choice.
* Admin token creation sends `ttl` as a top-level field and offers "do not
  send e-mail" only with `tokens.issue`.
* The License page masks the key.
* All texts are translated into English, German (formal), French, Spanish
  and Portuguese, and dates follow the admin locale. A test now checks that
  every message id used by the admin exists in all five locales.

### Build, dependencies and release

* Removed the unused `lodash` and `yup` dependencies.
* The root `strapi-server.js` and `strapi-admin.js` load `dist/` (they
  pointed at sources that are not published). Removed the dead
  `.npmignore`, `.externals.json`, `.trigger-release` and the unused
  license-tier map `server/src/config/features.js`.
* ESLint 10 flat config with `@eslint/js` recommended,
  `eslint-plugin-react-hooks` recommended and `eslint-config-prettier`, plus
  Prettier with `lint`, `lint:fix`, `format` and `format:check` scripts.
* GitHub Actions are pinned to commit SHAs with least-privilege tokens.
* New pull-request CI on Node 22 and 24 runs lint, format check, tests,
  build, verify and `npm pack --dry-run`.
* Releases install without lifecycle scripts and publish with npm trusted
  publishing and provenance.
* `verify:runtime` checks the public routes, the RBAC policy on every admin
  route and that the server bundle only loads declared dependencies.

# [5.6.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.9...v5.6.0) (2026-10-15)


### Bug Fixes

* align CI installs with lockfile settings ([77580a3](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/77580a36f00f7f41d04be953a8d19a0422d14dce))
* check out documentation before Pages deploy ([114ef6e](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/114ef6e3e5e4d1039d5db89ae791b633e1189793))


### Features

* delegate WhatsApp OTP to Magic WhatsApp ([64fa660](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/64fa66053478db45785374840f4e9f6236b428c4))

## [5.5.9](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.8...v5.5.9) (2026-05-03)


### Bug Fixes

* trigger release for plugin always-on refactor ([2ed54eb](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/2ed54eb228bccc84f1cd013741f98de69edf2268))

## [5.5.8](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.7...v5.5.8) (2026-05-03)


### Bug Fixes

* **settings:** declare missing emailTemplates state — closes [#17](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/17) ([6ee2740](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/6ee2740c62e7772e5cfa8904416ab64be84bab5e))

## [5.5.7](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.6...v5.5.7) (2026-04-26)


### Bug Fixes

* **send-link:** use Email Designer 5 template on public endpoint ([8e0abbc](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/8e0abbc3f479b5a41d5a56c081592c2a2f4daffa)), closes [#17](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/17) [#17](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/17)

## [5.5.6](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.5...v5.5.6) (2026-04-26)


### Bug Fixes

* **settings:** declare emailTemplates state and harden email-designer integration ([d9e6240](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/d9e62405942ca6432c006b863d0c7a3a9eedba42)), closes [#17](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/17) [#17](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/17) [#17](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/17)

## [5.5.5](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.4...v5.5.5) (2026-04-21)


### Bug Fixes

* **boot:** hoist crypto self-test require to top level + fix wrong path ([521c73f](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/521c73f02acf671b08c3360781c77eeafd51b4c8))

## [5.5.4](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.3...v5.5.4) (2026-04-21)


### Bug Fixes

* **build:** avoid destructured requires that pack-up rewrites into undefined ([7aea267](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/7aea2671686a2c0ea7d6a5f1293d7a830628c98e))

## [5.5.3](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.2...v5.5.3) (2026-04-21)


### Bug Fixes

* **build:** declare @strapi/utils as peerDependency to prevent zod/v4 crash ([08fecac](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/08fecacb2d85b91ba04de5a68d2500b287990969))

## [5.5.2](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.1...v5.5.2) (2026-04-21)


### Bug Fixes

* **rbac:** make plugin::magic-link.access visible in role editor ([66d6e95](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/66d6e95acb8abf28cdcb9e99d96d07179022a75a))

## [5.5.1](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.5.0...v5.5.1) (2026-04-21)


### Bug Fixes

* **build:** pin @strapi/sdk-plugin to ^5.4.0 — v6 produces broken 23-line stub bundles ([c653a7d](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/c653a7da00d2331cfecca533552d956e861447bd))

# [5.5.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.4.0...v5.5.0) (2026-04-21)


### Bug Fixes

* **deps:** move baileys to optionalDependencies + bump runtime deps ([b1716b2](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/b1716b22cb905aaa52fa5c7bfea5092ef722fc91)), closes [package.json#exports](https://github.com/package.json/issues/exports)
* **deps:** pin styled-components to ^6.3.9 to avoid npm ci ERESOLVE ([351cf6f](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/351cf6fd325bce0f7bc8df1bfa35895c81c326b9))
* **deps:** revert baileys back to dependencies, document protobufjs override for consumers ([260e144](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/260e1441959dfaa1bdc31550b76f4849854cc6c6))
* **enduser:** harden magic-link login/OTP flow (no enumeration, deterministic email lookup, clean delivery errors) ([707c45c](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/707c45cb4a007aa9c25b705c2b9e2f977749f126))
* **license:** wrap every license-server call in a 12s timeout with 1 retry ([6ab88ba](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/6ab88ba47e15c1d0feab53ff71866f7e5958d24a))
* **security:** gate every admin route with hasPermissions (plugin::magic-link.access) ([db821ef](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/db821ef24a46d5f5ccbebb452803dcab057123ff))


### Features

* **security,settings:** otp binding, crypto hardening, wire-up dead settings ([90dc76d](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/90dc76d3cb77fe6bc2272155b43272e6541ab91f))

# [5.4.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.20...v5.4.0) (2026-04-15)


### Bug Fixes

* **rbac:** keep routes functional, only hide UI for unpermitted roles ([5f230cb](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/5f230cbc4432477bea6c9c3886205d058fa90f10))
* **routes:** restore original open policies for end-user facing routes ([30d7fb5](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/30d7fb5ec77c1576068052ca92e4fe9fb4771fbc))


### Features

* **rbac:** add access permission and secure all admin routes ([7e68283](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/7e6828333a26f64612f0cf1831bdc2f535fb308f))

## [5.3.20](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.19...v5.3.20) (2026-02-27)


### Bug Fixes

* loosen peerDependencies to avoid conflicts with Strapi 5.37+ ([4ac6f96](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/4ac6f96493a408e8302655b94b0e93a8f4019ff4))
* security hardening - hash-based JWT storage, prefix token lookup, rate limiter rewrite ([7010255](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/701025549ef8f2af9d99d791c2eb143afab1a1c0))

## [5.3.19](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.18...v5.3.19) (2026-02-14)


### Bug Fixes

* resolve libsignal git+ssh dependency issue for CI/CD compatibility ([9c0d840](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/9c0d8403630806c10f6ea8e45de84d843d5bc206))

## [5.3.18](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.17...v5.3.18) (2026-02-08)


### Bug Fixes

* dark mode compatibility for LicensePage and LicenseGuard ([e3292b2](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/e3292b267ca1c1260c809ca6f7eed80be117b70a)), closes [#4945ff](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/4945ff)

## [5.3.17](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.16...v5.3.17) (2026-02-07)


### Bug Fixes

* replace all hardcoded theme colors with DS props and rgba for dark/light mode ([28b4f8e](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/28b4f8ee66e83012bb8037a4439dd393afe022e6)), closes [#BAE6FD](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/BAE6FD) [#BBF7D0](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/BBF7D0)

## [5.3.16](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.15...v5.3.16) (2026-02-07)


### Bug Fixes

* use Strapi DS tokens for light+dark mode compatibility ([6a603f9](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/6a603f9da6ec07a962e785cd3410f088b8f83a9d))

## [5.3.15](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.14...v5.3.15) (2026-02-07)


### Bug Fixes

* settings page fully dark mode compatible ([4b8e402](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/4b8e4026ae9d654fe655c1a812601517e82de4cd)), closes [#E5E7EB](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/E5E7EB) [#D1D5DB](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/D1D5DB) [#E9D5FF](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/E9D5FF) [#d1d5db](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/d1d5db)

## [5.3.14](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.13...v5.3.14) (2026-02-07)


### Bug Fixes

* extend token modal dark mode compatible ([cb10fc6](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/cb10fc64806d1a4e3055120740413a18dd5aa9b4))

## [5.3.13](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.12...v5.3.13) (2026-02-07)


### Bug Fixes

* token details modal fully dark mode compatible ([15da652](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/15da652fb8505017edc6b164d58dccb0325214dc))

## [5.3.12](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.11...v5.3.12) (2026-02-07)


### Bug Fixes

* white text color for reference badge in dark mode ([cac77ee](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/cac77ee2be56d9f7fd82bd62b8a38f632891ea07))

## [5.3.11](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.10...v5.3.11) (2026-02-07)


### Bug Fixes

* reference badge readable in dark mode ([7bb8ab6](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/7bb8ab6ed6329c2e9c6dc8f67da4b851bff92667))

## [5.3.10](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.9...v5.3.10) (2026-02-07)


### Bug Fixes

* use expire_period from settings as default TTL in token creation ([f8cb324](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/f8cb324882807bba5fc84a2b6ab853022f988601))

## [5.3.9](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.8...v5.3.9) (2026-02-07)


### Bug Fixes

* replace Toggle with Switch component (Strapi DS v2) ([a0af2f0](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/a0af2f02ac745fb6cb001008eb4af6c91257848f))

## [5.3.8](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.7...v5.3.8) (2026-02-07)


### Bug Fixes

* update admin UI to Strapi Design System v2 patterns ([057f5a3](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/057f5a3d4f137bb4e91b48c6a8cca103afaf067e))

## [5.3.7](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.6...v5.3.7) (2026-02-07)


### Bug Fixes

* context whitelist/blacklist input fields not typeable ([5e87a8c](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/5e87a8c1a78347a68d2089a0440a3c5e30f5187b))

## [5.3.6](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.5...v5.3.6) (2026-02-07)


### Bug Fixes

* pass all context fields through on login instead of hard whitelist ([116a032](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/116a032ecfe567dea51ec35688a030ebdef8e113))

## [5.3.5](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.4...v5.3.5) (2026-01-30)


### Bug Fixes

* restore package-lock.json for CI/CD npm ci ([422f849](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/422f8492e4cc677381d9c2ad8f15a63bdfbb545b))
* update NumberInput onChange to onValueChange for Strapi Design System v2 ([2b2c91f](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/2b2c91fb3b51383cc540ee06b00325831855007e))
* use expire_period from settings instead of hardcoded 1 hour ([cc48094](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/cc4809471ad7f1d890881534a223eab330475629))

## [5.3.4](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.3...v5.3.4) (2026-01-27)


### Bug Fixes

* use onValueChange for NumberInput components ([cbdfd3e](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/cbdfd3e61efabdb3867fdfce8a4e58c2959ddbe8))

## [5.3.3](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.2...v5.3.3) (2025-12-28)


### Bug Fixes

* remove begservice references and support email ([f8a5581](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/f8a558181b62388c3019e654ad55edb118561a4e))

## [5.3.2](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.1...v5.3.2) (2025-12-28)


### Bug Fixes

* update repository URLs from begservice to Schero94 ([0a5169c](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/0a5169cefba54f1582026c2027aa905c3e6b13f9))

## [5.3.1](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.3.0...v5.3.1) (2025-12-16)


### Bug Fixes

* improve WhatsApp integration stability and documentation ([5730c07](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/5730c07710cd59d007341608e10758cf7a23f2aa))

# [5.3.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.2.0...v5.3.0) (2025-12-16)


### Features

* add WhatsApp integration for magic links v5.2.7 ([bc2ba06](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/bc2ba068d5375002a068f49f3566fee3b3e5fbca))

# [5.2.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.1.4...v5.2.0) (2025-12-08)


### Features

* enhance GitHub issue templates with plugin-specific fields and feature request template ([78f9829](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/78f982927fb970d6062a584b4b81294795330d0e))
* enhance pull request template with comprehensive sections and plugin-specific checklist ([e64eec1](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/e64eec1c2986776a9f7f00f14fec37b29acd9fb5))

## [5.1.4](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.1.3...v5.1.4) (2025-12-08)


### Bug Fixes

* move semantic-release to devDependencies and add GitHub templates ([a942b79](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/a942b791a401c48f9c7450183c9ba57b4938a777))

## [5.1.3](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.1.2...v5.1.3) (2025-12-05)


### Bug Fixes

* resolve strapi reference loss in setInterval cleanup functions ([1caae3f](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/1caae3f81c274d64ee4e15457d8989e4873e9875))

## [5.1.2](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.1.1...v5.1.2) (2025-12-04)


### Bug Fixes

* hide internal content-types from Content Manager (Strapi v5) ([6cc1309](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/6cc13095229800ad00c71964738215453e102f27))

## [5.1.1](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.1.0...v5.1.1) (2025-12-04)


### Bug Fixes

* trigger release for code quality improvements ([ed51892](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/ed51892f120278841b2798adb371fa8c56f88c7a))
