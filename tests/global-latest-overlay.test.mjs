// Global Latest B3: the overlay policy (assets/locale.js) and /market/ TODAY
// (assets/market-close.js). Market Close is the base of every view; Global
// Latest may replace a global card's figures on TODAY only, one item at a time,
// and never on HISTORY, 1W or 1M. The homepage strip is covered with the real
// SSR handlers in tests/home-initial-ssr.test.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import '../assets/locale.js';
import { onRequestGet as globalLatestGet } from '../functions/api/market/global/latest.js';
import { GLOBAL_CODES, GLOBAL_LATEST_SERVED_AT_HEADER, validateGlobalLatestDocument } from '../functions/api/market/global/_shared.js';
import { EXPECTED_REASONS, MARKET_DATE, NOW, globalLatest0925, latestItem, snapshot0923 } from './helpers/global-latest-fixtures.mjs';

const LOCALE = globalThis.MARKET_LOCALE;
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [LOCALE_JS, MARKET_JS] = await Promise.all([read('assets/locale.js'), read('assets/market-close.js')]);
const MINUTE = 60 * 1000;

const reasonOf = (item, now = NOW, snapshot = null) => LOCALE.globalLatestItemStatus(item, now, snapshot).reason;
const usdkrw = fields => latestItem('USDKRW', 1354.4, 1367.36, { source_date: '2026-09-25', as_of: '2026-09-25T19:10:31Z', retrieved_at: '2026-09-25T19:16:02Z', data_state: 'intraday', ...fields });

/* ============================================================== policy */

test('the fixture is a valid receiver document apart from the items built to be rejected', () => {
  const valid = globalLatest0925().filter(item => !['WTI', 'DXY'].includes(item.code));
  const result = validateGlobalLatestDocument({ schema_version: '1.0.0', generated_at: '2026-09-25T19:29:00Z', items: valid }, Date.parse('2026-09-25T19:45:00Z'));
  assert.deepEqual(result.errors, []);
});

test('the overlay policy covers exactly the canonical Global Latest codes, never KOSPI or KOSDAQ', () => {
  assert.deepEqual(Object.keys(LOCALE.GLOBAL_LATEST_POLICY), [...GLOBAL_CODES]);
  assert.equal(LOCALE.isGlobalLatestCode('KOSPI'), false);
  assert.equal(LOCALE.isGlobalLatestCode('KOSDAQ'), false);
  const kospi = { ...usdkrw(), code: 'KOSPI' };
  const overlay = LOCALE.globalLatestOverlay([kospi, { ...kospi, code: 'KOSDAQ' }], snapshot0923(), NOW);
  assert.deepEqual(overlay.items, {});
});

test('each fixture item is judged as specified (fresh / stale / future / malformed)', () => {
  const overlay = LOCALE.globalLatestOverlay(globalLatest0925(), snapshot0923(), NOW);
  assert.deepEqual({ ...overlay.reasons }, EXPECTED_REASONS);
  assert.deepEqual(Object.keys(overlay.items).sort(), ['JPYKRW', 'NASDAQ', 'SOX', 'US10Y', 'USDKRW', 'VIX']);
});

test('intraday freshness is by as_of, per instrument: US 60 min, FX/DXY/WTI/GOLD 90 min, BITCOIN 60 min', () => {
  const at = minutes => new Date(Date.parse('2026-09-25T19:00:00Z') + minutes * MINUTE).toISOString().replace('.000', '');
  const now = Date.parse('2026-09-25T19:00:00Z');
  for (const [code, limit] of [['NASDAQ', 60], ['VIX', 60], ['US10Y', 60], ['USDKRW', 90], ['DXY', 90], ['WTI', 90], ['GOLD', 90], ['BITCOIN', 60]]) {
    const item = latestItem(code, 100, 99, { source_date: '2026-09-25', data_state: 'intraday' });
    const fresh = { ...item, as_of: at(-limit), retrieved_at: at(-limit + 1) };
    const stale = { ...item, as_of: at(-limit - 1), retrieved_at: at(-limit) };
    assert.equal(reasonOf(fresh, now), 'fresh', `${code} at ${limit} min`);
    assert.equal(reasonOf(stale, now), 'stale', `${code} past ${limit} min`);
  }
});

