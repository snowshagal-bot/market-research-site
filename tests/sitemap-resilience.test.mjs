import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { onRequestGet, SITEMAP_MARKET_BUDGET_MS } from '../functions/sitemap.xml.js';

const SCHEMA = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
const MAIN = 'https://snowshagal.com';
const PREVIEW = 'https://test.market-research-site.pages.dev';
const pair = [
  { href: 'reports/test.html', lang: 'ko', type: 'daily', registeredAt: '2026-11-25T23:45:00Z', translationGroup: 'test' },
  { href: 'reports/en/test.html', lang: 'en', type: 'daily', registeredAt: '2026-11-26T00:05:00Z', translationGroup: 'test' }
];

function entries(xml) {
  return new Map([...xml.matchAll(/<url><loc>([^<]+)<\/loc>([\s\S]*?)<\/url>/g)].map(([, loc, rest]) => [
    new URL(loc).pathname, { lastmod: rest.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1], rest }
  ]));
}

function fixture(t) {
  const db = new SqliteD1();
  db.exec(SCHEMA);
  t.after(() => db.close());
  const cache = new Map();
  const puts = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'info', () => {});
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { open: async (name) => {
      assert.equal(name, 'snowshagal-sitemap-v1');
      return {
        match: async key => cache.get(key.url)?.clone(),
        put: async (key, response) => { puts.push(key.url); cache.set(key.url, response.clone()); },
        delete: async key => cache.delete(key.url)
      };
    } }
  });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'caches', descriptor) : delete globalThis.caches);
  let posts = pair;
  const failures = new Map();
  const env = {
    ASSETS: { fetch: async () => failures.has('posts') ? new Response('', { status: 500 }) : Response.json(posts) },
    COMMENTS_DB: { prepare(sql) {
      for (const [table, error] of failures) {
        if (sql.includes(`FROM ${table} `)) return { all: error };
      }
      return db.prepare(sql);
    } }
  };
  function session(date, at, { krx = 3000, us, nikkei, dxy = 100 } = {}) {
    const item = (close, source_date = date) => ({ close, source_date, previous_close: close - 1, data_state: 'final_close' });
    const payload = {
      indices: { KOSPI: item(krx), KOSDAQ: item(800), NASDAQ: us && item(23585.8, us), NIKKEI225: nikkei && item(nikkei) },
      rates_fx_volatility: { VIX: us && item(28.29, us), DXY: item(dxy), USDKRW: item(1338) }
    };
    db.database.prepare(`INSERT OR REPLACE INTO market_close_snapshots
      (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source)
      VALUES (?, '1.2.0', ?, 'final', ?, ?, 'test')`).run(date, at, JSON.stringify(payload), at);
  }
  function day(table, date, at, items) {
    const rates = table === 'market_domestic_rates';
    db.database.prepare(`INSERT OR REPLACE INTO ${table}
      (market_date, schema_version, retrieved_at, payload_json, published_at, auth_source${rates ? ', basis_time' : ''})
      VALUES (?, '1.0.0', ?, ?, ?, 'test'${rates ? ", '16:00'" : ''})`)
      .run(date, at, JSON.stringify({ items, basis_time: '16:00' }), at);
  }
  async function request(origin = MAIN, suffix = '') {
    const background = [];
    const response = await onRequestGet({ request: new Request(`${origin}/sitemap.xml${suffix}`), env, waitUntil: p => background.push(p) });
    await Promise.all(background);
    return response;
  }
  return { db, cache, puts, failures, session, day, request, setPosts: value => { posts = value; } };
}

