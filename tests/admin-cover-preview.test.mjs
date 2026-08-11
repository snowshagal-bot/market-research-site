import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function createElement(id = '') {
  const listeners = new Map();
  const attributes = new Map();
  return {
    id,
    value: '',
    files: [],
    checked: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, ...event }); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    removeAttribute(name) { if (name === 'src') this.src = ''; attributes.delete(name); },
    querySelector() { return null; },
    appendChild() {},
    focus() {},
    click() {}
  };
}

async function loadAdmin({ confirmResult = false } = {}) {
  const source = await read('assets/admin.js');
  const ids = [
    'html-file', 'drop-zone', 'file-info', 'parse-status', 'preview-wrap', 'post-type',
    'post-date', 'registered-date', 'post-title', 'post-subtitle', 'post-description',
    'post-filename', 'cover-file', 'cover-info', 'cover-preview-canvas',
    'cover-preview-image', 'cover-preview-empty', 'cover-preview-meta',
    'cover-preview-name', 'cover-preview-dimensions', 'cover-preview-size',
    'cover-preview-caption', 'cover-preview-note', 'admin-key', 'publish-btn', 'publish-overlay',
    'publish-state-title', 'publish-state-text', 'publish-state-detail', 'publish-links',
    'published-report-link', 'published-home-link', 'category-status'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement(id)]));
  const themeButton = createElement('theme-toggle');
  const themeMeta = createElement('theme-color');
  const modeButtons = ['1280', '430', '360'].map(mode => {
    const button = createElement(`mode-${mode}`);
    button.dataset.coverPreviewMode = mode;
    button.setAttribute('aria-pressed', String(mode === '1280'));
    return button;
  });
  const categoryOptions = ['daily', 'weekly', 'research', 'basics', 'note'].map(value => {
    const option = createElement(`category-${value}`);
    option.value = value;
    return option;
  });
  const windowListeners = new Map();
  const createdUrls = [];
  const revokedUrls = [];
  const submissions = [];
  const confirmMessages = [];
  class TestFormData {
    entries = [];
    append(...args) { this.entries.push(args); }
  }
  const context = {
    console,
    confirm: message => { confirmMessages.push(message); return confirmResult; },
    fetch: async (url, options = {}) => {
      if (url === '/api/publish') {
        submissions.push(options.body);
        return { ok: false, status: 500, json: async () => ({ message: 'test stop' }) };
      }
      return { ok: true, json: async () => [] };
    },
    FormData: TestFormData,
    setTimeout() {},
    location: { href: '' },
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    DOMParser: class {
      parseFromString(text) {
        const title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || '';
        return {
          title,
          querySelector(selector) {
            const metaName = selector.match(/^meta\[name="([^"]+)"\]$/)?.[1];
            if (!metaName) return null;
            const tag = text.match(new RegExp(`<meta\\s+[^>]*name=["']${metaName}["'][^>]*>`, 'i'))?.[0];
            const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
            return content === undefined ? null : { content };
          }
        };
      }
    },
    URL: {
      createObjectURL(file) {
        const url = `blob:test-${createdUrls.length + 1}-${file.name}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL(url) { revokedUrls.push(url); }
    },
    document: {
      documentElement: { dataset: {} },
      getElementById: id => elements[id],
      querySelector: selector => selector === '[data-theme-toggle]' ? themeButton : selector === 'meta[name="theme-color"]' ? themeMeta : null,
      querySelectorAll: selector => selector === '[data-cover-preview-mode]'
        ? modeButtons
        : selector === 'input[name="post-category"]' ? categoryOptions : [],
      createElement: tag => createElement(tag)
    },
    window: {
      addEventListener(type, handler) { windowListeners.set(type, handler); }
    }
  };
  vm.runInNewContext(source, context);
  return { elements, modeButtons, categoryOptions, createdUrls, revokedUrls, windowListeners, submissions, confirmMessages };
}

const validCover = (name = 'cover.webp') => ({ name, type: 'image/webp', size: 320 * 1024 });

test('admin markup contains the cover preview modes before the original HTML preview', async () => {
  const [html, adminScript] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /3\. 홈페이지 커버 미리보기/);
  assert.match(html, /4\. 원본 HTML 미리보기/);
  assert.ok(html.indexOf('3. 홈페이지 커버 미리보기') < html.indexOf('4. 원본 HTML 미리보기'));
  assert.equal((html.match(/data-cover-preview-mode="(?:1280|430|360)"/g) || []).length, 3);
  assert.match(html, /data-cover-preview-mode="1280" aria-pressed="true"/);
  assert.match(html, /대표 커버를 선택하면 홈페이지에서 보이는 영역을 확인할 수 있습니다/);
  assert.match(html, /\.cover-preview-empty\[hidden\],[^}]*\{display:none\}/);
  assert.match(adminScript, /iframe\.setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(adminScript, /iframe\.srcdoc = text/);
  assert.doesNotMatch(adminScript, /allow-same-origin/);
});

test('admin exposes five always-visible accessible category radio chips', async () => {
  const html = await read('admin/index.html');
  assert.match(html, /class="category-options" role="radiogroup"/);
  assert.equal((html.match(/name="post-category" value="(?:daily|weekly|research|basics|note)"/g) || []).length, 5);
  for (const label of ['데일리', '위클리', '비정기', '시장 공부', '끄적끄적']) assert.match(html, new RegExp(`<span>${label}</span>`));
  assert.doesNotMatch(html, /<select id="post-type"/);
  assert.match(html, /\.category-chip input:focus-visible\+span/);
});

test('category auto-detection covers Korean and English inputs and leaves unknown reports unselected', async () => {
  const cases = [
    ['weekly-report.html', '<title>Market Research</title><body>MARKET RESEARCH</body>', 'weekly'],
    ['데일리.html', '<title>Daily</title><body>This research reviews market flows.</body>', 'daily'],
    ['generic.html', '<title>Market Research</title>', ''],
    ['generic.html', '<title>Generic report</title><body>This research reviews market flows.</body>', ''],
    ['비정기.html', '<title>Special report</title>', 'research'],
    ['시장 공부.html', '<title>Market Basics</title>', 'basics'],
    ['notes.html', '<title>Notes</title>', 'note'],
    ['데일리.html', '<meta name="report-type" content="weekly"><title>Daily</title>', 'weekly'],
    ['generic.html', '<meta name="report-type" content="research"><title>Market Research</title>', 'research'],
    ['generic.html', '<meta name="report-type" content="invalid"><title>Market Research</title>', '']
  ];
  for (const [name, markup, expected] of cases) {
    const { elements, categoryOptions } = await loadAdmin();
    elements['html-file'].files = [{ name, size: 100, text: async () => `<!doctype html>${markup}` }];
    await elements['html-file'].emit('change');
    assert.equal(elements['post-type'].value, expected, name);
    assert.equal(categoryOptions.find(option => option.checked)?.value || '', expected, name);
    if (expected) assert.match(elements['category-status'].textContent, new RegExp(`자동 인식: .+직접 변경`));
    else assert.match(elements['category-status'].textContent, /자동으로 판단하지 못했습니다/);
  }
});

test('manual category override becomes the final publish FormData value', async () => {
  const { elements, categoryOptions, submissions } = await loadAdmin({ confirmResult: true });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: '데일리.html',
    size: 100,
    text: async () => '<!doctype html><title>Daily report</title>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['post-type'].value, 'daily');

  const weekly = categoryOptions.find(option => option.value === 'weekly');
  categoryOptions.find(option => option.value === 'daily').emit('keydown', { key: 'ArrowRight' });
  assert.equal(elements['post-type'].value, 'weekly');
  assert.equal(weekly.checked, true);
  assert.equal(elements['category-status'].textContent, '직접 선택: 위클리');
  assert.equal(elements['publish-btn'].disabled, false);

  await elements['publish-btn'].emit('click');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].entries.find(([name]) => name === 'type')?.[1], 'weekly');
});

test('publish remains disabled when category detection has no result', async () => {
  const { elements, categoryOptions } = await loadAdmin();
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: 'generic.html',
    size: 100,
    text: async () => '<!doctype html><title>Unclassified report</title>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['post-type'].value, '');
  assert.equal(categoryOptions.some(option => option.checked), false);
  assert.equal(elements['publish-btn'].disabled, true);
});

test('valid cover selection renders client-only metadata and actual image dimensions', async () => {
  const { elements, createdUrls } = await loadAdmin();
  elements['cover-file'].files = [validCover('portrait.webp')];
  elements['cover-file'].emit('change');
  assert.equal(createdUrls.length, 1);
  assert.equal(elements['cover-preview-image'].src, createdUrls[0]);
  assert.equal(elements['cover-preview-image'].hidden, false);
  assert.equal(elements['cover-preview-name'].textContent, 'portrait.webp');
  assert.equal(elements['cover-preview-size'].textContent, '320.0 KB');
  elements['cover-preview-image'].naturalWidth = 900;
  elements['cover-preview-image'].naturalHeight = 1350;
  elements['cover-preview-image'].onload();
  assert.equal(elements['cover-preview-dimensions'].textContent, '900 × 1350px');
  assert.equal(elements['cover-preview-meta'].hidden, false);
  assert.equal(elements['cover-preview-note'].textContent, '선택한 커버가 홈페이지에 사용됩니다.');
  assert.doesNotMatch(elements['cover-preview-note'].textContent, /커버 미선택/);
});

test('image load failure removes the selected cover and returns to the fallback state', async () => {
  const { elements, createdUrls, revokedUrls } = await loadAdmin();
  elements['cover-file'].files = [validCover('broken.webp')];
  elements['cover-file'].emit('change');
  elements['cover-preview-image'].onerror();
  assert.equal(elements['cover-file'].value, '');
  assert.deepEqual(revokedUrls, createdUrls);
  assert.equal(elements['cover-preview-image'].hidden, true);
  assert.equal(elements['cover-preview-meta'].hidden, true);
  assert.match(elements['cover-info'].textContent, /이미지를 읽을 수 없습니다/);
  assert.match(elements['cover-preview-note'].textContent, /커버 미선택/);
});

test('image load failure omits the cover from the publish FormData', async () => {
  const { elements, submissions } = await loadAdmin({ confirmResult: true });
  elements['cover-file'].files = [validCover('broken.webp')];
  elements['cover-file'].emit('change');
  elements['cover-preview-image'].onerror();

  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: '데일리.html',
    size: 100,
    text: async () => '<!doctype html><title>Daily report</title>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['publish-btn'].disabled, false);
  await elements['publish-btn'].emit('click');

  assert.equal(submissions.length, 1);
  const fieldNames = submissions[0].entries.map(([name]) => name);
  assert.ok(fieldNames.includes('file'));
  assert.ok(!fieldNames.includes('cover'));
});

test('invalid MIME-extension pairs and covers over 4MB clear the preview', async () => {
  for (const file of [
    { name: 'cover.png', type: 'image/webp', size: 100 },
    { name: 'cover.webp', type: 'image/webp', size: 4 * 1024 * 1024 + 1 }
  ]) {
    const { elements, createdUrls } = await loadAdmin();
    elements['cover-file'].files = [file];
    elements['cover-file'].emit('change');
    assert.equal(createdUrls.length, 0);
    assert.equal(elements['cover-file'].value, '');
    assert.equal(elements['cover-preview-image'].hidden, true);
    assert.equal(elements['cover-preview-meta'].hidden, true);
  }
});

test('cover object URLs are revoked on replacement, reset, and page exit', async () => {
  const { elements, createdUrls, revokedUrls, windowListeners } = await loadAdmin();
  elements['cover-file'].files = [validCover('first.webp')];
  elements['cover-file'].emit('change');
  elements['cover-file'].files = [validCover('second.webp')];
  elements['cover-file'].emit('change');
  assert.deepEqual(revokedUrls, [createdUrls[0]]);
  elements['cover-file'].files = [];
  elements['cover-file'].emit('change');
  assert.deepEqual(revokedUrls, [createdUrls[0], createdUrls[1]]);
  elements['cover-file'].files = [validCover('third.webp')];
  elements['cover-file'].emit('change');
  windowListeners.get('pagehide')();
  assert.deepEqual(revokedUrls, createdUrls);
});

test('preview modes use buttons with aria-pressed and match homepage cover cropping', async () => {
  const [html, homepageStyles] = await Promise.all([read('admin/index.html'), read('assets/home-v2.css')]);
  const { elements, modeButtons } = await loadAdmin();
  modeButtons[1].emit('click');
  assert.equal(elements['cover-preview-canvas'].dataset.coverMode, '430');
  assert.equal(modeButtons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(modeButtons[0].getAttribute('aria-pressed'), 'false');
  assert.match(html, /\.cover-preview-canvas img\{[^}]*object-fit:cover;object-position:center top/);
  assert.match(homepageStyles, /\.carousel-cover>img\{object-position:center top\}/);
  assert.match(html, /--cover-preview-ratio:485 \/ 481/);
  assert.match(html, /--cover-preview-ratio:382 \/ 311/);
  assert.match(html, /--cover-preview-ratio:312 \/ 231/);
});

test('cover preview keeps the optional publish payload and server publisher unchanged in scope', async () => {
  const [adminScript, publishScript] = await Promise.all([
    read('assets/admin.js'),
    read('functions/api/publish.js')
  ]);
  assert.match(adminScript, /if \(selectedCover\) form\.append\('cover', selectedCover, selectedCover\.name\)/);
  assert.match(adminScript, /const ready = selectedFile && type\.value/);
  assert.doesNotMatch(publishScript, /cover-preview|createObjectURL|revokeObjectURL/);
});

test('publishing without a cover shows an explicit fallback-cover warning in the final confirmation', async () => {
  const { elements, confirmMessages } = await loadAdmin({ confirmResult: false });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: '데일리.html',
    size: 100,
    text: async () => '<!doctype html><html><head><title>Daily report</title></head><body></body></html>'
  }];
  await elements['html-file'].emit('change');
  await elements['publish-btn'].emit('click');
  assert.equal(confirmMessages.length, 1);
  assert.match(confirmMessages[0], /대표 커버가 선택되지 않았습니다/);
  assert.match(confirmMessages[0], /fallback cover/);
});
