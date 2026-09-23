// Homepage initial HTML (functions/_home-initial.js): Latest Research, the
// active notice and the TODAY strip in the HTTP response itself.
//
// The server runs the real /api/market/latest and /api/announcements handlers
// on an in-memory SQLite D1. The browser side runs the real assets/locale.js
// and assets/site.js against a DOM seeded from the same HTML, answering its
// requests with those same handlers, so every parity check compares what a
// reader sees before and after JavaScript on identical data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { onRequest as middleware } from '../functions/_middleware.js';
import { buildHomeInitial, homeInitialLang, latestResearchPost, serializeHomeBootstrap } from '../functions/_home-initial.js';
import { applyInitialHtmlToString } from '../functions/_initial-html.js';
import { onRequestGet as marketLatestGet } from '../functions/api/market/latest.js';
import { onRequestGet as announcementsGet } from '../functions/api/announcements.js';
import { ensureMarketTable, TABLE_NAME } from '../functions/api/market/_shared.js';
import { expectedPublishedKrxTradingDate } from '../functions/_trading-calendar.js';

const ORIGIN = 'https://snowshagal.com';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [KO_SHELL, EN_SHELL, LOCALE_JS, SITE_JS, SUMMARY_JS, MIGRATION, EXAMPLE, POSTS_JSON, TAGS_JSON] = await Promise.all([
  read('index.html'), read('en/index.html'), read('assets/locale.js'), read('assets/site.js'),
  read('data/market-summary.js'), read('migrations/comments/0001_admin_announcements.sql'),
  read('contracts/market_close/market_close.example.v1.2.0.json'), read('data/posts.json'), read('data/tags.json')
]);
const REAL_POSTS = JSON.parse(POSTS_JSON);
const shellFor = lang => (lang === 'en' ? EN_SHELL : KO_SHELL);

/** A KST wall-clock moment. */
function kst(date, time = '18:00') {
  return new Date(`${date}T${time}:00+09:00`);
}

/* ------------------------------------------------------------- database */

function payloadFor(marketDate, mutate) {
  const payload = JSON.parse(EXAMPLE);
  payload.meta.market_date = marketDate;
  if (mutate) mutate(payload);
  return payload;
}

