/**
 * StrictMode checks of every Magic Link admin entry point: the Tokens page (magic links, OTP codes,
 * JWT sessions, IP bans and the token dialogs), the Settings page and the initializer. See
 * harness/index.jsx for what each assertion counts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { checkStrictEntry, network, permission } from './harness/index.jsx';
import Tokens from '../../admin/src/pages/Tokens';
import Settings from '../../admin/src/pages/Settings';
import { Initializer } from '../../admin/src/components/Initializer';
import plugin from '../../admin/src/index';

const ALL = ['read', 'manage', 'settings.read', 'settings.update', 'settings.security'].map(
  (action) => permission(`plugin::magic-link.${action}`)
);

const hoursFromNow = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

const TOKEN = {
  id: 1,
  documentId: 'token-1',
  email: 'grace@example.test',
  is_active: true,
  is_used: false,
  createdAt: hoursFromNow(-1),
  expires_at: hoursFromNow(23),
  delivery_status: 'sent',
};

/** Routes of the Tokens page and its four tabs. */
const tokenRoutes = () => {
  network.on('GET', '/magic-link/tokens', { data: [TOKEN] });
  network.on('GET', '/magic-link/settings', { settings: { expire_period: 3600 } });
  network.on('GET', '/magic-link/otp/codes', {
    data: [],
    meta: { pagination: { page: 1, pageSize: 10, total: 0, pageCount: 1 } },
  });
  network.on('GET', '/magic-link/jwt-sessions', [
    {
      id: 'session-1',
      userId: 7,
      userEmail: 'grace@example.test',
      createdAt: hoursFromNow(-2),
      expiresAt: hoursFromNow(22),
      revoked: false,
      ipAddress: '203.0.113.10',
    },
  ]);
  network.on('GET', '/magic-link/banned-ips', { ips: ['203.0.113.99'] });
};

/**
 * Clicks an element inside `act` (Radix triggers also need pointerdown).
 * @param {Element | null | undefined} element - Element.
 */
