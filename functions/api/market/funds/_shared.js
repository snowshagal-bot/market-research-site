/**
 * Market Funds: KOFIA FreeSIS stock market funds of each KRX trading day:
 * investor deposits, margin loans (KOSPI and KOSDAQ), unpaid margin and forced
 * selling. KOFIA publishes a day's figures on a later business day, after the
 * day's Market Close record is final and frozen, so they are a dataset of
 * their own:
 * - published separately;
 * - stored in market_funds;
 * - joined to the session by market_date on the pages.
 * Nothing here reads or changes market_close_snapshots.
 *
 * Contract: contracts/market_funds/ (schema_version 1.0.0). This module holds
 * the only list of instruments; the JSON Schema's enums are checked against it
 * in tests.
 */
import { json } from '../_shared.js';
import { isMarketYearSupported, isTradingDate, kstParts, parseDate } from '../../../_trading-calendar.js';

export const MARKET_FUNDS_TABLE = 'market_funds';
export const MARKET_FUNDS_SCHEMA_VERSION = '1.0.0';
export const MARKET_FUNDS_MAX_BYTES = 64 * 1024;
export const MARKET_FUNDS_MAX_DAYS = 60;
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
// A day's balances exist only once its regular session has closed.
const SESSION_CLOSE_KST = '15:30';
const PREVIOUS_DATE_MAX_DAYS = 14;
const MILLION_KRW_MAX = 10_000_000_000;
// KOFIA rounds the total and its two markets separately: up to 1 apart in 2026.
const CREDIT_PARTS_TOLERANCE = 2;
// KOFIA's ratio is forced selling over the previous day's unpaid margin,
// rounded to 0.1 (exact on every 2026 day).
const RATIO_TOLERANCE = 0.051;

// Canonical order: the order of the rows and of `items` in every response.
// `unit`: 'million' (whole KRW millions, as KOFIA publishes) or 'percent'.
export const MARKET_FUND_INSTRUMENTS = Object.freeze([
  { code: 'DEPOSITS', unit: 'million' },
  { code: 'CREDIT', unit: 'million' },
  { code: 'CREDIT_KOSPI', unit: 'million' },
  { code: 'CREDIT_KOSDAQ', unit: 'million' },
  { code: 'UNPAID', unit: 'million' },
  { code: 'FORCED_SALE', unit: 'million' },
  { code: 'FORCED_SALE_RATIO', unit: 'percent' }
].map(item => Object.freeze(item)));
export const MARKET_FUND_CODES = Object.freeze(MARKET_FUND_INSTRUMENTS.map(item => item.code));
const ORDER = new Map(MARKET_FUND_CODES.map((code, index) => [code, index]));
const UNIT = new Map(MARKET_FUND_INSTRUMENTS.map(item => [item.code, item.unit]));

