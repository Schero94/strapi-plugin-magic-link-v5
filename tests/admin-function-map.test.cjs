'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const adminRoutes = require('../server/src/routes/admin').routes;
const readSource = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const visibleApiActions = [
  {
    page: 'admin/src/pages/Settings/SettingsModern.jsx',
    control: "get('/magic-link/settings')",
    method: 'GET', path: '/settings', handler: 'controller.getSettings',
    permission: 'plugin::magic-link.settings.read',
  },
  {
    page: 'admin/src/pages/Settings/SettingsModern.jsx',
    control: "put('/magic-link/settings'",
    method: 'PUT', path: '/settings', handler: 'controller.updateSettings',
    permission: 'plugin::magic-link.settings.update',
  },
  {
    page: 'admin/src/pages/Settings/SettingsModern.jsx',
    control: "get('/magic-link/rate-limit/stats')",
    method: 'GET', path: '/rate-limit/stats', handler: 'rateLimit.getStats',
    permission: 'plugin::magic-link.settings.read',
  },
  {
    page: 'admin/src/pages/Settings/SettingsModern.jsx',
    control: "post('/magic-link/rate-limit/cleanup')",
    method: 'POST', path: '/rate-limit/cleanup', handler: 'rateLimit.cleanup',
    permission: 'plugin::magic-link.settings.update',
  },
  {
    page: 'admin/src/pages/Settings/SettingsModern.jsx',
    control: "post('/magic-link/rate-limit/reset')",
    method: 'POST', path: '/rate-limit/reset', handler: 'rateLimit.reset',
    permission: 'plugin::magic-link.settings.update',
  },
  {
    page: 'admin/src/pages/Tokens/useTokenData.js',
    control: "get('/magic-link/tokens')",
    method: 'GET', path: '/tokens', handler: 'tokens.find',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/TokensProfessional.jsx',
    control: "post('/magic-link/tokens'",
    method: 'POST', path: '/tokens', handler: 'tokens.create',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/MagicLinksPanel.jsx',
    control: 'del(`/magic-link/tokens/${tokenId}`)',
    method: 'DELETE', path: '/tokens/:id', handler: 'tokens.delete',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/MagicLinksPanel.jsx',
    control: 'post(`/magic-link/tokens/${tokenId}/extend`',
    method: 'POST', path: '/tokens/:id/extend', handler: 'tokens.extend',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/MagicLinksPanel.jsx',
    control: 'post(`/magic-link/tokens/${tokenId}/block`)',
    method: 'POST', path: '/tokens/:id/block', handler: 'tokens.block',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/MagicLinksPanel.jsx',
    control: 'post(`/magic-link/tokens/${tokenId}/activate`)',
    method: 'POST', path: '/tokens/:id/activate', handler: 'tokens.activate',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/OTPCodes.jsx',
    control: 'get(`/${pluginId}/otp/codes`',
    method: 'GET', path: '/otp/codes', handler: 'otp.listCodes',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/OTPCodes.jsx',
    control: 'del(`/${pluginId}/otp/codes/${id}`)',
    method: 'DELETE', path: '/otp/codes/:id', handler: 'otp.deleteCode',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/OTPCodes.jsx',
    control: 'post(`/${pluginId}/otp/cleanup`)',
    method: 'POST', path: '/otp/cleanup', handler: 'otp.cleanup',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/JWTSessions.jsx',
    control: "get('/magic-link/jwt-sessions')",
    method: 'GET', path: '/jwt-sessions', handler: 'jwt.getSessions',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/JWTSessions.jsx',
    control: "post('/magic-link/revoke-jwt'",
    method: 'POST', path: '/revoke-jwt', handler: 'jwt.revokeToken',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/JWTSessions.jsx',
    control: "post('/magic-link/unrevoke-jwt'",
    method: 'POST', path: '/unrevoke-jwt', handler: 'jwt.unrevokeToken',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/JWTSessions.jsx',
    control: "post('/magic-link/cleanup-sessions')",
    method: 'POST', path: '/cleanup-sessions', handler: 'jwt.cleanupSessions',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/IPBans.jsx',
    control: "get('/magic-link/banned-ips')",
    method: 'GET', path: '/banned-ips', handler: 'tokens.getBannedIPs',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/IPBans.jsx',
    control: "post('/magic-link/ban-ip'",
    method: 'POST', path: '/ban-ip', handler: 'tokens.banIP',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/Tokens/IPBans.jsx',
    control: "post('/magic-link/unban-ip'",
    method: 'POST', path: '/unban-ip', handler: 'tokens.unbanIP',
    permission: 'plugin::magic-link.access',
  },
  {
    page: 'admin/src/pages/License/index.jsx',
    control: "get('/magic-link/license/status',",
    method: 'GET', path: '/license/status', handler: 'license.getStatus',
    permission: 'plugin::magic-link.access',
  },
];

test('every API-backed control on token, settings and license pages maps to its protected route', () => {
  for (const action of visibleApiActions) {
    const ui = readSource(action.page);
    assert.ok(ui.includes(action.control), `${action.page} contains ${action.control}`);

    const route = adminRoutes.find((candidate) => (
      candidate.method === action.method && candidate.path === action.path
    ));
    assert.ok(route, `registered route for ${action.method} ${action.path}`);
    assert.equal(route.handler, action.handler);

    const policies = route.config.policies;
    const actions = policies.flatMap((policy) => policy.config?.actions || []);
    assert.ok(policies.includes('admin::isAuthenticatedAdmin'), `${action.path} requires admin auth`);
    assert.ok(actions.includes(action.permission), `${action.path} requires ${action.permission}`);
  }
});