test('retrieved_at never makes an old observation fresh', () => {
  // Observed two hours ago, retrieved a minute ago.
  const item = usdkrw({ as_of: '2026-09-25T17:30:00Z', retrieved_at: '2026-09-25T19:29:00Z' });
  assert.equal(reasonOf(item), 'stale');
});

test('future as_of and future source_date are never overlaid; a few minutes of clock skew are', () => {
  assert.equal(reasonOf(usdkrw({ as_of: '2026-09-25T19:36:00Z', retrieved_at: '2026-09-25T19:36:01Z' })), 'future');
  assert.equal(reasonOf(usdkrw({ as_of: '2026-09-25T19:33:00Z', retrieved_at: '2026-09-25T19:33:01Z' })), 'fresh');
  assert.equal(reasonOf(usdkrw({ source_date: '2026-09-27', as_of: '2026-09-25T19:10:31Z' })), 'malformed');
});

test('malformed items are rejected one by one', () => {
  const base = usdkrw();
  const cases = {
    'value missing': { ...base, value: null },
    'value zero': { ...base, value: 0, change: -1367.36, change_pct: -100 },
    'value NaN': { ...base, value: Number.NaN },
    'value string': { ...base, value: '1354.4' },
    'previous close null': { ...base, previous_close: null, change: null, change_pct: null },
    'change contradicts': { ...base, change: 12.96 },
    'change_pct contradicts': { ...base, change_pct: 0.95 },
    'unknown state': { ...base, data_state: 'delayed' },
    'as_of without offset': { ...base, as_of: '2026-09-25T19:10:31' },
    'as_of unparseable': { ...base, as_of: 'yesterday' },
    'retrieved before observed': { ...base, retrieved_at: '2026-09-25T19:00:00Z' },
    'impossible source_date': { ...base, source_date: '2026-02-30' },
    'source_date far from as_of': { ...base, source_date: '2026-09-20' }
  };
  for (const [name, item] of Object.entries(cases)) assert.equal(reasonOf(item), 'malformed', name);
  assert.equal(LOCALE.globalLatestItemStatus(null, NOW).reason, 'unknown_code');
  assert.equal(LOCALE.globalLatestItemStatus(base, 'not a time').reason, 'no_clock');
});

test('final_close: respected for up to four days, only for instruments the collector finalises; VIX never', () => {
  const close = latestItem('NASDAQ', 27068.72, 26939.37, { source_date: '2026-09-25', as_of: '2026-09-25T20:00:00Z', retrieved_at: '2026-09-25T20:40:00Z', data_state: 'final_close' });
  // Friday's close through the weekend and Monday's pre-open.
  assert.equal(reasonOf(close, Date.parse('2026-09-28T13:00:00Z')), 'fresh');
  assert.equal(reasonOf(close, Date.parse('2026-09-30T00:00:00Z')), 'stale');
  for (const code of ['VIX', 'USDKRW', 'GOLD', 'BITCOIN']) {
    assert.equal(reasonOf({ ...close, code }, Date.parse('2026-09-25T21:00:00Z')), 'unexpected_final_close', code);
  }
});

