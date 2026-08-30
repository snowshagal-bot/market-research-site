import { TABLE_NAME, MarketDbError, ensureMarketTable, fingerprint, isValidMarketDate, json } from './_shared.js';
import { SUPPORTED_PERIODS, computeMarketRange } from './_aggregate.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const period = url.searchParams.get('period');

    if (!period || !Object.hasOwn(SUPPORTED_PERIODS, period)) {
      return json({ error: 'INVALID_PERIOD', message: '지원하지 않는 기간 형식입니다 (1w, 1m).' }, 400);
    }

    const requiredSessions = SUPPORTED_PERIODS[period];
    const end = url.searchParams.get('end');

    if (end !== null && end !== undefined && end !== '') {
      if (!isValidMarketDate(end)) {
        return json({ error: 'INVALID_DATE', message: '올바른 날짜 형식이 아닙니다 (YYYY-MM-DD).' }, 400);
      }
    }

    const db = await ensureMarketTable(env);
    let rows = [];

    if (end) {
      const result = await db.prepare(
        `SELECT market_date, generated_at, published_at, payload_json FROM ${TABLE_NAME} WHERE market_date <= ? ORDER BY market_date DESC LIMIT ?`
      ).bind(end, requiredSessions).all();
      rows = Array.isArray(result?.results) ? result.results : [];

      if (rows.length === 0 || rows[0].market_date !== end) {
        return json({ error: 'MARKET_DATE_NOT_FOUND', message: '해당 종료 날짜의 Market Close 데이터가 없습니다.' }, 404, 'public, max-age=30, s-maxage=60');
      }
    } else {
      const result = await db.prepare(
        `SELECT market_date, generated_at, published_at, payload_json FROM ${TABLE_NAME} ORDER BY market_date DESC LIMIT ?`
      ).bind(requiredSessions).all();
      rows = Array.isArray(result?.results) ? result.results : [];

      if (rows.length === 0) {
        return json({ error: 'NO_MARKET_DATA', message: '아직 게시된 Market Close 데이터가 없습니다.' }, 404, 'public, max-age=30, s-maxage=60');
      }
    }

    // Chronological ASC order for time-series aggregation
    const chronologicalRows = [...rows].reverse();

    const snapshots = [];
    for (const r of chronologicalRows) {
      try {
        snapshots.push(JSON.parse(r.payload_json));
      } catch (err) {
        console.error('Failed to parse snapshot payload in range query', err);
        return json({ error: 'INVALID_STORED_DATA', message: '저장된 Market Close 데이터를 읽을 수 없습니다.' }, 500);
      }
    }

    const aggregation = computeMarketRange(snapshots, period, requiredSessions);

    // ETag calculation based on period, dates, generated_at, and published_at
    const stamp = `range|${period}|${chronologicalRows.map(r => `${r.market_date}:${r.generated_at}:${r.published_at || ''}`).join('|')}`;
    const etag = `W/"market-range-${period}-${aggregation.window.start_date || 'none'}-${aggregation.window.end_date || 'none'}-${fingerprint(stamp)}"`;

    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, {
        status: 304,
        headers: { etag, 'cache-control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300' }
      });
    }

    return json(aggregation, 200, 'public, max-age=30, s-maxage=120, stale-while-revalidate=300', { etag });
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close range aggregation failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 집계 데이터를 불러오지 못했습니다.' }, 500);
  }
}
