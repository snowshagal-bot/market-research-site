import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { previousTradingDate } from '../functions/api/market/_freshness.js';
import { onRequestPost } from '../functions/api/market/publish.js';
import { validateMarketPayload } from '../functions/api/market/_shared.js';
import { createAdminSession, createMockAuthDb } from './helpers/auth-test-helper.mjs';

// Contract 1.2.0: HARD sections (INDEX, TOP10, TURNOVER, INVESTOR, PROGRAM,
// SHORT, FUTURES) still gate `final`; SOFT sections (last-5-session flows,
// KRX sectors/themes, global/24h indicators) may be partial or unavailable,
// declared in section_status, and must then be genuinely empty.

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = JSON.parse(await read('contracts/market_close/market_close.schema.json'));
const v110 = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const v120Example = JSON.parse(await read('contracts/market_close/market_close.example.v1.2.0.json'));
const clone = value => JSON.parse(JSON.stringify(value));
const GLOBAL = [
  ['indices', 'NASDAQ'], ['indices', 'DOW'], ['indices', 'SP500'],
  ['rates_fx_volatility', 'SOX'], ['rates_fx_volatility', 'VIX'], ['rates_fx_volatility', 'US10Y'],
  ['rates_fx_volatility', 'USDKRW'], ['rates_fx_volatility', 'JPYKRW'], ['rates_fx_volatility', 'DXY'],
  ['commodities_crypto', 'WTI'], ['commodities_crypto', 'GOLD'], ['commodities_crypto', 'BITCOIN']
];

// The example's source dates are aligned to its market date the same way the
// existing publish tests do, so freshness rules apply to every case below.
function aligned(payload, marketDate = payload.meta.market_date) {
  const copy = clone(payload);
  copy.meta.market_date = marketDate;
  const usDate = previousTradingDate(marketDate, 'NYSE');
  for (const code of ['KOSPI', 'KOSDAQ']) copy.indices[code].source_date = marketDate;
  for (const code of ['NASDAQ', 'DOW', 'SP500']) if (copy.indices[code]) copy.indices[code].source_date = usDate;
  for (const code of ['SOX', 'VIX', 'US10Y']) if (copy.rates_fx_volatility[code]) copy.rates_fx_volatility[code].source_date = usDate;
  for (const code of ['USDKRW', 'JPYKRW', 'DXY']) if (copy.rates_fx_volatility[code]) copy.rates_fx_volatility[code].source_date = marketDate;
  for (const code of ['WTI', 'GOLD', 'BITCOIN']) if (copy.commodities_crypto[code]) copy.commodities_crypto[code].source_date = marketDate;
  for (const rows of Object.values(copy.krx_groups || {})) for (const row of rows) row.source_date = marketDate;
  return copy;
}

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
  return aligned(ordered);
}

function fiveDayPartial(payload, missing = '2026-08-25') {
  payload.recent_5d_flows = { ...payload.recent_5d_flows, used_trading_days: 0, markets: {} };
  payload.section_status.five_day_flows = {
    status: 'partial', reason: 'missing_session', expected_sessions: 5, available_sessions: 4, missing_sessions: [missing]
  };
  return payload;
}

function groupsUnavailable(payload) {
  payload.krx_groups = null;
  payload.section_status.krx_groups = { status: 'unavailable', reason: 'source_validation_failed' };
  return payload;
}

function emptyInstrument(item) {
  return {
    ...item, close: null, current: null, change: null, change_pct: null, open: null, high: null, low: null,
    previous_close: null, source_date: null, as_of: null, retrieved_at: null, data_state: 'unavailable', is_cached: false
  };
}

function globalsUnavailable(payload, codes) {
  for (const [section, code] of GLOBAL) {
    if (codes.includes(code)) payload[section][code] = emptyInstrument(payload[section][code]);
  }
  payload.section_status.global_indicators = {
    status: codes.length === GLOBAL.length ? 'unavailable' : 'partial',
    reason: 'source_unavailable',
    unavailable: GLOBAL.map(([, code]) => code).filter(code => codes.includes(code))
  };
  return payload;
}

function breadthUnavailable(payload, reason = 'source_unavailable') {
  payload.market_breadth = {};
  payload.section_status.market_breadth = { status: 'unavailable', reason };
  return payload;
}

const verdict = payload => validateMarketPayload(payload, schema);

