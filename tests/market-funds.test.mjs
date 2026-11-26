// Market Funds: KOFIA FreeSIS investor deposits, margin loans, unpaid margin
// and forced selling of each KRX trading day, published a business day later.
// Their own dataset (contracts/market_funds/), stored apart from Market Close
// and joined to the session by date. Covered here:
// - the receiver and read API, on an in-memory SQLite standing in for D1 with
//   the checked-in migration;
// - the card on the session page and on TODAY;
// - the three history pages and the sitemap.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import {
  MARKET_FUND_CODES,
  MARKET_FUND_PAGE_CODES,
  MARKET_FUNDS_TABLE,
  loadMarketFundCodes,
  marketFundCodesIn,
  planMarketFundsWrites,
  validateMarketFundsDocument
} from '../functions/api/market/funds/_shared.js';
import { onRequestPost as publish } from '../functions/api/market/funds/publish.js';
import { onRequestGet as getDate } from '../functions/api/market/funds/date.js';
import {
  MARKET_INDICATORS,
  availableIndicatorCodes,
  marketArchivePageHtml,
  marketDatePageHtml,
  marketFundSeries,
  marketIndicatorPageHtml,
  marketIndicatorTitle,
  onMarketPageRequest,
  parseMarketPagePath
} from '../functions/_market-date-page.js';
import { OPTIONAL_INDICATOR_CLOSES_SQL } from '../functions/_market-indicators.js';
import { sitemapXml } from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const POSTS = JSON.parse(await readFile(new URL('../data/posts.json', import.meta.url), 'utf8'));
const [MIGRATION, SCHEMA_SQL, SCHEMA_JSON, EXAMPLE, CONTRACT_MD, SHELL_KO, SHELL_EN, MC_EXAMPLE, LOCALE_JS, MARKET_JS] = await Promise.all([
  read('migrations/comments/0006_market_funds.sql'), read('db/schema.sql'),
  read('contracts/market_funds/market_funds.schema.json'), read('contracts/market_funds/market_funds.example.json'),
  read('contracts/market_funds/MARKET_FUNDS_CONTRACT.md'),
  read('market/index.html'), read('en/market/index.html'),
  read('contracts/market_close/market_close.example.json'),
  read('assets/locale.js'), read('assets/market-close.js')
]);
const SHELLS = { ko: SHELL_KO, en: SHELL_EN };

const KEY = 'test-publish-key';
const PROD = 'https://snowshagal.com';
// Wednesday 2026-11-25, 12:00 KST.
const NOW = new Date('2026-11-25T03:00:00Z');

// KOFIA's own figures for 2026-11-24 and 2026-11-23 (KRW million; ratio in percent).
const FIGURES = {
  '2026-11-24': { previous: '2026-11-23', DEPOSITS: [82049700, 85336163], CREDIT: [25877746, 25942655], CREDIT_KOSPI: [20020227, 20055285], CREDIT_KOSDAQ: [5857519, 5887370], UNPAID: [966031, 876053], FORCED_SALE: [13675, 11147], FORCED_SALE_RATIO: [1.6, 1.2] },
  '2026-11-23': { previous: '2026-11-20', DEPOSITS: [85336163, 82984549], CREDIT: [25942655, 25957908], CREDIT_KOSPI: [20055285, 20095547], CREDIT_KOSDAQ: [5887370, 5862361], UNPAID: [876053, 901495], FORCED_SALE: [11147, 5307], FORCED_SALE_RATIO: [1.2, 0.5] }
};

function items(date = '2026-11-24', overrides = {}) {
  const figures = FIGURES[date] || FIGURES['2026-11-24'];
  return MARKET_FUND_CODES.map(code => ({ code, value: figures[code][0], previous_value: figures[code][1], ...(overrides[code] || {}) }));
}

function day(date, overrides = {}) {
  const next = { '2026-11-23': '2026-11-24', '2026-11-24': '2026-11-25' }[date] || '2026-11-25';
  return {
    market_date: date,
    previous_date: FIGURES[date]?.previous || '2026-11-23',
    retrieved_at: `${next}T08:31:04+09:00`,
    source: '금융투자협회 증시자금 추이',
    items: items(date),
    ...overrides
  };
}

