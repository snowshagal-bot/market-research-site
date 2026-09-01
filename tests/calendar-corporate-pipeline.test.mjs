import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  FILINGS_TABLE,
  addWatchlistCompany,
  ensureDisclosureSchema,
  normalizeFiling,
  upsertFiling
} from '../functions/api/disclosures/_shared.js';
import {
  MAX_DOCUMENTS_PER_RUN,
  syncCorporateEvents
} from '../functions/api/disclosures/_calendar-corporate.js';
import {
  fetchFilingDocument,
  filingUrl,
  parseViewerArgs,
  viewerUrl
} from '../functions/api/disclosures/_calendar-document.js';
import { EVENTS_TABLE, ensureCalendarEventSchema, getEventsForDisplayMonth } from '../functions/_calendar-events.js';

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

/*
 * The fixtures are a real filing:
 *
 *   대한전선 (001440) · 기업설명회(IR) 개최(안내공시)
 *   rcept_no 20260330800567, filed 2026-03-30
 *   https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260330800567
 *
 * The shell fixture keeps only the viewDoc call the fetcher reads. The body
 * fixture is the disclosure table as filed, with attributes stripped, and is
 * stored twice: as UTF-8 for readability and as the MS949 bytes DART actually
 * serves, so the decoding step is exercised on real bytes rather than assumed.
 */
const REAL_RECEIPT_NO = '20260330800567';
const SHELL = await readFile(new URL('./fixtures/dart/ir-20260330800567-shell.html', import.meta.url), 'utf8');
const BODY_BYTES = await readFile(new URL('./fixtures/dart/ir-20260330800567-body.ms949', import.meta.url));

const NOW = new Date('2026-03-30T09:00:00.000Z');
const FILED = '20260330';

/**
 * A stand-in for DART. The default body is the real filing's MS949 bytes; a
 * body passed in is UTF-8, and the stub declares whichever it is serving,
 * because the fetcher decodes by the declared charset.
 */
function dartFetch({ shell = SHELL, body, bodyCharset, shellStatus = 200, bodyStatus = 200 } = {}) {
  const bodyBytes = body === undefined ? BODY_BYTES : body;
  const charset = bodyCharset || (body === undefined ? 'MS949' : 'UTF-8');
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const isShell = String(url).includes('dsaf001/main.do');
    const status = isShell ? shellStatus : bodyStatus;
    const payload = isShell ? new TextEncoder().encode(shell) : bodyBytes;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: name => (name === 'content-type' ? `text/html; charset=${isShell ? 'UTF-8' : charset}` : null) },
      arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
    };
  };
  impl.calls = calls;
  return impl;
}

async function seedDb() {
  const db = new SqliteD1();
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  await ensureDisclosureSchema({ COMMENTS_DB: db });
  return db;
}

async function storeFiling(db, overrides = {}) {
  const filing = normalizeFiling({
    rcept_no: REAL_RECEIPT_NO, corp_cls: 'Y', corp_name: '대한전선', corp_code: '00126362',
    stock_code: '001440', report_nm: '기업설명회(IR)개최(안내공시)', flr_nm: '대한전선',
    rcept_dt: FILED, rm: '', ...overrides
  }, NOW);
  await upsertFiling(db, filing, { watchlistCodes: new Set(), now: NOW });
  return filing;
}

/* ------------------------------------------------- the document, end to end */

test('the two-step lookup reaches the filing the public link points at', () => {
  assert.equal(filingUrl(REAL_RECEIPT_NO), `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${REAL_RECEIPT_NO}`);

  const args = parseViewerArgs(SHELL);
  assert.deepEqual(args, {
    rcpNo: REAL_RECEIPT_NO, dcmNo: '11194491', eleId: '0', offset: '0', length: '0', dtd: 'HTML'
  });
  assert.match(viewerUrl(args), /report\/viewer\.do\?rcpNo=20260330800567&dcmNo=11194491/);
});

test('a filing page that no longer names its document is skipped, not guessed', async () => {
  assert.equal(parseViewerArgs('<html><body>점검 중</body></html>'), null);
  await assert.rejects(
    () => fetchFilingDocument(REAL_RECEIPT_NO, { fetchImpl: dartFetch({ shell: '<html></html>' }) }),
    /no longer names its document/
  );
  await assert.rejects(() => fetchFilingDocument('123', { fetchImpl: dartFetch() }), /14 digits/);
});

test('the MS949 body DART serves is decoded, not read as UTF-8', async () => {
  const text = await fetchFilingDocument(REAL_RECEIPT_NO, { fetchImpl: dartFetch() });
  // Read as UTF-8 these bytes are noise, and every Korean label would miss.
  assert.match(text, /기업설명회/);
  assert.match(text, /일시/);
  assert.match(text, /2026-04-01/);
});

