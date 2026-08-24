import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';
import { onRequestGet as sitemapRequest } from '../functions/sitemap.xml.js';
import {
  PRODUCTION_ORIGIN,
  findPostByPath,
  reportAlternates,
  reportSeoTags,
  reportSiteUrl,
  sitemapXml
} from '../functions/_seo.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const pairedPosts = [
  { id: 'ko-pair', lang: 'ko', title: '한국어 보고서', href: 'reports/한국어.html', reportDate: '2026-08-01', translationGroup: 'pair' },
  { id: 'en-pair', lang: 'en', title: 'English report', href: 'reports/en/report.html', reportDate: '2026-08-01', translationGroup: 'pair' },
  { id: 'ko-only', type: 'daily', title: '한국어 전용', description: '설명', href: 'reports/only.html', reportDate: '2026-08-02' }
];

test('public locale shells use snowshagal.com canonicals and only real homepage alternates', async () => {
  const [ko, en, aboutKo, aboutEn] = await Promise.all([
    read('index.html'), read('en/index.html'), read('about/index.html'), read('en/about/index.html')
  ]);
  assert.match(ko, /rel="canonical" href="https:\/\/snowshagal\.com\/"/);
  assert.match(en, /rel="canonical" href="https:\/\/snowshagal\.com\/en\/"/);
  assert.match(ko, /<title>Snowshagal \| 한국 시장 데일리·위클리·투자 인사이트<\/title>/);
  assert.match(ko, /<meta name="description" content="한국 시장의 데일리 복기와 위클리 전망, 주요 경제·시장 이슈와 투자에 참고할 만한 인사이트를 정리합니다\.">/);
  assert.match(ko, /<meta property="og:title" content="Snowshagal \| 한국 시장 데일리·위클리·투자 인사이트">/);
  assert.match(ko, /<meta property="og:description" content="한국 시장의 데일리 복기와 위클리 전망, 주요 경제·시장 이슈와 투자에 참고할 만한 인사이트를 정리합니다\.">/);
  assert.match(en, /<title>Snowshagal \| Korean Market Daily, Weekly &amp; Investment Insights<\/title>/);
  assert.match(en, /<meta name="description" content="Daily reviews and weekly outlooks on the Korean market, covering major economic and market issues with insights to support investment decisions\.">/);
  assert.match(en, /<meta property="og:title" content="Snowshagal \| Korean Market Daily, Weekly &amp; Investment Insights">/);
  assert.match(en, /<meta property="og:description" content="Daily reviews and weekly outlooks on the Korean market, covering major economic and market issues with insights to support investment decisions\.">/);
  for (const html of [ko, en]) assert.match(html, /<meta property="og:site_name" content="Snowshagal">/);
  for (const html of [ko, en]) {
    assert.match(html, /hreflang="ko"/);
    assert.match(html, /hreflang="en"/);
    assert.match(html, /hreflang="x-default"/);
    assert.doesNotMatch(html, /pages\.dev/);
  }
  const websiteJson = ko.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
  assert.ok(websiteJson);
  assert.deepEqual(JSON.parse(websiteJson), {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Snowshagal',
    url: 'https://snowshagal.com/',
    inLanguage: 'ko'
  });
  assert.doesNotMatch(en, /type="application\/ld\+json"/);
  assert.match(aboutKo, /noindex,nofollow/);
  assert.match(aboutKo, /rel="canonical" href="https:\/\/snowshagal\.com\/about\/"/);
  assert.match(aboutEn, /rel="canonical" href="https:\/\/snowshagal\.com\/en\/about\/"/);
});

test('report SEO resolves encoded paths and links only explicit translation counterparts', () => {
  const korean = findPostByPath(pairedPosts, '/reports/%ED%95%9C%EA%B5%AD%EC%96%B4.html');
  assert.equal(korean.id, 'ko-pair');
  assert.equal(findPostByPath(pairedPosts, '/reports/%ED%95%9C%EA%B5%AD%EC%96%B4')?.id, 'ko-pair');
  assert.deepEqual(reportAlternates(pairedPosts, korean).map(({ lang }) => lang), ['en', 'ko', 'x-default']);
  const tags = reportSeoTags(pairedPosts, korean);
  assert.match(tags, /rel="canonical" href="https:\/\/snowshagal\.com\/reports\/%ED%95%9C%EA%B5%AD%EC%96%B4"/);
  assert.match(tags, /hreflang="en" href="https:\/\/snowshagal\.com\/reports\/en\/report"/);
  assert.doesNotMatch(reportSeoTags(pairedPosts, pairedPosts[2]), /hreflang=/);
  assert.doesNotMatch(tags, /pages\.dev/);
});

