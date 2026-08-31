import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { onRequestPost } from '../functions/api/engagement.js';
import { onRequestGet as getStats } from '../functions/api/engagement-stats.js';
import { __test as sharedTest, aggregateRows, rangeDates } from '../functions/api/_engagement.js';
import { createMockAuthEnv } from './helpers/auth-test-helper.mjs';

const ADMIN_KEY = 'engagement-test-key';
const UUID = '123e4567-e89b-42d3-a456-426614174000';

let sharedAuthEnv = null;
async function getAuthEnv() {
  if (!sharedAuthEnv) {
    sharedAuthEnv = await createMockAuthEnv({ ADMIN_KEY });
  }
  return sharedAuthEnv;
}

class MockStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() {
    this.db.statements.push({ sql: this.sql, values: this.values });
    if (this.sql.startsWith('INSERT INTO engagement_sessions')) {
      const [session_id, path, country, lang, started_at, updated_at, active_ms, max_scroll] = this.values;
      const previous = this.db.rows.get(session_id);
      this.db.rows.set(session_id, previous ? {
        ...previous,
        updated_at,
        active_ms: Math.max(previous.active_ms, active_ms),
        max_scroll: Math.max(previous.max_scroll, max_scroll)
      } : { session_id, path, country, lang, started_at, updated_at, active_ms, max_scroll });
    }
    return { success: true };
  }
  async all() {
    this.db.statements.push({ sql: this.sql, values: this.values });
    const [start, end] = this.values;
    return { results: [...this.db.rows.values()].filter((row) => row.started_at >= start && row.started_at < end) };
  }
}

class MockDb {
  constructor(rows = []) {
    this.rows = new Map(rows.map((row, index) => [row.session_id || `row-${index}`, row]));
    this.statements = [];
  }
  prepare(sql) { return new MockStatement(this, sql); }
}

