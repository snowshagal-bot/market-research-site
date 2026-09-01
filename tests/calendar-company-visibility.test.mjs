import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  addWatchlistCompany,
  ensureDisclosureSchema,
  setWatchlistFlags,
  toggleWatchlistActive
} from '../functions/api/disclosures/_shared.js';
import {
  EVENTS_TABLE,
  ensureCalendarEventSchema,
  getEventsForDisplayMonth,
  upsertEvent
} from '../functions/_calendar-events.js';
import { onRequestGet as calendarGet } from '../functions/api/calendar.js';

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
    try { for (const statement of statements) await statement.run(); this.database.exec('COMMIT'); }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  row(sql, ...values) { return this.database.prepare(sql).get(...values) || null; }
  rows(sql, ...values) { return this.database.prepare(sql).all(...values); }
  close() { this.database.close(); }
}

const NOW = new Date('2026-09-02T00:00:00.000Z');

async function seeded() {
  const db = new SqliteD1();
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  await ensureDisclosureSchema({ COMMENTS_DB: db });
  return db;
}

const briefing = (overrides = {}) => ({
  eventDate: '2026-10-15', eventTime: '13:00', timezone: 'Asia/Seoul',
  market: 'KR', category: 'corporate_event', importance: 'normal',
  titleKo: '기업설명회(IR)', titleEn: 'Investor Relations Briefing',
  sourceType: 'opendart', sourceName: 'opendart',
  sourceUrl: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260330800567',
  sourceEventId: 'dart:20260330800567',
  companyStockCode: '001440', companyName: '대한전선',
  ...overrides
});

const idsIn = async (db, year, month) =>
  (await getEventsForDisplayMonth(db, year, month)).map(event => event.id);

/* ----------------------------------------- following a company, and stopping */

test('a company event appears only while the company is followed for the calendar', async () => {
  const db = await seeded();
  await addWatchlistCompany(db, {
    stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true
  }, NOW);
  await upsertEvent(db, briefing(), NOW);

  assert.deepEqual(await idsIn(db, 2026, 10), ['opendart:dart:20260330800567'], 'tracking on: the date is shown');

  await setWatchlistFlags(db, '001440', { calendarEnabled: false, disclosureEnabled: true }, NOW);
  assert.deepEqual(await idsIn(db, 2026, 10), [], 'tracking off: the date is hidden at once');

  // The event itself is still there, so turning tracking back on costs nothing.
  assert.ok(db.row(`SELECT event_id FROM ${EVENTS_TABLE} WHERE event_id = 'opendart:dart:20260330800567'`));

  await setWatchlistFlags(db, '001440', { calendarEnabled: true }, NOW);
  assert.deepEqual(await idsIn(db, 2026, 10), ['opendart:dart:20260330800567'], 'tracking on again: the same date returns');
  db.close();
});

test('deactivating a company hides its dates too', async () => {
  const db = await seeded();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  await upsertEvent(db, briefing(), NOW);
  assert.equal((await idsIn(db, 2026, 10)).length, 1);

  await toggleWatchlistActive(db, '001440', false, NOW);
  assert.deepEqual(await idsIn(db, 2026, 10), [], 'a suspended company shows nothing');

  await toggleWatchlistActive(db, '001440', true, NOW);
  assert.equal((await idsIn(db, 2026, 10)).length, 1);
  db.close();
});

test('a company that was never followed shows nothing', async () => {
  const db = await seeded();
  // The event exists from an earlier run; the company is not on the list now.
  await upsertEvent(db, briefing({ companyStockCode: '999999', companyName: '사라진기업', sourceEventId: 'dart:20260330800999' }), NOW);
  assert.deepEqual(await idsIn(db, 2026, 10), []);
  db.close();
});

