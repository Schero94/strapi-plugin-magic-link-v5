# Magic Link overhaul gates

Existing uncommitted work is part of the baseline and must be preserved and reviewed before any commit.

- [ ] A1: Inventory every public and admin route, role boundary, UI control, provider call, data mutation, error contract and existing test. Record unresolved risks.
- [ ] A2: Verify current Strapi, plugin SDK, design system and direct dependency documentation and versions. Record compatibility and audit evidence.
- [ ] S1: Isolate TOTP identities by principal type, define a safe legacy migration and prevent account collisions. Prove owner isolation, replay and failure behavior with regression tests.
- [ ] S2: Review and fix authentication, authorization, token lifecycle, validation, privacy logging and provider failure cases with negative and success tests.
- [ ] D1: Upgrade compatible dependencies and resolve or document remaining audit findings without forcing incompatible major versions.
- [ ] U1: Preserve the Strapi design and verify every safe admin journey with Playwright CLI at desktop and mobile widths, including keyboard, errors and overflow.
- [ ] R1: Correct README and GitHub Pages against verified API contracts and security limitations.
- [ ] V1: Plugin tests, lint, build and SDK/runtime verification pass.
  CHECK: npm test && npm run build && npm run verify
  EXPECT: # fail 0
- [ ] V2: Shared host builds and boots with the target Strapi version; authenticated UI and negative-access checks are evidenced.
- [ ] P1: Review all existing and new changes, commit only intended work, push, and verify GitHub Actions and Pages deployment.