test('1.1.0 historical final still passes and gains no new requirement', () => {
  const result = verdict(aligned(v110));
  assert.deepEqual(result, { passed: true, errors: [] });
});

test('1.1.0 payloads may not carry the 1.2.0 section_status block', () => {
  const payload = aligned(v110);
  payload.section_status = complete12().section_status;
  const result = verdict(payload);
  assert.equal(result.passed, false);
  assert.ok(result.errors.includes('$.section_status: 계약에 없는 필드입니다.'));
});

test('1.1.0 keeps requiring five complete sessions and KRX groups for final', () => {
  const partial = aligned(v110);
  partial.recent_5d_flows.used_trading_days = 4;
  assert.ok(verdict(partial).errors.some(error => error.includes('used_trading_days')));
  const noGroups = aligned(v110);
  noGroups.krx_groups = null;
  assert.equal(verdict(noGroups).passed, false);
});

test('1.2.0 with every section complete passes', () => {
  assert.deepEqual(verdict(complete12()), { passed: true, errors: [] });
});

test('1.2.0 requires section_status', () => {
  const payload = complete12();
  delete payload.section_status;
  const result = verdict(payload);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some(error => error.includes('section_status')));
});

test('1.2.0 five-session partial is final-publishable without a cumulative number', () => {
  assert.deepEqual(verdict(fiveDayPartial(complete12())), { passed: true, errors: [] });
});

test('1.2.0 five-session partial must not carry a four-session sum', () => {
  const payload = fiveDayPartial(complete12());
  payload.recent_5d_flows.markets = clone(v110.recent_5d_flows.markets);
  payload.recent_5d_flows.used_trading_days = 4;
  const result = verdict(payload);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some(error => error.includes('누적 숫자')));
});

test('1.2.0 five-session status must be internally consistent', () => {
  const cases = {
    'partial without a reason': payload => { payload.section_status.five_day_flows.reason = null; },
    'partial counts not adding to five': payload => { payload.section_status.five_day_flows.available_sessions = 3; },
    'complete with a missing session': payload => {
      payload.section_status.five_day_flows = { status: 'complete', reason: null, expected_sessions: 5, available_sessions: 4, missing_sessions: ['2026-08-25'] };
    },
    'unknown status word': payload => { payload.section_status.five_day_flows.status = 'degraded'; }
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const payload = fiveDayPartial(complete12());
    mutate(payload);
    assert.equal(verdict(payload).passed, false, label);
  }
});

test('1.2.0 KRX groups unavailable passes; another date is never a fallback', () => {
  assert.deepEqual(verdict(groupsUnavailable(complete12())), { passed: true, errors: [] });
  const stale = complete12();
  stale.section_status.krx_groups = { status: 'unavailable', reason: 'source_validation_failed' };
  const result = verdict(stale);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some(error => error.startsWith('$.krx_groups')));
  const wrongDate = complete12();
  wrongDate.krx_groups.sectors[0].source_date = '2026-08-27';
  assert.equal(verdict(wrongDate).passed, false);
});

test('1.2.0 global indicators unavailable (some or all) pass without stale values', () => {
  assert.deepEqual(verdict(globalsUnavailable(complete12(), ['USDKRW', 'BITCOIN'])), { passed: true, errors: [] });
  assert.deepEqual(verdict(globalsUnavailable(complete12(), GLOBAL.map(([, code]) => code))), { passed: true, errors: [] });
});

test('1.2.0 unavailable indicators must be empty and undeclared ones must be fresh', () => {
  const stale = globalsUnavailable(complete12(), ['WTI']);
  stale.commodities_crypto.WTI.close = 88.1;
  assert.ok(verdict(stale).errors.some(error => error.includes('WTI') && error.includes('stale')));

  const undeclared = complete12();
  undeclared.commodities_crypto.GOLD = emptyInstrument(undeclared.commodities_crypto.GOLD);
  assert.equal(verdict(undeclared).passed, false);

  const oldDate = complete12();
  oldDate.rates_fx_volatility.USDKRW.source_date = '2026-08-27';
  assert.ok(verdict(oldDate).errors.some(error => error.includes('USDKRW.source_date')));
});

test('1.2.0 KOSPI and KOSDAQ can never be declared SOFT-unavailable', () => {
  const payload = complete12();
  payload.indices.KOSPI = emptyInstrument(payload.indices.KOSPI);
  payload.section_status.global_indicators = { status: 'partial', reason: 'source_unavailable', unavailable: ['KOSPI'] };
  assert.equal(verdict(payload).passed, false);
});

