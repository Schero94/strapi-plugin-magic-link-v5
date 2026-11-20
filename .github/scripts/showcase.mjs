#!/usr/bin/env node
/**
 * "Used by" showcase for the plugin documentation site (docs/site).
 *
 * One dependency-free script, byte-identical in every plugin repository. The workflow
 * `.github/workflows/showcase.yml` calls it when a maintainer labels a showcase issue, and the
 * Pages workflow calls `render` before it uploads docs/site. `showcase.test.mjs` covers the
 * parser, the validators, the logo checks and the renderer, including hostile input.
 *
 * Subcommands:
 * - `prepare` reads the `issues` event payload as untrusted data, validates the form (name,
 *   website, logo, description, consent), downloads the logo from GitHub's attachment host only,
 *   checks it by magic bytes and pixel size and re-encodes it with sharp. It needs no write token
 *   and prints one JSON result (`add`, `remove` or `reject`) as a step output.
 * - `apply` validates that result again, writes docs/site/showcase.json, the logo and the
 *   sitemap `lastmod`, and writes the commit message, pull request body or rejection comment.
 * - `render` writes showcase.json into docs/site/index.html (static HTML and JSON-LD) and
 *   docs/site/llms.txt, so crawlers and language models see the list without JavaScript.
 *
 * sharp is optional: `SHOWCASE_SHARP_DIR` names a directory with an installed sharp (the
 * workflow installs an exact version there and then requires it). Without sharp, a logo is kept
 * as uploaded only when it is already small, static and within the stored size limits.
 */
import { Buffer } from 'node:buffer';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Issue labels used by the form and the workflow. */
export const LABELS = Object.freeze({
  submit: 'showcase',
  approve: 'showcase-approved',
  remove: 'showcase-remove',
});

/** Headings of the issue form (`.github/ISSUE_TEMPLATE/showcase.yml`), in form order. */
export const FORM_HEADINGS = Object.freeze({
  name: 'Company name',
  website: 'Website',
  logo: 'Logo',
  description: 'How you use the plugin (optional)',
  consent: 'Permission',
});

/** Checkbox labels of the form. All three must be ticked. */
export const CONSENT_OPTIONS = Object.freeze([
  'I am authorised to represent this company and to allow use of its name and logo.',
  'The logo and name may be shown publicly on this site and in its llms.txt.',
  'Removal can be requested any time via an issue.',
]);

/** Size and length limits. */
export const LIMITS = Object.freeze({
  bodyChars: 10000,
  nameMin: 2,
  nameMax: 60,
  urlMax: 200,
  descriptionMax: 140,
  downloadBytes: 500 * 1024,
  downloadTimeoutMs: 15000,
  maxRedirects: 3,
  inputPixels: 4096 * 4096,
  inputMinSide: 16,
  logoWidth: 320,
  logoHeight: 160,
  storedBytes: 64 * 1024,
  storedMaxWidth: 640,
  storedMaxHeight: 320,
  slugMax: 40,
});

/** The only accepted logo URL: an image dropped into a GitHub issue form. */
const ATTACHMENT_URL =
  /^https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Hosts that GitHub redirects attachment downloads to (checked on every redirect hop). */
export const ATTACHMENT_REDIRECT_HOSTS = Object.freeze([
  'github-production-user-asset-6210df.s3.amazonaws.com',
  'private-user-images.githubusercontent.com',
  'objects.githubusercontent.com',
  'user-images.githubusercontent.com',
]);

/** Host suffixes that never belong to a public company website. */
const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'private',
  'test',
  'invalid',
  'onion',
  'arpa',
];

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} &.,'’()+!-]*$/u;
const DESCRIPTION_PATTERN = /^[\p{L}\p{M}\p{N} .,;:!?'’"“”()&%+/-]*$/u;
const LOGO_PATH = /^showcase\/[a-z0-9-]{1,40}\.(?:webp|png|jpg)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTML_START = '<!-- showcase:start -->';
const HTML_END = '<!-- showcase:end -->';

/**
 * Error with a message that is safe to post on the issue. Messages never contain submitted text.
 */
export class ShowcaseError extends Error {
  /**
   * @param {string} message Reason shown to the submitter.
   */
  constructor(message) {
    super(message);
    this.name = 'ShowcaseError';
  }
}

/**
 * Normalises a single-line text value: Unicode NFC, collapsed whitespace, trimmed.
 * @param {string} value Raw value.
 * @returns {string} Normalised value.
 */
const cleanText = (value) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * Compares company names case-insensitively and independent of Unicode compatibility forms.
 * @param {string} value Name.
 * @returns {string} Comparison key.
 */
export const nameKey = (value) =>
  cleanText(String(value).normalize('NFKC')).toLocaleLowerCase('en');

/**
 * Splits a GitHub issue-form body into its sections. The form renders every field as
 * `### <label>` followed by the answer; empty optional answers are `_No response_`.
 * Only the exact headings of the showcase form, once each and in form order, are accepted, so an
 * answer cannot smuggle in a second "Website" or "Logo" section.
 * @param {unknown} body Issue body from the event payload (untrusted).
 * @returns {Record<keyof FORM_HEADINGS, string>} Raw answer per field ('' for no response).
 * @throws {ShowcaseError} When the body is empty, too long or not the unchanged form.
 */
export function parseIssueForm(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    throw new ShowcaseError('The issue body is empty. Please use the showcase form.');
  }
  if (body.length > LIMITS.bodyChars) {
    throw new ShowcaseError(`The issue body is longer than ${LIMITS.bodyChars} characters.`);
  }
  const keys = Object.keys(FORM_HEADINGS);
  const expected = keys.map((key) => FORM_HEADINGS[key]);
  const sections = [];
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^###[ \t]+(.*?)[ \t]*$/.exec(line);
    if (heading) {
      sections.push({ heading: heading[1], lines: [] });
    } else if (sections.length > 0) {
      sections.at(-1).lines.push(line);
    } else if (line.trim() !== '') {
      throw new ShowcaseError('The issue body does not match the showcase form.');
    }
  }
  const headings = sections.map((section) => section.heading);
  if (headings.length !== expected.length || headings.some((h, i) => h !== expected[i])) {
    throw new ShowcaseError(
      'The issue body does not match the showcase form. Keep the form headings unchanged.'
    );
  }
  const result = {};
  keys.forEach((key, index) => {
    const value = sections[index].lines.join('\n').trim();
    result[key] = value === '_No response_' ? '' : value;
  });
  return result;
}