function doc(days, overrides = {}) {
  return { schema_version: '1.0.0', generated_at: '2026-11-25T08:31:05+09:00', days, ...overrides };
}

const errorsOf = document => validateMarketFundsDocument(document, NOW.getTime()).errors.join('\n');

function database({ migrated = true } = {}) {
  const db = new SqliteD1();
  if (migrated) db.exec(MIGRATION);
  return db;
}

async function post(db, body, { origin = PROD, key = KEY, now = NOW, raw } = {}) {
  const request = new Request(`${origin}/api/market/funds/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-market-publish-key': key } : {}) },
    body: raw ?? JSON.stringify(body)
  });
  const response = await publish({ request, env: { COMMENTS_DB: db, MARKET_PUBLISH_KEY: KEY }, now });
  return { status: response.status, body: await response.json() };
}

async function get(db, date) {
  const response = await getDate({ request: new Request(`${PROD}/api/market/funds/date?date=${date}`), env: { COMMENTS_DB: db } });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

/* ------------------------------------------------------------ contract */

test('seven instruments; the schema enums, limits, example and contract agree with the allowlist', () => {
  assert.deepEqual([...MARKET_FUND_CODES], ['DEPOSITS', 'CREDIT', 'CREDIT_KOSPI', 'CREDIT_KOSDAQ', 'UNPAID', 'FORCED_SALE', 'FORCED_SALE_RATIO']);
  const schema = JSON.parse(SCHEMA_JSON);
  const [amounts, ratio] = schema.$defs.item.oneOf;
  assert.deepEqual([...amounts.properties.code.enum, ratio.properties.code.const].sort(), [...MARKET_FUND_CODES].sort());
  assert.equal(schema.$defs.day.properties.items.maxItems, MARKET_FUND_CODES.length);
  assert.equal(schema.properties.days.maxItems, 60);
  for (const code of MARKET_FUND_CODES) assert.match(CONTRACT_MD, new RegExp(`\`${code}\``));
  assert.deepEqual(validateMarketFundsDocument(JSON.parse(EXAMPLE), NOW.getTime()).errors, []);
  // Three of them have a history page, under the contract's addresses.
  assert.deepEqual(MARKET_INDICATORS.filter(item => item.funds).map(item => [item.code, item.slug]), [['DEPOSITS', 'deposits'], ['CREDIT', 'margin-loans'], ['FORCED_SALE', 'forced-selling']]);
  assert.deepEqual(MARKET_INDICATORS.filter(item => item.funds).map(item => item.code), [...MARKET_FUND_PAGE_CODES]);
  for (const item of MARKET_INDICATORS.filter(entry => entry.funds)) assert.match(CONTRACT_MD, new RegExp(`/market/${item.slug}/`));
  assert.equal(parseMarketPagePath('/market/margin-loans/').indicator.code, 'CREDIT');
  // The card in assets/locale.js links with the same slugs.
  const context = vm.createContext({ window: {}, document: undefined, Intl });
  vm.runInContext(LOCALE_JS, context);
  assert.deepEqual({ ...context.window.MARKET_LOCALE.MARKET_FUND_PAGES }, Object.fromEntries(MARKET_INDICATORS.filter(item => item.funds).map(item => [item.code, item.slug])));
  // They are not in the Market Close payload: the optional-closes column never reads them.
  assert.doesNotMatch(OPTIONAL_INDICATOR_CLOSES_SQL, /DEPOSITS|CREDIT|FORCED|market_funds/);
});

test('the migration and db/schema.sql define the same table', () => {
  const create = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE'));
  assert.ok(SCHEMA_SQL.includes(create.trim()), 'db/schema.sql carries the same table definition');
  assert.match(create, new RegExp(`CREATE TABLE IF NOT EXISTS ${MARKET_FUNDS_TABLE} \\(\\s*market_date TEXT PRIMARY KEY`));
});

