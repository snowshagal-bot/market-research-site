import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

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
    src: '',
    naturalWidth: 0,
    naturalHeight: 0,
    href: '',
    checked: id === 'cover-keep',
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, ...event }); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    removeAttribute(name) { if (name === 'src') this.src = ''; attributes.delete(name); },
    appendChild() {},
    querySelector() { return element(); },
    focus() {}
  };
}

async function loadClientHelpers({
  confirmResult = true,
  manageResponse = null,
  listPosts = [],
  deployResponses = [],
  coverStatuses = [],
  hostname = 'market-research-site.pages.dev'
} = {}) {
  const source = await read('assets/admin-manage.js');
  const ids = [
    'post-list', 'post-count', 'manage-search', 'editor-empty', 'editor-form', 'manage-status',
    'manage-admin-key', 'replacement-html', 'html-status', 'html-preview', 'html-preview-frame',
    'replacement-cover', 'cover-file-field', 'cover-status', 'manage-cover-image',
    'manage-cover-fallback', 'cover-meta', 'cover-name', 'cover-dimensions', 'cover-size',
    'current-cover-label', 'start-delete', 'delete-confirmation', 'delete-expected-title',
    'delete-title-confirm', 'confirm-delete', 'manage-cover-preview', 'save-post',
    'manage-result-overlay', 'manage-result-title', 'manage-result-text', 'manage-result-detail',
    'manage-result-home', 'manage-result-continue'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  elements['manage-result-overlay'].hidden = true;
  const themeButton = element('theme');
  const themeMeta = element('theme-meta');
  const coverKeep = element('cover-keep');
  coverKeep.value = 'keep';
  coverKeep.checked = true;
  const fetchCalls = [];
  const allFetchCalls = [];
  const timers = new Map();
  const clearedTimers = [];
  let nextTimerId = 1;
  const location = { hostname, href: '' };
  const context = {
    console,
    confirm: () => confirmResult,
    fetch: async (url, options = {}) => {
      allFetchCalls.push({ url: String(url), options });
      if (String(url).includes('/api/manage')) {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => manageResponse || { ok: true, post: {}, commit: 'abcdef0123456789' }
        };
      }
      if (String(url).startsWith('/data/posts.json?t=')) {
        const next = deployResponses.length ? deployResponses.shift() : listPosts;
        return { ok: true, status: 200, json: async () => next };
      }
      if (String(url).startsWith('/covers/')) {
        const status = coverStatuses.length ? coverStatuses.shift() : 404;
        return { ok: status === 200, status, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => listPosts };
    },
    setTimeout(callback, delay) { const id = nextTimerId++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { clearedTimers.push(id); timers.delete(id); },
    FormData,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    location,
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) => elements[id] || (elements[id] = element(id)),
      querySelector: (selector) => selector === '[data-theme-toggle]' ? themeButton : selector === 'meta[name="theme-color"]' ? themeMeta : selector.includes('cover-action') ? coverKeep : null,
      querySelectorAll: () => [],
      createElement: () => element()
    },
    window: { addEventListener() {} }
  };
  vm.runInNewContext(source, context);
  await Promise.resolve();
  await Promise.resolve();
  return { helpers: context.window.__adminManageTest, elements, coverKeep, fetchCalls, allFetchCalls, timers, clearedTimers, location };
}

async function flushPromises(turns = 6) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

