import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { LOCAL_SESSION_MAX_LAG_DAYS, OPTIONAL_GLOBAL_CODES, previousTradingDate } from '../functions/api/market/_freshness.js';
import { validateMarketPayload } from '../functions/api/market/_shared.js';
import { getPeriodValue } from '../functions/api/market/_aggregate.js';
import { shiftDate } from '../functions/_trading-calendar.js';
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

// Asian indices (닛케이225, 상해종합, 대만 가권), added 2026-11-22. The collector
// reads each one's local regular-session close from Yahoo and puts it in
// `indices` after SP500. Optional in contract 1.2.0 like the codes before them.
// Each is dated its local session: the latest one that ended on or before the
// KRX date. No local calendars are kept, so a local holiday carries the
// previous close with its own date, accepted up to 14 days back.

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = JSON.parse(await read('contracts/market_close/market_close.schema.json'));
const v110 = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const SHELLS = { ko: await read('market/index.html'), en: await read('en/market/index.html') };
const clone = value => JSON.parse(JSON.stringify(value));
const verdict = payload => validateMarketPayload(payload, schema);
const ASIA = ['NIKKEI225', 'SHANGHAI', 'TAIEX'];
const BY_CODE = Object.fromEntries(MARKET_INDICATORS.map(item => [item.code, item]));
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

// Yahoo daily bars of 2026-11-20 (open, high, low, close) and 2026-11-19 (previous close).
const BARS = {
  NIKKEI225: { name: '닛케이225', ticker: '^N225', open: 58551.56, high: 58707.48, low: 56436.65, close: 56436.65, previous_close: 59444.21 },
  SHANGHAI: { name: '상해종합', ticker: '000001.SS', open: 3527.3, high: 3538.27, low: 3500.83, close: 3533.79, previous_close: 3577.62 },
  TAIEX: { name: '대만 가권', ticker: '^TWII', open: 37646.13, high: 37646.13, low: 35738.68, close: 36033.29, previous_close: 38426.89 }
};

/** `payload` carrying the three Asian indices after SP500; `dates` overrides a code's source date. */
function withAsia(payload, dates = {}) {
  const copy = clone(payload);
  const indices = copy.indices;
  const shaped = {};
  for (const code of ASIA) {
    const bar = BARS[code];
    const sourceDate = dates[code] || copy.meta.market_date;
    shaped[code] = {
      ...clone(indices.SP500), ...bar,
      current: bar.close, change: bar.close - bar.previous_close, change_pct: (bar.close / bar.previous_close - 1) * 100,
      source_date: sourceDate, as_of: sourceDate, data_state: 'final_close', source: `Yahoo Finance · ${bar.ticker}`
    };
  }
  copy.indices = { KOSPI: indices.KOSPI, KOSDAQ: indices.KOSDAQ, NASDAQ: indices.NASDAQ, DOW: indices.DOW, SP500: indices.SP500, ...shaped };
  return copy;
}

const EMPTY_VALUES = { close: null, current: null, change: null, change_pct: null, open: null, high: null, low: null, previous_close: null, source_date: null, as_of: null, retrieved_at: null };
const unavailable = item => ({ ...item, ...EMPTY_VALUES, data_state: 'unavailable', is_cached: false });