test('an observation older than the snapshot figure never covers it', () => {
  const snapshot = snapshot0923();
  // Collector down since 09-19: its NASDAQ close predates the 09-22 close in the snapshot.
  const oldClose = latestItem('NASDAQ', 26000, 25900, { source_date: '2026-09-22', as_of: '2026-09-22T20:00:00Z', retrieved_at: '2026-09-22T20:40:00Z', data_state: 'final_close' });
  const overlay = LOCALE.globalLatestOverlay([oldClose], snapshot, Date.parse('2026-09-23T09:00:00Z'));
  assert.equal(overlay.reasons.NASDAQ, 'older_than_snapshot');
  // Without a retrieval stamp the session date decides.
  delete snapshot.indices.NASDAQ.retrieved_at;
  const byDate = LOCALE.globalLatestOverlay([{ ...oldClose, source_date: '2026-09-21', as_of: '2026-09-21T20:00:00Z', retrieved_at: '2026-09-21T20:30:00Z' }], snapshot, Date.parse('2026-09-23T09:00:00Z'));
  assert.equal(byDate.reasons.NASDAQ, 'older_than_snapshot');
});

test('a code sent twice is dropped; unknown codes and non-arrays are ignored', () => {
  const twice = LOCALE.globalLatestOverlay([usdkrw(), usdkrw()], snapshot0923(), NOW);
  assert.deepEqual(twice.items, {});
  assert.equal(twice.reasons.USDKRW, 'duplicate');
  assert.deepEqual(LOCALE.globalLatestOverlay([{ code: 'EURUSD' }, 7, null], snapshot0923(), NOW).items, {});
  for (const input of [null, undefined, {}, 'x']) assert.deepEqual(LOCALE.globalLatestOverlay(input, snapshot0923(), NOW).items, {});
});

test('the judging clock never runs behind the server, and a missing server time falls back to the browser', () => {
  const server = '2026-09-25T19:30:00.000Z';
  assert.equal(LOCALE.globalLatestNow(server, Date.parse('2026-09-25T17:00:00Z')), Date.parse(server));
  assert.equal(LOCALE.globalLatestNow(server, Date.parse('2026-09-25T20:00:00Z')), Date.parse('2026-09-25T20:00:00Z'));
  assert.equal(LOCALE.globalLatestNow('', Date.parse(server)), Date.parse(server));
  assert.equal(LOCALE.globalLatestNow('garbage', null), null);
});

test('basis labels: KO/EN say the same thing', () => {
  const pairs = [
    ['latest', { source_date: '2026-09-25', data_state: 'intraday' }, '9/25 · 장중', 'SEP 25 · INTRADAY'],
    ['latest', { source_date: '2026-09-25', data_state: 'final_close' }, '9/25 · 종가', 'SEP 25 · CLOSE'],
    ['krx', { source_date: '2026-09-23' }, '9/23 · 종가', 'SEP 23 · CLOSE'],
    ['snapshot', { source_date: '2026-09-23', data_state: 'intraday' }, '9/23 · 마감 시점', 'SEP 23 · AT KRX CLOSE'],
    ['snapshot', { source_date: '2026-09-22', data_state: 'final_close' }, '9/22 · 종가', 'SEP 22 · CLOSE'],
    ['latest', { source_date: '2026-09-05', data_state: 'intraday' }, '9/5 · 장중', 'SEP 05 · INTRADAY']
  ];
  for (const [kind, source, ko, en] of pairs) {
    assert.equal(LOCALE.todayStripBasis(kind, source, 'ko'), ko);
    assert.equal(LOCALE.todayStripBasis(kind, source, 'en'), en);
  }
  assert.equal(LOCALE.todayStripBasis('latest', { source_date: '', data_state: 'intraday' }, 'ko'), '');
});

/* ======================================================= receiver GET */

