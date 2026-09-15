import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { onRequestGet as statusGet, onRequestPost as syncPost } from '../functions/api/calendar/sync.js';
import { ensureCalendarEventSchema, recordSourceRun } from '../functions/_calendar-events.js';
import {
  CalendarSyncError,
  collectFailures,
  formatFailureReport,
  runCli,
  syncCalendar
} from '../scripts/sync-calendar.mjs';

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

/* ---------------------------------------------------- the failure report */

const FAILED_AT = new Date('2026-09-14T14:25:15.000Z');
const answer = (body, status) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('the runner names every failed source with its stage, HTTP status, attempt and time', async () => {
  const result = await syncCalendar({
    key: SYNC_KEY,
    fetchImpl: answer({
      ok: false, years: [2026, 2027], failed: ['bea', 'bank-of-korea-2026'],
      failures: [
        { source: 'bea', stage: 'fetch', error: 'HTTP 503', httpStatus: 503, attempt: 1 },
        { source: 'bank-of-korea-2026', stage: 'parse', error: 'expected date field missing', httpStatus: null, attempt: 1 }
      ],
      results: [
        { sourceName: 'bea', status: 'error', stage: 'fetch', error: 'HTTP 503', httpStatus: 503, attempt: 1 },
        { sourceName: 'bank-of-korea-2026', status: 'error', stage: 'parse', error: 'expected date field missing', attempt: 1 }
      ]
    }, 502)
  });

  assert.equal(result.ok, false);
  assert.equal(result.httpStatus, 502);
  assert.deepEqual(result.failed, ['bea', 'bank-of-korea-2026']);
  const report = formatFailureReport(result.failures, { now: FAILED_AT });
  assert.match(report, /^Calendar sync failed\n\nFailed sources:\n- bea: fetch — HTTP 503\n- bank-of-korea-2026: parse — expected date field missing\n/);
  assert.match(report, /source: bea\nstage: fetch\nerror: HTTP 503\nhttp_status: 503\nattempt: 1\ntimestamp: 2026-09-14T14:25:15\.000Z \(2026-09-14 23:25:15 KST\)/);
  assert.match(report, /source: bank-of-korea-2026\nstage: parse\nerror: expected date field missing\nhttp_status: n\/a/);
});

test('an older answer without stages still names the failed source', () => {
  const failures = collectFailures({
    ok: false, failed: ['bea'],
    results: [{ sourceName: 'federal-reserve', status: 'ok', events: 16 }, { sourceName: 'bea', status: 'error', error: 'HTTP 503' }]
  }, { httpStatus: 502 });
  assert.deepEqual(failures, [{ source: 'bea', stage: 'fetch', error: 'HTTP 503', httpStatus: 503, attempt: 1 }]);
});

test('#117: a failed answer that names no source is reported as internal, never as an empty list', async () => {
  // The 2026-09-14 run received a JSON answer with ok !== true and neither
  // `results` nor `failed`, and printed "sources failed:" with nothing after it.
  for (const [body, status] of [[{ ok: false, error: 'UPSTREAM' }, 502], [{}, 200], [{ ok: false, failed: [], results: [] }, 502]]) {
    const result = await syncCalendar({ key: SYNC_KEY, fetchImpl: answer(body, status) });
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(result.failures.length, 1);
    assert.deepEqual(
      { source: result.failures[0].source, stage: result.failures[0].stage, httpStatus: result.failures[0].httpStatus },
      { source: 'internal', stage: 'orchestration', httpStatus: status }
    );
    assert.match(result.failures[0].error, new RegExp(`HTTP ${status}`));

    const report = formatFailureReport(result.failures, { now: FAILED_AT });
    assert.doesNotMatch(report, /sources failed:\s*$/m);
    assert.match(report, /- internal: orchestration — HTTP \d{3}/);
    assert.match(report, /source: internal\nstage: orchestration/);
  }
  const unnamed = collectFailures({ ok: false, error: 'UPSTREAM', message: 'bad gateway' }, { httpStatus: 502 });
  assert.match(unnamed[0].error, /keys=\[ok,error,message\] error=UPSTREAM message=bad gateway/);
});

