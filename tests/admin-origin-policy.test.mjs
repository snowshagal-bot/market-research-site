import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_APEX_COMPATIBILITY,
  ADMIN_CSP,
  ADMIN_ORIGIN,
  HOST_CLASS,
  PUBLIC_ORIGIN,
  adminHostRouteDecision,
  apexAdminRouteDecision,
  classifyHost,
  isAdminHostnameAllowedPath,
  validateHumanAdminMutation
} from '../functions/_host-policy.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequestPost as publishPost } from '../functions/api/publish.js';
import { onRequestPost as managePost } from '../functions/api/manage.js';
import {
  onRequestGet as getComments,
  onRequestPost as postComment,
  onRequestDelete as deleteComment
} from '../functions/api/comments.js';
import { onRequestPost as disclosureSyncPost } from '../functions/api/disclosures/sync.js';
import { createMockAuthEnv } from './helpers/auth-test-helper.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function request(url, options = {}) {
  return new Request(url, options);
}

function htmlContext(url, options = {}) {
  let calls = 0;
  return {
    context: {
      request: request(url, options),
      env: {},
      next: async () => {
        calls += 1;
        return new Response('<!doctype html><html><head></head><body>ok</body></html>', {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
    },
    calls: () => calls
  };
}

test('hostname classification distinguishes canonical, redirect, admin, branch Preview, and unknown hosts', () => {
  assert.equal(classifyHost(`${PUBLIC_ORIGIN}/`), HOST_CLASS.PUBLIC_PRODUCTION);
  assert.equal(classifyHost('https://www.snowshagal.com/'), HOST_CLASS.PUBLIC_REDIRECT);
  assert.equal(classifyHost(ADMIN_ORIGIN), HOST_CLASS.ADMIN_PRODUCTION);
  assert.equal(classifyHost('https://feat-admin.market-research-site.pages.dev/admin/'), HOST_CLASS.PREVIEW);
  assert.equal(classifyHost('https://market-research-site.pages.dev/'), HOST_CLASS.PUBLIC_REDIRECT);
  assert.equal(classifyHost('https://attacker.pages.dev/'), HOST_CLASS.UNKNOWN);
});

test('Phase 1A enforcement redirects apex admin GET/HEAD and blocks mutations', () => {
  assert.equal(ADMIN_APEX_COMPATIBILITY, false);
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/admin/manage/`)),
    { action: 'redirect', status: 307, location: `${ADMIN_ORIGIN}/admin/manage/` }
  );
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/admin/manage/?from=test`)),
    { action: 'redirect', status: 307, location: `${ADMIN_ORIGIN}/admin/manage/?from=test` }
  );
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/admin/manage/`, { method: 'HEAD' })),
    { action: 'redirect', status: 307, location: `${ADMIN_ORIGIN}/admin/manage/` }
  );
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/api/manage`, { method: 'POST' })),
    { action: 'deny', status: 403 }
  );
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/admin/manage/`, { method: 'POST' })),
    { action: 'deny', status: 403 }
  );
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/admin/manage/`), { compatibilityMode: true }),
    { action: 'pass' }
  );
  // HYBRID endpoints make the final decision after authentication so their
  // machine credentials are not accidentally moved to the administrator host.
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/api/market/publish`, { method: 'POST' })),
    { action: 'pass' }
  );
});

test('admin hostname exposes only the inventoried administrator surface', () => {
  for (const pathname of [
    '/admin/', '/admin/manage/', '/admin/analytics/', '/admin/disclosures/', '/admin/market/',
    '/assets/admin.js', '/assets/site.css', '/assets/brand/snowshagal-owl.webp',
    '/data/posts.json', '/data/posts.js', '/data/tags.js', '/covers/example.webp',
    '/api/publish', '/api/manage', '/api/analytics', '/api/market/latest', '/api/disclosures/feed'
  ]) assert.equal(isAdminHostnameAllowedPath(pathname), true, pathname);

  for (const pathname of [
    '/', '/en/', '/about/', '/market/', '/reports/example', '/en/reports/example',
    '/reports/en/example', '/assets/report-shell.js', '/data/search-index-meta.js', '/api/engagement'
  ]) assert.equal(isAdminHostnameAllowedPath(pathname), false, pathname);

  assert.deepEqual(adminHostRouteDecision(`${ADMIN_ORIGIN}/reports/example`), { action: 'deny', status: 404 });
});

test('middleware denies report and public active HTML on admin host before static fallback', async () => {
  for (const pathname of ['/reports/example', '/reports/en/example', '/en/reports/example', '/', '/about/', '/market/']) {
    const fixture = htmlContext(`${ADMIN_ORIGIN}${pathname}`);
    const response = await middleware(fixture.context);
    assert.equal(response.status, 404, pathname);
    assert.equal(fixture.calls(), 0, pathname);
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  }
});

test('middleware redirects apex admin UI to admin host and adds admin-only no-store and CSP headers on admin host', async () => {
  const apex = htmlContext(`${PUBLIC_ORIGIN}/admin/`);
  const apexRes = await middleware(apex.context);
  assert.equal(apexRes.status, 307);
  assert.equal(apexRes.headers.get('location'), `${ADMIN_ORIGIN}/admin/`);
  assert.equal(apex.calls(), 0);

  const apexWithQuery = htmlContext(`${PUBLIC_ORIGIN}/admin/manage/?tab=drafts`);
  const apexWithQueryRes = await middleware(apexWithQuery.context);
  assert.equal(apexWithQueryRes.status, 307);
  assert.equal(apexWithQueryRes.headers.get('location'), `${ADMIN_ORIGIN}/admin/manage/?tab=drafts`);
  assert.equal(apexWithQuery.calls(), 0);

  const unauthAdmin = htmlContext(`${ADMIN_ORIGIN}/admin/manage/`);
  const unauthRes = await middleware(unauthAdmin.context);
  assert.equal(unauthRes.status, 302);
  assert.equal(unauthRes.headers.get('location'), `/admin/login/?next=%2Fadmin%2Fmanage%2F`);

  const adminLogin = htmlContext(`${ADMIN_ORIGIN}/admin/login/`);
  const response = await middleware(adminLogin.context);
  assert.equal(response.status, 200);
  assert.equal(adminLogin.calls(), 1);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('content-security-policy'), ADMIN_CSP);
  for (const directive of ['default-src', 'script-src', 'style-src', 'connect-src', 'img-src', 'form-action', 'base-uri', 'frame-ancestors']) {
    assert.match(ADMIN_CSP, new RegExp(`(?:^|; )${directive} `));
  }
});

test('human-admin mutations require the exact host-derived Origin', () => {
  const validAdmin = request(`${ADMIN_ORIGIN}/api/manage`, { method: 'POST', headers: { origin: ADMIN_ORIGIN } });
  assert.equal(validateHumanAdminMutation(validAdmin).ok, true);

  const wrongOrigin = request(`${ADMIN_ORIGIN}/api/manage`, { method: 'POST', headers: { origin: PUBLIC_ORIGIN } });
  assert.equal(validateHumanAdminMutation(wrongOrigin).error, 'BAD_ORIGIN');

  const missingOrigin = request(`${ADMIN_ORIGIN}/api/manage`, { method: 'POST' });
  assert.equal(validateHumanAdminMutation(missingOrigin).error, 'ORIGIN_REQUIRED');

  const previewOrigin = 'https://feat-admin.market-research-site.pages.dev';
  assert.equal(validateHumanAdminMutation(request(`${previewOrigin}/api/disclosures/publish`, {
    method: 'POST', headers: { origin: previewOrigin }
  })).ok, true);
  assert.equal(validateHumanAdminMutation(request(`${previewOrigin}/api/disclosures/publish`, {
    method: 'POST', headers: { origin: 'https://other.market-research-site.pages.dev' }
  })).error, 'BAD_ORIGIN');
});

test('publish and manage accept admin origin and block apex human-admin mutations in enforcement mode', async () => {
  const env = await createMockAuthEnv({ ADMIN_KEY: 'admin-secret', GITHUB_TOKEN: 'github-secret' });
  const call = (handler, origin, suppliedOrigin = origin) => handler({
    request: request(`${origin}${handler === publishPost ? '/api/publish' : '/api/manage'}`, {
      method: 'POST',
      headers: {
        'x-admin-key': 'admin-secret',
        cookie: env._authSession.cookieHeader,
        'x-csrf-token': env._authSession.csrfToken,
        ...(suppliedOrigin ? { origin: suppliedOrigin } : {})
      },
      body: new FormData()
    }),
    env
  });

  let response = await call(publishPost, ADMIN_ORIGIN);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'NO_FILE');

  response = await call(publishPost, PUBLIC_ORIGIN);
  assert.equal(response.status, 403);
  const publishApexData = await response.json();
  assert.ok(['PREVIEW_READ_ONLY', 'ADMIN_HOST_BLOCKED'].includes(publishApexData.error));

  response = await call(managePost, ADMIN_ORIGIN, PUBLIC_ORIGIN);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'BAD_ORIGIN');

  response = await call(managePost, ADMIN_ORIGIN, '');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'ORIGIN_REQUIRED');

  response = await call(managePost, 'https://unknown.example', 'https://unknown.example');
  assert.equal(response.status, 403);
  const unknownData = await response.json();
  assert.ok(['PREVIEW_READ_ONLY', 'ADMIN_HOST_BLOCKED'].includes(unknownData.error));
});

test('machine disclosure credential remains independent of human Origin validation', async () => {
  const response = await disclosureSyncPost({
    request: request(`${PUBLIC_ORIGIN}/api/disclosures/sync`, {
      method: 'POST',
      headers: { 'x-disclosure-sync-key': 'machine-secret', 'content-type': 'application/json' },
      body: '{}'
    }),
    env: { DISCLOSURE_SYNC_KEY: 'machine-secret' }
  });
  assert.notEqual(response.status, 403);
  assert.equal((await response.json()).error, 'DB_NOT_CONFIGURED');
});

test('comments admin delete uses the shared admin host and exact-Origin policy while guest comments work on apex', async () => {
  const columns = [
    'id', 'report_key', 'nickname', 'body', 'password_salt',
    'password_hash', 'ip_hash', 'created_at', 'deleted_at'
  ];
  const db = {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (sql === 'PRAGMA table_info(comments)') return { results: columns.map((name) => ({ name })) };
          return { results: [] };
        },
        async first() {
          if (sql.includes('SELECT id, password_salt')) return { id: 'comment-1', passwordSalt: '', passwordHash: '' };
          if (sql.includes('SELECT COUNT(*) AS count')) return { count: 0 };
          return null;
        },
        async run() { return { success: true }; }
      };
    },
    async batch() { return []; }
  };
  const body = JSON.stringify({ id: 'comment-1', report: '/reports/example' });
  const call = (origin) => deleteComment({
    request: request(`${origin || ADMIN_ORIGIN}/api/comments`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'admin-secret', ...(origin ? { origin } : {}) },
      body
    }),
    env: { ADMIN_KEY: 'admin-secret', COMMENTS_DB: db }
  });

  // Admin deletion requires admin host and matching admin origin:
  assert.equal((await call('')).status, 403);
  assert.equal((await call(PUBLIC_ORIGIN)).status, 403);
  assert.equal((await call(ADMIN_ORIGIN)).status, 200);

  // Guest comment reads and writes work normally on public apex:
  const getRes = await getComments({
    request: request(`${PUBLIC_ORIGIN}/api/comments?report=%2Freports%2Fexample`),
    env: { COMMENTS_DB: db }
  });
  assert.equal(getRes.status, 200);

  const postRes = await postComment({
    request: request(`${PUBLIC_ORIGIN}/api/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: PUBLIC_ORIGIN },
      body: JSON.stringify({ report: '/reports/example', nickname: 'reader', body: 'good report', password: 'guestpassword123' })
    }),
    env: { COMMENTS_DB: db }
  });
  assert.equal(postRes.status, 201);
});

