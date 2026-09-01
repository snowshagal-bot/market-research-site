const CALENDAR_HOLIDAYS = Object.freeze({
  KRX: Object.freeze({
    // KRX closes on Korean public holidays, Labor Day and its year-end
    // closing day. Keep this explicit list in sync with the annual KRX/KASI
    // calendar before the first trading day of a new year.
    2026: Object.freeze([
      '2026-01-01',
      '2026-02-16', '2026-02-17', '2026-02-18',
      '2026-03-02',
      '2026-05-01', '2026-05-05', '2026-05-25',
      '2026-06-03',
      '2026-08-17',
      '2026-09-24', '2026-09-25',
      '2026-10-05', '2026-10-09',
      '2026-12-25', '2026-12-31'
    ])
  }),
  NYSE: Object.freeze({
    // NYSE 2026 full-day market holidays. Early-close sessions are trading
    // days and therefore are intentionally absent.
    2026: Object.freeze([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
      '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
      '2026-11-26', '2026-12-25'
    ])
  })
});

const SAME_DAY_RULES = Object.freeze([
  ['indices', ['KOSPI', 'KOSDAQ']],
  ['rates_fx_volatility', ['USDKRW', 'JPYKRW', 'DXY']],
  ['commodities_crypto', ['WTI', 'GOLD', 'BITCOIN']]
]);

const PREVIOUS_US_SESSION_RULES = Object.freeze([
  ['indices', ['NASDAQ', 'DOW', 'SP500']],
  ['rates_fx_volatility', ['SOX', 'VIX', 'US10Y']]
]);

function parseDate(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateString ? date : null;
}

function shiftDate(dateString, days) {
  const date = parseDate(dateString);
  if (!date) throw new Error(`Invalid market date: ${dateString}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarHolidays(market, year) {
  const dates = CALENDAR_HOLIDAYS[market]?.[year];
  if (!dates) throw new Error(`${market} trading calendar is not configured for ${year}`);
  return new Set(dates);
}

export function isTradingDate(dateString, market) {
  const date = parseDate(dateString);
  if (!date) throw new Error(`Invalid market date: ${dateString}`);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !calendarHolidays(market, date.getUTCFullYear()).has(dateString);
}

export function previousTradingDate(dateString, market) {
  let candidate = shiftDate(dateString, -1);
  for (let attempts = 0; attempts < 370; attempts += 1) {
    if (isTradingDate(candidate, market)) return candidate;
    candidate = shiftDate(candidate, -1);
  }
  throw new Error(`Unable to resolve previous ${market} trading date from ${dateString}`);
}

function kstParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    minutes: Number(value.hour) * 60 + Number(value.minute)
  };
}

export function expectedLatestKrxTradingDate(now = new Date(), closeGraceMinutes = 16 * 60 + 30) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Freshness check requires a valid current time.');
  const current = kstParts(now);
  if (isTradingDate(current.date, 'KRX') && current.minutes >= closeGraceMinutes) return current.date;
  return previousTradingDate(current.date, 'KRX');
}

function validateInstrument(payload, section, code, expectedDate, errors) {
  const item = payload?.[section]?.[code];
  const path = `$.${section}.${code}`;
  if (!item || typeof item !== 'object') {
    errors.push(`${path}: required freshness instrument is missing.`);
    return;
  }
  if (item.data_state === 'unavailable') errors.push(`${path}.data_state: unavailable data cannot be published as final.`);
  if (item.source_date !== expectedDate) {
    errors.push(`${path}.source_date: expected ${expectedDate}, received ${String(item.source_date || '(missing)')}.`);
  }
}

export function validateSourceFreshness(payload) {
  const errors = [];
  const marketDate = payload?.meta?.market_date;
  try {
    if (!parseDate(marketDate)) throw new Error(`Invalid market date: ${String(marketDate || '(missing)')}`);
    if (!isTradingDate(marketDate, 'KRX')) errors.push(`$.meta.market_date: ${marketDate} is not a KRX trading date.`);
    const previousUsSession = previousTradingDate(marketDate, 'NYSE');
    for (const [section, codes] of SAME_DAY_RULES) {
      for (const code of codes) validateInstrument(payload, section, code, marketDate, errors);
    }
    for (const [section, codes] of PREVIOUS_US_SESSION_RULES) {
      for (const code of codes) validateInstrument(payload, section, code, previousUsSession, errors);
    }
  } catch (error) {
    errors.push(`$.meta.market_date: ${error instanceof Error ? error.message : String(error)}.`);
  }
  return { passed: errors.length === 0, errors: Array.from(new Set(errors)).slice(0, 100) };
}

export function validateProductionFreshness(payload, now = new Date()) {
  const expected = expectedLatestKrxTradingDate(now);
  const actual = payload?.meta?.market_date;
  if (actual !== expected) {
    return {
      passed: false,
      expected,
      actual: typeof actual === 'string' ? actual : null,
      message: `Production market_date is stale: expected ${expected}, received ${String(actual || '(missing)')}`
    };
  }
  return { passed: true, expected, actual, message: 'Production market_date is current.' };
}

export const MARKET_CALENDAR_COVERAGE = Object.freeze({ KRX: [2026], NYSE: [2026] });
