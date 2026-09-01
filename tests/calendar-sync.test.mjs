import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  EVENTS_TABLE,
  ensureCalendarEventSchema,
  getEventsForMonth,
  getSourceRuns
} from '../functions/_calendar-events.js';
import { runCalendarSync, syncBok, syncFomc, syncYears } from '../functions/_calendar-sync.js';

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
  row(sql, ...values) { return this.database.prepare(sql).get(...values) || null; }
  rows(sql, ...values) { return this.database.prepare(sql).all(...values); }
  close() { this.database.close(); }
}

const fixture = name => readFile(new URL(`./fixtures/calendar/${name}`, import.meta.url), 'utf8');

const PAGES = {
  'federalreserve.gov': await fixture('fomc-calendars.html'),
  'cpi.htm': await fixture('bls-cpi.html'),
  'empsit.htm': await fixture('bls-empsit.html'),
  'bea.gov': await fixture('bea-schedule.html'),
  'pYear=2026': await fixture('bok-2026.html'),
  'pYear=2027': await fixture('bok-2027.html')
};

const NOW = new Date('2026-09-02T00:00:00.000Z');

function pageFetch(overrides = {}) {
  const requested = [];
  const impl = async (url) => {
    requested.push(String(url));
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (String(url).includes(pattern)) {
        if (typeof handler === 'function') return handler();
        return handler;
      }
    }
    const key = Object.keys(PAGES).find(candidate => String(url).includes(candidate));
    if (!key) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => PAGES[key] };
  };
  impl.requested = requested;
  return impl;
}

async function freshDb() {
  const db = new SqliteD1();
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  return db;
}

const runOf = (results, name) => results.find(result => result.sourceName === name);

/* ---------------------------------------------------------- the whole pass */

test('one pass fills the calendar from every source', async () => {
  const db = await freshDb();
  const outcome = await runCalendarSync(db, { fetchImpl: pageFetch(), now: NOW });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.years, [2026, 2027]);
  assert.deepEqual(outcome.failed, []);

  const september = await getEventsForMonth(db, 2026, 9);
  assert.deepEqual(september.map(event => `${event.date} ${event.title.en}`), [
    '2026-09-04 US Employment Situation',
    '2026-09-10 KOSPI 200 Monthly Options Expiration',
    '2026-09-11 US Consumer Price Index',
    '2026-09-16 FOMC Rate Decision',
    '2026-09-18 US Standard Monthly Options Expiration',
    '2026-09-30 US Personal Income and Outlays (PCE)'
  ]);
  db.close();
});

test('running the pass twice changes nothing', async () => {
  const db = await freshDb();
  await runCalendarSync(db, { fetchImpl: pageFetch(), now: NOW });
  const before = db.rows(`SELECT event_id, event_date, status FROM ${EVENTS_TABLE} ORDER BY event_id`);

  const second = await runCalendarSync(db, { fetchImpl: pageFetch(), now: new Date('2026-09-03T00:00:00.000Z') });
  const after = db.rows(`SELECT event_id, event_date, status FROM ${EVENTS_TABLE} ORDER BY event_id`);

  assert.deepEqual(after, before, 'a second pass must not add, move or cancel anything');
  assert.equal(second.results.every(result => (result.created ?? 0) === 0), true);
  assert.equal(second.results.every(result => (result.cancelled ?? 0) === 0), true);
  db.close();
});

/* ------------------------------------------------ pending, and not pending */

test('a year the Board has not announced is pending, not a failure', async () => {
  const db = await freshDb();
  const outcome = await runCalendarSync(db, { fetchImpl: pageFetch(), now: NOW });

  const next = runOf(outcome.results, 'bank-of-korea-2027');
  assert.equal(next.status, 'pending');
  assert.equal(next.events, 0);
  assert.equal(outcome.ok, true, 'a pending year does not fail the pass');

  const runs = await getSourceRuns(db);
  const stored = runs.find(run => run.sourceName === 'bank-of-korea-2027');
  assert.equal(stored.status, 'pending');
  assert.equal(stored.lastError, '', 'pending is not an error');
  db.close();
});