test('1.2.0 any HARD section missing fails final', () => {
  const cases = {
    INDEX: payload => { payload.indices.KOSDAQ = null; },
    TOP10: payload => { payload.market_cap_top10 = payload.market_cap_top10.slice(0, 9); },
    TURNOVER: payload => { delete payload.market_internals.turnover.KOSDAQ; },
    INVESTOR: payload => { delete payload.krx_investor_trading.markets.KOSPI; },
    PROGRAM: payload => { delete payload.program_basis.program_trading['비차익']; },
    SHORT: payload => { delete payload.short_selling.market_summary.KOSPI; },
    'FUTURES investors': payload => { delete payload.krx_investor_trading.markets['KOSPI200선물']; },
    'FUTURES basis': payload => { payload.program_basis.basis = null; },
    validation: payload => { payload.validation = { passed: false, errors: ['프로그램 전체 미확정'] }; }
  };
  for (const [label, mutate] of Object.entries(cases)) {
    // HARD must still fail even when every SOFT section is degraded.
    const payload = globalsUnavailable(groupsUnavailable(fiveDayPartial(complete12())), ['VIX']);
    mutate(payload);
    assert.equal(verdict(payload).passed, false, label);
  }
});

test('the documented 1.2.0 example is a valid final (five-session partial, groups unavailable)', () => {
  const payload = aligned(v120Example);
  assert.deepEqual(verdict(payload), { passed: true, errors: [] });
  assert.equal(payload.section_status.five_day_flows.status, 'partial');
  assert.deepEqual(payload.recent_5d_flows.markets, {});
  assert.equal(payload.krx_groups, null);
});

class MockDb {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return null; },
      async all() { return { results: [] }; },
      async run() {
        if (/INSERT INTO market_close_snapshots/i.test(sql)) {
          const [market_date, schema_version, , status, payload_json] = this.args;
          db.rows.set(market_date, { market_date, schema_version, status, payload_json });
        }
        return { success: true };
      }
    };
  }
}

test('publish API stores a 1.2.0 SOFT-degraded final and rejects a HARD-incomplete one', async () => {
  const authDb = await createMockAuthDb();
  await createAdminSession(authDb);
  const db = new MockDb();
  const env = {
    AUTH_DB: authDb,
    COMMENTS_DB: db,
    MARKET_PUBLISH_KEY: 'market-secret',
    ASSETS: { fetch: async request => new URL(request.url).pathname.endsWith('/market_close.schema.json') ? Response.json(schema) : new Response('Not found', { status: 404 }) }
  };
  const post = payload => onRequestPost({
    request: new Request('https://snowshagal.com/api/market/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-market-publish-key': 'market-secret' },
      body: JSON.stringify(payload)
    }),
    env
  });
  const degraded = globalsUnavailable(groupsUnavailable(fiveDayPartial(complete12())), ['BITCOIN']);
  const accepted = await post(degraded);
  assert.ok([200, 201].includes(accepted.status), `status ${accepted.status}`);
  const stored = db.rows.get(degraded.meta.market_date);
  assert.equal(stored.schema_version, '1.2.0');
  assert.deepEqual(JSON.parse(stored.payload_json).section_status, degraded.section_status);

  const hardMissing = clone(degraded);
  hardMissing.meta.market_date = '2026-08-27';
  Object.assign(hardMissing, aligned(hardMissing, '2026-08-27'));
  delete hardMissing.program_basis.program_trading['전체'];
  const rejected = await post(hardMissing);
  assert.ok(rejected.status >= 400 && rejected.status < 500, `status ${rejected.status}`);
  assert.equal(db.rows.has('2026-08-27'), false);
});

async function marketRuntime(lang) {
  const script = await read('assets/market-close.js');
  const document = {
    documentElement: { dataset: { siteLang: lang } },
    body: { dataset: {} },
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = {};
  vm.runInContext(script, vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console }));
  return window.MARKET_CLOSE;
}

function fiveDaySection(markup) {
  const start = markup.indexOf('id="market-section-6"');
  return markup.slice(start, markup.indexOf('</section>', start));
}