test('GET /api/market/global/latest states when it was served, on 200 and on 304', async () => {
  const rows = globalLatest0925().slice(0, 2).map(item => ({ code: item.code, as_of: item.as_of, retrieved_at: item.retrieved_at, payload_json: JSON.stringify(item), published_at: item.retrieved_at }));
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        first: async () => (/sqlite_master/.test(sql) ? { name: 'market_global_latest' } : null),
        all: async () => ({ results: rows })
      };
    }
  };
  const now = new Date('2026-09-25T19:30:00Z');
  const first = await globalLatestGet({ request: new Request('https://snowshagal.com/api/market/global/latest'), env: { COMMENTS_DB: db }, now });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get(GLOBAL_LATEST_SERVED_AT_HEADER), '2026-09-25T19:30:00.000Z');
  const again = await globalLatestGet({ request: new Request('https://snowshagal.com/api/market/global/latest', { headers: { 'if-none-match': first.headers.get('etag') } }), env: { COMMENTS_DB: db }, now: new Date('2026-09-25T19:31:00Z') });
  assert.equal(again.status, 304);
  assert.equal(again.headers.get(GLOBAL_LATEST_SERVED_AT_HEADER), '2026-09-25T19:31:00.000Z');
});

/* ======================================================== /market/ page */

function fixedClock(now) {
  const fixed = new Date(now).getTime();
  return class FixedDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(fixed);
    }
    static now() { return fixed; }
  };
}

const jsonResponse = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

/**
 * The real locale.js + market-close.js with a routed fetch. `global` answers
 * /api/market/global/latest: an items array, a Response, or a function.
 */
async function marketPage({ lang = 'ko', global = globalLatest0925(), now = NOW, search = '', latest = snapshot0923(), fastTimeout = true } = {}) {
  const target = { innerHTML: '', addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const window = { addEventListener() {}, removeEventListener() {} };
  const requests = [];
  const history = { pushState(_, __, url) { location.search = url.includes('?') ? url.slice(url.indexOf('?')) : ''; }, replaceState() {} };
  const location = { hostname: 'snowshagal.com', search, pathname: lang === 'en' ? '/en/market/' : '/market/' };
  const day = date => {
    const payload = snapshot0923();
    payload.meta.market_date = date;
    return payload;
  };
  const context = vm.createContext({
    window,
    document: {
      documentElement: { dataset: { siteLang: lang } },
      body: { dataset: { marketSource: '/api/market/latest' } },
      readyState: 'loading',
      addEventListener() {},
      getElementById: id => (id === 'market-close-root' ? target : null),
      querySelector() { return null; },
      querySelectorAll() { return []; }
    },
    location,
    history,
    fetch: async url => {
      const path = String(url);
      requests.push(path);
      if (path === '/api/market/dates') return jsonResponse({ dates: ['2026-09-23', '2026-09-22', '2026-09-19'], latest: '2026-09-23', earliest: '2026-09-19' });
      if (path === '/api/market/latest') return jsonResponse(latest);
      if (path.startsWith('/api/market/date?')) return jsonResponse(day(new URL(path, 'https://x').searchParams.get('date')));
      if (path.startsWith('/api/market/range?')) {
        return jsonResponse({ aggregation_version: '1.0.0', period: path.endsWith('1m') ? '1m' : '1w', window: { start_date: '2026-09-17', end_date: '2026-09-23', sessions_used: 5, required_sessions: 5, complete: true }, instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} }, flows: { markets: {} }, breadth: {}, krx_groups: { coverage_complete: false } });
      }
      if (path === '/api/market/global/latest') {
        if (typeof global === 'function') return global();
        if (global instanceof Response) return global;
        return jsonResponse({ schema_version: '1.0.0', items: global }, { [GLOBAL_LATEST_SERVED_AT_HEADER]: new Date(now).toISOString() });
      }
      return new Response('{}', { status: 404 });
    },
    setTimeout: (fn, ms) => setTimeout(fn, fastTimeout && ms === 2500 ? 5 : ms),
    clearTimeout,
    URL, URLSearchParams, Headers, Intl, Set, Map, console,
    Date: fixedClock(now)
  });
  vm.runInContext(LOCALE_JS, context);
  vm.runInContext(MARKET_JS, context);
  return { runtime: window.MARKET_CLOSE, target, requests };
}

