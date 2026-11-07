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

- AUTH-14: fixed on `feat/multi-instance` (cluster-wide database locks for every plugin-store write, shared database rate limits, leased jobs; see README "Running several instances"). Remaining by design: each instance caches the blocklist for up to 2 s and the rate-limit settings for up to 5 s. MySQL is covered by unit tests only, not by a live multi-process run.
- `reset-data` deletes the session list and the IP bans with `settings.update` only; `from_email` and `response_email` are not security-gated.
- `/login-totp` keeps a small database-timing difference between unknown and known accounts.
- The server does not refuse `mfa_mode: required` when nobody has enrolled an authenticator (only the admin UI blocks it).
- `send-link` uses the raw e-mail address as rate-limiter key, so with `rateLimit.redis` addresses are stored in clear as Redis keys.
- `max_login_attempts` is validated and security-gated but read nowhere.
- A full page load of `/admin/plugins/magic-link/tokens` sometimes showed "no permissions" to a Super Admin (3 of about 6 reloads, likely `useRBAC` running before the permissions load). Not fixed.
- The tests use koa and @koa/router as transitive dependencies of the Strapi dev dependencies.

## 7.0.0: no registration key, no telemetry, install and docs (branch `chore/finish-free-docs`, 2026-11-07)

Host for every HTTP and browser count below: isolated Strapi 5.61.0, SQLite, port 1409, Node 22.23.1, plugin installed from `npm pack` of this branch, egress blocked (`block-egress.cjs`), synthetic admin `review-admin@example.test` with a generated password.

- [x] F1: The License page, its settings link, `LicenseGuard`, the `license` controller and routes, the `license-guard` service, the `remoteLookup` switch, every call to the old key server and all license translations are gone; the server makes no outbound call of its own.
      CHECK: `node --test tests/no-license.test.cjs`
      EVIDENCE: 2026-11-07, 9 of 9 pass (source scan decodes JSON, so `\u` escapes cannot hide a key). Built `dist/` contains no `fitlex`, `magicapi`, `license-guard` or `remoteLookup`. Host log after start and restart: zero "Egress blocked" lines.
- [x] F2: Stored 6.x keys are deleted once at bootstrap, under a cluster lock, without logging the value.
      EVIDENCE: unit test in `tests/no-license.test.cjs`; host: synthetic `licenseKey` and `lastValidated` rows inserted, restart logged `[magic-link] Removed 2 unused plugin-store key(s) from 6.x`, rows gone, synthetic key string absent from the log. `npm run test:cluster` with SQLite and with PostgreSQL 16 (127.0.0.1:5440, throwaway database dropped afterwards): "legacy keys: 2 rows deleted once by 8 processes", every other scenario passes.
- [x] F3: Admin after removal.
      EVIDENCE: Playwright (own headless Chromium, no shared MCP browser), Super Admin: the Magic Link settings section has one link (`/admin/settings/magic-link/config`); `/admin/settings/magic-link/license` renders no plugin page; with an admin token `GET /magic-link/license/status` 404, `POST /magic-link/license/store-key` 405, `GET /magic-link/settings` 200, `GET /magic-link/tokens` 200. Settings and Tokens at 1440/1024/390/320, light and dark: document overflow 0, elements outside viewport 0, clipped text 0. measure.js reports 2 low-contrast items on Tokens in light mode (header text over the brand gradient); the check cannot read gradients, the gradient stops are documented at >= 4.5:1 in `admin/src/utils/theme.js`. Console errors only from the test's own aborted external requests and the deliberate 404/405/401 probes.
- [x] I1: No plugin-caused install warnings in a fresh Strapi 5.61 app (create-strapi-app 5.61.0 dependency set, `--ignore-scripts`).
      EVIDENCE: yarn 1.22.22: 6.2.1 printed 4 plugin warnings (unmet peers `@strapi/design-system`, `@strapi/icons`, `@strapi/utils`, `react-intl`; 30 warnings total), this branch 0 (26 total, all Strapi's own). npm 11.21.2: 0 plugin warnings before and after (5 deprecation warnings, same as the app without the plugin). pnpm 12.18.0: 0 plugin warnings before and after; `pnpm peers check` lists only Strapi's `codemirror` peer, same as without the plugin; `strapi build` succeeds under pnpm with the optional peers. Pitfall: yarn 1 caches a local tarball by name and version, so the candidate was installed as `7.0.0-candidate.1` after removing the cached 6.2.1 entry.
- [x] P1: package.json metadata.
      EVIDENCE: `npm pkg fix` (npm 11.21.2) leaves the file unchanged; `npm publish --dry-run` of the packed candidate prints no normalisation warning; homepage is the Pages URL.
- [x] D1: README and Pages.
      EVIDENCE: workbench `check-plugin-pages.mjs` (copy pointed at this worktree): valid; `site.css` identical to `templates/plugin-pages/site.css`. Site at 320/390/1024/1440, light and dark: overflow 0, no broken image, no console error, Tab reaches the skip link first and it moves to `#main-content`. 29 external links checked: all 200 except npmjs.com (403 to scripted clients; the package page exists). Every README and site anchor resolves. Settings screenshots retaken without the License link (synthetic host above).
- [x] V1: Gates.
      CHECK: npm run lint && npm run format:check && npm test && npm run build && npm run verify && npm pack --dry-run
      EVIDENCE: lint exit 0, format "All matched files use Prettier code style!", tests 410 / pass 410 / fail 0, build and verify:runtime exit 0, `strapi-plugin verify` exit 0, pack 33 files, 499.1 kB packed (6.2.1: 517.8 kB).
- [ ] R1: Release. Not pushed, not merged. The commit carries a `BREAKING CHANGE:` footer, so semantic-release will publish 7.0.0 when it lands on `main`; that needs the owner's yes.