test('structure: days and items counted, each once, no unknown code or field', () => {
  assert.equal(validateMarketFundsDocument(doc([day('2026-11-24')]), NOW.getTime()).passed, true);
  assert.equal(validateMarketFundsDocument(doc([day('2026-11-24', { items: items().slice(0, 1) })]), NOW.getTime()).passed, true);
  assert.match(errorsOf(doc([])), /1 to 60 days/);
  assert.match(errorsOf(doc([day('2026-11-24'), day('2026-11-24')])), /appears more than once/);
  assert.match(errorsOf(doc([day('2026-11-24', { items: [] })])), /1 to 7 items/);
  assert.match(errorsOf(doc([day('2026-11-24', { items: [items()[0], items()[0]] })])), /DEPOSITS appears more than once/);
  assert.match(errorsOf(doc([day('2026-11-24', { items: [{ ...items()[0], code: 'RP' }] })])), /not a Market Funds instrument/);
  assert.match(errorsOf(doc([day('2026-11-24', { items: [{ ...items()[0], extra: 1 }] })])), /extra: unknown field/);
  assert.match(errorsOf(doc([{ ...day('2026-11-24'), extra: 1 }])), /\$\.days\[0\]\.extra: unknown field/);
  assert.match(errorsOf(doc([day('2026-11-24')], { schema_version: '1.1.0' })), /schema_version/);
  assert.match(errorsOf(doc([day('2026-11-24', { source: '' })])), /source/);
});

test('numbers: whole KRW millions, a percent ratio, and KOFIA’s own arithmetic', () => {
  assert.match(errorsOf(doc([day('2026-11-24', { items: items('2026-11-24', { DEPOSITS: { value: 82049700.5 } }) })])), /DEPOSITS|whole KRW millions/);
  assert.match(errorsOf(doc([day('2026-11-24', { items: items('2026-11-24', { UNPAID: { value: -1 } }) })])), /whole KRW millions/);
  assert.match(errorsOf(doc([day('2026-11-24', { items: items('2026-11-24', { FORCED_SALE_RATIO: { value: 101 } }) })])), /percent from 0 to 100/);
  // KOFIA rounds the total and its two markets separately (up to 1 apart in 2026): 2 is accepted, 3 is not.
  assert.equal(validateMarketFundsDocument(doc([day('2026-11-24', { items: items('2026-11-24', { CREDIT: { value: 25877748 } }) })]), NOW.getTime()).passed, true);
  assert.match(errorsOf(doc([day('2026-11-24', { items: items('2026-11-24', { CREDIT: { value: 25877749 } }) })])), /CREDIT\.value 25877749 is not CREDIT_KOSPI \+ CREDIT_KOSDAQ/);
  assert.match(errorsOf(doc([day('2026-11-24', { items: items('2026-11-24', { CREDIT_KOSDAQ: { previous_value: 5800000 } }) })])), /CREDIT\.previous_value/);
  // 13,675 ÷ the previous day's 876,053 = 1.56% → 1.6; against the same day's 966,031 it would be 1.4.
  assert.match(errorsOf(doc([day('2026-11-24', { items: items('2026-11-24', { FORCED_SALE_RATIO: { value: 1.4 } }) })])), /FORCED_SALE_RATIO 1\.4 contradicts/);
  // Without UNPAID the ratio is not checked; a zero previous UNPAID skips it too.
  assert.equal(validateMarketFundsDocument(doc([day('2026-11-24', { items: items().filter(item => item.code !== 'UNPAID').map(item => (item.code === 'FORCED_SALE_RATIO' ? { ...item, value: 9 } : item)) })]), NOW.getTime()).passed, true);
  assert.equal(validateMarketFundsDocument(doc([day('2026-11-24', { items: items('2026-11-24', { UNPAID: { previous_value: 0 }, FORCED_SALE_RATIO: { value: 0 } }) })]), NOW.getTime()).passed, true);
});

