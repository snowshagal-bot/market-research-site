/**
 * Global Latest: the current observation of global indicators, published by
 * the collector independently of the KRX calendar. It is not Market Close
 * (the KRX trading-session historical snapshot in market_close_snapshots) and
 * shares nothing with it but the publish credentials and host policy.
 *
 * Contract: contracts/global_latest/ (schema_version 1.0.0). This module holds
 * the only list of instruments; the JSON Schema's enum is checked against it
 * in tests.
 */
import { fingerprint, json } from '../_shared.js';
import { isTradingDate } from '../../../_trading-calendar.js';

export const GLOBAL_LATEST_TABLE = 'market_global_latest';
export const GLOBAL_LATEST_SCHEMA_VERSION = '1.0.0';
export const GLOBAL_LATEST_MAX_BYTES = 64 * 1024;
// When the GET body was read (ISO); the page's freshness clock never runs behind it.
export const GLOBAL_LATEST_SERVED_AT_HEADER = 'x-global-latest-served-at';
// Collector and server clocks may disagree a little; nothing may be dated
// further ahead than this.
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

// Canonical order. `nyseFinalClose`: a completed close must fall on an NYSE
// trading date (functions/_trading-calendar.js).
export const GLOBAL_INSTRUMENTS = Object.freeze([
  { code: 'NASDAQ', nyseFinalClose: true },
  { code: 'DOW', nyseFinalClose: true },
  { code: 'SP500', nyseFinalClose: true },
  { code: 'SOX', nyseFinalClose: true },
  { code: 'VIX', nyseFinalClose: true },
  { code: 'US10Y', nyseFinalClose: true },
  { code: 'USDKRW', nyseFinalClose: false },
  { code: 'JPYKRW', nyseFinalClose: false },
  { code: 'DXY', nyseFinalClose: false },
  { code: 'WTI', nyseFinalClose: false },
  { code: 'GOLD', nyseFinalClose: false },
  { code: 'BITCOIN', nyseFinalClose: false }
].map(item => Object.freeze(item)));
export const GLOBAL_CODES = Object.freeze(GLOBAL_INSTRUMENTS.map(item => item.code));
const INSTRUMENT_BY_CODE = new Map(GLOBAL_INSTRUMENTS.map(item => [item.code, item]));

