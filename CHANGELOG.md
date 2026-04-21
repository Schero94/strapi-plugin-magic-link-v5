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
