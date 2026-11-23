import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { OPTIONAL_GLOBAL_CODES, previousTradingDate } from '../functions/api/market/_freshness.js';
import { validateMarketPayload } from '../functions/api/market/_shared.js';
import { getPeriodValue } from '../functions/api/market/_aggregate.js';
import {
  MARKET_INDICATORS,
  availableIndicatorCodes,
  marketArchivePageHtml,
  marketDatePageHtml,
  marketIndicatorPageHtml,
  marketIndicatorSeries,
  marketIndicatorTitle,
  onMarketPageRequest,
  parseMarketPagePath
} from '../functions/_market-date-page.js';
import { OPTIONAL_INDICATOR_CLOSES_SQL } from '../functions/_market-indicators.js';
import { sitemapXml } from '../functions/_seo.js';

// Seven indicators added in 2026-11 (copper, Brent, silver, natural gas,
// CNY/KRW, EUR/KRW, USD/JPY). They are optional in contract 1.2.0: a record
// made before them has no such key and stays valid; a record that carries one
// follows every rule the original twelve follow.

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = JSON.parse(await read('contracts/market_close/market_close.schema.json'));
const v110 = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const SHELLS = { ko: await read('market/index.html'), en: await read('en/market/index.html') };
const clone = value => JSON.parse(JSON.stringify(value));
const verdict = payload => validateMarketPayload(payload, schema);
const ORIGINAL_GLOBAL = [
  ['indices', 'NASDAQ'], ['indices', 'DOW'], ['indices', 'SP500'],
  ['rates_fx_volatility', 'SOX'], ['rates_fx_volatility', 'VIX'], ['rates_fx_volatility', 'US10Y'],
  ['rates_fx_volatility', 'USDKRW'], ['rates_fx_volatility', 'JPYKRW'], ['rates_fx_volatility', 'DXY'],
  ['commodities_crypto', 'WTI'], ['commodities_crypto', 'GOLD'], ['commodities_crypto', 'BITCOIN']
];
const NEW_GLOBAL = [
  ['rates_fx_volatility', 'CNYKRW'], ['rates_fx_volatility', 'EURKRW'], ['rates_fx_volatility', 'USDJPY'],
  ['commodities_crypto', 'BRENT'], ['commodities_crypto', 'NATGAS'], ['commodities_crypto', 'SILVER'], ['commodities_crypto', 'COMEX_COPPER']
];

/** The 1.1.0 example as a complete 1.2.0 record, its source dates aligned to its market date. */
function complete12() {
  const payload = clone(v110);
  payload.meta.schema_version = '1.2.0';
  const ordered = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'validation') {
      ordered.section_status = {
        five_day_flows: { status: 'complete', reason: null, expected_sessions: 5, available_sessions: 5, missing_sessions: [] },
        krx_groups: { status: 'complete', reason: null },
        global_indicators: { status: 'complete', reason: null, unavailable: [] },
        market_breadth: { status: 'complete', reason: null }
      };
    }
    ordered[key] = value;
  }
  const date = ordered.meta.market_date;
  const usDate = previousTradingDate(date, 'NYSE');
  for (const code of ['KOSPI', 'KOSDAQ']) ordered.indices[code].source_date = date;
  for (const code of ['NASDAQ', 'DOW', 'SP500']) ordered.indices[code].source_date = usDate;
  for (const code of ['SOX', 'VIX', 'US10Y']) ordered.rates_fx_volatility[code].source_date = usDate;
  for (const code of ['USDKRW', 'JPYKRW', 'DXY']) ordered.rates_fx_volatility[code].source_date = date;
  for (const code of ['WTI', 'GOLD', 'BITCOIN']) ordered.commodities_crypto[code].source_date = date;
  for (const rows of Object.values(ordered.krx_groups || {})) for (const row of rows) row.source_date = date;
  return ordered;
}

