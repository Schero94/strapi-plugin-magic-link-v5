"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("JWT expiry validation matches the settings API format and length bound", async () => {
  const { isValidJwtExpiry } =
    await import("../admin/src/utils/settingsValidation.mjs");

  for (const value of ["1h", "7d", "30d", "90d"]) {
    assert.equal(isValidJwtExpiry(value), true, `${value} should be accepted`);
  }
  for (const value of [
    "",
    "invalid",
    "30m",
    "30D",
    "1 d",
    `${"1".repeat(16)}d`,
    null,
  ]) {
    assert.equal(
      isValidJwtExpiry(value),
      false,
      `${String(value)} should be rejected`,
    );
  }
});

test("optional settings email validation matches the server-side address bounds", async () => {
  const { isValidOptionalEmail } =
    await import("../admin/src/utils/settingsValidation.mjs");

  assert.equal(isValidOptionalEmail(""), true);
  assert.equal(isValidOptionalEmail("  support@example.com  "), true);
  assert.equal(isValidOptionalEmail("invalid-address"), false);
  assert.equal(isValidOptionalEmail(`a@${"b".repeat(316)}.com`), false);
  assert.equal(isValidOptionalEmail(null), false);
});

test("settings UI explains invalid fields and prevents submission before the API request", () => {
  const settings = readSource("admin/src/pages/Settings/SettingsModern.jsx");
  const auth = readSource("admin/src/pages/Settings/sections/AuthSection.jsx");
  const email = readSource("admin/src/pages/Settings/sections/EmailSection.jsx");

  const save = settings.slice(settings.indexOf("const handleSave"), settings.indexOf("put('/magic-link/settings'"));
  assert.ok(
    /if \(!settingsFormValid\) \{\s*focusField\(errorKeys\[0\]\);/.test(save),
    "save handler focuses the first invalid field instead of sending the request",
  );
  assert.ok(
    settings.includes("settings.auth.jwtExpiration.invalid"),
    "the field shows a localized correction",
  );
  assert.ok(settings.includes("settings.email.invalidEmail"), "email errors are localized");
  // DS Field.Root wires error -> aria-invalid and aria-describedby.
  assert.ok(/name="jwt_token_expires_in"[\s\S]*?error=\{errorFor\('jwt_token_expires_in'\)\}/.test(auth));
  assert.ok(/name="from_email"[\s\S]*?error=\{errorFor\('from_email'\)\}/.test(email));
  assert.ok(/name="response_email"[\s\S]*?error=\{errorFor\('response_email'\)\}/.test(email));
  assert.ok(settings.includes("settings.errors.summary"), "the sticky bar names fields that need attention");
});

test("JWT expiry and email validation messages exist in every supported locale", () => {
  for (const locale of ["de", "en", "es", "fr", "pt"]) {
    const messages = JSON.parse(
      readSource(`admin/src/translations/${locale}.json`),
    );
    assert.ok(
      messages["magic-link.settings.auth.jwtExpiration.invalid"],
      `${locale} JWT expiry message`,
    );
    assert.ok(
      messages["magic-link.settings.email.invalidEmail"],
      `${locale} email validation message`,
    );
  }
});
