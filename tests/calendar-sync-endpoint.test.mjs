import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { onRequestGet as statusGet, onRequestPost as syncPost } from '../functions/api/calendar/sync.js';
import { ensureCalendarEventSchema, recordSourceRun } from '../functions/_calendar-events.js';
import { syncCalendar, CalendarSyncError } from '../scripts/sync-calendar.mjs';

class SqliteStatement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async run() { return this.database.prepare(this.sql).run(...this.values); }
}

class SqliteD1 {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new SqliteStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      for (const statement of statements) await statement.run();
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { this.database.close(); }
}

const SYNC_KEY = 'calendar-sync-secret';
const NOW = new Date('2026-09-02T00:00:00.000Z');

async function freshDb() {
  const db = new SqliteD1();
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  return db;
}

const post = (db, { host = 'snowshagal.com', key = SYNC_KEY } = {}) => syncPost({
  request: new Request(`https://${host}/api/calendar/sync`, {
    method: 'POST',
    headers: key ? { 'x-disclosure-sync-key': key } : {}
  }),
  env: { COMMENTS_DB: db, DISCLOSURE_SYNC_KEY: SYNC_KEY },
  now: NOW
});

/* ------------------------------------------------------------ who may run it */

test('the sync refuses anywhere but production', async () => {
  const db = await freshDb();
  const response = await post(db, { host: 'preview.pages.dev' });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'PRODUCTION_ONLY');
  db.close();
});

test('the sync refuses without the operator key', async () => {
  const db = await freshDb();
  const response = await post(db, { key: '' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'UNAUTHORIZED');

  const wrong = await post(db, { key: 'not-the-key' });
  assert.equal(wrong.status, 401);
  db.close();
});

test('a GET is a read-only status view and needs the same key', async () => {
  const db = await freshDb();
  await recordSourceRun(db, { sourceName: 'federal-reserve', ok: true, eventCount: 16, note: 'decision time unconfirmed for 15 of 16 meetings' }, NOW);

  const unauthorized = await statusGet({
    request: new Request('https://admin.snowshagal.com/api/calendar/sync'),
    env: { COMMENTS_DB: db, DISCLOSURE_SYNC_KEY: SYNC_KEY }
  });
  assert.equal(unauthorized.status, 401);

  const authorized = await statusGet({
    request: new Request('https://admin.snowshagal.com/api/calendar/sync', { headers: { 'x-disclosure-sync-key': SYNC_KEY } }),
    env: { COMMENTS_DB: db, DISCLOSURE_SYNC_KEY: SYNC_KEY }
  });
  assert.equal(authorized.status, 200);
  const payload = await authorized.json();
  // Operational detail belongs here, behind the key, and not on /api/calendar.
  assert.match(payload.sources[0].note, /unconfirmed/);
  db.close();
});

test('an unusable database is reported rather than crashing the run', async () => {
  const broken = { prepare() { throw new Error('down'); }, async batch() { throw new Error('down'); } };
  const response = await syncPost({
    request: new Request('https://snowshagal.com/api/calendar/sync', { method: 'POST', headers: { 'x-disclosure-sync-key': SYNC_KEY } }),
    env: { COMMENTS_DB: broken, DISCLOSURE_SYNC_KEY: SYNC_KEY },
    now: NOW
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'DB_UNAVAILABLE');
});

test('the method is checked', async () => {
  const { onRequest } = await import('../functions/api/calendar/sync.js');
  const response = await onRequest({
    request: new Request('https://snowshagal.com/api/calendar/sync', { method: 'DELETE' }),
    env: {}
  });
  assert.equal(response.status, 405);
});

/* ---------------------------------------------------------- the runner script */

test('the runner needs a key before it goes anywhere', async () => {
  await assert.rejects(() => syncCalendar({ key: '', fetchImpl: async () => { throw new Error('should not be called'); } }),
    /DISCLOSURE_SYNC_KEY is not configured/);
});

test('a run where every source answered passes', async () => {
  const result = await syncCalendar({
    key: SYNC_KEY,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true, years: [2026, 2027], failed: [],
      results: [{ sourceName: 'federal-reserve', status: 'ok', events: 16, created: 16, timesUnconfirmed: 15 }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.years, [2026, 2027]);
  assert.equal(result.results.length, 1);
});

test('a run with a failed source still reports what every source did', async () => {
  // The endpoint answers 502 with a full body; the detail is the point of the
  // run and must survive the failure rather than being thrown away.
  const result = await syncCalendar({
    key: SYNC_KEY,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false, years: [2026, 2027], failed: ['bea'],
      results: [
        { sourceName: 'federal-reserve', status: 'ok', events: 16, created: 16 },
        { sourceName: 'bea', status: 'error', error: 'HTTP 503' },
        { sourceName: 'bank-of-korea-2027', status: 'pending', events: 0 }
      ]
    }), { status: 502, headers: { 'content-type': 'application/json' } })
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ['bea']);
  assert.equal(result.results.length, 3);
  assert.equal(result.results.find(entry => entry.sourceName === 'bank-of-korea-2027').status, 'pending');
});

test('an authentication failure is named as one', async () => {
  await assert.rejects(
    () => syncCalendar({ key: SYNC_KEY, fetchImpl: async () => new Response('{}', { status: 401 }) }),
    error => error instanceof CalendarSyncError && error.kind === 'auth'
  );
});

/* --------------------------------------------------------------- the workflow */

test('the workflow runs daily, after the disclosure sync, and alerts once', async () => {
  const workflow = await readFile(new URL('../.github/workflows/calendar-daily-sync.yml', import.meta.url), 'utf8');

  assert.match(workflow, /cron: "40 7 \* \* 1-5"/, 'after the 07:40 UTC disclosure sync at 07:05');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node scripts\/sync-calendar\.mjs/);
  assert.match(workflow, /DISCLOSURE_SYNC_KEY: \$\{\{ secrets\.DISCLOSURE_SYNC_KEY \}\}/, 'no new secret is introduced');

  // The same singleton-issue pattern the disclosure sync uses: one open issue,
  // commented on while it persists, closed and commented on when it recovers.
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /Open or update the operator alert/);
  assert.match(workflow, /Close a recovered operator alert/);
  assert.match(workflow, /state: 'closed', state_reason: 'completed'/);
  // A failure is never swallowed.
  assert.match(workflow, /Fail the workflow after alerting[\s\S]*run: exit 1/);
});

test('the disclosure sync workflow is untouched', async () => {
  const workflow = await readFile(new URL('../.github/workflows/disclosure-daily-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: "5 7 \* \* 1-5"/);
  assert.match(workflow, /node scripts\/sync-disclosures\.mjs/);
  assert.match(workflow, /\[Alert\] OpenDART daily sync failure/);
});
