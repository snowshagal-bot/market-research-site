const MAX_NICKNAME = 20;
const MAX_BODY = 1000;
const MAX_PASSWORD = 64;
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  report_key TEXT NOT NULL,
  nickname TEXT NOT NULL,
  body TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
)
`;
const INDEX_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_comments_report_created ON comments (report_key, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_comments_ip_created ON comments (ip_hash, created_at)'
];
const REQUIRED_COLUMNS = [
  'id', 'report_key', 'nickname', 'body', 'password_salt',
  'password_hash', 'ip_hash', 'created_at', 'deleted_at'
];
const LEGACY_TABLE = 'comments_legacy_v1';

let schemaPromise = null;

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function normalizeReportKey(raw) {
  let value = String(raw || '').trim();
  try { value = decodeURIComponent(value); } catch (_) {}
  value = value.split('?')[0].split('#')[0];
  if (!value.startsWith('/reports/')) return '';
  return value.slice(0, 500);
}

function cleanText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashPassword(password, saltBase64) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: base64ToBytes(saltBase64),
    iterations: 120000,
    hash: 'SHA-256'
  }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function digestText(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64(new Uint8Array(digest));
}

function constantTimeEqual(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return diff === 0;
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

async function ensureDbReady(env) {
  if (!env.COMMENTS_DB) {
    return reply({ error: 'DB_NOT_CONFIGURED', message: '댓글 데이터베이스가 아직 연결되지 않았습니다.' }, 503);
  }
  if (!schemaPromise) {
    schemaPromise = ensureSchema(env.COMMENTS_DB).catch(err => {
      schemaPromise = null;
      throw err;
    });
  }
  try {
    await schemaPromise;
    return null;
  } catch (err) {
    console.error('comment schema init failed', err);
    return reply({ error: 'DB_INIT_FAILED', message: '댓글 데이터베이스 초기화에 실패했습니다.' }, 500);
  }
}

async function ensureSchema(db) {
  const info = await db.prepare('PRAGMA table_info(comments)').all();
  const columns = new Set((info.results || []).map(column => column.name));
  const hasCurrentSchema = REQUIRED_COLUMNS.every(column => columns.has(column));

  if (columns.size && !hasCurrentSchema) {
    const existingLegacy = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    ).bind(LEGACY_TABLE).first();

    if (existingLegacy) {
      throw new Error('An incompatible comments table and a preserved legacy table both exist.');
    }

    await db.batch([
      db.prepare('DROP INDEX IF EXISTS idx_comments_report_created'),
      db.prepare('DROP INDEX IF EXISTS idx_comments_ip_created'),
      db.prepare(`ALTER TABLE comments RENAME TO ${LEGACY_TABLE}`)
    ]);
  }

  await db.batch([
    db.prepare(TABLE_SQL),
    ...INDEX_SQL.map(statement => db.prepare(statement))
  ]);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const missing = await ensureDbReady(env);
  if (missing) return missing;

  const url = new URL(request.url);
  const reportKey = normalizeReportKey(url.searchParams.get('report'));
  if (!reportKey) return reply({ error: 'BAD_REPORT', message: '리포트 경로를 확인하세요.' }, 400);

  try {
    const result = await env.COMMENTS_DB.prepare(`
      SELECT id, nickname, body, created_at AS createdAt
      FROM comments
      WHERE report_key = ? AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 300
    `).bind(reportKey).all();

    return reply({ ok: true, comments: result.results || [] });
  } catch (err) {
    console.error('comments get failed', err);
    return reply({ error: 'COMMENTS_READ_FAILED', message: '댓글을 불러오지 못했습니다.' }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const missing = await ensureDbReady(env);
  if (missing) return missing;
  if (!sameOrigin(request)) return reply({ error: 'BAD_ORIGIN', message: '허용되지 않은 요청입니다.' }, 403);

  let data;
  try { data = await request.json(); }
  catch (_) { return reply({ error: 'BAD_JSON', message: '댓글 데이터를 읽을 수 없습니다.' }, 400); }

  const reportKey = normalizeReportKey(data.report);
  const nickname = cleanText(data.nickname).replace(/\s+/g, ' ');
  const body = cleanText(data.body);
  const password = String(data.password || '');
  const honeypot = String(data.website || '').trim();

  if (honeypot) return reply({ ok: true }, 200);
  if (!reportKey) return reply({ error: 'BAD_REPORT', message: '리포트 경로를 확인하세요.' }, 400);
  if (nickname.length < 2 || nickname.length > MAX_NICKNAME) return reply({ error: 'BAD_NICKNAME', message: '닉네임은 2~20자로 입력하세요.' }, 400);
  if (!body || body.length > MAX_BODY) return reply({ error: 'BAD_BODY', message: '댓글은 1~1000자로 입력하세요.' }, 400);
  if (password.length < 4 || password.length > MAX_PASSWORD) return reply({ error: 'BAD_PASSWORD', message: '삭제 비밀번호는 4~64자로 입력하세요.' }, 400);

  const now = new Date();
  const createdAt = now.toISOString();
  const cutoff = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await digestText(`${ip}|${env.ADMIN_KEY || 'comment-rate-v1'}`);

  try {
    const rate = await env.COMMENTS_DB.prepare(`
      SELECT COUNT(*) AS count
      FROM comments
      WHERE ip_hash = ? AND created_at >= ?
    `).bind(ipHash, cutoff).first();

    if (Number(rate?.count || 0) >= RATE_LIMIT_COUNT) {
      return reply({ error: 'RATE_LIMIT', message: '댓글을 너무 빠르게 작성하고 있습니다. 잠시 후 다시 시도하세요.' }, 429);
    }

    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = bytesToBase64(saltBytes);
    const passwordHash = await hashPassword(password, salt);
    const id = crypto.randomUUID();

    await env.COMMENTS_DB.prepare(`
      INSERT INTO comments (
        id, report_key, nickname, body, password_salt, password_hash, ip_hash, created_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).bind(id, reportKey, nickname, body, salt, passwordHash, ipHash, createdAt).run();

    return reply({ ok: true, comment: { id, nickname, body, createdAt } }, 201);
  } catch (err) {
    console.error('comments post failed', err);
    return reply({ error: 'COMMENTS_WRITE_FAILED', message: '댓글을 저장하지 못했습니다.' }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const missing = await ensureDbReady(env);
  if (missing) return missing;
  if (!sameOrigin(request)) return reply({ error: 'BAD_ORIGIN', message: '허용되지 않은 요청입니다.' }, 403);

  let data;
  try { data = await request.json(); }
  catch (_) { return reply({ error: 'BAD_JSON', message: '삭제 요청을 읽을 수 없습니다.' }, 400); }

  const id = String(data.id || '').trim();
  const reportKey = normalizeReportKey(data.report);
  const password = String(data.password || '');
  if (!id || !reportKey) return reply({ error: 'BAD_REQUEST', message: '댓글 정보를 확인하세요.' }, 400);

  try {
    const row = await env.COMMENTS_DB.prepare(`
      SELECT id, password_salt AS passwordSalt, password_hash AS passwordHash
      FROM comments
      WHERE id = ? AND report_key = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(id, reportKey).first();

    if (!row) return reply({ error: 'NOT_FOUND', message: '댓글을 찾을 수 없습니다.' }, 404);

    let authorized = false;
    const adminKey = request.headers.get('x-admin-key') || '';
    if (env.ADMIN_KEY && adminKey && constantTimeEqual(adminKey, env.ADMIN_KEY)) {
      authorized = true;
    } else if (password) {
      const candidate = await hashPassword(password, row.passwordSalt);
      authorized = constantTimeEqual(candidate, row.passwordHash);
    }

    if (!authorized) return reply({ error: 'BAD_PASSWORD', message: '삭제 비밀번호가 올바르지 않습니다.' }, 401);

    await env.COMMENTS_DB.prepare(`UPDATE comments SET deleted_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), id).run();

    return reply({ ok: true });
  } catch (err) {
    console.error('comments delete failed', err);
    return reply({ error: 'COMMENTS_DELETE_FAILED', message: '댓글을 삭제하지 못했습니다.' }, 500);
  }
}
