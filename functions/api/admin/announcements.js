import { requireAdmin, requireAdminMutation, recordAuditEvent } from '../../_auth.js';
import {
  ANNOUNCEMENTS_TABLE,
  AnnouncementError,
  announcementDto,
  announcementErrorResponse,
  announcementJson,
  readAnnouncementJson,
  requireAnnouncementsDb,
  validAnnouncementId,
  validateAnnouncementInput
} from '../../_announcements.js';

function authError(result) {
  return announcementJson({ ok: false, error: result.error, message: result.message }, result.status);
}

async function listAnnouncements(request, env, now) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return authError(auth);
  const db = await requireAnnouncementsDb(env);
  const url = new URL(request.url);
  const query = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase('ko-KR');
  const type = String(url.searchParams.get('type') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim();
  const result = await db.prepare(`SELECT * FROM ${ANNOUNCEMENTS_TABLE} ORDER BY updated_at DESC, created_at DESC`).all();
  const allItems = (result?.results || []).map(row => announcementDto(row, now));
  const items = allItems.filter(item => {
    if (query && !item.title.toLocaleLowerCase('ko-KR').includes(query)) return false;
    if ((type === 'major' || type === 'general') && item.noticeType !== type) return false;
    if (['draft', 'scheduled', 'published', 'expired'].includes(status) && item.status !== status) return false;
    return true;
  });
  const counts = { all: allItems.length, major: 0, general: 0, draft: 0, scheduled: 0, published: 0, expired: 0 };
  for (const item of allItems) {
    counts[item.noticeType] += 1;
    counts[item.status] += 1;
  }
  return announcementJson({ ok: true, items, counts });
}

async function createAnnouncement(request, env, now) {
  const auth = await requireAdminMutation(request, env);
  if (!auth.ok) return authError(auth);
  const db = await requireAnnouncementsDb(env);
  const input = validateAnnouncementInput(await readAnnouncementJson(request));
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  const publishedAt = input.publishState === 'published' ? timestamp : null;
  await db.prepare(`INSERT INTO ${ANNOUNCEMENTS_TABLE} (
      id, notice_type, title, content, audience, target_group, publish_state,
      exposure_start_at, exposure_end_at, created_by, updated_by, created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id, input.noticeType, input.title, input.content, input.audience, input.targetGroup,
      input.publishState, input.exposureStartAt, input.exposureEndAt, auth.user.id, auth.user.id,
      timestamp, timestamp, publishedAt
    ).run();
  const row = await db.prepare(`SELECT * FROM ${ANNOUNCEMENTS_TABLE} WHERE id = ? LIMIT 1`).bind(id).first();
  await recordAuditEvent(env.AUTH_DB, {
    eventType: 'announcement.created',
    userId: auth.user.id,
    metadata: { announcementId: id, noticeType: input.noticeType, publishState: input.publishState }
  });
  return announcementJson({ ok: true, item: announcementDto(row, now) }, 201);
}

async function updateAnnouncement(request, env, now) {
  const auth = await requireAdminMutation(request, env);
  if (!auth.ok) return authError(auth);
  const db = await requireAnnouncementsDb(env);
  const body = await readAnnouncementJson(request);
  const id = validAnnouncementId(body.id);
  const existing = await db.prepare(`SELECT * FROM ${ANNOUNCEMENTS_TABLE} WHERE id = ? LIMIT 1`).bind(id).first();
  if (!existing) throw new AnnouncementError('NOT_FOUND', '공지를 찾을 수 없습니다.', 404);
  const input = validateAnnouncementInput(body);
  const timestamp = now.toISOString();
  const publishedAt = input.publishState === 'published'
    ? (existing.published_at || timestamp)
    : null;
  await db.prepare(`UPDATE ${ANNOUNCEMENTS_TABLE} SET
      notice_type = ?, title = ?, content = ?, audience = ?, target_group = ?, publish_state = ?,
      exposure_start_at = ?, exposure_end_at = ?, updated_by = ?, updated_at = ?, published_at = ?
    WHERE id = ?`)
    .bind(
      input.noticeType, input.title, input.content, input.audience, input.targetGroup,
      input.publishState, input.exposureStartAt, input.exposureEndAt, auth.user.id,
      timestamp, publishedAt, id
    ).run();
  const row = await db.prepare(`SELECT * FROM ${ANNOUNCEMENTS_TABLE} WHERE id = ? LIMIT 1`).bind(id).first();
  await recordAuditEvent(env.AUTH_DB, {
    eventType: 'announcement.updated',
    userId: auth.user.id,
    metadata: { announcementId: id, noticeType: input.noticeType, publishState: input.publishState }
  });
  return announcementJson({ ok: true, item: announcementDto(row, now) });
}

async function deleteAnnouncement(request, env) {
  const auth = await requireAdminMutation(request, env);
  if (!auth.ok) return authError(auth);
  const db = await requireAnnouncementsDb(env);
  const id = validAnnouncementId(new URL(request.url).searchParams.get('id'));
  const existing = await db.prepare(`SELECT id, notice_type, publish_state FROM ${ANNOUNCEMENTS_TABLE} WHERE id = ? LIMIT 1`).bind(id).first();
  if (!existing) throw new AnnouncementError('NOT_FOUND', '공지를 찾을 수 없습니다.', 404);
  await db.prepare(`DELETE FROM ${ANNOUNCEMENTS_TABLE} WHERE id = ?`).bind(id).run();
  await recordAuditEvent(env.AUTH_DB, {
    eventType: 'announcement.deleted',
    userId: auth.user.id,
    metadata: { announcementId: id, noticeType: existing.notice_type, publishState: existing.publish_state }
  });
  return announcementJson({ ok: true, deleted: true, id });
}

export async function onRequestGet({ request, env, now = new Date() }) {
  try { return await listAnnouncements(request, env, now); }
  catch (error) { return announcementErrorResponse(error); }
}

export async function onRequestPost({ request, env, now = new Date() }) {
  try { return await createAnnouncement(request, env, now); }
  catch (error) { return announcementErrorResponse(error); }
}

export async function onRequestPut({ request, env, now = new Date() }) {
  try { return await updateAnnouncement(request, env, now); }
  catch (error) { return announcementErrorResponse(error); }
}

export async function onRequestDelete({ request, env }) {
  try { return await deleteAnnouncement(request, env); }
  catch (error) { return announcementErrorResponse(error); }
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'PUT') return onRequestPut(context);
  if (context.request.method === 'DELETE') return onRequestDelete(context);
  return announcementJson({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST, PUT, DELETE' });
}
