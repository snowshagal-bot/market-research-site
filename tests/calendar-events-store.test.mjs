import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  EVENTS_TABLE,
  cancelMissingEvents,
  ensureCalendarEventSchema,
  getEventsForMonth,
  getSourceRuns,
  normalizeEvent,
  recordSourceRun,
  upsertEvent
} from '../functions/_calendar-events.js';

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
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  row(sql, ...values) { return this.database.prepare(sql).get(...values) || null; }
  rows(sql, ...values) { return this.database.prepare(sql).all(...values); }
  close() { this.database.close(); }
}

const DAY_ONE = new Date('2026-09-01T00:00:00.000Z');
const DAY_TWO = new Date('2026-09-02T00:00:00.000Z');

async function freshDb() {
  const db = new SqliteD1();
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  return db;
}

const fomc = (overrides = {}) => ({
  eventDate: '2026-09-16',
  eventTime: '14:00',
  timezone: 'America/New_York',
  market: 'US',
  category: 'monetary_policy',
  importance: 'high',
  titleKo: 'FOMC 정책금리 결정',
  titleEn: 'FOMC rate decision',
  sourceType: 'official',
  sourceName: 'federal-reserve',
  sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  sourceEventId: 'fomc:2026-09-16',
  ...overrides
});

/* ---------------------------------------------------------- what is allowed */

test('an event without a published time keeps no time at all', () => {
  const noTime = normalizeEvent(fomc({ eventTime: null }));
  assert.equal(noTime.eventTime, null);
  // An empty string means the same thing and must not become "00:00".
  assert.equal(normalizeEvent(fomc({ eventTime: '' })).eventTime, null);
  assert.equal(normalizeEvent(fomc({ eventTime: undefined })).eventTime, null);
});

test('a malformed date or time is refused rather than stored', () => {
  assert.throws(() => normalizeEvent(fomc({ eventDate: '2026-9-16' })), /event_date/);
  assert.throws(() => normalizeEvent(fomc({ eventDate: '' })), /event_date/);
  assert.throws(() => normalizeEvent(fomc({ eventTime: '2pm' })), /event_time/);
  assert.throws(() => normalizeEvent(fomc({ eventTime: '25:00' })), /event_time/);
});

test('an unknown market, category, status or source type is refused', () => {
  assert.throws(() => normalizeEvent(fomc({ market: 'JP' })), /market/);
  assert.throws(() => normalizeEvent(fomc({ category: 'gdp' })), /category/);
  assert.throws(() => normalizeEvent(fomc({ status: 'maybe' })), /status/);
  assert.throws(() => normalizeEvent(fomc({ sourceType: 'guess' })), /source type/);
});

test('an event needs a title in at least one locale', () => {
  assert.throws(() => normalizeEvent(fomc({ titleKo: '', titleEn: '' })), /title/);
  // One is enough — a Korean filing with no official English name still lands.
  assert.equal(normalizeEvent(fomc({ titleEn: '' })).titleEn, '');
});

/* ------------------------------------------------------------- idempotency */

test('re-reading the same schedule updates one row instead of adding another', async () => {
  const db = await freshDb();
  const first = await upsertEvent(db, fomc(), DAY_ONE);
  assert.equal(first.action, 'created');

  const second = await upsertEvent(db, fomc(), DAY_TWO);
  assert.equal(second.action, 'verified');
  assert.equal(second.eventId, first.eventId);

  assert.equal(db.rows(`SELECT event_id FROM ${EVENTS_TABLE}`).length, 1);
  const row = db.row(`SELECT status, first_seen_at, last_verified_at FROM ${EVENTS_TABLE}`);
  assert.equal(row.status, 'scheduled');
  assert.equal(row.first_seen_at, DAY_ONE.toISOString(), 'the first sighting is not rewritten');
  assert.equal(row.last_verified_at, DAY_TWO.toISOString(), 'but the last confirmation moves');
  db.close();
});

test('a date that moves upstream is recorded as changed', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc(), DAY_ONE);
  const moved = await upsertEvent(db, fomc({ eventDate: '2026-09-17' }), DAY_TWO);
  assert.equal(moved.action, 'changed');

  const row = db.row(`SELECT event_date, status FROM ${EVENTS_TABLE}`);
  assert.equal(row.event_date, '2026-09-17');
  assert.equal(row.status, 'changed');
  assert.equal(db.rows(`SELECT event_id FROM ${EVENTS_TABLE}`).length, 1);
  db.close();
});

