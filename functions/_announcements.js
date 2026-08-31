export const ANNOUNCEMENTS_TABLE = 'admin_announcements';
export const MAX_ANNOUNCEMENT_BODY_BYTES = 64 * 1024;
export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 20000;
export const MAX_TARGET_GROUP_LENGTH = 100;

const NOTICE_TYPES = new Set(['major', 'general']);
const AUDIENCES = new Set(['all', 'group']);
const PUBLISH_STATES = new Set(['draft', 'published']);

export class AnnouncementError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function announcementJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

export async function requireAnnouncementsDb(env) {
  const db = env?.COMMENTS_DB;
  if (!db || typeof db.prepare !== 'function') {
    throw new AnnouncementError('DB_NOT_CONFIGURED', '공지 데이터베이스가 연결되지 않았습니다.', 503);
  }
  try {
    const table = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`
    ).bind(ANNOUNCEMENTS_TABLE).first();
    if (!table) {
      throw new AnnouncementError('ANNOUNCEMENT_SCHEMA_NOT_READY', '공지 데이터베이스 migration이 적용되지 않았습니다.', 503);
    }
  } catch (error) {
    if (error instanceof AnnouncementError) throw error;
    throw new AnnouncementError('ANNOUNCEMENT_SCHEMA_NOT_READY', '공지 데이터베이스 스키마를 확인할 수 없습니다.', 503);
  }
  return db;
}

function normalizedIso(value, fieldName, { nullable = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw && nullable) return null;
  if (!raw) throw new AnnouncementError('INVALID_INPUT', `${fieldName}은(는) 필수입니다.`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/.test(raw)) {
    throw new AnnouncementError('INVALID_INPUT', `${fieldName}은(는) UTC ISO 시각이어야 합니다.`);
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AnnouncementError('INVALID_INPUT', `${fieldName}이(가) 올바르지 않습니다.`);
  }
  return parsed.toISOString();
}

export function validateAnnouncementInput(input = {}) {
  const noticeType = String(input.noticeType || input.notice_type || '').trim();
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  const audience = String(input.audience || '').trim();
  const targetGroupRaw = String(input.targetGroup || input.target_group || '').trim();
  const publishState = String(input.publishState || input.publish_state || '').trim();
  const exposureStartAt = normalizedIso(input.exposureStartAt || input.exposure_start_at, '노출 시작 시각');
  const exposureEndAt = normalizedIso(input.exposureEndAt || input.exposure_end_at, '노출 종료 시각', { nullable: true });

  if (!NOTICE_TYPES.has(noticeType)) throw new AnnouncementError('INVALID_INPUT', '공지 유형이 올바르지 않습니다.');
  if (!title) throw new AnnouncementError('INVALID_INPUT', '제목은 필수입니다.');
  if (title.length > MAX_TITLE_LENGTH) throw new AnnouncementError('INVALID_INPUT', `제목은 ${MAX_TITLE_LENGTH}자 이하이어야 합니다.`);
  if (!content) throw new AnnouncementError('INVALID_INPUT', '본문은 필수입니다.');
  if (content.length > MAX_CONTENT_LENGTH) throw new AnnouncementError('INVALID_INPUT', `본문은 ${MAX_CONTENT_LENGTH}자 이하이어야 합니다.`);
  if (!AUDIENCES.has(audience)) throw new AnnouncementError('INVALID_INPUT', '대상이 올바르지 않습니다.');
  if (audience === 'group' && !targetGroupRaw) throw new AnnouncementError('INVALID_INPUT', '특정 그룹 대상 공지는 대상 그룹이 필요합니다.');
  if (targetGroupRaw.length > MAX_TARGET_GROUP_LENGTH) throw new AnnouncementError('INVALID_INPUT', `대상 그룹은 ${MAX_TARGET_GROUP_LENGTH}자 이하이어야 합니다.`);
  if (!PUBLISH_STATES.has(publishState)) throw new AnnouncementError('INVALID_INPUT', '저장 상태가 올바르지 않습니다.');
  if (exposureEndAt && exposureEndAt < exposureStartAt) {
    throw new AnnouncementError('INVALID_INPUT', '노출 종료 시각은 시작 시각보다 빠를 수 없습니다.');
  }

  return {
    noticeType,
    title,
    content,
    audience,
    targetGroup: audience === 'group' ? targetGroupRaw : null,
    publishState,
    exposureStartAt,
    exposureEndAt
  };
}

export function computedAnnouncementStatus(row, now = new Date()) {
  if (String(row?.publish_state || row?.publishState || '') !== 'published') return 'draft';
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startMs = new Date(row?.exposure_start_at || row?.exposureStartAt || '').getTime();
  const endRaw = row?.exposure_end_at || row?.exposureEndAt || null;
  const endMs = endRaw ? new Date(endRaw).getTime() : null;
  if (Number.isFinite(startMs) && nowMs < startMs) return 'scheduled';
  if (endMs !== null && Number.isFinite(endMs) && nowMs > endMs) return 'expired';
  return 'published';
}

export function announcementDto(row, now = new Date()) {
  return {
    id: row.id,
    noticeType: row.notice_type,
    title: row.title,
    content: row.content,
    audience: row.audience,
    targetGroup: row.target_group || null,
    publishState: row.publish_state,
    status: computedAnnouncementStatus(row, now),
    exposureStartAt: row.exposure_start_at,
    exposureEndAt: row.exposure_end_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || null
  };
}

export async function readAnnouncementJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_ANNOUNCEMENT_BODY_BYTES) {
    throw new AnnouncementError('PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.', 413);
  }
  if (!request.body) throw new AnnouncementError('INVALID_JSON', 'JSON 요청 본문이 필요합니다.');

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ANNOUNCEMENT_BODY_BYTES) {
      await reader.cancel();
      throw new AnnouncementError('PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.', 413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed;
  } catch (_) {
    throw new AnnouncementError('INVALID_JSON', '올바른 JSON object가 필요합니다.');
  }
}

export function validAnnouncementId(value) {
  const id = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new AnnouncementError('INVALID_ID', '공지 ID가 올바르지 않습니다.');
  }
  return id;
}

export function announcementErrorResponse(error) {
  if (error instanceof AnnouncementError) {
    return announcementJson({ ok: false, error: error.code, message: error.message }, error.status);
  }
  console.error('announcement request failed', error);
  return announcementJson({ ok: false, error: 'ANNOUNCEMENT_FAILED', message: '공지 요청을 처리하지 못했습니다.' }, 500);
}

export const __test = { NOTICE_TYPES, AUDIENCES, PUBLISH_STATES, normalizedIso };
