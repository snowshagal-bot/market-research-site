import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import {
  PRODUCTION_ORIGIN,
  SOCIAL_FALLBACK_IMAGE,
  SOCIAL_REPORT_CARD_DIR,
  reportCardPath,
  reportSeoTags
} from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const bytes = path => readFile(new URL(`../${path}`, import.meta.url));
const sizeOf = async path => (await stat(new URL(`../${path}`, import.meta.url))).size;

function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'not a JPEG');
  let offset = 2;
  while (offset < buf.length) {
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error('no JPEG frame header');
}

/* ---------------- per-report social cards ---------------- */

test('a card path is derived only for reports that have a cover', () => {
  assert.equal(reportCardPath({ id: 'a-1', coverImage: 'covers/a-1.webp' }), 'covers/share/a-1.jpg');
  assert.equal(reportCardPath({ id: 'a-1' }), '');
  assert.equal(reportCardPath({ coverImage: 'covers/a-1.webp' }), '');
  assert.equal(reportCardPath(null), '');
});

test('every published report with a cover has a 1200x630 card on disk', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const covered = posts.filter(post => post.coverImage);
  assert.ok(covered.length >= 50, `expected most reports to have covers, found ${covered.length}`);

  for (const post of covered) {
    const path = reportCardPath(post);
    await access(new URL(`../${path}`, import.meta.url));
    assert.deepEqual(jpegSize(await bytes(path)), { width: 1200, height: 630 }, post.id);
    const size = await sizeOf(path);
    assert.ok(size <= 300 * 1024, `${path} is ${Math.round(size / 1024)}KB`);
  }
});

test('Open Graph gets the card and X keeps the cover', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const post of posts) {
    const tags = reportSeoTags(posts, post);
    const ogImage = tags.match(/property="og:image" content="([^"]*)"/)[1];
    const twitterImage = tags.match(/name="twitter:image" content="([^"]*)"/)[1];

    if (post.coverImage) {
      assert.equal(ogImage, `${PRODUCTION_ORIGIN}/${SOCIAL_REPORT_CARD_DIR}/${post.id}.jpg`, post.id);
      // The portrait cover is still what X shows, where it is not cropped.
      assert.equal(twitterImage, `${PRODUCTION_ORIGIN}/${post.coverImage}`, post.id);
      assert.match(tags, /<meta name="twitter:card" content="summary">/, post.id);
    } else {
      assert.equal(ogImage, `${PRODUCTION_ORIGIN}${SOCIAL_FALLBACK_IMAGE}`, post.id);
      assert.match(tags, /<meta name="twitter:card" content="summary_large_image">/, post.id);
    }
    assert.match(tags, /<meta property="og:image:width" content="1200">/, post.id);
  }
});

