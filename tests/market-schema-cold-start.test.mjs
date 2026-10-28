import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMarketTable, TABLE_NAME } from '../functions/api/market/_shared.js';
import { loadReportFacts } from '../functions/_report-facts.js';

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
    await ensureMarketTable({ COMMENTS_DB: db });
    assert.deepEqual(db.runs, ['CREATE TABLE IF', 'ALTER TABLE market_close_snapshots', 'ALTER TABLE market_close_snapshots', 'CREATE INDEX IF'], label);
  }
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