test('dates: a KRX trading day, its previous trading day, read after that session closed', () => {
  assert.match(errorsOf(doc([day('2026-11-22')])), /2026-11-22 is not a KRX trading date/);
  assert.match(errorsOf(doc([day('2026-11-26')])), /after today/);
  assert.match(errorsOf(doc([day('2026-02-30')])), /YYYY-MM-DD/);
  assert.match(validateMarketFundsDocument(doc([day('2028-01-04', { previous_date: '2027-12-30', retrieved_at: '2028-01-05T08:00:00+09:00' })], { generated_at: '2028-01-05T08:00:00+09:00' }), Date.parse('2028-01-05T09:00:00Z')).errors.join('\n'), /does not cover 2028/);
  assert.match(errorsOf(doc([day('2026-11-24', { previous_date: '2026-11-24' })])), /previous_date: must be 1 to 14 days before/);
  assert.match(errorsOf(doc([day('2026-11-24', { previous_date: '2026-11-01' })])), /previous_date: must be 1 to 14 days before/);
  assert.match(errorsOf(doc([day('2026-11-24', { previous_date: '2026-11-22' })])), /previous_date: 2026-11-22 is a weekend/);
  // KOFIA posts the KRX year-end closure (12-31): it is the previous row of the year's first session,
  // in a year the calendar does not cover (2025) and in one it does (2026-12-31 before 2027-01-04).
  assert.equal(validateMarketFundsDocument(doc([day('2026-01-02', { previous_date: '2025-12-31', retrieved_at: '2026-01-05T08:30:00+09:00' })]), NOW.getTime()).passed, true);
  assert.match(errorsOf(doc([day('2026-01-02', { previous_date: '2025-12-27', retrieved_at: '2026-01-05T08:30:00+09:00' })])), /previous_date: 2025-12-27 is a weekend/);
  const january = Date.parse('2027-01-05T03:00:00Z');
  assert.deepEqual(validateMarketFundsDocument(doc([day('2027-01-04', { previous_date: '2026-12-31', retrieved_at: '2027-01-05T08:30:00+09:00' })], { generated_at: '2027-01-05T08:30:00+09:00' }), january).errors, []);
  // The balances exist only once the session has closed: 15:30 KST.
  assert.match(errorsOf(doc([day('2026-11-24', { retrieved_at: '2026-11-24T15:29:59+09:00' })])), /before 2026-11-24 15:30 KST/);
  assert.equal(validateMarketFundsDocument(doc([day('2026-11-24', { retrieved_at: '2026-11-24T19:00:00+09:00' })]), NOW.getTime()).passed, true);
  assert.match(errorsOf(doc([day('2026-11-24', { retrieved_at: '2026-11-25T12:10:00+09:00' })])), /retrieved_at: in the future/);
  assert.match(errorsOf(doc([day('2026-11-24')], { generated_at: '2026-11-26T00:00:00+09:00' })), /generated_at: in the future/);
});

test('write plan: new days created, the same figures unchanged, different figures only when read later', () => {
  const entry = (date, retrievedAt, overrides = {}) => ({ day: day(date, { items: items(date, overrides) }), retrievedAt });
  const stored = [{ market_date: '2026-11-24', retrieved_at: '2026-11-24T23:31:04.000Z', payload_json: JSON.stringify(day('2026-11-24')) }];
  const plan = planMarketFundsWrites([entry('2026-11-23', '2026-11-23T23:31:04.000Z'), entry('2026-11-24', '2026-11-25T01:00:00.000Z')], stored);
  assert.deepEqual([plan.created, plan.unchanged, plan.updated], [['2026-11-23'], ['2026-11-24'], []]);
  const revised = planMarketFundsWrites([entry('2026-11-24', '2026-11-25T01:00:00.000Z', { DEPOSITS: { value: 82049800 } })], stored);
  assert.deepEqual(revised.updated, ['2026-11-24']);
  const older = planMarketFundsWrites([entry('2026-11-24', '2026-11-24T22:00:00.000Z', { DEPOSITS: { value: 82049800 } })], stored);
  assert.deepEqual(older.skipped_older, ['2026-11-24']);
});

