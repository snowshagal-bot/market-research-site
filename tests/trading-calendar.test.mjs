import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALENDAR_HOLIDAYS,
  HOLIDAY_NAMES,
  SPECIAL_SESSIONS,
  expectedLatestKrxTradingDate,
  getKrxSessionTimes,
  getMonthlyTradingCalendar,
  getUpcomingTradingEvents,
  isMarketYearSupported,
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
  // Verify 2026-06-03 is 9th Nationwide Local Election Day
  assert.equal(HOLIDAY_NAMES.KRX['2026-06-03'].ko, '전국동시지방선거일');
});

test('2026 NYSE holidays: all 10 designated holiday dates are non-trading days', () => {
  const nyse2026 = CALENDAR_HOLIDAYS.NYSE[2026];
  assert.equal(nyse2026.length, 10);
  for (const date of nyse2026) {
    assert.equal(isTradingDate(date, 'NYSE'), false, `${date} should be non-trading for NYSE`);
    assert.ok(HOLIDAY_NAMES.NYSE[date], `${date} should have descriptive name in HOLIDAY_NAMES.NYSE`);
  }
});

test('2027 NYSE official holidays: all 10 designated holiday dates are non-trading days and supported', () => {
  assert.equal(isMarketYearSupported('NYSE', 2027), true);
  const nyse2027 = CALENDAR_HOLIDAYS.NYSE[2027];
  assert.equal(nyse2027.length, 10);
  for (const date of nyse2027) {
    assert.equal(isTradingDate(date, 'NYSE'), false, `${date} should be non-trading for NYSE`);
    assert.ok(HOLIDAY_NAMES.NYSE[date], `${date} should have descriptive name in HOLIDAY_NAMES.NYSE`);
  }
  // Check 2027-11-26 special session (Day after Thanksgiving early close)
  assert.ok(SPECIAL_SESSIONS.NYSE['2027-11-26']);
  assert.equal(isTradingDate('2027-11-26', 'NYSE'), true);
});

test('2027 KRX holidays: fail-closed / pending while official schedule is unfinalized', () => {
  assert.equal(isMarketYearSupported('KRX', 2027), false);
  assert.throws(() => isTradingDate('2027-01-04', 'KRX'), /KRX trading calendar is not configured for 2027/);
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
  // NYSE 2027-01-04 (Mon) -> 2026-12-31 (Thu)
  assert.equal(previousTradingDate('2027-01-04', 'NYSE'), '2026-12-31');
});

test('getKrxSessionTimes and expectedLatestKrxTradingDate: CSAT day 2026-11-19 special session boundary', () => {
  // Normal session timing
  const normalTimes = getKrxSessionTimes('2026-09-01');
  assert.equal(normalTimes.closeTime, '15:30');
  assert.equal(normalTimes.publishEligibleMinutes, 16 * 60 + 5); // 16:05 KST
  assert.equal(normalTimes.freshnessGraceMinutes, 16 * 60 + 30);  // 16:30 KST (1h grace)
  assert.equal(normalTimes.alertMinutes, 17 * 60);              // 17:00 KST

  // CSAT session timing (2026-11-19)
  const csatTimes = getKrxSessionTimes('2026-11-19');
  assert.equal(csatTimes.closeTime, '16:30');
  assert.equal(csatTimes.publishEligibleMinutes, 17 * 60 + 5); // 17:05 KST (35 min after 16:30 close)
  assert.equal(csatTimes.freshnessGraceMinutes, 17 * 60 + 30);  // 17:30 KST (1h grace after 16:30 close)
  assert.equal(csatTimes.alertMinutes, 18 * 60);              // 18:00 KST

  // Normal day: 2026-09-01 at 16:29 KST -> 2026-08-31
  const normalPreGrace = new Date('2026-09-01T07:29:00Z'); // 16:29 KST
  assert.equal(expectedLatestKrxTradingDate(normalPreGrace), '2026-08-31');
  // Normal day: 2026-09-01 at 16:30 KST -> 2026-09-01
  const normalPostGrace = new Date('2026-09-01T07:30:00Z'); // 16:30 KST
  assert.equal(expectedLatestKrxTradingDate(normalPostGrace), '2026-09-01');

  // CSAT day (2026-11-19): At 16:05 KST (during trading!), expected date is previous session (2026-11-18)
  const csatAtFixedPublisher = new Date('2026-11-19T07:05:00Z'); // 16:05 KST
  assert.equal(expectedLatestKrxTradingDate(csatAtFixedPublisher), '2026-11-18');

  // CSAT day: At 17:29 KST (before 17:30 grace cutoff), expected date is still previous session
  const csatPreGrace = new Date('2026-11-19T08:29:00Z'); // 17:29 KST
  assert.equal(expectedLatestKrxTradingDate(csatPreGrace), '2026-11-18');

  // CSAT day: At 17:30 KST (1 hour after 16:30 close), expected date becomes 2026-11-19
  const csatPostGrace = new Date('2026-11-19T08:30:00Z'); // 17:30 KST
  assert.equal(expectedLatestKrxTradingDate(csatPostGrace), '2026-11-19');
});

test('getMonthlyTradingCalendar handles 2026 fully and 2027 per-market partial support', () => {
  // 2026: Both supported
  const cal2026 = getMonthlyTradingCalendar(2026, 9);
  assert.equal(cal2026.supported, true);
  assert.equal(cal2026.marketSupport.krx, true);
  assert.equal(cal2026.marketSupport.nyse, true);
  assert.equal(cal2026.days.length, 30);

  // 2027: KRX pending, NYSE supported
  const cal2027 = getMonthlyTradingCalendar(2027, 1);
  assert.equal(cal2027.supported, true);
  assert.equal(cal2027.marketSupport.krx, false);
  assert.equal(cal2027.marketSupport.nyse, true);
  assert.ok(cal2027.krxPendingMessage);
  assert.equal(cal2027.days.length, 31);

  // Check 2027-01-01 (NYSE New Year Holiday, KRX pending)
  const jan1 = cal2027.days.find(d => d.date === '2027-01-01');
  assert.ok(jan1);
  assert.equal(jan1.nyse.supported, true);
  assert.equal(jan1.nyse.holiday, true);
  assert.equal(jan1.krx.supported, false);
  assert.equal(jan1.krx.status, 'pending');

  // 2028: Neither supported -> supported: false
  const cal2028 = getMonthlyTradingCalendar(2028, 1);
  assert.equal(cal2028.supported, false);
  assert.equal(cal2028.marketSupport.krx, false);
  assert.equal(cal2028.marketSupport.nyse, false);
  assert.match(cal2028.message, /2028 calendar deferred — official schedule incomplete/);
});

test('getUpcomingTradingEvents returns ordered upcoming closures and sessions across 2026 and 2027', () => {
  const events = getUpcomingTradingEvents('2026-12-01', 5);
  assert.ok(events.length > 0);
  assert.ok(events.length <= 5);
  // Events in Dec 2026 / Jan 2027
  assert.ok(events.some(e => e.date.startsWith('2026-12')));
  assert.ok(events.some(e => e.date === '2027-01-01'));
});
