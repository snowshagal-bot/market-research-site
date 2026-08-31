import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  normalizeEmail,
  hashToken,
  sha256Hex,
  generateCsrfToken,
  validateCsrfToken,
  safeNextUrl,
  ensureAuthSchema,
  createSession,
  getSession,
  revokeSession,
  checkRateLimit,
  checkLoginRateLimits,
  recordLoginFailure,
  clearRateLimit,
  clearLoginRateLimits,
  requireAdmin,
  requireAdminMutation,
  SESSION_COOKIE_NAME
} from '../functions/_auth.js';
import { createMockAuthDb, createAdminSession, MockD1 } from './helpers/auth-test-helper.mjs';
import { onRequestPost as onLogin } from '../functions/api/auth/login.js';
import { onRequestPost as onLogout } from '../functions/api/auth/logout.js';
import { onRequestGet as onSession } from '../functions/api/auth/session.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { bootstrapAdmin, createAdminUserSql } from '../scripts/bootstrap-admin.mjs';
import { onRequestPost as onCommentsPost, onRequestDelete as onCommentsDelete } from '../functions/api/comments.js';
import { onRequestPost as onPublish } from '../functions/api/publish.js';
import { onRequestPost as onManage } from '../functions/api/manage.js';
import { onRequestGet as onAnalytics } from '../functions/api/analytics.js';
import { onRequestPost as onGenerateCover } from '../functions/api/generate-cover.js';
import { onRequestPost as onMarketPublish } from '../functions/api/market/publish.js';
import { onRequestPost as onDisclosureSync } from '../functions/api/disclosures/sync.js';

const TEST_AUTH_PEPPER = 'test-auth-pepper-secret-minimum-32-bytes';

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
  const ipHash = await sha256Hex(ip);
  const emailHash = await sha256Hex(normalizeEmail(email));

  const check1 = await checkLoginRateLimits(db, ipHash, emailHash);
  assert.equal(check1.allowed, true);
  assert.equal(check1.remaining, 5);

  for (let i = 1; i <= 4; i++) {
    await recordLoginFailure(db, ipHash, emailHash);
    const check = await checkLoginRateLimits(db, ipHash, emailHash);
    assert.equal(check.allowed, true);
    assert.equal(check.remaining, 5 - i);
  }

  // 5th failure
  await recordLoginFailure(db, ipHash, emailHash);
  const check5 = await checkLoginRateLimits(db, ipHash, emailHash);
  assert.equal(check5.allowed, false, '5th failure should trigger lockout');
  assert.equal(check5.remaining, 0);

  // Clear rate limit
  await clearLoginRateLimits(db, ipHash, emailHash);
  const checkAfterClear = await checkLoginRateLimits(db, ipHash, emailHash);
  assert.equal(checkAfterClear.allowed, true);
  assert.equal(checkAfterClear.remaining, 5);
});