/* ------------------------------------------------------------ API */

test('publish: credentials and host first; nothing is written before the migration or for an invalid document', async () => {
  const db = database();
  assert.equal((await post(db, doc([day('2026-11-24')]), { key: '' })).status, 401);
  assert.equal((await post(db, doc([day('2026-11-24')]), { key: 'wrong' })).status, 401);
  assert.equal((await post(db, doc([day('2026-11-24')]), { origin: 'https://market-research-site.pages.dev' })).status, 403);
  assert.equal((await post(db, null, { raw: '{' })).status, 400);
  assert.equal((await post(db, null, { raw: JSON.stringify(doc([day('2026-11-24')])) + ' '.repeat(70 * 1024) })).status, 413);
  const invalid = await post(db, doc([day('2026-11-24'), day('2026-11-22')]));
  assert.equal(invalid.status, 422);
  assert.match(invalid.body.details.join('\n'), /2026-11-22 is not a KRX trading date/);
  assert.equal(db.database.prepare(`SELECT COUNT(*) AS n FROM ${MARKET_FUNDS_TABLE}`).get().n, 0);
  const bare = database({ migrated: false });
  const notReady = await post(bare, doc([day('2026-11-24')]));
  assert.equal(notReady.status, 503);
  assert.equal(notReady.body.error, 'MARKET_FUNDS_SCHEMA_NOT_READY');
  assert.equal(bare.database.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(MARKET_FUNDS_TABLE), undefined);
});

test('publish then read: created, unchanged, revised; the read is canonical and never shows auth_source', async () => {
  const db = database();
  const first = await post(db, doc([day('2026-11-23'), day('2026-11-24', { items: items().reverse() })]));
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.created, first.body.updated, first.body.unchanged], [['2026-11-23', '2026-11-24'], [], []]);
  const again = await post(db, doc([day('2026-11-24', { retrieved_at: '2026-11-25T09:00:00+09:00' })]));
  assert.deepEqual([again.body.unchanged, again.body.published_at], [['2026-11-24'], null]);
  const revised = await post(db, doc([day('2026-11-24', { retrieved_at: '2026-11-25T09:00:00+09:00', items: items('2026-11-24', { DEPOSITS: { value: 82049800 } }) })]));
  assert.deepEqual(revised.body.updated, ['2026-11-24']);
  const stale = await post(db, doc([day('2026-11-24', { retrieved_at: '2026-11-25T08:40:00+09:00' })]));
  assert.deepEqual(stale.body.skipped_older, ['2026-11-24']);

  const one = await get(db, '2026-11-24');
  assert.equal(one.status, 200);
  assert.match(one.cache, /max-age=60/);
  assert.deepEqual(one.body.day.items.map(item => item.code), [...MARKET_FUND_CODES]);
  assert.equal(one.body.day.items[0].value, 82049800);
  assert.equal(one.body.day.previous_date, '2026-11-23');
  assert.ok(!JSON.stringify(one.body).includes('market-publish-key'));
  assert.equal((await get(db, 'latest')).body.day.market_date, '2026-11-24');
  assert.equal((await get(db, '2026-11-20')).status, 404);
  assert.equal((await get(db, 'yesterday')).status, 400);
  assert.equal((await get(database({ migrated: false }), 'latest')).status, 503);
  assert.deepEqual([...(await loadMarketFundCodes({ COMMENTS_DB: db }))], ['DEPOSITS', 'CREDIT', 'FORCED_SALE']);
  assert.deepEqual([...(await loadMarketFundCodes({ COMMENTS_DB: database({ migrated: false }) }))], []);
});

/* ------------------------------------------------------------ pages */

function cardOf(html) {
  const start = html.indexOf('<section class="mk-card mk-funds-card"');
  return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}

