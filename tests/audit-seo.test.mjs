// The SEO integrity audit (scripts/audit-seo.mjs) must fail on each broken
// invariant and pass on warnings alone. The corpus is a small real slice of
// data/posts.json rendered by the real middleware; each case breaks one
// rendered document (or the sitemap) and asserts on the audit result itself.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { auditCorpus, auditRepository, renderRepository, summarize } from '../scripts/audit-seo.mjs';
import { findTranslationCounterpart, sitemapXml } from '../functions/_seo.js';

const ALL_POSTS = JSON.parse(await readFile(new URL('../data/posts.json', import.meta.url), 'utf8'));

// One KO/EN pair of each of two types, chosen from the data rather than by id.
function slice() {
  const picked = [];
  for (const type of ['research', 'daily']) {
    const en = ALL_POSTS.find(post => post.type === type && post.lang === 'en' && findTranslationCounterpart(ALL_POSTS, post));
    picked.push(en, findTranslationCounterpart(ALL_POSTS, en));
  }
  return picked;
}
const POSTS = slice();
const BASE = await renderRepository(POSTS);
const EN = BASE.corpus.find(page => page.kind === 'report' && page.lang === 'en');
const KO = BASE.corpus.find(page => page.canonical === EN.counterpartCanonical);
const OTHER = BASE.corpus.find(page => page.kind === 'report' && page !== EN && page !== KO);

/** The audit of the slice after `edit` changes one document's HTML. */
function audit({ page, edit, sitemap = sitemapXml(POSTS) } = {}) {
  const documents = new Map(BASE.documents);
  if (page) {
    const doc = documents.get(page.canonical);
    const html = edit(doc.html);
    assert.notEqual(html, doc.html, 'the fixture edit changed the document');
    documents.set(page.canonical, { ...doc, html });
  }
  return auditCorpus({ corpus: BASE.corpus, documents, sitemap });
}
const checks = report => report.failures.map(item => item.check);

test('the unmodified slice passes with every invariant checked', () => {
  const report = audit();
  assert.deepEqual(report.failures, []);
  assert.equal(report.counts.corpus.reports, POSTS.length);
  assert.equal(report.counts.tally.validPairs, 2);
  assert.ok(report.counts.assets.checked > 0);
});

test('duplicate canonical fails', () => {
  const report = audit({ page: OTHER, edit: html => html.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${KO.canonical}">`) });
  assert.ok(checks(report).includes('canonical.duplicate'));
  assert.ok(checks(report).includes('canonical.self'));
  assert.equal(summarize(report).canonical.duplicate, 1);
});

test('missing title fails', () => {
  const report = audit({ page: KO, edit: html => html.replace(/<title>[\s\S]*?<\/title>/, '') });
  assert.ok(checks(report).includes('title.count'));
  assert.equal(summarize(report).metadata.missingTitle, 1);
});

test('missing description fails', () => {
  const report = audit({ page: EN, edit: html => html.replace(/<meta name="description" content="[^"]*">/, '') });
  assert.ok(checks(report).includes('description.count'));
  assert.equal(summarize(report).metadata.missingDescription, 1);
});

test('an <html lang> that disagrees with the post fails', () => {
  const report = audit({ page: EN, edit: html => html.replace(/<html([^>]*)\blang="en"/, '<html$1lang="ko"') });
  assert.deepEqual(report.failures.filter(item => item.check === 'html.lang').map(item => [item.actual, item.expected]), [['ko', 'en']]);
  assert.equal(summarize(report).indexability.langMismatch, 1);
});

test('a one-sided translation pair fails on both pages', () => {
  const report = audit({ page: EN, edit: html => html.replace(/<link rel="alternate" hreflang="[^"]*" href="[^"]*">/g, '') });
  assert.ok(checks(report).includes('hreflang.missing'), 'the page that lost its hreflang');
  assert.ok(checks(report).includes('hreflang.reciprocal'), 'the page whose counterpart no longer links back');
  assert.equal(report.counts.tally.validPairs, 1);
});

test('a hreflang pointing at a report that does not exist fails as invented', () => {
  const report = audit({ page: KO, edit: html => html.replace(`hreflang="en" href="${EN.canonical}"`, 'hreflang="en" href="https://snowshagal.com/reports/en/not-a-report"') });
  assert.ok(checks(report).includes('hreflang.counterpart-missing'));
});

test('a sitemap missing a public URL fails, and one listing an unknown URL fails', () => {
  const full = sitemapXml(POSTS);
  const withoutKo = full.replace(new RegExp(`<url><loc>${KO.canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>[\\s\\S]*?</url>`), '');
  assert.notEqual(withoutKo, full);
  const missing = audit({ sitemap: withoutKo });
  assert.deepEqual(missing.failures.filter(item => item.check === 'sitemap.missing').map(item => item.url), [KO.canonical]);
  const extra = audit({ sitemap: full.replace('</urlset>', '<url><loc>https://snowshagal.com/reports/ghost</loc></url></urlset>') });
  assert.ok(checks(extra).includes('sitemap.unexpected'));
  const duplicate = audit({ sitemap: full.replace('</urlset>', `<url><loc>${KO.canonical}</loc></url></urlset>`) });
  assert.ok(checks(duplicate).includes('sitemap.duplicate'));
});

test('warnings alone pass', () => {
  const long = 'An intentionally long search title that goes well past the seventy character advisory line';
  const report = audit({ page: OTHER, edit: html => html.replace(/<title>[\s\S]*?<\/title>/, `<title>${long}</title>`) });
  assert.deepEqual(report.failures, []);
  assert.ok(report.warnings.some(item => item.check === 'title.length' && item.url === OTHER.canonical));
});

test('the repository as committed passes the audit', async () => {
  const report = await auditRepository();
  assert.deepEqual(report.failures, [], JSON.stringify(report.failures.slice(0, 3)));
  assert.equal(report.counts.corpus.reports, ALL_POSTS.length);
});
