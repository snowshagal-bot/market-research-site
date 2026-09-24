// Today's KRX session (trading / holiday / weekend) is a separate fact from
// Market Close freshness. functions/_trading-calendar.js is its only source;
// /api/market/latest carries it in a header without touching the body, and the
// MARKET page shows a quiet TODAY-only line that never replaces the stale or
// outage notices.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { expectedLatestKrxTradingDate, expectedPublishedKrxTradingDate, krxSessionStatus } from '../functions/_trading-calendar.js';
import { onRequestGet as latestGet } from '../functions/api/market/latest.js';
import { onRequestGet as dateGet } from '../functions/api/market/date.js';
import { onRequestGet as rangeGet } from '../functions/api/market/range.js';
import {
  EXPECTED_MARKET_DATE_HEADER,
  KRX_SESSION_HEADER,
  TABLE_NAME,
  ensureMarketTable,
  formatMarketResponse
} from '../functions/api/market/_shared.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [LOCALE_JS, MARKET_JS, EXAMPLE] = await Promise.all([
  read('assets/locale.js'), read('assets/market-close.js'), read('contracts/market_close/market_close.example.v1.2.0.json')
]);
const kst = (date, time = '12:00') => new Date(`${date}T${time}:00+09:00`);

function localeApi() {
  const window = {};
  vm.runInContext(LOCALE_JS, vm.createContext({ window, Intl, Date }));
  return window.MARKET_LOCALE;
}
const LOCALE = localeApi();

/* ------------------------------------------------------------ calendar */

test('krxSessionStatus: trading, holiday and weekend around Chuseok 2026', () => {
  const cases = [
    ['2026-09-23', 'trading', null, '2026-09-23'],
    ['2026-09-24', 'holiday', { ko: '추석 전날', en: 'Chuseok Eve' }, '2026-09-23'],
    ['2026-09-25', 'holiday', { ko: '추석', en: 'Chuseok Day' }, '2026-09-23'],
    ['2026-09-26', 'weekend', null, '2026-09-23'],
    ['2026-09-27', 'weekend', null, '2026-09-23'],
    ['2026-09-28', 'trading', null, '2026-09-28']
  ];
  for (const [day, state, holidayName, lastTradingDate] of cases) {
    for (const time of ['00:00', '12:00', '23:59']) {
      assert.deepEqual(krxSessionStatus(kst(day, time)), { calendarDate: day, state, holidayName, lastTradingDate }, `${day} ${time}`);
    }
  }
});

test('krxSessionStatus: special sessions are trading days; an unconfigured year gives no status', () => {
  assert.equal(krxSessionStatus(kst('2026-11-19')).state, 'trading'); // CSAT delayed open/close
  assert.equal(krxSessionStatus(kst('2026-01-02')).state, 'trading'); // delayed opening ceremony
  assert.equal(krxSessionStatus(kst('2027-01-04')), null);
  assert.equal(krxSessionStatus(new Date('invalid')), null);
  // New Year's Day: still a holiday, but its previous session lies in an unconfigured year.
  assert.deepEqual(krxSessionStatus(kst('2026-01-01')), {
    calendarDate: '2026-01-01', state: 'holiday', holidayName: { ko: '신정 (새해 첫날)', en: "New Year's Day" }, lastTradingDate: null
  });
});

test('freshness is unchanged: a holiday after a published close is not stale', () => {
  for (const day of ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']) {
    assert.equal(expectedPublishedKrxTradingDate(kst(day)), '2026-09-23');
    assert.equal(expectedLatestKrxTradingDate(kst(day)), '2026-09-23');
    assert.equal(LOCALE.marketCloseAvailability('2026-09-23', '2026-09-23', 'ko').stale, false);
  }
  assert.equal(LOCALE.marketCloseAvailability('2026-09-21', '2026-09-23', 'ko').stale, true);
});

/* ------------------------------------------------------------ API */

function payloadFor(marketDate) {
  const payload = JSON.parse(EXAMPLE);
  payload.meta.market_date = marketDate;
  return payload;
}

async function database(dates) {
  const db = new SqliteD1();
  await ensureMarketTable({ COMMENTS_DB: db });
  for (const date of dates) {
    const payload = payloadFor(date);
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(date, payload.meta.schema_version, payload.meta.generated_at, 'final', JSON.stringify(payload), '2026-09-01T00:00:00.000Z', 'test', '', '')
      .run();
  }
  return db;
}

