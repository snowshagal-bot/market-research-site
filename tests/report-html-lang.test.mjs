// A report page's final <html lang> comes from its post's `lang`, not from
// whatever the uploaded file was written with (four EN dailies shipped with
// lang="ko"). The original files stay untouched; the middleware sets it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequest as middleware, setHtmlLang } from '../functions/_middleware.js';
import { postLanguage } from '../functions/_seo.js';

const ROOT = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const REAL_POSTS = JSON.parse(await read('data/posts.json'));
const TAGS = await read('data/tags.json');

function env(posts) {
  return {
    ASSETS: {
      async fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === '/data/posts.json') return new Response(JSON.stringify(posts), { headers: { 'content-type': 'application/json' } });
        if (pathname === '/data/tags.json') return new Response(TAGS, { headers: { 'content-type': 'application/json' } });
        return new Response('missing', { status: 404 });
      }
    }
  };
}

function cleanPath(post) {
  return `/${post.href.replace(/\.html$/i, '')}`;
}

async function render(post, source, posts = [post]) {
  const request = new Request(new URL(encodeURI(cleanPath(post)), 'https://snowshagal.com'));
  const response = await middleware({
    request,
    env: env(posts),
    next: async () => new Response(source, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
  return response.text();
}

const htmlTag = html => (/<html\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(html) || [''])[0];
const htmlLang = html => (/\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(htmlTag(html)) || []).slice(1).find(Boolean) ?? null;
const dataLang = html => (/report-shell\.js[^"]*" data-category="[^"]*" data-lang="(\w+)"/.exec(html) || [])[1];

function post(overrides) {
  return {
    id: 'p', type: 'daily', lang: 'ko', title: 'Title', reportDate: '2026-08-07', date: '2026-08-07',
    registeredAt: '2026-08-07T00:00:00.000Z', description: 'Description', href: 'reports/p.html', ...overrides
  };
}
const page = htmlOpen => `<!doctype html>${htmlOpen}<head><title>x</title></head><body><h1>Body</h1></body></html>`;

test('A. EN post in a file written with lang="ko" is served as lang="en"', async () => {
  const html = await render(post({ lang: 'en', href: 'reports/en/a.html' }), page('<html lang="ko">'));
  assert.equal(htmlLang(html), 'en');
  assert.equal(dataLang(html), 'en');
});

test('B. KO post in a file written with lang="en" is served as lang="ko"', async () => {
  const html = await render(post({ lang: 'ko', href: 'reports/b.html' }), page("<html lang='en' class=\"x\">"));
  assert.equal(htmlLang(html), 'ko');
  assert.match(htmlTag(html), /class="x"/);
});

test('B2. the post decides even when the URL points the other way', async () => {
  const html = await render(post({ lang: 'ko', href: 'reports/en/looks-english.html' }), page('<html lang="en">'));
  assert.equal(htmlLang(html), 'ko');
});

test('C. a file without lang gets the post language', async () => {
  const ko = await render(post({ lang: 'ko', href: 'reports/c.html' }), page('<html>'));
  assert.equal(htmlTag(ko), '<html lang="ko">');
  const en = await render(post({ lang: 'en', href: 'reports/en/c.html' }), page('<html data-x="1">'));
  assert.equal(htmlLang(en), 'en');
  assert.match(htmlTag(en), /data-x="1"/);
});

test('D-E. a correct file keeps its <html> tag byte for byte', async () => {
  for (const [lang, tag] of [['en', '<html lang="en">'], ['ko', '<html lang="ko" data-theme="light">']]) {
    const html = await render(post({ lang, href: `reports/${lang === 'en' ? 'en/' : ''}d.html` }), page(tag));
    assert.equal(htmlTag(html), tag);
  }
});

test('setHtmlLang replaces any quoting, adds when absent, and leaves xml:lang alone', () => {
  assert.equal(setHtmlLang('<html lang=ko>', 'en'), '<html lang="en">');
  assert.equal(setHtmlLang("<html lang='ko'>", 'en'), '<html lang="en">');
  assert.equal(setHtmlLang('<html LANG="ko" dir="ltr">', 'en'), '<html lang="en" dir="ltr">');
  assert.equal(setHtmlLang('<html xml:lang="ko">', 'en'), '<html lang="en" xml:lang="ko">');
  assert.equal(setHtmlLang('<html>', 'ko'), '<html lang="ko">');
  assert.equal(setHtmlLang('<head></head>', 'ko'), '<head></head>');
});

test('F. the HTMLRewriter path sets the same lang as the string fallback', async () => {
  const cases = [
    [post({ lang: 'en', href: 'reports/en/f.html' }), page('<html lang="ko">')],
    [post({ lang: 'ko', href: 'reports/f.html' }), page('<html lang="en">')],
    [post({ lang: 'en', href: 'reports/en/g.html' }), page('<html>')]
  ];
  for (const [item, source] of cases) {
    const fallback = htmlLang(await render(item, source));
    let rewritten = null;
    globalThis.HTMLRewriter = class {
      constructor() { this.handlers = []; }
      on(selector, handler) { this.handlers.push([selector, handler]); return this; }
      transform(response) {
        for (const [selector, handler] of this.handlers) {
          if (selector === 'html') handler.element({ setAttribute: (name, value) => { if (name === 'lang') rewritten = value; } });
        }
        return response;
      }
    };
    try {
      await render(item, source);
    } finally {
      delete globalThis.HTMLRewriter;
    }
    assert.equal(rewritten, fallback, item.href);
    assert.equal(rewritten, postLanguage(item));
  }
});

test('G. every published report renders with <html lang> = its post language', async () => {
  const mismatches = [];
  const reshaped = [];
  for (const item of REAL_POSTS) {
    const source = await read(item.href);
    const html = await render(item, source, REAL_POSTS);
    if (htmlLang(html) !== postLanguage(item)) mismatches.push(item.id);
    // Only the lang value may change; a file that was already right keeps its tag.
    if (htmlLang(source) === postLanguage(item) && htmlTag(html) !== htmlTag(source)) reshaped.push(item.id);
    // The language that drives the shell, footer and feed is unchanged for
    // every current post: its URL and its metadata agree.
    assert.equal(dataLang(html), /^reports\/en\//i.test(item.href) ? 'en' : 'ko', item.id);
  }
  assert.deepEqual(mismatches, []);
  assert.deepEqual(reshaped, []);
  for (const id of ['2026-08-24-daily-1nyohtr', '2026-08-24-daily-og5aig', '2026-08-06-daily-1d9zin0', '2026-08-07-daily-cjwe8f']) {
    const item = REAL_POSTS.find(candidate => candidate.id === id);
    assert.ok(item, id);
    assert.equal(htmlLang(await read(item.href)), 'ko', `${id}: the uploaded file itself is left as it was`);
    assert.equal(htmlLang(await render(item, await read(item.href), REAL_POSTS)), 'en', id);
  }
});
