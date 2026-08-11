import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function localeHelpers() {
  const context = { window: {}, URLSearchParams };
  vm.runInNewContext(await read('assets/locale.js'), context);
  return context.window.MARKET_LOCALE;
}

const fixturePosts = [
  { id: 'legacy-daily', type: 'daily', title: '한국어 데일리', description: '원화 수급', reportDate: '2026-08-10', href: 'reports/ko.html' },
  { id: 'ko-weekly', lang: 'ko', type: 'weekly', title: '한국어 위클리', reportDate: '2026-08-11', href: 'reports/weekly.html', translationGroup: 'weekly-pair' },
  { id: 'en-daily', lang: 'en', type: 'daily', title: 'English Daily', description: 'Dollar flows', reportDate: '2026-08-12', href: 'reports/en/daily.html' },
  { id: 'en-weekly', lang: 'en', type: 'weekly', title: 'English Weekly', reportDate: '2026-08-11', href: 'reports/en/weekly.html', translationGroup: 'weekly-pair' }
];

test('legacy posts are Korean and homepage data stays separated by language', async () => {
  const api = await localeHelpers();
  assert.equal(api.postLanguage(fixturePosts[0]), 'ko');
  assert.deepEqual(Array.from(api.localePosts(fixturePosts, 'ko'), post => post.id), ['legacy-daily', 'ko-weekly']);
  assert.deepEqual(Array.from(api.localePosts(fixturePosts, 'en'), post => post.id), ['en-daily', 'en-weekly']);

  assert.deepEqual(Array.from(api.latestByCore(fixturePosts, 'ko'), post => post.id), ['legacy-daily', 'ko-weekly']);
  assert.deepEqual(Array.from(api.latestByCore(fixturePosts, 'en'), post => post.id), ['en-daily', 'en-weekly']);
  assert.deepEqual({ ...api.categoryCounts(fixturePosts, 'ko') }, { daily: 1, weekly: 1, research: 0, basics: 0, note: 0 });
  assert.deepEqual({ ...api.categoryCounts(fixturePosts, 'en') }, { daily: 1, weekly: 1, research: 0, basics: 0, note: 0 });
  assert.deepEqual(Array.from(api.searchPosts(fixturePosts, 'ko', 'Dollar'), post => post.id), []);
  assert.deepEqual(Array.from(api.searchPosts(fixturePosts, 'en', 'Dollar'), post => post.id), ['en-daily']);
});

test('language URLs preserve category queries without browser-language redirects', async () => {
  const [api, site, koHome, enHome] = await Promise.all([
    localeHelpers(), read('assets/site.js'), read('index.html'), read('en/index.html')
  ]);
  assert.equal(api.pageLanguagePath('/', 'en', '?category=weekly'), '/en/?category=weekly');
  assert.equal(api.pageLanguagePath('/en/', 'ko', '?category=weekly'), '/?category=weekly');
  assert.equal(api.pageLanguagePath('/about/', 'en'), '/en/about/');
  assert.equal(api.pageLanguagePath('/en/about/', 'ko'), '/about/');
  assert.doesNotMatch(site, /navigator\.language|navigator\.languages/);
  assert.doesNotMatch(site, /getItem\(['"]site-language/);
  assert.match(site, /setItem\('site-language', target\)/);
  assert.match(koHome, /data-site-lang="ko"/);
  assert.match(enHome, /data-site-lang="en"/);
});

test('report translation counterpart lookup and locale homepage fallback are deterministic', async () => {
  const api = await localeHelpers();
  const counterpart = api.findCounterpart(fixturePosts, '/reports/weekly.html', 'en');
  assert.equal(counterpart.id, 'en-weekly');
  assert.equal(api.findCounterpart(fixturePosts, '/reports/ko.html', 'en'), null);
  assert.equal(api.homepagePath('en'), '/en/');
  assert.equal(api.homepagePath('ko'), '/');

  const [middleware, shell] = await Promise.all([read('functions/_middleware.js'), read('assets/report-shell.js')]);
  assert.match(middleware, /data-lang="\$\{lang\}"/);
  assert.match(middleware, /\/assets\/locale\.js/);
  assert.match(shell, /findCounterpart\(posts, location\.pathname, targetLocale\)/);
  assert.match(shell, /const fallback = localeApi\.homepagePath\(targetLocale\)/);
  assert.match(shell, /Comments/);
  assert.match(shell, /Market Basics/);
  assert.match(shell, /attachShadow\(\{ mode: 'open' \}\)/);
});

test('English and Korean page shells expose restrained desktop and mobile language controls', async () => {
  const pages = await Promise.all(['index.html', 'en/index.html', 'about/index.html', 'en/about/index.html'].map(read));
  for (const html of pages) {
    assert.match(html, /class="language-switch"/);
    assert.match(html, /class="mobile-language"/);
    assert.match(html, /data-language-choice="ko"/);
    assert.match(html, /data-language-choice="en"/);
    assert.doesNotMatch(html, /🇰🇷|🇺🇸|🇬🇧/);
  }
  assert.match(pages[1], />Daily</);
  assert.match(pages[1], />Recent Reports</);
  assert.match(pages[1], />All</);
  assert.match(pages[1], /No English reports match these filters yet|assets\/site\.js/);
});

test('publisher admin exposes language and optional translation pairing without changing category controls', async () => {
  const [html, script] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /id="post-language"[^>]*value="ko"/);
  assert.match(html, /name="post-language-choice" value="ko" checked/);
  assert.match(html, /name="post-language-choice" value="en"/);
  assert.match(html, /id="translation-source"/);
  assert.match(script, /form\.append\('lang', language\)/);
  assert.match(script, /form\.append\('translationGroup', translationSource\.value\)/);
  assert.match(script, /form\.append\('type', postType\)/);
});

test('repository post files remain synchronized and allow optional locale metadata', async () => {
  const [jsonText, jsText] = await Promise.all([read('data/posts.json'), read('data/posts.js')]);
  const posts = JSON.parse(jsonText);
  assert.equal(jsText.replace(/\r\n/g, '\n'), `window.RESEARCH_POSTS = ${JSON.stringify(posts, null, 2)};\n`);
  for (const post of posts) {
    if (Object.hasOwn(post, 'lang')) assert.ok(['ko', 'en'].includes(post.lang));
    if (Object.hasOwn(post, 'translationGroup')) assert.equal(typeof post.translationGroup, 'string');
  }
});
