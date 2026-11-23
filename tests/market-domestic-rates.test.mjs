// Domestic Rates: the KOFIA final quote yields (16:00 KST) of each KRX trading
// day — KTB 3Y and 10Y, corporate AA- 3Y and CD 91-day. Their own dataset
// (contracts/domestic_rates/), stored apart from Market Close and joined to the
// session by date: the receiver and read API on an in-memory SQLite standing in
// for D1 with the checked-in migration, the session and history pages, the
// sitemap, and the TODAY dashboard.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import {
  DOMESTIC_RATE_CODES,
  DOMESTIC_RATES_TABLE,
  domesticRateCodesIn,
  loadDomesticRateCodes,
  planDomesticRatesWrites,
  validateDomesticRatesDocument
} from '../functions/api/market/rates/_shared.js';
import { onRequestPost as publish } from '../functions/api/market/rates/publish.js';
import { onRequestGet as getDate } from '../functions/api/market/rates/date.js';
import {
  MARKET_INDICATORS,
  availableIndicatorCodes,
  domesticRateSeries,
  domesticRatesBody,
  marketArchivePageHtml,
  marketDatePageHtml,
  marketIndicatorPageHtml,
  marketIndicatorTitle,
  onMarketPageRequest,
  parseMarketPagePath
} from '../functions/_market-date-page.js';
import { OPTIONAL_INDICATOR_CLOSES_SQL } from '../functions/_market-indicators.js';
import { sitemapXml } from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [MIGRATION, SCHEMA_SQL, SCHEMA_JSON, EXAMPLE, CONTRACT_MD, SHELL_KO, SHELL_EN, MC_EXAMPLE, LOCALE_JS, MARKET_JS] = await Promise.all([
  read('migrations/comments/0003_market_domestic_rates.sql'), read('db/schema.sql'),
  read('contracts/domestic_rates/domestic_rates.schema.json'), read('contracts/domestic_rates/domestic_rates.example.json'),
  read('contracts/domestic_rates/DOMESTIC_RATES_CONTRACT.md'),
  read('market/index.html'), read('en/market/index.html'),
  read('contracts/market_close/market_close.example.json'),
  read('assets/locale.js'), read('assets/market-close.js')
]);
const SHELLS = { ko: SHELL_KO, en: SHELL_EN };

const KEY = 'test-publish-key';
const PROD = 'https://snowshagal.com';
// Monday 2026-11-23, 16:40 KST.
const NOW = new Date('2026-11-23T07:40:00Z');

function items(overrides = {}) {
  return [
    { code: 'KTB3Y', value: 3.642, previous_value: 3.716, change_bp: -7.4 },
    { code: 'KTB10Y', value: 3.857, previous_value: 3.942, change_bp: -8.5 },
    { code: 'CORPAA3Y', value: 4.329, previous_value: 4.39, change_bp: -6.1 },
    { code: 'CD91', value: 3.39, previous_value: 3.38, change_bp: 1 }
  ].map(item => ({ ...item, ...(overrides[item.code] || {}) }));
}

function day(date, overrides = {}) {
  return {
    market_date: date,
    basis_time: '16:00',
    retrieved_at: `${date}T16:31:04+09:00`,
    source: '금융투자협회 최종호가수익률',
    items: items(),
    ...overrides
  };
}

function doc(days, overrides = {}) {
  return { schema_version: '1.0.0', generated_at: '2026-11-23T16:31:05+09:00', days, ...overrides };
}

const errorsOf = document => validateDomesticRatesDocument(document, NOW.getTime()).errors.join('\n');

function database({ migrated = true } = {}) {
  const db = new SqliteD1();
  if (migrated) db.exec(MIGRATION);
  return db;
}