test('/api/market/latest: body, ETag and caching unchanged; the session travels in an ASCII header', async () => {
  const db = await database(['2026-09-22', '2026-09-23']);
  const env = { COMMENTS_DB: db };
  const row = await db.prepare(`SELECT market_date, generated_at, published_at, payload_json, takeaway_ko, takeaway_en FROM ${TABLE_NAME} WHERE market_date = ?`).bind('2026-09-23').first();
  const plain = formatMarketResponse(row, new Request('https://snowshagal.com/api/market/latest'));
  const plainBody = await plain.text();

  for (const [day, state] of [['2026-09-23', 'trading'], ['2026-09-24', 'holiday'], ['2026-09-26', 'weekend']]) {
    const response = await latestGet({ request: new Request('https://snowshagal.com/api/market/latest'), env, now: kst(day, '18:00') });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), plainBody, `${day}: the body is byte-identical`);
    assert.equal(response.headers.get('etag'), plain.headers.get('etag'));
    assert.equal(response.headers.get('cache-control'), plain.headers.get('cache-control'));
    assert.equal(response.headers.get(EXPECTED_MARKET_DATE_HEADER), '2026-09-23');
    const raw = response.headers.get(KRX_SESSION_HEADER);
    assert.match(raw, /^[\x21-\x7e]+$/, 'ASCII-only header value');
    const session = LOCALE.parseKrxSessionHeader(raw);
    assert.equal(session.state, state);
    assert.deepEqual(JSON.parse(JSON.stringify(session)), krxSessionStatus(kst(day, '18:00')));
  }

  // A revalidation keeps its 304 and carries the same headers.
  const etag = plain.headers.get('etag');
  const revalidated = await latestGet({ request: new Request('https://snowshagal.com/api/market/latest', { headers: { 'if-none-match': etag } }), env, now: kst('2026-09-24') });
  assert.equal(revalidated.status, 304);
  assert.equal(LOCALE.parseKrxSessionHeader(revalidated.headers.get(KRX_SESSION_HEADER)).holidayName.en, 'Chuseok Eve');
});

test('parseKrxSessionHeader rejects anything malformed', () => {
  for (const value of [null, '', '%E0%A4%A', 'not-json', encodeURIComponent('{"state":"open","calendarDate":"2026-09-24"}'), encodeURIComponent('{"state":"holiday","calendarDate":"24-09-2026"}')]) {
    assert.equal(LOCALE.parseKrxSessionHeader(value), null, String(value));
  }
  const holidayWithoutName = LOCALE.parseKrxSessionHeader(encodeURIComponent('{"state":"holiday","calendarDate":"2026-09-24","holidayName":{"ko":1},"lastTradingDate":"x"}'));
  assert.deepEqual(JSON.parse(JSON.stringify(holidayWithoutName)), { calendarDate: '2026-09-24', state: 'holiday', holidayName: null, lastTradingDate: null });
  assert.equal(LOCALE.krxSessionDisplay(holidayWithoutName, 'ko').label, 'KRX 휴장');
});

/* ------------------------------------------------------------ MARKET page */

async function marketPage(lang, env, now) {
  const target = { innerHTML: '', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const window = {};
  const requests = [];
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
    location: { hostname: 'snowshagal.com', search: '', pathname: lang === 'en' ? '/en/market/' : '/market/' },
    history: { replaceState() {}, pushState() {} },
    fetch: url => {
      requests.push(String(url));
      const request = new Request(new URL(String(url), 'https://snowshagal.com'));
      if (request.url.includes('/api/market/latest')) return latestGet({ request, env, now: now() });
      if (request.url.includes('/api/market/date')) return dateGet({ request, env });
      if (request.url.includes('/api/market/range')) return rangeGet({ request, env });
      return Promise.resolve(new Response('{}', { status: 404 }));
    },
    URLSearchParams, Headers, Intl, Date, Set, Map, console
  });
  vm.runInContext(LOCALE_JS, context);
  vm.runInContext(MARKET_JS, context);
  return { runtime: window.MARKET_CLOSE, target, requests };
}

const sessionBlock = html => (/<div class="market-session"[\s\S]*?<\/div>/.exec(html) || [''])[0];

test('MARKET TODAY on 09-24/09-25/weekend: one quiet closed line, no stale notice (KO/EN)', async () => {
  const env = { COMMENTS_DB: await database(['2026-09-22', '2026-09-23']) };
  const expected = {
    '2026-09-24': { ko: 'KRX 휴장 · 추석 전날', en: 'KRX CLOSED · CHUSEOK EVE' },
    '2026-09-25': { ko: 'KRX 휴장 · 추석', en: 'KRX CLOSED · CHUSEOK DAY' },
    '2026-09-26': { ko: 'KRX 휴장 · 주말', en: 'KRX CLOSED · WEEKEND' },
    '2026-09-27': { ko: 'KRX 휴장 · 주말', en: 'KRX CLOSED · WEEKEND' }
  };
  for (const [day, labels] of Object.entries(expected)) {
    for (const lang of ['ko', 'en']) {
      const { runtime, target } = await marketPage(lang, env, () => kst(day));
      await runtime.loadAndRender('today');
      const block = sessionBlock(target.innerHTML);
      assert.match(block, new RegExp(`market-session-badge">${labels[lang]}<`), `${day} ${lang}`);
      assert.match(block, lang === 'en'
        ? /The KRX is closed today\. Korean indices and investor flows reflect the Sep 23 last trading session\./
        : /오늘은 KRX 휴장일입니다\. 국내 지수와 수급은 9월 23일 마지막 거래일 기준입니다\./);
      assert.doesNotMatch(target.innerHTML, /market-availability/);
      assert.doesNotMatch(block, /warning|error|⚠/i);
    }
  }
});

