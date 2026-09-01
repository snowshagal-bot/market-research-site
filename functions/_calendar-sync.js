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
 */

import { monthlyExpiryEvents } from './_derivatives-expiry.js';
import {
  BEA_URL,
  BLS_SERIES,
  FOMC_URL,
  SOURCE_USER_AGENT,
  bokUrl,
  parseBeaSchedule,
  parseBlsSchedule,
  parseBokSchedule,
  fomcMonthlyUrl,
  parseFomcMonthlyTimes,
  parseFomcSchedule
} from './_calendar-sources.js';
import { cancelMissingEvents, recordSourceRun, upsertEvent } from './_calendar-events.js';
import { syncCorporateEvents } from './api/disclosures/_calendar-corporate.js';

/** How far ahead the calendar keeps events. Two years covers every source. */
export const SYNC_YEARS_AHEAD = 1;

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': SOURCE_USER_AGENT, accept: 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
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

async function failSource(db, { sourceName, sourceUrl, error }, now) {
  await recordSourceRun(db, { sourceName, sourceUrl, status: 'error', error: String(error?.message || error) }, now);
  return { sourceName, status: 'error', error: String(error?.message || error) };
}

const yearSpan = year => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/* ------------------------------------------------------------- official */

export async function syncFomc(db, { years, fetchImpl, now }) {
  try {
    const html = await fetchText(FOMC_URL, fetchImpl);
    const events = [];
    for (const year of years) events.push(...parseFomcSchedule(html, { year }));

    // The schedule page lists dates only. Each month has its own static page
    // where the same meeting appears with its hour, so the time is confirmed
    // there — one page per month that actually holds a meeting.
    const confirmed = await enrichFomcTimes(events, fetchImpl);
    const unconfirmed = events.filter(event => !event.eventTime).length;

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
    return failSource(db, { sourceName: 'federal-reserve', sourceUrl: FOMC_URL, error }, now);
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
  try {
    const html = await fetchText(spec.url, fetchImpl);
    const events = parseBlsSchedule(html, { series });
    // The page lists a rolling window rather than a calendar year, so the
    // sweep is confined to the span the page itself covered.
    const dates = events.map(event => event.eventDate).sort();
    return await commitSource(db, {
      sourceName, sourceUrl: spec.url, events,
      window: { from: dates[0], to: dates[dates.length - 1] }
    }, now);
  } catch (error) {
    return failSource(db, { sourceName, sourceUrl: spec.url, error }, now);
  }
}

export async function syncBea(db, { years, fetchImpl, now }) {
  try {
    const html = await fetchText(BEA_URL, fetchImpl);
    const events = parseBeaSchedule(html);
    const dates = events.map(event => event.eventDate).sort();
    return await commitSource(db, {
      sourceName: 'bea', sourceUrl: BEA_URL, events,
      window: { from: dates[0], to: dates[dates.length - 1] }
    }, now);
  } catch (error) {
    return failSource(db, { sourceName: 'bea', sourceUrl: BEA_URL, error }, now);
  }
}

/**
 * The Bank of Korea publishes one year per page, and announces next year's
 * dates late in the current one. An empty future year is `pending`; an empty
 * current or past year means the page stopped answering and is an error.
 */
export async function syncBok(db, { year, currentYear, fetchImpl, now }) {
  const url = bokUrl(year);
  try {
    const html = await fetchText(url, fetchImpl);
    const events = parseBokSchedule(html, { year });

    if (!events.length) {
      if (year > currentYear) {
        await recordSourceRun(db, { sourceName: `bank-of-korea-${year}`, sourceUrl: url, status: 'pending', eventCount: 0 }, now);
        return { sourceName: `bank-of-korea-${year}`, status: 'pending', events: 0 };
      }
      throw new Error(`no meetings listed for ${year}, which should be published`);
    }

    return await commitSource(db, {
      sourceName: `bank-of-korea-${year}`, sourceUrl: url, events, window: yearSpan(year)
    }, now);
  } catch (error) {
    return failSource(db, { sourceName: `bank-of-korea-${year}`, sourceUrl: url, error }, now);
  }
}

/* ----------------------------------------------------------------- rules */

/** Computed, so it cannot fail on the network — only on an unknown year. */
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
    results.push(await commitSource(db, {
      sourceName,
      sourceUrl: ruleEvents[0].sourceUrl,
      events: ruleEvents,
      window: { from: `${years[0]}-01-01`, to: `${years[years.length - 1]}-12-31` }
    }, now));
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

export async function runCalendarSync(db, { env = {}, fetchImpl = fetch, now = new Date() } = {}) {
  const years = syncYears(now);
  const currentYear = years[0];
  const results = [];

  results.push(await syncFomc(db, { years, fetchImpl, now }));
  for (const series of Object.keys(BLS_SERIES)) results.push(await syncBls(db, { series, fetchImpl, now }));
  results.push(await syncBea(db, { years, fetchImpl, now }));
  for (const year of years) results.push(await syncBok(db, { year, currentYear, fetchImpl, now }));
  results.push(...await syncExpiries(db, { years, now }));

  // Company dates come last: they read filings the disclosure sync has already
  // stored, and they are the only part that spends the OpenDART budget.
  try {
    results.push(await syncCorporateEvents(db, { env, fetchImpl, now }));
  } catch (error) {
    await recordSourceRun(db, { sourceName: 'opendart-corporate', status: 'error', error: String(error?.message || error) }, now);
    results.push({ sourceName: 'opendart-corporate', status: 'error', error: String(error?.message || error) });
  }

  const failed = results.filter(result => result.status === 'error');
  return {
    ok: failed.length === 0,
    years,
    results,
    failed: failed.map(result => result.sourceName)
  };
}