/**
 * Validates the company name: plain text, letters and digits plus a few punctuation marks.
 * @param {string} raw Answer from the form.
 * @returns {string} Normalised name.
 * @throws {ShowcaseError} When the name is missing, too short, too long or contains markup.
 */
export function validateName(raw) {
  const name = cleanText(String(raw ?? ''));
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
    throw new ShowcaseError(
      `The company name must be ${LIMITS.nameMin} to ${LIMITS.nameMax} characters long.`
    );
  }
  if (!NAME_PATTERN.test(name)) {
    throw new ShowcaseError(
      "The company name may contain letters, digits, spaces and & . , ' ( ) + ! - only."
    );
  }
  return name;
}

/**
 * Validates the company website: an https URL on a public host name, without credentials,
 * port, IP literal or internal host. The fragment is dropped.
 * @param {string} raw Answer from the form.
 * @returns {string} Normalised URL.
 * @throws {ShowcaseError} When the URL is not a public https URL.
 */
export function validateWebsite(raw) {
  const value = String(raw ?? '').trim();
  const invalid = new ShowcaseError(
    'The website must be a public https:// address, for example https://www.example.com.'
  );
  if (value === '' || value.length > LIMITS.urlMax || /[\s"'<>`\\]/.test(value)) throw invalid;
  if (!/^https:\/\//i.test(value)) throw invalid;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw invalid;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    throw invalid;
  }
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || /^[\d.]+$/.test(host)) throw invalid;
  const labels = host.split('.');
  if (labels.length < 2) throw invalid;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw invalid;
  }
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(labels.at(-1))) throw invalid;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw invalid;
  }
  url.hash = '';
  if (url.href.length > LIMITS.urlMax) throw invalid;
  return url.href;
}

/**
 * Validates the optional one-line description: plain text, no links, markup or mentions.
 * @param {string} raw Answer from the form ('' when empty).
 * @returns {string} Normalised description, possibly ''.
 * @throws {ShowcaseError} When the text is too long or contains markup, links or mentions.
 */
export function validateDescription(raw) {
  const text = cleanText(String(raw ?? ''));
  if (text.length > LIMITS.descriptionMax) {
    throw new ShowcaseError(
      `The description must be at most ${LIMITS.descriptionMax} characters long.`
    );
  }
  if (!DESCRIPTION_PATTERN.test(text) || /\/\/|www\./i.test(text)) {
    throw new ShowcaseError(
      'The description must be plain text without links, markup, mentions or issue references.'
    );
  }
  return text;
}

/**
 * Finds the logo URL in the logo answer. GitHub inserts a dropped image as `<img … src="…">` or
 * `![…](…)`; exactly one URL is allowed and it must be a github.com user attachment.
 * @param {string} raw Answer from the form.
 * @returns {string} Attachment URL.
 * @throws {ShowcaseError} When there is no URL, more than one, or one on another host.
 */
export function extractLogoUrl(raw) {
  const text = String(raw ?? '');
  if (/\b(?:javascript|data|vbscript|file):/i.test(text)) {
    throw new ShowcaseError('The logo must be an image uploaded to the issue form.');
  }
  const urls = new Set(text.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()[\]]+/gi) ?? []);
  if (urls.size !== 1) {
    throw new ShowcaseError(
      'Upload exactly one logo image to the Logo field (drag the file into the field).'
    );
  }
  const [url] = urls;
  if (!ATTACHMENT_URL.test(url)) {
    throw new ShowcaseError(
      'The logo must be uploaded to the issue form; links to other sites are not accepted.'
    );
  }
  return url;
}

/**
 * Checks that every consent checkbox exists unchanged and is ticked.
 * @param {string} raw Answer of the checkbox group.
 * @returns {true} When all boxes are ticked.
 * @throws {ShowcaseError} When a box is missing, changed or not ticked.
 */
export function validateConsent(raw) {
  const lines = String(raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const ok =
    lines.length === CONSENT_OPTIONS.length &&
    lines.every(
      (line, index) =>
        line === `- [X] ${CONSENT_OPTIONS[index]}` || line === `- [x] ${CONSENT_OPTIONS[index]}`
    );
  if (!ok) {
    throw new ShowcaseError('All three permission checkboxes must be ticked.');
  }
  return true;
}

/**
 * Builds a file-name slug from the company name, for example "Example Co" -> "example-co".
 * @param {string} name Validated company name.
 * @param {number} issueNumber Issue number, used when the name has no Latin letters or digits.
 * @returns {string} Slug of 1 to 40 characters `[a-z0-9-]`.
 */
export function slugify(name, issueNumber) {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slugMax)
    .replace(/-+$/g, '');
  return slug || `company-${Number(issueNumber)}`;
}

/**
 * Detects PNG, JPEG or WebP by magic bytes. Everything else (SVG, GIF, AVIF, HTML) is null.
 * @param {Uint8Array} data File content.
 * @returns {'png' | 'jpeg' | 'webp' | null} Image type.
 */
export function detectImageType(data) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 16 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Reads width, height and animation flag from the image header without decoding pixels.
 * @param {Uint8Array} data File content.
 * @returns {{ type: 'png' | 'jpeg' | 'webp', width: number, height: number, animated: boolean }}
 *   Header data.
 * @throws {ShowcaseError} When the file is not a PNG, JPEG or WebP or its header is broken.
 */
