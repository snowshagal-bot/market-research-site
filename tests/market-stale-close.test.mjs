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
  assert.ok(gap.transparencyNotice);
  assert.equal(gap.transparencyNotice.title, 'Market Close Notice — Sep 18');
  assert.equal(gap.transparencyNotice.body.length, 3);

  const koSep18 = at('2026-09-18T16:10', '2026-09-17', 'ko');
  assert.ok(koSep18.transparencyNotice);
  assert.equal(koSep18.transparencyNotice.title, '9월 18일 Market Close 안내');
  assert.equal(koSep18.transparencyNotice.body.length, 3);
  assert.equal(koSep18.transparencyNotice.body[0], '데이터 제공원 변경으로 인해 9월 18일 정규장 마감 데이터의 검증을 완료하지 못했습니다.');
  assert.equal(koSep18.transparencyNotice.body[1], '검증되지 않은 값을 임의로 보완하지 않기 위해 해당 일자의 Market Close는 제공하지 않습니다.');
  assert.equal(koSep18.transparencyNotice.body[2], '새로운 검증 절차를 적용 중이며 다음 거래일부터 정상 제공을 목표로 하고 있습니다.');

  const koSep21 = at('2026-09-21T16:10', '2026-09-17', 'ko');
  assert.equal(koSep21.transparencyNotice, null);

  const gapAcrossHoliday = at('2026-09-28T16:05', '2026-09-22', 'ko');
  assert.equal(gapAcrossHoliday.badge, '마지막 검증 완료 · 9월 22일');
  assert.equal(gapAcrossHoliday.notice, '9월 28일 Market Close 데이터셋은 검증 미완료로 제공하지 않습니다.');
  assert.equal(gapAcrossHoliday.transparencyNotice, null);

  // Single-digit days: the English badge matches the strip's SEP 09 label.
  const singleDigit = api.marketCloseAvailability('2026-09-09', '2026-10-02', 'en');
  assert.equal(singleDigit.badge, 'LAST VERIFIED CLOSE · SEP 09');
  assert.equal(singleDigit.notice, 'The Oct 2 Market Close dataset is unavailable pending validation.');
  assert.equal(api.marketCloseAvailability('2026-09-09', '2026-10-02', 'ko').badge, '마지막 검증 완료 · 9월 9일');

  // Without a usable expectation nothing is judged stale.
  assert.equal(api.marketCloseAvailability('2026-09-15', '', 'ko').stale, false);
  assert.equal(api.marketCloseAvailability('2026-09-15', 'soon', 'en').stale, false);
});

// The source of one named function, braces balanced, so a rule can be applied
// to the stale judgement without banning what the rest of the file needs (the
// #124 KST formatter in locale.js legitimately names Asia/Seoul and builds Dates).
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

test('the browser keeps no calendar or clock of its own for this judgement', async () => {
  const [locale, site, market] = await Promise.all([read('assets/locale.js'), read('assets/site.js'), read('assets/market-close.js')]);
  const judgement = [
    functionSource(locale, 'marketCloseAvailability'),
    functionSource(site, 'todayStripSession'),
    functionSource(site, 'paintTodayStrip'),
    functionSource(site, 'fetchPublishedMarketClose'),
    functionSource(market, 'availabilityNotice')
  ];
  for (const source of judgement) {
    // No calendar, no clock, no hard-coded session in the browser: the expected
    // date only ever arrives from the server's trading calendar.
    assert.doesNotMatch(source, /Asia\/Seoul|publishEligible|isTradingDate|previousTradingDate|new Date\(|Date\.now|getHours|getDay|\b20\d{2}-\d{2}-\d{2}\b/);
    // generated_at is the collector's refresh stamp (#124), never the market date.
    assert.doesNotMatch(source, /generated_?at|generatedAt/i);
  }
  // The KST timestamp line (#124) and the availability notice are separate outputs.
  assert.match(market, /generatedAtText\(data\.meta\?\.generated_at\)/);
  assert.match(market, /availabilityNotice\(marketDate, isHistory\)/);
});

/* 9. Recovery needs no manual step: the next response with the expected session
   returns the page to TODAY, through the real API handler and the real page code. */

async function marketPage(lang, respond) {
  const [localeScript, marketScript] = await Promise.all([read('assets/locale.js'), read('assets/market-close.js')]);
  const target = { innerHTML: '', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const window = {};
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
    fetch: url => respond(String(url)),
    URLSearchParams, Headers, Intl, Date, Set, Map, console
  });
  vm.runInContext(localeScript, context);
  vm.runInContext(marketScript, context);
  return { runtime: window.MARKET_CLOSE, target };
}

