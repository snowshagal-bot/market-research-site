import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/publish.js';

const ADMIN_KEY = 'test-admin-key';
const originalFetch = globalThis.fetch;

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function githubMock(existingPosts = []) {
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    let payload;
    if (path.includes('/contents/data/posts.json')) payload = { content: base64(`${JSON.stringify(existingPosts)}\n`) };
    else if (path.endsWith('/git/ref/heads/main')) payload = { object: { sha: 'parent-sha' } };
    else if (path.endsWith('/git/commits/parent-sha')) payload = { tree: { sha: 'base-tree' } };
    else if (path.endsWith('/git/blobs')) payload = { sha: 'cover-blob-sha' };
    else if (path.endsWith('/git/trees')) payload = { sha: 'tree-sha' };
    else if (path.endsWith('/git/commits')) payload = { sha: 'commit-sha' };
    else if (path.endsWith('/git/refs/heads/main')) payload = {};
    else throw new Error(`Unexpected GitHub request: ${path}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

function publishRequest({ type = 'daily', cover = null, lang = 'ko', translationGroup = '' } = {}, url = 'https://market-research-site.pages.dev/api/publish') {
  const form = new FormData();
  form.append('file', new File(['<!doctype html><html><body>report</body></html>'], 'report.html', { type: 'text/html' }));
  form.append('type', type);
  form.append('reportDate', '2026-08-10');
  form.append('title', type === 'basics' ? '시장을 읽는 기본' : '테스트 리포트');
  form.append('subtitle', '테스트 부제');
  form.append('description', '테스트 설명');
  form.append('filename', `${type}-report.html`);
  form.append('lang', lang);
  if (translationGroup) form.append('translationGroup', translationGroup);
  if (cover) form.append('cover', cover, cover.name);
  return new Request(url, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY },
    body: form
  });
}

async function runPublish(options = {}) {
  const response = await onRequestPost({ request: publishRequest(options), env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
  return { response, data: await response.json() };
}

test('Preview and local publish requests are rejected before GitHub access', async () => {
  for (const url of ['https://branch.market-research-site.pages.dev/api/publish', 'http://localhost:8788/api/publish']) {
    const calls = githubMock();
    try {
      const response = await onRequestPost({ request: publishRequest({}, url), env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error, 'PREVIEW_READ_ONLY');
      assert.equal(calls.length, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('publish validates language before GitHub access', async () => {
  for (const lang of ['', 'ja', 'english']) {
    const calls = githubMock();
    try {
      const { response, data } = await runPublish({ lang });
      assert.equal(response.status, 400);
      assert.equal(data.error, 'BAD_LANG');
      assert.equal(calls.length, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('publishing without a cover preserves existing records and omits coverImage', async () => {
  const existing = [{ id: 'legacy', href: 'reports/old.html', type: 'daily', title: 'Old report' }];
  const calls = githubMock(existing);
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 200);
    assert.equal(data.coverImage, null);
    const treeCall = calls.find(call => call.path.endsWith('/git/trees'));
    assert.equal(treeCall.body.tree.length, 3);
    assert.equal(treeCall.body.tree.some(entry => entry.path.startsWith('covers/')), false);
    const postsEntry = treeCall.body.tree.find(entry => entry.path === 'data/posts.json');
    const posts = JSON.parse(postsEntry.content);
    assert.deepEqual(posts.find(post => post.id === 'legacy'), existing[0]);
    assert.equal(Object.hasOwn(posts.find(post => post.id !== 'legacy'), 'coverImage'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publishing Market Basics with a cover stores a binary blob and coverImage metadata', async () => {
  const calls = githubMock();
  const cover = new File([new Uint8Array([1, 2, 3, 4])], 'cover.png', { type: 'image/png' });
  try {
    const { response, data } = await runPublish({ type: 'basics', cover });
    assert.equal(response.status, 200);
    assert.match(data.coverImage, /^covers\/2026-08-10-basics-[a-z0-9]+\.png$/);
    const blobCall = calls.find(call => call.path.endsWith('/git/blobs'));
    assert.deepEqual(blobCall.body, { content: 'AQIDBA==', encoding: 'base64' });
    const treeCall = calls.find(call => call.path.endsWith('/git/trees'));
    const coverEntry = treeCall.body.tree.find(entry => entry.path === data.coverImage);
    assert.equal(coverEntry.sha, 'cover-blob-sha');
    const postsEntry = treeCall.body.tree.find(entry => entry.path === 'data/posts.json');
    const post = JSON.parse(postsEntry.content)[0];
    assert.equal(post.type, 'basics');
    assert.equal(post.typeLabel, '시장 공부');
    assert.equal(post.coverImage, data.coverImage);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('English reports are stored under reports/en with language and translation metadata', async () => {
  const calls = githubMock([{ id: 'ko-source', href: 'reports/source.html', type: 'weekly', title: '원문' }]);
  try {
    const { response, data } = await runPublish({ type: 'weekly', lang: 'en', translationGroup: 'ko-source' });
    assert.equal(response.status, 200);
    assert.equal(data.lang, 'en');
    assert.equal(data.translationGroup, 'ko-source');
    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    assert.ok(tree.some(entry => entry.path === 'reports/en/weekly-report.html'));
    const post = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content).find(item => item.id === data.id);
    assert.equal(post.lang, 'en');
    assert.equal(post.translationGroup, 'ko-source');
    assert.equal(post.href, 'reports/en/weekly-report.html');
    assert.equal(post.typeLabel, 'Weekly');
  } finally { globalThis.fetch = originalFetch; }
});

test('unsupported and oversized cover files are rejected before GitHub writes', async () => {
  for (const [cover, expectedStatus, expectedError] of [
    [new File(['gif'], 'cover.gif', { type: 'image/gif' }), 400, 'BAD_COVER_TYPE'],
    [new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'cover.webp', { type: 'image/webp' }), 413, 'COVER_TOO_LARGE']
  ]) {
    const calls = githubMock();
    try {
      const { response, data } = await runPublish({ cover });
      assert.equal(response.status, expectedStatus);
      assert.equal(data.error, expectedError);
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});