test('sitemap contains canonical public locale pages and published reports without invented translations', () => {
  const xml = sitemapXml(pairedPosts);
  assert.match(xml, /<loc>https:\/\/snowshagal\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/snowshagal\.com\/en\/<\/loc>/);
  assert.match(xml, /https:\/\/snowshagal\.com\/reports\/%ED%95%9C%EA%B5%AD%EC%96%B4<\/loc>/);
  assert.match(xml, /hreflang="en" href="https:\/\/snowshagal\.com\/reports\/en\/report"/);
  const unpairedEntry = xml.match(/<url><loc>https:\/\/snowshagal\.com\/reports\/only<\/loc>[\s\S]*?<\/url>/)?.[0] || '';
  assert.doesNotMatch(unpairedEntry, /xhtml:link/);
  assert.doesNotMatch(xml, /about|pages\.dev/);
});

test('dynamic sitemap reads posts from the Pages asset binding and returns XML', async () => {
  const calls = [];
  const response = await sitemapRequest({
    request: new Request('https://branch.market-research-site.pages.dev/sitemap.xml'),
    env: { ASSETS: { fetch: async (request) => {
      calls.push(new URL(request.url).pathname);
      return Response.json(pairedPosts);
    } } }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/xml/);
  assert.deepEqual(calls, ['/data/posts.json']);
  assert.match(await response.text(), new RegExp(PRODUCTION_ORIGIN));
});

test('repository post metadata references existing public report files without fixed content counts', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  assert.ok(Array.isArray(posts));
  for (const post of posts) {
    assert.match(post.href, /^reports\/.+\.html?$/i);
    await access(fileURLToPath(new URL(`../${post.href}`, import.meta.url)));
  }
  const sitemapLocations = [...sitemapXml(posts).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  const expectedLocations = [
    `${PRODUCTION_ORIGIN}/`,
    `${PRODUCTION_ORIGIN}/en/`,
    ...posts.map((post) => reportSiteUrl(post.href))
  ];
  assert.deepEqual(new Set(sitemapLocations), new Set(expectedLocations));
});

test('robots permits public crawling, excludes admin APIs, and advertises the canonical sitemap', async () => {
  const robots = await read('robots.txt');
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/snowshagal\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /pages\.dev/);
});

test('SEO-producing code contains no legacy production-domain signals', async () => {
  const sources = await Promise.all([
    read('functions/_seo.js'), read('functions/_middleware.js'), read('functions/sitemap.xml.js'), read('robots.txt')
  ]);
  for (const source of sources) assert.doesNotMatch(source, /market-research-site\.pages\.dev/);
});

test('shared middleware marks Preview responses noindex while preserving Production indexing', async () => {
  const next = async () => new Response('<!doctype html><title>Home</title>', { headers: { 'content-type': 'text/html' } });
  const preview = await middlewareRequest({
    request: new Request('https://branch.market-research-site.pages.dev/'), next, env: {}
  });
  const production = await middlewareRequest({
    request: new Request('https://snowshagal.com/'), next, env: {}
  });
  assert.equal(preview.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(production.headers.get('x-robots-tag'), null);
});

test('custom 404 is non-indexable and does not claim a canonical URL', async () => {
  const html = await read('404.html');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /<title>페이지를 찾을 수 없습니다 · Snowshagal<\/title>/);
  assert.match(html, /href="\/assets\/site\.css"/);
  assert.match(html, /href="\/">홈페이지로 돌아가기/);
  assert.doesNotMatch(html, /rel="canonical"|pages\.dev/);
});

test('shared middleware preserves missing report status and body without report-shell injection', async () => {
  const body = await read('404.html');
  const next = async () => new Response(body, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
  const production = await middlewareRequest({
    request: new Request('https://snowshagal.com/reports/not-a-real-report'), next, env: {}
  });
  const preview = await middlewareRequest({
    request: new Request('https://branch.market-research-site.pages.dev/reports/not-a-real-report'), next, env: {}
  });

  assert.equal(production.status, 404);
  assert.equal(production.headers.get('x-robots-tag'), null);
  assert.doesNotMatch(await production.text(), /report-shell\.js/);
  assert.equal(preview.status, 404);
  assert.equal(preview.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.doesNotMatch(await preview.text(), /report-shell\.js/);
});
