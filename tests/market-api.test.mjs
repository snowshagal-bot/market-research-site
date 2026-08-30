import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequestGet as onRequestGetLatest } from '../functions/api/market/latest.js';
import { onRequestGet as onRequestGetDate } from '../functions/api/market/date.js';
import { onRequestGet as onRequestGetDates } from '../functions/api/market/dates.js';
import { onRequestPost } from '../functions/api/market/publish.js';
import { MAX_PAYLOAD_BYTES, isValidMarketDate, validateMarketPayload } from '../functions/api/market/_shared.js';

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
  async all() {
    if (/SELECT market_date FROM/i.test(this.sql)) {
      const sortedKeys = [...this.db.rows.keys()].sort().reverse();
      return { results: sortedKeys.map(k => ({ market_date: k })) };
    }
    return { results: [] };
  }
  async run() {
    this.db.calls.push({ sql: this.sql, args: this.args });
    if (/INSERT INTO market_close_snapshots/i.test(this.sql)) {
      const [market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en] = this.args;
      this.db.rows.set(market_date, { market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en });
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
  const response = await onRequestGetLatest({ request: new Request('https://snowshagal.com/api/market/latest'), env: environment(db) });
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

  const latest = await onRequestGetLatest({ request: new Request('https://snowshagal.com/api/market/latest'), env: environment(db) });
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
  let response = await onRequestGetLatest({ request: new Request('https://preview.pages.dev/api/market/latest'), env: environment(db) });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'NO_MARKET_DATA');

  await onRequestPost({ request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  response = await onRequestGetLatest({ request: new Request('https://snowshagal.com/api/market/latest'), env: environment(db) });
  assert.match(response.headers.get('cache-control'), /s-maxage=120/);
  const etag = response.headers.get('etag');
  assert.ok(etag);
  const cached = await onRequestGetLatest({ request: new Request('https://snowshagal.com/api/market/latest', { headers: { 'if-none-match': etag } }), env: environment(db) });
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

test('isValidMarketDate validates calendar integrity strictly', () => {
  assert.equal(isValidMarketDate('2026-08-28'), true);
  assert.equal(isValidMarketDate('1900-01-01'), true);
  assert.equal(isValidMarketDate('2024-02-29'), true); // leap year
  assert.equal(isValidMarketDate('2025-02-29'), false); // non-leap year
  assert.equal(isValidMarketDate('2026-02-30'), false);
  assert.equal(isValidMarketDate('2026-99-99'), false);
  assert.equal(isValidMarketDate('abc'), false);
  assert.equal(isValidMarketDate(''), false);
  assert.equal(isValidMarketDate(null), false);
  assert.equal(isValidMarketDate(undefined), false);
});

test('GET /api/market/date validates date format and returns 400 on malformed or impossible dates', async () => {
  const db = new MockDb();
  let res = await onRequestGetDate({ request: new Request('https://snowshagal.com/api/market/date?date=abc'), env: environment(db) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_DATE');

  res = await onRequestGetDate({ request: new Request('https://snowshagal.com/api/market/date?date=2026-99-99'), env: environment(db) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_DATE');

  res = await onRequestGetDate({ request: new Request('https://snowshagal.com/api/market/date?date=2026-02-30'), env: environment(db) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_DATE');

  res = await onRequestGetDate({ request: new Request('https://snowshagal.com/api/market/date'), env: environment(db) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_DATE');
});

test('GET /api/market/date returns 404 on missing date without falling back to latest', async () => {
  const db = new MockDb();
  await onRequestPost({ request: publishRequest(fixture, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });

  const res = await onRequestGetDate({ request: new Request('https://snowshagal.com/api/market/date?date=2026-08-20'), env: environment(db) });
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error, 'MARKET_DATE_NOT_FOUND');
});

test('GET /api/market/date returns exact row with paired takeaway and supports ETag revalidation', async () => {
  const db = new MockDb();
  const envelope = {
    market: fixture,
    takeaway: { ko: '8월 28일 마감 코멘트', en: 'August 28 market comment' }
  };
  await onRequestPost({ request: publishRequest(envelope, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });

  const res = await onRequestGetDate({ request: new Request(`https://snowshagal.com/api/market/date?date=${fixture.meta.market_date}`), env: environment(db) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.meta.market_date, fixture.meta.market_date);
  assert.equal(data.takeaway.ko, '8월 28일 마감 코멘트');
  assert.equal(data.takeaway.en, 'August 28 market comment');
  assert.equal(data.krx_groups.sectors.length, 46);
  assert.equal(data.krx_groups.themes.length, 39);

  const etag = res.headers.get('etag');
  assert.ok(etag);
  const cached = await onRequestGetDate({
    request: new Request(`https://snowshagal.com/api/market/date?date=${fixture.meta.market_date}`, { headers: { 'if-none-match': etag } }),
    env: environment(db)
  });
  assert.equal(cached.status, 304);
});

test('GET /api/market/date reads legacy v1.0.1 snapshots seamlessly', async () => {
  const db = new MockDb();
  await onRequestPost({ request: publishRequest(legacyFixture, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });

  const res = await onRequestGetDate({ request: new Request(`https://snowshagal.com/api/market/date?date=${legacyFixture.meta.market_date}`), env: environment(db) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.meta.market_date, legacyFixture.meta.market_date);
  assert.equal(data.meta.schema_version, '1.0.1');
  assert.equal(Object.hasOwn(data, 'krx_groups'), false);
});

test('GET /api/market/dates returns DESC sorted dates with latest and earliest bounds, and handles empty DB', async () => {
  const db = new MockDb();
  // Empty DB
  let res = await onRequestGetDates({ request: new Request('https://snowshagal.com/api/market/dates'), env: environment(db) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { dates: [], latest: null, earliest: null });

  // Add 3 dates
  const d1 = clone(fixture); d1.meta.market_date = '2026-08-26'; alignGroupDate(d1, '2026-08-26');
  const d2 = clone(fixture); d2.meta.market_date = '2026-08-27'; alignGroupDate(d2, '2026-08-27');
  const d3 = clone(fixture); d3.meta.market_date = '2026-08-28'; alignGroupDate(d3, '2026-08-28');

  await onRequestPost({ request: publishRequest(d1, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  await onRequestPost({ request: publishRequest(d2, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });
  await onRequestPost({ request: publishRequest(d3, { 'x-market-publish-key': 'market-secret' }), env: environment(db) });

  res = await onRequestGetDates({ request: new Request('https://snowshagal.com/api/market/dates'), env: environment(db) });
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.deepEqual(list.dates, ['2026-08-28', '2026-08-27', '2026-08-26']);
  assert.equal(list.latest, '2026-08-28');
  assert.equal(list.earliest, '2026-08-26');

  const etag = res.headers.get('etag');
  assert.ok(etag);
  const cached = await onRequestGetDates({
    request: new Request('https://snowshagal.com/api/market/dates', { headers: { 'if-none-match': etag } }),
    env: environment(db)
  });
  assert.equal(cached.status, 304);
});
