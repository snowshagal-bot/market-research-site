/**
 * The corporate half of the calendar sync.
 *
 * Filings are already in D1 by the time this runs; nothing re-crawls OpenDART's
 * list. What it does spend requests on is the filing documents themselves,
 * because the announced date exists nowhere else — and that spending is kept
 * small by narrowing hard before anything is fetched:
 *
 *   stored filings
 *     → companies with calendar tracking on   (a handful, not the market)
 *     → filing types that announce a date      (four kinds, not every filing)
 *     → not already read                       (a filing is opened once)
 *     → a per-run ceiling                      (a bad day cannot run away)
 *
 * Only then is a document requested, and every request is counted against the
 * same daily OpenDART budget the disclosure sync uses, so one number covers
 * everything this site asks of DART in a day.
 *
 * A candidate whose date cannot be read is recorded as read and skipped. It is
 * not retried tomorrow: the document does not change, and retrying it forever
 * would spend the budget on filings that will never yield a date.
 */

import {
  FILINGS_TABLE,
  disclosureConfig,
  ensureDisclosureSchema,
  getCalendarStockCodes,
  reserveRequest
} from './_shared.js';
import { buildCorporateEvent, selectCalendarCandidates } from './_calendar-extract.js';
import { REQUESTS_PER_DOCUMENT, fetchFilingDocument } from './_calendar-document.js';
import { EVENTS_TABLE, upsertEvent } from '../../_calendar-events.js';

/**
 * How many filings may be opened in one pass.
 *
 * Two requests each, so twenty filings is at most forty requests against a
 * daily budget in the thousands. The tracked companies file a handful of these
 * a day between them; the ceiling exists for the day something goes wrong, not
 * for the normal one.
 */
export const MAX_DOCUMENTS_PER_RUN = 20;

/** How far back to look for filings that have not been read yet. */
const LOOKBACK_DAYS = 7;

