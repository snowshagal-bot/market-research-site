import { isHumanAdminHost, validateHumanAdminMutation, ADMIN_ORIGIN } from './_host-policy.js';

export const SESSION_COOKIE_NAME = '__Host-snowshagal-admin-session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_ATTEMPTS = 5;
export const RATE_LIMIT_BLOCK_MS = 15 * 60 * 1000; // 15 minutes
export const PBKDF2_ITERATIONS = 600000;
export const PBKDF2_PREFIX = 'pbkdf2-sha256';
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('member', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_email_normalized ON users(email_normalized)`,
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
  `CREATE TABLE IF NOT EXISTS password_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    password_changed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS auth_rate_limits (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 1,
    first_attempt_at TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL,
    blocked_until TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_key ON auth_rate_limits(key)`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    ip_hash TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_user_created ON audit_events(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_type_created ON audit_events(event_type, created_at)`
];

const schemaInitSet = new WeakSet();

export async function ensureAuthSchema(db) {
  if (!db) return false;
  if (schemaInitSet.has(db)) return true;
  for (const statement of TABLE_SQL) {
    await db.prepare(statement).run();
  }
  schemaInitSet.add(db);
  return true;
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
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return base64ToBytes(base64);
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
      salt,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  const hashBytes = new Uint8Array(derivedBits);
  const saltB64 = bytesToBase64Url(salt);
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
  if (Number.isNaN(iterations) || iterations <= 0) return false;
  const salt = base64UrlToBytes(parts[2]);
  const expectedHash = parts[3];

  const actualHashed = await hashPassword(password, salt, iterations);
  const actualParts = actualHashed.split('$');
  return constantTimeEqual(actualParts[3], expectedHash);
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
  await ensureAuthSchema(db);
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

export async function recordLoginFailure(db, ip, email) {
  const ipHash = await sha256Hex(ip || '127.0.0.1');
  const normEmail = normalizeEmail(email);
  const rateLimitKey = `login:${ipHash}:${normEmail}`;
  return recordRateLimitAttempt(db, rateLimitKey, false);
}

export async function clearRateLimit(db, ip, email) {
  const ipHash = await sha256Hex(ip || '127.0.0.1');
  const normEmail = normalizeEmail(email);
  const rateLimitKey = `login:${ipHash}:${normEmail}`;
  return recordRateLimitAttempt(db, rateLimitKey, true);
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

export async function checkRateLimit(db, ipOrKey, maybeEmail = null) {
  let key = ipOrKey;
  if (maybeEmail !== null) {
    const ipHash = await sha256Hex(ipOrKey || '127.0.0.1');
    const normEmail = normalizeEmail(maybeEmail);
    key = `login:${ipHash}:${normEmail}`;
  }
  const now = new Date();
  const nowIso = now.toISOString();

  const record = await db.prepare(
    `SELECT id, attempts, first_attempt_at, last_attempt_at, blocked_until FROM auth_rate_limits WHERE key = ? LIMIT 1`
  ).bind(key).first();

  if (!record) {
    return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS };
  }

  if (record.blocked_until && new Date(record.blocked_until) > now) {
    return { allowed: false, remaining: 0, blockedUntil: record.blocked_until };
  }

  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
  if (new Date(record.first_attempt_at) < windowStart) {
    // Window expired, reset
    await db.prepare(`DELETE FROM auth_rate_limits WHERE key = ?`).bind(key).run();
    return { allowed: true, remaining: RATE_LIMIT_MAX_ATTEMPTS };
  }

  const remaining = Math.max(0, RATE_LIMIT_MAX_ATTEMPTS - record.attempts);
  return { allowed: record.attempts < RATE_LIMIT_MAX_ATTEMPTS, remaining };
}

export async function recordRateLimitAttempt(db, key, success = false) {
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
  if (newAttempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    blockedUntil = new Date(now.getTime() + RATE_LIMIT_BLOCK_MS).toISOString();
  }

  await db.prepare(
    `UPDATE auth_rate_limits SET attempts = ?, last_attempt_at = ?, blocked_until = ? WHERE key = ?`
  ).bind(newAttempts, nowIso, blockedUntil, key).run();
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

  await ensureAuthSchema(db);
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
  TABLE_SQL
};
