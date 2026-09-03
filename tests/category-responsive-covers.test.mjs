import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CATEGORY_FEATURED_COVER_SIZES,
  LATEST_CARD_COVER_SIZES,
  categoryFeaturedCards,
  homepageLatestLinks,
  reportSeoTags
} from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const base = {
  id: 'r-1', type: 'research', href: 'reports/r-1.html', title: 'T',
  reportDate: '2026-09-01', date: '2026-09-01', registeredAt: '2026-09-01T00:00:00.000Z',
  coverImage: 'covers/r-1.webp', coverThumbnail: 'covers/r-1-450.webp', tags: ['rates']
};
const ko = { ...base, lang: 'ko' };
const en = { ...base, id: 'r-2', href: 'reports/en/r-2.html', lang: 'en', coverImage: 'covers/r-2.webp', coverThumbnail: 'covers/r-2-450.webp' };
const imgOf = html => (html.match(/<img[^>]*>/g) || []);

/* ------------------------------------------ a thumbnail on record is offered */

test('a featured card whose post records a thumbnail offers 450w and 900w', () => {
  for (const [post, lang] of [[ko, 'ko'], [en, 'en']]) {
    const [img] = imgOf(categoryFeaturedCards([post], 'research', lang));
    assert.ok(img, `${lang}: renders an image`);
    assert.match(img, new RegExp(`^<img src="/${post.coverImage}"`), 'the original stays the src');
    assert.match(img, new RegExp(`srcset="/${post.coverThumbnail} 450w, /${post.coverImage} 900w"`));
    assert.match(img, /sizes="\(max-width: 680px\) calc\(37\.5vw - 10px\), \(max-width: 1220px\) calc\(20\.8vw - 12px\), 235px"/);
    assert.match(img, /width="900" height="1350"/);
    assert.match(img, /loading="lazy"/);
  }
});

/* ---------------------------------- no thumbnail on record: the plain original */

test('a featured card whose post records no thumbnail is the plain original, naming no -450 file', () => {
  for (const post of [
    { ...ko, coverThumbnail: undefined },
    { ...ko, coverThumbnail: '' },
    { ...ko, coverThumbnail: null },
    { ...ko, coverThumbnail: 'covers/r-1.webp' },        // not a thumbnail name
    { ...en, coverThumbnail: undefined }
  ]) {
    const [img] = imgOf(categoryFeaturedCards([post], 'research', post.lang));
    assert.equal(img, `<img src="/${post.coverImage}" alt="" loading="lazy">`, JSON.stringify(post.coverThumbnail));
    assert.doesNotMatch(img, /srcset|sizes|-450/);
  }
  // A real thumbnail on disk that the record does not mention is not offered.
  const unrecorded = { ...ko, coverImage: 'covers/2026-09-01-daily-1oq37xo.webp', coverThumbnail: undefined };
  assert.doesNotMatch(categoryFeaturedCards([unrecorded], 'research', 'ko'), /-450/);
});

/* ----------------------------------- the browser renderer follows the same rule */

test('the category landing script decides from the same field, with the same sizes, and never derives a name', async () => {
  const script = await read('assets/category-landing.js');
  assert.match(script, /function coverThumbnailOf\(post\) \{\s*const thumbnail = String\(post && post\.coverThumbnail \|\| ''\);/);
  assert.match(script, /coverImageMarkup\(post, CATEGORY_FEATURED_COVER_SIZES\)/);
  assert.match(script, new RegExp(`const CATEGORY_FEATURED_COVER_SIZES = '${CATEGORY_FEATURED_COVER_SIZES.replace(/[().]/g, '\\$&')}';`));
  assert.match(script, /if \(!thumbnail\) return `<img src="\$\{esc\(original\)\}" alt="" loading="lazy">`;/);
  assert.doesNotMatch(script, /coverThumbnailPath\(|-450\.webp`|replace\([^)]*-450/, 'no thumbnail name is ever built from the cover name');
  // The server renderer likewise.
  const seo = await read('functions/_seo.js');
  const featured = seo.slice(seo.indexOf('export function categoryFeaturedCards'), seo.indexOf('export function categoryArchiveLinks'));
  assert.match(featured, /coverImageMarkup\(post, CATEGORY_FEATURED_COVER_SIZES\)/);
  assert.doesNotMatch(featured, /coverThumbnailPath\(/);
});

/* ------------------------------------------------------- sizes is the layout's */

test('the category sizes describe the painted cover, not the viewport or the box', () => {
  assert.doesNotMatch(CATEGORY_FEATURED_COVER_SIZES, /100vw/);
  assert.notEqual(CATEGORY_FEATURED_COVER_SIZES, LATEST_CARD_COVER_SIZES, 'the homepage card is a different layout');
  // The painted widths measured on the live pages, and what the expression
  // yields at each: it may over-ask by a little, never under-ask.
  const widthAt = vw => vw <= 680 ? 0.375 * vw - 10 : vw <= 1220 ? 0.208 * vw - 12 : 235;
  for (const [vw, painted] of [[360, 123], [390, 134], [430, 149], [768, 146], [1024, 198], [1366, 235], [1440, 235]]) {
    const asks = widthAt(vw);
    assert.ok(asks >= painted - 1, `${vw}px: sizes asks ${asks}, but ${painted}px is painted`);
    assert.ok(asks <= painted * 1.12 + 2, `${vw}px: sizes asks ${asks}, far more than the ${painted}px painted`);
  }
  // So with only 450w and 900w on offer, a 1× screen never needs the original
  // and a 3× desktop always does.
  assert.ok(widthAt(1440) * 1 <= 450);
  assert.ok(widthAt(1440) * 3 > 450);
});

/* ------------------------------------------------ nothing else moved with it */

test('the homepage, the social images and the report pages are untouched', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const img of imgOf(homepageLatestLinks(posts, 'ko'))) {
    assert.match(img, /sizes="\(max-width: 760px\) 30vw, 112px"/, 'the homepage keeps its own sizes');
  }
  for (const post of posts.filter(entry => entry.coverImage).slice(0, 20)) {
    assert.doesNotMatch(reportSeoTags(posts, post), /-450\.webp/, `${post.id}: no social image is a thumbnail`);
  }
  // A report's own HTML is served as uploaded; nothing here rewrites it.
  const sample = posts.find(entry => entry.href && entry.coverThumbnail);
  const html = await read(sample.href);
  assert.doesNotMatch(html, /-450\.webp/, `${sample.id}: the report body does not reference a thumbnail`);
});

test('KO and EN category landings render the published set under one policy', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const type of ['daily', 'weekly', 'research', 'note', 'basics']) {
    for (const lang of ['ko', 'en']) {
      for (const img of imgOf(categoryFeaturedCards(posts, type, lang))) {
        const withThumbnail = /srcset=/.test(img);
        if (withThumbnail) {
          assert.match(img, /srcset="\/covers\/[^"]+-450\.webp 450w, \/covers\/[^"]+ 900w"/, `${type}/${lang}`);
          assert.match(img, /sizes="\(max-width: 680px\)/, `${type}/${lang}`);
        } else {
          assert.doesNotMatch(img, /-450/, `${type}/${lang}: a card without a recorded thumbnail names none`);
        }
      }
    }
  }
});
