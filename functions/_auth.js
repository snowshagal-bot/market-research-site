import { isHumanAdminHost, validateHumanAdminMutation, ADMIN_ORIGIN } from './_host-policy.js';

export const SESSION_COOKIE_NAME = '__Host-snowshagal-admin-session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_ATTEMPTS = 5; // IP + Email limit
export const RATE_LIMIT_IP_MAX_ATTEMPTS = 20; // IP-only limit
export const RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000; // 15 minutes
export const PBKDF2_ITERATIONS = 600000;
export const MIN_PBKDF2_ITERATIONS = 100000;
export const MAX_PBKDF2_ITERATIONS = 1000000;
export const PBKDF2_PREFIX = 'pbkdf2-sha256';
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_LOGIN_BODY_BYTES = 4096;
export const MAX_EMAIL_LENGTH = 254;

// Precomputed valid PBKDF2 hash (600,000 iterations) for dummy timing-equal verification
export const DUMMY_PBKDF2_HASH = 'pbkdf2-sha256$600000$1vX_Djy6tUzkgQCCS_JxGw$yeRgqwSvcMgUALML7ijA18LzTfJPghcztmaScIk1SOI';

export const REQUIRED_AUTH_TABLES = Object.freeze([
  'users',
  'password_credentials',
  'sessions',
  'auth_rate_limits',
  'audit_events'
]);

const verifiedDbSet = new WeakSet();

/**
 * Runtime schema readiness validation.
 * Verifies that all required tables exist in D1 without executing DDL on the request path.
 */
export async function validateAuthSchema(db) {
  if (!db || typeof db.prepare !== 'function') {
    return { ready: false, error: 'AUTH_NOT_CONFIGURED', message: '인증 데이터베이스가 연결되지 않았습니다.' };
  }
  if (verifiedDbSet.has(db)) {
    return { ready: true };
  }

  try {
    const rows = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'password_credentials', 'sessions', 'auth_rate_limits', 'audit_events')`
    ).all();

    const existingTables = new Set((rows?.results || []).map(r => r.name));
    const allPresent = REQUIRED_AUTH_TABLES.every(t => existingTables.has(t));

    if (!allPresent) {
      return {
        ready: false,
        error: 'AUTH_SCHEMA_NOT_READY',
        message: '인증 데이터베이스 스키마가 초기화되지 않았습니다.'
      };
    }

    verifiedDbSet.add(db);
    return { ready: true };
  } catch (err) {
    return {
      ready: false,
      error: 'AUTH_SCHEMA_NOT_READY',
      message: err?.message || '인증 데이터베이스 스키마를 확인할 수 없습니다.'
    };
  }
}

// For test environments only: compatibility alias
export async function ensureAuthSchema(db) {
  return validateAuthSchema(db);
}

export function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function validatePasswordStrength(password) {
  const str = String(password || '');
  if (str.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `비밀번호는 최소 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` };
  }
  if (str.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: `비밀번호는 최대 ${MAX_PASSWORD_LENGTH}자 이하이어야 합니다.` };
  }
  return { ok: true };
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlToBytes(str) {
  try {
    let base64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return base64ToBytes(base64);
  } catch (_) {
    return new Uint8Array(0);
  }
}

export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

export async function hashPassword(password, saltBytes = null, iterations = PBKDF2_ITERATIONS) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const saltArrayBuffer = salt instanceof Uint8Array
    ? salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength)
    : salt;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltArrayBuffer,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  const hashBytes = new Uint8Array(derivedBits);
  const saltB64 = bytesToBase64Url(salt instanceof Uint8Array ? salt : new Uint8Array(salt));
  const hashB64 = bytesToBase64Url(hashBytes);
  return `${PBKDF2_PREFIX}$${iterations}$${saltB64}$${hashB64}`;
}

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== PBKDF2_PREFIX) return false;

  const iterations = parseInt(parts[1], 10);
  if (Number.isNaN(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS) {
    return false;
  }

  try {
    const salt = base64UrlToBytes(parts[2]);
    if (!salt || salt.length < 8) return false;
    const expectedHash = parts[3];
    if (!expectedHash) return false;

    const actualHashed = await hashPassword(password, salt, iterations);
    const actualParts = actualHashed.split('$');
    return constantTimeEqual(actualParts[3], expectedHash);
  } catch (err) {
    console.error('verifyPassword error:', err);
    return false;
  }
}

export function generateToken(length = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return bytesToBase64Url(bytes);
}

export function generateCsrfToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToHex(bytes);
}

export function validateCsrfToken(submitted, expected) {
  if (!submitted || !expected) return false;
  return constantTimeEqual(String(submitted), String(expected));
}

export const safeNextUrl = validateSafeNextUrl;
export const hashToken = sha256Hex;

export async function createSession(db, { userId, role = 'admin' }) {
  const schemaCheck = await validateAuthSchema(db);
  if (!schemaCheck.ready) throw new Error(schemaCheck.message);

  const sessionId = crypto.randomUUID();
  const rawTokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const rawToken = bytesToHex(rawTokenBytes);
  const tokenHash = await sha256Hex(rawToken);
  const csrfToken = generateCsrfToken();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, tokenHash, csrfToken, nowIso, expiresAt).run();

  const cookie = createSessionCookie(rawToken);
  return {
    id: sessionId,
    rawToken,
    cookie,
    csrfToken,
    expiresAt
  };
}

export async function revokeSession(db, rawToken) {
  if (!db || !rawToken) return;
  const tokenHash = await sha256Hex(rawToken);
  const nowIso = new Date().toISOString();
  await db.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`).bind(nowIso, tokenHash).run();
}

