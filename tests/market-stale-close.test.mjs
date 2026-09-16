import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { expectedLatestKrxTradingDate, expectedPublishedKrxTradingDate } from '../functions/_trading-calendar.js';
import { onRequestGet as latestRequest } from '../functions/api/market/latest.js';
import { onRequestGet as dateRequest } from '../functions/api/market/date.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const kst = stamp => new Date(`${stamp}:00+09:00`);
const fixture = JSON.parse(await read('contracts/market_close/market_close.example.json'));

/* The session a Market Close may already exist for, per the canonical calendar. */

test('expected published session follows publishEligible (16:05 KST) on the existing calendar', () => {
  // 1-2. A weekday before 16:05 still expects the previous session.
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-17T15:00')), '2026-09-16');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-17T16:04')), '2026-09-16');
  // 3-4. From 16:05 the same day is expected.
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-17T16:05')), '2026-09-17');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-17T23:59')), '2026-09-17');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-18T00:04')), '2026-09-17');
  // 5. Weekend and Monday morning expect Friday.
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-19T12:00')), '2026-09-18');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-20T18:00')), '2026-09-18');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-21T09:00')), '2026-09-18');
  // 6. Chuseok (09-24, 09-25) expects the session before the holiday.
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-24T17:00')), '2026-09-23');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-25T17:00')), '2026-09-23');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-09-28T10:00')), '2026-09-23');
  // The CSAT session keeps its own later boundary (17:05) from the same table.
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-11-19T16:10')), '2026-11-18');
  assert.equal(expectedPublishedKrxTradingDate(kst('2026-11-19T17:05')), '2026-11-19');
  // The monitoring boundary (16:30) is unchanged.
  assert.equal(expectedLatestKrxTradingDate(kst('2026-09-17T16:10')), '2026-09-16');
  assert.equal(expectedLatestKrxTradingDate(kst('2026-09-17T16:30')), '2026-09-17');
});

/* /api/market/latest carries the expectation next to an unchanged body. */

class MockDb {
  constructor(rows) { this.rows = rows; }
  prepare(sql) {
    const rows = this.rows;
    return {
      bind() { return this; },
      async run() { return { success: true }; },
      async first() { return /ORDER BY market_date DESC|WHERE market_date = \?/i.test(sql) ? rows.at(-1) || null : null; }
    };
  }
}

function storedRow(marketDate) {
  const payload = structuredClone(fixture);
  payload.meta.market_date = marketDate;
  return {
    market_date: marketDate,
    generated_at: '2026-09-15T16:10:00+09:00',
    published_at: '2026-09-15T18:25:49+09:00',
    payload_json: JSON.stringify(payload),
    takeaway_ko: '',
    takeaway_en: ''
  };
}

