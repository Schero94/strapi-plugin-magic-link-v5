---
name: strapi-plugin-maintenance
description: Maintain the Magic Link v5 Strapi 5 plugin and test passwordless login, OTP, MFA, permissions and admin UI safely.
---

# Magic Link v5 maintenance

Use Node 22 (the package declares an upper bound). Verify current Strapi 5 and Plugin SDK docs with Context7, check the newest compatible 5.x against the workbench pin, and inspect local rules. Keep login credentials, OTP secrets, TOTP seeds, encryption keys, cookies and Playwright auth state out of skill text and Git. Never push without an explicit request.

Inspect `server/src/routes/content-api.js`, `compatibility.js`, `admin.js`, auth/OTP controllers and `admin/src/permissions.js`. Public login, send-link, OTP and MFA routes are intentional: test generic responses for unknown users, token expiry/replay, throttling, binding to identity and no sensitive data in logs. Build an access matrix for anonymous, authenticated user, admin lacking permission, allowed admin, owner and other user. Ensure settings, tokens, IP bans and MFA management have server-side checks; menu gating is supplementary. Avoid actually sending mail/WhatsApp during the shared-app smoke.

For UI changes, first read the workbench root skill's `references/ui-ux-standards.md`; it defines the shared responsive, alignment, readable-copy, accessibility and Playwright acceptance checks. Check Strapi 5 Design System form labels, keyboard/focus, validation, loading/error states and desktop/mobile screens with Playwright CLI. Run `npm run lint`, `npm run build`, `npm run verify`, then shared app build/boot and negative-access tests. The local workbench installer adds missing UI peers without changing the tracked manifest; report peer compatibility separately.

## Shared product quality contract

Use spec-first development: define acceptance criteria and API response/error contracts before implementation.

Follow the detailed JSDoc contract in the always-applied plugin rule for new and substantially changed exported or non-trivial functions, handlers, services, hooks, middleware, policies and components. Document purpose, context, applicable `@param` and `@returns`, and only actually propagated `@throws`. Verify HTTP `@route`, access, inputs and outcomes against the implementation; describe applicable mutations and security/privacy effects with `@sideeffect`. These are custom tags; respect configured tools, never invent behavior, and update comments when contracts change.

Every behavior change starts with a written current-state and target-state analysis covering screens, controls, routes, roles, data, known gaps and non-goals. Define acceptance criteria and API response/error contracts before implementation, then add a failing regression test first. A primary task should take no more than four meaningful user interactions from the plugin entry page; exclude login and mandatory security confirmations, and measure and document any justified exception. Use the Strapi Design System, responsive layouts, keyboard accessibility and explicit loading, empty, success and error states. Enforce authentication, plugin permissions, validation and owner boundaries server-side. Keep API error contracts consistent within each Strapi surface and never return stack traces or internal details. Do not log secrets, tokens, cookies, request bodies, email, IP or stable user/session identifiers. Use fakes for providers and record unverified behavior accurately.
