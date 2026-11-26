/**
 * Large inline images in uploaded reports, served as files.
 *
 * Most uploaded reports carry their pictures as `<img src="data:image/…;base64,…">`.
 * In 2026-11 that was 74% of all report bytes: some files were 0.8–2.8 MB.
 * - On a slow phone the cover alone held the first paint for about 4 s.
 * - A 2.8 MB report took 15 s to parse to its end.
 * - Crawlers that read the start of a page met hundreds of KB of base64 before any text.
 *
 * The report files stay as uploaded; this rewrites them on the way out.
 * - An image whose base64 is at least INLINE_IMAGE_MIN characters (about 110 KB) gets
 *   `src="/report-img/<hash>.<ext>?r=<report path>"`.
 *   - functions/report-img/[file].js finds that image again in the report by its hash.
 *   - It serves the image with a long, immutable cache.
 * - Smaller images stay inline. Measured on Note 13 (2026-11-26), a cover inside a
 *   report of a few hundred KB arrives with the HTML and paints sooner than a
 *   separate request would.
 *
 * Hints added to a moved image never override the report's own markup or CSS.
 * - `decoding="async"`.
 * - `fetchpriority="high"` when it is the document's first `<img>` (a cover above the fold).
 * - `loading="lazy"` from the fourth moved image on.
 * - Its intrinsic ratio as `--mrs-ar`, applied by REPORT_IMAGE_STYLE through a
 *   zero-specificity `:where()` rule, so the report's own CSS always wins.
 *   - Setting `aspect-ratio` inline changed image heights in Research NO.10 on phones.
 * - An attribute the image already carries is kept.
 */

export const INLINE_IMAGE_MIN = 150000;
export const REPORT_IMAGE_PREFIX = '/report-img/';
export const REPORT_IMAGE_STYLE = '<style id="mrs-img-ratio">:where(img[style*="--mrs-ar"]){aspect-ratio:var(--mrs-ar)}</style>';
const LAZY_FROM = 3;
const HASH_HEX = 16;

