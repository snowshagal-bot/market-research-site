import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { onRequestPost } from '../functions/api/manage.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const ADMIN_KEY = 'test-admin-key';
const originalFetch = globalThis.fetch;

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function githubMock(existingPosts, { searchIndex = null } = {}) {
  const calls = [];
  const defaultIndex = searchIndex !== null ? searchIndex : existingPosts.map(p => ({
    id: p.id,
    lang: p.lang || 'ko',
    category: p.type || 'daily',
    title: p.title || 'Title',
    date: p.reportDate || p.date || '2026-08-11',
    tags: []
  }));

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', body });
    if (path.includes('/contents/data/search-index.json?ref=')) {
      return new Response(JSON.stringify({ content: base64(`${JSON.stringify(defaultIndex)}\n`) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    let payload;
    if (path.endsWith('/git/ref/heads/main')) {
      payload = { object: { sha: 'base-sha' } };
    } else if (path.endsWith('/git/commits/base-sha')) payload = { tree: { sha: 'base-tree' } };
    else if (path.includes('/contents/data/posts.json?ref=')) payload = { content: base64(`${JSON.stringify(existingPosts)}\n`) };
    else if (path.endsWith('/git/trees')) payload = { sha: 'tree-sha' };
    else if (path.endsWith('/git/commits')) payload = { sha: 'commit-sha' };
    else if (path.endsWith('/git/refs/heads/main')) payload = {};
    else throw new Error(`Unexpected GitHub request: ${path}`);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

function manageRequest(fields = {}, key = ADMIN_KEY, url = 'https://snowshagal.com/api/manage') {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value instanceof File) form.append(name, value, value.name);
    else if (value !== null && value !== undefined) form.append(name, String(value));
  }
  return new Request(url, { method: 'POST', headers: { 'x-admin-key': key }, body: form });
}

function element(id = '') {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  return {
    id,
    value: '',
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    files: [],
    dataset: {},
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, ...event }); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    removeAttribute(name) { attributes.delete(name); },
    appendChild() {},
    querySelector() { return element(); },
    focus() {}
  };
}

async function loadManageUIContext(initialPosts = []) {
  const source = await read('assets/admin-manage.js');
  const ids = [
    'post-list', 'post-count', 'manage-search', 'editor-empty', 'editor-form', 'manage-status',
    'manage-admin-key', 'replacement-html', 'html-status', 'html-preview', 'html-preview-frame',
    'replacement-cover', 'cover-file-field', 'cover-status', 'manage-cover-image',
    'manage-cover-fallback', 'cover-meta', 'cover-name', 'cover-dimensions', 'cover-size',
    'current-cover-label', 'start-delete', 'delete-confirmation', 'delete-expected-title',
    'delete-title-confirm', 'confirm-delete', 'manage-cover-preview', 'save-post',
    'manage-result-overlay', 'manage-result-title', 'manage-result-text', 'manage-result-detail',
    'manage-result-home', 'manage-result-continue', 'manage-id', 'manage-href', 'manage-registered-date',
    'manage-registered-at', 'manage-language', 'manage-translation-group', 'manage-type', 'manage-date',
    'manage-title', 'manage-subtitle', 'manage-description', 'manage-summary', 'manage-takeaway',
    'manage-takeaway-field', 'current-report-link', 'manage-tag-options', 'manage-tags-count'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  const context = {
    console,
    fetch: async () => ({ ok: true, json: async () => initialPosts }),
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    document: {
      documentElement: element('html'),
      createElement: (tag) => element(tag),
      getElementById: (id) => elements[id] || element(id),
      querySelector: (sel) => {
        if (sel === 'input[name="cover-action"][value="keep"]') return element('keep');
        if (sel === 'input[name="cover-action"]:checked') return { value: 'keep' };
        return element();
      },
      querySelectorAll: () => []
    },
    location: { hostname: 'snowshagal.com', href: '' },
    FormData,
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    window: { addEventListener: () => {} }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.window.__adminManageTest.setPosts(initialPosts);
  return { context, elements };
}

// -------------------------------------------------------------
// TESTS
// -------------------------------------------------------------

test('Case 1: Loading existing Daily with takeaway populates textarea and shows field', async () => {
  const postWithTakeaway = {
    id: '2026-08-27-daily-test1',
    type: 'daily',
    title: '7,000의 문턱',
    date: '2026-08-27',
    reportDate: '2026-08-27',
    takeaway: '7,000의 문턱에서 다시 밀렸다',
    href: 'reports/test.html'
  };

  const { context, elements } = await loadManageUIContext([postWithTakeaway]);
  context.window.__adminManageTest.selectPost(postWithTakeaway.id);

  assert.equal(elements['manage-takeaway'].value, '7,000의 문턱에서 다시 밀렸다');
  assert.equal(elements['manage-takeaway-field'].hidden, false, 'Takeaway field must be visible for daily');
});

test('Case 2: Daily takeaway update via API modifies posts.json properly', async () => {
  const initialPost = {
    id: '2026-08-27-daily-test2',
    type: 'daily',
    typeLabel: '주식 리포트',
    title: '기존 리포트',
    date: '2026-08-27',
    reportDate: '2026-08-27',
    takeaway: '기존 문구',
    href: 'reports/test2.html'
  };

  const calls = githubMock([initialPost]);
  const req = manageRequest({
    action: 'update',
    id: initialPost.id,
    type: 'daily',
    reportDate: '2026-08-27',
    title: '기존 리포트',
    takeaway: '새로운 문구'
  });

  const res = await onRequestPost({ request: req, env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);

  const tree = calls.find(c => c.path.endsWith('/git/trees'))?.body.tree;
  const updatedPosts = JSON.parse(tree.find(e => e.path === 'data/posts.json').content);
  assert.equal(updatedPosts[0].takeaway, '새로운 문구');

  globalThis.fetch = originalFetch;
});

test('Case 3: Editing other fields (title, summary, tags) preserves existing takeaway', async () => {
  const initialPost = {
    id: '2026-08-27-daily-test3',
    type: 'daily',
    typeLabel: '주식 리포트',
    title: '이전 제목',
    date: '2026-08-27',
    reportDate: '2026-08-27',
    takeaway: '보존되어야 하는 기존 문구',
    href: 'reports/test3.html'
  };

  const calls = githubMock([initialPost]);
  const req = manageRequest({
    action: 'update',
    id: initialPost.id,
    type: 'daily',
    reportDate: '2026-08-27',
    title: '새로운 제목',
    summary: '새 요약'
  });

  const res = await onRequestPost({ request: req, env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);

  const tree = calls.find(c => c.path.endsWith('/git/trees'))?.body.tree;
  const updatedPosts = JSON.parse(tree.find(e => e.path === 'data/posts.json').content);
  assert.equal(updatedPosts[0].title, '새로운 제목');
  assert.equal(updatedPosts[0].takeaway, '보존되어야 하는 기존 문구', 'Takeaway must not be lost when not provided in partial update');

  globalThis.fetch = originalFetch;
});

test('Case 4: Deleting takeaway by submitting empty string removes takeaway property completely', async () => {
  const initialPost = {
    id: '2026-08-27-daily-test4',
    type: 'daily',
    typeLabel: '주식 리포트',
    title: '리포트',
    date: '2026-08-27',
    reportDate: '2026-08-27',
    takeaway: '삭제할 기존 문구',
    href: 'reports/test4.html'
  };

  const calls = githubMock([initialPost]);
  const req = manageRequest({
    action: 'update',
    id: initialPost.id,
    type: 'daily',
    reportDate: '2026-08-27',
    title: '리포트',
    takeaway: '   '
  });

  const res = await onRequestPost({ request: req, env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);

  const tree = calls.find(c => c.path.endsWith('/git/trees'))?.body.tree;
  const updatedPosts = JSON.parse(tree.find(e => e.path === 'data/posts.json').content);
  assert.equal('takeaway' in updatedPosts[0], false, 'takeaway property must be completely deleted when empty');

  globalThis.fetch = originalFetch;
});

test('Case 5: Changing category from Daily to Weekly strips takeaway property', async () => {
  const initialPost = {
    id: '2026-08-27-daily-test5',
    type: 'daily',
    typeLabel: '주식 리포트',
    title: '위클리로 변경할 리포트',
    date: '2026-08-27',
    reportDate: '2026-08-27',
    takeaway: '기존 데일리 문구',
    href: 'reports/test5.html'
  };

  const calls = githubMock([initialPost]);
  const req = manageRequest({
    action: 'update',
    id: initialPost.id,
    type: 'weekly',
    reportDate: '2026-08-27',
    title: '위클리로 변경할 리포트',
    takeaway: '기존 데일리 문구'
  });

  const res = await onRequestPost({ request: req, env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
  const data = await res.json();
  assert.equal(res.status, 200);

  const tree = calls.find(c => c.path.endsWith('/git/trees'))?.body.tree;
  const updatedPosts = JSON.parse(tree.find(e => e.path === 'data/posts.json').content);
  assert.equal(updatedPosts[0].type, 'weekly');
  assert.equal('takeaway' in updatedPosts[0], false, 'Non-daily categories must never retain a takeaway');

  globalThis.fetch = originalFetch;
});

test('Case 6: Changing category from Weekly to Daily allows creating takeaway', async () => {
  const initialPost = {
    id: '2026-08-27-weekly-test6',
    type: 'weekly',
    typeLabel: '위클리 리포트',
    title: '데일리로 변경할 리포트',
    date: '2026-08-27',
    reportDate: '2026-08-27',
    href: 'reports/test6.html'
  };

  const calls = githubMock([initialPost]);
  const req = manageRequest({
    action: 'update',
    id: initialPost.id,
    type: 'daily',
    reportDate: '2026-08-27',
    title: '데일리로 변경할 리포트',
    takeaway: '새로운 데일리 한 줄'
  });

  const res = await onRequestPost({ request: req, env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
  const data = await res.json();
  assert.equal(res.status, 200);

  const tree = calls.find(c => c.path.endsWith('/git/trees'))?.body.tree;
  const updatedPosts = JSON.parse(tree.find(e => e.path === 'data/posts.json').content);
  assert.equal(updatedPosts[0].type, 'daily');
  assert.equal(updatedPosts[0].takeaway, '새로운 데일리 한 줄');

  globalThis.fetch = originalFetch;
});

test('Case 7: 400 char limit enforcement on both client form and server API', async () => {
  const longTakeaway = '가'.repeat(450);
  const initialPost = {
    id: '2026-08-27-daily-test7',
    type: 'daily',
    typeLabel: '주식 리포트',
    title: '리포트',
    date: '2026-08-27',
    reportDate: '2026-08-27',
    href: 'reports/test7.html'
  };

  const calls = githubMock([initialPost]);
  const req = manageRequest({
    action: 'update',
    id: initialPost.id,
    type: 'daily',
    reportDate: '2026-08-27',
    title: '리포트',
    takeaway: longTakeaway
  });

  const res = await onRequestPost({ request: req, env: { GITHUB_TOKEN: 'token', ADMIN_KEY } });
  assert.equal(res.status, 200);

  const tree = calls.find(c => c.path.endsWith('/git/trees'))?.body.tree;
  const updatedPosts = JSON.parse(tree.find(e => e.path === 'data/posts.json').content);
  assert.equal(updatedPosts[0].takeaway.length, 400, 'Server must enforce 400 characters max limit');

  const { context, elements } = await loadManageUIContext([initialPost]);
  context.window.__adminManageTest.selectPost(initialPost.id);
  elements['manage-type'].value = 'daily';
  elements['manage-takeaway'].value = longTakeaway;
  const formData = await context.window.__adminManageTest.buildUpdateForm();
  assert.equal(formData.get('takeaway').length, 400, 'Client form builder must slice at 400 characters');

  globalThis.fetch = originalFetch;
});

test('Case 8: Daily without existing takeaway opens safely with blank textarea', async () => {
  const pastDailyWithoutTakeaway = {
    id: '2026-08-01-daily-legacy',
    type: 'daily',
    title: '과거 데일리',
    date: '2026-08-01',
    reportDate: '2026-08-01',
    href: 'reports/past.html'
  };

  const { context, elements } = await loadManageUIContext([pastDailyWithoutTakeaway]);
  context.window.__adminManageTest.selectPost(pastDailyWithoutTakeaway.id);

  assert.equal(elements['manage-takeaway'].value, '', 'Must not show undefined or null');
  assert.equal(elements['manage-takeaway-field'].hidden, false, 'Takeaway field must be visible for daily');
});

test('UI Visibility: Takeaway field is hidden for non-daily categories and toggles on type change', async () => {
  const weeklyPost = {
    id: '2026-08-20-weekly-test',
    type: 'weekly',
    title: '위클리 리서치',
    date: '2026-08-20',
    reportDate: '2026-08-20',
    href: 'reports/weekly.html'
  };

  const { context, elements } = await loadManageUIContext([weeklyPost]);
  context.window.__adminManageTest.selectPost(weeklyPost.id);

  assert.equal(elements['manage-takeaway-field'].hidden, true, 'Takeaway field must be hidden for weekly');

  elements['manage-type'].value = 'daily';
  context.window.__adminManageTest.updateTakeawayVisibility('daily');
  assert.equal(elements['manage-takeaway-field'].hidden, false, 'Takeaway field becomes visible when daily is selected');

  elements['manage-type'].value = 'research';
  context.window.__adminManageTest.updateTakeawayVisibility('research');
  assert.equal(elements['manage-takeaway-field'].hidden, true, 'Takeaway field becomes hidden when research is selected');
});
