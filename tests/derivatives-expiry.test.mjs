import assert from 'node:assert/strict';
import test from 'node:test';

import { isTradingDate } from '../functions/_trading-calendar.js';
import {
  krxMonthlyExpiry,
  monthlyExpiryEvents,
  nthWeekdayOfMonth,
  usMonthlyExpiry
} from '../functions/_derivatives-expiry.js';

const weekdayOf = date => new Date(`${date}T00:00:00Z`).getUTCDay();

/* ------------------------------------------------------------ the counting */

test('the nth weekday of a month is counted from the first of the month', () => {
  // 2026-09-01 is a Tuesday, so the first Thursday is the 3rd.
  assert.equal(nthWeekdayOfMonth(2026, 9, 4, 1), '2026-09-03');
  assert.equal(nthWeekdayOfMonth(2026, 9, 4, 2), '2026-09-10');
  assert.equal(nthWeekdayOfMonth(2026, 9, 5, 3), '2026-09-18');
  // A month starting on the weekday itself counts that day as the first.
  assert.equal(nthWeekdayOfMonth(2026, 1, 4, 1), '2026-01-01');
  assert.throws(() => nthWeekdayOfMonth(2026, 2, 4, 5), /no 5th weekday/);
  assert.throws(() => nthWeekdayOfMonth(2026, 13, 4, 1), /Invalid year or month/);
});

/* --------------------------------------------------------- ordinary months */

test('KRX settles on the second Thursday when that Thursday is open', () => {
  const september = krxMonthlyExpiry(2026, 9);
  assert.equal(september.date, '2026-09-10');
  assert.equal(september.scheduledDate, '2026-09-10');
  assert.equal(september.adjusted, false);
  assert.equal(weekdayOf(september.date), 4);
});

test('US options expire on the third Friday when that Friday is open', () => {
  const september = usMonthlyExpiry(2026, 9);
  assert.equal(september.date, '2026-09-18');
  assert.equal(september.adjusted, false);
  assert.equal(weekdayOf(september.date), 5);
});

test('every 2026 expiry lands on a day its market is actually open', () => {
  for (let month = 1; month <= 12; month += 1) {
    const krx = krxMonthlyExpiry(2026, month);
    assert.ok(krx, `KRX ${month} should resolve`);
    assert.equal(isTradingDate(krx.date, 'KRX'), true, `KRX expiry ${krx.date} must be a trading day`);

    const us = usMonthlyExpiry(2026, month);
    assert.ok(us, `US ${month} should resolve`);
    assert.equal(isTradingDate(us.date, 'NYSE'), true, `US expiry ${us.date} must be a trading day`);
  }
});

/* ------------------------------------------------------- holiday collision */

test('a third Friday that is an exchange holiday moves back a day', () => {
  // 19 June 2026 is a Friday and Juneteenth: the NYSE is shut.
  assert.equal(weekdayOf('2026-06-19'), 5);
  assert.equal(isTradingDate('2026-06-19', 'NYSE'), false);

  const june = usMonthlyExpiry(2026, 6);
  assert.equal(june.scheduledDate, '2026-06-19', 'the nominal day is still the third Friday');
  assert.equal(june.date, '2026-06-18', 'and expiry falls back to the preceding business day');
  assert.equal(june.adjusted, true);
  assert.equal(weekdayOf(june.date), 4);
  assert.equal(isTradingDate(june.date, 'NYSE'), true);
});

test('the same collision recurs in 2027 and is handled the same way', () => {
  const june = usMonthlyExpiry(2027, 6);
  assert.equal(june.scheduledDate, '2027-06-18');
  assert.equal(june.date, '2027-06-17');
  assert.equal(june.adjusted, true);
});

test('adjustment walks back over a run of closed days, never forward', () => {
  // Every adjusted expiry must be earlier than its nominal date, and the days
  // in between must all be closed.
  for (const [market, resolve, exchange] of [['KRX', krxMonthlyExpiry, 'KRX'], ['US', usMonthlyExpiry, 'NYSE']]) {
    for (const year of [2026, 2027]) {
      for (let month = 1; month <= 12; month += 1) {
        const expiry = resolve(year, month);
        if (!expiry || !expiry.adjusted) continue;
        assert.ok(expiry.date < expiry.scheduledDate, `${market} ${year}-${month} must move backwards`);
        const cursor = new Date(`${expiry.date}T00:00:00Z`);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        while (cursor.toISOString().slice(0, 10) <= expiry.scheduledDate) {
          const day = cursor.toISOString().slice(0, 10);
          assert.equal(isTradingDate(day, exchange), false, `${day} was skipped but is open`);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
    }
  }
});

/* ------------------------------------------- a year we cannot vouch for */

test('an unconfigured year produces nothing rather than a guess', () => {
  // KRX holidays are only checked in for 2026; 2027 is not published yet.
  assert.equal(krxMonthlyExpiry(2027, 1), null);
  assert.equal(krxMonthlyExpiry(2030, 5), null);
  // NYSE is configured through 2027 but not beyond.
  assert.ok(usMonthlyExpiry(2027, 1));
  assert.equal(usMonthlyExpiry(2028, 1), null);
});

test('a month in an unconfigured year yields only the market that is known', () => {
  const events2027 = monthlyExpiryEvents(2027, 9);
  assert.deepEqual(events2027.map(e => e.market), ['US'], 'KRX 2027 is unknown, so it is absent');

  const events2028 = monthlyExpiryEvents(2028, 9);
  assert.deepEqual(events2028, [], 'neither market is configured that far out');
});

/* ------------------------------------------------------- the event shape */

test('an expiry is stored as a date with no invented time', () => {
  const [krx, us] = monthlyExpiryEvents(2026, 9);

  assert.equal(krx.market, 'KR');
  assert.equal(krx.category, 'derivatives_expiry');
  assert.equal(krx.eventDate, '2026-09-10');
  assert.equal(krx.eventTime, null, 'the exchange publishes a date, not a clock time');
  assert.equal(krx.sourceType, 'rule');
  assert.equal(krx.sourceEventId, 'krx-monthly:2026-09');
  assert.equal(krx.titleKo, 'KRX 지수옵션 만기');
  assert.equal(krx.titleEn, 'KRX index option expiry');

  assert.equal(us.market, 'US');
  assert.equal(us.eventDate, '2026-09-18');
  assert.equal(us.eventTime, null);
  assert.equal(us.sourceEventId, 'us-monthly:2026-09');
});

test('the source identity is per month, so re-running a month cannot duplicate it', () => {
  const first = monthlyExpiryEvents(2026, 6);
  const second = monthlyExpiryEvents(2026, 6);
  assert.deepEqual(first, second, 'the rule is deterministic');
  assert.deepEqual(first.map(e => e.sourceEventId), ['krx-monthly:2026-06', 'us-monthly:2026-06']);

  // The identity does not carry the resolved date, so an adjustment that
  // changes the date updates the same row rather than creating a second one.
  const june = first.find(e => e.market === 'US');
  assert.equal(june.eventDate, '2026-06-18');
  assert.doesNotMatch(june.sourceEventId, /06-18/);
});
