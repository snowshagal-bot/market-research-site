import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DISPLAY_TIMEZONE,
  displayDate,
  toDisplayTime,
  withDisplayTime,
  zonedWallClockToInstant,
  zoneOffsetMillis
} from '../functions/_calendar-time.js';
import { parseFomcDecisionTime } from '../functions/_calendar-sources.js';

const HOUR = 60 * 60 * 1000;

/* --------------------------------------------------- the zone, not an offset */

test('New York is read through its IANA zone, so both halves of the year work', () => {
  // Summer time and standard time, an hour apart, without either being
  // written down as a fixed offset anywhere.
  assert.equal(zoneOffsetMillis(new Date('2026-09-16T18:00:00Z'), 'America/New_York'), -4 * HOUR);
  assert.equal(zoneOffsetMillis(new Date('2026-01-28T19:00:00Z'), 'America/New_York'), -5 * HOUR);
  assert.equal(zoneOffsetMillis(new Date('2026-09-16T18:00:00Z'), 'Asia/Seoul'), 9 * HOUR);
});

test('a wall clock in a zone resolves to the instant it names', () => {
  assert.equal(zonedWallClockToInstant('2026-09-16', '14:00', 'America/New_York').toISOString(), '2026-09-16T18:00:00.000Z');
  assert.equal(zonedWallClockToInstant('2026-01-28', '14:00', 'America/New_York').toISOString(), '2026-01-28T19:00:00.000Z');
  assert.equal(zonedWallClockToInstant('2026-10-15', '14:00', 'Asia/Seoul').toISOString(), '2026-10-15T05:00:00.000Z');
});

test('the changeover weekends resolve on the right side of the switch', () => {
  // US daylight saving in 2026 begins 8 March and ends 1 November.
  assert.equal(zonedWallClockToInstant('2026-03-07', '14:00', 'America/New_York').toISOString(), '2026-03-07T19:00:00.000Z');
  assert.equal(zonedWallClockToInstant('2026-03-09', '14:00', 'America/New_York').toISOString(), '2026-03-09T18:00:00.000Z');
  assert.equal(zonedWallClockToInstant('2026-10-31', '14:00', 'America/New_York').toISOString(), '2026-10-31T18:00:00.000Z');
  assert.equal(zonedWallClockToInstant('2026-11-02', '14:00', 'America/New_York').toISOString(), '2026-11-02T19:00:00.000Z');
});

/* ------------------------------------------- the date moves, not just the clock */

test('an afternoon decision in New York is the next morning in Seoul', () => {
  const shown = toDisplayTime({ date: '2026-09-16', time: '14:00', timezone: 'America/New_York' });
  assert.equal(shown.date, '2026-09-17');
  assert.equal(shown.time, '03:00');
  assert.equal(shown.timezone, 'Asia/Seoul');
  assert.equal(shown.shifted, true, 'the day cell must move too');
});

test('the same meeting in winter lands an hour later, still the next day', () => {
  const shown = toDisplayTime({ date: '2026-01-28', time: '14:00', timezone: 'America/New_York' });
  assert.equal(shown.date, '2026-01-29');
  assert.equal(shown.time, '04:00');
});

test('a morning release stays on its own day', () => {
  const summer = toDisplayTime({ date: '2026-09-11', time: '08:30', timezone: 'America/New_York' });
  assert.equal(summer.date, '2026-09-11');
  assert.equal(summer.time, '21:30');
  assert.equal(summer.shifted, false);

  const winter = toDisplayTime({ date: '2026-01-13', time: '08:30', timezone: 'America/New_York' });
  assert.equal(winter.date, '2026-01-13');
  assert.equal(winter.time, '22:30');
});

test('a Korean event is already in the reader’s zone and does not move', () => {
  const shown = toDisplayTime({ date: '2026-10-15', time: '14:00', timezone: 'Asia/Seoul' });
  assert.deepEqual([shown.date, shown.time, shown.shifted], ['2026-10-15', '14:00', false]);
});

