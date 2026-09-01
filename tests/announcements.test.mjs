import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  computedAnnouncementStatus,
  validateAnnouncementInput
} from '../functions/_announcements.js';
import {
  onRequestDelete as adminDelete,
  onRequestGet as adminGet,
  onRequestPost as adminPost,
  onRequestPut as adminPut
} from '../functions/api/admin/announcements.js';
import { onRequestGet as publicGet } from '../functions/api/announcements.js';
import { isAdminHostnameAllowedPath } from '../functions/_host-policy.js';
import { MockD1, createAdminSession, createMockAuthDb } from './helpers/auth-test-helper.mjs';

const migration = await readFile(new URL('../migrations/comments/0001_admin_announcements.sql', import.meta.url), 'utf8');
const NOW = new Date('2026-09-01T03:00:00.000Z');

async function setup(options = {}) {
  const authDb = await createMockAuthDb();
  const session = await createAdminSession(authDb, options.session || {});
  const commentsDb = new MockD1();
  if (options.withSchema !== false) await commentsDb.exec(migration);
  return {
    authDb,
    commentsDb,
    session,
    env: { AUTH_DB: authDb, COMMENTS_DB: commentsDb }
  };
}

function request(session, method = 'GET', body = null, path = '/api/admin/announcements', origin = 'https://admin.snowshagal.com') {
  return new Request(`https://admin.snowshagal.com${path}`, {
    method,
    headers: {
      cookie: session.cookieHeader,
      origin,
      'x-csrf-token': session.csrfToken,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : null
  });
}

function input(overrides = {}) {
  return {
    noticeType: 'major',
    title: '서비스 점검 안내',
    content: 'MARKET 데이터 점검 시간 안내입니다.',
    audience: 'all',
    targetGroup: null,
    publishState: 'draft',
    exposureStartAt: '2026-09-01T02:00:00.000Z',
    exposureEndAt: null,
    ...overrides
  };
}

test('migration is rerunnable and creates the isolated announcement entity', async () => {
  const db = new MockD1();
  await db.exec(migration);
  await db.exec(migration);
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_announcements'").first();
  assert.equal(table.name, 'admin_announcements');
  db.close();
});

test('server validation enforces values, group target, UTC dates, and end >= start', () => {
  assert.equal(validateAnnouncementInput(input()).title, '서비스 점검 안내');
  assert.throws(() => validateAnnouncementInput(input({ title: '  ' })), /제목은 필수/);
  assert.throws(() => validateAnnouncementInput(input({ content: '' })), /본문은 필수/);
  assert.throws(() => validateAnnouncementInput(input({ noticeType: 'dart' })), /공지 유형/);
  assert.throws(() => validateAnnouncementInput(input({ audience: 'group', targetGroup: '' })), /대상 그룹/);
  assert.throws(() => validateAnnouncementInput(input({ exposureStartAt: '2026-09-01T12:00' })), /UTC ISO/);
  assert.throws(() => validateAnnouncementInput(input({ exposureEndAt: '2026-09-01T01:00:00.000Z' })), /빠를 수 없습니다/);
});

test('status is derived from publish_state and the exposure window', () => {
  assert.equal(computedAnnouncementStatus({ publish_state: 'draft', exposure_start_at: '2020-01-01T00:00:00.000Z' }, NOW), 'draft');
  assert.equal(computedAnnouncementStatus({ publish_state: 'published', exposure_start_at: '2026-09-01T04:00:00.000Z' }, NOW), 'scheduled');
  assert.equal(computedAnnouncementStatus({ publish_state: 'published', exposure_start_at: '2026-09-01T02:00:00.000Z', exposure_end_at: '2026-09-01T04:00:00.000Z' }, NOW), 'published');
  assert.equal(computedAnnouncementStatus({ publish_state: 'published', exposure_start_at: '2026-08-31T00:00:00.000Z', exposure_end_at: '2026-09-01T02:59:59.000Z' }, NOW), 'expired');
});

test('authenticated admin can create, list, update, publish, and delete with audit events', async () => {
  const ctx = await setup();
  const created = await adminPost({ request: request(ctx.session, 'POST', input()), env: ctx.env, now: NOW });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.item.status, 'draft');

  const listed = await adminGet({ request: request(ctx.session), env: ctx.env, now: NOW });
  const listBody = await listed.json();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.counts.draft, 1);

  const updated = await adminPut({
    request: request(ctx.session, 'PUT', input({ id: createdBody.item.id, publishState: 'published', title: '수정된 공지' })),
    env: ctx.env,
    now: NOW
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).item.status, 'published');

  const removed = await adminDelete({
    request: request(ctx.session, 'DELETE', null, `/api/admin/announcements?id=${createdBody.item.id}`),
    env: ctx.env
  });
  assert.equal(removed.status, 200);
  assert.equal((await ctx.commentsDb.prepare('SELECT count(*) AS count FROM admin_announcements').first()).count, 0);
  const audit = await ctx.authDb.prepare("SELECT event_type FROM audit_events WHERE event_type LIKE 'announcement.%' ORDER BY rowid").all();
  assert.deepEqual(audit.results.map(row => row.event_type), ['announcement.created', 'announcement.updated', 'announcement.deleted']);
  ctx.authDb.close();
  ctx.commentsDb.close();
});

