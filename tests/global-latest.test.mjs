// Global Latest receiver (B1): contract, per-instrument monotonic storage and
// the publish/read API, on a real in-memory SQLite standing in for D1 with the
// checked-in migration applied.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import {
  GLOBAL_CODES,
  GLOBAL_LATEST_TABLE,
  planGlobalLatestWrites,
  validateGlobalLatestDocument
} from '../functions/api/market/global/_shared.js';
import { onRequestPost as publish } from '../functions/api/market/global/publish.js';
import { onRequestGet as latest } from '../functions/api/market/global/latest.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [MIGRATION, SCHEMA_SQL, SCHEMA_JSON, EXAMPLE, CONTRACT_MD] = await Promise.all([
  read('migrations/comments/0002_market_global_latest.sql'), read('db/schema.sql'),
  read('contracts/global_latest/global_latest.schema.json'), read('contracts/global_latest/global_latest.example.json'),
  read('contracts/global_latest/GLOBAL_LATEST_CONTRACT.md')
]);

const KEY = 'test-publish-key';
const PROD = 'https://snowshagal.com';
const PREVIEW = 'https://feat-market-global-latest-api.market-research-site.pages.dev';
const NOW = new Date('2026-09-24T14:00:00Z');

function item(code, overrides = {}) {
  const value = overrides.value ?? 100;
  const previous = 'previous_close' in overrides ? overrides.previous_close : 99;
  const base = {
    code,
    ticker: `T-${code}`,
    value,
    previous_close: previous,
    change: previous === null ? null : +(value - previous).toFixed(6),
    change_pct: previous === null ? null : +((value / previous - 1) * 100).toFixed(6),
    source_date: '2026-09-24',
    as_of: '2026-09-24T13:30:00Z',
    retrieved_at: '2026-09-24T13:31:00Z',
    data_state: 'intraday',
    source: 'preview-global-latest-fixture'
  };
  return { ...base, ...overrides };
}

function doc(items, overrides = {}) {
  return { schema_version: '1.0.0', generated_at: '2026-09-24T13:32:00Z', items, ...overrides };
}

function database({ migrated = true } = {}) {
  const db = new SqliteD1();
  if (migrated) db.exec(MIGRATION);
  return db;
}

function rows(db) {
  return db.database.prepare(`SELECT * FROM ${GLOBAL_LATEST_TABLE} ORDER BY code`).all();
}

async function post(db, body, { origin = PROD, key = KEY, now = NOW, raw } = {}) {
  const request = new Request(`${origin}/api/market/global/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { 'x-market-publish-key': key } : {}) },
    body: raw ?? JSON.stringify(body)
  });
  const response = await publish({ request, env: { COMMENTS_DB: db, MARKET_PUBLISH_KEY: KEY }, now });
  return { status: response.status, body: await response.json() };
}

async function get(db, headers = {}) {
  const response = await latest({ request: new Request(`${PROD}/api/market/global/latest`, { headers }), env: { COMMENTS_DB: db } });
  return { response, body: response.status === 200 ? await response.json() : null };
}

const errorsOf = document => validateGlobalLatestDocument(document, NOW.getTime()).errors.join('\n');

/* ------------------------------------------------------------ contract */

test('exactly the twelve canonical codes; the schema enum, example and doc agree with the allowlist', () => {
  assert.deepEqual([...GLOBAL_CODES], ['NASDAQ', 'DOW', 'SP500', 'SOX', 'VIX', 'US10Y', 'USDKRW', 'JPYKRW', 'DXY', 'WTI', 'GOLD', 'BITCOIN']);
  const schema = JSON.parse(SCHEMA_JSON);
  assert.deepEqual(schema.$defs.item.properties.code.enum, [...GLOBAL_CODES]);
  assert.equal(schema.properties.items.maxItems, GLOBAL_CODES.length);
  assert.ok(!GLOBAL_CODES.includes('KOSPI') && !GLOBAL_CODES.includes('KOSDAQ'));
  for (const code of GLOBAL_CODES) assert.match(CONTRACT_MD, new RegExp(`\`${code}\``));
  const example = JSON.parse(EXAMPLE);
  assert.deepEqual(validateGlobalLatestDocument(example, Date.parse('2026-09-24T14:00:00Z')).errors, []);
});

