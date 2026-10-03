import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  DEFAULT_DART_DAILY_BUDGET,
  DEFAULT_MAX_PAGES_PER_CLASS,
  FILINGS_TABLE,
  WATCHLIST_TABLE,
  disclosureConfig,
  ensureDisclosureSchema,
  normalizeFiling
} from '../functions/api/disclosures/_shared.js';
import { onRequestPost as syncPost } from '../functions/api/disclosures/sync.js';
import { onRequestGet as feedGet } from '../functions/api/disclosures/feed.js';
import {
  DisclosureSyncError,
  SCHEDULE_SLOT_UTC,
  catchUpDate,
  pagesRead,
  resolveSyncWindow,
  runCli,
  scheduledTargetDate,
  syncDisclosures
} from '../scripts/sync-disclosures.mjs';
import { ALERT_MARKER, ALERT_TITLE, datesInRange, pendingDates, planAlert } from '../scripts/disclosure-sync-alert.mjs';
import { createAdminSession, createMockAuthDb } from './helpers/auth-test-helper.mjs';

// #157: a run's date is its schedule slot, not the moment GitHub starts it; the
// previous KRX trading day is read again; a truncated read is a failure; and the
// alert closes only once every failed date has been synced.

const SYNC_KEY = 'fixture-disclosure-sync-key-9c1e';
const RUN_URL = 'https://github.com/snowshagal-bot/market-research-site/actions/runs/1';

class SqliteStatement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class SqliteD1 {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new SqliteStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.database.close(); }
}

const authDb = await createMockAuthDb();

// --------------------------------------------------------------------------
// R1: the logical date
// --------------------------------------------------------------------------

test('a scheduled run keeps its slot date however late GitHub starts it', () => {
  // 2026-09-28 (Mon): slot 07:05Z = 16:05 KST. GitHub actually started it at 15:09Z = 00:09 KST 09-29.
  assert.equal(scheduledTargetDate(new Date('2026-09-28T07:05:00Z')), '2026-09-28');
  assert.equal(scheduledTargetDate(new Date('2026-09-28T15:09:25Z')), '2026-09-28');
  assert.equal(scheduledTargetDate(new Date('2026-09-29T03:00:00Z')), '2026-09-28', 'still before the Tuesday slot');
  // Monday before its slot belongs to Friday; a weekend start belongs to Friday too.
  assert.equal(scheduledTargetDate(new Date('2026-10-05T01:00:00Z')), '2026-10-02');
  assert.equal(scheduledTargetDate(new Date('2026-10-03T12:00:00Z')), '2026-10-02');
  assert.equal(SCHEDULE_SLOT_UTC.cron, '5 7 * * 1-5');
});

