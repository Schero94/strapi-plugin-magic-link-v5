/**
 * Unit tests for the "Used by" showcase script. Run with `node --test .github/scripts/`.
 * Every fixture is synthetic ("Example Co", example.com); images are generated in memory.
 * The sharp test runs when sharp can be loaded (SHOWCASE_SHARP_DIR or node_modules).
 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  CONSENT_OPTIONS,
  FORM_HEADINGS,
  LABELS,
  ShowcaseError,
  apply,
  checkStoredLogo,
  detectImageType,
  downloadLogo,
  escapeHtml,
  extractLogoUrl,
  findRemovalTarget,
  loadSharp,
  normalizeLogo,
  parseIssueForm,
  prepare,
  readImageInfo,
  readShowcase,
  renderSite,
  slugify,
  validateConsent,
  validateDescription,
  validateEntry,
  validateName,
  validateWebsite,
} from './showcase.mjs';

const ATTACHMENT =
  'https://github.com/user-attachments/assets/0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const ASSET_HOST = 'https://github-production-user-asset-6210df.s3.amazonaws.com/1/logo.png';
const NOW = new Date('2026-11-20T12:00:00Z');

/** CRC-32 as used by PNG chunks. */
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/**
 * Builds a valid RGBA PNG: a dark rectangle on a transparent background.
 * @param {number} width Width in pixels.
 * @param {number} height Height in pixels.
 * @param {{ animated?: boolean }} [options] Adds an acTL chunk (APNG) when true.
 * @returns {Buffer} PNG file.
 */
function makePng(width, height, options = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const inside = x > width / 8 && x < (width * 7) / 8 && y > height / 4 && y < (height * 3) / 4;
      row.set(inside ? [18, 21, 29, 255] : [0, 0, 0, 0], 1 + x * 4);
    }
    rows.push(row);
  }
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr)];
  if (options.animated) parts.push(chunk('acTL', Buffer.alloc(8)));
  parts.push(chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** PNG header that claims a size without pixel data (for pixel-limit tests). */
const pngHeader = (width, height) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr)]);
};

/**
 * Builds an issue body exactly as GitHub renders the showcase form.
 * @param {Partial<Record<'name' | 'website' | 'logo' | 'description' | 'consent', string>>} [values]
 *   Answers to replace.
 * @returns {string} Issue body.
 */
function formBody(values = {}) {
  const answers = {
    name: 'Example Co',
    website: 'https://www.example.com',
    logo: `<img width="640" height="160" alt="example-logo" src="${ATTACHMENT}" />`,
    description: 'Editors share saved list views across three teams.',
    consent: CONSENT_OPTIONS.map((label) => `- [X] ${label}`).join('\n'),
    ...values,
  };
  return Object.entries(FORM_HEADINGS)
    .map(([key, heading]) => `### ${heading}\n\n${answers[key] || '_No response_'}`)
    .join('\n\n');
}

/**
 * Fake fetch: the attachment URL redirects to GitHub's asset host, which returns `file`.
 * @param {Buffer} file Logo bytes.
 * @param {{ location?: string, status?: number, headers?: Record<string, string> }} [options]
 *   Overrides for the redirect target and the final response.
 * @returns {typeof fetch} Fake.
 */
function fakeFetch(file, options = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.authorization, undefined);
    if (url === ATTACHMENT) {
      return new globalThis.Response(null, {
        status: 302,
        headers: { location: options.location ?? ASSET_HOST },
      });
    }
    return new globalThis.Response(file, {
      status: options.status ?? 200,
      headers: options.headers ?? {},
    });
  };
  impl.calls = calls;
  return impl;
}

/**
 * Creates a minimal docs site and package.json in a temporary directory.
 * @returns {{ root: string, site: string, cleanup: () => void }} Paths.
 */