/** `payload` with the seven new items, shaped as the collector writes them. */
function withNew(payload) {
  const copy = clone(payload);
  const date = copy.meta.market_date;
  const fx = copy.rates_fx_volatility.USDKRW;
  const quote = copy.commodities_crypto.WTI;
  const fixing = (name, ticker, close, current, previous) => ({
    ...clone(fx), name, ticker, close, current, change: current - previous, change_pct: (current / previous - 1) * 100,
    open: close, high: close, low: close, previous_close: previous, source_date: date, as_of: `${date}T15:30:00+09:00`,
    source: `네이버 금융 하나은행 15:30 회차별 매매기준율 + Yahoo 현재가 · ${ticker}`
  });
  const price = (name, ticker, value, previous) => ({
    ...clone(quote), name, ticker, close: value, current: value, change: value - previous, change_pct: (value / previous - 1) * 100,
    open: value, high: value, low: value, previous_close: previous, source_date: date, as_of: date, source: `Yahoo Finance · ${ticker}`
  });
  const rates = copy.rates_fx_volatility;
  copy.rates_fx_volatility = {
    SOX: rates.SOX, VIX: rates.VIX, US10Y: rates.US10Y, USDKRW: rates.USDKRW, JPYKRW: rates.JPYKRW,
    CNYKRW: fixing('원/위안', 'CNYKRW=X', 200.26, 201.677, 199.53),
    EURKRW: fixing('원/유로', 'EURKRW=X', 1467.46, 1475.7, 1458.96),
    DXY: rates.DXY,
    USDJPY: price('엔/달러', 'JPY=X', 158.512, 159.381)
  };
  const assets = copy.commodities_crypto;
  copy.commodities_crypto = {
    WTI: assets.WTI,
    BRENT: price('브렌트유', 'BZ=F', 89.95, 91.98),
    NATGAS: price('천연가스', 'NG=F', 3.748, 3.268),
    GOLD: assets.GOLD,
    SILVER: price('은 선물', 'SI=F', 41.07, 44.318),
    COMEX_COPPER: price('구리 선물', 'HG=F', 5.477, 5.625),
    BITCOIN: assets.BITCOIN
  };
  return copy;
}

const EMPTY_VALUES = { close: null, current: null, change: null, change_pct: null, open: null, high: null, low: null, previous_close: null, source_date: null, as_of: null, retrieved_at: null };
function unavailable(item) {
  return { ...item, ...EMPTY_VALUES, data_state: 'unavailable', is_cached: false };
}

/* ---------------------------------------------------------------- receiver */

test('contract 1.2.0 takes the seven new indicators and still takes a record without them', () => {
  // VKOSPI and the Asian indices (2026-11-22) are optional the same way;
  // tests/market-vkospi.test.mjs and tests/market-asia-indices.test.mjs cover them.
  assert.deepEqual(OPTIONAL_GLOBAL_CODES, ['CNYKRW', 'EURKRW', 'USDJPY', 'BRENT', 'COMEX_COPPER', 'SILVER', 'NATGAS', 'VKOSPI', 'NIKKEI225', 'SHANGHAI', 'TAIEX']);
  assert.deepEqual(verdict(complete12()), { passed: true, errors: [] });
  assert.deepEqual(verdict(withNew(complete12())), { passed: true, errors: [] });
  for (const [section, code] of NEW_GLOBAL) {
    assert.ok(schema.properties[section].properties[code], code);
    assert.ok(!schema.properties[section].required.includes(code), code);
  }
  const unknown = withNew(complete12());
  unknown.commodities_crypto.PLATINUM = clone(unknown.commodities_crypto.SILVER);
  assert.ok(verdict(unknown).errors.some(error => error.includes('PLATINUM')));
});

test('a carried new indicator follows the same-day source-date rule', () => {
  const payload = withNew(complete12());
  payload.commodities_crypto.BRENT.source_date = previousTradingDate(payload.meta.market_date, 'KRX');
  const result = verdict(payload);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some(error => error.startsWith('$.commodities_crypto.BRENT.source_date')), result.errors.join('\n'));
  const fx = withNew(complete12());
  fx.rates_fx_volatility.CNYKRW.data_state = 'unavailable';
  assert.equal(verdict(fx).passed, false);
});

test('a failed new indicator is declared unavailable like the original ones', () => {
  const payload = withNew(complete12());
  payload.rates_fx_volatility.CNYKRW = unavailable(payload.rates_fx_volatility.CNYKRW);
  payload.section_status.global_indicators = { status: 'partial', reason: 'stale_source_date', unavailable: ['CNYKRW'] };
  assert.deepEqual(verdict(payload), { passed: true, errors: [] });

  // Not listed, yet empty: rejected.
  const silent = withNew(complete12());
  silent.commodities_crypto.SILVER = unavailable(silent.commodities_crypto.SILVER);
  assert.ok(verdict(silent).errors.some(error => error.startsWith('$.commodities_crypto.SILVER')));

  // Listed although the record does not carry it: rejected.
  const phantom = complete12();
  phantom.commodities_crypto.WTI = unavailable(phantom.commodities_crypto.WTI);
  phantom.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['WTI', 'BRENT'] };
  assert.ok(verdict(phantom).errors.some(error => error.includes('BRENT')));
});

