import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function element(id = '') {
  return {
    id,
    value: '',
    hidden: false,
    disabled: false,
    textContent: '',
    innerHTML: '',
    files: [],
    dataset: {},
    checked: id === 'cover-keep',
    classList: { add() {}, remove() {} },
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    querySelector() { return element(); },
    focus() {}
  };
}

async function loadClientHelpers() {
  const source = await read('assets/admin-manage.js');
  const ids = [
    'post-list', 'post-count', 'manage-search', 'editor-empty', 'editor-form', 'manage-status',
    'manage-admin-key', 'replacement-html', 'html-status', 'html-preview', 'html-preview-frame',
    'replacement-cover', 'cover-file-field', 'cover-status', 'manage-cover-image',
    'manage-cover-fallback', 'cover-meta', 'cover-name', 'cover-dimensions', 'cover-size',
    'current-cover-label', 'start-delete', 'delete-confirmation', 'delete-expected-title',
    'delete-title-confirm', 'confirm-delete', 'manage-cover-preview', 'save-post'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  const themeButton = element('theme');
  const themeMeta = element('theme-meta');
  const coverKeep = element('cover-keep');
  coverKeep.value = 'keep';
  coverKeep.checked = true;
  const context = {
    console,
    confirm: () => false,
    fetch: () => new Promise(() => {}),
    FormData,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    location: { hostname: 'localhost' },
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
  return context.window.__adminManageTest;
}

test('manage page includes navigation, list controls, immutable metadata, edit fields, previews, and two-step delete UI', async () => {
  const html = await read('admin/manage/index.html');
  assert.match(html, /href="\.\.\/"[^>]*>새 리포트 등록/);
  assert.match(html, /href="\.\/" aria-current="page">게시물 관리/);
  assert.match(html, /id="manage-search"[^>]*type="search"/);
  for (const type of ['all', 'daily', 'weekly', 'research', 'basics', 'note']) assert.match(html, new RegExp(`data-filter="${type}"`));
  for (const id of ['manage-id', 'manage-href', 'manage-registered-date', 'manage-registered-at']) assert.match(html, new RegExp(`id="${id}"[^>]*readonly`));
  for (const id of ['manage-type', 'manage-date', 'manage-title', 'manage-subtitle', 'manage-description']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /id="replacement-html"[^>]*accept="\.html,text\/html"/);
  assert.match(html, /name="cover-action" value="keep" checked/);
  assert.match(html, /name="cover-action" value="replace"/);
  assert.match(html, /name="cover-action" value="remove"/);
  assert.equal((html.match(/<button[^>]+data-preview-mode="(?:1280|430|360)"/g) || []).length, 3);
  assert.match(html, /id="start-delete"/);
  assert.match(html, /id="delete-title-confirm"/);
  assert.match(html, /id="confirm-delete"[^>]*disabled/);
});

test('client list sorting, title/href search, category filters, file validation, and Preview safety are deterministic', async () => {
  const helpers = await loadClientHelpers();
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
  assert.match(source, /deleteTitleConfirm\.value !== selectedPost\.title/);
  assert.match(source, /Preview에서는 실제 저장·삭제를 실행할 수 없습니다/);
});

test('repository posts metadata is synchronized and the current production post remains unchanged', async () => {
  const [jsonText, jsText] = await Promise.all([read('data/posts.json'), read('data/posts.js')]);
  const posts = JSON.parse(jsonText);
  assert.equal(jsText.replace(/\r\n/g, '\n'), `window.RESEARCH_POSTS = ${JSON.stringify(posts, null, 2)};\n`);
  const current = posts.find((post) => post.id === '2026-08-11-daily-12vx8a7');
  assert.deepEqual(current, {
    id: '2026-08-11-daily-12vx8a7', type: 'daily', typeLabel: '주식 리포트', date: '2026-08-11', reportDate: '2026-08-11', registeredDate: '2026-08-11', registeredAt: '2026-08-11T10:06:02.296Z', legacyImport: false, title: '한 척이끌고 간 바다', subtitle: '', description: '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트.', href: 'reports/8월 11일 주식리포트_커버통합.html'
  });
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