export const DATA_STATES = Object.freeze(['intraday', 'final_close']);
const DOCUMENT_KEYS = ['schema_version', 'generated_at', 'items'];
const ITEM_KEYS = ['code', 'ticker', 'value', 'previous_close', 'change', 'change_pct', 'source_date', 'as_of', 'retrieved_at', 'data_state', 'source'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export class GlobalLatestError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function globalErrorResponse(error) {
  if (error instanceof GlobalLatestError) return json({ error: error.code, message: error.message }, error.status);
  console.error('global latest request failed', error);
  return json({ error: 'GLOBAL_LATEST_FAILED', message: 'Global Latest 요청을 처리하지 못했습니다.' }, 500);
}

/* ------------------------------------------------------------ validation */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Epoch milliseconds of a strict ISO date-time with an explicit offset, or null. */
export function parseDateTime(value) {
  if (typeof value !== 'string' || !ISO_DATE_TIME.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nonEmptyString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/*
 * The change must be the collector's own arithmetic on value and
 * previous_close. Rounding of any of the three is allowed; a figure that
 * could not have come from them (wrong sign, wrong magnitude) is not.
 */
function changeContradicts(value, previousClose, change) {
  const expected = value - previousClose;
  const tolerance = 0.006 + Math.abs(value) * 1e-4;
  return Math.abs(change - expected) > tolerance;
}

function changePctContradicts(value, previousClose, changePct) {
  const expected = (value / previousClose - 1) * 100;
  const tolerance = 0.01 + Math.abs(expected) * 0.005;
  return Math.abs(changePct - expected) > tolerance;
}

function validateItem(item, index, now, errors) {
  const at = `$.items[${index}]`;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push(`${at}: must be an object.`);
    return null;
  }
  for (const key of Object.keys(item)) if (!ITEM_KEYS.includes(key)) errors.push(`${at}.${key}: unknown field.`);
  for (const key of ITEM_KEYS) if (!(key in item)) errors.push(`${at}.${key}: required.`);

  const instrument = INSTRUMENT_BY_CODE.get(item.code);
  if (!instrument) errors.push(`${at}.code: ${JSON.stringify(item.code)} is not a Global Latest instrument.`);
  if (!nonEmptyString(item.ticker, 32)) errors.push(`${at}.ticker: non-empty string required.`);
  if (!nonEmptyString(item.source, 64)) errors.push(`${at}.source: non-empty string required.`);
  if (!DATA_STATES.includes(item.data_state)) errors.push(`${at}.data_state: must be one of ${DATA_STATES.join(', ')}.`);

  if (!isFiniteNumber(item.value)) errors.push(`${at}.value: finite number required.`);
  for (const key of ['previous_close', 'change', 'change_pct']) {
    if (item[key] !== null && !isFiniteNumber(item[key])) errors.push(`${at}.${key}: finite number or null required.`);
  }
  if (isFiniteNumber(item.previous_close) && item.previous_close <= 0) errors.push(`${at}.previous_close: must be positive.`);
  const hasPrevious = item.previous_close !== null && item.previous_close !== undefined;
  if (!hasPrevious && (item.change !== null || item.change_pct !== null)) {
    errors.push(`${at}: change and change_pct must be null when previous_close is null.`);
  }
  if (hasPrevious && (item.change === null || item.change_pct === null)) {
    errors.push(`${at}: change and change_pct are required when previous_close is present.`);
  }
  if ([item.value, item.previous_close, item.change, item.change_pct].every(isFiniteNumber) && item.previous_close > 0) {
    if (changeContradicts(item.value, item.previous_close, item.change)) {
      errors.push(`${at}.change: ${item.change} contradicts value − previous_close (${item.value - item.previous_close}).`);
    }
    if (changePctContradicts(item.value, item.previous_close, item.change_pct)) {
      errors.push(`${at}.change_pct: ${item.change_pct} contradicts (value / previous_close − 1) × 100.`);
    }
  }

  const asOf = parseDateTime(item.as_of);
  const retrievedAt = parseDateTime(item.retrieved_at);
  if (asOf === null) errors.push(`${at}.as_of: ISO date-time with offset required.`);
  if (retrievedAt === null) errors.push(`${at}.retrieved_at: ISO date-time with offset required.`);
  if (asOf !== null && asOf > now + FUTURE_SKEW_MS) errors.push(`${at}.as_of: in the future.`);
  if (retrievedAt !== null && retrievedAt > now + FUTURE_SKEW_MS) errors.push(`${at}.retrieved_at: in the future.`);
  if (asOf !== null && retrievedAt !== null && asOf > retrievedAt) errors.push(`${at}.as_of: later than retrieved_at.`);

  if (!validDate(item.source_date)) {
    errors.push(`${at}.source_date: YYYY-MM-DD required.`);
  } else {
    // The session date may be ahead of UTC by the exchange's offset, never more.
    const latestPossible = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (item.source_date > latestPossible) errors.push(`${at}.source_date: in the future.`);
    if (instrument?.nyseFinalClose && item.data_state === 'final_close') {
      try {
        if (!isTradingDate(item.source_date, 'NYSE')) errors.push(`${at}.source_date: ${item.source_date} is not an NYSE trading date.`);
      } catch (_) {
        errors.push(`${at}.source_date: the NYSE calendar does not cover ${item.source_date.slice(0, 4)}.`);
      }
    }
  }
  return { asOf, retrievedAt };
}

/**
 * The whole document or nothing: any contract error rejects the request
 * before storage is touched. Returns { passed, errors, items } where items
 * carry normalised UTC timestamps for ordering.
 */
export function validateGlobalLatestDocument(document, now = Date.now()) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { passed: false, errors: ['$: must be an object.'], items: [] };
  }
  for (const key of Object.keys(document)) if (!DOCUMENT_KEYS.includes(key)) errors.push(`$.${key}: unknown field.`);
  if (document.schema_version !== GLOBAL_LATEST_SCHEMA_VERSION) {
    errors.push(`$.schema_version: must be ${GLOBAL_LATEST_SCHEMA_VERSION}.`);
  }
  const generatedAt = parseDateTime(document.generated_at);
  if (generatedAt === null) errors.push('$.generated_at: ISO date-time with offset required.');
  else if (generatedAt > now + FUTURE_SKEW_MS) errors.push('$.generated_at: in the future.');

  const items = Array.isArray(document.items) ? document.items : null;
  if (!items) errors.push('$.items: array required.');
  else if (items.length < 1 || items.length > GLOBAL_CODES.length) errors.push(`$.items: 1 to ${GLOBAL_CODES.length} items required.`);

  const accepted = [];
  const seen = new Set();
  for (const [index, item] of (items || []).entries()) {
    const times = validateItem(item, index, now, errors);
    if (item && typeof item === 'object' && typeof item.code === 'string') {
      if (seen.has(item.code)) errors.push(`$.items[${index}].code: ${item.code} appears more than once.`);
      seen.add(item.code);
    }
    if (times) accepted.push({ item, asOf: times.asOf, retrievedAt: times.retrievedAt });
  }
  if (errors.length) return { passed: false, errors: errors.slice(0, 100), items: [] };
  return {
    passed: true,
    errors: [],
    items: accepted.map(({ item, asOf, retrievedAt }) => ({
      item: Object.fromEntries(ITEM_KEYS.map(key => [key, item[key]])),
      asOf: new Date(asOf).toISOString(),
      retrievedAt: new Date(retrievedAt).toISOString()
    }))
  };
}