async function post(db, body, { origin = PROD, key = KEY, now = NOW, raw } = {}) {
  const request = new Request(`${origin}/api/market/rates/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-market-publish-key': key } : {}) },
    body: raw ?? JSON.stringify(body)
  });
  const response = await publish({ request, env: { COMMENTS_DB: db, MARKET_PUBLISH_KEY: KEY }, now });
  return { status: response.status, body: await response.json() };
}

async function get(db, date) {
  const response = await getDate({ request: new Request(`${PROD}/api/market/rates/date?date=${date}`), env: { COMMENTS_DB: db } });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

/* ------------------------------------------------------------ contract */

test('four instruments; the schema enum, limits, example and contract agree with the allowlist', () => {
  assert.deepEqual([...DOMESTIC_RATE_CODES], ['KTB3Y', 'KTB10Y', 'CORPAA3Y', 'CD91']);
  const schema = JSON.parse(SCHEMA_JSON);
  assert.deepEqual(schema.$defs.item.properties.code.enum, [...DOMESTIC_RATE_CODES]);
  assert.equal(schema.$defs.day.properties.items.maxItems, DOMESTIC_RATE_CODES.length);
  assert.equal(schema.properties.days.maxItems, 60);
  for (const code of DOMESTIC_RATE_CODES) assert.match(CONTRACT_MD, new RegExp(`\`${code}\``));
  assert.deepEqual(validateDomesticRatesDocument(JSON.parse(EXAMPLE), NOW.getTime()).errors, []);
  // The history pages are the codes in lower case.
  assert.deepEqual(MARKET_INDICATORS.filter(item => item.domestic).map(item => item.slug), ['ktb3y', 'ktb10y', 'corpaa3y', 'cd91']);
  assert.equal(parseMarketPagePath('/market/corpaa3y/').indicator.code, 'CORPAA3Y');
  // They are not in the Market Close payload: the optional-closes column never reads them.
  assert.doesNotMatch(OPTIONAL_INDICATOR_CLOSES_SQL, /KTB|CORPAA|CD91|domestic_rates/);
});

test('the migration and db/schema.sql define the same table', () => {
  const create = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE'));
  assert.ok(SCHEMA_SQL.includes(create.trim()), 'db/schema.sql carries the same table definition');
  assert.match(create, new RegExp(`CREATE TABLE IF NOT EXISTS ${DOMESTIC_RATES_TABLE} \\(\\s*market_date TEXT PRIMARY KEY`));
});

test('structure: days and items counted, each once, no unknown code or field', () => {
  assert.equal(validateDomesticRatesDocument(doc([day('2026-11-23')]), NOW.getTime()).passed, true);
  assert.equal(validateDomesticRatesDocument(doc([day('2026-11-23', { items: items().slice(3) })]), NOW.getTime()).passed, true);
  assert.match(errorsOf(doc([])), /1 to 60 days/);
  assert.match(errorsOf(doc([day('2026-11-20'), day('2026-11-20')])), /appears more than once/);
  assert.match(errorsOf(doc([day('2026-11-20', { items: [] })])), /1 to 4 items/);
  assert.match(errorsOf(doc([day('2026-11-20', { items: [items()[0], items()[0]] })])), /KTB3Y appears more than once/);
  assert.match(errorsOf(doc([day('2026-11-20', { items: [{ ...items()[0], code: 'KTB5Y' }] })])), /not a Domestic Rates instrument/);
  assert.match(errorsOf(doc([day('2026-11-20', { items: [{ ...items()[0], extra: 1 }] })])), /extra: unknown field/);
  assert.match(errorsOf(doc([{ ...day('2026-11-20'), extra: 1 }])), /\$\.days\[0\]\.extra: unknown field/);
  assert.match(errorsOf(doc([day('2026-11-20')], { schema_version: '1.1.0' })), /schema_version/);
  assert.match(errorsOf(doc([day('2026-11-20', { source: '' })])), /source/);
  assert.match(errorsOf(doc([day('2026-11-20', { basis_time: '4pm' })])), /basis_time/);
  const many = [];
  for (let d = new Date('2026-01-02T00:00:00Z'); many.length < 61; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (![0, 6].includes(d.getUTCDay())) many.push(day(date));
  }
  assert.match(errorsOf(doc(many)), /1 to 60 days/);
});

test('numbers: finite yields within range, and the change must be the arithmetic on them', () => {
  assert.match(errorsOf(doc([day('2026-11-20', { items: items({ KTB3Y: { value: 'x' } }) })])), /value: finite number/);
  assert.match(errorsOf(doc([day('2026-11-20', { items: items({ KTB3Y: { value: 30 } }) })])), /between -1 and 25/);
  assert.match(errorsOf(doc([day('2026-11-20', { items: items({ KTB3Y: { change_bp: 7.4 } }) })])), /change_bp: 7\.4 contradicts/);
  // KOFIA's percent-point change is −0.074; −7.4bp is the same, ±0.1 of rounding is not a contradiction.
  assert.equal(validateDomesticRatesDocument(doc([day('2026-11-20', { items: items({ KTB3Y: { change_bp: -7.5 } }) })]), NOW.getTime()).passed, true);
});

