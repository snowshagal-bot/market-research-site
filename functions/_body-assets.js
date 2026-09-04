/**
 * Body images of a Research report, taken out of the HTML and committed as
 * files beside it.
 *
 * A published report arrives as one HTML file with every picture inlined as
 * a base64 data URI. For a Research report that is 0.5–1MB of images inside
 * a 1.1MB document: the parser cannot reach the text until the cover's
 * base64 has streamed past, the shell at the end of the body runs only after
 * the whole document has arrived, and the pictures far below the fold are
 * transferred whether or not anyone scrolls to them — `loading="lazy"` on a
 * data URI defers nothing.
 *
 * This module plans the transformation and nothing else: it neither talks to
 * GitHub nor decides whether a report qualifies (the publisher does that from
 * the post's canonical type). Measured on Production copies before this was
 * written, the rule set below is the one that kept LCP where it was:
 *
 * - only `<img>` whose `src` is a base64 data URI of WebP, PNG or JPEG. CSS
 *   `url(data:…)`, SVG `<image href>`, `image/svg+xml`, `<picture>`/`srcset`
 *   selection are left exactly as uploaded.
 * - the cover stays inline. It is the report's largest paint, and inline it
 *   arrives inside the HTML stream with nothing competing; taken out, it
 *   queued behind fonts and the shell and painted later. A cover is an <img>
 *   inside a block element carrying one of COVER_CONTAINERS; `span.cv` and
 *   the like are inline text classes in some templates, never containers.
 * - the first raster image that is not inside such a container is
 *   "uncertain" and also stays inline. "It comes first" is not evidence that
 *   it is the cover, and an uncertain cover taken out is the regression above.
 * - the decoded bytes must carry the magic of the declared MIME and must
 *   yield a width and height; otherwise that one image stays inline. Nothing
 *   is re-encoded, resized or converted.
 * - `loading` is preserved as uploaded, neither added nor removed.
 * - `width`/`height` are added only when both are absent, from the decoded
 *   image, so the box is reserved before the file arrives. When both are
 *   present they are kept; when one is present the tag is left alone.
 * - files are content-addressed: report-assets/<post-id>/<sha256 16 hex>.<ext>.
 *   The same bytes in one post map to one file; changed bytes change the URL,
 *   so no cache ever needs invalidating.
 * - guards run before any decoding, from the encoded length: more than 15
 *   candidates or any candidate that could decode to more than 1MB means the
 *   whole document passes through untouched — never half a report converted.
 */
import { COVER_CONTAINERS } from './_cover-style.js';

export const BODY_ASSET_ROOT = 'report-assets';
/** The canonical post types whose reports are transformed. */
export const BODY_ASSET_TYPES = Object.freeze(['research']);
export const BODY_ASSET_MAX_IMAGES = 15;
export const BODY_ASSET_MAX_IMAGE_BYTES = 1024 * 1024;
export const BODY_ASSET_HASH_LENGTH = 16;
export const BODY_ASSET_EXTENSIONS = Object.freeze({ webp: 'webp', png: 'png', jpeg: 'jpg' });

/** Elements that can wrap a cover; an inline element with a cover class is text styling. */
const COVER_BLOCK_ELEMENTS = new Set(['section', 'div', 'figure', 'header', 'article', 'main', 'aside']);
const IMG_TAG = /<img\b[^<>]*>/gi;
const SRC_ATTR = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
const DATA_URI = /^data:image\/(webp|png|jpeg|jpg)\s*;\s*base64\s*,\s*([\s\S]*)$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const POST_ID = /^[A-Za-z0-9._-]+$/;

export function bodyAssetsApply(type) {
  return BODY_ASSET_TYPES.includes(String(type || '').toLowerCase());
}

/** A path this post may own: report-assets/<post-id>/<hash>.<ext>, nothing else. */
export function isBodyAssetPath(path, postId) {
  if (typeof path !== 'string' || !POST_ID.test(String(postId || ''))) return false;
  const pattern = new RegExp(`^${BODY_ASSET_ROOT}/${postId.replace(/[.]/g, '\\.')}/[0-9a-f]{${BODY_ASSET_HASH_LENGTH}}\\.(?:webp|png|jpg)$`);
  return pattern.test(path);
}

export function magicMime(bytes) {
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

/** Intrinsic [width, height] read from the container header, or null. */
export function imageDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  try {
    if (mime === 'webp') {
      const chunk = ascii(12, 16);
      if (chunk === 'VP8X' && bytes.length >= 30) {
        return [1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))];
      }
      if (chunk === 'VP8 ' && bytes.length >= 30) {
        if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
        return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
      }
      if (chunk === 'VP8L' && bytes.length >= 25) {
        if (bytes[20] !== 0x2f) return null;
        const bits = view.getUint32(21, true);
        return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
      }
      return null;
    }
    if (mime === 'png') {
      if (bytes.length < 24 || ascii(12, 16) !== 'IHDR') return null;
      return [view.getUint32(16), view.getUint32(20)];
    }
    if (mime === 'jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker === 0xff) { offset += 1; continue; }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        const length = view.getUint16(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
        }
        if (length < 2) return null;
        offset += 2 + length;
      }
    }
  } catch (_) {
    return null;
  }
  return null;
}

