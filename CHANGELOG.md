# [6.2.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v6.1.0...v6.2.0) (2026-11-07)


### Bug Fixes

* **tokens:** create admin-link users through the locked find-or-create ([1d19d64](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/1d19d6492fc51ac97cfd8ff5eb0852206cbd80d0))


### Features

* **server:** keep shared state consistent across several Strapi processes ([eae7491](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/eae7491347873d5a63ccd277fda2d293be4cccd4))
* **server:** keep shared state consistent across several Strapi processes ([#23](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/23)) ([33799c2](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/33799c2f71d0d04f1e60caa52a2236bbf04869f9))

## [Unreleased]

Next release: **6.2.0** (minor). No breaking changes: routes, responses and settings keep their contract; the new table and columns are created on start.

### Fixed

- Several Strapi processes on one database (Railway replicas, pm2 cluster mode) no longer lose or duplicate shared state (AUTH-14):
  - JWT revocations, the session list, IP bans, settings and the license key are written under a cluster-wide database lock (PostgreSQL `pg_advisory_xact_lock`, MySQL `GET_LOCK`, SQLite write lock). The 5-minute cleanup no longer rewrites the blocklist from a stale read.
  - Rate limits, including the always-on second-factor limit, are shared through the new database table `magic_link_rate_limits`. Redis stays optional and now falls back to the database instead of process memory. The admin "reset counters" and changed limits reach every process within 5 seconds.
  - TOTP and backup codes have a database attempt counter (10 attempts without a success lock the factor for 15 minutes).
  - New accounts from magic-link requests and from admin-issued links (`POST /magic-link/tokens`), account claims, second-factor challenge starts, e-mail OTP creation, TOTP enrolment and delivery feedback are safe against parallel requests on different processes.
  - Background jobs run in one process at a time (lease); startup migrations run under a lock.
  - Startup merges plugin-store rows that earlier releases could have duplicated.
- Logins no longer run one after another across processes. JWT session records moved from one plugin-store JSON list (`jwt_sessions`, written under a cluster-wide lock, capped at 1000 records) to the hidden content type `plugin::magic-link.jwt-session` (table `magic_link_jwt_sessions`), one row per issued JWT:
  - a login inserts one row without a lock; revoke, restore and "clean up expired" are conditional updates of the affected rows only;
  - retention (7 days after expiry) and a size cap of 50,000 rows are indexed deletes run by the 5-minute cleanup job (one process);
  - the admin list reads the newest 1000 rows through the primary key, unchanged for the admin UI; `GET /magic-link/jwt-sessions` also accepts `page`, `pageSize` (max 1000), `status` (`all`, `active`, `revoked`, `expired`) and `userId`, and sends the total in `X-Total-Count`.

### Added

- Plugin config `rateLimit.store: 'memory'` keeps the previous per-process counters (single process only).
- Rate-limit statistics report `statsScope: 'process'`.
- README section "Running several instances (Railway replicas, pm2 cluster)"; `npm run test:cluster` runs 8 processes against SQLite or PostgreSQL.

### Migration

- No action needed. The first start creates `magic_link_rate_limits`, `magic_link_jwt_sessions` and two new private columns (`magic_link_tokens.challenge_revision`, TOTP `failed_attempts`/`locked_until`). Rate-limit counters start empty once. To keep in-memory counters, set `rateLimit: { store: 'memory' }`.
- The 6.1 session list (plugin-store key `jwt_sessions`) is moved into `magic_link_jwt_sessions` once at startup, by one process under a lock; already moved records are skipped, plaintext JWTs of very old releases are stored as hashes only, records more than 7 days past expiry are dropped, and the key is deleted. If the move fails, it is logged and retried on the next start.
- Several processes starting at once on this update can stop once with `column ... already exists` while Strapi adds the new columns; the restarted process starts normally (pm2 and Railway's default on-failure policy restart it). Or deploy with one replica and scale up afterwards. See README, "First deploy and schema changes".

# [6.1.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v6.0.0...v6.1.0) (2026-11-07)


### Bug Fixes

* **server:** fall back from Magic Mail only when nothing was sent ([f741d22](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/f741d22ec850d60fd12c03a6844578262e675a1a))


### Features

* **tokens:** bounce and spam-complaint feedback for login e-mails ([a3ab0bb](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/a3ab0bb58b4320ab6cfecb844a8e4cd8e65c2f34))
* **tokens:** delivery status and bounce feedback for login e-mails ([#22](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/22)) ([200abb8](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/200abb8c93734b715b50b7ae9b45cc7e1ff95dee))
* **tokens:** record the delivery status of every login e-mail ([48612e8](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/48612e848e0ddeff52cf253e42fa5b5d6855fb41))

# [6.0.0](https://github.com/Schero94/strapi-plugin-magic-link-v5/compare/v5.6.0...v6.0.0) (2026-11-07)


* build!: drop unused dependencies, require Node 22 and harden CI and release ([05eabb9](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/05eabb96baf98a8cca292f561a6e687d9417aeb8))
* build(deps)!: declare the users-permissions peer dependency ([fde4798](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/fde4798c273a9aa8e4d3ddd1144af8846c2eaaf6)), closes [#peerdependencies](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/peerdependencies)
* feat(admin-api)!: enforce read/manage RBAC, guard impersonation and harden sessions, IP bans, limits and license ([3036538](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/30365384350723d2ef38035a34f0cc81a03f8b5f))
* feat(admin)!: split admin RBAC into read, manage and settings actions ([8a0a5f3](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/8a0a5f3249dd8b0dd56585394dcd64d285e18a6b))
* feat(auth)!: harden the login core and make Magic Link e-mail only ([a1f4b89](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/a1f4b89b348fd046796658db22e9b52771478ead))
* feat(mfa)!: namespace TOTP by principal, add enrolment and backup codes, move to otplib ([466319e](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/466319e332c0fdc597ef393ea16a9e434f57fa87))
* fix(admin-api)!: require a confirmation for reset-data and keep MFA settings ([258fc76](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/258fc76c746e6a2c5e43d37108fcd8127a4e571b))
* fix(admin)!: rebuild the Settings view with lock-out safe MFA modes and an unsaved-changes guard ([2942a75](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/2942a75d3b0749c435e5dad4d7e449ddc2449ea6))
* fix(security)!: close revocation path bypass and admin limiter/settings gaps ([f63d203](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/f63d203eeb4315f304516280b22615bcc589cfda))
* fix(security)!: close the open adversarial review findings ([e1a19b5](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/e1a19b5ae71c9bf1789c1e338fae2b5278b34766))
* fix(security)!: guard required MFA, hash the send-link limiter key, tighten settings.security ([720240f](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/720240fb30927f5c1df46fd75d6ec081936f9f3a))


### Bug Fixes

* **admin:** complete translations, formal German and safe template placeholders ([e3e13fd](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/e3e13fde1daa9c8d24c485994e0661ba4ed34c4b))
* **admin:** make the Tokens list keyboard operable, readable and responsive ([8315dd2](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/8315dd2baf39cf698ec04423c0eba868b47dc45a)), closes [#0284C7](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/0284C7) [#0369A1](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/0369A1) [#16A34A](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/16A34A) [15803D/#166534](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/166534)
* **admin:** mask license key, gate it by settings rights and localise the License page ([a65011f](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/a65011f621fcc653c771b57a0380d14cd23f8f59))
* **admin:** pass browser acceptance of the OTP, JWT session and IP ban tabs ([40b1205](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/40b1205cc280e9c7d88c6ebdba419005439ae35b)), closes [#0369A1](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/0369A1) [#9333EA](https://github.com/Schero94/strapi-plugin-magic-link-v5/issues/9333EA)
* **admin:** pass browser acceptance of the Settings and License pages ([782bde7](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/782bde71f12c80cb29fd92a73144748c9e246eea))
* **admin:** rebuild OTP, JWT session and IP ban tabs on the shared foundation ([e9c85ed](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/e9c85ed55367df7941e32e12772cd2e968a13df8))
* **admin:** rebuild the Tokens view on the shared foundation and fix token actions ([afcd4d6](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/afcd4d6f793a342c210a1125945b8dc8ac12223e))
* **admin:** show IPv4-mapped bans as IPv4 and drop a stale validator ([73add59](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/73add59c2eb6cd83dbb8f9d6fd2e98b9c67f888a))
* **admin:** stop the reload permission race and unstick the Tokens table keyboard ([b76ff5b](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/b76ff5b8f024f15caef6a7cdd3105e8dd23e6d42))
* **auth:** give every legacy JWT a unique jti so session revocation is per session ([2100678](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/2100678098d8f38faf4325f3854bb2069e90a22d))
* **auth:** run the JWT revocation check on Content API paths only ([2189a36](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/2189a3642e944d44d1a17a3ef55b450a1d45d10d))
* **errors:** keep the IP-ban and tokens.issue 403 details; final docs review ([b336280](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/b3362801714792f2eed9fc776c9c224283d827be))
* **i18n:** merge view translations, drop unused keys and enforce id coverage ([9b949a4](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/9b949a44bd36d27e8a8ac3e40a5fc65848d0bed6))
* **mail:** send Magic Mail login links as untracked transactional mail ([1b42439](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/1b424395f1d72c8fead3ce98a835f458823002b3))
* **mfa:** keep second-factor brute-force limits on when rate limiting is off ([5ba821e](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/5ba821ec5130f5558f77cbc1b63bd6b94ba464c7))
* **otp:** accept the admin status filter on GET /otp/codes and return stats ([132a149](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/132a14949d204995417780ad85d3c1749870fe40))
* **release:** pass the npm token as fallback to trusted publishing ([72ca270](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/72ca270201ae8ddd5ac83dc7c146515066eea217))
* **security:** strict GCM tags, refresh-family session records, drop dead OTP mailer ([d12d215](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/d12d215e32c84564e27e48d2b970a8a80209efaa))


### Documentation

* rewrite README and project site for the e-mail-only 6.0.0 release ([4744ef6](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/4744ef6035c53cd4ab3305823918cba85195844f))


### Features

* **admin:** add shared admin foundation for theme, i18n, dialogs and RBAC ([4e6527b](https://github.com/Schero94/strapi-plugin-magic-link-v5/commit/4e6527b3d1de774b30c507ca3534aa7e9c218350))


### BREAKING CHANGES

* POST /magic-link/reset-data needs plugin::magic-link.settings.security and no longer returns securitySettingsKept; changing from_name, from_email or response_email needs settings.security; switching mfa_mode to required with no enrolled user needs acknowledgeNoEnrolledUsers: true; max_login_attempts is no longer accepted or stored.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* changing OTP, TOTP-parameter and rate-limit settings now
needs plugin::magic-link.settings.security, and reset-data without that
permission keeps all security settings. Grant Settings > Security to roles
that should keep changing them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* changing security settings (link URLs and paths,
templates, template providers, account creation, link/session lifetimes,
context lists, MFA/OTP switches) now requires
plugin::magic-link.settings.security in addition to settings.update; the
action is never granted automatically. Confirming an unconfirmed account
via Magic Link clears its password and ends its sessions. IPv6 IP bans now
cover the whole /64 network.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* hosts must have @strapi/plugin-users-permissions ^5.24.0
installed (it ships with every default Strapi 5 project).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* POST /magic-link/reset-data requires the body
{ "confirm": "RESET" }; MFA settings survive a reset unless
"resetSecurity": true is sent.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* documented 6.0.0 contract. Magic Link is e-mail only and
needs Node.js 22+ and Strapi 5.24+; see the upgrade guide in README.md and
CHANGELOG.md.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* Node.js 22 or newer is required, and the plugin needs
Strapi 5.24.0 or newer (users-permissions session manager).

Docs: npm trusted publishers (docs.npmjs.com/trusted-publishers),
GitHub Actions security hardening (pin to full SHA, least-privilege
GITHUB_TOKEN), Strapi 5.61.0 package.json engines, npm registry
metadata for qrcode and @paulmillr/qr; checked 2026-11-07.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* admin routes require plugin::magic-link.read / manage /
settings.read / settings.update (5.x `access` is migrated to read + manage
when the permission rows still exist). POST /magic-link/tokens returns the
plaintext token only for send_email:false and only with the new
plugin::magic-link.tokens.issue action, sends `ttl` top-level, fails with
503 when the mail fails; several unused admin routes were removed; GET
/tokens no longer returns hashes or securityScore; revoke-jwt needs
sessionId xor token; IPv4-mapped addresses are matched as IPv4; IP-ban
denials are formatted 403s with details.code; unknown settings keys are
dropped; license status masks the key for settings readers and no host
telemetry is sent. See CHANGELOG [Unreleased] for migration steps.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* MAGIC_LINK_ENCRYPTION_KEY and MAGIC_LINK_OTP_PEPPER are
required (>= 32 characters) on every host; rotate short keys with
MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS. TOTP enrolments are namespaced by
principal and 5.x rows without provable ownership are disabled. Required
MFA answers /login with requiresTOTPSetup instead of 403. /otp/verify
returns the common login body, the unbound OTP flow is refused while MFA
is active, otp-code lost the sms type and phoneNumber, admin TOTP routes
need a current code for re-setup, disable and backup codes. Grant the
`totp` actions to the Authenticated role for self-service. See CHANGELOG.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* the Settings page no longer offers the login_path,
callback_url, max_login_attempts and Email Designer compatibility
controls (the server never used them), and saves only changed fields.
Choosing "Magic link + authenticator app" now selects the optional
policy; requiring TOTP for every user needs an explicit confirmation.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* WhatsApp and SMS delivery removed; send-link requires email and rejects phoneNumber, phone, via and non-email delivery with 400; whatsapp_* and sms_* settings are deleted and otp_type only accepts 'email'.
* reserved context keys (requiresOTP, otpVerified, requiresTOTP, totpVerified, mfaVerified, totpLogin, userId, userDocumentId, user, expires_at, expiresAt, ttl and JWT claim names) are rejected; public context follows context_whitelist/context_blacklist.
* e-mail templates use {{VARIABLE}} placeholders; legacy <%= VAR %> is converted, any other <% %> code is printed as text.
* login links follow frontend_url+frontend_login_path > confirmationUrl > API URL; link URL settings must be https (http only for localhost); token_length must be 22..128.
* login responses return a content-API sanitized user, drop expiry_formatted and the TOTP challenge userId, return jwtIssued:false when use_jwt_token is false, and use the Strapi error envelope.
* JWTs honour jwt_token_expires_in; in users-permissions refresh mode logins return refreshToken (or the refresh cookie) from the u-p session manager.
* users with an enabled authenticator always get the TOTP challenge; required MFA without an authenticator returns 403.
* auto-registration also requires users-permissions allow_register; new users start unconfirmed; TOTP-only login no longer confirms users.
* /api/magic-link/passwordless/* routes and the compatibility-check policy are removed; /<prefix>/passwordless/* is handled by the rewrite middleware.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
* the plugin::magic-link.access action is replaced by
plugin::magic-link.read and plugin::magic-link.manage, and the License page
requires plugin::magic-link.settings.read. Re-grant Read (and Manage) to
every role that had "Access the Magic Link plugin"; see CHANGELOG.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

## 6.0.0 release notes (written before the release)

Next release: **6.0.0** (major). Magic Link becomes e-mail only and is
hardened throughout. Every breaking change below has migration steps; the
short version is the upgrade guide.

### Upgrade guide (5.x to 6.0.0)

1. Run Node.js 22 or newer and Strapi 5.24.0 or newer (5.33.3+ when refresh
   mode should read the refresh token from the httpOnly cookie).
2. Set `MAGIC_LINK_ENCRYPTION_KEY` and `MAGIC_LINK_OTP_PEPPER` (32+ characters
   each) on every host. If the old encryption key was shorter, or you used the
   development fallback, also set `MAGIC_LINK_ENCRYPTION_KEY_PREVIOUS` for the
   first start (see "Secrets are mandatory" below).
3. Remove WhatsApp/SMS fields from `send-link` calls and delete a leftover
   `.whatsapp-auth` directory.
4. Review admin roles: `access` became `read`, `manage`, `settings.read`,
   `settings.update`, `tokens.issue` and `settings.security` (roles with
   `access` get Read and Manage automatically; the others are never granted
   automatically).
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
* **Strapi 5.24.0 or newer** (`@strapi/strapi`, `@strapi/utils` and, new,
  `@strapi/plugin-users-permissions` peers `^5.24.0`). 5.24.0 is the first release with the users-permissions session
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
* **New `plugin::magic-link.settings.security` action** (*Settings > Security*).
  Changing a setting that can redirect login links (and the token in them),
  put the raw token into a template, or change who may log in and with which
  factors now needs it in addition to `settings.update`: `confirmationUrl`,
  `callback_url`, `frontend_url`, `frontend_login_path`, `login_path`,
  `passwordlessCompatibility`, `message_html`, `message_text`, the Email
  Designer / Magic Mail template fields, `enabled`, `createUserIfNotExists`,
  `user_creation_strategy`, `allow_magic_links_on_public_registration`,
  `verify_email`, `stays_valid`, `expire_period`, `token_length`,
  `use_jwt_token`, `jwt_token_expires_in`, `context_whitelist`,
  `context_blacklist`, `mfa_mode`, `mfa_require_totp`,
  `totp_as_primary_auth`, `otp_enabled`, `otp_strict_binding`, and the code
  and brute-force rules `otp_length`, `otp_expiry`, `otp_max_attempts`,
  `otp_resend_cooldown`, `totp_algorithm`, `totp_digits`, `totp_period`,
  `rate_limit_enabled`, `rate_limit_max_attempts`,
  `rate_limit_window_minutes`, `rate_limit_login_*`, and the sender identity
  `from_name`, `from_email` and `response_email`. Sending them unchanged is allowed. A refused save
  answers 403 (`error.details.key: settings.security.forbidden`, `fields`)
  and writes nothing. `reset-data` needs it as well (see "Follow-up fixes"
  below).
  Migration: the action is never granted automatically (Super Admin has
  it). Grant **Settings > Security** to the roles that should keep changing
  link targets, templates, account, MFA, code or rate-limit rules; roles
  with only `settings.update` keep subject, welcome-mail, login-info and TOTP
  issuer changes.
* **Optional `allowedLinkOrigins` plugin config.** When set
  (`config/plugins.js`, e.g. `['https://app.example.com']`), a changed
  `confirmationUrl`, `frontend_url` or `callback_url` outside these origins
  is rejected with 400 (`settings.linkOrigin.notAllowed`), whatever the
  admin's permissions.

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
  unverifiable requests now get a formatted 403 `PolicyError` with
  `error.details.code` `IP_ADDRESS_BLOCKED` or `IP_BAN_CHECK_UNAVAILABLE` (was a generic
  "Policy Failed").
* **IPv6 bans cover the /64.** Bans now match with the same granularity as
  the rate limits: IPv4 exactly, IPv6 per /64 network. Banning one IPv6
  address blocks every address of its /64; unbanning any address of that
  /64 removes all stored bans of it. Migration: review IPv6 entries in
  *IP bans*; an entry now also blocks its neighbours in the same /64.
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
* The always-on code-check limiter (`verify`, 10 checks per account and
  15 minutes) and the admin limiter are no longer cleared by
  `POST /rate-limit/reset` or by changing the public rate-limit values.
  Before, a role with `settings.update` could reset them in a loop and give
  unlimited guesses at TOTP, backup and e-mail codes. The reset now clears
  only the public limiters.
* Rate-limit admin endpoints no longer log or return limiter error details
  (a Redis error can contain the connection URL).
* A JWT session ended by an account claim can no longer be restored with
  `unrevoke-jwt` (400).
* `GET /otp/codes` accepts the `status` filter (`active`, `expired`, `used`)
  that the admin OTP tab sends. Before, the strict query schema rejected it
  with 400, so every status filter failed. The response also carries
  `stats` (`total`, `active`, `expired`, `used` over all codes), so the stat
  cards stay filled while a search or filter is active.
* `GET /jwt-sessions` adds `restoreBlock` per session (`expired`,
  `refreshMode`, `accountClaim` or `null`), with the same checks as
  `unrevoke-jwt`. Refresh-mode sessions cannot be restored because the
  users-permissions session manager deletes the session on revocation.
* `PUT /settings` and `POST /reset-data` reject security changes without
  `settings.security` with a `PolicyError` (403) that keeps `message` and
  `details` (`key: 'settings.security.forbidden'`, `fields`). Strapi replaced
  the previous `ForbiddenError` with a bare "Forbidden" and dropped the
  details, so the admin could not say what was refused.
* The IP-ban policy (`IP_ADDRESS_BLOCKED`) and `POST /magic-link/tokens`
  without `tokens.issue` (`tokens.issue.forbidden`) now throw a
  `PolicyError` (403) as well. Strapi 5.61's authorize middleware wraps the
  policies and the controller, so the previous `ForbiddenError` reached
  clients as a bare "Forbidden" with empty `details` (seen on a 5.61 host:
  a banned IP got `{"name":"ForbiddenError","message":"Forbidden","details":{}}`).
  Clients that read `error.details.code` or `error.details.key` now get it;
  `error.name` is `PolicyError`.

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

### BREAKING CHANGES (account claim)

* **Confirming an unconfirmed account clears its password.** When a magic
  link, an e-mail OTP or the TOTP enrolment during login confirms an
  account that was still unconfirmed, the plugin first ends every existing
  session of the account (plugin JWTs and, in refresh mode, all
  users-permissions refresh families), then confirms it with `password`,
  `resetPasswordToken` and `confirmationToken` set to null. This stops
  pre-account hijacking (someone registered the address with their own
  password before the owner). users-permissions refuses password login
  without a password. Migration: users who registered with a password and
  then used a magic link before confirming set a new password through
  "forgot password". Confirmed accounts are not changed.

### Security and fixes (login core)

* **No second login e-mail after a Magic Mail error.** With Magic Mail
  enabled, any Magic Mail error used to fall back to Email Designer or the
  Strapi e-mail plugin. Magic Mail 4.0 also routes the Strapi e-mail plugin,
  so a timeout could deliver two valid login links or OTP codes. Magic Link
  now falls back only when Magic Mail proves it sent nothing (no account,
  quota used up, account unavailable or misconfigured, template rendering
  failed, or a provider status that guarantees non-acceptance). Any other
  error is logged with its code only and returned to the caller. OTP mails
  through Magic Mail are now explicitly untracked as well. When Magic Mail
  is enabled but not installed, a warning says so and the next provider
  sends.
* **Revocation could be bypassed with an upper-case path.** Strapi 5.61
  mounts its routers with @koa/router defaults (`sensitive: false`), so
  `GET /API/users/me` reaches the same route as `/api/users/me`. The
  revocation middleware compared the path case-sensitively and skipped the
  check, so a revoked JWT kept working. The Content API and admin path
  checks now ignore case.

* **Refresh mode: revocation ends the whole refresh family.** @strapi/core
  5.61 rotates a refresh token into a new session id with the same device
  id; revoking only the first id left rotated tokens usable. The plugin now
  revokes by user and device id (`invalidateRefreshToken`), deleting the
  family including rotated rows; other devices stay logged in. Records from
  before the device id was stored can still only revoke the first token.
* **Refresh mode: access tokens of a revoked family are rejected.** While a
  user has a revoked family (until its maximum lifetime plus one
  access-token lifespan), the revocation middleware checks the
  users-permissions session (`isSessionActive`) of that user's access
  tokens: 401 when it is gone, 503 when the state cannot be read. Other
  users pay no lookup. Admin routes are never checked.
* **Legacy JWTs without `exp` stay revoked.** Revoking a JWT that never
  expires (users-permissions without `expiresIn`) now blocks it permanently
  instead of for 30 days.
* **Pending challenges re-check the current MFA policy.** An e-mail OTP no
  longer completes a login after MFA became required or the user enrolled
  an authenticator; re-opening the link starts the required challenge.
  Login-time TOTP enrolment is refused when the user already has an
  active authenticator.
* `Cache-Control: no-store` is now sent by every login, OTP and TOTP
  endpoint, including `send-link`, `otp/send`, `otp/resend`,
  `totp/status`, `totp/disable` and the admin TOTP status/disable routes.
* The built-in OTP, authenticator-confirmation and welcome mails are
  translated (de, en, es, fr, pt) from the request's `?locale=` or
  `Accept-Language` (FUN-27); custom login templates are unchanged.
* Multi-instance (AUTH-14) remains open: the session list, JWT blocklist
  and ban list are plugin-store blobs serialised per process only. See
  "Running behind a proxy or in a cluster" in the README.

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
* Login mails sent through Magic Mail are `transactional` and carry no
  open-tracking pixel and no tracked links (`enableTracking: false`).
* Sender falls back to the e-mail plugin `defaultFrom` instead of
  `noreply@example.com`; the default expiry text reads "1 hour".
* Server error messages are translated (de, en, es, fr, pt); unknown
  `?locale=` values fall back to English.
* Legacy-mode JWTs carry a random `jti`. Two logins of the same user within
  one second used to get byte-identical tokens, so revoking one session in
  the admin panel also ended the other.

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
  query (`page`, `pageSize` up to 1000, `email`, `type`, `status`), paginates on the
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

### Delivery status for login e-mails

* Every login link sent by e-mail now records whether the provider accepted
  it. The status is stored on the token: **sent** (accepted by the provider),
  **rejected** (the address or message was refused before acceptance, such
  as an SMTP 5xx reply, an HTTP 400/422 or an invalid recipient) or
  **failed** (connection, credentials, timeout or another provider error).
  It works with every send path, with or without Magic Mail: Magic Mail,
  Email Designer 5 and the Strapi e-mail plugin.
* Only a short reason code is stored, such as `SMTP_550`, `HTTP_400` or
  `ECONNECTION`, plus the send path and the time. Error messages, addresses,
  links and provider responses are never stored. The provider message id is
  kept server-side (private attribute) for bounce matching in a later
  release.
* The admin token list (`GET /magic-link/tokens`) returns `delivery_status`,
  `delivery_channel`, `delivery_reason` and `delivery_updated_at`. The token
  content type has five new optional attributes; existing rows show
  "Unknown". No migration is needed.
* Tokens view: a delivery badge under the reference, a "Delivery" filter and
  the reason and send path in the token details.
* "Sent" means the provider accepted the message, not that it reached the
  inbox. Login e-mails still carry no open or click tracking.

### Bounces and spam complaints for login e-mails

* Tokens move from **sent** to **bounced** or **complained** when the
  provider reports a hard bounce or a spam complaint. Two new values in
  `delivery_status`; existing rows are unchanged.
* With Magic Mail (4.2+): Magic Link listens to Magic Mail's signed
  provider webhooks (`magic-mail.delivery.bounced|complained` on
  `strapi.eventHub`). Nothing to configure in Magic Link.
* Without Magic Mail: new public route
  `POST /api/magic-link/delivery-webhooks/:provider` for SendGrid (Signed
  Event Webhook, ECDSA), Mailgun (HMAC signing key), Amazon SES through SNS
  (certificate from an SNS host over HTTPS, allowed topic ARNs, automatic
  SubscriptionConfirmation) and Postmark (HTTP Basic auth). Each provider is
  off until its secret is set in `config/plugins.js` (`deliveryWebhooks`) or
  the matching `MAGIC_LINK_WEBHOOK_*` environment variable; secrets are never
  stored in the admin settings.
* Requests are checked against a one-hour timestamp window, replays are
  ignored, the route is rate limited (600 per minute and IP) and covered by
  the IP-ban policy, bodies above 512 KB are refused and every failure
  returns the same 401 without detail. Feedback is matched only by the
  provider message id; addresses are never looked up or stored.
* Tokens view: red "Bounced" and "Spam complaint" badges and filter options.

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
* Tokens list (browser acceptance at 320 to 1440 px, light and dark):
  * the view, extend and delete buttons in a row work with Enter and Space
    (the design-system table cell cancelled the native key activation), and
    they stay in fixed columns when a token cannot be extended;
  * dialogs return focus to the row, the search field or "New token" when
    the element that opened them is gone (deleted row, closed details or
    create dialog);
  * the misleading "New user" line under every e-mail is gone (tokens have
    no user relation);
  * white text on the header, tab, button and dialog gradients and the status
    badges reach 4.5:1;
  * no orphan stat card, no horizontal table scrolling from 1024 px, no
    clipped header buttons at 320 px, a compact pagination with "Page x of y"
    below 520 px, and 32 px touch targets for the search clear button and the
    page links on phones.
* OTP codes, JWT sessions and IP bans (browser acceptance at 320 to 1440 px,
  light and dark):
  * the row actions are reachable with the arrow keys again (the select-all
    cell kept the grid focus), and Space and Enter activate them;
  * Restore is disabled with the reason for expired, refresh-mode and
    account-claim sessions instead of failing with an error;
  * the Ban IP dialog and the confirm dialogs return focus to their opener,
    or to the search field when the row is gone;
  * the status badges reach 4.5:1 (the design-system warning and danger
    badges are 3.6:1 and 3.9:1), the table has one frame with the header
    band at full width, rows line up with the filter bar, and checkboxes and
    page links are 24 px (32 px on phones);
  * no horizontal table scrolling from 1024 px, phone cards without a
    second frame, wrapped IPv6 addresses and no sticky hover tint on touch;
  * the IP placeholder uses a documentation address (203.0.113.10).
* Settings and License (browser acceptance at 320 to 1440 px, light and dark):
  * a refused save highlights and focuses the fields: link URLs outside
    `allowedLinkOrigins` and security fields changed without
    `settings.security` now get a field message instead of only a toast;
  * "Save" and "N fields need attention" move focus to the first invalid
    field also when its section is already open, and focus returns to the
    field (Enter) or the section header after a save or a discard instead of
    falling to the page body;
  * a section with invalid fields shows "Fields to fix" in its header (the
    design-system accordion never rendered the old description text);
  * the template gallery cards fill their grid cells (equal widths);
  * the "Unsaved changes" badge reaches 4.8:1 (design-system warning badge:
    3.6:1), and the License key buttons 5.4:1 (white frost: 3.6:1);
  * the sign-in mode cards are named by their title and described by their
    text.
* All texts are translated into English, German (formal), French, Spanish
  and Portuguese, and dates follow the admin locale. A test now checks that
  every message id used by the admin exists in all five locales.

### BREAKING CHANGES (follow-up fixes, 2026-11-07)

* **`POST /magic-link/reset-data` needs `settings.security`.** A reset
  deletes every login token, the JWT session list and all IP bans and resets
  link targets, templates, sender and code rules, so `settings.update` alone
  no longer allows it (403, `error.details.key: settings.security.forbidden`).
  The `securitySettingsKept` response field is gone. Migration: grant
  **Settings > Security** to the roles that run resets.
* **Sender identity is a security setting.** Changing `from_name`,
  `from_email` or `response_email` needs `settings.security` in addition to
  `settings.update`: the login mail carries the login link, so who it claims
  to come from matters. Sending them unchanged is still allowed.
* **`mfa_mode: "required"` is refused while nobody is enrolled.** The settings
  API answers 400 (`error.details.key: settings.mfa.noEnrolledUsers`,
  `fields: ["mfa_mode"]`) when MFA would become required (also through the
  legacy `mfa_require_totp`) and no end user has an active authenticator.
  Send `acknowledgeNoEnrolledUsers: true` with the update when your landing
  page handles `requiresTOTPSetup`; the flag is never stored.
* **`max_login_attempts` is removed.** It was validated but never read; the
  login limiter uses `rate_limit_login_max_attempts`. A stored or sent value
  is dropped.

### Security and fixes (follow-up, 2026-11-07)

* `send-link` keys its e-mail rate limiter with a hash of the normalised
  address, like the OTP and TOTP paths, so no address is kept in limiter
  memory and case variants share one bucket.
* Admin: the Tokens, Settings and License pages no longer show "no
  permissions" to a Super Admin after a full page reload. Strapi 5.61
  `useRBAC` could check while the admin permissions were still loading,
  settle with nothing allowed and never re-check; unconditioned grants from
  the loaded admin permissions now count.
* Admin: arrow keys in the Tokens table no longer get stuck on the
  select-all header cell.
* Docs: refresh mode works from Strapi 5.24.0; Strapi's own
  `/api/auth/refresh` reads the httpOnly refresh cookie only from 5.33.3.

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
