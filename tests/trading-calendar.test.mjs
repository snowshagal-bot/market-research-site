import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALENDAR_HOLIDAYS,
  HOLIDAY_NAMES,
  SPECIAL_SESSIONS,
  expectedLatestKrxTradingDate,
  getMonthlyTradingCalendar,
  getUpcomingTradingEvents,
  isTradingDate,
  previousTradingDate
} from '../functions/_trading-calendar.js';

test('2026 KRX holidays: all 16 designated holiday dates are non-trading days', () => {
  const krx2026 = CALENDAR_HOLIDAYS.KRX[2026];
  assert.equal(krx2026.length, 16);
  for (const date of krx2026) {
    assert.equal(isTradingDate(date, 'KRX'), false, `${date} should be non-trading for KRX`);
    assert.ok(HOLIDAY_NAMES.KRX[date], `${date} should have descriptive name in HOLIDAY_NAMES.KRX`);
  }
});

test('2026 NYSE holidays: all 10 designated holiday dates are non-trading days', () => {
  const nyse2026 = CALENDAR_HOLIDAYS.NYSE[2026];
  assert.equal(nyse2026.length, 10);
  for (const date of nyse2026) {
    assert.equal(isTradingDate(date, 'NYSE'), false, `${date} should be non-trading for NYSE`);
    assert.ok(HOLIDAY_NAMES.NYSE[date], `${date} should have descriptive name in HOLIDAY_NAMES.NYSE`);
  }
});

test('Weekends are always non-trading days for both markets', () => {
  assert.equal(isTradingDate('2026-08-29', 'KRX'), false); // Saturday
  assert.equal(isTradingDate('2026-08-30', 'KRX'), false); // Sunday
  assert.equal(isTradingDate('2026-08-29', 'NYSE'), false);
  assert.equal(isTradingDate('2026-08-30', 'NYSE'), false);
});

test('Normal weekdays without holidays are trading days', () => {
  assert.equal(isTradingDate('2026-09-01', 'KRX'), true); // Tuesday
  assert.equal(isTradingDate('2026-09-01', 'NYSE'), true);
  assert.equal(isTradingDate('2026-08-28', 'KRX'), true); // Friday
  assert.equal(isTradingDate('2026-08-28', 'NYSE'), true);
});

test('Special trading sessions remain trading days', () => {
  // KRX 2026-01-02 (opening ceremony 1h delayed open) is a trading day
  assert.equal(isTradingDate('2026-01-02', 'KRX'), true);
  assert.ok(SPECIAL_SESSIONS.KRX['2026-01-02']);
  // KRX 2026-11-19 (CSAT exam day) is a trading day
  assert.equal(isTradingDate('2026-11-19', 'KRX'), true);
  assert.ok(SPECIAL_SESSIONS.KRX['2026-11-19']);
  // NYSE 2026-11-27 (day after Thanksgiving early close) is a trading day
  assert.equal(isTradingDate('2026-11-27', 'NYSE'), true);
  assert.ok(SPECIAL_SESSIONS.NYSE['2026-11-27']);
  // NYSE 2026-12-24 (Christmas Eve early close) is a trading day
  assert.equal(isTradingDate('2026-12-24', 'NYSE'), true);
  assert.ok(SPECIAL_SESSIONS.NYSE['2026-12-24']);
});

test('previousTradingDate resolves correctly across holidays and weekends', () => {
  // 2026-09-01 (Tue) -> 2026-08-31 (Mon)
  assert.equal(previousTradingDate('2026-09-01', 'KRX'), '2026-08-31');
  // 2026-08-31 (Mon) -> 2026-08-28 (Fri)
  assert.equal(previousTradingDate('2026-08-31', 'KRX'), '2026-08-28');
  // 2026-08-18 (Tue, after Aug 17 holiday) -> 2026-08-14 (Fri)
  assert.equal(previousTradingDate('2026-08-18', 'KRX'), '2026-08-14');
  // NYSE 2026-09-08 (Tue, after Labor Day Sep 7) -> 2026-09-04 (Fri)
  assert.equal(previousTradingDate('2026-09-08', 'NYSE'), '2026-09-04');
});

test('Unsupported year (e.g. 2027) fails-closed', () => {
  assert.throws(() => isTradingDate('2027-01-04', 'KRX'), /KRX trading calendar is not configured for 2027/);
  assert.throws(() => isTradingDate('2027-01-04', 'NYSE'), /NYSE trading calendar is not configured for 2027/);

  const cal2027 = getMonthlyTradingCalendar(2027, 1);
  assert.equal(cal2027.supported, false);
  assert.match(cal2027.message, /2027 calendar deferred — official schedule incomplete/);
});

test('getMonthlyTradingCalendar returns full month structure for 2026', () => {
  const calSep = getMonthlyTradingCalendar(2026, 9);
  assert.equal(calSep.supported, true);
  assert.equal(calSep.year, 2026);
  assert.equal(calSep.month, 9);
  assert.equal(calSep.days.length, 30); // September has 30 days

  // Check 2026-09-07: NYSE Labor Day holiday, KRX normal trading day
  const sep7 = calSep.days.find(d => d.date === '2026-09-07');
  assert.ok(sep7);
  assert.equal(sep7.krx.trading, true);
  assert.equal(sep7.nyse.trading, false);
  assert.equal(sep7.nyse.holiday, true);
  assert.match(sep7.nyse.name.ko, /노동절/);

  // Check 2026-09-24: KRX Chuseok holiday, NYSE normal trading day
  const sep24 = calSep.days.find(d => d.date === '2026-09-24');
  assert.ok(sep24);
  assert.equal(sep24.krx.trading, false);
  assert.equal(sep24.krx.holiday, true);
  assert.equal(sep24.nyse.trading, true);

  // Check 2026-12-25: Joint closure (both markets closed on Friday)
  const calDec = getMonthlyTradingCalendar(2026, 12);
  const dec25 = calDec.days.find(d => d.date === '2026-12-25');
  assert.ok(dec25);
  assert.equal(dec25.isJointClosure, true);
  assert.equal(dec25.krx.holiday, true);
  assert.equal(dec25.nyse.holiday, true);
});

test('getUpcomingTradingEvents returns ordered upcoming closures and sessions', () => {
  const events = getUpcomingTradingEvents('2026-09-01', 5);
  assert.ok(events.length > 0);
  assert.ok(events.length <= 5);
  assert.equal(events[0].date, '2026-09-07'); // First event on or after Sep 1 is NYSE Labor Day
});