async function database({ market = [], notices = [] } = {}) {
  const db = new SqliteD1();
  db.exec(MIGRATION);
  await ensureMarketTable({ COMMENTS_DB: db });
  for (const row of market) {
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(row.payload.meta.market_date, row.payload.meta.schema_version, row.payload.meta.generated_at, 'final', JSON.stringify(row.payload), '2026-09-01T00:00:00.000Z', 'test', row.ko || '', row.en || '')
      .run();
  }
  for (const [index, notice] of notices.entries()) {
    await db.prepare(`INSERT INTO admin_announcements (id, notice_type, title, content, audience, target_group, publish_state, exposure_start_at, exposure_end_at, created_by, updated_by, created_at, updated_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        notice.id || `notice-${index}`, notice.type || 'general', notice.title, notice.content, notice.audience || 'all',
        notice.audience === 'group' ? 'beta' : null, notice.state || 'published', notice.start, notice.end || null,
        'admin', 'admin', notice.created || notice.start, notice.updated || notice.start, notice.start
      )
      .run();
  }
  return db;
}

function assetsFor(posts) {
  return {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/data/posts.json') return new Response(JSON.stringify(posts), { headers: { 'content-type': 'application/json' } });
      if (pathname === '/data/tags.json') return new Response(TAGS_JSON, { headers: { 'content-type': 'application/json' } });
      return new Response('missing', { status: 404 });
    }
  };
}

/* ---------------------------------------------------------------- server */

/** What the middleware sends for / or /en/ at `now` (edits applied as it applies them). */
async function serverHome({ lang = 'ko', db, posts = REAL_POSTS, now, ...options }) {
  const url = new URL(lang === 'en' ? '/en/' : '/', ORIGIN);
  const home = await buildHomeInitial(url, { COMMENTS_DB: db }, posts, { now, ...options });
  let html = shellFor(lang);
  if (home) {
    html = applyInitialHtmlToString(html, home);
    if (home.head) html = html.replace(/<\/head>/i, `${home.head}</head>`);
  }
  return { html, home };
}

/* ------------------------------------------------------------ HTML reader */

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = text => String(text).replace(/&(?:amp|lt|gt|quot|#39);/g, match => ENTITIES[match]);

function nodeById(html, id) {
  // Quote-aware: a raw ">" is valid inside a quoted attribute value.
  const attr = `(?:[^>"']|"[^"]*"|'[^']*')*`;
  const open = new RegExp(`<([a-zA-Z][\\w-]*)\\b(${attr}\\bid="${id}"${attr})>`).exec(html);
  if (!open) return null;
  const tag = open[1].toLowerCase();
  const attrs = {};
  for (const match of open[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[match[1]] = match[2] === undefined ? '' : decode(match[2]);
  if (tag === 'img') return { tag, attrs, inner: '' };
  const start = open.index + open[0].length;
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  pattern.lastIndex = start;
  let depth = 1;
  let close;
  while ((close = pattern.exec(html))) {
    depth += close[1] ? -1 : 1;
    if (depth === 0) break;
  }
  return { tag, attrs, inner: html.slice(start, close.index) };
}

/* What a reader sees, per element: the fields site.js writes. */
const VIEW = {
  'hero-slide-1': ['aria-label', 'aria-hidden', 'hidden'],
  'hero-slide-notice': ['aria-label', 'aria-hidden', 'hidden'],
  'hero-slide-2': ['aria-label', 'aria-hidden', 'hidden'],
  'carousel-current': ['text'],
  'carousel-total': ['text'],
  'hero-carousel-controls': ['hidden'],
  'hero-carousel-prev': ['disabled', 'aria-disabled'],
  'hero-carousel-next': ['disabled', 'aria-disabled'],
  'hero-featured-date': ['text'],
  'hero-featured-reading': ['text', 'hidden'],
  'hero-featured-title-link': ['text', 'href'],
  'hero-featured-snippet': ['text'],
  'hero-featured-action-btn': ['href'],
  'hero-featured-img-link': ['href'],
  'hero-featured-img': ['src', 'srcset', 'sizes', 'alt'],
  'hero-notice-date': ['text'],
  'hero-notice-title': ['text'],
  'hero-notice-snippet': ['text'],
  'notice-dialog-date': ['text'],
  'notice-dialog-title': ['text'],
  'notice-dialog-content': ['text'],
  'today-strip-tag': ['text'],
  'today-strip-date': ['text'],
  'today-strip-notice': ['text', 'hidden'],
  'today-strip-transparency': ['html', 'hidden'],
  'today-market-grid': ['html', 'aria-busy'],
  'today-takeaway-row': ['hidden'],
  'today-takeaway-label': ['text'],
  'today-takeaway-text': ['text'],
  'today-takeaway-link': ['href']
};
const PROPERTIES = new Set(['href', 'src', 'srcset', 'sizes', 'alt']);

function htmlView(html) {
  const view = {};
  for (const [id, fields] of Object.entries(VIEW)) {
    const node = nodeById(html, id);
    assert.ok(node, `${id} is in the page`);
    view[id] = Object.fromEntries(fields.map(field => {
      if (field === 'text') return [field, decode(node.inner)];
      if (field === 'html') return [field, node.inner];
      if (field === 'hidden' || field === 'disabled') return [field, Object.hasOwn(node.attrs, field)];
      return [field, node.attrs[field] ?? (PROPERTIES.has(field) ? '' : null)];
    }));
  }
  return view;
}

/* --------------------------------------------------------------- browser */

function element(id = '', seed = null) {
  const attributes = new Map(Object.entries(seed?.attrs || {}).filter(([name]) => name !== 'hidden' && name !== 'disabled'));
  const classes = new Set(String(seed?.attrs?.class || '').split(/\s+/).filter(Boolean));
  const node = {
    id,
    value: '',
    hidden: Object.hasOwn(seed?.attrs || {}, 'hidden'),
    disabled: Object.hasOwn(seed?.attrs || {}, 'disabled'),
    textContent: seed ? decode(seed.inner) : '',
    innerHTML: seed ? seed.inner : '',
    href: seed?.attrs?.href || '',
    src: seed?.attrs?.src || '',
    srcset: seed?.attrs?.srcset || '',
    sizes: seed?.attrs?.sizes || '',
    alt: seed?.attrs?.alt || '',
    dataset: {},
    style: {},
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      toggle(name, force) { if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
    closest() { return element(); },
    appendChild() {},
    removeChild() {},
    remove() {},
    focus() {},
    blur() {},
    scrollIntoView() {},
    showModal() {},
    close() {},
    querySelector() { return element(); },
    querySelectorAll() { return []; }
  };
  return node;
}

function elementView(nodes) {
  const view = {};
  for (const [id, fields] of Object.entries(VIEW)) {
    const node = nodes[id];
    view[id] = Object.fromEntries(fields.map(field => {
      if (field === 'text') return [field, node.textContent];
      if (field === 'html') return [field, node.innerHTML];
      if (field === 'hidden' || field === 'disabled') return [field, node[field]];
      if (PROPERTIES.has(field)) return [field, node[field] || ''];
      return [field, node.getAttribute(field)];
    }));
  }
  return view;
}

/**
 * Boot the real locale.js + site.js on `html`. Requests to the two homepage
 * APIs are answered by their real handlers at `now`; every request is recorded.
 */
async function runBrowser({ html, lang = 'ko', db, posts = REAL_POSTS, now }) {
  const nodes = {};
  for (const id of [...Object.keys(VIEW), 'notice-dialog']) nodes[id] = element(id, nodeById(html, id));
  const bootstrap = nodeById(html, 'home-initial-data');
  if (bootstrap) nodes['home-initial-data'] = Object.assign(element('home-initial-data'), { textContent: bootstrap.inner });
  const hero = element('brand-hero');
  hero.querySelector = selector => ({
    '.hero-carousel-controls': nodes['hero-carousel-controls'],
    '.carousel-total': nodes['carousel-total']
  }[selector] || element());
  const requests = [];
  const env = { COMMENTS_DB: db };
  const window = { addEventListener() {}, RESEARCH_POSTS: posts };
  const context = vm.createContext({
    window,
    console,
    Intl,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    history: { replaceState() {} },
    location: { pathname: lang === 'en' ? '/en/' : '/', search: '', href: `${ORIGIN}/`, replace() {} },
    fetch: async url => {
      requests.push(url);
      const request = new Request(new URL(url, ORIGIN));
      if (url === '/api/market/latest') return marketLatestGet({ request, env, now });
      if (url === '/api/announcements') return announcementsGet({ request, env, now });
      return new Response('{}', { status: 404 });
    },
    document: {
      documentElement: Object.assign(element('html'), { lang, dataset: { siteLang: lang } }),
      head: element('head'),
      body: element('body'),
      readyState: 'complete',
      addEventListener() {},
      createElement: () => element('created'),
      getElementById: id => nodes[id] || (id === 'home-initial-data' ? null : element(id)),
      querySelector: selector => {
        if (selector === '.brand-hero') return hero;
        if (selector === '.hero-carousel-controls') return nodes['hero-carousel-controls'];
        if (selector === '.carousel-total') return nodes['carousel-total'];
        if (selector === '.today-takeaway-row') return nodes['today-takeaway-row'];
        if (selector === '.today-strip') return element('today-strip');
        return element();
      },
      querySelectorAll: () => []
    }
  });
  vm.runInContext(SUMMARY_JS.replace(/^﻿/, ''), context);
  vm.runInContext(LOCALE_JS, context);
  vm.runInContext(SITE_JS, context);
  await window.__heroCarouselTest?.noticeReady;
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setImmediate(resolve));
  return { view: elementView(nodes), requests };
}

/**
 * The server page, the browser on the static shell (no bootstrap) and the
 * browser on the server page must all show the same thing; the last one
 * without requesting what the server already rendered.
 */
async function assertParity(scenario) {
  const server = await serverHome(scenario);
  const rendered = htmlView(server.html);
  const cold = await runBrowser({ ...scenario, html: shellFor(scenario.lang) });
  assert.deepEqual(rendered, cold.view, 'server HTML equals what site.js paints on the static shell');
  const warm = await runBrowser({ ...scenario, html: server.html });
  assert.deepEqual(warm.view, rendered, 'site.js leaves the server HTML as it is');
  assert.deepEqual(warm.requests, [], 'nothing the server rendered is requested again');
  assert.deepEqual([...cold.requests].sort(), ['/api/announcements', '/api/market/latest']);
  return { server, rendered };
}

/* ------------------------------------------------------------ scenarios */

const NORMAL_DATE = '2026-09-23';
const NORMAL_NOW = kst('2026-09-24', '18:00'); // Chuseok: 09-23 is still the expected session
const STALE_NOW = kst('2026-09-29', '18:00');

function researchPost(lang, overrides = {}) {
  return {
    id: `r-${lang}`, type: 'research', lang, title: lang === 'en' ? 'Research <EN> & "co"' : '리서치 <제목> & "인용"',
    reportDate: '2026-09-19', date: '2026-09-19', registeredAt: '2026-09-19T00:00:00.000Z',
    summary: '', subtitle: '', description: 'Fallback description',
    readingMinutes: 12, href: `reports/${lang === 'en' ? 'en/' : ''}r-${lang}.html`,
    coverImage: `covers/r-${lang}.webp`, coverThumbnail: `covers/r-${lang}-450.webp`, ...overrides
  };
}

function dailyPost(lang, date, takeaway = '') {
  return {
    id: `d-${lang}-${date}`, type: 'daily', lang, title: `Daily ${lang} ${date}`, reportDate: date, date,
    registeredAt: `${date}T09:00:00.000Z`, href: `reports/${lang === 'en' ? 'en/' : ''}daily-${date}.html`, takeaway
  };
}

/* ================================================================ tests */

test('1. KO Latest Research is the newest KO research, rendered as site.js renders it', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const { rendered } = await assertParity({ lang: 'ko', db, now: NORMAL_NOW });
  const post = latestResearchPost(REAL_POSTS, 'ko');
  assert.equal(post.lang ?? 'ko', 'ko');
  assert.equal(rendered['hero-featured-title-link'].text, post.title);
  assert.equal(rendered['hero-featured-title-link'].href, `/${post.href.replace(/\.html$/, '')}`);
  assert.equal(rendered['hero-featured-date'].text, post.reportDate);
  assert.equal(rendered['hero-featured-img'].src, `/${post.coverImage}`);
  assert.equal(rendered['hero-featured-img'].sizes, '(max-width: 760px) 140px, 220px');
  assert.equal(rendered['hero-featured-img'].alt, post.title);
  assert.notEqual(rendered['hero-featured-snippet'].text, '—');
});

test('2. EN Latest Research is the newest EN research with an extensionless link', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const { rendered } = await assertParity({ lang: 'en', db, now: NORMAL_NOW });
  const post = latestResearchPost(REAL_POSTS, 'en');
  assert.equal(post.lang, 'en');
  assert.equal(rendered['hero-featured-title-link'].text, post.title);
  assert.doesNotMatch(rendered['hero-featured-action-btn'].href, /\.html$/);
  assert.equal(rendered['hero-featured-reading'].text, `${post.readingMinutes} min read`);
});

test('summary → subtitle → description fallback, reading time and cover without thumbnail match site.js', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  for (const overrides of [{ summary: 'S', subtitle: 'T' }, { subtitle: ' Sub ' }, { readingMinutes: 0 }, { coverThumbnail: '' }, { coverImage: '' }]) {
    const posts = [researchPost('ko', overrides), dailyPost('ko', NORMAL_DATE)];
    await assertParity({ lang: 'ko', db, posts, now: NORMAL_NOW });
  }
});

test('3. no research: the slide is hidden and the counter matches (with and without a notice)', async () => {
  const posts = [dailyPost('ko', NORMAL_DATE)];
  const plain = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const { rendered, server } = await assertParity({ lang: 'ko', db: plain, posts, now: NORMAL_NOW });
  assert.equal(rendered['hero-slide-2'].hidden, true);
  assert.equal(rendered['hero-carousel-controls'].hidden, true);
  assert.equal(rendered['carousel-total'].text, '01');
  assert.match(server.html, /id="hero-slide-2"[^>]*\bhidden\b/);

  const withNotice = await database({
    market: [{ payload: payloadFor(NORMAL_DATE) }],
    notices: [{ title: '안내', content: '본문', start: '2026-09-20T00:00:00.000Z' }]
  });
  const second = await assertParity({ lang: 'ko', db: withNotice, posts, now: NORMAL_NOW });
  assert.equal(second.rendered['carousel-total'].text, '02');
  assert.equal(second.rendered['hero-slide-notice'].hidden, false);
});

test('4. active notice: slide, dialog and a three-slide carousel in the first HTML (KO and EN, no translation)', async () => {
  const notice = { type: 'major', title: '시스템 점검 안내', content: '9월 30일 02:00~04:00 점검합니다.', start: '2026-09-22T15:30:00.000Z' };
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }], notices: [notice] });
  for (const lang of ['ko', 'en']) {
    const { rendered } = await assertParity({ lang, db, now: NORMAL_NOW });
    assert.equal(rendered['hero-slide-notice'].hidden, false);
    assert.equal(rendered['carousel-total'].text, '03');
    assert.equal(rendered['hero-slide-notice']['aria-label'], lang === 'en' ? '2 of 3: Announcement' : '2 of 3: 공지사항');
    assert.equal(rendered['hero-notice-title'].text, notice.title);
    assert.equal(rendered['notice-dialog-content'].text, notice.content);
    assert.equal(rendered['hero-notice-date'].text, lang === 'en' ? 'SEP 23, 2026' : '2026.09.23');
  }
});

