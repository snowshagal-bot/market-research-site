import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { onRequest, reportHeadMeta } from '../functions/_middleware.js';
import {
  kstIsoTime,
  reportDescription,
  reportModifiedTime,
  reportPublishedTime,
  reportSeoTags,
  reportSeoTitle
} from '../functions/_seo.js';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const posts = JSON.parse(await read('data/posts.json'));
const tags = JSON.parse(await read('data/tags.json'));

const daily = {
  id: 'own-meta-daily', type: 'daily', lang: 'ko', title: '반도체 규제에 5,000선 아래로',
  reportDate: '2026-11-18', date: '2026-11-18', registeredAt: '2026-11-18T07:42:05.000Z',
  legacyImport: false, href: 'reports/2026-11-18_Snowshagal_Daily.html', tags: []
};
const facts = {
  kind: 'daily', marketDate: '2026-11-18',
  kospi: { close: 4987.12, pct: -1.2 }, kosdaq: { close: 650.5, pct: -2.1 },
  foreignNet: -1.2e12, institutionNet: 3.4e11
};
const ownTitle = '11월 18일 코스피 4,987.12 마감 · 미국 AI 반도체 규제 | Snowshagal';
const ownDescription = '미국의 AI 반도체 수출 규제 발표로 코스피가 5,000선을 내줬다. 외국인 1.2조원 순매도.';
const takeaway = '미국 AI 반도체 규제가 반도체 대형주를 끌어내렸다';

const metaTag = (property, html) => html.match(new RegExp(`<meta (?:name|property)="${property}" content="([^"]*)">`))?.[1];
const jsonLd = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'].find(n => n['@type'] === 'Article');

test('the report\'s own search title is the <title>, exactly as written', () => {
  assert.equal(reportSeoTitle(daily, { facts, reportMeta: { seoTitle: ownTitle } }), ownTitle);
  const head = reportSeoTags([daily], daily, { facts, reportMeta: { seoTitle: ownTitle } });
  assert.equal(head.match(/<title>([^<]*)<\/title>/)[1], ownTitle);
  assert.equal((head.match(/\| Snowshagal/g) || []).length, 1, 'the brand is not added a second time');
  // og:title, twitter:title and the JSON-LD headline stay the H1.
  assert.equal(metaTag('og:title', head), daily.title);
  assert.equal(metaTag('twitter:title', head), daily.title);
  assert.equal(jsonLd(head).headline, daily.title);
});

test('the report\'s own search description fills every description', () => {
  const head = reportSeoTags([daily], daily, { facts, reportMeta: { seoDescription: ownDescription, takeaway } });
  for (const name of ['description', 'og:description', 'twitter:description']) assert.equal(metaTag(name, head), ownDescription, name);
  assert.equal(jsonLd(head).description, ownDescription);
});

test('without a search description, a Daily or Weekly that names its takeaway opens with it', () => {
  const generated = reportDescription(daily, { facts });
  const led = reportDescription(daily, { facts, reportMeta: { takeaway } });
  assert.ok(led.startsWith(`${takeaway}.`), led);
  assert.ok(led.includes('코스피 4,987.12'), 'the numbers follow');
  assert.notEqual(led, generated);
  assert.ok(generated.startsWith('2026년 11월 18일') || /^\d/.test(generated) || generated.includes('코스피'), 'without the meta the numbers come first, as before');

  const weekly = { ...daily, id: 'own-meta-weekly', type: 'weekly' };
  assert.ok(reportDescription(weekly, { reportMeta: { takeaway } }).startsWith(`${takeaway}.`));
  // Other categories keep their written description.
  const note = posts.find(p => p.type === 'note' && p.description);
  assert.equal(reportDescription(note, { reportMeta: { takeaway } }), reportDescription(note));
});

test('posts whose uploads carry none of the metas render exactly as before', () => {
  for (const post of posts.slice(0, 40)) {
    assert.equal(reportSeoTags(posts, post, { reportMeta: {} }), reportSeoTags(posts, post), post.id);
  }
});

test('datePublished is the upload time in Korean time, with dateModified and the article: metas', () => {
  assert.equal(kstIsoTime('2026-11-18T07:42:05.000Z'), '2026-11-18T16:42:05+09:00');
  assert.equal(reportPublishedTime(daily), '2026-11-18T16:42:05+09:00');
  assert.equal(reportModifiedTime(daily), '2026-11-18T16:42:05+09:00');
  const edited = { ...daily, updatedAt: '2026-11-19T01:00:00.000Z' };
  assert.equal(reportModifiedTime(edited), '2026-11-19T10:00:00+09:00');

  const head = reportSeoTags([edited], edited, { facts });
  const article = jsonLd(head);
  assert.equal(article.datePublished, '2026-11-18T16:42:05+09:00');
  assert.equal(article.dateModified, '2026-11-19T10:00:00+09:00');
  assert.equal(metaTag('article:published_time', head), article.datePublished);
  assert.equal(metaTag('article:modified_time', head), article.dateModified);

  // An upload weeks after its report date, or an import, keeps the plain report date.
  assert.equal(reportPublishedTime({ ...daily, registeredAt: '2026-12-20T00:00:00.000Z' }), '2026-11-18');
  assert.equal(reportPublishedTime({ ...daily, legacyImport: true }), '2026-11-18');
  assert.equal(reportPublishedTime({ ...daily, registeredAt: undefined }), '2026-11-18');
  // Every post has a parseable datePublished on or after its report date.
  for (const post of posts) {
    const value = reportPublishedTime(post);
    assert.match(value, /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\+09:00)?$/, post.id);
    assert.ok(value.slice(0, 10) >= String(post.reportDate || post.date).slice(0, 10), post.id);
  }
});

test('the middleware reads the uploaded file\'s metas and writes one title, one description and one published time', async () => {
  const head = [
    `<meta content="${ownTitle}" name="report-seo-title">`,
    `<meta name="report-seo-description" content="${ownDescription.replace('.', '&#46;')}">`,
    `<meta name="report-takeaway" content="${takeaway}">`,
    '<meta property="article:published_time" content="2026-11-18">',
    '<meta name="description" content="old">',
    '<title>Uploaded title</title>'
  ].join('');
  assert.deepEqual(reportHeadMeta(head), { seoTitle: ownTitle, seoDescription: ownDescription, takeaway });

  const corpus = [daily, ...posts];
  const html = await (await onRequest({
    request: new Request('https://snowshagal.com/reports/2026-11-18_Snowshagal_Daily'),
    next: async () => new Response(`<!doctype html><html><head>${head}</head><body><h1>${daily.title}</h1></body></html>`, { headers: { 'content-type': 'text/html' } }),
    env: { ASSETS: { fetch: async request => {
      const pathname = new URL(request.url || request).pathname;
      if (pathname === '/data/posts.json') return Response.json(corpus);
      if (pathname === '/data/tags.json') return Response.json(tags);
      return new Response('', { status: 404 });
    } } }
  })).text();

  assert.deepEqual(html.match(/<title>[^<]*<\/title>/g), [`<title>${ownTitle}</title>`]);
  assert.deepEqual(html.match(/<meta name="description" content="[^"]*">/g), [`<meta name="description" content="${ownDescription}">`]);
  assert.equal((html.match(/article:published_time/g) || []).length, 1, 'the upload\'s own published_time is replaced');
  assert.match(html, /<meta property="article:published_time" content="2026-11-18T16:42:05\+09:00">/);
});