test('MARKET TODAY on trading days has no closed line (09-23, 09-28)', async () => {
  const env = { COMMENTS_DB: await database(['2026-09-22', '2026-09-23']) };
  for (const now of [kst('2026-09-23', '18:00'), kst('2026-09-28', '10:00')]) {
    for (const lang of ['ko', 'en']) {
      const { runtime, target } = await marketPage(lang, env, () => now);
      await runtime.loadAndRender('today');
      assert.doesNotMatch(target.innerHTML, /market-session/);
      assert.doesNotMatch(target.innerHTML, /market-availability/);
    }
  }
});

test('MARKET holiday + stale: the closed line and the stale notice both appear; the closed line claims no data date', async () => {
  const env = { COMMENTS_DB: await database(['2026-09-21']) };
  for (const lang of ['ko', 'en']) {
    const { runtime, target } = await marketPage(lang, env, () => kst('2026-09-24'));
    await runtime.loadAndRender('today');
    const block = sessionBlock(target.innerHTML);
    assert.match(block, lang === 'en' ? /KRX CLOSED · CHUSEOK EVE/ : /KRX 휴장 · 추석 전날/);
    assert.doesNotMatch(block, /9월 23일|Sep 23/);
    assert.match(target.innerHTML, /class="market-availability"/);
    assert.match(target.innerHTML, lang === 'en' ? /LAST VERIFIED CLOSE · SEP 21/ : /마지막 검증 완료 · 9월 21일/);
  }
});

test('outage and integrity notices are unchanged and carry no closed line on trading days', async () => {
  const env = { COMMENTS_DB: await database(['2026-09-14', '2026-09-17', '2026-09-21']) };
  // 09-22 outage: expected 09-22 on a trading day, latest 09-21.
  const outage = await marketPage('ko', env, () => kst('2026-09-22', '18:00'));
  await outage.runtime.loadAndRender('today');
  assert.match(outage.target.innerHTML, /9월 22일 Market Close 안내/);
  assert.doesNotMatch(outage.target.innerHTML, /market-session/);
  // 09-18 validation notice: expected 09-18, latest 09-17.
  const envOld = { COMMENTS_DB: await database(['2026-09-14', '2026-09-17']) };
  const validation = await marketPage('en', envOld, () => kst('2026-09-18', '18:00'));
  await validation.runtime.loadAndRender('today');
  assert.match(validation.target.innerHTML, /Market Close Notice — Sep 18/);
  assert.doesNotMatch(validation.target.innerHTML, /market-session/);
  // 09-14 integrity note in HISTORY, opened on a holiday: no closed line.
  const history = await marketPage('ko', env, () => kst('2026-09-24'));
  await history.runtime.loadAndRender('today');
  assert.match(history.target.innerHTML, /market-session/);
  await history.runtime.loadAndRender('history', '2026-09-14');
  assert.match(history.target.innerHTML, /데이터 안내/);
  assert.doesNotMatch(history.target.innerHTML, /market-session/);
});

test('HISTORY, 1W and 1M never show the closed line', async () => {
  const env = { COMMENTS_DB: await database(['2026-09-16', '2026-09-17', '2026-09-21', '2026-09-22', '2026-09-23']) };
  for (const lang of ['ko', 'en']) {
    const { runtime, target } = await marketPage(lang, env, () => kst('2026-09-24'));
    await runtime.loadAndRender('today');
    assert.match(target.innerHTML, /market-session/);
    await runtime.loadAndRender('history', '2026-09-23');
    assert.doesNotMatch(target.innerHTML, /market-session/, `${lang} history of 09-23 opened on 09-24`);
    for (const mode of ['1w', '1m']) {
      await runtime.loadAndRender(mode);
      assert.doesNotMatch(target.innerHTML, /market-session/, `${lang} ${mode}`);
    }
  }
  assert.doesNotMatch(MARKET_JS.slice(MARKET_JS.indexOf('function renderRangeView')), /sessionNotice\(/);
});