test('Auth API login / session / logout flow', async () => {
  const db = await createMockAuthDb();
  const email = 'superadmin@snowshagal.com';
  const password = 'CorrectPassword1234!';
  await bootstrapAdmin(db, { email, password });

  const env = { AUTH_DB: db, AUTH_PEPPER: TEST_AUTH_PEPPER, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };

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

test('Operator bootstrap atomicity: credential failure leaves no orphan user row', async () => {
  const db = await createMockAuthDb();
  db.exec(`CREATE TRIGGER fail_credentials BEFORE INSERT ON password_credentials BEGIN SELECT RAISE(FAIL, 'simulated credential failure'); END;`);

  await assert.rejects(
    async () => bootstrapAdmin(db, { email: 'fail-admin@snowshagal.com', password: 'AdminPassword123!' }),
    /simulated credential failure/
  );

  // Verify that because of atomic batch rollback, no user was left behind in users table
  const userCount = await db.prepare('SELECT COUNT(*) AS count FROM users').first('count');
  assert.equal(userCount, 0, 'Users table must have 0 rows after rollback');
});

test('AUTH_DB bound but schema missing fails closed with 503 AUTH_SCHEMA_NOT_READY', async () => {
  const emptyDb = await createMockAuthDb(true); // skipSchema = true
  const env = { AUTH_DB: emptyDb, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };
  const req = new Request('https://admin.snowshagal.com/admin/');

  const adminAuth = await requireAdmin(req, env);
  assert.equal(adminAuth.status, 503);
  assert.equal(adminAuth.error, 'AUTH_SCHEMA_NOT_READY');

  const sessionRes = await onSession({ request: req, env });
  assert.equal(sessionRes.status, 503);
  const sessionJson = await sessionRes.json();
  assert.equal(sessionJson.error, 'AUTH_SCHEMA_NOT_READY');

  const loginReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
    body: JSON.stringify({ email: 'admin@snowshagal.com', password: 'ValidPassword123!' })
  });
  const loginRes = await onLogin({ request: loginReq, env });
  assert.equal(loginRes.status, 503);
  const loginJson = await loginRes.json();
  assert.equal(loginJson.error, 'AUTH_SCHEMA_NOT_READY');
});

