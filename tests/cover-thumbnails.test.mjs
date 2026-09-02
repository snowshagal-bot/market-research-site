import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import {
  COVER_THUMBNAIL_WIDTH,
  HERO_FEATURED_COVER_SIZES,
  LATEST_CARD_COVER_SIZES,
  coverThumbnailMarkup,
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

/* -------------------------------------------------------- the files exist */

test('every published cover has its 450px thumbnail beside it, and it is 450 wide', async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  const covers = [...new Set(posts.map(post => post.coverImage).filter(Boolean))];
  assert.ok(covers.length >= 70, `expected the published set to carry covers, found ${covers.length}`);

  const problems = [];
  for (const cover of covers) {
    const thumbnail = coverThumbnailPath(cover);
    try {
      const bytes = await read(thumbnail);
      const size = webpSize(bytes);
      if (!size) problems.push(`${thumbnail}: not a WebP`);
      else if (size[0] !== COVER_THUMBNAIL_WIDTH) problems.push(`${thumbnail}: ${size[0]} wide, expected ${COVER_THUMBNAIL_WIDTH}`);
      // Same shape as the artwork it came from: nothing cropped.
      const original = await read(cover);
      const originalSize = webpSize(original) || (original.subarray(1, 4).toString('ascii') === 'PNG'
        ? [original.readUInt32BE(16), original.readUInt32BE(20)] : null);
      if (size && originalSize) {
        const expected = Math.round(originalSize[1] * COVER_THUMBNAIL_WIDTH / originalSize[0]);
        if (Math.abs(size[1] - expected) > 1) problems.push(`${thumbnail}: ${size[1]} tall, expected ${expected} to keep the cover's shape`);
      }
      // And it is smaller, or there was no point.
      if ((await stat(new URL(`../${thumbnail}`, import.meta.url))).size >= (await stat(new URL(`../${cover}`, import.meta.url))).size) {
        problems.push(`${thumbnail}: not smaller than ${cover}`);
      }
    } catch (error) {
      problems.push(`${thumbnail}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    }
  }
  assert.deepEqual(problems, [], `thumbnails out of step with their covers:\n  ${problems.join('\n  ')}`);
});

test('the thumbnail name is derived the same way everywhere', async () => {
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
  // The browser-side renderer carries the same rule, since it re-renders the
  // same cards; the two must not drift apart.
  const site = await text('assets/site.js');
  assert.match(site, /const COVER_THUMBNAIL_WIDTH = 450;/);
  assert.match(site, new RegExp(`const LATEST_CARD_COVER_SIZES = '${LATEST_CARD_COVER_SIZES.replace(/[()]/g, '\\$&')}';`));
  assert.match(site, new RegExp(`const HERO_FEATURED_COVER_SIZES = '${HERO_FEATURED_COVER_SIZES.replace(/[()]/g, '\\$&')}';`));
  assert.match(site, /\$\{match\[1\]\}-\$\{COVER_THUMBNAIL_WIDTH\}\.webp/);
});

/* ------------------------------------------------------- the cards use it */

test('a homepage card offers the thumbnail and the original and says how wide it draws', () => {
  const markup = coverThumbnailMarkup('covers/2026-09-01-daily-1oq37xo.webp', LATEST_CARD_COVER_SIZES);
  assert.match(markup, /^<img src="\/covers\/2026-09-01-daily-1oq37xo\.webp"/, 'the original is the fallback src');
  assert.match(markup, /srcset="\/covers\/2026-09-01-daily-1oq37xo-450\.webp 450w, \/covers\/2026-09-01-daily-1oq37xo\.webp 900w"/);
  assert.match(markup, /sizes="\(max-width: 760px\) 30vw, 112px"/);
  assert.match(markup, /width="900" height="1350"/, 'the intrinsic 2:3 keeps the box while the bytes arrive');
  assert.match(markup, /loading="lazy"/);
  // A `100vw` here would hand a 112px card the 900px file; the layout's own
  // widths are what let the browser choose the small one.
  assert.doesNotMatch(LATEST_CARD_COVER_SIZES, /100vw/);
  assert.doesNotMatch(HERO_FEATURED_COVER_SIZES, /100vw/);
});

test('the server-rendered homepage cards and the browser-rendered ones agree', async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  const html = homepageLatestLinks(posts, 'ko');
  const imgs = html.match(/<img[^>]*>/g) || [];
  assert.ok(imgs.length >= 1, 'the homepage renders at least one cover');
  for (const img of imgs) {
    assert.match(img, /srcset="\/covers\/[^"]+-450\.webp 450w, \/covers\/[^"]+ 900w"/, img);
    assert.match(img, /sizes="\(max-width: 760px\) 30vw, 112px"/, img);
    assert.match(img, /loading="lazy"/, img);
  }
  const site = await text('assets/site.js');
  assert.match(site, /coverThumbnailMarkup\(post\.coverImage, LATEST_CARD_COVER_SIZES\)/);
  assert.match(site, /imgEl\.srcset = cover && thumbnail \? `\$\{thumbnail\} 450w, \$\{cover\} 900w` : '';/);
  assert.match(site, /imgEl\.sizes = cover && thumbnail \? HERO_FEATURED_COVER_SIZES : '';/);
});

/* ------------------------------------------- what is left exactly as it was */

test('category landings, share cards and social images do not use the thumbnail', async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  // A different surface with its own box; not changed here.
  const category = categoryFeaturedCards(posts, 'research', 'ko');
  assert.doesNotMatch(category, /-450\.webp/);
  assert.doesNotMatch(category, /srcset=/);

  for (const post of posts.filter(entry => entry.coverImage)) {
    const tags = reportSeoTags(posts, post);
    assert.doesNotMatch(tags, /-450\.webp/, `${post.id}: a social image is never the thumbnail`);
  }
});

test('the publisher makes a thumbnail beside every cover it uploads', async () => {
  const admin = await text('assets/admin.js');
  const manage = await text('assets/admin-manage.js');
  const card = await text('assets/share-card.js');
  const publish = await text('functions/api/publish.js');
  const manageApi = await text('functions/api/manage.js');

  assert.match(card, /async function renderCoverThumbnail\(cover\)/);
  assert.match(card, /'image\/webp', THUMBNAIL_QUALITY\)/);
  assert.match(card, /const THUMBNAIL_QUALITY = 0\.9;/, 'the same quality the cover itself is encoded at');
  assert.match(card, /const THUMBNAIL_WIDTH = 450;/);
  assert.match(admin, /form\.append\('coverThumbnail', thumbnail, 'cover-450\.webp'\)/);
  assert.match(manage, /body\.append\('coverThumbnail', thumbnail, 'cover-450\.webp'\)/);
  assert.match(publish, /coverPath\.replace\(\/\\\.\[a-z0-9\]\+\$\/i, '-450\.webp'\)/);
  assert.match(manageApi, /nextCoverPath\.replace\(\/\\\.\[a-z0-9\]\+\$\/i, "-450\.webp"\)/);
});
