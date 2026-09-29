// Public category naming: the HOME archive filter says what the navigation says.
//
// assets/locale.js holds the canonical public label of every category. The
// static homepages repeat those labels literally — nothing rewrites them at
// runtime — so this file is what keeps the two from drifting apart again. It
// did once: the filter kept "시장 공부 / 끄적끄적" and "Market Basics / Notes",
// in basics → note order, after the navigation had moved on to
// "투자 노트 / 시장 입문" in note → basics order.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import '../assets/locale.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const LOCALE = globalThis.MARKET_LOCALE;
const HOMES = { ko: 'index.html', en: 'en/index.html' };
const ALL_LABEL = { ko: '전체', en: 'All' };
// The public order of the report categories, everywhere they are listed.
const ORDER = ['daily', 'weekly', 'research', 'note', 'basics'];

function archiveFilters(html) {
  const block = /<div class="filters"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] || '';
  return [...block.matchAll(/<button class="filter[^"]*" data-filter="([a-z]+)"[^>]*>([^<]*)<\/button>/g)]
    .map(([, type, label]) => ({ type, label: label.trim() }));
}

function navCategories(html, navClass) {
  const block = new RegExp(`<nav class="${navClass}"[^>]*>([\\s\\S]*?)</nav>`).exec(html)?.[1] || '';
  return [...block.matchAll(/<a data-nav-category="([a-z]+)"[^>]*>([^<]*)<\/a>/g)]
    .map(([, type, label]) => ({ type, label: label.trim() }))
    .filter(({ type }) => type !== 'all');
}

for (const lang of ['ko', 'en']) {
  test(`${lang.toUpperCase()} HOME archive filter lists daily → weekly → research → note → basics`, async () => {
    const filters = archiveFilters(await read(HOMES[lang]));
    assert.deepEqual(filters.map(({ type }) => type), ['all', ...ORDER]);
    assert.equal(filters[0].label, ALL_LABEL[lang]);
  });

  test(`${lang.toUpperCase()} HOME archive filter labels are the locale.js category labels`, async () => {
    const filters = archiveFilters(await read(HOMES[lang])).filter(({ type }) => type !== 'all');
    for (const { type, label } of filters) {
      assert.equal(label, LOCALE.copy[lang].categories[type].label, `${lang} ${type}`);
    }
  });

  test(`${lang.toUpperCase()} HOME archive filter and navigation name and order the categories alike`, async () => {
    const html = await read(HOMES[lang]);
    const filters = archiveFilters(html).filter(({ type }) => type !== 'all');
    for (const navClass of ['main-nav', 'mobile-quick-nav']) {
      assert.deepEqual(navCategories(html, navClass), filters, `${lang} ${navClass}`);
    }
  });
}

test('the canonical note and basics labels, and the order the site script lists them in', async () => {
  assert.equal(LOCALE.copy.ko.categories.note.label, '투자 노트');
  assert.equal(LOCALE.copy.ko.categories.basics.label, '시장 입문');
  assert.equal(LOCALE.copy.en.categories.note.label, 'Investment Note');
  assert.equal(LOCALE.copy.en.categories.basics.label, 'Market Basics');

  const site = await read('assets/site.js');
  assert.match(site, /const coreTypes = \['daily', 'weekly', 'research', 'note', 'basics'\];/);
  for (const lang of ['ko', 'en']) {
    const html = await read(HOMES[lang]);
    assert.doesNotMatch(html, />(?:시장 공부|끄적끄적|Notes)</, `${lang}: no retired label left on the homepage`);
  }
});

/* ---------------- ?category= behaviour, through the real site.js ---------------- */

function fakeElement(id = '') {
  const classes = new Set();
  const attrs = new Map();
  const listeners = {};
  return {
    id,
    dataset: {},
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    style: {},
    listeners,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, force) => { const on = force === undefined ? !classes.has(name) : Boolean(force); on ? classes.add(name) : classes.delete(name); return on; },
      contains: name => classes.has(name)
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute(key, value) { attrs.set(key, String(value)); },
    getAttribute(key) { return attrs.has(key) ? attrs.get(key) : null; },
    removeAttribute(key) { attrs.delete(key); },
    hasAttribute(key) { return attrs.has(key); },
    appendChild() {},
    append() {},
    prepend() {},
    remove() {},
    focus() {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  };
}