test('the workflow cron is the slot the script assumes', async () => {
  const workflow = await readFile(new URL('../.github/workflows/disclosure-daily-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, new RegExp(`cron: "${SCHEDULE_SLOT_UTC.cron.replace(/\*/g, '\\*')}"`));
});

// --------------------------------------------------------------------------
// R2: the catch-up day
// --------------------------------------------------------------------------

test('every run reads the previous KRX trading day again', () => {
  assert.equal(catchUpDate('2026-10-02'), '2026-10-01');
  assert.equal(catchUpDate('2026-10-05'), '2026-10-02', '10-05 is a KRX holiday; the run still covers Friday');
  assert.equal(catchUpDate('2026-10-06'), '2026-10-02', 'across the 10-05 holiday and the weekend');
  assert.equal(catchUpDate('2026-09-28'), '2026-09-23', 'across Chuseok');
  // A year the KRX calendar does not cover yet falls back to the previous weekday.
  assert.equal(catchUpDate('2027-01-04'), '2027-01-01');
  assert.equal(catchUpDate('2026-01-02'), '2026-01-01');
});

test('the window: scheduled = catch-up..slot date, a dated dispatch = exactly that date', () => {
  assert.deepEqual(resolveSyncWindow({ mode: 'scheduled', now: new Date('2026-09-28T15:09:25Z') }),
    { mode: 'scheduled', targetDate: '2026-09-28', beginDate: '2026-09-23', endDate: '2026-09-28' });
  assert.deepEqual(resolveSyncWindow({ mode: 'scheduled', now: new Date('2026-10-05T13:41:42Z') }),
    { mode: 'scheduled', targetDate: '2026-10-05', beginDate: '2026-10-02', endDate: '2026-10-05' });
  assert.deepEqual(resolveSyncWindow({ mode: 'manual', date: '2026-10-02', now: new Date('2026-10-03T14:00:00Z') }),
    { mode: 'date', targetDate: '2026-10-02', beginDate: '2026-10-02', endDate: '2026-10-02' });
  assert.deepEqual(resolveSyncWindow({ mode: 'manual', now: new Date('2026-10-02T13:00:00Z') }),
    { mode: 'manual', targetDate: '2026-10-02', beginDate: '2026-10-01', endDate: '2026-10-02' });
  for (const bad of ['2026-02-30', '20261002', '2026-10-2', '2026-10-04']) {
    assert.throws(() => resolveSyncWindow({ date: bad, now: new Date('2026-10-03T14:00:00Z') }),
      error => error instanceof DisclosureSyncError && error.kind === 'configuration', bad);
  }
});

// --------------------------------------------------------------------------
// The client: request, echo check, truncation, diagnostics
// --------------------------------------------------------------------------

const okBody = (overrides = {}) => ({
  ok: true,
  syncedAt: '2026-10-03T14:00:00.000Z',
  source: {
    provider: 'opendart', beginDate: '20261002', endDate: '20261002', fetched: 120, created: 120, updated: 0,
    truncated: false, classes: [{ corpClass: 'Y', totalPage: 1, reportedTotal: 60, fetchedRows: 60 }, { corpClass: 'K', totalPage: 1, reportedTotal: 60, fetchedRows: 60 }],
    ...overrides
  },
  ai: { completed: 0 }
});
const answer = (body, status = 200, headers = {}) => async () => new Response(
  typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } }
);
const WINDOW_1002 = { mode: 'date', targetDate: '2026-10-02', beginDate: '2026-10-02', endDate: '2026-10-02' };

test('the client asks for its window and refuses an answer for another one', async () => {
  let sent;
  const result = await syncDisclosures({
    key: SYNC_KEY,
    window: WINDOW_1002,
    fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return answer(okBody())(); }
  });
  assert.deepEqual(sent, { beginDate: '20261002', endDate: '20261002' }, 'a dated backfill does not claim to be the scheduled run');
  assert.equal(result.beginDate, '2026-10-02');
  assert.equal(result.pages, 2);

  await syncDisclosures({
    key: SYNC_KEY,
    window: { mode: 'scheduled', targetDate: '2026-10-05', beginDate: '2026-10-02', endDate: '2026-10-05' },
    fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return answer(okBody({ beginDate: '20261002', endDate: '20261005' }))(); }
  });
  assert.deepEqual(sent, { beginDate: '20261002', endDate: '20261005', scheduled: true });

  await assert.rejects(
    syncDisclosures({ key: SYNC_KEY, window: WINDOW_1002, fetchImpl: answer(okBody({ beginDate: '20261003', endDate: '20261003' })) }),
    error => error.kind === 'validation' && /answered for 2026-10-03\.\.2026-10-03, not the requested 2026-10-02\.\.2026-10-02/.test(error.message)
  );
});

test('a truncated answer is a failure, not a success', async () => {
  const truncated = okBody({
    truncated: true,
    classes: [{ corpClass: 'Y', totalPage: 3, reportedTotal: 250, fetchedRows: 250 }, { corpClass: 'K', totalPage: 14, reportedTotal: 1320, fetchedRows: 1000 }]
  });
  await assert.rejects(
    syncDisclosures({ key: SYNC_KEY, window: WINDOW_1002, fetchImpl: answer(truncated) }),
    error => error instanceof DisclosureSyncError && error.kind === 'truncated'
      && /K: 1000\/1320 rows, 10\/14 pages/.test(error.message)
      && /DISCLOSURE_DART_MAX_PAGES_PER_CLASS/.test(error.message)
  );
});

