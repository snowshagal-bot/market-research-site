import {
  DisclosureError,
  addWatchlistCompany,
  authorizeAdmin,
  ensureDisclosureSchema,
  getWatchlist,
  humanAdminHostAllowed,
  humanAdminMutationPolicy,
  json,
  removeWatchlistCompany,
  toggleWatchlistActive
} from './_shared.js';

const MAX_BODY_BYTES = 2048;

export async function onRequestGet({ request, env }) {
  if (!humanAdminHostAllowed(request)) return json({ ok: false, error: 'ADMIN_HOST_BLOCKED' }, 403);
  if (!(await authorizeAdmin(request, env))) {
    return json({ ok: false, error: 'UNAUTHORIZED', message: '관리자 인증이 필요합니다.' }, 401);
  }

  try {
    const db = await ensureDisclosureSchema(env);
    const watchlist = await getWatchlist(db);
    return json({ ok: true, watchlist });
  } catch (error) {
    if (error instanceof DisclosureError) return json({ ok: false, error: error.code, message: error.message }, error.status);
    console.error('get watchlist failed', error);
    return json({ ok: false, error: 'READ_FAILED', message: '관심기업 목록을 불러오지 못했습니다.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!humanAdminHostAllowed(request)) return json({ ok: false, error: 'ADMIN_HOST_BLOCKED' }, 403);
  if (!(await authorizeAdmin(request, env))) {
    return json({ ok: false, error: 'UNAUTHORIZED', message: '관리자 인증이 필요합니다.' }, 401);
  }
  const originPolicy = await humanAdminMutationPolicy(request, env);
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

  const action = String(input.action || 'add').trim().toLowerCase();
  try {
    const db = await ensureDisclosureSchema(env);
    if (action === 'add') {
      const result = await addWatchlistCompany(db, {
        stockCode: input.stockCode,
        corpCode: input.corpCode,
        corpName: input.corpName,
        corpCls: input.corpCls,
        sortOrder: input.sortOrder
      });
      const watchlist = await getWatchlist(db);
      return json({ ok: true, action: 'add', result, watchlist });
    }

    if (action === 'delete' || action === 'remove') {
      const result = await removeWatchlistCompany(db, input.stockCode);
      const watchlist = await getWatchlist(db);
      return json({ ok: true, action: 'delete', result, watchlist });
    }

    if (action === 'toggle') {
      const result = await toggleWatchlistActive(db, input.stockCode, input.active);
      const watchlist = await getWatchlist(db);
      return json({ ok: true, action: 'toggle', result, watchlist });
    }

    return json({ ok: false, error: 'INVALID_ACTION', message: '지원하지 않는 action입니다. (add, delete, toggle)' }, 400);
  } catch (error) {
    if (error instanceof DisclosureError) return json({ ok: false, error: error.code, message: error.message }, error.status);
    console.error('watchlist operation failed', error);
    return json({ ok: false, error: 'OPERATION_FAILED', message: '관심기업 처리에 실패했습니다.' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' });
}
