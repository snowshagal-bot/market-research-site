import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function createElement(id = '') {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  return {
    id,
    value: '',
    files: [],
    checked: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, ...event }); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    removeAttribute(name) { if (name === 'src') this.src = ''; attributes.delete(name); },
    querySelector() { return null; },
    appendChild() {},
    focus() { this.focused = true; },
    click() {}
  };
}

async function loadAdmin({ confirmResult = false, generateCover, publishResponse } = {}) {
  const source = await read('assets/admin.js');
  const ids = [
    'html-file', 'drop-zone', 'file-info', 'parse-status', 'preview-wrap', 'post-type',
    'post-date', 'registered-date', 'post-title', 'post-subtitle', 'post-description', 'post-summary',
    'post-filename', 'cover-file', 'cover-info', 'cover-preview-canvas',
    'cover-preview-image', 'cover-preview-empty', 'cover-preview-meta',
    'cover-preview-name', 'cover-preview-dimensions', 'cover-preview-size',
    'cover-preview-caption', 'cover-preview-note', 'admin-key', 'publish-btn', 'publish-overlay',
    'publish-state-title', 'publish-state-text', 'publish-state-detail', 'publish-links',
    'publish-error-actions', 'publish-error-close',
    'published-report-link', 'published-home-link', 'category-status'
    , 'post-language', 'translation-source', 'translation-source-status', 'generate-cover-btn', 'cover-generator-status'
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
  const languageOptions = ['ko', 'en'].map(value => {
    const option = createElement(`language-${value}`);
    option.value = value;
    option.checked = value === 'ko';
    return option;
  });
  elements['post-language'].value = 'ko';
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
        return publishResponse || { ok: false, status: 500, json: async () => ({ message: 'test stop' }) };
      }
      return { ok: true, json: async () => [] };
    },
    FormData: TestFormData,
    setTimeout() {},
    location: { href: '', hostname: 'snowshagal.com' },
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
            if (metaName) {
              const tag = text.match(new RegExp(`<meta\\s+[^>]*name=["']${metaName}["'][^>]*>`, 'i'))?.[0];
              const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
              return content === undefined ? null : { content };
            }
            const className = selector.match(/\.([a-z0-9_-]+)(?:\s*$)/i)?.[1];
            if (!className) return null;
            const match = text.match(new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
            return match ? { textContent: match[2].replace(/<[^>]+>/g, ' ') } : null;
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
        : selector === 'input[name="post-category"]' ? categoryOptions
          : selector === 'input[name="post-language-choice"]' ? languageOptions : [],
      createElement: tag => createElement(tag)
    },
    window: {
      MARKET_COVER_GENERATOR: {
        generate: generateCover || (async () => ({ file: validCover('generated-cover.webp'), method: 'template', selector: '' }))
      },
      RESEARCH_POSTS: [
        { id: 'ko-source', title: '한국어 원문', reportDate: '2026-08-10', href: 'reports/source.html' },
        { id: 'en-source', lang: 'en', title: 'English source', reportDate: '2026-08-10', href: 'reports/en/source.html' }
      ],
      addEventListener(type, handler) { windowListeners.set(type, handler); }
    }
  };
  vm.runInNewContext(source, context);
  return { elements, modeButtons, categoryOptions, languageOptions, createdUrls, revokedUrls, windowListeners, submissions, confirmMessages };
}

const validCover = (name = 'cover.webp') => ({ name, type: 'image/webp', size: 320 * 1024 });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function makePublishReady(elements) {
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: '데일리.html',
    size: 100,
    text: async () => '<!doctype html><html><head><meta name="report-date" content="2026-08-10"><title>Daily report</title></head><body></body></html>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['publish-btn'].disabled, false);
}

const reportFile = name => ({
  name,
  size: 100,
  text: async () => `<!doctype html><html><head><meta name="report-date" content="2026-08-10"><title>${name}</title></head><body></body></html>`
});