test('successful queries with no stored sessions return a complete sitemap for that empty database', async (t) => {
  const state = fixture(t);
  const response = await state.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-sitemap-source'), 'fresh');
  const xml = await response.text();
  assert.match(xml, /<loc>https:\/\/snowshagal\.com\/reports\/en\/test<\/loc>/);
  assert.doesNotMatch(xml, /\/market\/archive\//);
  assert.deepEqual(state.puts, [`${MAIN}/sitemap.xml?__sitemap_last_good=1`]);
});

test('partial D1 failure serves byte-identical complete XML from the same host and recovers with fresh XML', async (t) => {
  const state = fixture(t);
  state.session('2026-11-26', '2026-11-26T07:30:00Z');
  state.day('market_domestic_rates', '2026-11-26', '2026-11-26T08:00:00Z', [{ code: 'KTB3Y', value: 3 }]);
  state.day('market_funds', '2026-11-25', '2026-11-26T08:20:00Z', [{ code: 'FORCED_SALE', value: 8400 }]);
  const normal = await state.request();
  const complete = await normal.text();
  assert.equal(normal.headers.get('cache-control'), 'public, max-age=300');
  assert.ok(entries(complete).has('/en/market/forced-selling/'));
  assert.ok(entries(complete).has('/market/ktb3y/'));

  state.failures.set('market_domestic_rates', async () => { throw new Error('rates D1 unavailable'); });
  state.failures.set('market_funds', async () => ({ success: false, results: [] }));
  const fallback = await state.request(MAIN, '?ignored=yes');
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get('x-sitemap-source'), 'last-known-good');
  assert.equal(fallback.headers.get('cache-control'), 'no-store');
  assert.equal(await fallback.text(), complete);
  assert.equal(state.puts.filter(url => url.includes('last_good')).length, 1, 'failed generation must not replace the snapshot');
  assert.deepEqual(console.error.mock.calls[0].arguments, ['sitemap_generation_failed', {
    failures: { rates: 'rates D1 unavailable', funds: 'Invalid market funds result' },
    potentialMissingMarketUrls: 4, potentialMissingReportUrls: 0, recovery: 'serving-last-known-good'
  }]);

  const cold = await state.request(PREVIEW);
  assert.equal(cold.status, 503);
  assert.equal(cold.headers.get('cache-control'), 'no-store');
  assert.equal(cold.headers.get('retry-after'), '60');
  assert.doesNotMatch(await cold.text(), /<urlset>/);
  assert.ok(!state.cache.has(`${PREVIEW}/sitemap.xml?__sitemap_last_good=1`));

  state.failures.clear();
  state.session('2026-11-27', '2026-11-27T07:30:00Z');
  state.setPosts([...pair, { ...pair[0], href: 'reports/new.html', translationGroup: '' }]);
  const recovery = await state.request();
  const newXml = await recovery.text();
  assert.equal(recovery.status, 200);
  assert.equal(recovery.headers.get('x-sitemap-source'), 'fresh');
  assert.ok(entries(newXml).has('/market/2026-11-27/'));
  assert.ok(entries(newXml).has('/reports/new'));
  assert.ok(console.info.mock.calls.some(call => call.arguments[0] === 'sitemap_recovered'));
  assert.ok(!state.cache.has(`${MAIN}/sitemap.xml?__sitemap_failure=1`));
});

test('a timed-out source returns 503 without a snapshot and logs the source and retry state', async (t) => {
  const state = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  state.failures.set('market_close_snapshots', () => new Promise(() => {}));
  const pending = state.request();
  t.mock.timers.tick(SITEMAP_MARKET_BUDGET_MS);
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  const [, diagnostic] = console.error.mock.calls[0].arguments;
  assert.match(diagnostic.failures.sessions, /2000 ms/);
  assert.equal(diagnostic.potentialMissingMarketUrls, null);
  assert.equal(diagnostic.recovery, 'pending');
});

