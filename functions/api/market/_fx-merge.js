/**
 * How a Market Close record's USD/KRW reads once FX Close exists
 * (contracts/fx_close/FX_CLOSE_CONTRACT.md). No imports, so both the Market
 * Close reader (./_shared.js) and the FX Close module (./fx/_shared.js) can use it.
 *
 * - The day has an FX Close row: USD/KRW is the Seoul FX market's 15:30 KST rate
 *   from the Bank of Korea ECOS, its move against the previous ECOS day.
 *   `basis: 'seoul_1530'`.
 * - FX Close is live but the day has no row yet (ECOS publishes after the
 *   record is final): the record's Hana Bank rate stays, marked provisional,
 *   its move within the bank series (normalizeKrwPairs). `basis: 'bank_provisional'`.
 * - FX Close is not there at all (the table missing, a failed read): the
 *   record as it was. `fxDay === undefined`.
 */
export const FX_CLOSE_SOURCE = '한국은행 ECOS 원/달러(종가 15:30)';

const finite = value => typeof value === 'number' && Number.isFinite(value);

/** The USD/KRW item of an FX Close day, or null. */
export function fxCloseUsdKrw(fxDay) {
  const item = Array.isArray(fxDay?.items) ? fxDay.items.find(entry => entry?.code === 'USDKRW') : null;
  return item && finite(item.value) && finite(item.previous_value) && item.previous_value > 0 ? item : null;
}

/**
 * `fxDay`: that date's FX Close day (the public DTO), null when FX Close has no
 * row for it, undefined when FX Close is unavailable. Mutates and returns `payload`.
 */
export function applyFxClose(payload, fxDay) {
  const rates = payload?.rates_fx_volatility;
  const record = rates?.USDKRW;
  if (!record || typeof record !== 'object' || fxDay === undefined) return payload;
  const date = String(payload?.meta?.market_date || '');
  const fx = fxDay && fxDay.market_date === date ? fxCloseUsdKrw(fxDay) : null;
  if (fx) {
    rates.USDKRW = {
      name: record.name,
      ticker: record.ticker,
      close: fx.value,
      previous_close: fx.previous_value,
      previous_date: fxDay.previous_date || null,
      change: fx.value - fx.previous_value,
      change_pct: (fx.value / fx.previous_value - 1) * 100,
      open: null,
      high: null,
      low: null,
      source_date: date,
      as_of: `${date}T15:30:00+09:00`,
      retrieved_at: fxDay.retrieved_at || record.retrieved_at || null,
      data_state: 'final_close',
      is_cached: false,
      source: fxDay.source || FX_CLOSE_SOURCE,
      basis: 'seoul_1530',
      // What the record itself carried, for anyone comparing the two.
      bank_rate: finite(record.close) ? record.close : null
    };
  } else if (finite(record.close)) {
    record.basis = 'bank_provisional';
  }
  return payload;
}

/** A short stamp of what USD/KRW reads as (for ETags and the share card key). */
export function fxCloseStamp(payload) {
  const usd = payload?.rates_fx_volatility?.USDKRW;
  if (usd?.basis === 'seoul_1530') return `fx${usd.close}`;
  if (usd?.basis === 'bank_provisional') return 'fxp';
  return '';
}
