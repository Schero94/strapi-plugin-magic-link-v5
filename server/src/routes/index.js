'use strict';

const contentApi = require('./content-api');
const admin = require('./admin');

// The /api/passwordless/* compatibility paths are served by the
// passwordless-compat middleware (registered in bootstrap), which rewrites
// them to the regular /api/magic-link/* routes when the setting is on.
module.exports = {
  admin,
  'content-api': contentApi,
};