test('a partial batch is valid; one to twelve items, each code once, no unknown code or field', () => {
  assert.equal(validateGlobalLatestDocument(doc([item('SOX')]), NOW.getTime()).passed, true);
  assert.equal(validateGlobalLatestDocument(doc(GLOBAL_CODES.map(code => item(code))), NOW.getTime()).passed, true);
  assert.match(errorsOf(doc([])), /1 to 12 items/);
  assert.match(errorsOf(doc([item('SOX'), item('SOX')])), /appears more than once/);
  assert.match(errorsOf(doc([item('KOSPI')])), /not a Global Latest instrument/);
  assert.match(errorsOf(doc([{ ...item('SOX'), extra: 1 }])), /extra: unknown field/);
  assert.match(errorsOf(doc([item('SOX')], { schema_version: '1.2.0' })), /schema_version/);
  assert.match(errorsOf(doc([item('SOX')], { extra: true })), /\$\.extra: unknown field/);
  const missing = item('SOX');
  delete missing.ticker;
  assert.match(errorsOf(doc([missing])), /ticker: required/);
  assert.match(errorsOf(doc([item('SOX', { data_state: 'unavailable' })])), /data_state/);
  assert.match(errorsOf(doc([item('SOX', { source: '' })])), /source/);
});

test('numbers are finite; previous_close null ⇔ change null; change must agree with value and previous_close', () => {
  assert.match(errorsOf(doc([item('SOX', { value: 'NaN' })])), /value: finite number/);
  assert.match(errorsOf(JSON.parse(JSON.stringify(doc([item('SOX', { value: null })])))), /value: finite number/);
  assert.equal(validateGlobalLatestDocument(doc([item('SOX', { previous_close: null })]), NOW.getTime()).passed, true);
  assert.match(errorsOf(doc([item('SOX', { previous_close: null, change: 1, change_pct: 1 })])), /must be null when previous_close is null/);
  assert.match(errorsOf(doc([item('SOX', { change: null })])), /required when previous_close is present/);
  assert.match(errorsOf(doc([item('SOX', { change: -1 })])), /change: -1 contradicts/);
  assert.match(errorsOf(doc([item('SOX', { change_pct: 5 })])), /change_pct: 5 contradicts/);
  assert.match(errorsOf(doc([item('SOX', { previous_close: 0, change: 100, change_pct: 0 })])), /previous_close: must be positive/);
  // Rounding is not a contradiction.
  assert.equal(validateGlobalLatestDocument(doc([item('US10Y', { value: 5.11, previous_close: 5.071, change: 0.04, change_pct: 0.77 })]), NOW.getTime()).passed, true);
  assert.equal(validateGlobalLatestDocument(doc([item('BITCOIN', { value: 83883.81, previous_close: 84383.01, change: -499.2, change_pct: -0.59 })]), NOW.getTime()).passed, true);
  // A sign flip is.
  assert.match(errorsOf(doc([item('US10Y', { value: 5.11, previous_close: 5.071, change: -0.039, change_pct: -0.77 })])), /contradicts/);
});