test('manage page includes navigation, list controls, immutable metadata, edit fields, previews, and two-step delete UI', async () => {
  const html = await read('admin/manage/index.html');
  assert.match(html, /href="\.\.\/"[^>]*>새 리포트 등록/);
  assert.match(html, /href="\.\/" aria-current="page">게시물 관리/);
  assert.match(html, /id="manage-search"[^>]*type="search"/);
  for (const type of ['all', 'daily', 'weekly', 'research', 'basics', 'note']) assert.match(html, new RegExp(`data-filter="${type}"`));
  for (const id of ['manage-id', 'manage-href', 'manage-registered-date', 'manage-registered-at', 'manage-language', 'manage-translation-group']) assert.match(html, new RegExp(`id="${id}"[^>]*readonly`));
  for (const id of ['manage-type', 'manage-date', 'manage-title', 'manage-subtitle', 'manage-description']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="replacement-html"[^>]*accept="\.html,text\/html"/);
  assert.match(html, /id="html-preview-frame"[^>]*sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /sandbox="[^"]*allow-same-origin/);
  assert.match(html, /name="cover-action" value="keep" checked/);
  assert.match(html, /name="cover-action" value="replace"/);
  assert.match(html, /name="cover-action" value="remove"/);
  assert.equal((html.match(/<button[^>]+data-preview-mode="(?:1280|430|360)"/g) || []).length, 3);
  assert.match(html, /id="start-delete"/);
  assert.match(html, /id="delete-title-confirm"/);
  assert.match(html, /id="confirm-delete"[^>]*disabled/);
  assert.match(html, /id="manage-result-overlay"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="manage-result-home"[^>]*href="\/"/);
  assert.match(html, /id="manage-result-continue"/);
});

test('client list sorting, title/href search, category filters, file validation, and Preview safety are deterministic', async () => {
  const { helpers } = await loadClientHelpers();
  const items = [
    { id: 'old', type: 'daily', reportDate: '2026-08-01', registeredAt: '2026-08-02T00:00:00Z', title: '알파', href: 'reports/alpha.html' },
    { id: 'newer-registration', type: 'weekly', reportDate: '2026-08-11', registeredAt: '2026-08-11T02:00:00Z', title: '주간', href: 'reports/weekly.html' },
    { id: 'newest', type: 'research', reportDate: '2026-08-11', registeredAt: '2026-08-11T03:00:00Z', title: '소버린 AI', href: 'reports/sovereign.html' }
  ];
  assert.deepEqual(Array.from(helpers.sortPosts(items), (post) => post.id), ['newest', 'newer-registration', 'old']);
  assert.deepEqual(Array.from(helpers.filteredPosts(items, '소버린', 'all'), (post) => post.id), ['newest']);
  assert.deepEqual(Array.from(helpers.filteredPosts(items, 'weekly.html', 'all'), (post) => post.id), ['newer-registration']);
  assert.deepEqual(Array.from(helpers.filteredPosts(items, '', 'daily'), (post) => post.id), ['old']);
  assert.equal(helpers.validateHtml({ name: 'report.html', size: 100 }, '<!doctype html><html><body></body></html>'), '');
  assert.match(helpers.validateHtml({ name: 'report.html', size: 100 }, '<div>fragment</div>'), /독립 실행형/);
  assert.equal(helpers.validateCover({ name: 'cover.webp', type: 'image/webp', size: 100 }), '');
  assert.match(helpers.validateCover({ name: 'cover.gif', type: 'image/gif', size: 100 }), /JPG/);
  assert.equal(helpers.isPreviewHost('abc.market-research-site.pages.dev'), true);
  assert.equal(helpers.isPreviewHost('market-research-site.pages.dev'), false);
});

