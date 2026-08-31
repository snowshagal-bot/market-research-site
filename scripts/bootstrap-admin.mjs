#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  hashPassword,
  normalizeEmail,
  validatePasswordStrength,
  ensureAuthSchema
} from '../functions/_auth.js';

export async function createAdminUserSql({ email, password }) {
  const normEmail = normalizeEmail(email);
  if (!normEmail || !normEmail.includes('@')) {
    throw new Error('올바른 이메일 주소를 입력해 주세요.');
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    throw new Error(strength.message);
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const userSql = `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES ('${userId}', '${normEmail}', '${normEmail}', 'admin', 'active', '${now}', '${now}');`;
  const credSql = `INSERT INTO password_credentials (user_id, password_hash, password_changed_at) VALUES ('${userId}', '${passwordHash}', '${now}');`;

  return {
    userId,
    email: normEmail,
    role: 'admin',
    passwordHash,
    sql: `${userSql}\n${credSql}`
  };
}

export async function bootstrapAdmin(db, { email, password }) {
  await ensureAuthSchema(db);
  const normEmail = normalizeEmail(email);
  const existing = await db.prepare(`SELECT id, email FROM users WHERE role = 'admin' LIMIT 1`).first();
  if (existing) {
    throw new Error(`이미 관리자 계정(${existing.email})이 존재합니다.`);
  }

  const result = await createAdminUserSql({ email, password });
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?)`
  ).bind(result.userId, result.email, result.email, now, now).run();

  await db.prepare(
    `INSERT INTO password_credentials (user_id, password_hash, password_changed_at) VALUES (?, ?, ?)`
  ).bind(result.userId, result.passwordHash, now).run();

  return { userId: result.userId, email: result.email, role: 'admin' };
}

// CLI interactive execution
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const email = (await rl.question('Admin Email: ')).trim();
    const password = await rl.question('Admin Password (min 12 chars): ');
    if (!email || !password) {
      console.error('Email and password are required.');
      process.exit(1);
    }
    const result = await createAdminUserSql({ email, password });
    console.log('\n--- Admin SQL Bootstrap Query ---');
    console.log(result.sql);
    console.log('---------------------------------');
    console.log(`\nGenerated admin bootstrap SQL for ${result.email} (ID: ${result.userId})`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}