test('partial and unavailable count only the indicators the record carries', () => {
  // A replay of a day before the new indicators, with no stored global evidence: all twelve.
  const old = complete12();
  for (const [section, code] of ORIGINAL_GLOBAL) old[section][code] = unavailable(old[section][code]);
  old.section_status.global_indicators = { status: 'unavailable', reason: 'replay_without_stored_source', unavailable: ORIGINAL_GLOBAL.map(([, code]) => code) };
  assert.deepEqual(verdict(old), { passed: true, errors: [] });

  // A record carrying the new ones: twelve missing out of nineteen is partial, not unavailable.
  const current = withNew(complete12());
  for (const [section, code] of ORIGINAL_GLOBAL) current[section][code] = unavailable(current[section][code]);
  current.section_status.global_indicators = { status: 'unavailable', reason: 'source_unavailable', unavailable: ORIGINAL_GLOBAL.map(([, code]) => code) };
  assert.equal(verdict(current).passed, false);
  current.section_status.global_indicators.status = 'partial';
  assert.deepEqual(verdict(current), { passed: true, errors: [] });
});

test('1W/1M take the 15:30 fixing for the new KRW pairs and the quote for USD/JPY', () => {
  const item = { close: 200.26, current: 201.68, data_state: 'intraday' };
  assert.equal(getPeriodValue('CNYKRW', item), 200.26);
  assert.equal(getPeriodValue('EURKRW', item), 200.26);
  assert.equal(getPeriodValue('USDJPY', item), 201.68);
});

/* ------------------------------------------------------------ server pages */

// The optional instruments the Market Close payload carries; the domestic rates are their own dataset.
const OPTIONAL = MARKET_INDICATORS.filter(item => item.optional && !item.domestic);
const closesFor = (codes) => JSON.stringify(OPTIONAL.map(item => (codes.includes(item.code) ? 1 : null)));

test('the new history pages: /market/copper/ for COMEX copper, the code in lower case for the rest', () => {
  assert.deepEqual(OPTIONAL.map(item => item.slug), ['nikkei225', 'shanghai', 'taiex', 'vkospi', 'cnykrw', 'eurkrw', 'usdjpy', 'brent', 'natgas', 'silver', 'copper']);
  assert.equal(parseMarketPagePath('/market/copper/').indicator.code, 'COMEX_COPPER');
  assert.equal(parseMarketPagePath('/en/market/natgas/').indicator.code, 'NATGAS');
  assert.equal(parseMarketPagePath('/market/comex_copper/'), null);
  // One column, a JSON array in the same order.
  assert.equal(OPTIONAL_INDICATOR_CLOSES_SQL, `json_extract(payload_json, ${OPTIONAL.map(item => `'$.${item.group}.${item.code}.close'`).join(', ')})`);
});

test('a new indicator has a page once some final record has its value', () => {
  const originals = availableIndicatorCodes([]);
  assert.equal(originals.size, 14);
  assert.ok(!originals.has('BRENT'));
  const some = availableIndicatorCodes([{ optional_closes: '[null,null,null,null,null,null,null]' }, { optional_closes: closesFor(['CNYKRW', 'COMEX_COPPER']) }]);
  assert.ok(some.has('CNYKRW') && some.has('COMEX_COPPER'));
  assert.ok(!some.has('EURKRW'));
  assert.equal(some.size, 16);
  assert.equal(availableIndicatorCodes([{ optional_closes: JSON.parse(closesFor(OPTIONAL.map(item => item.code))) }]).size, 25);
  assert.equal(availableIndicatorCodes([{ optional_closes: 'not json' }, { optional_closes: null }]).size, 14);
});

