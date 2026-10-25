// Repository files that ship with the Pages output (operating docs, tooling,
// tests, CI config, database schema) answer like any missing page, with the
// site's own 404 page. Public paths, including the market contract the API
// reads, are untouched.
import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequest, isRepoInternalPath } from '../functions/_middleware.js';

const NOT_FOUND_PAGE = '<!doctype html><html lang="ko"><title>404</title><h1>페이지를 찾을 수 없습니다</h1></html>';

function context(url) {
  const nextCalls = [];
  const assetCalls = [];
  return {
    nextCalls,
    assetCalls,
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: async (request) => {
          assetCalls.push(new URL(request.url).pathname);
          return new Response(NOT_FOUND_PAGE, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
      }
    },
    next: async () => {
      nextCalls.push(url);
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  };
}

test('repository internals are recognised by path, case and encoding included', () => {
  for (const path of [
    '/docs/', '/docs', '/docs/DEPLOYMENT.md', '/DOCS/index.md',
    '/scripts/verify.mjs', '/tests/seo.test.mjs', '/.github/workflows/verify.yml',
    '/db/schema.sql', '/migrations/auth/0001_auth_foundation.sql',
    '/AGENTS.md', '/README.md', '/.gitignore', '/%64ocs/DEPLOYMENT.md'
  ]) assert.equal(isRepoInternalPath(path), true, path);

  for (const path of [
    '/', '/en/', '/market/', '/daily/', '/reports/2026-10-23_Snowshagal_Daily',
    '/reports/docs-and-more', '/contracts/market_close/market_close.schema.json',
    '/assets/site.js', '/data/posts.json', '/documents/', '/en/docs/', '/robots.txt'
  ]) assert.equal(isRepoInternalPath(path), false, path);
});

test('an internal file gets the site 404 page with a 404 status and is never served', async () => {
  for (const url of ['https://snowshagal.com/docs/DEPLOYMENT.md', 'https://snowshagal.com/AGENTS.md', 'https://snowshagal.com/scripts/verify.mjs']) {
    const ctx = context(url);
    const response = await onRequest(ctx);
    assert.equal(response.status, 404, url);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await response.text(), /페이지를 찾을 수 없습니다/);
    assert.deepEqual(ctx.nextCalls, [], 'the file itself is never fetched');
  }
});

test('without the asset binding the answer is still a plain 404', async () => {
  const ctx = context('https://snowshagal.com/.github/workflows/verify.yml');
  delete ctx.env.ASSETS;
  const response = await onRequest(ctx);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Not Found');
});

test('public files, including the market contract schema, pass through', async () => {
  const ctx = context('https://snowshagal.com/contracts/market_close/market_close.schema.json');
  const response = await onRequest(ctx);
  assert.equal(response.status, 200);
  assert.equal(ctx.nextCalls.length, 1);
});
