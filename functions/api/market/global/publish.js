import { authorizePublish, isMarketWriteRequest, json } from '../_shared.js';
import {
  GLOBAL_LATEST_MAX_BYTES,
  GLOBAL_LATEST_TABLE,
  globalErrorResponse,
  planGlobalLatestWrites,
  requireGlobalLatestDb,
  upsertStatement,
  validateGlobalLatestDocument
} from './_shared.js';

/**
 * POST /api/market/global/publish — the Global Latest collector's upload.
 *
 * Same hosts and credentials as the Market Close publisher (Production or an
 * isolated branch Preview; MARKET_PUBLISH_KEY or an admin session). An
 * invalid document writes nothing (422). A valid one writes, in one D1 batch,
 * only the instruments whose observation is newer than the stored one; older
 * observations are skipped without error. An instrument the collector could
 * not read is simply absent from the request and keeps its stored row.
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const now = (context.now instanceof Date ? context.now : new Date()).getTime();
  if (!isMarketWriteRequest(request)) {
    return json({ error: 'WRITE_HOST_BLOCKED', message: 'Global Latest 게시는 Production 또는 격리된 branch Preview에서만 허용됩니다.' }, 403);
  }
  const authSource = await authorizePublish(request, env);
  if (!authSource) return json({ error: 'UNAUTHORIZED', message: '인증에 실패했습니다.' }, 401);

  if (Number(request.headers.get('content-length') || 0) > GLOBAL_LATEST_MAX_BYTES) {
    return json({ error: 'PAYLOAD_TOO_LARGE', message: '요청 본문이 허용 크기를 초과했습니다.' }, 413);
  }
  let raw;
  try { raw = await request.text(); }
  catch (_) { return json({ error: 'INVALID_BODY', message: '요청 본문을 읽을 수 없습니다.' }, 400); }
  if (new TextEncoder().encode(raw).byteLength > GLOBAL_LATEST_MAX_BYTES) {
    return json({ error: 'PAYLOAD_TOO_LARGE', message: '요청 본문이 허용 크기를 초과했습니다.' }, 413);
  }
  let document;
  try { document = JSON.parse(raw); }
  catch (_) { return json({ error: 'INVALID_JSON', message: '올바른 JSON이 아닙니다.' }, 400); }

  const validation = validateGlobalLatestDocument(document, now);
  if (!validation.passed) {
    return json({ error: 'VALIDATION_FAILED', message: 'Global Latest 데이터 계약 검증에 실패했습니다.', details: validation.errors }, 422);
  }

  try {
    const db = await requireGlobalLatestDb(env);
    const codes = validation.items.map(entry => entry.item.code);
    const placeholders = codes.map(() => '?').join(', ');
    const stored = await db.prepare(`SELECT code, as_of, retrieved_at, payload_json FROM ${GLOBAL_LATEST_TABLE} WHERE code IN (${placeholders})`)
      .bind(...codes).all();
    const plan = planGlobalLatestWrites(validation.items, stored?.results || []);
    const publishedAt = new Date(now).toISOString();
    if (plan.write.length) {
      await db.batch(plan.write.map(entry => upsertStatement(db, entry, publishedAt, authSource)));
    }
    return json({
      ok: true,
      schema_version: document.schema_version,
      received: validation.items.length,
      created: plan.created,
      updated: plan.updated,
      unchanged: plan.unchanged,
      skipped_older: plan.skipped_older,
      skipped_conflict: plan.skipped_conflict,
      published_at: plan.write.length ? publishedAt : null
    }, 200);
  } catch (error) {
    return globalErrorResponse(error);
  }
}