async function bootHome(lang, search) {
  const [html, localeScript, site, postsJson, tagsJson] = await Promise.all([
    read(HOMES[lang]), read('assets/locale.js'), read('assets/site.js'), read('data/posts.json'), read('data/tags.json')
  ]);
  const buttons = archiveFilters(html).map(({ type, label }) => {
    const button = fakeElement();
    button.dataset.filter = type;
    button.textContent = label;
    if (type === 'all') { button.classList.add('active'); button.setAttribute('aria-pressed', 'true'); }
    return button;
  });
  const byId = new Map();
  const home = lang === 'en' ? '/en/' : '/';
  const replaced = [];
  const location = { pathname: home, search, href: `https://snowshagal.com${home}${search}`, hash: '', replace() {} };
  const document = {
    documentElement: Object.assign(fakeElement('html'), { lang, dataset: { siteLang: lang } }),
    body: fakeElement('body'),
    head: fakeElement('head'),
    readyState: 'complete',
    addEventListener() {},
    createElement: () => fakeElement(),
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, fakeElement(id)); return byId.get(id); },
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === '[data-filter]' ? buttons : [])
  };
  const window = { RESEARCH_POSTS: JSON.parse(postsJson), TAG_REGISTRY: JSON.parse(tagsJson), addEventListener() {} };
  const context = vm.createContext({
    window, document, location,
    history: { replaceState: (_state, _title, url) => { replaced.push(String(url)); location.search = new URL(String(url)).search; }, pushState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: async () => new Response('{}', { status: 404 }),
    setTimeout, clearTimeout, Intl, URL, URLSearchParams, console
  });
  window.window = window;
  vm.runInContext(localeScript, context);
  vm.runInContext(site, context);
  await new Promise(resolve => setImmediate(resolve));
  const posts = JSON.parse(postsJson).filter(post => (post.lang === 'en' ? 'en' : 'ko') === lang);
  return { buttons, list: byId.get('report-list'), replaced, posts };
}

const pressed = (buttons) => buttons.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.dataset.filter);
const listedHrefs = (list) => [...list.innerHTML.matchAll(/class="report-item"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="report-item"/g)].map(m => m[1] || m[2]);

for (const lang of ['ko', 'en']) {
  for (const type of ['note', 'basics']) {
    test(`${lang.toUpperCase()} ?category=${type} still selects that filter and lists only that category`, async () => {
      const { buttons, list, posts } = await bootHome(lang, `?category=${type}`);
      assert.deepEqual(pressed(buttons), [type]);
      assert.ok(buttons.find(button => button.dataset.filter === type).classList.contains('active'));

      const hrefs = listedHrefs(list);
      const expected = posts.filter(post => post.type === type);
      assert.ok(expected.length > 0, `${lang} has ${type} posts`);
      assert.equal(hrefs.length, Math.min(expected.length, 20));
      const allowed = new Set(expected.map(post => `/${post.href.replace(/\.html$/, '')}`));
      for (const href of hrefs) assert.ok(allowed.has(decodeURI(href)) || allowed.has(href), `${lang} ${type}: ${href}`);
    });
  }

  test(`${lang.toUpperCase()} clicking the note and basics filters writes ?category= as before`, async () => {
    const { buttons, replaced } = await bootHome(lang, '');
    assert.deepEqual(pressed(buttons), ['all']);
    for (const type of ['note', 'basics']) {
      const button = buttons.find(entry => entry.dataset.filter === type);
      for (const fn of button.listeners.click || []) fn();
      assert.equal(new URL(replaced.at(-1)).searchParams.get('category'), type);
      assert.deepEqual(pressed(buttons), [type]);
    }
    const all = buttons.find(entry => entry.dataset.filter === 'all');
    for (const fn of all.listeners.click || []) fn();
    assert.equal(new URL(replaced.at(-1)).searchParams.get('category'), null);
  });
}
