// A realistic B3 situation: the KRX Market Close on screen is 2026-09-23
// (Chuseok follows), while Global Latest carries 2026-09-24/25 observations in
// every state the overlay has to judge. NOW is Friday 2026-09-25 15:30 New York
// (19:30Z, Saturday 04:30 KST).
import { readFile } from 'node:fs/promises';

export const MARKET_DATE = '2026-09-23';
export const NOW = new Date('2026-09-25T19:30:00Z');

const EXAMPLE = await readFile(new URL('../../contracts/market_close/market_close.example.v1.2.0.json', import.meta.url), 'utf8');

// Market Close 09-23 as the collector writes it: US figures are the 09-22
// closes, FX/commodities/crypto were captured with the KRX close.
const SNAPSHOT_GLOBALS = {
  indices: {
    NASDAQ: { close: 27244.277, previous_close: 27100.1, source_date: '2026-09-22', data_state: 'final_close' },
    DOW: { close: 51863.7, previous_close: 51700.2, source_date: '2026-09-22', data_state: 'final_close' },
    SP500: { close: 7764.64, previous_close: 7740.5, source_date: '2026-09-22', data_state: 'final_close' }
  },
  rates_fx_volatility: {
    SOX: { close: 12689.82, previous_close: 12600.4, source_date: '2026-09-22', data_state: 'final_close' },
    VIX: { close: 15.2, previous_close: 15.9, source_date: '2026-09-22', data_state: 'final_close' },
    US10Y: { close: 4.968, previous_close: 4.95, source_date: '2026-09-22', data_state: 'final_close' },
    USDKRW: { close: 1358.7, previous_close: 1361.2, source_date: '2026-09-23', data_state: 'intraday' },
    JPYKRW: { close: 861.63, previous_close: 862.4, source_date: '2026-09-23', data_state: 'intraday' },
    DXY: { close: 100.763, previous_close: 100.9, source_date: '2026-09-23', data_state: 'intraday' }
  },
  commodities_crypto: {
    WTI: { close: 90.29, previous_close: 91.1, source_date: '2026-09-23', data_state: 'intraday' },
    GOLD: { close: 4356.4, previous_close: 4330.1, source_date: '2026-09-23', data_state: 'intraday' },
    BITCOIN: { close: 86073.42, previous_close: 85500.3, source_date: '2026-09-23', data_state: 'intraday' }
  }
};

/** The Market Close payload for 2026-09-23 (contract 1.2.0). */
export function snapshot0923() {
  const payload = JSON.parse(EXAMPLE);
  payload.meta.market_date = MARKET_DATE;
  payload.meta.generated_at = '2026-09-23T14:22:10.818927+07:00';
  payload.indices.KOSPI = { ...payload.indices.KOSPI, close: 7080.92, previous_close: 7020.5, change: 60.42, change_pct: 0.860, source_date: MARKET_DATE, as_of: MARKET_DATE, retrieved_at: '2026-09-23T15:38:17.234239+09:00', data_state: 'final_close' };
  payload.indices.KOSDAQ = { ...payload.indices.KOSDAQ, close: 844.48, previous_close: 846.1, change: -1.62, change_pct: -0.191, source_date: MARKET_DATE, as_of: MARKET_DATE, retrieved_at: '2026-09-23T15:38:17.234239+09:00', data_state: 'final_close' };
  for (const [group, items] of Object.entries(SNAPSHOT_GLOBALS)) {
    for (const [code, figures] of Object.entries(items)) {
      const change = figures.close - figures.previous_close;
      payload[group][code] = {
        ...payload[group][code],
        ...figures,
        current: figures.close,
        change,
        change_pct: (figures.close / figures.previous_close - 1) * 100,
        as_of: figures.source_date,
        retrieved_at: '2026-09-23T15:46:41.295833+07:00'
      };
    }
  }
  return payload;
}

/** One Global Latest item with its change computed from value and previous close. */
export function latestItem(code, value, previousClose, fields) {
  const hasPrevious = previousClose !== null;
  return {
    code,
    ticker: code,
    value,
    previous_close: previousClose,
    change: hasPrevious ? value - previousClose : null,
    change_pct: hasPrevious ? (value / previousClose - 1) * 100 : null,
    source: 'Yahoo Finance',
    ...fields
  };
}

/**
 * Every judgement the overlay makes, at NOW:
 * fresh intraday (NASDAQ, VIX, USDKRW, JPYKRW), fresh final_close (US10Y 09-25,
 * SOX 09-24), stale intraday (SP500 > 60 min, GOLD > 90 min), future as_of
 * (DXY), malformed change (WTI), missing previous close (BITCOIN) and absent (DOW).
 */
export function globalLatest0925() {
  return [
    latestItem('NASDAQ', 27068.72, 26939.37, { source_date: '2026-09-25', as_of: '2026-09-25T19:15:59Z', retrieved_at: '2026-09-25T19:16:02Z', data_state: 'intraday' }),
    latestItem('SP500', 7743.41, 7704.13, { source_date: '2026-09-25', as_of: '2026-09-25T18:20:00Z', retrieved_at: '2026-09-25T18:20:03Z', data_state: 'intraday' }),
    latestItem('SOX', 12492.54, 12400.1, { source_date: '2026-09-24', as_of: '2026-09-24T20:00:00Z', retrieved_at: '2026-09-24T20:45:00Z', data_state: 'final_close' }),
    latestItem('VIX', 14.86, 15.67, { source_date: '2026-09-25', as_of: '2026-09-25T19:15:01Z', retrieved_at: '2026-09-25T19:16:02Z', data_state: 'intraday' }),
    latestItem('US10Y', 5.184, 5.162, { source_date: '2026-09-25', as_of: '2026-09-25T18:59:55Z', retrieved_at: '2026-09-25T19:29:40Z', data_state: 'final_close' }),
    latestItem('USDKRW', 1354.4, 1367.36, { source_date: '2026-09-25', as_of: '2026-09-25T19:10:31Z', retrieved_at: '2026-09-25T19:16:02Z', data_state: 'intraday' }),
    latestItem('JPYKRW', 860.1, 861.58, { source_date: '2026-09-25', as_of: '2026-09-25T19:09:11Z', retrieved_at: '2026-09-25T19:16:02Z', data_state: 'intraday' }),
    latestItem('DXY', 100.972, 101.29, { source_date: '2026-09-25', as_of: '2026-09-25T19:40:00Z', retrieved_at: '2026-09-25T19:40:02Z', data_state: 'intraday' }),
    { ...latestItem('WTI', 92.62, 94.61, { source_date: '2026-09-25', as_of: '2026-09-25T19:20:00Z', retrieved_at: '2026-09-25T19:20:03Z', data_state: 'intraday' }), change: 3.5 },
    latestItem('GOLD', 4327.8, 4298, { source_date: '2026-09-25', as_of: '2026-09-25T17:40:00Z', retrieved_at: '2026-09-25T17:40:03Z', data_state: 'intraday' }),
    latestItem('BITCOIN', 83933.47, null, { source_date: '2026-09-25', as_of: '2026-09-25T19:25:02Z', retrieved_at: '2026-09-25T19:25:05Z', data_state: 'intraday' })
  ];
}

/** What the overlay must decide for each code at NOW. */
export const EXPECTED_REASONS = {
  NASDAQ: 'fresh',
  SP500: 'stale',
  SOX: 'fresh',
  VIX: 'fresh',
  US10Y: 'fresh',
  USDKRW: 'fresh',
  JPYKRW: 'fresh',
  DXY: 'future',
  WTI: 'malformed',
  GOLD: 'stale',
  BITCOIN: 'malformed'
};