test('a time that appears later is a change too', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc({ eventTime: null }), DAY_ONE);
  assert.equal(db.row(`SELECT event_time FROM ${EVENTS_TABLE}`).event_time, null);

  const withTime = await upsertEvent(db, fomc({ eventTime: '14:00' }), DAY_TWO);
  assert.equal(withTime.action, 'changed');
  assert.equal(db.row(`SELECT event_time FROM ${EVENTS_TABLE}`).event_time, '14:00');
  db.close();
});

test('two sources can carry the same date without colliding', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc(), DAY_ONE);
  await upsertEvent(db, fomc({
    sourceType: 'rule', sourceName: 'krx-expiry', sourceEventId: 'krx-monthly:2026-09-16',
    market: 'KR', category: 'derivatives_expiry', titleKo: 'KRX 옵션만기', titleEn: 'KRX option expiry',
    timezone: 'Asia/Seoul', eventTime: null
  }), DAY_ONE);
  assert.equal(db.rows(`SELECT event_id FROM ${EVENTS_TABLE}`).length, 2);
  db.close();
});

/* ------------------------------------------------ withdrawal, not deletion */

test('an event the source stops listing is cancelled, never deleted', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc(), DAY_ONE);
  await upsertEvent(db, fomc({ eventDate: '2026-09-30', sourceEventId: 'fomc:2026-09-30' }), DAY_ONE);

  const result = await cancelMissingEvents(db, {
    sourceName: 'federal-reserve',
    fromDate: '2026-09-01',
    toDate: '2026-09-30',
    seenEventIds: new Set(['official:fomc:2026-09-16'])
  }, DAY_TWO);

  assert.equal(result.cancelled, 1);
  assert.deepEqual(result.eventIds, ['official:fomc:2026-09-30']);
  assert.equal(db.rows(`SELECT event_id FROM ${EVENTS_TABLE}`).length, 2, 'the row stays');
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE event_id = 'official:fomc:2026-09-30'`).status, 'cancelled');
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE event_id = 'official:fomc:2026-09-16'`).status, 'scheduled');
  db.close();
});

test('cancellation is scoped to one source and one window', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc(), DAY_ONE);
  await upsertEvent(db, fomc({
    sourceName: 'bls', sourceEventId: 'cpi:2026-09-10', eventDate: '2026-09-10',
    category: 'inflation', titleKo: '미국 CPI', titleEn: 'US CPI'
  }), DAY_ONE);
  // Another month, same source.
  await upsertEvent(db, fomc({ sourceEventId: 'fomc:2026-10-28', eventDate: '2026-10-28' }), DAY_ONE);

  await cancelMissingEvents(db, {
    sourceName: 'federal-reserve', fromDate: '2026-09-01', toDate: '2026-09-30', seenEventIds: new Set()
  }, DAY_TWO);

  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE event_id = 'official:fomc:2026-09-16'`).status, 'cancelled');
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE event_id = 'official:cpi:2026-09-10'`).status, 'scheduled',
    'another source in the same month is untouched');
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE event_id = 'official:fomc:2026-10-28'`).status, 'scheduled',
    'the same source outside the window is untouched');
  db.close();
});

test('a schedule that comes back after being withdrawn reads as changed', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc(), DAY_ONE);
  await cancelMissingEvents(db, {
    sourceName: 'federal-reserve', fromDate: '2026-09-01', toDate: '2026-09-30', seenEventIds: new Set()
  }, DAY_TWO);
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE}`).status, 'cancelled');

  const back = await upsertEvent(db, fomc(), DAY_TWO);
  assert.equal(back.action, 'changed');
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE}`).status, 'changed');
  db.close();
});

test('a bad window or a missing set is refused, so a failed fetch cannot cancel anything', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc(), DAY_ONE);
  await assert.rejects(() => cancelMissingEvents(db, { sourceName: 'federal-reserve', fromDate: 'x', toDate: '2026-09-30', seenEventIds: new Set() }), /YYYY-MM-DD/);
  await assert.rejects(() => cancelMissingEvents(db, { sourceName: 'federal-reserve', fromDate: '2026-09-01', toDate: '2026-09-30', seenEventIds: null }), /Set/);
  await assert.rejects(() => cancelMissingEvents(db, { sourceName: '', fromDate: '2026-09-01', toDate: '2026-09-30', seenEventIds: new Set() }), /sourceName/);
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE}`).status, 'scheduled');
  db.close();
});

