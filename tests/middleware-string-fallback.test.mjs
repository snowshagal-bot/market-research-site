// The middleware's string fallback (Node and tests, where HTMLRewriter does
// not exist) must remove exactly what the Production HTMLRewriter selectors
// remove, whatever the attribute order or quoting of the uploaded report.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequest as middleware, removeTags, tagAttributes } from '../functions/_middleware.js';
import { FAVICON_TAGS, findTranslationCounterpart, postLanguage } from '../functions/_seo.js';

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

async function render(post, source, posts = [post]) {
  const request = new Request(new URL(encodeURI(`/${post.href.replace(/\.html$/i, '')}`), 'https://snowshagal.com'));
  const response = await middleware({
    request,
    env: env(posts),
    next: async () => new Response(source, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  });
  return response.text();
}

const POST = {
  id: 'fallback', type: 'research', lang: 'ko', title: '제목', reportDate: '2026-09-01', date: '2026-09-01',
  registeredAt: '2026-09-01T00:00:00.000Z', description: '설명', href: 'reports/fallback.html'
};
const headOf = html => html.slice(0, html.search(/<\/head>/i));
const withHead = head => `<!doctype html><html lang="ko"><head><title>old</title>${head}</head><body><p>body</p></body></html>`;

// Each case: an uploaded tag and whether Production (HTMLRewriter) removes it.
const CASES = [
  ['A', '<meta name="description" content="old-a">', true],
  ['B', '<meta content="old-b" name="description">', true],
  ['B2', "<meta content='old-b2' name='description'/>", true],
  ['C', '<meta property="og:title" content="old-c">', true],
  ['D', '<meta content="old-d" property="og:title">', true],
  ['E', '<meta name="twitter:title" content="old-e">', true],
  ['F', '<meta content="old-f" name="twitter:title">', true],
  ['G', '<link rel="canonical" href="https://example.com/old-g">', true],
  ['H', '<link href="https://example.com/old-h" rel="canonical">', true],
  ['I', '<link hreflang="en" href="https://example.com/old-i" rel="alternate">', true],
  ['J', '<link href="https://example.com/old-j" rel="alternate" hreflang="en">', true],
  ['K', '<link href="/old-k.xml" type="application/atom+xml">', true],
  ['L1', '<link href="/old-l1.ico" rel="icon">', true],
  ['L2', '<link rel="shortcut icon" href="/old-l2.ico">', true],
  ['L3', '<link href="/old-l3.ico" rel="icon shortcut" sizes="any">', true],
  ['L4', '<link href="/old-l4.png" rel="apple-touch-icon">', true],
  ['L5', '<link href="/old-l5.webmanifest" rel="manifest">', true],
  ['L6', '<LINK HREF="/old-l6.ico" REL="icon">', true],
  ['M1', '<meta name="keywords" content="keep-m1">', false],
  ['M2', '<meta content="keep-m2" name="author">', false],
  ['M3', '<link href="/keep-m3.css" rel="stylesheet">', false],
  ['M4', '<link rel="preconnect" href="https://keep-m4.example">', false],
  ['M5', '<meta property="article:section" content="keep-m5">', false],
  ['M6', '<link rel="alternate" href="/keep-m6.pdf" type="application/pdf">', false],
  ['M7', '<meta name="description-extra" content="keep-m7">', false]
];

test('A–M. the string fallback removes the Production-removed tags in any attribute order and keeps the rest', async () => {
  for (const [label, tag, removed] of CASES) {
    const html = await render(POST, withHead(tag));
    const marker = /(?:old|keep)-[a-z0-9]+/.exec(tag)[0];
    assert.equal(html.includes(marker), !removed, `${label}: ${tag}`);
  }
});

test('the replacement metadata is present exactly once after the originals are removed', async () => {
  const head = headOf(await render(POST, withHead(CASES.map(([, tag]) => tag).join(''))));
  const count = pattern => (head.match(pattern) || []).length;
  assert.equal(count(/<title>/g), 1);
  assert.equal(count(/<meta name="description"/g), 1);
  assert.equal(count(/<link rel="canonical"/g), 1);
  assert.equal(count(/<meta property="og:title"/g), 1);
  assert.equal(count(/<meta name="twitter:title"/g), 1);
  assert.equal(count(/type="application\/atom\+xml"/g), 1);
  assert.equal(count(/<link rel="manifest"/g), 1);
  assert.equal(count(/<link rel="apple-touch-icon"/g), 1);
});

test('tagAttributes: quoting, case of names, bare attributes, ">" inside values', () => {
  assert.deepEqual(tagAttributes(' content="a > b" NAME=\'description\' data-x rel=icon /'), {
    content: 'a > b', name: 'description', 'data-x': '', rel: 'icon'
  });
  assert.equal(removeTags('<meta content="x>y" name="description"><p>', 'meta', attrs => attrs.name === 'description'), '<p>');
  assert.equal(removeTags('<metadata><meta name="a">', 'meta', () => true), '<metadata>');
});

test('every published report renders through the string fallback with one set of metadata', async () => {
  const faviconIcons = (FAVICON_TAGS.match(/rel="icon"/g) || []).length;
  const problems = [];
  for (const post of REAL_POSTS) {
    const html = await render(post, await read(post.href), REAL_POSTS);
    const head = headOf(html);
    const count = pattern => (head.match(pattern) || []).length;
    const expectHreflang = findTranslationCounterpart(REAL_POSTS, post) ? 3 : 0;
    const og = [...head.matchAll(/<meta\b[^>]*property="(og:[^"]+)"/g)].map(m => m[1]);
    const twitter = [...head.matchAll(/<meta\b[^>]*name="(twitter:[^"]+)"/g)].map(m => m[1]);
    const checks = {
      title: [count(/<title\b/g), 1],
      description: [count(/<meta\b[^>]*name="description"/g), 1],
      canonical: [count(/<link\b[^>]*rel="canonical"/g), 1],
      hreflang: [count(/<link\b[^>]*hreflang=/g), expectHreflang],
      ogDuplicates: [og.length - new Set(og).size, 0],
      twitterDuplicates: [twitter.length - new Set(twitter).size, 0],
      feed: [count(/type="application\/atom\+xml"/g), 1],
      icon: [count(/<link\b[^>]*rel="(?:[^"]*\s)?icon(?:\s[^"]*)?"/g), faviconIcons],
      appleTouchIcon: [count(/<link\b[^>]*rel="apple-touch-icon"/g), 1],
      manifest: [count(/<link\b[^>]*rel="manifest"/g), 1],
      lang: [(/<html\b[^>]*\blang="([^"]*)"/.exec(html) || [])[1], postLanguage(post)]
    };
    for (const [name, [actual, expected]] of Object.entries(checks)) {
      if (actual !== expected) problems.push(`${post.id} ${name}: ${actual} (expected ${expected})`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the Research/Note reports whose descriptions come content-first render one description', async () => {
  const contentFirst = [];
  for (const post of REAL_POSTS) {
    const source = await read(post.href);
    if (!/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*\bcontent=[^>]*\bname=["']description["']/i.test(source)) continue;
    contentFirst.push(post.id);
    const head = headOf(await render(post, source, REAL_POSTS));
    assert.equal((head.match(/<meta\b[^>]*name="description"/g) || []).length, 1, post.id);
  }
  assert.ok(contentFirst.length > 0, 'the corpus still contains content-first descriptions to guard');
});