test('admin markup contains the cover preview modes before the original HTML preview', async () => {
  const [html, adminScript] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.equal((html.match(/class="admin-grid"/g) || []).length, 1);
  assert.equal((html.match(/id="html-file"/g) || []).length, 1);
  assert.equal((html.match(/id="drop-zone"/g) || []).length, 1);
  assert.match(html, /3\. 홈페이지 커버 미리보기/);
  assert.match(html, /4\. 원본 HTML 미리보기/);
  assert.ok(html.indexOf('3. 홈페이지 커버 미리보기') < html.indexOf('4. 원본 HTML 미리보기'));
  assert.equal((html.match(/data-cover-preview-mode="(?:1280|430|360)"/g) || []).length, 3);
  assert.match(html, /data-cover-preview-mode="1280" aria-pressed="true"/);
  assert.match(html, /대표 커버를 선택하면 홈페이지에서 보이는 영역을 확인할 수 있습니다/);
  assert.match(html, /\.cover-preview-empty\[hidden\],[^}]*\{display:none\}/);
  assert.match(adminScript, /iframe\.setAttribute\('sandbox', 'allow-scripts'\)/);
  assert.match(adminScript, /iframe\.srcdoc = text/);
  assert.match(html, /admin\.js\?v=20260827-1/);
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

test('English natural-language report dates are detected and an unknown date stays blank', async () => {
  for (const [titleText, expected] of [
    ['KOSPI Daily Report · August 4, 2026 · Sung Oh', '2026-08-04'],
    ['KOSPI Daily Report · 5 Aug 2026 · Sung Oh', '2026-08-05']
  ]) {
    const { elements } = await loadAdmin();
    elements['admin-key'].value = 'test-key';
    elements['html-file'].files = [{
      name: 'daily-report.html',
      size: 100,
      text: async () => `<!doctype html><title>${titleText}</title>`
    }];
    await elements['html-file'].emit('change');
    assert.equal(elements['post-date'].value, expected);
    assert.equal(elements['publish-btn'].disabled, false);
  }

  const { elements } = await loadAdmin();
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: 'daily-report.html',
    size: 100,
    text: async () => '<!doctype html><title>Daily report without a date</title>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['post-date'].value, '');
  assert.equal(elements['publish-btn'].disabled, true);
  assert.match(elements['parse-status'].textContent, /기준일을 자동으로 찾지 못했습니다/);
});

test('manual category override becomes the final publish FormData value', async () => {
  const { elements, categoryOptions, submissions } = await loadAdmin({ confirmResult: true });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: '데일리.html',
    size: 100,
    text: async () => '<!doctype html><meta name="report-date" content="2026-08-10"><title>Daily report</title>'
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

test('report-summary metadata takes priority and cover copy supplies a language-neutral editable fallback', async () => {
  const { elements, submissions } = await loadAdmin({ confirmResult: true });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: 'weekly-report.html',
    size: 100,
    text: async () => '<!doctype html><meta name="report-date" content="2026-08-10"><meta name="report-summary" content="자동 인식한 홈페이지 요약"><title>Weekly report</title>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['post-summary'].value, '자동 인식한 홈페이지 요약');
  elements['post-summary'].value = '사용자가 수정한 최종 요약';
  await elements['publish-btn'].emit('click');
  assert.equal(submissions[0].entries.find(([name]) => name === 'summary')?.[1], '사용자가 수정한 최종 요약');

  const english = await loadAdmin();
  const englishChoice = english.languageOptions.find(option => option.value === 'en');
  englishChoice.checked = true;
  englishChoice.emit('change');
  english.elements['html-file'].files = [{
    name: 'daily-report.html',
    size: 100,
    text: async () => '<!doctype html><title>Daily report</title><span class="cover-oneline">Two heavyweight stocks dragged the index,<br>while the rest of the market went its own way.</span>'
  }];
  await english.elements['html-file'].emit('change');
  assert.equal(english.elements['post-summary'].value, 'Two heavyweight stocks dragged the index, while the rest of the market went its own way.');
  assert.equal(english.elements['post-description'].value, 'A daily report on market trends, investor flows, sectors, and macro drivers.');

  const korean = await loadAdmin();
  korean.elements['html-file'].files = [{
    name: '비정기 리서치.html',
    size: 100,
    text: async () => '<!doctype html><title>비정기 리서치</title><section class="opener"><p class="stand">보이는 수급 아래, <b>잠긴 구조를 읽는다.</b></p></section>'
  }];
  await korean.elements['html-file'].emit('change');
  assert.equal(korean.elements['post-summary'].value, '보이는 수급 아래, 잠긴 구조를 읽는다.');
  assert.equal(korean.elements['post-description'].value, '특정 산업·기업·정책 이슈를 별도로 분석한 비정기 리서치.');
});

test('language defaults to Korean and English selection submits an optional translation group', async () => {
  const { elements, languageOptions, submissions } = await loadAdmin({ confirmResult: true });
  assert.equal(elements['post-language'].value, 'ko');
  assert.equal(languageOptions.find(option => option.checked)?.value, 'ko');

  const english = languageOptions.find(option => option.value === 'en');
  english.checked = true;
  english.emit('change');
  assert.equal(elements['post-language'].value, 'en');
  elements['translation-source'].value = 'ko-source';
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: 'weekly-report.html',
    size: 100,
    text: async () => '<!doctype html><title>Weekly report</title>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['post-date'].value, '2026-08-10');
  assert.match(elements['translation-source-status'].textContent, /2026-08-10.*자동 적용/);
  await elements['publish-btn'].emit('click');

  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].entries.find(([name]) => name === 'lang')?.[1], 'en');
  assert.equal(submissions[0].entries.find(([name]) => name === 'translationGroup')?.[1], 'ko-source');
});

test('translation pairing blocks a manually changed date that differs from its counterpart', async () => {
  const { elements, languageOptions, submissions, confirmMessages } = await loadAdmin({ confirmResult: true });
  const english = languageOptions.find(option => option.value === 'en');
  english.checked = true;
  english.emit('change');
  elements['translation-source'].value = 'ko-source';
  elements['translation-source'].emit('change');
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: 'daily-report.html',
    size: 100,
    text: async () => '<!doctype html><title>August 10, 2026 Daily report</title>'
  }];
  await elements['html-file'].emit('change');
  elements['post-date'].value = '2026-08-24';
  await elements['publish-btn'].emit('click');

  assert.equal(submissions.length, 0);
  assert.equal(confirmMessages.length, 0);
  assert.match(elements['parse-status'].textContent, /번역 짝과 같은 2026-08-10/);
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
    text: async () => '<!doctype html><meta name="report-date" content="2026-08-10"><title>Daily report</title>'
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

test('preview modes use buttons with aria-pressed and show the complete homepage cover', async () => {
  const [html, homepageStyles] = await Promise.all([read('admin/index.html'), read('assets/home-v2.css')]);
  const { elements, modeButtons } = await loadAdmin();
  modeButtons[1].emit('click');
  assert.equal(elements['cover-preview-canvas'].dataset.coverMode, '430');
  assert.equal(modeButtons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(modeButtons[0].getAttribute('aria-pressed'), 'false');
  assert.match(html, /\.cover-preview-canvas img\{[^}]*object-fit:contain;object-position:center center/);
  assert.match(homepageStyles, /\.latest-card-cover img\s*\{[\s\S]*?object-position: center center/);
  assert.match(html, /--cover-preview-ratio:485 \/ 481/);
  assert.match(html, /--cover-preview-ratio:382 \/ 311/);
  assert.match(html, /--cover-preview-ratio:312 \/ 231/);
});

test('cover preview keeps the optional publish payload and server publisher unchanged in scope', async () => {
  const [adminScript, publishScript] = await Promise.all([
    read('assets/admin.js'),
    read('functions/api/publish.js')
  ]);
  assert.match(adminScript, /form\.append\('cover', selectedCover, selectedCover\.name\)/);
  assert.match(adminScript, /const ready = selectedFile && type\.value/);
  assert.doesNotMatch(publishScript, /cover-preview|createObjectURL|revokeObjectURL/);
});

test('publishing without a cover shows an explicit fallback-cover warning in the final confirmation', async () => {
  const { elements, confirmMessages } = await loadAdmin({ confirmResult: false });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: '데일리.html',
    size: 100,
    text: async () => '<!doctype html><html><head><meta name="report-date" content="2026-08-10"><title>Daily report</title></head><body></body></html>'
  }];
  await elements['html-file'].emit('change');
  await elements['publish-btn'].emit('click');
  assert.equal(confirmMessages.length, 1);
  assert.match(confirmMessages[0], /대표 커버가 선택되지 않았습니다/);
  assert.match(confirmMessages[0], /fallback cover/);
});

test('invalid administrator authentication keeps a clear publish failure visible and returns focus to the key', async () => {
  const { elements, submissions } = await loadAdmin({
    confirmResult: true,
    publishResponse: {
      ok: false,
      status: 401,
      json: async () => ({ error: 'UNAUTHORIZED', message: '관리자 키가 올바르지 않습니다.' })
    }
  });
  await makePublishReady(elements);
  await elements['publish-btn'].emit('click');

  assert.equal(submissions.length, 1);
  assert.equal(elements['publish-overlay'].classList.contains('on'), true);
  assert.equal(elements['publish-overlay'].classList.contains('error'), true);
  assert.equal(elements['publish-overlay'].getAttribute('role'), 'alertdialog');
  assert.equal(elements['publish-overlay'].getAttribute('aria-live'), 'assertive');
  assert.equal(elements['publish-state-title'].textContent, '게시되지 않았습니다.');
  assert.match(elements['publish-state-text'].textContent, /관리자 키가 올바르지 않아 게시하지 못했습니다/);
  assert.equal(elements['publish-error-actions'].hidden, false);
  assert.equal(elements['admin-key'].getAttribute('aria-invalid'), 'true');
  assert.match(elements['parse-status'].textContent, /게시되지 않음/);

  elements['publish-error-close'].emit('click');
  assert.equal(elements['publish-overlay'].classList.contains('on'), false);
  assert.equal(elements['admin-key'].focused, true);

  elements['admin-key'].value = 'corrected-key';
  elements['admin-key'].emit('input');
  assert.equal(elements['admin-key'].getAttribute('aria-invalid'), undefined);
  assert.equal(elements['parse-status'].classList.contains('error'), false);
  assert.match(elements['parse-status'].textContent, /다시 게시해 주세요/);
});

test('an automatically generated cover suppresses the missing-cover warning', async () => {
  const { elements, confirmMessages } = await loadAdmin({ confirmResult: false });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [{
    name: '데일리.html',
    size: 100,
    text: async () => '<!doctype html><html><head><meta name="report-date" content="2026-08-10"><title>Daily report</title></head><body></body></html>'
  }];
  await elements['html-file'].emit('change');
  assert.equal(elements['generate-cover-btn'].disabled, false);
  await elements['generate-cover-btn'].emit('click');
  elements['cover-preview-image'].naturalWidth = 900;
  elements['cover-preview-image'].naturalHeight = 1350;
  elements['cover-preview-image'].onload();
  await elements['publish-btn'].emit('click');
  assert.equal(confirmMessages.length, 1);
  assert.doesNotMatch(confirmMessages[0], /대표 커버가 선택되지 않았습니다|fallback cover/);
});

test('automatic cover generation passes the current admin key to the generator', async () => {
  let generationInput;
  const { elements } = await loadAdmin({
    generateCover: async input => {
      generationInput = input;
      return { file: validCover('authenticated.webp'), method: 'browser-rendering', selector: '.cover-frame' };
    }
  });
  await makePublishReady(elements);
  await elements['generate-cover-btn'].emit('click');
  assert.equal(generationInput.adminKey, 'test-key');
});

test('A-C: automatic generation and generated-image decode both block publishing until onload', async () => {
  const generation = deferred();
  const generatedFile = validCover('generated-race.webp');
  const { elements, submissions, confirmMessages } = await loadAdmin({
    confirmResult: true,
    generateCover: () => generation.promise
  });
  await makePublishReady(elements);

  const generateTask = elements['generate-cover-btn'].emit('click');
  assert.equal(elements['publish-btn'].disabled, true, 'A: generator promise is pending');

  generation.resolve({ file: generatedFile, method: 'template', selector: '' });
  await generateTask;
  assert.equal(elements['publish-btn'].disabled, true, 'B: generated preview decode is pending');

  elements['cover-preview-image'].naturalWidth = 900;
  elements['cover-preview-image'].naturalHeight = 1350;
  elements['cover-preview-image'].onload();
  assert.equal(elements['publish-btn'].disabled, false, 'C: current generated image decoded');
  await elements['publish-btn'].emit('click');

  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].entries.find(([name]) => name === 'cover')?.[1], generatedFile);
  assert.doesNotMatch(confirmMessages[0], /대표 커버가 선택되지 않았습니다|fallback cover/);
});

