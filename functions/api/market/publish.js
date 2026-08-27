import { MAX_PAYLOAD_BYTES, MAX_TAKEAWAY_LENGTH, TABLE_NAME, MarketDbError, authorizePublish, ensureMarketTable, isProductionRequest, json, loadMarketSchema, validateMarketPayload } from './_shared.js';

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

  let body;
  try { body = JSON.parse(raw); }
  catch (_) { return json({ error: 'INVALID_JSON', message: '올바른 JSON 파일이 아닙니다.' }, 400); }

  // Either the bare Market Close document, or an envelope carrying the
  // editorial one-liner alongside it. The contract JSON stays untouched
  // either way, because it is machine-generated.
  const isEnvelope = Boolean(body && typeof body === 'object' && body.market && typeof body.market === 'object');
  const payload = isEnvelope ? body.market : body;
  const payloadText = isEnvelope ? JSON.stringify(payload) : raw;
  const takeaway = {
    ko: String(isEnvelope ? body.takeaway?.ko ?? '' : '').trim(),
    en: String(isEnvelope ? body.takeaway?.en ?? '' : '').trim()
  };
  for (const [lang, text] of Object.entries(takeaway)) {
    if (text.length > MAX_TAKEAWAY_LENGTH) {
      return json({ error: 'TAKEAWAY_TOO_LONG', message: `오늘의 한 줄(${lang})은 ${MAX_TAKEAWAY_LENGTH}자 이하여야 합니다.` }, 422);
    }
  }
  let schema;
  try { schema = await loadMarketSchema(request, env); }
  catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    return json({ error: 'SCHEMA_UNAVAILABLE', message: 'Market Close JSON Schema를 불러올 수 없습니다.' }, 500);
  }
  const validation = validateMarketPayload(payload, schema);
  if (!validation.passed) return json({ error: 'VALIDATION_FAILED', message: 'Market Close 데이터 계약 검증에 실패했습니다.', details: validation.errors }, 422);

  try {
    const db = await ensureMarketTable(env);
    const existing = await db.prepare(`SELECT market_date FROM ${TABLE_NAME} WHERE market_date = ? LIMIT 1`).bind(payload.meta.market_date).first();
    const latestBefore = await db.prepare(`SELECT market_date FROM ${TABLE_NAME} ORDER BY market_date DESC LIMIT 1`).first();
    const publishedAt = new Date().toISOString();
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(market_date) DO UPDATE SET
        schema_version = excluded.schema_version,
        generated_at = excluded.generated_at,
        status = excluded.status,
        payload_json = excluded.payload_json,
        published_at = excluded.published_at,
        auth_source = excluded.auth_source,
        takeaway_ko = excluded.takeaway_ko,
        takeaway_en = excluded.takeaway_en`)
      .bind(payload.meta.market_date, payload.meta.schema_version, payload.meta.generated_at, payload.meta.status, payloadText, publishedAt, authSource, takeaway.ko, takeaway.en).run();
    const isLatest = !latestBefore?.market_date || payload.meta.market_date >= latestBefore.market_date;
    return json({ ok: true, market_date: payload.meta.market_date, schema_version: payload.meta.schema_version, action: existing ? 'updated' : 'created', is_latest: isLatest, takeaway: { ko: Boolean(takeaway.ko), en: Boolean(takeaway.en) } }, existing ? 200 : 201);
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market close publish failed', error);
    return json({ error: 'PUBLISH_FAILED', message: 'Market Close 데이터를 저장하지 못했습니다.' }, 500);
  }
}
