import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../functions/api/comments.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function loadHandler(scenario) {
  return (await import(`${moduleUrl}#${scenario}`)).onRequestGet;
}

const currentColumns = [
  'id', 'report_key', 'nickname', 'body', 'password_salt',
  'password_hash', 'ip_hash', 'created_at', 'deleted_at'
];

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.trim();
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    this.db.calls.push(this.sql);
    if (this.sql === 'PRAGMA table_info(comments)') {
      return { results: this.db.columns.map(name => ({ name })) };
    }
    if (this.sql.includes('SELECT id, nickname, body')) return { results: [] };
    throw new Error(`Unexpected all(): ${this.sql}`);
  }

  async first() {
    this.db.calls.push(this.sql);
    if (this.sql.includes('sqlite_master')) return null;
    throw new Error(`Unexpected first(): ${this.sql}`);
  }

  async run() {
    this.db.calls.push(this.sql);
    if (this.sql.startsWith('ALTER TABLE comments RENAME TO comments_legacy_v1')) {
      this.db.legacyColumns = [...this.db.columns];
      this.db.columns = [];
      return { success: true };
    }
    if (this.sql.startsWith('CREATE TABLE IF NOT EXISTS comments')) {
      this.db.columns = [...currentColumns];
      return { success: true };
    }
    if (this.sql.startsWith('DROP INDEX IF EXISTS')) return { success: true };
    if (this.sql.startsWith('CREATE INDEX IF NOT EXISTS')) return { success: true };
    throw new Error(`Unexpected run(): ${this.sql}`);
  }
}

class MockDb {
  constructor(columns) {
    this.columns = [...columns];
    this.legacyColumns = [];
    this.calls = [];
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

const legacyColumns = ['id', 'slug', 'nickname', 'body', 'status', 'created_at'];
const legacyDb = new MockDb(legacyColumns);
const legacyResponse = await (await loadHandler('legacy'))({
  request: new Request('https://example.com/api/comments?report=%2Freports%2Fsample.html'),
  env: { COMMENTS_DB: legacyDb }
});

assert.equal(legacyResponse.status, 200);
assert.deepEqual(legacyDb.legacyColumns, legacyColumns);
assert.deepEqual(legacyDb.columns, currentColumns);
assert.ok(legacyDb.calls.some(sql => sql.startsWith('ALTER TABLE comments RENAME TO comments_legacy_v1')));
assert.deepEqual(await legacyResponse.json(), { ok: true, comments: [] });

const currentDb = new MockDb(currentColumns);
const currentResponse = await (await loadHandler('current'))({
  request: new Request('https://example.com/api/comments?report=%2Freports%2Fsample.html'),
  env: { COMMENTS_DB: currentDb }
});

assert.equal(currentResponse.status, 200);
assert.deepEqual(currentDb.columns, currentColumns);
assert.equal(currentDb.calls.some(sql => sql.startsWith('ALTER TABLE comments')), false);
assert.deepEqual(await currentResponse.json(), { ok: true, comments: [] });

console.log('comments schema migration test passed');
