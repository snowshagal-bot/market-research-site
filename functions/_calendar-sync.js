/**
 * One pass over every calendar source.
 *
 * The official schedules are fetched and parsed; the two option expiries are
 * computed. Each source is handled on its own so one failing page cannot stop
 * the rest, and every source records how it went — including the difference
 * between "this year is not published yet" and "the page that should have
 * answered did not". A source that fails leaves its stored events untouched:
 * the sweep that marks missing events cancelled runs only after a fetch that
 * actually succeeded and covered the window it is sweeping.
 *
 * Every failure names its source, the stage it stopped at, and the HTTP status
 * when there was one. An operator reading the alert should never have to guess
 * which source broke.
 */

import { monthlyExpiryEvents } from './_derivatives-expiry.js';
import {
  BEA_URL,
  BLS_SERIES,
  FOMC_URL,
  SOURCE_USER_AGENT,
  SourceParseError,
  bokUrl,
  parseBeaSchedule,
  parseBlsSchedule,
  parseBokSchedule,
  fomcMonthlyUrl,
  parseFomcMonthlyTimes,
  parseFomcSchedule
} from './_calendar-sources.js';
import { CalendarEventError, cancelMissingEvents, recordSourceRun, upsertEvent } from './_calendar-events.js';
import { syncCorporateEvents } from './api/disclosures/_calendar-corporate.js';

/** How far ahead the calendar keeps events. Two years covers every source. */
export const SYNC_YEARS_AHEAD = 1;

/** Where a source's pass stopped. `orchestration` is a fault outside any one step. */
export const FAILURE_STAGES = Object.freeze(['fetch', 'parse', 'normalize', 'validate', 'publish', 'orchestration']);

/** The source name used when a failure cannot be tied to a source. */
export const INTERNAL_SOURCE = 'internal';

export class SourceFetchError extends Error {
  constructor(message, httpStatus = null) {
    super(message);
    this.name = 'SourceFetchError';
    this.stage = 'fetch';
    this.httpStatus = httpStatus;
  }
}

async function fetchText(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'user-agent': SOURCE_USER_AGENT, accept: 'text/html,application/xhtml+xml' }
    });
  } catch (error) {
    throw new SourceFetchError(`network failure: ${shortError(error)}`);
  }
  if (!response.ok) throw new SourceFetchError(`HTTP ${response.status}`, response.status);
  try {
    return await response.text();
  } catch (error) {
    throw new SourceFetchError(`body could not be read: ${shortError(error)}`, response.status);
  }
}

function shortError(error) {
  return String(error?.message || error || 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 300) || 'unknown error';
}

const WINDOW_ERROR_CODES = new Set(['BAD_WINDOW', 'BAD_SEEN_SET', 'BAD_SOURCE']);

/** The stage an error belongs to: its own if it carries one, else what it is, else where it was thrown. */
export function failureStage(error, fallback = 'orchestration') {
  if (FAILURE_STAGES.includes(error?.stage)) return error.stage;
  if (error instanceof SourceParseError) return 'parse';
  if (error instanceof CalendarEventError) return WINDOW_ERROR_CODES.has(error.code) ? 'validate' : 'normalize';
  return FAILURE_STAGES.includes(fallback) ? fallback : 'orchestration';
}

/**
 * Writes one source's events and cancels the ones it no longer lists.
 *
 * `window` is the span the source was asked about. Cancellation is confined to
 * it, so a source that answers for one year cannot withdraw another year's
 * events.
 */
async function commitSource(db, { sourceName, sourceUrl, events, window: span, note = '' }, now) {
  const seen = new Set();
  let created = 0;
  let changed = 0;
  for (const event of events) {
    const result = await upsertEvent(db, event, now);
    seen.add(result.eventId);
    if (result.action === 'created') created += 1;
    if (result.action === 'changed') changed += 1;
  }
  const { cancelled } = span
    ? await cancelMissingEvents(db, { sourceName, fromDate: span.from, toDate: span.to, seenEventIds: seen }, now)
    : { cancelled: 0 };

  await recordSourceRun(db, { sourceName, sourceUrl, status: 'ok', eventCount: events.length, note }, now);
  return { sourceName, status: 'ok', events: events.length, created, changed, cancelled };
}

/**
 * The failure result for one source. Recording it can itself fail (the same
 * database that just broke), and that must not turn a named failure into an
 * anonymous crash.
 */
async function failSource(db, { sourceName, sourceUrl = '', error, stage }, now) {
  const failure = {
    sourceName: sourceName || INTERNAL_SOURCE,
    status: 'error',
    stage: failureStage(error, stage),
    error: shortError(error),
    httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
    attempt: 1
  };
  try {
    await recordSourceRun(db, { sourceName: failure.sourceName, sourceUrl, status: 'error', error: failure.error }, now);
  } catch (recordError) {
    failure.recordError = shortError(recordError);
  }
  return failure;
}

