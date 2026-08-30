import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  categoryFeaturedCards,
  categoryArchiveLinks,
  categoryReportLinks,
  homepageLatestLinks,
  homepageReportLinks,
  postLanguage,
  cleanReportHref
} from '../functions/_seo.js';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';

const read = (rel) => readFile(new URL('../' + rel, import.meta.url), 'utf8');

test('1 & 2. Daily KO & EN category pages render top 2 featured cards via SSR and client scripts', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const lang of ['ko', 'en']) {
    const featuredHtml = categoryFeaturedCards(posts, 'daily', lang);
    const cardMatches = [...featuredHtml.matchAll(/class="category-featured-card category-featured-card-daily"/g)];
    assert.equal(cardMatches.length, 2, `${lang} daily featured cards count must be 2`);

    const landingHtml = await read(lang === 'en' ? 'en/daily/index.html' : 'daily/index.html');
    assert.match(landingHtml, /id="category-featured-section"/);
    assert.match(landingHtml, /id="category-featured-cards"/);
    assert.match(landingHtml, /<h2[^>]*id="category-featured-heading"[^>]*>(최신 데일리 리포트|Latest Daily Reports)<\/h2>/);
  }
});

test('3. Weekly category page renders top 2 featured cards and 3rd+ posts in archive', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const koWeeklyPosts = posts.filter(p => postLanguage(p) === 'ko' && p.type === 'weekly');
  assert.ok(koWeeklyPosts.length > 2, 'KO weekly has more than 2 posts');

  const featured = categoryFeaturedCards(posts, 'weekly', 'ko');
  const archive = categoryArchiveLinks(posts, 'weekly', 'ko');

  const featuredMatches = [...featured.matchAll(/class="category-featured-card category-featured-card-weekly"/g)];
  assert.equal(featuredMatches.length, 2);

  const archiveMatches = [...archive.matchAll(/class="report-item"/g)];
  assert.equal(archiveMatches.length, koWeeklyPosts.length - 2);
});

test('4. Research category has zero duplicate posts between Featured and Archive', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const lang of ['ko', 'en']) {
    const featured = categoryFeaturedCards(posts, 'research', lang);
    const archive = categoryArchiveLinks(posts, 'research', lang);

    const featuredHrefs = [...featured.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const archiveHrefs = [...archive.matchAll(/href="([^"]+)"/g)].map(m => m[1]);

    for (const href of featuredHrefs) {
      assert.ok(!archiveHrefs.includes(href), `Duplicate found in research ${lang}: ${href}`);
    }
  }
});

test('5. Category with <= 2 posts hides archive section without empty boxes', async () => {
  const testPosts = [
    { id: 'b1', type: 'basics', lang: 'en', reportDate: '2026-08-13', title: 'B1', href: 'reports/en/b1.html' },
    { id: 'b2', type: 'basics', lang: 'en', reportDate: '2026-08-11', title: 'B2', href: 'reports/en/b2.html' }
  ];

  const archive = categoryArchiveLinks(testPosts, 'basics', 'en');
  assert.equal(archive, '', 'Archive links for <=2 posts must be empty string');

  // Test middleware SSR hiding
  const assets = { fetch: async () => Response.json(testPosts) };
  const res = await middlewareRequest({
    request: new Request('https://branch.market-research-site.pages.dev/en/basics/'),
    env: { ASSETS: assets },
    next: async () => new Response(await read('en/basics/index.html'), { headers: { 'content-type': 'text/html' } })
  });
  const html = await res.text();
  assert.match(html, /id="category-archive-section"[^>]*\bhidden\b/);
});

test('6. Posts without cover images fall back safely without 404 or broken image markup', async () => {
  const posts = [
    {
      id: 'test-no-cover',
      title: 'Coverless Test Post',
      href: 'reports/coverless-test.html',
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-28',
      summary: 'Testing fallback art'
    }
  ];
  const featured = categoryFeaturedCards(posts, 'daily', 'ko');
  assert.match(featured, /class="category-featured-art"/);
  assert.doesNotMatch(featured, /<img/);
});

