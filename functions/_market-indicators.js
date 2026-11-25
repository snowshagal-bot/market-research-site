// The instruments that have a daily history page: /market/{slug}/ and
// /en/market/{slug}/ (functions/_market-date-page.js renders them, the
// sitemap lists them). `group` is the Market Close payload section holding the
// item; `kind` says what its value is:
//   krx      — KRX regular-session close, dated the KRX session
//   us       — the U.S. close the record carries, dated the U.S. session
//   fx       — the 15:30 KST reference rate (Hana Bank, via Naver Finance)
//   snapshot — the quote when the record was made, shortly after the Korea close
//   kofia    — the KOFIA final quote yield of the KRX session, 16:00 KST basis
//   krxvol   — a KRX derivatives index close (15:45 KST, the KOSPI 200 options
//              close), dated the KRX session: VKOSPI
//   asia     — an Asian index's local regular-session close (Tokyo, Shanghai,
//              Taipei), dated the local session: the latest one that ended on
//              or before the KRX date, so a local holiday carries the previous
//              close with its own date
//   funds    — a KOFIA FreeSIS end-of-day balance or amount of the KRX
//              session (KRW million), published the next business day
// The slug is the code in lower case, except COMEX_COPPER (copper) and the
// market funds (deposits, margin-loans, forced-selling);
// assets/market-close.js and assets/locale.js link with the same rule.
//
// `optional`: added in 2026-11 and optional in contract 1.2.0, so records made
// before them have no such key. Their pages are listed (sitemap, archive,
// related links) only once a final record has a value; until then the page
// itself is a 404 like any address without data.
//
// `domestic`: not in the Market Close payload at all. KOFIA computes these
// yields at 16:00 KST, after the record is final, so they are their own
// dataset (D1 market_domestic_rates, contracts/domestic_rates/), joined to the
// session by date. They are optional the same way: listed once a day is stored.
//
// `funds`: not in the Market Close payload either. KOFIA publishes a day's
// deposits, margin loans and forced selling on a later business day, so they
// are their own dataset too (D1 market_funds, contracts/market_funds/), listed
// once a day is stored.
const SLUG_EXCEPTIONS = Object.freeze({ COMEX_COPPER: 'copper', DEPOSITS: 'deposits', CREDIT: 'margin-loans', FORCED_SALE: 'forced-selling' });

export const MARKET_INDICATORS = Object.freeze([
  { code: 'KOSPI', group: 'indices', kind: 'krx' },
  { code: 'KOSDAQ', group: 'indices', kind: 'krx' },
  { code: 'NASDAQ', group: 'indices', kind: 'us' },
  { code: 'DOW', group: 'indices', kind: 'us' },
  { code: 'SP500', group: 'indices', kind: 'us' },
  { code: 'NIKKEI225', group: 'indices', kind: 'asia', optional: true },
  { code: 'SHANGHAI', group: 'indices', kind: 'asia', optional: true },
  { code: 'TAIEX', group: 'indices', kind: 'asia', optional: true },
  { code: 'SOX', group: 'rates_fx_volatility', kind: 'us' },
  { code: 'VIX', group: 'rates_fx_volatility', kind: 'us' },
  { code: 'VKOSPI', group: 'rates_fx_volatility', kind: 'krxvol', optional: true },
  { code: 'US10Y', group: 'rates_fx_volatility', kind: 'us' },
  { code: 'KTB3Y', group: 'domestic_rates', kind: 'kofia', optional: true, domestic: true },
  { code: 'KTB10Y', group: 'domestic_rates', kind: 'kofia', optional: true, domestic: true },
  { code: 'CORPAA3Y', group: 'domestic_rates', kind: 'kofia', optional: true, domestic: true },
  { code: 'CD91', group: 'domestic_rates', kind: 'kofia', optional: true, domestic: true },
  { code: 'DEPOSITS', group: 'market_funds', kind: 'funds', optional: true, funds: true },
  { code: 'CREDIT', group: 'market_funds', kind: 'funds', optional: true, funds: true },
  { code: 'FORCED_SALE', group: 'market_funds', kind: 'funds', optional: true, funds: true },
  { code: 'USDKRW', group: 'rates_fx_volatility', kind: 'fx' },
  { code: 'JPYKRW', group: 'rates_fx_volatility', kind: 'fx' },
  { code: 'CNYKRW', group: 'rates_fx_volatility', kind: 'fx', optional: true },
  { code: 'EURKRW', group: 'rates_fx_volatility', kind: 'fx', optional: true },
  { code: 'DXY', group: 'rates_fx_volatility', kind: 'snapshot' },
  { code: 'USDJPY', group: 'rates_fx_volatility', kind: 'snapshot', optional: true },
  { code: 'WTI', group: 'commodities_crypto', kind: 'snapshot' },
  { code: 'BRENT', group: 'commodities_crypto', kind: 'snapshot', optional: true },
  { code: 'NATGAS', group: 'commodities_crypto', kind: 'snapshot', optional: true },
  { code: 'GOLD', group: 'commodities_crypto', kind: 'snapshot' },
  { code: 'SILVER', group: 'commodities_crypto', kind: 'snapshot', optional: true },
  { code: 'COMEX_COPPER', group: 'commodities_crypto', kind: 'snapshot', optional: true },
  { code: 'BITCOIN', group: 'commodities_crypto', kind: 'snapshot' }
].map(item => Object.freeze({ optional: false, domestic: false, funds: false, ...item, slug: SLUG_EXCEPTIONS[item.code] || item.code.toLowerCase() })));