function engagementRequest(payload, { host = 'snowshagal.com', country = 'KR' } = {}) {
  const request = new Request(`https://${host}/api/engagement`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  Object.defineProperty(request, 'cf', { value: { country } });
  return request;
}

test('tracker is production-only and excludes private paths', async () => {
  const source = await readFile(new URL('../assets/engagement.js', import.meta.url), 'utf8');
  function context(hostname, pathname = '/reports/sample') {
    const documentListeners = new Map();
    const windowListeners = new Map();
    let intervalCount = 0;
    let fetchCount = 0;
    const doc = {
      hidden: false, body: { scrollHeight: 1000, offsetHeight: 1000, scrollTop: 0 },
      documentElement: { scrollHeight: 1000, offsetHeight: 1000, clientHeight: 400, scrollTop: 0 },
      hasFocus: () => true,
      addEventListener: (name, handler) => documentListeners.set(name, handler)
    };
    const win = {
      location: { hostname, pathname }, document: doc, innerHeight: 400, scrollY: 0,
      crypto: { randomUUID: () => UUID }, performance: { now: () => 0 },
      fetch: () => { fetchCount += 1; return Promise.resolve(new Response()); },
      addEventListener: (name, handler) => windowListeners.set(name, handler),
      setInterval: () => { intervalCount += 1; return 1; }, clearInterval() {}
    };
    win.window = win;
    vm.runInNewContext(source, { window: win, document: doc, console, Date, Math, JSON, Promise });
    return { win, intervalCount: () => intervalCount, fetchCount: () => fetchCount };
  }
  assert.equal(context('snowshagal.com').intervalCount(), 1);
  assert.equal(context('branch.market-research-site.pages.dev').intervalCount(), 0);
  for (const path of ['/admin/', '/api/test', '/cdn-cgi/trace']) assert.equal(context('snowshagal.com', path).intervalCount(), 0);
});

test('tracker pauses active time in background, resumes in foreground, and keeps maximum scroll', async () => {
  const source = await readFile(new URL('../assets/engagement.js', import.meta.url), 'utf8');
  const docListeners = new Map();
  const winListeners = new Map();
  let clock = 0;
  let focused = true;
  const doc = {
    hidden: false, body: { scrollHeight: 1000, offsetHeight: 1000, scrollTop: 0 },
    documentElement: { scrollHeight: 1000, offsetHeight: 1000, clientHeight: 400, scrollTop: 0 },
    hasFocus: () => focused,
    addEventListener: (name, handler) => docListeners.set(name, handler)
  };
  const win = {
    location: { hostname: 'snowshagal.com', pathname: '/reports/sample' }, document: doc, innerHeight: 400, scrollY: 0,
    crypto: { randomUUID: () => UUID }, performance: { now: () => clock }, fetch: () => Promise.resolve(new Response()),
    addEventListener: (name, handler) => winListeners.set(name, handler), setInterval: () => 1, clearInterval() {}
  };
  win.window = win;
  vm.runInNewContext(source, { window: win, document: doc, console, Date, Math, JSON, Promise });
  const tracker = win.__snowshagalEngagementTest.createTracker(win, doc);
  clock = 1000;
  focused = false;
  winListeners.get('blur')();
  clock = 6000;
  assert.equal(tracker.snapshot().active, 1000);
  focused = true;
  winListeners.get('focus')();
  clock = 8000;
  assert.equal(tracker.snapshot().active, 3000);
  win.scrollY = 500;
  winListeners.get('scroll')();
  assert.equal(tracker.snapshot().scroll, 90);
  win.scrollY = 10;
  winListeners.get('scroll')();
  assert.equal(tracker.snapshot().scroll, 90);
});

test('engagement API validates host, UUID, path, active time, and scroll', async () => {
  const valid = { session_id: UUID, path: '/reports/sample', active_ms: 1200, max_scroll: 42 };
  const db = new MockDb();
  sharedTest.resetSchemaCache();
  assert.equal((await onRequestPost({ request: engagementRequest(valid, { host: 'preview.pages.dev' }), env: { COMMENTS_DB: db } })).status, 404);
  const crossOrigin = engagementRequest(valid);
  crossOrigin.headers.set('origin', 'https://example.com');
  assert.equal((await onRequestPost({ request: crossOrigin, env: { COMMENTS_DB: db } })).status, 403);
  for (const payload of [
    { ...valid, session_id: 'bad' },
    { ...valid, path: '/admin/analytics/' },
    { ...valid, active_ms: -1 },
    { ...valid, max_scroll: 101 }
  ]) {
    assert.equal((await onRequestPost({ request: engagementRequest(payload), env: { COMMENTS_DB: db } })).status, 400);
  }
  assert.equal(db.rows.size, 0);
});

test('duplicate session UPSERT preserves server country and monotonic maxima', async () => {
  const db = new MockDb();
  sharedTest.resetSchemaCache();
  const first = { session_id: UUID, path: '/reports/sample', country: 'US', active_ms: 5000, max_scroll: 70 };
  const second = { ...first, active_ms: 3000, max_scroll: 90 };
  assert.equal((await onRequestPost({ request: engagementRequest(first, { country: 'JP' }), env: { COMMENTS_DB: db } })).status, 202);
  assert.equal((await onRequestPost({ request: engagementRequest(second, { country: 'JP' }), env: { COMMENTS_DB: db } })).status, 202);
  const row = db.rows.get(UUID);
  assert.equal(row.country, 'JP');
  assert.equal(row.active_ms, 5000);
  assert.equal(row.max_scroll, 90);
  assert.equal(row.lang, 'ko');
});

test('stats ranges, averages, medians, thresholds, pages, and countries are deterministic', () => {
  assert.deepEqual(rangeDates(1, new Date('2026-08-26T13:00:00Z')).from, '2026-08-26');
  assert.deepEqual(rangeDates(7, new Date('2026-08-26T13:00:00Z')).from, '2026-08-20');
  assert.deepEqual(rangeDates(28, new Date('2026-08-26T13:00:00Z')).from, '2026-07-30');
  const result = aggregateRows([
    { path: '/reports/a', lang: 'ko', country: 'KR', active_ms: 30000, max_scroll: 50 },
    { path: '/reports/a', lang: 'ko', country: 'KR', active_ms: 60000, max_scroll: 100 },
    { path: '/reports/en/a', lang: 'en', country: 'US', active_ms: 180000, max_scroll: 90 }
  ], (path) => path === '/reports/a' ? '리포트 A' : 'Report A');
  assert.equal(result.overall.sessions, 3);
  assert.equal(result.overall.avgActiveMs, 90000);
  assert.equal(result.overall.medianActiveMs, 60000);
  assert.equal(result.overall.over30sRate, 100);
  assert.equal(result.overall.over1mRate, 66.7);
  assert.equal(result.overall.over3mRate, 33.3);
  assert.equal(result.overall.over90ScrollRate, 66.7);
  assert.equal(result.pages.length, 2);
  assert.equal(result.pages[0].title, '리포트 A');
  assert.equal(result.countries.find((item) => item.country === 'KR').sessions, 2);
});

test('stats API authenticates, handles empty and populated D1, and leaves comments schema intact', async () => {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS comments/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS engagement_sessions/);
  assert.doesNotMatch(schema, /DROP TABLE|DELETE FROM comments/i);

  const authEnv = await getAuthEnv();
  for (const rows of [[], [{
    session_id: UUID, path: '/reports/sample', country: 'KR', lang: 'ko',
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(), active_ms: 42000, max_scroll: 95
  }]]) {
    const db = new MockDb(rows);
    sharedTest.resetSchemaCache();
    const request = new Request('https://admin.snowshagal.com/api/engagement-stats?days=7', {
      headers: {
        'x-admin-key': ADMIN_KEY,
        cookie: authEnv._authSession.cookieHeader
      }
    });
    const response = await getStats({ request, env: { ...authEnv, COMMENTS_DB: db, ASSETS: { fetch: async () => Response.json([{ href: 'reports/sample.html', title: '샘플 리포트' }]) } } });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.equal(data.empty, rows.length === 0);
    assert.equal(data.overall.sessions, rows.length);
    if (rows.length) assert.equal(data.pages[0].title, '샘플 리포트');
  }
  const unauthorized = await getStats({ request: new Request('https://admin.snowshagal.com/api/engagement-stats?days=7'), env: { ...authEnv, COMMENTS_DB: new MockDb() } });
  assert.equal(unauthorized.status, 401);
});