test('D: generated image decode failure restores coverless publishing and fallback warning', async () => {
  const { elements, submissions, confirmMessages } = await loadAdmin({ confirmResult: true });
  await makePublishReady(elements);
  await elements['generate-cover-btn'].emit('click');
  assert.equal(elements['publish-btn'].disabled, true);

  elements['cover-preview-image'].onerror();
  assert.equal(elements['publish-btn'].disabled, false);
  await elements['publish-btn'].emit('click');

  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].entries.some(([name]) => name === 'cover'), false);
  assert.match(confirmMessages[0], /대표 커버가 선택되지 않았습니다/);
  assert.match(confirmMessages[0], /fallback cover/);
});

test('E: manual cover selection blocks publishing until the image onload succeeds', async () => {
  const { elements } = await loadAdmin();
  await makePublishReady(elements);

  elements['cover-file'].files = [validCover('manual-race.webp')];
  elements['cover-file'].emit('change');
  assert.equal(elements['publish-btn'].disabled, true);

  elements['cover-preview-image'].onload();
  assert.equal(elements['publish-btn'].disabled, false);
});

test('F: a stale cover onload cannot replace the newer cover selection', async () => {
  const { elements, submissions } = await loadAdmin({ confirmResult: true });
  const coverA = validCover('cover-a.webp');
  const coverB = validCover('cover-b.webp');
  await makePublishReady(elements);

  elements['cover-file'].files = [coverA];
  elements['cover-file'].emit('change');
  const staleOnload = elements['cover-preview-image'].onload;
  elements['cover-file'].files = [coverB];
  elements['cover-file'].emit('change');
  const currentOnload = elements['cover-preview-image'].onload;

  staleOnload();
  assert.equal(elements['publish-btn'].disabled, true);
  assert.equal(submissions.length, 0);

  currentOnload();
  assert.equal(elements['publish-btn'].disabled, false);
  await elements['publish-btn'].emit('click');
  assert.equal(submissions[0].entries.find(([name]) => name === 'cover')?.[1], coverB);
});