const DOCUMENT_KEYS = ['schema_version', 'generated_at', 'days'];
const DAY_KEYS = ['market_date', 'previous_date', 'retrieved_at', 'source', 'items'];
const ITEM_KEYS = ['code', 'value', 'previous_value'];
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export class MarketFundsError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function marketFundsErrorResponse(error) {
  if (error instanceof MarketFundsError) return json({ error: error.code, message: error.message }, error.status);
  console.error('market funds request failed', error);
  return json({ error: 'MARKET_FUNDS_FAILED', message: '증시 자금 요청을 처리하지 못했습니다.' }, 500);
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

function validValue(code, value) {
  if (UNIT.get(code) === 'percent') return isFiniteNumber(value) && value >= 0 && value <= 100;
  return Number.isInteger(value) && value >= 0 && value <= MILLION_KRW_MAX;
}

function validateItem(item, at, errors) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${at}: must be an object.`);
    return;
  }
  for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) errors.push(`${at}.${key}: unknown field.`);
  for (const key of ITEM_KEYS) if (!(key in item)) errors.push(`${at}.${key}: required.`);
  if (!ORDER.has(item.code)) {
    errors.push(`${at}.code: ${JSON.stringify(item.code)} is not a Market Funds instrument.`);
    return;
  }
  const rule = UNIT.get(item.code) === 'percent' ? 'a percent from 0 to 100' : 'whole KRW millions from 0';
  for (const key of ['value', 'previous_value']) {
    if (!validValue(item.code, item[key])) errors.push(`${at}.${key}: ${rule} required.`);
  }
}

function dayOffset(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// The two relationships KOFIA's own figures keep (MARKET_FUNDS_CONTRACT.md).
function validateArithmetic(items, at, errors) {
  const byCode = new Map(items.filter(item => item && ORDER.has(item.code)).map(item => [item.code, item]));
  const total = byCode.get('CREDIT');
  const kospi = byCode.get('CREDIT_KOSPI');
  const kosdaq = byCode.get('CREDIT_KOSDAQ');
  if (total && kospi && kosdaq) {
    for (const key of ['value', 'previous_value']) {
      if ([total[key], kospi[key], kosdaq[key]].every(Number.isInteger)
        && Math.abs(total[key] - kospi[key] - kosdaq[key]) > CREDIT_PARTS_TOLERANCE) {
        errors.push(`${at}.items: CREDIT.${key} ${total[key]} is not CREDIT_KOSPI + CREDIT_KOSDAQ (${kospi[key] + kosdaq[key]}).`);
      }
    }
  }
  const forced = byCode.get('FORCED_SALE');
  const unpaid = byCode.get('UNPAID');
  const ratio = byCode.get('FORCED_SALE_RATIO');
  if (forced && unpaid && ratio && Number.isInteger(forced.value) && Number.isInteger(unpaid.previous_value)
    && unpaid.previous_value > 0 && isFiniteNumber(ratio.value)) {
    const expected = forced.value / unpaid.previous_value * 100;
    if (Math.abs(ratio.value - expected) > RATIO_TOLERANCE) {
      errors.push(`${at}.items: FORCED_SALE_RATIO ${ratio.value} contradicts FORCED_SALE ÷ previous UNPAID × 100 (${expected.toFixed(2)}).`);
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
    if (gap < 1 || gap > PREVIOUS_DATE_MAX_DAYS) errors.push(`${at}.previous_date: must be 1 to ${PREVIOUS_DATE_MAX_DAYS} days before market_date.`);
    else if (!isMarketYearSupported('KRX', previous.getUTCFullYear())) {
      // A year before the calendar's first (2026-01-02's previous session is
      // 2025-12-30): only the gap and a weekday can be checked.
      if ([0, 6].includes(previous.getUTCDay())) errors.push(`${at}.previous_date: ${day.previous_date} is a weekend.`);
    } else if (!isTradingDate(day.previous_date, 'KRX')) errors.push(`${at}.previous_date: ${day.previous_date} is not a KRX trading date.`);
  }
  if (typeof day.source !== 'string' || !day.source.trim() || day.source.length > 80) errors.push(`${at}.source: non-empty string of at most 80 characters required.`);

  const retrievedAt = parseDateTime(day.retrieved_at);
  if (retrievedAt === null) {
    errors.push(`${at}.retrieved_at: ISO date-time with offset required.`);
  } else {
    if (retrievedAt > now + FUTURE_SKEW_MS) errors.push(`${at}.retrieved_at: in the future.`);
    if (date && retrievedAt < Date.parse(`${day.market_date}T${SESSION_CLOSE_KST}:00+09:00`)) {
      errors.push(`${at}.retrieved_at: before ${day.market_date} ${SESSION_CLOSE_KST} KST, when the session closes.`);
    }
  }

  const items = Array.isArray(day.items) ? day.items : null;
  if (!items) errors.push(`${at}.items: array required.`);
  else if (items.length < 1 || items.length > MARKET_FUND_CODES.length) errors.push(`${at}.items: 1 to ${MARKET_FUND_CODES.length} items required.`);
  const seen = new Set();
  for (const [itemIndex, item] of (items || []).entries()) {
    validateItem(item, `${at}.items[${itemIndex}]`, errors);
    if (item && typeof item === 'object' && typeof item.code === 'string') {
      if (seen.has(item.code)) errors.push(`${at}.items[${itemIndex}].code: ${item.code} appears more than once.`);
      seen.add(item.code);
    }
  }
  if (items) validateArithmetic(items, at, errors);
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
export function validateMarketFundsDocument(document, now = Date.now()) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { passed: false, errors: ['$: must be an object.'], days: [] };
  }
  for (const key of Object.keys(document)) if (!DOCUMENT_KEYS.includes(key)) errors.push(`$.${key}: unknown field.`);
  if (document.schema_version !== MARKET_FUNDS_SCHEMA_VERSION) errors.push(`$.schema_version: must be ${MARKET_FUNDS_SCHEMA_VERSION}.`);
  const generatedAt = parseDateTime(document.generated_at);
  if (generatedAt === null) errors.push('$.generated_at: ISO date-time with offset required.');
  else if (generatedAt > now + FUTURE_SKEW_MS) errors.push('$.generated_at: in the future.');

  const days = Array.isArray(document.days) ? document.days : null;
  if (!days) errors.push('$.days: array required.');
  else if (days.length < 1 || days.length > MARKET_FUNDS_MAX_DAYS) errors.push(`$.days: 1 to ${MARKET_FUNDS_MAX_DAYS} days required.`);

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
  return Boolean(await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).bind(MARKET_FUNDS_TABLE).first());
}

/**
 * The table is created by migrations/comments/0006_market_funds.sql, never by
 * a request. A database without it answers 503 instead of silently creating one.
 */
export async function requireMarketFundsDb(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') {
    throw new MarketFundsError('DB_NOT_CONFIGURED', '증시 자금 데이터베이스가 연결되지 않았습니다.', 503);
  }
  let exists;
  try { exists = await tableExists(db); }
  catch (_) { throw new MarketFundsError('MARKET_FUNDS_SCHEMA_NOT_READY', '증시 자금 스키마를 확인할 수 없습니다.', 503); }
  if (!exists) throw new MarketFundsError('MARKET_FUNDS_SCHEMA_NOT_READY', '증시 자금 migration이 적용되지 않았습니다.', 503);
  return db;
}

// What makes two publications of a day the same: everything but retrieved_at.
function figures(day) {
  return JSON.stringify({ previous_date: day.previous_date, source: day.source, items: day.items });
}

/**
 * What to do with each accepted day against the stored row. Different
 * figures replace the stored ones only when read later (a KOFIA revision);
 * the same figures are unchanged whenever they were read.
 */
export function planMarketFundsWrites(accepted, storedRows) {
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
  return db.prepare(`INSERT INTO ${MARKET_FUNDS_TABLE}
      (market_date, schema_version, retrieved_at, payload_json, published_at, auth_source)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(market_date) DO UPDATE SET
      schema_version = excluded.schema_version,
      retrieved_at = excluded.retrieved_at,
      payload_json = excluded.payload_json,
      published_at = excluded.published_at,
      auth_source = excluded.auth_source
    WHERE excluded.retrieved_at > ${MARKET_FUNDS_TABLE}.retrieved_at`)
    .bind(day.market_date, MARKET_FUNDS_SCHEMA_VERSION, entry.retrievedAt, JSON.stringify(day), publishedAt, authSource);
}

/* ------------------------------------------------------------ read */

/** Public day: the published fields and when the site stored them. Never auth_source. */
export function marketFundsDayDto(row) {
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

const SELECT_DAY = `SELECT market_date, payload_json, published_at FROM ${MARKET_FUNDS_TABLE}`;

/** The stored row of a date, or the newest one for 'latest'. */
export function selectMarketFundsDay(db, date) {
  return date === 'latest'
    ? db.prepare(`${SELECT_DAY} ORDER BY market_date DESC LIMIT 1`).first()
    : db.prepare(`${SELECT_DAY} WHERE market_date = ? LIMIT 1`).bind(date).first();
}

/**
 * Page loaders. A missing table (migration not applied yet) or a failing
 * query leaves the pages exactly as they were without funds: null / [],
 * never an error page.
 */
export async function loadMarketFundsDay(env, date) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') return null;
  try {
    if (!(await tableExists(db))) return null;
    const row = await selectMarketFundsDay(db, date);
    return row ? marketFundsDayDto(row) : null;
  } catch (error) {
    console.error('market funds day unavailable', error);
    return null;
  }
}

/** Every stored day, newest first, as DTOs. */
export async function loadMarketFundsDays(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') return [];
  try {
    if (!(await tableExists(db))) return [];
    const result = await db.prepare(`${SELECT_DAY} ORDER BY market_date DESC`).all();
    return (result?.results || []).map(marketFundsDayDto).filter(Boolean);
  } catch (error) {
    console.error('market funds unavailable', error);
    return [];
  }
}

// The instruments with a daily history page (functions/_market-indicators.js).
export const MARKET_FUND_PAGE_CODES = Object.freeze(['DEPOSITS', 'CREDIT', 'FORCED_SALE']);

/** The page codes some stored day has a value for: the fund pages that exist. */
export function marketFundCodesIn(days) {
  const codes = new Set();
  for (const day of Array.isArray(days) ? days : []) {
    for (const item of day?.items || []) {
      if (MARKET_FUND_PAGE_CODES.includes(item?.code) && isFiniteNumber(item.value)) codes.add(item.code);
    }
    if (codes.size === MARKET_FUND_PAGE_CODES.length) break;
  }
  return codes;
}

export async function loadMarketFundCodes(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') return new Set();
  try {
    if (!(await tableExists(db))) return new Set();
    const result = await db.prepare(`${SELECT_DAY} ORDER BY market_date DESC LIMIT 10`).all();
    return marketFundCodesIn((result?.results || []).map(marketFundsDayDto).filter(Boolean));
  } catch (error) {
    console.error('market fund codes unavailable', error);
    return new Set();
  }
}
