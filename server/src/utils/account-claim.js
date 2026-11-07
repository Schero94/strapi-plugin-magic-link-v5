'use strict';

/**
 * Pre-account hijacking defence.
 *
 * With users-permissions e-mail confirmation on, anyone can register
 * `victim@example.test` at /api/auth/local/register with a password of their
 * choice; the account stays unconfirmed. When the real mailbox owner later
 * logs in with a magic link or an e-mail OTP, Magic Link confirms the
 * account (the link or code proves the mailbox). Without this defence the
 * attacker's password would then work on the now-confirmed account.
 *
 * When a login confirms an unconfirmed account, `claimUnconfirmedAccount`
 * therefore first ends every existing session of the account (plugin JWTs
 * and, in refresh mode, all users-permissions refresh families) and then
 * confirms it with the password, reset token and confirmation token cleared.
 * users-permissions /auth/local refuses accounts without a password, so the
 * owner sets one through "forgot password" if they want password login.
 *
 * Docs checked (2026-11-07): installed @strapi/plugin-users-permissions 5.61
 * server/src/controllers/auth.js (callback refuses `!user.password`,
 * emailConfirmation clears confirmationToken), services/user.js edit()
 * (Document Service update) and @strapi/core 5.61
 * services/document-service/attributes/transforms.js (only string passwords
 * are hashed; null is stored as null).
 */

const CLAIM_REASON = 'Unconfirmed account claimed by the e-mail owner';

/**
 * Confirms an unconfirmed account after the e-mail owner proved the
 * mailbox, ending all earlier sessions and invalidating the password.
 * Confirmed accounts are left untouched.
 *
 * @param {object} strapi - Strapi instance.
 * @param {object} user - users-permissions user (mutated: confirmed, password).
 * @returns {Promise<boolean>} Whether the account was claimed now.
 */
const claimUnconfirmedAccount = async (strapi, user) => {
  if (!user || user.confirmed) return false;

  await strapi.plugin('magic-link').service('magic-link').revokeUserSessions(user.id, CLAIM_REASON);
  await strapi.plugin('users-permissions').service('user').edit(user.id, {
    confirmed: true,
    password: null,
    resetPasswordToken: null,
    confirmationToken: null,
  });
  user.confirmed = true;
  user.password = null;
  user.resetPasswordToken = null;
  user.confirmationToken = null;
  strapi.log.info(
    '[magic-link] Unconfirmed account confirmed by its e-mail owner; earlier sessions and the password were invalidated'
  );
  return true;
};

module.exports = { claimUnconfirmedAccount, CLAIM_REASON };
