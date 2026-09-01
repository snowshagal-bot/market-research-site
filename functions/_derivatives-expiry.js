/**
 * Monthly option expiries, computed rather than fetched.
 *
 * These two are the only market dates this repo derives itself, because both
 * exchanges publish them as rules rather than as schedules:
 *
 *   KRX  — KOSPI 200 options settle on the second Thursday of the contract
 *          month. When that Thursday is a closure the last trading day moves
 *          back to the trading day before it.
 *   US   — standard monthly equity and index options expire on the third
 *          Friday. When that Friday is an exchange holiday, expiry moves back
 *          to the preceding business day.
 *
 * The holiday half is the part worth writing down: "second Thursday" and
 * "third Friday" alone are wrong in exactly the months a reader would most
 * want the calendar to be right. Both adjustments walk the canonical trading
 * calendar in functions/_trading-calendar.js, so an expiry can never be
 * computed for a year whose holidays this repo has not been told. A year that
 * is not configured yields no events at all rather than a guess.
 */

import { isMarketYearSupported, isTradingDate, previousTradingDate } from './_trading-calendar.js';

const KRX_EXPIRY_WEEKDAY = 4; // Thursday
const KRX_EXPIRY_NTH = 2;
const US_EXPIRY_WEEKDAY = 5; // Friday
const US_EXPIRY_NTH = 3;

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The nth given weekday of a month, as YYYY-MM-DD. Weekday: 0 Sun … 6 Sat. */
export function nthWeekdayOfMonth(year, month, weekday, nth) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`Invalid year or month: ${year}-${month}`);
  }
  if (!Number.isInteger(nth) || nth < 1) throw new Error(`Invalid nth: ${nth}`);

  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (day > daysInMonth) throw new Error(`Month ${y}-${m} has no ${nth}th weekday ${weekday}`);
  return iso(y, m, day);
}

/**
 * Returns null when the market's holidays for that year are not configured,
 * because an expiry that skipped an unknown closure would be a wrong date
 * presented as a certain one.
 */
function resolveExpiry({ market, year, month, weekday, nth }) {
  if (!isMarketYearSupported(market, year)) return null;
  const scheduled = nthWeekdayOfMonth(year, month, weekday, nth);
  if (isTradingDate(scheduled, market)) {
    return { date: scheduled, scheduledDate: scheduled, adjusted: false, market };
  }
  // Walk back rather than forward: both exchanges bring the last trading day
  // in when the nominal day is closed.
  const moved = previousTradingDate(scheduled, market);
  return { date: moved, scheduledDate: scheduled, adjusted: true, market };
}

export function krxMonthlyExpiry(year, month) {
  return resolveExpiry({ market: 'KRX', year, month, weekday: KRX_EXPIRY_WEEKDAY, nth: KRX_EXPIRY_NTH });
}

export function usMonthlyExpiry(year, month) {
  return resolveExpiry({ market: 'NYSE', year, month, weekday: US_EXPIRY_WEEKDAY, nth: US_EXPIRY_NTH });
}

/**
 * Both expiries for one month, in the shape the event store accepts. No time
 * is attached: the exchanges publish a date, and the session close is already
 * on the calendar as trading hours.
 */
export function monthlyExpiryEvents(year, month) {
  const events = [];

  const krx = krxMonthlyExpiry(year, month);
  if (krx) {
    events.push({
      eventDate: krx.date,
      eventTime: null,
      timezone: 'Asia/Seoul',
      market: 'KR',
      category: 'derivatives_expiry',
      importance: 'normal',
      titleKo: 'KRX 지수옵션 만기',
      titleEn: 'KRX index option expiry',
      sourceType: 'rule',
      sourceName: 'krx-expiry-rule',
      sourceUrl: 'https://global.krx.co.kr/contents/GLB/05/0503/0503010301/GLB0503010301.jsp',
      sourceEventId: `krx-monthly:${year}-${String(month).padStart(2, '0')}`
    });
  }

  const us = usMonthlyExpiry(year, month);
  if (us) {
    events.push({
      eventDate: us.date,
      eventTime: null,
      timezone: 'America/New_York',
      market: 'US',
      category: 'derivatives_expiry',
      importance: 'normal',
      titleKo: '미국 월물 옵션 만기',
      titleEn: 'US monthly option expiry',
      sourceType: 'rule',
      sourceName: 'us-expiry-rule',
      sourceUrl: 'https://www.theocc.com/',
      sourceEventId: `us-monthly:${year}-${String(month).padStart(2, '0')}`
    });
  }

  return events;
}

export const __test = { resolveExpiry, iso };
