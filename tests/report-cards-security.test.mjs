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

test('a card path is trusted only when the card was actually recorded', () => {
  const card = 'covers/share/a-1.jpg';
  assert.equal(reportCardPath({ id: 'a-1', coverImage: 'covers/a-1.webp', shareCardImage: card }), card);
  assert.equal(reportCardPath({ id: 'a-1', coverImage: 'covers/a-1.webp', shareCardImage: `/${card}` }), card);

  // Composing a card can fail while publishing continues, so a cover on its own
  // must never imply one exists.
  assert.equal(reportCardPath({ id: 'a-1', coverImage: 'covers/a-1.webp' }), '');
  assert.equal(reportCardPath({ id: 'a-1' }), '');
  assert.equal(reportCardPath(null), '');
  // Metadata may only name the card this post owns.
  assert.equal(reportCardPath({ id: 'a-1', shareCardImage: 'covers/share/other.jpg' }), '');
  assert.equal(reportCardPath({ id: 'a-1', shareCardImage: 'https://evil.example/x.jpg' }), '');
});

test('SEO output falls back to the brand card whenever no card is recorded', () => {
  const base = { id: 'r-1', title: 'T', href: 'reports/r-1.html', coverImage: 'covers/r-1.webp' };
  const ogOf = post => reportSeoTags([post], post).match(/og:image" content="([^"]*)"/)[1];
  const brand = `${PRODUCTION_ORIGIN}${SOCIAL_FALLBACK_IMAGE}`;

  // publish: card generation failed, the report went out anyway
  assert.equal(ogOf(base), brand);
  // cover replaced, new card failed: the previous card must not be reused
  assert.equal(ogOf({ ...base, coverImage: 'covers/r-1-v2.webp' }), brand);
  // card present
  assert.equal(ogOf({ ...base, shareCardImage: 'covers/share/r-1.jpg' }),
    `${PRODUCTION_ORIGIN}/covers/share/r-1.jpg`);

  // The cover still reaches X in every case.
  assert.match(reportSeoTags([base], base), /<meta name="twitter:card" content="summary">/);
});

test('every recorded card exists on disk at 1200x630, and none is recorded without one', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const carded = posts.filter(post => post.shareCardImage);
  assert.ok(carded.length >= 50, `expected most reports to carry a card, found ${carded.length}`);
  // A card is only ever recorded alongside the cover it was composed from.
  for (const post of posts) {
    if (post.shareCardImage) assert.ok(post.coverImage, `${post.id}: card without a cover`);
    if (post.shareCardImage) assert.equal(post.shareCardImage, `covers/share/${post.id}.jpg`, post.id);
  }

  for (const post of carded) {
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

    if (post.shareCardImage) {
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
  // The metadata field is written only when the blob is actually committed.
  assert.match(publishFn, /const shareCardPath = hasShareCard \?/);
  assert.match(publishFn, /shareCardPath \? \{ shareCardImage: shareCardPath \} : \{\}/);

  assert.match(manageFn, /form\.get\("shareCard"\)/);
  // Replacing a cover without a new card deletes the old one rather than
  // leaving it beside artwork it no longer depicts.
  assert.match(manageFn, /\} else \{[\s\S]{0,160}?if \(existing\.shareCardImage\) entries\.push\(deletedEntry\(existing\.shareCardImage\)\);[\s\S]{0,60}?delete updated\.shareCardImage;/);
  assert.match(manageFn, /updated\.shareCardImage = nextCardPath;/);
  // Removal and deletion both take the recorded card with them.
  assert.equal((manageFn.match(/deletedEntry\(existing\.shareCardImage\)/g) || []).length, 3);
  assert.match(manageFn, /delete updated\.shareCardImage;/);
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

  // Scoped to the reader's language: an English-only note must not surface the
  // Korean entry point, or the other way round.
  assert.match(site, /const hasNotes = posts\.some\(post => post\.type === 'note'\);/);
  assert.doesNotMatch(site, /hasNotes = allPosts/);
  assert.match(site, /const listedTypes = hasNotes \? \[\.\.\.coreTypes, 'note'\] : \[\.\.\.coreTypes\];/);
  // Both navs and the archive filter hide together.
  assert.match(site, /\[data-nav-category="note"\], \[data-filter="note"\]/);
  // The archive index is built from the same list, so its counts match.
  assert.match(site, /archiveIndex\.innerHTML=listedTypes\.map/);

  // The report shell learns the same fact from the middleware, so the fixed nav
  // on a report never offers a link the homepage has hidden.
  assert.match(middleware, /candidate\?\.type === 'note' && \(candidate\?\.lang === 'en' \? 'en' : 'ko'\) === lang/);
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

/* ---------------- notes gating is per locale ---------------- */

/** Run assets/site.js against a stub homepage and report what the notes entry points did. */
async function notesVisibility(posts, lang) {
  const [localeSource, siteSource] = await Promise.all([read('assets/locale.js'), read('assets/site.js')]);
  const { default: vm } = await import('node:vm');

  const stub = (name) => ({
    name, hidden: false, textContent: '', innerHTML: '', href: '', value: '', dataset: {},
    style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    getAttribute: () => null, appendChild() {}, append() {}, remove() {}, focus() {},
    querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({})
  });

  const noteNodes = [stub('nav-note'), stub('mobile-note'), stub('filter-note')];
  const archiveIndex = stub('archive-index');
  const byId = new Map([['archive-index', archiveIndex], ['report-list', stub('report-list')]]);

  const document = {
    documentElement: Object.assign(stub('html'), { lang, dataset: { siteLang: lang } }),
    body: stub('body'), title: '', readyState: 'complete',
    addEventListener() {}, createElement: () => stub('created'),
    getElementById: id => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: selector => (selector.includes('note') ? noteNodes : [])
  };

  const context = vm.createContext({
    window: { RESEARCH_POSTS: posts, addEventListener() {} },
    document,
    location: { pathname: lang === 'en' ? '/en/' : '/', search: '', href: 'https://snowshagal.com/' },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    setTimeout, clearTimeout, Intl, URL, URLSearchParams, console
  });
  vm.runInContext(localeSource, context);
  vm.runInContext(siteSource, context);

  return {
    hiddenNodes: noteNodes.filter(node => node.hidden).length,
    totalNodes: noteNodes.length,
  };
}

const KO_NOTE = { id: 'ko-note', type: 'note', lang: 'ko', title: '끄적', href: 'reports/n.html', reportDate: '2026-08-20', tags: [] };
const EN_NOTE = { id: 'en-note', type: 'note', lang: 'en', title: 'Note', href: 'reports/en/n.html', reportDate: '2026-08-20', tags: [] };
const KO_DAILY = { id: 'ko-d', type: 'daily', lang: 'ko', title: '데일리', href: 'reports/d.html', reportDate: '2026-08-26', tags: [] };
const EN_DAILY = { id: 'en-d', type: 'daily', lang: 'en', title: 'Daily', href: 'reports/en/d.html', reportDate: '2026-08-26', tags: [] };

test('a Korean note surfaces the entry points on the Korean homepage only', async () => {
  const posts = [KO_NOTE, KO_DAILY, EN_DAILY];

  const ko = await notesVisibility(posts, 'ko');
  assert.equal(ko.hiddenNodes, 0, 'Korean entry points must stay visible');

  const en = await notesVisibility(posts, 'en');
  assert.equal(en.hiddenNodes, en.totalNodes, 'English entry points must be hidden');
});

test('an English note surfaces the entry points on the English homepage only', async () => {
  const posts = [EN_NOTE, KO_DAILY, EN_DAILY];

  const en = await notesVisibility(posts, 'en');
  assert.equal(en.hiddenNodes, 0);

  const ko = await notesVisibility(posts, 'ko');
  assert.equal(ko.hiddenNodes, ko.totalNodes);
});

test('with no notes at all both locales hide the entry points', async () => {
  const posts = [KO_DAILY, EN_DAILY];
  for (const lang of ['ko', 'en']) {
    const result = await notesVisibility(posts, lang);
    assert.equal(result.hiddenNodes, result.totalNodes, lang);
  }
});

test('the middleware flags notes only for the report language', async () => {
  const middleware = await read('functions/_middleware.js');
  // lang is derived from the report path, so a Korean-only note leaves an
  // English report's fixed nav without the link, matching /en/.
  assert.ok(middleware.includes("i.test(url.pathname) ? 'en' : 'ko'"),
    'lang must come from the report path');
  assert.match(middleware, /candidate\?\.type === 'note' && \(candidate\?\.lang === 'en' \? 'en' : 'ko'\) === lang/);
});