/** Each instrument card of the rendered page: { name, value, change, state, basis }. */
function cards(html) {
  return [...html.matchAll(/<article class="instrument-card[^"]*"( data-basis="(\w+)")?>([\s\S]*?)<\/article>/g)].map(match => {
    const body = match[3];
    const text = pattern => (pattern.exec(body)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return {
      name: text(/<div class="instrument-heading"><span>([\s\S]*?)<\/span>/),
      value: text(/<strong class="instrument-value">([\s\S]*?)<\/strong>/),
      change: text(/<div class="instrument-change [^"]*">([\s\S]*?)<\/div>/),
      state: text(/<div class="instrument-state">([\s\S]*?)<\/div>\s*$/),
      basis: match[2] || null,
      body
    };
  });
}
const byName = (html, name) => cards(html).find(card => card.name === name);
const overlayCount = html => Number(/data-global-latest="(\d+)"/.exec(html)?.[1] ?? -1);

test('11. MARKET TODAY: fresh Global Latest replaces the global cards, each with its own basis', async () => {
  const { runtime, target, requests } = await marketPage();
  await runtime.init();
  assert.deepEqual(requests, ['/api/market/dates', '/api/market/global/latest', '/api/market/latest']);
  const html = target.innerHTML;
  assert.equal(overlayCount(html), 6);

  const nasdaq = byName(html, '나스닥 종합');
  assert.equal(nasdaq.basis, 'latest');
  assert.equal(nasdaq.value, '27,068.72');
  assert.match(nasdaq.change, /▲ \+129\.35 \(\+0\.48%\)/);
  assert.match(nasdaq.state, /^2026\.09\.25 · 장중 9월 26일 04:15 KST 기준$/);
  // The snapshot's open/high/low belong to 09-22: only the previous close of this observation is shown.
  assert.doesNotMatch(nasdaq.body, /시가|고가|저가/);
  assert.match(nasdaq.body, /<dt>전일<\/dt><dd>26,939\.37<\/dd>/);

  const us10y = byName(html, '미국 국채 10년');
  assert.equal(us10y.value, '5.184%');
  assert.match(us10y.change, /▲ 2\.2bp/);
  assert.equal(us10y.state, '2026.09.25 · 종가');

  const sox = byName(html, '필라델피아 반도체');
  assert.equal(sox.state, '2026.09.24 · 종가');

  const usdkrw = byName(html, '원/달러');
  assert.equal(usdkrw.value, '1,354.40원');
  // The 15:30 fixing context is the snapshot's; it is not shown next to a live figure.
  assert.doesNotMatch(usdkrw.body, /15:30 확정|instrument-current/);
  assert.match(usdkrw.state, /^2026\.09\.25 · 장중/);
});

test('6-8. MARKET TODAY: stale, future and malformed items keep their snapshot figures, marked as such', async () => {
  const { runtime, target } = await marketPage();
  await runtime.init();
  const html = target.innerHTML;
  for (const [name, value, state] of [
    ['S&P 500', '7,764.64', '2026.09.22 · 최근 종가'], // stale intraday
    ['국제 금', '$4,356.40', '2026.09.23 · 마감 시점'], // stale intraday
    ['달러인덱스', '100.76', '2026.09.23 · 마감 시점'], // future as_of
    ['WTI 원유', '$90.29', '2026.09.23 · 마감 시점'], // change contradicts value
    ['비트코인', '$86,073', '2026.09.23 · 마감 시점'], // no previous close
    ['다우존스', '51,863.70', '2026.09.22 · 최근 종가'] // absent
  ]) {
    const card = byName(html, name);
    assert.equal(card.basis, 'snapshot', name);
    assert.equal(card.value, value, name);
    assert.equal(card.state, state, name);
  }
});

