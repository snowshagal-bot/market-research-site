import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  normalizeEmail,
  hashToken,
  generateCsrfToken,
  validateCsrfToken,
  safeNextUrl,
  ensureAuthSchema,
  createSession,
  getSession,
  revokeSession,
  checkRateLimit,
  recordLoginFailure,
  clearRateLimit,
  requireAdmin,
  requireAdminMutation,
  SESSION_COOKIE_NAME
} from '../functions/_auth.js';
import { createMockAuthDb, MockD1 } from './helpers/auth-test-helper.mjs';
import { onRequestPost as onLogin } from '../functions/api/auth/login.js';
import { onRequestPost as onLogout } from '../functions/api/auth/logout.js';
import { onRequestGet as onSession } from '../functions/api/auth/session.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { bootstrapAdmin, createAdminUserSql } from '../scripts/bootstrap-admin.mjs';

test('Password hashing and verification with PBKDF2-SHA256 (600,000 iterations)', async () => {
  const password = 'SuperSecureAdminPassword123!';
  const hash = await hashPassword(password);

  assert.match(hash, /^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  const parts = hash.split('$');
  assert.equal(parts[1], '600000');
  assert.ok(parts[2].length >= 22, 'Salt base64url should be at least 16 bytes');

  const valid = await verifyPassword(password, hash);
  assert.equal(valid, true, 'Correct password must verify successfully');

  const invalid = await verifyPassword('WrongPassword123!', hash);
  assert.equal(invalid, false, 'Incorrect password must fail verification');

  const invalidAlgo = await verifyPassword(password, hash.replace('pbkdf2-sha256', 'sha1'));
  assert.equal(invalidAlgo, false, 'Unsupported algorithm format must fail safely');
});

test('Password strength validation enforces 12-128 characters', () => {
  assert.equal(validatePasswordStrength('short').ok, false);
  assert.equal(validatePasswordStrength('12345678901').ok, false);
  assert.equal(validatePasswordStrength('123456789012').ok, true);
  assert.equal(validatePasswordStrength('A'.repeat(128)).ok, true);
  assert.equal(validatePasswordStrength('A'.repeat(129)).ok, false);
});

test('Email normalization trims and lowercases', () => {
  assert.equal(normalizeEmail('  Admin@SnowShagal.COM  '), 'admin@snowshagal.com');
  assert.equal(normalizeEmail(''), '');
});

test('CSRF token generation and constant-time validation', () => {
  const token = generateCsrfToken();
  assert.equal(typeof token, 'string');
  assert.equal(token.length, 64, '32 bytes in hex is 64 characters');

  assert.equal(validateCsrfToken(token, token), true);
  assert.equal(validateCsrfToken(token, 'invalid-token-12345'), false);
  assert.equal(validateCsrfToken('', token), false);
  assert.equal(validateCsrfToken(null, token), false);
});

test('Safe next URL redirection prevents open redirects', () => {
  assert.equal(safeNextUrl('/admin/'), '/admin/');
  assert.equal(safeNextUrl('/admin/manage/'), '/admin/manage/');
  assert.equal(safeNextUrl('/admin/analytics/?range=7'), '/admin/analytics/?range=7');
  assert.equal(safeNextUrl('/admin/disclosures/'), '/admin/disclosures/');
  assert.equal(safeNextUrl('/admin/market/'), '/admin/market/');

  // Open redirects blocked
  assert.equal(safeNextUrl('https://evil.com'), '/admin/');
  assert.equal(safeNextUrl('//evil.com/admin/'), '/admin/');
  assert.equal(safeNextUrl('javascript:alert(1)'), '/admin/');
  assert.equal(safeNextUrl('/external'), '/admin/');
  assert.equal(safeNextUrl(''), '/admin/');
});

test('Session creation, retrieval, and revocation lifecycle', async () => {
  const db = await createMockAuthDb();
  const userId = crypto.randomUUID();
  const email = 'editor@snowshagal.com';
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?)`
  ).bind(userId, email, email, now, now).run();

  const session = await createSession(db, { userId, role: 'admin' });
  assert.ok(session.rawToken);
  assert.ok(session.cookie);
  assert.ok(session.csrfToken);
  assert.match(session.cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(session.cookie, /HttpOnly/i);
  assert.match(session.cookie, /Secure/i);
  assert.match(session.cookie, /SameSite=Lax/i);

  // Retrieve session with cookie
  const req = new Request('https://admin.snowshagal.com/admin/', {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${session.rawToken}` }
  });
  const retrieved = await getSession(db, req);
  assert.ok(retrieved);
  assert.equal(retrieved.user.id, userId);
  assert.equal(retrieved.user.email, email);
  assert.equal(retrieved.user.role, 'admin');

  // Revoke session
  await revokeSession(db, session.rawToken);
  const afterRevoke = await getSession(db, req);
  assert.equal(afterRevoke, null, 'Revoked session should not be found');
});