/* ------------------------------------------------------- reading it back */

test('a month comes back sorted, with untimed events before timed ones', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc({ eventDate: '2026-09-16', eventTime: '14:00' }), DAY_ONE);
  await upsertEvent(db, fomc({
    sourceEventId: 'expiry:2026-09-10', eventDate: '2026-09-10', eventTime: null,
    sourceType: 'rule', sourceName: 'krx-expiry', market: 'KR', category: 'derivatives_expiry',
    timezone: 'Asia/Seoul', titleKo: 'KRX 옵션만기', titleEn: 'KRX option expiry'
  }), DAY_ONE);
  await upsertEvent(db, fomc({
    sourceEventId: 'cpi:2026-09-16', eventDate: '2026-09-16', eventTime: '08:30',
    sourceName: 'bls', category: 'inflation', titleKo: '미국 CPI', titleEn: 'US CPI'
  }), DAY_ONE);
  // A different month must not appear.
  await upsertEvent(db, fomc({ sourceEventId: 'fomc:2026-10-28', eventDate: '2026-10-28' }), DAY_ONE);

  const events = await getEventsForMonth(db, 2026, 9);
  assert.deepEqual(events.map(e => `${e.date} ${e.time || '--:--'}`), [
    '2026-09-10 --:--',
    '2026-09-16 08:30',
    '2026-09-16 14:00'
  ]);
  db.close();
});

test('the public shape carries no internal bookkeeping', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc(), DAY_ONE);
  const [event] = await getEventsForMonth(db, 2026, 9);

  assert.deepEqual(Object.keys(event).sort(), [
    'category', 'company', 'date', 'id', 'importance', 'market', 'source', 'status', 'time', 'timezone', 'title'
  ]);
  assert.deepEqual(event.title, { ko: 'FOMC 정책금리 결정', en: 'FOMC rate decision' });
  assert.equal(event.company, null, 'an economic event has no company');
  assert.equal('first_seen_at' in event, false);
  assert.equal('last_verified_at' in event, false);
  assert.equal('source_type' in event, false);
  db.close();
});

test('a company event carries the company it belongs to', async () => {
  const db = await freshDb();
  await upsertEvent(db, fomc({
    sourceType: 'opendart', sourceName: 'opendart', sourceEventId: 'ir:20260901000123',
    market: 'KR', category: 'corporate_event', timezone: 'Asia/Seoul', eventTime: null,
    titleKo: '기업설명회(IR) 개최', titleEn: 'Investor relations briefing',
    companyStockCode: '005930', companyName: '삼성전자'
  }), DAY_ONE);
  const [event] = await getEventsForMonth(db, 2026, 9);
  // The English name is filled in from the watchlist by the public month query;
  // the stored row alone carries the name the filing was made under.
  assert.deepEqual(event.company, { stockCode: '005930', name: '삼성전자', nameEn: '' });
  db.close();
});

test('an empty month is an empty list, not an error', async () => {
  const db = await freshDb();
  assert.deepEqual(await getEventsForMonth(db, 2026, 11), []);
  db.close();
});

/* ------------------------------------------------------- source freshness */

test('each source records when it last answered and why it did not', async () => {
  const db = await freshDb();
  await recordSourceRun(db, { sourceName: 'bls', sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm', ok: true, eventCount: 12 }, DAY_ONE);
  await recordSourceRun(db, { sourceName: 'bls', ok: false, error: 'HTTP 403' }, DAY_TWO);

  const [bls] = await getSourceRuns(db);
  assert.equal(bls.sourceName, 'bls');
  // A later failure does not erase the last time it worked.
  assert.equal(bls.lastSuccessAt, DAY_ONE.toISOString());
  assert.equal(bls.lastAttemptAt, DAY_TWO.toISOString());
  assert.equal(bls.lastError, 'HTTP 403');
  assert.equal(bls.eventCount, 12, 'the count from the last good run is kept');
  assert.match(bls.sourceUrl, /bls\.gov/);
  db.close();
});
