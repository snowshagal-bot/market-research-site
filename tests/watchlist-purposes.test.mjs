import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  FILINGS_TABLE,
  WATCHLIST_TABLE,
  compactDate,
  ensureDisclosureSchema,
  getCalendarCompanies,
  getCalendarStockCodes,
  getWatchlist,
  getWatchlistStockCodes,
  kstDate,
  normalizeFiling,
  setWatchlistFlags,
  upsertFiling
} from '../functions/api/disclosures/_shared.js';
import { onRequestPost as watchlistPost } from '../functions/api/disclosures/watchlist.js';
import { createMockAuthDb, createAdminSession } from './helpers/auth-test-helper.mjs';

/** The same in-memory D1 stand-in the disclosure integration suite uses. */
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

const sharedAuthDb = await createMockAuthDb();
const sharedSession = await createAdminSession(sharedAuthDb);
const NOW = new Date('2026-08-30T10:00:00.000Z');
const TODAY = compactDate(kstDate(NOW));

async function seededDb() {
  const db = new SqliteD1();
  await ensureDisclosureSchema({ COMMENTS_DB: db });
  return db;
}

const envFor = db => ({ AUTH_DB: sharedAuthDb, COMMENTS_DB: db, ADMIN_KEY: 'watchlist-admin-secret' });

function adminRequest(body) {
  return new Request('https://admin.snowshagal.com/api/disclosures/watchlist', {
    method: 'POST',
    headers: { ...sharedSession.headers, 'content-type': 'application/json', origin: 'https://admin.snowshagal.com' },
    body: JSON.stringify(body)
  });
}

const post = (db, body) => watchlistPost({ request: adminRequest(body), env: envFor(db) });

/** A filing important enough that watchlist membership would auto-publish it. */
async function fileHighScore(db, stockCode) {
  const filing = normalizeFiling({
    rcept_no: `2026083000${stockCode.slice(-4)}`,
    corp_cls: 'Y', corp_name: '테스트기업', corp_code: '00123456', stock_code: stockCode,
    report_nm: '상장폐지(관리종목지정)', flr_nm: '테스트기업', rcept_dt: TODAY, rm: ''
  }, NOW);
  assert.ok(filing.ruleScore >= 7, 'the fixture must be a high-score filing');
  const codes = await getWatchlistStockCodes(db);
  await upsertFiling(db, filing, { watchlistCodes: codes, now: NOW });
  return filing.rceptNo;
}

/* ------------------------------------- what the thirty seeded companies are */

test('the seeded companies are followed for both reasons', async () => {
  const db = await seededDb();
  const watchlist = await getWatchlist(db);
  assert.ok(watchlist.length >= 30);
  for (const company of watchlist) {
    assert.equal(company.disclosureEnabled, true, `${company.corpName} must keep its disclosure meaning`);
    assert.equal(company.calendarEnabled, true, `${company.corpName} is a default calendar company`);
  }
  db.close();
});

