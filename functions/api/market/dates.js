import { TABLE_NAME, MarketDbError, ensureMarketTable, fingerprint, json } from './_shared.js';

export async function onRequestGet({ request, env }) {
  try {
    const db = await ensureMarketTable(env);
    const result = await db.prepare(`SELECT market_date FROM ${TABLE_NAME} ORDER BY market_date DESC`).all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    const dates = rows.map(r => r.market_date).filter(Boolean);

    const latest = dates.length > 0 ? dates[0] : null;
    const earliest = dates.length > 0 ? dates[dates.length - 1] : null;

    const etag = `W/"market-dates-${fingerprint(dates.join(','))}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, 'cache-control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120' }
      });
    }

    const payload = {
      dates,
      latest,
      earliest
    };

    return json(payload, 200, 'public, max-age=30, s-maxage=60, stale-while-revalidate=120', { etag });
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close dates list failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 날짜 목록을 불러오지 못했습니다.' }, 500);
  }
}
