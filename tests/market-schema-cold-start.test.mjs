import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MarketDbError, ensureMarketTable, formatMarketResponse, TABLE_NAME } from '../functions/api/market/_shared.js';
import { onRequestGet as latestGet } from '../functions/api/market/latest.js';
import { onRequestGet as dateGet } from '../functions/api/market/date.js';
import { loadReportFacts } from '../functions/_report-facts.js';
import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';

const CURRENT_TABLE_SQL = `CREATE TABLE ${TABLE_NAME} (
        market_date TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        published_at TEXT NOT NULL,
        auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`;

// A D1 stand-in that answers the sqlite_master probe with `schema` and records
// every statement it runs.
function schemaDb(schema) {
  const runs = [];
  return {
    runs,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          if (/FROM sqlite_master/.test(sql)) {
            if (schema instanceof Error) throw schema;
            assert.deepEqual(args, [TABLE_NAME, 'idx_market_close_generated']);
            return schema;
          }
          return null;
        },
        async run() { runs.push(sql.trim().split(/\s+/).slice(0, 3).join(' ')); return { success: true }; }
      };
    }
  };
}

test('a current market table is confirmed with one read and no DDL', async () => {
  const db = schemaDb({ table_sql: CURRENT_TABLE_SQL, has_index: 1 });
  assert.equal(await ensureMarketTable({ COMMENTS_DB: db }), db);
  assert.deepEqual(db.runs, []);
});

test('anything short of the current schema runs the DDL as before', async () => {
  const cases = [
    ['no table yet', { table_sql: null, has_index: null }],
    ['no one-liner columns', { table_sql: CURRENT_TABLE_SQL.replace(/, takeaway_ko[\s\S]*$/, ')'), has_index: 1 }],
    ['no index', { table_sql: CURRENT_TABLE_SQL, has_index: null }],
    ['probe failed', new Error('no such table: sqlite_master')],
    ['probe answered nothing', null]
  ];
  for (const [label, schema] of cases) {
    const db = schemaDb(schema);
    const { logs } = await withConsole(() => ensureMarketTable({ COMMENTS_DB: db }));
    assert.deepEqual(db.runs, ['CREATE TABLE IF', 'ALTER TABLE market_close_snapshots', 'ALTER TABLE market_close_snapshots', 'CREATE INDEX IF'], label);
    assert.deepEqual(logs, [], `${label}: a schema created without trouble logs nothing`);
  }
});

// console.warn and console.error lines written while fn runs.
async function withConsole(fn) {
  const logs = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  try {
    return { result: await fn(), logs };
  } finally {
    Object.assign(console, original);
  }
}

// A real SQLite table whose schema statements fail the way D1 sometimes does:
// the sqlite_master probe and every DDL statement throw, ordinary reads work.
async function failingSchemaDb(dates = []) {
  const db = new SqliteD1();
  await ensureMarketTable({ COMMENTS_DB: db });
  const example = JSON.parse(await readFile(new URL('../contracts/market_close/market_close.example.v1.2.0.json', import.meta.url), 'utf8'));
  for (const date of dates) {
    const payload = { ...example, meta: { ...example.meta, market_date: date } };
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(date, payload.meta.schema_version, payload.meta.generated_at, 'final', JSON.stringify(payload), '2026-09-01T00:00:00.000Z', 'test', '', '')
      .run();
  }
  const healthy = db;
  const flaky = {
    prepare(sql) {
      const statement = healthy.prepare(sql);
      if (/sqlite_master|^\s*(CREATE|ALTER)\b/i.test(sql)) {
        const fail = async () => { throw new Error('D1_ERROR: Network connection lost.', { cause: new Error('upstream reset') }); };
        return { bind() { return this; }, first: fail, run: fail, all: fail };
      }
      return statement;
    }
  };
  return { healthy, flaky };
}

test('a read gets the database when the schema init fails; publishing still refuses', async () => {
  const { flaky } = await failingSchemaDb();
  const read = await withConsole(() => ensureMarketTable({ COMMENTS_DB: flaky }, { readOnly: true }));
  assert.equal(read.result, flaky);
  // One line: the failed statement, D1's error and cause, and what the probe saw.
  assert.deepEqual(read.logs, [
    'market close schema init failed, reading anyway: CREATE TABLE failed: D1_ERROR: Network connection lost. (cause: upstream reset) [probe failed: D1_ERROR: Network connection lost. (cause: upstream reset)]'
  ]);

  const write = await withConsole(() => ensureMarketTable({ COMMENTS_DB: flaky }).then(() => null, error => error));
  assert.ok(write.result instanceof MarketDbError);
  assert.equal(write.result.code, 'DB_INIT_FAILED');
  assert.equal(write.result.status, 500);
  assert.deepEqual(write.logs, [
    'market close schema init failed: CREATE TABLE failed: D1_ERROR: Network connection lost. (cause: upstream reset) [probe failed: D1_ERROR: Network connection lost. (cause: upstream reset)]'
  ]);
});

test('/api/market/latest and /api/market/date answer from the table when the schema init fails', async () => {
  const { healthy, flaky } = await failingSchemaDb(['2026-09-22', '2026-09-23']);
  const expected = formatMarketResponse(
    await healthy.prepare(`SELECT market_date, generated_at, published_at, payload_json, takeaway_ko, takeaway_en FROM ${TABLE_NAME} WHERE market_date = ?`).bind('2026-09-23').first(),
    new Request('https://snowshagal.com/api/market/latest')
  );
  const expectedBody = await expected.text();
  const now = new Date('2026-09-23T18:00:00+09:00');

  const latest = await withConsole(() => latestGet({ request: new Request('https://snowshagal.com/api/market/latest'), env: { COMMENTS_DB: flaky }, now }));
  assert.equal(latest.result.status, 200);
  assert.equal(await latest.result.text(), expectedBody);
  assert.equal(latest.result.headers.get('etag'), expected.headers.get('etag'));

  const date = await withConsole(() => dateGet({ request: new Request('https://snowshagal.com/api/market/date?date=2026-09-22'), env: { COMMENTS_DB: flaky } }));
  assert.equal(date.result.status, 200);
  assert.equal(JSON.parse(await date.result.text()).meta.market_date, '2026-09-22');
});

test('report facts give up on D1 that does not answer within the budget', async () => {
  const hanging = { prepare() { return { bind() { return this; }, first: () => new Promise(() => {}), run: () => new Promise(() => {}) }; } };
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const started = Date.now();
    const facts = await loadReportFacts({ COMMENTS_DB: hanging }, { type: 'daily', reportDate: '2026-10-28' }, { budgetMs: 30 });
    assert.equal(facts, null);
    assert.ok(Date.now() - started < 1000, 'returned at the budget, not when D1 answered');
    assert.ok(errors.some(line => /report facts unavailable/.test(line) && /30 ms/.test(line)));
  } finally {
    console.error = originalError;
  }
});