test('dates: a KRX trading day the calendar covers, not after today, read after the basis time', () => {
  assert.match(errorsOf(doc([day('2026-11-21')])), /2026-11-21 is not a KRX trading date/);
  assert.match(errorsOf(doc([day('2026-10-09')])), /not a KRX trading date/);
  assert.match(errorsOf(doc([day('2026-11-24')])), /after today/);
  assert.match(errorsOf(doc([day('2026-02-30')])), /YYYY-MM-DD/);
  assert.match(validateDomesticRatesDocument(doc([day('2028-01-04')]), Date.parse('2028-01-04T09:00:00Z')).errors.join('\n'), /does not cover 2028/);
  assert.match(errorsOf(doc([day('2026-11-23', { retrieved_at: '2026-11-23T15:59:59+09:00' })])), /before 2026-11-23 16:00 KST/);
  assert.equal(validateDomesticRatesDocument(doc([day('2026-11-23', { retrieved_at: '2026-11-23T07:00:00Z' })]), NOW.getTime()).passed, true);
  // The CSAT day: KOFIA's afternoon basis moves with the session.
  assert.match(errorsOf(doc([day('2026-11-19', { basis_time: '17:00', retrieved_at: '2026-11-19T16:30:00+09:00' })])), /before 2026-11-19 17:00 KST/);
  assert.match(errorsOf(doc([day('2026-11-23', { retrieved_at: '2026-11-23T16:50:00+09:00' })])), /retrieved_at: in the future/);
  assert.match(errorsOf(doc([day('2026-11-20')], { generated_at: '2026-11-24T00:00:00+09:00' })), /generated_at: in the future/);
});

test('write plan: new days created, the same figures unchanged, different figures only when read later', () => {
  const entry = (date, retrievedAt, overrides) => ({ day: day(date, { items: items(overrides) }), retrievedAt });
  const stored = [{ market_date: '2026-11-20', retrieved_at: '2026-11-20T07:31:04.000Z', payload_json: JSON.stringify(day('2026-11-20')) }];
  const plan = planDomesticRatesWrites([
    entry('2026-11-19', '2026-11-19T07:31:04.000Z'),
    entry('2026-11-20', '2026-11-21T00:00:00.000Z')
  ], stored);
  assert.deepEqual([plan.created, plan.unchanged, plan.updated], [['2026-11-19'], ['2026-11-20'], []]);
  const corrected = planDomesticRatesWrites([entry('2026-11-20', '2026-11-20T08:00:00.000Z', { KTB3Y: { value: 3.643, change_bp: -7.3 } })], stored);
  assert.deepEqual(corrected.updated, ['2026-11-20']);
  const older = planDomesticRatesWrites([entry('2026-11-20', '2026-11-20T07:00:00.000Z', { KTB3Y: { value: 3.643, change_bp: -7.3 } })], stored);
  assert.deepEqual(older.skipped_older, ['2026-11-20']);
});

/* ------------------------------------------------------------ API */

test('publish: credentials and host first; nothing is written before the migration or for an invalid document', async () => {
  const db = database();
  assert.equal((await post(db, doc([day('2026-11-20')]), { key: '' })).status, 401);
  assert.equal((await post(db, doc([day('2026-11-20')]), { key: 'wrong' })).status, 401);
  assert.equal((await post(db, doc([day('2026-11-20')]), { origin: 'https://market-research-site.pages.dev' })).status, 403);
  assert.equal((await post(db, null, { raw: '{' })).status, 400);
  assert.equal((await post(db, null, { raw: JSON.stringify(doc([day('2026-11-20')])) + ' '.repeat(70 * 1024) })).status, 413);
  const invalid = await post(db, doc([day('2026-11-20'), day('2026-11-21')]));
  assert.equal(invalid.status, 422);
  assert.match(invalid.body.details.join('\n'), /2026-11-21 is not a KRX trading date/);
  assert.equal(db.database.prepare(`SELECT COUNT(*) AS n FROM ${DOMESTIC_RATES_TABLE}`).get().n, 0);
  const bare = database({ migrated: false });
  const notReady = await post(bare, doc([day('2026-11-20')]));
  assert.equal(notReady.status, 503);
  assert.equal(notReady.body.error, 'DOMESTIC_RATES_SCHEMA_NOT_READY');
  assert.equal(bare.database.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(DOMESTIC_RATES_TABLE), undefined);
});