test('a Cloudflare error keeps error_code, ray_id and cf-ray, and never the key', async () => {
  const cloudflare = {
    type: 'https://developers.cloudflare.com/fixture/', title: 'Fixture gateway timeout', status: 504,
    detail: `echo ${SYNC_KEY}`, instance: 'fixture', error_code: 1102, error_name: 'fixture_name',
    error_category: 'workers', ray_id: '8c1f2a3b4c5d6e7f', retryable: true, cloudflare_error: true, footer: 'not copied'
  };
  const logs = [];
  const results = [];
  const code = await runCli({
    args: ['--date', '2026-10-02'],
    env: { DISCLOSURE_SYNC_RESULT: '/tmp/result.json' },
    now: () => new Date('2026-10-03T14:00:00Z'),
    syncImpl: options => syncDisclosures({ ...options, key: SYNC_KEY, fetchImpl: answer(cloudflare, 504, { 'cf-ray': '8c1f2a3b4c5d6e7f-ICN' }) }),
    log: line => logs.push(line),
    logError: line => logs.push(line),
    writeResult: async (_path, text) => results.push(JSON.parse(text))
  });
  assert.equal(code, 1);
  const [result] = results;
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'server');
  assert.equal(result.targetDate, '2026-10-02');
  assert.match(result.report, /^OpenDART daily sync failed\n\ntarget_date: 2026-10-02 \(date\)\nrange: 2026-10-02\.\.2026-10-02\nerror: \[server\] OpenDART sync API returned HTTP 504\n/);
  assert.match(result.report, /\nResponse diagnostics:\nhttp_status: 504\ncontent_type: application\/json\ncf_ray: 8c1f2a3b4c5d6e7f-ICN\n/);
  assert.match(result.report, /^cloudflare\.error_code: 1102$/m);
  assert.match(result.report, /^cloudflare\.ray_id: 8c1f2a3b4c5d6e7f$/m);
  assert.doesNotMatch(result.report, /not copied/);
  const everything = JSON.stringify(results) + logs.join('\n');
  assert.ok(!everything.includes(SYNC_KEY), 'the key is printed nowhere');
  assert.match(everything, /\[redacted\]/);
});

test('the app\'s own error keeps its message and adds only status, content-type and cf-ray', async () => {
  await assert.rejects(
    syncDisclosures({ key: SYNC_KEY, fetchImpl: answer({ ok: false, error: 'OPENDART_TIMEOUT', message: 'OpenDART 응답이 지연되고 있습니다.' }, 504) }),
    error => error.kind === 'server' && /HTTP 504: OpenDART 응답이 지연되고 있습니다\./.test(error.message)
      && error.diagnostics.cloudflare === null && error.diagnostics.bodyPreview === null
  );
});

test('a passing run prints its date, range and pages and writes a passing result', async () => {
  const logs = [];
  const results = [];
  const code = await runCli({
    args: [],
    env: { SYNC_EVENT: 'schedule', DISCLOSURE_SYNC_RESULT: '/tmp/result.json' },
    now: () => new Date('2026-10-05T13:41:42Z'),
    syncImpl: options => syncDisclosures({ ...options, key: SYNC_KEY, fetchImpl: answer(okBody({ beginDate: '20261002', endDate: '20261005' })) }),
    log: line => logs.push(line),
    logError: line => logs.push(line),
    writeResult: async (_path, text) => results.push(JSON.parse(text))
  });
  assert.equal(code, 0);
  assert.match(logs[0], /^PASS OpenDART daily sync: target=2026-10-05 \(scheduled\) range=2026-10-02\.\.2026-10-05 fetched=120 created=120 updated=0 pages=2 publishDate=n\/a /);
  assert.deepEqual({ ok: results[0].ok, beginDate: results[0].beginDate, endDate: results[0].endDate }, { ok: true, beginDate: '2026-10-02', endDate: '2026-10-05' });
});

// --------------------------------------------------------------------------
// R3: the alert closes only when every failed date is synced
// --------------------------------------------------------------------------

const failure = target => ({ ok: false, targetDate: target, report: `OpenDART daily sync failed\n\ntarget_date: ${target}` });
const success = (beginDate, endDate) => ({ ok: true, beginDate, endDate });

test('a failure opens the alert with its date, and another failure adds its date', () => {
  const first = planAlert({ issue: null, result: failure('2026-10-02'), runUrl: RUN_URL });
  assert.equal(first.action, 'create');
  assert.ok(first.body.startsWith(ALERT_MARKER));
  assert.deepEqual(pendingDates(first.body), ['2026-10-02']);
  assert.match(first.body, /\*\*Dates not yet synced:\*\* 2026-10-02/);

  const second = planAlert({ issue: { number: 157, body: first.body }, result: failure('2026-10-05'), runUrl: RUN_URL });
  assert.equal(second.action, 'update');
  assert.deepEqual(pendingDates(second.body), ['2026-10-02', '2026-10-05']);
  assert.match(second.comment, /^Daily sync failed again/);
});

