#!/usr/bin/env node
/**
 * Snowshagal SEO integrity audit.
 *
 *   node scripts/audit-seo.mjs                     repository mode (no network)
 *   node scripts/audit-seo.mjs --origin=<url>      live mode (HTTP, e.g. a Preview)
 *   add --json for one machine-readable JSON object on stdout
 *
 * The unit tests cover each SEO helper and its edge cases; this audit checks
 * the whole public, indexable corpus at once. Repository mode renders every page
 * through the real functions/_middleware.js (string path, no D1, no network)
 * and reads the result, so no SEO rule is re-implemented here. Live mode reads
 * the same pages over HTTP. Both feed one set of document checks.
 *
 * Exit code: 0 = no hard failure (warnings allowed), 1 = hard failure,
 * 2 = the audit itself could not run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { onRequest as middleware } from '../functions/_middleware.js';
import {
  CATEGORY_SLUGS,
  ORGANIZATION_ID,
  PRODUCTION_ORIGIN,
  WEBSITE_ID,
  categoryHasPosts,
  categoryLandingPath,
  cleanReportHref,
  findTranslationCounterpart,
  normalizeSitePath,
  postLanguage,
  reportSiteUrl,
  sitemapXml
} from '../functions/_seo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCTION_HOST = new URL(PRODUCTION_ORIGIN).host;

// Pages that exist in both locales at fixed paths. Category landings and
// reports are derived from data/posts.json.
const STATIC_PAGES = [
  { key: 'home', ko: '/', en: '/en/' },
  { key: 'about', ko: '/about/', en: '/en/about/' },
  { key: 'market', ko: '/market/', en: '/en/market/' },
  { key: 'disclosures', ko: '/disclosures/', en: '/en/disclosures/' },
  { key: 'calendar', ko: '/calendar/', en: '/en/calendar/' }
];

// Advisory only: length never fails the audit.
const TITLE_WARN_LENGTH = 70;
const DESCRIPTION_WARN_LENGTH = 175;
const LIVE_CONCURRENCY = 6;
const VERIFICATION_FILES = ['/naver96f43741acd96bcdeb679f22cddc4a80.html', '/yandex_9866f357776964b4.html'];

/* ------------------------------------------------------------ corpus */

function shellFile(pathname) {
  return `${normalizeSitePath(pathname)}index.html`;
}

/** Every page that is public and meant to be indexed, plus empty category landings. */
export function buildCorpus(posts) {
  const pages = [];
  for (const page of STATIC_PAGES) {
    for (const lang of ['ko', 'en']) {
      pages.push({ kind: page.key, lang, path: page[lang], file: shellFile(page[lang]), indexable: true, pair: page });
    }
  }
  for (const type of Object.keys(CATEGORY_SLUGS)) {
    const both = categoryHasPosts(posts, type, 'ko') && categoryHasPosts(posts, type, 'en');
    for (const lang of ['ko', 'en']) {
      const pagePath = categoryLandingPath(type, lang);
      pages.push({
        kind: 'category',
        type,
        lang,
        path: pagePath,
        file: shellFile(pagePath),
        indexable: categoryHasPosts(posts, type, lang),
        pair: both ? { ko: categoryLandingPath(type, 'ko'), en: categoryLandingPath(type, 'en') } : null
      });
    }
  }
  for (const post of posts) {
    const counterpart = findTranslationCounterpart(posts, post);
    pages.push({
      kind: 'report',
      lang: postLanguage(post),
      path: cleanReportHref(post.href),
      file: normalizeSitePath(post.href),
      indexable: true,
      post,
      // The pair the metadata defines; the rendered page must show exactly it.
      counterpartCanonical: counterpart ? reportSiteUrl(counterpart.href) : null
    });
  }
  for (const page of pages) {
    page.canonical = page.kind === 'report' ? reportSiteUrl(page.post.href) : new URL(page.path, PRODUCTION_ORIGIN).href;
  }
  return pages;
}

/* ------------------------------------------------------------ HTML reading */

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" };
const unescapeHtml = value => String(value).replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, entity => ENTITIES[entity]);

