'use strict';

// Legacy entry for tools that resolve <plugin>/strapi-server.js directly.
// Strapi 5 uses the package.json exports map; both point at the build output.
module.exports = require('./dist/server/index.js');
