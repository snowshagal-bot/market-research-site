import { isValidMarketDate, json } from '../_shared.js';
import {
  DOMESTIC_RATES_SCHEMA_VERSION,
  DOMESTIC_RATES_TABLE,
  domesticRatesDayDto,
  domesticRatesErrorResponse,
  requireDomesticRatesDb
} from './_shared.js';

// A day's yields never change after KOFIA's afternoon publication (a rare
// correction excepted), but `latest` moves once a day: keep both short.
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

/**
 * GET /api/market/rates/date?date=YYYY-MM-DD | latest — one KRX trading
 * day's KOFIA yields as published, or the newest stored day. 404 when the date
 * has no row; 503 until the migration is applied.
 */
export async function onRequestGet({ request, env }) {
  const date = new URL(request.url).searchParams.get('date') || '';
  if (date !== 'latest' && !isValidMarketDate(date)) {
    return json({ error: 'INVALID_DATE', message: 'date는 YYYY-MM-DD 또는 latest여야 합니다.' }, 400);
  }
  try {
    const db = await requireDomesticRatesDb(env);
    const row = date === 'latest'
      ? await db.prepare(`SELECT market_date, basis_time, payload_json, published_at FROM ${DOMESTIC_RATES_TABLE} ORDER BY market_date DESC LIMIT 1`).first()
      : await db.prepare(`SELECT market_date, basis_time, payload_json, published_at FROM ${DOMESTIC_RATES_TABLE} WHERE market_date = ? LIMIT 1`).bind(date).first();
    const day = row ? domesticRatesDayDto(row) : null;
    if (!day) return json({ error: 'NOT_FOUND', message: '해당 날짜의 국내 금리가 없습니다.' }, 404, CACHE_CONTROL);
    return json({ schema_version: DOMESTIC_RATES_SCHEMA_VERSION, day }, 200, CACHE_CONTROL);
  } catch (error) {
    return domesticRatesErrorResponse(error);
  }
}
