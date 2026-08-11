import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestPost } from '../functions/api/manage.js';

const ADMIN_KEY = 'test-admin-key';
const originalFetch = globalThis.fetch;

const basePost = {
  id: '2026-08-11-daily-12vx8a7',
  type: 'daily',
  typeLabel: '주식 리포트',
  date: '2026-08-11',
  reportDate: '2026-08-11',
  registeredDate: '2026-08-11',
  registeredAt: '2026-08-11T10:06:02.296Z',
  legacyImport: false,
  title: '한 척이끌고 간 바다',
  subtitle: '',
  description: '기존 설명',
  href: 'reports/8월 11일 주식리포트_커버통합.html'
};

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function githubMock(existingPosts = [basePost], { conflict = false } = {}) {
  const calls = [];
  let refReads = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    let payload;
    if (path.endsWith('/git/ref/heads/main')) {
      refReads += 1;
      payload = { object: { sha: conflict && refReads > 1 ? 'new-main-sha' : 'base-sha' } };
    } else if (path.endsWith('/git/commits/base-sha')) payload = { tree: { sha: 'base-tree' } };
    else if (path.includes('/contents/data/posts.json?ref=base-sha')) payload = { content: base64(`${JSON.stringify(existingPosts)}\n`) };
    else if (path.endsWith('/git/blobs')) payload = { sha: 'cover-blob-sha' };
    else if (path.endsWith('/git/trees')) payload = { sha: 'tree-sha' };
    else if (path.endsWith('/git/commits')) payload = { sha: 'commit-sha' };
    else if (path.endsWith('/git/refs/heads/main')) payload = {};
    else throw new Error(`Unexpected GitHub request: ${path}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

function manageRequest(fields = {}, key = ADMIN_KEY, url = 'https://market-research-site.pages.dev/api/manage') {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    action: 'update',
    id: basePost.id,
    type: 'weekly',
    reportDate: '2026-08-12',
    title: '수정한 제목',
    subtitle: '수정한 부제',
    description: '수정한 설명',
    coverAction: 'keep',
    ...fields
  })) {
    if (value instanceof File) form.append(name, value, value.name);
    else if (value !== null && value !== undefined) form.append(name, String(value));
  }
  return new Request(url, { method: 'POST', headers: { 'x-admin-key': key }, body: form });
}

async function run(fields = {}, env = { GITHUB_TOKEN: 'token', ADMIN_KEY }, url) {
  const response = await onRequestPost({ request: manageRequest(fields, ADMIN_KEY, url), env });
  return { response, data: await response.json() };
}

function treeFrom(calls) {
  return calls.find((call) => call.path.endsWith('/git/trees'))?.body.tree;
}

function postsFromTree(tree) {
  return JSON.parse(tree.find((entry) => entry.path === 'data/posts.json').content);
}

test('Preview, localhost, and non-production hosts are read-only before GitHub access', async () => {
  for (const url of [
    'https://d66a2dcd.market-research-site.pages.dev/api/manage',
    'https://agent-admin-post-management.market-research-site.pages.dev/api/manage',
    'http://localhost:8788/api/manage',
    'http://127.0.0.1:8788/api/manage',
    'https://admin.example.com/api/manage'
  ]) {
    const calls = githubMock();
    try {
      const { response, data } = await run({}, { GITHUB_TOKEN: 'token', ADMIN_KEY }, url);
      assert.equal(response.status, 403);
      assert.equal(data.error, 'PREVIEW_READ_ONLY');
      assert.equal(calls.length, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('metadata update preserves immutable fields, keeps HTML, and synchronizes posts files', async () => {
  const legacy = { ...basePost, id: 'older', reportDate: '2026-08-01', date: '2026-08-01', href: 'reports/older.html', legacyImport: true };
  const calls = githubMock([legacy, basePost]);
  try {
    const { response, data } = await run();
    assert.equal(response.status, 200);
    assert.equal(data.action, 'update');
    const tree = treeFrom(calls);
    assert.equal(tree.some((entry) => entry.path === basePost.href), false);
    const updated = postsFromTree(tree)[0];
    for (const key of ['id', 'href', 'registeredDate', 'registeredAt', 'legacyImport']) assert.deepEqual(updated[key], basePost[key]);
    assert.equal(updated.type, 'weekly');
    assert.equal(updated.typeLabel, '위클리 리포트');
    assert.equal(updated.date, '2026-08-12');
    assert.equal(updated.reportDate, '2026-08-12');
    assert.equal(updated.title, '수정한 제목');
    assert.match(updated.updatedAt, /^2026-/);
    assert.equal(Object.hasOwn(legacy, 'updatedAt'), false);
    const js = tree.find((entry) => entry.path === 'data/posts.js').content;
    assert.equal(js, `window.RESEARCH_POSTS = ${JSON.stringify(postsFromTree(tree), null, 2)};\n`);
  } finally { globalThis.fetch = originalFetch; }
});

test('metadata update preserves lang and translationGroup without moving the report path', async () => {
  const englishPost = {
    ...basePost,
    lang: 'en',
    translationGroup: 'ko-source-post',
    typeLabel: 'Daily',
    href: 'reports/en/daily-report.html'
  };
  const calls = githubMock([englishPost]);
  try {
    const { response } = await run();
    assert.equal(response.status, 200);
    const updated = postsFromTree(treeFrom(calls))[0];
    assert.equal(updated.lang, 'en');
    assert.equal(updated.translationGroup, 'ko-source-post');
    assert.equal(updated.href, englishPost.href);
    assert.equal(updated.typeLabel, 'Weekly');
  } finally { globalThis.fetch = originalFetch; }
});

test('optional HTML replacement keeps href and validates standalone HTML before GitHub access', async () => {
  const calls = githubMock();
  try {
    const file = new File(['<!doctype html><html><body>updated</body></html>'], 'different-name.html', { type: 'text/html' });
    const { response } = await run({ file });
    assert.equal(response.status, 200);
    const reportEntry = treeFrom(calls).find((entry) => entry.path === basePost.href);
    assert.equal(reportEntry.content, '<!doctype html><html><body>updated</body></html>');
    assert.equal(treeFrom(calls).some((entry) => entry.path.includes('different-name')), false);
  } finally { globalThis.fetch = originalFetch; }

  const noCalls = githubMock();
  try {
    const invalid = new File(['<div>fragment</div>'], 'bad.html', { type: 'text/html' });
    const { response, data } = await run({ file: invalid });
    assert.equal(response.status, 400);
    assert.equal(data.error, 'INVALID_HTML');
    assert.equal(noCalls.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('cover add, same-extension replace, extension change, and remove use safe repository paths', async () => {
  const cases = [
    { current: null, action: 'replace', file: new File(['new'], 'new.webp', { type: 'image/webp' }), added: `${basePost.id}.webp`, deleted: null },
    { current: `covers/${basePost.id}.webp`, action: 'replace', file: new File(['new'], 'new.webp', { type: 'image/webp' }), added: `${basePost.id}.webp`, deleted: null },
    { current: `covers/${basePost.id}.webp`, action: 'replace', file: new File(['new'], 'new.png', { type: 'image/png' }), added: `${basePost.id}.png`, deleted: `${basePost.id}.webp` },
    { current: `covers/${basePost.id}.webp`, action: 'remove', file: null, added: null, deleted: `${basePost.id}.webp` }
  ];
  for (const item of cases) {
    const post = { ...basePost };
    if (item.current) post.coverImage = item.current;
    const calls = githubMock([post]);
    try {
      const fields = { coverAction: item.action };
      if (item.file) fields.cover = item.file;
      const { response } = await run(fields);
      assert.equal(response.status, 200);
      const tree = treeFrom(calls);
      const updated = postsFromTree(tree)[0];
      if (item.added) {
        assert.equal(updated.coverImage, `covers/${item.added}`);
        assert.equal(tree.find((entry) => entry.path === `covers/${item.added}`).sha, 'cover-blob-sha');
      } else assert.equal(Object.hasOwn(updated, 'coverImage'), false);
      if (item.deleted) assert.equal(tree.find((entry) => entry.path === `covers/${item.deleted}`).sha, null);
      if (!item.deleted && item.current) assert.equal(tree.filter((entry) => entry.path === item.current && entry.sha === null).length, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('invalid covers and unsafe stored paths are rejected without repository mutation', async () => {
  for (const [posts, fields, expected] of [
    [[basePost], { coverAction: 'replace', cover: new File(['gif'], 'bad.gif', { type: 'image/gif' }) }, 'INVALID_COVER'],
    [[basePost], { coverAction: 'replace', cover: new File(['png'], 'bad.gif', { type: 'image/png' }) }, 'INVALID_COVER'],
    [[basePost], { coverAction: 'replace', cover: new File(['jpeg'], 'bad.exe', { type: 'image/jpeg' }) }, 'INVALID_COVER'],
    [[{ ...basePost, coverImage: 'assets/not-managed.webp' }], { coverAction: 'remove' }, 'UNSAFE_COVER_PATH'],
    [[{ ...basePost, href: '../outside.html' }], { action: 'delete' }, 'UNSAFE_REPORT_PATH']
  ]) {
    const calls = githubMock(posts);
    try {
      const { response, data } = await run(fields);
      assert.equal(response.status, 400);
      assert.equal(data.error, expected);
      assert.equal(calls.some((call) => call.method === 'PATCH' || call.path.endsWith('/git/trees')), false);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('delete removes metadata, report HTML, and managed cover in one tree', async () => {
  const post = { ...basePost, coverImage: `covers/${basePost.id}.webp` };
  const calls = githubMock([post]);
  try {
    const { response, data } = await run({ action: 'delete', confirmTitle: post.title });
    assert.equal(response.status, 200);
    assert.equal(data.post, null);
    const tree = treeFrom(calls);
    assert.equal(tree.find((entry) => entry.path === post.href).sha, null);
    assert.equal(tree.find((entry) => entry.path === post.coverImage).sha, null);
    assert.deepEqual(postsFromTree(tree), []);
    assert.equal(calls.filter((call) => call.path.endsWith('/git/commits')).length, 1);
    assert.deepEqual(calls.find((call) => call.path.endsWith('/git/commits')).body.parents, ['base-sha']);
  } finally { globalThis.fetch = originalFetch; }
});

test('delete requires the exact current title before creating a Git tree or commit', async () => {
  for (const confirmTitle of [undefined, '틀린 제목']) {
    const calls = githubMock();
    try {
      const fields = { action: 'delete' };
      if (confirmTitle !== undefined) fields.confirmTitle = confirmTitle;
      const { response, data } = await run(fields);
      assert.equal(response.status, 400);
      assert.equal(data.error, 'DELETE_CONFIRMATION_MISMATCH');
      assert.equal(calls.some((call) => call.path.endsWith('/git/trees') || call.path.endsWith('/git/commits')), false);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('main branch movement returns 409 and never force-updates the ref', async () => {
  const calls = githubMock([basePost], { conflict: true });
  try {
    const { response, data } = await run();
    assert.equal(response.status, 409);
    assert.equal(data.error, 'REPOSITORY_CHANGED');
    assert.match(data.message, /새로고침/);
    assert.equal(calls.some((call) => call.method === 'PATCH'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('authentication and server configuration fail before GitHub access', async () => {
  for (const [key, env, status, error] of [
    ['wrong', { GITHUB_TOKEN: 'token', ADMIN_KEY }, 401, 'UNAUTHORIZED'],
    [ADMIN_KEY, { ADMIN_KEY }, 503, 'SERVER_NOT_CONFIGURED']
  ]) {
    const calls = githubMock();
    try {
      const response = await onRequestPost({ request: manageRequest({}, key), env });
      const data = await response.json();
      assert.equal(response.status, status);
      assert.equal(data.error, error);
      assert.equal(calls.length, 0);
    } finally { globalThis.fetch = originalFetch; }
  }
});