test('12. MARKET TODAY: KRX figures and sections are the snapshot, untouched', async () => {
  const { runtime, target } = await marketPage();
  await runtime.init();
  const overlaid = target.innerHTML;
  const plain = await marketPage({ global: [] });
  await plain.runtime.init();
  const base = plain.target.innerHTML;
  for (const name of ['코스피', '코스닥']) {
    const card = byName(overlaid, name);
    assert.equal(card.basis, null);
    assert.deepEqual(card, byName(base, name));
  }
  // Everything below the global sections (breadth, flows, program/basis,
  // internals, short selling, market cap) is byte-identical.
  const tail = html => html.slice(html.indexOf('id="market-section-4"'));
  assert.equal(tail(overlaid), tail(base));
  assert.match(overlaid, /<p class="market-date">2026\.09\.23 · 15:30 KST 마감 기준<\/p>/);
});

test('9-10. MARKET TODAY: API failure, empty, malformed or late Global Latest leaves the Market Close page as it is', async () => {
  const baseline = await marketPage({ global: [] });
  await baseline.runtime.init();
  const expected = baseline.target.innerHTML;
  assert.equal(overlayCount(expected), 0);
  assert.doesNotMatch(expected, /data-basis/);
  const failures = {
    500: () => new Response('{"error":"x"}', { status: 500 }),
    503: () => new Response('{}', { status: 503 }),
    'malformed JSON': () => new Response('{not json', { status: 200 }),
    'items not an array': () => jsonResponse({ items: 'nope' }),
    'network error': () => Promise.reject(new TypeError('Failed to fetch')),
    'never answers': () => new Promise(() => {})
  };
  for (const [name, global] of Object.entries(failures)) {
    const page = await marketPage({ global });
    await page.runtime.init();
    assert.equal(page.target.innerHTML, expected, name);
  }
  // One usable item is a partial overlay of exactly that card.
  const one = await marketPage({ global: [globalLatest0925().find(item => item.code === 'USDKRW')] });
  await one.runtime.init();
  assert.equal(overlayCount(one.target.innerHTML), 1);
  assert.equal(cards(one.target.innerHTML).filter(card => card.basis === 'latest').map(card => card.name).join(), '원/달러');
});

test('13-15. HISTORY, 1W and 1M entered directly never request or apply Global Latest', async () => {
  for (const search of ['?date=2026-09-22', '?view=1w', '?view=1m']) {
    const { runtime, target, requests } = await marketPage({ search });
    await runtime.init();
    assert.ok(!requests.includes('/api/market/global/latest'), search);
    assert.doesNotMatch(target.innerHTML, /data-basis="latest"/, search);
    if (search.startsWith('?date')) {
      assert.equal(overlayCount(target.innerHTML), 0);
      assert.equal(byName(target.innerHTML, '원/달러').value, '1,358.70원');
    }
  }
});

test('13. Global Latest held in memory is never applied to a HISTORY render', async () => {
  const { runtime } = await marketPage();
  await runtime.init();
  runtime.state.mode = 'history';
  runtime.state.isLatest = false;
  const target = { innerHTML: '', addEventListener() {}, removeEventListener() {} };
  runtime.render(snapshot0923(), target, { globalLatest: { items: globalLatest0925(), now: NOW.getTime() } });
  assert.equal(overlayCount(target.innerHTML), 0);
  assert.doesNotMatch(target.innerHTML, /data-basis/);
});

