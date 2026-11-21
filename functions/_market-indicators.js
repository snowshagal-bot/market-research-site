// The instruments that have a daily history page: /market/{slug}/ and
// /en/market/{slug}/ (functions/_market-date-page.js renders them, the
// sitemap lists them). `group` is the Market Close payload section holding the
// item; `kind` says what its value is:
//   krx      — KRX regular-session close, dated the KRX session
//   us       — the U.S. close the record carries, dated the U.S. session
//   fx       — the 15:30 KST reference rate (Hana Bank, via Naver Finance)
//   snapshot — the quote when the record was made, shortly after the Korea close
// The slug is always the code in lower case, so the dashboard can link to it.
export const MARKET_INDICATORS = Object.freeze([
  { code: 'KOSPI', group: 'indices', kind: 'krx' },
  { code: 'KOSDAQ', group: 'indices', kind: 'krx' },
  { code: 'NASDAQ', group: 'indices', kind: 'us' },
  { code: 'DOW', group: 'indices', kind: 'us' },
  { code: 'SP500', group: 'indices', kind: 'us' },
  { code: 'SOX', group: 'rates_fx_volatility', kind: 'us' },
  { code: 'VIX', group: 'rates_fx_volatility', kind: 'us' },
  { code: 'US10Y', group: 'rates_fx_volatility', kind: 'us' },
  { code: 'USDKRW', group: 'rates_fx_volatility', kind: 'fx' },
  { code: 'JPYKRW', group: 'rates_fx_volatility', kind: 'fx' },
  { code: 'DXY', group: 'rates_fx_volatility', kind: 'snapshot' },
  { code: 'WTI', group: 'commodities_crypto', kind: 'snapshot' },
  { code: 'GOLD', group: 'commodities_crypto', kind: 'snapshot' },
  { code: 'BITCOIN', group: 'commodities_crypto', kind: 'snapshot' }
].map(item => Object.freeze({ ...item, slug: item.code.toLowerCase() })));

const BY_SLUG = new Map(MARKET_INDICATORS.map(item => [item.slug, item]));
const BY_CODE = new Map(MARKET_INDICATORS.map(item => [item.code, item]));

export function marketIndicatorBySlug(slug) {
  return BY_SLUG.get(String(slug || '')) || null;
}

export function marketIndicatorPath(codeOrSlug, lang = 'ko') {
  const item = BY_CODE.get(codeOrSlug) || BY_SLUG.get(codeOrSlug);
  return item ? `${lang === 'en' ? '/en' : ''}/market/${item.slug}/` : null;
}