test('9. a newly published close returns MARKET KO/EN to TODAY on the next load with no manual step', async () => {
  const rows = [storedRow('2026-09-15')];
  const env = { COMMENTS_DB: new MockDb(rows) };
  let now = kst('2026-09-16T16:05');
  // Market data is only ever read through the real /api/market/latest handler.
  const respond = url => {
    assert.equal(url, '/api/market/latest');
    return latestRequest({ request: new Request(`https://snowshagal.com${url}`), env, now });
  };

  for (const [lang, stalePattern, staleNote] of [
    ['ko', /마지막 검증 완료 · 9월 15일/, /9월 16일 Market Close 데이터셋은 검증 미완료로 제공하지 않습니다\./],
    ['en', /LAST VERIFIED CLOSE · SEP 15/, /The Sep 16 Market Close dataset is unavailable pending validation\./]
  ]) {
    rows.splice(0, rows.length, storedRow('2026-09-15'));
    now = kst('2026-09-16T16:05');
    const { runtime, target } = await marketPage(lang, respond);

    await runtime.loadAndRender('today');
    assert.match(target.innerHTML, /class="market-availability"/, `${lang} stale at 16:05 with 09-15`);
    assert.match(target.innerHTML, stalePattern);
    assert.match(target.innerHTML, staleNote);

    // The collector publishes 09-16; nothing else changes.
    rows.push(storedRow('2026-09-16'));
    now = kst('2026-09-16T16:20');
    await runtime.loadAndRender('today');
    assert.doesNotMatch(target.innerHTML, /market-availability/, `${lang} back to TODAY`);
    assert.equal(runtime.state.expectedDate, '2026-09-16');
    assert.equal(runtime.state.currentDate, '2026-09-16');
  }
});

test('homepage markup ships the tag and a hidden notice node in KO and EN', async () => {
  for (const page of await Promise.all([read('index.html'), read('en/index.html')])) {
    assert.match(page, /<span class="today-strip-tag" id="today-strip-tag">TODAY<\/span>/);
    assert.match(page, /<p class="today-strip-notice" id="today-strip-notice" role="status" hidden><\/p>/);
    assert.match(page, /<div class="today-strip-transparency" id="today-strip-transparency" role="region"/);
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
  assert.doesNotMatch(koHtml, /market-transparency-card/);

  const enHtml = renderMarket(en, { latest: '2026-09-15', expected: '2026-09-18' });
  assert.match(enHtml, /<p class="market-availability-badge">LAST VERIFIED CLOSE · SEP 15<\/p><p class="market-availability-note">The Sep 18 Market Close dataset is unavailable pending validation\.<\/p>/);
  assert.match(enHtml, /<div class="market-transparency-card"><h2 class="market-transparency-title">Market Close Notice — Sep 18<\/h2>/);
  assert.match(enHtml, /Due to a change in one of our market data sources, we could not complete verification of the Sep 18 regular-session close\./);

  const koSep18Html = renderMarket(ko, { latest: '2026-09-17', expected: '2026-09-18' });
  assert.match(koSep18Html, /<div class="market-transparency-card"><h2 class="market-transparency-title">9월 18일 Market Close 안내<\/h2>/);
  assert.match(koSep18Html, /데이터 제공원 변경으로 인해 9월 18일 정규장 마감 데이터의 검증을 완료하지 못했습니다\./);
});