test('timestamps: strict ISO with offset, as_of ≤ retrieved_at, at most 5 minutes ahead', () => {
  assert.match(errorsOf(doc([item('SOX', { as_of: '2026-09-24 13:30' })])), /as_of: ISO date-time/);
  assert.match(errorsOf(doc([item('SOX', { as_of: '2026-09-24T13:30:00' })])), /as_of: ISO date-time/);
  assert.match(errorsOf(doc([item('SOX', { retrieved_at: 'yesterday' })])), /retrieved_at: ISO date-time/);
  assert.match(errorsOf(doc([item('SOX', { as_of: '2026-09-24T13:40:00Z', retrieved_at: '2026-09-24T13:35:00Z' })])), /later than retrieved_at/);
  assert.match(errorsOf(doc([item('SOX', { as_of: '2026-09-24T14:06:00Z', retrieved_at: '2026-09-24T14:06:00Z' })])), /as_of: in the future/);
  assert.match(errorsOf(doc([item('SOX')], { generated_at: '2026-09-24T14:10:00Z' })), /generated_at: in the future/);
  assert.equal(validateGlobalLatestDocument(doc([item('SOX', { as_of: '2026-09-24T14:04:00Z', retrieved_at: '2026-09-24T14:04:30+00:00' })]), NOW.getTime()).passed, true);
  assert.equal(validateGlobalLatestDocument(doc([item('SOX', { as_of: '2026-09-24T22:30:00+09:00', retrieved_at: '2026-09-24T22:31:00+09:00' })]), NOW.getTime()).passed, true);
});

test('source_date: a real date, not beyond tomorrow; completed US closes only on NYSE trading dates', () => {
  assert.match(errorsOf(doc([item('SOX', { source_date: '2026-02-30' })])), /source_date: YYYY-MM-DD/);
  assert.match(errorsOf(doc([item('SOX', { source_date: '2026-09-27' })])), /source_date: in the future/);
  // Next-day session date (Asia) is allowed; UTC date of as_of is not forced.
  assert.equal(validateGlobalLatestDocument(doc([item('USDKRW', { source_date: '2026-09-25' })]), NOW.getTime()).passed, true);
  for (const code of ['NASDAQ', 'DOW', 'SP500', 'SOX', 'VIX', 'US10Y']) {
    const closed = { data_state: 'final_close', source_date: '2026-09-07', as_of: '2026-09-07T20:00:00Z' }; // Labor Day
    assert.match(errorsOf(doc([item(code, closed)])), /not an NYSE trading date/, code);
    assert.equal(validateGlobalLatestDocument(doc([item(code, { ...closed, source_date: '2026-09-08', as_of: '2026-09-08T20:00:00Z' })]), NOW.getTime()).passed, true, code);
    // Intraday is trusted for its session date (format only).
    assert.equal(validateGlobalLatestDocument(doc([item(code, { source_date: '2026-09-24' })]), NOW.getTime()).passed, true, code);
  }
  // FX, DXY, commodities and bitcoin are not held to the NYSE calendar.
  for (const code of ['USDKRW', 'JPYKRW', 'DXY', 'WTI', 'GOLD', 'BITCOIN']) {
    assert.equal(validateGlobalLatestDocument(doc([item(code, { data_state: 'final_close', source_date: '2026-09-07', as_of: '2026-09-07T20:00:00Z' })]), NOW.getTime()).passed, true, code);
  }
});

/* ------------------------------------------------------------ storage rules */

