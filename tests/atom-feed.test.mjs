import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ATOM_CONTENT_TYPE,
  FEED_LIMIT,
  FEED_PATHS,
  atomDateAtKst,
  atomFeedXml,
  atomTimestamp,
  entryDates,
  entrySummary,
  feedDiscoveryTag,
  feedEntries,
  feedUnavailable,
  xmlText
} from '../functions/_feed.js';
import { onRequestGet as koFeed } from '../functions/rss.xml.js';
import { onRequestGet as enFeed } from '../functions/en/rss.xml.js';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';
import { siteFooter } from '../functions/_footer.js';
import { postLanguage, reportDescription, reportSiteUrl } from '../functions/_seo.js';
import { STATIC_FEED_PAGES, withFeedLink } from '../scripts/sync-static-feed-links.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(path.join(rootDir, rel), 'utf8');
const ATOM_LINK = /<link\b[^>]*type="application\/atom\+xml"[^>]*>/g;
const count = (html, re) => (html.match(re) || []).length;

const post = (id, extra = {}) => ({
  id, type: 'daily', lang: 'ko', title: `제목 ${id}`, description: `설명 ${id}`, reportDate: '2026-09-04',
  registeredDate: '2026-09-04', registeredAt: '2026-09-04T09:00:00.000Z', href: `reports/${id}.html`, ...extra
});
const entriesOf = xml => xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
const idsOf = xml => entriesOf(xml).map(e => e.match(/<id>([^<]*)<\/id>/)[1]);

/* ----------------------------------------------------------------- document */