test('a passing run does not close the alert while an older failed date is still missing', () => {
  const body = planAlert({ issue: null, result: failure('2026-09-28'), runUrl: RUN_URL }).body;
  const issue = { number: 157, body: planAlert({ issue: { number: 157, body }, result: failure('2026-10-02'), runUrl: RUN_URL }).body };
  // Monday's run reads 10-02..10-05: 10-02 comes back, 09-28 does not.
  const plan = planAlert({ issue, result: success('2026-10-02', '2026-10-05'), runUrl: RUN_URL });
  assert.equal(plan.action, 'update');
  assert.deepEqual(pendingDates(plan.body), ['2026-09-28']);
  assert.match(plan.comment, /Recovered: 2026-10-02\. Still not synced: 2026-09-28\./);
  assert.match(plan.body, /Latest failure: /, 'the last failure report is kept');

  const closed = planAlert({ issue: { number: 157, body: plan.body }, result: success('2026-09-28', '2026-09-28'), runUrl: RUN_URL });
  assert.equal(closed.action, 'close');
  assert.match(closed.comment, /covers every date this alert was waiting for \(2026-09-28\)/);
});

test('without an open alert a passing run does nothing; an untracked old alert is never auto-closed', () => {
  assert.deepEqual(planAlert({ issue: null, result: success('2026-10-02', '2026-10-05'), runUrl: RUN_URL }), { action: 'none' });
  const legacy = { number: 157, body: `${ALERT_MARKER}\nOpenDART daily disclosure synchronization failed.` };
  const plan = planAlert({ issue: legacy, result: success('2026-10-02', '2026-10-05'), runUrl: RUN_URL });
  assert.equal(plan.action, 'comment');
  assert.match(plan.comment, /stays open/);
});

test('a crash before the window was known still alerts and keeps the dates already waiting', () => {
  const issue = { number: 157, body: planAlert({ issue: null, result: failure('2026-10-02'), runUrl: RUN_URL }).body };
  const plan = planAlert({ issue, result: { ok: false, report: 'the sync step failed without writing its result' }, runUrl: RUN_URL });
  assert.equal(plan.action, 'update');
  assert.deepEqual(pendingDates(plan.body), ['2026-10-02']);
});