const stat = (card, code) => (card.match(new RegExp(`<div class="mk-stat" data-fund="${code}">([\\s\\S]*?)</div>`)) || [])[1] || '';
const text = fragment => fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the session page shows that day’s funds after the session stats; never another day’s', () => {
  const payload = JSON.parse(MC_EXAMPLE);
  payload.meta.market_date = '2026-11-24';
  const ko = marketDatePageHtml(SHELLS.ko, payload, 'ko', { marketFunds: { ...day('2026-11-24'), published_at: '' } });
  const card = cardOf(ko);
  assert.ok(card, 'a funds card');
  assert.ok(ko.indexOf('mk-grid-kr2') < ko.indexOf('mk-funds-card'), 'after the stats and the top 10');
  assert.match(card, /<h3 id="mk-funds-title">증시 자금<\/h3><span class="mk-card-note">2026\.11\.24 기준 · 다음 영업일 공개<\/span>/);
  assert.equal(text(stat(card, 'DEPOSITS')), '투자자예탁금 82.05조원 전일 대비 −3.29조원');
  assert.match(stat(card, 'DEPOSITS'), /<a class="instrument-history-link" href="\/market\/deposits\/">투자자예탁금<\/a>/);
  assert.match(stat(card, 'DEPOSITS'), /<span class="down">−3\.29조원<\/span>/);
  assert.equal(text(stat(card, 'CREDIT')), '신용거래융자 25.88조원 전일 대비 −649억원 · 코스피 20.02조원 · 코스닥 5.86조원');
  assert.equal(text(stat(card, 'UNPAID')), '위탁매매 미수금 9,660억원 전일 대비 +900억원');
  assert.match(stat(card, 'UNPAID'), /<span class="up">\+900억원<\/span>/);
  assert.equal(text(stat(card, 'FORCED_SALE')), '반대매매 137억원 전일 대비 +25억원 · 미수금 대비 1.6%');
  assert.match(card, /금융투자협회 증시자금 추이 · 투자자예탁금은 장내파생상품 거래예수금 제외/);

  const en = cardOf(marketDatePageHtml(SHELLS.en, payload, 'en', { marketFunds: { ...day('2026-11-24'), published_at: '' } }));
  assert.match(en, /Market Funds<\/h3><span class="mk-card-note">As of Nov 24, 2026 · Published the next business day/);
  assert.equal(text(stat(en, 'DEPOSITS')), 'Investor deposits KRW 82.05tn vs. prior day KRW −3.29tn');
  assert.match(stat(en, 'CREDIT'), /href="\/en\/market\/margin-loans\/">Margin loans<\/a>/);
  assert.equal(text(stat(en, 'UNPAID')), 'Unpaid margin KRW 966.0bn vs. prior day KRW +90.0bn');
  assert.equal(text(stat(en, 'FORCED_SALE')), 'Forced selling KRW 13.7bn vs. prior day KRW +2.5bn · 1.6% of unpaid margin');

  // Another day's funds, or none: no card.
  assert.equal(cardOf(marketDatePageHtml(SHELLS.ko, payload, 'ko', { marketFunds: day('2026-11-23') })), '');
  assert.equal(cardOf(marketDatePageHtml(SHELLS.ko, payload, 'ko', {})), '');
  // A day with none of the four headline figures draws no card.
  assert.equal(cardOf(marketDatePageHtml(SHELLS.ko, payload, 'ko', { marketFunds: { ...day('2026-11-24'), items: items().filter(item => item.code === 'CREDIT_KOSPI') } })), '');
});

