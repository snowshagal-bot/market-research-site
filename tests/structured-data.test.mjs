import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_ORIGIN,
  ORGANIZATION_ID,
  WEBSITE_ID,
  BRAND_LOGO_URL,
  CATEGORY_BREADCRUMB_NAMES,
  serializeJsonLd,
  structuredDataScript,
  organizationStructuredData,
  websiteStructuredData,
  homepageStructuredData,
  categoryBreadcrumbStructuredData,
  categoryStructuredData,
  reportArticleImage,
  reportArticleStructuredData,
  reportBreadcrumbStructuredData,
  reportStructuredData,
  reportSeoTags,
  reportDescription,
  reportSiteUrl
} from '../functions/_seo.js';
import { onRequest as middlewareOnRequest } from '../functions/_middleware.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const posts = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/posts.json'), 'utf8'));

test('1-4. Structured Data: Homepage has WebSite and Organization nodes; /en/ has no site-level WebSite JSON-LD', () => {
  const koHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const enHtml = fs.readFileSync(path.join(rootDir, 'en/index.html'), 'utf8');

  // Root homepage KO
  const jsonLdMatch = koHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLdMatch, 'Homepage must contain application/ld+json script');
  const data = JSON.parse(jsonLdMatch[1]);
  assert.equal(data['@context'], 'https://schema.org');
  assert.ok(Array.isArray(data['@graph']));

  const orgNodes = data['@graph'].filter((n) => n['@type'] === 'Organization');
  const siteNodes = data['@graph'].filter((n) => n['@type'] === 'WebSite');

  assert.equal(orgNodes.length, 1, 'Exactly one Organization node');
  assert.equal(siteNodes.length, 1, 'Exactly one WebSite node');

  const org = orgNodes[0];
  assert.equal(org['@id'], 'https://snowshagal.com/#organization');
  assert.equal(org.name, 'Snowshagal');
  assert.equal(org.url, 'https://snowshagal.com/');
  assert.equal(org.logo, 'https://snowshagal.com/assets/brand/snowshagal-owl.webp');
  assert.ok(typeof org.description === 'string' && org.description.length > 0);

  const site = siteNodes[0];
  assert.equal(site['@id'], 'https://snowshagal.com/#website');
  assert.equal(site.url, 'https://snowshagal.com/');
  assert.equal(site.name, 'Snowshagal');
  assert.equal(site.alternateName, 'snowshagal.com');
  assert.deepEqual(site.publisher, { '@id': 'https://snowshagal.com/#organization' });

  // /en/ homepage has NO site-level WebSite or JSON-LD script tag
  assert.doesNotMatch(enHtml, /<script type="application\/ld\+json">/);
});

test('5-14. Structured Data: Representative KO & EN reports have Article with correct fields', () => {
  const sampleKO = posts.find((p) => p.type === 'daily' && p.lang === 'ko');
  const sampleEN = posts.find((p) => p.type === 'daily' && p.lang === 'en');
  assert.ok(sampleKO && sampleEN);

  for (const post of [sampleKO, sampleEN]) {
    const data = reportStructuredData(post);
    assert.equal(data['@context'], 'https://schema.org');
    assert.ok(Array.isArray(data['@graph']));

    const articleNodes = data['@graph'].filter((n) => n['@type'] === 'Article');
    assert.equal(articleNodes.length, 1, 'Exactly one Article node');
    const article = articleNodes[0];

    const cleanUrl = reportSiteUrl(post.href);
    assert.equal(article['@id'], `${cleanUrl}#article`);
    assert.equal(article.url, cleanUrl);
    assert.equal(article.mainEntityOfPage, cleanUrl);
    assert.doesNotMatch(article.url, /\.html?$/i);
    assert.equal(article.headline, post.title.trim());
    assert.equal(article.description, reportDescription(post));
    assert.equal(article.datePublished, (post.reportDate || post.date).slice(0, 10));
    assert.equal(article.dateModified, undefined, 'No fabricated dateModified');
    assert.equal(article.inLanguage, post.lang === 'en' ? 'en' : 'ko-KR');
    assert.deepEqual(article.publisher, { '@id': 'https://snowshagal.com/#organization' });
    assert.equal(article.author['@id'], 'https://snowshagal.com/#organization');
  }
});