test('plan: created, newer as_of, later retrieval, identical re-post, older, conflict', () => {
  const entry = (code, asOf, retrievedAt, extra = {}) => ({ item: { code, value: 1, ...extra }, asOf, retrievedAt });
  const stored = [
    { code: 'DOW', as_of: '2026-09-24T13:00:00.000Z', retrieved_at: '2026-09-24T13:01:00.000Z', payload_json: JSON.stringify({ code: 'DOW', value: 1 }) },
    { code: 'SOX', as_of: '2026-09-24T13:00:00.000Z', retrieved_at: '2026-09-24T13:01:00.000Z', payload_json: JSON.stringify({ code: 'SOX', value: 1 }) },
    { code: 'VIX', as_of: '2026-09-24T13:00:00.000Z', retrieved_at: '2026-09-24T13:01:00.000Z', payload_json: JSON.stringify({ code: 'VIX', value: 1 }) },
    { code: 'GOLD', as_of: '2026-09-24T13:00:00.000Z', retrieved_at: '2026-09-24T13:01:00.000Z', payload_json: JSON.stringify({ code: 'GOLD', value: 1 }) },
    { code: 'WTI', as_of: '2026-09-24T13:00:00.000Z', retrieved_at: '2026-09-24T13:01:00.000Z', payload_json: JSON.stringify({ code: 'WTI', value: 1 }) },
    { code: 'DXY', as_of: '2026-09-24T13:00:00.000Z', retrieved_at: '2026-09-24T13:01:00.000Z', payload_json: JSON.stringify({ code: 'DXY', value: 1 }) }
  ];
  const plan = planGlobalLatestWrites([
    entry('NASDAQ', '2026-09-24T13:00:00.000Z', '2026-09-24T13:01:00.000Z'),
    entry('DOW', '2026-09-24T13:30:00.000Z', '2026-09-24T13:31:00.000Z'),
    entry('SOX', '2026-09-24T13:00:00.000Z', '2026-09-24T13:05:00.000Z'),
    entry('VIX', '2026-09-24T13:00:00.000Z', '2026-09-24T13:01:00.000Z'),
    entry('GOLD', '2026-09-24T12:00:00.000Z', '2026-09-24T13:59:00.000Z'),
    entry('WTI', '2026-09-24T13:00:00.000Z', '2026-09-24T13:00:30.000Z'),
    entry('DXY', '2026-09-24T13:00:00.000Z', '2026-09-24T13:01:00.000Z', { value: 2 })
  ], stored);
  assert.deepEqual(plan.created, ['NASDAQ']);
  assert.deepEqual(plan.updated, ['DOW', 'SOX']);
  assert.deepEqual(plan.unchanged, ['VIX']);
  assert.deepEqual(plan.skipped_older, ['GOLD', 'WTI']);
  assert.deepEqual(plan.skipped_conflict, ['DXY']);
  assert.deepEqual(plan.write.map(entry => entry.item.code), ['NASDAQ', 'DOW', 'SOX']);
});

test('publish → read: create, idempotent re-post, older rejected, mixed batch updates only the newer', async () => {
  const db = database();
  const first = await post(db, doc([item('NASDAQ'), item('SOX'), item('GOLD')]));
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.created, ['NASDAQ', 'SOX', 'GOLD']);
  assert.equal(rows(db).length, 3);

  const again = await post(db, doc([item('NASDAQ'), item('SOX'), item('GOLD')]));
  assert.deepEqual(again.body.unchanged, ['NASDAQ', 'SOX', 'GOLD']);
  assert.equal(again.body.published_at, null);

  const older = await post(db, doc([item('SOX', { value: 50, as_of: '2026-09-24T13:00:00Z', retrieved_at: '2026-09-24T13:59:00Z' })]));
  assert.deepEqual(older.body.skipped_older, ['SOX']);
  assert.equal(JSON.parse(rows(db).find(row => row.code === 'SOX').payload_json).value, 100);

  const mixed = await post(db, doc([
    item('NASDAQ', { value: 101, as_of: '2026-09-24T13:45:00Z', retrieved_at: '2026-09-24T13:46:00Z' }),
    item('SOX', { value: 102, as_of: '2026-09-24T13:45:00Z', retrieved_at: '2026-09-24T13:46:00Z' }),
    item('GOLD', { value: 1, as_of: '2026-09-24T12:00:00Z', retrieved_at: '2026-09-24T13:46:00Z' })
  ]));
  assert.deepEqual(mixed.body.updated, ['NASDAQ', 'SOX']);
  assert.deepEqual(mixed.body.skipped_older, ['GOLD']);
  const stored = Object.fromEntries(rows(db).map(row => [row.code, row]));
  assert.equal(JSON.parse(stored.NASDAQ.payload_json).value, 101);
  assert.equal(JSON.parse(stored.GOLD.payload_json).value, 100);
  assert.equal(stored.NASDAQ.as_of, '2026-09-24T13:45:00.000Z');

  // Same observation, retrieved later: stored retrieved_at moves forward, as_of does not move.
  const later = await post(db, doc([item('GOLD', { retrieved_at: '2026-09-24T13:50:00Z' })]));
  assert.deepEqual(later.body.updated, ['GOLD']);
  assert.equal(rows(db).find(row => row.code === 'GOLD').retrieved_at, '2026-09-24T13:50:00.000Z');
  // ...and never backwards.
  const earlierRetrieval = await post(db, doc([item('GOLD', { retrieved_at: '2026-09-24T13:40:00Z' })]));
  assert.deepEqual(earlierRetrieval.body.skipped_older, ['GOLD']);
  assert.equal(rows(db).find(row => row.code === 'GOLD').retrieved_at, '2026-09-24T13:50:00.000Z');
});

