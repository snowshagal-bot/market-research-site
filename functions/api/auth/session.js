import { getSession } from '../../_auth.js';

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0'
    }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env?.AUTH_DB) {
    return reply({ error: 'AUTH_NOT_CONFIGURED', message: '인증 데이터베이스가 설정되지 않았습니다.' }, 503);
  }

  const session = await getSession(request, env);
  if (!session || !session.authenticated) {
    return reply({ ok: true, authenticated: false }, 200);
  }

  return reply({
    ok: true,
    authenticated: true,
    user: {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role
    },
    csrfToken: session.session.csrfToken
  }, 200);
}
