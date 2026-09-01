/**
 * The five official release schedules the calendar follows.
 *
 * Every one of these is a first-party government or central-bank page, free and
 * unauthenticated. None of them publishes a machine-readable calendar, so each
 * parser reads the one table on the page that carries the schedule.
 *
 *   Federal Reserve  FOMC meeting dates
 *   BLS              CPI, and the Employment Situation report
 *   BEA              Personal Income and Outlays, which carries PCE
 *   Bank of Korea    Monetary Policy Board rate decisions
 *
 * Parsing HTML that someone else maintains fails eventually. It has to fail
 * loudly: every parser throws when the page no longer looks like the page it
 * was written for, rather than returning an empty list that the sync would
 * happily read as "nothing is scheduled" and act on. The caller records the
 * failure and leaves the stored events alone.
 *
 * Where a source publishes a date and no clock time, event_time stays null.
 * The convention for what time a release "usually" lands is not a fact this
 * calendar is willing to assert.
 */

const MONTHS = Object.freeze({
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
});

export class SourceParseError extends Error {
  constructor(source, message) {
    super(`${source}: ${message}`);
    this.source = source;
  }
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const stripTags = html => String(html).replace(/<[^>]+>/g, ' ');
const collapse = text => String(text).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const cellText = cell => collapse(stripTags(cell));

function monthNumber(name) {
  const key = String(name || '').trim().slice(0, 3).toLowerCase();
  return MONTHS[key] || 0;
}

/** Every `<tr>` on the page, as arrays of cell text. */
function tableRows(html) {
  return [...String(html).matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(match =>
    [...match[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map(cell => cellText(cell[0]))
  );
}

/** "08:30 AM" → "08:30". Returns null for anything else, never a guess. */
export function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(collapse(value));
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/* ------------------------------------------------------------- FOMC ----- */

/**
 * The Fed lists each meeting as a month and a day range: "September 15-16".
 * A two-day meeting is one calendar event on its final day, because that is
 * when the decision lands; the first day is kept as metadata and never as a
 * second row. The page publishes no time, so none is stored.
 */
export function parseFomcSchedule(html, { year } = {}) {
  const text = collapse(stripTags(String(html)));
  if (!/FOMC/i.test(text)) throw new SourceParseError('federal-reserve', 'page no longer mentions the FOMC');

  // The page carries several years, and not in chronological order — the
  // tentative next year sits below the historical ones. Each heading owns the
  // text up to the next heading, whichever year that is.
  const headings = [...text.matchAll(/\b(20\d{2})\s+FOMC Meetings\b/gi)]
    .map(match => ({ year: Number(match[1]), index: match.index }))
    .sort((a, b) => a.index - b.index);
  if (!headings.length) throw new SourceParseError('federal-reserve', 'no meeting year headings found');

  const meetings = [];
  headings.forEach((heading, position) => {
    const until = position + 1 < headings.length ? headings[position + 1].index : text.length;
    let block = text.slice(heading.index, until);
    // Footnotes below the list mention dates that are not this year's meetings,
    // including next year's first one. They are notes, not schedule rows.
    const noteAt = block.search(/\bNote:/i);
    if (noteAt > 0) block = block.slice(0, noteAt);

    for (const match of block.matchAll(/\b([A-Z][a-z]+)\s+(\d{1,2})\s*[-–]\s*(?:([A-Z][a-z]+)\s+)?(\d{1,2})\b/g)) {
      const startMonth = monthNumber(match[1]);
      const startDay = Number(match[2]);
      const endMonth = match[3] ? monthNumber(match[3]) : startMonth;
      const endDay = Number(match[4]);
      if (!startMonth || !endMonth || !startDay || !endDay) continue;

      // A meeting runs forwards. Anything else is not a date range, and this
      // parser would rather miss a meeting than invent one.
      const crossesMonth = endMonth !== startMonth;
      if (!crossesMonth && endDay <= startDay) continue;
      const endYear = crossesMonth && endMonth < startMonth ? heading.year + 1 : heading.year;

      const startDate = realDate(heading.year, startMonth, startDay);
      const endDate = realDate(endYear, endMonth, endDay);
      if (!startDate || !endDate) continue;
      meetings.push({ date: endDate, startDate });
    }
  });

  const wanted = year ? meetings.filter(meeting => meeting.date.startsWith(`${Number(year)}-`)) : meetings;
  if (!wanted.length) {
    if (year) return [];
    throw new SourceParseError('federal-reserve', 'no meeting date ranges found');
  }
  // The Committee holds eight scheduled meetings a year. A year that parses
  // to wildly more or fewer means the page changed shape.
  if (year && (wanted.length < 6 || wanted.length > 10)) {
    throw new SourceParseError('federal-reserve', `${wanted.length} meetings parsed for ${year}, expected about eight`);
  }

  return wanted.map(meeting => ({
    eventDate: meeting.date,
    eventTime: null,
    timezone: 'America/New_York',
    market: 'US',
    category: 'monetary_policy',
    importance: 'high',
    titleKo: 'FOMC 금리결정',
    titleEn: 'FOMC Rate Decision',
    sourceType: 'official',
    sourceName: 'federal-reserve',
    sourceUrl: FOMC_URL,
    // A two-day meeting is one event, dated to the day the decision lands.
    // The first day is kept beside it rather than as a second row.
    sourceEventId: `fomc:${meeting.date}`,
    meta: { meetingStartDate: meeting.startDate }
  }));
}

/** Returns the ISO date only when it exists: no 31 February. */
function realDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return iso(year, month, day);
}

/* -------------------------------------------------------------- BLS ----- */

/**
 * The BLS schedule pages are one table: reference month, release date, release
 * time. The release time is published, so it is used as given.
 */
export function parseBlsSchedule(html, { series } = {}) {
  const spec = BLS_SERIES[series];
  if (!spec) throw new SourceParseError('bls', `unknown series: ${series}`);

  const rows = tableRows(html);
  if (!rows.length) throw new SourceParseError('bls', 'no table rows on the page');

  const events = [];
  for (const cells of rows) {
    if (cells.length < 3) continue;
    const [, releaseDate, releaseTime] = cells;
    const date = parseUsLongDate(releaseDate);
    if (!date) continue;
    events.push({
      eventDate: date,
      eventTime: parseClock(releaseTime),
      timezone: 'America/New_York',
      market: 'US',
      category: spec.category,
      importance: 'high',
      titleKo: spec.titleKo,
      titleEn: spec.titleEn,
      sourceType: 'official',
      sourceName: 'bls',
      sourceUrl: spec.url,
      sourceEventId: `${spec.slug}:${date}`,
      meta: { referenceMonth: cells[0] || '' }
    });
  }
  if (!events.length) throw new SourceParseError('bls', `no release dates parsed for ${series}`);
  return events;
}

/** "Dec. 18, 2025" or "December 18, 2025" → 2025-12-18. */
export function parseUsLongDate(value) {
  const match = /\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(20\d{2})\b/.exec(collapse(value));
  if (!match) return null;
  const month = monthNumber(match[1]);
  const day = Number(match[2]);
  if (!month || !day || day > 31) return null;
  return iso(Number(match[3]), month, day);
}

/* -------------------------------------------------------------- BEA ----- */

/**
 * The BEA schedule lists every release; only Personal Income and Outlays is
 * wanted, because that is the report PCE arrives in. Rows read
 * "September 30 8:30 AM | News | Personal Income and Outlays, August 2026",
 * so the year comes from the page heading rather than the row.
 */
export function parseBeaSchedule(html, { year } = {}) {
  const rows = tableRows(html);
  if (!rows.length) throw new SourceParseError('bea', 'no table rows on the page');

  const pageYear = Number(year) || beaScheduleYear(html);
  if (!pageYear) throw new SourceParseError('bea', 'could not determine the schedule year');

  const events = [];
  for (const cells of rows) {
    const line = cells.join(' | ');
    if (!/Personal Income and Outlays/i.test(line)) continue;

    const when = /\b([A-Z][a-z]+)\s+(\d{1,2})\b(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?/.exec(cells[0] || '');
    if (!when) continue;
    const month = monthNumber(when[1]);
    const day = Number(when[2]);
    if (!month || !day) continue;
    const date = iso(pageYear, month, day);

    events.push({
      eventDate: date,
      eventTime: parseClock(when[3] || ''),
      timezone: 'America/New_York',
      market: 'US',
      category: 'inflation',
      importance: 'high',
      titleKo: '미국 개인소비지출(PCE) 물가',
      titleEn: 'US Personal Income and Outlays (PCE)',
      sourceType: 'official',
      sourceName: 'bea',
      sourceUrl: BEA_URL,
      sourceEventId: `pce:${date}`,
      meta: { release: collapse(cells[cells.length - 1] || '') }
    });
  }
  if (!events.length) throw new SourceParseError('bea', 'no Personal Income and Outlays releases found');
  return events;
}

function beaScheduleYear(html) {
  const match = /\bYear\s+(20\d{2})\b/i.exec(collapse(stripTags(html)));
  return match ? Number(match[1]) : 0;
}

/* -------------------------------------------------- Bank of Korea ----- */

/**
 * The Bank of Korea lists its rate decisions as "01월 15일(목)" under a year
 * selected by query parameter, so the year comes from the request rather than
 * the row. No time is published on this page.
 *
 * A year the Board has not yet announced returns an empty page, which is a
 * real answer rather than a parse failure: nothing is scheduled yet.
 */
export function parseBokSchedule(html, { year } = {}) {
  const requestedYear = Number(year);
  if (!Number.isInteger(requestedYear)) throw new SourceParseError('bank-of-korea', 'year is required');

  const text = String(html);
  if (!/통화정책방향/.test(text)) throw new SourceParseError('bank-of-korea', 'page no longer mentions 통화정책방향');

  const events = [];
  const seen = new Set();
  for (const match of text.matchAll(/(\d{1,2})월\s?(\d{1,2})일\([월화수목금토일]\)/g)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (!month || month > 12 || !day || day > 31) continue;
    const date = iso(requestedYear, month, day);
    if (seen.has(date)) continue;
    seen.add(date);
    events.push({
      eventDate: date,
      eventTime: null,
      timezone: 'Asia/Seoul',
      market: 'KR',
      category: 'monetary_policy',
      importance: 'high',
      titleKo: '한국은행 금통위 통화정책방향 결정',
      titleEn: 'Bank of Korea Monetary Policy Decision',
      sourceType: 'official',
      sourceName: 'bank-of-korea',
      sourceUrl: bokUrl(requestedYear),
      sourceEventId: `bok:${date}`,
      meta: {}
    });
  }
  return events;
}

/* --------------------------------------------------------- endpoints ----- */

export const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const BEA_URL = 'https://www.bea.gov/news/schedule';
export const bokUrl = year =>
  `https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?menuNo=200755&mtgSe=A&pYear=${year}`;

export const BLS_SERIES = Object.freeze({
  cpi: {
    slug: 'cpi',
    category: 'inflation',
    titleKo: '미국 소비자물가지수(CPI)',
    titleEn: 'US Consumer Price Index',
    url: 'https://www.bls.gov/schedule/news_release/cpi.htm'
  },
  employment: {
    slug: 'nfp',
    category: 'employment',
    titleKo: '미국 고용보고서(비농업 고용)',
    titleEn: 'US Employment Situation',
    url: 'https://www.bls.gov/schedule/news_release/empsit.htm'
  }
});

/**
 * BLS refuses a request without a browser-shaped User-Agent, so every fetch
 * here identifies this site. A refusal must surface as a failure rather than
 * as an empty schedule.
 */
export const SOURCE_USER_AGENT =
  'Mozilla/5.0 (compatible; SnowshagalCalendarBot/1.0; +https://snowshagal.com)';

export const __test = { tableRows, cellText, monthNumber, beaScheduleYear, realDate };
