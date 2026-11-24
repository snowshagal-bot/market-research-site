import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { previousTradingDate } from '../functions/api/market/_freshness.js';
import { validateMarketPayload } from '../functions/api/market/_shared.js';
import { shiftDate } from '../functions/_trading-calendar.js';
import { marketDatePageHtml } from '../functions/_market-date-page.js';

// Stock rankings (proposal 6, 2026-11-23): per KRX market the top five gainers,
// losers and stocks by trading value, and how many stocks set a 52-week high
// or low. The collector saves Naver's ranking lists in the 15:35~15:39 KST
// regular snapshot window (from 15:40 NXT after-market trades move them) and
// exports the section only when its last two captures agree. SOFT and
// optional within contract 1.2.0: records before it carry neither the section
// nor its status.

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = JSON.parse(await read('contracts/market_close/market_close.schema.json'));
const v110 = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const SHELLS = { ko: await read('market/index.html'), en: await read('en/market/index.html') };
const clone = value => JSON.parse(JSON.stringify(value));
const verdict = payload => validateMarketPayload(payload, schema);
const HANGUL = /[ㄱ-ㆎ가-힣]/;

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

const stock = (rank, ticker, name, close, change_pct, trading_value_won, price_limit = null) => ({ rank, ticker, name, close, change_pct, trading_value_won, price_limit });

// Shaped like Naver's lists of 2026-11-20 (KOSPI −5.21%, KOSDAQ −5.71%).
function rankings(date) {
  return {
    source_date: date,
    as_of: `${date}T15:38:19+09:00`,
    source: '네이버 금융 국내주식 순위 · 정규장 마감 후 15:35~15:39 캡처',
    markets: {
      KOSPI: {
        top_gainers: [
          stock(1, '18064K', '한진칼우', 99700, 29.99, 43491000000, 'upper'),
          stock(2, '003495', '대한항공우', 27150, 12.42, 18200000000),
          stock(3, '180640', '한진칼', 237000, 9.72, 134700000000)
        ],
        top_losers: [
          stock(1, '014990', '인디에프', 1997, -25.62, 2531000000),
          stock(2, '007660', '이수페타시스', 68500, -17.47, 133500000000)
        ],
        top_turnover: [
          stock(1, '000660', 'SK하이닉스', 1113000, -5.92, 3430981000000),
          stock(2, '005930', '삼성전자', 183100, -7.01, 3074629000000)
        ],
        new_high_52w: 5,
        new_low_52w: 170
      },
      KOSDAQ: {
        top_gainers: [stock(1, '285770', '삐아', 7810, 29.95, 469000000, 'upper')],
        top_losers: [stock(1, '355390', '크라우드웍스', 810, -29.99, 1000000000, 'lower')],
        top_turnover: [stock(1, '067390', '하나에어로', 5670, -0.53, 484100000000)],
        new_high_52w: 6,
        new_low_52w: 293
      }
    }
  };
}

/** `payload` with the section; `state` 'complete' | 'unavailable'. */
function withRankings(payload, state = 'complete') {
  const copy = clone(payload);
  const status = state === 'complete' ? { status: 'complete', reason: null } : { status: 'unavailable', reason: 'source_validation_failed' };
  const ordered = {};
  for (const [key, value] of Object.entries(copy)) {
    if (key === 'section_status') ordered.stock_rankings = state === 'complete' ? rankings(copy.meta.market_date) : null;
    ordered[key] = key === 'section_status' ? { ...value, stock_rankings: status } : value;
  }
  return ordered;
}

test('the contract adds stock_rankings as an optional SOFT section with its own status', () => {
  assert.ok(!schema.required.includes('stock_rankings'));
  assert.deepEqual(schema.properties.stock_rankings.anyOf, [{ $ref: '#/$defs/stockRankings' }, { type: 'null' }]);
  assert.ok(!schema.$defs.sectionStatus.required.includes('stock_rankings'));
  assert.deepEqual(schema.$defs.sectionStatus.properties.stock_rankings.properties.status, { enum: ['complete', 'unavailable'] });
  assert.deepEqual(schema.$defs.rankingMarket.required, ['top_gainers', 'top_losers', 'top_turnover', 'new_high_52w', 'new_low_52w']);
  for (const key of ['top_gainers', 'top_losers', 'top_turnover']) assert.equal(schema.$defs.rankingMarket.properties[key].maxItems, 5);
  assert.deepEqual(schema.$defs.rankingStock.properties.price_limit, { enum: ['upper', 'lower', null] });
});