test('MARKET renders a partial five-session window as availability, never as numbers (KO/EN)', async () => {
  const payload = fiveDayPartial(complete12(), '2026-09-22');
  for (const [lang, headline, missing] of [
    ['ko', '데이터 불완전 · 4/5 거래일 확보', '9월 22일 데이터 없음'],
    ['en', 'Incomplete data · 4/5 sessions available', 'No data for Sep 22']
  ]) {
    const runtime = await marketRuntime(lang);
    const target = { innerHTML: '' };
    runtime.render(payload, target);
    const section = fiveDaySection(target.innerHTML);
    assert.ok(section.includes(headline), `${lang}: ${section}`);
    assert.ok(section.includes(missing), `${lang}: ${section}`);
    assert.doesNotMatch(section, /<table/);
    assert.doesNotMatch(section, /억원|조원|KRW [+−]/);
  }
});

test('MARKET keeps the five-session table for complete 1.2.0 and for 1.1.0', async () => {
  for (const payload of [complete12(), aligned(v110)]) {
    const runtime = await marketRuntime('ko');
    const target = { innerHTML: '' };
    runtime.render(payload, target);
    const section = fiveDaySection(target.innerHTML);
    assert.match(section, /<table/);
    assert.doesNotMatch(section, /데이터 불완전/);
  }
});

test('MARKET shows unavailable global indicators as unavailable, not as a stale value', async () => {
  const payload = globalsUnavailable(complete12(), ['USDKRW']);
  for (const [lang, word] of [['ko', '데이터 없음'], ['en', 'Unavailable']]) {
    const runtime = await marketRuntime(lang);
    const target = { innerHTML: '' };
    runtime.render(payload, target);
    const at = target.innerHTML.indexOf('<small>KRW=X</small>');
    const card = target.innerHTML.slice(at, target.innerHTML.indexOf('</article>', at));
    assert.ok(at > 0);
    assert.match(card, /instrument-value">--</);
    assert.ok(card.includes(word), `${lang}`);
  }
});

test('1.2.0 market breadth complete passes and is still required per market', () => {
  assert.deepEqual(verdict(complete12()), { passed: true, errors: [] });
  const missing = complete12();
  delete missing.market_breadth.KOSDAQ;
  assert.ok(verdict(missing).errors.some(error => error.startsWith('$.market_breadth.KOSDAQ')));
});

test('1.2.0 market breadth unavailable is final-publishable (SOFT)', () => {
  assert.deepEqual(verdict(breadthUnavailable(complete12())), { passed: true, errors: [] });
  assert.deepEqual(verdict(breadthUnavailable(complete12(), 'replay_without_stored_source')), { passed: true, errors: [] });
});

test('1.2.0 market breadth never carries stale or other-date counts', () => {
  const otherDate = complete12();
  otherDate.market_breadth.KOSPI.source_date = '2026-08-27';
  assert.ok(verdict(otherDate).errors.some(error => error.includes('market_breadth.KOSPI.source_date')));
  const staleUnderUnavailable = complete12();
  staleUnderUnavailable.section_status.market_breadth = { status: 'unavailable', reason: 'stale_source_date' };
  assert.ok(verdict(staleUnderUnavailable).errors.some(error => error.startsWith('$.market_breadth:')));
  const noReason = breadthUnavailable(complete12());
  noReason.section_status.market_breadth.reason = null;
  assert.equal(verdict(noReason).passed, false);
  const partialWord = complete12();
  partialWord.section_status.market_breadth.status = 'partial';
  assert.equal(verdict(partialWord).passed, false);
});

test('1.2.0 HARD missing still fails when market breadth is complete', () => {
  const payload = complete12();
  payload.market_cap_top10 = payload.market_cap_top10.slice(0, 9);
  assert.equal(payload.section_status.market_breadth.status, 'complete');
  assert.equal(verdict(payload).passed, false);
});

test('MARKET shows unavailable breadth as a state, never as counts (KO/EN)', async () => {
  const payload = breadthUnavailable(complete12());
  for (const [lang, text] of [['ko', '이날 시장 폭 데이터 없음'], ['en', 'Market breadth unavailable for this session']]) {
    const runtime = await marketRuntime(lang);
    const target = { innerHTML: '' };
    runtime.render(payload, target);
    const start = target.innerHTML.indexOf('id="market-section-4"');
    const section = target.innerHTML.slice(start, target.innerHTML.indexOf('</section>', start));
    assert.ok(section.includes(text), lang);
    assert.doesNotMatch(section, /breadth-card|breadth-bar/);
  }
});