export function readImageInfo(data) {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const type = detectImageType(buf);
  const broken = new ShowcaseError('The logo file is damaged or not a PNG, JPEG or WebP image.');
  if (!type) {
    throw new ShowcaseError('The logo must be a PNG, JPEG or WebP image (SVG is not accepted).');
  }
  if (type === 'png') {
    if (buf.length < 33 || buf.toString('latin1', 12, 16) !== 'IHDR') throw broken;
    let animated = false;
    for (let offset = 8; offset + 8 <= buf.length;) {
      const length = buf.readUInt32BE(offset);
      const chunk = buf.toString('latin1', offset + 4, offset + 8);
      if (chunk === 'acTL') animated = true;
      if (chunk === 'IDAT' || chunk === 'IEND') break;
      offset += 12 + length;
    }
    return { type, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), animated };
  }
  if (type === 'jpeg') {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) throw broken;
      const marker = buf[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = buf.readUInt16BE(offset + 2);
      if (length < 2) throw broken;
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) {
        return {
          type,
          width: buf.readUInt16BE(offset + 7),
          height: buf.readUInt16BE(offset + 5),
          animated: false,
        };
      }
      offset += 2 + length;
    }
    throw broken;
  }
  if (buf.length < 30) throw broken;
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw broken;
    return {
      type,
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
      animated: false,
    };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) throw broken;
    const bits = buf.readUInt32LE(21);
    return {
      type,
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      animated: false,
    };
  }
  if (chunk === 'VP8X') {
    return {
      type,
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
      animated: (buf[20] & 0x02) !== 0,
    };
  }
  throw broken;
}

/**
 * Checks the pixel size of an uploaded logo before it is decoded.
 * @param {{ width: number, height: number }} info Header data from readImageInfo.
 * @returns {void}
 * @throws {ShowcaseError} When the image is too small or has too many pixels.
 */
function checkInputPixels(info) {
  if (info.width < LIMITS.inputMinSide || info.height < LIMITS.inputMinSide) {
    throw new ShowcaseError(
      `The logo must be at least ${LIMITS.inputMinSide} pixels wide and high.`
    );
  }
  if (info.width * info.height > LIMITS.inputPixels) {
    throw new ShowcaseError('The logo has too many pixels; upload a version up to 4096 x 4096.');
  }
}

/**
 * Checks a logo file as it is stored in docs/site/showcase: type, bytes and pixel size.
 * @param {Uint8Array} data File content.
 * @returns {{ type: 'png' | 'jpeg' | 'webp', width: number, height: number }} Header data.
 * @throws {ShowcaseError} When the file is not an acceptable stored logo.
 */
export function checkStoredLogo(data) {
  if (data.byteLength > LIMITS.storedBytes) {
    throw new ShowcaseError('The processed logo is too large.');
  }
  const info = readImageInfo(data);
  if (
    info.animated ||
    info.width < 1 ||
    info.height < 1 ||
    info.width > LIMITS.storedMaxWidth ||
    info.height > LIMITS.storedMaxHeight
  ) {
    throw new ShowcaseError(
      `The logo must be a static image of at most ${LIMITS.storedMaxWidth} x ${LIMITS.storedMaxHeight} pixels.`
    );
  }
  return info;
}

/**
 * Downloads the logo from GitHub's attachment host. Redirects are followed by hand, and only to
 * GitHub's own asset hosts over https; no token is sent. The body is read with a byte cap.
 * @param {string} url Attachment URL from extractLogoUrl.
 * @param {{ fetchImpl?: typeof fetch, maxBytes?: number, timeoutMs?: number }} [options]
 *   Test hooks and limits.
 * @returns {Promise<Buffer>} File content.
 * @throws {ShowcaseError} On a foreign host, a failed or slow download or a file that is too big.
 * @sideeffect Network request to github.com and GitHub's attachment storage.
 */