function makeSite() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'showcase-test-'));
  const site = path.join(root, 'docs', 'site');
  mkdirSync(site, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ repository: { url: 'git+https://github.com/Example/Example-Plugin.git' } })
  );
  writeFileSync(
    path.join(site, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <link rel="canonical" href="https://example.github.io/Example-Plugin/" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "SoftwareApplication", "name": "Example Plugin", "softwareVersion": "__PACKAGE_VERSION__" },
          { "@type": "FAQPage", "mainEntity": [] }
        ]
      }
    </script>
  </head>
  <body>
    <main id="main-content">
      <section class="section" id="used-by" aria-labelledby="used-by-title" data-plugin="Example Plugin">
        <h2 id="used-by-title">Used by</h2>
        <!-- showcase:start -->
        <p>old</p>
        <!-- showcase:end -->
      </section>
    </main>
  </body>
</html>
`
  );
  writeFileSync(path.join(site, 'llms.txt'), '# Example\n\n> Example.\n\n## Docs\n\n- [Docs](x)\n');
  writeFileSync(
    path.join(site, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>https://example.github.io/Example-Plugin/</loc>\n  </url>\n</urlset>\n'
  );
  writeFileSync(path.join(site, 'showcase.json'), '[]\n');
  return { root, site, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const event = (label, body, extra = {}) => ({
  action: 'labeled',
  label: { name: label },
  issue: { number: 12, title: 'Showcase: Example Co', body, ...extra },
});

// --- Form parsing ----------------------------------------------------------------------------

test('form: a complete submission is parsed field by field', () => {
  const form = parseIssueForm(formBody());
  assert.equal(form.name, 'Example Co');
  assert.equal(form.website, 'https://www.example.com');
  assert.match(form.logo, /user-attachments/);
  assert.equal(validateConsent(form.consent), true);
});

test('form: the issue template has the headings and checkboxes the parser expects', () => {
  const form = readFileSync(new URL('../ISSUE_TEMPLATE/showcase.yml', import.meta.url), 'utf8');
  const labels = [...form.matchAll(/^ +(?:- )?label: (.+)$/gm)].map((match) => match[1].trim());
  assert.deepEqual(labels, [...Object.values(FORM_HEADINGS), ...CONSENT_OPTIONS]);
  assert.match(form, new RegExp(`^labels: \\['${LABELS.submit}'\\]$`, 'm'));
  assert.equal(form.match(/required: true/g).length, 6);
});

test('form: CRLF line endings and an empty optional answer', () => {
  const form = parseIssueForm(formBody({ description: '' }).replace(/\n/g, '\r\n'));
  assert.equal(form.description, '');
  assert.equal(validateDescription(form.description), '');
});

test('form: missing, repeated, reordered or extra headings are rejected', () => {
  const body = formBody();
  assert.throws(() => parseIssueForm(''), ShowcaseError);
  assert.throws(() => parseIssueForm(null), ShowcaseError);
  assert.throws(() => parseIssueForm(`hello\n${body}`), ShowcaseError);
  assert.throws(
    () => parseIssueForm(`${body}\n\n### Website\n\nhttps://evil.example`),
    ShowcaseError
  );
  assert.throws(
    () => parseIssueForm(formBody({ logo: `${ATTACHMENT}\n### Logo\n\nx` })),
    ShowcaseError
  );
  assert.throws(() => parseIssueForm(body.replace('### Website', '### Site')), ShowcaseError);
  assert.throws(() => parseIssueForm(`${body}\n${'x'.repeat(10001)}`), /longer than/);
});

test('form: an unticked or edited permission checkbox is rejected', () => {
  const ticked = CONSENT_OPTIONS.map((label) => `- [X] ${label}`);
  const unticked = [...ticked];
  unticked[1] = `- [ ] ${CONSENT_OPTIONS[1]}`;
  assert.throws(() => validateConsent(unticked.join('\n')), /checkboxes/);
  assert.throws(() => validateConsent(ticked.slice(0, 2).join('\n')), /checkboxes/);
  assert.throws(
    () => validateConsent([...ticked.slice(0, 2), '- [X] Something else.'].join('\n')),
    /checkboxes/
  );
  assert.equal(validateConsent(ticked.join('\n').replace(/\[X\]/g, '[x]')), true);
});

// --- Field validation ------------------------------------------------------------------------