test('5. no active notice: the notice slide stays hidden and the carousel has two slides', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const { rendered, server } = await assertParity({ lang: 'ko', db, now: NORMAL_NOW });
  assert.equal(rendered['hero-slide-notice'].hidden, true);
  assert.equal(rendered['carousel-total'].text, '02');
  assert.equal(rendered['hero-slide-2']['aria-label'], '2 of 2: 최신 리서치');
  assert.deepEqual(JSON.parse(nodeById(server.html, 'home-initial-data').inner).announcement, null);
});

test('6-7. expired, future, draft and group notices are excluded exactly as by the API', async () => {
  const db = await database({
    market: [{ payload: payloadFor(NORMAL_DATE) }],
    notices: [
      { title: 'expired', content: 'x', start: '2026-09-01T00:00:00.000Z', end: '2026-09-10T00:00:00.000Z' },
      { title: 'future', content: 'x', start: '2026-10-01T00:00:00.000Z' },
      { title: 'draft', content: 'x', start: '2026-09-01T00:00:00.000Z', state: 'draft' },
      { title: 'group', content: 'x', start: '2026-09-01T00:00:00.000Z', audience: 'group' }
    ]
  });
  const { rendered } = await assertParity({ lang: 'ko', db, now: NORMAL_NOW });
  assert.equal(rendered['hero-slide-notice'].hidden, true);
  assert.equal(rendered['hero-notice-title'].text, '—');
});

