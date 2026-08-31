import {
  ensureAuthSchema,
  normalizeEmail,
  verifyPassword,
  generateToken,
  sha256Hex,
  createSessionCookie,
  getIpHash,
  checkRateLimit,
  recordRateLimitAttempt,
  recordAuditEvent,
  SESSION_TTL_MS
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

  // 2. DB availability
  if (!env?.AUTH_DB) {
    return reply({ error: 'AUTH_NOT_CONFIGURED', message: '인증 데이터베이스가 설정되지 않았습니다.' }, 503);
  }

  await ensureAuthSchema(env.AUTH_DB);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return reply({ error: 'BAD_JSON', message: '요청 데이터를 읽을 수 없습니다.' }, 400);
  }

  const rawEmail = String(body?.email || '');
  const rawPassword = String(body?.password || '');
  const email = normalizeEmail(rawEmail);

  if (!email || !rawPassword) {
    return reply({ error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);
  }

  const ipHash = await getIpHash(request, env.AUTH_PEPPER || '');
  const rateLimitKey = `login:${ipHash}:${email}`;

  // 3. Rate limit check
  const rateCheck = await checkRateLimit(env.AUTH_DB, rateLimitKey);
  if (!rateCheck.allowed) {
    await recordAuditEvent(env.AUTH_DB, {
      eventType: 'login_rate_limited',
      ipHash,
      metadata: { email }
    });
    return reply({
      error: 'RATE_LIMIT',
      message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    }, 429);
  }

  // 4. Query user & credential
  const row = await env.AUTH_DB.prepare(`
    SELECT
      u.id AS id,
      u.email AS email,
      u.email_normalized AS email_normalized,
      u.role AS role,
      u.status AS status,
      p.password_hash AS password_hash
    FROM users u
    LEFT JOIN password_credentials p ON p.user_id = u.id
    WHERE u.email_normalized = ?
    LIMIT 1
  `).bind(email).first();

  let valid = false;
  if (row && row.password_hash && row.status === 'active') {
    valid = await verifyPassword(rawPassword, row.password_hash);
  }

  if (!valid || !row) {
    await recordRateLimitAttempt(env.AUTH_DB, rateLimitKey, false);
    await recordAuditEvent(env.AUTH_DB, {
      eventType: 'login_failure',
      userId: row?.id || null,
      ipHash,
      metadata: { email, reason: !row ? 'user_not_found' : row.status !== 'active' ? 'disabled' : 'wrong_password' }
    });
    return reply({ error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);
  }

  if (row.role !== 'admin') {
    await recordRateLimitAttempt(env.AUTH_DB, rateLimitKey, false);
    await recordAuditEvent(env.AUTH_DB, {
      eventType: 'login_forbidden_role',
      userId: row.id,
      ipHash,
      metadata: { email, role: row.role }
    });
    return reply({ error: 'FORBIDDEN', message: '관리자 권한이 없는 계정입니다.' }, 403);
  }

  // 5. Success -> Clear rate limit, create session
  await recordRateLimitAttempt(env.AUTH_DB, rateLimitKey, true);

  const rawToken = generateToken(32);
  const csrfToken = generateToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await env.AUTH_DB.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(sessionId, row.id, tokenHash, csrfToken, now.toISOString(), expiresAt).run();

  await recordAuditEvent(env.AUTH_DB, {
    eventType: 'login_success',
    userId: row.id,
    ipHash,
    metadata: { email, sessionId }
  });

  const cookieHeader = createSessionCookie(rawToken);

  return reply(
    {
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        role: row.role
      },
      csrfToken
    },
    200,
    { 'set-cookie': cookieHeader }
  );
}
