import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const fixture = JSON.parse(await read('contracts/market_close/market_close.example.json'));

const KO_TITLE = '데이터 안내';
const KO_BODY = [
  '2026년 9월 14일 Market Close는 당시 수집 방식의 한계로 일부 항목에 정규장 이후 거래가 포함되어 있습니다.',
  '정규장 기준 원천 스냅샷이 보존되지 않아 해당 값은 소급 수정하지 않았습니다.'
];
const EN_TITLE = 'Data Note';
const EN_BODY = [
  'Some fields in the Sep 14, 2026 Market Close include post-close trading because of the collection method used at the time.',
  'The original regular-session snapshots were not retained, so these historical values have not been retrospectively altered.'
];

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
    document: {
      documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} },
      readyState: 'loading', addEventListener() {}, getElementById() { return null; }
    },
    location: { hostname: 'localhost' }, Intl, Date, Set, console
  });
  vm.runInContext(localeScript, context);
  vm.runInContext(marketScript, context);
  return window.MARKET_CLOSE;
}

function renderDate(runtime, marketDate, { mode = 'history', latest = '2026-09-21' } = {}) {
  const payload = structuredClone(fixture);
  payload.meta.market_date = marketDate;
  Object.assign(runtime.state, {
    mode, latestDate: latest, currentDate: marketDate,
    expectedDate: latest, isLatest: marketDate === latest
  });
  const target = { innerHTML: '', addEventListener() {} };
  runtime.render(payload, target);
  return target.innerHTML;
}

test('the note exists for 2026-09-14 only, in both locales', async () => {
  const api = await localeApi();
  const ko = api.marketIntegrityNotice('2026-09-14', 'ko');
  assert.equal(ko.title, KO_TITLE);
  assert.deepEqual(Array.from(ko.body), KO_BODY);
  const en = api.marketIntegrityNotice('2026-09-14', 'en');
  assert.equal(en.title, EN_TITLE);
  assert.deepEqual(Array.from(en.body), EN_BODY);

  for (const date of ['2026-09-21', '2026-09-13', '2026-09-15', '2026-09-18', '', 'yesterday', null, undefined]) {
    for (const lang of ['ko', 'en']) {
      assert.equal(api.marketIntegrityNotice(date, lang), null, `${date} ${lang}`);
    }
  }
});

test('MARKET renders the note when 09-14 is on screen and nothing on other dates', async () => {
  const [ko, en] = await Promise.all([marketRuntime('ko'), marketRuntime('en')]);

  const koHtml = renderDate(ko, '2026-09-14');
  assert.match(koHtml, /<div class="market-integrity" role="note"><h2 class="market-transparency-title">데이터 안내<\/h2>/);
  for (const line of KO_BODY) assert.ok(koHtml.includes(`<p>${line}</p>`), line);

  const enHtml = renderDate(en, '2026-09-14');
  assert.match(enHtml, /<div class="market-integrity" role="note"><h2 class="market-transparency-title">Data Note<\/h2>/);
  for (const line of EN_BODY) assert.ok(enHtml.includes(`<p>${line}</p>`), line);

  // Every other session, and the latest one, stay exactly as they were.
  for (const runtime of [ko, en]) {
    for (const date of ['2026-09-21', '2026-09-15', '2026-09-11']) {
      const html = renderDate(runtime, date, { mode: date === '2026-09-21' ? 'today' : 'history' });
      assert.doesNotMatch(html, /market-integrity/, date);
      assert.doesNotMatch(html, /데이터 안내|Data Note/, date);
    }
  }
});

test('the note is presentation only: no stale, takeaway, payload or API change', async () => {
  const [locale, market, site, css] = await Promise.all([
    read('assets/locale.js'), read('assets/market-close.js'), read('assets/site.js'), read('assets/market-close.css')
  ]);
  // HOME never renders it; the strip keeps its own stale logic untouched.
  assert.doesNotMatch(site, /market-integrity|marketIntegrityNotice/);
  // The note is read from the date alone, never written into the payload.
  assert.doesNotMatch(market, /payload\.[a-zA-Z_]*integrity|meta\.integrity/);
  assert.match(css, /\.market-integrity\{/);
  // Stale judgement keeps its own copy and is not aware of the note.
  const api = await localeApi();
  const stale = api.marketCloseAvailability('2026-09-14', '2026-09-21', 'ko');
  assert.equal(stale.stale, true);
  assert.equal(stale.transparencyNotice, null);
  assert.equal(api.marketCloseAvailability('2026-09-21', '2026-09-21', 'ko').stale, false);
  assert.ok(locale.includes("'2026-09-14'"));

  // The published contract fixture is untouched by the note.
  const runtime = await marketRuntime('ko');
  const before = JSON.parse(JSON.stringify(fixture));
  renderDate(runtime, '2026-09-14');
  assert.equal(JSON.stringify(fixture), JSON.stringify(before));
});
