import { MAX_PAYLOAD_BYTES, TABLE_NAME, MarketDbError, authorizePublish, ensureMarketTable, isProductionRequest, json, validateMarketPayload } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isProductionRequest(request)) return json({ error: 'PRODUCTION_ONLY', message: 'Market Close 게시는 Production에서만 허용됩니다.' }, 403);
  const authSource = authorizePublish(request, env);
  if (!authSource) return json({ error: 'UNAUTHORIZED', message: '인증에 실패했습니다.' }, 401);

  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > MAX_PAYLOAD_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE', message: 'JSON 파일이 허용 크기를 초과했습니다.' }, 413);

  let raw;
  try { raw = await request.text(); }
  catch (_) { return json({ error: 'INVALID_BODY', message: '요청 본문을 읽을 수 없습니다.' }, 400); }
  if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE', message: 'JSON 파일이 허용 크기를 초과했습니다.' }, 413);

  let payload;
  try { payload = JSON.parse(raw); }
  catch (_) { return json({ error: 'INVALID_JSON', message: '올바른 JSON 파일이 아닙니다.' }, 400); }
  const validation = validateMarketPayload(payload);
  if (!validation.passed) return json({ error: 'VALIDATION_FAILED', message: 'Market Close 데이터 계약 검증에 실패했습니다.', details: validation.errors }, 422);

  try {
    const db = await ensureMarketTable(env);
    const existing = await db.prepare(`SELECT market_date FROM ${TABLE_NAME} WHERE market_date = ? LIMIT 1`).bind(payload.meta.market_date).first();
    const latestBefore = await db.prepare(`SELECT market_date FROM ${TABLE_NAME} ORDER BY market_date DESC LIMIT 1`).first();
    const publishedAt = new Date().toISOString();
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(market_date) DO UPDATE SET
        schema_version = excluded.schema_version,
        generated_at = excluded.generated_at,
        status = excluded.status,
        payload_json = excluded.payload_json,
        published_at = excluded.published_at,
        auth_source = excluded.auth_source`)
      .bind(payload.meta.market_date, payload.meta.schema_version, payload.meta.generated_at, payload.meta.status, raw, publishedAt, authSource).run();
    const isLatest = !latestBefore?.market_date || payload.meta.market_date >= latestBefore.market_date;
    return json({ ok: true, market_date: payload.meta.market_date, schema_version: payload.meta.schema_version, action: existing ? 'updated' : 'created', is_latest: isLatest }, existing ? 200 : 201);
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close publish failed', error);
    return json({ error: 'PUBLISH_FAILED', message: 'Market Close 데이터를 저장하지 못했습니다.' }, 500);
  }
}