/* ------------------------------------------------------------ storage */

/**
 * The table is created by migrations/comments/0002_market_global_latest.sql,
 * never by a request. A database without it answers 503 instead of silently
 * creating one.
 */
export async function requireGlobalLatestDb(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') {
    throw new GlobalLatestError('DB_NOT_CONFIGURED', 'Global Latest 데이터베이스가 연결되지 않았습니다.', 503);
  }
  let table;
  try {
    table = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).bind(GLOBAL_LATEST_TABLE).first();
  } catch (_) {
    throw new GlobalLatestError('GLOBAL_LATEST_SCHEMA_NOT_READY', 'Global Latest 스키마를 확인할 수 없습니다.', 503);
  }
  if (!table) {
    throw new GlobalLatestError('GLOBAL_LATEST_SCHEMA_NOT_READY', 'Global Latest migration이 적용되지 않았습니다.', 503);
  }
  return db;
}

function samePayload(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * What to do with each accepted item against the stored row. The stored
 * observation time never moves backwards: an older as_of, or the same as_of
 * retrieved earlier, is skipped; the identical observation is unchanged.
 */
export function planGlobalLatestWrites(accepted, storedRows) {
  const stored = new Map(storedRows.map(row => [row.code, row]));
  const plan = { write: [], created: [], updated: [], unchanged: [], skipped_older: [], skipped_conflict: [] };
  for (const entry of accepted) {
    const { code } = entry.item;
    const row = stored.get(code);
    if (!row) {
      plan.write.push(entry);
      plan.created.push(code);
      continue;
    }
    if (entry.asOf < row.as_of) {
      plan.skipped_older.push(code);
    } else if (entry.asOf > row.as_of) {
      plan.write.push(entry);
      plan.updated.push(code);
    } else if (entry.retrievedAt < row.retrieved_at) {
      plan.skipped_older.push(code);
    } else if (entry.retrievedAt > row.retrieved_at) {
      plan.write.push(entry);
      plan.updated.push(code);
    } else if (samePayload(entry.item, JSON.parse(row.payload_json))) {
      plan.unchanged.push(code);
    } else {
      // Same observation, same retrieval, different figures: the stored row
      // stays; nothing distinguishes which one is right.
      plan.skipped_conflict.push(code);
    }
  }
  return plan;
}

/**
 * One statement per written row. The WHERE clause repeats the ordering rule,
 * so a publish racing another cannot move a row backwards between the read
 * and the write (ISO UTC strings order as the instants they name).
 */
export function upsertStatement(db, entry, publishedAt, authSource) {
  const { item } = entry;
  return db.prepare(`INSERT INTO ${GLOBAL_LATEST_TABLE}
      (code, schema_version, source_date, as_of, retrieved_at, data_state, payload_json, published_at, auth_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      schema_version = excluded.schema_version,
      source_date = excluded.source_date,
      as_of = excluded.as_of,
      retrieved_at = excluded.retrieved_at,
      data_state = excluded.data_state,
      payload_json = excluded.payload_json,
      published_at = excluded.published_at,
      auth_source = excluded.auth_source
    WHERE excluded.as_of > ${GLOBAL_LATEST_TABLE}.as_of
       OR (excluded.as_of = ${GLOBAL_LATEST_TABLE}.as_of AND excluded.retrieved_at > ${GLOBAL_LATEST_TABLE}.retrieved_at)`)
    .bind(item.code, GLOBAL_LATEST_SCHEMA_VERSION, item.source_date, entry.asOf, entry.retrievedAt, item.data_state, JSON.stringify(item), publishedAt, authSource);
}

/* ------------------------------------------------------------ read */

const ORDER = new Map(GLOBAL_CODES.map((code, index) => [code, index]));

/** Public item: the published fields and when the site stored them. Never auth_source. */
export function globalLatestDto(row) {
  let payload;
  try { payload = JSON.parse(row.payload_json); } catch (_) { return null; }
  const item = Object.fromEntries(ITEM_KEYS.map(key => [key, payload[key] ?? null]));
  return { ...item, published_at: row.published_at };
}

export function orderRows(rows) {
  return rows
    .filter(row => ORDER.has(row.code))
    .sort((left, right) => ORDER.get(left.code) - ORDER.get(right.code));
}

export function globalLatestEtag(rows) {
  const stamp = rows.map(row => `${row.code}|${row.as_of}|${row.retrieved_at}|${row.published_at}`).join(';');
  return `W/"global-${rows.length}-${fingerprint(stamp)}"`;
}
