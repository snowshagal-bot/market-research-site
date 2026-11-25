import { isValidMarketDate, json } from '../_shared.js';
import {
  MARKET_FUNDS_SCHEMA_VERSION,
  marketFundsDayDto,
  marketFundsErrorResponse,
  requireMarketFundsDb,
  selectMarketFundsDay
} from './_shared.js';

// A day's figures rarely change after KOFIA publishes them (a revision
// excepted), but `latest` moves once a day: keep both short.
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

/**
 * GET /api/market/funds/date?date=YYYY-MM-DD | latest — one KRX trading day's
 * KOFIA market funds as published, or the newest stored day. 404 when the date
 * has no row; 503 until the migration is applied.
 */
export async function onRequestGet({ request, env }) {
  const date = new URL(request.url).searchParams.get('date') || '';
  if (date !== 'latest' && !isValidMarketDate(date)) {
    return json({ error: 'INVALID_DATE', message: 'date는 YYYY-MM-DD 또는 latest여야 합니다.' }, 400);
  }
  try {
    const db = await requireMarketFundsDb(env);
    const row = await selectMarketFundsDay(db, date);
    const day = row ? marketFundsDayDto(row) : null;
    if (!day) return json({ error: 'NOT_FOUND', message: '해당 날짜의 증시 자금 자료가 없습니다.' }, 404, CACHE_CONTROL);
    return json({ schema_version: MARKET_FUNDS_SCHEMA_VERSION, day }, 200, CACHE_CONTROL);
  } catch (error) {
    return marketFundsErrorResponse(error);
  }
}