test('the Asian indices are optional `indices` after SP500, dated the local session, with their own pages', () => {
  const codes = MARKET_INDICATORS.map(item => item.code);
  assert.deepEqual(codes.slice(codes.indexOf('SP500') + 1, codes.indexOf('SP500') + 4), ASIA);
  assert.deepEqual(ASIA.map(code => ({ ...BY_CODE[code] })), [
    { optional: true, domestic: false, code: 'NIKKEI225', group: 'indices', kind: 'asia', slug: 'nikkei225' },
    { optional: true, domestic: false, code: 'SHANGHAI', group: 'indices', kind: 'asia', slug: 'shanghai' },
    { optional: true, domestic: false, code: 'TAIEX', group: 'indices', kind: 'asia', slug: 'taiex' }
  ]);
  for (const code of ASIA) {
    assert.equal(parseMarketPagePath(`/market/${code.toLowerCase()}/`).indicator, BY_CODE[code]);
    assert.equal(parseMarketPagePath(`/en/market/${code.toLowerCase()}/`).lang, 'en');
    assert.ok(OPTIONAL_GLOBAL_CODES.includes(code), code);
    assert.ok(schema.properties.indices.properties[code], code);
    assert.ok(!schema.properties.indices.required.includes(code), code);
  }
  const listed = schema.$defs.sectionStatus.properties.global_indicators.properties.unavailable;
  for (const code of ASIA) assert.ok(listed.items.enum.includes(code), code);
  assert.equal(listed.maxItems, listed.items.enum.length);
  assert.equal(LOCAL_SESSION_MAX_LAG_DAYS, 14);
});

test('contract 1.2.0 takes the latest local session up to 14 days back, and a record without them', () => {
  const base = complete12();
  const date = base.meta.market_date;
  assert.deepEqual(verdict(base), { passed: true, errors: [] });
  assert.deepEqual(verdict(withAsia(base)), { passed: true, errors: [] });
  // A local holiday: the previous local close with its own date.
  assert.deepEqual(verdict(withAsia(base, { NIKKEI225: shiftDate(date, -3) })), { passed: true, errors: [] });
  assert.deepEqual(verdict(withAsia(base, { SHANGHAI: shiftDate(date, -14) })), { passed: true, errors: [] });
  const cases = [
    ['SHANGHAI', shiftDate(date, -15)],
    ['TAIEX', shiftDate(date, 1)],
    ['NIKKEI225', 'not-a-date']
  ];
  for (const [code, sourceDate] of cases) {
    const result = verdict(withAsia(base, { [code]: sourceDate }));
    assert.equal(result.passed, false, `${code} ${sourceDate}`);
    assert.ok(result.errors.some(error => error.startsWith(`$.indices.${code}.source_date`)), result.errors.join('\n'));
  }
  const missing = withAsia(base);
  missing.indices.TAIEX.source_date = null;
  assert.ok(verdict(missing).errors.some(error => error.startsWith('$.indices.TAIEX.source_date')));
});

test('a failed Asian index is declared unavailable and the record stays valid', () => {
  const payload = withAsia(complete12());
  payload.indices.SHANGHAI = unavailable(payload.indices.SHANGHAI);
  payload.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['SHANGHAI'] };
  assert.deepEqual(verdict(payload), { passed: true, errors: [] });
  const silent = withAsia(complete12());
  silent.indices.SHANGHAI = unavailable(silent.indices.SHANGHAI);
  assert.ok(verdict(silent).errors.some(error => error.startsWith('$.indices.SHANGHAI')));
  const phantom = complete12();
  phantom.rates_fx_volatility.DXY = unavailable(phantom.rates_fx_volatility.DXY);
  phantom.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['DXY', 'TAIEX'] };
  assert.ok(verdict(phantom).errors.some(error => error.includes('TAIEX')));
});

test('1W/1M take the Asian close', () => {
  assert.equal(getPeriodValue('NIKKEI225', { data_state: 'final_close', close: 56436.65, current: 1 }), 56436.65);
  assert.equal(getPeriodValue('TAIEX', { data_state: 'unavailable', close: null }), null);
});