test('name: plain names pass, markup and odd lengths fail', () => {
  assert.equal(validateName('  Example   Co  '), 'Example Co');
  assert.equal(validateName('Exämple & Søns (Nord) GmbH'), 'Exämple & Søns (Nord) GmbH');
  for (const bad of [
    '<script>alert(1)</script>',
    'Example <b>Co</b>',
    '[Example](https://evil.example)',
    'Example `Co`',
    '@example',
    'Example #1',
    'Ex\u202eample',
    'E',
    'x'.repeat(61),
    '',
  ]) {
    assert.throws(() => validateName(bad), ShowcaseError, bad);
  }
});

test('website: only public https URLs without credentials, IPs or internal hosts', () => {
  assert.equal(validateWebsite('https://www.example.com'), 'https://www.example.com/');
  assert.equal(validateWebsite('https://example.com/en/#team'), 'https://example.com/en/');
  assert.equal(validateWebsite('https://bücher.example'), 'https://xn--bcher-kva.example/');
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(document.domain)//https://example.com',
    'http://example.com',
    'data:text/html,<script>alert(1)</script>',
    'https://user:pass@example.com',
    'https://example.com@evil.example',
    'https://127.0.0.1',
    'https://2130706433/',
    'https://0x7f.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://intranet/',
    'https://app.internal/',
    'https://printer.local/',
    'https://example.com:8443/',
    'https://example.com/"onmouseover="alert(1)',
    'www.example.com',
    `https://example.com/${'a'.repeat(200)}`,
  ]) {
    assert.throws(() => validateWebsite(bad), ShowcaseError, bad);
  }
});

test('description: plain text up to 140 characters, no links, markup or mentions', () => {
  assert.equal(
    validateDescription('We share "saved views" (AND/OR) daily.'),
    'We share "saved views" (AND/OR) daily.'
  );
  for (const bad of [
    '<img src=x onerror=alert(1)>',
    'See https://evil.example',
    'Visit www.evil.example',
    'Thanks @someone',
    'Fixes #1',
    '[link](https://evil.example)',
    'x'.repeat(141),
  ]) {
    assert.throws(() => validateDescription(bad), ShowcaseError, bad);
  }
});

test('logo field: exactly one GitHub attachment URL', () => {
  assert.equal(extractLogoUrl(`<img alt="logo" src="${ATTACHMENT}" />`), ATTACHMENT);
  assert.equal(extractLogoUrl(`![logo.png](${ATTACHMENT})`), ATTACHMENT);
  for (const bad of [
    '',
    'https://evil.example/logo.png',
    `![a](${ATTACHMENT}) ![b](https://evil.example/x.png)`,
    'https://github.com/user-attachments/files/123/logo.svg',
    'https://user-images.githubusercontent.com/1/logo.png',
    'https://github.com.evil.example/user-attachments/assets/0f8c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
    `<img src="data:image/svg+xml;base64,PHN2Zz4=" /> ${ATTACHMENT}`,
    `javascript:alert(1) ${ATTACHMENT}`,
  ]) {
    assert.throws(() => extractLogoUrl(bad), ShowcaseError, bad);
  }
});

test('slug: readable, bounded and never empty', () => {
  assert.equal(slugify('Example Co', 12), 'example-co');
  assert.equal(slugify('Exämple & Søns GmbH', 12), 'example-s-ns-gmbh');
  assert.equal(slugify('株式会社', 12), 'company-12');
  assert.ok(slugify('A'.repeat(60), 1).length <= 40);
});

// --- Images ----------------------------------------------------------------------------------

