import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const navBlocks = html => [...html.matchAll(/<nav class="(?:main-nav|mobile-quick-nav)"[\s\S]*?<\/nav>/g)].map(match => match[0]);

const KO_CATEGORY_LINKS = {
  daily: '/daily/',
  weekly: '/weekly/',
  research: '/research/',
  basics: '/basics/',
  note: '/notes/'
};

const EN_CATEGORY_LINKS = {
  daily: '/en/daily/',
  weekly: '/en/weekly/',
  research: '/en/research/',
  basics: '/en/basics/',
  note: '/en/notes/'
};

function assertDirectCategoryLinks(nav, links) {
  for (const [type, href] of Object.entries(links)) {
    assert.match(nav, new RegExp(`data-nav-category="${type}"[^>]*href="${href.replaceAll('/', '\\/')}"`));
  }
  assert.doesNotMatch(nav, /\?category=/);
}

test('KO and EN homepage desktop and mobile navigation use category landings', async () => {
  const [ko, en] = await Promise.all([read('index.html'), read('en/index.html')]);
  const koNavs = navBlocks(ko);
  const enNavs = navBlocks(en);
  assert.equal(koNavs.length, 2);
  assert.equal(enNavs.length, 2);
  koNavs.forEach(nav => assertDirectCategoryLinks(nav, KO_CATEGORY_LINKS));
  enNavs.forEach(nav => assertDirectCategoryLinks(nav, EN_CATEGORY_LINKS));
});

test('KO About desktop and mobile navigation use category landings', async () => {
  const navs = navBlocks(await read('about/index.html'));
  assert.equal(navs.length, 2);
  navs.forEach(nav => assertDirectCategoryLinks(nav, KO_CATEGORY_LINKS));
});

test('EN About desktop and mobile navigation use category landings', async () => {
  const navs = navBlocks(await read('en/about/index.html'));
  assert.equal(navs.length, 2);
  navs.forEach(nav => assertDirectCategoryLinks(nav, EN_CATEGORY_LINKS));
});

test('KO Market desktop and mobile navigation use category landings and keep Market active', async () => {
  const html = await read('market/index.html');
  const navs = navBlocks(html);
  assert.equal(navs.length, 2);
  navs.forEach(nav => {
    assertDirectCategoryLinks(nav, KO_CATEGORY_LINKS);
    assert.match(nav, /class="active" href="\/market\/" aria-current="page">마켓<\/a>/);
  });
});

test('EN Market desktop and mobile navigation use category landings and keep Market active', async () => {
  const html = await read('en/market/index.html');
  const navs = navBlocks(html);
  assert.equal(navs.length, 2);
  navs.forEach(nav => {
    assertDirectCategoryLinks(nav, EN_CATEGORY_LINKS);
    assert.match(nav, /class="active" href="\/en\/market\/" aria-current="page">Market<\/a>/);
  });
});

test('all ten category landing shells and their generator retain direct navigation URLs', async () => {
  const pages = [
    ['daily/index.html', KO_CATEGORY_LINKS],
    ['weekly/index.html', KO_CATEGORY_LINKS],
    ['research/index.html', KO_CATEGORY_LINKS],
    ['basics/index.html', KO_CATEGORY_LINKS],
    ['notes/index.html', KO_CATEGORY_LINKS],
    ['en/daily/index.html', EN_CATEGORY_LINKS],
    ['en/weekly/index.html', EN_CATEGORY_LINKS],
    ['en/research/index.html', EN_CATEGORY_LINKS],
    ['en/basics/index.html', EN_CATEGORY_LINKS],
    ['en/notes/index.html', EN_CATEGORY_LINKS]
  ];
  for (const [path, links] of pages) {
    const navs = navBlocks(await read(path));
    assert.equal(navs.length, 2, path);
    navs.forEach(nav => assertDirectCategoryLinks(nav, links));
  }
  const generator = await read('scripts/build-category-pages.mjs');
  assert.match(generator, /categoryLandingPath\(type, lang\)/);
  assert.doesNotMatch(generator, /\?category=/);
});

test('Report Shell uses locale category paths while preserving Notes gating and active state', async () => {
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /function categoryPath\(type\)/);
  assert.match(shell, /const prefix = locale === 'en' \? '\/en' : ''/);
  assert.match(shell, /const slug = type === 'note' \? 'notes' : type/);
  for (const type of ['daily', 'weekly', 'research', 'basics', 'note']) {
    assert.match(shell, new RegExp(`href="\\$\\{categoryPath\\('${type}'\\)\\}"`));
  }
  assert.match(shell, /hasNotes \|\| active === 'note'/);
  assert.match(shell, /active === 'daily' \? 'active' : ''/);
  assert.match(shell, /active === 'note' \? 'aria-current="true"' : ''/);
  assert.doesNotMatch(shell, /href="\$\{homePath\}\?category=/);
});

test('public navigation markup no longer emits legacy category query links', async () => {
  const paths = [
    'index.html', 'en/index.html', 'about/index.html', 'en/about/index.html',
    'market/index.html', 'en/market/index.html', 'daily/index.html', 'weekly/index.html',
    'research/index.html', 'basics/index.html', 'notes/index.html', 'en/daily/index.html',
    'en/weekly/index.html', 'en/research/index.html', 'en/basics/index.html', 'en/notes/index.html'
  ];
  for (const path of paths) {
    const navs = navBlocks(await read(path));
    navs.forEach(nav => assert.doesNotMatch(nav, /\?category=/, path));
  }
});

test('homepage category query deep links remain supported for backward compatibility', async () => {
  const [site, locale] = await Promise.all([read('assets/site.js'), read('assets/locale.js')]);
  assert.match(site, /href="\?category=\$\{encodeURIComponent\(type\)\}"/);
  assert.match(site, /params\.get\('category'\)/);
  assert.match(locale, /\?category=\$\{encodeURIComponent\(category\)\}/);
});

test('report and category Clean URL behavior remains intact', async () => {
  const [shell, categoryClient] = await Promise.all([
    read('assets/report-shell.js'),
    read('assets/category-landing.js')
  ]);
  assert.match(shell, /replace\(\/\\\.html\?\$\/i, ''\)/);
  assert.match(categoryClient, /cleanReportUrl/);
  assert.doesNotMatch(categoryClient, /href[^\n]*\.html["']/);
});