test('public API exposes only current all-audience published notices', async () => {
  const ctx = await setup();
  const records = [
    input({ title: 'Draft', publishState: 'draft' }),
    input({ title: 'Future', publishState: 'published', exposureStartAt: '2026-09-01T04:00:00.000Z' }),
    input({ title: 'Active major', publishState: 'published' }),
    input({ title: 'Active general', noticeType: 'general', publishState: 'published' }),
    input({ title: 'Expired', publishState: 'published', exposureStartAt: '2026-08-30T00:00:00.000Z', exposureEndAt: '2026-09-01T02:00:00.000Z' }),
    input({ title: 'Group only', audience: 'group', targetGroup: 'members', publishState: 'published' })
  ];
  for (const body of records) {
    assert.equal((await adminPost({ request: request(ctx.session, 'POST', body), env: ctx.env, now: NOW })).status, 201);
  }

  const response = await publicGet({ request: new Request('https://snowshagal.com/api/announcements'), env: ctx.env, now: NOW });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /public/);
  const payload = await response.json();
  assert.deepEqual(payload.items.map(item => item.title), ['Active major', 'Active general']);
  assert.ok(payload.items.every(item => item.status === 'published' && item.audience === 'all'));

  const general = await publicGet({ request: new Request('https://snowshagal.com/api/announcements?type=general'), env: ctx.env, now: NOW });
  assert.deepEqual((await general.json()).items.map(item => item.title), ['Active general']);
  ctx.authDb.close();
  ctx.commentsDb.close();
});

test('admin API rejects unauthenticated, wrong-origin, non-admin, and unmigrated access', async () => {
  const ctx = await setup();
  const unauth = await adminGet({ request: new Request('https://admin.snowshagal.com/api/admin/announcements'), env: ctx.env, now: NOW });
  assert.equal(unauth.status, 401);

  const wrongOrigin = await adminPost({ request: request(ctx.session, 'POST', input(), '/api/admin/announcements', 'https://snowshagal.com'), env: ctx.env, now: NOW });
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await wrongOrigin.json()).error, 'BAD_ORIGIN');

  const memberCtx = await setup({ session: { role: 'member' } });
  const member = await adminGet({ request: request(memberCtx.session), env: memberCtx.env, now: NOW });
  assert.equal(member.status, 403);

  const missingCtx = await setup({ withSchema: false });
  const missing = await adminGet({ request: request(missingCtx.session), env: missingCtx.env, now: NOW });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'ANNOUNCEMENT_SCHEMA_NOT_READY');

  ctx.authDb.close(); ctx.commentsDb.close();
  memberCtx.authDb.close(); memberCtx.commentsDb.close();
  missingCtx.authDb.close(); missingCtx.commentsDb.close();
});

test('admin and public surfaces preserve the existing MARKET announcement UI contract', async () => {
  const [page, client, market, css] = await Promise.all([
    readFile(new URL('../admin/market/announcements/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../assets/admin-announcements.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/market-close.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/admin-announcements.css', import.meta.url), 'utf8')
  ]);
  for (const id of ['announcement-type', 'announcement-title', 'announcement-content', 'announcement-audience', 'announcement-target-group', 'announcement-start', 'announcement-end']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /<script src="\/data\/posts\.js"><\/script>\s*<script src="\/assets\/locale\.js\?v=[a-f0-9]+"><\/script>\s*<script src="\/assets\/site\.js\?v=[a-f0-9]+"><\/script>/);
  for (const filter of ['major', 'general', 'draft', 'scheduled', 'published', 'expired']) {
    assert.match(page, new RegExp(`data-filter="${filter}"`));
  }
  assert.match(client, /new Date\(`\$\{value\}:00\+09:00`\)/);
  assert.doesNotMatch(client, /\.innerHTML\s*=/);
  assert.match(market, /\/api\/announcements/);
  assert.match(market, /id="market-announcements-mount"/);
  assert.match(market, /html\(item\.content \|\| ''\)\.replace/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(client, /return item\.status !== 'expired';/);
  assert.equal(isAdminHostnameAllowedPath('/api/admin/announcements'), true);
  assert.equal(isAdminHostnameAllowedPath('/assets/admin-announcements.js'), true);
});