test('contract 1.2.0 accepts complete or unavailable rankings, and a record without them', () => {
  assert.deepEqual(verdict(complete12()).errors, []);
  assert.deepEqual(verdict(withRankings(complete12())).errors, []);
  assert.deepEqual(verdict(withRankings(complete12(), 'unavailable')).errors, []);

  const empty = withRankings(complete12());
  empty.stock_rankings.markets.KOSPI.top_gainers = [];
  assert.deepEqual(verdict(empty).errors, [], 'a day when nothing rose');

  const missing = withRankings(complete12());
  missing.stock_rankings = null;
  assert.ok(verdict(missing).errors.some(error => error.startsWith('$.stock_rankings: section_status가 complete')));

  const stale = withRankings(complete12(), 'unavailable');
  stale.stock_rankings = rankings(stale.meta.market_date);
  assert.ok(verdict(stale).errors.some(error => error.includes('unavailable이면 null')));

  const noReason = withRankings(complete12(), 'unavailable');
  noReason.section_status.stock_rankings.reason = null;
  assert.ok(verdict(noReason).errors.some(error => error.includes('stock_rankings.reason')));

  const noStatus = withRankings(complete12());
  delete noStatus.section_status.stock_rankings;
  assert.ok(verdict(noStatus).errors.some(error => error.includes('상태가 필요합니다')));
});

test('the receiver rejects another session’s rankings and re-sorted lists', () => {
  const date = complete12().meta.market_date;
  const broken = mutate => {
    const payload = withRankings(complete12());
    mutate(payload.stock_rankings, payload.stock_rankings.markets.KOSPI);
    return verdict(payload).errors;
  };
  assert.ok(broken(section => { section.source_date = shiftDate(date, -1); }).some(error => error.includes('stock_rankings.source_date')));
  assert.ok(broken(section => { section.as_of = `${shiftDate(date, 1)}T00:30:00+09:00`; }).some(error => error.includes('stock_rankings.as_of')));
  // 08:00 KST is still the same day although it is the day before in UTC.
  assert.deepEqual(broken(section => { section.as_of = `${date}T08:00:00+09:00`; }), []);
  assert.ok(broken((section, kospi) => { kospi.top_gainers.reverse().forEach((row, index) => { row.rank = index + 1; }); }).some(error => error.includes('top_gainers 순서')));
  assert.ok(broken((section, kospi) => { kospi.top_gainers[2].change_pct = -1; }).some(error => error.includes('상승 종목')));
  assert.ok(broken((section, kospi) => { kospi.top_losers[1].change_pct = 0; }).some(error => error.includes('하락 종목')));
  assert.ok(broken((section, kospi) => { kospi.top_turnover[1].trading_value_won = 4e12; }).some(error => error.includes('top_turnover 순서')));
  assert.ok(broken((section, kospi) => { kospi.top_turnover[1].ticker = '000660'; }).some(error => error.includes('중복')));
  assert.ok(broken((section, kospi) => { kospi.top_losers[1].rank = 3; }).some(error => error.includes('.rank')));
  assert.ok(broken((section, kospi) => { kospi.top_turnover[0].ticker = '00066'; }).some(error => error.includes('ticker')));
  assert.ok(broken((section, kospi) => { kospi.new_low_52w = -1; }).length > 0);
  assert.ok(broken((section, kospi) => {
    kospi.top_turnover = Array.from({ length: 6 }, (_, index) => stock(index + 1, `00000${index}`, `종목${index}`, 1000, 1, 6e9 - index));
  }).length > 0);
});

// The rankings card of a rendered page: its <section>, or '' when there is none.
const rankingsCard = page => page.match(/<section class="mk-card mk-rankings-card"[\s\S]*?<\/section>/)?.[0] || '';
const cardTitle = card => card.match(/<h3 id="mk-rankings-title">([^<]+)<\/h3>/)?.[1];

