import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
  CATEGORY_FEATURED_COVER_SIZES,
  LATEST_CARD_COVER_SIZES,
  categoryFeaturedCards,
  coverImageMarkup,
  homepageLatestLinks,
  postLanguage,
  reportSeoTags
} from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const imgOf = html => html.match(/<img[^>]*>/g) || [];
const loadingOf = img => (img.match(/loading="([^"]*)"/) || [])[1];

const post = (id, lang, extra = {}) => ({
  id, type: 'research', lang, title: `T ${id}`,
  href: lang === 'en' ? `reports/en/${id}.html` : `reports/${id}.html`,
  reportDate: extra.reportDate || '2026-09-01', date: extra.reportDate || '2026-09-01', registeredAt: '2026-09-01T00:00:00.000Z',
  coverImage: `covers/${id}.webp`, coverThumbnail: `covers/${id}-450.webp`, tags: ['rates'],
  ...extra
});

/**
 * Runs assets/category-landing.js against the smallest document it needs and
 * returns what it wrote into the featured host — the markup a browser gets
 * after the script re-renders the server's cards.
 */
async function browserFeaturedMarkup(posts, lang, category = 'research') {
  const script = await read('assets/category-landing.js');
  const host = { innerHTML: '', hidden: false };
  const element = () => ({ innerHTML: '', hidden: false });
  const byId = {
    'category-featured-section': element(),
    'category-featured-cards': host,
    'category-archive-section': element(),
    'category-report-list': element()
  };
  const sandbox = {
    document: {
      documentElement: { lang },
      body: { dataset: { category } },
      getElementById: id => byId[id] || null,
      querySelectorAll: () => []
    },
    RESEARCH_POSTS: posts,
    TAG_REGISTRY: { rates: { ko: '금리', en: 'Rates' } }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(script, sandbox);
  return host.innerHTML;
}

/* ------------------------------------- the first card is eager, the second lazy */

test('server: the first featured cover is eager and the second lazy, in KO and EN', () => {
  for (const lang of ['ko', 'en']) {
    const posts = [post('newer', lang, { reportDate: '2026-09-02' }), post('older', lang, { reportDate: '2026-09-01' })];
    const imgs = imgOf(categoryFeaturedCards(posts, 'research', lang));
    assert.equal(imgs.length, 2, `${lang}: two featured covers`);
    assert.match(imgs[0], /src="\/covers\/newer\.webp"/, `${lang}: the newest post comes first`);
    assert.equal(loadingOf(imgs[0]), 'eager', `${lang}: first`);
    assert.equal(loadingOf(imgs[1]), 'lazy', `${lang}: second`);
    // The rest of the picture is exactly what PR #99 ships: same two files, same sizes.
    for (const img of imgs) {
      assert.match(img, /srcset="\/covers\/[a-z]+-450\.webp 450w, \/covers\/[a-z]+\.webp 900w"/);
      assert.match(img, new RegExp(`sizes="${CATEGORY_FEATURED_COVER_SIZES.replace(/[().]/g, '\\$&')}"`));
      assert.match(img, /width="900" height="1350"/);
      assert.doesNotMatch(img, /fetchpriority/, 'no priority hint: it measured no better than eager alone');
    }
  }
});

test('server: a landing with a single featured post still requests that one cover at once', () => {
  const imgs = imgOf(categoryFeaturedCards([post('only', 'ko')], 'research', 'ko'));
  assert.equal(imgs.length, 1);
  assert.equal(loadingOf(imgs[0]), 'eager');
});

test('server: a first cover with no thumbnail on record is the plain original, still eager, still naming no -450 file', () => {
  for (const thumbnail of [undefined, '', null, 'covers/first.webp']) {
    const posts = [post('first', 'ko', { reportDate: '2026-09-02', coverThumbnail: thumbnail }), post('second', 'ko')];
    const imgs = imgOf(categoryFeaturedCards(posts, 'research', 'ko'));
    assert.equal(imgs[0], '<img src="/covers/first.webp" alt="" loading="eager">', JSON.stringify(thumbnail));
    assert.doesNotMatch(imgs[0], /srcset|sizes|-450/);
    assert.equal(loadingOf(imgs[1]), 'lazy');
    assert.match(imgs[1], /srcset=/);
  }
  // And the other way round: a lazy second card without a thumbnail.
  const imgs = imgOf(categoryFeaturedCards([post('first', 'ko', { reportDate: '2026-09-02' }), post('second', 'ko', { coverThumbnail: undefined })], 'research', 'ko'));
  assert.equal(imgs[1], '<img src="/covers/second.webp" alt="" loading="lazy">');
});

/* -------------------------------- the browser re-render applies the same rule */

test('browser: category-landing.js renders the same covers with the same loading, so its re-render never turns the eager cover lazy', async () => {
  for (const lang of ['ko', 'en']) {
    const posts = [post('newer', lang, { reportDate: '2026-09-02' }), post('older', lang, { reportDate: '2026-09-01' })];
    const server = imgOf(categoryFeaturedCards(posts, 'research', lang));
    const browser = imgOf(await browserFeaturedMarkup(posts, lang));
    assert.equal(browser.length, 2, `${lang}: the script rendered two covers`);
    assert.deepEqual(browser, server, `${lang}: the script's <img> tags are the server's, attribute for attribute`);
    assert.equal(loadingOf(browser[0]), 'eager');
    assert.equal(loadingOf(browser[1]), 'lazy');
  }
});

test('browser: the single-post and no-thumbnail cases match the server too', async () => {
  const single = [post('only', 'ko')];
  assert.deepEqual(imgOf(await browserFeaturedMarkup(single, 'ko')), imgOf(categoryFeaturedCards(single, 'research', 'ko')));
  assert.equal(loadingOf(imgOf(await browserFeaturedMarkup(single, 'ko'))[0]), 'eager');

  const bare = [post('first', 'ko', { reportDate: '2026-09-02', coverThumbnail: undefined }), post('second', 'ko')];
  const browser = imgOf(await browserFeaturedMarkup(bare, 'ko'));
  assert.deepEqual(browser, imgOf(categoryFeaturedCards(bare, 'research', 'ko')));
  assert.equal(browser[0], '<img src="/covers/first.webp" alt="" loading="eager">');
});

/* -------------------------------------- the helper's default did not move */

test('coverImageMarkup stays lazy unless asked, and only "eager" is honoured', () => {
  const p = post('x', 'ko');
  const lazy = coverImageMarkup(p, LATEST_CARD_COVER_SIZES);
  assert.equal(loadingOf(lazy), 'lazy', 'the two-argument call every existing caller makes is unchanged');
  assert.equal(coverImageMarkup(p, LATEST_CARD_COVER_SIZES, {}), lazy);
  assert.equal(coverImageMarkup(p, LATEST_CARD_COVER_SIZES, { loading: 'lazy' }), lazy);
  assert.equal(coverImageMarkup(p, LATEST_CARD_COVER_SIZES, { loading: 'auto' }), lazy, 'an unknown value is not written into the page');
  const eager = coverImageMarkup(p, LATEST_CARD_COVER_SIZES, { loading: 'eager' });
  assert.equal(eager, lazy.replace('loading="lazy"', 'loading="eager"'), 'eager changes the one attribute and nothing else');
  assert.equal(coverImageMarkup({ ...p, coverThumbnail: undefined }, LATEST_CARD_COVER_SIZES, { loading: 'eager' }), '<img src="/covers/x.webp" alt="" loading="eager">');
  assert.equal(coverImageMarkup({ ...p, coverImage: '' }, LATEST_CARD_COVER_SIZES, { loading: 'eager' }), '');
});

/* --------------------------------------------- nothing else changed with it */

test('the homepage cards, the share cards and the published landings keep their policy', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const lang of ['ko', 'en']) {
    const home = imgOf(homepageLatestLinks(posts, lang));
    assert.ok(home.length >= 1, `${lang}: homepage cards render covers`);
    for (const img of home) assert.equal(loadingOf(img), 'lazy', `${lang}: homepage cards stay lazy: ${img}`);
  }
  for (const entry of posts.filter(p => p.coverImage).slice(0, 20)) {
    assert.doesNotMatch(reportSeoTags(posts, entry), /loading=/, `${entry.id}: social tags carry no loading attribute`);
  }
  // Every published landing, both languages: exactly one eager cover, first.
  for (const type of ['daily', 'weekly', 'research', 'note', 'basics']) {
    for (const lang of ['ko', 'en']) {
      const imgs = imgOf(categoryFeaturedCards(posts, type, lang));
      if (!imgs.length) continue;
      assert.equal(loadingOf(imgs[0]), 'eager', `${type}/${lang}: first`);
      assert.deepEqual(imgs.slice(1).map(loadingOf), imgs.slice(1).map(() => 'lazy'), `${type}/${lang}: the rest`);
    }
  }
  // The browser side of the same published set. In a browser locale.js hands
  // the script only the current language's posts, newest first; the stub has
  // no locale.js, so that selection is made here the way the server makes it.
  const dailyKo = posts.filter(p => postLanguage(p) === 'ko' && p.type === 'daily')
    .sort((a, b) => String(b.reportDate || b.date || '').localeCompare(String(a.reportDate || a.date || '')));
  assert.deepEqual(imgOf(await browserFeaturedMarkup(dailyKo, 'ko', 'daily')), imgOf(categoryFeaturedCards(posts, 'daily', 'ko')));
});
