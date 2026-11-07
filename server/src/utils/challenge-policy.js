'use strict';

/**
 * Second-factor policy shared by login start and challenge completion.
 *
 * A login challenge is stored on the token when the link is opened. The MFA
 * policy (settings, or the user's own authenticator) can change while it is
 * pending. Every completion endpoint therefore re-checks the CURRENT policy
 * with `challengeSatisfiesPolicy`: a challenge may be completed when it is at
 * least as strong as what the policy requires now. A weaker pending
 * challenge is refused; re-opening the link starts the required one.
 *
 * Strength: TOTP (and enrolling one) > e-mail OTP > none.
 */

const { resolveMfaMode } = require('./mfa-mode');

/**
 * Returns the challenge the current policy requires for a user.
 *
 * @param {object} otpService - Plugin OTP service (getTOTPStatus).
 * @param {object} settings - Current plugin settings.
 * @param {number|string} userId - users-permissions user id.
 * @returns {Promise<'totp'|'totp-setup'|'otp'|null>} Required challenge.
 */
const requiredChallenge = async (otpService, settings, userId) => {
  const mfaMode = resolveMfaMode(settings || {});
  if (mfaMode !== 'disabled') {
    const status = await otpService.getTOTPStatus(userId);
    if (status?.configured && status?.enabled) return 'totp';
    if (mfaMode === 'required') return 'totp-setup';
  }
  if (settings?.otp_enabled === true) return 'otp';
  return null;
};

/**
 * Whether completing a pending challenge still satisfies the policy.
 *
 * - Nothing required: any challenge may complete.
 * - TOTP verification is the strongest factor and always satisfies (the TOTP
 *   endpoint itself refuses users without an active authenticator).
 * - Enrolling an authenticator satisfies "e-mail OTP" or "enrol", but not
 *   "verify the authenticator you already have" (that would replace it).
 * - An e-mail OTP only satisfies an e-mail OTP requirement.
 *
 * @param {'otp'|'totp'|'totp-setup'} pendingType - Pending challenge type.
 * @param {'otp'|'totp'|'totp-setup'|null} required - requiredChallenge() result.
 * @returns {boolean} Whether the challenge may complete.
 */
const challengeSatisfiesPolicy = (pendingType, required) => {
  if (!required || pendingType === required) return true;
  if (pendingType === 'totp') return true;
  if (pendingType === 'totp-setup') return required === 'otp';
  return false;
};

module.exports = { requiredChallenge, challengeSatisfiesPolicy };