test('an empty failure list is itself reported as an internal failure', () => {
  for (const failures of [[], undefined, null]) {
    const report = formatFailureReport(failures, { now: FAILED_AT });
    assert.match(report, /Failed sources:\n- internal: orchestration — sync reported a failure without naming any source/);
    assert.match(report, /source: internal\nstage: orchestration/);
  }
});

test('the command line passes quietly and writes a named report when anything fails', async () => {
  const written = [];
  const quiet = { log: () => {}, logError: () => {}, now: () => FAILED_AT, writeReport: async (path, text) => { written.push({ path, text }); } };

  const pass = await runCli({
    ...quiet, env: { CALENDAR_SYNC_REPORT: '/tmp/report.txt' },
    syncImpl: async () => ({ ok: true, years: [2026], failures: [], results: [{ sourceName: 'bea', status: 'ok', events: 4 }] })
  });
  assert.equal(pass, 0);
  assert.equal(written.length, 0);

  const failed = await runCli({
    ...quiet, env: { CALENDAR_SYNC_REPORT: '/tmp/report.txt' },
    syncImpl: async () => ({
      ok: false, httpStatus: 502, years: [2026],
      failures: [{ source: 'federal-reserve', stage: 'parse', error: 'no meeting date ranges found', httpStatus: null, attempt: 1 }],
      results: [{ sourceName: 'federal-reserve', status: 'error', stage: 'parse', error: 'no meeting date ranges found' }]
    })
  });
  assert.equal(failed, 1);
  assert.equal(written[0].path, '/tmp/report.txt');
  assert.match(written[0].text, /- federal-reserve: parse — no meeting date ranges found/);

  // Thrown before any source result exists: still named.
  const thrown = await runCli({
    ...quiet, env: { CALENDAR_SYNC_REPORT: '/tmp/report.txt' },
    syncImpl: async () => { throw new CalendarSyncError('network', 'calendar sync network failure: getaddrinfo ENOTFOUND'); }
  });
  assert.equal(thrown, 1);
  assert.match(written[1].text, /source: internal\nstage: orchestration\nerror: \[network\] calendar sync network failure: getaddrinfo ENOTFOUND\nhttp_status: n\/a/);
});

test('a pass that cannot run at all still answers with a named internal failure', async () => {
  const db = await freshDb();
  const response = await syncPost({
    request: new Request('https://snowshagal.com/api/calendar/sync', { method: 'POST', headers: { 'x-disclosure-sync-key': SYNC_KEY } }),
    env: { COMMENTS_DB: db, DISCLOSURE_SYNC_KEY: SYNC_KEY },
    now: new Date('not a date')
  });
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.failed, ['internal']);
  assert.equal(payload.failures[0].stage, 'orchestration');
  assert.match(payload.failures[0].error, /Invalid time value/);
  db.close();
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
  // The alert quotes the named failure report instead of pointing at the log,
  // and a missing report is itself named rather than left blank.
  assert.equal((workflow.match(/CALENDAR_SYNC_REPORT: \$\{\{ runner\.temp \}\}\/calendar-sync-report\.txt/g) || []).length, 2);
  assert.match(workflow, /readFileSync\(process\.env\.CALENDAR_SYNC_REPORT/);
  assert.match(workflow, /source: internal', 'stage: orchestration'/);
  assert.doesNotMatch(workflow, /The per-source lines in the run log say which source stopped answering/);
});

test('the disclosure sync workflow is untouched', async () => {
  const workflow = await readFile(new URL('../.github/workflows/disclosure-daily-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: "5 7 \* \* 1-5"/);
  assert.match(workflow, /node scripts\/sync-disclosures\.mjs/);
  assert.match(workflow, /\[Alert\] OpenDART daily sync failure/);
});
