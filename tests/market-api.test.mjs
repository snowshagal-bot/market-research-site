import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequestGet as onRequestGetLatest } from '../functions/api/market/latest.js';
import { onRequestGet as onRequestGetDate } from '../functions/api/market/date.js';
import { onRequestGet as onRequestGetDates } from '../functions/api/market/dates.js';
import { onRequestGet as onRequestGetRange } from '../functions/api/market/range.js';
import { computeMarketRange } from '../functions/api/market/_aggregate.js';
import { previousTradingDate } from '../functions/api/market/_freshness.js';
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
  const usDate = previousTradingDate(marketDate, 'NYSE');
  for (const code of ['KOSPI', 'KOSDAQ']) payload.indices[code].source_date = marketDate;
  for (const code of ['NASDAQ', 'DOW', 'SP500']) payload.indices[code].source_date = usDate;
  for (const code of ['SOX', 'VIX', 'US10Y']) payload.rates_fx_volatility[code].source_date = usDate;
  for (const code of ['USDKRW', 'JPYKRW', 'DXY']) payload.rates_fx_volatility[code].source_date = marketDate;
  for (const code of ['WTI', 'GOLD', 'BITCOIN']) payload.commodities_crypto[code].source_date = marketDate;
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
    if (/WHERE market_date <= \?/i.test(this.sql)) {
      const [endDate, limit] = this.args;
      const sortedKeys = [...this.db.rows.keys()].filter(k => k <= endDate).sort().reverse().slice(0, limit);
      return { results: sortedKeys.map(k => this.db.rows.get(k)) };
    }
    if (/ORDER BY market_date DESC LIMIT \?/i.test(this.sql)) {
      const [limit] = this.args;
      const sortedKeys = [...this.db.rows.keys()].sort().reverse().slice(0, limit);
      return { results: sortedKeys.map(k => this.db.rows.get(k)) };
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

import { createMockAuthDb, createAdminSession } from './helpers/auth-test-helper.mjs';

const sharedAuthDb = await createMockAuthDb();
const sharedSession = await createAdminSession(sharedAuthDb);

const environment = db => ({
  AUTH_DB: sharedAuthDb,
  COMMENTS_DB: db,
  ADMIN_KEY: 'admin-secret',
  MARKET_PUBLISH_KEY: 'market-secret',
  ASSETS: { fetch: async request => new URL(request.url).pathname.endsWith('/market_close.schema.json') ? Response.json(schema) : new Response('Not found', { status: 404 }) }
});
const publishRequest = (payload, headers = {}, host = 'snowshagal.com') => {
  const origin = `https://${host}`;
  return new Request(`${origin}/api/market/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload)
  });
};

test('authoritative example passes the schema-backed final validator', () => {
  assert.deepEqual(validateMarketPayload(fixture, schema), { passed: true, errors: [] });
});

test('legacy v1.0.1 payload remains publishable without krx_groups', () => {
  assert.deepEqual(validateMarketPayload(legacyFixture, schema), { passed: true, errors: [] });
});

test('publish validator rejects the observed stale US source-date regression', () => {
  const stale = clone(fixture);
  stale.meta.market_date = '2026-08-31';
  alignGroupDate(stale, stale.meta.market_date);
  for (const code of ['NASDAQ', 'DOW', 'SP500']) stale.indices[code].source_date = '2026-08-27';
  for (const code of ['SOX', 'VIX', 'US10Y']) stale.rates_fx_volatility[code].source_date = '2026-08-27';
  const result = validateMarketPayload(stale, schema);
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /NASDAQ.*expected 2026-08-28.*2026-08-27/);
  assert.match(result.errors.join('\n'), /US10Y.*expected 2026-08-28.*2026-08-27/);
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

test('publish API rejects stale per-market source dates before any D1 write', async () => {
  const db = new MockDb();
  const stale = clone(fixture);
  stale.meta.market_date = '2026-08-31';
  alignGroupDate(stale, stale.meta.market_date);
  for (const code of ['NASDAQ', 'DOW', 'SP500']) stale.indices[code].source_date = '2026-08-27';
  for (const code of ['SOX', 'VIX', 'US10Y']) stale.rates_fx_volatility[code].source_date = '2026-08-27';

  const response = await onRequestPost({
    request: publishRequest(stale, { 'x-market-publish-key': 'market-secret' }),
    env: environment(db)
  });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error, 'VALIDATION_FAILED');
  assert.match(body.details.join('\n'), /NASDAQ.*expected 2026-08-28.*2026-08-27/);
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
  response = await onRequestPost({ request: publishRequest(repeated, sharedSession.headers, 'admin.snowshagal.com'), env: environment(db) });
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

test('GET /api/market/range validates period and end parameters, and enforces 400/404 errors', async () => {
  const db = new MockDb();
  const env = environment(db);

  // Missing period -> 400
  let res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range'), env });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_PERIOD');

  // Invalid period -> 400
  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=3m'), env });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_PERIOD');

  // Malformed end date -> 400
  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w&end=abc'), env });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_DATE');

  // Impossible end date -> 400
  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w&end=2026-02-30'), env });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_DATE');

  // Empty DB -> 404 NO_MARKET_DATA
  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w'), env });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'NO_MARKET_DATA');

  // Valid date but missing from DB -> 404 MARKET_DATE_NOT_FOUND
  const d1 = clone(fixture); d1.meta.market_date = '2026-08-28'; alignGroupDate(d1, '2026-08-28');
  await onRequestPost({ request: publishRequest(d1, { 'x-market-publish-key': 'market-secret' }), env });

  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w&end=2026-08-20'), env });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'MARKET_DATE_NOT_FOUND');
});

test('GET /api/market/range calculates window completeness for 1w (5 sessions) and 1m (20 sessions)', async () => {
  const db = new MockDb();
  const env = environment(db);

  // Seed 4 snapshots (like current Production)
  const dates = ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
  for (const d of dates) {
    const snap = clone(fixture);
    snap.meta.market_date = d;
    alignGroupDate(snap, d);
    await onRequestPost({ request: publishRequest(snap, { 'x-market-publish-key': 'market-secret' }), env });
  }

  // 1w with 4 rows -> sessions_used: 4, required_sessions: 5, complete: false
  let res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w'), env });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.aggregation_version, '1.0.0');
  assert.equal(data.period, '1w');
  assert.deepEqual(data.window, {
    start_date: '2026-08-25',
    end_date: '2026-08-28',
    dates: ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'],
    sessions_used: 4,
    required_sessions: 5,
    complete: false
  });

  // 1m with 4 rows -> sessions_used: 4, required_sessions: 20, complete: false
  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1m'), env });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.window.sessions_used, 4);
  assert.equal(data.window.required_sessions, 20);
  assert.equal(data.window.complete, false);

  // Add 5th date -> 1w complete: true
  const snap5 = clone(fixture);
  snap5.meta.market_date = '2026-08-31';
  alignGroupDate(snap5, '2026-08-31');
  await onRequestPost({ request: publishRequest(snap5, { 'x-market-publish-key': 'market-secret' }), env });

  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w'), env });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.window.sessions_used, 5);
  assert.equal(data.window.required_sessions, 5);
  assert.equal(data.window.complete, true);
  assert.equal(data.window.start_date, '2026-08-25');
  assert.equal(data.window.end_date, '2026-08-31');

  // Query historical end=2026-08-27 -> 3 sessions (25, 26, 27)
  res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w&end=2026-08-27'), env });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.window.end_date, '2026-08-27');
  assert.equal(data.window.sessions_used, 3);
  assert.equal(data.window.complete, false);
});

test('Multi-session return prevents off-by-one errors using first session previous_close baseline', () => {
  // Synthetic 5-day series
  // D1: prev_close = 100, close = 101, high = 102, low = 99
  // D2: prev_close = 101, close = 102, high = 103, low = 101
  // D3: prev_close = 102, close = 103, high = 104, low = 102
  // D4: prev_close = 103, close = 104, high = 105, low = 103
  // D5: prev_close = 104, close = 105, high = 106, low = 104
  const snapshots = [
    {
      meta: { market_date: '2026-08-24', schema_version: '1.1.0' },
      indices: {
        KOSPI: { close: 101, previous_close: 100, high: 102, low: 99, source_date: '2026-08-24' }
      }
    },
    {
      meta: { market_date: '2026-08-25', schema_version: '1.1.0' },
      indices: {
        KOSPI: { close: 102, previous_close: 101, high: 103, low: 101, source_date: '2026-08-25' }
      }
    },
    {
      meta: { market_date: '2026-08-26', schema_version: '1.1.0' },
      indices: {
        KOSPI: { close: 103, previous_close: 102, high: 104, low: 102, source_date: '2026-08-26' }
      }
    },
    {
      meta: { market_date: '2026-08-27', schema_version: '1.1.0' },
      indices: {
        KOSPI: { close: 104, previous_close: 103, high: 105, low: 103, source_date: '2026-08-27' }
      }
    },
    {
      meta: { market_date: '2026-08-28', schema_version: '1.1.0' },
      indices: {
        KOSPI: { close: 105, previous_close: 104, high: 106, low: 104, source_date: '2026-08-28' }
      }
    }
  ];

  const res = computeMarketRange(snapshots, '1w', 5);
  const kospi = res.instruments.indices.KOSPI;

  assert.equal(kospi.baseline_value, 100);
  assert.equal(kospi.end_value, 105);
  assert.equal(kospi.change, 5);
  // Correct 5-session return: (105 / 100 - 1) * 100 = 5.0%
  // Erroneous off-by-one 4-session return would have been: (105 / 101 - 1) * 100 = 3.960396...%
  assert.ok(Math.abs(kospi.return_pct - 5) < 1e-9);
  assert.equal(kospi.period_high, 106);
  assert.equal(kospi.period_low, 99);
  assert.equal(kospi.observations, 5);
  assert.equal(kospi.complete, true);
});

test('Investor flows sum daily raw net_buy and are strictly decoupled from recent_5d_flows', () => {
  // 5 daily foreign KOSPI net_buy: +100, -200, +300, -50, +25 -> sum = +175
  const netBuys = [100, -200, 300, -50, 25];
  const snapshots = netBuys.map((nb, i) => ({
    meta: { market_date: `2026-08-2${i + 1}`, schema_version: '1.1.0' },
    krx_investor_trading: {
      unit: 'KRW billion',
      markets: {
        KOSPI: {
          investors: {
            외국인: { net_buy: nb },
            기관: { net_buy: 10 },
            개인: { net_buy: -nb - 10 }
          }
        },
        KOSDAQ: {
          investors: {
            외국인: { net_buy: 5 },
            기관: { net_buy: 5 },
            개인: { net_buy: -10 }
          }
        },
        KOSPI200선물: {
          investors: {
            외국인: { net_buy: 20 },
            기관: { net_buy: -20 },
            개인: { net_buy: 0 }
          }
        }
      }
    },
    // Poisoned recent_5d_flows to verify that the aggregation engine never touches this field!
    recent_5d_flows: {
      markets: {
        KOSPI: { 외국인: 99999999, 기관: 99999999, 개인: 99999999 }
      }
    }
  }));

  const res = computeMarketRange(snapshots, '1w', 5);
  const foreignKospi = res.flows.markets.KOSPI.외국인;

  assert.equal(foreignKospi.net_buy, 175, 'Foreign KOSPI net_buy must be exactly 175');
  assert.equal(foreignKospi.observations, 5);
  assert.equal(foreignKospi.complete, true);
  assert.equal(res.flows.unit, 'KRW billion');
});

test('Market breadth averages ratios and counts, and tracks session dominance accurately', () => {
  const breadthSeries = [
    { rise_ratio: 0.60, fall_ratio: 0.35, rise_count: 600, fall_count: 350 }, // advancer
    { rise_ratio: 0.55, fall_ratio: 0.40, rise_count: 550, fall_count: 400 }, // advancer
    { rise_ratio: 0.40, fall_ratio: 0.55, rise_count: 400, fall_count: 550 }, // decliner
    { rise_ratio: 0.70, fall_ratio: 0.25, rise_count: 700, fall_count: 250 }, // advancer
    { rise_ratio: 0.50, fall_ratio: 0.50, rise_count: 500, fall_count: 500 }  // neutral
  ];

  const snapshots = breadthSeries.map((b, i) => ({
    meta: { market_date: `2026-08-2${i + 1}`, schema_version: '1.1.0' },
    market_breadth: {
      KOSPI: b,
      KOSDAQ: b
    }
  }));

  const res = computeMarketRange(snapshots, '1w', 5);
  const breadth = res.breadth.KOSPI;

  assert.equal(breadth.avg_rise_ratio, 0.55);
  assert.equal(breadth.avg_fall_ratio, 0.41);
  assert.equal(breadth.avg_rise_count, 550);
  assert.equal(breadth.avg_fall_count, 410);
  assert.equal(breadth.advancer_dominant_sessions, 3);
  assert.equal(breadth.decliner_dominant_sessions, 1);
  assert.equal(breadth.neutral_sessions, 1);
  assert.equal(breadth.observations, 5);
  assert.equal(breadth.complete, true);
});

test('US10Y provides accurate change_bp basis-point calculation', () => {
  const snapshots = [
    {
      meta: { market_date: '2026-08-24', schema_version: '1.1.0' },
      rates_fx_volatility: {
        US10Y: { close: 4.61, previous_close: 4.60, high: 4.65, low: 4.59, source_date: '2026-08-24' }
      }
    },
    {
      meta: { market_date: '2026-08-28', schema_version: '1.1.0' },
      rates_fx_volatility: {
        US10Y: { close: 4.72, previous_close: 4.70, high: 4.74, low: 4.68, source_date: '2026-08-28' }
      }
    }
  ];

  const res = computeMarketRange(snapshots, '1w', 2);
  const us10y = res.instruments.rates_fx_volatility.US10Y;

  assert.equal(us10y.baseline_value, 4.60);
  assert.equal(us10y.end_value, 4.72);
  assert.ok(Math.abs(us10y.change - 0.12) < 1e-9);
  assert.ok(Math.abs(us10y.change_bp - 12) < 1e-9);
});

test('KRX groups multi-session returns require full coverage across sessions and index_code identity', () => {
  // A. 5 v1.1.0 snapshots with complete group code
  // D1: close = 100, change = 2 -> baseline = 98
  // D5: close = 110 -> return_pct = (110 / 98 - 1) * 100 = 12.244897959183675%
  const completeSnapshots = [1, 2, 3, 4, 5].map(day => ({
    meta: { market_date: `2026-08-2${day}`, schema_version: '1.1.0' },
    krx_groups: {
      sectors: [
        { index_code: 'KGS04P', name: '화학', market: 'KOSPI', close: 100 + (day - 1) * 2.5, change: 2 },
        { index_code: 'QGS03P', name: '건설', market: 'KOSDAQ', close: 50 + (day - 1), change: 1 }
      ],
      themes: [
        { index_code: 'KT001', name: '2차전지', close: 200 + (day - 1) * 5, change: 4 }
      ]
    }
  }));

  const completeRes = computeMarketRange(completeSnapshots, '1w', 5);
  assert.equal(completeRes.krx_groups.coverage_complete, true);
  assert.equal(completeRes.krx_groups.sessions_with_data, 5);

  const chemSector = completeRes.krx_groups.sectors.find(s => s.index_code === 'KGS04P');
  assert.ok(chemSector);
  assert.equal(chemSector.baseline_value, 98);
  assert.equal(chemSector.end_value, 110);
  assert.ok(Math.abs(chemSector.return_pct - ((110 / 98 - 1) * 100)) < 1e-9);
  assert.equal(chemSector.complete, true);

  // Sector sorting: market ASC ('KOSDAQ' then 'KOSPI'), then index_code ASC
  assert.equal(completeRes.krx_groups.sectors[0].market, 'KOSDAQ');
  assert.equal(completeRes.krx_groups.sectors[1].market, 'KOSPI');

  // B. Code missing on day 3 -> code complete: false, return_pct: null
  const partialSnapshots = clone(completeSnapshots);
  partialSnapshots[2].krx_groups.sectors = partialSnapshots[2].krx_groups.sectors.filter(s => s.index_code !== 'KGS04P');

  const partialRes = computeMarketRange(partialSnapshots, '1w', 5);
  const missingCodeChem = partialRes.krx_groups.sectors.find(s => s.index_code === 'KGS04P');
  assert.equal(missingCodeChem.observations, 4);
  assert.equal(missingCodeChem.complete, false);
  assert.equal(missingCodeChem.return_pct, null);
});

test('Mixed schema windows (v1.0.1 and v1.1.0) aggregate gracefully with coverage reporting', () => {
  const mixedSnapshots = [
    {
      meta: { market_date: '2026-08-25', schema_version: '1.0.1' },
      indices: { KOSPI: { close: 100, previous_close: 99, source_date: '2026-08-25' } }
    },
    {
      meta: { market_date: '2026-08-26', schema_version: '1.0.1' },
      indices: { KOSPI: { close: 101, previous_close: 100, source_date: '2026-08-26' } }
    },
    {
      meta: { market_date: '2026-08-27', schema_version: '1.1.0' },
      indices: { KOSPI: { close: 102, previous_close: 101, source_date: '2026-08-27' } },
      krx_groups: {
        sectors: [{ index_code: 'KGS04P', name: '화학', market: 'KOSPI', close: 100, change: 2 }],
        themes: []
      }
    }
  ];

  const res = computeMarketRange(mixedSnapshots, '1w', 5);
  assert.deepEqual(res.coverage.schema_versions, { '1.0.1': 2, '1.1.0': 1 });
  assert.equal(res.krx_groups.sessions_with_data, 1);
  assert.equal(res.krx_groups.sessions_used, 3);
  assert.equal(res.krx_groups.coverage_complete, false);
  assert.equal(res.instruments.indices.KOSPI.observations, 3);
});

test('GET /api/market/range supports ETag caching and revalidates on snapshot republish', async () => {
  const db = new MockDb();
  const env = environment(db);

  const d1 = clone(fixture); d1.meta.market_date = '2026-08-27'; alignGroupDate(d1, '2026-08-27');
  const d2 = clone(fixture); d2.meta.market_date = '2026-08-28'; alignGroupDate(d2, '2026-08-28');

  await onRequestPost({ request: publishRequest(d1, { 'x-market-publish-key': 'market-secret' }), env });
  await onRequestPost({ request: publishRequest(d2, { 'x-market-publish-key': 'market-secret' }), env });

  const res = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w'), env });
  assert.equal(res.status, 200);
  const etag = res.headers.get('etag');
  assert.ok(etag);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');

  // Revalidate unchanged -> 304
  const cached = await onRequestGetRange({
    request: new Request('https://snowshagal.com/api/market/range?period=1w', { headers: { 'if-none-match': etag } }),
    env
  });
  assert.equal(cached.status, 304);

  // Republish d2 with updated generated_at -> new ETag generated
  const d2Updated = clone(d2);
  d2Updated.meta.generated_at = '2026-08-30T18:00:00.000000+07:00';
  await onRequestPost({ request: publishRequest(d2Updated, { 'x-market-publish-key': 'market-secret' }), env });

  const refreshed = await onRequestGetRange({ request: new Request('https://snowshagal.com/api/market/range?period=1w'), env });
  assert.equal(refreshed.status, 200);
  const newEtag = refreshed.headers.get('etag');
  assert.notEqual(newEtag, etag, 'ETag must change when a constituent snapshot is updated');
});

test('Unified complete semantics: 1W with 4 rows marks window, instruments, flows, breadth, and groups complete=false', () => {
  const snapshots = [1, 2, 3, 4].map(day => ({
    meta: { market_date: `2026-08-2${day}`, schema_version: '1.1.0' },
    indices: {
      KOSPI: { close: 100 + day, previous_close: 99 + day, high: 105, low: 95, source_date: `2026-08-2${day}` }
    },
    krx_investor_trading: {
      unit: 'KRW billion',
      markets: {
        KOSPI: { investors: { 외국인: { net_buy: 100 }, 기관: { net_buy: 50 }, 개인: { net_buy: -150 } } }
      }
    },
    market_breadth: {
      KOSPI: { rise_count: 500, fall_count: 300, rise_ratio: 0.6, fall_ratio: 0.35 }
    },
    krx_groups: {
      sectors: [{ index_code: 'KGS04P', name: '화학', market: 'KOSPI', close: 100 + day, change: 1 }],
      themes: [{ index_code: 'KT001', name: '2차전지', close: 200 + day, change: 2 }]
    }
  }));

  const res = computeMarketRange(snapshots, '1w', 5);

  // 1. Window complete false
  assert.equal(res.window.sessions_used, 4);
  assert.equal(res.window.required_sessions, 5);
  assert.equal(res.window.complete, false);

  // 2. Instrument complete false, partial return calculated
  const kospi = res.instruments.indices.KOSPI;
  assert.equal(kospi.observations, 4);
  assert.equal(kospi.complete, false);
  assert.equal(kospi.baseline_value, 100);
  assert.equal(kospi.end_value, 104);

  // 3. Flow complete false, partial sum calculated
  const foreignKospi = res.flows.markets.KOSPI.외국인;
  assert.equal(foreignKospi.observations, 4);
  assert.equal(foreignKospi.complete, false);
  assert.equal(foreignKospi.net_buy, 400);

  // 4. Breadth complete false
  const breadthKospi = res.breadth.KOSPI;
  assert.equal(breadthKospi.observations, 4);
  assert.equal(breadthKospi.complete, false);

  // 5. KRX groups coverage_complete false & individual sector/theme return_pct null
  assert.equal(res.krx_groups.coverage_complete, false);
  assert.equal(res.krx_groups.sessions_with_data, 4);
  const chem = res.krx_groups.sectors.find(s => s.index_code === 'KGS04P');
  assert.equal(chem.observations, 4);
  assert.equal(chem.complete, false);
  assert.equal(chem.return_pct, null, 'KRX sector return_pct must be null when window is incomplete (4/5)');
});

test('Boundary handling: missing instrument in first or last snapshot returns null return_pct', () => {
  // First snapshot missing KOSPI
  const snapshotsMissingFirst = [
    { meta: { market_date: '2026-08-25', schema_version: '1.1.0' }, indices: {} },
    { meta: { market_date: '2026-08-26', schema_version: '1.1.0' }, indices: { KOSPI: { close: 102, previous_close: 101, source_date: '2026-08-26' } } },
    { meta: { market_date: '2026-08-27', schema_version: '1.1.0' }, indices: { KOSPI: { close: 103, previous_close: 102, source_date: '2026-08-27' } } },
    { meta: { market_date: '2026-08-28', schema_version: '1.1.0' }, indices: { KOSPI: { close: 104, previous_close: 103, source_date: '2026-08-28' } } },
    { meta: { market_date: '2026-08-29', schema_version: '1.1.0' }, indices: { KOSPI: { close: 105, previous_close: 104, source_date: '2026-08-29' } } }
  ];

  const res1 = computeMarketRange(snapshotsMissingFirst, '1w', 5);
  const kospi1 = res1.instruments.indices.KOSPI;
  assert.equal(kospi1.baseline_value, null);
  assert.equal(kospi1.end_value, 105);
  assert.equal(kospi1.change, null);
  assert.equal(kospi1.return_pct, null);
  assert.equal(kospi1.observations, 4);
  assert.equal(kospi1.complete, false);

  // Last snapshot missing KOSPI
  const snapshotsMissingLast = [
    { meta: { market_date: '2026-08-25', schema_version: '1.1.0' }, indices: { KOSPI: { close: 101, previous_close: 100, source_date: '2026-08-25' } } },
    { meta: { market_date: '2026-08-26', schema_version: '1.1.0' }, indices: { KOSPI: { close: 102, previous_close: 101, source_date: '2026-08-26' } } },
    { meta: { market_date: '2026-08-27', schema_version: '1.1.0' }, indices: { KOSPI: { close: 103, previous_close: 102, source_date: '2026-08-27' } } },
    { meta: { market_date: '2026-08-28', schema_version: '1.1.0' }, indices: { KOSPI: { close: 104, previous_close: 103, source_date: '2026-08-28' } } },
    { meta: { market_date: '2026-08-29', schema_version: '1.1.0' }, indices: {} }
  ];

  const res2 = computeMarketRange(snapshotsMissingLast, '1w', 5);
  const kospi2 = res2.instruments.indices.KOSPI;
  assert.equal(kospi2.baseline_value, 100);
  assert.equal(kospi2.end_value, null);
  assert.equal(kospi2.change, null);
  assert.equal(kospi2.return_pct, null);
  assert.equal(kospi2.observations, 4);
  assert.equal(kospi2.complete, false);
});

test('Explicit rejection of data_state=unavailable and strict final_close non-fallback', () => {
  // 1. data_state === 'unavailable' with stale finite numbers must be rejected
  const unavailableSnapshots = [
    {
      meta: { market_date: '2026-08-25', schema_version: '1.1.0' },
      rates_fx_volatility: {
        VIX: { close: 15.0, current: 15.0, previous_close: 14.5, data_state: 'unavailable', source_date: '2026-08-25' }
      }
    },
    {
      meta: { market_date: '2026-08-26', schema_version: '1.1.0' },
      rates_fx_volatility: {
        VIX: { close: 16.0, current: 16.0, previous_close: 15.0, data_state: 'final_close', source_date: '2026-08-26' }
      }
    }
  ];

  const res1 = computeMarketRange(unavailableSnapshots, '1w', 2);
  const vix = res1.instruments.rates_fx_volatility.VIX;
  assert.equal(vix.baseline_value, null, 'Unavailable item must not serve as baseline');
  assert.equal(vix.end_value, 16.0);
  assert.equal(vix.return_pct, null);
  assert.equal(vix.observations, 1);

  // 2. data_state === 'final_close' where close is null must NOT fall back to current
  const finalCloseNoCloseSnapshots = [
    {
      meta: { market_date: '2026-08-25', schema_version: '1.1.0' },
      commodities_crypto: {
        WTI: { close: null, current: 82.5, previous_close: 80.0, data_state: 'final_close', source_date: '2026-08-25' }
      }
    },
    {
      meta: { market_date: '2026-08-26', schema_version: '1.1.0' },
      commodities_crypto: {
        WTI: { close: null, current: 83.0, previous_close: 82.5, data_state: 'final_close', source_date: '2026-08-26' }
      }
    }
  ];

  const res2 = computeMarketRange(finalCloseNoCloseSnapshots, '1w', 2);
  const wti = res2.instruments.commodities_crypto.WTI;
  assert.equal(wti.baseline_value, null);
  assert.equal(wti.end_value, null);
  assert.equal(wti.observations, 0);
  assert.equal(wti.complete, false);
});

test('Breadth missing ratio/count exclusion: partial field session is excluded without being treated as 0', () => {
  const breadthSeries = [
    { rise_ratio: 0.60, fall_ratio: 0.35, rise_count: 600, fall_count: 350 }, // valid
    { rise_ratio: 0.50, fall_ratio: 0.40, rise_count: 500, fall_count: 400 }, // valid
    { rise_ratio: null, fall_ratio: 0.50, rise_count: 400, fall_count: 500 }, // missing rise_ratio -> excluded!
    { rise_ratio: 0.70, fall_ratio: 0.25, rise_count: 700, fall_count: 250 }, // valid
    { rise_ratio: 0.40, fall_ratio: 0.50, rise_count: 400, fall_count: 500 }  // valid
  ];

  const snapshots = breadthSeries.map((b, i) => ({
    meta: { market_date: `2026-08-2${i + 1}`, schema_version: '1.1.0' },
    market_breadth: {
      KOSPI: b
    }
  }));

  const res = computeMarketRange(snapshots, '1w', 5);
  const breadth = res.breadth.KOSPI;

  // 4 valid sessions: (0.60 + 0.50 + 0.70 + 0.40) / 4 = 0.55
  // If the 3rd session were treated as 0: (0.60 + 0.50 + 0 + 0.70 + 0.40) / 5 = 0.44
  assert.equal(breadth.avg_rise_ratio, 0.55);
  assert.equal(breadth.observations, 4);
  assert.equal(breadth.complete, false);
});

test('Machine publisher early publish guard enforces session timing boundaries while permitting backfill and admin sessions', async () => {
  const db = new MockDb();
  const env = environment(db);

  const payloadNormal = clone(fixture);
  payloadNormal.meta.market_date = '2026-09-01';
  alignGroupDate(payloadNormal, '2026-09-01');

  // 1. Normal trading day: 16:04 KST (07:04 UTC) -> REJECT
  const normalPreTime = new Date('2026-09-01T07:04:00Z');
  const resPre = await onRequestPost({
    request: publishRequest(payloadNormal, { 'x-market-publish-key': 'market-secret' }),
    env,
    now: normalPreTime
  });
  assert.equal(resPre.status, 422);
  const dataPre = await resPre.json();
  assert.equal(dataPre.error, 'MARKET_PUBLISH_TOO_EARLY');

  // 2. Normal trading day: 16:05 KST (07:05 UTC) -> ALLOW
  const normalPostTime = new Date('2026-09-01T07:05:00Z');
  const resPost = await onRequestPost({
    request: publishRequest(payloadNormal, { 'x-market-publish-key': 'market-secret' }),
    env,
    now: normalPostTime
  });
  assert.equal(resPost.status, 201);
  const dataPost = await resPost.json();
  assert.equal(dataPost.ok, true);

  // 3. CSAT special session day (2026-11-19, 16:30 close, 17:05 publish eligible):
  const payloadCsat = clone(fixture);
  payloadCsat.meta.market_date = '2026-11-19';
  alignGroupDate(payloadCsat, '2026-11-19');

  // 3a. CSAT day: 17:04 KST (08:04 UTC) -> REJECT
  const csatPreTime = new Date('2026-11-19T08:04:00Z');
  const resCsatPre = await onRequestPost({
    request: publishRequest(payloadCsat, { 'x-market-publish-key': 'market-secret' }),
    env,
    now: csatPreTime
  });
  assert.equal(resCsatPre.status, 422);
  const dataCsatPre = await resCsatPre.json();
  assert.equal(dataCsatPre.error, 'MARKET_PUBLISH_TOO_EARLY');

  // 3b. CSAT day: 17:05 KST (08:05 UTC) -> ALLOW
  const csatPostTime = new Date('2026-11-19T08:05:00Z');
  const resCsatPost = await onRequestPost({
    request: publishRequest(payloadCsat, { 'x-market-publish-key': 'market-secret' }),
    env,
    now: csatPostTime
  });
  assert.equal(resCsatPost.status, 201);
  const dataCsatPost = await resCsatPost.json();
  assert.equal(dataCsatPost.ok, true);

  // 4. Past trading date historical backfill by machine publisher:
  // On 2026-09-01 at 10:00 KST, publishing 2026-08-31 -> ALLOW
  const payloadBackfill = clone(fixture);
  payloadBackfill.meta.market_date = '2026-08-31';
  alignGroupDate(payloadBackfill, '2026-08-31');
  const morningTime = new Date('2026-09-01T01:00:00Z'); // 10:00 KST
  const resBackfill = await onRequestPost({
    request: publishRequest(payloadBackfill, { 'x-market-publish-key': 'market-secret' }),
    env,
    now: morningTime
  });
  assert.equal(resBackfill.status, 201);
  const dataBackfill = await resBackfill.json();
  assert.equal(dataBackfill.ok, true);

  // 5. Human admin session publishing current date before 16:05 (e.g. 10:00 KST):
  // Admin manual publish bypasses early machine guard -> ALLOW
  const payloadAdmin = clone(fixture);
  payloadAdmin.meta.market_date = '2026-09-02';
  alignGroupDate(payloadAdmin, '2026-09-02');
  const adminMorningTime = new Date('2026-09-02T01:00:00Z'); // 10:00 KST
  const resAdmin = await onRequestPost({
    request: publishRequest(payloadAdmin, sharedSession.headers, 'admin.snowshagal.com'),
    env,
    now: adminMorningTime
  });
  assert.equal(resAdmin.status, 201);
  const dataAdmin = await resAdmin.json();
  assert.equal(dataAdmin.ok, true);
});
