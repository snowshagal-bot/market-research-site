import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  ensureCalendarEventSchema,
  getEventsForDisplayMonth,
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
      for (const statement of statements) await statement.run();
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { this.database.close(); }
}

const AT = new Date('2026-09-01T00:00:00.000Z');

async function freshDb() {
  const db = new SqliteD1();
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  return db;
}

/** A US economic event unless told otherwise. */
const usEvent = (overrides = {}) => ({
  eventDate: '2026-09-16',
  eventTime: '14:00',
  timezone: 'America/New_York',
  market: 'US',
  category: 'monetary_policy',
  importance: 'high',
  titleKo: 'FOMC 금리결정',
  titleEn: 'FOMC Rate Decision',
  sourceType: 'official',
  sourceName: 'federal-reserve',
  sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  sourceEventId: 'fomc:2026-09-16',
  ...overrides
});

const idsIn = async (db, year, month) =>
  (await getEventsForDisplayMonth(db, year, month)).map(event => event.id);

/* ------------------------------- which month a reader finds an event in */

test('a decision on the last day of a month is found in the next one', async () => {
  const db = await freshDb();
  // 14:00 in New York on 31 January is 04:00 on 1 February in Seoul.
  await upsertEvent(db, usEvent({ eventDate: '2026-01-31', sourceEventId: 'fomc:2026-01-31' }), AT);

  assert.deepEqual(await idsIn(db, 2026, 1), [], 'not in the month its source published it');
  const february = await getEventsForDisplayMonth(db, 2026, 2);
  assert.deepEqual(february.map(event => event.id), ['official:fomc:2026-01-31']);
  assert.equal(february[0].display.date, '2026-02-01');
  assert.equal(february[0].display.time, '04:00');
  assert.equal(february[0].source.date, '2026-01-31', 'the stored date is unchanged');
  db.close();
});

test('a decision on the last day of a year is found in the next year', async () => {
  const db = await freshDb();
  await upsertEvent(db, usEvent({ eventDate: '2026-12-31', sourceEventId: 'fomc:2026-12-31' }), AT);

  assert.deepEqual(await idsIn(db, 2026, 12), []);
  const january = await getEventsForDisplayMonth(db, 2027, 1);
  assert.deepEqual(january.map(event => event.id), ['official:fomc:2026-12-31']);
  assert.equal(january[0].display.date, '2027-01-01');
  db.close();
});

test('the boundary is read through the zone, so both sides of a DST switch work', async () => {
  const db = await freshDb();
  // US daylight saving ends on 1 November 2026, so 11:00 in New York is
  // 00:00 the next day in Seoul before the switch and 01:00 after it. Either
  // way the event belongs to November.
  await upsertEvent(db, usEvent({ eventDate: '2026-10-31', eventTime: '11:00', sourceEventId: 'edt:2026-10-31' }), AT);
  await upsertEvent(db, usEvent({ eventDate: '2026-11-02', eventTime: '11:00', sourceEventId: 'est:2026-11-02' }), AT);

  assert.deepEqual(await idsIn(db, 2026, 10), [], 'the 31st has already moved into November');
  const november = await getEventsForDisplayMonth(db, 2026, 11);
  assert.equal(november.find(event => event.id === 'official:edt:2026-10-31').display.date, '2026-11-01');
  assert.equal(november.find(event => event.id === 'official:edt:2026-10-31').display.time, '00:00');
  assert.equal(november.find(event => event.id === 'official:est:2026-11-02').display.date, '2026-11-03');
  assert.equal(november.find(event => event.id === 'official:est:2026-11-02').display.time, '01:00');
  db.close();
});

test('an early release on the first of a month stays where it is', async () => {
  const db = await freshDb();
  // 08:30 in New York is the same evening in Seoul, so nothing moves.
  await upsertEvent(db, usEvent({ eventDate: '2026-09-01', eventTime: '08:30', sourceEventId: 'cpi:2026-09-01' }), AT);
  assert.deepEqual(await idsIn(db, 2026, 9), ['official:cpi:2026-09-01']);
  assert.deepEqual(await idsIn(db, 2026, 8), []);
  db.close();
});

test('an event with no time stays in its own month', async () => {
  const db = await freshDb();
  await upsertEvent(db, usEvent({
    eventDate: '2026-01-31', eventTime: null, sourceEventId: 'expiry:2026-01',
    sourceType: 'rule', sourceName: 'us-expiry-rule', category: 'derivatives_expiry',
    titleKo: '미국 표준 월물 옵션 만기', titleEn: 'US Standard Monthly Options Expiration'
  }), AT);

  assert.deepEqual(await idsIn(db, 2026, 1), ['rule:expiry:2026-01']);
  assert.deepEqual(await idsIn(db, 2026, 2), [], 'no time means no conversion, and no month to slide into');
  db.close();
});

