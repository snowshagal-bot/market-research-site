import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  cleanReportHref,
  homepageLatestLinks,
  homepageReportLinks,
  categoryReportLinks,
  normalizeSitePath,
  reportSiteUrl
} from '../functions/_seo.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('cleanReportHref converts report paths to clean URLs without .html and preserves query/hash', () => {
  // Korean report
  assert.equal(cleanReportHref('reports/8월 27일 주식리포트_커버통합.html'), '/reports/8월 27일 주식리포트_커버통합');
  assert.equal(cleanReportHref('/reports/8월 27일 주식리포트_커버통합.html'), '/reports/8월 27일 주식리포트_커버통합');

  // English report
  assert.equal(cleanReportHref('reports/en/2026-08-27_KOSPI_Daily_Report_EN_polished.html'), '/reports/en/2026-08-27_KOSPI_Daily_Report_EN_polished');
  assert.equal(cleanReportHref('/reports/en/2026-08-27_KOSPI_Daily_Report_EN_polished.html'), '/reports/en/2026-08-27_KOSPI_Daily_Report_EN_polished');

  // Query string & hash preservation
  assert.equal(cleanReportHref('reports/test.html?tab=flows#section-2'), '/reports/test?tab=flows#section-2');
  assert.equal(cleanReportHref('/reports/en/test.html?lang=en#summary'), '/reports/en/test?lang=en#summary');

  // Non-report paths must NOT be stripped or altered
  assert.equal(cleanReportHref('admin/manage.html'), '/admin/manage.html');
  assert.equal(cleanReportHref('about/'), '/about/');
  assert.equal(cleanReportHref('/market/'), '/market/');
  assert.equal(cleanReportHref(''), '/');
});

test('data/posts.json preserves raw .html storage paths for file operations', async () => {
  const raw = await read('data/posts.json');
  const posts = JSON.parse(raw);
  assert.ok(posts.length > 0);
  for (const post of posts) {
    assert.match(post.href, /^reports\/.+\.html$/i, `post ${post.id} must keep raw .html href for file operations`);
  }
});

test('SSR discovery link generators produce clean URLs without .html', async () => {
  const raw = await read('data/posts.json');
  const posts = JSON.parse(raw);

  const koLatest = homepageLatestLinks(posts, 'ko');
  const enLatest = homepageLatestLinks(posts, 'en');
  const koArchive = homepageReportLinks(posts, 'ko');
  const enArchive = homepageReportLinks(posts, 'en');
  const koCategory = categoryReportLinks(posts, 'daily', 'ko');
  const enCategory = categoryReportLinks(posts, 'daily', 'en');

  const allHrefs = [koLatest, enLatest, koArchive, enArchive, koCategory, enCategory]
    .flatMap(html => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]));

  assert.ok(allHrefs.length > 0);
  for (const href of allHrefs) {
    assert.match(href, /^\/reports\//, 'all generated report links must start with /reports/');
    assert.doesNotMatch(href, /\.html?($|[?#])/i, `internal link "${href}" must not contain .html extension`);
  }
});

test('data/search-index-meta.js and search-index.json store clean report URLs', async () => {
  const indexRaw = await read('data/search-index.json');
  const metaRaw = await read('data/search-index-meta.js');
  const index = JSON.parse(indexRaw);
  const meta = JSON.parse(metaRaw.slice(metaRaw.indexOf('['), metaRaw.lastIndexOf(']') + 1));

  assert.ok(index.length > 0);
  assert.ok(meta.length > 0);

  for (const item of [...index, ...meta]) {
    assert.match(item.url, /^\/reports\//, 'search item url must start with /reports/');
    assert.doesNotMatch(item.url, /\.html?($|[?#])/i, `search item url "${item.url}" must not contain .html`);
  }
});
