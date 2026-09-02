import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import {
  COVER_THUMBNAIL_WIDTH,
  HERO_FEATURED_COVER_SIZES,
  LATEST_CARD_COVER_SIZES,
  coverImageMarkup,
  coverThumbnailOf,
  coverThumbnailPath,
  homepageLatestLinks,
  categoryFeaturedCards,
  reportSeoTags
} from '../functions/_seo.js';
import { thumbnailPathFor } from '../scripts/build-cover-thumbnails.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url));
const text = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/** Width and height out of a WebP header, without decoding the picture. */
function webpSize(bytes) {
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  if (chunk === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') { const bits = bytes.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]; }
  return null;
}

const daily = {
  id: 'r-1', type: 'daily', lang: 'ko', title: 'T', href: 'reports/r-1.html',
  coverImage: 'covers/r-1.webp', coverThumbnail: 'covers/r-1-450.webp'
};

/* ------------------------------------------- 1. a thumbnail on record is offered */

test('a post whose thumbnail is on record offers 450w and 900w', () => {
  const markup = coverImageMarkup(daily, LATEST_CARD_COVER_SIZES);
  assert.match(markup, /^<img src="\/covers\/r-1\.webp"/, 'the original stays the src');
  assert.match(markup, /srcset="\/covers\/r-1-450\.webp 450w, \/covers\/r-1\.webp 900w"/);
  assert.match(markup, /sizes="\(max-width: 760px\) 30vw, 112px"/);
  assert.match(markup, /width="900" height="1350"/);
  assert.match(markup, /loading="lazy"/);
  assert.doesNotMatch(LATEST_CARD_COVER_SIZES, /100vw/);
  assert.doesNotMatch(HERO_FEATURED_COVER_SIZES, /100vw/);
});

/* -------------------------- 2. no thumbnail on record means the plain original */

test('a post with no thumbnail on record gets the plain original and names no -450 file', () => {
  for (const post of [
    { ...daily, coverThumbnail: undefined },
    { ...daily, coverThumbnail: '' },
    { ...daily, coverThumbnail: null },
    // The field is the only authority: a wrong-looking value is not trusted.
    { ...daily, coverThumbnail: 'covers/r-1.webp' },
    { ...daily, coverThumbnail: 'covers/r-1-450.png' }
  ]) {
    const markup = coverImageMarkup(post, LATEST_CARD_COVER_SIZES);
    assert.equal(markup, '<img src="/covers/r-1.webp" alt="" loading="lazy">', JSON.stringify(post.coverThumbnail));
    assert.doesNotMatch(markup, /srcset|sizes|-450/);
    assert.equal(coverThumbnailOf(post), '');
  }
  // And the file's existence on disk is never consulted for the decision:
  // a real thumbnail that is not on record is not offered either.
  const real = { ...daily, coverImage: 'covers/2026-09-01-daily-1oq37xo.webp', coverThumbnail: undefined };
  assert.doesNotMatch(coverImageMarkup(real, LATEST_CARD_COVER_SIZES), /-450/);
  assert.equal(coverImageMarkup({ ...daily, coverImage: '' }, LATEST_CARD_COVER_SIZES), '');
});

test('the browser-side renderer decides the same way, from the same field', async () => {
  const site = await text('assets/site.js');
  assert.match(site, /function coverThumbnailOf\(post\)\{\s*const thumbnail = String\(post && post\.coverThumbnail \|\| ''\);/);
  assert.match(site, /coverImageMarkup\(post, LATEST_CARD_COVER_SIZES\)/);
  assert.match(site, /const thumbnail = cover \? coverThumbnailOf\(latestResearch\) : '';/);
  assert.match(site, /imgEl\.srcset = cover && thumbnail \? `\$\{thumbnail\} 450w, \$\{cover\} 900w` : '';/);
  assert.match(site, /imgEl\.sizes = cover && thumbnail \? HERO_FEATURED_COVER_SIZES : '';/);
  assert.doesNotMatch(site, /coverThumbnailPath\(/, 'the browser never derives a thumbnail name it has not been given');
  assert.match(site, new RegExp(`const LATEST_CARD_COVER_SIZES = '${LATEST_CARD_COVER_SIZES.replace(/[()]/g, '\\$&')}';`));
  assert.match(site, new RegExp(`const HERO_FEATURED_COVER_SIZES = '${HERO_FEATURED_COVER_SIZES.replace(/[()]/g, '\\$&')}';`));
});

/* --------------- 4. every published cover has its thumbnail, on disk and on record */

test('every published cover has a thumbnail on disk and on record, and they agree', async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  const withCover = posts.filter(post => post.coverImage);
  assert.ok(withCover.length >= 70, `expected the published set to carry covers, found ${withCover.length}`);

  const problems = [];
  for (const post of withCover) {
    const expected = coverThumbnailPath(post.coverImage);
    if (post.coverThumbnail !== expected) { problems.push(`${post.id}: coverThumbnail is ${JSON.stringify(post.coverThumbnail)}, expected ${expected}`); continue; }
    try {
      const bytes = await read(expected);
      const size = webpSize(bytes);
      if (!size) problems.push(`${expected}: not a WebP`);
      else if (size[0] !== COVER_THUMBNAIL_WIDTH) problems.push(`${expected}: ${size[0]} wide, expected ${COVER_THUMBNAIL_WIDTH}`);
      const original = await read(post.coverImage);
      const originalSize = webpSize(original) || (original.subarray(1, 4).toString('ascii') === 'PNG'
        ? [original.readUInt32BE(16), original.readUInt32BE(20)] : null);
      if (size && originalSize) {
        const wanted = Math.round(originalSize[1] * COVER_THUMBNAIL_WIDTH / originalSize[0]);
        if (Math.abs(size[1] - wanted) > 1) problems.push(`${expected}: ${size[1]} tall, expected ${wanted} to keep the cover's shape`);
      }
      if ((await stat(new URL(`../${expected}`, import.meta.url))).size >= (await stat(new URL(`../${post.coverImage}`, import.meta.url))).size) {
        problems.push(`${expected}: not smaller than ${post.coverImage}`);
      }
    } catch (error) {
      problems.push(`${expected}: ${error.code === 'ENOENT' ? 'missing on disk' : error.message}`);
    }
  }
  // Nothing on record without a cover to belong to.
  for (const post of posts.filter(entry => !entry.coverImage && entry.coverThumbnail)) {
    problems.push(`${post.id}: coverThumbnail without a coverImage`);
  }
  assert.deepEqual(problems, [], `thumbnails out of step with their covers:\n  ${problems.join('\n  ')}`);

  // The rendered homepage therefore offers a thumbnail on every card.
  for (const img of homepageLatestLinks(posts, 'ko').match(/<img[^>]*>/g) || []) {
    assert.match(img, /srcset="\/covers\/[^"]+-450\.webp 450w, \/covers\/[^"]+ 900w"/, img);
  }
});

test('the thumbnail name is derived the same way by the writers', () => {
  for (const [cover, expected] of [
    ['covers/2026-09-01-daily-1oq37xo.webp', 'covers/2026-09-01-daily-1oq37xo-450.webp'],
    ['/covers/2026-08-31-daily-1mkemh5.png', 'covers/2026-08-31-daily-1mkemh5-450.webp'],
    ['covers/x.JPG', 'covers/x-450.webp'],
    ['covers/no-extension', ''],
    ['', '']
  ]) {
    assert.equal(coverThumbnailPath(cover), expected, cover);
    assert.equal(thumbnailPathFor(cover), expected, `${cover} (build script)`);
  }
});

/* ------------------------------------------- what is left exactly as it was */

test('category landings, share cards and social images do not use the thumbnail', async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  const category = categoryFeaturedCards(posts, 'research', 'ko');
  assert.doesNotMatch(category, /-450\.webp/);
  assert.doesNotMatch(category, /srcset=/);
  for (const post of posts.filter(entry => entry.coverImage)) {
    assert.doesNotMatch(reportSeoTags(posts, post), /-450\.webp/, `${post.id}: a social image is never the thumbnail`);
  }
});

test('the publisher makes a thumbnail beside every cover it uploads and records only what it committed', async () => {
  const admin = await text('assets/admin.js');
  const manage = await text('assets/admin-manage.js');
  const card = await text('assets/share-card.js');
  const publish = await text('functions/api/publish.js');
  const manageApi = await text('functions/api/manage.js');

  assert.match(card, /async function renderCoverThumbnail\(cover\)/);
  assert.match(card, /const THUMBNAIL_QUALITY = 0\.9;/, 'the same quality the cover itself is encoded at');
  assert.match(card, /const THUMBNAIL_WIDTH = 450;/);
  assert.match(admin, /form\.append\('coverThumbnail', thumbnail, 'cover-450\.webp'\)/);
  assert.match(manage, /body\.append\('coverThumbnail', thumbnail, 'cover-450\.webp'\)/);
  assert.match(publish, /\.\.\.\(coverThumbnailPath \? \{ coverThumbnail: coverThumbnailPath \} : \{\}\)/);
  assert.match(manageApi, /updated\.coverThumbnail = nextThumbnailPath;/);
  assert.match(manageApi, /delete updated\.coverThumbnail;/);
});