test('7 & 8. All Featured and Archive links use canonical Clean URLs', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const cat of ['daily', 'weekly', 'research', 'basics']) {
    for (const lang of ['ko', 'en']) {
      const featured = categoryFeaturedCards(posts, cat, lang);
      const archive = categoryArchiveLinks(posts, cat, lang);
      for (const snippet of [featured, archive]) {
        const links = [...snippet.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
        for (const link of links) {
          assert.match(link, /^\/reports\//);
          assert.doesNotMatch(link, /\.html?$/i, `Clean URL required: ${link}`);
        }
      }
    }
  }
});

test('9. data/posts.json maintains physical .html hrefs for all entries', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  assert.ok(posts.length >= 66);
  for (const post of posts) {
    assert.match(post.href, /\.html$/i, `Storage href must end with .html: ${post.href}`);
  }
});

test('10 & 11. Navigation contains Home / 홈 as first item on all public pages', async () => {
  const koPages = ['index.html', 'market/index.html', 'about/index.html', 'daily/index.html'];
  for (const p of koPages) {
    const html = await read(p);
    const mainNav = html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.match(mainNav, /<a[^>]*data-nav-category="all"[^>]*href="\/"[^>]*>홈<\/a>/);
  }

  const enPages = ['en/index.html', 'en/market/index.html', 'en/about/index.html', 'en/daily/index.html'];
  for (const p of enPages) {
    const html = await read(p);
    const mainNav = html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.match(mainNav, /<a[^>]*data-nav-category="all"[^>]*href="\/en\/"[^>]*>Home<\/a>/);
  }
});

test('12. Category active state attribute preserved on landing pages', async () => {
  const landing = await read('daily/index.html');
  assert.match(landing, /data-category="daily"/);
  const enLanding = await read('en/weekly/index.html');
  assert.match(enLanding, /data-category="weekly"/);
});

test('13. Mobile navigation exposes Home / 홈 as first swipe link', async () => {
  const koPages = ['index.html', 'market/index.html', 'about/index.html', 'daily/index.html'];
  for (const p of koPages) {
    const html = await read(p);
    const quickNav = html.match(/<nav class="mobile-quick-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.match(quickNav, /<a[^>]*data-nav-category="all"[^>]*href="\/"[^>]*>홈<\/a>/);
  }

  const enPages = ['en/index.html', 'en/market/index.html', 'en/about/index.html', 'en/daily/index.html'];
  for (const p of enPages) {
    const html = await read(p);
    const quickNav = html.match(/<nav class="mobile-quick-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.match(quickNav, /<a[^>]*data-nav-category="all"[^>]*href="\/en\/"[^>]*>Home<\/a>/);
  }
});

test('14. Homepage latest category highlights remain functional and intact', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const lang of ['ko', 'en']) {
    const highlights = homepageLatestLinks(posts, lang);
    assert.match(highlights, /class="latest-card latest-card-daily"/);
    assert.match(highlights, /class="latest-card latest-card-weekly"/);
    assert.match(highlights, /class="latest-card latest-card-research"/);
  }
});

test('15. Category landing hero eyebrow is editorial uppercase without ARCHIVE', async () => {
  const daily = await read('daily/index.html');
  assert.match(daily, /<p class="category-landing-eyebrow">DAILY<\/p>/);
  assert.doesNotMatch(daily, /카테고리 아카이브/);

  const basics = await read('basics/index.html');
  assert.match(basics, /<p class="category-landing-eyebrow">MARKET BASICS<\/p>/);

  const enWeekly = await read('en/weekly/index.html');
  assert.match(enWeekly, /<p class="category-landing-eyebrow">WEEKLY<\/p>/);
  assert.doesNotMatch(enWeekly, />ARCHIVE</);
});

test('16. SSR Featured cards include tags matching tag registry', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const dailyKo = categoryFeaturedCards(posts, 'daily', 'ko');
  assert.match(dailyKo, /<div class="category-featured-tags">/);
  const researchEn = categoryFeaturedCards(posts, 'research', 'en');
  assert.match(researchEn, /<div class="category-featured-tags">/);
});

test('17. Desktop Featured 2 cards grid styling in category-landing.css', async () => {
  const catCss = await read('assets/category-landing.css');
  assert.match(catCss, /\.category-featured-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
});

test('18. Mobile CSS contains vertical stacked layout for category featured cards', async () => {
  const catCss = await read('assets/category-landing.css');
  assert.match(catCss, /\.category-featured-grid\s*\{[^}]*grid-template-columns:\s*1fr;/);
  assert.match(catCss, /\.category-featured-card:not\(:last-child\)\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);/);
});
