import { TABLE_NAME, MarketDbError, ensureMarketTable, formatMarketResponse, json } from './_shared.js';

export async function onRequestGet({ request, env }) {
  try {
    const db = await ensureMarketTable(env);
    const row = await db.prepare(`SELECT market_date, generated_at, published_at, payload_json, takeaway_ko, takeaway_en FROM ${TABLE_NAME} ORDER BY market_date DESC LIMIT 1`).first();
    if (!row) return json({ error: 'NO_MARKET_DATA', message: '아직 게시된 Market Close 데이터가 없습니다.' }, 404, 'public, max-age=30, s-maxage=60');
    return formatMarketResponse(row, request);
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close latest failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 데이터를 불러오지 못했습니다.' }, 500);
  }
}
