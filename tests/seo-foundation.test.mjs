import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';
import {
  CATEGORY_LANDINGS,
  CATEGORY_SLUGS,
  PRODUCTION_ORIGIN,
  categoryHasPosts,
  categoryLandingPath,
  categoryReportLinks,
  cleanReportHref,
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

function sitemapLocations(posts) {
  return [...sitemapXml(posts).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

function categoryShell(lang) {
  const prefix = lang === 'en' ? '/en' : '';
  return `<!doctype html><html><head>
    <link rel="alternate" hreflang="ko" href="https://snowshagal.com/notes/">
    <link rel="alternate" hreflang="en" href="https://snowshagal.com/en/notes/">
    <link rel="alternate" hreflang="x-default" href="https://snowshagal.com/notes/">
    </head><body><nav>
    ${Object.entries(CATEGORY_SLUGS).map(([type, slug]) => `<a data-nav-category="${type}" href="${prefix}/${slug}/">${type}</a>`).join('')}
    </nav><div id="category-report-list"></div></body></html>`;
}

async function renderCategory(path, posts) {
  const lang = path.startsWith('/en/') ? 'en' : 'ko';
  return middlewareRequest({
    request: new Request(`https://snowshagal.com${path}`),
    env: { ASSETS: { fetch: async () => Response.json(posts) } },
    next: async () => new Response(categoryShell(lang), { headers: { 'content-type': 'text/html' } })
  });
}

async function renderHome(lang, posts) {
  const path = lang === 'en' ? '/en/' : '/';
  const prefix = lang === 'en' ? '/en' : '';
  const nav = Object.entries(CATEGORY_SLUGS)
    .map(([type, slug]) => `<a data-nav-category="${type}" href="${prefix}/${slug}/">${type}</a>`)
    .join('');
  return middlewareRequest({
    request: new Request(`https://snowshagal.com${path}`),
    env: { ASSETS: { fetch: async () => Response.json(posts) } },
    next: async () => new Response(`<!doctype html><html><head></head><body><nav>${nav}</nav><div id="latest-category-cards"></div><div id="report-list"></div></body></html>`, { headers: { 'content-type': 'text/html' } })
  });
}

function fixturePost(type, lang, suffix = '') {
  return {
    id: `${lang}-${type}${suffix}`,
    type,
    lang,
    title: `${lang} ${type}${suffix}`,
    reportDate: '2026-08-27',
    href: `reports/${lang === 'en' ? 'en/' : ''}${type}${suffix || ''}.html`
  };
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
      assert.doesNotMatch(href, /\.html?$/i, 'internal links must use clean URLs');
      const decoded = decodeURIComponent(href.replace(/^\//, ''));
      await access(fileURLToPath(new URL(`../${decoded}.html`, import.meta.url)));
    }
    const localizedPaths = new Set(posts.filter((post) => postLanguage(post) === lang).map((post) => cleanReportHref(post.href)));
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
  const expected = new Set(posts.filter((post) => postLanguage(post) === 'ko' && post.type === 'daily').map((post) => cleanReportHref(post.href)));
  for (const href of hrefs(landingHtml)) assert.ok(expected.has(href), `daily landing leaked ${href}`);
});

test('all category landing pages have unique metadata, H1, self canonical, and runtime-managed locale links', async () => {
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
      assert.doesNotMatch(html, /<link rel="alternate" hreflang=/, 'category alternates must follow live posts data');
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
      assert.deepEqual(new Set(links), new Set(expected.map((post) => cleanReportHref(post.href))));
      for (const post of expected) await access(fileURLToPath(new URL(`../${post.href}`, import.meta.url)));
    }
  }
});

test('report SEO title and description are non-empty, unique, and preserve explicit summaries before dated fallbacks', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const titles = posts.map(reportSeoTitle);
  const descriptions = posts.map(reportDescription);
  assert.equal(new Set(titles).size, titles.length, 'report SEO titles must be unique');
  assert.equal(new Set(descriptions).size, descriptions.length, 'report SEO descriptions must be unique');
  for (const post of posts) {
    const title = reportSeoTitle(post);
    const description = reportDescription(post);
    const tags = reportSeoTags(posts, post);
    assert.ok(title.includes('Snowshagal'));
    assert.ok(title.includes(post.title));
    assert.ok(description.length > 0);
    assert.ok(description.length <= 180, `${post.id} description is too long`);
    assert.match(tags, /<title>[^<]+<\/title>/);
    assert.match(tags, /<meta name="description" content="[^"]+">/);
    assert.ok(tags.includes(`rel="canonical" href="${reportSiteUrl(post.href)}`));
    const summary = String(post.summary || '').replace(/\s+/g, ' ').trim();
    if (summary) assert.equal(description, summary);
    else if (post.title && (post.reportDate || post.date)) {
      assert.match(description, new RegExp(String(post.reportDate || post.date).slice(0, 4)));
      assert.ok(description.includes(post.title), `${post.id} lacks title context`);
    }
  }
  const fallback = { lang: 'en', type: 'note', title: 'A Small Observation', href: 'reports/en/note.html' };
  assert.match(reportDescription(fallback), /A Small Observation/);
  assert.equal(reportDescription({ lang: 'en', type: 'daily', title: 'No date', description: 'Safe copy.' }), 'Safe copy.');
  assert.equal(reportDescription({ lang: 'ko', type: 'daily', reportDate: '2026-08-27', description: '안전 문구.' }), '안전 문구.');
  assert.ok(reportDescription({ lang: 'en', type: 'daily', title: 'Long', reportDate: '2026-08-27', summary: 'word '.repeat(100) }).length <= 180);
});