test('the upsert itself refuses to move a row backwards (race between read and write)', async () => {
  const db = database();
  await post(db, doc([item('VIX', { as_of: '2026-09-24T13:50:00Z', retrieved_at: '2026-09-24T13:51:00Z' })]));
  const { upsertStatement } = await import('../functions/api/market/global/_shared.js');
  const stale = { item: item('VIX', { value: 1 }), asOf: '2026-09-24T13:00:00.000Z', retrievedAt: '2026-09-24T13:01:00.000Z' };
  await upsertStatement(db, stale, '2026-09-24T14:00:00.000Z', 'test').run();
  assert.equal(rows(db)[0].as_of, '2026-09-24T13:50:00.000Z');
});

test('an invalid request writes nothing, even when other items are valid', async () => {
  const db = database();
  for (const bad of [
    doc([item('NASDAQ'), item('KOSPI')]),
    doc([item('NASDAQ'), item('NASDAQ')]),
    doc([item('NASDAQ'), item('SOX', { as_of: '2026-09-24T15:00:00Z', retrieved_at: '2026-09-24T15:00:00Z' })]),
    doc([item('NASDAQ'), item('SOX', { as_of: 'not a time' })])
  ]) {
    const response = await post(db, bad);
    assert.equal(response.status, 422);
    assert.equal(response.body.error, 'VALIDATION_FAILED');
  }
  assert.equal(rows(db).length, 0);
  assert.equal((await post(db, null, { raw: '{"schema_version":' })).status, 400);
  assert.equal(rows(db).length, 0);
});

test('accepted rows are written in one batch: a failure part-way writes none of them', async () => {
  const db = database();
  let statements = 0;
  const failing = {
    prepare: sql => {
      const statement = db.prepare(sql);
      if (!/^INSERT/.test(sql.trim())) return statement;
      const run = statement.run.bind(statement);
      return Object.assign(statement, { run: async () => { statements += 1; if (statements === 2) throw new Error('d1 write failed'); return run(); } });
    },
    batch: statements => db.batch(statements)
  };
  const request = new Request(`${PROD}/api/market/global/publish`, { method: 'POST', headers: { 'x-market-publish-key': KEY }, body: JSON.stringify(doc([item('NASDAQ'), item('SOX'), item('GOLD')])) });
  const response = await publish({ request, env: { COMMENTS_DB: failing, MARKET_PUBLISH_KEY: KEY }, now: NOW });
  assert.equal(response.status, 500);
  assert.equal(rows(db).length, 0);
});

/* ------------------------------------------------------------ API */

test('auth and hosts: key required; Production and branch Preview write; bare Pages and unknown hosts are blocked', async () => {
  const db = database();
  assert.equal((await post(db, doc([item('SOX')]), { key: null })).status, 401);
  assert.equal((await post(db, doc([item('SOX')]), { key: 'wrong' })).status, 401);
  assert.equal((await post(db, doc([item('SOX')]), { origin: 'https://market-research-site.pages.dev' })).status, 403);
  assert.equal((await post(db, doc([item('SOX')]), { origin: 'https://example.com' })).status, 403);
  assert.equal(rows(db).length, 0);
  assert.equal((await post(db, doc([item('SOX')]), { origin: PREVIEW })).status, 200);
  assert.equal((await post(db, doc([item('DOW')]), { origin: PROD })).status, 200);
  assert.equal(rows(db).length, 2);
  assert.ok(rows(db).every(row => row.auth_source === 'market-publish-key'));
});

