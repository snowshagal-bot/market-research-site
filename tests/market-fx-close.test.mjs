// FX Close (2026-11-26): the Seoul FX market's USD/KRW 15:30 rate from the Bank
// of Korea ECOS, published by the collector after the Market Close record is
// final, stored apart (market_fx_close) and joined to every reader of a record:
// with a row USD/KRW is the 15:30 rate (basis seoul_1530); without one, once FX
// Close exists, the record's bank rate is provisional; without FX Close at all
// the pages are as before (tests/market-krw-pairs.test.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { FX_CLOSE_CODES, FX_CLOSE_TABLE, loadFxCloseDay, validateFxCloseDocument } from '../functions/api/market/fx/_shared.js';
import { onRequestPost as publish } from '../functions/api/market/fx/publish.js';
import { onRequestGet as getDay } from '../functions/api/market/fx/date.js';
import { applyFxClose, fxCloseStamp } from '../functions/api/market/_fx-merge.js';
import { onRequestGet as dateRequest } from '../functions/api/market/date.js';
import { onRequestGet as latestRequest } from '../functions/api/market/latest.js';
import { onRequestGet as rangeRequest } from '../functions/api/market/range.js';
import { loadTrend } from '../functions/api/market/trend.js';
import { INDICATOR_GUIDES, onMarketPageRequest } from '../functions/_market-date-page.js';
import { cardSourceKey, marketCardIsStale } from '../functions/_market-card.js';
import { marketBlogPost } from '../functions/_market-share-text.js';
import { glossaryEntries, glossaryTermId } from '../functions/_glossary.js';
import '../assets/locale.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [MIGRATION, SCHEMA_SQL, SCHEMA_JSON, EXAMPLE, MC_EXAMPLE, SHELL_KO, SHELL_EN, POSTS_JSON, GLOSSARY_JSON, MARKET_JS] = await Promise.all([
  read('migrations/comments/0007_market_fx_close.sql'), read('db/schema.sql'),
  read('contracts/fx_close/fx_close.schema.json'), read('contracts/fx_close/fx_close.example.json'),
  read('contracts/market_close/market_close.example.json'), read('market/index.html'), read('en/market/index.html'),
  read('data/posts.json'), read('data/glossary.json'), read('assets/market-close.js')
]);
const L = globalThis.MARKET_LOCALE;
const KEY = 'test-publish-key';
const PROD = 'https://snowshagal.com';
const NOW = new Date('2026-11-26T09:00:00Z');

// ECOS 731Y003/0000003 and the records' Hana Bank rates, 2026-11-18..26.
const ECOS = { '2026-11-18': 1333, '2026-11-19': 1330, '2026-11-20': 1336.2, '2026-11-23': 1345.9, '2026-11-24': 1342.4, '2026-11-25': 1343.2, '2026-11-26': 1342.7 };
const HANA = { '2026-11-19': 1330.2, '2026-11-20': 1336, '2026-11-23': 1346.8, '2026-11-24': 1342.4, '2026-11-25': 1343.4, '2026-11-26': 1342.7 };
const DATES = Object.keys(ECOS);

function fxDay(date, overrides = {}) {
  const previous = DATES[DATES.indexOf(date) - 1];
  return {
    market_date: date,
    previous_date: previous,
    retrieved_at: `${date}T17:23:04+09:00`,
    source: '한국은행 ECOS 원/달러(종가 15:30)',
    items: [{ code: 'USDKRW', value: ECOS[date], previous_value: ECOS[previous] }],
    ...overrides
  };
}
const doc = (days, overrides = {}) => ({ schema_version: '1.0.0', generated_at: '2026-11-26T17:23:05+09:00', days, ...overrides });
const errorsOf = (document, now = NOW) => validateFxCloseDocument(document, now.getTime()).errors.join('\n');

