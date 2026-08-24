import { TABLE_NAME, MarketDbError, ensureMarketTable, json } from './_shared.js';

export async function onRequestGet({ request, env }) {
  try {
    const db = await ensureMarketTable(env);
    const row = await db.prepare(`SELECT market_date, generated_at, payload_json FROM ${TABLE_NAME} ORDER BY market_date DESC LIMIT 1`).first();
    if (!row) return json({ error: 'NO_MARKET_DATA', message: '아직 게시된 Market Close 데이터가 없습니다.' }, 404, 'public, max-age=30, s-maxage=60');
    const etag = `W/"market-${row.market_date}-${String(row.generated_at).replace(/[^0-9]/g, '')}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300' } });
    let payload;
    try { payload = JSON.parse(row.payload_json); }
    catch (error) {
      console.error('stored market close payload is invalid', error);
      return json({ error: 'INVALID_STORED_DATA', message: '저장된 Market Close 데이터를 읽을 수 없습니다.' }, 500);
    }
    return json(payload, 200, 'public, max-age=30, s-maxage=120, stale-while-revalidate=300', { etag });
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close latest failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 데이터를 불러오지 못했습니다.' }, 500);
  }
}
