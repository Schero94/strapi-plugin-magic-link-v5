'use strict';

const service = require('./service');
const magicLink = require('./magic-link');
const store = require('./store');
const rateLimiter = require('./rate-limiter');
const otp = require('./otp');
const deliveryFeedback = require('./delivery-feedback');

module.exports = {
  service,
  'magic-link': magicLink,
  magicLink, // Alias für Kompatibilität
  store,
  'rate-limiter': rateLimiter,
  rateLimiter, // Alias für Kompatibilität
  otp,
  'delivery-feedback': deliveryFeedback,
};