test('a database created before the split keeps disclosure and joins the calendar', async () => {
  const db = new SqliteD1();
  // The shape the table had before this change, with a row already in it.
  db.database.exec(`CREATE TABLE ${WATCHLIST_TABLE} (
    stock_code TEXT PRIMARY KEY, corp_code TEXT NOT NULL DEFAULT '', corp_name TEXT NOT NULL,
    corp_cls TEXT NOT NULL DEFAULT 'Y', active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.database.exec(`INSERT INTO ${WATCHLIST_TABLE} (stock_code, corp_code, corp_name, corp_cls, active, sort_order, created_at, updated_at)
    VALUES ('005930', '00126380', '삼성전자', 'Y', 1, 1, '2026-01-01', '2026-01-01')`);

  await ensureDisclosureSchema({ COMMENTS_DB: db });

  const [company] = await getWatchlist(db);
  assert.equal(company.stockCode, '005930');
  assert.equal(company.disclosureEnabled, true, 'migration must not change what disclosure does');
  assert.equal(company.calendarEnabled, true, 'the existing watchlist is the default calendar group');
  assert.equal(company.corpNameEn, '');
  db.close();
});

/* ------------------------------------- a calendar-only company stays out of it */

test('a calendar-only company is not a disclosure-priority company', async () => {
  const db = await seededDb();
  const response = await post(db, {
    action: 'add', stockCode: '064350', corpName: '현대로템', corpCls: 'Y',
    disclosureEnabled: false, calendarEnabled: true
  });
  assert.equal(response.status, 200);

  const disclosureCodes = await getWatchlistStockCodes(db);
  const calendarCodes = await getCalendarStockCodes(db);
  assert.equal(disclosureCodes.has('064350'), false, 'calendar tracking must grant no disclosure priority');
  assert.equal(calendarCodes.has('064350'), true);

  // And its filings are neither flagged nor auto-published.
  const rceptNo = await fileHighScore(db, '064350');
  const row = db.row(`SELECT is_watchlist, publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo);
  assert.equal(row.is_watchlist, 0);
  assert.equal(row.publish_status, 'admin_only', 'a calendar-only company must not reach the public feed');
  db.close();
});

test('a disclosure company still auto-publishes exactly as before', async () => {
  const db = await seededDb();
  await post(db, {
    action: 'add', stockCode: '064350', corpName: '현대로템', corpCls: 'Y',
    disclosureEnabled: true, calendarEnabled: false
  });

  const disclosureCodes = await getWatchlistStockCodes(db);
  const calendarCodes = await getCalendarStockCodes(db);
  assert.equal(disclosureCodes.has('064350'), true);
  assert.equal(calendarCodes.has('064350'), false);

  const rceptNo = await fileHighScore(db, '064350');
  const row = db.row(`SELECT is_watchlist, publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo);
  assert.equal(row.is_watchlist, 1);
  assert.equal(row.publish_status, 'auto');
  db.close();
});

test('adding for the calendar alone does not retroactively publish today’s filings', async () => {
  const db = await seededDb();
  // The filing arrives first, before anyone is following the company.
  const rceptNo = await fileHighScore(db, '064350');
  assert.equal(db.row(`SELECT publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo).publish_status, 'admin_only');

  await post(db, {
    action: 'add', stockCode: '064350', corpName: '현대로템',
    disclosureEnabled: false, calendarEnabled: true
  });
  assert.equal(
    db.row(`SELECT publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo).publish_status,
    'admin_only',
    'the retroactive publish belongs to disclosure membership, not to calendar tracking'
  );
  db.close();
});

/* ------------------------------------------------ flipping one at a time */

test('the two switches move independently', async () => {
  const db = await seededDb();
  await post(db, { action: 'add', stockCode: '064350', corpName: '현대로템', disclosureEnabled: false, calendarEnabled: true });

  const on = await setWatchlistFlags(db, '064350', { disclosureEnabled: true }, NOW);
  assert.deepEqual(on, { stockCode: '064350', disclosureEnabled: true, calendarEnabled: true });
  assert.equal((await getWatchlistStockCodes(db)).has('064350'), true);

  const off = await setWatchlistFlags(db, '064350', { calendarEnabled: false }, NOW);
  assert.deepEqual(off, { stockCode: '064350', disclosureEnabled: true, calendarEnabled: false });
  assert.equal((await getCalendarStockCodes(db)).has('064350'), false);
  assert.equal((await getWatchlistStockCodes(db)).has('064350'), true, 'the other switch must not follow');
  db.close();
});

test('turning disclosure on grants the same-day publish it always granted', async () => {
  const db = await seededDb();
  await post(db, { action: 'add', stockCode: '064350', corpName: '현대로템', disclosureEnabled: false, calendarEnabled: true });
  const rceptNo = await fileHighScore(db, '064350');
  assert.equal(db.row(`SELECT publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo).publish_status, 'admin_only');

  await setWatchlistFlags(db, '064350', { disclosureEnabled: true }, NOW);
  const row = db.row(`SELECT is_watchlist, publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo);
  assert.equal(row.is_watchlist, 1);
  assert.equal(row.publish_status, 'auto');
  db.close();
});

test('turning disclosure off withdraws the flag but leaves what was published alone', async () => {
  const db = await seededDb();
  await post(db, { action: 'add', stockCode: '064350', corpName: '현대로템', disclosureEnabled: true, calendarEnabled: true });
  const rceptNo = await fileHighScore(db, '064350');
  assert.equal(db.row(`SELECT publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo).publish_status, 'auto');

  await setWatchlistFlags(db, '064350', { disclosureEnabled: false }, NOW);
  const row = db.row(`SELECT is_watchlist, publish_status FROM ${FILINGS_TABLE} WHERE rcept_no = ?`, rceptNo);
  assert.equal(row.is_watchlist, 0);
  assert.equal(row.publish_status, 'auto', 'already-public items stay public, as removal has always behaved');
  db.close();
});

