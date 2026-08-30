import { TABLE_NAME, MarketDbError, ensureMarketTable, formatMarketResponse, isValidMarketDate, json } from './_shared.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    if (!isValidMarketDate(date)) {
      return json({ error: 'INVALID_DATE', message: '올바른 날짜 형식이 아닙니다 (YYYY-MM-DD).' }, 400);
    }

    const db = await ensureMarketTable(env);
    const row = await db.prepare(`SELECT market_date, generated_at, published_at, payload_json, takeaway_ko, takeaway_en FROM ${TABLE_NAME} WHERE market_date = ? LIMIT 1`).bind(date).first();
    if (!row) {
      return json({ error: 'MARKET_DATE_NOT_FOUND', message: '해당 날짜의 Market Close 데이터가 없습니다.' }, 404, 'public, max-age=30, s-maxage=60');
    }
    return formatMarketResponse(row, request);
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close date query failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 데이터를 불러오지 못했습니다.' }, 500);
  }
}