test('publish then read: created, unchanged, corrected; the read is canonical and never shows auth_source', async () => {
  const db = database();
  const first = await post(db, doc([day('2026-11-19'), day('2026-11-20', { items: items().reverse() })]));
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.created, first.body.updated, first.body.unchanged], [['2026-11-19', '2026-11-20'], [], []]);
  const again = await post(db, doc([day('2026-11-20', { retrieved_at: '2026-11-20T17:00:00+09:00' })]));
  assert.deepEqual([again.body.unchanged, again.body.published_at], [['2026-11-20'], null]);
  const fixed = await post(db, doc([day('2026-11-20', { retrieved_at: '2026-11-20T17:00:00+09:00', items: items({ CD91: { value: 3.4, change_bp: 2 } }) })]));
  assert.deepEqual(fixed.body.updated, ['2026-11-20']);
  const stale = await post(db, doc([day('2026-11-20', { retrieved_at: '2026-11-20T16:40:00+09:00' })]));
  assert.deepEqual(stale.body.skipped_older, ['2026-11-20']);

  const one = await get(db, '2026-11-20');
  assert.equal(one.status, 200);
  assert.match(one.cache, /max-age=60/);
  assert.deepEqual(one.body.day.items.map(item => item.code), ['KTB3Y', 'KTB10Y', 'CORPAA3Y', 'CD91']);
  assert.equal(one.body.day.items[3].value, 3.4);
  assert.equal(one.body.day.basis_time, '16:00');
  assert.ok(!JSON.stringify(one.body).includes('market-publish-key'));
  assert.equal((await get(db, 'latest')).body.day.market_date, '2026-11-20');
  assert.equal((await get(db, '2026-11-18')).status, 404);
  assert.equal((await get(db, 'yesterday')).status, 400);
  assert.equal((await get(database({ migrated: false }), 'latest')).status, 503);
  assert.deepEqual([...(await loadDomesticRateCodes({ COMMENTS_DB: db }))], ['KTB3Y', 'KTB10Y', 'CORPAA3Y', 'CD91']);
  assert.deepEqual([...(await loadDomesticRateCodes({ COMMENTS_DB: database({ migrated: false }) }))], []);
});

/* ------------------------------------------------------------ pages */

const DATE = JSON.parse(MC_EXAMPLE).meta.market_date;

test('the session page shows that day’s yields as their own section, numbered in order, and never another day’s', () => {
  const payload = JSON.parse(MC_EXAMPLE);
  const ko = marketDatePageHtml(SHELLS.ko, payload, 'ko', { domesticRates: { ...day(DATE), published_at: '' } });
  const headings = [...ko.matchAll(/<h2 id="market-section-(\d+)"><span>(\d+)\.<\/span> ([^<]+)<\/h2>/g)].map(match => [match[2], match[3]]);
  const rates = headings.find(([, title]) => title === '국내 금리');
  assert.ok(rates, 'a 국내 금리 section');
  assert.deepEqual(headings.map(([n]) => n), headings.map((_, index) => String(index + 1).padStart(2, '0')));
  const section = ko.slice(ko.indexOf('국내 금리</h2>'), ko.indexOf('</section>', ko.indexOf('국내 금리</h2>')));
  assert.equal((section.match(/<article class="instrument-card rate-card"/g) || []).length, 4);
  assert.match(section, /<a class="instrument-history-link" href="\/market\/ktb3y\/">국고채 3년<\/a>[\s\S]*?3\.642%[\s\S]*?▼ 7\.4bp[\s\S]*?16:00 최종호가/);
  assert.match(section, /CD 91일[\s\S]*?3\.39%[\s\S]*?▲ 1\.0bp/);
  assert.match(section, /금융투자협회 최종호가수익률 · 16:00 KST 기준/);
  const en = marketDatePageHtml(SHELLS.en, payload, 'en', { domesticRates: { ...day(DATE), published_at: '' } });
  assert.match(en, /Korean Bond Yields<\/h2>/);
  assert.match(en, /href="\/en\/market\/corpaa3y\/">Corporate AA- 3Y<\/a>/);
  // Another day's yields, or none: the page is as before.
  const without = marketDatePageHtml(SHELLS.ko, payload, 'ko', {});
  assert.doesNotMatch(without, /국내 금리|rate-card/);
  assert.doesNotMatch(marketDatePageHtml(SHELLS.ko, payload, 'ko', { domesticRates: day('2026-08-27') }), /rate-card/);
  assert.equal(domesticRatesBody({ market_date: DATE, items: [] }, 'ko'), '');
});

