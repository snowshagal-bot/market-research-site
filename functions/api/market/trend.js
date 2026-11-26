import { TABLE_NAME, MarketDbError, ensureMarketTable, fingerprint, isValidMarketDate, json } from './_shared.js';
import { DOMESTIC_RATES_TABLE, DOMESTIC_RATE_CODES, domesticRatesDayDto } from './rates/_shared.js';
import { loadFxCloseValues } from './fx/_shared.js';

/**
 * GET /api/market/trend[?end=YYYY-MM-DD]: the small trend lines on /market/.
 *
 * The last TREND_SESSIONS final sessions up to `end` (default: the newest),
 * oldest first, and each instrument's close in each of them (null where that
 * record has none: an unavailable item, or one added after that session).
 * KOFIA yields of the same dates come from their own table and fail soft.
 *
 * One query of json_extract columns, so no payload leaves D1 whole. The paths
 * come from the fixed list below, never from the request.
 */
export const TREND_SESSIONS = 20;
export const TREND_GROUPS = Object.freeze([
  ['indices', ['KOSPI', 'KOSDAQ', 'NASDAQ', 'DOW', 'SP500', 'NIKKEI225', 'SHANGHAI', 'TAIEX']],
  ['rates_fx_volatility', ['SOX', 'VIX', 'VKOSPI', 'US10Y', 'USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY']],
  ['commodities_crypto', ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER', 'BITCOIN']]
]);
export const TREND_CODES = Object.freeze(TREND_GROUPS.flatMap(([, codes]) => codes));

const COLUMNS = TREND_GROUPS
  .flatMap(([group, codes]) => codes.map(code => `json_extract(payload_json, '$.${group}.${code}.close') AS "${code}"`))
  .join(', ');

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

async function domesticRateSeries(db, dates) {
  const series = Object.fromEntries(DOMESTIC_RATE_CODES.map(code => [code, dates.map(() => null)]));
  if (!dates.length) return series;
  try {
    const placeholders = dates.map(() => '?').join(', ');
    const result = await db.prepare(`SELECT market_date, basis_time, payload_json, published_at FROM ${DOMESTIC_RATES_TABLE} WHERE market_date IN (${placeholders})`)
      .bind(...dates).all();
    const index = new Map(dates.map((date, position) => [date, position]));
    for (const row of result?.results || []) {
      const day = domesticRatesDayDto(row);
      const position = index.get(day?.market_date);
      if (position === undefined) continue;
      for (const item of day.items || []) {
        if (series[item?.code]) series[item.code][position] = finite(item.value);
      }
    }
  } catch (error) {
    // A missing table (migration not applied) or a failing query: no yields, the rest stands.
    console.error('market trend: domestic rates unavailable', error);
  }
  return series;
}

/**
 * The trend body for the sessions up to `end` (or the newest): also used by
 * the server-rendered session pages. Throws on a database failure.
 */
export async function loadTrend(db, end = null) {
  const where = end ? `status = 'final' AND market_date <= ?` : `status = 'final'`;
  const statement = db.prepare(`SELECT market_date, ${COLUMNS} FROM ${TABLE_NAME} WHERE ${where} ORDER BY market_date DESC LIMIT ${TREND_SESSIONS}`);
  const result = await (end ? statement.bind(end) : statement).all();
  const rows = (Array.isArray(result?.results) ? result.results : [])
    .filter(row => isValidMarketDate(String(row?.market_date || '')))
    .reverse();
  const dates = rows.map(row => row.market_date);
  const series = Object.fromEntries(TREND_CODES.map(code => [code, rows.map(row => finite(row[code]))]));
  Object.assign(series, await domesticRateSeries(db, dates));
  // USD/KRW: the ECOS 15:30 rates once FX Close holds any. A session without one
  // yet (the evening before ECOS publishes) has no point, never the bank rate.
  const fx = await loadFxCloseValues(db, dates);
  if (fx && fx.size) series.USDKRW = dates.map(date => fx.get(date) ?? null);
  return { sessions: TREND_SESSIONS, end_date: dates[dates.length - 1] || null, dates, series };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const end = url.searchParams.get('end');
  if (end !== null && !isValidMarketDate(end)) {
    return json({ error: 'INVALID_DATE', message: 'end는 YYYY-MM-DD 형식이어야 합니다.' }, 400);
  }
  try {
    const db = await ensureMarketTable(env, { readOnly: true });
    const body = await loadTrend(db, end);
    const etag = `W/"market-trend-${fingerprint(JSON.stringify(body))}"`;
    const cacheControl = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': cacheControl } });
    }
    return json(body, 200, cacheControl, { etag });
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market trend failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 추이를 불러오지 못했습니다.' }, 500);
  }
}