/** Attribute maps of every <name ...> tag (quote-aware). */
function tags(html, name) {
  const pattern = new RegExp(`<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'gi');
  return [...html.matchAll(pattern)].map(match => {
    const attrs = {};
    for (const attr of match[1].matchAll(/([^\s=/"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      attrs[attr[1].toLowerCase()] = unescapeHtml(attr[3] ?? attr[4] ?? attr[5] ?? '');
    }
    return attrs;
  });
}

function headOf(html) {
  const end = html.search(/<\/head>/i);
  return end >= 0 ? html.slice(0, end) : html;
}

function jsonLdNodes(html) {
  const nodes = [];
  const errors = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      for (const item of Array.isArray(data) ? data : [data]) {
        if (Array.isArray(item?.['@graph'])) nodes.push(...item['@graph']);
        else nodes.push(item);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { nodes, errors };
}

function readDocument(html) {
  const head = headOf(html);
  const title = [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map(match => unescapeHtml(match[1]).trim());
  const links = tags(html, 'link');
  const metas = tags(head, 'meta');
  const htmlTag = tags(html, 'html')[0] || {};
  const hrefs = [...tags(html, 'a'), ...links].map(attrs => attrs.href).filter(Boolean);
  return {
    lang: htmlTag.lang ?? null,
    titles: title,
    descriptions: metas.filter(m => (m.name || '').toLowerCase() === 'description').map(m => m.content ?? ''),
    canonicals: links.filter(l => (l.rel || '').toLowerCase().split(/\s+/).includes('canonical')).map(l => l.href || ''),
    alternates: links.filter(l => (l.rel || '').toLowerCase() === 'alternate' && l.hreflang).map(l => ({ lang: l.hreflang, href: l.href || '' })),
    robots: metas.filter(m => ['robots', 'googlebot'].includes((m.name || '').toLowerCase())).map(m => m.content || ''),
    images: metas.filter(m => ['og:image', 'twitter:image'].includes((m.property || m.name || '').toLowerCase())).map(m => m.content || ''),
    ogUrl: metas.filter(m => (m.property || '').toLowerCase() === 'og:url').map(m => m.content || ''),
    jsonLd: jsonLdNodes(html),
    reportHtmlLinks: hrefs.filter(href => {
      try {
        const url = new URL(href, PRODUCTION_ORIGIN);
        return url.host === PRODUCTION_HOST && /^\/reports\/.+\.html?$/i.test(url.pathname);
      } catch (_) { return false; }
    })
  };
}

/* ------------------------------------------------------------ checks */

function createReport(mode, origin) {
  return { mode, origin, failures: [], warnings: [], counts: {}, live: {} };
}

function fail(report, check, page, actual, expected) {
  report.failures.push({ check, url: page?.canonical || page?.url || '', id: page?.post?.id || '', actual, expected });
}

function warn(report, check, page, actual, note) {
  report.warnings.push({ check, url: page?.canonical || '', id: page?.post?.id || '', actual, note });
}

function isProductionUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.host === PRODUCTION_HOST;
  } catch (_) { return false; }
}

function localAssetPath(value) {
  if (!isProductionUrl(value)) return null;
  const pathname = decodeURIComponent(new URL(value).pathname);
  return path.join(ROOT, pathname.replace(/^\/+/, ''));
}

function checkAsset(report, page, value, label, assets) {
  if (!value) return;
  if (!/^https?:\/\//i.test(value)) {
    fail(report, `${label}.absolute`, page, value, 'absolute production URL');
    return;
  }
  if (!isProductionUrl(value)) {
    if (/pages\.dev/i.test(value)) fail(report, `${label}.origin`, page, value, PRODUCTION_ORIGIN);
    return; // external URLs are not requested
  }
  const file = localAssetPath(value);
  assets.checked += 1;
  if (!fs.existsSync(file)) {
    assets.broken += 1;
    fail(report, `${label}.missing-file`, page, value, `file ${path.relative(ROOT, file)}`);
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value) {
  if (!ISO_DAY.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkStructuredData(report, page, doc, assets, tally) {
  const { nodes, errors } = doc.jsonLd;
  for (const error of errors) fail(report, 'jsonld.parse', page, error, 'valid JSON-LD');
  const byType = type => nodes.filter(node => [].concat(node?.['@type'] || []).includes(type));
  for (const node of nodes) {
    const text = JSON.stringify(node);
    if (/pages\.dev/i.test(text)) fail(report, 'jsonld.origin', page, 'pages.dev URL in JSON-LD', PRODUCTION_ORIGIN);
    if (/snowshagal\.com\/reports\/[^"]*\.html?"/i.test(text)) fail(report, 'jsonld.legacy-html', page, 'report .html URL in JSON-LD', 'extensionless report URL');
  }
  for (const org of byType('Organization')) {
    if (org['@id'] !== ORGANIZATION_ID) fail(report, 'jsonld.organization.id', page, org['@id'], ORGANIZATION_ID);
    if (org.logo) checkAsset(report, page, typeof org.logo === 'string' ? org.logo : org.logo?.url, 'jsonld.organization.logo', assets);
  }

  if (page.kind === 'home' && page.lang === 'ko') {
    const orgs = byType('Organization');
    const sites = byType('WebSite');
    if (orgs.length !== 1) fail(report, 'jsonld.home.organization-count', page, orgs.length, 1);
    if (sites.length !== 1) fail(report, 'jsonld.home.website-count', page, sites.length, 1);
    const site = sites[0];
    if (site && site['@id'] !== WEBSITE_ID) fail(report, 'jsonld.home.website-id', page, site['@id'], WEBSITE_ID);
    if (site && site.url !== `${PRODUCTION_ORIGIN}/`) fail(report, 'jsonld.home.website-url', page, site.url, `${PRODUCTION_ORIGIN}/`);
    if (site && site.publisher?.['@id'] !== ORGANIZATION_ID) fail(report, 'jsonld.home.website-publisher', page, site.publisher?.['@id'], ORGANIZATION_ID);
  }

  if (page.kind === 'category' && page.indexable) {
    const crumbs = byType('BreadcrumbList');
    const items = crumbs[0]?.itemListElement || [];
    const home = page.lang === 'en' ? `${PRODUCTION_ORIGIN}/en/` : `${PRODUCTION_ORIGIN}/`;
    if (crumbs.length !== 1 || items.length !== 2 || items[0]?.item !== home || items[1]?.item !== page.canonical) {
      tally.breadcrumb += 1;
      fail(report, 'jsonld.category.breadcrumb', page, items.map(item => item?.item), [home, page.canonical]);
    }
  }

  if (page.kind !== 'report') return;
  const articles = byType('Article');
  if (articles.length !== 1) {
    tally.article += 1;
    fail(report, 'jsonld.article.count', page, articles.length, 1);
  }
  const article = articles[0];
  if (article) {
    const expectLang = page.lang === 'en' ? 'en' : 'ko';
    const problems = [];
    if (article['@id'] !== `${page.canonical}#article`) problems.push(['@id', article['@id'], `${page.canonical}#article`]);
    if (article.url !== page.canonical) problems.push(['url', article.url, page.canonical]);
    const main = typeof article.mainEntityOfPage === 'string' ? article.mainEntityOfPage : article.mainEntityOfPage?.['@id'];
    if (main !== page.canonical) problems.push(['mainEntityOfPage', main, page.canonical]);
    if (!String(article.headline || '').trim()) problems.push(['headline', article.headline, 'non-empty']);
    if (!String(article.description || '').trim()) problems.push(['description', article.description, 'non-empty']);
    if (!validDay(article.datePublished)) problems.push(['datePublished', article.datePublished, 'valid YYYY-MM-DD']);
    if (!String(article.inLanguage || '').toLowerCase().startsWith(expectLang)) problems.push(['inLanguage', article.inLanguage, expectLang]);
    if (article.publisher?.['@id'] !== ORGANIZATION_ID) problems.push(['publisher', article.publisher?.['@id'], ORGANIZATION_ID]);
    if (!article.author) problems.push(['author', article.author, 'present']);
    else if (article.author['@id'] && article.author['@id'] !== ORGANIZATION_ID) problems.push(['author.@id', article.author['@id'], ORGANIZATION_ID]);
    if ('dateModified' in article) problems.push(['dateModified', article.dateModified, 'absent (no fabricated dateModified)']);
    if (article.image) {
      const image = typeof article.image === 'string' ? article.image : article.image?.url;
      if (!isProductionUrl(image)) problems.push(['image', image, 'absolute production URL']);
      else checkAsset(report, page, image, 'jsonld.article.image', assets);
    }
    if (problems.length) tally.article += 1;
    for (const [field, actual, expected] of problems) fail(report, `jsonld.article.${field}`, page, actual, expected);
  }

  const crumbs = byType('BreadcrumbList');
  const items = crumbs[0]?.itemListElement || [];
  const home = page.lang === 'en' ? `${PRODUCTION_ORIGIN}/en/` : `${PRODUCTION_ORIGIN}/`;
  const category = `${PRODUCTION_ORIGIN}${categoryLandingPath(page.post.type, page.lang)}`;
  const expected = [home, category, page.canonical];
  const actual = items.map(item => item?.item);
  const ordered = items.every((item, index) => item?.position === index + 1 && String(item?.name || '').trim());
  if (crumbs.length !== 1 || JSON.stringify(actual) !== JSON.stringify(expected) || !ordered) {
    tally.breadcrumb += 1;
    fail(report, 'jsonld.breadcrumb', page, { count: crumbs.length, items: actual }, expected);
  }
}

