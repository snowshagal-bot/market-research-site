/**
 * Storage for the market events shown on /calendar/.
 *
 * Exchange closures stay in _trading-calendar.js, which is checked in and needs
 * no database. What lives here is everything that arrives from outside: the
 * official release schedules, the expiries this repo computes, and the future
 * dates a followed company has filed. Those change upstream, so they need
 * identity, a status, and a record of when they were last confirmed.
 *
 * Two rules shape the schema. An event keeps the identity its source gave it,
 * so re-reading the same schedule updates one row instead of adding another.
 * And an event that disappears upstream is marked cancelled rather than
 * deleted, because a date that was announced and withdrawn is itself news.
 */

import { DISPLAY_TIMEZONE, withDisplayTime } from './_calendar-time.js';

export const EVENTS_TABLE = 'market_calendar_events';

export const EVENT_CATEGORIES = Object.freeze([
  'monetary_policy',
  'inflation',
  'employment',
  'earnings',
  'corporate_event',
  'derivatives_expiry'
]);

export const EVENT_STATUSES = Object.freeze(['scheduled', 'confirmed', 'changed', 'cancelled']);
export const EVENT_MARKETS = Object.freeze(['KR', 'US']);
export const EVENT_SOURCE_TYPES = Object.freeze(['official', 'rule', 'opendart']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TITLE = 200;

export class CalendarEventError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const schemaPromises = new WeakMap();

export async function ensureCalendarEventSchema(env) {
  const db = env?.COMMENTS_DB;
  if (!db) throw new CalendarEventError('DB_NOT_CONFIGURED', '캘린더 이벤트 데이터베이스가 연결되지 않았습니다.');
  if (!schemaPromises.has(db)) {
    const promise = runSchema(db).catch(error => {
      schemaPromises.delete(db);
      throw error;
    });
    schemaPromises.set(db, promise);
  }
  await schemaPromises.get(db);
  return db;
}

async function runSchema(db) {
  await db.batch([
    // event_time is nullable on purpose: several official schedules publish a
    // date and no clock time, and a guessed time would read as a fact.
    db.prepare(`CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE} (
      event_id TEXT PRIMARY KEY,
      event_date TEXT NOT NULL,
      event_time TEXT,
      timezone TEXT NOT NULL,
      market TEXT NOT NULL,
      category TEXT NOT NULL,
      importance TEXT NOT NULL DEFAULT 'normal',
      title_ko TEXT NOT NULL DEFAULT '',
      title_en TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      source_event_id TEXT NOT NULL,
      company_stock_code TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled',
      -- Source-specific detail that is worth keeping but is not the event
      -- itself: the first day of a two-day FOMC meeting, for instance.
      meta_json TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL,
      last_verified_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_calendar_events_month
      ON ${EVENTS_TABLE} (event_date, market, category)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_calendar_events_source
      ON ${EVENTS_TABLE} (source_type, source_name, event_date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_calendar_events_company
      ON ${EVENTS_TABLE} (company_stock_code, event_date)`),
    // When each source last answered, so a stale feed is visible rather than
    // silently frozen.
    db.prepare(`CREATE TABLE IF NOT EXISTS market_calendar_sources (
      source_name TEXT PRIMARY KEY,
      source_url TEXT NOT NULL DEFAULT '',
      last_success_at TEXT NOT NULL DEFAULT '',
      last_attempt_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      event_count INTEGER NOT NULL DEFAULT 0,
      last_status TEXT NOT NULL DEFAULT 'ok',
      -- What a successful run could not confirm, such as a release time the
      -- source did not publish. Not an error: the events still landed.
      last_note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )`)
  ]);
}

/** `official:fomc:2026-09-16` — readable, and stable across syncs. */
export function buildEventId(sourceType, sourceEventId) {
  const type = String(sourceType || '').trim();
  const id = String(sourceEventId || '').trim();
  if (!EVENT_SOURCE_TYPES.includes(type)) throw new CalendarEventError('BAD_SOURCE_TYPE', `Unknown source type: ${type}`);
  if (!id) throw new CalendarEventError('BAD_SOURCE_EVENT_ID', 'source_event_id is required');
  return `${type}:${id}`.slice(0, 200);
}

function text(value, max = MAX_TITLE) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Rejects anything that would put a wrong date on the calendar. Callers are
 * expected to skip an event they cannot describe rather than guess at it.
 */
export function normalizeEvent(input = {}) {
  const eventDate = String(input.eventDate || '').trim();
  if (!ISO_DATE.test(eventDate)) throw new CalendarEventError('BAD_EVENT_DATE', `event_date must be YYYY-MM-DD: ${eventDate}`);

  // A missing time stays missing. '' and undefined both mean "not published".
  const rawTime = input.eventTime === null || input.eventTime === undefined ? '' : String(input.eventTime).trim();
  if (rawTime && !CLOCK.test(rawTime)) throw new CalendarEventError('BAD_EVENT_TIME', `event_time must be HH:MM or null: ${rawTime}`);

  const market = String(input.market || '').trim().toUpperCase();
  if (!EVENT_MARKETS.includes(market)) throw new CalendarEventError('BAD_MARKET', `market must be one of ${EVENT_MARKETS.join(', ')}`);

  const category = String(input.category || '').trim();
  if (!EVENT_CATEGORIES.includes(category)) throw new CalendarEventError('BAD_CATEGORY', `Unknown category: ${category}`);

  const status = String(input.status || 'scheduled').trim();
  if (!EVENT_STATUSES.includes(status)) throw new CalendarEventError('BAD_STATUS', `Unknown status: ${status}`);

  const titleKo = text(input.titleKo);
  const titleEn = text(input.titleEn);
  if (!titleKo && !titleEn) throw new CalendarEventError('BAD_TITLE', 'an event needs a title in at least one locale');

  const sourceType = String(input.sourceType || '').trim();
  const sourceEventId = String(input.sourceEventId || '').trim();

  return {
    eventId: buildEventId(sourceType, sourceEventId),
    eventDate,
    eventTime: rawTime || null,
    timezone: text(input.timezone, 60) || (market === 'KR' ? 'Asia/Seoul' : 'America/New_York'),
    market,
    category,
    importance: ['high', 'normal', 'low'].includes(input.importance) ? input.importance : 'normal',
    titleKo,
    titleEn,
    sourceType,
    sourceName: text(input.sourceName, 80),
    sourceUrl: String(input.sourceUrl || '').trim().slice(0, 500),
    sourceEventId,
    companyStockCode: text(input.companyStockCode, 20),
    companyName: text(input.companyName, 80),
    status,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {}
  };
}

/**
 * Writes one event, and reports which of the three things happened. A date or
 * time that moved is recorded as 'changed' rather than overwritten quietly,
 * so a reader can see that the schedule shifted.
 */
export async function upsertEvent(db, input, now = new Date()) {
  const event = normalizeEvent(input);
  const nowStr = now.toISOString();

  const existing = await db.prepare(`SELECT event_date, event_time, status, title_ko, title_en
    FROM ${EVENTS_TABLE} WHERE event_id = ?`).bind(event.eventId).first();

  if (!existing) {
    await db.prepare(`INSERT INTO ${EVENTS_TABLE} (
        event_id, event_date, event_time, timezone, market, category, importance,
        title_ko, title_en, source_type, source_name, source_url, source_event_id,
        company_stock_code, company_name, status, meta_json, first_seen_at, last_verified_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(event.eventId, event.eventDate, event.eventTime, event.timezone, event.market, event.category,
        event.importance, event.titleKo, event.titleEn, event.sourceType, event.sourceName, event.sourceUrl,
        event.sourceEventId, event.companyStockCode, event.companyName, event.status,
        JSON.stringify(event.meta), nowStr, nowStr, nowStr).run();
    return { eventId: event.eventId, action: 'created' };
  }

  const moved = existing.event_date !== event.eventDate || (existing.event_time || null) !== event.eventTime;
  // A schedule that comes back after being withdrawn is a change too.
  const wasCancelled = existing.status === 'cancelled';
  const status = moved || wasCancelled ? 'changed' : event.status;

  await db.prepare(`UPDATE ${EVENTS_TABLE} SET
      event_date = ?, event_time = ?, timezone = ?, market = ?, category = ?, importance = ?,
      title_ko = ?, title_en = ?, source_name = ?, source_url = ?,
      company_stock_code = ?, company_name = ?, status = ?, meta_json = ?,
      last_verified_at = ?, updated_at = ?
    WHERE event_id = ?`)
    .bind(event.eventDate, event.eventTime, event.timezone, event.market, event.category, event.importance,
      event.titleKo, event.titleEn, event.sourceName, event.sourceUrl,
      event.companyStockCode, event.companyName, status, JSON.stringify(event.meta), nowStr, nowStr, event.eventId).run();

  return { eventId: event.eventId, action: moved || wasCancelled ? 'changed' : 'verified' };
}

/**
 * Marks the events a source no longer lists as cancelled.
 *
 * Only ever called with the results of a fetch that actually succeeded and
 * covered the window given — a failed fetch must not be read as "everything
 * was withdrawn". Nothing is deleted.
 */
export async function cancelMissingEvents(db, { sourceName, fromDate, toDate, seenEventIds }, now = new Date()) {
  if (!sourceName) throw new CalendarEventError('BAD_SOURCE', 'sourceName is required');
  if (!ISO_DATE.test(String(fromDate)) || !ISO_DATE.test(String(toDate))) {
    throw new CalendarEventError('BAD_WINDOW', 'fromDate and toDate must be YYYY-MM-DD');
  }
  if (!(seenEventIds instanceof Set)) throw new CalendarEventError('BAD_SEEN_SET', 'seenEventIds must be a Set');

  const nowStr = now.toISOString();
  const candidates = await db.prepare(`SELECT event_id FROM ${EVENTS_TABLE}
    WHERE source_name = ? AND event_date >= ? AND event_date <= ? AND status != 'cancelled'`)
    .bind(sourceName, fromDate, toDate).all();

  const missing = (candidates?.results || []).map(row => row.event_id).filter(id => !seenEventIds.has(id));
  for (const eventId of missing) {
    await db.prepare(`UPDATE ${EVENTS_TABLE} SET status = 'cancelled', updated_at = ? WHERE event_id = ?`)
      .bind(nowStr, eventId).run();
  }
  return { cancelled: missing.length, eventIds: missing };
}

/**
 * Records that a source answered, or why it did not.
 *
 * `pending` is its own outcome, distinct from both. A year the Bank of Korea
 * has not announced yet returns nothing, and that is the truth rather than a
 * failure; the same silence from a year that should be published is a failure
 * and has to look like one.
 */
export const SOURCE_RUN_STATUSES = Object.freeze(['ok', 'pending', 'error']);

export async function recordSourceRun(db, { sourceName, sourceUrl = '', ok, status, error = '', eventCount = 0, note = '' }, now = new Date()) {
  const runStatus = SOURCE_RUN_STATUSES.includes(status) ? status : (ok ? 'ok' : 'error');
  const succeeded = runStatus !== 'error';
  const nowStr = now.toISOString();
  await db.prepare(`INSERT INTO market_calendar_sources (
      source_name, source_url, last_success_at, last_attempt_at, last_error, event_count, last_status, last_note, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_name) DO UPDATE SET
      source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE market_calendar_sources.source_url END,
      last_success_at = CASE WHEN excluded.last_success_at != '' THEN excluded.last_success_at ELSE market_calendar_sources.last_success_at END,
      last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error,
      event_count = CASE WHEN excluded.last_error = '' THEN excluded.event_count ELSE market_calendar_sources.event_count END,
      last_status = excluded.last_status,
      last_note = excluded.last_note,
      updated_at = excluded.updated_at`)
    .bind(sourceName, String(sourceUrl || ''), succeeded ? nowStr : '', nowStr,
      succeeded ? '' : String(error || 'unknown').slice(0, 300),
      Number(eventCount) || 0, runStatus, String(note || '').slice(0, 200), nowStr).run();
}

export async function getSourceRuns(db) {
  const result = await db.prepare(`SELECT source_name, source_url, last_success_at, last_attempt_at, last_error, event_count, last_status, last_note
    FROM market_calendar_sources ORDER BY source_name ASC`).all();
  return (result?.results || []).map(row => ({
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    lastSuccessAt: row.last_success_at || null,
    lastAttemptAt: row.last_attempt_at || null,
    lastError: row.last_error || '',
    eventCount: Number(row.event_count || 0),
    status: row.last_status || 'ok',
    note: row.last_note || ''
  }));
}

/**
 * The events for one month, in the shape the public API hands out. Cancelled
 * events are included so a withdrawn date can be shown as withdrawn; callers
 * that only want live ones filter on status.
 */
export async function getEventsForMonth(db, year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new CalendarEventError('BAD_MONTH', 'year and month must be integers, month 1-12');
  }
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const result = await db.prepare(`SELECT event_id, event_date, event_time, timezone, market, category, importance,
      title_ko, title_en, source_name, source_url, company_stock_code, company_name, status
    FROM ${EVENTS_TABLE}
    WHERE event_date >= ? AND event_date <= ?
    ORDER BY event_date ASC, (event_time IS NULL) ASC, event_time ASC, market ASC, title_ko ASC`)
    .bind(from, to).all();

  return (result?.results || []).map(publicEvent);
}

/** Nothing internal travels to the public API: no source errors, no timestamps. */
export function publicEvent(row, company = null) {
  return {
    id: row.event_id,
    date: row.event_date,
    time: row.event_time || null,
    timezone: row.timezone,
    market: row.market,
    category: row.category,
    importance: row.importance,
    title: { ko: row.title_ko || '', en: row.title_en || '' },
    // The registered English name when the administrator entered one, and the
    // Korean name as it stands when they did not. Nothing is translated here.
    company: row.company_stock_code
      ? {
        stockCode: row.company_stock_code,
        name: company?.name || row.company_name,
        nameEn: company?.nameEn || ''
      }
      : null,
    source: { name: row.source_name, url: row.source_url || '' },
    status: row.status
  };
}

export const __test = { text, runSchema };

/**
 * The events a Seoul reader should see in one month.
 *
 * Which month an event belongs to is decided by its Korean display date, not
 * by the date its source published. A Federal Reserve decision at 14:00 on
 * 31 January is 04:00 on 1 February in Seoul, and February is where a reader
 * looks for it — so the rows are read with a couple of days of slack on either
 * side, converted, and only then filtered to the month that was asked for.
 *
 * Events with no time keep their own date: an expiry or a record date is a day
 * in its own market rather than an instant, and shifting it would be inventing
 * a fact rather than translating one.
 */
export async function getEventsForDisplayMonth(db, year, month, displayTimeZone = DISPLAY_TIMEZONE) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new CalendarEventError('BAD_MONTH', 'year and month must be integers, month 1-12');
  }

  // Two days covers any zone this calendar carries, in either direction.
  const BUFFER_DAYS = 2;
  const firstOfMonth = Date.UTC(y, m - 1, 1);
  const lastOfMonth = Date.UTC(y, m, 0);
  const from = new Date(firstOfMonth - BUFFER_DAYS * 86400000).toISOString().slice(0, 10);
  const to = new Date(lastOfMonth + BUFFER_DAYS * 86400000).toISOString().slice(0, 10);

  const result = await db.prepare(`SELECT event_id, event_date, event_time, timezone, market, category, importance,
      title_ko, title_en, source_name, source_url, company_stock_code, company_name, status
    FROM ${EVENTS_TABLE}
    WHERE event_date >= ? AND event_date <= ?`).bind(from, to).all();

  const prefix = `${y}-${String(m).padStart(2, '0')}-`;

  // A company's dates are shown only while it is actually being followed for
  // the calendar. Turning tracking off hides its events at once without
  // deleting them, so turning it back on shows the same ones again rather than
  // spending requests re-reading filings that have not changed.
  const followed = await calendarCompanyIndex(db);

  return (result?.results || [])
    .filter(row => !row.company_stock_code || followed.has(row.company_stock_code))
    .map(row => withDisplayTime(publicEvent(row, followed.get(row.company_stock_code)), displayTimeZone))
    .filter(event => event.display.date.startsWith(prefix))
    .sort(byDisplayOrder);
}

/**
 * The companies the calendar currently follows, and the names each locale
 * should use for them. Empty when the disclosure tables are not there, which
 * simply means no company events are shown.
 */
async function calendarCompanyIndex(db) {
  const index = new Map();
  try {
    const result = await db.prepare(`SELECT stock_code, corp_name, corp_name_en FROM disclosure_watchlist
      WHERE active = 1 AND calendar_enabled = 1`).all();
    for (const row of result?.results || []) {
      index.set(row.stock_code, { name: row.corp_name, nameEn: String(row.corp_name_en || '') });
    }
  } catch (_) {
    // No watchlist table means no followed companies, and therefore no
    // company events — never a page full of them from a stale table.
  }
  return index;
}

/**
 * Reading order for a day: everything that has no hour first, because it
 * belongs to the whole day, then by the hour shown. Ties fall back to
 * importance, then to fixed fields so the order never wobbles between calls.
 */
const IMPORTANCE_RANK = { high: 0, normal: 1, low: 2 };

export function byDisplayOrder(a, b) {
  if (a.display.date !== b.display.date) return a.display.date < b.display.date ? -1 : 1;

  const aAllDay = a.display.time === null;
  const bAllDay = b.display.time === null;
  if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
  if (!aAllDay && a.display.time !== b.display.time) return a.display.time < b.display.time ? -1 : 1;

  const rank = (IMPORTANCE_RANK[a.importance] ?? 1) - (IMPORTANCE_RANK[b.importance] ?? 1);
  if (rank !== 0) return rank;
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
}
