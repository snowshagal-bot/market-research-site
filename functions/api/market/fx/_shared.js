/**
 * FX Close: the Seoul FX market's USD/KRW rate at 15:30 KST of each KRX trading
 * day, from the Bank of Korea ECOS (731Y003 / 0000003), the figure the news
 * and Bank of Korea statistics use. ECOS publishes it after the day's Market
 * Close record is final and frozen, so it is a dataset of its own:
 * - published separately;
 * - stored in market_fx_close;
 * - joined to the session by market_date (applyFxClose, ../_fx-merge.js).
 * Nothing here reads or changes market_close_snapshots.
 *
 * Contract: contracts/fx_close/ (schema_version 1.0.0). Written after the
 * Market Funds module (../funds/_shared.js), whose storage rules it keeps.
 */
import { json } from '../_shared.js';
import { isMarketYearSupported, isTradingDate, kstParts, parseDate } from '../../../_trading-calendar.js';

export const FX_CLOSE_TABLE = 'market_fx_close';
export const FX_CLOSE_SCHEMA_VERSION = '1.0.0';
export const FX_CLOSE_MAX_BYTES = 64 * 1024;
export const FX_CLOSE_MAX_DAYS = 60;
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
// A day's 15:30 rate exists only from 15:30 KST.
const SESSION_CLOSE_KST = '15:30';
const PREVIOUS_DATE_MAX_DAYS = 14;
// KRW per USD: a sanity range, at most two decimals, within 10% of the previous day.
const RATE_MIN = 100;
const RATE_MAX = 5000;
const MAX_DAILY_MOVE = 0.10;

export const FX_CLOSE_CODES = Object.freeze(['USDKRW']);
const ORDER = new Map(FX_CLOSE_CODES.map((code, index) => [code, index]));

const DOCUMENT_KEYS = ['schema_version', 'generated_at', 'days'];
const DAY_KEYS = ['market_date', 'previous_date', 'retrieved_at', 'source', 'items'];
const ITEM_KEYS = ['code', 'value', 'previous_value'];
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export class FxCloseError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function fxCloseErrorResponse(error) {
  if (error instanceof FxCloseError) return json({ error: error.code, message: error.message }, error.status);
  console.error('fx close request failed', error);
  return json({ error: 'FX_CLOSE_FAILED', message: '원/달러 15:30 기준가 요청을 처리하지 못했습니다.' }, 500);
}

