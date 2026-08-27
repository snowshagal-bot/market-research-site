import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const SCRIPT = await read('assets/admin.js');

/**
 * assets/admin.js is one IIFE over a large form, so the harness hands it a
 * document that invents an element for any id and records what the script
 * builds. detectTakeaway is then exercised through the real analysis path:
 * choosing a file and reading what the form would send.
 */
function makeElement(id = '') {
  const listeners = new Map();
  const attrs = new Map();
  const element = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    hidden: false,
    disabled: false,
    checked: false,
    files: null,
    srcdoc: '',
    title: '',
    style: {},
    children: [],
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    setAttribute(key, value) { attrs.set(key, String(value)); },
    getAttribute(key) { return attrs.has(key) ? attrs.get(key) : null; },
    removeAttribute(key) { attrs.delete(key); },
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, blur() {}, click() {},
    scrollIntoView() {}, showModal() {}, close() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    fire(type, event = {}) {
      return Promise.all((listeners.get(type) || []).map(handler => handler({ preventDefault() {}, stopPropagation() {}, ...event })));
    }
  };
  return element;
}

/**
 * Just enough of a parsed document for the detectors: a map from selector to a
 * node. Real report HTML is handed to `htmlDocument` below instead.
 */
function stubDocument(map) {
  return {
    title: map.title || '',
    body: makeElement(),
    querySelector: selector => map[selector] || null,
    querySelectorAll: () => []
  };
}

/**
 * Locates an element by a `.parent .child` or `.child` class selector in real
 * HTML and returns its rendered text, tags stripped and entities resolved.
 * Only the handful of shapes the takeaway detectors ask for.
 */
function htmlDocument(html) {
  const findByClass = (source, className) => {
    const pattern = new RegExp(`<(\\w+)([^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*)>`, 'i');
    const open = pattern.exec(source);
    if (!open) return null;
    const tag = open[1];
    const from = open.index + open[0].length;
    // Walk to the matching close tag so nested spans come along.
    const scanner = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
    scanner.lastIndex = from;
    let depth = 1;
    let match;
    while ((match = scanner.exec(source))) {
      depth += match[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return { attrs: open[2], inner: source.slice(from, match.index) };
    }
    return null;
  };
  const textOf = inner => inner
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  return {
    title: (/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim(),
    body: makeElement(),
    querySelectorAll: () => [],
    querySelector(selector) {
      const meta = /^meta\[name="([^"]+)"\]$/.exec(selector);
      if (meta) {
        const found = new RegExp(`<meta[^>]*name="${meta[1]}"[^>]*>`, 'i').exec(html);
        if (!found) return null;
        return { content: /content="([^"]*)"/i.exec(found[0])?.[1] || '' };
      }
      if (selector === '[data-report-takeaway]') {
        const found = /<(\w+)([^>]*\bdata-report-takeaway(?:="([^"]*)")?[^>]*)>([\s\S]*?)<\/\1>/i.exec(html);
        if (!found) return null;
        const node = makeElement();
        node.textContent = textOf(found[4]);
        node.setAttribute('data-report-takeaway', found[3] || '');
        return node;
      }
      // Only class paths are understood here; any other selector is absent,
      // which is what the detectors treat as "no marker".
      if (!/^\.[\w-]+( \.[\w-]+)*$/.test(selector)) return null;
      const classes = selector.split(/\s+/).map(part => part.replace(/^\./, ''));
      let scope = html;
      let last = null;
      for (const className of classes) {
        last = findByClass(scope, className);
        if (!last) return null;
        scope = last.inner;
      }
      const node = makeElement();
      node.textContent = textOf(last.inner);
      return node;
    }
  };
}