test('the current year answering with nothing is a failure, not pending', async () => {
  const db = await freshDb();
  // The page is reachable and still looks like itself, but lists no meetings.
  const empty = { ok: true, status: 200, text: async () => '<html><body>통화정책방향 결정회의<table></table></body></html>' };
  const result = await syncBok(db, {
    year: 2026, currentYear: 2026, now: NOW,
    fetchImpl: pageFetch({ 'pYear=2026': empty })
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /should be published/);
  const stored = (await getSourceRuns(db)).find(run => run.sourceName === 'bank-of-korea-2026');
  assert.equal(stored.status, 'error');
  db.close();
});

/* ------------------------------------------------------------- failure */

test('a source that fails leaves its stored events alone', async () => {
  const db = await freshDb();
  await runCalendarSync(db, { fetchImpl: pageFetch(), now: NOW });
  const before = db.rows(`SELECT event_id, status FROM ${EVENTS_TABLE} WHERE source_name = 'federal-reserve' ORDER BY event_id`);
  assert.ok(before.length >= 8);

  const failing = pageFetch({ 'federalreserve.gov': { ok: false, status: 503, text: async () => '' } });
  const result = await syncFomc(db, { years: [2026, 2027], fetchImpl: failing, now: NOW });

  assert.equal(result.status, 'error');
  assert.match(result.error, /HTTP 503/);
  const after = db.rows(`SELECT event_id, status FROM ${EVENTS_TABLE} WHERE source_name = 'federal-reserve' ORDER BY event_id`);
  assert.deepEqual(after, before, 'a failed fetch must never be read as "everything was withdrawn"');
  db.close();
});

test('a page that changed shape fails rather than emptying the calendar', async () => {
  const db = await freshDb();
  await runCalendarSync(db, { fetchImpl: pageFetch(), now: NOW });
  const before = db.rows(`SELECT count(*) AS n FROM ${EVENTS_TABLE} WHERE source_name = 'federal-reserve'`)[0].n;

  const replaced = { ok: true, status: 200, text: async () => '<html><body><p>We are making improvements.</p></body></html>' };
  const result = await syncFomc(db, { years: [2026], fetchImpl: pageFetch({ 'federalreserve.gov': replaced }), now: NOW });

  assert.equal(result.status, 'error');
  assert.equal(db.rows(`SELECT count(*) AS n FROM ${EVENTS_TABLE} WHERE source_name = 'federal-reserve'`)[0].n, before);
  db.close();
});

test('one broken source does not stop the others', async () => {
  const db = await freshDb();
  const outcome = await runCalendarSync(db, {
    fetchImpl: pageFetch({ 'bea.gov': { ok: false, status: 500, text: async () => '' } }),
    now: NOW
  });

  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.failed, ['bea']);
  // Everything else still landed.
  assert.equal(runOf(outcome.results, 'federal-reserve').status, 'ok');
  assert.equal(runOf(outcome.results, 'bls-cpi').status, 'ok');
  assert.equal(runOf(outcome.results, 'bank-of-korea-2026').status, 'ok');
  db.close();
});

/* ------------------------------------------------------ withdrawal scope */

test('a source that drops a date cancels only its own, only in its window', async () => {
  const db = await freshDb();
  await runCalendarSync(db, { fetchImpl: pageFetch(), now: NOW });

  // The Fed page comes back with September missing. The month and its day
  // range sit in separate elements, so the range is removed from the 2026
  // block specifically.
  const page = PAGES['federalreserve.gov'];
  const blockAt = page.indexOf('2026 FOMC Meetings');
  const rangeAt = page.indexOf('>15-16*<', blockAt);
  assert.ok(rangeAt > blockAt, 'the fixture should carry the September 2026 range');
  const withoutSeptember = `${page.slice(0, rangeAt)}>15<${page.slice(rangeAt + '>15-16*<'.length)}`;
  const result = await syncFomc(db, {
    years: [2026, 2027], now: NOW,
    fetchImpl: pageFetch({ 'federalreserve.gov': { ok: true, status: 200, text: async () => withoutSeptember } })
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.cancelled, 1);
  const september = db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE event_id = 'official:fomc:2026-09-16'`);
  assert.equal(september.status, 'cancelled', 'the row stays, marked withdrawn');
  // Another source's September event is untouched.
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE source_name = 'bls-cpi' AND event_date = '2026-09-11'`).status, 'scheduled');
  db.close();
});

/* ------------------------------------------------------------- the rules */

test('the computed expiries need no network at all', async () => {
  const db = await freshDb();
  const offline = pageFetch({ 'http': { ok: false, status: 503, text: async () => '' } });
  const outcome = await runCalendarSync(db, { fetchImpl: offline, now: NOW });

  assert.equal(runOf(outcome.results, 'krx-expiry-rule').status, 'ok');
  assert.equal(runOf(outcome.results, 'us-expiry-rule').status, 'ok');
  // KRX holidays are only checked in for 2026, so only that year is computed.
  assert.equal(runOf(outcome.results, 'krx-expiry-rule').events, 12);
  assert.equal(runOf(outcome.results, 'us-expiry-rule').events, 24);
  db.close();
});

/* ------------------------------------------------------------ the window */

test('the pass covers this year and the next', () => {
  assert.deepEqual(syncYears(new Date('2026-09-02T00:00:00Z')), [2026, 2027]);
  assert.deepEqual(syncYears(new Date('2027-01-01T00:00:00Z')), [2027, 2028]);
});

test('every source identifies itself with the page it read', async () => {
  const db = await freshDb();
  await runCalendarSync(db, { fetchImpl: pageFetch(), now: NOW });
  for (const run of await getSourceRuns(db)) {
    assert.ok(run.sourceUrl.startsWith('https://'), `${run.sourceName} must record its page`);
    assert.ok(run.lastAttemptAt, `${run.sourceName} must record when it was tried`);
  }
  db.close();
});