/** One page: everything that can be judged from its own HTML and headers. */
function checkDocument(report, page, doc, headers, context) {
  const { assets, tally, preview } = context;

  // Canonical
  if (doc.canonicals.length !== 1) {
    tally.canonicalMissing += doc.canonicals.length === 0 ? 1 : 0;
    fail(report, 'canonical.count', page, doc.canonicals.length, 1);
  }
  const canonical = doc.canonicals[0] || '';
  page.renderedCanonical = canonical;
  if (canonical) {
    let url = null;
    try { url = new URL(canonical); } catch (_) {}
    if (!url || url.protocol !== 'https:') fail(report, 'canonical.absolute-https', page, canonical, 'absolute https URL');
    if (url && url.host !== PRODUCTION_HOST) {
      tally.nonProduction += 1;
      fail(report, 'canonical.origin', page, canonical, PRODUCTION_ORIGIN);
    }
    if (url && (url.search || url.hash || /[?#]/.test(canonical))) fail(report, 'canonical.query-fragment', page, canonical, 'no query or fragment');
    if (/\.html?$/i.test(url?.pathname || '')) {
      tally.legacyHtml += 1;
      fail(report, 'canonical.legacy-html', page, canonical, page.canonical);
    }
    if (canonical !== page.canonical) fail(report, 'canonical.self', page, canonical, page.canonical);
  }
  for (const value of doc.ogUrl) if (value !== page.canonical) fail(report, 'og:url', page, value, page.canonical);

  // Title / description
  if (doc.titles.length !== 1) fail(report, 'title.count', page, doc.titles.length, 1);
  if (doc.titles.length && !doc.titles[0]) fail(report, 'title.empty', page, '', 'non-empty <title>');
  if (doc.descriptions.length !== 1) fail(report, 'description.count', page, doc.descriptions.length, 1);
  if (doc.descriptions.length && !doc.descriptions[0].trim()) fail(report, 'description.empty', page, '', 'non-empty meta description');
  const title = doc.titles[0] || '';
  const description = (doc.descriptions[0] || '').trim();
  page.title = title;
  page.description = description;
  if (title.length > TITLE_WARN_LENGTH) warn(report, 'title.length', page, title.length, `longer than ${TITLE_WARN_LENGTH} characters (advisory)`);
  if (description.length > DESCRIPTION_WARN_LENGTH) warn(report, 'description.length', page, description.length, `longer than ${DESCRIPTION_WARN_LENGTH} characters (advisory)`);

  // Language
  if (doc.lang !== page.lang) {
    tally.lang += 1;
    fail(report, 'html.lang', page, doc.lang, page.lang);
  }

  // Indexability
  const robotsHeader = headers.get('x-robots-tag') || '';
  const metaNoindex = doc.robots.some(value => /noindex/i.test(value));
  if (metaNoindex) {
    tally.noindex += 1;
    fail(report, 'robots.meta-noindex', page, doc.robots.join(', '), 'no meta robots noindex');
  }
  if (preview) {
    if (!/noindex/i.test(robotsHeader) || !/nofollow/i.test(robotsHeader)) fail(report, 'robots.preview-header', page, robotsHeader || '(none)', 'noindex, nofollow');
  } else if (page.indexable && /noindex/i.test(robotsHeader)) {
    tally.noindex += 1;
    fail(report, 'robots.header-noindex', page, robotsHeader, 'no x-robots-tag noindex');
  } else if (!page.indexable && !/noindex/i.test(robotsHeader)) {
    fail(report, 'robots.empty-category', page, robotsHeader || '(none)', 'noindex (empty locale category)');
  }

  // Hreflang (reciprocity is judged across pages afterwards)
  page.alternates = doc.alternates;
  for (const entry of doc.alternates) {
    if (/\.html?$/i.test(entry.href)) fail(report, 'hreflang.legacy-html', page, entry.href, 'extensionless URL');
    if (!isProductionUrl(entry.href)) fail(report, 'hreflang.origin', page, entry.href, PRODUCTION_ORIGIN);
  }

  // Internal report links
  if (doc.reportHtmlLinks.length) {
    tally.internalHtml += doc.reportHtmlLinks.length;
    fail(report, 'links.report-html', page, doc.reportHtmlLinks.slice(0, 5), 'no /reports/*.html links');
  }

  // Images named by metadata
  for (const image of doc.images) checkAsset(report, page, image, 'meta.image', assets);
  checkStructuredData(report, page, doc, assets, tally);
}

function alternateMap(entries) {
  const map = {};
  for (const entry of entries || []) {
    if (map[entry.lang] !== undefined) map[`${entry.lang}#duplicate`] = entry.href;
    map[entry.lang] = entry.href;
  }
  return map;
}

/** Hreflang across pages: expected pairs, reciprocity, no invented counterparts. */
function checkHreflang(report, pages, tally) {
  const byCanonical = new Map(pages.filter(page => page.renderedCanonical).map(page => [page.canonical, page]));
  const seenPairs = new Set();
  for (const page of pages.filter(p => p.indexable)) {
    const map = alternateMap(page.alternates);
    const keys = Object.keys(map).sort();

    if (page.kind !== 'report') {
      if (!page.pair) {
        if (keys.length) fail(report, 'hreflang.unexpected', page, map, 'no hreflang (no locale pair)');
        continue;
      }
      const expected = {
        en: `${PRODUCTION_ORIGIN}${page.pair.en}`,
        ko: `${PRODUCTION_ORIGIN}${page.pair.ko}`,
        'x-default': `${PRODUCTION_ORIGIN}${page.pair.ko}`
      };
      if (JSON.stringify(map, Object.keys(map).sort()) !== JSON.stringify(expected, Object.keys(expected).sort())) {
        tally.hreflangBroken += 1;
        fail(report, 'hreflang.locale-pair', page, map, expected);
      }
      continue;
    }

    if (!keys.length) {
      if (page.counterpartCanonical) {
        tally.hreflangBroken += 1;
        fail(report, 'hreflang.missing', page, 'no hreflang', `ko/en/x-default with ${page.counterpartCanonical}`);
      }
      continue;
    }
    if (!page.counterpartCanonical) {
      tally.hreflangInvented += 1;
      fail(report, 'hreflang.invented', page, map, 'no hreflang (no translation pair in data/posts.json)');
      continue;
    }
    const self = map[page.lang];
    const otherLang = page.lang === 'ko' ? 'en' : 'ko';
    const counterpart = byCanonical.get(map[otherLang]);
    if (JSON.stringify(keys) !== JSON.stringify(['en', 'ko', 'x-default'])) {
      tally.hreflangBroken += 1;
      fail(report, 'hreflang.set', page, keys, ['en', 'ko', 'x-default']);
      continue;
    }
    if (self !== page.canonical) {
      tally.hreflangBroken += 1;
      fail(report, 'hreflang.self', page, self, page.canonical);
    }
    if (!counterpart || counterpart.kind !== 'report' || counterpart.lang !== otherLang) {
      tally.hreflangInvented += 1;
      fail(report, 'hreflang.counterpart-missing', page, map[otherLang], `an existing ${otherLang} report`);
      continue;
    }
    if (counterpart.canonical !== page.counterpartCanonical) fail(report, 'hreflang.counterpart', page, counterpart.canonical, page.counterpartCanonical);
    if (counterpart.post.type !== page.post.type) fail(report, 'hreflang.counterpart-type', page, counterpart.post.type, page.post.type);
    const day = post => String(post.reportDate || post.date || '').slice(0, 10);
    if (day(counterpart.post) !== day(page.post)) fail(report, 'hreflang.counterpart-date', page, `${counterpart.post.id} ${day(counterpart.post)}`, day(page.post));
    const koUrl = page.lang === 'ko' ? page.canonical : counterpart.canonical;
    if (map['x-default'] !== koUrl) fail(report, 'hreflang.x-default', page, map['x-default'], koUrl);
    const back = alternateMap(counterpart.alternates);
    if (back[page.lang] !== page.canonical || back[otherLang] !== counterpart.canonical) {
      tally.hreflangBroken += 1;
      fail(report, 'hreflang.reciprocal', page, { counterpart: counterpart.canonical, itsAlternates: back }, `${page.lang} → ${page.canonical}`);
      continue;
    }
    seenPairs.add([page.canonical, counterpart.canonical].sort().join(' | '));
  }
  tally.validPairs = seenPairs.size;
}

function checkUniqueness(report, pages) {
  const groups = (items, key) => {
    const map = new Map();
    for (const item of items) {
      const value = key(item);
      if (!value) continue;
      if (!map.has(value)) map.set(value, []);
      map.get(value).push(item);
    }
    return [...map.entries()].filter(([, list]) => list.length > 1);
  };
  const indexable = pages.filter(page => page.indexable);
  const duplicates = { canonical: 0, title: 0, description: 0 };
  for (const [value, list] of groups(indexable, page => page.renderedCanonical)) {
    duplicates.canonical += 1;
    fail(report, 'canonical.duplicate', list[0], value, `unique per document; shared by ${list.map(p => p.path).join(', ')}`);
  }
  const reports = indexable.filter(page => page.kind === 'report');
  for (const [value, list] of groups(reports, page => page.title)) {
    duplicates.title += 1;
    fail(report, 'title.duplicate', list[0], value, `unique report title; shared by ${list.map(p => p.post.id).join(', ')}`);
  }
  for (const [value, list] of groups(reports, page => page.description)) {
    duplicates.description += 1;
    fail(report, 'description.duplicate', list[0], value, `unique report description; shared by ${list.map(p => p.post.id).join(', ')}`);
  }
  return duplicates;
}

/* ------------------------------------------------------------ sitemap */

function parseSitemap(xml) {
  const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(match => unescapeHtml(match[1].trim()));
  const alternates = [...xml.matchAll(/<xhtml:link\b[^>]*href="([^"]*)"/g)].map(match => unescapeHtml(match[1]));
  return { locs, alternates };
}

function checkSitemap(report, xml, pages) {
  const { locs, alternates } = parseSitemap(xml);
  const result = { urls: locs.length, duplicate: 0, legacyHtml: 0, malformed: 0, pagesDev: 0, missing: [], unexpected: [] };
  const seen = new Set();
  for (const loc of locs) {
    if (seen.has(loc)) { result.duplicate += 1; fail(report, 'sitemap.duplicate', { url: loc }, loc, 'listed once'); }
    seen.add(loc);
    if (/pages\.dev/i.test(loc)) { result.pagesDev += 1; fail(report, 'sitemap.pages-dev', { url: loc }, loc, PRODUCTION_ORIGIN); }
    if (!isProductionUrl(loc)) { result.malformed += 1; fail(report, 'sitemap.malformed', { url: loc }, loc, 'absolute https production URL'); continue; }
    const url = new URL(loc);
    if (url.search || url.hash) { result.malformed += 1; fail(report, 'sitemap.malformed', { url: loc }, loc, 'no query or fragment'); }
    if (/^\/reports\/.+\.html?$/i.test(url.pathname)) { result.legacyHtml += 1; fail(report, 'sitemap.legacy-html', { url: loc }, loc, 'extensionless report URL'); }
  }
  for (const href of alternates) {
    if (/\.html?$/i.test(href) || !isProductionUrl(href)) fail(report, 'sitemap.hreflang', { url: href }, href, 'extensionless production URL');
  }
  const expected = new Set(pages.filter(page => page.indexable).map(page => page.canonical));
  result.missing = [...expected].filter(url => !seen.has(url));
  result.unexpected = [...seen].filter(url => !expected.has(url));
  for (const url of result.missing) fail(report, 'sitemap.missing', { url }, 'absent', 'listed (public indexable page)');
  for (const url of result.unexpected) fail(report, 'sitemap.unexpected', { url }, 'listed', 'not in the public corpus');
  return result;
}

/* ------------------------------------------------------------ core */

function newTally() {
  return { canonicalMissing: 0, nonProduction: 0, legacyHtml: 0, lang: 0, noindex: 0, internalHtml: 0, hreflangBroken: 0, hreflangInvented: 0, validPairs: 0, article: 0, breadcrumb: 0 };
}

function corpusCounts(pages) {
  const reports = pages.filter(page => page.kind === 'report');
  return {
    pages: pages.filter(page => page.indexable).length,
    reports: reports.length,
    koReports: reports.filter(page => page.lang === 'ko').length,
    enReports: reports.filter(page => page.lang === 'en').length,
    emptyCategories: pages.filter(page => page.kind === 'category' && !page.indexable).map(page => page.path)
  };
}

/**
 * Judges rendered documents exactly as received. `documents` maps a corpus
 * page's canonical URL to { status, headers, html } — or { missing: true } for
 * an absent file, { error } for a failed request. Corpus pages without an
 * entry are not audited (live mode audits what the sitemap lists). `sitemap`
 * is the sitemap XML, compared against the whole corpus.
 */
export function auditCorpus({ mode = 'repository', origin = PRODUCTION_ORIGIN, preview = false, corpus, documents, sitemap }) {
  const report = createReport(mode, origin);
  const assets = { checked: 0, broken: 0 };
  const tally = newTally();
  const audited = [];
  for (const page of corpus) {
    delete page.renderedCanonical;
    delete page.title;
    delete page.description;
    delete page.alternates;
    const doc = documents.get(page.canonical);
    if (!doc) continue;
    audited.push(page);
    if (doc.missing) {
      fail(report, page.kind === 'report' ? 'report.file-missing' : 'shell.file-missing', page, page.file, 'published file');
      continue;
    }
    if (doc.error) {
      fail(report, 'live.request', page, doc.error, 'HTTP response');
      continue;
    }
    if (doc.status !== 200) {
      fail(report, mode === 'live' ? 'live.status' : 'render.status', page, doc.status, 200);
      continue;
    }
    const type = doc.headers.get('content-type') || '';
    if (!/text\/html/i.test(type)) fail(report, 'content-type', page, type, 'text/html');
    checkDocument(report, page, readDocument(doc.html), doc.headers, { assets, tally, preview });
  }
  checkHreflang(report, audited, tally);
  const duplicates = checkUniqueness(report, audited);
  const sitemapResult = checkSitemap(report, sitemap, corpus);
  report.counts = { corpus: corpusCounts(corpus), audited: audited.length, tally, duplicates, sitemap: sitemapResult, assets };
  return report;
}

/* ------------------------------------------------------------ repository mode */

function readPosts() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data/posts.json'), 'utf8'));
}

function repositoryAssets(posts) {
  return {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/data/posts.json') return new Response(JSON.stringify(posts), { headers: { 'content-type': 'application/json' } });
      const file = path.join(ROOT, decodeURIComponent(pathname).replace(/^\/+/, ''));
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return new Response(fs.readFileSync(file), { headers: { 'content-type': 'application/json' } });
      return new Response('missing', { status: 404 });
    }
  };
}

async function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = original; }
}

