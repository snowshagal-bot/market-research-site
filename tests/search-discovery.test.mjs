import assert from 'node:assert/strict';
import test from 'node:test';
import { atomFeedXml } from '../functions/_feed.js';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';
import {
  PRODUCTION_ORIGIN,
  cleanReportHref,
  reportSiteUrl,
  sitemapXml
} from '../functions/_seo.js';

const posts = [
  {
    id: 'older-ko',
    type: 'daily',
    lang: 'ko',
    title: '기존 한국어 리포트',
    href: 'reports/older-ko.html',
    reportDate: '2026-09-04',
    registeredAt: '2026-09-04T09:00:00Z'
  },
  {
    id: 'new-ko',
    type: 'daily',
    lang: 'ko',
    title: '새 한국어 리포트',
    href: 'reports/새-한국어.html',
    reportDate: '2026-09-07',
    registeredAt: '2026-09-07T09:00:00Z',
    updatedAt: '2026-09-08T01:02:03Z',
    translationGroup: 'new-pair'
  },
  {
    id: 'new-en',
    type: 'daily',
    lang: 'en',
    title: 'New English report',
    href: 'reports/en/new-english.html',
    reportDate: '2026-09-07',
    registeredAt: '2026-09-07T09:05:00Z',
    translationGroup: 'new-pair'
  }
];

function sitemapEntries(xml) {
  return [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?[\s\S]*?<\/url>/g)]
    .map((match) => ({ location: match[1], lastmod: match[2] || '' }));
}

function responseWithPosts() {
  return { ASSETS: { fetch: async () => Response.json(posts) } };
}

test('a new KO/EN publish deterministically enters the canonical sitemap with metadata-derived lastmod', () => {
  const first = sitemapXml(posts);
  const second = sitemapXml([...posts]);
  assert.equal(first, second, 'request/build time must not change sitemap output');

  const entries = sitemapEntries(first);
  const locations = entries.map((entry) => entry.location);
  assert.equal(new Set(locations).size, locations.length);
  for (const location of locations) {
    assert.equal(new URL(location).origin, PRODUCTION_ORIGIN);
    assert.doesNotMatch(location, /pages\.dev|\.html?(?:$|[?#])/i);
  }
  assert.deepEqual(
    new Set(entries.map((entry) => entry.lastmod).filter(Boolean)),
    new Set(['2026-09-04', '2026-09-07', '2026-09-08']),
    'lastmod values must come only from the supplied content metadata'
  );

  const ko = entries.find((entry) => entry.location === reportSiteUrl(posts[1].href));
  const en = entries.find((entry) => entry.location === reportSiteUrl(posts[2].href));
  assert.deepEqual(ko, { location: reportSiteUrl(posts[1].href), lastmod: '2026-09-08' });
  assert.deepEqual(en, { location: reportSiteUrl(posts[2].href), lastmod: '2026-09-07' });
});

test('a new publish is crawlable in raw homepage and category HTML without client JavaScript', async () => {
  const home = await middlewareRequest({
    request: new Request(`${PRODUCTION_ORIGIN}/`),
    env: responseWithPosts(),
    next: async () => new Response(
      '<!doctype html><html><head></head><body><div id="latest-category-cards"></div><div id="report-list"></div></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    )
  });
  const homeHtml = await home.text();
  assert.match(homeHtml, new RegExp(`href="${cleanReportHref(posts[1].href)}"`));
  assert.doesNotMatch(homeHtml, new RegExp(`href="${cleanReportHref(posts[2].href)}"`));

  const category = await middlewareRequest({
    request: new Request(`${PRODUCTION_ORIGIN}/daily/`),
    env: responseWithPosts(),
    next: async () => new Response(
      '<!doctype html><html><head></head><body><div id="category-featured-cards"></div><div id="category-report-list"></div><section id="category-featured-section"></section><section id="category-archive-section"></section></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } }
    )
  });
  const categoryHtml = await category.text();
  assert.match(categoryHtml, new RegExp(`href="${cleanReportHref(posts[1].href)}"`));
  assert.doesNotMatch(categoryHtml, new RegExp(`href="${cleanReportHref(posts[2].href)}"`));
});

test('a new publish enters only its localized Atom feed with its canonical report URL', () => {
  const koFeed = atomFeedXml(posts, 'ko');
  const enFeed = atomFeedXml(posts, 'en');
  const koUrl = reportSiteUrl(posts[1].href);
  const enUrl = reportSiteUrl(posts[2].href);

  assert.match(koFeed, new RegExp(`<id>${koUrl}</id>`));
  assert.doesNotMatch(koFeed, new RegExp(`<id>${enUrl}</id>`));
  assert.match(enFeed, new RegExp(`<id>${enUrl}</id>`));
  assert.doesNotMatch(enFeed, new RegExp(`<id>${koUrl}</id>`));
  assert.equal(atomFeedXml(posts, 'ko'), koFeed, 'feed output is stable without a content change');
  assert.equal(atomFeedXml(posts, 'en'), enFeed, 'feed output is stable without a content change');
});
