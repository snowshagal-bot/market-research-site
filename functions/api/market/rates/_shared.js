/**
 * Domestic Rates: the KOFIA final quote yields (금융투자협회 최종호가수익률) of
 * each KRX trading day, afternoon basis 16:00 KST. KOFIA publishes them after
 * the day's Market Close record is final (16:05 KST), so they are a dataset of
 * their own: published separately, stored in market_domestic_rates, and
 * joined to the session by market_date on the pages. Nothing here reads or
 * changes market_close_snapshots.
 *
 * Contract: contracts/domestic_rates/ (schema_version 1.0.0). This module holds
 * the only list of instruments; the JSON Schema's enum is checked against it
 * in tests.
 */
import { json } from '../_shared.js';
import { isMarketYearSupported, isTradingDate, kstParts, parseDate } from '../../../_trading-calendar.js';

export const DOMESTIC_RATES_TABLE = 'market_domestic_rates';
export const DOMESTIC_RATES_SCHEMA_VERSION = '1.0.0';
export const DOMESTIC_RATES_MAX_BYTES = 64 * 1024;
export const DOMESTIC_RATES_MAX_DAYS = 60;
// Collector and server clocks may disagree a little; nothing may be dated
// further ahead than this.
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

// Canonical order: the order of the cards and of `items` in every response.
// `digits`: decimals KOFIA publishes (bonds 3, CD 2).
export const DOMESTIC_RATE_INSTRUMENTS = Object.freeze([
  { code: 'KTB3Y', digits: 3 },
  { code: 'KTB10Y', digits: 3 },
  { code: 'CORPAA3Y', digits: 3 },
  { code: 'CD91', digits: 2 }
].map(item => Object.freeze(item)));
export const DOMESTIC_RATE_CODES = Object.freeze(DOMESTIC_RATE_INSTRUMENTS.map(item => item.code));
const ORDER = new Map(DOMESTIC_RATE_CODES.map((code, index) => [code, index]));

const DOCUMENT_KEYS = ['schema_version', 'generated_at', 'days'];
const DAY_KEYS = ['market_date', 'basis_time', 'retrieved_at', 'source', 'items'];
const ITEM_KEYS = ['code', 'value', 'previous_value', 'change_bp'];
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const BASIS_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const YIELD_MIN = -1;
const YIELD_MAX = 25;
// Values carry 3 decimals (CD 2), so the exact change is a multiple of 0.1bp
// (CD 1bp); the collector rounds it to 0.1bp. Anything further off is not
// arithmetic on the two values.
const CHANGE_TOLERANCE_BP = 0.11;