async function dashboard(lang) {
  const document = { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(LOCALE_JS, context);
  vm.runInContext(MARKET_JS, context);
  return window.MARKET_CLOSE;
}

test('TODAY shows the newest stored funds day up to the record’s date, dated; a past date shows its own day only', async () => {
  for (const lang of ['ko', 'en']) {
    const runtime = await dashboard(lang);
    const payload = JSON.parse(MC_EXAMPLE);
    payload.meta.market_date = '2026-11-25';
    const render = (funds, mode = 'today') => {
      Object.assign(runtime.state, mode === 'history' ? { mode: 'history', isLatest: false, latestDate: '2026-11-26' } : { mode: 'today', isLatest: true, latestDate: null });
      const target = { innerHTML: '' };
      runtime.render(structuredClone(payload), target, { marketFunds: funds });
      return cardOf(target.innerHTML);
    };
    // The record is 11-25; KOFIA has 11-24 so far: TODAY shows it, with its own date.
    const today = render({ ...day('2026-11-24'), published_at: '' });
    assert.match(today, lang === 'ko' ? /2026\.11\.24 기준/ : /As of Nov 24, 2026/, lang);
    assert.match(today, lang === 'ko' ? /82\.05조원/ : /KRW 82\.05tn/);
    // Never a day after the record, nor one more than 10 days older.
    assert.equal(render({ ...day('2026-11-24'), market_date: '2026-11-26' }), '');
    assert.equal(render({ ...day('2026-11-24'), market_date: '2026-11-10' }), '');
    // The 11-25 page opened from the calendar wants 11-25's own funds.
    assert.equal(render({ ...day('2026-11-24'), published_at: '' }, 'history'), '');
    assert.match(render({ ...day('2026-11-24'), market_date: '2026-11-25' }, 'history'), /mk-funds-card/);
  }
});

test('a fund history page: amounts in 조원/억원, the change against the previous day, links only to sessions with a record', () => {
  const days = [day('2026-11-24'), day('2026-11-23')].map(item => ({ ...item, published_at: '2026-11-25T00:00:00Z' }));
  const deposits = MARKET_INDICATORS.find(item => item.code === 'DEPOSITS');
  const series = marketFundSeries(days, deposits, new Set(['2026-11-24']));
  assert.deepEqual(series.map(point => [point.date, point.recordDate, point.close, point.change]), [['2026-11-24', '2026-11-24', 82049700, -3286463], ['2026-11-23', null, 85336163, 2351614]]);
  assert.equal(marketIndicatorTitle(deposits, series, 'ko'), '투자자예탁금 일별 추이 · 11월 24일 82.05조원(−3.85%) | Snowshagal');
  assert.equal(marketIndicatorTitle(deposits, series, 'en'), 'Investor Deposits History: KRW 82.05tn (−3.85%) on Nov 24, 2026 | Snowshagal');
  const available = availableIndicatorCodes([], marketFundCodesIn(days));
  const ko = marketIndicatorPageHtml(SHELLS.ko, deposits, series, 'ko', available);
  assert.match(ko, /<h1 id="market-indicator-heading">투자자예탁금\(고객예탁금\) 일별 기록<\/h1>/);
  assert.match(ko, /금융투자협회 증시자금 추이 · 장내파생상품 거래예수금 제외/);
  assert.match(ko, /<a href="\/market\/2026-11-24\/">/);
  assert.doesNotMatch(ko, /href="\/market\/2026-11-23\/"/);
  assert.match(ko, /<td><span class="down">−3\.29조원<\/span><\/td>/);
  assert.match(ko, /<td><span class="down">−3\.85%<\/span><\/td>/);
  assert.match(ko, /데이터 출처: 금융투자협회 종합통계서비스\(FreeSIS\)/);
  assert.match(ko, /class="indicator-chart-tick"[^>]*>8[0-9](\.[0-9])?조</);
  const related = ko.slice(ko.indexOf('class="indicator-links"'));
  assert.match(related, /href="\/market\/forced-selling\/">반대매매<\/a>/);
  assert.doesNotMatch(related, /href="\/market\/deposits\/"/);
  const forced = MARKET_INDICATORS.find(item => item.code === 'FORCED_SALE');
  assert.equal(marketIndicatorTitle(forced, marketFundSeries(days, forced), 'ko'), '반대매매 일별 추이 · 11월 24일 137억원(+22.68%) | Snowshagal');
  assert.match(marketIndicatorPageHtml(SHELLS.ko, forced, marketFundSeries(days, forced), 'ko', available), /class="indicator-chart-tick"[^>]*>1[0-9]{2}억</);
});

test('fund pages are listed (archive, sitemap, related links) only once a day is stored', () => {
  const session = { market_date: '2026-11-24', published_at: '2026-11-24T07:10:00Z', optional_closes: null };
  assert.doesNotMatch(sitemapXml([], { marketSessions: [session] }), /\/market\/deposits\//);
  const listed = sitemapXml([], { marketSessions: [session], rateCodes: new Set(['DEPOSITS', 'CREDIT', 'FORCED_SALE']) });
  for (const slug of ['deposits', 'margin-loans', 'forced-selling']) {
    assert.match(listed, new RegExp(`<loc>https://snowshagal\\.com/market/${slug}/</loc>`));
    assert.match(listed, new RegExp(`<loc>https://snowshagal\\.com/en/market/${slug}/</loc>`));
  }
  assert.doesNotMatch(marketArchivePageHtml(SHELLS.ko, [session], 'ko'), /\/market\/margin-loans\//);
  assert.match(marketArchivePageHtml(SHELLS.ko, [session], 'ko', new Set(['CREDIT'])), /href="\/market\/margin-loans\/">신용융자 잔고<\/a>/);
  assert.equal(availableIndicatorCodes([]).has('DEPOSITS'), false);
  assert.equal(availableIndicatorCodes([], ['DEPOSITS', 'UNPAID']).has('DEPOSITS'), true);
  // Only the three page codes ever have a page.
  assert.equal(availableIndicatorCodes([], ['UNPAID']).has('UNPAID'), false);
});

async function route(url, db) {
  const context = {
    request: new Request(url),
    env: { COMMENTS_DB: db, ASSETS: { fetch: async request => new Response(new URL(request.url).pathname === '/en/market/' ? SHELLS.en : SHELLS.ko, { status: new URL(request.url).pathname === '/__not-found__' ? 404 : 200 }) } },
    next: async () => new Response('static')
  };
  return onMarketPageRequest(context, { loadPostsFn: async () => POSTS });
}

test('the routes: a fund page exists once a day is stored; a session page carries its day; nothing breaks without the migration', async () => {
  const bare = database({ migrated: false });
  assert.equal((await route(`${PROD}/market/deposits/`, bare)).status, 404);
  const db = database();
  assert.equal((await route(`${PROD}/market/deposits/`, db)).status, 404);
  await post(db, doc([day('2026-11-23'), day('2026-11-24')]));
  const page = await route(`${PROD}/en/market/margin-loans/`, db);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Korean Margin Loan Balance: Daily History/);

  // A session page: the record from Market Close, the funds from Market Funds.
  const payload = JSON.parse(MC_EXAMPLE);
  payload.meta.market_date = '2026-11-24';
  payload.meta.status = 'final';
  db.database.prepare(`CREATE TABLE IF NOT EXISTS market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source) VALUES (?, ?, ?, 'final', ?, ?, 'test')`)
    .run('2026-11-24', payload.meta.schema_version, payload.meta.generated_at, JSON.stringify(payload), '2026-11-24T07:10:00Z');
  const session = await (await route(`${PROD}/market/2026-11-24/`, db)).text();
  assert.match(cardOf(session), /82\.05조원/);
  const history = await (await route(`${PROD}/market/forced-selling/`, db)).text();
  assert.match(history, /<a href="\/market\/2026-11-24\/">/);
  assert.doesNotMatch(history, /<a href="\/market\/2026-11-23\/">/);
  // Another indicator's page lists the fund pages as related.
  // The deposits page carries its guide (related reads from the posts) but no latest-session block.
  const deposits = await (await route(`${PROD}/market/deposits/`, db)).text();
  assert.ok(deposits.includes('투자자예탁금이란</h2>'));
  assert.ok(deposits.includes('<a href="/reports/basics-13-deposits">'));
  assert.doesNotMatch(deposits, /indicator-latest/);
  const other = await route(`${PROD}/market/usdkrw/`, db);
  assert.equal(other.status, 200);
  assert.match(await other.text(), /href="\/market\/deposits\/"/);
});