test('a Korean event never moves, because it is already in the reader zone', async () => {
  const db = await freshDb();
  await upsertEvent(db, usEvent({
    eventDate: '2026-01-31', eventTime: '23:00', timezone: 'Asia/Seoul', market: 'KR',
    sourceEventId: 'ir:2026-01-31', sourceType: 'opendart', sourceName: 'opendart',
    category: 'corporate_event', titleKo: '기업설명회(IR)', titleEn: 'Investor Relations Briefing'
  }), AT);
  assert.deepEqual(await idsIn(db, 2026, 1), ['opendart:ir:2026-01-31']);
  assert.deepEqual(await idsIn(db, 2026, 2), []);
  db.close();
});

test('nothing is lost or duplicated across a month boundary', async () => {
  const db = await freshDb();
  for (const day of ['2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']) {
    await upsertEvent(db, usEvent({ eventDate: day, sourceEventId: `fomc:${day}` }), AT);
  }
  const january = await idsIn(db, 2026, 1);
  const february = await idsIn(db, 2026, 2);

  // Every event lands in exactly one month, and all five are accounted for.
  assert.equal(january.length + february.length, 5);
  assert.equal(new Set([...january, ...february]).size, 5);
  assert.deepEqual(january, ['official:fomc:2026-01-29', 'official:fomc:2026-01-30']);
  assert.deepEqual(february, ['official:fomc:2026-01-31', 'official:fomc:2026-02-01', 'official:fomc:2026-02-02']);
  db.close();
});

/* ----------------------------------------------------------- reading order */

test('a day reads all-day first, then by the hour shown', async () => {
  const db = await freshDb();
  await upsertEvent(db, usEvent({ sourceEventId: 'late', eventDate: '2026-09-16', eventTime: '14:00' }), AT);
  await upsertEvent(db, usEvent({ sourceEventId: 'cpi', eventDate: '2026-09-17', eventTime: '08:30' }), AT);
  await upsertEvent(db, usEvent({
    sourceEventId: 'expiry', eventDate: '2026-09-17', eventTime: null,
    sourceType: 'rule', sourceName: 'us-expiry-rule', category: 'derivatives_expiry'
  }), AT);

  const september = await getEventsForDisplayMonth(db, 2026, 9);
  assert.deepEqual(september.map(event => `${event.display.date} ${event.display.time || 'all-day'}`), [
    '2026-09-17 all-day',
    '2026-09-17 03:00',
    '2026-09-17 21:30'
  ]);
  db.close();
});

test('ordering follows the displayed day, not the stored one', async () => {
  const db = await freshDb();
  // Stored: the 16th at 14:00 and the 17th at 08:30. Displayed: both on the
  // 17th, the American afternoon first.
  await upsertEvent(db, usEvent({ sourceEventId: 'fomc', eventDate: '2026-09-16', eventTime: '14:00' }), AT);
  await upsertEvent(db, usEvent({ sourceEventId: 'cpi', eventDate: '2026-09-17', eventTime: '08:30' }), AT);

  const order = (await getEventsForDisplayMonth(db, 2026, 9)).map(event => event.id);
  assert.deepEqual(order, ['official:fomc', 'official:cpi']);
  db.close();
});

test('the order does not wobble between identical calls', async () => {
  const db = await freshDb();
  await upsertEvent(db, usEvent({ sourceEventId: 'a', eventDate: '2026-09-17', eventTime: '08:30', importance: 'normal', category: 'employment' }), AT);
  await upsertEvent(db, usEvent({ sourceEventId: 'b', eventDate: '2026-09-17', eventTime: '08:30', importance: 'high', category: 'inflation' }), AT);
  await upsertEvent(db, usEvent({ sourceEventId: 'c', eventDate: '2026-09-17', eventTime: '08:30', importance: 'normal', category: 'inflation' }), AT);

  const first = await idsIn(db, 2026, 9);
  assert.deepEqual(await idsIn(db, 2026, 9), first);
  // Importance leads the tie-break, then category, then the identity.
  assert.deepEqual(first, ['official:b', 'official:a', 'official:c']);
  db.close();
});

/* -------------------------------------- nothing operational reaches a reader */

test('the month payload carries no operational detail', async () => {
  const db = await freshDb();
  await upsertEvent(db, usEvent(), AT);
  await recordSourceRun(db, {
    sourceName: 'federal-reserve', ok: true,
    note: 'decision time unconfirmed for 15 of 16 meetings'
  }, AT);

  const [event] = await getEventsForDisplayMonth(db, 2026, 9);
  const serialized = JSON.stringify(event);
  for (const leak of ['last_note', 'lastError', 'unconfirmed', 'first_seen_at', 'last_verified_at', 'source_type', 'meta_json']) {
    assert.equal(serialized.includes(leak), false, `${leak} must not reach a reader`);
  }
  assert.deepEqual(Object.keys(event.source).sort(), ['date', 'time', 'timezone']);
  assert.deepEqual(Object.keys(event.display).sort(), ['date', 'shifted', 'time', 'timezone']);
  db.close();
});

test('a month with nothing in it is an empty list', async () => {
  const db = await freshDb();
  assert.deepEqual(await idsIn(db, 2026, 5), []);
  await assert.rejects(() => getEventsForDisplayMonth(db, 2026, 13), /month 1-12/);
  db.close();
});