/**
 * Every corpus page rendered by the real middleware from the files in the
 * repository, as a Production-host request with no D1 binding. The response
 * is handed to the checks untouched.
 */
export async function renderRepository(posts = readPosts()) {
  const corpus = buildCorpus(posts);
  const env = { ASSETS: repositoryAssets(posts) };
  const documents = new Map();
  for (const page of corpus) {
    const file = path.join(ROOT, page.file);
    if (!fs.existsSync(file)) {
      documents.set(page.canonical, { missing: true });
      continue;
    }
    const request = new Request(new URL(page.path, PRODUCTION_ORIGIN));
    const response = await quietly(() => middleware({
      request,
      env,
      next: async () => new Response(fs.readFileSync(file), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }));
    documents.set(page.canonical, { status: response.status, headers: response.headers, html: await response.text() });
  }
  return { corpus, documents };
}

export async function auditRepository({ posts = readPosts() } = {}) {
  const { corpus, documents } = await renderRepository(posts);
  return auditCorpus({ mode: 'repository', corpus, documents, sitemap: sitemapXml(posts) });
}

/* ------------------------------------------------------------ live mode */

async function pool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function fetchWithRetry(url, options = {}, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }); } catch (error) { lastError = error; }
  }
  throw lastError;
}

export async function auditLive(origin, { posts = readPosts() } = {}) {
  const base = new URL(origin).origin;
  const preview = base !== PRODUCTION_ORIGIN;
  const corpus = buildCorpus(posts);

  const sitemapResponse = await fetchWithRetry(`${base}/sitemap.xml`);
  if (sitemapResponse.status !== 200) throw new Error(`${base}/sitemap.xml answered ${sitemapResponse.status}`);
  const sitemap = await sitemapResponse.text();
  const listed = new Set(parseSitemap(sitemap).locs);
  const targets = corpus.filter(page => listed.has(page.canonical));

  let requested = 1;
  const documents = new Map();
  await pool(targets, LIVE_CONCURRENCY, async page => {
    requested += 1;
    try {
      const response = await fetchWithRetry(`${base}${new URL(page.canonical).pathname}`, { redirect: 'manual' });
      documents.set(page.canonical, { status: response.status, headers: response.headers, html: await response.text() });
    } catch (error) {
      documents.set(page.canonical, { error: error.message });
    }
  });
  const report = auditCorpus({ mode: 'live', origin: base, preview, corpus, documents, sitemap });

  // Legacy .html → one 301 to the clean URL, for every listed report.
  const reports = targets.filter(page => page.kind === 'report');
  let legacyOk = 0;
  await pool(reports, LIVE_CONCURRENCY, async page => {
    const clean = new URL(page.canonical).pathname;
    requested += 1;
    const response = await fetchWithRetry(`${base}${clean}.html`, { redirect: 'manual' }).catch(() => null);
    const location = response?.headers.get('location') || '';
    const expected = `${base}${clean}`;
    if (response?.status === 301 && location && new URL(location, base).href === expected) legacyOk += 1;
    else fail(report, 'live.legacy-redirect', page, `${response?.status ?? 'error'} ${location}`, `301 → ${expected}`);
  });

  const probe = `/reports/__seo_audit_missing_${Date.now().toString(36)}`;
  const missing = {};
  for (const suffix of ['', '.html']) {
    requested += 1;
    const response = await fetchWithRetry(`${base}${probe}${suffix}`, { redirect: 'manual' }).catch(() => null);
    missing[suffix || 'clean'] = response?.status ?? 'error';
    if (response?.status !== 404) fail(report, 'live.missing-report', { url: `${base}${probe}${suffix}` }, response?.status, 404);
  }
  const verification = {};
  for (const file of VERIFICATION_FILES) {
    requested += 1;
    const response = await fetchWithRetry(`${base}${file}`, { redirect: 'manual' }).catch(() => null);
    verification[file] = response?.status ?? 'error';
    if (response?.status !== 200) fail(report, 'live.verification-file', { url: `${base}${file}` }, response?.status, 200);
  }

  report.live = { preview, requested, pagesChecked: targets.length, legacyChecked: reports.length, legacyOk, missing, verification };
  return report;
}

