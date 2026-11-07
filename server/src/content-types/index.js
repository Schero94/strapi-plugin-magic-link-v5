'use strict';

const token = require('./token');
const otpCode = require('./otp-code');
const totpConfig = require('./totp-config');
const jwtSession = require('./jwt-session');

module.exports = {
  token,
  'otp-code': otpCode,
  'totp-config': totpConfig,
  'jwt-session': jwtSession,
};
