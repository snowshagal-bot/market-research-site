// Boots the real assets/site.js in a sandbox far enough to drive the global
// search dialog: open/close, typing, tag clicks, and the <script> loads for the
// search index files, which the test resolves or fails on demand.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

function element(name) {
  const attrs = new Map();
  const listeners = {};
  return {
    name,
    attrs,
    listeners,
    dataset: {},
    textContent: '',
    innerHTML: '',
    value: '',
    hidden: false,
    open: false,
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute(key, value) { attrs.set(key, String(value)); },
    removeAttribute(key) { attrs.delete(key); },
    getAttribute(key) { return attrs.has(key) ? attrs.get(key) : null; },
    hasAttribute(key) { return attrs.has(key); },
    appendChild() {},
    focus() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  };
}

export const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
};

/**
 * @param {object} options
 * @param {'ko'|'en'} options.lang
 * @param {string} [options.siteSource] site.js source (defaults to the working tree)
 * @param {object} options.files map of src path -> script content served for it
 */
export async function bootSearch({ lang, siteSource, files }) {
  const [localeScript, site, postsJson, tagsJson] = await Promise.all([
    read('assets/locale.js'),
    siteSource ? Promise.resolve(siteSource) : read('assets/site.js'),
    read('data/posts.json'),
    read('data/tags.json')
  ]);

  const ids = ['search-dialog', 'global-search-input', 'search-clear-btn', 'search-results-list', 'search-empty-state', 'search-quick-tags', 'search-tag-cloud'];
  const byId = new Map(ids.map(id => [id, element(id)]));
  const trigger = element('trigger');
  const closeButton = element('close');
  const dialog = byId.get('search-dialog');
  dialog.querySelectorAll = (selector) => (selector === '[data-search-close]' ? [closeButton] : []);

  const requests = [];
  const pending = [];
  const head = element('head');
  head.appendChild = (script) => { requests.push(script.src); pending.push(script); };

  const document = {
    documentElement: Object.assign(element('html'), { lang, dataset: { siteLang: lang } }),
    head,
    body: element('body'),
    readyState: 'complete',
    addEventListener() {},
    createElement: (tag) => Object.assign(element(tag), { src: '', onload: null, onerror: null }),
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === '[data-search-trigger]' ? [trigger] : [])
  };
  const window = {
    RESEARCH_POSTS: JSON.parse(postsJson),
    TAG_REGISTRY: JSON.parse(tagsJson),
    addEventListener() {}
  };
  const context = vm.createContext({
    window,
    document,
    location: { pathname: lang === 'en' ? '/en/about/' : '/about/', search: '', href: 'https://snowshagal.com/about/', replace() {} },
    history: { replaceState() {}, pushState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: async () => new Response('{}', { status: 404 }),
    setTimeout,
    clearTimeout,
    Intl,
    URL,
    URLSearchParams,
    console
  });
  vm.runInContext(localeScript, context);
  vm.runInContext(site, context);

  const input = byId.get('global-search-input');
  const results = byId.get('search-results-list');
  const empty = byId.get('search-empty-state');

  /** Completes the oldest pending load of `src` with its file content (or fails it). */
  async function settle(src, { fail = false } = {}) {
    const index = pending.findIndex(script => script.src === src);
    if (index === -1) throw new Error(`no pending load for ${src}`);
    const [script] = pending.splice(index, 1);
    if (fail) script.onerror?.(new Error('network'));
    else {
      vm.runInContext(files[src], context);
      script.onload?.();
    }
    await flush();
  }

  return {
    requests,
    pending,
    dialog,
    input,
    results,
    empty,
    window,
    settle,
    async open() { for (const fn of trigger.listeners.click || []) fn(); await flush(); },
    async close() { for (const fn of closeButton.listeners.click || []) fn(); await flush(); },
    async type(value) {
      input.value = value;
      for (const fn of input.listeners.input || []) fn({ target: input });
      await flush();
    },
    async clear() {
      for (const fn of byId.get('search-clear-btn').listeners.click || []) fn();
      await flush();
    },
    snapshot() { return { html: results.innerHTML, empty: empty.hidden === false }; },
    resultIds() { return [...results.innerHTML.matchAll(/class="search-result-item" href="([^"]+)"/g)].map(m => m[1]); }
  };
}

export const META_SRC = '/data/search-index-meta.js';
export const bodySrc = (lang) => `/data/search-index-body-${lang}.js`;

/** Search index files as the browser would receive them, from the working tree. */
export async function currentFiles() {
  const [meta, ko, en] = await Promise.all([
    read('data/search-index-meta.js'),
    read('data/search-index-body-ko.js'),
    read('data/search-index-body-en.js')
  ]);
  return { [META_SRC]: meta, [bodySrc('ko')]: ko, [bodySrc('en')]: en };
}

/**
 * The metadata file as it was before the unused fields were dropped: every
 * field of data/search-index.json except bodyText.
 */
export async function fullFieldMeta() {
  const index = JSON.parse(await read('data/search-index.json'));
  const entries = index.map(({ bodyText, ...rest }) => rest);
  return `window.SEARCH_INDEX_META = ${JSON.stringify(entries)};\n`;
}

export const QUERY_CORPUS = {
  ko: [
    ['title match', 'WGBI'],
    ['tag-only', '선물·파생'],
    ['summary-only', '변수를'],
    ['body-only, deep', '6거래일'],
    ['body-only, company', '한화시스템'],
    ['stock name', '삼성전자'],
    ['stock name, Latin+Hangul', 'SK하이닉스'],
    ['every field', '반도체'],
    ['number', '7,000'],
    ['two words', '외국인 순매도'],
    ['Latin in Korean pages', 'kospi'],
    ['no result', 'zzqxjv']
  ],
  en: [
    ['title match', 'WGBI'],
    ['tag-only', 'Futures & Derivatives'],
    ['summary', 'macro drivers'],
    ['body-only, deep', 'indicating'],
    ['body-only, figure', '277tn'],
    ['stock name', 'Samsung'],
    ['stock name, two words', 'SK hynix'],
    ['every field', 'semiconductor'],
    ['number', '7,000'],
    ['two words', 'foreign investors'],
    ['Hangul in English pages', '반도체'],
    ['no result', 'zzqxjv']
  ]
};
