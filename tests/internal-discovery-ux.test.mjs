import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  homepageLatestLinks,
  categoryReportLinks
} from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function makeElement(tag, attrs = {}) {
  const dataset = {};
  const style = { setProperty() {}, getPropertyValue: () => '' };
  const shadow = makeShadowRoot();
  return {
    tagName: tag.toUpperCase(),
    dataset,
    style,
    hidden: false,
    textContent: '',
    innerHTML: '',
    attributes: attrs,
    getAttribute: name => attrs[name] ?? null,
    setAttribute: (name, value) => { attrs[name] = String(value); },
    removeAttribute: name => { delete attrs[name]; },
    hasAttribute: name => name in attrs,
    appendChild: child => child,
    append: () => {},
    insertBefore: child => child,
    remove() {},
    attachShadow: () => shadow,
    shadowRoot: shadow,
    addEventListener() {},
    focus() {},
    contains: () => false,
    querySelector: () => makeElement('div'),
    querySelectorAll: () => []
  };
}

function makeShadowRoot() {
  const cache = new Map();
  const root = { innerHTML: '', addEventListener() {}, append: () => {} };
  const node = key => {
    if (!cache.has(key)) cache.set(key, makeElement(key));
    return cache.get(key);
  };
  root.getElementById = id => node(`#${id}`);
  root.querySelector = selector => node(selector);
  root.querySelectorAll = selector => [node(`all:${selector}`)];
  root.activeElement = null;
  return root;
}