test('the sitemap and the archive list a new indicator only once it has a value', () => {
  const before = sitemapXml([], { marketSessions: [{ market_date: '2026-11-20', published_at: '2026-11-20T08:45:00Z', optional_closes: closesFor([]) }] });
  assert.doesNotMatch(before, /\/market\/(cnykrw|eurkrw|usdjpy|brent|natgas|silver|copper)\//);
  assert.match(before, /\/market\/wti\//);
  const after = sitemapXml([], { marketSessions: [
    { market_date: '2026-11-24', published_at: '2026-11-24T08:45:00Z', optional_closes: closesFor(['BRENT', 'COMEX_COPPER']) },
    { market_date: '2026-11-23', published_at: '2026-11-23T08:45:00Z', optional_closes: closesFor([]) }
  ] });
  assert.match(after, /<loc>https:\/\/snowshagal\.com\/market\/copper\/<\/loc><lastmod>2026-11-24<\/lastmod>/);
  assert.match(after, /<loc>https:\/\/snowshagal\.com\/en\/market\/brent\/<\/loc>/);
  assert.doesNotMatch(after, /\/market\/silver\//);

  const row = { market_date: '2026-11-24', kospi_close: 1, kospi_pct: 0, kosdaq_close: 1, kosdaq_pct: 0, foreign_net: 0, usdkrw: 1 };
  const nav = html => html.slice(html.indexOf('id="indicators"'), html.indexOf('</nav>', html.indexOf('id="indicators"')));
  const old = nav(marketArchivePageHtml(SHELLS.ko, [row], 'ko'));
  assert.equal((old.match(/<a href="\/market\/[a-z0-9]+\/">/g) || []).length, 14);
  const all = nav(marketArchivePageHtml(SHELLS.ko, [{ ...row, optional_closes: closesFor(OPTIONAL.map(item => item.code)) }], 'ko'));
  assert.equal((all.match(/<a href="\/market\/[a-z0-9]+\/">/g) || []).length, 25);
  assert.match(all, /<a href="\/market\/copper\/">구리 선물<\/a>/);
  assert.match(nav(marketArchivePageHtml(SHELLS.en, [{ ...row, optional_closes: closesFor(['USDJPY']) }], 'en')), /<a href="\/en\/market\/usdjpy\/">USD\/JPY<\/a>/);
});

test('session pages show the seven rows with their own units and link those with a value', () => {
  const data = withNew(complete12());
  data.commodities_crypto.SILVER = unavailable(data.commodities_crypto.SILVER);
  const context = { prev: null, next: null, report: null };
  const ko = marketDatePageHtml(SHELLS.ko, data, 'ko', context);
  const en = marketDatePageHtml(SHELLS.en, data, 'en', context);
  const fxBoard = ko.slice(ko.indexOf('data-board="fx"'), ko.indexOf('</section>', ko.indexOf('data-board="fx"')));
  const order = [...fxBoard.matchAll(/<tr class="mk-row" data-code="([A-Z0-9_]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY']);
  assert.match(ko, /href="\/market\/cnykrw\/">원\/위안<\/a>[\s\S]*?200\.26원[\s\S]*?15:30 확정/);
  assert.match(ko, /href="\/market\/usdjpy\/">엔\/달러<\/a>[\s\S]*?158\.51엔/);
  assert.match(ko, /href="\/market\/copper\/">구리 선물<\/a>[\s\S]*?\$5\.477[\s\S]*?▼ −0\.148/);
  assert.match(ko, /href="\/market\/natgas\/">천연가스<\/a>[\s\S]*?\$3\.748/);
  assert.match(en, /href="\/en\/market\/eurkrw\/">EUR\/KRW<\/a>[\s\S]*?₩1,467\.46/);
  assert.match(en, /href="\/en\/market\/usdjpy\/">USD\/JPY<\/a>[\s\S]*?¥158\.51/);
  assert.match(en, /href="\/en\/market\/brent\/">Brent Crude<\/a>[\s\S]*?\$89\.95/);
  // Silver failed that day: its row stays, not a link (its page may not exist yet).
  assert.doesNotMatch(ko, /\/market\/silver\//);
  assert.match(ko, /<span class="mk-row-name">은 선물<\/span>/);
  // A record from before the new indicators shows the rows it always had.
  const old = marketDatePageHtml(SHELLS.ko, complete12(), 'ko', context);
  assert.doesNotMatch(old, /cnykrw|copper|brent|JPY=X/);
});

test('the copper history page reads in dollars per pound, with only listed indicators as related links', () => {
  const copper = MARKET_INDICATORS.find(item => item.code === 'COMEX_COPPER');
  const rows = [
    { market_date: '2026-11-24', published_at: '2026-11-24T08:45:00Z', item: JSON.stringify({ close: 5.477, previous_close: 5.625, high: 5.5, low: 5.4, source_date: '2026-11-24', data_state: 'final_close' }), optional_closes: closesFor(['COMEX_COPPER', 'BRENT']) },
    { market_date: '2026-11-23', published_at: '2026-11-23T08:45:00Z', item: JSON.stringify({ close: 5.625, previous_close: 5.6, source_date: '2026-11-23', data_state: 'final_close' }), optional_closes: closesFor(['COMEX_COPPER']) },
    { market_date: '2026-11-20', published_at: '2026-11-20T08:45:00Z', item: null, optional_closes: closesFor([]) }
  ];
  const series = marketIndicatorSeries(rows, copper);
  assert.equal(series.length, 2);
  assert.equal(marketIndicatorTitle(copper, series, 'ko'), '구리 선물 일별 기록 · 11월 24일 $5.477(−2.63%) | Snowshagal');
  assert.equal(marketIndicatorTitle(copper, series, 'en'), 'Copper History: $5.477 (−2.63%) on Nov 24, 2026 | Snowshagal');
  const ko = marketIndicatorPageHtml(SHELLS.ko, copper, series, 'ko', availableIndicatorCodes(rows));
  assert.match(ko, /<h1 id="market-indicator-heading">구리 선물 가격 일별 기록<\/h1>/);
  assert.match(ko, /변동은 직전 기록 대비 · 달러\/파운드\(COMEX\)/);
  assert.match(ko, /<td><span class="down">−0\.148<\/span><\/td>/);
  const related = ko.slice(ko.indexOf('class="indicator-links"'));
  assert.match(related, /href="\/market\/brent\/"/);
  assert.doesNotMatch(related, /href="\/market\/(silver|copper|cnykrw)\/"/);
  assert.match(marketIndicatorPageHtml(SHELLS.en, copper, series, 'en', availableIndicatorCodes(rows)), /USD per pound \(COMEX\)/);
});

function indicatorDb(rowsByCode) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async run() { return { success: true }; },
        async first() { return null; },
        async all() {
          const match = sql.match(/'\$\.(indices|rates_fx_volatility|commodities_crypto)\.([A-Z0-9_]+)'\) AS item/);
          return { results: (match && rowsByCode[match[2]]) || [] };
        }
      };
    }
  };
}

async function get(url, db) {
  const context = {
    request: new Request(url),
    env: { COMMENTS_DB: db, ASSETS: { fetch: async request => new Response(new URL(request.url).pathname === '/en/market/' ? SHELLS.en : SHELLS.ko, { status: new URL(request.url).pathname === '/__not-found__' ? 404 : 200 }) } },
    next: async () => new Response('static')
  };
  return onMarketPageRequest(context, { loadPostsFn: async () => [] });
}

test('the route serves /market/copper/ once a record has copper, and 404s before', async () => {
  const row = { market_date: '2026-11-24', published_at: '2026-11-24T08:45:00Z', item: JSON.stringify({ close: 5.477, source_date: '2026-11-24', data_state: 'final_close' }), optional_closes: closesFor(['COMEX_COPPER']) };
  const ok = await get('https://snowshagal.com/market/copper/', indicatorDb({ COMEX_COPPER: [row] }));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /구리 선물 가격 일별 기록/);
  const empty = await get('https://snowshagal.com/en/market/copper/', indicatorDb({ COMEX_COPPER: [{ ...row, item: null, optional_closes: closesFor([]) }] }));
  assert.equal(empty.status, 404);
});

