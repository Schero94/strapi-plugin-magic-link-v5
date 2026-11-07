'use strict';

/**
 * Controllers
 */
const controller = require('./controller');
const auth = require('./auth');
const tokens = require('./tokens');
const jwt = require('./jwt');
const rateLimit = require('./rate-limit');
const otp = require('./otp');
const totp = require('./totp');
const deliveryWebhooks = require('./delivery-webhooks');

module.exports = {
  controller,
  auth,
  tokens,
  jwt,
  rateLimit,
  otp,
  totp,
  deliveryWebhooks,
};