test('GET: empty table is 200 with no items; populated in canonical order; auth_source never leaks', async () => {
  const db = database();
  const empty = await get(db);
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.body, { schema_version: '1.0.0', items: [] });
  await post(db, doc([item('BITCOIN'), item('NASDAQ'), item('US10Y', { data_state: 'final_close', source_date: '2026-09-23', as_of: '2026-09-23T19:00:00Z' })]));
  const { response, body } = await get(db);
  assert.equal(response.status, 200);
  assert.deepEqual(body.items.map(entry => entry.code), ['NASDAQ', 'US10Y', 'BITCOIN']);
  assert.deepEqual(Object.keys(body.items[0]).sort(), ['as_of', 'change', 'change_pct', 'code', 'data_state', 'previous_close', 'published_at', 'retrieved_at', 'source', 'source_date', 'ticker', 'value']);
  assert.doesNotMatch(JSON.stringify(body), /auth_source|market-publish-key/);
  assert.equal(body.items[1].as_of, '2026-09-23T19:00:00Z', 'timestamps are returned as published');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30, s-maxage=60');
});

test('GET ETag follows the stored observations; If-None-Match answers 304', async () => {
  const db = database();
  await post(db, doc([item('SOX')]));
  const first = await get(db);
  const etag = first.response.headers.get('etag');
  assert.match(etag, /^W\/"global-1-/);
  const revalidated = await get(db, { 'if-none-match': etag });
  assert.equal(revalidated.response.status, 304);
  await post(db, doc([item('SOX', { value: 101, as_of: '2026-09-24T13:45:00Z', retrieved_at: '2026-09-24T13:46:00Z' })]));
  const changed = await get(db, { 'if-none-match': etag });
  assert.equal(changed.response.status, 200);
  assert.notEqual(changed.response.headers.get('etag'), etag);
});

test('without the migration both endpoints answer 503 and nothing creates the table', async () => {
  const db = database({ migrated: false });
  const read = await latest({ request: new Request(`${PROD}/api/market/global/latest`), env: { COMMENTS_DB: db } });
  assert.equal(read.status, 503);
  assert.equal((await read.json()).error, 'GLOBAL_LATEST_SCHEMA_NOT_READY');
  const write = await post(db, doc([item('SOX')]));
  assert.equal(write.status, 503);
  assert.equal(write.body.error, 'GLOBAL_LATEST_SCHEMA_NOT_READY');
  assert.equal(db.database.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?`).get(GLOBAL_LATEST_TABLE).n, 0);
  const noBinding = await latest({ request: new Request(`${PROD}/api/market/global/latest`), env: {} });
  assert.equal(noBinding.status, 503);
});

test('no runtime DDL; the migration is idempotent and matches db/schema.sql', async () => {
  for (const file of ['functions/api/market/global/_shared.js', 'functions/api/market/global/publish.js', 'functions/api/market/global/latest.js']) {
    assert.doesNotMatch(await read(file), /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i, file);
  }
  const db = database();
  db.exec(MIGRATION);
  const create = MIGRATION.slice(MIGRATION.indexOf('CREATE TABLE'));
  assert.ok(SCHEMA_SQL.includes(create.trim()), 'db/schema.sql carries the same table definition');
  const statements = MIGRATION.split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(statements, /market_close_snapshots|DROP|DELETE|UPDATE\s|INSERT/i);
  assert.equal((statements.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/g) || []).length, 1);
  assert.doesNotMatch(statements, /CREATE\s+(UNIQUE\s+)?INDEX/i, 'code is the primary key; no extra index');
  assert.throws(() => db.database.prepare(`INSERT INTO ${GLOBAL_LATEST_TABLE} VALUES ('SOX','1.0.0','2026-09-24','a','b','unavailable','{}','c','d')`).run(), /CHECK/);
});