test('8. notice ordering is the API\'s: major first, then newest exposure start, then newest update', async () => {
  const db = await database({
    market: [{ payload: payloadFor(NORMAL_DATE) }],
    notices: [
      { id: 'g-new', type: 'general', title: 'general newest', content: 'x', start: '2026-09-22T00:00:00.000Z' },
      { id: 'm-old', type: 'major', title: 'major older', content: 'x', start: '2026-09-10T00:00:00.000Z', updated: '2026-09-10T00:00:00.000Z' },
      { id: 'm-new', type: 'major', title: 'major newer', content: 'x', start: '2026-09-15T00:00:00.000Z', updated: '2026-09-15T00:00:00.000Z' },
      { id: 'm-tie', type: 'major', title: 'major same start, updated later', content: 'x', start: '2026-09-15T00:00:00.000Z', updated: '2026-09-16T00:00:00.000Z' }
    ]
  });
  const api = await (await announcementsGet({ request: new Request(`${ORIGIN}/api/announcements`), env: { COMMENTS_DB: db }, now: NORMAL_NOW })).json();
  assert.equal(api.items[0].title, 'major same start, updated later');
  const { rendered } = await assertParity({ lang: 'ko', db, now: NORMAL_NOW });
  assert.equal(rendered['hero-notice-title'].text, api.items[0].title);
});

