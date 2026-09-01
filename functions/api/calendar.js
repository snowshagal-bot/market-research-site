import {
  getMonthlyTradingCalendar,
  getUpcomingTradingEvents,
  kstParts
} from '../_trading-calendar.js';

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

export async function onRequestGet({ request, now = new Date() }) {
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
      message: calendarData.message || `${queryYear} calendar deferred — official schedule incomplete`,
      days: [],
      upcoming: []
    });
  }

  const upcoming = getUpcomingTradingEvents(currentKst.date, 12);

  return json({
    ok: true,
    supported: true,
    year: queryYear,
    month: queryMonth,
    serverDate: currentKst.date,
    days: calendarData.days,
    upcoming
  });
}
