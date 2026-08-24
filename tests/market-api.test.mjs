import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequestGet } from '../functions/api/market/latest.js';
import { onRequestPost } from '../functions/api/market/publish.js';
import { MAX_PAYLOAD_BYTES, validateMarketPayload } from '../functions/api/market/_shared.js';

const fixture = JSON.parse(await readFile(new URL('../contracts/market_close/market_close.example.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

class MockStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    if (/WHERE market_date = \?/i.test(this.sql)) return this.db.rows.get(this.args[0]) || null;
    if (/ORDER BY market_date DESC/i.test(this.sql)) {
      const key = [...this.db.rows.keys()].sort().at(-1);
      return key ? this.db.rows.get(key) : null;
    }
    return null;
  }
  async run() {
    this.db.calls.push({ sql: this.sql, args: this.args });
    if (/INSERT INTO market_close_snapshots/i.test(this.sql)) {
      const [market_date, schema_version, generated_at, status, payload_json, published_at, auth_source] = this.args;
      this.db.rows.set(market_date, { market_date, schema_version, generated_at, status, payload_json, published_at, auth_source });
    }
    return { success: true };
  }
}

class MockDb {
  constructor() { this.rows = new Map(); this.calls = []; }
  prepare(sql) { return new MockStatement(this, sql); }
}

const environment = db => ({ COMMENTS_DB: db, ADMIN_KEY: 'admin-secret', MARKET_PUBLISH_KEY: 'market-secret' });
const publishRequest = (payload, headers = {}, host = 'snowshagal.com') => new Request(`https://${host}/api/market/publish`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof payload === 'string' ? payload : JSON.stringify(payload)
});

test('authoritative example passes the schema-backed final validator', () => {
  assert.deepEqual(validateMarketPayload(fixture), { passed: true, errors: [] });
});

test('validator rejects contract drift, incomplete data, wrong types, and final cardinality failures', () => {
  const extra = clone(fixture); extra.indices.KOSPI.invented = 1;
  assert.equal(validateMarketPayload(extra).passed, false);
  const incomplete = clone(fixture); incomplete.meta.status = 'incomplete';
  assert.match(validateMarketPayload(incomplete).errors.join('\n'), /final/);
  const wrongType = clone(fixture); wrongType.market_breadth.KOSPI.rise = 1.5;
  assert.match(validateMarketPayload(wrongType).errors.join('\n'), /integer/);
  const shortList = clone(fixture); shortList.short_selling.top5_by_value.pop();
  assert.match(validateMarketPayload(shortList).errors.join('\n'), /최소 5개/);
  const missing = clone(fixture); delete missing.market_internals.turnover.KOSDAQ;
  assert.match(validateMarketPayload(missing).errors.join('\n'), /KOSDAQ/);
});

test('publish fails closed on Preview, missing auth, invalid JSON, and oversized bodies', async () => {
  const db = new MockDb();
  let response = await onRequestPost({ request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }, 'preview.pages.dev'), env: environment(db) });
  assert.equal(response.status, 403);
  response = await onRequestPost({ request: publishRequest(fixture), env: environment(db) });
  assert.equal(response.status, 401);
  response = await onRequestPost({ request: publishRequest('{broken', { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  assert.equal(response.status, 400);
  response = await onRequestPost({ request: publishRequest('{}', { 'x-market-publish-key': 'market-secret', 'content-length': String(MAX_PAYLOAD_BYTES + 1) }), env: environment(db) });
  assert.equal(response.status, 413);
  assert.equal(db.rows.size, 0);
});

test('publish accepts automated and admin auth, upserts same dates, and never rolls latest backward', async () => {
  const db = new MockDb();
  let response = await onRequestPost({ request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  assert.equal(response.status, 201);
  let result = await response.json();
  assert.equal(result.action, 'created');
  assert.equal(result.is_latest, true);

  const repeated = clone(fixture); repeated.indices.KOSPI.close = 6697;
  response = await onRequestPost({ request: publishRequest(repeated, { 'x-admin-key': 'admin-secret' }), env: environment(db) });
  assert.equal(response.status, 200);
  result = await response.json();
  assert.equal(result.action, 'updated');

  const older = clone(fixture);
  older.meta.market_date = '2026-08-21';
  response = await onRequestPost({ request: publishRequest(older, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).is_latest, false);

  const latest = await onRequestGet({ request: new Request('https://snowshagal.com/api/market/latest'), env: environment(db) });
  assert.equal(latest.status, 200);
  assert.equal((await latest.json()).meta.market_date, '2026-08-24');
});

test('latest returns an explicit empty state, cache headers, and ETag revalidation', async () => {
  const db = new MockDb();
  let response = await onRequestGet({ request: new Request('https://preview.pages.dev/api/market/latest'), env: environment(db) });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'NO_MARKET_DATA');

  await onRequestPost({ request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  response = await onRequestGet({ request: new Request('https://snowshagal.com/api/market/latest'), env: environment(db) });
  assert.match(response.headers.get('cache-control'), /s-maxage=120/);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  const cached = await onRequestGet({ request: new Request('https://snowshagal.com/api/market/latest', { headers: { 'if-none-match': etag } }), env: environment(db) });
  assert.equal(cached.status, 304);
});

test('invalid final payload is rejected before D1 writes', async () => {
  const db = new MockDb();
  const invalid = clone(fixture); invalid.validation.errors = ['source failed']; invalid.validation.passed = false;
  const response = await onRequestPost({ request: publishRequest(invalid, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  assert.equal(response.status, 422);
  const result = await response.json();
  assert.equal(result.error, 'VALIDATION_FAILED');
  assert.equal(db.calls.length, 0);
});