test('automatic generation failure restores coverless publishing', async () => {
  const { elements, confirmMessages } = await loadAdmin({
    confirmResult: false,
    generateCover: async () => { throw new Error('test generation failure'); }
  });
  await makePublishReady(elements);

  await elements['generate-cover-btn'].emit('click');
  assert.equal(elements['publish-btn'].disabled, false);
  await elements['publish-btn'].emit('click');
  assert.match(confirmMessages[0], /fallback cover/);
});

test('automatic generation shows the exact safe server error instead of silently using a template', async () => {
  const failure = Object.assign(new Error('관리자 키가 올바르지 않습니다.'), {
    code: 'UNAUTHORIZED',
    status: 401
  });
  const { elements } = await loadAdmin({
    generateCover: async () => { throw failure; }
  });
  await makePublishReady(elements);

  await elements['generate-cover-btn'].emit('click');
  assert.match(elements['cover-generator-status'].textContent, /관리자 키가 올바르지 않습니다/);
  assert.match(elements['cover-generator-status'].textContent, /UNAUTHORIZED · HTTP 401/);
  assert.doesNotMatch(elements['cover-generator-status'].textContent, /표준 템플릿 커버를 생성했습니다/);
  assert.equal(elements['cover-preview-image'].hidden, true);
});

test('G: a cover generated for report A is discarded after report B is selected', async () => {
  const generationA = deferred();
  const { elements, createdUrls } = await loadAdmin({ generateCover: () => generationA.promise });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [reportFile('A-데일리.html')];
  await elements['html-file'].emit('change');
  const generationTaskA = elements['generate-cover-btn'].emit('click');
  assert.equal(elements['publish-btn'].disabled, true);

  elements['html-file'].files = [reportFile('B-데일리.html')];
  await elements['html-file'].emit('change');
  assert.equal(elements['publish-btn'].disabled, false);
  generationA.resolve({ file: validCover('a-generated.webp'), method: 'template', selector: '' });
  await generationTaskA;

  assert.equal(createdUrls.length, 0);
  assert.equal(elements['cover-preview-image'].hidden, true);
  assert.match(elements['cover-preview-note'].textContent, /커버 미선택/);
  assert.match(elements['cover-generator-status'].textContent, /업로드한 리포트 HTML의 첫 화면/);
});

