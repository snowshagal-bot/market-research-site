import { DatabaseSync } from 'node:sqlite';
import {
  ensureAuthSchema,
  hashToken,
  SESSION_COOKIE_NAME,
  generateCsrfToken
} from '../../functions/_auth.js';

class SqliteStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values.map(v => (v === undefined ? null : v));
    return this;
  }

  async run() {
    const stmt = this.database.prepare(this.sql);
    const info = stmt.run(...this.values);
    return { success: true, meta: { changes: info.changes } };
  }

  async first(col) {
    const stmt = this.database.prepare(this.sql);
    const row = stmt.get(...this.values);
    if (!row) return null;
    if (col) return row[col];
    return row;
  }

  async all() {
    const stmt = this.database.prepare(this.sql);
    const results = stmt.all(...this.values);
    return { results, success: true };
  }
}

export class MockD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
  }

  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }

  close() {
    this.database.close();
  }
}

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const migrationPath = fileURLToPath(new URL('../../migrations/auth/0001_auth_foundation.sql', import.meta.url));
const MIGRATION_SQL = readFileSync(migrationPath, 'utf8');

export async function createMockAuthDb(skipSchema = false) {
  const db = new MockD1();
  if (!skipSchema) {
    db.exec(MIGRATION_SQL);
  }
  return db;
}

export async function createAdminSession(authDb, options = {}) {
  const userId = options.userId || crypto.randomUUID();
  const email = (options.email || 'admin@snowshagal.com').trim().toLowerCase();
  const role = options.role || 'admin';
  const status = options.status || 'active';
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // Create user
  await authDb.prepare(
    `INSERT OR REPLACE INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(userId, email, email, role, status, createdAt, createdAt).run();

  // Create session
  const rawTokenBytes = new Uint8Array(32);
  crypto.getRandomValues(rawTokenBytes);
  let rawToken = '';
  for (const b of rawTokenBytes) rawToken += b.toString(16).padStart(2, '0');

  const tokenHash = await hashToken(rawToken);
  const csrfToken = generateCsrfToken();
  const sessionId = crypto.randomUUID();

  await authDb.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(sessionId, userId, tokenHash, csrfToken, createdAt, expiresAt).run();

  const cookieHeader = `${SESSION_COOKIE_NAME}=${rawToken}`;

  return {
    userId,
    email,
    role,
    rawToken,
    sessionId,
    csrfToken,
    cookieHeader,
    headers: {
      'cookie': cookieHeader,
      'x-csrf-token': csrfToken,
      'origin': 'https://admin.snowshagal.com'
    }
  };
}

export async function createMockAuthEnv(extra = {}) {
  const authDb = extra.AUTH_DB || (await createMockAuthDb());
  const session = await createAdminSession(authDb);
  return {
    AUTH_DB: authDb,
    AUTH_PEPPER: 'test-auth-pepper-secret-minimum-32-bytes',
    ADMIN_ORIGIN: 'https://admin.snowshagal.com',
    ADMIN_KEY: 'test-admin-key',
    GITHUB_TOKEN: 'test-token',
    GITHUB_REPO: 'snowshagal-bot/market-research-site',
    ...extra,
    _authSession: session
  };
}