test('manage client keeps immutable values server-owned and preserves current href for HTML replacement', async () => {
  const source = await read('assets/admin-manage.js');
  assert.match(source, /body\.append\('id', selectedPost\.id\)/);
  assert.doesNotMatch(source, /body\.append\('(href|registeredDate|registeredAt|legacyImport)'/);
  assert.match(source, /selectedHtml[^\n]+body\.append\('file'/);
  assert.match(source, /htmlFrame\.srcdoc = source/);
  assert.match(source, /body\.append\('confirmTitle', deleteTitleConfirm\.value\)/);
  assert.match(source, /next\.lang === 'en' \? 'English \(en\)'/);
  assert.match(source, /next\.translationGroup \|\| '연결 없음'/);
  assert.match(source, /deleteTitleConfirm\.value !== selectedPost\.title/);
  assert.match(source, /Preview에서는 실제 저장·삭제를 실행할 수 없습니다/);
  assert.match(source, /DEPLOY_POLL_INTERVAL_MS = 2500/);
  assert.match(source, /DEPLOY_POLL_MAX_ATTEMPTS = 36/);
});

test('cover replacement is excluded until decode succeeds and remains excluded after decode failure', async () => {
  const { helpers, elements, coverKeep, fetchCalls } = await loadClientHelpers();
  const post = {
    id: 'post-1', type: 'daily', reportDate: '2026-08-11', date: '2026-08-11',
    registeredDate: '2026-08-11', registeredAt: '2026-08-11T00:00:00Z',
    title: '테스트 제목', subtitle: '', description: '', href: 'reports/test.html'
  };
  helpers.setPosts([post]);
  helpers.selectPost(post.id);
  coverKeep.value = 'replace';
  const cover = new File(['image'], 'cover.webp', { type: 'image/webp' });

  helpers.chooseCover(cover);
  assert.equal(helpers.coverState().coverDecodePending, true);
  assert.equal(helpers.coverState().selectedCover, null);
  assert.equal(elements['save-post'].disabled, true);
  assert.equal(Array.from(helpers.buildUpdateForm().keys()).includes('cover'), false);
  await helpers.save({ preventDefault() {} });
  assert.equal(fetchCalls.length, 0);

  elements['manage-cover-image'].onerror();
  assert.equal(helpers.coverState().coverDecodePending, false);
  assert.equal(helpers.coverState().selectedCover, null);
  assert.equal(Array.from(helpers.buildUpdateForm().keys()).includes('cover'), false);

  helpers.chooseCover(cover);
  elements['manage-cover-image'].naturalWidth = 900;
  elements['manage-cover-image'].naturalHeight = 1350;
  elements['manage-cover-image'].onload();
  assert.equal(helpers.coverState().coverDecodePending, false);
  assert.equal(helpers.coverState().selectedCover, cover);
  assert.equal(elements['save-post'].disabled, false);
  assert.equal(Array.from(helpers.buildUpdateForm().keys()).includes('cover'), true);
});

test('update success opens the deployment overlay without immediately rerendering the editor', async () => {
  const post = {
    id: 'post-1', type: 'daily', reportDate: '2026-08-11', date: '2026-08-11',
    registeredDate: '2026-08-11', registeredAt: '2026-08-11T00:00:00Z',
    title: '테스트 제목', subtitle: '', description: '', href: 'reports/test.html'
  };
  const responsePost = { ...post, title: '수정 제목', updatedAt: '2026-08-11T12:00:00Z' };
  const { helpers, elements, fetchCalls } = await loadClientHelpers({
    listPosts: [post],
    deployResponses: [[post]],
    manageResponse: { ok: true, action: 'update', post: responsePost, commit: 'abcdef0123456789' }
  });
  helpers.setPosts([post]);
  helpers.selectPost(post.id);
  elements['manage-admin-key'].value = 'test-key';
  elements['manage-title'].value = responsePost.title;
  await helpers.save({ preventDefault() {} });
  assert.equal(fetchCalls.length, 1);
  assert.equal(elements['manage-result-overlay'].hidden, false);
  assert.equal(elements['manage-result-title'].textContent, '저장되었습니다.');
  assert.equal(elements['manage-result-text'].textContent, '홈페이지 반영을 확인하고 있습니다.');
  assert.match(elements['manage-result-detail'].textContent, /abcdef0/);
  assert.equal(elements['manage-title'].value, responsePost.title);
  const source = await read('assets/admin-manage.js');
  assert.doesNotMatch(source, /selectPost\(data\.post\.id\)/);
});

test('deployment polling matches the updated post, verifies the cover, and redirects home', async () => {
  const updated = {
    id: 'post-1', type: 'daily', typeLabel: '주식 리포트', reportDate: '2026-08-11', date: '2026-08-11',
    registeredDate: '2026-08-11', registeredAt: '2026-08-11T00:00:00Z', title: '수정 제목', subtitle: '',
    description: '수정 설명', href: 'reports/test.html', updatedAt: '2026-08-11T12:00:00Z', coverImage: 'covers/post-1.webp'
  };
  const { helpers, elements, allFetchCalls, timers, location } = await loadClientHelpers({
    listPosts: [updated], deployResponses: [[updated]], coverStatuses: [200]
  });
  const operation = { action: 'update', id: updated.id, post: updated, commit: 'abcdef0123456789' };
  const result = await helpers.beginDeploymentCheck(operation, { maxAttempts: 1, intervalMs: 0 });
  assert.equal(result, 'complete');
  assert.equal(elements['manage-result-overlay'].classList.contains('done'), true);
  assert.equal(elements['manage-result-title'].textContent, '홈페이지 반영이 완료되었습니다.');
  assert.equal(elements['manage-result-text'].textContent, '잠시 후 홈페이지로 이동합니다.');
  const postsCall = allFetchCalls.find((call) => call.url.startsWith('/data/posts.json?t='));
  const coverCall = allFetchCalls.find((call) => call.url.startsWith('/covers/post-1.webp?t='));
  assert.equal(postsCall.options.cache, 'no-store');
  assert.equal(coverCall.options.cache, 'no-store');
  assert.equal([...timers.values()].some((timer) => timer.delay === 1500), true);
  [...timers.values()].find((timer) => timer.delay === 1500).callback();
  assert.equal(location.href, '/');
});

test('continue management cancels redirect, reloads production posts, and reselects the updated post', async () => {
  const oldPost = {
    id: 'post-1', type: 'daily', reportDate: '2026-08-11', date: '2026-08-11', registeredDate: '2026-08-11',
    registeredAt: '2026-08-11T00:00:00Z', title: '기존 제목', subtitle: '', description: '', href: 'reports/test.html'
  };
  const updated = { ...oldPost, title: '배포된 제목', updatedAt: '2026-08-11T12:00:00Z' };
  const { helpers, elements, allFetchCalls, timers, clearedTimers } = await loadClientHelpers({
    listPosts: [updated], deployResponses: [[updated]]
  });
  helpers.setPosts([oldPost]);
  helpers.selectPost(oldPost.id);
  const operation = { action: 'update', id: updated.id, post: updated, commit: 'abcdef0123456789' };
  await helpers.beginDeploymentCheck(operation, { maxAttempts: 1, intervalMs: 0 });
  const redirectId = [...timers.entries()].find(([, timer]) => timer.delay === 1500)[0];
  await helpers.continueManagement();
  assert.equal(elements['manage-result-overlay'].hidden, true);
  assert.equal(clearedTimers.includes(redirectId), true);
  assert.equal(elements['manage-title'].value, updated.title);
  assert.equal(allFetchCalls.filter((call) => call.url === '../../data/posts.json').length >= 2, true);
});

test('deployment timeout keeps the successful save state and offers non-error actions', async () => {
  const expected = { id: 'post-1', title: '새 제목', updatedAt: '2026-08-11T12:00:00Z' };
  const stale = { id: 'post-1', title: '이전 제목', updatedAt: '2026-08-11T11:00:00Z' };
  const { helpers, elements } = await loadClientHelpers({ listPosts: [stale], deployResponses: [[stale]] });
  const result = await helpers.beginDeploymentCheck(
    { action: 'update', id: expected.id, post: expected, commit: 'abcdef0123456789' },
    { maxAttempts: 1, intervalMs: 0 }
  );
  assert.equal(result, 'timeout');
  assert.equal(elements['manage-result-overlay'].classList.contains('delayed'), true);
  assert.equal(elements['manage-result-overlay'].classList.contains('done'), false);
  assert.equal(elements['manage-result-title'].textContent, '저장은 완료됐지만 홈페이지 반영 확인이 지연되고 있습니다.');
  assert.equal(elements['manage-result-home'].textContent, '홈페이지 확인');
  assert.equal(elements['manage-result-continue'].textContent, '관리 계속하기');
});

test('delete success waits until the post disappears from production data', async () => {
  const post = {
    id: 'post-1', type: 'daily', reportDate: '2026-08-11', date: '2026-08-11', registeredDate: '2026-08-11',
    registeredAt: '2026-08-11T00:00:00Z', title: '삭제 제목', subtitle: '', description: '', href: 'reports/test.html'
  };
  const { helpers, elements, fetchCalls } = await loadClientHelpers({
    listPosts: [post], deployResponses: [[]], manageResponse: { ok: true, action: 'delete', post: null, commit: 'fedcba9876543210' }
  });
  helpers.setPosts([post]);
  helpers.selectPost(post.id);
  elements['manage-admin-key'].value = 'test-key';
  elements['delete-title-confirm'].value = post.title;
  await helpers.deletePost();
  await flushPromises();
  assert.equal(fetchCalls.length, 1);
  assert.equal(elements['manage-result-overlay'].hidden, false);
  assert.equal(elements['manage-result-overlay'].classList.contains('done'), true);
  assert.equal(elements['manage-result-title'].textContent, '삭제가 홈페이지에 반영되었습니다.');
  assert.equal(elements['manage-result-text'].textContent, '잠시 후 홈페이지로 이동합니다.');
});

test('Preview still blocks mutations before the management API is called', async () => {
  const post = {
    id: 'post-1', type: 'daily', reportDate: '2026-08-11', date: '2026-08-11', registeredDate: '2026-08-11',
    registeredAt: '2026-08-11T00:00:00Z', title: '테스트 제목', subtitle: '', description: '', href: 'reports/test.html'
  };
  const { helpers, elements, fetchCalls } = await loadClientHelpers({ hostname: 'branch.market-research-site.pages.dev', listPosts: [post] });
  helpers.setPosts([post]);
  helpers.selectPost(post.id);
  elements['manage-admin-key'].value = 'test-key';
  await helpers.save({ preventDefault() {} });
  assert.equal(fetchCalls.length, 0);
  assert.match(elements['manage-status'].textContent, /Preview에서는 실제 저장·삭제를 실행할 수 없습니다/);
  assert.equal(elements['manage-result-overlay'].hidden, true);
});

test('repository posts metadata is synchronized and follows stable schema invariants', async () => {
  const [jsonText, jsText] = await Promise.all([read('data/posts.json'), read('data/posts.js')]);
  const posts = JSON.parse(jsonText);
  assert.equal(jsText.replace(/\r\n/g, '\n'), `window.RESEARCH_POSTS = ${JSON.stringify(posts, null, 2)};\n`);
  assert.ok(Array.isArray(posts));
  const allowedTypes = new Set(['daily', 'weekly', 'research', 'basics', 'note']);
  const ids = new Set();
  for (const post of posts) {
    assert.equal(typeof post.id, 'string');
    assert.ok(post.id.length > 0);
    assert.equal(ids.has(post.id), false);
    ids.add(post.id);
    assert.ok(allowedTypes.has(post.type));
    assert.equal(typeof post.title, 'string');
    assert.ok(post.title.trim().length > 0);
    assert.equal(typeof post.href, 'string');
    assert.match(post.href, /^reports\/.+\.html?$/i);
    assert.ok(!post.href.includes('..') && !post.href.includes('\\'));
    assert.match(post.reportDate, /^\d{4}-\d{2}-\d{2}$/);
    if (Object.hasOwn(post, 'coverImage')) {
      assert.equal(typeof post.coverImage, 'string');
      assert.match(post.coverImage, /^covers\/[^/\\]+\.(?:jpe?g|png|webp)$/i);
      assert.ok(!post.coverImage.includes('..'));
    }
  }
});

test('responsive management CSS retains homepage crop behavior and visible focus states', async () => {
  const css = await read('assets/admin-manage.css');
  assert.match(css, /object-fit:cover;object-position:center top/);
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.match(css, /--preview-ratio:485 \/ 481/);
  assert.match(css, /--preview-ratio:382 \/ 311/);
  assert.match(css, /--preview-ratio:312 \/ 231/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /:focus-visible/);
});