export async function downloadLogo(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxBytes = options.maxBytes ?? LIMITS.downloadBytes;
  const signal = globalThis.AbortSignal.timeout(options.timeoutMs ?? LIMITS.downloadTimeoutMs);
  if (!ATTACHMENT_URL.test(url)) {
    throw new ShowcaseError('The logo must be uploaded to the issue form.');
  }
  let current = new URL(url);
  try {
    for (let hop = 0; hop <= LIMITS.maxRedirects; hop += 1) {
      const response = await fetchImpl(current.href, {
        redirect: 'manual',
        signal,
        headers: { accept: 'image/png, image/jpeg, image/webp', 'user-agent': 'showcase-workflow' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;
        const next = new URL(location, current);
        if (
          next.protocol !== 'https:' ||
          next.username !== '' ||
          next.password !== '' ||
          next.port !== '' ||
          !ATTACHMENT_REDIRECT_HOSTS.includes(next.hostname)
        ) {
          throw new ShowcaseError('The logo download was redirected to an unexpected host.');
        }
        current = next;
        continue;
      }
      if (response.status !== 200 || !response.body) {
        throw new ShowcaseError('The logo could not be downloaded from the issue.');
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new ShowcaseError(`The logo file is larger than ${Math.round(maxBytes / 1024)} KB.`);
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw new ShowcaseError(
            `The logo file is larger than ${Math.round(maxBytes / 1024)} KB.`
          );
        }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
  } catch (error) {
    if (error instanceof ShowcaseError) throw error;
    throw new ShowcaseError('The logo could not be downloaded from the issue.');
  }
  throw new ShowcaseError('The logo could not be downloaded from the issue.');
}

/**
 * Loads sharp from `SHOWCASE_SHARP_DIR`, or from the repository's own node_modules.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {Function | null} The sharp factory, or null when it is not installed.
 * @throws {Error} When `SHOWCASE_SHARP_DIR` is set but sharp cannot be loaded there.
 */
export function loadSharp(env = process.env) {
  if (env.SHOWCASE_SHARP_DIR) {
    const requireFrom = createRequire(path.join(path.resolve(env.SHOWCASE_SHARP_DIR), 'index.js'));
    return requireFrom('sharp');
  }
  try {
    return createRequire(import.meta.url)('sharp');
  } catch {
    return null;
  }
}

/**
 * Turns an uploaded logo into the stored file. With sharp the first frame is decoded with the
 * pixel limit, resized to fit 320 x 160 (never enlarged) and written as WebP without metadata.
 * Without sharp the original is kept only when it already meets the stored limits.
 * @param {Buffer} data Downloaded file.
 * @param {{ sharp?: Function | null }} [options] sharp factory (null to skip re-encoding).
 * @returns {Promise<{ data: Buffer, ext: 'webp' | 'png' | 'jpg', width: number, height: number, processed: boolean }>}
 *   Stored logo.
 * @throws {ShowcaseError} When the file is not an acceptable image.
 */
export async function normalizeLogo(data, options = {}) {
  const info = readImageInfo(data);
  checkInputPixels(info);
  const sharp = options.sharp ?? null;
  if (!sharp) {
    if (info.animated) throw new ShowcaseError('Animated logos are not accepted.');
    const stored = checkStoredLogo(data);
    const ext = stored.type === 'jpeg' ? 'jpg' : stored.type;
    return { data, ext, width: stored.width, height: stored.height, processed: false };
  }
  let output;
  try {
    output = await sharp(data, {
      limitInputPixels: LIMITS.inputPixels,
      failOn: 'warning',
      animated: false,
      autoOrient: true,
    })
      .resize({
        width: LIMITS.logoWidth,
        height: LIMITS.logoHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ShowcaseError('The logo image could not be read. Upload a PNG, JPEG or WebP file.');
  }
  const stored = checkStoredLogo(output.data);
  return {
    data: output.data,
    ext: 'webp',
    width: stored.width,
    height: stored.height,
    processed: true,
  };
}

/**
 * Validates one showcase.json entry (also used on data from the prepare job and on hand edits).
 * @param {unknown} entry Candidate entry.
 * @returns {{ name: string, url: string, logo: string, description: string, issue: number, addedAt: string }}
 *   Entry with normalised fields.
 * @throws {ShowcaseError} When a field is missing or invalid.
 */
export function validateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new ShowcaseError('A showcase entry is not an object.');
  }
  const allowed = ['name', 'url', 'logo', 'description', 'issue', 'addedAt'];
  if (Object.keys(entry).some((key) => !allowed.includes(key))) {
    throw new ShowcaseError('A showcase entry has unknown fields.');
  }
  const name = validateName(entry.name);
  if (name !== entry.name) throw new ShowcaseError('A showcase name is not normalised.');
  const url = validateWebsite(entry.url);
  if (url !== entry.url) throw new ShowcaseError('A showcase URL is not normalised.');
  if (typeof entry.logo !== 'string' || !LOGO_PATH.test(entry.logo)) {
    throw new ShowcaseError('A showcase logo path is invalid.');
  }
  const description = validateDescription(entry.description ?? '');
  if (!Number.isSafeInteger(entry.issue) || entry.issue < 1) {
    throw new ShowcaseError('A showcase issue number is invalid.');
  }
  if (typeof entry.addedAt !== 'string' || !ISO_DATE.test(entry.addedAt)) {
    throw new ShowcaseError('A showcase date is invalid.');
  }
  return { name, url, logo: entry.logo, description, issue: entry.issue, addedAt: entry.addedAt };
}

/**
 * Sorts entries by name, case-insensitive, with the issue number as tie-breaker.
 * @param {Array<{ name: string, issue: number }>} entries Entries.
 * @returns {Array<object>} New sorted array.
 */
export const sortEntries = (entries) =>
  [...entries].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
      a.name.localeCompare(b.name, 'en') ||
      a.issue - b.issue
  );

/**
 * Reads and validates docs/site/showcase.json. A missing file is an empty list.
 * @param {string} siteDir Path of docs/site.
 * @returns {Array<ReturnType<typeof validateEntry>>} Entries.
 * @throws {ShowcaseError} When the file is not a valid list of entries.
 */
export function readShowcase(siteDir) {
  const file = path.join(siteDir, 'showcase.json');
  if (!existsSync(file)) return [];
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ShowcaseError('docs/site/showcase.json is not valid JSON.');
  }
  if (!Array.isArray(data)) throw new ShowcaseError('docs/site/showcase.json must be a list.');
  const entries = data.map(validateEntry);
  const keys = new Set();
  for (const entry of entries) {
    if (keys.has(nameKey(entry.name)) || keys.has(entry.logo)) {
      throw new ShowcaseError('docs/site/showcase.json lists a company twice.');
    }
    keys.add(nameKey(entry.name));
    keys.add(entry.logo);
  }
  return entries;
}

/**
 * Writes docs/site/showcase.json sorted by name, formatted like Prettier formats JSON.
 * @param {string} siteDir Path of docs/site.
 * @param {Array<object>} entries Validated entries.
 * @returns {void}
 * @sideeffect Writes docs/site/showcase.json.
 */
export function writeShowcase(siteDir, entries) {
  const sorted = sortEntries(entries).map((entry) => ({
    name: entry.name,
    url: entry.url,
    logo: entry.logo,
    description: entry.description,
    issue: entry.issue,
    addedAt: entry.addedAt,
  }));
  writeFileSync(path.join(siteDir, 'showcase.json'), `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Host name without a leading "www.", used to find duplicates.
 * @param {string} href Validated URL.
 * @returns {string} Host key.
 */
const hostKey = (href) => new URL(href).hostname.replace(/^www\./, '');

/**
 * Throws when a company with the same name, logo file or website host is already listed.
 * @param {Array<object>} entries Existing entries.
 * @param {{ name: string, url: string, logo: string }} candidate New entry.
 * @returns {void}
 * @throws {ShowcaseError} When the company is already listed.
 */
export function assertNotListed(entries, candidate) {
  const duplicate = entries.some(
    (entry) =>
      nameKey(entry.name) === nameKey(candidate.name) ||
      entry.logo.replace(/\.[a-z]+$/, '') === candidate.logo.replace(/\.[a-z]+$/, '') ||
      hostKey(entry.url) === hostKey(candidate.url)
  );
  if (duplicate) throw new ShowcaseError('This company or website is already listed.');
}

/**
 * Finds the listed company an issue asks to remove: the entry added from this issue, the form's
 * company name, a title "Showcase removal: <name>" or "Showcase: <name>", or the only listed
 * name that the title or body mentions.
 * @param {{ number: number, title?: string, body?: string | null }} issue Issue from the event.
 * @param {Array<object>} entries Listed entries.
 * @returns {object} The entry to remove.
 * @throws {ShowcaseError} When no single listed company can be identified.
 */
export function findRemovalTarget(issue, entries) {
  const byKey = (key) => entries.filter((entry) => nameKey(entry.name) === key);
  const fromIssue = entries.filter((entry) => entry.issue === issue.number);
  if (fromIssue.length === 1) return fromIssue[0];
  const body = typeof issue.body === 'string' ? issue.body.slice(0, LIMITS.bodyChars) : '';
  const title = typeof issue.title === 'string' ? issue.title.slice(0, 300) : '';
  try {
    const match = byKey(nameKey(parseIssueForm(body).name));
    if (match.length === 1) return match[0];
  } catch {
    // Not a showcase form; try the title next.
  }
  const titled = /^\s*showcase(?:\s+removal)?\s*:\s*(.+?)\s*$/i.exec(title);
  if (titled) {
    const match = byKey(nameKey(titled[1]));
    if (match.length === 1) return match[0];
  }
  const haystack = `${title}\n${body}`;
  const mentioned = entries.filter((entry) => {
    const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(haystack);
  });
  if (mentioned.length === 1) return mentioned[0];
  throw new ShowcaseError(
    'Could not tell which listed company to remove. Put the exact name in the title, for example "Showcase removal: Example Co".'
  );
}

/**
 * Today's date in UTC as YYYY-MM-DD.
 * @param {Date} [now] Clock for tests.
 * @returns {string} Date.
 */
const isoDate = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Decides what an `issues: labeled` event asks for and validates everything it can without a
 * write token. Rejections come back as a result, not as an exception.
 * @param {{ label?: { name?: string }, issue?: { number?: number, title?: string, body?: string | null } }} event
 *   Event payload (untrusted).
 * @param {{ siteDir: string, sharp?: Function | null, fetchImpl?: typeof fetch, now?: Date }} options
 *   Site directory and hooks.
 * @returns {Promise<object>} Result with `action` 'add', 'remove', 'reject' or 'ignored'.
 * @sideeffect Downloads the logo from GitHub (add only).
 */
export async function prepare(event, options) {
  const label = event?.label?.name;
  const issue = event?.issue ?? {};
  const number = Number(issue.number);
  if (!Number.isSafeInteger(number) || number < 1) return { action: 'ignored' };
  if (label !== LABELS.approve && label !== LABELS.remove) return { action: 'ignored' };
  try {
    const entries = readShowcase(options.siteDir);
    if (label === LABELS.remove) {
      const target = findRemovalTarget({ ...issue, number }, entries);
      return { action: 'remove', label, issue: number, logo: target.logo, name: target.name };
    }
    const form = parseIssueForm(issue.body);
    const name = validateName(form.name);
    const url = validateWebsite(form.website);
    const description = validateDescription(form.description);
    validateConsent(form.consent);
    const logoUrl = extractLogoUrl(form.logo);
    const slug = slugify(name, number);
    assertNotListed(entries, { name, url, logo: `showcase/${slug}.webp` });
    const downloaded = await downloadLogo(logoUrl, { fetchImpl: options.fetchImpl });
    const logo = await normalizeLogo(downloaded, { sharp: options.sharp });
    const entry = {
      name,
      url,
      logo: `showcase/${slug}.${logo.ext}`,
      description,
      issue: number,
      addedAt: isoDate(options.now),
    };
    return {
      action: 'add',
      label,
      issue: number,
      entry,
      logoData: logo.data.toString('base64'),
      processed: logo.processed,
    };
  } catch (error) {
    if (!(error instanceof ShowcaseError)) throw error;
    return { action: 'reject', label, issue: number, reason: error.message };
  }
}

/**
 * Sets `<lastmod>` of the canonical page in sitemap.xml (inserted when missing).
 * @param {string} siteDir Path of docs/site.
 * @param {string} date YYYY-MM-DD.
 * @returns {boolean} Whether the sitemap was changed.
 * @sideeffect Writes docs/site/sitemap.xml.
 */
export function setSitemapLastmod(siteDir, date) {
  const file = path.join(siteDir, 'sitemap.xml');
  if (!existsSync(file) || !ISO_DATE.test(date)) return false;
  const xml = readFileSync(file, 'utf8');
  const canonical = readCanonical(siteDir);
  const next = xml.replace(/<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = /^([ \t]*)<loc>([^<]*)<\/loc>[ \t]*$/m.exec(block);
    if (!loc || loc[2] !== canonical) return block;
    if (/<lastmod>[^<]*<\/lastmod>/.test(block)) {
      return block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${date}</lastmod>`);
    }
    return block.replace(loc[0], `${loc[0]}\n${loc[1]}<lastmod>${date}</lastmod>`);
  });
  if (next === xml) return false;
  writeFileSync(file, next);
  return true;
}