test('Login response equivalence for unknown user, disabled user, member role, and wrong password', async () => {
  const db = await createMockAuthDb();
  const env = { AUTH_DB: db, AUTH_PEPPER: TEST_AUTH_PEPPER, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };

  // 1. Setup active admin, disabled admin, and active member
  const adminPassword = 'AdminPassword123!';
  const memberPassword = 'MemberPassword123!';
  const disabledPassword = 'DisabledPassword123!';

  const adminHash = await hashPassword(adminPassword);
  const memberHash = await hashPassword(memberPassword);
  const disabledHash = await hashPassword(disabledPassword);
  const now = new Date().toISOString();

  // Admin
  const adminId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?)`
  ).bind(adminId, 'realadmin@snowshagal.com', 'realadmin@snowshagal.com', now, now).run();
  await db.prepare(
    `INSERT INTO password_credentials (user_id, password_hash, password_changed_at) VALUES (?, ?, ?)`
  ).bind(adminId, adminHash, now).run();

  // Member
  const memberId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES (?, ?, ?, 'member', 'active', ?, ?)`
  ).bind(memberId, 'member@snowshagal.com', 'member@snowshagal.com', now, now).run();
  await db.prepare(
    `INSERT INTO password_credentials (user_id, password_hash, password_changed_at) VALUES (?, ?, ?)`
  ).bind(memberId, memberHash, now).run();

  // Disabled Admin
  const disabledId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'disabled', ?, ?)`
  ).bind(disabledId, 'disabled@snowshagal.com', 'disabled@snowshagal.com', now, now).run();
  await db.prepare(
    `INSERT INTO password_credentials (user_id, password_hash, password_changed_at) VALUES (?, ?, ?)`
  ).bind(disabledId, disabledHash, now).run();

  async function attemptLogin(email, password) {
    const req = new Request('https://admin.snowshagal.com/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
      body: JSON.stringify({ email, password })
    });
    const res = await onLogin({ request: req, env });
    const json = await res.json();
    return { status: res.status, json };
  }

  // A. Non-existent user
  const nonExistent = await attemptLogin('nonexistent@snowshagal.com', 'SomePassword123!');
  assert.equal(nonExistent.status, 401);
  assert.equal(nonExistent.json.error, 'INVALID_CREDENTIALS');
  assert.equal(nonExistent.json.message, '이메일 또는 비밀번호가 올바르지 않습니다.');

  // B. Disabled user
  const disabled = await attemptLogin('disabled@snowshagal.com', disabledPassword);
  assert.equal(disabled.status, 401);
  assert.equal(disabled.json.error, 'INVALID_CREDENTIALS');
  assert.equal(disabled.json.message, '이메일 또는 비밀번호가 올바르지 않습니다.');

  // C. Member role
  const member = await attemptLogin('member@snowshagal.com', memberPassword);
  assert.equal(member.status, 401);
  assert.equal(member.json.error, 'INVALID_CREDENTIALS');
  assert.equal(member.json.message, '이메일 또는 비밀번호가 올바르지 않습니다.');

  // D. Admin with wrong password
  const wrongPass = await attemptLogin('realadmin@snowshagal.com', 'WrongPassword123!');
  assert.equal(wrongPass.status, 401);
  assert.equal(wrongPass.json.error, 'INVALID_CREDENTIALS');
  assert.equal(wrongPass.json.message, '이메일 또는 비밀번호가 올바르지 않습니다.');
});

test('Malformed password hash and abnormal iterations are safely rejected without crashing', async () => {
  // Abnormal iteration counts (< 100,000 or > 1,000,000)
  const lowIterHash = 'pbkdf2-sha256$50000$c2FsdHNhbHQ$aGFzaGhhc2g';
  assert.equal(await verifyPassword('password123', lowIterHash), false);

  const highIterHash = 'pbkdf2-sha256$5000000$c2FsdHNhbHQ$aGFzaGhhc2g';
  assert.equal(await verifyPassword('password123', highIterHash), false);

  const nanIterHash = 'pbkdf2-sha256$NaN$c2FsdHNhbHQ$aGFzaGhhc2g';
  assert.equal(await verifyPassword('password123', nanIterHash), false);

  // Malformed string structure
  assert.equal(await verifyPassword('password123', 'not-a-hash'), false);
  assert.equal(await verifyPassword('password123', 'pbkdf2-sha256$600000$short'), false);
  assert.equal(await verifyPassword('password123', 'pbkdf2-sha256$600000$???invalid_base64???$hash'), false);
  assert.equal(await verifyPassword('password123', null), false);
  assert.equal(await verifyPassword('password123', undefined), false);
});

test('Oversized login inputs are rejected cleanly', async () => {
  const db = await createMockAuthDb();
  const env = { AUTH_DB: db, AUTH_PEPPER: TEST_AUTH_PEPPER, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };

  // 1. Body > 4096 bytes
  const largeBody = JSON.stringify({ email: 'admin@snowshagal.com', password: 'A'.repeat(5000) });
  const largeReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
    body: largeBody
  });
  const largeRes = await onLogin({ request: largeReq, env });
  assert.equal(largeRes.status, 413);

  // 2. Email > 254 chars
  const longEmail = `${'a'.repeat(250)}@snowshagal.com`;
  const emailReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
    body: JSON.stringify({ email: longEmail, password: 'ValidPassword123!' })
  });
  const emailRes = await onLogin({ request: emailReq, env });
  assert.equal(emailRes.status, 401);

  // 3. Password > 128 chars
  const longPassReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
    body: JSON.stringify({ email: 'admin@snowshagal.com', password: 'P'.repeat(130) })
  });
  const longPassRes = await onLogin({ request: longPassReq, env });
  assert.equal(longPassRes.status, 401);
});

test('IP-only rate limit bucket triggers across different emails from the same IP', async () => {
  const db = await createMockAuthDb();
  const env = { AUTH_DB: db, AUTH_PEPPER: TEST_AUTH_PEPPER, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };
  const ip = '198.51.100.42';

  // 20 failed attempts with unique emails from same IP
  for (let i = 1; i <= 20; i++) {
    const req = new Request('https://admin.snowshagal.com/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': 'https://admin.snowshagal.com',
        'CF-Connecting-IP': ip
      },
      body: JSON.stringify({ email: `user${i}@snowshagal.com`, password: 'WrongPassword123!' })
    });
    const res = await onLogin({ request: req, env });
    assert.equal(res.status, 401);
  }

  // 21st attempt from same IP should be blocked by IP bucket rate limit
  const lockedReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://admin.snowshagal.com',
      'CF-Connecting-IP': ip
    },
    body: JSON.stringify({ email: 'user21@snowshagal.com', password: 'WrongPassword123!' })
  });
  const lockedRes = await onLogin({ request: lockedReq, env });
  assert.equal(lockedRes.status, 429);
  const lockedJson = await lockedRes.json();
  assert.equal(lockedJson.error, 'RATE_LIMIT');
});

test('Comments DELETE supports guest password and admin session, rejecting ADMIN_KEY alone', async () => {
  const authDb = await createMockAuthDb();
  const commentsDb = new MockD1();
  const session = await createAdminSession(authDb);
  const env = {
    AUTH_DB: authDb,
    COMMENTS_DB: commentsDb,
    ADMIN_ORIGIN: 'https://admin.snowshagal.com',
    ADMIN_KEY: 'secret-admin-key'
  };

  const report = '/reports/sample.html';
  const postReq = new Request('https://snowshagal.com/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://snowshagal.com' },
    body: JSON.stringify({
      report,
      nickname: '게스트',
      body: '테스트 댓글입니다.',
      password: 'GuestPassword123!',
      website: ''
    })
  });
  const postRes = await onCommentsPost({ request: postReq, env });
  assert.equal(postRes.status, 201);
  const postData = await postRes.json();
  const commentId = postData.comment.id;

  // 1. ADMIN_KEY alone without password must fail
  const adminKeyReq = new Request('https://admin.snowshagal.com/api/comments', {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      origin: 'https://admin.snowshagal.com',
      'x-admin-key': 'secret-admin-key'
    },
    body: JSON.stringify({ id: commentId, report })
  });
  const adminKeyRes = await onCommentsDelete({ request: adminKeyReq, env });
  assert.equal(adminKeyRes.status, 401);

  // 2. Admin session delete (cookie + csrf + origin) succeeds without comment password
  const adminSessionReq = new Request('https://admin.snowshagal.com/api/comments', {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      origin: 'https://admin.snowshagal.com',
      cookie: session.cookieHeader,
      'x-csrf-token': session.csrfToken
    },
    body: JSON.stringify({ id: commentId, report })
  });
  const adminSessionRes = await onCommentsDelete({ request: adminSessionReq, env });
  assert.equal(adminSessionRes.status, 200);
  assert.equal((await adminSessionRes.json()).ok, true);
});

test('Valid ADMIN_KEY alone CANNOT authenticate human endpoints', async () => {
  const authDb = await createMockAuthDb();
  const env = {
    AUTH_DB: authDb,
    COMMENTS_DB: new MockD1(),
    ADMIN_ORIGIN: 'https://admin.snowshagal.com',
    ADMIN_KEY: 'valid-secret-admin-key',
    GITHUB_TOKEN: 'fake-token',
    GITHUB_REPO: 'test/test'
  };

  const adminHeaders = {
    'x-admin-key': 'valid-secret-admin-key',
    origin: 'https://admin.snowshagal.com'
  };

  // 1. Publish endpoint
  const pubReq = new Request('https://admin.snowshagal.com/api/publish', {
    method: 'POST',
    headers: adminHeaders,
    body: new FormData()
  });
  const pubRes = await onPublish({ request: pubReq, env });
  assert.equal(pubRes.status, 401, 'Publish must reject ADMIN_KEY alone');

  // 2. Manage endpoint
  const mgReq = new Request('https://admin.snowshagal.com/api/manage', {
    method: 'POST',
    headers: adminHeaders,
    body: new FormData()
  });
  const mgRes = await onManage({ request: mgReq, env });
  assert.equal(mgRes.status, 401, 'Manage must reject ADMIN_KEY alone');

  // 3. Analytics endpoint
  const anaReq = new Request('https://admin.snowshagal.com/api/analytics', {
    headers: { 'x-admin-key': 'valid-secret-admin-key' }
  });
  const anaRes = await onAnalytics({ request: anaReq, env });
  assert.equal(anaRes.status, 401, 'Analytics must reject ADMIN_KEY alone');

  // 4. Generate cover endpoint
  const genReq = new Request('https://admin.snowshagal.com/api/generate-cover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...adminHeaders },
    body: JSON.stringify({ html: '<div>test</div>' })
  });
  const genRes = await onGenerateCover({ request: genReq, env });
  assert.equal(genRes.status, 401, 'Generate cover must reject ADMIN_KEY alone');
});

test('Market and disclosure purpose-specific machine keys still work without session', async () => {
  const authDb = await createMockAuthDb();
  const commentsDb = new MockD1();
  const env = {
    AUTH_DB: authDb,
    COMMENTS_DB: commentsDb,
    MARKET_PUBLISH_KEY: 'test-market-key-12345',
    DISCLOSURE_SYNC_KEY: 'test-sync-key-12345',
    DART_API_KEY: 'dart-key'
  };

  // 1. Market Publish with x-market-publish-key
  const marketPayload = {
    date: '2026-08-31',
    indices: { kospi: { value: 2600.0, change: 10.0, changePercent: 0.38 } }
  };
  const marketReq = new Request('https://snowshagal.com/api/market/publish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-market-publish-key': 'test-market-key-12345'
    },
    body: JSON.stringify(marketPayload)
  });
  const marketRes = await onMarketPublish({ request: marketReq, env });
  // Passes authentication (may return 200 or payload validation status)
  assert.notEqual(marketRes.status, 401);
  assert.notEqual(marketRes.status, 403);

  // 2. Disclosure Sync with x-disclosure-sync-key
  const syncReq = new Request('https://snowshagal.com/api/disclosures/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-disclosure-sync-key': 'test-sync-key-12345'
    },
    body: JSON.stringify({})
  });
  const syncRes = await onDisclosureSync({ request: syncReq, env, now: new Date('2026-08-31T10:00:00Z') });
  assert.notEqual(syncRes.status, 401);
  assert.notEqual(syncRes.status, 403);
});

test('Bootstrap admin helper does not expose plain password or SQL injection', async () => {
  const result = await createAdminUserSql({
    email: "admin'--@snowshagal.com",
    password: 'SafePassword1234!'
  });
  assert.ok(result.userId);
  assert.ok(result.passwordHash);
  // Escaped in SQL
  assert.match(result.sql, /admin''--@snowshagal\.com/);
  assert.doesNotMatch(result.sql, /SafePassword1234!/);
});

test('Missing AUTH_PEPPER on login fails closed with 503 AUTH_PEPPER_NOT_CONFIGURED', async () => {
  const db = await createMockAuthDb();
  const env = { AUTH_DB: db, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };
  const loginReq = new Request('https://admin.snowshagal.com/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': 'https://admin.snowshagal.com' },
    body: JSON.stringify({ email: 'admin@snowshagal.com', password: 'ValidPassword123!' })
  });
  const loginRes = await onLogin({ request: loginReq, env });
  assert.equal(loginRes.status, 503);
  const loginJson = await loginRes.json();
  assert.equal(loginJson.error, 'AUTH_PEPPER_NOT_CONFIGURED');
});

test('Missing AUTH_PEPPER on logout still revokes session and clears cookie', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const env = { AUTH_DB: db, ADMIN_ORIGIN: 'https://admin.snowshagal.com' };

  const logoutReq = new Request('https://admin.snowshagal.com/api/auth/logout', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://admin.snowshagal.com',
      cookie: session.cookieHeader,
      'x-csrf-token': session.csrfToken
    }
  });
  const logoutRes = await onLogout({ request: logoutReq, env });
  assert.equal(logoutRes.status, 200);
  const cookieHeader = logoutRes.headers.get('set-cookie');
  assert.match(cookieHeader, /Max-Age=0/);

  // Session should be revoked in DB
  const revokedSession = await db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').bind(session.sessionId).first();
  assert.ok(revokedSession.revoked_at, 'Session must be marked revoked');
});
