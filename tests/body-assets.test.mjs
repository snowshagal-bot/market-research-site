import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BODY_ASSET_MAX_IMAGES,
  BODY_ASSET_MAX_IMAGE_BYTES,
  bodyAssetsApply,
  bodyAssetsSummary,
  coverContainerSpans,
  imageDimensions,
  isBodyAssetPath,
  magicMime,
  planBodyAssets,
  referencedBodyAssets
} from '../functions/_body-assets.js';

/* ------------------------------------------------------------ tiny real images */

function png(width, height, filler = 0) {
  const bytes = new Uint8Array(8 + 25 + 12 + filler);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width); view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  for (let i = 0; i < filler; i++) bytes[45 + i] = (i * 7) & 255;
  return bytes;
}
function webp(width, height, filler = 0) {
  const bytes = new Uint8Array(30 + filler);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);                      // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8); // WEBPVP8<space>
  bytes.set([0x9d, 0x01, 0x2a], 23);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, bytes.length - 20, true);
  view.setUint16(26, width, true); view.setUint16(28, height, true);
  for (let i = 0; i < filler; i++) bytes[30 + i] = (i * 13) & 255;
  return bytes;
}
function jpeg(width, height, filler = 0) {
  const bytes = new Uint8Array(4 + 18 + 19 + filler + 2);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, 16); bytes.set([0x4a, 0x46, 0x49, 0x46, 0x00], 6);   // APP0 "JFIF"
  bytes.set([0xff, 0xc0], 22); view.setUint16(24, 17); bytes[26] = 8;   // SOF0
  view.setUint16(27, height); view.setUint16(29, width); bytes[31] = 3;
  for (let i = 0; i < filler; i++) bytes[41 + i] = (i * 3) & 255;
  bytes.set([0xff, 0xd9], bytes.length - 2);
  return bytes;
}
const b64 = bytes => Buffer.from(bytes).toString('base64');
const uri = (mime, bytes) => `data:image/${mime};base64,${b64(bytes)}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const ID = '2026-09-04-research-1abc2de';
const doc = body => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
const coverImg = `<img class="cart" src="${uri('webp', webp(900, 1350, 40))}" width="900" height="1350" alt="cover">`;
const cover = `<section class="cover"><div class="plate">${coverImg}</div></section>`;

/* --------------------------------------------------------------- primitives */

test('magic bytes and dimensions are read from the decoded image, not the label', () => {
  assert.equal(magicMime(png(3, 4)), 'png'); assert.deepEqual(imageDimensions(png(3, 4), 'png'), [3, 4]);
  assert.equal(magicMime(webp(720, 909)), 'webp'); assert.deepEqual(imageDimensions(webp(720, 909), 'webp'), [720, 909]);
  assert.equal(magicMime(jpeg(1180, 664)), 'jpeg'); assert.deepEqual(imageDimensions(jpeg(1180, 664), 'jpeg'), [1180, 664]);
  assert.equal(magicMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(imageDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'png'), null, 'a truncated header yields nothing');
});

test('only research qualifies, and only its own hashed paths are its assets', () => {
  assert.equal(bodyAssetsApply('research'), true);
  for (const type of ['daily', 'weekly', 'note', 'basics', '', undefined, 'Research ']) assert.equal(bodyAssetsApply(type), false, String(type));
  assert.equal(isBodyAssetPath(`report-assets/${ID}/0123456789abcdef.webp`, ID), true);
  assert.equal(isBodyAssetPath(`report-assets/${ID}/0123456789abcdef.jpg`, ID), true);
  for (const bad of [
    `report-assets/other-post/0123456789abcdef.webp`, `report-assets/${ID}/../x/0123456789abcdef.webp`, `report-assets/${ID}/0123456789abcdef.svg`,
    `report-assets/${ID}/0123456789abcde.webp`, `/report-assets/${ID}/0123456789abcdef.webp`, `covers/${ID}.webp`, `assets/brand/owl.webp`
  ]) assert.equal(isBodyAssetPath(bad, ID), false, bad);
  assert.equal(isBodyAssetPath(`report-assets/a/0123456789abcdef.webp`, '../a'), false);
});

test('cover containers are block elements only; span.cv is text styling', () => {
  const html = '<section class="cover"><img src="x"></section><span class="cv">t</span><div class="x dcv y"><p>a</p></div><h1 class="cvtitle">t</h1><p class="cover">no</p>';
  const spans = coverContainerSpans(html);
  assert.equal(spans.length, 2);
  assert.equal(html.slice(spans[0][0], spans[0][1]), '<section class="cover"><img src="x"></section>');
  assert.equal(html.slice(spans[1][0], spans[1][1]), '<div class="x dcv y"><p>a</p></div>');
  // nested same-name elements close at the right depth
  const nested = '<div class="cv"><div>inner</div><img src="in"></div><img src="out">';
  const [span] = coverContainerSpans(nested);
  assert.equal(nested.slice(span[0], span[1]), '<div class="cv"><div>inner</div><img src="in"></div>');
});

/* ------------------------------------------------------------- happy paths */

test('research KO: the cover stays inline, the body WebP moves out with its size, loading is untouched', async () => {
  const body = webp(1180, 664, 120);
  const html = doc(`${cover}<p>본문</p><figure><img alt="삽화" src="${uri('webp', body)}" loading="lazy"></figure>`);
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.passThrough, null);
  assert.equal(plan.converted, 1);
  assert.deepEqual(plan.kept, [{ index: 1, reason: 'cover' }]);
  const path = `report-assets/${ID}/${sha(body)}.webp`;
  assert.deepEqual(plan.bodyAssets, [path]);
  assert.equal(plan.assets.length, 1);
  assert.equal(plan.assets[0].path, path);
  assert.equal(plan.assets[0].mime, 'image/webp');
  assert.deepEqual([...plan.assets[0].bytes], [...body], 'the committed bytes are the decoded original');
  assert.ok(plan.html.includes(coverImg), 'the cover tag is byte-identical');
  assert.ok(plan.html.includes(`<img width="1180" height="664" alt="삽화" src="/${path}" loading="lazy">`), plan.html.slice(-300));
  assert.doesNotMatch(plan.html, /fetchpriority/);
  assert.equal((plan.html.match(/data:image/g) || []).length, 1, 'only the cover remains inline');
  assert.deepEqual(referencedBodyAssets(plan.html, ID), [path]);
  assert.deepEqual(bodyAssetsSummary(plan), { converted: 1, skipped: 1, skipReasons: { cover: 1 } });
});

test('research EN: JPEG and PNG bodies, single quotes, eager and no loading all pass through unchanged apart from src', async () => {
  const j = jpeg(1400, 875, 50), p = png(244, 330, 30);
  const html = doc(`${cover}<img src='${uri('jpeg', j)}' loading="eager" class="a"><img src="${uri('png', p)}" width="122" height="165">`);
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.converted, 2);
  assert.ok(plan.html.includes(`<img width="1400" height="875" src='/report-assets/${ID}/${sha(j)}.jpg' loading="eager" class="a">`), 'quote style kept, loading kept, dims added');
  assert.ok(plan.html.includes(`<img src="/report-assets/${ID}/${sha(p)}.png" width="122" height="165">`), 'existing width/height kept verbatim');
  assert.deepEqual(plan.bodyAssets, [`report-assets/${ID}/${sha(j)}.jpg`, `report-assets/${ID}/${sha(p)}.png`]);
  assert.equal(plan.assets[0].mime, 'image/jpeg');
});

test('a jpg label, a lone width attribute and an unusual-case MIME are handled conservatively', async () => {
  const j = jpeg(100, 50, 10);
  const html = doc(`${cover}<img src="${uri('jpg', j)}" width="50"><IMG SRC="${uri('PNG', png(10, 10))}">`);
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.converted, 2);
  assert.ok(plan.html.includes(`<img src="/report-assets/${ID}/${sha(j)}.jpg" width="50">`), 'one attribute present: the tag keeps exactly what it had');
  assert.match(plan.html, new RegExp(`<IMG width="10" height="10" SRC="/report-assets/${ID}/[0-9a-f]{16}\\.png">`));
});

test('the same picture twice is one file, referenced twice, recorded once', async () => {
  const body = webp(600, 400, 33);
  const html = doc(`${cover}<img src="${uri('webp', body)}"><p>x</p><img src="${uri('webp', body)}" loading="lazy">`);
  const plan = await planBodyAssets(html, ID);
  const path = `report-assets/${ID}/${sha(body)}.webp`;
  assert.equal(plan.converted, 2);
  assert.equal(plan.assets.length, 1);
  assert.deepEqual(plan.bodyAssets, [path]);
  assert.equal((plan.html.match(new RegExp(`/${path}`, 'g')) || []).length, 2);
});

test('changed bytes change the URL', async () => {
  const a = webp(600, 400, 33), b = webp(600, 400, 34);
  const one = await planBodyAssets(doc(`${cover}<img src="${uri('webp', a)}">`), ID);
  const two = await planBodyAssets(doc(`${cover}<img src="${uri('webp', b)}">`), ID);
  assert.notEqual(one.bodyAssets[0], two.bodyAssets[0]);
  assert.equal(one.bodyAssets[0], `report-assets/${ID}/${sha(a)}.webp`);
});

/* ----------------------------------------------------------- kept inline */

test('the first raster image outside a cover container is uncertain and stays inline', async () => {
  const first = webp(1024, 1536, 20), second = webp(700, 394, 20);
  const html = doc(`<span class="cv">title</span><img src="${uri('webp', first)}"><img src="${uri('webp', second)}">`);
  const plan = await planBodyAssets(html, ID);
  assert.deepEqual(plan.kept, [{ index: 1, reason: 'first-uncertain' }]);
  assert.equal(plan.converted, 1);
  assert.ok(plan.html.includes(`<img src="${uri('webp', first)}">`), 'the uncertain first image is byte-identical');
  assert.equal(plan.bodyAssets.length, 1);
});

test('a cover inside a cover container is never the uncertain one, and the second image converts', async () => {
  const plan = await planBodyAssets(doc(`${cover}<img src="${uri('png', png(10, 10))}">`), ID);
  assert.equal(plan.converted, 1);
  assert.equal(plan.kept[0].reason, 'cover');
});

test('MIME label that does not match the bytes, corrupt base64 and unreadable dimensions stay inline, others still convert', async () => {
  const good = webp(300, 200, 10);
  const html = doc(`${cover}`
    + `<img src="data:image/png;base64,${b64(webp(10, 10))}">`                       // says PNG, is WebP
    + `<img src="data:image/webp;base64,!!!notbase64!!!">`                            // corrupt
    + `<img src="data:image/png;base64,${b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))}">` // header only
    + `<img src="${uri('webp', good)}">`);
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.passThrough, null);
  assert.deepEqual(plan.kept.map(k => k.reason), ['cover', 'mime-mismatch', 'bad-base64', 'no-dimensions']);
  assert.equal(plan.converted, 1);
  assert.equal((plan.html.match(/data:image/g) || []).length, 4, 'the three unsafe ones and the cover are still data URIs');
  assert.deepEqual(plan.bodyAssets, [`report-assets/${ID}/${sha(good)}.webp`]);
});

test('SVG data URIs, CSS url(data:…), srcset and <picture> are left exactly as uploaded', async () => {
  const svg = `data:image/svg+xml;base64,${b64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))}`;
  const cssUri = uri('png', png(4, 4));
  const inPicture = uri('webp', webp(20, 20, 5));
  const withSrcset = uri('webp', webp(21, 21, 5));
  const body = webp(300, 200, 10);
  const html = doc(`<style>.bg{background:url(${cssUri})}</style>${cover}`
    + `<img src="${svg}">`
    + `<picture><source srcset="/x.webp" type="image/webp"><img src="${inPicture}"></picture>`
    + `<img src="${withSrcset}" srcset="/y.webp 450w">`
    + `<svg><image href="${cssUri}"/></svg>`
    + `<img src="${uri('webp', body)}">`);
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.converted, 1);
  assert.deepEqual(plan.kept.map(k => k.reason), ['cover', 'picture', 'srcset']);
  for (const untouched of [svg, `url(${cssUri})`, `<img src="${inPicture}">`, `<img src="${withSrcset}" srcset="/y.webp 450w">`, `<image href="${cssUri}"/>`]) {
    assert.ok(plan.html.includes(untouched), untouched.slice(0, 60));
  }
});

test('a malformed src (unquoted) and an <img> with no data URI are skipped without touching the tag', async () => {
  const html = doc(`${cover}<img src=${uri('png', png(5, 5))}><img src="/covers/x.webp"><img alt="no src">`);
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.converted, 0);
  assert.equal(plan.passThrough.reason, 'NO_CANDIDATES', 'nothing convertible was found, so nothing was attempted');
  assert.equal(plan.html, html);
  assert.deepEqual(plan.kept.map(k => k.reason), ['cover', 'malformed']);
});

/* ------------------------------------------------------ whole-document guards */

test(`more than ${BODY_ASSET_MAX_IMAGES} candidates passes the whole document through`, async () => {
  const imgs = Array.from({ length: BODY_ASSET_MAX_IMAGES + 1 }, (_, i) => `<img src="${uri('png', png(10 + i, 10))}">`).join('');
  const html = doc(cover + imgs);
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.passThrough.reason, 'TOO_MANY_IMAGES');
  assert.equal(plan.html, html);
  assert.equal(plan.assets.length, 0);
  assert.deepEqual(plan.bodyAssets, []);
  // exactly the limit still converts
  const atLimit = await planBodyAssets(doc(cover + Array.from({ length: BODY_ASSET_MAX_IMAGES }, (_, i) => `<img src="${uri('png', png(10 + i, 10))}">`).join('')), ID);
  assert.equal(atLimit.converted, BODY_ASSET_MAX_IMAGES);
});

test('an image that could decode to more than 1MB passes the whole document through, judged before decoding', async () => {
  const big = webp(4000, 3000, BODY_ASSET_MAX_IMAGE_BYTES + 100);
  const small = webp(300, 200, 10);
  const html = doc(`${cover}<img src="${uri('webp', small)}"><img src="${uri('webp', big)}">`);
  const originalAtob = globalThis.atob;
  let decoded = 0;
  globalThis.atob = value => { decoded += value.length; return originalAtob(value); };
  try {
    const plan = await planBodyAssets(html, ID);
    assert.equal(plan.passThrough.reason, 'IMAGE_TOO_LARGE');
    assert.equal(plan.html, html);
    assert.equal(plan.converted, 0, 'not even the small one');
    assert.equal(decoded, 0, 'nothing was base64-decoded');
  } finally {
    globalThis.atob = originalAtob;
  }
});

test('an unsafe post id passes through', async () => {
  const plan = await planBodyAssets(doc(`${cover}<img src="${uri('webp', webp(3, 3))}">`), '../etc');
  assert.equal(plan.passThrough.reason, 'UNSAFE_POST_ID');
});

test('a document with no data URIs at all is untouched and says so', async () => {
  const html = doc('<p>text only</p><img src="/covers/x.webp">');
  const plan = await planBodyAssets(html, ID);
  assert.equal(plan.html, html);
  assert.equal(plan.passThrough.reason, 'NO_CANDIDATES');
  assert.deepEqual(bodyAssetsSummary(plan), { converted: 0, skipped: 0, passThrough: 'NO_CANDIDATES' });
});
