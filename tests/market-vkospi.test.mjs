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
  marketDatePageHtml,
  marketIndicatorPageHtml,
  marketIndicatorSeries,
  marketIndicatorTitle,
  parseMarketPagePath
} from '../functions/_market-date-page.js';
import { sitemapXml } from '../functions/_seo.js';

// VKOSPI (KRX 코스피 200 변동성지수), added 2026-11-22. The collector reads
// its close from KRX Index after the KOSPI 200 options close (15:45 KST) and
// puts it in rates_fx_volatility beside VIX. Like the seven indicators before
// it, it is optional in contract 1.2.0: records made before it have no such
// key. When carried, it is dated the KRX session itself.

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = JSON.parse(await read('contracts/market_close/market_close.schema.json'));
const v110 = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const SHELLS = { ko: await read('market/index.html'), en: await read('en/market/index.html') };
const clone = value => JSON.parse(JSON.stringify(value));
const verdict = payload => validateMarketPayload(payload, schema);
const VKOSPI = MARKET_INDICATORS.find(item => item.code === 'VKOSPI');
const OPTIONAL = MARKET_INDICATORS.filter(item => item.optional && !item.domestic);
const closesFor = codes => JSON.stringify(OPTIONAL.map(item => (codes.includes(item.code) ? 1 : null)));

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

/** `payload` carrying VKOSPI right after VIX, shaped like the other closes (2026-11-20 values). */
function withVkospi(payload) {
  const copy = clone(payload);
  const date = copy.meta.market_date;
  const rates = copy.rates_fx_volatility;
  const vkospi = {
    ...clone(rates.VIX), name: 'VKOSPI', ticker: 'KRX:1-300',
    close: 53.18, current: 53.18, change: -0.75, change_pct: -1.39, open: 52.27, high: 53.81, low: 52.07, previous_close: 53.93,
    source_date: date, as_of: date, data_state: 'final_close', source: '한국거래소 KRX Index · 코스피 200 변동성지수'
  };
  copy.rates_fx_volatility = { SOX: rates.SOX, VIX: rates.VIX, VKOSPI: vkospi, US10Y: rates.US10Y, USDKRW: rates.USDKRW, JPYKRW: rates.JPYKRW, DXY: rates.DXY };
  return copy;
}

const EMPTY_VALUES = { close: null, current: null, change: null, change_pct: null, open: null, high: null, low: null, previous_close: null, source_date: null, as_of: null, retrieved_at: null };
const unavailable = item => ({ ...item, ...EMPTY_VALUES, data_state: 'unavailable', is_cached: false });

test('VKOSPI is an optional indicator beside VIX, dated the KRX session, with /market/vkospi/', () => {
  assert.deepEqual({ ...VKOSPI }, { optional: true, domestic: false, code: 'VKOSPI', group: 'rates_fx_volatility', kind: 'krxvol', slug: 'vkospi' });
  const codes = MARKET_INDICATORS.map(item => item.code);
  assert.equal(codes.indexOf('VKOSPI'), codes.indexOf('VIX') + 1);
  assert.equal(parseMarketPagePath('/market/vkospi/').indicator, VKOSPI);
  assert.equal(parseMarketPagePath('/en/market/vkospi/').lang, 'en');
  assert.ok(OPTIONAL_GLOBAL_CODES.includes('VKOSPI'));
  const rates = schema.properties.rates_fx_volatility;
  assert.ok(rates.properties.VKOSPI);
  assert.ok(!rates.required.includes('VKOSPI'));
  const listed = schema.$defs.sectionStatus.properties.global_indicators.properties.unavailable;
  assert.ok(listed.items.enum.includes('VKOSPI'));
  assert.equal(listed.maxItems, listed.items.enum.length);
});

test('contract 1.2.0 takes a record with VKOSPI of the session, and one without it', () => {
  assert.deepEqual(verdict(complete12()), { passed: true, errors: [] });
  assert.deepEqual(verdict(withVkospi(complete12())), { passed: true, errors: [] });
  const stale = withVkospi(complete12());
  stale.rates_fx_volatility.VKOSPI.source_date = previousTradingDate(stale.meta.market_date, 'KRX');
  const result = verdict(stale);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some(error => error.startsWith('$.rates_fx_volatility.VKOSPI.source_date')), result.errors.join('\n'));
});

test('a failed VKOSPI is declared unavailable and the record stays valid', () => {
  const payload = withVkospi(complete12());
  payload.rates_fx_volatility.VKOSPI = unavailable(payload.rates_fx_volatility.VKOSPI);
  payload.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['VKOSPI'] };
  assert.deepEqual(verdict(payload), { passed: true, errors: [] });
  const silent = withVkospi(complete12());
  silent.rates_fx_volatility.VKOSPI = unavailable(silent.rates_fx_volatility.VKOSPI);
  assert.ok(verdict(silent).errors.some(error => error.startsWith('$.rates_fx_volatility.VKOSPI')));
  const phantom = complete12();
  phantom.rates_fx_volatility.DXY = unavailable(phantom.rates_fx_volatility.DXY);
  phantom.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['DXY', 'VKOSPI'] };
  assert.ok(verdict(phantom).errors.some(error => error.includes('VKOSPI')));
});

test('1W/1M take the VKOSPI close', () => {
  assert.equal(getPeriodValue('VKOSPI', { data_state: 'intraday', current: 60, close: 53.18 }), 53.18);
  assert.equal(getPeriodValue('VKOSPI', { data_state: 'final_close', close: 53.18 }), 53.18);
  assert.equal(getPeriodValue('VKOSPI', { data_state: 'unavailable', close: null }), null);
});