test('15-17. Structured Data: Image fallback policy for reports', () => {
  const withCard = {
    id: 'test-card-post',
    type: 'daily',
    lang: 'ko',
    date: '2026-08-27',
    title: 'Card Post',
    href: 'reports/test-card-post.html',
    shareCardImage: 'covers/share/test-card-post.jpg',
    coverImage: 'covers/test-card-post.webp'
  };
  assert.equal(reportArticleImage(withCard), 'https://snowshagal.com/covers/share/test-card-post.jpg');

  const withCoverOnly = {
    id: 'test-cover-post',
    type: 'weekly',
    lang: 'ko',
    date: '2026-08-27',
    title: 'Cover Post',
    href: 'reports/test-cover-post.html',
    coverImage: 'covers/test-cover-post.webp'
  };
  assert.equal(reportArticleImage(withCoverOnly), 'https://snowshagal.com/covers/test-cover-post.webp');

  const withNoImage = {
    id: 'test-bare-post',
    type: 'basics',
    lang: 'ko',
    date: '2026-08-27',
    title: 'Bare Post',
    href: 'reports/test-bare-post.html'
  };
  assert.equal(reportArticleImage(withNoImage), '');
  const articleBare = reportArticleStructuredData(withNoImage);
  assert.equal(articleBare.image, undefined, 'Image property must be omitted if no representative image exists');
});

test('18-20. Structured Data: Report BreadcrumbList hierarchy (KO & EN & Notes)', () => {
  const koDaily = posts.find((p) => p.type === 'daily' && p.lang === 'ko');
  const enDaily = posts.find((p) => p.type === 'daily' && p.lang === 'en');
  const koNote = posts.find((p) => p.type === 'note' && p.lang === 'ko') || {
    id: 'sample-note',
    type: 'note',
    lang: 'ko',
    date: '2026-08-27',
    title: '노트 샘플',
    href: 'reports/sample-note.html'
  };
  const enNote = posts.find((p) => p.type === 'note' && p.lang === 'en') || {
    id: 'sample-en-note',
    type: 'note',
    lang: 'en',
    date: '2026-08-27',
    title: 'Sample Note',
    href: 'reports/en/sample-en-note.html'
  };

  const koData = reportBreadcrumbStructuredData(koDaily);
  assert.equal(koData['@type'], 'BreadcrumbList');
  assert.deepEqual(koData.itemListElement, [
    { '@type': 'ListItem', position: 1, name: '홈', item: 'https://snowshagal.com/' },
    { '@type': 'ListItem', position: 2, name: '데일리', item: 'https://snowshagal.com/daily/' },
    { '@type': 'ListItem', position: 3, name: koDaily.title.trim(), item: reportSiteUrl(koDaily.href) }
  ]);

  const enData = reportBreadcrumbStructuredData(enDaily);
  assert.deepEqual(enData.itemListElement, [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://snowshagal.com/en/' },
    { '@type': 'ListItem', position: 2, name: 'Daily', item: 'https://snowshagal.com/en/daily/' },
    { '@type': 'ListItem', position: 3, name: enDaily.title.trim(), item: reportSiteUrl(enDaily.href) }
  ]);

  const noteDataKO = reportBreadcrumbStructuredData(koNote);
  assert.equal(noteDataKO.itemListElement[1].item, 'https://snowshagal.com/notes/');
  assert.equal(noteDataKO.itemListElement[1].name, '투자 노트');

  const noteDataEN = reportBreadcrumbStructuredData(enNote);
  assert.equal(noteDataEN.itemListElement[1].item, 'https://snowshagal.com/en/notes/');
  assert.equal(noteDataEN.itemListElement[1].name, 'Investment Note');
});

