import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from '../functions/api/admin/runtime-status.js';
import { createMockAuthDb, createAdminSession } from './helpers/auth-test-helper.mjs';

function createAdminRequest(url = 'https://admin.snowshagal.com/api/admin/runtime-status', headers = {}) {
  return new Request(url, {
    method: 'GET',
    headers: {
      ...headers
    }
  });
}

test('runtime-status requires admin host and returns 403 on public host', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });
  const env = { AUTH_DB: db };
  const res = await onRequestGet({ request, env });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'FORBIDDEN_HOST');
});

test('runtime-status requires authenticated admin session and returns 401 when unauthenticated', async () => {
  const db = await createMockAuthDb();
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status');
  const env = { AUTH_DB: db };
  const res = await onRequestGet({ request, env });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'UNAUTHORIZED');
});

test('runtime-status blocks non-admin member sessions with 403 FORBIDDEN', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db, { role: 'member' });
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });
  const env = { AUTH_DB: db };
  const res = await onRequestGet({ request, env });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'FORBIDDEN');
});

test('missing GITHUB_TOKEN sets githubTokenConfigured=false and skips outbound GitHub fetch', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('', { status: 200 });
  };
  try {
    const env = { AUTH_DB: db, GITHUB_TOKEN: '' };
    const res = await onRequestGet({ request, env });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.runtime.githubTokenConfigured, false);
    assert.equal(data.runtime.githubRepoRead, false);
    assert.equal(data.runtime.githubHttpStatus, null);
    assert.equal(fetchCalled, false, 'No outbound fetch must occur when GITHUB_TOKEN is missing');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('configured GITHUB_TOKEN with GitHub 200 response sets githubTokenConfigured=true and githubRepoRead=true', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });
  let calledUrl = '';
  let authHeader = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calledUrl = String(url);
    authHeader = options.headers?.Authorization || '';
    return new Response(JSON.stringify({ ref: 'refs/heads/main' }), { status: 200 });
  };
  try {
    const env = {
      AUTH_DB: db,
      GITHUB_TOKEN: 'ghp_secret_token_value_12345',
      CLOUDFLARE_BROWSER_RENDERING_TOKEN: 'br-token',
      DISCLOSURE_SYNC_KEY: 'disc-key',
      MARKET_PUBLISH_KEY: 'mkt-key'
    };
    const res = await onRequestGet({ request, env });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.runtime.githubTokenConfigured, true);
    assert.equal(data.runtime.githubRepoRead, true);
    assert.equal(data.runtime.githubHttpStatus, 200);
    assert.equal(data.runtime.browserRenderingConfigured, true);
    assert.equal(data.runtime.disclosureSyncKeyConfigured, true);
    assert.equal(data.runtime.marketPublishKeyConfigured, true);
    assert.match(calledUrl, /api\.github\.com\/repos\/snowshagal-bot\/market-research-site\/git\/ref\/heads\/main/);
    assert.equal(authHeader, 'Bearer ghp_secret_token_value_12345');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('configured GITHUB_TOKEN with GitHub 401/403/404 response sets githubRepoRead=false and reports exact status code', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });
  const originalFetch = globalThis.fetch;
  for (const status of [401, 403, 404]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status });
    try {
      const env = { AUTH_DB: db, GITHUB_TOKEN: 'expired_or_invalid_token' };
      const res = await onRequestGet({ request, env });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.runtime.githubTokenConfigured, true);
      assert.equal(data.runtime.githubRepoRead, false);
      assert.equal(data.runtime.githubHttpStatus, status);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});

test('runtime-status NEVER returns secret values, prefixes, hashes, or sensitive strings in response payload', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });
  const sensitiveToken = 'ghp_SUPER_SECRET_TOKEN_DO_NOT_LEAK_99999999';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ secret_github_internal: 'hidden' }), { status: 200 });
  try {
    const env = { AUTH_DB: db, GITHUB_TOKEN: sensitiveToken };
    const res = await onRequestGet({ request, env });
    const text = await res.text();
    assert.doesNotMatch(text, /SUPER_SECRET/);
    assert.doesNotMatch(text, /ghp_/);
    assert.doesNotMatch(text, /secret_github_internal/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
