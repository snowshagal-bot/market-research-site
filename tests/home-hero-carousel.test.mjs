import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (relPath) => readFile(new URL(`../${relPath}`, import.meta.url), 'utf8');

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
    href: '',
    src: '',
    alt: '',
    dataset: {},
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
        } else if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    emit(type, event = {}) {
      (listeners.get(type) || []).forEach((fn) => fn({ preventDefault() {}, ...event }));
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name); },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
    closest() { return element(); },
    appendChild() {},
    querySelector(sel) {
      if (sel === '#archive-more') return element('archive-more');
      if (sel === '.hero-carousel-controls') return element('hero-carousel-controls');
      return element();
    },
    querySelectorAll() { return []; },
    focus() {}
  };
}

async function loadSiteScriptContext(initialPosts = [], currentLocale = 'ko') {
  const source = await read('assets/site.js');
  const ids = [
    'hero-slide-1', 'hero-slide-2', 'hero-carousel-prev', 'hero-carousel-next',
    'carousel-current', 'hero-featured-date', 'hero-featured-reading',
    'hero-featured-title-link', 'hero-featured-snippet', 'hero-featured-action-btn',
    'hero-featured-img-link', 'hero-featured-img', 'today-strip-date',
    'today-takeaway-label', 'today-takeaway-text', 'today-takeaway-link',
    'report-list', 'archive-more', 'filter-year', 'filter-month', 'filter-tag',
    'filter-reset', 'search-dialog', 'global-search-input', 'search-clear-btn',
    'search-results-list', 'search-empty-state', 'search-quick-tags', 'search-tag-cloud'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  elements['hero-slide-1'].classList.add('active');
  const heroSection = element('brand-hero');
  const controlsEl = element('hero-carousel-controls');
  const context = {
    console,
    URLSearchParams,
    Intl,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    document: {
      documentElement: { lang: currentLocale, dataset: {} },
      body: { classList: { contains: () => true }, dataset: {} },
      getElementById: (id) => elements[id] || element(id),
      querySelector: (sel) => {
        if (sel === '.brand-hero') return heroSection;
        if (sel === '.hero-carousel-controls') return controlsEl;
        if (sel === '.today-strip') return element('today-strip');
        if (sel === '.today-takeaway-row') return element('today-takeaway-row');
        if (sel === '#report-list') return elements['report-list'];
        if (sel.startsWith('#')) return elements[sel.slice(1)] || element(sel.slice(1));
        return element();
      },
      querySelectorAll: () => []
    },
    location: { pathname: currentLocale === 'en' ? '/en/' : '/', search: '', replace: () => {} },
    window: {
      addEventListener: () => {},
      RESEARCH_POSTS: initialPosts,
      MARKET_LOCALE: {
        siteLanguage: () => currentLocale,
        preferredHomepageRedirect: () => '',
        validLanguages: ['ko', 'en'],
        pageLanguagePath: () => '',
        categoryCounts: () => ({}),
        copy: {
          ko: { categories: {}, read: '읽기', archiveMore: '더보기', reportOrder: '최신순', takeawayLabel: 'TODAY' },
          en: { categories: {}, read: 'Read', archiveMore: 'Load more', reportOrder: 'Latest', takeawayLabel: 'TODAY' }
        },
        localePosts: (all, loc) => all.filter((p) => (p.lang === 'en' ? 'en' : 'ko') === loc),
        sortPosts: (arr) => arr.slice().sort((a, b) => {
          const da = String(a.reportDate || a.date || '');
          const db = String(b.reportDate || b.date || '');
          if (da !== db) return db.localeCompare(da);
          return String(b.registeredAt || '').localeCompare(String(a.registeredAt || ''));
        })
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, heroSection, controlsEl };
}

// -------------------------------------------------------------
// TESTS
// -------------------------------------------------------------

test('Slide 02 Featured Research: KO homepage picks latest KO Research even if newer Daily exists', async () => {
  const samplePosts = [
    { id: '2026-08-28-daily-ko', type: 'daily', lang: 'ko', title: '더 최신 KO 데일리', reportDate: '2026-08-28', takeaway: '데일리 요약', readingMinutes: 5, href: 'reports/ko-daily-828.html' },
    { id: '2026-08-27-research-ko', type: 'research', lang: 'ko', title: '한국 밸류업 프로그램 분석', reportDate: '2026-08-27', summary: '밸류업의 핵심 정책과 수혜 업종 분석', readingMinutes: 14, coverImage: 'covers/valueup.jpg', href: 'reports/valueup.html' },
    { id: '2026-08-20-research-ko', type: 'research', lang: 'ko', title: '이전 리서치', reportDate: '2026-08-20', summary: '이전 글', href: 'reports/prev-res.html' }
  ];

  const { elements } = await loadSiteScriptContext(samplePosts, 'ko');

  assert.equal(elements['hero-featured-date'].textContent, '2026-08-27');
  assert.equal(elements['hero-featured-title-link'].textContent, '한국 밸류업 프로그램 분석');
  assert.equal(elements['hero-featured-title-link'].href, '/reports/valueup');
  assert.equal(elements['hero-featured-snippet'].textContent, '밸류업의 핵심 정책과 수혜 업종 분석');
  assert.equal(elements['hero-featured-reading'].textContent, '약 14분');
  assert.equal(elements['hero-featured-action-btn'].href, '/reports/valueup');
  assert.equal(elements['hero-featured-img'].src, '/covers/valueup.jpg');
});

test('Slide 02 Featured Research: EN homepage picks latest EN Research without mixed locale', async () => {
  const samplePosts = [
    { id: '2026-08-27-research-ko', type: 'research', lang: 'ko', title: 'KO 리서치', reportDate: '2026-08-27', href: 'reports/ko-res.html' },
    { id: '2026-08-26-research-en', type: 'research', lang: 'en', title: 'Semiconductor Cycle Deep Dive', reportDate: '2026-08-26', summary: 'Analyzing the next memory cycle.', readingMinutes: 18, coverImage: 'covers/semi.jpg', href: 'reports/semi-en.html' }
  ];

  const { elements } = await loadSiteScriptContext(samplePosts, 'en');

  assert.equal(elements['hero-featured-title-link'].textContent, 'Semiconductor Cycle Deep Dive');
  assert.equal(elements['hero-featured-reading'].textContent, '18 min read');
  assert.equal(elements['hero-featured-snippet'].textContent, 'Analyzing the next memory cycle.');
  assert.equal(elements['hero-featured-action-btn'].href, '/reports/semi-en');
  assert.equal(elements['hero-featured-img'].src, '/covers/semi.jpg');
});

test('Slide 02 Featured Research: Copy fallback priority: summary -> subtitle -> description', async () => {
  const postWithSummary = [
    { id: '1', type: 'research', lang: 'ko', title: '글 1', reportDate: '2026-08-27', takeaway: '데일리용', summary: '리서치 요약문', subtitle: '부제', description: '설명', href: 'reports/1.html' }
  ];
  const { elements: el1 } = await loadSiteScriptContext(postWithSummary, 'ko');
  assert.equal(el1['hero-featured-snippet'].textContent, '리서치 요약문');

  const postWithSubtitle = [
    { id: '2', type: 'research', lang: 'ko', title: '글 2', reportDate: '2026-08-27', subtitle: '부제문구', description: '설명문구', href: 'reports/2.html' }
  ];
  const { elements: el2 } = await loadSiteScriptContext(postWithSubtitle, 'ko');
  assert.equal(el2['hero-featured-snippet'].textContent, '부제문구');
});

test('Slide 02 Featured Research: Fallback when 0 research posts exist (hide slide 2 and controls)', async () => {
  const postsNoResearch = [
    { id: '1', type: 'daily', lang: 'ko', title: '데일리만 있음', reportDate: '2026-08-27', href: 'reports/1.html' }
  ];
  const { elements, controlsEl } = await loadSiteScriptContext(postsNoResearch, 'ko');

  assert.equal(elements['hero-slide-2'].hidden, true);
  assert.equal(controlsEl.hidden, true);
});

test('Slide 02 Featured Research: Fallback cover image when coverImage is missing', async () => {
  const postWithoutCover = [
    { id: '1', type: 'research', lang: 'ko', title: '커버없는 리서치', reportDate: '2026-08-27', href: 'reports/1.html' }
  ];
  const { elements } = await loadSiteScriptContext(postWithoutCover, 'ko');
  assert.equal(elements['hero-featured-img'].src, '/assets/social/snowshagal-home.jpg');
});

test('Slide 02 Featured Research: Manual carousel navigation (click, keyboard, swipe, no autoplay)', async () => {
  const samplePosts = [
    { id: '1', type: 'research', lang: 'ko', title: '리서치 글', reportDate: '2026-08-27', href: 'reports/1.html' }
  ];
  const { context, elements, heroSection } = await loadSiteScriptContext(samplePosts, 'ko');
  const controller = context.window.__heroCarouselTest;

  assert.equal(controller.getActiveIndex(), 0);
  assert.equal(elements['hero-slide-1'].classList.contains('active'), true);
  assert.equal(elements['hero-slide-2'].classList.contains('active'), false);
  assert.equal(elements['hero-carousel-prev'].disabled, true);
  assert.equal(elements['hero-carousel-next'].disabled, false);
  assert.equal(elements['carousel-current'].textContent, '01');

  // Next click -> Slide 2
  elements['hero-carousel-next'].emit('click');
  assert.equal(controller.getActiveIndex(), 1);
  assert.equal(elements['hero-slide-1'].classList.contains('active'), false);
  assert.equal(elements['hero-slide-2'].classList.contains('active'), true);
  assert.equal(elements['hero-carousel-prev'].disabled, false);
  assert.equal(elements['hero-carousel-next'].disabled, true);
  assert.equal(elements['carousel-current'].textContent, '02');

  // Prev click -> Slide 1
  elements['hero-carousel-prev'].emit('click');
  assert.equal(controller.getActiveIndex(), 0);

  // Keyboard navigation
  heroSection.emit('keydown', { key: 'ArrowRight' });
  assert.equal(controller.getActiveIndex(), 1);
  heroSection.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(controller.getActiveIndex(), 0);

  // Touch Swipe (Left swipe -> Slide 2)
  heroSection.emit('touchstart', { touches: [{ clientX: 200, clientY: 100 }] });
  heroSection.emit('touchend', { changedTouches: [{ clientX: 100, clientY: 105 }] });
  assert.equal(controller.getActiveIndex(), 1);

  // Touch Swipe (Right swipe -> Slide 1)
  heroSection.emit('touchstart', { touches: [{ clientX: 100, clientY: 100 }] });
  heroSection.emit('touchend', { changedTouches: [{ clientX: 220, clientY: 98 }] });
  assert.equal(controller.getActiveIndex(), 0);
});

test('TASK C: Category Icon scale-up and 44px tap target css rules exist', async () => {
  const homeCss = await read('assets/home-v2.css');
  assert.ok(homeCss.includes('.entry-symbol'));
  assert.ok(homeCss.includes('width: 28px'));
  assert.ok(homeCss.includes('.entry-daily'));
  assert.ok(homeCss.includes('border: 1.8px solid currentColor'));
  assert.ok(homeCss.includes('min-height: 44px'));
});

test('Slide 02: Vertical cover contain and no forced landscape crop', async () => {
  const homeCss = await read('assets/home-v2.css');
  assert.ok(homeCss.includes('.featured-cover-wrap img'));
  assert.ok(homeCss.includes('object-fit: contain'));
  assert.ok(homeCss.includes('aspect-ratio: 2 / 3'));
  assert.equal(homeCss.includes('aspect-ratio: 16 / 10'), false);
  assert.equal(homeCss.includes('aspect-ratio: 16 / 9'), false);
});

test('Carousel controls: Minimal editorial controls without pill background or circular buttons', async () => {
  const homeCss = await read('assets/home-v2.css');
  assert.ok(homeCss.includes('.hero-carousel-controls'));
  assert.ok(homeCss.includes('.carousel-btn:focus-visible'));
  assert.equal(homeCss.includes('backdrop-filter: blur'), false);
  assert.ok(homeCss.includes('background: none;'));
});

test('TASK D: Report List read label has nowrap and proper grid template', async () => {
  const [siteCss, catCss, homeCss] = await Promise.all([
    read('assets/site.css'),
    read('assets/category-landing.css'),
    read('assets/home-v2.css')
  ]);

  assert.ok(siteCss.includes('grid-template-columns:130px minmax(0,1fr) max-content'));
  assert.ok(siteCss.includes('.report-read-label{white-space:nowrap;word-break:keep-all}'));
  assert.ok(catCss.includes('.category-page .report-arrow'));
  assert.ok(catCss.includes('white-space: nowrap'));
  assert.ok(catCss.includes('.category-page .report-read-label'));
  assert.ok(catCss.includes('word-break: keep-all'));
  assert.ok(homeCss.includes('.report-read-label'));
  assert.ok(homeCss.includes('white-space: nowrap'));
});