test('administrator static dependencies resolve on admin host and public exits are absolute apex URLs', async () => {
  const htmlFiles = [
    'admin/index.html', 'admin/manage/index.html', 'admin/analytics/index.html',
    'admin/market/index.html', 'admin/disclosures/index.html'
  ];
  for (const relative of htmlFiles) {
    const html = await readFile(path.join(root, relative), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
      const pathname = new URL(match[1], ADMIN_ORIGIN).pathname;
      assert.equal(isAdminHostnameAllowedPath(pathname), true, `${relative}: ${pathname}`);
    }
  }

  const publishClient = await readFile(path.join(root, 'assets/admin.js'), 'utf8');
  const manageClient = await readFile(path.join(root, 'assets/admin-manage.js'), 'utf8');
  const marketClient = await readFile(path.join(root, 'assets/market-close.js'), 'utf8');
  assert.match(publishClient, /https:\/\/snowshagal\.com/);
  assert.match(manageClient, /https:\/\/snowshagal\.com/);
  assert.match(marketClient, /https:\/\/snowshagal\.com\/\$\{String\(exactDaily\.href\)/);
  assert.match(publishClient, /hostname !== 'admin\.snowshagal\.com'/);
  assert.match(manageClient, /hostname !== 'admin\.snowshagal\.com'/);
});

test('Functions do not introduce wildcard or credentialed cross-origin CORS', async () => {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  }
  await walk(path.join(root, 'functions'));
  const source = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(source, /access-control-allow-origin["']?\s*[:=]\s*["']\*/i);
  assert.doesNotMatch(source, /access-control-allow-credentials["']?\s*[:=]\s*["']true/i);
});