test('16. TODAY → HISTORY → 1W → TODAY: overlay only on TODAY, one Global Latest request per TODAY load', async () => {
  const { runtime, target, requests } = await marketPage();
  await runtime.init();
  assert.equal(overlayCount(target.innerHTML), 6);

  await runtime.navigateToMode('history', '2026-09-22');
  assert.equal(overlayCount(target.innerHTML), 0);
  assert.match(target.innerHTML, /<p class="market-date">2026\.09\.22 · 15:30 KST 마감 기준<\/p>/);
  assert.doesNotMatch(target.innerHTML, /data-basis/);

  await runtime.navigateToMode('1w');
  assert.doesNotMatch(target.innerHTML, /data-basis|data-global-latest="[1-9]/);

  await runtime.navigateToMode('today');
  assert.equal(overlayCount(target.innerHTML), 6);
  assert.deepEqual(requests.filter(url => url === '/api/market/global/latest').length, 2);
  assert.deepEqual(requests, [
    '/api/market/dates', '/api/market/global/latest', '/api/market/latest',
    '/api/market/date?date=2026-09-22',
    '/api/market/range?period=1w',
    '/api/market/global/latest', '/api/market/latest'
  ]);
});

test('a slow TODAY response never paints over the HISTORY view the reader moved to', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { runtime, target } = await marketPage({
    fastTimeout: false,
    global: () => gate.then(() => jsonResponse({ items: globalLatest0925() }, { [GLOBAL_LATEST_SERVED_AT_HEADER]: NOW.toISOString() }))
  });
  const today = runtime.loadAndRender('today');
  await runtime.loadAndRender('history', '2026-09-22');
  release();
  await today;
  assert.equal(runtime.state.mode, 'history');
  assert.match(target.innerHTML, /2026\.09\.22 · 15:30 KST 마감 기준/);
  assert.equal(overlayCount(target.innerHTML), 0);
});

test('17. MARKET EN shows the same overlay with English basis', async () => {
  const [ko, en] = [await marketPage(), await marketPage({ lang: 'en' })];
  await ko.runtime.init();
  await en.runtime.init();
  const koCards = cards(ko.target.innerHTML);
  const enCards = cards(en.target.innerHTML);
  assert.deepEqual(enCards.map(card => card.basis), koCards.map(card => card.basis));
  assert.equal(byName(en.target.innerHTML, 'NASDAQ Composite').state, 'Sep 25, 2026 · Intraday As of Sep 26, 04:15 KST');
  assert.equal(byName(en.target.innerHTML, 'US 10Y').state, 'Sep 25, 2026 · Close');
  assert.equal(byName(en.target.innerHTML, 'Gold').state, 'Sep 23, 2026 · At KRX close');
  assert.equal(byName(en.target.innerHTML, 'USD/KRW').value, '₩1,354.40');
});

test('a wrong browser clock cannot make a stale observation current: the server time is the floor', async () => {
  // The browser thinks it is 17:00Z; the server served the body at 19:30Z.
  const { runtime, target } = await marketPage({
    now: new Date('2026-09-25T17:00:00Z'),
    global: () => jsonResponse({ items: globalLatest0925() }, { [GLOBAL_LATEST_SERVED_AT_HEADER]: NOW.toISOString() })
  });
  await runtime.init();
  // GOLD (as_of 17:40Z) would look fresh by the browser clock alone.
  assert.equal(byName(target.innerHTML, '국제 금').basis, 'snapshot');
  assert.equal(overlayCount(target.innerHTML), 6);
});

test('market-close.js reads the overlay only through the TODAY load, never from the range view', async () => {
  const source = MARKET_JS;
  const rangeView = source.slice(source.indexOf('function renderRangeView'), source.indexOf('function bindEvents'));
  assert.doesNotMatch(rangeView, /globalLatest|GLOBAL_LATEST/);
  assert.equal((source.match(/render\(data, rootEl, \{ globalLatest \}\)/g) || []).length, 1);
  assert.match(source, /latestInput && state\.mode === 'today' && !isHistory/);
  assert.match(source, /latest: krx\(key\) \? null/);
});

test('market date and Global Latest dates are shown as they are, never aligned', async () => {
  const { runtime, target } = await marketPage();
  await runtime.init();
  const html = target.innerHTML;
  assert.match(html, new RegExp(`${MARKET_DATE.replace(/-/g, '\\.')} · 15:30 KST`));
  const states = cards(html).filter(card => card.basis === 'latest').map(card => card.state.slice(0, 10));
  assert.deepEqual([...new Set(states)].sort(), ['2026.09.24', '2026.09.25']);
});