/**
 * Reads the canonical URL of docs/site/index.html.
 * @param {string} siteDir Path of docs/site.
 * @returns {string} Canonical https URL.
 * @throws {ShowcaseError} When index.html has no canonical link.
 */
export function readCanonical(siteDir) {
  const html = readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  const canonical = /<link rel="canonical" href="(https:\/\/[^"]+)"/.exec(html)?.[1];
  if (!canonical) throw new ShowcaseError('index.html has no canonical URL.');
  return canonical;
}

/**
 * Escapes text for HTML element content and quoted attribute values.
 * @param {string} value Text.
 * @returns {string} Escaped text.
 */
export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Reads the page facts the renderer needs: plugin name (the `data-plugin` attribute of the
 * `used-by` section, else the JSON-LD SoftwareApplication name), canonical URL and repository.
 * @param {string} siteDir Path of docs/site.
 * @param {string} [packageFile] Path of package.json (repository URL).
 * @returns {{ pluginName: string, canonical: string, repository: string, formUrl: string }}
 *   Page facts.
 * @throws {ShowcaseError} When index.html or package.json lacks one of them.
 */
export function siteInfo(siteDir, packageFile = path.join(siteDir, '..', '..', 'package.json')) {
  const html = readFileSync(path.join(siteDir, 'index.html'), 'utf8');
  const canonical = readCanonical(siteDir);
  const section = /<section\b[^>]*\bid="used-by"[^>]*>/.exec(html)?.[0] ?? '';
  let pluginName = /\bdata-plugin="([^"<>&]+)"/.exec(section)?.[1];
  if (!pluginName) {
    for (const block of jsonLdBlocks(html)) {
      const nodes = block.data?.['@graph'] ?? [block.data];
      const app = nodes.find((node) => node?.['@type'] === 'SoftwareApplication');
      if (typeof app?.name === 'string') pluginName = app.name;
    }
  }
  let repository = '';
  if (existsSync(packageFile)) {
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
    const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const match = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(raw ?? '');
    if (match) repository = `https://github.com/${match[1]}`;
  }
  if (!canonical || !pluginName || !repository) {
    throw new ShowcaseError(
      'index.html or package.json lacks the canonical URL, name or repository.'
    );
  }
  return {
    pluginName,
    canonical,
    repository,
    formUrl: `${repository}/issues/new?template=showcase.yml`,
  };
}

