'use strict';

// Legacy entry for tools that resolve <plugin>/strapi-admin.js directly.
// Strapi 5 uses the package.json exports map; both point at the build output.
module.exports = require('./dist/admin/index.js');
