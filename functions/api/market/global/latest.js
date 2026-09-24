import { json } from '../_shared.js';
import {
  GLOBAL_LATEST_SCHEMA_VERSION,
  GLOBAL_LATEST_TABLE,
  globalErrorResponse,
  globalLatestDto,
  globalLatestEtag,
  orderRows,
  requireGlobalLatestDb
} from './_shared.js';

// Short enough to follow a 30-minute collector; the ETag answers revalidations.
const CACHE_CONTROL = 'public, max-age=30, s-maxage=60';

/**
 * GET /api/market/global/latest — every stored Global Latest observation, in
 * canonical order, exactly as published with its own timestamps. Freshness is
 * not judged here: an old row is returned with its old as_of for the page to
 * judge. An instrument never published is absent; an empty table is 200 with
 * no items, distinct from a missing table (503).
 */
export async function onRequestGet({ request, env }) {
  try {
    const db = await requireGlobalLatestDb(env);
    const result = await db.prepare(`SELECT code, as_of, retrieved_at, payload_json, published_at FROM ${GLOBAL_LATEST_TABLE}`).all();
    const rows = orderRows(result?.results || []);
    const etag = globalLatestEtag(rows);
    if (request.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': CACHE_CONTROL } });
    }
    const items = rows.map(globalLatestDto).filter(Boolean);
    return json({ schema_version: GLOBAL_LATEST_SCHEMA_VERSION, items }, 200, CACHE_CONTROL, { etag });
  } catch (error) {
    return globalErrorResponse(error);
  }
}
