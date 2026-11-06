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

test("settings UI explains invalid JWT expiry and prevents submission before the API request", () => {
  const settings = readSource("admin/src/pages/Settings/SettingsModern.jsx");

  assert.ok(
    /if \(!settingsFormValid\) return;/.test(settings),
    "save handler guards the API request",
  );
  assert.ok(
    /disabled=\{isSaving \|\| isPermissionLoading \|\| !canWriteSettings \|\| !settingsFormValid\}/.test(
      settings,
    ),
    "invalid input disables Save Changes",
  );
  assert.ok(
    /aria-invalid=\{!jwtExpiryValid\}/.test(settings),
    "input exposes its validation state",
  );
  assert.ok(
    settings.includes("settings.auth.jwtExpiration.invalid"),
    "the field shows a localized correction",
  );
  assert.ok(
    /aria-invalid=\{!fromEmailValid\}/.test(settings),
    "sender email input exposes its validation state",
  );
  assert.ok(
    /aria-invalid=\{!responseEmailValid\}/.test(settings),
    "reply email input exposes its validation state",
  );
  assert.ok(
    settings.includes("!settingsFormValid"),
    "Save Changes is unavailable while an email field is invalid",
  );
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