/* ------------------------------------------------------------ output */

function line(label, value) {
  const dots = '.'.repeat(Math.max(2, 26 - label.length));
  return `  ${label} ${dots} ${value}`;
}

export function summarize(report) {
  const { tally, duplicates, sitemap, assets } = report.counts;
  const count = (...checks) => report.failures.filter(item => checks.includes(item.check)).length;
  const prefix = value => report.failures.filter(item => item.check.startsWith(value)).length;
  return {
    canonical: {
      missing: tally.canonicalMissing,
      other: prefix('canonical.') - tally.canonicalMissing - tally.nonProduction - tally.legacyHtml - duplicates.canonical,
      duplicate: duplicates.canonical,
      legacyHtml: tally.legacyHtml,
      nonProduction: tally.nonProduction,
      internalReportHtml: tally.internalHtml
    },
    metadata: {
      missingTitle: count('title.count', 'title.empty'),
      duplicateTitle: duplicates.title,
      missingDescription: count('description.count', 'description.empty'),
      duplicateDescription: duplicates.description
    },
    hreflang: { validPairs: tally.validPairs, broken: prefix('hreflang.') - tally.hreflangInvented, invented: tally.hreflangInvented },
    structuredData: {
      article: tally.article,
      breadcrumb: tally.breadcrumb,
      other: prefix('jsonld.') - prefix('jsonld.article') - prefix('jsonld.breadcrumb') - prefix('jsonld.category.breadcrumb'),
      imagesChecked: assets.checked,
      brokenImages: assets.broken
    },
    indexability: { unexpectedNoindex: tally.noindex, previewNoindexMissing: count('robots.preview-header'), langMismatch: tally.lang },
    sitemap: { urls: sitemap.urls, missing: sitemap.missing.length, unexpected: sitemap.unexpected.length, duplicate: sitemap.duplicate, legacyHtml: sitemap.legacyHtml, malformed: sitemap.malformed, pagesDev: sitemap.pagesDev },
    warnings: {
      title: report.warnings.filter(item => item.check === 'title.length').length,
      description: report.warnings.filter(item => item.check === 'description.length').length
    }
  };
}