test('an unreachable document is an error rather than an empty read', async () => {
  await assert.rejects(() => fetchFilingDocument(REAL_RECEIPT_NO, { fetchImpl: dartFetch({ shellStatus: 503 }) }), /HTTP 503/);
  await assert.rejects(() => fetchFilingDocument(REAL_RECEIPT_NO, { fetchImpl: dartFetch({ bodyStatus: 404 }) }), /HTTP 404/);
});

/* ------------------------------------- the whole pipeline, on a real filing */

test('a real IR filing becomes a calendar event a reader can see', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, {
    stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true
  }, NOW);
  await storeFiling(db);

  const fetchImpl = dartFetch();
  const outcome = await syncCorporateEvents(db, { fetchImpl, now: NOW });

  assert.equal(outcome.status, 'ok');
  assert.equal(outcome.candidates, 1);
  assert.equal(outcome.opened, 1);
  assert.equal(outcome.events, 1);
  assert.equal(outcome.requests, 2, 'the shell and the body');
  assert.equal(fetchImpl.calls.length, 2);

  // The date and time as the filing states them: 일시 2026-04-01 13:00.
  const stored = db.row(`SELECT * FROM ${EVENTS_TABLE} WHERE event_id = 'opendart:dart:${REAL_RECEIPT_NO}'`);
  assert.equal(stored.event_date, '2026-04-01');
  assert.equal(stored.event_time, '13:00');
  assert.equal(stored.timezone, 'Asia/Seoul');
  assert.equal(stored.company_name, '대한전선');
  assert.equal(stored.company_stock_code, '001440');
  assert.equal(stored.title_ko, '기업설명회(IR)');
  assert.match(stored.source_url, new RegExp(`rcpNo=${REAL_RECEIPT_NO}`));

  // And it reaches the public month payload.
  const [event] = await getEventsForDisplayMonth(db, 2026, 4);
  assert.equal(event.id, `opendart:dart:${REAL_RECEIPT_NO}`);
  assert.deepEqual(event.display, { date: '2026-04-01', time: '13:00', timezone: 'Asia/Seoul', shifted: false });
  assert.deepEqual(event.company, { stockCode: '001440', name: '대한전선' });
  db.close();
});

/* -------------------------------------------------- what is never opened */

test('a company without calendar tracking is never opened', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, {
    stockCode: '001440', corpName: '대한전선', disclosureEnabled: true, calendarEnabled: false
  }, NOW);
  await storeFiling(db);

  const fetchImpl = dartFetch();
  const outcome = await syncCorporateEvents(db, { fetchImpl, now: NOW });
  assert.equal(outcome.candidates, 0);
  assert.equal(fetchImpl.calls.length, 0, 'disclosure priority buys no document requests');
  db.close();
});

test('a filing type that announces no date is never opened', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  await storeFiling(db, { rcept_no: '20260330800999', report_nm: '분기보고서 (2026.03)' });

  const fetchImpl = dartFetch();
  const outcome = await syncCorporateEvents(db, { fetchImpl, now: NOW });
  assert.equal(outcome.candidates, 0);
  assert.equal(fetchImpl.calls.length, 0);
  db.close();
});

test('a filing is opened once, not every day', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  await storeFiling(db);

  const first = dartFetch();
  await syncCorporateEvents(db, { fetchImpl: first, now: NOW });
  assert.equal(first.calls.length, 2);

  const second = dartFetch();
  const outcome = await syncCorporateEvents(db, { fetchImpl: second, now: new Date('2026-03-31T09:00:00.000Z') });
  assert.equal(outcome.candidates, 0);
  assert.equal(second.calls.length, 0, 'a filing already read is not opened again');
  db.close();
});

test('a filing with no readable date is remembered rather than retried forever', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  await storeFiling(db, { rcept_no: '20260330800111' });

  const undated = dartFetch({ body: new TextEncoder().encode('<html><body>일시는 추후 공시 예정입니다.</body></html>') });
  const first = await syncCorporateEvents(db, { fetchImpl: undated, now: NOW });
  assert.equal(first.events, 0);
  assert.equal(first.skipped, 1);
  assert.equal(db.row(`SELECT reason FROM market_calendar_skipped WHERE rcept_no = '20260330800111'`).reason, 'NO_LABELLED_DATE');

  const again = dartFetch();
  const second = await syncCorporateEvents(db, { fetchImpl: again, now: new Date('2026-03-31T09:00:00.000Z') });
  assert.equal(again.calls.length, 0, 'the budget is not spent on it a second time');
  assert.equal(second.candidates, 0);
  db.close();
});

/* ------------------------------------------------------------ the budget */

test('every document request is counted against the OpenDART daily budget', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  await storeFiling(db);

  await syncCorporateEvents(db, { fetchImpl: dartFetch(), now: NOW });
  const usage = db.row(`SELECT request_count FROM disclosure_usage_daily WHERE kind = 'source:opendart' AND usage_date = '2026-03-30'`);
  assert.equal(usage.request_count, 2, 'the shell and the body, on the same meter the sync uses');
  db.close();
});