test('economic and rule events are untouched by any of this', async () => {
  const db = await seeded();
  await upsertEvent(db, {
    eventDate: '2026-10-16', eventTime: '14:00', timezone: 'America/New_York',
    market: 'US', category: 'monetary_policy', importance: 'high',
    titleKo: 'FOMC 금리결정', titleEn: 'FOMC Rate Decision',
    sourceType: 'official', sourceName: 'federal-reserve', sourceEventId: 'fomc:2026-10-16'
  }, NOW);
  await upsertEvent(db, {
    eventDate: '2026-10-08', eventTime: null, timezone: 'Asia/Seoul',
    market: 'KR', category: 'derivatives_expiry', importance: 'normal',
    titleKo: 'KOSPI200 월물 옵션 만기', titleEn: 'KOSPI 200 Monthly Options Expiration',
    sourceType: 'rule', sourceName: 'krx-expiry-rule', sourceEventId: 'krx-monthly:2026-10'
  }, NOW);

  // No watchlist entries at all, and both still show: they belong to nobody.
  assert.equal((await idsIn(db, 2026, 10)).length, 2);
  db.close();
});

/* ------------------------------------------------------- the company's names */

test('an official English name is carried for the English calendar', async () => {
  const db = await seeded();
  await addWatchlistCompany(db, {
    stockCode: '001440', corpName: '대한전선', corpNameEn: 'Taihan Cable & Solution',
    disclosureEnabled: false, calendarEnabled: true
  }, NOW);
  await upsertEvent(db, briefing(), NOW);

  const [event] = await getEventsForDisplayMonth(db, 2026, 10);
  assert.deepEqual(event.company, {
    stockCode: '001440', name: '대한전선', nameEn: 'Taihan Cable & Solution'
  });
  db.close();
});

test('a company with no English name keeps its Korean one, untranslated', async () => {
  const db = await seeded();
  await addWatchlistCompany(db, {
    stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true
  }, NOW);
  await upsertEvent(db, briefing(), NOW);

  const [event] = await getEventsForDisplayMonth(db, 2026, 10);
  assert.equal(event.company.name, '대한전선');
  assert.equal(event.company.nameEn, '', 'an absent name is absent, not invented');
  db.close();
});

test('a renamed company shows its current name, not the one filed with', async () => {
  const db = await seeded();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  await upsertEvent(db, briefing({ companyName: '옛이름' }), NOW);

  const [event] = await getEventsForDisplayMonth(db, 2026, 10);
  assert.equal(event.company.name, '대한전선', 'the list is the authority on what a company is called');
  db.close();
});

/* ------------------------------------------------------ through the real API */

test('the public API applies the same rule', async () => {
  const db = await seeded();
  await addWatchlistCompany(db, {
    stockCode: '001440', corpName: '대한전선', corpNameEn: 'Taihan Cable & Solution',
    disclosureEnabled: false, calendarEnabled: true
  }, NOW);
  await upsertEvent(db, briefing(), NOW);

  const call = () => calendarGet({
    request: new Request('https://snowshagal.com/api/calendar?year=2026&month=10'),
    env: { COMMENTS_DB: db },
    now: NOW
  });

  const shown = await (await call()).json();
  assert.equal(shown.events.length, 1);
  assert.equal(shown.events[0].company.nameEn, 'Taihan Cable & Solution');

  await setWatchlistFlags(db, '001440', { calendarEnabled: false, disclosureEnabled: true }, NOW);
  const hidden = await (await call()).json();
  assert.deepEqual(hidden.events, []);
  assert.equal(hidden.eventsStatus, 'ok', 'hidden is not the same as unavailable');
  db.close();
});

/* --------------------------------------------------------------- in the UI */

test('the English page prefers the official name and never translates', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(new URL('../assets/calendar.js', import.meta.url), 'utf8');
  assert.match(script, /if \(!ko && event\.company\.nameEn\) return event\.company\.nameEn;/);
  assert.match(script, /return event\.company\.name \|\| event\.company\.stockCode \|\| '';/);
});
