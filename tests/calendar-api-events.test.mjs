import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { onRequestGet as calendarGet } from '../functions/api/calendar.js';
import { ensureCalendarEventSchema, upsertEvent } from '../functions/_calendar-events.js';

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

const NOW = new Date('2026-09-02T00:00:00.000Z');

async function seededDb() {
  const db = new SqliteD1();
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  await upsertEvent(db, {
    eventDate: '2026-09-16', eventTime: '14:00', timezone: 'America/New_York',
    market: 'US', category: 'monetary_policy', importance: 'high',
    titleKo: 'FOMC 금리결정', titleEn: 'FOMC Rate Decision',
    sourceType: 'official', sourceName: 'federal-reserve',
    sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
    sourceEventId: 'fomc:2026-09-16', meta: { meetingStartDate: '2026-09-15' }
  }, NOW);
  await upsertEvent(db, {
    eventDate: '2026-09-10', eventTime: null, timezone: 'Asia/Seoul',
    market: 'KR', category: 'derivatives_expiry', importance: 'normal',
    titleKo: 'KOSPI200 월물 옵션 만기', titleEn: 'KOSPI 200 Monthly Options Expiration',
    sourceType: 'rule', sourceName: 'krx-expiry-rule', sourceUrl: 'https://global.krx.co.kr/',
    sourceEventId: 'krx-monthly:2026-09'
  }, NOW);
  return db;
}

const call = (query, env) => calendarGet({
  request: new Request(`https://snowshagal.com/api/calendar${query}`),
  env,
  now: NOW
});

/* ---------------------------------------------- the existing contract holds */

test('the trading calendar answers exactly as it did before', async () => {
  const db = await seededDb();
  const payload = await (await call('?year=2026&month=9', { COMMENTS_DB: db })).json();

  assert.equal(payload.ok, true);
  assert.equal(payload.supported, true);
  assert.equal(payload.year, 2026);
  assert.equal(payload.month, 9);
  assert.equal(payload.serverDate, '2026-09-02');
  assert.deepEqual(payload.marketSupport, { krx: true, nyse: true });
  assert.equal(payload.days.length, 30);
  assert.ok(Array.isArray(payload.upcoming));

  // The day shape the page already renders is untouched.
  const first = payload.days[0];
  assert.deepEqual(Object.keys(first).sort(), ['date', 'day', 'dayOfWeek', 'isJointClosure', 'isWeekend', 'krx', 'nyse']);
  db.close();
});

test('an unsupported year still answers, and still carries its events', async () => {
  const db = await seededDb();
  const payload = await (await call('?year=2030&month=9', { COMMENTS_DB: db })).json();
  assert.equal(payload.supported, false);
  assert.deepEqual(payload.days, []);
  assert.ok(Array.isArray(payload.events), 'events do not depend on a holiday table');
  assert.equal(payload.eventsStatus, 'ok');
  db.close();
});

