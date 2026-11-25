// Large inline images in uploaded reports are served as files (2026-11-26):
// the middleware moves each <img src="data:…"> of at least INLINE_IMAGE_MIN
// base64 characters to /report-img/<hash>.<ext>?r=<report path>, and
// functions/report-img/[file].js serves those bytes from the report file.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequest as middleware } from '../functions/_middleware.js';
import {
  INLINE_IMAGE_MIN,
  REPORT_IMAGE_STYLE,
  imageHash,
  imageSize,
  inlineImageHandler,
  movableImage,
  rewriteInlineImages
} from '../functions/_report-images.js';
import { isReportPath, onRequestGet as serveImage, onRequestHead as headImage } from '../functions/report-img/[file].js';

const ROOT = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const POSTS = JSON.parse(await read('data/posts.json'));
const TAGS = await read('data/tags.json');
const HEAVY = 'reports/en/2026-08-24_KOSPI_Daily_Report_EN_Benchmark.html';
const HEAVY_PATH = '/reports/en/2026-08-24_KOSPI_Daily_Report_EN_Benchmark';
const HEAVY_HTML = await read(HEAVY);

// A real large WebP (the 08-24 cover) and a small PNG, as base64.
const BIG = /data:image\/webp;base64,([A-Za-z0-9+/=]+)/.exec(HEAVY_HTML)[1];
const SMALL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function env(pages = {}) {
  return {
    ASSETS: {
      async fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === '/data/posts.json') return new Response(JSON.stringify(POSTS), { headers: { 'content-type': 'application/json' } });
        if (pathname === '/data/tags.json') return new Response(TAGS, { headers: { 'content-type': 'application/json' } });
        if (pages[pathname]) return new Response(pages[pathname], { headers: { 'content-type': 'text/html; charset=utf-8' } });
        return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
    }
  };
}

test('only large images move; the threshold, types and sizes', () => {
  assert.ok(BIG.length >= INLINE_IMAGE_MIN, 'the 08-24 cover is a large image');
  assert.equal(movableImage(`data:image/webp;base64,${BIG}`).ext, 'webp');
  assert.equal(movableImage(`data:image/png;base64,${SMALL}`), null, 'small images stay inline');
  assert.equal(movableImage(`data:image/svg+xml;base64,${BIG}`), null, 'SVG stays inline');
  assert.equal(movableImage('/assets/cover.webp'), null);
  assert.deepEqual(imageSize(BIG, 'image/webp'), { w: 1024, h: 1536 });
  assert.deepEqual(imageSize(SMALL, 'image/png'), { w: 1, h: 1 });
});

