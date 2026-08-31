import {
  getSession,
  clearSessionCookie,
  constantTimeEqual,
  recordAuditEvent,
  getIpHash
} from '../../_auth.js';
import { validateHumanAdminMutation } from '../../_host-policy.js';

function reply(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      ...headers
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1. Origin verification
  const originPolicy = validateHumanAdminMutation(request);
  if (!originPolicy.ok) {
    return reply({ error: originPolicy.error, message: '허용되지 않은 관리자 Origin입니다.' }, 403);
  }

  const cookieHeader = clearSessionCookie();

  if (!env?.AUTH_DB) {
    return reply({ ok: true }, 200, { 'set-cookie': cookieHeader });
  }

  const session = await getSession(request, env);
  if (session && session.authenticated) {
    // Verify CSRF if active session
    const suppliedCsrf = request.headers.get('x-csrf-token') || '';
    if (!suppliedCsrf || !constantTimeEqual(suppliedCsrf, session.session.csrfToken)) {
      return reply({ error: 'CSRF_INVALID', message: 'CSRF 토큰이 유효하지 않습니다.' }, 403);
    }

    const nowIso = new Date().toISOString();
    await env.AUTH_DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE id = ?`
    ).bind(nowIso, session.session.id).run();

    let ipHash = null;
    if (env?.AUTH_PEPPER) {
      ipHash = await getIpHash(request, env.AUTH_PEPPER);
    }
    await recordAuditEvent(env.AUTH_DB, {
      eventType: 'logout',
      userId: session.user.id,
      ipHash,
      metadata: { sessionId: session.session.id }
    });
  }

  return reply({ ok: true }, 200, { 'set-cookie': cookieHeader });
}