function database({ migrated = true, records = ['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'] } = {}) {
  const db = new SqliteD1();
  if (migrated) db.exec(MIGRATION);
  db.database.prepare(`CREATE TABLE market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  for (const date of records) {
    const payload = JSON.parse(MC_EXAMPLE);
    payload.meta.market_date = date;
    payload.meta.status = 'final';
    const previous = DATES[DATES.indexOf(date) - 1];
    Object.assign(payload.rates_fx_volatility.USDKRW, { close: HANA[date], previous_close: HANA[previous] ?? 1330, current: HANA[date] - 1.5, change: -1.5, change_pct: -0.1, source_date: date });
    db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source) VALUES (?, ?, ?, 'final', ?, ?, 'test')`)
      .run(date, payload.meta.schema_version, `${date}T16:05:00+09:00`, JSON.stringify(payload), `${date}T07:10:00Z`);
  }
  return db;
}

async function post(db, body, { origin = PROD, key = KEY, now = NOW } = {}) {
  const request = new Request(`${origin}/api/market/fx/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-market-publish-key': key } : {}) },
    body: JSON.stringify(body)
  });
  const response = await publish({ request, env: { COMMENTS_DB: db, MARKET_PUBLISH_KEY: KEY }, now });
  return { status: response.status, body: await response.json() };
}

/* ------------------------------------------------------------ contract */

test('one instrument; the schema, the example, the migration and db/schema.sql agree', () => {
  assert.deepEqual([...FX_CLOSE_CODES], ['USDKRW']);
  const schema = JSON.parse(SCHEMA_JSON);
  assert.equal(schema.$defs.item.properties.code.const, 'USDKRW');
  assert.equal(schema.properties.days.maxItems, 60);
  assert.deepEqual(validateFxCloseDocument(JSON.parse(EXAMPLE), NOW.getTime()).errors, []);
  const create = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE'));
  assert.ok(SCHEMA_SQL.includes(create.trim()), 'db/schema.sql carries the same table definition');
  assert.equal(FX_CLOSE_TABLE, 'market_fx_close');
});

test('the server rules: KRX session, after 15:30, previous date, range and daily move, clock', () => {
  assert.equal(errorsOf(doc([fxDay('2026-11-26')])), '');
  assert.match(errorsOf(doc([fxDay('2026-11-22')])), /not a KRX trading date/);
  assert.match(errorsOf(doc([fxDay('2026-11-26', { retrieved_at: '2026-11-26T15:29:59+09:00' })])), /before 2026-11-26 15:30 KST/);
  assert.match(errorsOf(doc([fxDay('2026-11-26', { previous_date: '2026-11-22' })])), /weekend/);
  assert.match(errorsOf(doc([fxDay('2026-11-26', { previous_date: '2026-11-26' })])), /1 to 14 days before/);
  assert.match(errorsOf(doc([fxDay('2026-11-26', { items: [{ code: 'USDKRW', value: 1342.735, previous_value: 1343.2 }] })])), /at most two decimals/);
  assert.match(errorsOf(doc([fxDay('2026-11-26', { items: [{ code: 'USDKRW', value: 90, previous_value: 1343.2 }] })])), /KRW 100 to 5000/);
  assert.match(errorsOf(doc([fxDay('2026-11-26', { items: [{ code: 'USDKRW', value: 1500, previous_value: 1343.2 }] })])), /more than 10%/);
  assert.match(errorsOf(doc([fxDay('2026-11-26', { items: [{ code: 'JPYKRW', value: 900, previous_value: 900 }] })])), /not an FX Close instrument/);
  assert.match(errorsOf(doc([fxDay('2026-11-26')]), new Date('2026-11-26T08:00:00Z')), /in the future/);
  assert.match(errorsOf(doc([fxDay('2026-11-26'), fxDay('2026-11-26')])), /appears more than once/);
});

/* ------------------------------------------------------------ endpoints */

test('publish: 503 before the migration, then created, unchanged, updated, skipped_older; date reads it', async () => {
  assert.equal((await post(database({ migrated: false }), doc([fxDay('2026-11-26')]))).status, 503);
  const db = database();
  assert.equal((await post(db, doc([fxDay('2026-11-26')]), { key: 'wrong' })).status, 401);
  assert.equal((await post(db, doc([fxDay('2026-11-26')]), { origin: 'https://example.com' })).status, 403);
  let result = await post(db, doc([fxDay('2026-11-25'), fxDay('2026-11-26')]));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.created, ['2026-11-25', '2026-11-26']);
  result = await post(db, doc([fxDay('2026-11-26', { retrieved_at: '2026-11-26T17:40:00+09:00' })]));
  assert.deepEqual(result.body.unchanged, ['2026-11-26']);
  result = await post(db, doc([fxDay('2026-11-26', { retrieved_at: '2026-11-26T17:45:00+09:00', items: [{ code: 'USDKRW', value: 1342.6, previous_value: 1343.2 }] })]));
  assert.deepEqual(result.body.updated, ['2026-11-26']);
  result = await post(db, doc([fxDay('2026-11-26', { retrieved_at: '2026-11-26T17:30:00+09:00', items: [{ code: 'USDKRW', value: 1342.5, previous_value: 1343.2 }] })]));
  assert.deepEqual(result.body.skipped_older, ['2026-11-26']);

  const read = async date => {
    const response = await getDay({ request: new Request(`${PROD}/api/market/fx/date?date=${date}`), env: { COMMENTS_DB: db } });
    return { status: response.status, body: await response.json() };
  };
  const latest = await read('latest');
  assert.equal(latest.body.day.market_date, '2026-11-26');
  assert.equal(latest.body.day.items[0].value, 1342.6);
  assert.equal((await read('2026-11-24')).status, 404);
  assert.equal((await read('nope')).status, 400);
  assert.equal(await loadFxCloseDay({ COMMENTS_DB: database({ migrated: false }) }, '2026-11-26'), undefined, 'no table: unavailable');
  assert.equal(await loadFxCloseDay({ COMMENTS_DB: db }, '2026-11-24'), null, 'a table without the date: none yet');
});

/* ------------------------------------------------------------ the join */

test('applyFxClose: the 15:30 rate with a row, a provisional bank rate without one, the record without FX Close', () => {
  const record = () => ({ meta: { market_date: '2026-11-23' }, rates_fx_volatility: { USDKRW: { name: '원/달러', close: 1346.8, previous_close: 1336, change: 10.8, current: 1344.88, source: '네이버 금융 하나은행 15:30 회차별 매매기준율 + Yahoo 현재가 · KRW=X' } } });
  const joined = applyFxClose(record(), fxDay('2026-11-23')).rates_fx_volatility.USDKRW;
  assert.equal(joined.close, 1345.9);
  assert.equal(joined.previous_close, 1336.2);
  assert.equal(Number(joined.change.toFixed(2)), 9.7);
  assert.equal(joined.basis, 'seoul_1530');
  assert.equal(joined.as_of, '2026-11-23T15:30:00+09:00');
  assert.equal(joined.source, '한국은행 ECOS 원/달러(종가 15:30)');
  assert.equal(joined.bank_rate, 1346.8);
  assert.equal(joined.current, undefined, 'no Yahoo reading next to the 15:30 rate');
  assert.equal(applyFxClose(record(), null).rates_fx_volatility.USDKRW.basis, 'bank_provisional');
  assert.equal(applyFxClose(record(), undefined).rates_fx_volatility.USDKRW.basis, undefined);
  assert.equal(applyFxClose(record(), fxDay('2026-11-24')).rates_fx_volatility.USDKRW.basis, 'bank_provisional', 'another date never applies');
  assert.equal(fxCloseStamp(applyFxClose(record(), fxDay('2026-11-23'))), 'fx1345.9');
  assert.equal(fxCloseStamp(applyFxClose(record(), null)), 'fxp');
  assert.equal(fxCloseStamp(record()), '');
});

test('the API, session page, TODAY labels, archive, history, range, trend, card and blog text all read the 15:30 rate', async () => {
  const db = database();
  await post(db, doc(['2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25'].map(date => fxDay(date))));
  const env = { COMMENTS_DB: db, ASSETS: { fetch: async request => new Response(new URL(request.url).pathname.startsWith('/en/') ? SHELL_EN : SHELL_KO) } };

  // API: 11-23 from ECOS; 11-26 (no row yet) provisional on the bank series.
  const api = async path => (await (path.includes('latest') ? latestRequest : dateRequest)({ request: new Request(`${PROD}${path}`), env })).json();
  const day23 = (await api('/api/market/date?date=2026-11-23')).rates_fx_volatility.USDKRW;
  assert.deepEqual([day23.close, Number(day23.change.toFixed(2)), day23.basis], [1345.9, 9.7, 'seoul_1530']);
  const latest = (await api('/api/market/latest')).rates_fx_volatility.USDKRW;
  assert.deepEqual([latest.close, Number(latest.change.toFixed(2)), latest.basis], [1342.7, -0.7, 'bank_provisional']);

  // The ETag changes when the day's row arrives.
  const etag = async () => (await dateRequest({ request: new Request(`${PROD}/api/market/date?date=2026-11-26`), env })).headers.get('etag');
  const before = await etag();
  await post(db, doc([fxDay('2026-11-26')]));
  assert.notEqual(await etag(), before);

  const page = async path => (await onMarketPageRequest({ request: new Request(`${PROD}${path}`), env, next: async () => new Response('static') }, { loadPostsFn: async () => [] })).text();
  const session = await page('/market/2026-11-23/');
  const usdRow = session.slice(session.indexOf('data-code="USDKRW"'), session.indexOf('</tr>', session.indexOf('data-code="USDKRW"')));
  assert.match(usdRow, /2026\.11\.23 · 15:30 기준가/);
  assert.match(usdRow, /1,345\.90원/);
  assert.match(usdRow, /▲ 9\.70 <span>\(\+0\.73%\)<\/span>/);
  assert.match(session, /<small>[^<]*서울 외환시장 15:30 기준가<\/small>/);
  assert.match(session, /원\/달러는 서울 외환시장 15:30 기준가\(한국은행\), 그 밖의 원화는 하나은행 고시/);
  assert.match(session, /데이터 출처: KRX 한국거래소, 네이버 금융, 야후 파이낸스, 한국은행 ECOS\(원\/달러 15:30\)/);
  // Other KRW pairs stay the bank rate.
  const jpyRow = session.slice(session.indexOf('data-code="JPYKRW"'), session.indexOf('</tr>', session.indexOf('data-code="JPYKRW"')));
  assert.match(jpyRow, /하나은행 고시/);
  assert.match(await page('/en/market/2026-11-23/'), /Nov 23, 2026 · 3:30 p\.m\. rate/);

  // /market/usdkrw/: ECOS days only, its own basis, column and guide.
  const history = await page('/market/usdkrw/');
  assert.match(history, /서울 외환시장 오후 3시 30분 기준가 · 한국은행 ECOS · 대비는 전 거래일 기준가 대비/);
  assert.match(history, /<th scope="col">15:30 기준가<\/th>/);
  assert.match(history, /<a href="\/market\/2026-11-23\/">11월 23일\(월\)<\/a><\/th><td>1,345\.90원<\/td><td><span class="up">\+9\.70<\/span>/);
  assert.match(history, /서울 외환시장의 오후 3시 30분 기준가로, 뉴스와 한국은행 경제통계시스템\(ECOS\)이 쓰는 숫자입니다/);
  assert.doesNotMatch(history, /하나은행 고시 매매기준율\(15:30 직전 회차/);
  assert.match(history, /데이터 출처: 한국은행 ECOS\./);

  // The archive's USD/KRW column.
  assert.match(await page('/market/archive/'), /1,345\.90원/);

  // 1W: every session has a row, so the window reads ECOS; drop one and it reads the bank series.
  const range = async () => (await (await rangeRequest({ request: new Request(`${PROD}/api/market/range?period=1w`), env })).json()).instruments?.rates_fx_volatility?.USDKRW;
  assert.deepEqual([(await range()).baseline_value, (await range()).end_value], [1330, 1342.7], 'ECOS 11-19 to 11-26');
  db.database.prepare(`DELETE FROM ${FX_CLOSE_TABLE} WHERE market_date = '2026-11-24'`).run();
  assert.deepEqual([(await range()).baseline_value, (await range()).end_value], [1330.2, 1342.7], 'the bank series 11-19 to 11-26');

  // Trend lines: ECOS values, a day without a row has no point.
  const trend = await loadTrend(db, '2026-11-26');
  assert.deepEqual(trend.series.USDKRW, [1336.2, 1345.9, null, 1343.2, 1342.7]);

  // The card is drawn again once the 15:30 rate replaces the provisional rate.
  const meta = { sourceKey: cardSourceKey('2026-11-26T16:05:00+09:00', '', 'fxp') };
  const record = JSON.parse(MC_EXAMPLE);
  record.meta.generated_at = '2026-11-26T16:05:00+09:00';
  record.meta.market_date = '2026-11-26';
  record.rates_fx_volatility.USDKRW.basis = 'bank_provisional';
  assert.equal(marketCardIsStale(meta, record, ''), false);
  applyFxClose(record, fxDay('2026-11-26'));
  assert.equal(marketCardIsStale(meta, record, ''), true);
  assert.equal(cardSourceKey('g', '', ''), cardSourceKey('g'), 'a key without FX keeps its old form');

  // The blog text names what the figure is.
  const post23 = marketBlogPost(applyFxClose(JSON.parse(MC_EXAMPLE), { market_date: JSON.parse(MC_EXAMPLE).meta.market_date, previous_date: '2026-08-27', source: '한국은행 ECOS 원/달러(종가 15:30)', items: [{ code: 'USDKRW', value: 1370.1, previous_value: 1375 }] }), {});
  assert.ok(post23.body.includes('원/달러 1,370.10원 (15:30 기준가)'), post23.body);
});

test('TODAY and the home strip use the same labels; the guide variant links resolve', () => {
  assert.ok(MARKET_JS.includes("if (key === 'USDKRW' && item.basis === 'seoul_1530') return copy.seoulClose;"));
  assert.ok(MARKET_JS.includes("'한국은행 ECOS 원/달러(종가 15:30)': '한국은행 ECOS(원/달러 15:30)'"));
  assert.equal(L.todayStripBasis('snapshot', { source_date: '2026-11-26', basis: 'seoul_1530' }, 'ko', 'USDKRW'), '11/26 · 15:30 기준가');
  assert.equal(L.todayStripBasis('snapshot', { source_date: '2026-11-26', basis: 'bank_provisional' }, 'en', 'USDKRW'), 'NOV 26 · PROVISIONAL');
  assert.equal(L.todayStripBasis('snapshot', { source_date: '2026-11-26' }, 'ko', 'JPYKRW'), '11/26 · 하나은행 고시');

  const posts = JSON.parse(POSTS_JSON);
  const glossary = JSON.parse(GLOSSARY_JSON);
  const seoul = INDICATOR_GUIDES.USDKRW.seoul;
  for (const lang of ['ko', 'en']) {
    const ids = new Set(glossaryEntries(posts, glossary, lang).map(entry => glossaryTermId(entry.term)));
    const terms = seoul[lang].paragraphs.flatMap(text => [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(match => match[2] || match[1]));
    assert.ok(terms.length >= 3, lang);
    for (const term of terms) assert.ok(ids.has(glossaryTermId(term)), `${lang}: "${term}"`);
  }
});
