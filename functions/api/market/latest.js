import { TABLE_NAME, MarketDbError, ensureMarketTable, json } from './_shared.js';

export async function onRequestGet({ request, env }) {
  try {
    const db = await ensureMarketTable(env);
    const row = await db.prepare(`SELECT market_date, generated_at, published_at, payload_json, takeaway_ko, takeaway_en FROM ${TABLE_NAME} ORDER BY market_date DESC LIMIT 1`).first();
    if (!row) return json({ error: 'NO_MARKET_DATA', message: '아직 게시된 Market Close 데이터가 없습니다.' }, 404, 'public, max-age=30, s-maxage=60');
    // published_at is rewritten by every publish, so editing only the
    // one-liner still changes the tag; generated_at alone would not, because
    // the same Market Close document can be republished with a new line.
    // The lines themselves are folded in as well, since a Worker's clock can
    // read the same across two publishes and the tag must move regardless.
    const stamp = `${row.generated_at}|${row.published_at || ''}|${row.takeaway_ko || ''}|${row.takeaway_en || ''}`;
    const etag = `W/"market-${row.market_date}-${fingerprint(stamp)}"`;
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag, 'cache-control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=300' } });
    let payload;
    try { payload = JSON.parse(row.payload_json); }
    catch (error) {
      console.error('stored market close payload is invalid', error);
      return json({ error: 'INVALID_STORED_DATA', message: '저장된 Market Close 데이터를 읽을 수 없습니다.' }, 500);
    }
    // The one-liner travels with the session it describes, so a consumer can
    // never pair it with another date's numbers.
    payload.takeaway = { ko: String(row.takeaway_ko || ''), en: String(row.takeaway_en || '') };
    return json(payload, 200, 'public, max-age=30, s-maxage=120, stale-while-revalidate=300', { etag });
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close latest failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 데이터를 불러오지 못했습니다.' }, 500);
  }
}

// FNV-1a over the fields that decide whether a cached copy is stale. Not a
// security hash; it only has to change whenever its input does.
function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
