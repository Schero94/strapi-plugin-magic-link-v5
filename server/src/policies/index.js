'use strict';

const compatibilityCheck = require('./compatibility-check');
const ipBanCheck = require('./ip-ban-check');

module.exports = {
  'compatibility-check': compatibilityCheck,
  'ip-ban-check': ipBanCheck,
};