test('the string rewrite: address, hints, and the report’s own attributes kept', async () => {
  const hash = await imageHash(BIG);
  const big = `data:image/webp;base64,${BIG}`;
  const html = [
    `<html><head></head><body>`,
    `<img class="cover" alt="Cover" src="${big}">`,
    `<img src="data:image/png;base64,${SMALL}" alt="logo">`,
    `<img src='${big}' style="width:100%" loading="eager">`,
    `<img src="${big}" decoding="sync">`,
    `<img src="${big}" alt="fourth moved">`,
    `</body></html>`
  ].join('\n');
  const out = await rewriteInlineImages(html, '/reports/x');
  const imgs = [...out.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  const url = `/report-img/${hash}.webp?r=%2Freports%2Fx`;
  // The document's first image: high priority, its ratio as a zero-specificity default.
  assert.equal(imgs[0], `<img class="cover" alt="Cover" src="${url}" decoding="async" fetchpriority="high" style="--mrs-ar:1024/1536">`);
  // Small images are untouched.
  assert.equal(imgs[1], `<img src="data:image/png;base64,${SMALL}" alt="logo">`);
  // An existing style is extended, an existing loading is kept (and blocks the priority hint).
  assert.match(imgs[2], /src="\/report-img\/[0-9a-f]{16}\.webp\?r=%2Freports%2Fx"/);
  assert.match(imgs[2], /style="width:100%;--mrs-ar:1024\/1536"/);
  assert.match(imgs[2], /loading="eager"/);
  assert.doesNotMatch(imgs[2], /fetchpriority|loading="lazy"/);
  assert.match(imgs[3], /decoding="sync"/);
  assert.doesNotMatch(imgs[3], /decoding="async"/);
  // From the fourth moved image on: lazy.
  assert.match(imgs[4], /loading="lazy"/);
  assert.doesNotMatch(out, /data:image\/webp;base64/);
  // Nothing to move: the same string back.
  const plain = '<html><body><img src="/a.png"></body></html>';
  assert.equal(await rewriteInlineImages(plain, '/reports/x'), plain);
});

test('the streaming handler sets the same address and hints', async () => {
  const handler = inlineImageHandler('/reports/x');
  const element = attrs => {
    const state = new Map(Object.entries(attrs));
    return {
      state,
      getAttribute: name => (state.has(name) ? state.get(name) : null),
      setAttribute: (name, value) => state.set(name, value),
      get attributes() { return [...state.entries()][Symbol.iterator](); }
    };
  };
  const first = element({ src: `data:image/webp;base64,${BIG}`, alt: 'Cover' });
  const small = element({ src: `data:image/png;base64,${SMALL}` });
  await handler.element(first);
  await handler.element(small);
  assert.equal(first.state.get('src'), `/report-img/${await imageHash(BIG)}.webp?r=%2Freports%2Fx`);
  assert.equal(first.state.get('fetchpriority'), 'high');
  assert.equal(first.state.get('decoding'), 'async');
  assert.equal(first.state.get('style'), '--mrs-ar:1024/1536');
  assert.equal(small.state.get('src'), `data:image/png;base64,${SMALL}`);
});

test('a heavy report through the middleware: the cover becomes a file, and the page shrinks', async () => {
  const response = await middleware({
    request: new Request(`https://snowshagal.com${HEAVY_PATH}`),
    env: env(),
    next: async () => new Response(HEAVY_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
  const html = await response.text();
  assert.ok(html.length < HEAVY_HTML.length * 0.3, `${HEAVY_HTML.length} → ${html.length}`);
  assert.match(html, new RegExp(`src="/report-img/${await imageHash(BIG)}\\.webp\\?r=${encodeURIComponent(HEAVY_PATH).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.ok(html.includes(REPORT_IMAGE_STYLE), 'the ratio rule is in the head');
  assert.ok(html.indexOf(REPORT_IMAGE_STYLE) < html.indexOf('</head>'));
  assert.doesNotMatch(html, /<img\b[^>]*src="data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{150000}/);
});

test('/report-img/ serves the exact bytes of that image, and nothing else', async () => {
  const hash = await imageHash(BIG);
  const request = path => serveImage({ request: new Request(`https://snowshagal.com${path}`), env: env({ [HEAVY_PATH]: HEAVY_HTML }), params: { file: path.split('/')[2].split('?')[0] } });
  const ok = await request(`/report-img/${hash}.webp?r=${encodeURIComponent(HEAVY_PATH)}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/webp');
  assert.match(ok.headers.get('cache-control'), /max-age=31536000, immutable/);
  assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), new Uint8Array(Buffer.from(BIG, 'base64')));
  // Another hash, another type, another page, or an address outside /reports/: 404.
  for (const path of [
    `/report-img/0000000000000000.webp?r=${encodeURIComponent(HEAVY_PATH)}`,
    `/report-img/${hash}.png?r=${encodeURIComponent(HEAVY_PATH)}`,
    `/report-img/${hash}.webp?r=${encodeURIComponent('/reports/missing')}`,
    `/report-img/${hash}.webp?r=${encodeURIComponent('/admin/')}`,
    `/report-img/${hash}.webp`,
    `/report-img/${hash.toUpperCase()}.webp?r=${encodeURIComponent(HEAVY_PATH)}`
  ]) assert.equal((await request(path)).status, 404, path);
  const head = await headImage({ request: new Request(`https://snowshagal.com/report-img/${hash}.webp?r=${encodeURIComponent(HEAVY_PATH)}`, { method: 'HEAD' }), env: env({ [HEAVY_PATH]: HEAVY_HTML }), params: { file: `${hash}.webp` } });
  assert.equal(head.status, 200);
});

test('the report path check refuses anything but a plain /reports/ path', () => {
  assert.equal(isReportPath('/reports/en/2026-08-24_KOSPI_Daily_Report_EN_Benchmark'), true);
  assert.equal(isReportPath('/reports/8%EC%9B%94%2024%EC%9D%BC'), true);
  for (const bad of ['', '/reports/', '/report/x', '/reports/../admin', '/reports/a/../../x', '/reports//x', '/reports/x?y', '/reports/x#y', '/reports/%2e%2e/x', '/reports/a%2Fb', 'https://example.com/reports/x', '/reports\\x']) {
    assert.equal(isReportPath(bad), false, bad);
  }
});