test('21. Structured Data: Category landings have BreadcrumbList ONLY (no Article, no Organization)', () => {
  const landingFiles = [
    'daily/index.html',
    'weekly/index.html',
    'research/index.html',
    'basics/index.html',
    'notes/index.html',
    'en/daily/index.html',
    'en/weekly/index.html',
    'en/research/index.html',
    'en/basics/index.html',
    'en/notes/index.html'
  ];

  for (const file of landingFiles) {
    const html = fs.readFileSync(path.join(rootDir, file), 'utf8');
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLdMatch, `Category landing ${file} must have JSON-LD`);
    const data = JSON.parse(jsonLdMatch[1]);
    assert.equal(data['@context'], 'https://schema.org');
    assert.equal(data['@type'], 'BreadcrumbList');
    assert.equal(data.itemListElement.length, 2);
    assert.equal(data.itemListElement[0].position, 1);
    assert.equal(data.itemListElement[1].position, 2);
    assert.doesNotMatch(data.itemListElement[0].item, /\.html?$/i);
    assert.doesNotMatch(data.itemListElement[1].item, /\.html?$/i);

    // No Article, no Organization
    assert.doesNotMatch(html, /"Organization"/);
    assert.doesNotMatch(html, /"Article"/);
  }
});

test('22-23. Structured Data: 404, redirects and non-canonical pages do not contain Article JSON-LD', () => {
  const html404 = fs.readFileSync(path.join(rootDir, '404.html'), 'utf8');
  assert.doesNotMatch(html404, /"Article"/);
  assert.doesNotMatch(html404, /type="application\/ld\+json"/);
});

test('24-25. Structured Data: JSON-LD safe serialization escapes HTML special chars and parses via JSON.parse', () => {
  const payload = {
    title: 'Risk & Strategy <script>alert("XSS")</script> & "Quotes" > 100 < 200',
    tags: ['A & B', '<tag>', '</script>']
  };
  const serialized = serializeJsonLd(payload);
  assert.doesNotMatch(serialized, /<\/script>/i);
  assert.doesNotMatch(serialized, /<|>/);
  assert.doesNotMatch(serialized, /&/);

  const parsed = JSON.parse(serialized);
  assert.equal(parsed.title, payload.title);
  assert.deepEqual(parsed.tags, payload.tags);
});

test('26-27. Structured Data: All posts emit valid, parseable JSON-LD without duplicate entities', () => {
  for (const post of posts) {
    const tags = reportSeoTags(posts, post);
    const jsonLdMatch = tags.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonLdMatch, `reportSeoTags must contain JSON-LD for post ${post.id}`);
    const data = JSON.parse(jsonLdMatch[1]);

    assert.equal(data['@context'], 'https://schema.org');
    assert.ok(Array.isArray(data['@graph']));

    const articles = data['@graph'].filter((n) => n['@type'] === 'Article');
    const orgs = data['@graph'].filter((n) => n['@type'] === 'Organization');
    const breadcrumbs = data['@graph'].filter((n) => n['@type'] === 'BreadcrumbList');

    assert.equal(articles.length, 1, `Post ${post.id} must have exactly one Article`);
    assert.equal(orgs.length, 1, `Post ${post.id} must have exactly one Organization`);
    assert.equal(breadcrumbs.length, 1, `Post ${post.id} must have exactly one BreadcrumbList`);

    const article = articles[0];
    assert.equal(article.headline, post.title.trim());
    assert.equal(article.url, reportSiteUrl(post.href));
    assert.equal(article.description, reportDescription(post));
    assert.doesNotMatch(article.url, /\.html?$/i);

    const canonicalMatch = tags.match(/<link rel="canonical" href="([^"]+)">/);
    assert.equal(article.url, canonicalMatch[1]);
  }
});