test('a rate history page: yields in percent, changes in bp, links only to sessions that have a record', () => {
  const days = [day('2026-11-20'), day('2026-11-19', { items: items({ KTB3Y: { value: 3.716, previous_value: 3.736, change_bp: -2 } }) }), day('2026-01-02')].map(item => ({ ...item, published_at: `${item.market_date}T07:35:00Z` }));
  const ktb3y = MARKET_INDICATORS.find(item => item.code === 'KTB3Y');
  const series = domesticRateSeries(days, ktb3y, new Set(['2026-11-20']));
  assert.deepEqual(series.map(point => [point.date, point.recordDate, point.close]), [['2026-11-20', '2026-11-20', 3.642], ['2026-11-19', null, 3.716], ['2026-01-02', null, 3.642]]);
  assert.equal(marketIndicatorTitle(ktb3y, series, 'ko'), '국고채 3년 금리 일별 기록 · 11월 20일 3.642%(−7.4bp) | Snowshagal');
  assert.equal(marketIndicatorTitle(ktb3y, series, 'en'), 'KTB 3Y Yield History: 3.642% (−7.4bp) on Nov 20, 2026 | Snowshagal');
  const available = availableIndicatorCodes([], domesticRateCodesIn(days));
  const ko = marketIndicatorPageHtml(SHELLS.ko, ktb3y, series, 'ko', available);
  assert.match(ko, /<h1 id="market-indicator-heading">국고채 3년물 금리 일별 기록<\/h1>/);
  assert.match(ko, /금융투자협회 최종호가수익률 · 16:00 KST 기준/);
  assert.match(ko, /<a href="\/market\/2026-11-20\/">/);
  assert.doesNotMatch(ko, /href="\/market\/2026-11-19\/"/);
  assert.match(ko, /<td><span class="down">−7\.4bp<\/span><\/td>/);
  assert.doesNotMatch(ko, /<th scope="col">등락률<\/th>/);
  assert.match(ko, /데이터 출처: 금융투자협회 채권정보센터/);
  const related = ko.slice(ko.indexOf('class="indicator-links"'));
  assert.match(related, /href="\/market\/cd91\/">CD 91일 금리<\/a>/);
  assert.doesNotMatch(related, /href="\/market\/ktb3y\/"/);
  const cd = MARKET_INDICATORS.find(item => item.code === 'CD91');
  assert.match(marketIndicatorTitle(cd, domesticRateSeries(days, cd), 'ko'), /3\.39%\(\+1\.0bp\)/);
});