export function formatReport(report) {
  const { corpus, tally } = report.counts;
  const summary = summarize(report);
  const scope = report.mode === 'live' ? 'Live' : 'Repository';
  const out = [];
  out.push('================================================');
  out.push('Snowshagal SEO Integrity Audit');
  out.push(`Mode: ${report.mode}${report.mode === 'live' ? ` (${report.origin}${report.live.preview ? ', Preview' : ', Production'})` : ' (no network)'}`);
  out.push('================================================', '');
  out.push('Corpus');
  out.push(line('Sitemap URLs', summary.sitemap.urls));
  out.push(line('Indexable pages', corpus.pages));
  out.push(line('Reports', corpus.reports));
  out.push(line('KO reports', corpus.koReports));
  out.push(line('EN reports', corpus.enReports));
  out.push(line('Translation pairs', tally.validPairs));
  out.push(line('Empty categories', corpus.emptyCategories.length ? corpus.emptyCategories.join(', ') : 0));
  if (report.mode === 'live') {
    out.push(line('Pages requested', report.live.pagesChecked));
    out.push(line('Legacy .html → 301', `${report.live.legacyOk}/${report.live.legacyChecked}`));
    out.push(line('HTTP requests total', report.live.requested));
  }
  out.push('', 'Canonical');
  out.push(line('Missing', summary.canonical.missing));
  out.push(line('Duplicate', summary.canonical.duplicate));
  out.push(line('Legacy .html', summary.canonical.legacyHtml));
  out.push(line('Non-production origin', summary.canonical.nonProduction));
  out.push(line('Other canonical errors', summary.canonical.other));
  out.push(line('Internal report .html', summary.canonical.internalReportHtml));
  out.push('', 'Metadata');
  out.push(line('Missing title', summary.metadata.missingTitle));
  out.push(line('Duplicate title', summary.metadata.duplicateTitle));
  out.push(line('Missing description', summary.metadata.missingDescription));
  out.push(line('Duplicate description', summary.metadata.duplicateDescription));
  out.push('', 'Hreflang');
  out.push(line('Valid pairs', summary.hreflang.validPairs));
  out.push(line('Broken reciprocal', summary.hreflang.broken));
  out.push(line('Invented counterpart', summary.hreflang.invented));
  out.push('', 'Structured Data');
  out.push(line('Article errors', summary.structuredData.article));
  out.push(line('Breadcrumb errors', summary.structuredData.breadcrumb));
  out.push(line('Other JSON-LD errors', summary.structuredData.other));
  out.push(line('Image refs checked', summary.structuredData.imagesChecked));
  out.push(line('Broken image refs', summary.structuredData.brokenImages));
  out.push('', 'Indexability');
  out.push(line('Unexpected noindex', summary.indexability.unexpectedNoindex));
  if (report.mode === 'live' && report.live.preview) out.push(line('Preview noindex missing', summary.indexability.previewNoindexMissing));
  out.push(line('HTML lang mismatch', summary.indexability.langMismatch));
  out.push('', 'Sitemap');
  out.push(line('Missing', summary.sitemap.missing));
  out.push(line('Unexpected', summary.sitemap.unexpected));
  out.push(line('Duplicate', summary.sitemap.duplicate));
  out.push(line('Legacy .html', summary.sitemap.legacyHtml));
  out.push(line('Malformed / pages.dev', `${summary.sitemap.malformed} / ${summary.sitemap.pagesDev}`));
  if (report.mode === 'live') {
    out.push('', 'HTTP');
    out.push(line('Missing report', Object.entries(report.live.missing).map(([k, v]) => `${k} ${v}`).join(', ')));
    for (const [file, status] of Object.entries(report.live.verification)) out.push(line(file.replace(/^\//, '').replace(/^(\w{6})\w*(\.html)$/, '$1…$2'), status));
  }
  out.push('', `${scope} warnings (advisory, never fail)`);
  out.push(line('Title length', summary.warnings.title));
  out.push(line('Description length', summary.warnings.description));
  if (report.failures.length) {
    out.push('', `Failures (${report.failures.length})`);
    for (const item of report.failures) {
      out.push(`  ✖ ${item.check}${item.id ? ` [${item.id}]` : ''} ${item.url}`);
      out.push(`      actual:   ${JSON.stringify(item.actual)}`);
      out.push(`      expected: ${JSON.stringify(item.expected)}`);
    }
  }
  if (report.warnings.length) {
    out.push('', `${scope} warning details`);
    const byCheck = {};
    for (const item of report.warnings) (byCheck[item.check] ||= []).push(item);
    for (const [check, items] of Object.entries(byCheck)) {
      out.push(`  ! ${check}: ${items.length} — ${items[0].note}`);
      for (const item of items.slice(0, 5)) out.push(`      ${item.actual}  ${item.url}`);
      if (items.length > 5) out.push(`      … ${items.length - 5} more`);
    }
  }
  out.push('', `RESULT: ${report.failures.length ? 'FAIL' : 'PASS'}${report.warnings.length ? ` (${report.warnings.length} warnings)` : ''}`);
  return out.join('\n');
}

/* ------------------------------------------------------------ CLI */

async function main(argv) {
  const originArg = argv.find(arg => arg.startsWith('--origin='));
  const json = argv.includes('--json');
  const report = originArg ? await auditLive(originArg.slice('--origin='.length)) : await auditRepository();
  if (json) process.stdout.write(`${JSON.stringify({ result: report.failures.length ? 'FAIL' : 'PASS', summary: summarize(report), ...report }, null, 2)}\n`);
  else console.log(formatReport(report));
  return report.failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(`SEO audit could not run: ${error?.stack || error}`);
    process.exitCode = 2;
  });
}