export function parseCookies(request) {
  const cookieHeader = request?.headers?.get('cookie') || '';
  const cookies = new Map();
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    cookies.set(name, decodeURIComponent(val));
  }
  return cookies;
}

export function getSessionToken(request) {
  const cookies = parseCookies(request);
  return cookies.get(SESSION_COOKIE_NAME) || '';
}

export function createSessionCookie(token, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function getIpHash(request, pepper = '') {
  const ip = request?.headers?.get('CF-Connecting-IP') || '127.0.0.1';
  return sha256Hex(`${ip}|${pepper}`);
}

/**
 * Checks a single rate limit bucket.
 */
export async function checkRateLimit(db, key, maxAttempts = RATE_LIMIT_MAX_ATTEMPTS) {
  const now = new Date();

  const record = await db.prepare(
    `SELECT id, attempts, first_attempt_at, last_attempt_at, blocked_until FROM auth_rate_limits WHERE key = ? LIMIT 1`
  ).bind(key).first();

  if (!record) {
    return { allowed: true, remaining: maxAttempts };
  }

  if (record.blocked_until && new Date(record.blocked_until) > now) {
    return { allowed: false, remaining: 0, blockedUntil: record.blocked_until };
  }

  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
  if (new Date(record.first_attempt_at) < windowStart) {
    // Window expired, reset
    await db.prepare(`DELETE FROM auth_rate_limits WHERE key = ?`).bind(key).run();
    return { allowed: true, remaining: maxAttempts };
  }

  const remaining = Math.max(0, maxAttempts - record.attempts);
  return { allowed: record.attempts < maxAttempts, remaining };
}

/**
 * Checks both IP-only (20 attempts) and IP+Email (5 attempts) rate limit buckets.
 */
export async function checkLoginRateLimits(db, ipHash, emailHash) {
  const ipKey = `login:ip:${ipHash}`;
  const ipEmailKey = `login:ip_email:${ipHash}:${emailHash}`;

  const ipCheck = await checkRateLimit(db, ipKey, RATE_LIMIT_IP_MAX_ATTEMPTS);
  if (!ipCheck.allowed) {
    return { allowed: false, bucket: 'ip', remaining: 0, blockedUntil: ipCheck.blockedUntil };
  }

  const emailCheck = await checkRateLimit(db, ipEmailKey, RATE_LIMIT_MAX_ATTEMPTS);
  if (!emailCheck.allowed) {
    return { allowed: false, bucket: 'ip_email', remaining: 0, blockedUntil: emailCheck.blockedUntil };
  }

  return { allowed: true, remaining: Math.min(ipCheck.remaining, emailCheck.remaining) };
}

/**
 * Records a single attempt in a rate limit bucket.
 */
export async function recordRateLimitAttempt(db, key, success = false, maxAttempts = RATE_LIMIT_MAX_ATTEMPTS) {
  const now = new Date();
  const nowIso = now.toISOString();

  if (success) {
    await db.prepare(`DELETE FROM auth_rate_limits WHERE key = ?`).bind(key).run();
    return;
  }

  const record = await db.prepare(
    `SELECT id, attempts, first_attempt_at FROM auth_rate_limits WHERE key = ? LIMIT 1`
  ).bind(key).first();

  if (!record) {
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO auth_rate_limits (id, key, attempts, first_attempt_at, last_attempt_at) VALUES (?, ?, 1, ?, ?)`
    ).bind(id, key, nowIso, nowIso).run();
    return;
  }

  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
  if (new Date(record.first_attempt_at) < windowStart) {
    await db.prepare(
      `UPDATE auth_rate_limits SET attempts = 1, first_attempt_at = ?, last_attempt_at = ?, blocked_until = NULL WHERE key = ?`
    ).bind(nowIso, nowIso, key).run();
    return;
  }

  const newAttempts = record.attempts + 1;
  let blockedUntil = null;
  if (newAttempts >= maxAttempts) {
    blockedUntil = new Date(now.getTime() + RATE_LIMIT_BLOCK_MS).toISOString();
  }

  await db.prepare(
    `UPDATE auth_rate_limits SET attempts = ?, last_attempt_at = ?, blocked_until = ? WHERE key = ?`
  ).bind(newAttempts, nowIso, blockedUntil, key).run();
}

/**
 * Records failed login across both IP-only and IP+Email buckets.
 */
export async function recordLoginFailure(db, ipHash, emailHash) {
  const ipKey = `login:ip:${ipHash}`;
  const ipEmailKey = `login:ip_email:${ipHash}:${emailHash}`;
  await Promise.all([
    recordRateLimitAttempt(db, ipKey, false, RATE_LIMIT_IP_MAX_ATTEMPTS),
    recordRateLimitAttempt(db, ipEmailKey, false, RATE_LIMIT_MAX_ATTEMPTS)
  ]);
}

/**
 * Clears rate limits on successful login.
 */
export async function clearLoginRateLimits(db, ipHash, emailHash) {
  const ipKey = `login:ip:${ipHash}`;
  const ipEmailKey = `login:ip_email:${ipHash}:${emailHash}`;
  await Promise.all([
    recordRateLimitAttempt(db, ipKey, true),
    recordRateLimitAttempt(db, ipEmailKey, true)
  ]);
}

export async function clearRateLimit(db, ip, email) {
  const ipHash = await sha256Hex(ip || '127.0.0.1');
  const emailHash = await sha256Hex(normalizeEmail(email));
  return clearLoginRateLimits(db, ipHash, emailHash);
}

export async function recordAuditEvent(db, { eventType, userId = null, ipHash = null, metadata = {} }) {
  if (!db) return;
  try {
    const id = crypto.randomUUID();
    const cleanMeta = typeof metadata === 'object' && metadata !== null ? JSON.stringify(metadata) : '{}';
    const nowIso = new Date().toISOString();
    await db.prepare(
      `INSERT INTO audit_events (id, event_type, user_id, ip_hash, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, eventType, userId, ipHash, cleanMeta, nowIso).run();
  } catch (err) {
    console.error('Failed to record audit event:', err);
  }
}

export function validateSafeNextUrl(rawNext) {
  if (!rawNext || typeof rawNext !== 'string') return '/admin/';
  const trimmed = rawNext.trim();
  // Must start with /admin/ or /admin, not //, not /\, and not have scheme
  if (!trimmed.startsWith('/admin') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/admin/';
  }
  // Check for colon before question mark or hash (e.g. javascript:, http:)
  const preQuery = trimmed.split('?')[0].split('#')[0];
  if (preQuery.includes(':')) {
    return '/admin/';
  }
  // Avoid loop redirect to login page itself
  if (preQuery === '/admin/login' || preQuery === '/admin/login/') {
    return '/admin/';
  }
  return trimmed;
}

export async function getSession(requestOrDb, envOrRequest) {
  let db = envOrRequest?.AUTH_DB;
  let request = requestOrDb;
  if (requestOrDb && typeof requestOrDb.prepare === 'function') {
    db = requestOrDb;
    request = envOrRequest;
  }
  if (!db) return null;
  const token = getSessionToken(request);
  if (!token) return null;

  const schemaCheck = await validateAuthSchema(db);
  if (!schemaCheck.ready) return null;

  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();

  const row = await db.prepare(`
    SELECT
      s.id AS session_id,
      s.user_id AS user_id,
      s.csrf_token AS csrf_token,
      s.expires_at AS expires_at,
      s.revoked_at AS revoked_at,
      u.email AS email,
      u.role AS role,
      u.status AS status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, nowIso).first();

  if (!row) return null;
  if (row.status !== 'active') return null;

  return {
    authenticated: true,
    token,
    user: {
      id: row.user_id,
      email: row.email,
      role: row.role,
      status: row.status
    },
    session: {
      id: row.session_id,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at
    }
  };
}

export async function requireAdmin(request, env) {
  if (!env?.AUTH_DB) {
    return { ok: false, status: 503, error: 'AUTH_NOT_CONFIGURED', message: '인증 데이터베이스가 설정되지 않았습니다.' };
  }
  const schemaCheck = await validateAuthSchema(env.AUTH_DB);
  if (!schemaCheck.ready) {
    return { ok: false, status: 503, error: schemaCheck.error, message: schemaCheck.message };
  }
  const session = await getSession(request, env);
  if (!session || !session.authenticated) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED', message: '로그인이 필요합니다.' };
  }
  if (session.user.role !== 'admin') {
    return { ok: false, status: 403, error: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' };
  }
  return { ok: true, user: session.user, session: session.session };
}

export async function requireAdminMutation(request, env) {
  // 1. Origin verification
  const originPolicy = validateHumanAdminMutation(request);
  if (!originPolicy.ok) {
    return { ok: false, status: 403, error: originPolicy.error, message: '허용되지 않은 관리자 Origin입니다.' };
  }

  // 2. Authentication & Admin role
  const authResult = await requireAdmin(request, env);
  if (!authResult.ok) return authResult;

  // 3. CSRF Verification
  const suppliedCsrf = request.headers.get('x-csrf-token') || '';
  if (!suppliedCsrf || !constantTimeEqual(suppliedCsrf, authResult.session.csrfToken)) {
    return { ok: false, status: 403, error: 'CSRF_INVALID', message: 'CSRF 토큰이 유효하지 않습니다.' };
  }

  return authResult;
}

export const __test = {
  bytesToBase64,
  base64ToBytes,
  verifiedDbSet
};