/* ------------------------------------------------------------ validation */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseDateTime(value) {
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validRate(value) {
  return isFiniteNumber(value) && value >= RATE_MIN && value <= RATE_MAX && Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

function validateItem(item, at, errors) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${at}: must be an object.`);
    return;
  }
  for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) errors.push(`${at}.${key}: unknown field.`);
  for (const key of ITEM_KEYS) if (!(key in item)) errors.push(`${at}.${key}: required.`);
  if (!ORDER.has(item.code)) {
    errors.push(`${at}.code: ${JSON.stringify(item.code)} is not an FX Close instrument.`);
    return;
  }
  for (const key of ['value', 'previous_value']) {
    if (!validRate(item[key])) errors.push(`${at}.${key}: KRW ${RATE_MIN} to ${RATE_MAX} with at most two decimals required.`);
  }
  if (validRate(item.value) && validRate(item.previous_value) && Math.abs(item.value / item.previous_value - 1) > MAX_DAILY_MOVE) {
    errors.push(`${at}.value: ${item.value} is more than ${MAX_DAILY_MOVE * 100}% from previous_value ${item.previous_value}.`);
  }
}

function dayOffset(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function validateDay(day, index, now, errors) {
  const at = `$.days[${index}]`;
  if (!day || typeof day !== 'object' || Array.isArray(day)) {
    errors.push(`${at}: must be an object.`);
    return null;
  }
  for (const key of Object.keys(day)) if (!DAY_KEYS.includes(key)) errors.push(`${at}.${key}: unknown field.`);
  for (const key of DAY_KEYS) if (!(key in day)) errors.push(`${at}.${key}: required.`);

  const today = kstParts(new Date(now)).date;
  const date = typeof day.market_date === 'string' ? parseDate(day.market_date) : null;
  let marketDateOk = false;
  if (!date) {
    errors.push(`${at}.market_date: YYYY-MM-DD required.`);
  } else {
    const year = date.getUTCFullYear();
    if (day.market_date > today) errors.push(`${at}.market_date: after today (KST).`);
    else if (!isMarketYearSupported('KRX', year)) errors.push(`${at}.market_date: the KRX calendar does not cover ${year}.`);
    else if (!isTradingDate(day.market_date, 'KRX')) errors.push(`${at}.market_date: ${day.market_date} is not a KRX trading date.`);
    else marketDateOk = true;
  }
  const previous = typeof day.previous_date === 'string' ? parseDate(day.previous_date) : null;
  if (!previous) {
    errors.push(`${at}.previous_date: YYYY-MM-DD required.`);
  } else if (marketDateOk) {
    const gap = dayOffset(day.previous_date, day.market_date);
    // ECOS's previous row: normally the previous KRX session. The Seoul FX
    // market keeps its own calendar, so it is checked as a weekday 1 to 14 days
    // earlier, not as a KRX session.
    if (gap < 1 || gap > PREVIOUS_DATE_MAX_DAYS) errors.push(`${at}.previous_date: must be 1 to ${PREVIOUS_DATE_MAX_DAYS} days before market_date.`);
    else if ([0, 6].includes(previous.getUTCDay())) errors.push(`${at}.previous_date: ${day.previous_date} is a weekend.`);
  }
  if (typeof day.source !== 'string' || !day.source.trim() || day.source.length > 80) errors.push(`${at}.source: non-empty string of at most 80 characters required.`);

  const retrievedAt = parseDateTime(day.retrieved_at);
  if (retrievedAt === null) {
    errors.push(`${at}.retrieved_at: ISO date-time with offset required.`);
  } else {
    if (retrievedAt > now + FUTURE_SKEW_MS) errors.push(`${at}.retrieved_at: in the future.`);
    if (date && retrievedAt < Date.parse(`${day.market_date}T${SESSION_CLOSE_KST}:00+09:00`)) {
      errors.push(`${at}.retrieved_at: before ${day.market_date} ${SESSION_CLOSE_KST} KST, when the rate is set.`);
    }
  }

  const items = Array.isArray(day.items) ? day.items : null;
  if (!items) errors.push(`${at}.items: array required.`);
  else if (items.length < 1 || items.length > FX_CLOSE_CODES.length) errors.push(`${at}.items: 1 to ${FX_CLOSE_CODES.length} items required.`);
  const seen = new Set();
  for (const [itemIndex, item] of (items || []).entries()) {
    validateItem(item, `${at}.items[${itemIndex}]`, errors);
    if (item && typeof item === 'object' && typeof item.code === 'string') {
      if (seen.has(item.code)) errors.push(`${at}.items[${itemIndex}].code: ${item.code} appears more than once.`);
      seen.add(item.code);
    }
  }
  return retrievedAt === null ? null : { retrievedAt };
}

/** The stored and served form of a day: known fields only, items in canonical order. */
function normalizeDay(day) {
  return {
    market_date: day.market_date,
    previous_date: day.previous_date,
    retrieved_at: day.retrieved_at,
    source: day.source,
    items: day.items
      .map(item => Object.fromEntries(ITEM_KEYS.map(key => [key, item[key]])))
      .sort((left, right) => ORDER.get(left.code) - ORDER.get(right.code))
  };
}

/**
 * The whole document or nothing: any contract error rejects the request
 * before storage is touched. Returns { passed, errors, days } where days carry
 * the normalised day and its retrieval instant (UTC ISO) for ordering.
 */
export function validateFxCloseDocument(document, now = Date.now()) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { passed: false, errors: ['$: must be an object.'], days: [] };
  }
  for (const key of Object.keys(document)) if (!DOCUMENT_KEYS.includes(key)) errors.push(`$.${key}: unknown field.`);
  if (document.schema_version !== FX_CLOSE_SCHEMA_VERSION) errors.push(`$.schema_version: must be ${FX_CLOSE_SCHEMA_VERSION}.`);
  const generatedAt = parseDateTime(document.generated_at);
  if (generatedAt === null) errors.push('$.generated_at: ISO date-time with offset required.');
  else if (generatedAt > now + FUTURE_SKEW_MS) errors.push('$.generated_at: in the future.');

  const days = Array.isArray(document.days) ? document.days : null;
  if (!days) errors.push('$.days: array required.');
  else if (days.length < 1 || days.length > FX_CLOSE_MAX_DAYS) errors.push(`$.days: 1 to ${FX_CLOSE_MAX_DAYS} days required.`);

  const accepted = [];
  const seen = new Set();
  for (const [index, day] of (days || []).entries()) {
    const times = validateDay(day, index, now, errors);
    if (day && typeof day === 'object' && typeof day.market_date === 'string') {
      if (seen.has(day.market_date)) errors.push(`$.days[${index}].market_date: ${day.market_date} appears more than once.`);
      seen.add(day.market_date);
    }
    if (times) accepted.push({ day, retrievedAt: times.retrievedAt });
  }
  if (errors.length) return { passed: false, errors: errors.slice(0, 100), days: [] };
  return {
    passed: true,
    errors: [],
    days: accepted.map(({ day, retrievedAt }) => ({ day: normalizeDay(day), retrievedAt: new Date(retrievedAt).toISOString() }))
  };
}

/* ------------------------------------------------------------ storage */

async function tableExists(db) {
  return Boolean(await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).bind(FX_CLOSE_TABLE).first());
}

/**
 * The table is created by migrations/comments/0007_market_fx_close.sql, never
 * by a request. A database without it answers 503 instead of silently creating one.
 */
export async function requireFxCloseDb(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') {
    throw new FxCloseError('DB_NOT_CONFIGURED', '원/달러 15:30 기준가 데이터베이스가 연결되지 않았습니다.', 503);
  }
  let exists;
  try { exists = await tableExists(db); }
  catch (_) { throw new FxCloseError('FX_CLOSE_SCHEMA_NOT_READY', '원/달러 15:30 기준가 스키마를 확인할 수 없습니다.', 503); }
  if (!exists) throw new FxCloseError('FX_CLOSE_SCHEMA_NOT_READY', '원/달러 15:30 기준가 migration이 적용되지 않았습니다.', 503);
  return db;
}

// What makes two publications of a day the same: everything but retrieved_at.
function figures(day) {
  return JSON.stringify({ previous_date: day.previous_date, source: day.source, items: day.items });
}

/**
 * What to do with each accepted day against the stored row. Different
 * figures replace the stored ones only when read later (an ECOS revision);
 * the same figures are unchanged whenever they were read.
 */
export function planFxCloseWrites(accepted, storedRows) {
  const stored = new Map(storedRows.map(row => [row.market_date, row]));
  const plan = { write: [], created: [], updated: [], unchanged: [], skipped_older: [] };
  for (const entry of accepted) {
    const date = entry.day.market_date;
    const row = stored.get(date);
    if (!row) {
      plan.write.push(entry);
      plan.created.push(date);
      continue;
    }
    let storedDay = null;
    try { storedDay = JSON.parse(row.payload_json); } catch (_) {}
    if (storedDay && figures(storedDay) === figures(entry.day)) plan.unchanged.push(date);
    else if (entry.retrievedAt > row.retrieved_at) {
      plan.write.push(entry);
      plan.updated.push(date);
    } else {
      plan.skipped_older.push(date);
    }
  }
  return plan;
}

/**
 * One statement per written day. The WHERE clause repeats the ordering rule,
 * so a publish racing another cannot replace a row with figures read earlier
 * (ISO UTC strings order as the instants they name).
 */
export function upsertStatement(db, entry, publishedAt, authSource) {
  const { day } = entry;
  return db.prepare(`INSERT INTO ${FX_CLOSE_TABLE}
      (market_date, schema_version, retrieved_at, payload_json, published_at, auth_source)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_date) DO UPDATE SET
      schema_version = excluded.schema_version,
      retrieved_at = excluded.retrieved_at,
      payload_json = excluded.payload_json,
      published_at = excluded.published_at,
      auth_source = excluded.auth_source
    WHERE excluded.retrieved_at > ${FX_CLOSE_TABLE}.retrieved_at`)
    .bind(day.market_date, FX_CLOSE_SCHEMA_VERSION, entry.retrievedAt, JSON.stringify(day), publishedAt, authSource);
}

/* ------------------------------------------------------------ read */

/** Public day: the published fields and when the site stored them. Never auth_source. */
export function fxCloseDayDto(row) {
  let day;
  try { day = JSON.parse(row.payload_json); } catch (_) { return null; }
  if (!day || typeof day !== 'object' || !Array.isArray(day.items)) return null;
  const items = day.items
    .filter(item => ORDER.has(item?.code) && isFiniteNumber(item.value))
    .map(item => Object.fromEntries(ITEM_KEYS.map(key => [key, item[key] ?? null])))
    .sort((left, right) => ORDER.get(left.code) - ORDER.get(right.code));
  return {
    market_date: row.market_date,
    previous_date: String(day.previous_date || ''),
    retrieved_at: String(day.retrieved_at || ''),
    source: String(day.source || ''),
    items,
    published_at: row.published_at || ''
  };
}

const SELECT_DAY = `SELECT market_date, payload_json, published_at FROM ${FX_CLOSE_TABLE}`;

/** The stored row of a date, or the newest one for 'latest'. */
export function selectFxCloseDay(db, date) {
  return date === 'latest'
    ? db.prepare(`${SELECT_DAY} ORDER BY market_date DESC LIMIT 1`).first()
    : db.prepare(`${SELECT_DAY} WHERE market_date = ? LIMIT 1`).bind(date).first();
}

/**
 * Page loaders. FX Close missing altogether (the table not there yet, a failing
 * query) answers `undefined`, so readers keep the record exactly as it was
 * (applyFxClose); a table without the date's row answers `null`, so the
 * record's bank rate reads as provisional.
 */
export async function loadFxCloseDay(env, date) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') return undefined;
  try {
    if (!(await tableExists(db))) return undefined;
    const row = await selectFxCloseDay(db, date);
    return row ? fxCloseDayDto(row) : null;
  } catch (error) {
    console.error('fx close day unavailable', error);
    return undefined;
  }
}

/** Every stored day as a Map of market_date to DTO, or undefined when FX Close is unavailable. */
export async function loadFxCloseDays(env, { strict = false } = {}) {
  const db = env?.COMMENTS_DB;
  try {
    if (!db || typeof db.prepare !== 'function') {
      if (strict) throw new Error('COMMENTS_DB is unavailable');
      return undefined;
    }
    if (!strict && !(await tableExists(db))) return undefined;
    const result = await db.prepare(`${SELECT_DAY} ORDER BY market_date DESC`).all();
    const days = (result?.results || []).map(fxCloseDayDto);
    if (strict && (result?.success === false || !Array.isArray(result?.results) || days.some(day => !day))) {
      throw new Error('Invalid FX close result');
    }
    return new Map(days.filter(Boolean).map(day => [day.market_date, day]));
  } catch (error) {
    if (strict) throw error;
    console.error('fx close unavailable', error);
    return undefined;
  }
}

/**
 * USD/KRW of these dates from a database handle (the trend lines): a Map of
 * date to value, or undefined when FX Close is unavailable.
 */
export async function loadFxCloseValues(db, dates) {
  if (!db || typeof db.prepare !== 'function' || !dates.length) return undefined;
  try {
    if (!(await tableExists(db))) return undefined;
    const placeholders = dates.map(() => '?').join(', ');
    const result = await db.prepare(`${SELECT_DAY} WHERE market_date IN (${placeholders})`).bind(...dates).all();
    const values = new Map();
    for (const day of (result?.results || []).map(fxCloseDayDto)) {
      const item = day?.items?.find(entry => entry.code === 'USDKRW');
      if (item && isFiniteNumber(item.value)) values.set(day.market_date, item.value);
    }
    return values;
  } catch (error) {
    console.error('fx close values unavailable', error);
    return undefined;
  }
}

/** One date from loadFxCloseDays: the day, null when missing, undefined when FX Close is unavailable. */
export function fxCloseDayOf(days, date) {
  if (days === undefined) return undefined;
  return days.get(date) || null;
}