/* -------------------------------------------------- events with no time at all */

test('an event with no time keeps its date and gains no hour', () => {
  for (const timezone of ['America/New_York', 'Asia/Seoul']) {
    const shown = toDisplayTime({ date: '2026-09-18', time: null, timezone });
    assert.equal(shown.date, '2026-09-18', 'an all-day event belongs to its own market’s day');
    assert.equal(shown.time, null);
    assert.equal(shown.allDay, true);
    assert.equal(shown.shifted, false);
  }
});

test('a missing time is never filled in, which would also move the date', () => {
  // Midnight in New York is the previous afternoon in Seoul. Inventing a time
  // for an expiry would silently file it on the wrong day.
  const expiry = toDisplayTime({ date: '2026-09-18', time: null, timezone: 'America/New_York' });
  assert.equal(expiry.date, '2026-09-18');
  const ifMidnightWereAssumed = toDisplayTime({ date: '2026-09-18', time: '00:00', timezone: 'America/New_York' });
  assert.equal(ifMidnightWereAssumed.date, '2026-09-18');
  assert.equal(ifMidnightWereAssumed.time, '13:00');
});

/* ------------------------------------------------------ what travels to a client */

test('the stored values travel beside the display ones', () => {
  const event = { id: 'official:fomc:2026-09-16', date: '2026-09-16', time: '14:00', timezone: 'America/New_York' };
  const decorated = withDisplayTime(event);

  assert.deepEqual(decorated.source, { date: '2026-09-16', time: '14:00', timezone: 'America/New_York' });
  assert.deepEqual(decorated.display, { date: '2026-09-17', time: '03:00', timezone: 'Asia/Seoul', shifted: true });
  // The original fields are untouched, so a client can convert for itself.
  assert.equal(decorated.date, '2026-09-16');
  assert.equal(decorated.time, '14:00');
  assert.equal(decorated.timezone, 'America/New_York');
});

test('the day cell an event belongs in is the reader’s day', () => {
  assert.equal(displayDate({ date: '2026-09-16', time: '14:00', timezone: 'America/New_York' }), '2026-09-17');
  assert.equal(displayDate({ date: '2026-09-18', time: null, timezone: 'America/New_York' }), '2026-09-18');
  assert.equal(DISPLAY_TIMEZONE, 'Asia/Seoul');
});

test('a malformed stored value is refused rather than shown wrong', () => {
  assert.throws(() => toDisplayTime({ date: '2026-9-16', time: '14:00', timezone: 'America/New_York' }), /YYYY-MM-DD/);
  assert.throws(() => toDisplayTime({ date: '2026-09-16', time: '2pm', timezone: 'America/New_York' }), /HH:MM/);
});

/* ------------------------------------------------- the FOMC release time */

test('the decision time is read only when the Fed writes it down', () => {
  assert.equal(parseFomcDecisionTime('<p>The Committee will release its policy statement at 2:00 p.m. EDT.</p>'), '14:00');
  assert.equal(parseFomcDecisionTime('<p>The decision is announced at 2:00 p.m.</p>'), '14:00');
  // A press conference is not the decision, and this v1 does not add it as an
  // event of its own.
  assert.equal(parseFomcDecisionTime('<p>A press conference will follow at 2:30 p.m.</p>'), null);
  assert.equal(parseFomcDecisionTime('<p>Meeting dates are listed below.</p>'), null);
  assert.equal(parseFomcDecisionTime(''), null);
});

test('the meeting calendar as published carries no time, and that is not a failure', async () => {
  const page = await readFile(new URL('./fixtures/calendar/fomc-calendars.html', import.meta.url), 'utf8');
  // The schedule page lists dates only. The meeting still belongs on the
  // calendar; it simply has no hour, which the sync records as unconfirmed.
  assert.equal(parseFomcDecisionTime(page), null);
});