test('rate pages are listed (archive, sitemap, related links) only once a day is stored', () => {
  const session = { market_date: '2026-11-20', published_at: '2026-11-20T07:10:00Z', optional_closes: null };
  assert.doesNotMatch(sitemapXml([], { marketSessions: [session] }), /\/market\/ktb3y\//);
  const listed = sitemapXml([], { marketSessions: [session], rateCodes: new Set(['KTB3Y', 'KTB10Y', 'CORPAA3Y', 'CD91']) });
  for (const slug of ['ktb3y', 'ktb10y', 'corpaa3y', 'cd91']) {
    assert.match(listed, new RegExp(`<loc>https://snowshagal\\.com/market/${slug}/</loc>`));
    assert.match(listed, new RegExp(`<loc>https://snowshagal\\.com/en/market/${slug}/</loc>`));
  }
  assert.doesNotMatch(marketArchivePageHtml(SHELLS.ko, [session], 'ko'), /\/market\/ktb10y\//);
  assert.match(marketArchivePageHtml(SHELLS.ko, [session], 'ko', new Set(['KTB10Y'])), /href="\/market\/ktb10y\/">국고채 10년 금리<\/a>/);
  assert.equal(availableIndicatorCodes([]).has('KTB3Y'), false);
  assert.equal(availableIndicatorCodes([], ['KTB3Y', 'NASDAQ_X']).has('KTB3Y'), true);
});

async function route(url, db) {
  const context = {
    request: new Request(url),
    env: { COMMENTS_DB: db, ASSETS: { fetch: async request => new Response(new URL(request.url).pathname === '/en/market/' ? SHELLS.en : SHELLS.ko, { status: new URL(request.url).pathname === '/__not-found__' ? 404 : 200 }) } },
    next: async () => new Response('static')
  };
  return onMarketPageRequest(context, { loadPostsFn: async () => [] });
}

test('the routes: a rate page exists once a day is stored; a session page carries its day; nothing breaks without the migration', async () => {
  const bare = database({ migrated: false });
  assert.equal((await route(`${PROD}/market/ktb3y/`, bare)).status, 404);
  const db = database();
  assert.equal((await route(`${PROD}/market/ktb3y/`, db)).status, 404);
  await post(db, doc([day('2026-11-19'), day('2026-11-20')]));
  const page = await route(`${PROD}/en/market/ktb10y/`, db);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Korea Treasury Bond 10-Year Yield: Daily History/);

  // A session page: the record from Market Close, the yields from Domestic Rates.
  const payload = JSON.parse(MC_EXAMPLE);
  payload.meta.market_date = '2026-11-20';
  payload.meta.status = 'final';
  db.database.prepare(`CREATE TABLE IF NOT EXISTS market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source) VALUES (?, ?, ?, 'final', ?, ?, 'test')`)
    .run('2026-11-20', payload.meta.schema_version, payload.meta.generated_at, JSON.stringify(payload), '2026-11-20T07:10:00Z');
  const session = await (await route(`${PROD}/market/2026-11-20/`, db)).text();
  assert.match(session, /국내 금리<\/h2>[\s\S]*?3\.642%/);
  const history = await (await route(`${PROD}/market/ktb3y/`, db)).text();
  assert.match(history, /<a href="\/market\/2026-11-20\/">/);
  assert.doesNotMatch(history, /<a href="\/market\/2026-11-19\/">/);
  // Another indicator's page lists the rate pages as related.
  const other = await route(`${PROD}/market/usdkrw/`, db);
  assert.equal(other.status, 200);
  assert.match(await other.text(), /href="\/market\/corpaa3y\/"/);
});

/* ------------------------------------------------------------ TODAY */

async function dashboard(lang) {
  const document = { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(LOCALE_JS, context);
  vm.runInContext(MARKET_JS, context);
  return window.MARKET_CLOSE;
}

test('TODAY lists the record’s own day of yields in the rates board after US 10Y; another day is not shown', async () => {
  for (const [lang, note, prefix] of [['ko', '금융투자협회 최종호가수익률', ''], ['en', 'KOFIA final quote yields', '/en']]) {
    const runtime = await dashboard(lang);
    const payload = JSON.parse(MC_EXAMPLE);
    const target = { innerHTML: '' };
    runtime.render(payload, target, { domesticRates: { ...day(DATE), published_at: '' } });
    const html = target.innerHTML;
    const start = html.indexOf('data-board="rates"');
    const board = html.slice(start, html.indexOf('</section>', start));
    assert.deepEqual([...board.matchAll(/<tr class="mk-row[^"]*"[^>]* data-(?:code|rate-code)="([A-Z0-9_]+)"/g)].map(m => m[1]), ['US10Y', 'KTB3Y', 'KTB10Y', 'CORPAA3Y', 'CD91'], lang);
    assert.equal((board.match(/class="mk-row rate-row"/g) || []).length, 4);
    assert.ok(board.includes(note), lang);
    assert.match(board, new RegExp(`href="${prefix}/market/ktb3y/"`));
    assert.match(board, /3\.642%[\s\S]*?▼ 7\.4bp/);

    const before = { innerHTML: '' };
    runtime.render(payload, before, { domesticRates: day('2026-08-27') });
    assert.doesNotMatch(before.innerHTML, /rate-row/);
  }
});