test('session pages show VKOSPI after VIX, linked once it has a value', () => {
  const context = { prev: null, next: null, report: null };
  for (const [lang, prefix] of [['ko', ''], ['en', '/en']]) {
    const page = marketDatePageHtml(SHELLS[lang], withVkospi(complete12()), lang, context);
    const board = page.slice(page.indexOf('data-board="world"'), page.indexOf('data-board="rates"'));
    const codes = [...board.matchAll(/<tr class="mk-row" data-code="([A-Z0-9_]+)"/g)].map(m => m[1]);
    assert.equal(codes.indexOf('VKOSPI'), codes.indexOf('VIX') + 1, lang);
    assert.match(page, new RegExp(`href="${prefix}/market/vkospi/">VKOSPI</a>[\\s\\S]*?53\\.18[\\s\\S]*?▼ −0\\.75`), lang);
  }
  const failed = withVkospi(complete12());
  failed.rates_fx_volatility.VKOSPI = unavailable(failed.rates_fx_volatility.VKOSPI);
  failed.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['VKOSPI'] };
  assert.doesNotMatch(marketDatePageHtml(SHELLS.ko, failed, 'ko', context), /\/market\/vkospi\//);
  assert.doesNotMatch(marketDatePageHtml(SHELLS.ko, complete12(), 'ko', context), /VKOSPI/);
});

test('the VKOSPI history page: KRX close with high and low, on the 15:45 derivatives basis', () => {
  const item = (close, previous, high, low, date) => JSON.stringify({ close, previous_close: previous, high, low, source_date: date, data_state: 'final_close' });
  const rows = [
    { market_date: '2026-11-20', published_at: '2026-11-20T07:10:00Z', item: item(53.18, 53.93, 53.81, 52.07, '2026-11-20'), optional_closes: closesFor(['VKOSPI']) },
    { market_date: '2026-11-19', published_at: '2026-11-19T08:30:00Z', item: item(53.93, 50.1, 54.2, 50.3, '2026-11-19'), optional_closes: closesFor(['VKOSPI']) },
    { market_date: '2026-11-18', published_at: '2026-11-18T07:10:00Z', item: null, optional_closes: closesFor([]) }
  ];
  const series = marketIndicatorSeries(rows, VKOSPI);
  assert.equal(series.length, 2);
  assert.equal(series[0].date, '2026-11-20');
  assert.ok(Math.abs(series[0].change + 0.75) < 1e-9);
  assert.equal(marketIndicatorTitle(VKOSPI, series, 'ko'), 'VKOSPI 일별 종가 · 11월 20일 53.18(−1.39%) | Snowshagal');
  assert.match(marketIndicatorTitle(VKOSPI, series, 'en'), /^VKOSPI Daily Close: 53\.18 \(−1\.39%\) on Nov 20, 2026 \| Snowshagal$/);
  const ko = marketIndicatorPageHtml(SHELLS.ko, VKOSPI, series, 'ko', availableIndicatorCodes(rows));
  assert.match(ko, /<h1 id="market-indicator-heading">VKOSPI\(코스피200 변동성지수\) 일별 기록<\/h1>/);
  assert.match(ko, /KRX 파생상품 정규장 15:45 마감 종가/);
  assert.match(ko, /market-indicator-table with-range/);
  const en = marketIndicatorPageHtml(SHELLS.en, VKOSPI, series, 'en', availableIndicatorCodes(rows));
  assert.match(en, /KRX derivatives-session close, 15:45 KST/);
});

test('the sitemap lists /market/vkospi/ only once a record has VKOSPI', () => {
  const before = sitemapXml([], { marketSessions: [{ market_date: '2026-11-20', published_at: '2026-11-20T08:45:00Z', optional_closes: closesFor([]) }] });
  assert.doesNotMatch(before, /\/market\/vkospi\//);
  const after = sitemapXml([], { marketSessions: [{ market_date: '2026-11-24', published_at: '2026-11-24T08:45:00Z', optional_closes: closesFor(['VKOSPI']) }] });
  assert.match(after, /<loc>https:\/\/snowshagal\.com\/market\/vkospi\/<\/loc>/);
  assert.match(after, /<loc>https:\/\/snowshagal\.com\/en\/market\/vkospi\/<\/loc>/);
});

async function dashboard(lang) {
  const [locale, script] = await Promise.all([read('assets/locale.js'), read('assets/market-close.js')]);
  const document = { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(locale, context);
  vm.runInContext(script, context);
  return window.MARKET_CLOSE;
}

test('TODAY shows VKOSPI after VIX, and nothing for a record without it', async () => {
  for (const [lang, prefix] of [['ko', ''], ['en', '/en']]) {
    const runtime = await dashboard(lang);
    const target = { innerHTML: '' };
    runtime.render(withVkospi(complete12()), target);
    const html = target.innerHTML;
    // The overseas board ends with the two volatility indices: VIX, then VKOSPI.
    const board = html.slice(html.indexOf('data-board="world"'), html.indexOf('data-board="rates"'));
    const codes = [...board.matchAll(/<tr class="mk-row"[^>]* data-code="([A-Z0-9_]+)"/g)].map(m => m[1]);
    assert.deepEqual(codes.slice(-2), ['VIX', 'VKOSPI'], lang);
    assert.match(html, new RegExp(`<a class="instrument-history-link" href="${prefix}/market/vkospi/">VKOSPI</a>`), lang);
    const row = board.slice(board.indexOf('data-code="VKOSPI"'));
    assert.match(row, /53\.18[\s\S]*?▼ −0\.75/);
  }
  const runtime = await dashboard('ko');
  const target = { innerHTML: '' };
  runtime.render(complete12(), target);
  assert.doesNotMatch(target.innerHTML, /vkospi|VKOSPI/);
});
