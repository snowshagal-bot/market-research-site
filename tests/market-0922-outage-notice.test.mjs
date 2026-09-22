import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const fixture = JSON.parse(await read('contracts/market_close/market_close.example.json'));

const KO_TITLE = '9월 22일 Market Close 안내';
const KO_BODY = [
  '정규장 데이터 수집 구간 중 시스템 중단으로 9월 22일 Market Close는 발행하지 않았습니다.',
  '확인되지 않은 값을 소급해 채우지 않으며, 마지막 검증 완료 데이터인 9월 21일 종가를 표시합니다.'
];
const EN_TITLE = 'Market Close Notice — Sep 22';
const EN_BODY = [
  'The Sep 22 Market Close was not published because the regular-session collection window was interrupted.',
  'Unverified values are not reconstructed retrospectively; Sep 21 remains the last verified close.'
];
const PENDING = /검증 미완료로 제공하지 않습니다|unavailable pending validation/;

async function localeApi() {
  const window = {};
  vm.runInContext(await read('assets/locale.js'), vm.createContext({ window }));
  return window.MARKET_LOCALE;
}

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

test('the Sep 22 outage card exists only for latest 2026-09-21 + expected 2026-09-22, in both locales', async () => {
  const api = await localeApi();
  const ko = api.marketCloseAvailability('2026-09-21', '2026-09-22', 'ko');
  assert.equal(ko.stale, true);
  assert.equal(ko.badge, '마지막 검증 완료 · 9월 21일');
  assert.equal(ko.transparencyNotice.title, KO_TITLE);
  assert.deepEqual(Array.from(ko.transparencyNotice.body), KO_BODY);
  // The settled outage replaces the generic "pending validation" sentence.
  assert.equal(ko.notice, '');

  const en = api.marketCloseAvailability('2026-09-21', '2026-09-22', 'en');
  assert.equal(en.badge, 'LAST VERIFIED CLOSE · SEP 21');
  assert.equal(en.transparencyNotice.title, EN_TITLE);
  assert.deepEqual(Array.from(en.transparencyNotice.body), EN_BODY);
  assert.equal(en.notice, '');

  // Any other combination keeps today's behaviour: no Sep 22 card, generic sentence intact.
  for (const [latest, expected] of [['2026-09-21', '2026-09-23'], ['2026-09-18', '2026-09-22'], ['2026-09-15', '2026-09-22'], ['2026-09-22', '2026-09-23']]) {
    for (const lang of ['ko', 'en']) {
      const other = api.marketCloseAvailability(latest, expected, lang);
      assert.equal(other.stale, true, `${latest}/${expected}`);
      assert.notEqual(other.transparencyNotice?.title, lang === 'ko' ? KO_TITLE : EN_TITLE, `${latest}/${expected} ${lang}`);
      assert.match(other.notice, PENDING, `${latest}/${expected} ${lang}`);
    }
  }
  // Once Sep 22 (or Sep 23) is published the expectation is met and nothing is shown.
  assert.equal(api.marketCloseAvailability('2026-09-22', '2026-09-22', 'ko').stale, false);
  assert.equal(api.marketCloseAvailability('2026-09-23', '2026-09-23', 'en').stale, false);
  // The Sep 18 notice is untouched and still carries its generic sentence.
  const sep18 = api.marketCloseAvailability('2026-09-17', '2026-09-18', 'ko');
  assert.equal(sep18.transparencyNotice.title, '9월 18일 Market Close 안내');
  assert.match(sep18.notice, PENDING);
});

test('MARKET KO/EN render the Sep 22 card instead of the pending sentence, and never mix in the Sep 14 note', async () => {
  const [ko, en] = await Promise.all([marketRuntime('ko'), marketRuntime('en')]);

  const koHtml = renderMarket(ko, { latest: '2026-09-21', expected: '2026-09-22' });
  assert.match(koHtml, /<div class="market-availability" role="status"><p class="market-availability-badge">마지막 검증 완료 · 9월 21일<\/p><div class="market-transparency-card"><h2 class="market-transparency-title">9월 22일 Market Close 안내<\/h2>/);
  for (const line of KO_BODY) assert.ok(koHtml.includes(`<p>${line}</p>`), line);
  assert.doesNotMatch(koHtml, /market-availability-note/);
  assert.doesNotMatch(koHtml, PENDING);
  assert.doesNotMatch(koHtml, /market-integrity|데이터 안내/);

  const enHtml = renderMarket(en, { latest: '2026-09-21', expected: '2026-09-22' });
  assert.match(enHtml, /<p class="market-availability-badge">LAST VERIFIED CLOSE · SEP 21<\/p><div class="market-transparency-card"><h2 class="market-transparency-title">Market Close Notice — Sep 22<\/h2>/);
  for (const line of EN_BODY) assert.ok(enHtml.includes(`<p>${line}</p>`), line);
  assert.doesNotMatch(enHtml, PENDING);
  assert.doesNotMatch(enHtml, /market-integrity|Data Note/);

  // Published Sep 22 (or later) → no availability block at all; the card is gone on its own.
  for (const runtime of [ko, en]) {
    assert.doesNotMatch(renderMarket(runtime, { latest: '2026-09-22', expected: '2026-09-22' }), /market-availability|market-transparency-card/);
    assert.doesNotMatch(renderMarket(runtime, { latest: '2026-09-23', expected: '2026-09-23' }), /market-availability|market-transparency-card/);
    // HISTORY view of 09-21 is not a statement about the missing 09-22.
    assert.doesNotMatch(renderMarket(runtime, { latest: '2026-09-21', expected: '2026-09-22', mode: 'history', currentDate: '2026-09-21' }), /market-availability/);
    // Other stale combinations keep the generic sentence exactly as before.
    const generic = renderMarket(runtime, { latest: '2026-09-21', expected: '2026-09-23' });
    assert.match(generic, /market-availability-note/);
    assert.match(generic, PENDING);
    assert.doesNotMatch(generic, /Sep 22|9월 22일 Market Close 안내/);
  }
  // The Sep 14 integrity note still renders on its own date and never alongside the outage card.
  const sep14 = renderMarket(ko, { latest: '2026-09-21', expected: '2026-09-22', mode: 'history', currentDate: '2026-09-14' });
  assert.match(sep14, /market-integrity/);
  assert.doesNotMatch(sep14, /9월 22일 Market Close 안내/);
});

test('HOME hides the empty generic sentence when the card replaces it, and is otherwise unchanged', async () => {
  const site = await read('assets/site.js');
  assert.match(site, /noticeEl\.hidden = !availability\.stale \|\| !availability\.notice;/);
  assert.match(site, /const tNotice = availability\.transparencyNotice;/);
  // Presentation only: no payload, schema, collector or API change rides along.
  for (const path of ['functions/api/market/latest.js', 'functions/api/market/publish.js', 'functions/_trading-calendar.js', 'contracts/market_close/market_close.schema.json']) {
    const text = await read(path);
    assert.doesNotMatch(text, /2026-09-22/);
  }
  const locale = await read('assets/locale.js');
  assert.equal((locale.match(/'2026-09-22'/g) || []).length, 1);
});
