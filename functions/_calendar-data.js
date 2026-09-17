import {
  getMonthlyTradingCalendar,
  getUpcomingTradingEvents,
  kstParts
} from './_trading-calendar.js';
import { DISPLAY_TIMEZONE } from './_calendar-time.js';
import { ensureCalendarEventSchema, getEventsForDisplayMonth } from './_calendar-events.js';

/**
 * One month of the market calendar, as one server-side computation.
 *
 * `/api/calendar` and the server-rendered `/calendar/` page both call this, so
 * the JSON and the initial HTML carry the same days, the same upcoming list and
 * the same events, measured against the same Seoul clock.
 */

/** The current Seoul year and month, from functions/_trading-calendar.js. */
export function currentKstYearMonth(now = new Date()) {
  const current = kstParts(now);
  const [year, month] = current.date.split('-').map(Number);
  return { year, month, date: current.date };
}

/**
 * Market events for the month, and whether they could be read at all.
 *
 * The exchange calendar is checked in and needs no database, so a D1 outage
 * costs the reader the events and not the whole page. It also has to be
 * distinguishable from a quiet month: an empty list with 'ok' means nothing
 * is scheduled, and an empty list with 'unavailable' means the page could not
 * find out. The reason itself stays here — no error text, no source metadata.
 */
async function monthEvents(env, year, month) {
  if (!env?.COMMENTS_DB) return { events: [], available: false };
  try {
    const db = await ensureCalendarEventSchema(env);
    return { events: await getEventsForDisplayMonth(db, year, month), available: true };
  } catch (error) {
    console.error('calendar events unavailable', error);
    return { events: [], available: false };
  }
}

/**
 * Returns the calendar body (`ok: true` shape) for a validated year and month.
 * Never throws for an event-store failure; that is reported as
 * `eventsStatus: 'unavailable'` beside an intact exchange calendar.
 */
export async function loadCalendarMonth(env, { year, month, now = new Date() }) {
  const currentKst = kstParts(now);
  const calendarData = getMonthlyTradingCalendar(year, month);

  if (!calendarData.supported) {
    const deferred = await monthEvents(env, year, month);
    return {
      ok: true,
      supported: false,
      year,
      month,
      serverDate: currentKst.date,
      marketSupport: { krx: false, nyse: false },
      message: calendarData.message || `${year} calendar deferred — official schedule incomplete`,
      days: [],
      upcoming: [],
      // Events are stored per date and do not depend on a market's holiday
      // table, so a year without one can still carry them.
      eventsTimezone: DISPLAY_TIMEZONE,
      eventsStatus: deferred.available ? 'ok' : 'unavailable',
      events: deferred.events
    };
  }

  const upcoming = getUpcomingTradingEvents(currentKst.date, 12);
  const { events, available } = await monthEvents(env, year, month);

  return {
    ok: true,
    supported: true,
    year,
    month,
    serverDate: currentKst.date,
    marketSupport: calendarData.marketSupport,
    krxPendingMessage: calendarData.krxPendingMessage || null,
    days: calendarData.days,
    upcoming,
    // Events belong to the month a Seoul reader sees them in, which is not
    // always the month their source published them in. Each carries both
    // its source values and the converted ones.
    eventsTimezone: DISPLAY_TIMEZONE,
    eventsStatus: available ? 'ok' : 'unavailable',
    events
  };
}