test('lastmod follows each material series change through US holiday, KOFIA lag, weekend, FX lag and corrections', async (t) => {
  const state = fixture(t);
  const clock = (value) => t.mock.timers.setTime(Date.parse(value));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-25T08:00:00Z') });
  const funds = (date, at, forced, deposits) => state.day('market_funds', date, at, [
    { code: 'FORCED_SALE', value: forced, previous_value: 13700 }, { code: 'DEPOSITS', value: deposits }
  ]);
  const fx = (date, at, value) => state.day('market_fx_close', date, at, [{ code: 'USDKRW', value, previous_value: 1342.4 }]);
  const get = async () => entries(await (await state.request()).text());
  const lastmod = (map, slug, expected) => {
    for (const prefix of ['', '/en']) assert.equal(map.get(`${prefix}/market/${slug}/`).lastmod, expected, `${prefix}/${slug}`);
  };

  state.session('2026-11-25', '2026-11-25T07:15:00Z', { us: '2026-11-24', nikkei: 46000 });
  funds('2026-11-24', '2026-11-25T07:30:00Z', 13700, 55500);
  const initial = await get();
  lastmod(initial, 'vix', undefined);
  lastmod(initial, 'forced-selling', undefined);

  clock('2026-11-26T10:00:00Z');
  state.session('2026-11-26', '2026-11-26T07:15:00Z', { us: '2026-11-25', nikkei: 46010 });
  fx('2026-11-25', '2026-11-25T09:00:00Z', 1343.2);
  fx('2026-11-26', '2026-11-26T08:30:00Z', 1342.7);
  funds('2026-11-25', '2026-11-26T07:48:00Z', 8400, 55600);
  const updated = await get();
  lastmod(updated, 'vix', '2026-11-26T07:15:00.000Z');
  lastmod(updated, 'nasdaq', '2026-11-26T07:15:00.000Z');
  lastmod(updated, 'forced-selling', '2026-11-26T07:48:00.000Z');

  clock('2026-11-27T10:00:00Z');
  state.session('2026-11-27', '2026-11-27T07:15:00Z', { us: '2026-11-25' });
  fx('2026-11-27', '2026-11-27T17:32:00+09:00', 1337.9);
  state.day('market_domestic_rates', '2026-11-27', '2026-11-27T08:12:00Z', [{ code: 'KTB3Y', value: 3.123 }]);
  const holiday = await get();
  lastmod(holiday, 'vix', '2026-11-26T07:15:00.000Z');
  lastmod(holiday, 'nasdaq', '2026-11-26T07:15:00.000Z');
  lastmod(holiday, 'nikkei225', '2026-11-26T07:15:00.000Z');
  lastmod(holiday, 'kospi', '2026-11-27T07:15:00.000Z');
  lastmod(holiday, 'ktb3y', '2026-11-27T08:12:00.000Z');
  lastmod(holiday, 'usdkrw', '2026-11-27T08:32:00.000Z');
  lastmod(holiday, 'forced-selling', '2026-11-26T07:48:00.000Z');
  assert.equal(holiday.get('/market/2026-11-27/').lastmod, '2026-11-27');
  assert.equal(holiday.get('/reports/test').lastmod, '2026-11-25');
  assert.equal(holiday.get('/reports/en/test').lastmod, '2026-11-26');

  clock('2026-11-28T09:00:00Z');
  funds('2026-11-25', '2026-11-28T00:35:00+09:00', 8400, 56200);
  state.session('2026-11-27', '2026-11-28T03:00:00Z', { us: '2026-11-25' });
  const saturday = await get();
  lastmod(saturday, 'deposits', '2026-11-27T15:35:00.000Z');
  lastmod(saturday, 'forced-selling', '2026-11-26T07:48:00.000Z');
  lastmod(saturday, 'kospi', '2026-11-27T07:15:00.000Z');
  lastmod(saturday, 'vix', '2026-11-26T07:15:00.000Z');
  assert.equal(saturday.get('/market/2026-11-27/').lastmod, '2026-11-28', 'the existing session policy still applies');

  clock('2026-11-30T10:00:00Z');
  state.session('2026-11-30', '2026-11-30', { us: '2026-11-27', krx: 3001 });
  const missingStamp = await get();
  lastmod(missingStamp, 'vix', undefined);
  lastmod(missingStamp, 'usdkrw', '2026-11-27T08:32:00.000Z');
  lastmod(missingStamp, 'forced-selling', '2026-11-26T07:48:00.000Z');
});