test('images: magic bytes decide; SVG, GIF and HTML are not images here', () => {
  assert.equal(detectImageType(makePng(20, 20)), 'png');
  assert.equal(detectImageType(Buffer.from('ffd8ffe000104a464946', 'hex')), 'jpeg');
  assert.equal(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8L\0\0\0\0', 'latin1')), 'webp');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  assert.equal(detectImageType(svg), null);
  assert.equal(detectImageType(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1')), null);
  assert.throws(() => readImageInfo(svg), /SVG is not accepted/);
});

test('images: header sizes for PNG, JPEG and the three WebP variants', () => {
  assert.deepEqual(readImageInfo(makePng(40, 20)), {
    type: 'png',
    width: 40,
    height: 20,
    animated: false,
  });
  assert.equal(readImageInfo(makePng(40, 20, { animated: true })).animated, true);

  const jpeg = Buffer.from('ffd8ffe000041010ffc0000b08004000a00301000000ffd9', 'hex');
  assert.deepEqual(readImageInfo(jpeg), { type: 'jpeg', width: 160, height: 64, animated: false });

  const webp = (fourcc, payload) => {
    const out = Buffer.alloc(30 + payload.length);
    out.write('RIFF', 0, 'latin1');
    out.write('WEBP', 8, 'latin1');
    out.write(fourcc, 12, 'latin1');
    payload.copy(out, 20);
    return out;
  };
  const lossy = Buffer.alloc(10);
  lossy.set([0x9d, 0x01, 0x2a], 3);
  lossy.writeUInt16LE(300, 6);
  lossy.writeUInt16LE(100, 8);
  assert.equal(readImageInfo(webp('VP8 ', lossy)).width, 300);
  const lossless = Buffer.alloc(10);
  lossless[0] = 0x2f;
  lossless.writeUInt32LE((200 - 1) | ((50 - 1) << 14), 1);
  assert.deepEqual(readImageInfo(webp('VP8L', lossless)), {
    type: 'webp',
    width: 200,
    height: 50,
    animated: false,
  });
  const extended = Buffer.alloc(10);
  extended[0] = 0x02;
  extended.writeUIntLE(319, 4, 3);
  extended.writeUIntLE(159, 7, 3);
  assert.deepEqual(readImageInfo(webp('VP8X', extended)), {
    type: 'webp',
    width: 320,
    height: 160,
    animated: true,
  });
  assert.throws(() => readImageInfo(Buffer.from('ffd8ff00', 'hex')), /damaged/);
});

test('images: without sharp only small static originals are kept', async () => {
  const kept = await normalizeLogo(makePng(300, 120), { sharp: null });
  assert.equal(kept.ext, 'png');
  assert.equal(kept.processed, false);
  await assert.rejects(normalizeLogo(makePng(800, 200), { sharp: null }), /at most 640 x 320/);
  await assert.rejects(
    normalizeLogo(makePng(64, 32, { animated: true }), { sharp: null }),
    /Animated/
  );
  await assert.rejects(normalizeLogo(pngHeader(50000, 50000), { sharp: null }), /too many pixels/);
  await assert.rejects(normalizeLogo(makePng(8, 8), { sharp: null }), /at least 16/);
});

const sharp = loadSharp();
test(
  'images: sharp re-encodes to WebP within 320 x 160',
  { skip: !sharp && 'sharp not installed' },
  async () => {
    const result = await normalizeLogo(makePng(1200, 300), { sharp });
    assert.equal(result.ext, 'webp');
    assert.equal(result.processed, true);
    assert.equal(detectImageType(result.data), 'webp');
    assert.ok(result.width <= 320 && result.height <= 160, `${result.width}x${result.height}`);
    assert.deepEqual([result.width, result.height], [320, 80]);
    const small = await normalizeLogo(makePng(100, 40), { sharp });
    assert.deepEqual([small.width, small.height], [100, 40]);
    await assert.rejects(normalizeLogo(pngHeader(64, 64), { sharp }), /could not be read/);
  }
);

// --- Download --------------------------------------------------------------------------------

test('download: follows GitHub redirects only, without a token', async () => {
  const fetchImpl = fakeFetch(makePng(64, 32));
  const data = await downloadLogo(ATTACHMENT, { fetchImpl });
  assert.equal(detectImageType(data), 'png');
  assert.deepEqual(
    fetchImpl.calls.map((call) => new URL(call.url).hostname),
    ['github.com', 'github-production-user-asset-6210df.s3.amazonaws.com']
  );
});

test('download: foreign hosts, redirects, big files and errors are rejected', async () => {
  const png = makePng(64, 32);
  await assert.rejects(
    downloadLogo('https://evil.example/logo.png', { fetchImpl: fakeFetch(png) }),
    ShowcaseError
  );
  await assert.rejects(
    downloadLogo(ATTACHMENT, { fetchImpl: fakeFetch(png, { location: 'https://evil.example/x' }) }),
    /unexpected host/
  );
  await assert.rejects(
    downloadLogo(ATTACHMENT, {
      fetchImpl: fakeFetch(png, { location: 'http://objects.githubusercontent.com/x' }),
    }),
    /unexpected host/
  );
  await assert.rejects(
    downloadLogo(ATTACHMENT, {
      fetchImpl: fakeFetch(png, { headers: { 'content-length': String(600 * 1024) } }),
    }),
    /larger than 500 KB/
  );
  const huge = Buffer.concat([png, Buffer.alloc(600 * 1024)]);
  await assert.rejects(
    downloadLogo(ATTACHMENT, { fetchImpl: fakeFetch(huge) }),
    /larger than 500 KB/
  );
  await assert.rejects(
    downloadLogo(ATTACHMENT, { fetchImpl: fakeFetch(png, { status: 404 }) }),
    /could not be downloaded/
  );
  const failing = async () => {
    throw new Error('network down');
  };
  await assert.rejects(downloadLogo(ATTACHMENT, { fetchImpl: failing }), /could not be downloaded/);
  const looping = async (url) =>
    new globalThis.Response(null, { status: 302, headers: { location: url.replace(/x*$/, 'x') } });
  await assert.rejects(downloadLogo(ATTACHMENT, { fetchImpl: looping }), ShowcaseError);
});

// --- prepare, apply and render ---------------------------------------------------------------

test('end to end: approve, apply, render, then remove again', async () => {
  const { site, root, cleanup } = makeSite();
  try {
    const result = await prepare(event(LABELS.approve, formBody()), {
      siteDir: site,
      sharp: null,
      fetchImpl: fakeFetch(makePng(300, 120)),
      now: NOW,
    });
    assert.equal(result.action, 'add', result.reason);
    assert.deepEqual(result.entry, {
      name: 'Example Co',
      url: 'https://www.example.com/',
      logo: 'showcase/example-co.png',
      description: 'Editors share saved list views across three teams.',
      issue: 12,
      addedAt: '2026-11-20',
    });

    // The result travels between jobs as JSON text.
    const out = path.join(root, 'out');
    const outputs = apply(JSON.parse(JSON.stringify(result)), {
      siteDir: site,
      outDir: out,
      now: NOW,
    });
    assert.equal(outputs.action, 'add');
    assert.equal(outputs.branch, 'showcase/add-example-co');
    assert.equal(outputs.title, 'docs: add Example Co to the showcase');
    assert.match(
      readFileSync(outputs.commit_file, 'utf8'),
      /^docs: add Example Co to the showcase\n/
    );
    assert.match(readFileSync(outputs.body_file, 'utf8'), /Closes #12/);
    assert.ok(existsSync(path.join(site, 'showcase', 'example-co.png')));
    assert.equal(readShowcase(site).length, 1);
    assert.match(
      readFileSync(path.join(site, 'sitemap.xml'), 'utf8'),
      /<lastmod>2026-11-20<\/lastmod>/
    );

    renderSite(site, { packageFile: path.join(root, 'package.json') });
    const html = readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.match(
      html,
      /<a class="showcase-tile" href="https:\/\/www\.example\.com\/" rel="ugc noopener">/
    );
    assert.match(
      html,
      /<img src="\.\/showcase\/example-co\.png" alt="Example Co" width="300" height="120" loading="lazy" decoding="async" \/>/
    );
    assert.doesNotMatch(html, /target=/);
    assert.match(html, /Using Example Plugin in production\?/);
    assert.match(
      html,
      /https:\/\/github\.com\/Example\/Example-Plugin\/issues\/new\?template=showcase\.yml/
    );
    const ld = JSON.parse(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]
    );
    assert.deepEqual(ld['@graph'][1].mentions, [
      {
        '@type': 'Organization',
        name: 'Example Co',
        url: 'https://www.example.com/',
        logo: 'https://example.github.io/Example-Plugin/showcase/example-co.png',
      },
    ]);
    assert.equal(ld['@graph'][0].softwareVersion, '__PACKAGE_VERSION__');
    const llms = readFileSync(path.join(site, 'llms.txt'), 'utf8');
    assert.match(
      llms,
      /## Used by\n\n[\s\S]*- \[Example Co\]\(https:\/\/www\.example\.com\/\): Editors/
    );
    assert.ok(llms.indexOf('## Used by') < llms.indexOf('## Docs'));

    // Rendering twice gives the same files.
    renderSite(site, { packageFile: path.join(root, 'package.json') });
    assert.equal(readFileSync(path.join(site, 'index.html'), 'utf8'), html);
    assert.equal(readFileSync(path.join(site, 'llms.txt'), 'utf8'), llms);

    // A second approval of the same company is rejected.
    const again = await prepare(event(LABELS.approve, formBody({ name: 'EXAMPLE co' })), {
      siteDir: site,
      sharp: null,
      fetchImpl: fakeFetch(makePng(300, 120)),
      now: NOW,
    });
    assert.equal(again.action, 'reject');
    assert.match(again.reason, /already listed/);

    // Removal from a separate issue that names the company in its title.
    const removal = await prepare(
      {
        label: { name: LABELS.remove },
        issue: { number: 30, title: 'Showcase removal: Example Co', body: 'Please remove us.' },
      },
      { siteDir: site, now: NOW }
    );
    assert.equal(removal.action, 'remove');
    const removed = apply(removal, { siteDir: site, outDir: out, now: NOW });
    assert.equal(removed.branch, 'showcase/remove-example-co');
    assert.equal(removed.title, 'docs: remove Example Co from the showcase');
    assert.equal(readShowcase(site).length, 0);
    assert.ok(!existsSync(path.join(site, 'showcase', 'example-co.png')));

    renderSite(site, { packageFile: path.join(root, 'package.json') });
    const empty = readFileSync(path.join(site, 'index.html'), 'utf8');
    assert.match(empty, /class="showcase-empty"/);
    assert.match(empty, /Add your company<\/a>/);
    assert.doesNotMatch(empty, /"mentions"/);
    assert.match(readFileSync(path.join(site, 'llms.txt'), 'utf8'), /No companies are listed yet/);
  } finally {
    cleanup();
  }
});

test('prepare: hostile submissions are rejected without downloading anything', async () => {
  const { site, cleanup } = makeSite();
  try {
    const neverFetch = async () => {
      throw new Error('must not download');
    };
    const cases = [
      [formBody({ name: '<script>alert(1)</script>' }), /company name/],
      [formBody({ website: 'javascript:alert(1)' }), /website/],
      [formBody({ logo: '![x](https://evil.example/logo.svg)' }), /uploaded to the issue form/],
      [formBody({ description: '<a href=https://evil.example>x</a>' }), /description/],
      [
        formBody({
          consent: CONSENT_OPTIONS.map((l, i) => `- [${i ? 'X' : ' '}] ${l}`).join('\n'),
        }),
        /checkboxes/,
      ],
    ];
    for (const [body, reason] of cases) {
      const result = await prepare(event(LABELS.approve, body), {
        siteDir: site,
        fetchImpl: neverFetch,
      });
      assert.equal(result.action, 'reject');
      assert.match(result.reason, reason);
    }
    const svg = await prepare(event(LABELS.approve, formBody()), {
      siteDir: site,
      sharp: null,
      fetchImpl: fakeFetch(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    });
    assert.match(svg.reason, /SVG is not accepted/);
    assert.equal((await prepare(event('bug', formBody()), { siteDir: site })).action, 'ignored');
  } finally {
    cleanup();
  }
});

test('apply: a rejection writes only a comment and never echoes submitted text', () => {
  const { site, root, cleanup } = makeSite();
  try {
    const before = readFileSync(path.join(site, 'showcase.json'), 'utf8');
    const out = path.join(root, 'out');
    const outputs = apply(
      { action: 'reject', label: LABELS.approve, issue: 12, reason: 'The website must be https.' },
      { siteDir: site, outDir: out }
    );
    assert.equal(outputs.action, 'reject');
    assert.match(readFileSync(outputs.comment_file, 'utf8'), /> The website must be https\./);
    const forged = apply(
      { action: 'reject', label: LABELS.approve, issue: 12, reason: '<img src=x> @someone' },
      { siteDir: site, outDir: out }
    );
    assert.doesNotMatch(readFileSync(forged.comment_file, 'utf8'), /img|@someone/);
    assert.equal(readFileSync(path.join(site, 'showcase.json'), 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('apply: a tampered prepare result is rejected', () => {
  const { site, root, cleanup } = makeSite();
  try {
    const out = path.join(root, 'out');
    const entry = {
      name: 'Example Co',
      url: 'https://www.example.com/',
      logo: 'showcase/example-co.png',
      description: '',
      issue: 12,
      addedAt: '2026-11-20',
    };
    const png = makePng(64, 32).toString('base64');
    const svg = Buffer.from('<svg/>').toString('base64');
    const cases = [
      [{ ...entry, url: 'javascript:alert(1)' }, png],
      [{ ...entry, logo: '../../index.html' }, png],
      [{ ...entry, logo: 'showcase/other.png' }, png],
      [{ ...entry, issue: 13 }, png],
      [{ ...entry, extra: true }, png],
      [entry, svg],
      [entry, makePng(1000, 100).toString('base64')],
    ];
    for (const [candidate, logoData] of cases) {
      const outputs = apply(
        { action: 'add', label: LABELS.approve, issue: 12, entry: candidate, logoData },
        { siteDir: site, outDir: out }
      );
      assert.equal(outputs.action, 'reject', JSON.stringify(candidate));
    }
    assert.equal(readShowcase(site).length, 0);
    assert.ok(!existsSync(path.join(site, 'showcase')));
  } finally {
    cleanup();
  }
});

test('render: refuses hand-edited data that is not safe to publish', () => {
  const { site, root, cleanup } = makeSite();
  try {
    const entry = {
      name: 'Example Co',
      url: 'https://www.example.com/',
      logo: 'showcase/example-co.png',
      description: '',
      issue: 12,
      addedAt: '2026-11-20',
    };
    const write = (data) => writeFileSync(path.join(site, 'showcase.json'), JSON.stringify(data));
    const render = () => renderSite(site, { packageFile: path.join(root, 'package.json') });
    write([{ ...entry, url: 'javascript:alert(1)' }]);
    assert.throws(render, ShowcaseError);
    write([{ ...entry, name: 'Example "><script>' }]);
    assert.throws(render, ShowcaseError);
    write([entry]);
    assert.throws(render, /Missing logo/);
    mkdirSync(path.join(site, 'showcase'));
    writeFileSync(path.join(site, entry.logo), '<svg onload="alert(1)"/>');
    assert.throws(render, /SVG/);
    write({ not: 'a list' });
    assert.throws(render, /must be a list/);
  } finally {
    cleanup();
  }
});

test('removal: the issue must identify exactly one listed company', () => {
  const entries = [
    validateEntry({
      name: 'Example Co',
      url: 'https://www.example.com/',
      logo: 'showcase/example-co.webp',
      description: '',
      issue: 3,
      addedAt: '2026-11-01',
    }),
    validateEntry({
      name: 'Example Labs',
      url: 'https://labs.example.org/',
      logo: 'showcase/example-labs.webp',
      description: '',
      issue: 4,
      addedAt: '2026-11-02',
    }),
  ];
  assert.equal(
    findRemovalTarget({ number: 4, title: 'x', body: '' }, entries).name,
    'Example Labs'
  );
  assert.equal(
    findRemovalTarget({ number: 9, title: 'Showcase removal: example co', body: '' }, entries).name,
    'Example Co'
  );
  assert.equal(
    findRemovalTarget({ number: 9, title: 'Remove us', body: 'We are Example Labs.' }, entries)
      .name,
    'Example Labs'
  );
  assert.throws(
    () =>
      findRemovalTarget(
        { number: 9, title: 'Remove', body: 'Example Co and Example Labs' },
        entries
      ),
    /Could not tell/
  );
  assert.throws(
    () => findRemovalTarget({ number: 9, title: 'Remove', body: '' }, entries),
    /Could not tell/
  );
});

test('helpers: HTML escaping and stored logo limits', () => {
  assert.equal(escapeHtml(`"'<>&`), '&quot;&#39;&lt;&gt;&amp;');
  assert.throws(() => checkStoredLogo(Buffer.alloc(70 * 1024)), /too large/);
});
