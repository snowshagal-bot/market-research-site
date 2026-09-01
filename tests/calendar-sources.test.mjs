import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BLS_SERIES,
  SOURCE_USER_AGENT,
  SourceParseError,
  parseBeaSchedule,
  parseBlsSchedule,
  parseBokSchedule,
  parseClock,
  parseFomcSchedule,
  parseUsLongDate
} from '../functions/_calendar-sources.js';

const fixture = name => readFile(new URL(`./fixtures/calendar/${name}`, import.meta.url), 'utf8');

const FOMC = await fixture('fomc-calendars.html');
const CPI = await fixture('bls-cpi.html');
const EMPSIT = await fixture('bls-empsit.html');
const BEA = await fixture('bea-schedule.html');
const BOK_2026 = await fixture('bok-2026.html');
const BOK_2027 = await fixture('bok-2027.html');

/* ------------------------------------------------------------- fragments */

test('a published clock time is read as given, and anything else is no time', () => {
  assert.equal(parseClock('08:30 AM'), '08:30');
  assert.equal(parseClock('12:00 PM'), '12:00');
  assert.equal(parseClock('12:30 AM'), '00:30');
  assert.equal(parseClock('02:00 PM'), '14:00');
  assert.equal(parseClock('14:00'), '14:00');
  // Nothing here is a time, and none of it becomes midnight.
  assert.equal(parseClock(''), null);
  assert.equal(parseClock('TBD'), null);
  assert.equal(parseClock('morning'), null);
  assert.equal(parseClock('25:00'), null);
});

test('release dates are read in the abbreviated and full forms BLS uses', () => {
  assert.equal(parseUsLongDate('Dec. 18, 2025'), '2025-12-18');
  assert.equal(parseUsLongDate('February 13, 2026'), '2026-02-13');
  assert.equal(parseUsLongDate('Sep. 1, 2026'), '2026-09-01');
  assert.equal(parseUsLongDate('sometime in March'), null);
  assert.equal(parseUsLongDate(''), null);
});

/* ------------------------------------------------------------------ FOMC */

test('a two-day FOMC meeting is one event, dated to the decision day', () => {
  const meetings = parseFomcSchedule(FOMC, { year: 2026 });
  assert.equal(meetings.length, 8, 'the Committee holds eight scheduled meetings a year');
  assert.deepEqual(meetings.map(m => m.eventDate), [
    '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
    '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'
  ]);

  const september = meetings.find(m => m.eventDate === '2026-09-16');
  // The meeting runs 15-16 September; only the 16th is on the calendar.
  assert.equal(september.meta.meetingStartDate, '2026-09-15');
  assert.equal(meetings.filter(m => m.eventDate === '2026-09-15').length, 0, 'the opening day is not a second event');
  assert.equal(september.sourceEventId, 'fomc:2026-09-16');
  assert.equal(september.titleKo, 'FOMC 금리결정');
  assert.equal(september.titleEn, 'FOMC Rate Decision');
});

test('the Fed publishes no release time, so none is invented', () => {
  for (const meeting of parseFomcSchedule(FOMC, { year: 2026 })) {
    assert.equal(meeting.eventTime, null);
  }
});

test('each year on the page is attributed to its own heading', () => {
  const y2026 = parseFomcSchedule(FOMC, { year: 2026 });
  const y2027 = parseFomcSchedule(FOMC, { year: 2027 });
  assert.equal(y2027.length, 8);
  assert.deepEqual(y2027.map(m => m.eventDate).slice(0, 3), ['2027-01-27', '2027-03-17', '2027-04-28']);
  // The tentative next year sits below the historical ones on the page, so a
  // parser that ran to the end of the document would mix them up.
  assert.equal(y2026.some(m => m.eventDate.startsWith('2027')), false);
  assert.equal(y2027.some(m => m.eventDate.startsWith('2026')), false);
});

test('a footnote about a later meeting is not read as a scheduled one', () => {
  // The 2027 block closes with "Note: A two-day meeting is scheduled for
  // January 25-26, 2028." That is prose, not a row.
  assert.deepEqual(parseFomcSchedule(FOMC, { year: 2028 }), []);
  assert.equal(parseFomcSchedule(FOMC, { year: 2027 }).filter(m => m.eventDate.endsWith('-01-26')).length, 0);
});

test('a page that no longer looks like the schedule fails loudly', () => {
  assert.throws(() => parseFomcSchedule('<html><body><p>Service unavailable</p></body></html>'), SourceParseError);
  assert.throws(() => parseFomcSchedule('<html><body>FOMC information</body></html>'), /no meeting year headings/);
});

/* ------------------------------------------------------------------- BLS */

test('the CPI schedule is read with the release time the page states', () => {
  const releases = parseBlsSchedule(CPI, { series: 'cpi' });
  assert.ok(releases.length >= 12);

  const february = releases.find(r => r.eventDate === '2026-02-13');
  assert.equal(february.eventTime, '08:30');
  assert.equal(february.category, 'inflation');
  assert.equal(february.titleKo, '미국 소비자물가지수(CPI)');
  assert.equal(february.titleEn, 'US Consumer Price Index');
  assert.equal(february.sourceEventId, 'cpi:2026-02-13');
  assert.match(february.meta.referenceMonth, /January 2026/);
});