test('datesInRange covers every calendar day of a catch-up window', () => {
  assert.deepEqual(datesInRange('2026-10-02', '2026-10-05'), ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
  assert.deepEqual(datesInRange('2026-10-05', '2026-10-02'), []);
  assert.equal(ALERT_TITLE, '[Alert] OpenDART daily sync failure', 'the same issue as before');
});

// --------------------------------------------------------------------------
// The server: the window decides "today", and OpenDART calls stay bounded
// --------------------------------------------------------------------------

async function freshDb() {
  const d1 = new SqliteD1();
  const db = { prepare: sql => d1.prepare(sql), batch: statements => d1.batch(statements), close: () => d1.close() };
  await ensureDisclosureSchema({ COMMENTS_DB: db });
  await db.prepare(`INSERT INTO ${WATCHLIST_TABLE} (stock_code, corp_code, corp_name, active, disclosure_enabled, created_at, updated_at)
    VALUES ('005930', '00126380', '삼성전자', 1, 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')
    ON CONFLICT(stock_code) DO UPDATE SET active = 1, disclosure_enabled = 1`).run();
  return { d1, db };
}

const filing = (rceptNo, rcptDate, overrides = {}) => ({
  rcept_no: rceptNo, corp_cls: 'Y', corp_name: '삼성전자', corp_code: '00126380', stock_code: '005930',
  report_nm: '주요사항보고서(유상증자결정)', flr_nm: '삼성전자', rcept_dt: rcptDate, rm: '', ...overrides
});

function opendart(listByCall) {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(new URL(url));
    const page = Number(new URL(url).searchParams.get('page_no'));
    const { list, totalPage = 1 } = listByCall(new URL(url), page);
    return new Response(JSON.stringify({ status: list.length ? '000' : '013', message: '정상', total_count: list.length, total_page: totalPage, list }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  };
  return { calls, fetchImpl };
}

async function postSync(db, body, now, extraEnv = {}, headers = { 'x-disclosure-sync-key': SYNC_KEY }) {
  const request = new Request('https://snowshagal.com/api/disclosures/sync', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const env = { AUTH_DB: authDb, COMMENTS_DB: db, DISCLOSURE_SYNC_KEY: SYNC_KEY, OPENDART_API_KEY: 'fixture-opendart', DISCLOSURE_LLM_PROVIDER: 'none', DISCLOSURE_LLM_PER_RUN: '0', ...extraEnv };
  const response = await syncPost({ request, env, now });
  return { status: response.status, data: await response.json() };
}

const statusOf = async (db, rceptNo) => (await db.prepare(`SELECT publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`).bind(rceptNo).first())?.publish_status;

test('a scheduled run GitHub starts after midnight KST publishes its own day like an on-time run', async () => {
  assert.ok(normalizeFiling(filing('20260928000001', '20260928')).ruleScore >= 7, 'fixture is auto-publish eligible');
  const lateStart = new Date('2026-09-28T15:09:25Z'); // 00:09 KST 09-29, the real 09-28 start
  const list = [filing('20260928000001', '20260928'), filing('20260923000009', '20260923')];
  const originalFetch = globalThis.fetch;
  try {
    // Before: no window, so the late run read 09-29 and never saw 09-28 at all.
    {
      const { d1, db } = await freshDb();
      globalThis.fetch = opendart(() => ({ list: [] })).fetchImpl;
      const { data } = await postSync(db, {}, lateStart);
      assert.equal(data.source.beginDate, '20260929', 'without a window the late run reads the wrong day');
      d1.close();
    }
    // After: the scheduled window 09-23..09-28. The server derives 09-28 from its own
    // clock, so 09-28 publishes as it would have at 16:05; the catch-up day does not.
    const { d1, db } = await freshDb();
    globalThis.fetch = opendart(() => ({ list })).fetchImpl;
    const { status, data } = await postSync(db, { beginDate: '20260923', endDate: '20260928', scheduled: true }, lateStart);
    assert.equal(status, 200);
    assert.equal(data.source.publishDate, '20260928');
    assert.equal(await statusOf(db, '20260928000001'), 'auto');
    assert.equal(await statusOf(db, '20260923000009'), 'admin_only', 'Date Guard: a catch-up day never auto-publishes');
    const feed = await (await feedGet({ request: new Request('https://snowshagal.com/api/disclosures/feed?date=2026-09-28'), env: { COMMENTS_DB: db } })).json();
    assert.deepEqual(feed.items.map(item => item.rceptNo), ['20260928000001']);
    d1.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Date Guard still holds for everyone else: a dated backfill and an admin "scheduled" flag keep KST today', async () => {
  const lateStart = new Date('2026-09-28T15:09:25Z');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = opendart(() => ({ list: [filing('20260928000001', '20260928')] })).fetchImpl;
    // A dated backfill (no scheduled flag), even with the machine key.
    {
      const { d1, db } = await freshDb();
      const { data } = await postSync(db, { beginDate: '20260928', endDate: '20260928' }, lateStart);
      assert.equal(data.source.publishDate, '20260929');
      assert.equal(await statusOf(db, '20260928000001'), 'admin_only');
      d1.close();
    }
    // An admin session cannot claim to be the scheduled run.
    {
      const { d1, db } = await freshDb();
      const session = await createAdminSession(authDb);
      const request = new Request('https://admin.snowshagal.com/api/disclosures/sync', {
        method: 'POST',
        headers: { ...session.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ beginDate: '20260928', endDate: '20260928', scheduled: true })
      });
      const env = { AUTH_DB: authDb, COMMENTS_DB: db, DISCLOSURE_SYNC_KEY: SYNC_KEY, OPENDART_API_KEY: 'fixture-opendart', DISCLOSURE_LLM_PROVIDER: 'none', DISCLOSURE_LLM_PER_RUN: '0' };
      const response = await syncPost({ request, env, now: lateStart });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).source.publishDate, '20260929');
      assert.equal(await statusOf(db, '20260928000001'), 'admin_only');
      d1.close();
    }
    // `scheduled` must be exactly true; a string does not count.
    {
      const { d1, db } = await freshDb();
      const { data } = await postSync(db, { beginDate: '20260928', endDate: '20260928', scheduled: 'true' }, lateStart);
      assert.equal(data.source.publishDate, '20260929');
      d1.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reading the catch-up day again never duplicates a filing or undoes an admin decision', async () => {
  const { d1, db } = await freshDb();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = opendart(() => ({ list: [filing('20261002000001', '20261002'), filing('20261002000002', '20261002')] })).fetchImpl;
    await postSync(db, { beginDate: '20261001', endDate: '20261002', scheduled: true }, new Date('2026-10-02T13:41:42Z'));
    assert.equal(await statusOf(db, '20261002000001'), 'auto');
    await db.prepare(`UPDATE ${FILINGS_TABLE} SET publish_status = 'suppressed' WHERE rcept_no = '20261002000002'`).run();

    // Monday's scheduled run reads 10-02..10-05 again; one 10-02 filing is new to it.
    globalThis.fetch = opendart(() => ({ list: [filing('20261002000001', '20261002'), filing('20261002000002', '20261002'), filing('20261002000003', '20261002')] })).fetchImpl;
    const { data } = await postSync(db, { beginDate: '20261002', endDate: '20261005', scheduled: true }, new Date('2026-10-05T13:00:00Z'));
    assert.equal(data.source.created, 1);
    assert.equal(data.source.updated, 2);
    const rows = await db.prepare(`SELECT rcept_no, publish_status FROM ${FILINGS_TABLE} ORDER BY rcept_no`).all();
    assert.deepEqual(rows.results.map(row => [row.rcept_no, row.publish_status]), [
      ['20261002000001', 'auto'],
      ['20261002000002', 'suppressed'],
      ['20261002000003', 'admin_only']
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    d1.close();
  }
});

test('OpenDART calls per run are capped at classes x max pages, far inside the daily limits', async () => {
  const { d1, db } = await freshDb();
  const originalFetch = globalThis.fetch;
  try {
    // A quarterly-deadline-sized window: 25 pages reported per class.
    const source = opendart((_url, page) => ({ list: Array.from({ length: 100 }, (_, i) => filing(`2026111${String(page).padStart(2, '0')}${String(i).padStart(5, '0')}`.slice(0, 14), '20261116')), totalPage: 25 }));
    globalThis.fetch = source.fetchImpl;
    const { data } = await postSync(db, { beginDate: '20261113', endDate: '20261116' }, new Date('2026-11-16T09:00:00Z'));
    const classes = disclosureConfig({}).corpClasses.length;
    assert.equal(source.calls.length, classes * DEFAULT_MAX_PAGES_PER_CLASS, 'Y and K, 10 pages each');
    assert.equal(data.source.truncated, true);
    assert.equal(pagesRead(data.source.classes), source.calls.length, 'the client counts the same calls');

    // The client turns that answer into a failure.
    await assert.rejects(
      syncDisclosures({ key: SYNC_KEY, window: { beginDate: '2026-11-13', endDate: '2026-11-16' }, fetchImpl: answer(data) }),
      error => error.kind === 'truncated'
    );
  } finally {
    globalThis.fetch = originalFetch;
    d1.close();
  }

  // Daily arithmetic: one scheduled run, a few manual runs and backfills, against the
  // internal budget (reserved per call in D1) and OpenDART's 20,000 calls a day per key.
  const perRunDefault = 2 * DEFAULT_MAX_PAGES_PER_CLASS; // Y,K x 10 = 20
  const perRunCeiling = 3 * 20; // DISCLOSURE_CORP_CLASSES=Y,K,N and DISCLOSURE_DART_MAX_PAGES_PER_CLASS=20
  assert.equal(perRunDefault, 20);
  assert.ok(perRunDefault * 10 <= DEFAULT_DART_DAILY_BUDGET, '10 full runs a day fit the default budget of 1,000');
  assert.ok(perRunCeiling * 10 < 20_000, 'even the largest settings stay far below the OpenDART key limit');
  assert.ok(disclosureConfig({ DISCLOSURE_DART_DAILY_BUDGET: '999999' }).dartDailyBudget < 20_000, 'the budget itself is clamped below the key limit');
});

test('the workflow passes the date through the environment and reuses the same alert issue', async () => {
  const workflow = await readFile(new URL('../.github/workflows/disclosure-daily-sync.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*date:/);
  assert.match(workflow, /SYNC_DATE: \$\{\{ inputs\.date \}\}/);
  assert.match(workflow, /SYNC_EVENT: \$\{\{ github\.event_name \}\}/);
  assert.doesNotMatch(workflow, /run: .*inputs\.date/, 'the input never reaches a shell line');
  assert.match(workflow, /DISCLOSURE_SYNC_RESULT: \$\{\{ runner\.temp \}\}\/disclosure-sync-result\.json/);
  assert.match(workflow, /scripts\/disclosure-sync-alert\.mjs/);
  assert.match(workflow, /Fail the workflow after alerting/);
});