function validDimensions(dims) {
  return Array.isArray(dims) && dims.length === 2 && dims.every(v => Number.isInteger(v) && v > 0 && v <= 65535);
}

/**
 * [start, end) offsets of every block element carrying a cover class.
 * The closing tag is found by nesting count of the same element name.
 */
export function coverContainerSpans(html) {
  const spans = [];
  const classToken = new RegExp(`(?:^|\\s)(?:${COVER_CONTAINERS.join('|')})(?:\\s|$)`);
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^<>]*\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')[^<>]*>/g;
  let match;
  while ((match = open.exec(html))) {
    const name = match[1].toLowerCase();
    if (!COVER_BLOCK_ELEMENTS.has(name)) continue;
    const classes = match[2] ?? match[3] ?? '';
    if (!classToken.test(classes)) continue;
    const walker = new RegExp(`<(/?)${name}\\b[^<>]*>`, 'gi');
    walker.lastIndex = match.index + match[0].length;
    let depth = 1;
    let step;
    let end = html.length;
    while ((step = walker.exec(html))) {
      if (step[1]) {
        depth -= 1;
        if (depth === 0) { end = step.index + step[0].length; break; }
      } else if (!/\/>$/.test(step[0])) {
        depth += 1;
      }
    }
    spans.push([match.index, end]);
  }
  return spans;
}

function elementSpans(html, name) {
  const spans = [];
  const re = new RegExp(`<${name}\\b[^<>]*>[\\s\\S]*?<\\/${name}\\s*>`, 'gi');
  let match;
  while ((match = re.exec(html))) spans.push([match.index, match.index + match[0].length]);
  return spans;
}

function within(spans, at) {
  return spans.some(([start, end]) => at > start && at < end);
}

function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function hasAttribute(tag, name) {
  return new RegExp(`\\s${name}\\s*=`, 'i').test(tag);
}

/**
 * Plan the transformation of one report. Pure apart from hashing; the caller
 * commits `assets` and writes `bodyAssets` into the post only once every
 * blob exists.
 *
 * @returns {Promise<{
 *   html: string,
 *   assets: Array<{path: string, bytes: Uint8Array, mime: string}>,
 *   bodyAssets: string[],
 *   converted: number,
 *   kept: Array<{index: number, reason: string}>,
 *   passThrough: null | {reason: string, detail?: string}
 * }>}
 */
