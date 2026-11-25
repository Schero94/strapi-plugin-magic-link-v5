'use strict';

/**
 * Confirm page for `GET /api/magic-link/login?loginToken=...` page
 * navigations (security audit 2026-11-25, ML-SEC-01).
 *
 * Mail security scanners and link previews open every link in an e-mail
 * before the recipient does. When the e-mailed link points at the API
 * (the default without `frontend_url`), a plain GET used to consume the
 * single-use token and hand the session to the scanner; the user's own click
 * then failed. A request that asks for an HTML page (a browser navigation or
 * a scanner imitating one) now gets a page with a "Continue" button instead.
 * The button submits a same-origin form POST to the same route, which is the
 * existing token exchange. Nothing is looked up or consumed on GET.
 *
 * API clients that do not ask for HTML (no Accept header, `*\/*`,
 * `application/json`) keep the documented GET exchange unchanged.
 *
 * The page has no script, so it works under Strapi's default
 * Content-Security-Policy (`strapi::security`, helmet defaults:
 * `form-action 'self'`, `frame-ancestors 'self'`).
 */

const i18n = require('./i18n');
const { escapeHtml } = require('./template-renderer');

const MAX_ACCEPT_LENGTH = 2048;
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];
const JSON_TYPES = ['application/json'];

/**
 * Highest quality value the Accept header gives to one of `types`, or -1
 * when none of them is listed. Wildcards are deliberately ignored, so `*\/*`
 * counts for neither HTML nor JSON.
 *
 * @param {string} accept - Accept header (already length-capped).
 * @param {string[]} types - Lower-case media types.
 * @returns {number} Quality between 0 and 1, or -1.
 */
const qualityOf = (accept, types) => {
  let best = -1;
  for (const part of accept.split(',').slice(0, 64)) {
    const [type, ...params] = part.split(';');
    if (!types.includes(type.trim().toLowerCase())) continue;
    let quality = 1;
    for (const param of params) {
      const [key, value] = param.split('=');
      if (key.trim().toLowerCase() === 'q') {
        const parsed = Number(String(value).trim());
        quality = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
      }
    }
    best = Math.max(best, quality);
  }
  return best;
};

/**
 * Whether a GET login request is a page navigation that must be confirmed
 * instead of exchanging the token right away.
 *
 * @param {object} ctx - Koa context.
 * @returns {boolean} True for browser-style page requests.
 */
const wantsConfirmationPage = (ctx) => {
  if (String(ctx?.method || '').toUpperCase() !== 'GET') return false;
  const header = ctx?.request?.header || {};
  const dest = String(header['sec-fetch-dest'] || '').toLowerCase();
  const mode = String(header['sec-fetch-mode'] || '').toLowerCase();
  if (dest === 'document' || dest === 'iframe' || mode === 'navigate') return true;
  const accept = String(header.accept || '').slice(0, MAX_ACCEPT_LENGTH);
  if (!accept) return false;
  const html = qualityOf(accept, HTML_TYPES);
  return html > 0 && html > qualityOf(accept, JSON_TYPES);
};

/**
 * Writes the confirm page. The token is only echoed (HTML-escaped) into a
 * hidden form field; it is not looked up, so the page reveals nothing about
 * the token.
 *
 * @param {object} ctx - Koa context (no-store headers already set).
 * @param {string} loginToken - Login token from the query string.
 * @returns {void}
 */
const sendConfirmationPage = (ctx, loginToken) => {
  const locale = i18n.getLocaleFromContext(ctx);
  const t = (key) => escapeHtml(i18n.t(`page.${key}`, locale));
  const action = escapeHtml(String(ctx.path || '/api/magic-link/login'));
  ctx.set('X-Robots-Tag', 'noindex, nofollow');
  ctx.status = 200;
  ctx.type = 'text/html; charset=utf-8';
  ctx.body = `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${t('confirm.title')}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;padding:48px 16px;background:#f6f6f9;color:#32324d}
main{max-width:420px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 4px rgba(33,33,52,.1)}
h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;margin:0 0 24px}
button{font:inherit;font-weight:600;color:#fff;background:#4945ff;border:0;border-radius:4px;padding:10px 16px;cursor:pointer;width:100%}
button:focus-visible{outline:2px solid #271fe0;outline-offset:2px}
</style>
</head>
<body>
<main>
<h1>${t('confirm.title')}</h1>
<p>${t('confirm.body')}</p>
<form method="post" action="${action}">
<input type="hidden" name="loginToken" value="${escapeHtml(loginToken)}">
<button type="submit">${t('confirm.button')}</button>
</form>
</main>
</body>
</html>
`;
};

module.exports = { wantsConfirmationPage, sendConfirmationPage, qualityOf };