test('9. normal Market Close: TODAY, the session date and five real values in the first HTML', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  assert.equal(expectedPublishedKrxTradingDate(NORMAL_NOW), NORMAL_DATE);
  for (const lang of ['ko', 'en']) {
    const { rendered, server } = await assertParity({ lang, db, now: NORMAL_NOW });
    assert.equal(rendered['today-strip-tag'].text, 'TODAY');
    assert.equal(rendered['today-strip-date'].text, 'SEP 23');
    assert.equal(rendered['today-market-grid']['aria-busy'], null);
    assert.doesNotMatch(rendered['today-market-grid'].html, /—|pending/);
    assert.match(rendered['today-market-grid'].html, /6,788\.88/);
    assert.match(rendered['today-market-grid'].html, lang === 'en' ? /₩/ : /원/);
    assert.equal(rendered['today-strip-notice'].hidden, true);
    assert.equal(rendered['today-strip-transparency'].hidden, true);
    const boot = JSON.parse(nodeById(server.html, 'home-initial-data').inner);
    assert.equal(boot.market.expectedDate, NORMAL_DATE);
    assert.equal(boot.market.payload.meta.market_date, NORMAL_DATE);
  }
});

test('10. stale Market Close is LAST VERIFIED CLOSE with its notice from the first byte (KO/EN)', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  assert.ok(expectedPublishedKrxTradingDate(STALE_NOW) > NORMAL_DATE);
  for (const lang of ['ko', 'en']) {
    const { rendered } = await assertParity({ lang, db, now: STALE_NOW });
    assert.notEqual(rendered['today-strip-tag'].text, 'TODAY');
    assert.equal(rendered['today-strip-notice'].hidden, false);
    assert.ok(rendered['today-strip-notice'].text.length > 0);
  }
});

