import {
  ensureEngagementSchema,
  isExcludedPath,
  json,
  languageForPath,
  normalizeCountry,
  normalizePath
} from './_engagement.js';

const MAX_PAYLOAD_BYTES = 2048;
const MAX_ACTIVE_MS = 12 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(message) {
  return json({ ok: false, error: 'INVALID_REQUEST', message }, 400);
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (url.hostname !== 'snowshagal.com') return json({ ok: false, error: 'NOT_FOUND' }, 404);
  if (!env?.COMMENTS_DB) return json({ ok: false, error: 'SERVER_NOT_CONFIGURED' }, 503);
  const origin = request.headers.get('origin');
  if (origin && origin !== 'https://snowshagal.com') return json({ ok: false, error: 'FORBIDDEN' }, 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return invalid('content-type은 application/json이어야 합니다.');

  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > MAX_PAYLOAD_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  let raw;
  try { raw = await request.text(); } catch (_) { return invalid('요청 본문을 읽을 수 없습니다.'); }
  if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);

  let payload;
  try { payload = JSON.parse(raw); } catch (_) { return invalid('JSON 형식이 올바르지 않습니다.'); }
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const path = normalizePath(payload.path);
  const activeMs = payload.active_ms;
  const maxScroll = payload.max_scroll;
  if (!UUID_PATTERN.test(sessionId)) return invalid('session_id 형식이 올바르지 않습니다.');
  if (!path) return invalid('path 형식이 올바르지 않습니다.');
  if (isExcludedPath(path)) return invalid('이 경로는 수집하지 않습니다.');
  if (!Number.isInteger(activeMs) || activeMs < 0 || activeMs > MAX_ACTIVE_MS) return invalid('active_ms 범위가 올바르지 않습니다.');
  if (!Number.isInteger(maxScroll) || maxScroll < 0 || maxScroll > 100) return invalid('max_scroll 범위가 올바르지 않습니다.');

  const timestamp = new Date().toISOString();
  const country = normalizeCountry(request.cf?.country);
  const lang = languageForPath(path);
  try {
    await ensureEngagementSchema(env.COMMENTS_DB);
    await env.COMMENTS_DB.prepare(`
      INSERT INTO engagement_sessions
        (session_id, path, country, lang, started_at, updated_at, active_ms, max_scroll)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        active_ms = MAX(engagement_sessions.active_ms, excluded.active_ms),
        max_scroll = MAX(engagement_sessions.max_scroll, excluded.max_scroll)
    `).bind(sessionId, path, country, lang, timestamp, timestamp, activeMs, maxScroll).run();
    return json({ ok: true }, 202);
  } catch (error) {
    console.error(JSON.stringify({ event: 'engagement_write_failed', message: error?.message || 'unknown' }));
    return json({ ok: false, error: 'ENGAGEMENT_WRITE_FAILED' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' });
  return onRequestPost(context);
}

export const __test = { MAX_ACTIVE_MS, MAX_PAYLOAD_BYTES, UUID_PATTERN };