test('Rate limiting locks out after 5 consecutive failed attempts in 15 minutes', async () => {
  const db = await createMockAuthDb();
  const ip = '1.2.3.4';
  const email = 'target@snowshagal.com';

  const check1 = await checkRateLimit(db, ip, email);
  assert.equal(check1.allowed, true);
  assert.equal(check1.remaining, 5);

  for (let i = 1; i <= 4; i++) {
    await recordLoginFailure(db, ip, email);
    const check = await checkRateLimit(db, ip, email);
    assert.equal(check.allowed, true);
    assert.equal(check.remaining, 5 - i);
  }

  // 5th failure
  await recordLoginFailure(db, ip, email);
  const check5 = await checkRateLimit(db, ip, email);
  assert.equal(check5.allowed, false, '5th failure should trigger lockout');
  assert.equal(check5.remaining, 0);

  // Clear rate limit
  await clearRateLimit(db, ip, email);
  const checkAfterClear = await checkRateLimit(db, ip, email);
  assert.equal(checkAfterClear.allowed, true);
  assert.equal(checkAfterClear.remaining, 5);
});

test('Auth API login / session / logout flow', async () => {
  const db = await createMockAuthDb();
  const email = 'superadmin@snowshagal.com';
  const password = 'CorrectPassword1234!';
  await bootstrapAdmin(db, { email, password });

  const env = { AUTH_DB: db, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };

  // 1. Bad password -> 401
  const badLoginReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
    body: JSON.stringify({ email, password: 'WrongPassword123!' })
  });
  const badLoginRes = await onLogin({ request: badLoginReq, env });
  assert.equal(badLoginRes.status, 401);
  const badData = await badLoginRes.json();
  assert.equal(badData.error, 'INVALID_CREDENTIALS');

  // 2. Good login -> 200 with session cookie
  const goodLoginReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
    body: JSON.stringify({ email, password })
  });
  const goodLoginRes = await onLogin({ request: goodLoginReq, env });
  assert.equal(goodLoginRes.status, 200);
  const setCookie = goodLoginRes.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.match(setCookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));

  const loginData = await goodLoginRes.json();
  assert.equal(loginData.ok, true);
  assert.equal(loginData.user.email, email);
  assert.ok(loginData.csrfToken);

  // Extract raw token from cookie header
  const tokenMatch = setCookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  const rawToken = tokenMatch[1];

  // 3. GET /api/auth/session with cookie -> 200
  const sessionReq = new Request('https://admin.snowshagal.com/api/auth/session', {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` }
  });
  const sessionRes = await onSession({ request: sessionReq, env });
  assert.equal(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assert.equal(sessionData.authenticated, true);
  assert.equal(sessionData.user.email, email);
  assert.equal(sessionData.csrfToken, loginData.csrfToken);

  // 4. POST /api/auth/logout -> 200 with cleared cookie
  const logoutReq = new Request('https://admin.snowshagal.com/api/auth/logout', {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
      origin: 'https://admin.snowshagal.com',
      'x-csrf-token': sessionData.csrfToken
    }
  });
  const logoutRes = await onLogout({ request: logoutReq, env });
  assert.equal(logoutRes.status, 200);
  const logoutCookie = logoutRes.headers.get('set-cookie');
  assert.match(logoutCookie, /Max-Age=0/i);

  // 5. Session now unauthenticated
  const postLogoutSession = await onSession({ request: sessionReq, env });
  const postLogoutData = await postLogoutSession.json();
  assert.equal(postLogoutData.authenticated, false);
});

test('Missing AUTH_DB fails closed with 503 AUTH_NOT_CONFIGURED', async () => {
  const envNoDb = {};
  const req = new Request('https://admin.snowshagal.com/admin/');

  const adminAuth = await requireAdmin(req, envNoDb);
  assert.equal(adminAuth.status, 503);
  assert.equal(adminAuth.error, 'AUTH_NOT_CONFIGURED');

  const mutationAuth = await requireAdminMutation(req, envNoDb);
  assert.equal(mutationAuth.status, 503);
  assert.equal(mutationAuth.error, 'AUTH_NOT_CONFIGURED');
});

test('Admin Route Guard in middleware redirects unauthenticated users to /admin/login/?next=...', async () => {
  const db = await createMockAuthDb();
  const env = { AUTH_DB: db };

  let nextCalled = false;
  const context = {
    request: new Request('https://admin.snowshagal.com/admin/manage/?filter=daily'),
    env,
    next: async () => {
      nextCalled = true;
      return new Response('OK');
    }
  };

  const response = await middleware(context);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/admin/login/?next=%2Fadmin%2Fmanage%2F%3Ffilter%3Ddaily');
  assert.equal(nextCalled, false);
});

test('Admin Route Guard allows authenticated admin through', async () => {
  const db = await createMockAuthDb();
  const email = 'guard-admin@snowshagal.com';
  const adminInfo = await bootstrapAdmin(db, { email, password: 'ValidPassword123!' });

  const session = await createSession(db, { userId: adminInfo.userId, role: 'admin' });
  const env = { AUTH_DB: db };

  let nextCalled = false;
  const context = {
    request: new Request('https://admin.snowshagal.com/admin/disclosures/', {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.rawToken}` }
    }),
    env,
    next: async () => {
      nextCalled = true;
      return new Response('OK');
    }
  };

  const response = await middleware(context);
  assert.equal(response.status, 200);
  assert.equal(nextCalled, true);
});

test('Operator bootstrap CLI rejects duplicate admin', async () => {
  const db = await createMockAuthDb();
  const email = 'initial-admin@snowshagal.com';
  const password = 'AdminPassword123!';

  const result1 = await bootstrapAdmin(db, { email, password });
  assert.equal(result1.email, email);

  await assert.rejects(
    async () => bootstrapAdmin(db, { email: 'another-admin@snowshagal.com', password: 'AnotherPassword123!' }),
    /이미 관리자 계정.*존재합니다/
  );
});
