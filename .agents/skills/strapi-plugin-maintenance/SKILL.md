---
name: strapi-plugin-maintenance
description: Maintain the Magic Link v5 Strapi 5 plugin and test passwordless login, OTP, MFA, permissions and admin UI safely.
---

# Magic Link v5 maintenance

Use Node 22 (the package declares an upper bound). Verify current Strapi 5 and Plugin SDK docs with Context7, check the newest compatible 5.x against the workbench pin, and inspect local rules. Keep login credentials, OTP secrets, TOTP seeds, encryption keys, cookies and Playwright auth state out of skill text and Git. Never push without an explicit request.

Inspect `server/src/routes/content-api.js`, `compatibility.js`, `admin.js`, auth/OTP controllers and `admin/src/permissions.js`. Public login, send-link, OTP and MFA routes are intentional: test generic responses for unknown users, token expiry/replay, throttling, binding to identity and no sensitive data in logs. Build an access matrix for anonymous, authenticated user, admin lacking permission, allowed admin, owner and other user. Ensure settings, tokens, IP bans and MFA management have server-side checks; menu gating is supplementary. Avoid actually sending mail/WhatsApp during the shared-app smoke.

Check Strapi 5 Design System form labels, keyboard/focus, validation, loading/error states and desktop/mobile screens with Playwright CLI. Run `npm run lint`, `npm run build`, `npm run verify`, then shared app build/boot and negative-access tests. The local workbench installer adds missing UI peers without changing the tracked manifest; report peer compatibility separately.