function harness() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const submissions = [];
  let parsed = null;

  class StubFormData {
    constructor() { this.entries = []; }
    append(key, value) { this.entries.push([key, value]); }
    get(key) { return this.entries.find(([name]) => name === key)?.[1] ?? null; }
    getAll(key) { return this.entries.filter(([name]) => name === key).map(([, value]) => value); }
    has(key) { return this.entries.some(([name]) => name === key); }
  }

  const context = {
    document: {
      getElementById: get,
      // The page chrome the script sets up on load: theme root, colour meta.
      documentElement: makeElement('html'),
      querySelector: selector => (selector.startsWith('meta') ? makeElement(selector) : null),
      querySelectorAll: () => [],
      createElement: tag => makeElement(tag),
      addEventListener() {},
      body: makeElement()
    },
    window: { RESEARCH_POSTS: [], SITE_TAGS: [], MARKET_COVER_GENERATOR: null, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
    location: { hostname: 'snowshagal.com', origin: 'https://snowshagal.com' },
    navigator: { clipboard: null },
    sessionStorage: { getItem: () => 'key', setItem() {} },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setTimeout: (fn) => { fn(); return 0; },
    confirm: () => true,
    FormData: StubFormData,
    URL,
    DOMParser: class { parseFromString(text) { return parsed ?? htmlDocument(text); } },
    fetch: async (url, init) => {
      // Only the publish call carries the form; the deployment poll that
      // follows it must not overwrite what the test is looking at.
      if (String(url).includes('/api/publish')) submissions.push({ url, form: init?.body });
      return { ok: true, status: 200, json: async () => ({ id: 'x', registeredDate: '2026-08-27', reportUrl: '/reports/x', state: 'success', deployed: true }) };
    },
    console
  };
  vm.runInNewContext(SCRIPT, context);

  async function analyze(htmlOrDoc, name = '2026-08-27_daily.html') {
    parsed = typeof htmlOrDoc === 'string' ? null : htmlOrDoc;
    const text = typeof htmlOrDoc === 'string' ? htmlOrDoc : '<html></html>';
    const file = { name, size: text.length, text: async () => text };
    get('html-file').files = [file];
    await get('html-file').fire('change');
    return get('takeaway-status');
  }

  // The publish button gates on these, so a test that wants to publish must
  // fill them the way the form would and let it re-evaluate.
  async function ready({ date = '2026-08-27', title = '리포트', filename = 'report.html' } = {}) {
    get('post-date').value = date;
    get('post-title').value = title;
    get('post-filename').value = filename;
    get('admin-key').value = 'key';
    await get('admin-key').fire('input');
  }

  return { get, analyze, ready, submissions };
}

/* ------------------------------------------------------------ extraction */

test('the shipping Daily cover hands over its own one-liner', async () => {
  const app = harness();
  const html = await read('reports/8월 26일 주식리포트_커버통합.html');
  await app.analyze(html, '8월 26일 주식리포트_커버통합.html');

  const status = app.get('takeaway-status');
  assert.equal(status.hidden, false);
  // The real 8/26 cover, zero-width breaks and non-breaking spaces normalized.
  assert.equal(status.textContent, 'TODAY 한 줄 자동 감지 · "PCE· 엔비디아· 금통위가 한 장에 겹친다"');
  // The scroll nudge sits in the same .cover-hint and must not come along.
  assert.doesNotMatch(status.textContent, /아래로 넘기면/);
});

test('the English Daily cover is read the same way', async () => {
  const app = harness();
  const html = await read('reports/en/2026-08-26_KOSPI_Daily_Report_EN.html');
  await app.analyze(html, '2026-08-26_KOSPI_Daily_Report_EN.html');
  assert.match(app.get('takeaway-status').textContent, /PCE· NVIDIA· and the BOK policy meeting converge on one page/);
});

test('a declared meta tag outranks the cover', async () => {
  const app = harness();
  await app.analyze(`<html><head><meta name="report-type" content="daily"><meta name="report-takeaway" content="선언된 한 줄"></head>
    <body><div class="cover-hint"><span class="cv-one">커버 한 줄</span></div></body></html>`);
  assert.match(app.get('takeaway-status').textContent, /"선언된 한 줄"/);
});

test('a data-report-takeaway element is honoured, attribute first', async () => {
  const withValue = harness();
  await withValue.analyze(`<html><head><meta name="report-type" content="daily"></head>
    <body><p data-report-takeaway="속성에 담긴 한 줄">본문 텍스트</p></body></html>`);
  assert.match(withValue.get('takeaway-status').textContent, /"속성에 담긴 한 줄"/);

  const bare = harness();
  await bare.analyze(`<html><head><meta name="report-type" content="daily"></head>
    <body><p data-report-takeaway>표시만 한 요소의 문장</p></body></html>`);
  assert.match(bare.get('takeaway-status').textContent, /"표시만 한 요소의 문장"/);
});

test('.cover-oneline is the last resort', async () => {
  const app = harness();
  await app.analyze(`<html><head><meta name="report-type" content="daily"></head>
    <body><p class="cover-oneline">커버 원라인</p></body></html>`);
  assert.match(app.get('takeaway-status').textContent, /"커버 원라인"/);
});

/* ----------------------------------------------------- nothing is invented */

test('a Daily with no marked line reports none, and invents nothing', async () => {
  const app = harness();
  await app.analyze(`<html><head>
      <meta name="report-type" content="daily">
      <title>제목이 한 줄로 쓰이면 안 된다</title>
      <meta name="description" content="설명이 한 줄로 쓰이면 안 된다">
    </head><body><p>본문 첫 문장이 한 줄로 쓰이면 안 된다.</p></body></html>`);

  const status = app.get('takeaway-status');
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, 'TODAY 한 줄 감지 없음 · 홈페이지에서는 한 줄이 숨겨집니다.');
  assert.doesNotMatch(status.textContent, /제목이|설명이|본문 첫 문장/);
});

