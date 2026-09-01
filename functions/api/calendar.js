import {
  getMonthlyTradingCalendar,
  getUpcomingTradingEvents,
  kstParts
} from '../_trading-calendar.js';
import { DISPLAY_TIMEZONE } from '../_calendar-time.js';
import { ensureCalendarEventSchema, getEventsForDisplayMonth } from '../_calendar-events.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}

/**
 * Market events for the month, or an empty list when the database is not
 * reachable. The exchange calendar is checked in and needs no database, so a
 * D1 outage must cost the reader the events and not the whole page.
 *
 * Operational detail — which source last failed, what a parser could not
 * confirm — belongs to the admin surface and never travels here.
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

export async function onRequestGet({ request, env, now = new Date() }) {
  const url = new URL(request.url);
  const currentKst = kstParts(now);
  const [currentYearStr, currentMonthStr] = currentKst.date.split('-');
  const defaultYear = Number(currentYearStr);
  const defaultMonth = Number(currentMonthStr);

  const queryYear = url.searchParams.has('year') ? Number(url.searchParams.get('year')) : defaultYear;
  const queryMonth = url.searchParams.has('month') ? Number(url.searchParams.get('month')) : defaultMonth;

  if (!Number.isInteger(queryYear) || !Number.isInteger(queryMonth) || queryMonth < 1 || queryMonth > 12) {
    return json({
      ok: false,
      error: 'INVALID_QUERY',
      message: 'year 및 month 파라미터가 유효하지 않습니다.'
    }, 400);
  }

  const calendarData = getMonthlyTradingCalendar(queryYear, queryMonth);

  if (!calendarData.supported) {
    return json({
      ok: true,
      supported: false,
      year: queryYear,
      month: queryMonth,
      serverDate: currentKst.date,
      marketSupport: { krx: false, nyse: false },
      message: calendarData.message || `${queryYear} calendar deferred — official schedule incomplete`,
      days: [],
      upcoming: [],
      // Events are stored per date and do not depend on a market's holiday
      // table, so a year without one can still carry them.
      eventsTimezone: DISPLAY_TIMEZONE,
      events: (await monthEvents(env, queryYear, queryMonth)).events
    });
  }

  const upcoming = getUpcomingTradingEvents(currentKst.date, 12);
  const { events } = await monthEvents(env, queryYear, queryMonth);

  return json({
    ok: true,
    supported: true,
    year: queryYear,
    month: queryMonth,
    serverDate: currentKst.date,
    marketSupport: calendarData.marketSupport,
    krxPendingMessage: calendarData.krxPendingMessage || null,
    days: calendarData.days,
    upcoming,
    // Events belong to the month a Seoul reader sees them in, which is not
    // always the month their source published them in. Each carries both
    // its source values and the converted ones.
    eventsTimezone: DISPLAY_TIMEZONE,
    events
  });
}
