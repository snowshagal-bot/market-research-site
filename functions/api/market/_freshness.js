import {
  CALENDAR_SUPPORTED_YEARS,
  expectedLatestKrxTradingDate,
  isTradingDate,
  parseDate,
  previousTradingDate
} from '../../_trading-calendar.js';

export {
  expectedLatestKrxTradingDate,
  isTradingDate,
  previousTradingDate
};

// Added 2026-11 and optional in 1.2.0: a payload recorded before them has no
// such key and stays valid. When the key is there, every rule applies.
export const OPTIONAL_GLOBAL_CODES = Object.freeze(['CNYKRW', 'EURKRW', 'USDJPY', 'BRENT', 'COMEX_COPPER', 'SILVER', 'NATGAS', 'VKOSPI']);
const OPTIONAL = new Set(OPTIONAL_GLOBAL_CODES);

/** False only for an optional indicator the payload does not carry at all. */
export function carriesInstrument(payload, section, code) {
  if (!OPTIONAL.has(code)) return true;
  const group = payload?.[section];
  return Boolean(group && typeof group === 'object' && Object.prototype.hasOwnProperty.call(group, code));
}

const SAME_DAY_RULES = Object.freeze([
  ['indices', ['KOSPI', 'KOSDAQ']],
  // VKOSPI: the KRX derivatives close (15:45 KST) of the session itself.
  ['rates_fx_volatility', ['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY', 'VKOSPI']],
  ['commodities_crypto', ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER', 'BITCOIN']]
]);

const PREVIOUS_US_SESSION_RULES = Object.freeze([
  ['indices', ['NASDAQ', 'DOW', 'SP500']],
  ['rates_fx_volatility', ['SOX', 'VIX', 'US10Y']]
]);

// Global / 24h indicators: a SOFT section in schema 1.2.0. KOSPI and KOSDAQ
// are HARD and are never exempt from the freshness rules.
export const GLOBAL_INDICATOR_SECTIONS = Object.freeze([
  ['indices', ['NASDAQ', 'DOW', 'SP500']],
  ['rates_fx_volatility', ['SOX', 'VIX', 'VKOSPI', 'US10Y', 'USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY']],
  ['commodities_crypto', ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER', 'BITCOIN']]
]);

// 1.2.0 only: indicators the payload itself declares unavailable. Their empty
// shape is checked by validateSectionStatus; freshness does not apply to a
// value that is deliberately absent.
function declaredUnavailable(payload) {
  if (payload?.meta?.schema_version !== '1.2.0') return new Set();
  const listed = payload?.section_status?.global_indicators?.unavailable;
  const globalCodes = new Set(GLOBAL_INDICATOR_SECTIONS.flatMap(([, codes]) => codes));
  return new Set(Array.isArray(listed) ? listed.filter(code => globalCodes.has(code)) : []);
}

function validateInstrument(payload, section, code, expectedDate, errors) {
  if (!carriesInstrument(payload, section, code)) return;
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
    const exempt = declaredUnavailable(payload);
    for (const [section, codes] of SAME_DAY_RULES) {
      for (const code of codes) if (!exempt.has(code)) validateInstrument(payload, section, code, marketDate, errors);
    }
    for (const [section, codes] of PREVIOUS_US_SESSION_RULES) {
      for (const code of codes) if (!exempt.has(code)) validateInstrument(payload, section, code, previousUsSession, errors);
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

// The years functions/_trading-calendar.js configures; other years fail closed.
export const MARKET_CALENDAR_COVERAGE = CALENDAR_SUPPORTED_YEARS;
