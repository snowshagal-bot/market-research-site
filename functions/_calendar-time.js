/**
 * Turning a source-local event time into the one a Seoul reader sees.
 *
 * Events are stored exactly as their source published them: the date, the
 * time, and the zone that time is in. A Federal Reserve decision is
 * 2026-09-16 14:00 in America/New_York, and that is what the row says. It is
 * also 2026-09-17 03:00 in Asia/Seoul, and that is what the calendar shows —
 * the date moves, not only the clock, which is the whole reason this file
 * exists. A strip that put the FOMC on the 16th would put it on the wrong day
 * for every reader it has.
 *
 * The offset is never assumed. America/New_York is UTC-5 for part of the year
 * and UTC-4 for the rest, and the changeover dates move; the zone is resolved
 * through Intl with the IANA name, so daylight saving is handled by the
 * platform rather than by arithmetic here.
 *
 * An event with no published time keeps its date and gains none. There is no
 * hour at which an all-day event "really" happens, and inventing one would
 * also invent a date change across the line.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DISPLAY_TIMEZONE = 'Asia/Seoul';

const formatterCache = new Map();

function zoneFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }));
  }
  return formatterCache.get(timeZone);
}

function partsIn(instant, timeZone) {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
    utcMillis: Date.UTC(
      Number(value.year), Number(value.month) - 1, Number(value.day),
      Number(value.hour), Number(value.minute), Number(value.second)
    )
  };
}

/** How far the zone is from UTC at a given instant, in milliseconds. */
export function zoneOffsetMillis(instant, timeZone) {
  return partsIn(instant, timeZone).utcMillis - instant.getTime();
}

/**
 * The instant at which a wall-clock time in a named zone occurs.
 *
 * Read once to learn the offset, then again at the corrected instant, because
 * the first guess can land on the other side of a daylight-saving change.
 */
export function zonedWallClockToInstant(date, time, timeZone) {
  if (!ISO_DATE.test(String(date))) throw new Error(`date must be YYYY-MM-DD: ${date}`);
  if (!CLOCK.test(String(time))) throw new Error(`time must be HH:MM: ${time}`);
  const naive = Date.parse(`${date}T${time}:00Z`);
  let instant = naive;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = naive - zoneOffsetMillis(new Date(instant), timeZone);
  }
  return new Date(instant);
}

/**
 * The date and time a Seoul reader should see, and the day cell the event
 * belongs in.
 *
 * Returns the stored date unchanged when there is no time to convert: an
 * expiry or a holiday is a day in its own market, not an instant.
 */
export function toDisplayTime(event, displayTimeZone = DISPLAY_TIMEZONE) {
  const date = String(event?.date || event?.eventDate || '');
  const time = event?.time ?? event?.eventTime ?? null;
  const timeZone = String(event?.timezone || '') || DISPLAY_TIMEZONE;

  if (!ISO_DATE.test(date)) throw new Error(`event date must be YYYY-MM-DD: ${date}`);

  if (!time) {
    return { date, time: null, timezone: displayTimeZone, shifted: false, allDay: true };
  }
  if (!CLOCK.test(String(time))) throw new Error(`event time must be HH:MM or null: ${time}`);

  const instant = zonedWallClockToInstant(date, time, timeZone);
  const shown = partsIn(instant, displayTimeZone);
  return {
    date: shown.date,
    time: shown.time,
    timezone: displayTimeZone,
    // True when the reader's day differs from the source's day, which is the
    // case a monthly grid has to get right.
    shifted: shown.date !== date,
    allDay: false
  };
}

/**
 * Adds the display fields to a stored event without touching the stored ones.
 * The source values travel with it so a client can check the conversion, or
 * redo it for another zone.
 */
export function withDisplayTime(event, displayTimeZone = DISPLAY_TIMEZONE) {
  const display = toDisplayTime(event, displayTimeZone);
  return {
    ...event,
    source: { date: event.date, time: event.time ?? null, timezone: event.timezone },
    display: { date: display.date, time: display.time, timezone: display.timezone, shifted: display.shifted }
  };
}

/** Which day cell an event belongs in, once the reader's zone is applied. */
export function displayDate(event, displayTimeZone = DISPLAY_TIMEZONE) {
  return toDisplayTime(event, displayTimeZone).date;
}
