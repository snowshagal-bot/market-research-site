// The middleware's string fallback (Node and tests, where HTMLRewriter does
// not exist) must remove exactly what the Production HTMLRewriter selectors
// remove, whatever the attribute order or quoting of the uploaded report.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequest as middleware, REPORT_NAV_SPACER, removeTags, tagAttributes } from '../functions/_middleware.js';
import { FAVICON_TAGS, findTranslationCounterpart, postLanguage, reportSiteUrl } from '../functions/_seo.js';

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

test('report response includes visible clean reading links before any shell script executes', async () => {
  for (const lang of ['ko', 'en']) {
    const posts = REAL_POSTS.filter(post => post.type === 'basics' && postLanguage(post) === lang);
    const post = posts[Math.floor(posts.length / 2)];
    const html = await render(post, withHead(''), REAL_POSTS);
    const nav = html.match(/<nav id="mrs-reading-nav"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav, lang);
    assert.match(nav, /<a href="\/reports\/[^"?]+" rel="prev">/);
    assert.match(nav, /<a href="\/reports\/[^"?]+" rel="next">/);
    assert.doesNotMatch(nav, /\.html["?]|\shidden\b/);
    assert.ok(html.indexOf(nav) < html.indexOf('<script src="/assets/report-shell.js'));
  }
});

test('paired archived reports link to each other in the initial footer and head', async () => {
  const lessons = REAL_POSTS.filter(post => /\/Market_Language_Ep[123]_/.test(post.href));
  assert.equal(lessons.length, 3);
  const daily = REAL_POSTS.find(post => post.id === '2026-08-20-daily-1ctu7fr');
  assert.equal(findTranslationCounterpart(REAL_POSTS, daily)?.id, '2026-08-20-daily-c6eow2');
  for (const english of [...lessons, daily]) {
    const korean = findTranslationCounterpart(REAL_POSTS, english);
    assert.ok(korean, english.href);
    for (const [source, target] of [[english, korean], [korean, english]]) {
      const html = await render(source, withHead(''), REAL_POSTS);
      const footer = html.match(/<footer id="site-footer"[\s\S]*?<\/footer>/)?.[0] || '';
      const url = new URL(reportSiteUrl(target.href));
      const language = postLanguage(target);
      assert.ok(footer.includes(`href="${url.pathname}" hreflang="${language}" lang="${language}"`), source.href);
      assert.ok(headOf(html).includes(`hreflang="${language}" href="${url.href}"`), source.href);
    }
  }

  const unpaired = await render(POST, withHead(''));
  assert.ok(unpaired.includes('<a href="/en/">English</a>'));
  assert.doesNotMatch(unpaired, /English version/);
});

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
  // The site writes the page's structured data itself.
  ['N1', '<script type="application/ld+json">{"@type":"Article","name":"old-n1"}</script>', true],
  ['N2', `<script id='ld' type='application/ld+json'>[{"name":"old-n2"}]</script>`, true],
  ['N3', '<SCRIPT TYPE="application/ld+json">{"name":"old-n3"}</SCRIPT>', true],
  ['M1', '<meta name="keywords" content="keep-m1">', false],
  ['M2', '<meta content="keep-m2" name="author">', false],
  ['M3', '<link href="/keep-m3.css" rel="stylesheet">', false],
  ['M4', '<link rel="preconnect" href="https://keep-m4.example">', false],
  ['M5', '<meta property="article:section" content="keep-m5">', false],
  ['M6', '<link rel="alternate" href="/keep-m6.pdf" type="application/pdf">', false],
  ['M7', '<meta name="description-extra" content="keep-m7">', false],
  ['M8', '<script type="application/json">{"name":"keep-m8"}</script>', false],
  ['M9', '<script>window.keepM9 = "keep-m9";</script>', false]
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
  assert.equal(count(/application\/ld\+json/g), 1);
});

// A replacement *string* would read these as patterns: "$&" is the match
// ("</head>"), "$'" and "$`" the rest of the page after and before it, "$$" one
// "$". Post text is inserted with callbacks, so all of them stay literal.
const DOLLAR_TEXT = "$1 $2 $& $' $` $$ $1tn";
const decodeText = text => String(text)
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const countOf = (html, needle) => html.split(needle).length - 1;

