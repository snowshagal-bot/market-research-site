import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/publish.js';
import { createMockAuthEnv } from './helpers/auth-test-helper.mjs';

const ADMIN_KEY = 'test-admin-key';
const originalFetch = globalThis.fetch;

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function githubMock(existingPosts = [], { searchIndex = null, searchIndexFail = false, searchIndexViaBlob = false } = {}) {
  const calls = [];
  const defaultIndex = searchIndex !== null ? searchIndex : existingPosts.map(p => ({
    id: p.id,
    lang: p.lang || 'ko',
    category: p.type || 'daily',
    title: p.title || 'Title',
    date: p.reportDate || p.date || '2026-08-10',
    tags: []
  }));

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/contents/data/search-index.json')) {
      if (searchIndexFail) return new Response('Not found', { status: 404 });
      if (searchIndexViaBlob) {
        return new Response(JSON.stringify({ content: '', encoding: 'none', sha: 'search-index-sha', size: 2434318 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ content: base64(`${JSON.stringify(defaultIndex)}\n`) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    let payload;
    if (path.includes('/contents/data/posts.json')) payload = { content: base64(`${JSON.stringify(existingPosts)}\n`) };
    else if (path.endsWith('/git/ref/heads/main')) payload = { object: { sha: 'parent-sha' } };
    else if (path.endsWith('/git/commits/parent-sha')) payload = { tree: { sha: 'base-tree' } };
    else if (path.endsWith('/git/blobs/search-index-sha')) payload = { content: base64(`${JSON.stringify(defaultIndex)}\n`), encoding: 'base64', sha: 'search-index-sha' };
    else if (path.endsWith('/git/blobs')) payload = { sha: 'cover-blob-sha' };
    else if (path.endsWith('/git/trees')) payload = { sha: 'tree-sha' };
    else if (path.endsWith('/git/commits')) payload = { sha: 'commit-sha' };
    else if (path.endsWith('/git/refs/heads/main')) payload = {};
    else throw new Error(`Unexpected GitHub request: ${path}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

function atomicGithubMock({
  existingPosts = [],
  advancedPosts = [],
  advancedSha = 'advanced-sha',
  advanceAfterSnapshot = false,
  concurrentInitialRefs = 0
} = {}) {
  const calls = [];
  const commits = new Map();
  const trees = new Map();
  const defaultIndex = existingPosts.map(post => ({
    id: post.id,
    lang: post.lang || 'ko',
    category: post.type || 'daily',
    title: post.title || 'Title',
    date: post.reportDate || post.date || '2026-08-10',
    tags: post.tags || []
  }));
  let branchSha = 'base-sha';
  let contentReads = 0;
  let treeCounter = 0;
  let commitCounter = 0;
  let blobCounter = 0;
  let initialRefReads = 0;
  let releaseInitialRefs;
  const initialRefGate = concurrentInitialRefs > 0
    ? new Promise(resolve => { releaseInitialRefs = resolve; })
    : null;

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });

    if (path.endsWith('/git/ref/heads/main')) {
      if (concurrentInitialRefs > 0 && contentReads === 0 && initialRefReads < concurrentInitialRefs) {
        initialRefReads += 1;
        if (initialRefReads === concurrentInitialRefs) releaseInitialRefs();
        await initialRefGate;
        return Response.json({ object: { sha: 'base-sha' } });
      }
      if (advanceAfterSnapshot && contentReads >= 2 && branchSha === 'base-sha') branchSha = advancedSha;
      return Response.json({ object: { sha: branchSha } });
    }

    if (path.includes('/contents/data/posts.json')) {
      contentReads += 1;
      const ref = url.searchParams.get('ref');
      const posts = ref === advancedSha ? advancedPosts : existingPosts;
      return Response.json({ content: base64(`${JSON.stringify(posts)}\n`) });
    }
    if (path.includes('/contents/data/search-index.json')) {
      contentReads += 1;
      return Response.json({ content: base64(`${JSON.stringify(defaultIndex)}\n`) });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      const sha = path.split('/').pop();
      if (sha === 'base-sha') return Response.json({ tree: { sha: 'base-tree' } });
      if (sha === advancedSha) return Response.json({ tree: { sha: 'advanced-tree' } });
      throw new Error(`Unexpected commit read: ${path}`);
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      blobCounter += 1;
      return Response.json({ sha: `blob-${blobCounter}` });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      treeCounter += 1;
      const sha = `tree-${treeCounter}`;
      trees.set(sha, body);
      return Response.json({ sha });
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      commitCounter += 1;
      const sha = `commit-${commitCounter}`;
      commits.set(sha, body);
      return Response.json({ sha });
    }
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) {
      const candidate = commits.get(body.sha);
      if (!candidate || candidate.parents[0] !== branchSha) {
        return Response.json({ message: 'Update is not a fast forward' }, { status: 422 });
      }
      branchSha = body.sha;
      return Response.json({ object: { sha: branchSha } });
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  };

  return {
    calls,
    commits,
    trees,
    advancedPosts,
    get branchSha() { return branchSha; },
    branchTree() {
      const commit = commits.get(branchSha);
      return commit ? trees.get(commit.tree) : null;
    }
  };
}

let sharedAuthEnv = null;
async function getAuthEnv() {
  if (!sharedAuthEnv) {
    sharedAuthEnv = await createMockAuthEnv({ ADMIN_KEY, GITHUB_TOKEN: 'token', GITHUB_REPO: 'snowshagal-bot/market-research-site' });
  }
  return sharedAuthEnv;
}

function publishRequest({ type = 'daily', cover = null, shareCard = null, lang = 'ko', translationGroup = '', reportDate = '2026-08-10', summary, takeaway, tags = null } = {}, url = 'https://admin.snowshagal.com/api/publish', session = sharedAuthEnv?._authSession) {
  const form = new FormData();
  form.append('file', new File(['<!doctype html><html><body>report content with some words</body></html>'], 'report.html', { type: 'text/html' }));
  form.append('type', type);
  form.append('reportDate', reportDate);
  form.append('title', type === 'basics' ? '시장을 읽는 기본' : '테스트 리포트');
  form.append('subtitle', '테스트 부제');
  form.append('description', '테스트 설명');
  if (summary !== undefined) form.append('summary', summary);
  if (takeaway !== undefined) form.append('takeaway', takeaway);
  if (tags !== null) {
    if (Array.isArray(tags)) tags.forEach(t => form.append('tags', t));
    else form.append('tags', tags);
  }
  form.append('filename', `${type}-report.html`);
  form.append('lang', lang);
  if (translationGroup) form.append('translationGroup', translationGroup);
  if (cover) form.append('cover', cover, cover.name);
  if (shareCard) form.append('shareCard', shareCard, shareCard.name);
  const headers = {
    origin: new URL(url).origin,
    'x-admin-key': ADMIN_KEY
  };
  if (session) {
    headers['cookie'] = session.cookieHeader;
    headers['x-csrf-token'] = session.csrfToken;
  }
  return new Request(url, {
    method: 'POST',
    headers,
    body: form
  });
}

async function runPublish(options = {}) {
  const env = await getAuthEnv();
  const request = publishRequest(options, 'https://admin.snowshagal.com/api/publish', env._authSession);
  const response = await onRequestPost({ request, env });
  return { response, data: await response.json() };
}

function repositoryReadRefs(calls) {
  return calls
    .filter(call => call.path.includes('/contents/data/posts.json') || call.path.includes('/contents/data/search-index.json'))
    .map(call => new URL(`https://api.github.test${call.path}`).searchParams.get('ref'));
}

test('atomic snapshot rejects an intervening publish and preserves its metadata', async () => {
  const interveningPost = {
    id: 'intervening-post',
    type: 'daily',
    lang: 'ko',
    reportDate: '2026-08-11',
    title: '먼저 게시된 리포트',
    href: 'reports/intervening.html'
  };
  const github = atomicGithubMock({
    advanceAfterSnapshot: true,
    advancedSha: 'intervening-publish-sha',
    advancedPosts: [interveningPost]
  });
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 409);
    assert.equal(data.error, 'REPOSITORY_CHANGED');
    assert.equal(data.message, '저장소가 변경되었습니다. 새로고침 후 다시 게시하세요.');
    assert.deepEqual(repositoryReadRefs(github.calls), ['base-sha', 'base-sha']);
    assert.equal(github.branchSha, 'intervening-publish-sha');
    assert.deepEqual(github.advancedPosts, [interveningPost]);
    assert.equal(github.calls.some(call => call.method === 'PATCH'), false);
    const commit = [...github.commits.values()][0];
    assert.deepEqual(commit.parents, ['base-sha']);
  } finally { globalThis.fetch = originalFetch; }
});

test('atomic snapshot rejects an unrelated PR advance and leaves the PR tree untouched', async () => {
  const github = atomicGithubMock({
    advanceAfterSnapshot: true,
    advancedSha: 'unrelated-pr-sha'
  });
  try {
    const { response, data } = await runPublish({ type: 'weekly' });
    assert.equal(response.status, 409);
    assert.equal(data.error, 'REPOSITORY_CHANGED');
    assert.deepEqual(repositoryReadRefs(github.calls), ['base-sha', 'base-sha']);
    assert.equal(github.branchSha, 'unrelated-pr-sha');
    assert.equal(github.calls.some(call => call.method === 'PATCH'), false);
    assert.equal([...github.trees.values()][0].base_tree, 'base-tree');
    assert.deepEqual([...github.commits.values()][0].parents, ['base-sha']);
  } finally { globalThis.fetch = originalFetch; }
});

test('unchanged main publishes every artifact in one exact-SHA commit', async () => {
  const github = atomicGithubMock();
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.deepEqual(repositoryReadRefs(github.calls), ['base-sha', 'base-sha']);
    const firstRef = github.calls.findIndex(call => call.path.endsWith('/git/ref/heads/main'));
    const firstContent = github.calls.findIndex(call => call.path.includes('/contents/data/'));
    assert.ok(firstRef >= 0 && firstRef < firstContent, 'baseSha must be fixed before repository data is read');
    assert.equal(github.commits.size, 1);
    assert.equal(github.trees.size, 1);
    const [commit] = github.commits.values();
    const [tree] = github.trees.values();
    assert.deepEqual(commit.parents, ['base-sha']);
    assert.equal(tree.base_tree, 'base-tree');
    assert.deepEqual(
      tree.tree.map(entry => entry.path).sort(),
      [
        'data/posts.js',
        'data/posts.json',
        'data/search-index-body-en.js',
        'data/search-index-body-ko.js',
        'data/search-index-meta.js',
        'data/search-index.json',
        'reports/daily-report.html'
      ].sort()
    );
    const patch = github.calls.find(call => call.method === 'PATCH');
    assert.deepEqual(patch.body, { sha: data.commitSha, force: false });
    assert.equal(github.branchSha, data.commitSha);
  } finally { globalThis.fetch = originalFetch; }
});

test('concurrent publishes allow one winner and return 409 for the loser without metadata loss', async () => {
  const github = atomicGithubMock({ concurrentInitialRefs: 2 });
  try {
    const results = await Promise.all([
      runPublish({ type: 'daily' }),
      runPublish({ type: 'weekly' })
    ]);
    const success = results.find(result => result.response.status === 200);
    const conflict = results.find(result => result.response.status === 409);
    assert.ok(success);
    assert.ok(conflict);
    assert.equal(conflict.data.error, 'REPOSITORY_CHANGED');
    assert.equal(github.branchSha, success.data.commitSha);
    const winningTree = github.branchTree();
    assert.ok(winningTree, 'the branch must point at the successful atomic tree');
    const publishedPosts = JSON.parse(winningTree.tree.find(entry => entry.path === 'data/posts.json').content);
    assert.equal(publishedPosts.length, 1);
    assert.equal(publishedPosts[0].id, success.data.id);
    assert.equal(github.commits.get(github.branchSha).parents[0], 'base-sha');
    for (const call of github.calls.filter(call => call.method === 'PATCH')) {
      assert.equal(call.body.force, false);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('atomic publish preserves pairing, inherited tags, reading time, cover, and share card behavior', async () => {
  const pairedPost = {
    id: 'ko-paired',
    type: 'daily',
    lang: 'ko',
    translationGroup: 'daily-pair',
    reportDate: '2026-08-10',
    title: '한국어 원문',
    tags: ['flows', 'rates'],
    readingMinutes: 3,
    href: 'reports/paired.html'
  };
  const github = atomicGithubMock({ existingPosts: [pairedPost] });
  const cover = new File([new Uint8Array([1, 2, 3])], 'cover.webp', { type: 'image/webp' });
  const shareCard = new File([new Uint8Array([4, 5, 6])], 'share.jpg', { type: 'image/jpeg' });
  try {
    const { response, data } = await runPublish({
      type: 'daily',
      lang: 'en',
      translationGroup: 'daily-pair',
      cover,
      shareCard
    });
    assert.equal(response.status, 200);
    const tree = github.branchTree().tree;
    const posts = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content);
    const published = posts.find(post => post.id === data.id);
    assert.equal(published.translationGroup, 'daily-pair');
    assert.deepEqual(published.tags, ['flows', 'rates']);
    assert.equal(published.readingMinutes, 3);
    assert.match(published.coverImage, /^covers\/.+\.webp$/);
    assert.match(published.shareCardImage, /^covers\/share\/.+\.jpg$/);
    assert.ok(tree.some(entry => entry.path === published.coverImage));
    assert.ok(tree.some(entry => entry.path === published.shareCardImage));
    assert.ok(tree.some(entry => entry.path === 'reports/en/daily-report.html'));
    const fromJs = JSON.parse(tree.find(entry => entry.path === 'data/posts.js').content.replace(/^window\.RESEARCH_POSTS = /, '').replace(/;\s*$/, ''));
    assert.deepEqual(fromJs, posts);
    assert.ok(tree.some(entry => entry.path === 'data/search-index.json'));
    assert.ok(tree.some(entry => entry.path === 'data/search-index-meta.js'));
    assert.ok(tree.some(entry => entry.path === 'data/search-index-body-ko.js'));
    assert.ok(tree.some(entry => entry.path === 'data/search-index-body-en.js'));
    assert.deepEqual(github.commits.get(github.branchSha).parents, ['base-sha']);
  } finally { globalThis.fetch = originalFetch; }
});

test('Preview, former production, and local publish requests are rejected before GitHub access', async () => {
  for (const url of ['https://branch.market-research-site.pages.dev/api/publish', 'https://market-research-site.pages.dev/api/publish', 'http://localhost:8788/api/publish']) {
    const calls = githubMock();
    const env = await getAuthEnv();
    try {
      const response = await onRequestPost({ request: publishRequest({}, url, env._authSession), env });
      assert.equal(response.status, 403);
      const data = await response.json();
      assert.ok(['PREVIEW_READ_ONLY', 'ADMIN_HOST_BLOCKED'].includes(data.error));
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
    // report + posts.json + posts.js + the four search index artifacts
    assert.equal(treeCall.body.tree.length, 7);
    assert.equal(treeCall.body.tree.some(entry => entry.path.startsWith('covers/')), false);
    assert.ok(treeCall.body.tree.some(entry => entry.path === 'data/search-index.json'));
    assert.ok(treeCall.body.tree.some(entry => entry.path === 'data/search-index-meta.js'));
    assert.ok(treeCall.body.tree.some(entry => entry.path === 'data/search-index-body-ko.js'));
    assert.ok(treeCall.body.tree.some(entry => entry.path === 'data/search-index-body-en.js'));
    assert.equal(treeCall.body.tree.some(entry => entry.path === 'data/search-index.js'), false);
    const postsEntry = treeCall.body.tree.find(entry => entry.path === 'data/posts.json');
    const posts = JSON.parse(postsEntry.content);
    assert.deepEqual(posts.find(post => post.id === 'legacy'), existing[0]);
    assert.equal(Object.hasOwn(posts.find(post => post.id !== 'legacy'), 'coverImage'), false);
    assert.equal(Object.hasOwn(posts.find(post => post.id !== 'legacy'), 'summary'), false);
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
    assert.equal(post.typeLabel, '시장 입문');
    assert.equal(post.coverImage, data.coverImage);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publishing stores an optional trimmed homepage summary up to 500 characters', async () => {
  for (const [input, expected] of [
    ['  홈페이지 전용 요약  ', '홈페이지 전용 요약'],
    ['요'.repeat(520), '요'.repeat(500)]
  ]) {
    const calls = githubMock();
    try {
      const { response, data } = await runPublish({ summary: input });
      assert.equal(response.status, 200);
      const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
      const post = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content).find(item => item.id === data.id);
      assert.equal(post.summary, expected);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('English reports are stored under reports/en with language and translation metadata', async () => {
  const calls = githubMock([{ id: 'ko-source', href: 'reports/source.html', type: 'weekly', title: '원문', reportDate: '2026-08-10' }]);
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

test('translation pairing rejects a missing counterpart or a mismatched report date', async () => {
  for (const [existingPosts, options, expectedError] of [
    [[], { lang: 'en', translationGroup: 'missing-source' }, 'BAD_TRANSLATION_GROUP'],
    [[{ id: 'ko-source', reportDate: '2026-08-04' }], { lang: 'en', translationGroup: 'ko-source', reportDate: '2026-08-24' }, 'PAIR_DATE_MISMATCH']
  ]) {
    const calls = githubMock(existingPosts);
    try {
      const { response, data } = await runPublish(options);
      assert.equal(response.status, 400);
      assert.equal(data.error, expectedError);
      assert.equal(calls.some(call => call.path.endsWith('/git/trees')), false);
    } finally { globalThis.fetch = originalFetch; }
  }
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

test('publish fails closed when search-index fetch fails (no commit created)', async () => {
  const calls = githubMock([], { searchIndexFail: true });
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 500);
    assert.equal(data.error, 'SEARCH_INDEX_READ_FAILED');
    assert.equal(calls.some(call => call.path.endsWith('/git/trees')), false);
    assert.equal(calls.some(call => call.path.endsWith('/git/commits')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish reads an oversized search index through the Git blob fallback', async () => {
  const calls = githubMock([], { searchIndexViaBlob: true });
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(calls.some(call => call.path.endsWith('/git/blobs/search-index-sha')), true);
    assert.equal(calls.some(call => call.path.endsWith('/git/trees')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish fails closed when posts and search-index counts mismatch', async () => {
  const existing = [{ id: 'post-1', href: 'reports/1.html', type: 'daily', title: 'P1' }];
  // Search index has 0 items while posts has 1
  const calls = githubMock(existing, { searchIndex: [] });
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 500);
    assert.equal(data.error, 'SEARCH_INDEX_INTEGRITY_FAILED');
    assert.equal(calls.some(call => call.path.endsWith('/git/trees')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('duplicate search index ID updates existing entry without duplicate append', async () => {
  // If report has same ID, it replaces the search entry rather than pushing duplicates
  const existing = [];
  const calls = githubMock(existing);
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 200);
    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    const searchIdxEntry = tree.find(entry => entry.path === 'data/search-index.json');
    const index = JSON.parse(searchIdxEntry.content);
    assert.equal(index.length, 1);
    assert.equal(index[0].id, data.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish rejects equal-length but mismatched ID sets with SEARCH_INDEX_INTEGRITY_FAILED (no commit created)', async () => {
  const posts = [
    { id: 'post-A', href: 'reports/a.html', type: 'daily', title: 'Post A' },
    { id: 'post-B', href: 'reports/b.html', type: 'daily', title: 'Post B' }
  ];
  const searchIndex = [
    { id: 'post-A', lang: 'ko', category: 'daily', title: 'Post A', date: '2026-08-10', tags: [] },
    { id: 'post-C', lang: 'ko', category: 'daily', title: 'Post C', date: '2026-08-10', tags: [] }
  ];

  const calls = githubMock(posts, { searchIndex });
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 500);
    assert.equal(data.error, 'SEARCH_INDEX_INTEGRITY_FAILED');
    assert.equal(calls.some(call => call.path.endsWith('/git/trees')), false);
    assert.equal(calls.some(call => call.path.endsWith('/git/commits')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish rejects duplicate IDs in search index with SEARCH_INDEX_INTEGRITY_FAILED (no commit created)', async () => {
  const posts = [
    { id: 'post-A', href: 'reports/a.html', type: 'daily', title: 'Post A' },
    { id: 'post-B', href: 'reports/b.html', type: 'daily', title: 'Post B' }
  ];
  const searchIndex = [
    { id: 'post-A', lang: 'ko', category: 'daily', title: 'Post A', date: '2026-08-10', tags: [] },
    { id: 'post-A', lang: 'ko', category: 'daily', title: 'Post A duplicate', date: '2026-08-10', tags: [] }
  ];

  const calls = githubMock(posts, { searchIndex });
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 500);
    assert.equal(data.error, 'SEARCH_INDEX_INTEGRITY_FAILED');
    assert.equal(calls.some(call => call.path.endsWith('/git/trees')), false);
    assert.equal(calls.some(call => call.path.endsWith('/git/commits')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish validates canonical tags and rejects unknown tags', async () => {
  const calls = githubMock();
  try {
    const { response, data } = await runPublish({ tags: ['rates', 'invalid_random_tag'] });
    assert.equal(response.status, 400);
    assert.equal(data.error, 'BAD_TAGS');
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish automatically calculates readingMinutes and synchronizes tags in posts and searchIndex', async () => {
  const calls = githubMock();
  try {
    const { response, data } = await runPublish({ tags: ['rates', 'semiconductors'] });
    assert.equal(response.status, 200);

    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    const postsEntry = tree.find(entry => entry.path === 'data/posts.json');
    const searchIdxEntry = tree.find(entry => entry.path === 'data/search-index.json');

    const posts = JSON.parse(postsEntry.content);
    const searchIndex = JSON.parse(searchIdxEntry.content);

    assert.equal(posts.length, 1);
    assert.equal(searchIndex.length, 1);

    assert.deepEqual(posts[0].tags, ['rates', 'semiconductors']);
    assert.deepEqual(searchIndex[0].tags, ['rates', 'semiconductors']);
    assert.equal(posts[0].readingMinutes, 3);
    assert.equal(searchIndex[0].readingMinutes, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish inherits canonical tags from translation counterpart when not specified', async () => {
  const existingPost = {
    id: '2026-08-10-daily-ko-item',
    type: 'daily',
    lang: 'ko',
    reportDate: '2026-08-10',
    translationGroup: 'daily-2026-08-10',
    title: '한국어 원본',
    tags: ['flows', 'rates'],
    readingMinutes: 3,
    href: 'reports/ko.html'
  };
  const calls = githubMock([existingPost]);
  try {
    const { response, data } = await runPublish({
      lang: 'en',
      reportDate: '2026-08-10',
      translationGroup: 'daily-2026-08-10'
      // tags is omitted -> should inherit from existingPost
    });
    assert.equal(response.status, 200);

    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    const postsEntry = tree.find(entry => entry.path === 'data/posts.json');
    const posts = JSON.parse(postsEntry.content);

    const enPost = posts.find(p => p.lang === 'en');
    assert.ok(enPost);
    assert.deepEqual(enPost.tags, ['flows', 'rates']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish rejects 4 unique tags with BAD_TAGS 400', async () => {
  const calls = githubMock([]);
  try {
    const { response, data } = await runPublish({
      tags: ['flows', 'rates', 'fx', 'fed']
    });
    assert.equal(response.status, 400);
    assert.equal(data.error, 'BAD_TAGS');
    assert.equal(calls.length, 0, 'No GitHub calls should be made on validation failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish normalizes duplicate tags without rejecting', async () => {
  const calls = githubMock([]);
  try {
    const { response, data } = await runPublish({
      tags: ['flows', 'flows', 'rates']
    });
    assert.equal(response.status, 200);

    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    const postsEntry = tree.find(entry => entry.path === 'data/posts.json');
    const posts = JSON.parse(postsEntry.content);
    assert.deepEqual(posts[0].tags, ['flows', 'rates']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ------------------------------- the TODAY one-liner rides with a Daily */

test('a Daily stores its TODAY one-liner beside, not instead of, the summary', async () => {
  const calls = githubMock();
  try {
    const { response, data } = await runPublish({
      type: 'daily',
      summary: '리포트 전체를 두세 문장으로 설명하는 요약.',
      takeaway: '  지수는  되돌렸지만\n 거래대금은 따라오지 않았다.  '
    });
    assert.equal(response.status, 200);
    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;

    const fromJson = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content).find(item => item.id === data.id);
    assert.equal(fromJson.takeaway, '지수는 되돌렸지만 거래대금은 따라오지 않았다.');
    // Two fields, two meanings: the summary is untouched by the addition.
    assert.equal(fromJson.summary, '리포트 전체를 두세 문장으로 설명하는 요약.');

    // posts.js is generated from the same array, so it must agree.
    const js = tree.find(entry => entry.path === 'data/posts.js').content;
    const fromJs = JSON.parse(js.replace(/^window\.RESEARCH_POSTS = /, '').replace(/;\s*$/, '')).find(item => item.id === data.id);
    assert.deepEqual(fromJs, fromJson);

    // The search index keeps its own contract; the one-liner is not part of it.
    const index = JSON.parse(tree.find(entry => entry.path === 'data/search-index.json').content).find(item => item.id === data.id);
    assert.equal(index.summary, '리포트 전체를 두세 문장으로 설명하는 요약.');
    assert.equal('takeaway' in index, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('only a Daily is allowed to carry one', async () => {
  for (const type of ['weekly', 'research', 'basics', 'note']) {
    const calls = githubMock();
    try {
      const { response, data } = await runPublish({ type, takeaway: '이 문구는 저장되면 안 된다.' });
      assert.equal(response.status, 200);
      const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
      const post = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content).find(item => item.id === data.id);
      assert.equal('takeaway' in post, false, `${type} must not store a TODAY one-liner`);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('a Daily with no one-liner simply has no field', async () => {
  const calls = githubMock();
  try {
    const { response, data } = await runPublish({ type: 'daily' });
    assert.equal(response.status, 200);
    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    const post = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content).find(item => item.id === data.id);
    assert.equal('takeaway' in post, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('an over-long one-liner is cut at the stored limit', async () => {
  const calls = githubMock();
  try {
    const { response, data } = await runPublish({ type: 'daily', takeaway: '가'.repeat(520) });
    assert.equal(response.status, 200);
    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    const post = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content).find(item => item.id === data.id);
    assert.equal(post.takeaway.length, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test('existing posts are not backfilled', async () => {
  const existing = [
    { id: 'ko-old', href: 'reports/old.html', type: 'daily', lang: 'ko', title: '지난 리포트', reportDate: '2026-08-05' }
  ];
  const calls = githubMock(existing);
  try {
    const { response } = await runPublish({ type: 'daily', takeaway: '새 리포트의 한 줄.' });
    assert.equal(response.status, 200);
    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;
    const posts = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content);
    const old = posts.find(item => item.id === 'ko-old');
    assert.equal('takeaway' in old, false, 'past reports keep whatever they had');
  } finally { globalThis.fetch = originalFetch; }
});

test('publish creates raw physical href in posts.json/posts.js and clean public URL in search index without .html extension', async () => {
  const calls = githubMock();
  try {
    const { response, data } = await runPublish({
      type: 'daily',
      lang: 'ko',
      title: '테스트 리포트',
      reportDate: '2026-08-28'
    });
    assert.equal(response.status, 200);

    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;

    // 1. posts.json: href must keep raw .html path
    const postsJsonContent = tree.find(entry => entry.path === 'data/posts.json').content;
    const posts = JSON.parse(postsJsonContent);
    const publishedPost = posts.find(item => item.id === data.id);
    assert.ok(publishedPost);
    assert.match(publishedPost.href, /^reports\/.+\.html$/i, 'posts.json must store physical .html href');
    assert.equal(publishedPost.href, 'reports/daily-report.html');

    // 2. posts.js: href must agree with posts.json
    const postsJsContent = tree.find(entry => entry.path === 'data/posts.js').content;
    const postsFromJs = JSON.parse(postsJsContent.replace(/^window\.RESEARCH_POSTS\s*=\s*/, '').replace(/;\s*$/, ''));
    const postInJs = postsFromJs.find(item => item.id === data.id);
    assert.ok(postInJs);
    assert.equal(postInJs.href, publishedPost.href);

    // 3. search-index.json: url must be clean URL without .html
    const searchIndexJsonContent = tree.find(entry => entry.path === 'data/search-index.json').content;
    const searchIndex = JSON.parse(searchIndexJsonContent);
    const searchItem = searchIndex.find(item => item.id === data.id);
    assert.ok(searchItem);
    assert.equal(searchItem.url, '/reports/daily-report');
    assert.doesNotMatch(searchItem.url, /\.html?($|[?#])/i, 'search-index.json url must be clean URL without .html');

    // 4. search-index-meta.js: url must be clean URL without .html
    const searchMetaJsContent = tree.find(entry => entry.path === 'data/search-index-meta.js').content;
    const searchMeta = JSON.parse(searchMetaJsContent.replace(/^window\.SEARCH_INDEX_META\s*=\s*/, '').replace(/;\s*$/, ''));
    const metaItem = searchMeta.find(item => item.id === data.id);
    assert.ok(metaItem);
    assert.equal(metaItem.url, '/reports/daily-report');
    assert.doesNotMatch(metaItem.url, /\.html?($|[?#])/i, 'search-index-meta.js url must be clean URL without .html');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('publish English report creates reports/en/...html in posts.json and /reports/en/... in search index', async () => {
  const calls = githubMock();
  try {
    const { response, data } = await runPublish({
      type: 'research',
      lang: 'en',
      title: 'English Research Report',
      reportDate: '2026-08-28'
    });
    assert.equal(response.status, 200);

    const tree = calls.find(call => call.path.endsWith('/git/trees')).body.tree;

    // posts.json: physical href under reports/en/...
    const posts = JSON.parse(tree.find(entry => entry.path === 'data/posts.json').content);
    const publishedPost = posts.find(item => item.id === data.id);
    assert.match(publishedPost.href, /^reports\/en\/.+\.html$/i);

    // search-index.json & search-index-meta.js: clean URL /reports/en/...
    const searchIndex = JSON.parse(tree.find(entry => entry.path === 'data/search-index.json').content);
    const searchItem = searchIndex.find(item => item.id === data.id);
    assert.match(searchItem.url, /^\/reports\/en\//);
    assert.doesNotMatch(searchItem.url, /\.html?($|[?#])/i);

    const searchMeta = JSON.parse(tree.find(entry => entry.path === 'data/search-index-meta.js').content.replace(/^window\.SEARCH_INDEX_META\s*=\s*/, '').replace(/;\s*$/, ''));
    const metaItem = searchMeta.find(item => item.id === data.id);
    assert.equal(metaItem.url, searchItem.url);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

