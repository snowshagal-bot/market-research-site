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
import { MAX_COMPANY_NAMES_PER_RUN, syncCompanyNames } from '../functions/api/disclosures/_company-names.js';
import { loadCalendarMonth } from '../functions/_calendar-data.js';
import { renderCalendarGrid } from '../functions/_initial-html.js';

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

const nameEnv = { OPENDART_API_KEY: 'test-key' };
const companyResponse = (code, stock, name = 'Taihan Cable & Solution') => ({
  // The documented company overview response does not require corp_code.
  ok: true, json: async () => ({ status: '000', stock_code: stock, corp_name_eng: name })
});

async function unnamedCompany(db, overrides = {}) {
  // Isolate from the default watchlist seeded for a new deployment.
  await db.prepare('UPDATE disclosure_watchlist SET calendar_enabled = 0').run();
  await addWatchlistCompany(db, {
    stockCode: '001440', corpCode: '00123456', corpName: '대한전선', calendarEnabled: true, ...overrides
  }, NOW);
}

test('official English names reach existing calendar events without recollecting filings', async () => {
  const db = await seeded();
  await unnamedCompany(db);
  await upsertEvent(db, briefing(), NOW);
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url.origin + url.pathname, 'https://opendart.fss.or.kr/api/company.json');
    assert.equal(url.searchParams.get('crtfc_key'), 'test-key');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['user-agent'], 'snowshagal-disclosure-monitor/1.0');
    return companyResponse(url.searchParams.get('corp_code'), '001440');
  };
  const result = await syncCompanyNames(db, { env: nameEnv, fetchImpl, now: NOW });
  assert.equal(result.updated, 1);
  const [event] = await getEventsForDisplayMonth(db, 2026, 10);
  assert.equal(event.company.nameEn, 'Taihan Cable & Solution');
  assert.equal(event.company.name, '대한전선');
  const data = await loadCalendarMonth({ COMMENTS_DB: db }, { year: 2026, month: 10, now: NOW });
  const english = renderCalendarGrid(data, { lang: 'en', filter: 'ALL' });
  assert.match(english, /Taihan Cable &amp; Solution/);
  assert.doesNotMatch(english, /대한전선/);
  assert.match(renderCalendarGrid(data, { lang: 'ko', filter: 'ALL' }), /대한전선/);
  await syncCompanyNames(db, { env: nameEnv, fetchImpl, now: new Date('2026-09-03T00:00:00Z') });
  assert.equal(calls, 1, 'a saved name is reused');
  assert.equal(db.row("SELECT request_count FROM disclosure_usage_daily WHERE usage_date = '2026-09-02' AND kind = 'source:opendart'").request_count, 1);
  db.close();
});

test('manual names, suspended companies and disclosure-only companies spend no requests', async () => {
  const db = await seeded();
  await unnamedCompany(db, { corpNameEn: 'Owner-approved Name' });
  await addWatchlistCompany(db, { stockCode: '001441', corpCode: '00123457', corpName: '공시만', calendarEnabled: false }, NOW);
  await addWatchlistCompany(db, { stockCode: '001442', corpCode: '00123458', corpName: '중단', calendarEnabled: true }, NOW);
  await toggleWatchlistActive(db, '001442', false, NOW);
  const result = await syncCompanyNames(db, { env: nameEnv, fetchImpl: () => assert.fail('must not fetch'), now: NOW });
  assert.equal(result.attempted, 0);
  db.close();
});

test('missing key and exhausted shared budget leave names unchanged', async () => {
  const db = await seeded();
  await unnamedCompany(db);
  assert.equal((await syncCompanyNames(db, { now: NOW })).status, 'pending');
  await db.prepare("INSERT INTO disclosure_usage_daily (usage_date, kind, request_count, updated_at) VALUES ('2026-09-02', 'source:opendart', 1000, '')").run();
  const result = await syncCompanyNames(db, { env: nameEnv, now: NOW, fetchImpl: () => assert.fail('budget exhausted') });
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.attempted, 0);
  db.close();
});

test('failed lookups are redacted, rate limited per Seoul day, and never block stored events', async () => {
  const db = await seeded();
  await unnamedCompany(db);
  await upsertEvent(db, briefing(), NOW);
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('secret-test-key in URL'); };
  const first = await syncCompanyNames(db, { env: nameEnv, fetchImpl, now: NOW });
  assert.equal(first.status, 'error');
  assert.doesNotMatch(JSON.stringify(first), /secret-test-key/);
  await syncCompanyNames(db, { env: nameEnv, fetchImpl, now: NOW });
  assert.equal(calls, 1);
  await syncCompanyNames(db, { env: nameEnv, fetchImpl, now: new Date('2026-09-02T15:01:00Z') });
  assert.equal(calls, 2, 'the next Seoul day is eligible again');
  assert.equal((await getEventsForDisplayMonth(db, 2026, 10)).length, 1);
  assert.equal(db.row("SELECT corp_name_en FROM disclosure_watchlist WHERE stock_code = '001440'").corp_name_en, '');
  db.close();
});

