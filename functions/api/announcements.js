import {
  ANNOUNCEMENTS_TABLE,
  announcementDto,
  announcementErrorResponse,
  announcementJson,
  requireAnnouncementsDb
} from '../_announcements.js';

export async function onRequestGet({ request, env, now = new Date() }) {
  try {
    const db = await requireAnnouncementsDb(env);
    const url = new URL(request.url);
    const requestedType = String(url.searchParams.get('type') || '').trim();
    const typeFilter = requestedType === 'major' || requestedType === 'general' ? requestedType : '';
    const nowIso = now.toISOString();
    const sql = `SELECT * FROM ${ANNOUNCEMENTS_TABLE}
      WHERE publish_state = 'published'
        AND audience = 'all'
        AND exposure_start_at <= ?
        AND (exposure_end_at IS NULL OR exposure_end_at >= ?)
        ${typeFilter ? 'AND notice_type = ?' : ''}
      ORDER BY CASE notice_type WHEN 'major' THEN 0 ELSE 1 END, exposure_start_at DESC, updated_at DESC
      LIMIT 50`;
    const statement = db.prepare(sql);
    const result = typeFilter
      ? await statement.bind(nowIso, nowIso, typeFilter).all()
      : await statement.bind(nowIso, nowIso).all();
    const items = (result?.results || []).map(row => announcementDto(row, now));
    return announcementJson({ ok: true, items, count: items.length }, 200, {
      'cache-control': 'public, max-age=30, s-maxage=60'
    });
  } catch (error) {
    return announcementErrorResponse(error);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return announcementJson({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' });
  }
  return onRequestGet(context);
}