export class DomesticRatesError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function domesticRatesErrorResponse(error) {
  if (error instanceof DomesticRatesError) return json({ error: error.code, message: error.message }, error.status);
  console.error('domestic rates request failed', error);
  return json({ error: 'DOMESTIC_RATES_FAILED', message: '국내 금리 요청을 처리하지 못했습니다.' }, 500);
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

function validateItem(item, at, errors) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${at}: must be an object.`);
    return;
  }
  for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) errors.push(`${at}.${key}: unknown field.`);
  for (const key of ITEM_KEYS) if (!(key in item)) errors.push(`${at}.${key}: required.`);
  if (!ORDER.has(item.code)) errors.push(`${at}.code: ${JSON.stringify(item.code)} is not a Domestic Rates instrument.`);
  for (const key of ['value', 'previous_value']) {
    if (!isFiniteNumber(item[key])) errors.push(`${at}.${key}: finite number required.`);
    else if (item[key] < YIELD_MIN || item[key] > YIELD_MAX) errors.push(`${at}.${key}: must be between ${YIELD_MIN} and ${YIELD_MAX} (percent).`);
  }
  if (!isFiniteNumber(item.change_bp)) {
    errors.push(`${at}.change_bp: finite number required.`);
  } else if (isFiniteNumber(item.value) && isFiniteNumber(item.previous_value)) {
    const expected = (item.value - item.previous_value) * 100;
    if (Math.abs(item.change_bp - expected) > CHANGE_TOLERANCE_BP) {
      errors.push(`${at}.change_bp: ${item.change_bp} contradicts (value − previous_value) × 100 (${expected.toFixed(2)}).`);
    }
  }
}

function validateDay(day, index, now, errors) {
  const at = `$.days[${index}]`;
  if (!day || typeof day !== 'object' || Array.isArray(day)) {
    errors.push(`${at}: must be an object.`);
    return null;
  }
  for (const key of Object.keys(day)) if (!DAY_KEYS.includes(key)) errors.push(`${at}.${key}: unknown field.`);
  for (const key of DAY_KEYS) if (!(key in day)) errors.push(`${at}.${key}: required.`);

  const date = typeof day.market_date === 'string' ? parseDate(day.market_date) : null;
  if (!date) {
    errors.push(`${at}.market_date: YYYY-MM-DD required.`);
  } else {
    const year = date.getUTCFullYear();
    if (day.market_date > kstParts(new Date(now)).date) errors.push(`${at}.market_date: after today (KST).`);
    else if (!isMarketYearSupported('KRX', year)) errors.push(`${at}.market_date: the KRX calendar does not cover ${year}.`);
    else if (!isTradingDate(day.market_date, 'KRX')) errors.push(`${at}.market_date: ${day.market_date} is not a KRX trading date.`);
  }
  if (typeof day.basis_time !== 'string' || !BASIS_TIME.test(day.basis_time)) errors.push(`${at}.basis_time: HH:MM (KST) required.`);
  if (typeof day.source !== 'string' || !day.source.trim() || day.source.length > 80) errors.push(`${at}.source: non-empty string of at most 80 characters required.`);

  const retrievedAt = parseDateTime(day.retrieved_at);
  if (retrievedAt === null) {
    errors.push(`${at}.retrieved_at: ISO date-time with offset required.`);
  } else {
    if (retrievedAt > now + FUTURE_SKEW_MS) errors.push(`${at}.retrieved_at: in the future.`);
    if (date && BASIS_TIME.test(String(day.basis_time))) {
      const basis = Date.parse(`${day.market_date}T${day.basis_time}:00+09:00`);
      if (retrievedAt < basis) errors.push(`${at}.retrieved_at: before ${day.market_date} ${day.basis_time} KST, when the afternoon yields are computed.`);
    }
  }

  const items = Array.isArray(day.items) ? day.items : null;
  if (!items) errors.push(`${at}.items: array required.`);
  else if (items.length < 1 || items.length > DOMESTIC_RATE_CODES.length) errors.push(`${at}.items: 1 to ${DOMESTIC_RATE_CODES.length} items required.`);
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
    basis_time: day.basis_time,
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
export function validateDomesticRatesDocument(document, now = Date.now()) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { passed: false, errors: ['$: must be an object.'], days: [] };
  }
  for (const key of Object.keys(document)) if (!DOCUMENT_KEYS.includes(key)) errors.push(`$.${key}: unknown field.`);
  if (document.schema_version !== DOMESTIC_RATES_SCHEMA_VERSION) errors.push(`$.schema_version: must be ${DOMESTIC_RATES_SCHEMA_VERSION}.`);
  const generatedAt = parseDateTime(document.generated_at);
  if (generatedAt === null) errors.push('$.generated_at: ISO date-time with offset required.');
  else if (generatedAt > now + FUTURE_SKEW_MS) errors.push('$.generated_at: in the future.');

  const days = Array.isArray(document.days) ? document.days : null;
  if (!days) errors.push('$.days: array required.');
  else if (days.length < 1 || days.length > DOMESTIC_RATES_MAX_DAYS) errors.push(`$.days: 1 to ${DOMESTIC_RATES_MAX_DAYS} days required.`);

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
  return Boolean(await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).bind(DOMESTIC_RATES_TABLE).first());
}

/**
 * The table is created by migrations/comments/0003_market_domestic_rates.sql,
 * never by a request. A database without it answers 503 instead of silently
 * creating one.
 */
export async function requireDomesticRatesDb(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') {
    throw new DomesticRatesError('DB_NOT_CONFIGURED', '국내 금리 데이터베이스가 연결되지 않았습니다.', 503);
  }
  let exists;
  try { exists = await tableExists(db); }
  catch (_) { throw new DomesticRatesError('DOMESTIC_RATES_SCHEMA_NOT_READY', '국내 금리 스키마를 확인할 수 없습니다.', 503); }
  if (!exists) throw new DomesticRatesError('DOMESTIC_RATES_SCHEMA_NOT_READY', '국내 금리 migration이 적용되지 않았습니다.', 503);
  return db;
}

// What makes two publications of a day the same: everything but retrieved_at.
function figures(day) {
  return JSON.stringify({ basis_time: day.basis_time, source: day.source, items: day.items });
}

/**
 * What to do with each accepted day against the stored row. Different
 * figures replace the stored ones only when read later (a KOFIA correction);
 * the same figures are unchanged whenever they were read.
 */
export function planDomesticRatesWrites(accepted, storedRows) {
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
  return db.prepare(`INSERT INTO ${DOMESTIC_RATES_TABLE}
      (market_date, schema_version, basis_time, retrieved_at, payload_json, published_at, auth_source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_date) DO UPDATE SET
      schema_version = excluded.schema_version,
      basis_time = excluded.basis_time,
      retrieved_at = excluded.retrieved_at,
      payload_json = excluded.payload_json,
      published_at = excluded.published_at,
      auth_source = excluded.auth_source
    WHERE excluded.retrieved_at > ${DOMESTIC_RATES_TABLE}.retrieved_at`)
    .bind(day.market_date, DOMESTIC_RATES_SCHEMA_VERSION, day.basis_time, entry.retrievedAt, JSON.stringify(day), publishedAt, authSource);
}

/* ------------------------------------------------------------ read */

/** Public day: the published fields and when the site stored them. Never auth_source. */
export function domesticRatesDayDto(row) {
  let day;
  try { day = JSON.parse(row.payload_json); } catch (_) { return null; }
  if (!day || typeof day !== 'object' || !Array.isArray(day.items)) return null;
  const items = day.items
    .filter(item => ORDER.has(item?.code) && isFiniteNumber(item.value))
    .map(item => Object.fromEntries(ITEM_KEYS.map(key => [key, item[key] ?? null])))
    .sort((left, right) => ORDER.get(left.code) - ORDER.get(right.code));
  return {
    market_date: row.market_date,
    basis_time: String(day.basis_time || row.basis_time || ''),
    retrieved_at: String(day.retrieved_at || ''),
    source: String(day.source || ''),
    items,
    published_at: row.published_at || ''
  };
}

/**
 * Page loaders. A missing table (migration not applied yet) or a failing
 * query leaves the pages exactly as they were without rates: null / [] /
 * an empty set, never an error page.
 */
export async function loadDomesticRatesDay(env, date) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') return null;
  try {
    if (!(await tableExists(db))) return null;
    const row = date === 'latest'
      ? await db.prepare(`SELECT market_date, basis_time, payload_json, published_at FROM ${DOMESTIC_RATES_TABLE} ORDER BY market_date DESC LIMIT 1`).first()
      : await db.prepare(`SELECT market_date, basis_time, payload_json, published_at FROM ${DOMESTIC_RATES_TABLE} WHERE market_date = ? LIMIT 1`).bind(date).first();
    return row ? domesticRatesDayDto(row) : null;
  } catch (error) {
    console.error('domestic rates day unavailable', error);
    return null;
  }
}

/** Every stored day, newest first, as DTOs. */
export async function loadDomesticRatesDays(env, { strict = false } = {}) {
  const db = env?.COMMENTS_DB;
  try {
    if (!db || typeof db.prepare !== 'function') {
      if (strict) throw new Error('COMMENTS_DB is unavailable');
      return [];
    }
    if (!strict && !(await tableExists(db))) return [];
    const result = await db.prepare(`SELECT market_date, basis_time, payload_json, published_at FROM ${DOMESTIC_RATES_TABLE} ORDER BY market_date DESC`).all();
    const days = (result?.results || []).map(domesticRatesDayDto);
    if (strict && (result?.success === false || !Array.isArray(result?.results) || days.some(day => !day))) {
      throw new Error('Invalid domestic rates result');
    }
    return days.filter(Boolean);
  } catch (error) {
    if (strict) throw error;
    console.error('domestic rates unavailable', error);
    return [];
  }
}

/** The codes some stored day has a value for: the rate pages that exist. */
export function domesticRateCodesIn(days) {
  const codes = new Set();
  for (const day of Array.isArray(days) ? days : []) {
    for (const item of day?.items || []) if (ORDER.has(item?.code) && isFiniteNumber(item.value)) codes.add(item.code);
    if (codes.size === DOMESTIC_RATE_CODES.length) break;
  }
  return codes;
}

export async function loadDomesticRateCodes(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') return new Set();
  try {
    if (!(await tableExists(db))) return new Set();
    // The newest day lists every instrument KOFIA publishes; older days add any it once had.
    const result = await db.prepare(`SELECT market_date, basis_time, payload_json, published_at FROM ${DOMESTIC_RATES_TABLE} ORDER BY market_date DESC LIMIT 10`).all();
    return domesticRateCodesIn((result?.results || []).map(domesticRatesDayDto).filter(Boolean));
  } catch (error) {
    console.error('domestic rate codes unavailable', error);
    return new Set();
  }
}