function compactDaysAgo(now, days) {
  const date = new Date(now.getTime() - days * 86400000);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Which filings this pass will open.
 *
 * The "already read" test is the events table itself: a filing that produced an
 * event owns `opendart:dart:<rceptNo>`, and one that did not is remembered in
 * the same place through `market_calendar_skipped`, so neither is opened twice.
 */
async function pendingCandidates(db, { calendarCodes, now }) {
  if (!calendarCodes.size) return [];
  const since = compactDaysAgo(now, LOOKBACK_DAYS);
  const placeholders = [...calendarCodes].map(() => '?').join(', ');

  const rows = await db.prepare(`SELECT rcept_no, corp_name, stock_code, report_nm, rcept_dt
    FROM ${FILINGS_TABLE}
    WHERE rcept_dt >= ? AND stock_code IN (${placeholders})
    ORDER BY rcept_dt DESC, rcept_no DESC
    LIMIT 200`).bind(since, ...calendarCodes).all();

  const candidates = selectCalendarCandidates(rows?.results || [], calendarCodes);
  if (!candidates.length) return [];

  const seen = await readAlready(db, candidates.map(candidate => candidate.rceptNo));
  return candidates.filter(candidate => !seen.has(candidate.rceptNo));
}

async function readAlready(db, receiptNumbers) {
  const seen = new Set();
  if (!receiptNumbers.length) return seen;
  const placeholders = receiptNumbers.map(() => '?').join(', ');

  const events = await db.prepare(`SELECT source_event_id FROM ${EVENTS_TABLE}
    WHERE source_type = 'opendart' AND source_event_id IN (${placeholders})`)
    .bind(...receiptNumbers.map(no => `dart:${no}`)).all();
  for (const row of events?.results || []) seen.add(String(row.source_event_id).replace(/^dart:/, ''));

  const skipped = await db.prepare(`SELECT rcept_no FROM market_calendar_skipped
    WHERE rcept_no IN (${placeholders})`).bind(...receiptNumbers).all();
  for (const row of skipped?.results || []) seen.add(row.rcept_no);

  return seen;
}

export async function ensureSkippedTable(db) {
  // A filing that carried no readable date is remembered so the budget is not
  // spent opening it again every day. The reason is kept for the operator.
  await db.prepare(`CREATE TABLE IF NOT EXISTS market_calendar_skipped (
    rcept_no TEXT PRIMARY KEY,
    stock_code TEXT NOT NULL DEFAULT '',
    report_nm TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    skipped_at TEXT NOT NULL
  )`).run();
}

async function rememberSkip(db, candidate, reason, now) {
  await db.prepare(`INSERT INTO market_calendar_skipped (rcept_no, stock_code, report_nm, reason, skipped_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(rcept_no) DO UPDATE SET reason = excluded.reason, skipped_at = excluded.skipped_at`)
    .bind(candidate.rceptNo, candidate.stockCode, candidate.reportName, reason, now.toISOString()).run();
}

/**
 * A correction that names the filing it corrects supersedes it.
 *
 * Without that stated receipt number nothing is merged — same company, same
 * filing type and a nearby date are every similarity a guess would use. With
 * it, the original is marked cancelled so the two do not both stand as live
 * dates, and the correction carries the schedule from here on.
 */
async function supersedeOriginal(db, correctedRceptNo, now) {
  const originalId = `opendart:dart:${correctedRceptNo}`;
  const existing = await db.prepare(`SELECT event_id, status FROM ${EVENTS_TABLE} WHERE event_id = ?`)
    .bind(originalId).first();
  if (!existing || existing.status === 'cancelled') return false;

  await db.prepare(`UPDATE ${EVENTS_TABLE} SET status = 'cancelled', updated_at = ? WHERE event_id = ?`)
    .bind(now.toISOString(), originalId).run();
  return true;
}

/**
 * Opens what is worth opening and writes what can be read.
 *
 * Returns counts rather than throwing: one unreadable filing is not a reason to
 * abandon the rest, and the run reports what it managed.
 */
export async function syncCorporateEvents(db, { env = {}, fetchImpl = fetch, now = new Date(), limit = MAX_DOCUMENTS_PER_RUN } = {}) {
  // This step reads the disclosure tables, so it says so rather than
  // assuming somebody else created them first.
  await ensureDisclosureSchema({ ...env, COMMENTS_DB: db });
  await ensureSkippedTable(db);
  const config = disclosureConfig(env);
  const usageDate = now.toISOString().slice(0, 10);

  const calendarCodes = await getCalendarStockCodes(db);
  const candidates = await pendingCandidates(db, { calendarCodes, now });

  const outcome = {
    sourceName: 'opendart-corporate',
    status: 'ok',
    companies: calendarCodes.size,
    candidates: candidates.length,
    opened: 0,
    events: 0,
    superseded: 0,
    skipped: 0,
    budgetExhausted: false,
    requests: 0
  };

  for (const candidate of candidates.slice(0, Math.max(0, limit))) {
    // Both requests are reserved before either is made, so a document is never
    // half-fetched on the last of the budget.
    let reserved = 0;
    for (let i = 0; i < REQUESTS_PER_DOCUMENT; i += 1) {
      const budget = await reserveRequest(db, usageDate, 'source:opendart', config.dartDailyBudget);
      if (!budget.allowed) break;
      reserved += 1;
    }
    if (reserved < REQUESTS_PER_DOCUMENT) {
      outcome.budgetExhausted = true;
      outcome.requests += reserved;
      break;
    }
    outcome.requests += reserved;

    let document;
    try {
      document = await fetchFilingDocument(candidate.rceptNo, { fetchImpl });
      outcome.opened += 1;
    } catch (error) {
      // A filing that could not be opened is left for tomorrow: unlike an
      // unreadable one, this may well be temporary.
      outcome.skipped += 1;
      continue;
    }

    const built = buildCorporateEvent(candidate, document, { now });
    if (!built.ok) {
      await rememberSkip(db, candidate, built.reason, now);
      outcome.skipped += 1;
      continue;
    }

    if (built.correctedRceptNo && await supersedeOriginal(db, built.correctedRceptNo, now)) {
      outcome.superseded += 1;
    }
    await upsertEvent(db, built.event, now);
    outcome.events += 1;
  }

  return outcome;
}

export const __test = { pendingCandidates, supersedeOriginal, compactDaysAgo };
