import { isValidMarketDate, json } from '../_shared.js';
import {
  FX_CLOSE_SCHEMA_VERSION,
  fxCloseDayDto,
  fxCloseErrorResponse,
  requireFxCloseDb,
  selectFxCloseDay
} from './_shared.js';

// A day's rate rarely changes after ECOS publishes it (a revision excepted),
// but `latest` moves once a day: keep both short.
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300';

/**
 * GET /api/market/fx/date?date=YYYY-MM-DD | latest — one KRX trading day's
 * ECOS USD/KRW 15:30 rate as published, or the newest stored day. 404 when the date
 * has no row; 503 until the migration is applied.
 */
export async function onRequestGet({ request, env }) {
  const date = new URL(request.url).searchParams.get('date') || '';
  if (date !== 'latest' && !isValidMarketDate(date)) {
    return json({ error: 'INVALID_DATE', message: 'date는 YYYY-MM-DD 또는 latest여야 합니다.' }, 400);
  }
  try {
    const db = await requireFxCloseDb(env);
    const row = await selectFxCloseDay(db, date);
    const day = row ? fxCloseDayDto(row) : null;
    if (!day) return json({ error: 'NOT_FOUND', message: '해당 날짜의 원/달러 15:30 기준가가 없습니다.' }, 404, CACHE_CONTROL);
    return json({ schema_version: FX_CLOSE_SCHEMA_VERSION, day }, 200, CACHE_CONTROL);
  } catch (error) {
    return fxCloseErrorResponse(error);
  }
}