test('10b. date-specific transparency notices (09-18, 09-22) render as the browser renders them', async () => {
  const cases = [
    { latest: '2026-09-17', now: kst('2026-09-18', '18:00') },
    { latest: '2026-09-21', now: kst('2026-09-22', '18:00') }
  ];
  for (const { latest, now } of cases) {
    const db = await database({ market: [{ payload: payloadFor(latest) }] });
    for (const lang of ['ko', 'en']) {
      const { rendered } = await assertParity({ lang, db, now });
      assert.equal(rendered['today-strip-transparency'].hidden, false, `${latest} ${lang}`);
      assert.match(rendered['today-strip-transparency'].html, /market-transparency-card/);
    }
  }
});

test('11. SOFT indicators the 1.2.0 payload declares unavailable read "--"; KOSPI/KOSDAQ never do', async () => {
  const soft = payloadFor(NORMAL_DATE, payload => {
    payload.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['USDKRW', 'US10Y', 'GOLD', 'KOSPI'] };
    delete payload.rates_fx_volatility.USDKRW;
    delete payload.rates_fx_volatility.US10Y;
    delete payload.commodities_crypto.GOLD;
  });
  const db = await database({ market: [{ payload: soft }] });
  const { rendered } = await assertParity({ lang: 'ko', db, now: NORMAL_NOW });
  const values = [...rendered['today-market-grid'].html.matchAll(/today-value">([^<]*)</g)].map(match => match[1]);
  assert.deepEqual(values.slice(2), ['--', '--', '--']);
  assert.match(values[0], /\d/);

  const hardMissing = payloadFor(NORMAL_DATE, payload => {
    payload.section_status.global_indicators.unavailable = ['KOSPI'];
    delete payload.indices.KOSPI;
  });
  const server = await serverHome({ lang: 'ko', db: await database({ market: [{ payload: hardMissing }] }), now: NORMAL_NOW });
  assert.match(nodeById(server.html, 'today-strip-date').inner, /—/, 'a missing HARD item is never rendered as "--"');
  assert.equal(JSON.parse(nodeById(server.html, 'home-initial-data').inner).market, undefined);
});

test('12. D1 takeaway wins; otherwise the same-date, same-locale Daily supplies it and the link', async () => {
  const posts = [researchPost('ko'), dailyPost('ko', NORMAL_DATE, '같은 날 데일리 한 줄'), dailyPost('en', NORMAL_DATE, 'Same-day EN line')];
  const overridden = await database({ market: [{ payload: payloadFor(NORMAL_DATE), ko: 'D1 한 줄' }] });
  const first = await assertParity({ lang: 'ko', db: overridden, posts, now: NORMAL_NOW });
  assert.equal(first.rendered['today-takeaway-text'].text, 'D1 한 줄');
  assert.equal(first.rendered['today-takeaway-link'].href, `/reports/daily-${NORMAL_DATE}`);

  const plain = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const second = await assertParity({ lang: 'ko', db: plain, posts, now: NORMAL_NOW });
  assert.equal(second.rendered['today-takeaway-row'].hidden, false);
  assert.equal(second.rendered['today-takeaway-text'].text, '같은 날 데일리 한 줄');
});

test('13. a Daily from another date never supplies the line; the link goes to Market Close', async () => {
  const posts = [researchPost('en'), dailyPost('en', '2026-09-22', 'Yesterday line')];
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const { rendered } = await assertParity({ lang: 'en', db, posts, now: NORMAL_NOW });
  assert.equal(rendered['today-takeaway-row'].hidden, true);
  assert.equal(rendered['today-takeaway-text'].text, '');
  assert.equal(rendered['today-takeaway-link'].href, '/en/market/');
});

test('14. no cross-language takeaway: KO never shows EN text and EN never shows KO text', async () => {
  const posts = [researchPost('ko'), researchPost('en'), dailyPost('ko', NORMAL_DATE, 'KO 데일리 한 줄')];
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE), ko: '' , en: '' }] });
  const en = await assertParity({ lang: 'en', db, posts, now: NORMAL_NOW });
  assert.equal(en.rendered['today-takeaway-row'].hidden, true);
  assert.equal(en.rendered['today-takeaway-link'].href, '/en/market/');
  const koOnly = await database({ market: [{ payload: payloadFor(NORMAL_DATE), en: 'EN only D1 line' }] });
  const ko = await assertParity({ lang: 'ko', db: koOnly, posts, now: NORMAL_NOW });
  assert.equal(ko.rendered['today-takeaway-text'].text, 'KO 데일리 한 줄');
  const boot = JSON.parse(nodeById((await serverHome({ lang: 'ko', db: koOnly, posts, now: NORMAL_NOW })).html, 'home-initial-data').inner);
  assert.deepEqual(boot.market.payload.takeaway, { ko: '' }, 'only this locale\'s line travels');
});

