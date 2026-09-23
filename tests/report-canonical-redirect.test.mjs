import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequest as middleware } from '../functions/_middleware.js';
import { PRODUCTION_ORIGIN, reportSiteUrl, sitemapXml } from '../functions/_seo.js';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), 'utf8');
const posts = JSON.parse(await read('data/posts.json'));
const KO_POST = posts.find(post => post.lang !== 'en' && /[가-힣]/.test(post.href));
const EN_POST = posts.find(post => post.lang === 'en');
const NAVER = '/naver96f43741acd96bcdeb679f22cddc4a80.html';
const YANDEX = '/yandex_9866f357776964b4.html';
const REPORT_HTML_LINK = /\/reports\/[^"'<>\s]*\.html?(?=["'?#<\s]|$)/i;

function encodedPath(href) {
  return new URL(`/${href}`, PRODUCTION_ORIGIN).pathname;
}

async function exists(pathname) {
  try {
    await access(new URL(`.${decodeURIComponent(pathname)}`, ROOT));
    return true;
  } catch (_) {
    return false;
  }
}

/** Pages static-asset behaviour: an existing `x.html` answers 308 → `x`, `x` serves the file, the rest 404. */
async function pagesAsset(request) {
  const url = new URL(request.url);
  if (/\.html$/i.test(url.pathname) && await exists(url.pathname)) {
    return new Response(null, { status: 308, headers: { location: url.pathname.replace(/\.html$/i, '') + url.search } });
  }
  const file = /\.[a-z0-9]+$/i.test(url.pathname) ? url.pathname : `${url.pathname}.html`;
  if (await exists(file)) {
    const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
    return new Response(await readFile(new URL(`.${decodeURIComponent(file)}`, ROOT)), { headers: { 'content-type': type } });
  }
  return new Response('missing', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function get(pathWithQuery, { method = 'GET', origin = PRODUCTION_ORIGIN } = {}) {
  const request = new Request(new URL(pathWithQuery, origin), { method, redirect: 'manual' });
  return middleware({ request, env: { ASSETS: { fetch: pagesAsset } }, next: () => pagesAsset(request) });
}

test('1. report .html answers one 301 to the extensionless URL and keeps the query (KO Hangul and EN)', async () => {
  for (const post of [KO_POST, EN_POST]) {
    const legacy = encodedPath(post.href);
    const response = await get(`${legacy}?utm_source=x&a=1`);
    assert.equal(response.status, 301, legacy);
    const location = response.headers.get('location');
    assert.equal(location, `${PRODUCTION_ORIGIN}${legacy.replace(/\.html$/i, '')}?utm_source=x&a=1`);
    assert.equal(location, new URL(`${reportSiteUrl(post.href)}?utm_source=x&a=1`).href, 'Location equals the canonical URL');
    assert.doesNotMatch(location, /%25/, 'Hangul path must not be percent-encoded twice');
    assert.match(location, /^[\x21-\x7e]+$/, 'Location header stays ASCII');
  }
  const head = await get(encodedPath(EN_POST.href), { method: 'HEAD' });
  assert.equal(head.status, 301);
  const preview = await get(encodedPath(EN_POST.href), { origin: 'https://fix-seo.market-research-site.pages.dev' });
  assert.equal(preview.status, 301);
  assert.equal(new URL(preview.headers.get('location')).origin, 'https://fix-seo.market-research-site.pages.dev');
});

test('2. extensionless report URL answers 200 directly', async () => {
  for (const post of [KO_POST, EN_POST]) {
    const clean = encodedPath(post.href).replace(/\.html$/i, '');
    const response = await get(clean);
    assert.equal(response.status, 200, clean);
    assert.equal(response.headers.get('location'), null);
  }
});

test('3. rendered report carries an exact self-canonical and extensionless hreflang, og:url and JSON-LD', async () => {
  for (const post of [KO_POST, EN_POST]) {
    const clean = encodedPath(post.href).replace(/\.html$/i, '');
    const html = await (await get(clean)).text();
    const canonicals = [...html.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(canonicals, [reportSiteUrl(post.href)]);
    assert.equal(canonicals[0], `${PRODUCTION_ORIGIN}${clean}`);
    const head = html.slice(0, html.search(/<\/head>/i));
    assert.doesNotMatch(head, REPORT_HTML_LINK, `${clean}: head must not reference a report .html URL`);
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotMatch(block[1], REPORT_HTML_LINK);
    }
  }
});

test('4. the redirect target is final: no chain', async () => {
  for (const post of [KO_POST, EN_POST]) {
    const first = await get(`${encodedPath(post.href)}?q=1`);
    const target = new URL(first.headers.get('location'));
    const second = await get(`${target.pathname}${target.search}`);
    assert.equal(second.status, 200);
  }
});

test('5. a missing report answers 404 directly for both spellings', async () => {
  for (const path of ['/reports/does-not-exist-xyz.html', '/reports/does-not-exist-xyz', '/reports/en/missing.html', '/reports/없는-리포트.html']) {
    const response = await get(encodeURI(path));
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('location'), null, path);
  }
});

test('6-7. root verification files are never redirected by the report rule and have a 200 rewrite', async () => {
  const redirects = await read('_redirects');
  for (const file of [NAVER, YANDEX]) {
    const bare = file.replace(/\.html$/, '');
    assert.match(redirects, new RegExp(`^${file.replace(/\./g, '\\.')} ${bare} 200$`, 'm'));
    assert.ok(await exists(file), `${file} must exist at the site root`);
    const request = new Request(new URL(file, PRODUCTION_ORIGIN));
    const response = await middleware({
      request,
      env: {},
      next: async () => new Response(await read(file.slice(1)), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    });
    assert.equal(response.status, 200, file);
    assert.equal(response.headers.get('location'), null);
  }
  assert.match(await read(NAVER.slice(1)), /naver-site-verification: naver96f43741acd96bcdeb679f22cddc4a80\.html/);
});

test('8. sitemap has no .html URL, no duplicate, and every report URL maps to a published file', async () => {
  const xml = sitemapXml(posts);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const hreflangs = [...xml.matchAll(/hreflang="[^"]+" href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(locs.filter(loc => /\.html?$/i.test(loc)).length, 0);
  assert.equal(hreflangs.filter(href => /\.html?$/i.test(href)).length, 0);
  assert.equal(new Set(locs).size, locs.length);
  const reportLocs = locs.filter(loc => new URL(loc).pathname.startsWith('/reports/'));
  assert.equal(reportLocs.length, posts.length);
  for (const loc of reportLocs) {
    const pathname = new URL(loc).pathname;
    assert.ok(await exists(`${pathname}.html`), `${loc} must be served by a report file`);
  }
});

test('9. server-rendered and client-rendered internal links never point at report .html', async () => {
  for (const [path, shell] of [['/', 'index.html'], ['/en/', 'en/index.html'], ['/daily/', 'daily/index.html'], ['/en/daily/', 'en/daily/index.html']]) {
    const request = new Request(new URL(path, PRODUCTION_ORIGIN));
    const response = await middleware({
      request,
      env: { ASSETS: { fetch: pagesAsset } },
      next: async () => new Response(await read(shell), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    });
    const html = await response.text();
    const hrefs = [...html.matchAll(/href="([^"]*\/reports\/[^"]*)"/g)].map(match => match[1]);
    assert.ok(hrefs.length > 0, `${path} renders report links`);
    for (const href of hrefs) assert.doesNotMatch(href, /\.html?($|[?#])/i, `${path}: ${href}`);
  }
  for (const post of [KO_POST, EN_POST]) {
    const html = await (await get(encodedPath(post.href).replace(/\.html$/i, ''))).text();
    const hrefs = [...html.matchAll(/href="([^"]*\/reports\/[^"]*)"/g)].map(match => match[1]);
    for (const href of hrefs) assert.doesNotMatch(href, /\.html?($|[?#])/i, href);
  }
  // Client renderers wrap every report href in their clean-URL helper; the Market
  // page's Daily CTA strips the extension from the stored href as well.
  for (const file of ['assets/site.js', 'assets/category-landing.js', 'assets/report-shell.js']) {
    const source = await read(file);
    for (const match of source.matchAll(/href="\$\{([^}]*\.href[^}]*)\}"/g)) {
      assert.match(match[1], /cleanReportUrl\(/, `${file}: ${match[0]}`);
    }
  }
  const market = await read('assets/market-close.js');
  assert.match(market, /String\(exactDaily\.href\)\.replace\(\/\^\\\/\+\/, ''\)\.replace\(\/\\\.html\?\$\/i, ''\)/);
});