test('report hreflang is reciprocal only for real KO and EN translation pairs', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const byHref = new Map(posts.map((post) => [reportSiteUrl(post.href), post]));
  for (const post of posts) {
    const alternates = reportAlternates(posts, post);
    const group = String(post.translationGroup || post.id || '').trim();
    const grouped = posts.filter((candidate) => String(candidate.translationGroup || candidate.id || '').trim() === group);
    const hasExactPair = grouped.filter((candidate) => postLanguage(candidate) === 'ko').length === 1
      && grouped.filter((candidate) => postLanguage(candidate) === 'en').length === 1;
    if (!hasExactPair) {
      assert.deepEqual(alternates, []);
      assert.doesNotMatch(reportSeoTags(posts, post), /hreflang=/);
      continue;
    }
    assert.ok(alternates.length, `${post.id} real translation pair was omitted`);
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

test('sitemap includes only populated locale category landings without duplicate or malformed URLs', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const locations = sitemapLocations(posts);
  assert.equal(new Set(locations).size, locations.length);
  for (const type of Object.keys(CATEGORY_SLUGS)) {
    for (const lang of ['ko', 'en']) {
      const expected = `${PRODUCTION_ORIGIN}${categoryLandingPath(type, lang)}`;
      assert.equal(locations.includes(expected), categoryHasPosts(posts, type, lang), expected);
    }
  }
  for (const location of locations) {
    const url = new URL(location);
    assert.equal(url.origin, PRODUCTION_ORIGIN);
    assert.doesNotMatch(url.pathname, /\/\//);
  }
});

test('empty category SEO gating follows locale posts and restores itself when the first post appears', async () => {
  const core = ['daily', 'weekly', 'research', 'basics']
    .flatMap((type) => [fixturePost(type, 'ko'), fixturePost(type, 'en')]);
  const koNote = fixturePost('note', 'ko');
  const enNote = fixturePost('note', 'en');

  // KO/EN both empty: routes remain, but both are noindex and absent from sitemap/hreflang. Nav remains visible.
  const emptyLocations = sitemapLocations(core);
  for (const path of ['/notes/', '/en/notes/']) {
    assert.ok(!emptyLocations.includes(`${PRODUCTION_ORIGIN}${path}`));
    const response = await renderCategory(path, core);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow');
    const html = await response.text();
    assert.match(html, /data-nav-category="note"/);
    assert.doesNotMatch(html, /hreflang=/);
  }
  for (const lang of ['ko', 'en']) {
    const home = await renderHome(lang, core);
    assert.match(await home.text(), /data-nav-category="note"/);
  }

  // KO only: only KO is indexable/discoverable; neither page invents a locale counterpart.
  const koreanOnly = [...core, koNote];
  const koreanLocations = sitemapLocations(koreanOnly);
  assert.ok(koreanLocations.includes(`${PRODUCTION_ORIGIN}/notes/`));
  assert.ok(!koreanLocations.includes(`${PRODUCTION_ORIGIN}/en/notes/`));
  const koOnlyPage = await renderCategory('/notes/', koreanOnly);
  const enEmptyPage = await renderCategory('/en/notes/', koreanOnly);
  assert.equal(koOnlyPage.headers.get('x-robots-tag'), null);
  assert.equal(enEmptyPage.headers.get('x-robots-tag'), 'noindex, follow');
  assert.doesNotMatch(await koOnlyPage.text(), /hreflang=/);
  assert.doesNotMatch(await enEmptyPage.text(), /hreflang=/);
  assert.match(await (await renderHome('ko', koreanOnly)).text(), /data-nav-category="note"/);
  assert.match(await (await renderHome('en', koreanOnly)).text(), /data-nav-category="note"/);

  // Both locales populated: both URLs and reciprocal alternates return automatically.
  const bilingual = [...koreanOnly, enNote];
  const bilingualXml = sitemapXml(bilingual);
  for (const path of ['/notes/', '/en/notes/']) {
    assert.ok(sitemapLocations(bilingual).includes(`${PRODUCTION_ORIGIN}${path}`));
    const response = await renderCategory(path, bilingual);
    assert.equal(response.headers.get('x-robots-tag'), null);
    const html = await response.text();
    for (const lang of ['ko', 'en', 'x-default']) assert.match(html, new RegExp(`hreflang="${lang}"`));
    assert.match(html, /data-nav-category="note"/);
  }
  for (const lang of ['ko', 'en', 'x-default']) assert.match(bilingualXml, new RegExp(`hreflang="${lang}"`));
  for (const lang of ['ko', 'en']) assert.match(await (await renderHome(lang, bilingual)).text(), /data-nav-category="note"/);

  // The four established category pairs remain indexable and reciprocal throughout.
  for (const type of ['daily', 'weekly', 'research', 'basics']) {
    for (const lang of ['ko', 'en']) {
      const path = categoryLandingPath(type, lang);
      assert.ok(emptyLocations.includes(`${PRODUCTION_ORIGIN}${path}`));
      const response = await renderCategory(path, core);
      assert.equal(response.headers.get('x-robots-tag'), null);
      const html = await response.text();
      for (const alternate of ['ko', 'en', 'x-default']) assert.match(html, new RegExp(`hreflang="${alternate}"`));
    }
  }
});
