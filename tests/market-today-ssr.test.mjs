// /market/ and /en/market/ (TODAY) carry the newest final session's dashboard
// in the first HTML (functions/_initial-html.js), drawn by the session page's
// renderer, so crawlers and a slow phone get the figures before
// assets/market-close.js runs. The script then draws TODAY over it as before.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { onRequest as middleware } from '../functions/_middleware.js';
import { buildInitialHtml } from '../functions/_initial-html.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [SHELL_KO, SHELL_EN, EXAMPLE, FUNDS_MIGRATION, MARKET_JS] = await Promise.all([
  read('market/index.html'), read('en/market/index.html'), read('contracts/market_close/market_close.example.json'),
  read('migrations/comments/0006_market_funds.sql'), read('assets/market-close.js')
]);
const SHELLS = { '/market/': SHELL_KO, '/en/market/': SHELL_EN };

function database() {
  const db = new SqliteD1();
  db.database.prepare(`CREATE TABLE market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  for (const [date, close, status] of [['2026-11-24', 5006.03, 'final'], ['2026-11-25', 4697.51, 'final'], ['2026-11-26', 4800.12, 'provisional']]) {
    const payload = JSON.parse(EXAMPLE);
    payload.meta.market_date = date;
    payload.meta.status = status;
    payload.indices.KOSPI.close = close;
    db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source) VALUES (?, ?, ?, ?, ?, ?, 'test')`)
      .run(date, payload.meta.schema_version, payload.meta.generated_at, status, JSON.stringify(payload), `${date}T07:10:00Z`);
  }
  db.exec(FUNDS_MIGRATION);
  const day = {
    market_date: '2026-11-24', previous_date: '2026-11-23', retrieved_at: '2026-11-25T08:30:00+09:00', source: '금융투자협회 증시자금 추이',
    items: [{ code: 'DEPOSITS', value: 82049700, previous_value: 85336163 }, { code: 'FORCED_SALE', value: 13675, previous_value: 11147 }]
  };
  db.database.prepare(`INSERT INTO market_funds VALUES (?, '1.0.0', ?, ?, ?, 'test')`).run(day.market_date, '2026-11-24T23:30:00Z', JSON.stringify(day), '2026-11-24T23:30:05Z');
  return db;
}

async function page(pathWithQuery, env) {
  const url = new URL(`https://snowshagal.com${pathWithQuery}`);
  const response = await middleware({
    request: new Request(url),
    env: { ...env, ASSETS: { fetch: async () => new Response('[]', { headers: { 'content-type': 'application/json' } }) } },
    next: async () => new Response(SHELLS[url.pathname], { headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
  return { status: response.status, html: await response.text() };
}

const dashboardOpen = html => (/<div\b[^>]*\bid="market-dashboard-view"[^>]*>/.exec(html) || [''])[0];

test('/market/ ships the newest final session’s figures in the first HTML', async () => {
  const db = database();
  const { status, html } = await page('/market/', { COMMENTS_DB: db });
  assert.equal(status, 200);
  const open = dashboardOpen(html);
  assert.match(open, /data-ssr-date="2026-11-25"/, 'the newest final session, not the provisional one after it');
  assert.match(open, /class="market-wrap market-dashboard mk-dashboard"/);
  assert.match(html, /<strong class="mk-index-value[^"]*">4,697\.51<\/strong>|mk-index-value[^>]*>4,697\.51/);
  assert.doesNotMatch(html, /4,800\.12/);
  // TODAY's market funds rule: the newest stored day up to the session, under its own date.
  assert.match(html, /mk-funds-card[\s\S]*?2026\.11\.24 기준/);
  // The static placeholder cards are gone; the header and the date bar stay.
  assert.doesNotMatch(html, /유가증권시장 대표 벤치마크 지수/);
  assert.match(html, /<h1 id="market-close-heading">/);
  assert.match(html, /mk-datebar market-history-strip/);
  // Exactly one dashboard mount.
  assert.equal(html.split('id="market-dashboard-view"').length - 1, 1);
});

test('/en/market/ ships the same session in English', async () => {
  const { html } = await page('/en/market/', { COMMENTS_DB: database() });
  assert.match(dashboardOpen(html), /data-ssr-date="2026-11-25"/);
  assert.match(html, /Market Funds[\s\S]*?As of Nov 24, 2026/);
  assert.doesNotMatch(html, /주요 지수|코스피 6/);
});

test('a past date, a period view, no database or a failing one keep the static shell', async () => {
  const db = database();
  for (const path of ['/market/?date=2026-11-24', '/market/?view=1w']) {
    const { status, html } = await page(path, { COMMENTS_DB: db });
    assert.equal(status, 200, path);
    assert.doesNotMatch(dashboardOpen(html), /data-ssr-date/, path);
    assert.match(html, /유가증권시장 대표 벤치마크 지수/, path);
  }
  const broken = { prepare() { throw new Error('d1 down'); } };
  for (const env of [{}, { COMMENTS_DB: broken }]) {
    const { status, html } = await page('/market/', env);
    assert.equal(status, 200);
    assert.doesNotMatch(dashboardOpen(html), /data-ssr-date/);
  }
  assert.equal(await buildInitialHtml(new URL('https://snowshagal.com/market/archive/'), { COMMENTS_DB: db }), null, 'other /market/ pages are their own');
});

test('the script keeps the server’s figures at full strength while TODAY loads', () => {
  const load = MARKET_JS.slice(MARKET_JS.indexOf("const dashboardView = document.getElementById('market-dashboard-view');"));
  assert.match(load.slice(0, 400), /if \(dashboardView && !\(mode === 'today' && dashboardView\.dataset\?\.ssrDate\)\) \{\s*dashboardView\.classList\.add\('is-loading'\);/);
});
