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
import { onRequestDelete as deleteComment } from '../functions/api/comments.js';
import { onRequestPost as disclosureSyncPost } from '../functions/api/disclosures/sync.js';

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

test('Phase 1A keeps apex admin compatible while the same policy exposes the future enforcement result', () => {
  assert.equal(ADMIN_APEX_COMPATIBILITY, true);
  assert.deepEqual(apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/admin/manage/`)), { action: 'pass' });
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/admin/manage/?from=test`), { compatibilityMode: false }),
    { action: 'redirect', status: 307, location: `${ADMIN_ORIGIN}/admin/manage/?from=test` }
  );
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/api/manage`, { method: 'POST' }), { compatibilityMode: false }),
    { action: 'deny', status: 403 }
  );
  // HYBRID endpoints make the final decision after authentication so their
  // machine credentials are not accidentally moved to the administrator host.
  assert.deepEqual(
    apexAdminRouteDecision(request(`${PUBLIC_ORIGIN}/api/market/publish`, { method: 'POST' }), { compatibilityMode: false }),
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

test('middleware allows Compatibility admin UI and adds admin-only no-store and CSP headers', async () => {
  const apex = htmlContext(`${PUBLIC_ORIGIN}/admin/`);
  assert.equal((await middleware(apex.context)).status, 200);
  assert.equal(apex.calls(), 1);

  const admin = htmlContext(`${ADMIN_ORIGIN}/admin/manage/`);
  const response = await middleware(admin.context);
  assert.equal(response.status, 200);
  assert.equal(admin.calls(), 1);
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

test('publish and manage accept admin origin without weakening apex Compatibility Mode', async () => {
  const env = { ADMIN_KEY: 'admin-secret', GITHUB_TOKEN: 'github-secret' };
  const call = (handler, origin, suppliedOrigin = origin) => handler({
    request: request(`${origin}${handler === publishPost ? '/api/publish' : '/api/manage'}`, {
      method: 'POST',
      headers: { 'x-admin-key': 'admin-secret', ...(suppliedOrigin ? { origin: suppliedOrigin } : {}) },
      body: new FormData()
    }),
    env
  });

  let response = await call(publishPost, ADMIN_ORIGIN);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'NO_FILE');

  response = await call(publishPost, PUBLIC_ORIGIN);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'NO_FILE');

  response = await call(managePost, ADMIN_ORIGIN, PUBLIC_ORIGIN);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'BAD_ORIGIN');

  response = await call(managePost, ADMIN_ORIGIN, '');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'ORIGIN_REQUIRED');

  response = await call(managePost, 'https://unknown.example', 'https://unknown.example');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'PREVIEW_READ_ONLY');
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

test('comments admin delete uses the shared admin host and exact-Origin policy', async () => {
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
          return null;
        },
        async run() { return { success: true }; }
      };
    },
    async batch() { return []; }
  };
  const body = JSON.stringify({ id: 'comment-1', report: '/reports/example' });
  const call = (origin) => deleteComment({
    request: request(`${ADMIN_ORIGIN}/api/comments`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'admin-secret', ...(origin ? { origin } : {}) },
      body
    }),
    env: { ADMIN_KEY: 'admin-secret', COMMENTS_DB: db }
  });

  assert.equal((await call('')).status, 403);
  assert.equal((await call(PUBLIC_ORIGIN)).status, 403);
  assert.equal((await call(ADMIN_ORIGIN)).status, 200);
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
