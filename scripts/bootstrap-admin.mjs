#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hashPassword,
  normalizeEmail,
  validatePasswordStrength,
  validateAuthSchema
} from '../functions/_auth.js';

export function escapeSqlString(value) {
  return String(value || '').replace(/'/g, "''");
}

export function askHidden(query) {
  return new Promise((res) => {
    stdout.write(query);
    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin, output: stdout });
      rl.question('', (answer) => {
        rl.close();
        res(answer.trim());
      });
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (char) => {
      char = String(char);
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(Boolean(wasRaw));
        stdin.pause();
        stdout.write('\n');
        res(input);
      } else if (char === '\u0003') {
        stdin.removeListener('data', onData);
        stdin.setRawMode(Boolean(wasRaw));
        process.exit(1);
      } else if (char === '\u007f' || char === '\b') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    stdin.on('data', onData);
  });
}

export async function createAdminUserSql({ email, password }) {
  const normEmail = normalizeEmail(email);
  if (!normEmail || !normEmail.includes('@') || normEmail.length > 254) {
    throw new Error('올바른 이메일 주소를 입력해 주세요.');
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    throw new Error(strength.message);
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const safeUserId = escapeSqlString(userId);
  const safeEmail = escapeSqlString(normEmail);
  const safeHash = escapeSqlString(passwordHash);
  const safeNow = escapeSqlString(now);

  const userSql = `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES ('${safeUserId}', '${safeEmail}', '${safeEmail}', 'admin', 'active', '${safeNow}', '${safeNow}');`;
  const credSql = `INSERT INTO password_credentials (user_id, password_hash, password_changed_at) VALUES ('${safeUserId}', '${safeHash}', '${safeNow}');`;

  return {
    userId,
    email: normEmail,
    role: 'admin',
    passwordHash,
    sql: `${userSql}\n${credSql}`
  };
}

export async function bootstrapAdmin(db, { email, password }) {
  const schemaCheck = await validateAuthSchema(db);
  if (!schemaCheck.ready) {
    throw new Error(schemaCheck.message);
  }
  const normEmail = normalizeEmail(email);
  const existing = await db.prepare(`SELECT id, email FROM users WHERE role = 'admin' LIMIT 1`).first();
  if (existing) {
    throw new Error(`이미 관리자 계정(${existing.email})이 존재합니다.`);
  }

  const result = await createAdminUserSql({ email, password });
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      `INSERT INTO users (id, email, email_normalized, role, status, created_at, updated_at) VALUES (?, ?, ?, 'admin', 'active', ?, ?)`
    ).bind(result.userId, result.email, result.email, now, now),
    db.prepare(
      `INSERT INTO password_credentials (user_id, password_hash, password_changed_at) VALUES (?, ?, ?)`
    ).bind(result.userId, result.passwordHash, now)
  ]);

  return { userId: result.userId, email: result.email, role: 'admin' };
}

// CLI interactive execution
if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/')) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const email = (await rl.question('Admin Email: ')).trim();
    rl.close();

    const password = await askHidden('Admin Password (min 12 chars): ');
    if (!email || !password) {
      console.error('Email and password are required.');
      process.exit(1);
    }

    const result = await createAdminUserSql({ email, password });
    const outFile = process.argv[2] ? resolve(process.argv[2]) : resolve('.bootstrap-admin.sql');
    writeFileSync(outFile, result.sql, { encoding: 'utf8', mode: 0o600 });

    console.log(`\n✔ Admin user generated successfully for: ${result.email} (ID: ${result.userId})`);
    console.log(`✔ Bootstrap SQL written to: ${outFile}`);
    console.log('(Note: Password hashes and credential SQL are stored in the file and not printed to console.)');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}
