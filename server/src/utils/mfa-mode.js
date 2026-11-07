'use strict';

const MFA_MODES = new Set(['disabled', 'optional', 'required']);

/**
 * Resolves the effective MFA policy, honoring the legacy required-TOTP flag.
 *
 * Older Settings UI versions persisted `mfa_require_totp` while leaving the
 * explicit `mfa_mode` at `disabled`. Treating that stale value as authoritative
 * silently bypassed the administrator's required second factor.
 *
 * @param {object} settings - Persisted Magic Link settings.
 * @returns {'disabled'|'optional'|'required'} The effective TOTP policy.
 */
function resolveMfaMode(settings = {}) {
  if (settings.mfa_require_totp === true) return 'required';
  return MFA_MODES.has(settings.mfa_mode) ? settings.mfa_mode : 'disabled';
}

/**
 * Copies settings while keeping the current and legacy MFA flags consistent.
 *
 * @param {object} settings - Settings object to normalize.
 * @param {object} [patch] - Fields explicitly sent in a settings update.
 * @returns {object} A new settings object with a canonical MFA mode.
 */
function normalizeMfaSettings(settings = {}, patch) {
  let mfa_mode = resolveMfaMode(settings);

  if (patch?.mfa_require_totp === true) {
    mfa_mode = 'required';
  } else if (patch && MFA_MODES.has(patch.mfa_mode)) {
    mfa_mode = patch.mfa_mode;
  } else if (patch?.mfa_require_totp === false) {
    mfa_mode = 'disabled';
  }

  return {
    ...settings,
    mfa_mode,
    mfa_require_totp: mfa_mode === 'required',
  };
}

module.exports = { normalizeMfaSettings, resolveMfaMode };
