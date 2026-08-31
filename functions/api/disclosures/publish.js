import {
  DisclosureError,
  authorizeAdmin,
  ensureDisclosureSchema,
  humanAdminHostAllowed,
  humanAdminMutationPolicy,
  json,
  setFilingPublishStatus
} from './_shared.js';

const MAX_BODY_BYTES = 1024;

export async function onRequestPost({ request, env }) {
  if (!humanAdminHostAllowed(request)) return json({ ok: false, error: 'ADMIN_HOST_BLOCKED' }, 403);
  if (!authorizeAdmin(request, env)) {
    return json({ ok: false, error: 'UNAUTHORIZED', message: '관리자 인증이 필요합니다.' }, 401);
  }
  const originPolicy = humanAdminMutationPolicy(request);
  if (!originPolicy.ok) return json({ ok: false, error: originPolicy.error, message: '허용되지 않은 관리자 Origin입니다.' }, 403);

  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > MAX_BODY_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);

  let raw = '';
  try { raw = await request.text(); }
  catch (_) { return json({ ok: false, error: 'INVALID_BODY' }, 400); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);

  let input = {};
  if (raw.trim()) {
    try { input = JSON.parse(raw); }
    catch (_) { return json({ ok: false, error: 'INVALID_JSON' }, 400); }
  }

  const rceptNo = String(input.rceptNo || '').trim();
  const action = String(input.action || 'publish').trim().toLowerCase();
  if (!/^\d{14}$/.test(rceptNo)) {
    return json({ ok: false, error: 'INVALID_RCEPT_NO', message: '올바른 접수번호(14자리)를 지정해 주세요.' }, 400);
  }
  if (action !== 'publish' && action !== 'unpublish') {
    return json({ ok: false, error: 'INVALID_ACTION', message: 'action은 publish 또는 unpublish 여야 합니다.' }, 400);
  }

  try {
    const db = await ensureDisclosureSchema(env);
    const targetStatus = action === 'publish' ? 'manual' : 'suppressed';
    const filing = await setFilingPublishStatus(db, rceptNo, targetStatus, new Date());
    return json({ ok: true, action, filing });
  } catch (error) {
    if (error instanceof DisclosureError) return json({ ok: false, error: error.code, message: error.message }, error.status);
    console.error('disclosure publish status update failed', error);
    return json({ ok: false, error: 'PUBLISH_FAILED', message: '게시 상태 변경에 실패했습니다.' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' });
  return onRequestPost(context);
}