export const IMAGE_TYPES = Object.freeze({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' });
export const IMAGE_MIME = Object.freeze(Object.fromEntries(Object.entries(IMAGE_TYPES).map(([mime, ext]) => [ext, mime])));

const DATA_URI = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/i;
// One <img …> start tag whose src is a base64 image, in a raw HTML string.
const IMG_WITH_DATA = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const SRC_ATTR = /(\s)src\s*=\s*(["'])(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)\2/i;

/** The mime type and base64 payload of a data URI this module would move, or null. */
export function movableImage(src) {
  const match = DATA_URI.exec(String(src || ''));
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!IMAGE_TYPES[mime] || match[2].length < INLINE_IMAGE_MIN) return null;
  return { mime, base64: match[2], ext: IMAGE_TYPES[mime] };
}

/** A stable, URL-safe hash of the base64 text (SHA-256, first HASH_HEX hex digits). */
export async function imageHash(base64) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, HASH_HEX);
}

/** The served address of a moved image. `reportPath` is the report's URL path. */
export function reportImageUrl(hash, ext, reportPath) {
  return `${REPORT_IMAGE_PREFIX}${hash}.${ext}?r=${encodeURIComponent(reportPath)}`;
}

function decodeHead(base64, chars) {
  const text = base64.slice(0, chars - (chars % 4));
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Intrinsic { w, h } from the first bytes of a PNG, WebP or JPEG; null when unknown. */
export function imageSize(base64, mime) {
  try {
    const bytes = decodeHead(base64, mime === 'image/jpeg' ? 96000 : 64);
    const view = new DataView(bytes.buffer);
    if (mime === 'image/png') return { w: view.getUint32(16), h: view.getUint32(20) };
    if (mime === 'image/webp') {
      const kind = String.fromCharCode(...bytes.slice(12, 16));
      const u24 = at => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      if (kind === 'VP8X') return { w: 1 + u24(24), h: 1 + u24(27) };
      if (kind === 'VP8 ') return { w: view.getUint16(26, true) & 0x3fff, h: view.getUint16(28, true) & 0x3fff };
      if (kind === 'VP8L') { const b = view.getUint32(21, true); return { w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 }; }
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        const length = view.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: view.getUint16(i + 5), w: view.getUint16(i + 7) };
        i += 2 + length;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * The attributes to add to a moved image, given which moved image it is
 * (`index`, from 0), whether it is the document's first <img>, and the
 * attributes it already has (lower-cased names).
 */
export function imageHints({ index, first, has, size, style }) {
  const add = {};
  if (!has.has('decoding')) add.decoding = 'async';
  if (first && !has.has('fetchpriority') && !has.has('loading')) add.fetchpriority = 'high';
  if (index >= LAZY_FROM && !has.has('loading')) add.loading = 'lazy';
  if (size?.w > 0 && size?.h > 0) {
    const ratio = `--mrs-ar:${size.w}/${size.h}`;
    const current = String(style || '').trim();
    add.style = current ? `${current.replace(/;?\s*$/, ';')}${ratio}` : ratio;
  }
  return add;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function attributeNames(source) {
  const names = new Set();
  for (const match of String(source).matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?/g)) names.add(match[1].toLowerCase());
  return names;
}

/**
 * The string-path rewrite (Node and tests, where HTMLRewriter does not exist):
 * every movable image in `html` gets its file address and hints, in document order.
 */
export async function rewriteInlineImages(html, reportPath) {
  const text = String(html || '');
  const firstImg = text.search(/<img\b/i);
  const edits = [];
  let moved = 0;
  for (const match of text.matchAll(IMG_WITH_DATA)) {
    const source = match[1];
    const src = SRC_ATTR.exec(source);
    const image = src ? movableImage(src[3]) : null;
    if (!image) continue;
    const hash = await imageHash(image.base64);
    const styleMatch = /(\s)style\s*=\s*(["'])([\s\S]*?)\2/i.exec(source);
    const hints = imageHints({
      index: moved,
      first: match.index === firstImg,
      has: attributeNames(source.replace(src[0], ' ')),
      size: imageSize(image.base64, image.mime),
      style: styleMatch ? styleMatch[3] : ''
    });
    moved += 1;
    let next = source.replace(src[0], `${src[1]}src="${escapeAttribute(reportImageUrl(hash, image.ext, reportPath))}"`);
    if (hints.style && styleMatch) next = next.replace(styleMatch[0], `${styleMatch[1]}style="${escapeAttribute(hints.style)}"`);
    const extra = Object.entries(hints).filter(([name]) => !(name === 'style' && styleMatch)).map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
    edits.push({ start: match.index, end: match.index + match[0].length, tag: `<img${next}${extra}>` });
  }
  if (!edits.length) return text;
  let out = '';
  let at = 0;
  for (const edit of edits) {
    out += text.slice(at, edit.start) + edit.tag;
    at = edit.end;
  }
  return out + text.slice(at);
}

/**
 * The HTMLRewriter handler doing the same, for `.on('img', handler)`. One
 * handler per response: it counts images in document order.
 */
export function inlineImageHandler(reportPath) {
  let seen = 0;
  let moved = 0;
  return {
    async element(element) {
      const first = seen === 0;
      seen += 1;
      const image = movableImage(element.getAttribute('src'));
      if (!image) return;
      const has = new Set();
      for (const [name] of element.attributes) has.add(String(name).toLowerCase());
      has.delete('src');
      const hints = imageHints({ index: moved, first, has, size: imageSize(image.base64, image.mime), style: element.getAttribute('style') || '' });
      moved += 1;
      element.setAttribute('src', reportImageUrl(await imageHash(image.base64), image.ext, reportPath));
      for (const [name, value] of Object.entries(hints)) element.setAttribute(name, value);
    }
  };
}

/** The bytes of the moved image with `hash` in `html`, as { mime, bytes }, or null. */
export async function findReportImage(html, hash) {
  for (const match of String(html || '').matchAll(IMG_WITH_DATA)) {
    const src = SRC_ATTR.exec(match[1]);
    const image = src ? movableImage(src[3]) : null;
    if (!image || (await imageHash(image.base64)) !== hash) continue;
    const binary = atob(image.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { mime: image.mime, bytes };
  }
  return null;
}