const CASES = [
  ['ko', '등락률 · 거래대금 상위 종목', ['한진칼우', '상한가', '하한가', '52주 신고가 <b>5</b>종목', '52주 신저가 <b>170</b>종목</span><span class="ranking-52w-basis">장중 기준 · 네이버 금융 집계</span>', '3.43조원', '99,700원 · 거래대금 435억원', '1,997원 · 거래대금 25억원', '7,810원 · 거래대금 4.7억원', '810원 · 거래대금 10억원', '15:35~15:39에 저장']],
  ['en', 'Top Movers &amp; Most Traded', ['18064K', 'Limit up', 'Limit down', 'SK hynix', '52-week highs <b>5</b>', '52-week lows <b>170</b></span><span class="ranking-52w-basis">intraday · Naver Finance count</span>', 'KRW 3.43tn', '7,810 · Value KRW 469M', '15:35–15:39 KST']]
];

test('session pages show the rankings card after the cap table and before the sectors', () => {
  const context = { prev: null, next: null, report: null };
  for (const [lang, title, texts] of CASES) {
    const page = marketDatePageHtml(SHELLS[lang], withRankings(complete12()), lang, context);
    const card = rankingsCard(page);
    assert.equal(cardTitle(card), title, lang);
    assert.ok(page.indexOf('id="mk-top-title"') < page.indexOf('id="mk-rankings-title"'), `${lang}: after the cap table`);
    assert.ok(page.indexOf('id="mk-rankings-title"') < page.indexOf('id="mk-groups-title"'), `${lang}: before the sectors`);
    assert.ok(page.indexOf('id="mk-rankings-title"') < page.indexOf('id="mk-global-title"'), `${lang}: inside the Korean market section`);
    assert.equal((card.match(/<article class="ranking-market">/g) || []).length, 2, lang);
    assert.equal((card.match(/<li>/g) || []).length, 10, lang);
    for (const text of texts) assert.ok(card.includes(text), `${lang}: ${text}`);
    if (lang === 'en') assert.doesNotMatch(card, HANGUL, 'no Korean names on the English page');
  }
  const unavailable = rankingsCard(marketDatePageHtml(SHELLS.ko, withRankings(complete12(), 'unavailable'), 'ko', context));
  assert.match(unavailable, /등락률 · 거래대금 상위 종목<\/h3>[\s\S]*<p class="unit-note">이날 종목 순위 데이터 없음<\/p>/);
  assert.doesNotMatch(unavailable, /ranking-markets/);
  const before = marketDatePageHtml(SHELLS.ko, complete12(), 'ko', context);
  assert.doesNotMatch(before, /등락률 · 거래대금 상위 종목|ranking-|mk-rankings/);
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

test('TODAY shows the same rankings card as the session page', async () => {
  const context = { prev: null, next: null, report: null };
  for (const [lang, title, texts] of CASES) {
    const runtime = await dashboard(lang);
    const target = { innerHTML: '' };
    runtime.render(withRankings(complete12()), target);
    const card = rankingsCard(target.innerHTML);
    assert.equal(cardTitle(card), title, lang);
    assert.ok(target.innerHTML.indexOf('id="mk-top-title"') < target.innerHTML.indexOf('id="mk-rankings-title"'), lang);
    assert.ok(target.innerHTML.indexOf('id="mk-rankings-title"') < target.innerHTML.indexOf('id="mk-global-title"'), lang);
    for (const text of texts) assert.ok(card.includes(text), `${lang}: ${text}`);
    if (lang === 'en') assert.doesNotMatch(card, HANGUL);
    // One record, two renderers: the lists, counts and note are the same markup.
    const lists = html => html.slice(html.indexOf('<div class="ranking-markets">'));
    const server = rankingsCard(marketDatePageHtml(SHELLS[lang], withRankings(complete12()), lang, context));
    assert.equal(lists(card).replace(/\s+/g, ' '), lists(server).replace(/\s+/g, ' '), `${lang}: same body as the session page`);
  }
  const runtime = await dashboard('ko');
  const target = { innerHTML: '' };
  runtime.render(complete12(), target);
  assert.doesNotMatch(target.innerHTML, /ranking-|mk-rankings/);
  runtime.render(withRankings(complete12(), 'unavailable'), target);
  const unavailable = rankingsCard(target.innerHTML);
  assert.match(unavailable, /등락률 · 거래대금 상위 종목<\/h3>[\s\S]*<p class="unit-note">이날 종목 순위 데이터 없음<\/p>/);
  assert.doesNotMatch(unavailable, /ranking-markets/);
});