test('a mismatched or unsuccessful response never becomes a company name', async () => {
  for (const response of [{ ok: true, json: async () => ({ status: '000', corp_code: '99999999', stock_code: '001440', corp_name_eng: 'Wrong company' }) }, companyResponse('00123456', '999999'),
    { ok: false, status: 503 }, { ok: true, json: async () => ({ status: '020' }) }]) {
    const db = await seeded();
    await unnamedCompany(db);
    assert.equal((await syncCompanyNames(db, { env: nameEnv, fetchImpl: async () => response, now: NOW })).updated, 0);
    assert.equal(db.row("SELECT corp_name_en FROM disclosure_watchlist WHERE stock_code = '001440'").corp_name_en, '');
    db.close();
  }
});

test('a name entered during lookup wins over the automatic response', async () => {
  const db = await seeded();
  await unnamedCompany(db);
  const result = await syncCompanyNames(db, { env: nameEnv, now: NOW, fetchImpl: async () => {
    await db.prepare("UPDATE disclosure_watchlist SET corp_name_en = 'Manual Name' WHERE stock_code = '001440'").run();
    return companyResponse('00123456', '001440');
  } });
  assert.equal(result.updated, 0);
  assert.equal(db.row("SELECT corp_name_en FROM disclosure_watchlist WHERE stock_code = '001440'").corp_name_en, 'Manual Name');
  db.close();
});

test('name lookup diagnostics include safe status codes but never upstream text', async () => {
  const db = await seeded();
  await unnamedCompany(db);
  const result = await syncCompanyNames(db, { env: nameEnv, now: NOW, fetchImpl: async () => ({ ok: false, status: 503, statusText: 'secret-key' }) });
  assert.equal(result.httpStatus, 503);
  assert.match(result.error, /HTTP 503/);
  assert.doesNotMatch(JSON.stringify(result), /secret-key/);
  db.close();
});

test('redirects are rejected without following them or forwarding the API key', async () => {
  const db = await seeded();
  await unnamedCompany(db);
  let calls = 0;
  const result = await syncCompanyNames(db, { env: nameEnv, now: NOW, fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return { ok: false, status: 302 };
  } });
  assert.equal(calls, 1);
  assert.equal(result.updated, 0);
  assert.match(result.error, /HTTP 302/);
  db.close();
});

test('a company added without a DART code can use the code in its stored filings', async () => {
  const db = await seeded();
  await unnamedCompany(db, { corpCode: '' });
  await db.prepare(`INSERT INTO disclosure_filings
    (rcept_no, corp_cls, corp_name, corp_code, stock_code, report_nm, rcept_dt, source_url, first_seen_at, updated_at)
    VALUES ('20260902000001', 'Y', '대한전선', '00123456', '001440', '기업설명회', '20260902', '', '', '')`).run();
  const result = await syncCompanyNames(db, { env: nameEnv, now: NOW, fetchImpl: async url => {
    assert.equal(url.searchParams.get('corp_code'), '00123456');
    return companyResponse('00123456', '001440');
  } });
  assert.equal(result.updated, 1);
  db.close();
});

test('a pass is bounded and failed/empty names do not starve the rest of the queue', async () => {
  const db = await seeded();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url.searchParams.get('corp_code'));
    const stock = db.row('SELECT stock_code FROM disclosure_watchlist WHERE corp_code = ?', url.searchParams.get('corp_code')).stock_code;
    return companyResponse(url.searchParams.get('corp_code'), stock, '');
  };
  const first = await syncCompanyNames(db, { env: nameEnv, fetchImpl, now: NOW });
  assert.equal(first.attempted, MAX_COMPANY_NAMES_PER_RUN);
  assert.equal(first.unavailable, MAX_COMPANY_NAMES_PER_RUN);
  await syncCompanyNames(db, { env: nameEnv, fetchImpl, now: new Date('2026-09-03T00:00:00Z') });
  assert.equal(new Set(requests).size, 2 * MAX_COMPANY_NAMES_PER_RUN, 'unattempted companies go first');
  db.close();
});