test('session pages show the Asian row under the major indices, with a local-holiday note', () => {
  const context = { prev: null, next: null, report: null };
  for (const [lang, prefix, title, holiday] of [['ko', '', '아시아 증시', '현지 휴장'], ['en', '/en', 'Asian Markets', 'Local holiday']]) {
    const payload = withAsia(complete12(), { NIKKEI225: shiftDate(complete12().meta.market_date, -1) });
    const page = marketDatePageHtml(SHELLS[lang], payload, lang, context);
    const start = page.indexOf('market-asia-title');
    assert.ok(start > page.indexOf('major-index-grid'), lang);
    const row = page.slice(start, page.indexOf('</section>', start));
    assert.match(row, new RegExp(`>${title}</h3><div class="mini-instrument-grid market-asia-grid">`));
    assert.deepEqual([...row.matchAll(/<small>([^<]+)<\/small>/g)].map(m => m[1]), ['^N225', '000001.SS', '^TWII'], lang);
    assert.match(row, new RegExp(`href="${prefix}/market/nikkei225/"`), lang);
    assert.match(row, new RegExp(`href="${prefix}/market/taiex/"`), lang);
    assert.match(row, /56,436\.65/);
    // Only the index dated before the session carries the note.
    assert.equal((row.match(new RegExp(holiday, 'g')) || []).length, 1, lang);
  }
  const failed = withAsia(complete12());
  failed.indices.TAIEX = unavailable(failed.indices.TAIEX);
  failed.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['TAIEX'] };
  const page = marketDatePageHtml(SHELLS.ko, failed, 'ko', context);
  assert.doesNotMatch(page, /\/market\/taiex\//);
  assert.match(page, /\/market\/shanghai\//);
  assert.doesNotMatch(marketDatePageHtml(SHELLS.ko, complete12(), 'ko', context), /market-asia|nikkei225|아시아 증시/);
});

test('the Nikkei history page: dated Japanese sessions, a holiday carry listed once', () => {
  const NIKKEI = BY_CODE.NIKKEI225;
  const item = (close, previous, date) => JSON.stringify({ close, previous_close: previous, high: close, low: close, source_date: date, data_state: 'final_close' });
  const rows = [
    // 2026-11-23 is a Japanese holiday: the record carries the 11-20 close again.
    { market_date: '2026-11-23', published_at: '2026-11-23T07:10:00Z', item: item(56436.65, 59444.21, '2026-11-20'), optional_closes: closesFor(ASIA) },
    { market_date: '2026-11-20', published_at: '2026-11-20T07:10:00Z', item: item(56436.65, 59444.21, '2026-11-20'), optional_closes: closesFor(ASIA) },
    { market_date: '2026-11-19', published_at: '2026-11-19T07:10:00Z', item: item(59444.21, 59024.28, '2026-11-19'), optional_closes: closesFor(ASIA) },
    { market_date: '2026-11-18', published_at: '2026-11-18T07:10:00Z', item: null, optional_closes: closesFor([]) }
  ];
  const series = marketIndicatorSeries(rows, NIKKEI);
  assert.deepEqual(series.map(point => [point.date, point.recordDate]), [['2026-11-20', '2026-11-20'], ['2026-11-19', '2026-11-19']]);
  assert.equal(marketIndicatorTitle(NIKKEI, series, 'ko'), '닛케이225 지수 일별 종가 · 11월 20일 56,436.65(−5.06%) | Snowshagal');
  assert.equal(marketIndicatorTitle(NIKKEI, series, 'en'), 'Nikkei 225 Daily Close: 56,436.65 (−5.06%) on Nov 20, 2026 | Snowshagal');
  const ko = marketIndicatorPageHtml(SHELLS.ko, NIKKEI, series, 'ko', availableIndicatorCodes(rows));
  assert.match(ko, /<h1 id="market-indicator-heading">닛케이225 지수 일별 기록<\/h1>/);
  assert.match(ko, /도쿄 정규장 15:30 종가\(한국 시각 15:30\) · 날짜는 일본 거래일/);
  assert.match(ko, /날짜는 현지 거래일입니다/);
  assert.doesNotMatch(ko, /with-range/);
  assert.match(ko, /href="\/market\/shanghai\/">상해종합지수<\/a>/);
  const en = marketIndicatorPageHtml(SHELLS.en, NIKKEI, series, 'en', availableIndicatorCodes(rows));
  assert.match(en, /Tokyo regular-session close, 15:30 JST \(15:30 KST\)/);
  assert.match(en, /Dates are local trading days/);
  const shanghai = marketIndicatorPageHtml(SHELLS.ko, BY_CODE.SHANGHAI, series, 'ko', availableIndicatorCodes(rows));
  assert.match(shanghai, /상하이 정규장 15:00 종가\(한국 시각 16:00\)/);
  assert.equal(marketIndicatorTitle(BY_CODE.TAIEX, series, 'en'), 'TAIEX Daily Close: 56,436.65 (−5.06%) on Nov 20, 2026 | Snowshagal');
});

test('the sitemap lists the Asian pages only once a record has them', () => {
  const before = sitemapXml([], { marketSessions: [{ market_date: '2026-11-20', published_at: '2026-11-20T08:45:00Z', optional_closes: closesFor([]) }] });
  assert.doesNotMatch(before, /\/market\/(nikkei225|shanghai|taiex)\//);
  const after = sitemapXml([], { marketSessions: [{ market_date: '2026-11-24', published_at: '2026-11-24T08:45:00Z', optional_closes: closesFor(['NIKKEI225', 'TAIEX']) }] });
  assert.match(after, /<loc>https:\/\/snowshagal\.com\/market\/nikkei225\/<\/loc>/);
  assert.match(after, /<loc>https:\/\/snowshagal\.com\/en\/market\/taiex\/<\/loc>/);
  assert.doesNotMatch(after, /\/market\/shanghai\//);
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

test('TODAY shows the Asian row under the major indices, and nothing for a record without it', async () => {
  for (const [lang, prefix, holiday] of [['ko', '', '현지 휴장'], ['en', '/en', 'Local holiday']]) {
    const runtime = await dashboard(lang);
    const target = { innerHTML: '' };
    runtime.render(withAsia(complete12(), { TAIEX: shiftDate(complete12().meta.market_date, -2) }), target);
    const html = target.innerHTML;
    const start = html.indexOf('market-asia-title');
    assert.ok(start > html.indexOf('major-index-grid') && start < html.indexOf('<div class="mini-instrument-grid">'), lang);
    const row = html.slice(start, html.indexOf('</section>', start));
    assert.equal((row.match(/<article class="instrument-card/g) || []).length, 3, lang);
    assert.deepEqual([...row.matchAll(/<small>([^<]+)<\/small>/g)].map(m => m[1]), ['^N225', '000001.SS', '^TWII'], lang);
    assert.match(row, new RegExp(`<a class="instrument-history-link" href="${prefix}/market/shanghai/">`), lang);
    assert.match(row, /3,533\.79[\s\S]*?▼ −43\.83/);
    assert.equal((row.match(new RegExp(holiday, 'g')) || []).length, 1, lang);
  }
  const runtime = await dashboard('ko');
  const target = { innerHTML: '' };
  runtime.render(complete12(), target);
  assert.doesNotMatch(target.innerHTML, /market-asia|nikkei225|아시아 증시/);
});

test('1W/1M list the Asian indices after SOX once the window has them', async () => {
  const item = (start, end) => ({ baseline_value: start, end_value: end, change: end - start, return_pct: (end / start - 1) * 100, period_high: end, period_low: start, observations: 5, complete: true });
  const data = {
    aggregation_version: '1.0.0', period: '1w',
    window: { start_date: '2026-11-24', end_date: '2026-11-30', dates: ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30'], sessions_used: 5, required_sessions: 5, complete: true },
    instruments: {
      indices: { KOSPI: item(4800, 4900), NIKKEI225: item(56436.65, 57000), TAIEX: item(36033.29, 36500) },
      rates_fx_volatility: { SOX: item(8400, 8500) },
      commodities_crypto: {}
    },
    flows: { unit: 'KRW billion', sessions_used: 5, markets: {} }, breadth: {}, krx_groups: {}
  };
  const runtime = await dashboard('ko');
  const target = { innerHTML: '' };
  runtime.renderRangeView(data, '1w', target);
  const names = [...target.innerHTML.matchAll(/<div class="range-item-name">\s*<strong>(.*?)<\/strong>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(names.slice(0, 4), ['코스피', '필라델피아 반도체', '닛케이225', '대만 가권']);
  assert.match(target.innerHTML, /56,436\.65 <span class="range-arrow">→<\/span> 57,000\.00/);
});