test('H: report A decode completion cannot attach its cover after report B is selected', async () => {
  const { elements, createdUrls, revokedUrls } = await loadAdmin();
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [reportFile('A-데일리.html')];
  await elements['html-file'].emit('change');
  await elements['generate-cover-btn'].emit('click');
  const staleOnload = elements['cover-preview-image'].onload;
  assert.equal(elements['publish-btn'].disabled, true);

  elements['html-file'].files = [reportFile('B-데일리.html')];
  await elements['html-file'].emit('change');
  staleOnload();

  assert.deepEqual(revokedUrls, createdUrls);
  assert.equal(elements['cover-preview-image'].hidden, true);
  assert.match(elements['cover-preview-note'].textContent, /커버 미선택/);
  assert.equal(elements['publish-btn'].disabled, false);
});

test('I: selecting report B clears report A manual cover and restores cover-missing state', async () => {
  const { elements, confirmMessages } = await loadAdmin({ confirmResult: false });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [reportFile('A-데일리.html')];
  await elements['html-file'].emit('change');
  elements['cover-file'].files = [validCover('a-manual.webp')];
  elements['cover-file'].emit('change');
  elements['cover-preview-image'].onload();
  assert.doesNotMatch(elements['cover-preview-note'].textContent, /커버 미선택/);

  elements['html-file'].files = [reportFile('B-데일리.html')];
  await elements['html-file'].emit('change');
  assert.equal(elements['cover-file'].value, '');
  assert.equal(elements['cover-preview-image'].hidden, true);
  assert.match(elements['cover-preview-note'].textContent, /커버 미선택/);
  await elements['publish-btn'].emit('click');
  assert.match(confirmMessages[0], /fallback cover/);
});

