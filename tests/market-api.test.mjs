import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequestGet } from '../functions/api/market/latest.js';
import { onRequestPost } from '../functions/api/market/publish.js';
import { MAX_PAYLOAD_BYTES, validateMarketPayload } from '../functions/api/market/_shared.js';

const fixture = JSON.parse(await readFile(new URL('../contracts/market_close/market_close.example.json', import.meta.url), 'utf8'));
const schema = JSON.parse(await readFile(new URL('../contracts/market_close/market_close.schema.json', import.meta.url), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const legacyFixture = clone(fixture);
legacyFixture.meta.schema_version = '1.0.1';
delete legacyFixture.krx_groups;
const alignGroupDate = (payload, marketDate) => {
  for (const rows of Object.values(payload.krx_groups || {})) {
    for (const row of rows) row.source_date = marketDate;
  }
};

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

const environment = db => ({
  COMMENTS_DB: db,
  ADMIN_KEY: 'admin-secret',
  MARKET_PUBLISH_KEY: 'market-secret',
  ASSETS: { fetch: async request => new URL(request.url).pathname.endsWith('/market_close.schema.json') ? Response.json(schema) : new Response('Not found', { status: 404 }) }
});
const publishRequest = (payload, headers = {}, host = 'snowshagal.com') => new Request(`https://${host}/api/market/publish`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof payload === 'string' ? payload : JSON.stringify(payload)
});

test('authoritative example passes the schema-backed final validator', () => {
  assert.deepEqual(validateMarketPayload(fixture, schema), { passed: true, errors: [] });
});

test('legacy v1.0.1 payload remains publishable without krx_groups', () => {
  assert.deepEqual(validateMarketPayload(legacyFixture, schema), { passed: true, errors: [] });
});

test('legacy v1.0.1 payload can be stored and read back without krx_groups', async () => {
  const db = new MockDb();
  const published = await onRequestPost({
    request: publishRequest(legacyFixture, { 'x-market-publish-key': 'market-secret' }),
    env: environment(db)
  });
  assert.equal(published.status, 201);
  const response = await onRequestGet({ request: new Request('https://snowshagal.com/api/market/latest'), env: environment(db) });
  const payload = await response.json();
  assert.equal(payload.meta.schema_version, '1.0.1');
  assert.equal(Object.hasOwn(payload, 'krx_groups'), false);
});

test('validator rejects contract drift, incomplete data, wrong types, and final cardinality failures', () => {
  const extra = clone(fixture); extra.indices.KOSPI.invented = 1;
  assert.equal(validateMarketPayload(extra, schema).passed, false);
  const incomplete = clone(fixture); incomplete.meta.status = 'incomplete';
  assert.match(validateMarketPayload(incomplete, schema).errors.join('\n'), /final/);
  const wrongType = clone(fixture); wrongType.market_breadth.KOSPI.rise = 1.5;
  assert.match(validateMarketPayload(wrongType, schema).errors.join('\n'), /integer/);
  const shortList = clone(fixture); shortList.short_selling.top5_by_value.pop();
  assert.match(validateMarketPayload(shortList, schema).errors.join('\n'), /최소 5개/);
  const missing = clone(fixture); delete missing.market_internals.turnover.KOSDAQ;
  assert.match(validateMarketPayload(missing, schema).errors.join('\n'), /KOSDAQ/);
  const duplicate = clone(fixture); duplicate.krx_groups.sectors[1].index_code = duplicate.krx_groups.sectors[0].index_code;
  assert.match(validateMarketPayload(duplicate, schema).errors.join('\n'), /중복/);
  const duplicateTheme = clone(fixture); duplicateTheme.krx_groups.themes[1].index_code = duplicateTheme.krx_groups.themes[0].index_code;
  assert.match(validateMarketPayload(duplicateTheme, schema).errors.join('\n'), /중복/);
  const wrongDate = clone(fixture); wrongDate.krx_groups.themes[0].source_date = '2026-08-27';
  assert.match(validateMarketPayload(wrongDate, schema).errors.join('\n'), /market_date/);
  const nonFinite = clone(fixture); nonFinite.krx_groups.sectors[0].close = 'NaN';
  assert.match(validateMarketPayload(nonFinite, schema).errors.join('\n'), /number/);
  const missingGroups = clone(fixture); delete missingGroups.krx_groups;
  assert.match(validateMarketPayload(missingGroups, schema).errors.join('\n'), /krx_groups/);
});

test('publish fails closed on Preview, missing auth, invalid JSON, and oversized bodies', async () => {
  const db = new MockDb();
  let response = await onRequestPost({ request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }, 'preview.pages.dev'), env: environment(db) });
  assert.equal(response.status, 403);
  response = await onRequestPost({ request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }, 'market-research-site.pages.dev'), env: environment(db) });
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
  assert.equal(db.rows.size, 1);

  const older = clone(fixture);
  older.meta.market_date = '2026-08-27';
  alignGroupDate(older, older.meta.market_date);
  response = await onRequestPost({ request: publishRequest(older, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).is_latest, false);

  const latest = await onRequestGet({ request: new Request('https://snowshagal.com/api/market/latest'), env: environment(db) });
  assert.equal(latest.status, 200);
  const latestPayload = await latest.json();
  assert.equal(latestPayload.meta.market_date, fixture.meta.market_date);
  assert.deepEqual(latestPayload.krx_groups, repeated.krx_groups);
});

test('branch Preview accepts authenticated writes only into its supplied Preview DB', async () => {
  const previewDb = new MockDb();
  const response = await onRequestPost({
    request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }, 'feat-market-krx-groups.market-research-site.pages.dev'),
    env: environment(previewDb)
  });
  assert.equal(response.status, 201);
  assert.equal(previewDb.rows.size, 1);
  assert.equal(previewDb.rows.get(fixture.meta.market_date).payload_json, JSON.stringify(fixture));
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
