# Security review in progress

This is an initial source review, not a completed security audit. Existing uncommitted changes were present before this review and are included in the inspected baseline.

## S-01: TOTP principal identity collision

Severity: high, pending runtime reproduction. Admin TOTP setup uses `ctx.state.user.id` in `server/src/controllers/otp.js`, while public login uses a Users & Permissions user's numeric ID in `server/src/controllers/auth.js`. The TOTP service selects configurations by `userId` alone in `server/src/services/otp.js`, and the schema makes that integer unique in `server/src/content-types/totp-config/schema.json`.

Admin users and Users & Permissions users are separate principals and can have the same numeric ID. A TOTP secret enrolled by an admin could therefore be applied to a different end user during login. The same ambiguity prevents safely assigning legacy records to a principal type based on ID alone. Existing setups must not be silently migrated to an assumed owner. Tests must cover equal numeric IDs across both principal types and legacy records, and the migration must fail closed where ownership cannot be established.

The plugin currently has no owner-bound end-user TOTP enrollment route. Required MFA can lock out users who have not enrolled. Review enrollment, recovery and compatibility as one security contract before enabling that flow.

## S-02: Personal data in TOTP service logs

The TOTP service logs numeric user IDs and, on setup, an email address in `server/src/services/otp.js`. Replace these with non-identifying operation messages and test that secrets and personal data are not logged.

## Dependency baseline

On 2026-11-06, `npm audit --omit=dev` reported two high-severity entries: `@strapi/utils` and its nested `zod`, associated with GHSA-mrhx-c7xc-m3w5. npm proposed a Strapi 4 downgrade; that is not an acceptable automatic fix for this Strapi 5 plugin. Assess the current compatible upstream versions and actual exposure before selecting remediation. The full audit reported 87 entries, including development dependencies; these counts are not a claim that every advisory is exploitable in production.