test('a bad query is still rejected the same way', async () => {
  const response = await call('?year=2026&month=13', {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_QUERY');
});

/* ------------------------------------------------------- the new events */

test('events arrive with both the source values and the Seoul ones', async () => {
  const db = await seededDb();
  const payload = await (await call('?year=2026&month=9', { COMMENTS_DB: db })).json();

  assert.equal(payload.eventsTimezone, 'Asia/Seoul');
  const fomc = payload.events.find(event => event.id === 'official:fomc:2026-09-16');
  assert.deepEqual(fomc.source, { date: '2026-09-16', time: '14:00', timezone: 'America/New_York' });
  assert.deepEqual(fomc.display, { date: '2026-09-17', time: '03:00', timezone: 'Asia/Seoul', shifted: true });
  assert.deepEqual(fomc.title, { ko: 'FOMC 금리결정', en: 'FOMC Rate Decision' });
  assert.equal(fomc.market, 'US');
  assert.equal(fomc.company, null);
  db.close();
});

test('an event whose Seoul day falls in the month is returned for that month', async () => {
  const db = await seededDb();
  await upsertEvent(db, {
    eventDate: '2026-08-31', eventTime: '14:00', timezone: 'America/New_York',
    market: 'US', category: 'monetary_policy', importance: 'high',
    titleKo: '월말 이벤트', titleEn: 'Month-end event',
    sourceType: 'official', sourceName: 'federal-reserve', sourceEventId: 'edge:2026-08-31'
  }, NOW);

  const august = await (await call('?year=2026&month=8', { COMMENTS_DB: db })).json();
  const september = await (await call('?year=2026&month=9', { COMMENTS_DB: db })).json();

  assert.equal(august.events.some(event => event.id === 'official:edge:2026-08-31'), false);
  const moved = september.events.find(event => event.id === 'official:edge:2026-08-31');
  assert.equal(moved.display.date, '2026-09-01');
  db.close();
});

test('events are ordered by the day a reader sees them on', async () => {
  const db = await seededDb();
  const payload = await (await call('?year=2026&month=9', { COMMENTS_DB: db })).json();
  const shown = payload.events.map(event => `${event.display.date} ${event.display.time || 'all-day'}`);
  assert.deepEqual(shown, ['2026-09-10 all-day', '2026-09-17 03:00']);
  db.close();
});

/* ----------------------------------------------- what a reader never sees */

test('no operational detail travels to the public API', async () => {
  const db = await seededDb();
  const body = await (await call('?year=2026&month=9', { COMMENTS_DB: db })).text();
  for (const leak of ['last_note', 'last_error', 'lastError', 'unconfirmed', 'first_seen_at', 'meta_json', 'meetingStartDate']) {
    assert.equal(body.includes(leak), false, `${leak} must not reach a reader`);
  }
  db.close();
});

test('a quiet month and an unreachable one are told apart', async () => {
  const db = await seededDb();
  // Nothing is scheduled in May, and the page knows that for a fact.
  const quiet = await (await call('?year=2026&month=5', { COMMENTS_DB: db })).json();
  assert.deepEqual(quiet.events, []);
  assert.equal(quiet.eventsStatus, 'ok');

  // Without a database the page cannot know either way, and says so.
  const missing = await (await call('?year=2026&month=5', {})).json();
  assert.deepEqual(missing.events, []);
  assert.equal(missing.eventsStatus, 'unavailable');
  db.close();
});

test('the calendar still renders when the database is not there', async () => {
  // The exchange schedule is checked in; a D1 outage costs the events only.
  const payload = await (await call('?year=2026&month=9', {})).json();
  assert.equal(payload.ok, true);
  assert.equal(payload.days.length, 30);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.eventsStatus, 'unavailable');
  assert.equal(payload.eventsTimezone, 'Asia/Seoul');
});

test('a database that throws costs the events and nothing else', async () => {
  const broken = {
    prepare() { throw new Error('D1 unavailable'); },
    async batch() { throw new Error('D1 unavailable'); }
  };
  const response = await call('?year=2026&month=9', { COMMENTS_DB: broken });
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.days.length, 30);
  assert.deepEqual(payload.events, []);
  assert.equal(payload.eventsStatus, 'unavailable');
  // The reason stays on the server: no exception text reaches the reader.
  assert.equal(JSON.stringify(payload).includes('D1 unavailable'), false);
});

test('a month that answers carries the ok status', async () => {
  const db = await seededDb();
  const payload = await (await call('?year=2026&month=9', { COMMENTS_DB: db })).json();
  assert.equal(payload.eventsStatus, 'ok');
  assert.ok(payload.events.length > 0);
  db.close();
});

test('the response stays cacheable', async () => {
  const db = await seededDb();
  const response = await call('?year=2026&month=9', { COMMENTS_DB: db });
  assert.match(response.headers.get('cache-control'), /public/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  db.close();
});