/* ---------------------------------------------------------------- failure */

const broken = { prepare() { throw new Error('d1 down'); }, batch() { throw new Error('d1 down'); } };

async function middlewareHome(lang, env) {
  const request = new Request(new URL(lang === 'en' ? '/en/' : '/', ORIGIN));
  return middleware({
    request,
    env: { ASSETS: assetsFor(REAL_POSTS), ...env },
    next: async () => new Response(shellFor(lang), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
}

test('15. Market failure: homepage 200, strip left to the script, notice still rendered', async () => {
  const noticeDb = await database({ notices: [{ title: '공지', content: '본문', start: '2026-09-20T00:00:00.000Z' }] });
  const server = await serverHome({ lang: 'ko', db: noticeDb, now: NORMAL_NOW, readMarket: async () => { throw new Error('market down'); } });
  const boot = JSON.parse(nodeById(server.html, 'home-initial-data').inner);
  assert.equal(boot.market, undefined);
  assert.equal(boot.announcement.title, '공지');
  assert.equal(decode(nodeById(server.html, 'today-strip-date').inner), '—');
  assert.equal(nodeById(server.html, 'today-market-grid').attrs['aria-busy'], 'true');
  const browser = await runBrowser({ html: server.html, db: noticeDb, now: NORMAL_NOW });
  assert.deepEqual(browser.requests, ['/api/market/latest'], 'the script fetches only what the server did not render');

  const response = await middlewareHome('ko', { COMMENTS_DB: broken });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="latest-category-cards"[^>]*>\s*<a /, 'the existing card SSR is kept');
  assert.match(html, /id="hero-featured-title-link" href="\/reports\//, 'research needs no database');
  assert.doesNotMatch(html, /id="home-initial-data"/);
});

test('16. Announcement failure: homepage 200, market rendered, notice and counter left to the script', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const server = await serverHome({ lang: 'ko', db, now: NORMAL_NOW, readNotice: async () => { throw new Error('notice down'); } });
  const boot = JSON.parse(nodeById(server.html, 'home-initial-data').inner);
  assert.equal(Object.hasOwn(boot, 'announcement'), false);
  assert.equal(decode(nodeById(server.html, 'today-strip-date').inner), 'SEP 23');
  const browser = await runBrowser({ html: server.html, db, now: NORMAL_NOW });
  assert.deepEqual(browser.requests, ['/api/announcements']);
  assert.deepEqual(browser.view, htmlView((await serverHome({ lang: 'ko', db, now: NORMAL_NOW })).html));
});

test('17. timeout: a source past the budget is dropped, the other is kept, and the page is 200', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const never = () => new Promise(() => {});
  const started = Date.now();
  const server = await serverHome({ lang: 'ko', db, now: NORMAL_NOW, budgetMs: 50, readMarket: never });
  assert.ok(Date.now() - started < 1000);
  const boot = JSON.parse(nodeById(server.html, 'home-initial-data').inner);
  assert.equal(boot.market, undefined);
  assert.equal(boot.announcement, null);

  const hanging = { prepare() { return { bind() { return this; }, first: never, all: never, run: never }; } };
  const response = await middlewareHome('en', { COMMENTS_DB: hanging });
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /id="home-initial-data"/);
});

test('18. bootstrap JSON cannot close its script element and round-trips exactly', () => {
  const hostile = { announcement: { title: '</script><script>alert(1)</script>', content: '<!-- & ' + String.fromCharCode(0x2028, 0x2029) + ' -->', exposureStartAt: null, createdAt: null } };
  const markup = serializeHomeBootstrap(hostile);
  const open = '<script id="home-initial-data" type="application/json">';
  assert.ok(markup.startsWith(open) && markup.endsWith('</script>'));
  const json = markup.slice(open.length, -'</script>'.length);
  assert.doesNotMatch(json, /[<>&]/, 'no raw <, > or & inside the element');
  assert.ok(!json.includes(String.fromCharCode(0x2028)) && !json.includes(String.fromCharCode(0x2029)));
  assert.deepEqual(JSON.parse(json), hostile);
});