/* --------------------------------------------------------------- dashboard */

async function dashboard(lang) {
  const [locale, script] = await Promise.all([read('assets/locale.js'), read('assets/market-close.js')]);
  const document = { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(locale, context);
  vm.runInContext(script, context);
  return window.MARKET_CLOSE;
}

// The rows of one quote board ('world', 'rates', 'fx', 'commodities'), by instrument code.
const boardCodes = (html, id) => {
  const start = html.indexOf(`data-board="${id}"`);
  const board = html.slice(start, html.indexOf('</section>', start));
  return [...board.matchAll(/<tr class="mk-row"[^>]* data-code="([A-Z0-9_]+)"/g)].map(m => m[1]);
};

test('TODAY shows six FX and seven commodity rows, and keeps the old three and three for older records', async () => {
  const data = withNew(complete12());
  data.commodities_crypto.NATGAS = unavailable(data.commodities_crypto.NATGAS);
  for (const [lang, prefix] of [['ko', ''], ['en', '/en']]) {
    const runtime = await dashboard(lang);
    const target = { innerHTML: '' };
    runtime.render(data, target);
    const html = target.innerHTML;
    assert.deepEqual(boardCodes(html, 'fx'), ['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY'], lang);
    assert.deepEqual(boardCodes(html, 'commodities'), ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER', 'BITCOIN'], lang);
    for (const slug of ['cnykrw', 'eurkrw', 'usdjpy', 'brent', 'silver', 'copper']) {
      assert.match(html, new RegExp(`<a class="instrument-history-link" href="${prefix}/market/${slug}/">`), `${lang} ${slug}`);
    }
    // Natural gas failed: the card stays, without a link to a page that may not exist yet.
    assert.doesNotMatch(html, /\/market\/natgas\//);
    assert.match(html, lang === 'ko' ? /천연가스[\s\S]*?데이터 없음/ : /Natural Gas[\s\S]*?Unavailable/);
    // KRW pairs: the 15:30 fixing, then the live quote.
    assert.match(html, lang === 'ko' ? /200\.26원[\s\S]*?15:30 확정[\s\S]*?현재[\s\S]*?201\.68원/ : /₩200\.26[\s\S]*?15:30 close[\s\S]*?Latest[\s\S]*?₩201\.68/);
    assert.match(html, lang === 'ko' ? /158\.51엔/ : /¥158\.51/);
    assert.match(html, /\$5\.477[\s\S]*?▼ −0\.148/);
  }
  const runtime = await dashboard('ko');
  const target = { innerHTML: '' };
  runtime.render(complete12(), target);
  assert.deepEqual(boardCodes(target.innerHTML, 'fx'), ['USDKRW', 'JPYKRW', 'DXY']);
  assert.deepEqual(boardCodes(target.innerHTML, 'commodities'), ['WTI', 'GOLD', 'BITCOIN']);
  assert.doesNotMatch(target.innerHTML, /cnykrw|copper|brent|usdjpy/);
});

test('1W/1M list a new indicator once the window starts with it', async () => {
  const item = (start, end) => ({ baseline_value: start, end_value: end, change: end - start, return_pct: (end / start - 1) * 100, period_high: end, period_low: start, observations: 5, complete: true });
  const late = { baseline_value: null, end_value: 89.95, return_pct: null, period_high: 90, period_low: 89, observations: 2, complete: false };
  const data = {
    aggregation_version: '1.0.0', period: '1w',
    window: { start_date: '2026-11-24', end_date: '2026-11-30', dates: ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30'], sessions_used: 5, required_sessions: 5, complete: true },
    instruments: {
      indices: {},
      rates_fx_volatility: { USDKRW: item(1336, 1340), CNYKRW: item(200.26, 201.1), USDJPY: item(158.5, 157.2) },
      commodities_crypto: { WTI: item(83, 82), BRENT: late, COMEX_COPPER: item(5.477, 5.512) }
    },
    flows: { unit: 'KRW billion', sessions_used: 5, markets: {} }, breadth: {}, krx_groups: {}
  };
  const runtime = await dashboard('ko');
  const target = { innerHTML: '' };
  runtime.renderRangeView(data, '1w', target);
  const names = [...target.innerHTML.matchAll(/<div class="range-item-name">\s*<strong>(.*?)<\/strong>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(names, ['원/달러', '원/위안', '엔/달러', 'WTI 원유', '구리 선물']);
  assert.match(target.innerHTML, /5\.477 <span class="range-arrow">→<\/span> 5\.512/);
  assert.match(target.innerHTML, /200\.26 <span class="range-arrow">→<\/span> 201\.10[\s\S]*?\+0\.84/);
});

test('a last card alone in its row takes the row at every width', async () => {
  const css = await read('assets/market-close.css');
  assert.match(css, /\.mini-instrument-grid \.instrument-card:last-child:nth-child\(3n\+1\)\{grid-column:1\/-1\}/);
  assert.match(css, /@media\(max-width:760px\)\{\.mini-instrument-grid:not\(\.commodity-grid\) \.instrument-card:last-child\{grid-column:auto\}\.mini-instrument-grid:not\(\.commodity-grid\) \.instrument-card:last-child:nth-child\(odd\)\{grid-column:1\/-1\}\}/);
});