const yearSpan = year => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/* ------------------------------------------------------------- official */

export async function syncFomc(db, { years, fetchImpl, now }) {
  let stage = 'fetch';
  try {
    const html = await fetchText(FOMC_URL, fetchImpl);
    stage = 'parse';
    const events = [];
    for (const year of years) events.push(...parseFomcSchedule(html, { year }));

    // The schedule page lists dates only. Each month has its own static page
    // where the same meeting appears with its hour, so the time is confirmed
    // there — one page per month that actually holds a meeting.
    const confirmed = await enrichFomcTimes(events, fetchImpl);
    const unconfirmed = events.filter(event => !event.eventTime).length;

    stage = 'publish';
    const result = await commitSource(db, {
      sourceName: 'federal-reserve',
      sourceUrl: FOMC_URL,
      events,
      window: { from: `${years[0]}-01-01`, to: `${years[years.length - 1]}-12-31` },
      note: unconfirmed ? `decision time unconfirmed for ${unconfirmed} of ${events.length} meetings` : ''
    }, now);
    return {
      ...result,
      enrichment: unconfirmed === 0 ? 'confirmed' : (confirmed ? 'partial' : 'unconfirmed'),
      timesConfirmed: confirmed,
      timesUnconfirmed: unconfirmed
    };
  } catch (error) {
    return failSource(db, { sourceName: 'federal-reserve', sourceUrl: FOMC_URL, error, stage }, now);
  }
}

/**
 * Fills in each meeting's hour from the Fed's monthly page for that month.
 *
 * A month whose page is not published yet answers 404, and a month that does
 * not name the hour answers with nothing. Neither is a failure: the meeting
 * keeps its date and stays on the calendar without a time. Only a row titled
 * exactly "FOMC Meeting" is read, so the press conference half an hour later
 * is never mistaken for the decision.
 */
async function enrichFomcTimes(events, fetchImpl) {
  const months = new Map();
  let confirmed = 0;

  for (const event of events) {
    const [year, month] = event.eventDate.split('-').map(Number);
    const key = `${year}-${month}`;
    if (!months.has(key)) {
      months.set(key, await readMonthlyTimes(year, month, fetchImpl));
    }
    const time = months.get(key).get(event.eventDate);
    if (!time) continue;
    event.eventTime = time;
    // The stored value stays in the Fed's own zone; the calendar converts it.
    event.timezone = 'America/New_York';
    event.meta = { ...(event.meta || {}), decisionTimeSource: fomcMonthlyUrl(year, month) };
    confirmed += 1;
  }
  return confirmed;
}

async function readMonthlyTimes(year, month, fetchImpl) {
  try {
    const html = await fetchText(fomcMonthlyUrl(year, month), fetchImpl);
    return parseFomcMonthlyTimes(html, { year, month });
  } catch (_) {
    // Next year's pages do not exist yet. That is expected, not broken.
    return new Map();
  }
}

export async function syncBls(db, { series, fetchImpl, now }) {
  const spec = BLS_SERIES[series];
  const sourceName = `bls-${spec.slug}`;
  let stage = 'fetch';
  try {
    const html = await fetchText(spec.url, fetchImpl);
    stage = 'parse';
    const events = parseBlsSchedule(html, { series });
    // The page lists a rolling window rather than a calendar year, so the
    // sweep is confined to the span the page itself covered.
    const dates = events.map(event => event.eventDate).sort();
    stage = 'publish';
    return await commitSource(db, {
      sourceName, sourceUrl: spec.url, events,
      window: { from: dates[0], to: dates[dates.length - 1] }
    }, now);
  } catch (error) {
    return failSource(db, { sourceName, sourceUrl: spec.url, error, stage }, now);
  }
}

export async function syncBea(db, { years, fetchImpl, now }) {
  let stage = 'fetch';
  try {
    const html = await fetchText(BEA_URL, fetchImpl);
    stage = 'parse';
    const events = parseBeaSchedule(html);
    const dates = events.map(event => event.eventDate).sort();
    stage = 'publish';
    return await commitSource(db, {
      sourceName: 'bea', sourceUrl: BEA_URL, events,
      window: { from: dates[0], to: dates[dates.length - 1] }
    }, now);
  } catch (error) {
    return failSource(db, { sourceName: 'bea', sourceUrl: BEA_URL, error, stage }, now);
  }
}

/**
 * The Bank of Korea publishes one year per page, and announces next year's
 * dates late in the current one. An empty future year is `pending`; an empty
 * current or past year means the page stopped answering and is an error.
 */
