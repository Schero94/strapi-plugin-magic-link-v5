'use strict';

const service = require('./service');
const magicLink = require('./magic-link');
const store = require('./store');
const licenseGuard = require('./license-guard');
const rateLimiter = require('./rate-limiter');
const otp = require('./otp');
const whatsapp = require('./whatsapp');

module.exports = {
  service,
  'magic-link': magicLink,
  magicLink, // Alias für Kompatibilität
  store,
  'license-guard': licenseGuard,
  licenseGuard, // Alias für Kompatibilität
  'rate-limiter': rateLimiter,
  rateLimiter, // Alias für Kompatibilität
  otp,
  whatsapp,
};