test('J: report B publishes only the newly generated and decoded B cover', async () => {
  let generationCount = 0;
  const coverA = validCover('a-generated.webp');
  const coverB = validCover('b-generated.webp');
  const { elements, submissions, confirmMessages } = await loadAdmin({
    confirmResult: true,
    generateCover: async () => ({ file: ++generationCount === 1 ? coverA : coverB, method: 'template', selector: '' })
  });
  elements['admin-key'].value = 'test-key';
  elements['html-file'].files = [reportFile('A-데일리.html')];
  await elements['html-file'].emit('change');
  await elements['generate-cover-btn'].emit('click');
  elements['cover-preview-image'].onload();

  elements['html-file'].files = [reportFile('B-데일리.html')];
  await elements['html-file'].emit('change');
  await elements['generate-cover-btn'].emit('click');
  assert.equal(elements['publish-btn'].disabled, true);
  elements['cover-preview-image'].onload();
  assert.equal(elements['publish-btn'].disabled, false);
  await elements['publish-btn'].emit('click');

  const coverEntry = submissions[0].entries.find(([name]) => name === 'cover');
  assert.equal(coverEntry?.[1], coverB);
  assert.equal(coverEntry?.[2], 'b-generated.webp');
  assert.notEqual(coverEntry?.[1], coverA);
  assert.doesNotMatch(confirmMessages[0], /fallback cover/);
});