export async function syncBok(db, { year, currentYear, fetchImpl, now }) {
  const url = bokUrl(year);
  let stage = 'fetch';
  try {
    const html = await fetchText(url, fetchImpl);
    stage = 'parse';
    const events = parseBokSchedule(html, { year });

    if (!events.length) {
      if (year > currentYear) {
        stage = 'publish';
        await recordSourceRun(db, { sourceName: `bank-of-korea-${year}`, sourceUrl: url, status: 'pending', eventCount: 0 }, now);
        return { sourceName: `bank-of-korea-${year}`, status: 'pending', events: 0 };
      }
      stage = 'validate';
      throw new Error(`no meetings listed for ${year}, which should be published`);
    }

    stage = 'publish';
    return await commitSource(db, {
      sourceName: `bank-of-korea-${year}`, sourceUrl: url, events, window: yearSpan(year)
    }, now);
  } catch (error) {
    return failSource(db, { sourceName: `bank-of-korea-${year}`, sourceUrl: url, error, stage }, now);
  }
}

/* ----------------------------------------------------------------- rules */

/** Computed, so it cannot fail on the network — only on an unknown year or the store. */
export async function syncExpiries(db, { years, now }) {
  const events = [];
  for (const year of years) {
    for (let month = 1; month <= 12; month += 1) events.push(...monthlyExpiryEvents(year, month));
  }
  const byRule = new Map();
  for (const event of events) {
    if (!byRule.has(event.sourceName)) byRule.set(event.sourceName, []);
    byRule.get(event.sourceName).push(event);
  }

  const results = [];
  for (const [sourceName, ruleEvents] of byRule) {
    try {
      results.push(await commitSource(db, {
        sourceName,
        sourceUrl: ruleEvents[0].sourceUrl,
        events: ruleEvents,
        window: { from: `${years[0]}-01-01`, to: `${years[years.length - 1]}-12-31` }
      }, now));
    } catch (error) {
      results.push(await failSource(db, { sourceName, sourceUrl: ruleEvents[0].sourceUrl, error, stage: 'publish' }, now));
    }
  }
  // A year whose holidays are not checked in produces nothing, and that is
  // deliberate rather than a failure: see _derivatives-expiry.js.
  return results;
}

/* ------------------------------------------------------------ the pass */

export function syncYears(now = new Date()) {
  const current = Number(now.toISOString().slice(0, 4));
  return Array.from({ length: SYNC_YEARS_AHEAD + 1 }, (_, offset) => current + offset);
}

/** One failure per errored result, always with a source and a known stage. */
export function failuresOf(results) {
  return results
    .filter(result => result?.status === 'error')
    .map(result => ({
      source: String(result.sourceName || INTERNAL_SOURCE),
      stage: FAILURE_STAGES.includes(result.stage) ? result.stage : 'orchestration',
      error: shortError(result.error),
      httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null,
      attempt: Number.isInteger(result.attempt) && result.attempt > 0 ? result.attempt : 1
    }));
}

/** The outcome for a pass that could not run at all. It still names what failed. */
export function orchestrationFailure(error) {
  const failures = [{ source: INTERNAL_SOURCE, stage: 'orchestration', error: shortError(error), httpStatus: null, attempt: 1 }];
  return { ok: false, years: [], results: [], failed: [INTERNAL_SOURCE], failures };
}

export async function runCalendarSync(db, { env = {}, fetchImpl = fetch, now = new Date() } = {}) {
  const years = syncYears(now);
  const currentYear = years[0];
  const results = [];

  // Each step is caught on its own. An exception that escapes a source still
  // names the step it came from instead of taking the whole pass down.
  const step = async (sourceName, action) => {
    try {
      const value = await action();
      results.push(...(Array.isArray(value) ? value : [value]));
    } catch (error) {
      results.push(await failSource(db, { sourceName, error, stage: 'orchestration' }, now));
    }
  };

  await step('federal-reserve', () => syncFomc(db, { years, fetchImpl, now }));
  for (const series of Object.keys(BLS_SERIES)) {
    await step(`bls-${BLS_SERIES[series].slug}`, () => syncBls(db, { series, fetchImpl, now }));
  }
  await step('bea', () => syncBea(db, { years, fetchImpl, now }));
  for (const year of years) {
    await step(`bank-of-korea-${year}`, () => syncBok(db, { year, currentYear, fetchImpl, now }));
  }
  await step('derivatives-expiry', () => syncExpiries(db, { years, now }));

  // Company dates come last: they read filings the disclosure sync has already
  // stored, and they are the only part that spends the OpenDART budget.
  await step('opendart-corporate', () => syncCorporateEvents(db, { env, fetchImpl, now }));

  const failures = failuresOf(results);
  return {
    ok: failures.length === 0,
    years,
    results,
    failed: failures.map(failure => failure.source),
    failures
  };
}