const click = async (element) => {
  assert.ok(element, 'element to click exists');
  await act(async () => {
    element.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    element.click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
};

/**
 * Finds a button or tab by accessible label or exact text anywhere in the document.
 * @param {string | RegExp} label - Label or text.
 * @returns {HTMLElement | undefined} Button.
 */
const button = (label) =>
  [...document.querySelectorAll('button, [role="tab"]')].find((node) => {
    const name = node.getAttribute('aria-label') || node.textContent.trim();
    return label instanceof RegExp ? label.test(name) : name === label;
  });

const live = (calls, pathname, method = 'GET') =>
  calls.filter((call) => call.method === method && call.pathname === pathname && !call.aborted);

const mutations = (calls) => calls.filter((call) => call.method !== 'GET');

test('plugin registration: menu link, settings link and initializer are registered', () => {
  const app = { menu: [], settings: [], plugins: [] };
  plugin.register({
    addMenuLink: (link) => app.menu.push(link),
    createSettingSection: (_section, links) => app.settings.push(...links),
    registerPlugin: (entry) => app.plugins.push(entry),
  });
  assert.equal(app.menu.length, 1);
  assert.deepEqual(
    app.settings.map((link) => link.id),
    ['magic-link-settings']
  );
  assert.equal(app.plugins[0].initializer, Initializer);
});

test('initializer: StrictMode mount reports the plugin and leaves nothing behind', async () => {
  const ready = [];
  await checkStrictEntry(<Initializer setPlugin={(id) => ready.push(id)} />);
  assert.ok(ready.length >= 1);
  assert.ok(ready.every((id) => id === 'magic-link'));
});

test('tokens page: StrictMode mount, one live token request, clean unmount', async () => {
  tokenRoutes();
  const result = await checkStrictEntry(<Tokens />, {
    path: '/plugins/magic-link',
    permissions: ALL,
  });
  assert.match(result.html, /grace@example\.test/);
  assert.doesNotMatch(result.html, /could not be loaded/i);
  assert.equal(live(result.mountCalls, '/magic-link/tokens').length, 1);
  assert.equal(live(result.mountCalls, '/magic-link/settings').length, 1);
});

test('tokens page: every tab mounts and unmounts cleanly, the create dialog opens', async () => {
  tokenRoutes();
  const result = await checkStrictEntry(<Tokens />, {
    path: '/plugins/magic-link',
    permissions: ALL,
    async whileMounted() {
      await click(button(/^New Token$/));
      assert.ok(document.querySelector('[role="dialog"]'), 'create dialog is open');
      await click(button('Cancel'));
      for (const tab of ['OTP Codes', 'JWT Sessions', 'IP Bans']) {
        await click(button(tab));
        // The OTP search is debounced; give each tab time to load.
        await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
        assert.doesNotMatch(document.body.textContent, /could not be loaded/i, tab);
      }
      assert.match(document.body.textContent, /203\.0\.113\.99/);
    },
  });
  assert.equal(mutations(result.calls).length, 0, 'no mutation');
  assert.equal(live(result.calls, '/magic-link/otp/codes').length, 1);
  assert.equal(live(result.calls, '/magic-link/jwt-sessions').length, 1);
  assert.equal(live(result.calls, '/magic-link/banned-ips').length, 1);
});

/**
 * Types into an input the way React sees it (native value setter + input event).
 * @param {HTMLInputElement | null} input - Input.
 * @param {string} value - Value.
 */
const type = async (input, value) => {
  assert.ok(input, 'input exists');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
      input,
      value
    );
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};

test('tokens page: token details, extend and delete dialogs open and close cleanly', async () => {
  tokenRoutes();
  const result = await checkStrictEntry(<Tokens />, {
    path: '/plugins/magic-link',
    permissions: ALL,
    async whileMounted() {
      for (const action of ['View details for', 'Extend token for', 'Delete token for']) {
        await click(button(`${action} grace@example.test`));
        assert.ok(
          document.querySelector('[role="dialog"], [role="alertdialog"]'),
          `${action} dialog is open`
        );
        await click(button(/^(Cancel|Close)$/));
      }
      await click(button('IP Bans'));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      await click(button('Ban IP'));
      assert.match(document.body.textContent, /Ban IP Address/);
      await click(button('Cancel'));
    },
  });
  assert.equal(mutations(result.calls).length, 0, 'no mutation');
});

test('tokens page: creating a token sends one POST and shows the one-time token dialog', async () => {
  tokenRoutes();
  network.on('POST', '/magic-link/tokens', {
    token: 'synthetic-token-value',
    email: 'ada@example.test',
    expires_at: hoursFromNow(24),
  });
  const result = await checkStrictEntry(<Tokens />, {
    path: '/plugins/magic-link',
    permissions: ALL,
    async whileMounted() {
      await click(button(/^New Token$/));
      await type(document.querySelector('input[name="create-token-email"]'), 'ada@example.test');
      const form = document.querySelector('[role="dialog"] form');
      await act(async () => form.requestSubmit());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
      assert.match(document.body.textContent, /Token created/);
    },
    allowLeaks: [
      {
        match: /^listener document:visibilitychange lib:sonner\//,
        reason:
          'the success notification is a sonner toast (Strapi NotificationsProvider); sonner keeps its visibility listener while a toast is pending',
      },
    ],
  });
  assert.equal(live(result.calls, '/magic-link/tokens', 'POST').length, 1);
});

test('tokens page without read permission: no requests, no-permission state', async () => {
  const result = await checkStrictEntry(<Tokens />, { path: '/plugins/magic-link' });
  assert.equal(result.mountCalls.filter((call) => call.fromPlugin).length, 0);
});

test('settings page: StrictMode mount shows the form, sections switch cleanly', async () => {
  network.on('GET', '/magic-link/settings', { settings: {} });
  network.on('GET', '/magic-link/rate-limit/stats', { data: {} });
  network.on('GET', '/magic-link/totp/enrollment-summary', { data: { enrolled: 0 } });
  const result = await checkStrictEntry(<Settings />, {
    path: '/settings/magic-link/config',
    permissions: ALL,
    async whileMounted(handle) {
      assert.doesNotMatch(handle.container.textContent, /could not be loaded/i);
      for (const tab of [...document.querySelectorAll('[role="tab"]')].slice(1)) await click(tab);
    },
  });
  assert.equal(live(result.mountCalls, '/magic-link/settings').length, 1);
  assert.equal(mutations(result.calls).length, 0, 'no mutation');
});