test('an exhausted budget stops the pass instead of half-reading a filing', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  await storeFiling(db);
  await storeFiling(db, { rcept_no: '20260330800222' });

  // Room for one document's two requests and one more.
  const fetchImpl = dartFetch();
  const outcome = await syncCorporateEvents(db, {
    fetchImpl, now: NOW, env: { DISCLOSURE_DART_DAILY_BUDGET: '50' }, limit: 2
  });
  assert.ok(outcome.events >= 1);
  // Whatever it opened, it never made an odd number of requests.
  assert.equal(fetchImpl.calls.length % 2, 0, 'a document is never half-fetched');
  db.close();
});

test('the per-run ceiling bounds the worst day', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);
  for (let i = 0; i < 25; i += 1) {
    await storeFiling(db, { rcept_no: `202603308001${String(i).padStart(2, '0')}` });
  }

  const fetchImpl = dartFetch();
  const outcome = await syncCorporateEvents(db, { fetchImpl, now: NOW });
  assert.equal(outcome.candidates, 25);
  assert.equal(outcome.opened, MAX_DOCUMENTS_PER_RUN);
  assert.equal(fetchImpl.calls.length, MAX_DOCUMENTS_PER_RUN * 2);
  db.close();
});

/* ----------------------------------------------------------- corrections */

test('a correction that names its original leaves one live date, not two', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);

  // The original announces 15 October.
  await storeFiling(db, { rcept_no: '20261001800001', rcept_dt: '20261001' });
  const original = dartFetch({ body: new TextEncoder().encode('<html><body>1. 일시 및 장소 일시 2026-10-15 13:00</body></html>') });
  await syncCorporateEvents(db, { fetchImpl: original, now: new Date('2026-10-01T00:00:00.000Z') });
  assert.equal(db.row(`SELECT event_date FROM ${EVENTS_TABLE} WHERE event_id = 'opendart:dart:20261001800001'`).event_date, '2026-10-15');

  // The correction moves it to the 22nd and says which filing it corrects.
  await storeFiling(db, { rcept_no: '20261005800002', rcept_dt: '20261005', report_nm: '[기재정정]기업설명회(IR)개최(안내공시)' });
  const corrected = dartFetch({ body: new TextEncoder().encode(
    '<html><body>정정대상 공시 접수번호 20261001800001 1. 일시 및 장소 일시 2026-10-22 13:00</body></html>') });
  const outcome = await syncCorporateEvents(db, { fetchImpl: corrected, now: new Date('2026-10-05T00:00:00.000Z') });

  assert.equal(outcome.superseded, 1);
  const live = (await getEventsForDisplayMonth(db, 2026, 10)).filter(event => event.status !== 'cancelled');
  assert.equal(live.length, 1, 'the reader sees one date for this briefing');
  assert.equal(live[0].display.date, '2026-10-22');
  assert.equal(live[0].id, 'opendart:dart:20261005800002');
  // The withdrawn original is kept, marked withdrawn.
  assert.equal(db.row(`SELECT status FROM ${EVENTS_TABLE} WHERE event_id = 'opendart:dart:20261001800001'`).status, 'cancelled');
  db.close();
});

test('a correction with no stated original leaves the first one alone', async () => {
  const db = await seedDb();
  await addWatchlistCompany(db, { stockCode: '001440', corpName: '대한전선', disclosureEnabled: false, calendarEnabled: true }, NOW);

  await storeFiling(db, { rcept_no: '20261001800001', rcept_dt: '20261001' });
  await syncCorporateEvents(db, {
    fetchImpl: dartFetch({ body: new TextEncoder().encode('<html><body>1. 일시 및 장소 일시 2026-10-15 13:00</body></html>') }),
    now: new Date('2026-10-01T00:00:00.000Z')
  });

  // Same company, same type, a week later: every similarity, no evidence.
  await storeFiling(db, { rcept_no: '20261005800002', rcept_dt: '20261005', report_nm: '[기재정정]기업설명회(IR)개최(안내공시)' });
  const outcome = await syncCorporateEvents(db, {
    fetchImpl: dartFetch({ body: new TextEncoder().encode('<html><body>1. 일시 및 장소 일시 2026-10-22 13:00</body></html>') }),
    now: new Date('2026-10-05T00:00:00.000Z')
  });

  assert.equal(outcome.superseded, 0, 'nothing is merged on resemblance');
  const live = (await getEventsForDisplayMonth(db, 2026, 10)).filter(event => event.status !== 'cancelled');
  assert.equal(live.length, 2, 'both filings stand, because neither says it replaces the other');
  db.close();
});

/* ---------------------------------------------- it runs as part of the pass */

test('the corporate step is part of the calendar sync, not a separate thing', async () => {
  const source = await readFile(new URL('../functions/_calendar-sync.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ syncCorporateEvents \}/);
  assert.match(source, /results\.push\(await syncCorporateEvents\(db, \{ env, fetchImpl, now \}\)\)/);
  // A failure there is reported like any other source, not swallowed.
  assert.match(source, /sourceName: 'opendart-corporate', status: 'error'/);
});