test('the employment report is a separate series with its own dates', () => {
  const releases = parseBlsSchedule(EMPSIT, { series: 'employment' });
  const january = releases.find(r => r.eventDate === '2026-01-09');
  assert.ok(january, 'the January release should be present');
  assert.equal(january.category, 'employment');
  assert.equal(january.titleEn, 'US Employment Situation');
  assert.equal(january.sourceEventId, 'nfp:2026-01-09');

  // The two series must not collide in the store.
  const cpiIds = new Set(parseBlsSchedule(CPI, { series: 'cpi' }).map(r => r.sourceEventId));
  assert.equal(releases.some(r => cpiIds.has(r.sourceEventId)), false);
});

test('an unknown series or an empty page is refused', () => {
  assert.throws(() => parseBlsSchedule(CPI, { series: 'ppi' }), /unknown series/);
  assert.throws(() => parseBlsSchedule('<html><body>no table</body></html>', { series: 'cpi' }), /no table rows/);
  assert.throws(() => parseBlsSchedule('<table><tr><td>a</td><td>b</td><td>c</td></tr></table>', { series: 'cpi' }), /no release dates/);
});

test('both BLS series are declared with the page they come from', () => {
  assert.match(BLS_SERIES.cpi.url, /^https:\/\/www\.bls\.gov\/schedule\/news_release\/cpi\.htm$/);
  assert.match(BLS_SERIES.employment.url, /empsit\.htm$/);
  // BLS refuses a request without a browser-shaped agent, so one is declared.
  assert.match(SOURCE_USER_AGENT, /snowshagal\.com/);
});

/* ------------------------------------------------------------------- BEA */

test('only Personal Income and Outlays is taken from the BEA schedule', () => {
  const releases = parseBeaSchedule(BEA, { year: 2026 });
  assert.deepEqual(releases.map(r => r.eventDate), ['2026-09-30', '2026-10-29', '2026-11-25', '2026-12-23']);
  for (const release of releases) {
    assert.equal(release.category, 'inflation');
    assert.equal(release.titleEn, 'US Personal Income and Outlays (PCE)');
    assert.equal(release.eventTime, '08:30');
    assert.match(release.meta.release, /Personal Income and Outlays/);
  }
  // GDP and the trade report share the page and must not come along.
  assert.equal(releases.some(r => /GDP|Trade/i.test(r.meta.release)), false);
});

test('the BEA schedule refuses to guess a year it cannot read', () => {
  assert.throws(() => parseBeaSchedule('<table><tr><td>September 30</td><td>Personal Income and Outlays</td></tr></table>'),
    /schedule year/);
  assert.throws(() => parseBeaSchedule('<html><body>maintenance</body></html>', { year: 2026 }), /no table rows/);
  assert.throws(() => parseBeaSchedule('<table><tr><td>GDP</td></tr></table>', { year: 2026 }), /no Personal Income/);
});

/* --------------------------------------------------------- Bank of Korea */

test('the Board’s 2026 decision dates are read from the year page', () => {
  const meetings = parseBokSchedule(BOK_2026, { year: 2026 });
  assert.deepEqual(meetings.map(m => m.eventDate), [
    '2026-01-15', '2026-02-26', '2026-04-10', '2026-05-28',
    '2026-07-16', '2026-08-27', '2026-10-22', '2026-11-26'
  ]);
  const first = meetings[0];
  assert.equal(first.market, 'KR');
  assert.equal(first.timezone, 'Asia/Seoul');
  assert.equal(first.category, 'monetary_policy');
  assert.equal(first.eventTime, null, 'the page publishes no time');
  assert.equal(first.titleKo, '한국은행 금통위 통화정책방향 결정');
  assert.equal(first.titleEn, 'Bank of Korea Monetary Policy Decision');
  assert.match(first.sourceUrl, /pYear=2026$/);
});

test('a year the Board has not announced yet is empty, not an error', () => {
  // An empty answer here is the truth: nothing is scheduled yet.
  assert.deepEqual(parseBokSchedule(BOK_2027, { year: 2027 }), []);
});

test('the year comes from the request, because the rows carry only month and day', () => {
  const meetings = parseBokSchedule(BOK_2026, { year: 2026 });
  assert.ok(meetings.every(m => m.eventDate.startsWith('2026-')));
  assert.throws(() => parseBokSchedule(BOK_2026, {}), /year is required/);
});

test('a Bank of Korea page that changed shape fails loudly', () => {
  assert.throws(() => parseBokSchedule('<html><body>점검 중입니다</body></html>', { year: 2026 }), /통화정책방향/);
});

/* ------------------------------------------- what every source has in common */

test('every parsed event is ready for the store, with no invented time', async () => {
  const batches = [
    parseFomcSchedule(FOMC, { year: 2026 }),
    parseBlsSchedule(CPI, { series: 'cpi' }),
    parseBlsSchedule(EMPSIT, { series: 'employment' }),
    parseBeaSchedule(BEA, { year: 2026 }),
    parseBokSchedule(BOK_2026, { year: 2026 })
  ];
  const { normalizeEvent } = await import('../functions/_calendar-events.js');

  const ids = new Set();
  for (const events of batches) {
    for (const event of events) {
      const normalized = normalizeEvent(event);
      assert.equal(normalized.sourceType, 'official');
      assert.ok(normalized.sourceUrl.startsWith('https://'), 'each event names the page it came from');
      assert.ok(normalized.titleKo && normalized.titleEn, 'official events are named in both locales');
      assert.ok(event.eventTime === null || /^\d{2}:\d{2}$/.test(event.eventTime));
      assert.equal(ids.has(normalized.eventId), false, `duplicate identity: ${normalized.eventId}`);
      ids.add(normalized.eventId);
    }
  }
});