const BY_SLUG = new Map(MARKET_INDICATORS.map(item => [item.slug, item]));
const BY_CODE = new Map(MARKET_INDICATORS.map(item => [item.code, item]));
// The optional instruments the Market Close payload carries (not the domestic rates or funds).
const OPTIONAL_INDICATORS = MARKET_INDICATORS.filter(item => item.optional && !item.domestic && !item.funds);
export const DOMESTIC_RATE_INDICATORS = Object.freeze(MARKET_INDICATORS.filter(item => item.domestic));
export const MARKET_FUND_INDICATORS = Object.freeze(MARKET_INDICATORS.filter(item => item.funds));

export function marketIndicatorBySlug(slug) {
  return BY_SLUG.get(String(slug || '')) || null;
}

export function marketIndicatorPath(codeOrSlug, lang = 'ko') {
  const item = BY_CODE.get(codeOrSlug) || BY_SLUG.get(codeOrSlug);
  return item ? `${lang === 'en' ? '/en' : ''}/market/${item.slug}/` : null;
}

export function isOptionalIndicator(code) {
  return Boolean(BY_CODE.get(code)?.optional);
}

export function isDomesticRateIndicator(code) {
  return Boolean(BY_CODE.get(code)?.domestic);
}

export function isMarketFundIndicator(code) {
  return Boolean(BY_CODE.get(code)?.funds);
}

// One SQL column holding the optional indicators' closes for a row, as a JSON
// array in OPTIONAL_INDICATORS order (json_extract with several paths). Built
// from the fixed list above, never from a request.
export const OPTIONAL_INDICATOR_CLOSES_SQL = `json_extract(payload_json, ${OPTIONAL_INDICATORS.map(item => `'$.${item.group}.${item.code}.close'`).join(', ')})`;

/**
 * The codes that have a page, from rows carrying `optional_closes`: every
 * original indicator, and an optional one once some row has its value.
 * `rateCodes`: the domestic rate and market fund codes some stored day has a
 * value for (loadDomesticRateCodes, loadMarketFundCodes), which Market Close
 * rows cannot tell.
 */
export function availableIndicatorCodes(rows, rateCodes = []) {
  const codes = new Set(MARKET_INDICATORS.filter(item => !item.optional).map(item => item.code));
  for (const code of rateCodes || []) if (isDomesticRateIndicator(code) || isMarketFundIndicator(code)) codes.add(code);
  for (const row of Array.isArray(rows) ? rows : []) {
    let closes = row?.optional_closes;
    if (typeof closes === 'string') {
      try { closes = JSON.parse(closes); } catch (_) { closes = null; }
    }
    if (!Array.isArray(closes)) continue;
    OPTIONAL_INDICATORS.forEach((item, index) => {
      if (typeof closes[index] === 'number' && Number.isFinite(closes[index])) codes.add(item.code);
    });
    if (codes.size === MARKET_INDICATORS.length) break;
  }
  return codes;
}

/** MARKET_INDICATORS without the optional ones that have no page yet. */
export function listedIndicators(available) {
  return MARKET_INDICATORS.filter(item => !item.optional || Boolean(available?.has(item.code)));
}