test('the card is composed in the browser and never re-typesets the report title', async () => {
  const source = await read('assets/share-card.js');

  assert.match(source, /const WIDTH = 1200;/);
  assert.match(source, /const HEIGHT = 630;/);
  // Only the category and the date are drawn, both Latin, so Korean and English
  // reports lay out identically.
  assert.match(source, /categoryLabel/);
  assert.match(source, /formatDate/);
  // The word appears in the comment explaining why; what matters is that no
  // title value is ever read or drawn.
  assert.doesNotMatch(source, /\.title\b/);
  assert.doesNotMatch(source, /fillText\(\s*(?:meta|post)/);
  // Georgia ships on Windows and macOS, so the backfill and the browser agree.
  assert.match(source, /Georgia/);
  assert.match(source, /root\.SHARE_CARD = /);
});

test('publishing and cover replacement both keep the card in step', async () => {
  const [admin, manage, publishFn, manageFn, adminHtml, manageHtml] = await Promise.all([
    read('assets/admin.js'), read('assets/admin-manage.js'),
    read('functions/api/publish.js'), read('functions/api/manage.js'),
    read('admin/index.html'), read('admin/manage/index.html')
  ]);

  for (const source of [admin, manage]) {
    assert.match(source, /window\.SHARE_CARD\.renderShareCard\(selectedCover/);
    assert.match(source, /append\('shareCard', card, 'share-card\.jpg'\)/);
    // A failed card must never block the mutation it accompanies.
    assert.match(source, /catch \(error\) \{[\s\S]*?console\.warn/);
  }
  for (const html of [adminHtml, manageHtml]) assert.match(html, /assets\/share-card\.js\?v=/);

  assert.match(publishFn, /form\.get\('shareCard'\)/);
  assert.match(publishFn, /SOCIAL_REPORT_CARD_DIR/);
  assert.match(manageFn, /form\.get\("shareCard"\)/);
  // Removing or deleting a cover takes its card with it.
  assert.equal((manageFn.match(/deletedEntry\(`\$\{SOCIAL_REPORT_CARD_DIR\}\/\$\{existing\.id\}\.jpg`\)/g) || []).length, 2);
});

/* ---------------- security headers ---------------- */

test('_headers sets frame and permissions policy without pinning HSTS', async () => {
  const headers = await read('_headers');

  assert.match(headers, /^\/\*\r?\n(?:.*\r?\n)*?\s+X-Frame-Options: SAMEORIGIN/m);
  assert.match(headers, /Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\)/);
  // A second X-Frame-Options would collide with the site-wide one; frame-ancestors
  // is specified to take precedence when both are present, so it wins cleanly.
  assert.match(headers, /^\/admin\/\*\r?\n(?:.*\r?\n)*?\s+Content-Security-Policy: frame-ancestors 'none'/m);
  assert.equal((headers.match(/X-Frame-Options:/g) || []).length, 1, 'only one X-Frame-Options rule');

  // HSTS is hard to reverse and is better toggled from the Cloudflare dashboard
  // than pinned in the repository, so it is deliberately absent.
  assert.doesNotMatch(headers, /Strict-Transport-Security/i);
});

/* ---------------- notes category ---------------- */

test('the notes entry points appear only once a note exists', async () => {
  const [site, shell, middleware] = await Promise.all([
    read('assets/site.js'), read('assets/report-shell.js'), read('functions/_middleware.js')
  ]);

  assert.match(site, /const hasNotes = allPosts\.some\(post => post\.type === 'note'\);/);
  assert.match(site, /const listedTypes = hasNotes \? \[\.\.\.coreTypes, 'note'\] : \[\.\.\.coreTypes\];/);
  // Both navs and the archive filter hide together.
  assert.match(site, /\[data-nav-category="note"\], \[data-filter="note"\]/);
  // The archive index is built from the same list, so its counts match.
  assert.match(site, /archiveIndex\.innerHTML=listedTypes\.map/);

  // The report shell learns the same fact from the middleware, so the fixed nav
  // on a report never offers a link the homepage has hidden.
  assert.match(middleware, /hasNotes = posts\.some\(\(candidate\) => candidate\?\.type === 'note'\)/);
  assert.match(middleware, /data-notes="\$\{hasNotes \? '1' : '0'\}"/);
  assert.match(shell, /const hasNotes = scriptEl\?\.dataset\.notes === '1';/);
  assert.match(shell, /\$\{hasNotes \|\| active === 'note' \?/);
});

test('nothing about the notes category itself is removed', async () => {
  const [locale, site] = await Promise.all([read('assets/locale.js'), read('assets/site.js')]);
  // Hidden, not deleted: publishing the first note brings every entry point back.
  assert.match(locale, /note: \{ label: '끄적끄적'/);
  assert.match(locale, /note: \{ label: 'Notes'/);
  assert.match(site, /const validTypes = \['all', \.\.\.coreTypes, 'note'\];/);

  const posts = JSON.parse(await read('data/posts.json'));
  assert.equal(posts.filter(post => post.type === 'note').length, 0, 'fixture assumes there are still no notes');
});