test('$-patterns in report titles stay literal in the head, structured data and reading links', async () => {
  const series = ['2026-09-01', '2026-09-02', '2026-09-03'].map((date, index) => ({
    ...POST, id: `dollar-${index}`, lang: 'en', reportDate: date, date,
    title: `Report ${index} ${DOLLAR_TEXT}`, href: `reports/en/dollar-${index}.html`
  }));
  const source = withHead('');
  const html = await render(series[1], source, series);
  for (const tag of ['<head>', '</head>', '<body>', '</body>', '</html>', '<p>body</p>']) {
    assert.equal(countOf(html, tag), countOf(source, tag), tag);
  }
  const head = headOf(html);
  assert.ok(decodeText(/<title>([\s\S]*?)<\/title>/.exec(head)[1]).includes(`Report 1 ${DOLLAR_TEXT}`));
  assert.ok(decodeText(/<meta property="og:title" content="([^"]*)"/.exec(head)[1]).includes(`Report 1 ${DOLLAR_TEXT}`));
  const structured = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)[1];
  assert.ok(JSON.stringify(JSON.parse(structured)).includes(`Report 1 ${DOLLAR_TEXT}`));
  const nav = decodeText(html.match(/<nav id="mrs-reading-nav"[\s\S]*?<\/nav>/)[0]);
  assert.ok(nav.includes(`<strong>Report 0 ${DOLLAR_TEXT}</strong>`));
  assert.ok(nav.includes(`<strong>Report 2 ${DOLLAR_TEXT}</strong>`));
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
      // The site's one structured-data block, whatever the report carried.
      structuredData: [(html.match(/application\/ld\+json/g) || []).length, 1],
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

test('a Daily report links to its session’s market page only when that close is published', async () => {
  const payload = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const date = payload.meta.market_date;
  // A D1 that holds one final Market Close, for `date`.
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() {
          if (/FROM sqlite_master/.test(sql)) return { table_sql: 'CREATE TABLE market_close_snapshots (takeaway_ko TEXT, takeaway_en TEXT)', has_index: 1 };
          if (/WHERE market_date = \?/.test(sql)) return args[0] === date ? { market_date: date, payload_json: JSON.stringify(payload), takeaway_ko: '', takeaway_en: '' } : null;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true }; }
      };
    }
  };
  const daily = { id: 'daily-x', type: 'daily', lang: 'ko', title: '데일리', reportDate: date, date, registeredAt: `${date}T09:00:00.000Z`, description: '설명', href: 'reports/daily-x.html' };
  const english = { ...daily, id: 'daily-x-en', lang: 'en', title: 'Daily', href: 'reports/en/daily-x.html' };
  const unpublished = { ...daily, id: 'daily-y', reportDate: '2026-08-31', date: '2026-08-31', href: 'reports/daily-y.html' };
  const note = { ...daily, id: 'note-x', type: 'note', href: 'reports/note-x.html' };
  const posts = [daily, english, unpublished, note];
  const page = async (post, withDb = true) => {
    const request = new Request(new URL(`/${post.href.replace(/\.html$/i, '')}`, 'https://snowshagal.com'));
    const response = await middleware({
      request,
      env: { ...env(posts), ...(withDb ? { COMMENTS_DB: db } : {}) },
      next: async () => new Response(withHead(''), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    });
    return response.text();
  };

  const ko = await page(daily);
  const nav = ko.match(/<nav id="mrs-reading-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav, 'reading nav');
  assert.match(nav, new RegExp(`<a href="/market/${date}/" data-market-session="${date}">`));
  // In the raw HTML, before the shell script that replaces the nav.
  assert.ok(ko.indexOf('data-market-session=') < ko.indexOf('<script src="/assets/report-shell.js'));
  assert.match(await page(english), new RegExp(`<a href="/en/market/${date}/" data-market-session="${date}">`));

  // No record for that date, no database, or not a Daily: no session link.
  assert.doesNotMatch(await page(unpublished), /data-market-session=/);
  assert.doesNotMatch(await page(daily, false), /data-market-session=/);
  assert.doesNotMatch(await page(note), /data-market-session=/);
});

test('the top bar spacer is in the first HTML, so the report never drops when the shell arrives', async () => {
  // report-shell.js runs at the end of the body. When it created the 52 px
  // spacer itself, a visitor without the script cached saw the report paint
  // and then move down 52 px (Web Analytics CLS up to 1.33 on report pages).
  const shellSource = await read('assets/report-shell.js');
  const barHeight = Number(shellSource.match(/const BAR_H = (\d+);/)?.[1]);
  assert.equal(barHeight, 52);
  assert.match(REPORT_NAV_SPACER, new RegExp(`height:${barHeight}px!important`));
  assert.match(REPORT_NAV_SPACER, /^<div id="mrs-nav-spacer" aria-hidden="true"/);

  const source = '<!doctype html><html lang="ko"><head><title>old</title></head><body class="report" data-note=\'a>b\'><header class="top">report</header><p>body</p></body></html>';
  const html = await render(POST, source);
  const bodyOpen = html.match(/<body\b(?:[^>"']|"[^"]*"|'[^']*')*>/)?.[0];
  assert.equal(bodyOpen, '<body class="report" data-note=\'a>b\'>');
  assert.ok(html.includes(`${bodyOpen}${REPORT_NAV_SPACER}<header class="top">`), 'first child of <body>');
  assert.equal(html.split('id="mrs-nav-spacer"').length - 1, 1, 'exactly once');
  assert.ok(html.indexOf(REPORT_NAV_SPACER) < html.indexOf('<script src="/assets/report-shell.js'));

  // The shell takes the server's node instead of adding a second one.
  const mount = shellSource.slice(shellSource.indexOf('function mountReportNav'), shellSource.indexOf('function resolveReportLanguageLink'));
  assert.match(mount, /let spacer = document\.getElementById\('mrs-nav-spacer'\);\s*if \(!spacer\) \{/);
});

test('the streaming middleware prepends the same spacer to <body>', async () => {
  const prepended = [];
  const appended = [];
  globalThis.HTMLRewriter = class {
    constructor() { this.handlers = []; }
    on(selector, handler) { this.handlers.push([selector, handler]); return this; }
    transform(response) {
      for (const [selector, handler] of this.handlers) {
        if (selector === 'body') handler.element({ prepend: (html, options) => prepended.push([html, options]), append: html => appended.push(html) });
      }
      return response;
    }
  };
  try {
    await render(POST, withHead(''));
    assert.deepEqual(prepended, [[REPORT_NAV_SPACER, { html: true }]]);
    assert.equal(appended.length, 1);
    assert.match(appended[0], /<script src="\/assets\/report-shell\.js/);
  } finally {
    delete globalThis.HTMLRewriter;
  }
});
