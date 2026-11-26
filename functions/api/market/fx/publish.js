import { authorizePublish, isMarketWriteRequest, json } from '../_shared.js';
import {
  FX_CLOSE_MAX_BYTES,
  FX_CLOSE_TABLE,
  fxCloseErrorResponse,
  planFxCloseWrites,
  requireFxCloseDb,
  upsertStatement,
  validateFxCloseDocument
} from './_shared.js';

/**
 * POST /api/market/fx/publish — the collector's ECOS USD/KRW 15:30 rates, one or
 * more KRX trading days (a backfill carries up to 60).
 *
 * Same hosts and credentials as Market Close, Domestic Rates and Market Funds (Production or
 * an isolated branch Preview; MARKET_PUBLISH_KEY or an admin session). An
 * invalid document writes nothing (422). A valid one writes, in one D1 batch,
 * the days that are new or carry different figures read later than the stored
 * ones (contracts/fx_close/FX_CLOSE_CONTRACT.md).
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const now = (context.now instanceof Date ? context.now : new Date()).getTime();
  if (!isMarketWriteRequest(request)) {
    return json({ error: 'WRITE_HOST_BLOCKED', message: '원/달러 15:30 기준가 게시는 Production 또는 격리된 branch Preview에서만 허용됩니다.' }, 403);
  }
  const authSource = await authorizePublish(request, env);
  if (!authSource) return json({ error: 'UNAUTHORIZED', message: '인증에 실패했습니다.' }, 401);

  if (Number(request.headers.get('content-length') || 0) > FX_CLOSE_MAX_BYTES) {
    return json({ error: 'PAYLOAD_TOO_LARGE', message: '요청 본문이 허용 크기를 초과했습니다.' }, 413);
  }
  let raw;
  try { raw = await request.text(); }
  catch (_) { return json({ error: 'INVALID_BODY', message: '요청 본문을 읽을 수 없습니다.' }, 400); }
  if (new TextEncoder().encode(raw).byteLength > FX_CLOSE_MAX_BYTES) {
    return json({ error: 'PAYLOAD_TOO_LARGE', message: '요청 본문이 허용 크기를 초과했습니다.' }, 413);
  }
  let document;
  try { document = JSON.parse(raw); }
  catch (_) { return json({ error: 'INVALID_JSON', message: '올바른 JSON이 아닙니다.' }, 400); }

  const validation = validateFxCloseDocument(document, now);
  if (!validation.passed) {
    return json({ error: 'VALIDATION_FAILED', message: '원/달러 15:30 기준가 데이터 계약 검증에 실패했습니다.', details: validation.errors }, 422);
  }

  try {
    const db = await requireFxCloseDb(env);
    const dates = validation.days.map(entry => entry.day.market_date);
    const placeholders = dates.map(() => '?').join(', ');
    const stored = await db.prepare(`SELECT market_date, retrieved_at, payload_json FROM ${FX_CLOSE_TABLE} WHERE market_date IN (${placeholders})`)
      .bind(...dates).all();
    const plan = planFxCloseWrites(validation.days, stored?.results || []);
    const publishedAt = new Date(now).toISOString();
    if (plan.write.length) {
      await db.batch(plan.write.map(entry => upsertStatement(db, entry, publishedAt, authSource)));
    }
    return json({
      ok: true,
      schema_version: document.schema_version,
      received: validation.days.length,
      created: plan.created,
      updated: plan.updated,
      unchanged: plan.unchanged,
      skipped_older: plan.skipped_older,
      published_at: plan.write.length ? publishedAt : null
    }, 200);
  } catch (error) {
    return fxCloseErrorResponse(error);
  }
}
