import {
  validateAuthSchema,
  normalizeEmail,
  verifyPassword,
  generateToken,
  sha256Hex,
  createSessionCookie,
  getIpHash,
  checkLoginRateLimits,
  recordLoginFailure,
  clearLoginRateLimits,
  recordAuditEvent,
  DUMMY_PBKDF2_HASH,
  SESSION_TTL_MS,
  MAX_LOGIN_BODY_BYTES,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH
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

  const schemaCheck = await validateAuthSchema(env.AUTH_DB);
  if (!schemaCheck.ready) {
    return reply({ error: schemaCheck.error, message: schemaCheck.message }, 503);
  }

  // 3. Body size and JSON parsing
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_LOGIN_BODY_BYTES) {
    return reply({ error: 'PAYLOAD_TOO_LARGE', message: '요청 크기가 허용 범위를 초과했습니다.' }, 413);
  }

  let rawText;
  try {
    rawText = await request.text();
  } catch (_) {
    return reply({ error: 'INVALID_BODY', message: '요청 본문을 읽을 수 없습니다.' }, 400);
  }

  if (new TextEncoder().encode(rawText).byteLength > MAX_LOGIN_BODY_BYTES) {
    return reply({ error: 'PAYLOAD_TOO_LARGE', message: '요청 크기가 허용 범위를 초과했습니다.' }, 413);
  }

  let body;
  try {
    body = JSON.parse(rawText);
  } catch (_) {
    return reply({ error: 'BAD_JSON', message: '요청 데이터를 읽을 수 없습니다.' }, 400);
  }

  const rawEmail = String(body?.email || '');
  const rawPassword = String(body?.password || '');
  const email = normalizeEmail(rawEmail);

  const ipHash = await getIpHash(request, env.AUTH_PEPPER || '');
  const emailHash = await sha256Hex(email || 'empty');

  // 4. Rate limit check (dual bucket: IP-only and IP+Email)
  const rateCheck = await checkLoginRateLimits(env.AUTH_DB, ipHash, emailHash);
  if (!rateCheck.allowed) {
    await recordAuditEvent(env.AUTH_DB, {
      eventType: 'login_rate_limited',
      ipHash,
      metadata: { bucket: rateCheck.bucket }
    });
    return reply({
      error: 'RATE_LIMIT',
      message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
    }, 429);
  }

  // 5. Input bounds and format validation
  if (!email || !rawPassword || email.length > MAX_EMAIL_LENGTH || rawPassword.length > MAX_PASSWORD_LENGTH) {
    // Run dummy PBKDF2 hash check for timing mitigation
    await verifyPassword(rawPassword || 'dummy-password', DUMMY_PBKDF2_HASH);
    await recordLoginFailure(env.AUTH_DB, ipHash, emailHash);
    await recordAuditEvent(env.AUTH_DB, {
      eventType: 'login_failure',
      ipHash,
      metadata: { reason: 'invalid_format' }
    });
    return reply({ error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);
  }

  // 6. Query user & credential
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

  const isEligibleAdmin = Boolean(row && row.password_hash && row.status === 'active' && row.role === 'admin');

  let valid = false;
  if (isEligibleAdmin) {
    valid = await verifyPassword(rawPassword, row.password_hash);
  } else {
    // Execute dummy PBKDF2 (or hash of non-admin account) to ensure constant execution timing
    const hashToVerify = row?.password_hash || DUMMY_PBKDF2_HASH;
    await verifyPassword(rawPassword, hashToVerify);
  }

  if (!valid || !isEligibleAdmin) {
    await recordLoginFailure(env.AUTH_DB, ipHash, emailHash);
    const reason = !row
      ? 'user_not_found'
      : row.status !== 'active'
        ? 'disabled'
        : row.role !== 'admin'
          ? 'non_admin_role'
          : 'wrong_password';

    await recordAuditEvent(env.AUTH_DB, {
      eventType: 'login_failure',
      userId: row?.id || null,
      ipHash,
      metadata: { reason }
    });
    // Response equivalence: always return 401 INVALID_CREDENTIALS with same message
    return reply({ error: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);
  }

  // 7. Success -> Clear rate limits, create session
  await clearLoginRateLimits(env.AUTH_DB, ipHash, emailHash);

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
    metadata: { sessionId }
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
