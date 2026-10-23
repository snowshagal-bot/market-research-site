import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { onRequest } from '../functions/_middleware.js';
import { GA4_MEASUREMENT_ID, ga4Tag, appendGa4ToHtml } from '../functions/_ga4.js';
import { STATIC_PUBLIC_PAGES } from '../scripts/static-public-pages.mjs';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const posts = JSON.parse(await read('data/posts.json'));
const tags = JSON.parse(await read('data/tags.json'));
const marker = /<script data-snowshagal-ga4="G-L3XBBY93CG">/g;
const shell = '<!doctype html><html><head><title>Public report</title></head><body>Report</body></html>';
const bootstrap = ga4Tag(new URL('https://snowshagal.com/')).replace(/^<script[^>]*>|<\/script>$/g, '');

test('browser code is a literal asset and never serialized from a bundled server function', async () => {
  const source = await read('functions/_ga4.js');
  assert.doesNotMatch(source, /\.toString\s*\(/, 'Function serialization can leak Cloudflare/esbuild helpers into the browser');
  assert.doesNotMatch(bootstrap, /\b__name\s*\(|\b__defProp\b/);
});

async function render(path, html = shell, { origin = 'https://snowshagal.com', status = 200, type = 'text/html', method = 'GET', corpus = posts } = {}) {
  return onRequest({
    request: new Request(origin + path, { method }),
    next: async () => new Response(html, { status, headers: { 'content-type': type, 'x-preserve': 'yes' } }),
    env: { ASSETS: { fetch: async request => {
      const pathname = new URL(request.url || request).pathname;
      if (pathname === '/data/posts.json') return Response.json(corpus);
      if (pathname === '/data/tags.json') return Response.json(tags);
      return new Response('', { status: 404 });
    } } }
  });
}

function browser({ url = 'https://snowshagal.com/reports/example?email=reader%40example.com&token=secret&q=private&utm_source=private#secret', referrer = 'https://www.google.com/search?q=private&email=reader@example.com#secret', readyState = 'complete', existingScript = false, existingGtag = false, dataLayer } = {}) {
  const scripts = [];
  const listeners = [];
  const document = {
    referrer, readyState,
    querySelector: () => existingScript ? {} : null,
    createElement: name => { assert.equal(name, 'script'); return {}; },
    head: { appendChild: script => scripts.push(script) },
    addEventListener: (name, fn, options) => { listeners.push({ name, fn, options }); }
  };
  const window = { document, dataLayer };
  if (existingGtag) window.gtag = () => assert.fail('must not configure another tag');
  const context = vm.createContext({ window, document, location: new URL(url), URL, Date });
  const run = () => vm.runInContext(bootstrap, context);
  const commands = () => Array.from(window.dataLayer || [], entry => Array.from(entry));
  return { window, document, scripts, listeners, run, commands };
}

test('all real public shells and every published KO/EN report receive exactly one tag in response HTML', async () => {
  const files = new Set(STATIC_PUBLIC_PAGES.filter(page => page.file !== '404.html').map(page => page.file));
  for (const lang of ['', 'en/']) {
    for (const slug of ['daily', 'weekly', 'research', 'notes', 'basics']) files.add(`${lang}${slug}/index.html`);
  }
  for (const post of posts) files.add(post.href);
  for (const file of files) {
    const path = file === 'index.html' ? '/' : file.endsWith('/index.html') ? '/' + file.replace(/index\.html$/, '') : '/' + file.replace(/\.html$/, '');
    const response = await render(path, await read(file));
    const html = await response.text();
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-preserve'), 'yes');
    assert.equal([...html.matchAll(marker)].length, 1, path);
    assert.ok(html.indexOf('data-snowshagal-ga4') < html.indexOf('</head>'), path);
    assert.match(html, /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=/, path);
  }
});

test('a future automated publish receives GA4 without touching its uploaded HTML', async () => {
  const future = { id: 'future', type: 'note', lang: 'en', title: 'Future note', reportDate: '2026-10-23', href: 'reports/en/future.html' };
  const html = await (await render('/reports/en/future', shell, { corpus: [...posts, future] })).text();
  assert.equal([...html.matchAll(marker)].length, 1);
  assert.match(html, /data-lang="en"/);
  assert.match(html, /report-shell\.js/);
});

test('Preview, local, admin, APIs, redirects, errors and non-HTML never receive the public tag', async () => {
  for (const options of [
    { origin: 'https://branch.market-research-site.pages.dev' },
    { origin: 'http://localhost:8788' },
    { status: 404 }, { status: 500 }, { status: 302 }, { type: 'application/json' }
  ]) {
    const response = await render('/market/', shell, options);
    assert.doesNotMatch(await response.text(), /data-snowshagal-ga4/);
  }
  for (const path of ['/admin/', '/api/market/latest', '/cdn-cgi/trace']) {
    assert.doesNotMatch(await (await render(path)).text(), /data-snowshagal-ga4/);
  }
  assert.equal(ga4Tag(new URL('https://admin.snowshagal.com/admin/login/')), '');
});

test('one async official loader and one automatic pageview config survive repeated initialization', () => {
  const page = browser();
  page.run(); page.run();
  assert.equal(page.scripts.length, 1);
  assert.equal(page.scripts[0].async, true);
  assert.equal(page.scripts[0].src, `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`);
  assert.equal(page.scripts[0].referrerPolicy, 'strict-origin');
  assert.equal(page.commands().filter(command => command[0] === 'config').length, 1);
  assert.equal(page.commands().find(command => command[0] === 'config')[2].send_page_view, true);
  assert.equal(page.commands().filter(command => command[0] === 'event').length, 0);
  assert.equal(page.listeners.length, 0, 'no custom history, input, comment or click tracking');
});

test('queries, fragments, search terms, referrer paths and advertising signals are not passed to gtag', () => {
  const page = browser(); page.run();
  const settings = page.commands().find(command => command[0] === 'set')[1];
  assert.equal(settings.page_location, 'https://snowshagal.com/reports/example');
  assert.equal(settings.page_referrer, 'https://www.google.com/');
  assert.equal(settings.allow_google_signals, false);
  assert.equal(settings.allow_ad_personalization_signals, false);
  assert.doesNotMatch(JSON.stringify(page.commands()), /reader|secret|private|user_id|user_properties|search_term|token/);
  for (const referrer of ['', 'javascript:alert(1)', 'not a URL', 'https://user:password@example.com/private?email=secret#private']) {
    const other = browser({ referrer }); other.run();
    assert.doesNotMatch(JSON.stringify(other.commands()), /password|secret|private|alert/);
  }
});

test('existing Google tag, GTM or queued config prevents a second installation, including body tags', () => {
  for (const options of [
    { existingScript: true }, { existingGtag: true },
    { dataLayer: [['config', 'G-EXISTING']] }, { dataLayer: [{ 'gtm.start': 123 }] }
  ]) {
    const page = browser(options); page.run();
    assert.equal(page.scripts.length, 0);
    assert.equal(page.window.__snowshagalGA4, undefined);
  }
  const page = browser({ readyState: 'loading' });
  page.run(); page.run();
  assert.equal(page.scripts.length, 0);
  assert.equal(page.listeners[0].name, 'DOMContentLoaded');
  assert.equal(page.listeners[0].options.once, true);
  for (const listener of page.listeners) listener.fn();
  assert.equal(page.scripts.length, 1);
});

test('client guard also rejects Preview and private origins even if someone copies the snippet', () => {
  for (const url of ['http://snowshagal.com/', 'https://preview.pages.dev/', 'http://localhost/', 'https://admin.snowshagal.com/', 'https://snowshagal.com/admin/', 'https://snowshagal.com/api/market/latest']) {
    const page = browser({ url }); page.run();
    assert.equal(page.scripts.length, 0, url);
    assert.equal(page.commands().length, 0, url);
  }
});

test('string injection is idempotent and the streaming middleware uses the identical bootstrap', async () => {
  const tag = ga4Tag(new URL('https://snowshagal.com/'));
  const once = appendGa4ToHtml(shell, tag);
  assert.equal(appendGa4ToHtml(once, tag), once);
  const appended = [];
  const removed = [];
  globalThis.HTMLRewriter = class {
    constructor() { this.handlers = []; }
    on(selector, handler) { this.handlers.push([selector, handler]); return this; }
    transform(response) {
      for (const [selector, handler] of this.handlers) {
        if (selector === 'head') handler.element({ append: html => appended.push(html) });
        if (selector === 'script[data-snowshagal-ga4]') handler.element({ remove: () => removed.push(true) });
      }
      return response;
    }
  };
  try {
    for (const path of ['/market/', '/reports/future']) {
      appended.length = 0;
      await render(path);
      assert.equal(appended.filter(html => html === tag).length, 1, path);
    }
    assert.equal(removed.length, 2);
  } finally {
    delete globalThis.HTMLRewriter;
  }
});
