import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';
import {
  CATEGORY_LANDINGS,
  CATEGORY_SLUGS,
  PRODUCTION_ORIGIN,
  categoryLandingPath,
  categoryReportLinks,
  homepageLatestLinks,
  homepageReportLinks,
  postLanguage,
  reportAlternates,
  reportDescription,
  reportSeoTags,
  reportSeoTitle,
  reportSiteUrl,
  sitemapXml
} from '../functions/_seo.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function hrefs(markup) {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]);
}

test('homepage discovery renderers expose real localized report anchors', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const lang of ['ko', 'en']) {
    const latest = homepageLatestLinks(posts, lang);
    const archive = homepageReportLinks(posts, lang);
    const latestHrefs = hrefs(latest);
    const archiveHrefs = hrefs(archive);
    assert.ok(latestHrefs.length >= 2, `${lang} latest report anchors`);
    assert.ok(archiveHrefs.length > 0, `${lang} archive report anchors`);
    for (const href of [...latestHrefs, ...archiveHrefs]) {
      assert.match(href, /^\/reports\/.+/);
      assert.doesNotMatch(href, /\/\/|\\|\?|#/);
      const decoded = decodeURIComponent(href.replace(/^\//, ''));
      await access(fileURLToPath(new URL(`../${decoded}`, import.meta.url)));
    }
    const localizedPaths = new Set(posts.filter((post) => postLanguage(post) === lang).map((post) => `/${post.href}`));
    for (const href of [...latestHrefs, ...archiveHrefs]) assert.ok(localizedPaths.has(href), `${lang}: ${href}`);
  }
});

test('middleware puts crawlable report links into homepage and category source', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const assets = { fetch: async () => Response.json(posts) };
  const homeSource = '<!doctype html><html><body><div id="latest-category-cards"></div><div id="report-list"></div></body></html>';
  const home = await middlewareRequest({
    request: new Request('https://branch.market-research-site.pages.dev/'),
    env: { ASSETS: assets },
    next: async () => new Response(homeSource, { headers: { 'content-type': 'text/html' } })
  });
  const homeHtml = await home.text();
  assert.match(homeHtml, /id="latest-category-cards"><a class="latest-card/);
  assert.match(homeHtml, /id="report-list"><a class="report-item"/);

  const landing = await middlewareRequest({
    request: new Request('https://branch.market-research-site.pages.dev/daily/'),
    env: { ASSETS: assets },
    next: async () => new Response('<!doctype html><html><body><div id="category-report-list"></div></body></html>', { headers: { 'content-type': 'text/html' } })
  });
  const landingHtml = await landing.text();
  assert.match(landingHtml, /id="category-report-list"><a class="report-item"/);
  const expected = new Set(posts.filter((post) => postLanguage(post) === 'ko' && post.type === 'daily').map((post) => `/${post.href}`));
  for (const href of hrefs(landingHtml)) assert.ok(expected.has(href), `daily landing leaked ${href}`);
});

test('all category landing pages have unique metadata, H1, self canonical, and reciprocal locale links', async () => {
  const titles = new Set();
  for (const [type, slug] of Object.entries(CATEGORY_SLUGS)) {
    for (const lang of ['ko', 'en']) {
      const relative = `${lang === 'en' ? 'en/' : ''}${slug}/index.html`;
      const html = await read(relative);
      const expected = CATEGORY_LANDINGS[type][lang];
      const canonical = `${PRODUCTION_ORIGIN}${categoryLandingPath(type, lang)}`;
      assert.match(html, new RegExp(`<html lang="${lang}"`));
      assert.ok(html.includes(`<title>${expected.title.replace(/&/g, '&amp;')}</title>`));
      assert.ok(html.includes(`<meta name="description" content="${expected.description.replace(/&/g, '&amp;')}">`));
      assert.ok(html.includes(`<h1>${expected.heading.replace(/&/g, '&amp;')}</h1>`));
      assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`));
      assert.ok(html.includes(`hreflang="ko" href="${PRODUCTION_ORIGIN}${categoryLandingPath(type, 'ko')}"`));
      assert.ok(html.includes(`hreflang="en" href="${PRODUCTION_ORIGIN}${categoryLandingPath(type, 'en')}"`));
      assert.match(html, /id="category-report-list"/);
      titles.add(expected.title);
    }
  }
  assert.equal(titles.size, Object.keys(CATEGORY_SLUGS).length * 2);
});

test('category lists contain only their locale and category and every link resolves to a tracked report', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const type of Object.keys(CATEGORY_SLUGS)) {
    for (const lang of ['ko', 'en']) {
      const links = hrefs(categoryReportLinks(posts, type, lang));
      const expected = posts.filter((post) => postLanguage(post) === lang && post.type === type);
      assert.deepEqual(new Set(links), new Set(expected.map((post) => `/${post.href}`)));
      for (const post of expected) await access(fileURLToPath(new URL(`../${post.href}`, import.meta.url)));
    }
  }
});

test('report SEO title and description are non-empty, unique, and preserve explicit copy before fallbacks', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const titles = posts.map(reportSeoTitle);
  assert.equal(new Set(titles).size, titles.length, 'report SEO titles must be unique');
  for (const post of posts) {
    const title = reportSeoTitle(post);
    const description = reportDescription(post);
    const tags = reportSeoTags(posts, post);
    assert.ok(title.includes('Snowshagal'));
    assert.ok(title.includes(post.title));
    assert.ok(description.length > 0);
    assert.match(tags, /<title>[^<]+<\/title>/);
    assert.match(tags, /<meta name="description" content="[^"]+">/);
    assert.ok(tags.includes(`rel="canonical" href="${reportSiteUrl(post.href)}`));
    const supplied = String(post.summary || post.description || post.subtitle || '').replace(/\s+/g, ' ').trim();
    if (supplied) assert.equal(description, supplied);
  }
  const fallback = { lang: 'en', type: 'note', title: 'A Small Observation', href: 'reports/en/note.html' };
  assert.match(reportDescription(fallback), /A Small Observation/);
});

test('report hreflang is reciprocal only for real KO and EN translation pairs', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const byHref = new Map(posts.map((post) => [reportSiteUrl(post.href), post]));
  for (const post of posts) {
    const alternates = reportAlternates(posts, post);
    if (!alternates.length) {
      assert.doesNotMatch(reportSeoTags(posts, post), /hreflang=/);
      continue;
    }
    const locales = new Set(alternates.map((entry) => entry.lang));
    assert.deepEqual(locales, new Set(['ko', 'en', 'x-default']));
    for (const entry of alternates.filter((item) => item.lang !== 'x-default')) {
      const counterpart = byHref.get(entry.href);
      assert.ok(counterpart, `${post.id} invented ${entry.href}`);
      const reverse = reportAlternates(posts, counterpart);
      assert.ok(reverse.some((item) => item.href === reportSiteUrl(post.href)), `${post.id} is not reciprocal`);
    }
  }

  const ambiguous = [
    { id: 'ko-1', lang: 'ko', title: '하나', href: 'reports/one.html', translationGroup: 'ambiguous' },
    { id: 'ko-2', lang: 'ko', title: '둘', href: 'reports/two.html', translationGroup: 'ambiguous' },
    { id: 'en-1', lang: 'en', title: 'One', href: 'reports/en/one.html', translationGroup: 'ambiguous' }
  ];
  for (const post of ambiguous) assert.deepEqual(reportAlternates(ambiguous, post), []);
});

test('sitemap includes every category landing without duplicate or malformed URLs', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const locations = [...sitemapXml(posts).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.equal(new Set(locations).size, locations.length);
  for (const type of Object.keys(CATEGORY_SLUGS)) {
    for (const lang of ['ko', 'en']) {
      const expected = `${PRODUCTION_ORIGIN}${categoryLandingPath(type, lang)}`;
      assert.ok(locations.includes(expected), expected);
    }
  }
  for (const location of locations) {
    const url = new URL(location);
    assert.equal(url.origin, PRODUCTION_ORIGIN);
    assert.doesNotMatch(url.pathname, /\/\//);
  }
});
