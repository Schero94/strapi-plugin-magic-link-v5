# Magic Link overhaul gates

Existing uncommitted work is part of the baseline and must be preserved and reviewed before any commit.

- [ ] A1: Inventory every public and admin route, role boundary, UI control, provider call, data mutation, error contract and existing test. Record unresolved risks.
      STATUS: partial. Routes, role boundaries and error contracts are covered by `tests/admin-function-map.test.cjs`, `verify:runtime` and the README route and error tables; open risks are listed under "Open risks" below. No single inventory document exists.
- [x] A2: Verify current Strapi, plugin SDK, design system and direct dependency documentation and versions. Record compatibility and audit evidence.
      EVIDENCE: installed @strapi/core, @strapi/admin and @strapi/plugin-users-permissions 5.61.0, @strapi/design-system 2.2.4, jsonwebtoken 9.0.3 and otplib 13.6.0 sources read; listed in the bodies of commits e1a19b5, f63d203, 2100678, 8315dd2, 40b1205, 782bde7 and 9954a52.
- [x] S1: Isolate TOTP identities by principal type, define a safe legacy migration and prevent account collisions. Prove owner isolation, replay and failure behavior with regression tests.
      EVIDENCE: `tests/mfa-totp.test.cjs` (S-01 equal-id test, replay), `tests/mfa-enrollment.test.cjs`; status in `docs/security-review-2026-11-06.md`.
- [x] S2: Review and fix authentication, authorization, token lifecycle, validation, privacy logging and provider failure cases with negative and success tests.
      EVIDENCE: `tests/security-open-items.test.cjs`, `tests/security-reattack-2026-11-07.test.cjs`, `tests/security-review-hardening.test.cjs`; HTTP acceptance on an isolated Strapi 5.61 host: 184 steps, 0 failures (legacy and refresh mode).
- [x] D1: Upgrade compatible dependencies and resolve or document remaining audit findings without forcing incompatible major versions.
      EVIDENCE: `npm audit --omit=dev` (2026-11-07, exit 1) reports 2 high entries, both GHSA-mrhx-c7xc-m3w5 via `@strapi/utils` 5.61 (nested zod 4.4.3). npm's only fix is a Strapi 4 downgrade, so it is documented in the README with a host-side `overrides` workaround. The plugin's own zod is 4.6.7.
- [x] U1: Preserve the Strapi design and verify every safe admin journey with Playwright CLI at desktop and mobile widths, including keyboard, errors and overflow.
      EVIDENCE: browser acceptance with Playwright (MCP browser, not the CLI) of Tokens, OTP codes, JWT sessions, IP bans, Settings and License at 1440/1280/1080/1024/768/520/390/320 px, light and dark: no document overflow, keyboard walk, dialogs return focus, contrast at least 4.5:1. Commits 8315dd2, 132a149, 40b1205 and 782bde7.
- [x] R1: Correct README and GitHub Pages against verified API contracts and security limitations.
      EVIDENCE: README, `docs/site/index.html` and CHANGELOG [Unreleased] checked against the code in the final review (2026-11-07). The Pages deployment itself is not verified (see P1).
- [x] V1: Plugin tests, lint, build and SDK/runtime verification pass.
      CHECK: npm test && npm run build && npm run verify
      EXPECT: # fail 0
      EVIDENCE (final review, 2026-11-07): npm run lint exit 0; npm run format:check "All matched files use Prettier code style!"; npm test "# tests 339 # pass 339 # fail 0"; npm run build exit 0; npm run verify exit 0; npm run verify:runtime exit 0; npm pack --dry-run exit 0 (37 files, 459.0 kB packed, README, CHANGELOG and LICENSE included). The review host, redeployed with this build, answers a banned IP with `403 PolicyError` and `details.code: "IP_ADDRESS_BLOCKED"` (before: bare "Forbidden", empty details).
- [ ] V2: Shared host builds and boots with the target Strapi version; authenticated UI and negative-access checks are evidenced.
      STATUS: not done on the shared workbench host. An isolated Strapi 5.61.0 review host (SQLite, NODE_ENV=production, local mail capture) was booted from an `npm pack` tarball, with authenticated UI checks and negative-access checks (an admin role without `settings.security`, a read-only role).
- [ ] P1: Review all existing and new changes, commit only intended work, push, and verify GitHub Actions and Pages deployment.
      STATUS: committed on `claude/magiclink-overhaul`, not pushed (by instruction). GitHub Actions and the Pages deployment are not verified.

## Open risks (documented, not fixed)

- AUTH-14: in a cluster, concurrent admin writes to the session list, blocklist and ban list can overwrite each other; each instance caches the blocklist for up to 2 s.
- `reset-data` deletes the session list and the IP bans with `settings.update` only; `from_email` and `response_email` are not security-gated.
- `/login-totp` keeps a small database-timing difference between unknown and known accounts.
- The server does not refuse `mfa_mode: required` when nobody has enrolled an authenticator (only the admin UI blocks it).
- `send-link` uses the raw e-mail address as rate-limiter key, so with `rateLimit.redis` addresses are stored in clear as Redis keys.
- `max_login_attempts` is validated and security-gated but read nowhere.
- A full page load of `/admin/plugins/magic-link/tokens` sometimes showed "no permissions" to a Super Admin (3 of about 6 reloads, likely `useRBAC` running before the permissions load). Not fixed.
- The tests use koa and @koa/router as transitive dependencies of the Strapi dev dependencies.