test('the detector reads only the four marked places', async () => {
  const script = await read('assets/admin.js');
  const body = /function detectTakeaway\(doc\)[\s\S]*?\n  }/.exec(script)?.[0] || '';
  assert.ok(body, 'detectTakeaway must exist');
  for (const allowed of ['report-takeaway', 'data-report-takeaway', '.cover-hint .cv-one', '.cover-oneline']) {
    assert.ok(body.includes(allowed), `${allowed} must be one of the sources`);
  }
  // Title, description and body prose are never consulted.
  assert.doesNotMatch(body, /doc\.title|report-summary|description|querySelectorAll|\bp\b\s*,/);
});

/* ------------------------------------------------- Daily and Daily only */

test('only a Daily submits a takeaway', async () => {
  const app = harness();
  const doc = stubDocument({
    'meta[name="report-type"]': { content: 'weekly' },
    '.cover-hint .cv-one': { textContent: '위클리 커버 문장' }
  });
  await app.analyze(doc, '위클리.html');

  // The status line is for Daily only, so nothing is shown here.
  assert.equal(app.get('takeaway-status').hidden, true);

  await app.ready({ title: '위클리', filename: '위클리.html' });
  await app.get('publish-btn').fire('click');
  const form = app.submissions.at(-1)?.form;
  assert.ok(form, 'a publish request must have been sent');
  assert.equal(form.get('type'), 'weekly');
  assert.equal(form.has('takeaway'), false, 'only a Daily carries a one-liner');
});

test('a Daily submits the line it was published with', async () => {
  const app = harness();
  const doc = stubDocument({
    'meta[name="report-type"]': { content: 'daily' },
    'meta[name="report-date"]': { content: '2026-08-27' },
    '.cover-hint .cv-one': { textContent: '  지수는  되돌렸지만 거래대금은 따라오지 않았다.  ' }
  });
  await app.analyze(doc);

  await app.ready({ title: '데일리', filename: 'daily.html' });
  await app.get('publish-btn').fire('click');

  const form = app.submissions.at(-1)?.form;
  assert.equal(form.get('type'), 'daily');
  assert.equal(form.get('takeaway'), '지수는 되돌렸지만 거래대금은 따라오지 않았다.');
  // summary keeps its own meaning and its own field.
  assert.notEqual(form.get('summary'), form.get('takeaway'));
});

test('switching the category away from Daily withdraws the line', async () => {
  const app = harness();
  const doc = stubDocument({
    'meta[name="report-type"]': { content: 'daily' },
    '.cover-hint .cv-one': { textContent: '데일리 한 줄' }
  });
  await app.analyze(doc);
  assert.equal(app.get('takeaway-status').hidden, false);

  // The editor corrects the category by hand before publishing.
  app.get('post-type').value = 'research';
  await app.ready({ title: '리서치', filename: 'research.html' });
  await app.get('publish-btn').fire('click');
  assert.equal(app.submissions.at(-1).form.has('takeaway'), false);
});

test('an over-long line is cut to the stored limit, not sent whole', async () => {
  const app = harness();
  const doc = stubDocument({
    'meta[name="report-type"]': { content: 'daily' },
    '.cover-hint .cv-one': { textContent: '가'.repeat(500) }
  });
  await app.analyze(doc);
  await app.ready({ title: '데일리', filename: 'daily.html' });
  await app.get('publish-btn').fire('click');
  assert.equal(app.submissions.at(-1).form.get('takeaway').length, 400);
});

test('the lightweight 8/27 layout is detected through its head tag alone', async () => {
  const app = harness();
  // No .cover-hint, no .cover-oneline: exactly the layout that came up empty
  // before the head tag existed.
  await app.analyze(`<!doctype html><html lang="ko"><head>
      <meta charset="utf-8">
      <meta name="report-type" content="daily">
      <meta name="report-date" content="2026-08-27">
      <meta name="report-takeaway" content="지수는 되돌렸지만 거래대금은 따라오지 않았다.">
      <meta name="description" content="설명이 한 줄을 대신하면 안 된다.">
      <title>2026.08.27 코스피 데일리 리포트</title>
    </head><body><section class="cover"><h1>두 개의 와이어</h1></section>
    <main><p>본문 첫 문장이 한 줄을 대신하면 안 된다.</p></main></body></html>`,
  '8월 27일 주식리포트_커버통합.html');

  assert.equal(app.get('takeaway-status').hidden, false);
  assert.equal(app.get('takeaway-status').textContent, 'TODAY 한 줄 자동 감지 · "지수는 되돌렸지만 거래대금은 따라오지 않았다."');

  await app.ready({ title: '두 개의 와이어', filename: '8월 27일 주식리포트_커버통합.html' });
  await app.get('publish-btn').fire('click');
  const form = app.submissions.at(-1).form;
  assert.equal(form.get('type'), 'daily');
  assert.equal(form.get('takeaway'), '지수는 되돌렸지만 거래대금은 따라오지 않았다.');
});