/**
 * Finds JSON-LD script blocks in a page.
 * @param {string} html Page source.
 * @returns {Array<{ start: number, end: number, indent: string, data: any }>} Parsed blocks.
 */
function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /([ \t]*)<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (const match of html.matchAll(pattern)) {
    try {
      blocks.push({
        start: match.index,
        end: match.index + match[0].length,
        indent: match[1],
        data: JSON.parse(match[2]),
      });
    } catch {
      // Not JSON; leave the block alone.
    }
  }
  return blocks;
}

/**
 * Serialises JSON-LD so that it cannot close the script element.
 * @param {unknown} data JSON-LD.
 * @param {string} indent Indentation of the script tag.
 * @returns {string} Script element.
 */
function jsonLdScript(data, indent) {
  const json = JSON.stringify(data, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const body = json
    .split('\n')
    .map((line) => `${indent}  ${line}`)
    .join('\n');
  return `${indent}<script type="application/ld+json">\n${body}\n${indent}</script>`;
}

/**
 * Builds the HTML between the showcase markers: a logo grid and the call to action, or only the
 * call to action when the list is empty. Every value is escaped; links carry rel="ugc noopener".
 * @param {Array<object>} entries Validated entries.
 * @param {{ pluginName: string, formUrl: string }} info Page facts.
 * @param {Map<string, { width: number, height: number }>} sizes Logo pixel sizes by path.
 * @param {string} indent Indentation of the start marker.
 * @returns {string} HTML lines, including both markers.
 */
export function renderShowcaseHtml(entries, info, sizes, indent = '') {
  const lines = [HTML_START];
  const cta = `<p class="showcase-cta">Using ${escapeHtml(info.pluginName)} in production? <a class="showcase-add" href="${escapeHtml(info.formUrl)}">Add your company</a></p>`;
  if (entries.length === 0) {
    lines.push(
      '<div class="showcase-empty">',
      `  ${cta}`,
      '  <p class="showcase-note">Fill in the short form on GitHub with your company name, website and logo. A maintainer reviews every entry before it appears here.</p>',
      '</div>'
    );
  } else {
    lines.push(
      `<p class="section-lead">Teams that run ${escapeHtml(info.pluginName)} in production. Each company submitted its own entry, and a maintainer reviewed it before it was published.</p>`,
      '<ul class="showcase-grid">'
    );
    for (const entry of sortEntries(entries)) {
      const size = sizes.get(entry.logo);
      lines.push(
        '  <li class="showcase-item">',
        `    <a class="showcase-tile" href="${escapeHtml(entry.url)}" rel="ugc noopener">`,
        `      <img src="./${escapeHtml(entry.logo)}" alt="${escapeHtml(entry.name)}" width="${size.width}" height="${size.height}" loading="lazy" decoding="async" />`,
        '    </a>'
      );
      if (entry.description) {
        lines.push(`    <p class="showcase-text">${escapeHtml(entry.description)}</p>`);
      }
      lines.push('  </li>');
    }
    lines.push(
      '</ul>',
      cta,
      '<p class="showcase-note">Links to company websites are submitted by the companies themselves.</p>'
    );
  }
  lines.push(HTML_END);
  return lines.map((line, index) => (index === 0 ? line : `${indent}${line}`)).join('\n');
}

/**
 * Builds the "## Used by" section of llms.txt.
 * @param {Array<object>} entries Validated entries.
 * @param {{ pluginName: string, formUrl: string }} info Page facts.
 * @returns {string} Markdown section ending with a blank line.
 */
export function renderLlmsSection(entries, info) {
  const lines = ['## Used by', ''];
  if (entries.length === 0) {
    lines.push(
      `No companies are listed yet. Using ${info.pluginName} in production? Add your company: ${info.formUrl}`
    );
  } else {
    lines.push(
      `Companies that use ${info.pluginName} in production. Each company submitted its own entry; a maintainer reviewed it before publishing.`,
      ''
    );
    for (const entry of sortEntries(entries)) {
      const text = entry.description ? `: ${entry.description}` : '';
      const href = entry.url.replace(/\(/g, '%28').replace(/\)/g, '%29');
      lines.push(`- [${entry.name}](${href})${text}`);
    }
    lines.push('', `Add your company: ${info.formUrl}`);
  }
  return `${lines.join('\n')}\n\n`;
}

/**
 * Writes showcase.json into index.html (between the markers, plus `mentions` on the FAQPage
 * JSON-LD node, which is the page itself) and into llms.txt (the "## Used by" section, placed
 * before "## Docs" when missing). Logos are checked again on disk.
 * @param {string} siteDir Path of docs/site.
 * @param {{ packageFile?: string }} [options] package.json location.
 * @returns {{ entries: number }} Number of rendered entries.
 * @throws {ShowcaseError} When the data, a logo or the markers are invalid.
 * @sideeffect Writes docs/site/index.html and docs/site/llms.txt.
 */
export function renderSite(siteDir, options = {}) {
  const entries = readShowcase(siteDir);
  const info = siteInfo(siteDir, options.packageFile);
  const sizes = new Map();
  for (const entry of entries) {
    const file = path.join(siteDir, entry.logo);
    if (!existsSync(file)) throw new ShowcaseError(`Missing logo file docs/site/${entry.logo}.`);
    sizes.set(entry.logo, checkStoredLogo(readFileSync(file)));
  }

  const indexFile = path.join(siteDir, 'index.html');
  let html = readFileSync(indexFile, 'utf8');
  const start = html.indexOf(HTML_START);
  const end = html.indexOf(HTML_END);
  if (start < 0 || end < start || html.indexOf(HTML_START, start + 1) >= 0) {
    throw new ShowcaseError('index.html needs exactly one pair of showcase markers.');
  }
  const indent = /[ \t]*$/.exec(html.slice(0, start))[0];
  html = `${html.slice(0, start)}${renderShowcaseHtml(entries, info, sizes, indent)}${html.slice(end + HTML_END.length)}`;

  const mentions = sortEntries(entries).map((entry) => ({
    '@type': 'Organization',
    name: entry.name,
    url: entry.url,
    logo: new URL(entry.logo, info.canonical).href,
  }));
  for (const block of jsonLdBlocks(html).reverse()) {
    const nodes = block.data?.['@graph'] ?? [block.data];
    const page = nodes.find((node) => node?.['@type'] === 'FAQPage');
    if (!page) continue;
    if (mentions.length === 0 && !('mentions' in page)) continue;
    if (mentions.length === 0) delete page.mentions;
    else page.mentions = mentions;
    html = `${html.slice(0, block.start)}${jsonLdScript(block.data, block.indent)}${html.slice(block.end)}`;
  }
  writeFileSync(indexFile, html);

  const llmsFile = path.join(siteDir, 'llms.txt');
  if (existsSync(llmsFile)) {
    const llms = readFileSync(llmsFile, 'utf8');
    const section = renderLlmsSection(entries, info);
    const existing = /^## Used by\n[\s\S]*?(?=^## |(?![\s\S]))/m;
    let next;
    if (existing.test(llms)) next = llms.replace(existing, section);
    else if (/^## Docs$/m.test(llms)) next = llms.replace(/^## Docs$/m, `${section}## Docs`);
    else next = `${llms.replace(/\n*$/, '\n\n')}${section.replace(/\n+$/, '\n')}`;
    writeFileSync(llmsFile, next);
  }
  return { entries: entries.length };
}

/**
 * Applies a prepare result with write access: validates it again (the prepare job processed
 * untrusted input), then writes the files and the texts for git, the pull request and the issue.
 * @param {object} result Parsed prepare result.
 * @param {{ siteDir: string, outDir: string, now?: Date }} options Paths and clock.
 * @returns {Record<string, string>} Step outputs (action, branch, title, files).
 * @sideeffect Writes docs/site files and text files in outDir.
 */
export function apply(result, options) {
  mkdirSync(options.outDir, { recursive: true });
  const issue = Number(result?.issue);
  const label = result?.label === LABELS.remove ? LABELS.remove : LABELS.approve;
  const reject = (reason) => {
    const file = path.join(options.outDir, 'comment.md');
    const what = label === LABELS.remove ? 'removed from' : 'added to';
    writeFileSync(
      file,
      [
        `This company could not be ${what} the showcase automatically:`,
        '',
        `> ${reason}`,
        '',
        label === LABELS.remove
          ? `Please check the issue, then a maintainer can add the \`${LABELS.remove}\` label again.`
          : `Please edit the issue so it matches the form. A maintainer can then add the \`${LABELS.approve}\` label again.`,
        '',
      ].join('\n')
    );
    return { action: 'reject', label, comment_file: file };
  };
  if (!Number.isSafeInteger(issue) || issue < 1)
    throw new Error('The prepare result has no issue.');
  try {
    if (result.action === 'reject') {
      const reasons = String(result.reason ?? '');
      // Only reasons the prepare step produces are posted: one line, no markup characters.
      if (!/^[\w .,;:!?'"()&+/-]{1,300}$/.test(reasons))
        return reject('The submission is invalid.');
      return reject(reasons);
    }
    const entries = readShowcase(options.siteDir);
    const date = isoDate(options.now);
    if (result.action === 'remove') {
      const target = entries.find((entry) => entry.logo === result.logo);
      if (!target) throw new ShowcaseError('This company is not listed (any more).');
      writeShowcase(
        options.siteDir,
        entries.filter((entry) => entry !== target)
      );
      rmSync(path.join(options.siteDir, target.logo), { force: true });
      setSitemapLastmod(options.siteDir, date);
      const slug = path.basename(target.logo).replace(/\.[a-z]+$/, '');
      const title = `docs: remove ${target.name} from the showcase`;
      return writeTexts(options.outDir, {
        action: 'remove',
        branch: `showcase/remove-${slug}`,
        title,
        commit: `${title}\n\nRequested in #${issue}.\n`,
        body: [
          `Removes **${target.name}** from the "Used by" showcase on the documentation site, as requested in #${issue}.`,
          '',
          `- Deletes \`docs/site/${target.logo}\` and the entry in \`docs/site/showcase.json\`.`,
          '- Updates `lastmod` in `docs/site/sitemap.xml`.',
          '',
          'The `docs:` commit type publishes no npm release. Merging deploys the Pages site.',
          '',
          `Closes #${issue}`,
          '',
        ].join('\n'),
      });
    }
    if (result.action !== 'add') throw new Error(`Unknown prepare action "${result.action}".`);
    const entry = validateEntry(result.entry);
    if (entry.issue !== issue) throw new ShowcaseError('The entry does not belong to this issue.');
    const data = Buffer.from(String(result.logoData ?? ''), 'base64');
    const info = checkStoredLogo(data);
    const ext = info.type === 'jpeg' ? 'jpg' : info.type;
    const slug = slugify(entry.name, issue);
    if (entry.logo !== `showcase/${slug}.${ext}`) {
      throw new ShowcaseError('The logo path does not match the company name.');
    }
    assertNotListed(entries, entry);
    mkdirSync(path.join(options.siteDir, 'showcase'), { recursive: true });
    writeFileSync(path.join(options.siteDir, entry.logo), data);
    writeShowcase(options.siteDir, [...entries, entry]);
    setSitemapLastmod(options.siteDir, date);
    const title = `docs: add ${entry.name} to the showcase`;
    return writeTexts(options.outDir, {
      action: 'add',
      branch: `showcase/add-${slug}`,
      title,
      commit: `${title}\n\nRequested in #${issue}.\n`,
      body: [
        `Adds **${entry.name}** to the "Used by" showcase on the documentation site, as requested in #${issue}.`,
        '',
        `- Website: ${entry.url} (rendered with \`rel="ugc noopener"\`)`,
        `- Logo: \`docs/site/${entry.logo}\`, ${info.width} x ${info.height} px, ${data.byteLength} bytes, ${result.processed ? 're-encoded with sharp, metadata removed' : 'kept as uploaded'}`,
        `- Description: ${entry.description ? `"${entry.description}"` : 'none'}`,
        '',
        'Before merging, check that the logo belongs to the company and that the website is theirs.',
        'The `docs:` commit type publishes no npm release. Merging deploys the Pages site.',
        '',
        `Closes #${issue}`,
        '',
      ].join('\n'),
    });
  } catch (error) {
    if (error instanceof ShowcaseError) return reject(error.message);
    throw error;
  }
}

/**
 * Writes the commit message and pull request body files.
 * @param {string} outDir Output directory.
 * @param {{ action: string, branch: string, title: string, commit: string, body: string }} texts
 *   Texts.
 * @returns {Record<string, string>} Step outputs.
 * @sideeffect Writes two files in outDir.
 */
function writeTexts(outDir, texts) {
  const commitFile = path.join(outDir, 'commit-message.txt');
  const bodyFile = path.join(outDir, 'pr-body.md');
  writeFileSync(commitFile, texts.commit);
  writeFileSync(bodyFile, texts.body);
  return {
    action: texts.action,
    branch: texts.branch,
    title: texts.title,
    commit_file: commitFile,
    body_file: bodyFile,
  };
}

/**
 * Appends step outputs in the `name=value` format of `$GITHUB_OUTPUT`.
 * @param {string | undefined} file Output file; nothing is written when it is not set.
 * @param {Record<string, string>} outputs Single-line values.
 * @returns {void}
 * @throws {Error} When a value contains a line break.
 * @sideeffect Appends to the output file.
 */
function writeOutputs(file, outputs) {
  for (const [key, value] of Object.entries(outputs)) {
    if (/[\r\n]/.test(value)) throw new Error(`Output ${key} contains a line break.`);
    if (file) appendFileSync(file, `${key}=${value}\n`);
  }
}

/**
 * Command-line entry point.
 * @param {string[]} argv Arguments after the script path.
 * @returns {Promise<number>} Exit code.
 * @throws {Error} On unknown commands or invalid input files.
 * @sideeffect Reads and writes files, may download the logo, prints a summary.
 */
export async function main(argv) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      site: { type: 'string', default: 'docs/site' },
      package: { type: 'string', default: 'package.json' },
      event: { type: 'string' },
      result: { type: 'string' },
      out: { type: 'string' },
      output: { type: 'string', default: process.env.GITHUB_OUTPUT },
    },
  });
  const [command] = positionals;
  const siteDir = path.resolve(values.site);
  if (command === 'render') {
    const { entries } = renderSite(siteDir, { packageFile: path.resolve(values.package) });
    process.stdout.write(`showcase: rendered ${entries} entries into ${values.site}\n`);
    return 0;
  }
  if (command === 'prepare') {
    if (!values.event) throw new Error('prepare needs --event <path>');
    const event = JSON.parse(readFileSync(values.event, 'utf8'));
    const sharp = event?.label?.name === LABELS.approve ? loadSharp() : null;
    const result = await prepare(event, { siteDir, sharp });
    writeOutputs(values.output, { action: result.action, result: JSON.stringify(result) });
    const detail = result.action === 'reject' ? `: ${result.reason}` : '';
    process.stdout.write(`showcase: ${result.action}${detail}\n`);
    return 0;
  }
  if (command === 'apply') {
    const raw = values.result ? readFileSync(values.result, 'utf8') : process.env.SHOWCASE_RESULT;
    if (!raw) throw new Error('apply needs --result <file> or SHOWCASE_RESULT');
    if (!values.out) throw new Error('apply needs --out <dir>');
    const outputs = apply(JSON.parse(raw), { siteDir, outDir: path.resolve(values.out) });
    writeOutputs(values.output, outputs);
    process.stdout.write(`showcase: ${outputs.action} ${outputs.branch ?? ''}\n`);
    return 0;
  }
  throw new Error(`unknown command "${command ?? ''}" (use prepare, apply or render)`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`showcase: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}
