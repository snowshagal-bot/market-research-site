// The publish and manage APIs with Research body pictures: what one commit
// carries, what a failure leaves behind, and that every other type is byte
// for byte untouched.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { onRequestPost as publish } from '../functions/api/publish.js';
import { onRequestPost as manage } from '../functions/api/manage.js';
import { createMockAuthEnv } from './helpers/auth-test-helper.mjs';

const ADMIN_KEY = 'test-admin-key';
const originalFetch = globalThis.fetch;
let sharedAuthEnv = null;
async function authEnv() {
  if (!sharedAuthEnv) sharedAuthEnv = await createMockAuthEnv({ ADMIN_KEY, GITHUB_TOKEN: 'token', GITHUB_REPO: 'snowshagal-bot/market-research-site' });
  return sharedAuthEnv;
}

/* ------------------------------------------------------------- fixtures */

function webp(width, height, filler = 0) {
  const bytes = new Uint8Array(30 + filler);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8);
  bytes.set([0x9d, 0x01, 0x2a], 23);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, bytes.length - 20, true);
  view.setUint16(26, width, true); view.setUint16(28, height, true);
  for (let i = 0; i < filler; i++) bytes[30 + i] = (i * 13) & 255;
  return bytes;
}
function png(width, height, filler = 0) {
  const bytes = new Uint8Array(8 + 25 + 12 + filler);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width); view.setUint32(20, height); bytes.set([8, 6, 0, 0, 0], 24);
  for (let i = 0; i < filler; i++) bytes[45 + i] = (i * 7) & 255;
  return bytes;
}
const b64 = bytes => Buffer.from(bytes).toString('base64');
const uri = (mime, bytes) => `data:image/${mime};base64,${b64(bytes)}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
const base64Text = text => Buffer.from(text, 'utf8').toString('base64');

const COVER = webp(900, 1350, 60);
const BODY_A = webp(1180, 664, 90);
const BODY_B = png(720, 909, 70);
const reportHtml = (bodies = [BODY_A, BODY_B]) => '<!doctype html><html><head><title>리서치</title></head><body>'
  + `<section class="cover"><div class="plate"><img class="cart" src="${uri('webp', COVER)}" width="900" height="1350" alt=""></div></section>`
  + '<p>본문 텍스트가 충분히 길어서 읽기 시간이 계산됩니다. 스테이블코인과 국채의 관계를 다룹니다.</p>'
  + bodies.map((bytes, i) => `<figure><img alt="삽화 ${i}" src="${uri(bytes[0] === 0x89 ? 'png' : 'webp', bytes)}" loading="lazy"></figure>`).join('')
  + '</body></html>';

/* --------------------------------------------------------- GitHub mock */

function githubMock({ existingPosts = [], failBlobAt = null, failTree = false, treeHasPaths = [] } = {}) {
  const calls = [];
  const blobs = [];
  const trees = new Map();
  const commits = new Map();
  let branchSha = 'base-sha';
  const index = existingPosts.map(p => ({ id: p.id, lang: p.lang || 'ko', category: p.type || 'daily', title: p.title || 'T', date: p.reportDate || '2026-09-04', tags: [] }));
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: branchSha } });
    if (path.includes('/contents/data/posts.json')) return json({ content: base64Text(`${JSON.stringify(existingPosts)}\n`) });
    if (path.includes('/contents/data/search-index.json')) return json({ content: base64Text(`${JSON.stringify(index)}\n`) });
    if (path.includes('/contents/')) {
      const file = decodeURIComponent(path.slice(path.indexOf('/contents/') + 10).split('?')[0]);
      return treeHasPaths.includes(file) ? json({ sha: 'exists' }) : json({ message: 'Not Found' }, 404);
    }
    if (method === 'GET' && path.endsWith('/git/commits/base-sha')) return json({ tree: { sha: 'base-tree' } });
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      blobs.push(body);
      if (failBlobAt !== null && blobs.length === failBlobAt) return json({ message: 'blob storage unavailable' }, 502);
      return json({ sha: `blob-${blobs.length}` });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      if (failTree) return json({ message: 'tree failed' }, 502);
      const treeSha = `tree-${trees.size + 1}`; trees.set(treeSha, body); return json({ sha: treeSha });
    }
    if (method === 'POST' && path.endsWith('/git/commits')) { const commitSha = `commit-${commits.size + 1}`; commits.set(commitSha, body); return json({ sha: commitSha }); }
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) { branchSha = body.sha; return json({ object: { sha: branchSha } }); }
    throw new Error(`Unexpected GitHub request: ${method} ${path}`);
  };
  return { calls, blobs, trees, commits, get branchSha() { return branchSha; }, tree() { return [...trees.values()][0]; }, refUpdates() { return calls.filter(c => c.method === 'PATCH').length; } };
}

async function runPublish({ type = 'research', lang = 'ko', html = reportHtml(), filename = 'research-report.html' } = {}) {
  const env = await authEnv();
  const form = new FormData();
  form.append('file', new File([html], filename, { type: 'text/html' }));
  form.append('type', type); form.append('lang', lang); form.append('reportDate', '2026-09-04');
  form.append('title', '테스트 리서치'); form.append('subtitle', ''); form.append('description', '설명'); form.append('filename', filename);
  const request = new Request('https://admin.snowshagal.com/api/publish', { method: 'POST', headers: { origin: 'https://admin.snowshagal.com', 'x-admin-key': ADMIN_KEY, cookie: env._authSession.cookieHeader, 'x-csrf-token': env._authSession.csrfToken }, body: form });
  const response = await publish({ request, env });
  return { response, data: await response.json() };
}

const existingResearch = {
  id: '2026-09-01-research-abc1234', type: 'research', typeLabel: '비정기 리서치', lang: 'ko', date: '2026-09-01', reportDate: '2026-09-01',
  registeredDate: '2026-09-01', registeredAt: '2026-09-01T00:00:00.000Z', legacyImport: false, title: '기존 리서치', subtitle: '', description: 'd',
  href: 'reports/existing-research.html', coverImage: 'covers/2026-09-01-research-abc1234.webp',
  bodyAssets: [`report-assets/2026-09-01-research-abc1234/${sha(BODY_A)}.webp`, `report-assets/2026-09-01-research-abc1234/${'0'.repeat(16)}.png`]
};

async function runManage(fields = {}) {
  const env = await authEnv();
  const form = new FormData();
  for (const [name, value] of Object.entries({ action: 'update', id: existingResearch.id, type: 'research', reportDate: '2026-09-01', title: '기존 리서치', subtitle: '', description: 'd', coverAction: 'keep', ...fields })) {
    if (value instanceof File) form.append(name, value, value.name);
    else if (value !== null && value !== undefined) form.append(name, String(value));
  }
  const request = new Request('https://admin.snowshagal.com/api/manage', { method: 'POST', headers: { origin: 'https://admin.snowshagal.com', 'x-admin-key': ADMIN_KEY, cookie: env._authSession.cookieHeader, 'x-csrf-token': env._authSession.csrfToken }, body: form });
  const response = await manage({ request, env });
  return { response, data: await response.json() };
}

const pathsOf = tree => tree.tree.map(e => e.path);
const entryOf = (tree, path) => tree.tree.find(e => e.path === path);

/* ----------------------------------------------------------------- publish */

test('publish research KO: cover inline, two body files, HTML, posts and index in one commit and one ref update', async () => {
  const github = githubMock();
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.deepEqual(data.bodyAssets, { converted: 2, skipped: 1, skipReasons: { cover: 1 } });
    const id = data.id;
    const a = `report-assets/${id}/${sha(BODY_A)}.webp`, b = `report-assets/${id}/${sha(BODY_B)}.png`;
    assert.equal(github.trees.size, 1); assert.equal(github.commits.size, 1); assert.equal(github.refUpdates(), 1);
    const tree = github.tree();
    assert.deepEqual(pathsOf(tree).filter(p => p.startsWith('report-assets/')), [a, b]);
    assert.equal(entryOf(tree, a).sha, 'blob-1'); assert.equal(entryOf(tree, b).sha, 'blob-2');
    assert.equal(github.blobs.length, 2, 'no cover was uploaded, so exactly the two body pictures became blobs');
    assert.equal(github.blobs[0].content, b64(BODY_A), 'the blob is the decoded original');
    const html = entryOf(tree, `reports/${'research-report.html'}`).content;
    assert.ok(html.includes(`src="${uri('webp', COVER)}"`), 'the cover is still inline');
    assert.ok(html.includes(`<img width="1180" height="664" alt="삽화 0" src="/${a}" loading="lazy">`));
    assert.ok(html.includes(`<img width="720" height="909" alt="삽화 1" src="/${b}" loading="lazy">`));
    assert.equal((html.match(/data:image/g) || []).length, 1);
    const posts = JSON.parse(entryOf(tree, 'data/posts.json').content);
    const post = posts.find(p => p.id === id);
    assert.deepEqual(post.bodyAssets, [a, b]);
    assert.ok(entryOf(tree, 'data/posts.js').content.includes(`"${a}"`), 'the JS mirror carries the same metadata');
    // blobs all came before the tree
    const lastBlob = github.calls.map((c, i) => c.path.endsWith('/git/blobs') ? i : -1).filter(i => i >= 0).pop();
    const treeAt = github.calls.findIndex(c => c.path.endsWith('/git/trees'));
    assert.ok(lastBlob < treeAt);
  } finally { globalThis.fetch = originalFetch; }
});

test('publish research EN goes under reports/en with its own directory', async () => {
  const github = githubMock();
  try {
    const { response, data } = await runPublish({ lang: 'en', filename: 'research-en.html' });
    assert.equal(response.status, 200, JSON.stringify(data));
    const tree = github.tree();
    assert.ok(entryOf(tree, 'reports/en/research-en.html'));
    assert.deepEqual(pathsOf(tree).filter(p => p.startsWith('report-assets/')), [`report-assets/${data.id}/${sha(BODY_A)}.webp`, `report-assets/${data.id}/${sha(BODY_B)}.png`]);
  } finally { globalThis.fetch = originalFetch; }
});

test('publish daily / weekly / note / basics with the same HTML: byte-identical, no blobs, no bodyAssets', async () => {
  for (const type of ['daily', 'weekly', 'note', 'basics']) {
    const github = githubMock();
    try {
      const html = reportHtml();
      const { response, data } = await runPublish({ type, html, filename: `${type}.html` });
      assert.equal(response.status, 200, `${type}: ${JSON.stringify(data)}`);
      assert.equal(data.bodyAssets, undefined, `${type}: nothing to report`);
      assert.equal(github.blobs.length, 0, `${type}: no blobs`);
      const tree = github.tree();
      assert.equal(entryOf(tree, `reports/${type}.html`).content, html, `${type}: the HTML is exactly the upload`);
      assert.equal(pathsOf(tree).some(p => p.startsWith('report-assets/')), false);
      const post = JSON.parse(entryOf(tree, 'data/posts.json').content).find(p => p.id === data.id);
      assert.equal('bodyAssets' in post, false, `${type}: no field`);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('publish research whose pictures all stay inline passes through and says why', async () => {
  const github = githubMock();
  try {
    const sixteen = Array.from({ length: 16 }, (_, i) => webp(10 + i, 10));
    const html = reportHtml(sixteen);
    const { response, data } = await runPublish({ html });
    assert.equal(response.status, 200);
    assert.equal(data.bodyAssets.passThrough, 'TOO_MANY_IMAGES');
    assert.equal(data.bodyAssets.converted, 0);
    assert.equal(github.blobs.length, 0);
    assert.equal(entryOf(github.tree(), 'reports/research-report.html').content, html, 'byte-identical');
    assert.equal('bodyAssets' in JSON.parse(entryOf(github.tree(), 'data/posts.json').content).find(p => p.id === data.id), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('publish: a blob failure in the middle means no tree, no commit, no ref update', async () => {
  const github = githubMock({ failBlobAt: 2 });
  try {
    const { response, data } = await runPublish();
    assert.equal(response.status, 500);
    assert.equal(data.error, 'PUBLISH_FAILED');
    assert.equal(github.trees.size, 0); assert.equal(github.commits.size, 0); assert.equal(github.refUpdates(), 0);
    assert.equal(github.branchSha, 'base-sha');
  } finally { globalThis.fetch = originalFetch; }
});

test('publish: a tree failure after the blobs means no commit and no ref update', async () => {
  const github = githubMock({ failTree: true });
  try {
    const { response } = await runPublish();
    assert.equal(response.status, 500);
    assert.equal(github.blobs.length, 2);
    assert.equal(github.commits.size, 0); assert.equal(github.refUpdates(), 0);
    assert.equal(github.branchSha, 'base-sha');
  } finally { globalThis.fetch = originalFetch; }
});

/* ------------------------------------------------------------------ manage */

test('manage replace research: new files, new HTML, metadata and old-only deletions in one commit; a kept file is untouched', async () => {
  const github = githubMock({ existingPosts: [existingResearch] });
  try {
    const NEW_C = webp(640, 480, 45);
    const html = reportHtml([BODY_A, NEW_C]);      // A kept (same bytes → same path), B gone, C new
    const { response, data } = await runManage({ file: new File([html], 'r.html', { type: 'text/html' }) });
    assert.equal(response.status, 200, JSON.stringify(data));
    const id = existingResearch.id;
    const a = `report-assets/${id}/${sha(BODY_A)}.webp`, c = `report-assets/${id}/${sha(NEW_C)}.webp`, oldB = existingResearch.bodyAssets[1];
    assert.deepEqual(data.post.bodyAssets, [a, c]);
    assert.deepEqual(data.bodyAssets, { converted: 2, skipped: 1, skipReasons: { cover: 1 } });
    assert.equal(github.trees.size, 1); assert.equal(github.commits.size, 1); assert.equal(github.refUpdates(), 1);
    const tree = github.tree();
    assert.ok(entryOf(tree, a) && entryOf(tree, a).sha === 'blob-1', 'the kept picture is re-uploaded to the same path (same bytes, same content)');
    assert.ok(entryOf(tree, c) && entryOf(tree, c).sha === 'blob-2');
    assert.deepEqual(entryOf(tree, oldB), { path: oldB, mode: '100644', type: 'blob', sha: null }, 'the file only the old HTML used is deleted');
    assert.ok(entryOf(tree, existingResearch.href).content.includes(`/${c}`));
    const post = JSON.parse(entryOf(tree, 'data/posts.json').content).find(p => p.id === id);
    assert.deepEqual(post.bodyAssets, [a, c]);
  } finally { globalThis.fetch = originalFetch; }
});

test('manage replace: a blob failure leaves the old report, files and metadata untouched — nothing deleted first', async () => {
  const github = githubMock({ existingPosts: [existingResearch], failBlobAt: 1 });
  try {
    const { response, data } = await runManage({ file: new File([reportHtml([webp(50, 50, 5)])], 'r.html', { type: 'text/html' }) });
    assert.equal(response.status, 500);
    assert.equal(data.error, 'MANAGE_FAILED');
    assert.equal(github.trees.size, 0); assert.equal(github.commits.size, 0); assert.equal(github.refUpdates(), 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('manage update without a new file leaves bodyAssets and files exactly as they were', async () => {
  const github = githubMock({ existingPosts: [existingResearch] });
  try {
    const { response, data } = await runManage({ title: '제목만 수정' });
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.deepEqual(data.post.bodyAssets, existingResearch.bodyAssets);
    assert.equal(data.bodyAssets, undefined);
    const tree = github.tree();
    assert.equal(pathsOf(tree).some(p => p.startsWith('report-assets/')), false, 'no asset entry of any kind');
  } finally { globalThis.fetch = originalFetch; }
});

test('manage replace with a non-research type passes the HTML through and removes files the new HTML no longer uses', async () => {
  const github = githubMock({ existingPosts: [existingResearch] });
  try {
    const html = reportHtml();
    const { response, data } = await runManage({ type: 'weekly', file: new File([html], 'r.html', { type: 'text/html' }) });
    assert.equal(response.status, 200, JSON.stringify(data));
    const tree = github.tree();
    assert.equal(entryOf(tree, existingResearch.href).content, html, 'byte-identical');
    for (const old of existingResearch.bodyAssets) assert.equal(entryOf(tree, old).sha, null, `${old} deleted`);
    assert.equal('bodyAssets' in data.post, false);
    assert.equal(github.blobs.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('manage delete removes every recorded body file in the same commit', async () => {
  const github = githubMock({ existingPosts: [existingResearch] });
  try {
    const { response, data } = await runManage({ action: 'delete', confirmTitle: existingResearch.title });
    assert.equal(response.status, 200, JSON.stringify(data));
    const tree = github.tree();
    for (const old of existingResearch.bodyAssets) assert.equal(entryOf(tree, old).sha, null, `${old} deleted`);
    assert.equal(entryOf(tree, existingResearch.href).sha, null);
    assert.equal(entryOf(tree, existingResearch.coverImage).sha, null);
    assert.equal(JSON.parse(entryOf(tree, 'data/posts.json').content).length, 0);
    assert.equal(github.refUpdates(), 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('manage refuses a post whose recorded body paths are not its own', async () => {
  const rogue = { ...existingResearch, bodyAssets: ['report-assets/other-post/0123456789abcdef.webp'] };
  const github = githubMock({ existingPosts: [rogue] });
  try {
    const { response, data } = await runManage({ action: 'delete', confirmTitle: rogue.title });
    assert.equal(response.status, 400);
    assert.equal(data.error, 'UNSAFE_BODY_ASSET_PATH');
    assert.equal(github.trees.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});