async function loadReportShell() {
  const code = await read('assets/report-shell.js');
  const windowObj = { MARKET_LOCALE: undefined, addEventListener() {} };
  const documentObj = {
    currentScript: { dataset: { category: 'daily', lang: 'ko' } },
    documentElement: makeElement('html'),
    body: Object.assign(makeElement('body'), { firstChild: null }),
    title: '',
    readyState: 'complete',
    addEventListener() {},
    createElement: tag => makeElement(tag),
    getElementById: id => (id === 'mrs-comments-host' ? makeElement('section') : null),
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const sandbox = {
    window: windowObj,
    document: documentObj,
    location: { pathname: '/reports/8월 27일 주식리포트_커버통합.html', href: 'https://snowshagal.com/reports/report', search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: { share: undefined, clipboard: undefined },
    fetch: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return {
    shell: sandbox.window.REPORT_SHELL,
    discovery: sandbox.window.REPORT_DISCOVERY
  };
}

/* -------------------------------------------------- 1. Previous / Next */

test('Previous / Next: stays within the same category and same locale in reportDate order', async () => {
  const { discovery } = await loadReportShell();
  const mockPosts = [
    { id: 'ko-daily-1', type: 'daily', lang: 'ko', reportDate: '2026-08-25', href: 'reports/2026-08-25-daily.html', title: '8/25 데일리' },
    { id: 'ko-daily-2', type: 'daily', lang: 'ko', reportDate: '2026-08-26', href: 'reports/2026-08-26-daily.html', title: '8/26 데일리' },
    { id: 'ko-daily-3', type: 'daily', lang: 'ko', reportDate: '2026-08-27', href: 'reports/2026-08-27-daily.html', title: '8/27 데일리' },
    { id: 'ko-weekly-1', type: 'weekly', lang: 'ko', reportDate: '2026-08-26', href: 'reports/2026-08-26-weekly.html', title: '8/26 위클리' },
    { id: 'en-daily-2', type: 'daily', lang: 'en', reportDate: '2026-08-26', href: 'reports/en/2026-08-26-daily.html', title: '8/26 Daily EN' }
  ];

  // Middle post: 8/26 KO Daily
  const mid = discovery.findAdjacentReports(mockPosts, '/reports/2026-08-26-daily.html', 'ko');
  assert.equal(mid.current?.id, 'ko-daily-2');
  assert.equal(mid.prev?.id, 'ko-daily-1', 'Previous must be older daily post (8/25)');
  assert.equal(mid.next?.id, 'ko-daily-3', 'Next must be newer daily post (8/27)');

  // First post: 8/25 KO Daily (oldest)
  const first = discovery.findAdjacentReports(mockPosts, '/reports/2026-08-25-daily.html', 'ko');
  assert.equal(first.prev, null, 'Oldest report has no previous post');
  assert.equal(first.next?.id, 'ko-daily-2');

  // Last post: 8/27 KO Daily (newest)
  const last = discovery.findAdjacentReports(mockPosts, '/reports/2026-08-27-daily.html', 'ko');
  assert.equal(last.prev?.id, 'ko-daily-2');
  assert.equal(last.next, null, 'Newest report has no next post');

  // English report: stays strictly in EN
  const en = discovery.findAdjacentReports(mockPosts, '/reports/en/2026-08-26-daily.html', 'en');
  assert.equal(en.current?.id, 'en-daily-2');
  assert.equal(en.prev, null, 'No older EN daily post in mock');
  assert.equal(en.next, null, 'No newer EN daily post in mock');
});

test('Previous / Next: real posts data traversal across all categories', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const { discovery } = await loadReportShell();

  // Test 8/26 KO Daily
  const ko826 = posts.find(p => p.date === '2026-08-26' && p.lang === 'ko' && p.type === 'daily');
  assert.ok(ko826, '8/26 KO Daily exists');
  const adj = discovery.findAdjacentReports(posts, `/${ko826.href}`, 'ko');
  assert.equal(adj.current?.id, ko826.id);
  assert.ok(adj.prev, '8/26 KO Daily must have previous post (8/25)');
  assert.equal(adj.prev?.type, 'daily');
  assert.equal(adj.prev?.lang, 'ko');
  assert.ok(adj.next, '8/26 KO Daily must have next post (8/27)');
  assert.equal(adj.next?.type, 'daily');
  assert.equal(adj.next?.lang, 'ko');
});

/* -------------------------------------------------- 2. Related Reading */

test('Related Reading: deterministic tag ranking and fallback', async () => {
  const { discovery } = await loadReportShell();
  const mockPosts = [
    {
      id: 'current-post',
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-27',
      tags: ['rates', 'ai', 'policy'],
      href: 'reports/current.html',
      title: '현재 글'
    },
    {
      id: 'p-3tags',
      type: 'research',
      lang: 'ko',
      reportDate: '2026-08-20',
      tags: ['rates', 'ai', 'policy'],
      href: 'reports/p-3tags.html',
      title: '3개 태그 일치'
    },
    {
      id: 'p-2tags-daily',
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-25',
      tags: ['rates', 'ai'],
      href: 'reports/p-2tags-daily.html',
      title: '2개 태그 일치 + 데일리'
    },
    {
      id: 'p-2tags-weekly',
      type: 'weekly',
      lang: 'ko',
      reportDate: '2026-08-25',
      tags: ['rates', 'ai'],
      href: 'reports/p-2tags-weekly.html',
      title: '2개 태그 일치 + 위클리'
    },
    {
      id: 'p-notags',
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-24',
      tags: ['flows'],
      href: 'reports/p-notags.html',
      title: '태그 불일치'
    },
    {
      id: 'p-en-post',
      type: 'daily',
      lang: 'en',
      reportDate: '2026-08-27',
      tags: ['rates', 'ai', 'policy'],
      href: 'reports/en/p-en.html',
      title: '영문 글 (제외되어야 함)'
    }
  ];

  const current = mockPosts[0];
  const related = discovery.rankRelatedReports(mockPosts, current, 'ko', 3);

  assert.equal(related.length, 3, 'Must return exactly 3 related reports');
  assert.equal(related[0].id, 'p-3tags', 'Top ranked must have highest tag match (score 30)');
  assert.equal(related[1].id, 'p-2tags-daily', 'Second ranked must be 2 tags + same category bonus (score 22)');
  assert.equal(related[2].id, 'p-2tags-weekly', 'Third ranked must be 2 tags weekly (score 20)');

  // Verify exclusions
  assert.ok(related.every(p => p.id !== 'current-post'), 'Self must never be in related');
  assert.ok(related.every(p => p.lang === 'ko'), 'English posts must never leak into Korean recommendations');
});

test('Related Reading: fallback fills up to 3 when shared tags are insufficient', async () => {
  const { discovery } = await loadReportShell();
  const mockPosts = [
    {
      id: 'current',
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-27',
      tags: ['rare-tag'],
      href: 'reports/current.html'
    },
    {
      id: 'daily-latest',
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-26',
      tags: ['unrelated'],
      href: 'reports/daily-latest.html'
    },
    {
      id: 'weekly-latest',
      type: 'weekly',
      lang: 'ko',
      reportDate: '2026-08-25',
      tags: ['unrelated'],
      href: 'reports/weekly-latest.html'
    },
    {
      id: 'research-latest',
      type: 'research',
      lang: 'ko',
      reportDate: '2026-08-24',
      tags: ['unrelated'],
      href: 'reports/research-latest.html'
    }
  ];

  const related = discovery.rankRelatedReports(mockPosts, mockPosts[0], 'ko', 3);
  assert.equal(related.length, 3, 'Must fill 3 items via fallback');
  assert.equal(related[0].id, 'daily-latest', 'Fallback prioritizes same category latest');
  assert.equal(related[1].id, 'weekly-latest', 'Fallback then takes other category latest');
  assert.equal(related[2].id, 'research-latest');
});

/* ------------------------------------------- 3. Homepage Latest Reading Time */

test('Homepage Latest: renders reading time in SSR metadata for both KO and EN', async () => {
  const posts = JSON.parse(await read('data/posts.json'));

  // Korean homepage latest links
  const koHtml = homepageLatestLinks(posts, 'ko');
  assert.match(koHtml, /DAILY · 약 \d+분/, 'KO Daily latest card must include reading time');
  assert.match(koHtml, /WEEKLY · 약 \d+분/, 'KO Weekly latest card must include reading time');
  assert.match(koHtml, /RESEARCH · 약 \d+분/, 'KO Research latest card must include reading time');
  assert.doesNotMatch(koHtml, /undefined|NaN|약 0분/);

  // English homepage latest links
  const enHtml = homepageLatestLinks(posts, 'en');
  assert.match(enHtml, /DAILY · \d+ min read/, 'EN Daily latest card must include reading time');
  assert.match(enHtml, /WEEKLY · \d+ min read/, 'EN Weekly latest card must include reading time');
  assert.match(enHtml, /RESEARCH · \d+ min read/, 'EN Research latest card must include reading time');
  assert.doesNotMatch(enHtml, /undefined|NaN|0 min read/);
});

test('Homepage Latest: safely omits reading time when missing or zero without broken copy', () => {
  const mockPosts = [
    {
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-27',
      title: '테스트',
      readingMinutes: 0,
      href: 'reports/test.html'
    }
  ];
  const html = homepageLatestLinks(mockPosts, 'ko');
  assert.match(html, /<b>DAILY<\/b>/, 'When readingMinutes is 0, omit suffix cleanly');
  assert.doesNotMatch(html, /·/);
});

/* ------------------------------------------------ 4. Category Landing UX */

test('Category Landing: renders latest report and archive rows with reading time and tags', async () => {
  const posts = JSON.parse(await read('data/posts.json'));

  for (const type of ['daily', 'weekly', 'research', 'basics']) {
    for (const lang of ['ko', 'en']) {
      const html = categoryReportLinks(posts, type, lang);
      assert.ok(html.length > 0, `${lang} ${type} category report links must not be empty`);
      assert.match(html, /class="report-item" data-latest="true"/, `${lang} ${type} must highlight the first post as latest`);
      assert.match(html, lang === 'en' ? />LATEST<\/span>/ : />최신 리포트<\/span>/);
      assert.match(html, lang === 'en' ? /\d+ min read/ : /약 \d+분/);
    }
  }
});

/* -------------------------------------------------- 5. DOM Order & CSS */

test('Report Shell: mount order guarantees body -> discovery -> share -> comments', async () => {
  const shell = await read('assets/report-shell.js');
  const mountBody = shell.slice(shell.indexOf('function mount()'), shell.indexOf('if (document.readyState'));
  const order = [
    mountBody.indexOf('mountReportNav()'),
    mountBody.indexOf('mountDiscovery()'),
    mountBody.indexOf('mountShare()'),
    mountBody.indexOf('mountComments()')
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'Mount functions must execute in exact reader priority order');
});