test('bootstrap carries only public fields the page uses', async () => {
  const db = await database({
    market: [{ payload: payloadFor(NORMAL_DATE), ko: 'KO', en: 'EN' }],
    notices: [{ title: 'T', content: 'C', start: '2026-09-20T00:00:00.000Z' }]
  });
  const { html } = await serverHome({ lang: 'ko', db, now: NORMAL_NOW });
  const boot = JSON.parse(nodeById(html, 'home-initial-data').inner);
  assert.deepEqual(Object.keys(boot).sort(), ['announcement', 'market']);
  assert.deepEqual(Object.keys(boot.announcement).sort(), ['content', 'createdAt', 'exposureStartAt', 'title']);
  assert.deepEqual(Object.keys(boot.market.payload).sort(), ['commodities_crypto', 'indices', 'meta', 'rates_fx_volatility', 'section_status', 'takeaway']);
  assert.deepEqual(Object.keys(boot.market.payload.indices.KOSPI).sort(), ['change', 'change_pct', 'close']);
  assert.ok(JSON.stringify(boot).length < 2000);
});

test('19. with a bootstrap the script makes no initial request to either API', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }], notices: [{ title: 'T', content: 'C', start: '2026-09-20T00:00:00.000Z' }] });
  for (const lang of ['ko', 'en']) {
    const server = await serverHome({ lang, db, now: NORMAL_NOW });
    const browser = await runBrowser({ lang, html: server.html, db, now: NORMAL_NOW });
    assert.deepEqual(browser.requests, []);
  }
});

test('20. without a bootstrap the script fetches both APIs as before', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  const browser = await runBrowser({ lang: 'ko', html: KO_SHELL, db, now: NORMAL_NOW });
  assert.deepEqual([...browser.requests].sort(), ['/api/announcements', '/api/market/latest']);
});

test('21. parity matrix: KO/EN × normal/stale × notice/no notice × schema 1.0.1/1.2.0', async () => {
  const legacy = payloadFor(NORMAL_DATE, payload => {
    payload.meta.schema_version = '1.0.1';
    delete payload.section_status;
  });
  for (const payload of [payloadFor(NORMAL_DATE), legacy]) {
    for (const notices of [[], [{ title: '공지 & <b>', content: '줄1\n줄2', start: '2026-09-20T00:00:00.000Z' }]]) {
      const db = await database({ market: [{ payload, ko: 'KO line', en: '' }], notices });
      for (const lang of ['ko', 'en']) {
        for (const now of [NORMAL_NOW, STALE_NOW]) await assertParity({ lang, db, now });
      }
    }
  }
});

test('the middleware renders / and /en/ from the live handlers and keeps the existing SSR', async () => {
  const db = await database({ market: [{ payload: payloadFor(NORMAL_DATE) }] });
  for (const lang of ['ko', 'en']) {
    const response = await middlewareHome(lang, { COMMENTS_DB: db });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.equal((html.match(/id="home-initial-data"/g) || []).length, 1);
    assert.ok(html.indexOf('id="home-initial-data"') < html.indexOf('</head>'));
    assert.notEqual(decode(nodeById(html, 'today-strip-date').inner), '—');
    assert.equal(nodeById(html, 'today-market-grid').attrs['aria-busy'], undefined);
    assert.notEqual(decode(nodeById(html, 'hero-featured-date').inner), '—');
    assert.match(nodeById(html, 'latest-category-cards').inner, /<a /);
    assert.match(nodeById(html, 'report-list').inner, /<a /);
  }
});

test('22. only / and /en/ are home pages; /disclosures/ and /calendar/ are untouched', async () => {
  assert.equal(homeInitialLang('/'), 'ko');
  assert.equal(homeInitialLang('/en/'), 'en');
  for (const path of ['/disclosures/', '/en/calendar/', '/daily/', '/market/', '/reports/x', '/en/about/']) {
    assert.equal(homeInitialLang(path), null, path);
    assert.equal(await buildHomeInitial(new URL(path, ORIGIN), {}, REAL_POSTS), null, path);
  }
  const shell = await read('disclosures/index.html');
  const response = await middleware({
    request: new Request(`${ORIGIN}/disclosures/`),
    env: { COMMENTS_DB: broken },
    next: async () => new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /home-initial-data/);
});