test('KO feed: Atom root, self/alternate links, stable id, language, author', () => {
  const xml = atomFeedXml([post('a')], 'ko');
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ko">'));
  assert.match(xml, /<title>Snowshagal — 최신 리포트<\/title>/);
  assert.match(xml, /<id>https:\/\/snowshagal\.com\/rss\.xml<\/id>/);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/snowshagal\.com\/rss\.xml"\/>/);
  assert.match(xml, /<link rel="alternate" href="https:\/\/snowshagal\.com\/"\/>/);
  assert.match(xml, /<author><name>Snowshagal<\/name><\/author>/);
  assert.doesNotMatch(xml, /<!\[CDATA\[/);
  assert.ok(xml.endsWith('</feed>\n'));
});

test('EN feed: its own title, id, self and alternate, xml:lang="en"', () => {
  const xml = atomFeedXml([post('b', { lang: 'en', href: 'reports/en/b.html' })], 'en');
  assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom" xml:lang="en">/);
  assert.match(xml, /<title>Snowshagal — Latest Reports<\/title>/);
  assert.match(xml, /<id>https:\/\/snowshagal\.com\/en\/rss\.xml<\/id>/);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/snowshagal\.com\/en\/rss\.xml"\/>/);
  assert.match(xml, /<link rel="alternate" href="https:\/\/snowshagal\.com\/en\/"\/>/);
});

test('the feed <updated> is the newest entry update, never the request time; an empty feed has a fixed one', () => {
  const posts = [post('old', { registeredAt: '2026-08-01T00:00:00Z' }), post('new', { registeredAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' })];
  assert.match(atomFeedXml(posts, 'ko'), /<author>[\s\S]*?<\/author>/);
  assert.match(atomFeedXml(posts, 'ko').split('<entry>')[0], /<updated>2026-09-02T00:00:00Z<\/updated>/);
  const empty = atomFeedXml([], 'ko');
  assert.match(empty, /<updated>2026-08-09T00:00:00\+09:00<\/updated>/);
  assert.equal(entriesOf(empty).length, 0);
  assert.equal(atomFeedXml([], 'ko'), atomFeedXml([], 'ko'), 'deterministic');
});

/* ---------------------------------------------------------- item selection */

test('language filtering follows postLanguage: missing lang is Korean, en goes only to the EN feed', () => {
  const posts = [post('ko1'), post('nolang', { lang: undefined }), post('en1', { lang: 'en', href: 'reports/en/en1.html' })];
  assert.equal(postLanguage(posts[1]), 'ko');
  assert.deepEqual(idsOf(atomFeedXml(posts, 'ko')).map(u => u.split('/').pop()), ['ko1', 'nolang']);
  assert.deepEqual(idsOf(atomFeedXml(posts, 'en')).map(u => u.split('/').pop()), ['en1']);
});

test('only reports/*.html posts are feed items', () => {
  const posts = [post('ok'), post('nohref', { href: '' }), post('page', { href: 'about/index.html' }), post('dir', { href: 'reports/' })];
  assert.deepEqual(idsOf(atomFeedXml(posts, 'ko')).map(u => u.split('/').pop()), ['ok']);
});

test(`at most ${FEED_LIMIT} items, the newest registrations`, () => {
  const posts = Array.from({ length: FEED_LIMIT + 7 }, (_, i) => post(`p${String(i).padStart(2, '0')}`, { registeredAt: `2026-07-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`, updatedAt: undefined }));
  const entries = feedEntries(posts, 'ko');
  assert.equal(entries.length, FEED_LIMIT);
  assert.equal(entriesOf(atomFeedXml(posts, 'ko')).length, FEED_LIMIT);
  const kept = new Set(entries.map(e => e.post.id));
  const dropped = posts.filter(p => !kept.has(p.id));
  const oldestKept = Math.min(...entries.map(e => e.publishedAt));
  assert.ok(dropped.every(p => Date.parse(p.registeredAt) <= oldestKept), 'everything dropped is at least as old as everything kept');
});

/* ------------------------------------------------------------------- dates */

test('published prefers registeredAt, then registeredDate read as Korean midnight; reportDate is never used', () => {
  assert.equal(entryDates(post('a')).published, '2026-09-04T09:00:00Z');
  assert.equal(entryDates(post('b', { registeredAt: undefined, registeredDate: '2026-08-10', reportDate: '2026-07-06' })).published, '2026-08-10T00:00:00+09:00');
  assert.equal(entryDates(post('c', { registeredAt: 'not a time', registeredDate: '2026-08-10' })).published, '2026-08-10T00:00:00+09:00');
  assert.equal(entryDates(post('d', { registeredAt: undefined, registeredDate: undefined, reportDate: '2026-07-06' })), null, 'no registration: skipped, not dated from reportDate');
  assert.equal(entryDates(post('e', { registeredAt: '', registeredDate: '2026-02-30', reportDate: '2026-07-06' })), null, 'an impossible date is not a date');
  const xml = atomFeedXml([post('d', { registeredAt: undefined, registeredDate: undefined, reportDate: '2026-07-06' }), post('ok')], 'ko');
  assert.equal(entriesOf(xml).length, 1);
  assert.doesNotMatch(xml, /2026-07-06T/);
});

test('updated is updatedAt when valid and not before published, otherwise published', () => {
  assert.equal(entryDates(post('a', { updatedAt: '2026-09-05T01:02:03Z' })).updated, '2026-09-05T01:02:03Z');
  assert.equal(entryDates(post('b', { updatedAt: undefined })).updated, '2026-09-04T09:00:00Z');
  assert.equal(entryDates(post('c', { updatedAt: 'garbage' })).updated, '2026-09-04T09:00:00Z');
  assert.equal(entryDates(post('d', { updatedAt: '2026-01-01T00:00:00Z' })).updated, '2026-09-04T09:00:00Z', 'never earlier than published');
  for (const e of feedEntries([post('a', { updatedAt: '2026-09-05T01:02:03Z' }), post('d', { updatedAt: '2026-01-01T00:00:00Z' })], 'ko')) {
    assert.ok(Date.parse(e.updated) >= Date.parse(e.published));
  }
});

test('timestamps are RFC 3339', () => {
  assert.equal(atomTimestamp('2026-09-04T09:12:33.987Z'), '2026-09-04T09:12:33Z');
  assert.equal(atomTimestamp('2026-09-04T18:12:33+09:00'), '2026-09-04T09:12:33Z');
  assert.equal(atomTimestamp('2026-09-04'), null);
  assert.equal(atomDateAtKst('2026-09-04'), '2026-09-04T00:00:00+09:00');
  assert.equal(atomDateAtKst('2026-9-4'), null);
  const xml = atomFeedXml([post('a'), post('b', { registeredAt: undefined })], 'ko');
  for (const m of xml.matchAll(/<(published|updated)>([^<]*)<\/\1>/g)) assert.match(m[2], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|\+09:00)$/, m[2]);
});

/* --------------------------------------------------------------- ordering */

test('entries are ordered by published DESC, not by reportDate, with a deterministic tie-break', () => {
  const posts = [
    post('older-report-registered-today', { reportDate: '2026-07-06', registeredAt: '2026-09-05T00:00:00Z' }),
    post('newer-report-registered-earlier', { reportDate: '2026-09-04', registeredAt: '2026-09-04T00:00:00Z' }),
    post('tie-b', { registeredAt: '2026-09-01T00:00:00Z' }),
    post('tie-a', { registeredAt: '2026-09-01T00:00:00Z' })
  ];
  const order = idsOf(atomFeedXml(posts, 'ko')).map(u => u.split('/').pop());
  assert.deepEqual(order, ['older-report-registered-today', 'newer-report-registered-earlier', 'tie-a', 'tie-b']);
  assert.equal(atomFeedXml(posts, 'ko'), atomFeedXml([...posts].reverse(), 'ko'), 'input order does not matter');
});

/* --------------------------------------------------------------- entries */

test('entry id and link are the canonical report URL without .html; title is the post title', () => {
  const p = post('x', { href: 'reports/9월 4일 주식리포트_통합.html', title: '받침보다 무거운 날' });
  const xml = atomFeedXml([p], 'ko');
  const canonical = reportSiteUrl(p.href);
  assert.equal(canonical, 'https://snowshagal.com/reports/9%EC%9B%94%204%EC%9D%BC%20%EC%A3%BC%EC%8B%9D%EB%A6%AC%ED%8F%AC%ED%8A%B8_%ED%86%B5%ED%95%A9');
  assert.ok(xml.includes(`<id>${canonical}</id>`));
  assert.ok(xml.includes(`<link rel="alternate" href="${canonical}"/>`));
  assert.doesNotMatch(xml, /\.html/);
  assert.match(xml, /<title>받침보다 무거운 날<\/title>/);
  assert.match(xml, /<category term="daily" label="한국 주식시장 데일리 리포트"\/>/);
});

test('summary is reportDescription with the report date in front, only when there is one', () => {
  const p = post('s', { summary: '요약 문장.' });
  assert.equal(entrySummary(p, 'ko'), `기준일 2026-09-04 · ${reportDescription(p)}`);
  assert.equal(entrySummary({ ...p, lang: 'en', href: 'reports/en/s.html' }, 'en'), `Report date 2026-09-04 · ${reportDescription({ ...p, lang: 'en' })}`);
  assert.equal(entrySummary({ ...p, reportDate: undefined }, 'ko'), reportDescription({ ...p, reportDate: undefined }));
  assert.equal(entrySummary({ ...p, reportDate: '2026-13-40' }, 'ko'), reportDescription({ ...p, reportDate: '2026-13-40' }));
  const noSummary = post('t', { summary: undefined, description: '설명만 있는 글' });
  assert.match(atomFeedXml([noSummary], 'ko'), /<summary type="text">기준일 2026-09-04 · [^<]*설명만 있는 글[^<]*<\/summary>/);
});

/* ------------------------------------------------------------- XML safety */

test('xmlText escapes the five XML characters and drops what XML 1.0 forbids', () => {
  assert.equal(xmlText('a & b < c > "d" \'e\''), 'a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;');
  assert.equal(xmlText('x yz'), 'xyz');
  assert.equal(xmlText('tab\tnl\ncr\r ok'), 'tab\tnl\ncr\r ok', 'tab, newline and return are allowed');
  assert.equal(xmlText('del c1 end￾￿'), 'del c1 end');
  assert.equal(xmlText('lone\uD800 high, lone\uDC00 low, pair 😀'), 'lone high, lone low, pair 😀');
  assert.equal(xmlText(null), '');
});

test('titles, summaries, categories and URLs are all sanitized in the document', () => {
  const p = post('q', { title: 'A & B <"C">', summary: 'S <b>bold</b> & ', type: 'daily"x' });
  const xml = atomFeedXml([p], 'ko');
  assert.match(xml, /<title>A &amp; B &lt;&quot;C&quot;&gt;<\/title>/);
  assert.match(xml, /<summary type="text">[^<]*S &lt;b&gt;bold&lt;\/b&gt; &amp; [^<]*<\/summary>/);
  assert.match(xml, /<category term="daily&quot;x"\/>/);
  assert.doesNotMatch(xml, /[ -]/);
  assert.equal(count(xml, /<(?!\/?(?:feed|title|id|link|updated|author|name|entry|published|category|summary)\b)[a-z?]/g), 1, 'only the XML declaration and Atom elements open a tag');
});

/* --------------------------------------------------------------- endpoints */

const envWith = posts => ({ ASSETS: { fetch: async () => Response.json(posts) } });
const req = url => new Request(url);

test('/rss.xml and /en/rss.xml respond as Atom with a 5 minute cache and nosniff', async () => {
  const posts = [post('ko1'), post('en1', { lang: 'en', href: 'reports/en/en1.html' })];
  const ko = await koFeed({ request: req('https://snowshagal.com/rss.xml'), env: envWith(posts) });
  assert.equal(ko.status, 200);
  assert.equal(ko.headers.get('content-type'), ATOM_CONTENT_TYPE);
  assert.equal(ko.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(ko.headers.get('x-content-type-options'), 'nosniff');
  const koXml = await ko.text();
  assert.equal(koXml, atomFeedXml(posts, 'ko'));
  const en = await enFeed({ request: req('https://snowshagal.com/en/rss.xml'), env: envWith(posts) });
  assert.equal(en.headers.get('content-type'), ATOM_CONTENT_TYPE);
  assert.equal(await en.text(), atomFeedXml(posts, 'en'));
});

test('a posts.json that cannot be read is a 503 that says nothing about why', async () => {
  const failing = { ASSETS: { fetch: async () => new Response('boom', { status: 500 }) } };
  for (const handler of [koFeed, enFeed]) {
    const res = await handler({ request: req('https://snowshagal.com/rss.xml'), env: failing });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const text = await res.text();
    assert.equal(text, 'Feed is temporarily unavailable.');
    assert.doesNotMatch(text, /POSTS_FETCH|Error|at /);
  }
  const unavailable = feedUnavailable();
  assert.equal(unavailable.status, 503);
});

/* --------------------------------------------------------------- discovery */

test('feedDiscoveryTag is one relative Atom link per language', () => {
  assert.equal(feedDiscoveryTag('ko'), '<link rel="alternate" type="application/atom+xml" title="Snowshagal (KO)" href="/rss.xml">');
  assert.equal(feedDiscoveryTag('en'), '<link rel="alternate" type="application/atom+xml" title="Snowshagal (EN)" href="/en/rss.xml">');
  assert.equal(feedDiscoveryTag(undefined), feedDiscoveryTag('ko'));
  assert.deepEqual(FEED_PATHS, { ko: '/rss.xml', en: '/en/rss.xml' });
});

test('every static public page carries exactly its own language\'s feed link and keeps its hreflang links', async () => {
  for (const { file, lang } of STATIC_FEED_PAGES) {
    const html = await read(file);
    const links = html.match(ATOM_LINK) || [];
    assert.equal(links.length, 1, `${file}: ${links.length} Atom links`);
    assert.equal(links[0], feedDiscoveryTag(lang), file);
    if (file !== '404.html') assert.ok(count(html, /<link rel="alternate" hreflang=/g) >= 3, `${file}: hreflang links kept`);
    assert.equal(withFeedLink(html, lang), html, `${file}: the sync is idempotent`);
  }
});

test('every category landing carries exactly its own language\'s feed link', async () => {
  for (const type of ['daily', 'weekly', 'research', 'basics', 'notes']) {
    for (const [file, lang] of [[`${type}/index.html`, 'ko'], [`en/${type}/index.html`, 'en']]) {
      const html = await read(file);
      const links = html.match(ATOM_LINK) || [];
      assert.equal(links.length, 1, `${file}: ${links.length} Atom links`);
      assert.equal(links[0], feedDiscoveryTag(lang), file);
      assert.match(html, /<link rel="canonical" href="[^"]+">\n<link rel="alternate" type="application\/atom\+xml"/, `${file}: right after canonical`);
    }
  }
});

test('withFeedLink removes any Atom link already there and writes exactly one back, keeping the file\'s line endings', () => {
  const crlf = '<!doctype html>\r\n<html><head>\r\n<link rel="canonical" href="https://snowshagal.com/">\r\n<link rel="alternate" hreflang="ko" href="https://snowshagal.com/">\r\n</head><body></body></html>';
  const once = withFeedLink(crlf, 'ko');
  assert.equal(count(once, ATOM_LINK), 1);
  assert.ok(once.includes('<link rel="canonical" href="https://snowshagal.com/">\r\n' + feedDiscoveryTag('ko') + '\r\n<link rel="alternate" hreflang="ko"'));
  assert.equal(withFeedLink(once, 'ko'), once);
  assert.equal(withFeedLink(withFeedLink(once, 'en'), 'ko'), once, 'a stale link of the other language is replaced, not added to');
  const stale = crlf.replace('</head>', '<link rel="alternate" type="application/atom+xml" title="old" href="/old.xml">\r\n<link rel="alternate" type="application/atom+xml" title="old2" href="/old2.xml">\r\n</head>');
  assert.equal(count(withFeedLink(stale, 'ko'), ATOM_LINK), 1);
  assert.doesNotMatch(withFeedLink(stale, 'ko'), /old\.xml|old2\.xml/);
  const noCanonical = '<html><head><title>t</title></head><body></body></html>';
  assert.equal(withFeedLink(noCanonical, 'en'), `<html><head><title>t</title>${feedDiscoveryTag('en')}\n</head><body></body></html>`);
});

test('the middleware gives a report exactly one feed link for its language, keeps hreflang it adds, and drops any the upload carried', async () => {
  const uploaded = '<!doctype html><html><head><title>Sample</title><link rel="alternate" type="application/atom+xml" title="stale" href="/stale.xml"><link rel="alternate" hreflang="ko" href="https://snowshagal.com/reports/sample"></head><body><p>Body</p></body></html>';
  const next = async () => new Response(uploaded, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  for (const [pathname, lang] of [['/reports/sample.html', 'ko'], ['/reports/en/sample.html', 'en']]) {
    const res = await middlewareRequest({ request: new Request(`https://snowshagal.com${pathname}`), next, env: {} });
    const html = await res.text();
    const links = html.match(ATOM_LINK) || [];
    assert.equal(links.length, 1, `${pathname}: ${links.length} Atom links`);
    assert.equal(links[0], feedDiscoveryTag(lang), pathname);
    assert.doesNotMatch(html, /stale\.xml/);
    assert.ok(html.indexOf(links[0]) < html.indexOf('</head>'), 'in the head');
    assert.ok(html.indexOf(links[0]) < html.indexOf('<style id="site-footer-css">'), 'before the footer style, with the other head tags');
  }
});

test('hreflang links added by the middleware survive next to the feed link on a report the site knows', async () => {
  const posts = [post('known', { href: 'reports/known.html', translationGroup: 'g' }), post('known-en', { lang: 'en', href: 'reports/en/known-en.html', translationGroup: 'g' })];
  const uploaded = '<!doctype html><html><head><title>Known</title></head><body><p>Body</p></body></html>';
  const next = async () => new Response(uploaded, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const res = await middlewareRequest({ request: new Request('https://snowshagal.com/reports/known.html'), next, env: envWith(posts) });
  const html = await res.text();
  assert.equal(count(html, ATOM_LINK), 1);
  assert.ok(count(html, /<link rel="alternate" hreflang=/g) >= 2, 'hreflang pair present');
});

test('admin pages and API routes carry no feed discovery link', async () => {
  for (const file of ['admin/index.html', 'admin/manage/index.html', 'admin/market/index.html', 'admin/analytics/index.html', 'admin/login/index.html']) {
    try { assert.equal(count(await read(file), ATOM_LINK), 0, file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const next = async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  const res = await middlewareRequest({ request: new Request('https://snowshagal.com/api/posts'), next, env: {} });
  assert.equal(count(await res.text(), ATOM_LINK), 0);
});

/* ------------------------------------------------------------------ footer */

test('the footer has a fourth group, Follow, whose only link is the language\'s Atom feed', () => {
  for (const [lang, heading, aria, href] of [['ko', '팔로우', '푸터 팔로우 메뉴', '/rss.xml'], ['en', 'Follow', 'Footer Follow menu', '/en/rss.xml']]) {
    const footer = siteFooter(lang);
    assert.equal(count(footer, /class="site-footer-group"/g), 4, `${lang}: four groups`);
    assert.match(footer, new RegExp(`<p class="site-footer-heading" aria-hidden="true">${heading}</p>\\s*<nav class="site-footer-nav" aria-label="${aria}">\\s*<a href="${href}" type="application/atom\\+xml">RSS</a>\\s*</nav>`));
    const order = [...footer.matchAll(/<p class="site-footer-heading" aria-hidden="true">([^<]*)<\/p>/g)].map(m => m[1]);
    assert.deepEqual(order, lang === 'en' ? ['Reports', 'Market', 'Follow', 'Site'] : ['리포트', '마켓', '팔로우', '사이트']);
    assert.doesNotMatch(footer, /coming soon|Email updates|newsletter/i);
  }
});

/* --------------------------------------------------------------- untouched */

test('reports, sitemap and robots are untouched', async () => {
  const status = execSync('git status --porcelain reports/ robots.txt functions/sitemap.xml.js', { cwd: rootDir, encoding: 'utf8' }).trim();
  assert.equal(status, '');
  const { sitemapXml } = await import('../functions/_seo.js');
  assert.doesNotMatch(sitemapXml([post('a')]), /rss\.xml/);
  assert.doesNotMatch(await read('robots.txt'), /rss\.xml/);
});
