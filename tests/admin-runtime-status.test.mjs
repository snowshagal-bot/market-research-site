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
      CLOUDFLARE_ACCOUNT_ID: 'acc-id-123',
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

test('browserRenderingConfigured requires both CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_BROWSER_RENDERING_TOKEN', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });

  const matrix = [
    { accountId: '', token: '', expected: false },
    { accountId: 'acc-123', token: '', expected: false },
    { accountId: '', token: 'br-tok', expected: false },
    { accountId: 'acc-123', token: 'br-tok', expected: true }
  ];

  for (const { accountId, token, expected } of matrix) {
    const env = {
      AUTH_DB: db,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_BROWSER_RENDERING_TOKEN: token
    };
    const res = await onRequestGet({ request, env });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(
      data.runtime.browserRenderingConfigured,
      expected,
      `Expected browserRenderingConfigured=${expected} when accountId="${accountId}" and token="${token}"`
    );
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
  const sensitiveGemini = 'AIzaSy_SUPER_SECRET_GEMINI_KEY_123456';
  const sensitiveOpenDart = 'opendart_SUPER_SECRET_KEY_7890';
  const sensitiveAnalytics = 'cf_SUPER_SECRET_ANALYTICS_TOKEN_ABC';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ secret_github_internal: 'hidden' }), { status: 200 });
  try {
    const env = {
      AUTH_DB: db,
      GITHUB_TOKEN: sensitiveToken,
      GEMINI_API_KEY: sensitiveGemini,
      OPENDART_API_KEY: sensitiveOpenDart,
      CLOUDFLARE_ANALYTICS_API_TOKEN: sensitiveAnalytics,
      CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
      CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: 'tag-12345'
    };
    const res = await onRequestGet({ request, env });
    const text = await res.text();
    assert.doesNotMatch(text, /SUPER_SECRET/);
    assert.doesNotMatch(text, /ghp_/);
    assert.doesNotMatch(text, /AIzaSy/);
    assert.doesNotMatch(text, /opendart_/);
    assert.doesNotMatch(text, /secret_github_internal/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('geminiApiKeyConfigured and openDartApiKeyConfigured accurately report presence', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });

  const envBothMissing = { AUTH_DB: db };
  const res1 = await onRequestGet({ request, env: envBothMissing });
  const data1 = await res1.json();
  assert.equal(data1.runtime.geminiApiKeyConfigured, false);
  assert.equal(data1.runtime.openDartApiKeyConfigured, false);

  const envBothPresent = {
    AUTH_DB: db,
    GEMINI_API_KEY: 'test-gemini-key',
    OPENDART_API_KEY: 'test-opendart-key'
  };
  const res2 = await onRequestGet({ request, env: envBothPresent });
  const data2 = await res2.json();
  assert.equal(data2.runtime.geminiApiKeyConfigured, true);
  assert.equal(data2.runtime.openDartApiKeyConfigured, true);
});

test('analyticsConfigured requires all three: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ANALYTICS_API_TOKEN, and CLOUDFLARE_WEB_ANALYTICS_SITE_TAG', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });

  const matrix = [
    { acc: '', tok: '', tag: '', expected: false },
    { acc: 'acc-1', tok: 'tok-1', tag: '', expected: false },
    { acc: 'acc-1', tok: '', tag: 'tag-1', expected: false },
    { acc: '', tok: 'tok-1', tag: 'tag-1', expected: false },
    { acc: 'acc-1', tok: 'tok-1', tag: 'tag-1', expected: true }
  ];

  for (const { acc, tok, tag, expected } of matrix) {
    const env = {
      AUTH_DB: db,
      CLOUDFLARE_ACCOUNT_ID: acc,
      CLOUDFLARE_ANALYTICS_API_TOKEN: tok,
      CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: tag
    };
    const res = await onRequestGet({ request, env });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(
      data.runtime.analyticsConfigured,
      expected,
      `Expected analyticsConfigured=${expected} when acc="${acc}", tok="${tok}", tag="${tag}"`
    );
  }
});

test('disclosureSyncKeyConfigured=false is treated as optional and keeps ok=true with disclosureSyncKeyRequired=false', async () => {
  const db = await createMockAuthDb();
  const session = await createAdminSession(db);
  const request = createAdminRequest('https://admin.snowshagal.com/api/admin/runtime-status', {
    cookie: session.cookieHeader
  });

  const env = {
    AUTH_DB: db,
    DISCLOSURE_SYNC_KEY: ''
  };
  const res = await onRequestGet({ request, env });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.runtime.disclosureSyncKeyConfigured, false);
  assert.equal(data.runtime.disclosureSyncKeyRequired, false);
});