test('/api/market/latest sends x-market-expected-date without changing the payload', async () => {
  const row = storedRow('2026-09-15');
  const env = { COMMENTS_DB: new MockDb([row]) };
  const response = await latestRequest({ request: new Request('https://snowshagal.com/api/market/latest'), env, now: kst('2026-09-17T00:04') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-market-expected-date'), '2026-09-16');
  const body = await response.json();
  assert.deepEqual(body, { ...JSON.parse(row.payload_json), takeaway: { ko: '', en: '' } });

  const before = await latestRequest({ request: new Request('https://snowshagal.com/api/market/latest'), env, now: kst('2026-09-16T16:04') });
  assert.equal(before.headers.get('x-market-expected-date'), '2026-09-15');

  // A revalidation carries the expectation of its own moment too.
  const etag = response.headers.get('etag');
  const revalidated = await latestRequest({ request: new Request('https://snowshagal.com/api/market/latest', { headers: { 'if-none-match': etag } }), env, now: kst('2026-09-17T16:05') });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get('x-market-expected-date'), '2026-09-17');

  // A year outside the configured KRX calendar sends no expectation at all.
  const unsupported = await latestRequest({ request: new Request('https://snowshagal.com/api/market/latest'), env, now: kst('2027-01-05T17:00') });
  assert.equal(unsupported.status, 200);
  assert.equal(unsupported.headers.get('x-market-expected-date'), null);

  // Historical reads are not "today" and carry no expectation.
  const history = await dateRequest({ request: new Request('https://snowshagal.com/api/market/date?date=2026-09-15'), env });
  assert.equal(history.headers.get('x-market-expected-date'), null);
});

/* Shared judgement and copy (assets/locale.js). */

async function localeApi() {
  const window = {};
  vm.runInContext(await read('assets/locale.js'), vm.createContext({ window }));
  return window.MARKET_LOCALE;
}

test('availability is stale only when the latest close is older than the expected session', async () => {
  const api = await localeApi();
  const at = (stamp, latest, language = 'ko') => api.marketCloseAvailability(latest, expectedPublishedKrxTradingDate(kst(stamp)), language);

  assert.equal(at('2026-09-17T15:00', '2026-09-16').stale, false, '1. weekday 15:00');
  assert.equal(at('2026-09-17T16:04', '2026-09-16').stale, false, '2. weekday 16:04');
  assert.equal(at('2026-09-17T16:05', '2026-09-16').stale, true, '3. weekday 16:05');
  assert.equal(at('2026-09-17T16:05', '2026-09-17').stale, false, '4. latest is today');
  assert.equal(at('2026-09-19T11:00', '2026-09-18').stale, false, '5. Saturday with Friday');
  assert.equal(at('2026-09-20T20:00', '2026-09-18').stale, false, '5. Sunday with Friday');
  assert.equal(at('2026-09-24T17:00', '2026-09-23').stale, false, '6. holiday with the session before it');
  assert.equal(at('2026-09-28T09:30', '2026-09-23').stale, false, '6. Monday morning after the holidays');

  // The Sep 16 case exactly as specified.
  const ko = at('2026-09-17T00:04', '2026-09-15', 'ko');
  assert.equal(ko.badge, '마지막 검증 완료 · 9월 15일');
  assert.equal(ko.notice, '9월 16일 Market Close 데이터셋은 검증 미완료로 제공하지 않습니다.');
  const en = at('2026-09-17T00:04', '2026-09-15', 'en');
  assert.equal(en.badge, 'LAST VERIFIED CLOSE · SEP 15');
  assert.equal(en.notice, 'The Sep 16 Market Close dataset is unavailable pending validation.');

  // 7. Several missing sessions: the notice names the expected session, not the day after latest.
  const gap = at('2026-09-18T16:10', '2026-09-15', 'en');
  assert.equal(gap.expectedDate, '2026-09-18');
  assert.equal(gap.badge, 'LAST VERIFIED CLOSE · SEP 15');
  assert.equal(gap.notice, 'The Sep 18 Market Close dataset is unavailable pending validation.');
  const gapAcrossHoliday = at('2026-09-28T16:05', '2026-09-22', 'ko');
  assert.equal(gapAcrossHoliday.badge, '마지막 검증 완료 · 9월 22일');
  assert.equal(gapAcrossHoliday.notice, '9월 28일 Market Close 데이터셋은 검증 미완료로 제공하지 않습니다.');

  // Single-digit days: the English badge matches the strip's SEP 09 label.
  const singleDigit = api.marketCloseAvailability('2026-09-09', '2026-10-02', 'en');
  assert.equal(singleDigit.badge, 'LAST VERIFIED CLOSE · SEP 09');
  assert.equal(singleDigit.notice, 'The Oct 2 Market Close dataset is unavailable pending validation.');
  assert.equal(api.marketCloseAvailability('2026-09-09', '2026-10-02', 'ko').badge, '마지막 검증 완료 · 9월 9일');

  // Without a usable expectation nothing is judged stale.
  assert.equal(api.marketCloseAvailability('2026-09-15', '', 'ko').stale, false);
  assert.equal(api.marketCloseAvailability('2026-09-15', 'soon', 'en').stale, false);
});

test('the browser keeps no calendar or clock of its own for this judgement', async () => {
  const [locale, site, market] = await Promise.all([read('assets/locale.js'), read('assets/site.js'), read('assets/market-close.js')]);
  for (const source of [locale, site, market]) {
    assert.doesNotMatch(source, /Asia\/Seoul|publishEligible|isTradingDate|previousTradingDate|2026-09-16/);
  }
  assert.doesNotMatch(locale, /new Date\(/);
});

test('homepage markup ships the tag and a hidden notice node in KO and EN', async () => {
  for (const page of await Promise.all([read('index.html'), read('en/index.html')])) {
    assert.match(page, /<span class="today-strip-tag" id="today-strip-tag">TODAY<\/span>/);
    assert.match(page, /<p class="today-strip-notice" id="today-strip-notice" role="status" hidden><\/p>/);
  }
});

/* MARKET hero (assets/market-close.js) */

async function marketRuntime(lang) {
  const [localeScript, marketScript] = await Promise.all([read('assets/locale.js'), read('assets/market-close.js')]);
  const window = {};
  const context = vm.createContext({
    window,
    document: { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    location: { hostname: 'localhost' }, Intl, Date, Set, console
  });
  vm.runInContext(localeScript, context);
  vm.runInContext(marketScript, context);
  return window.MARKET_CLOSE;
}

function renderMarket(runtime, { latest, expected, mode = 'today', currentDate = latest }) {
  const payload = structuredClone(fixture);
  payload.meta.market_date = currentDate;
  Object.assign(runtime.state, { mode, latestDate: latest, currentDate, expectedDate: expected, isLatest: currentDate === latest });
  const target = { innerHTML: '', addEventListener() {} };
  runtime.render(payload, target);
  return target.innerHTML;
}

test('MARKET KO/EN show the availability notice only on a stale TODAY view', async () => {
  const [ko, en] = await Promise.all([marketRuntime('ko'), marketRuntime('en')]);

  for (const runtime of [ko, en]) {
    const current = renderMarket(runtime, { latest: '2026-09-17', expected: '2026-09-17' });
    assert.doesNotMatch(current, /market-availability/);
    const noHeader = renderMarket(runtime, { latest: '2026-09-15', expected: null });
    assert.doesNotMatch(noHeader, /market-availability/);
    // A past date opened from HISTORY is not a statement about today.
    const history = renderMarket(runtime, { latest: '2026-09-15', expected: '2026-09-16', mode: 'history', currentDate: '2026-09-14' });
    assert.doesNotMatch(history, /market-availability/);
  }

  const koHtml = renderMarket(ko, { latest: '2026-09-15', expected: '2026-09-16' });
  assert.match(koHtml, /<p class="market-date">2026\.09\.15 · 15:30 KST 마감 기준<\/p>\s*<div class="market-availability" role="status"><p class="market-availability-badge">마지막 검증 완료 · 9월 15일<\/p><p class="market-availability-note">9월 16일 Market Close 데이터셋은 검증 미완료로 제공하지 않습니다\.<\/p><\/div>/);

  const enHtml = renderMarket(en, { latest: '2026-09-15', expected: '2026-09-18' });
  assert.match(enHtml, /<p class="market-availability-badge">LAST VERIFIED CLOSE · SEP 15<\/p><p class="market-availability-note">The Sep 18 Market Close dataset is unavailable pending validation\.<\/p>/);
});