test('deactivating a company suspends both, and reactivating restores only what it is enabled for', async () => {
  const db = await seededDb();
  await post(db, { action: 'add', stockCode: '064350', corpName: '현대로템', disclosureEnabled: false, calendarEnabled: true });
  await post(db, { action: 'toggle', stockCode: '064350', active: false });
  assert.equal((await getCalendarStockCodes(db)).has('064350'), false);

  await post(db, { action: 'toggle', stockCode: '064350', active: true });
  assert.equal((await getCalendarStockCodes(db)).has('064350'), true);
  assert.equal((await getWatchlistStockCodes(db)).has('064350'), false, 'reactivating must not turn disclosure on');
  db.close();
});

/* --------------------------------------------------- names for the calendar */

test('the calendar knows which name each locale should show', async () => {
  const db = await seededDb();
  await post(db, {
    action: 'add', stockCode: '064350', corpName: '현대로템', corpNameEn: 'Hyundai Rotem',
    disclosureEnabled: false, calendarEnabled: true
  });
  await post(db, { action: 'add', stockCode: '999990', corpName: '영문명없는기업', disclosureEnabled: false, calendarEnabled: true });

  const companies = await getCalendarCompanies(db);
  const rotem = companies.find(c => c.stockCode === '064350');
  const unnamed = companies.find(c => c.stockCode === '999990');
  assert.equal(rotem.corpNameEn, 'Hyundai Rotem');
  // No official English name means the Korean one is shown as it is; nothing
  // is machine-translated into the record.
  assert.equal(unnamed.corpNameEn, '');
  db.close();
});

/* ------------------------------------------------------------ the API guard */

test('the flags action requires an authenticated admin', async () => {
  const db = await seededDb();
  const response = await watchlistPost({
    request: new Request('https://admin.snowshagal.com/api/disclosures/watchlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://admin.snowshagal.com' },
      body: JSON.stringify({ action: 'flags', stockCode: '005930', calendarEnabled: false })
    }),
    env: envFor(db)
  });
  assert.equal(response.status, 401);
  // And nothing moved.
  assert.equal((await getCalendarStockCodes(db)).has('005930'), true);
  db.close();
});

test('the API answers with the list the caller will render', async () => {
  const db = await seededDb();
  const response = await post(db, { action: 'flags', stockCode: '005930', calendarEnabled: false });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const samsung = payload.watchlist.find(c => c.stockCode === '005930');
  assert.equal(samsung.calendarEnabled, false);
  assert.equal(samsung.disclosureEnabled, true);
  db.close();
});

test('an unknown company cannot have its flags set', async () => {
  const db = await seededDb();
  const response = await post(db, { action: 'flags', stockCode: '000000', calendarEnabled: true });
  assert.equal(response.status, 404);
  db.close();
});