export async function planBodyAssets(html, postId) {
  const source = String(html || '');
  const untouched = (reason, detail) => ({ html: source, assets: [], bodyAssets: [], converted: 0, kept: [], passThrough: { reason, ...(detail ? { detail } : {}) } });
  if (!POST_ID.test(String(postId || ''))) return untouched('UNSAFE_POST_ID');

  const coverSpans = coverContainerSpans(source);
  const pictureSpans = elementSpans(source, 'picture');

  // Pass 1: find every candidate without decoding anything.
  const candidates = [];
  const kept = [];
  let rasterSeen = 0;
  let index = 0;
  IMG_TAG.lastIndex = 0;
  let tagMatch;
  while ((tagMatch = IMG_TAG.exec(source))) {
    index += 1;
    const tag = tagMatch[0];
    const at = tagMatch.index;
    const srcMatch = SRC_ATTR.exec(tag);
    if (!srcMatch) continue;
    const src = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? '';
    const data = DATA_URI.exec(src);
    if (!data) continue;
    rasterSeen += 1;
    const declared = data[1].toLowerCase() === 'jpg' ? 'jpeg' : data[1].toLowerCase();
    const encoded = data[2].replace(/\s+/g, '');
    if (within(coverSpans, at)) { kept.push({ index, reason: 'cover' }); continue; }
    if (rasterSeen === 1) { kept.push({ index, reason: 'first-uncertain' }); continue; }
    if (srcMatch[3] !== undefined) { kept.push({ index, reason: 'malformed' }); continue; }
    if (hasAttribute(tag, 'srcset')) { kept.push({ index, reason: 'srcset' }); continue; }
    if (within(pictureSpans, at)) { kept.push({ index, reason: 'picture' }); continue; }
    candidates.push({ index, at, tag, srcValue: srcMatch[0], declared, encoded });
  }
  if (!candidates.length) return { html: source, assets: [], bodyAssets: [], converted: 0, kept, passThrough: { reason: 'NO_CANDIDATES' } };

  // Guards, from encoded length only: the whole document or nothing.
  if (candidates.length > BODY_ASSET_MAX_IMAGES) return untouched('TOO_MANY_IMAGES', `${candidates.length} > ${BODY_ASSET_MAX_IMAGES}`);
  for (const candidate of candidates) {
    const upperBound = Math.floor(candidate.encoded.length * 3 / 4);
    if (upperBound > BODY_ASSET_MAX_IMAGE_BYTES) return untouched('IMAGE_TOO_LARGE', `image ${candidate.index} may decode to ${upperBound} bytes`);
  }

  // Pass 2: decode, verify, measure, hash.
  const assets = new Map();       // path → {bytes, mime}
  const prefixes = new Map();     // hash prefix → full hash
  const replacements = [];        // {at, length, text}
  const bodyAssets = [];
  let converted = 0;
  for (const candidate of candidates) {
    const { index, at, tag, srcValue, declared, encoded } = candidate;
    if (!encoded || encoded.length % 4 !== 0 || !BASE64.test(encoded)) { kept.push({ index, reason: 'bad-base64' }); continue; }
    let bytes;
    try { bytes = decodeBase64(encoded); } catch (_) { kept.push({ index, reason: 'bad-base64' }); continue; }
    if (!bytes.length || bytes.length > BODY_ASSET_MAX_IMAGE_BYTES) { kept.push({ index, reason: 'bad-base64' }); continue; }
    const magic = magicMime(bytes);
    if (!magic || magic !== declared) { kept.push({ index, reason: 'mime-mismatch' }); continue; }
    const dims = imageDimensions(bytes, magic);
    if (!validDimensions(dims)) { kept.push({ index, reason: 'no-dimensions' }); continue; }

    const fullHash = await sha256Hex(bytes);
    const prefix = fullHash.slice(0, BODY_ASSET_HASH_LENGTH);
    if (prefixes.has(prefix) && prefixes.get(prefix) !== fullHash) return untouched('HASH_COLLISION', prefix);
    prefixes.set(prefix, fullHash);
    const path = `${BODY_ASSET_ROOT}/${postId}/${prefix}.${BODY_ASSET_EXTENSIONS[magic]}`;
    if (!assets.has(path)) { assets.set(path, { bytes, mime: `image/${magic}` }); bodyAssets.push(path); }

    // Only the quoted value of `src` changes; every other byte of the tag,
    // including the quote style and attribute order, is the author's.
    const srcAt = tag.indexOf(srcValue);
    const equalsAt = srcValue.indexOf('=') + 1;
    const value = srcValue.slice(equalsAt).replace(/^\s*(["'])[^"']*\1/, (m, quote) => `${quote}/${path}${quote}`);
    let next = tag.slice(0, srcAt) + srcValue.slice(0, equalsAt) + value + tag.slice(srcAt + srcValue.length);
    const hasWidth = hasAttribute(tag, 'width');
    const hasHeight = hasAttribute(tag, 'height');
    if (!hasWidth && !hasHeight) next = next.replace(/^<img\b/i, `$& width="${dims[0]}" height="${dims[1]}"`);
    replacements.push({ at, length: tag.length, text: next });
    converted += 1;
  }
  if (!converted) return { html: source, assets: [], bodyAssets: [], converted: 0, kept, passThrough: { reason: 'NO_CONVERTIBLE_CANDIDATES' } };

  let out = '';
  let cursor = 0;
  for (const { at, length, text } of replacements) {
    out += source.slice(cursor, at) + text;
    cursor = at + length;
  }
  out += source.slice(cursor);

  return {
    html: out,
    assets: [...assets.entries()].map(([path, value]) => ({ path, bytes: value.bytes, mime: value.mime })),
    bodyAssets,
    converted,
    kept,
    passThrough: null
  };
}

/** The `/report-assets/<post-id>/…` paths a report's HTML references, in order, once each. */
export function referencedBodyAssets(html, postId) {
  if (!POST_ID.test(String(postId || ''))) return [];
  const re = new RegExp(`/${BODY_ASSET_ROOT}/${postId.replace(/[.]/g, '\\.')}/[0-9a-f]+\\.[a-z0-9]+`, 'g');
  const seen = [];
  for (const match of String(html || '').matchAll(re)) {
    const path = match[0].slice(1);
    if (!seen.includes(path)) seen.push(path);
  }
  return seen;
}

/** One line for the publish response and the server log. */
export function bodyAssetsSummary(plan) {
  const reasons = {};
  for (const item of plan.kept) reasons[item.reason] = (reasons[item.reason] || 0) + 1;
  return {
    converted: plan.converted,
    skipped: plan.kept.length,
    ...(Object.keys(reasons).length ? { skipReasons: reasons } : {}),
    ...(plan.passThrough ? { passThrough: plan.passThrough.reason, ...(plan.passThrough.detail ? { detail: plan.passThrough.detail } : {}) } : {})
  };
}
