import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractSearchText,
  extractReadingText,
  calculateReadingMinutes,
  buildSearchIndex,
  READING_SPEED
} from '../scripts/build-search-index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const tagsRegistry = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'tags.json'), 'utf8'));
const validTagKeys = new Set(Object.keys(tagsRegistry));

test('Reading Time: Korean calculation (500 non-whitespace chars/min)', () => {
  const text1000 = '가'.repeat(1000);
  const html = `<html><body><article><p>${text1000}</p></article></body></html>`;
  const minutes = calculateReadingMinutes(html, 'ko');
  assert.equal(minutes, 2); // 1000 / 500 = 2

  const text499 = '가'.repeat(499);
  const html2 = `<html><body><p>${text499}</p></body></html>`;
  assert.equal(calculateReadingMinutes(html2, 'ko'), 1);

  const text501 = '가'.repeat(501);
  const html3 = `<html><body><p>${text501}</p></body></html>`;
  assert.equal(calculateReadingMinutes(html3, 'ko'), 2);
});

test('Reading Time: English calculation (220 words/min)', () => {
  const words440 = Array(440).fill('market').join(' ');
  const html = `<html><body><p>${words440}</p></body></html>`;
  const minutes = calculateReadingMinutes(html, 'en');
  assert.equal(minutes, 2); // 440 / 220 = 2

  const words221 = Array(221).fill('market').join(' ');
  const html2 = `<html><body><p>${words221}</p></body></html>`;
  assert.equal(calculateReadingMinutes(html2, 'en'), 2);
});

test('Reading Time: minimum is always at least 1 minute', () => {
  assert.equal(calculateReadingMinutes('', 'ko'), 1);
  assert.equal(calculateReadingMinutes('<html><body></body></html>', 'ko'), 1);
  assert.equal(calculateReadingMinutes('<html><body><p>Short</p></body></html>', 'en'), 1);
});

test('Reading Time vs Search Separation: Closed <details> excluded from reading time but included in search text', () => {
  const baseContent = '안녕하세요. 오늘의 핵심 리서치입니다. '.repeat(50); // ~1000 chars -> 2 min
  const hiddenSecret = 'EXCLUSIVE_COLLAPSED_KEYWORD_XYZ999';
  const hugeCollapsedData = `<details class="fold rv"><summary>상세 수급표 보기</summary><p>${hiddenSecret} ${'대량의 상세 수급 데이터 '.repeat(1000)}</p></details>`;

  const htmlA = `<html><body><main><p>${baseContent}</p></main></body></html>`;
  const htmlB = `<html><body><main><p>${baseContent}</p>${hugeCollapsedData}</main></body></html>`;

  const readingA = calculateReadingMinutes(htmlA, 'ko');
  const readingB = calculateReadingMinutes(htmlB, 'ko');

  // Reading time must be IDENTICAL despite huge collapsed data
  assert.equal(readingA, readingB, 'Reading time must not change when adding collapsed content');

  // Search text must INCLUDE the hidden keyword in htmlB
  const searchA = extractSearchText(htmlA);
  const searchB = extractSearchText(htmlB);

  assert.equal(searchA.includes(hiddenSecret), false);
  assert.equal(searchB.includes(hiddenSecret), true, 'Search text must index collapsible/details keywords');

  // Reading text must NOT include the hidden keyword
  const readingTextB = extractReadingText(htmlB);
  assert.equal(readingTextB.includes(hiddenSecret), false, 'Reading text must exclude collapsed content');
});

test('Reading Time: <details open> content is included as initial visible content', () => {
  const openContent = '열린 상세 정보입니다. '.repeat(50);
  const htmlOpen = `<html><body><details open><summary>열린 요약</summary><p>${openContent}</p></details></body></html>`;
  const readingText = extractReadingText(htmlOpen);
  assert.match(readingText, /열린 상세 정보입니다/);
});

test('Reading Time: hidden attributes, dialog, nav, header, footer are excluded', () => {
  const html = `
    <html>
      <head><style>.css { color: red; }</style></head>
      <body>
        <header><h1>Site Header</h1></header>
        <nav><a href="/">Nav Item</a></nav>
        <dialog open><p>Modal Content</p></dialog>
        <div hidden><p>Hidden Div Content</p></div>
        <main><p>Real Main Article Body Content</p></main>
        <footer><p>Footer disclaimer boilerplate</p></footer>
        <script>console.log("script content");</script>
      </body>
    </html>
  `;
  const readingText = extractReadingText(html);
  assert.doesNotMatch(readingText, /Site Header/);
  assert.doesNotMatch(readingText, /Nav Item/);
  assert.doesNotMatch(readingText, /Modal Content/);
  assert.doesNotMatch(readingText, /Hidden Div Content/);
  assert.doesNotMatch(readingText, /script content/);
  assert.match(readingText, /Real Main Article Body Content/);
});

test('Tags: Canonical Tag Registry validation and constraints', () => {
  assert.equal(validTagKeys.size, 16, 'Exactly 16 canonical tags in registry');
  for (const tag of validTagKeys) {
    const entry = tagsRegistry[tag];
    assert.ok(entry.ko, `Tag ${tag} must have Korean label`);
    assert.ok(entry.en, `Tag ${tag} must have English label`);
  }
});

test('Backfilled Data Integrity: posts.json and search-index.json synchronization', () => {
  const posts = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'posts.json'), 'utf8'));
  const searchIndex = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'search-index.json'), 'utf8'));

  assert.equal(posts.length, searchIndex.length, 'posts and searchIndex must have equal item count');
  assert.ok(posts.length >= 60, 'All reports present in posts');

  const postMap = new Map(posts.map(p => [p.id, p]));
  const searchMap = new Map(searchIndex.map(s => [s.id, s]));

  for (const [id, post] of postMap.entries()) {
    const searchEntry = searchMap.get(id);
    assert.ok(searchEntry, `Search index must contain entry for ${id}`);

    // Tags equality
    assert.deepEqual(post.tags, searchEntry.tags, `Tags must match for ${id}`);
    assert.ok(Array.isArray(post.tags), `post.tags must be array for ${id}`);
    assert.ok(post.tags.length <= 3, `post.tags must not exceed 3 tags for ${id}`);

    // No duplicate tags
    assert.equal(new Set(post.tags).size, post.tags.length, `No duplicate tags allowed in ${id}`);

    // All tags in registry
    for (const t of post.tags) {
      assert.ok(validTagKeys.has(t), `Tag "${t}" in ${id} must be in canonical tag registry`);
    }

    // Reading minutes equality and sanity
    assert.equal(post.readingMinutes, searchEntry.readingMinutes, `readingMinutes must match for ${id}`);
    assert.ok(Number.isInteger(post.readingMinutes), `readingMinutes must be integer for ${id}`);
    assert.ok(post.readingMinutes >= 1, `readingMinutes must be >= 1 for ${id}`);
    assert.ok(post.readingMinutes <= 60, `readingMinutes must be reasonable (<= 60) for ${id}`);
  }
});

test('UI templates and styles: site.js, home-v2.css, and index.html support tags & reading time', () => {
  const siteJs = fs.readFileSync(path.join(rootDir, 'assets', 'site.js'), 'utf8');
  const homeCss = fs.readFileSync(path.join(rootDir, 'assets', 'home-v2.css'), 'utf8');

  // Helper functions
  assert.match(siteJs, /formatReadingTime/);
  assert.match(siteJs, /formatTags/);
  assert.match(siteJs, /TAG_REGISTRY/);

  // Localized tag matching in search
  assert.match(siteJs, /localizedTagTerms/);

  // CSS classes for tags
  assert.match(homeCss, /\.latest-card-tags/);
  assert.match(homeCss, /\.report-tags/);
  assert.match(homeCss, /\.calendar-preview-tags/);
  assert.match(homeCss, /\.search-result-tags/);
});

test('Canonical Registry: Single Source of Truth consistency across all files', () => {
  const tagsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'tags.json'), 'utf8'));
  const tagsJs = fs.readFileSync(path.join(rootDir, 'data', 'tags.js'), 'utf8');
  const publishJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'publish.js'), 'utf8');
  const manageJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'manage.js'), 'utf8');
  const siteJs = fs.readFileSync(path.join(rootDir, 'assets', 'site.js'), 'utf8');

  const jsonKeys = Object.keys(tagsJson).sort();
  assert.equal(jsonKeys.length, 16, 'Exactly 16 canonical tags in tags.json');

  // tags.js verification
  for (const k of jsonKeys) {
    assert.ok(tagsJs.includes(`"${k}"`) || tagsJs.includes(`'${k}'`), `tags.js must contain tag "${k}"`);
  }

  // publish.js verification
  for (const k of jsonKeys) {
    assert.ok(publishJs.includes(`'${k}'`) || publishJs.includes(`"${k}"`), `publish.js CANONICAL_TAGS must contain "${k}"`);
  }

  // manage.js verification
  for (const k of jsonKeys) {
    assert.ok(manageJs.includes(`'${k}'`) || manageJs.includes(`"${k}"`), `manage.js CANONICAL_TAGS must contain "${k}"`);
  }

  // site.js verification
  for (const k of jsonKeys) {
    assert.ok(siteJs.includes(`'${k}'`) || siteJs.includes(`"${k}"`), `site.js fallback registry must contain "${k}"`);
  }
});

test('Admin UI Tag Selectors: Publish & Manage tag selector markup and scripts', () => {
  const adminHtml = fs.readFileSync(path.join(rootDir, 'admin', 'index.html'), 'utf8');
  const adminJs = fs.readFileSync(path.join(rootDir, 'assets', 'admin.js'), 'utf8');
  const manageHtml = fs.readFileSync(path.join(rootDir, 'admin', 'manage', 'index.html'), 'utf8');
  const manageJs = fs.readFileSync(path.join(rootDir, 'assets', 'admin-manage.js'), 'utf8');

  // Admin Publish
  assert.match(adminHtml, /id="tag-options"/);
  assert.match(adminHtml, /id="tags-count"/);
  assert.match(adminHtml, /data\/tags\.js/);
  assert.match(adminJs, /renderTagSelector/);
  assert.match(adminJs, /getSelectedTags/);
  assert.match(adminJs, /setSelectedTags/);
  assert.match(adminJs, /form\.append\('tags'/);

  // Admin Manage
  assert.match(manageHtml, /id="manage-tag-options"/);
  assert.match(manageHtml, /id="manage-tags-count"/);
  assert.match(manageHtml, /data\/tags\.js/);
  assert.match(manageJs, /renderManageTagSelector/);
  assert.match(manageJs, /getSelectedManageTags/);
  assert.match(manageJs, /setSelectedManageTags/);
  assert.match(manageJs, /body\.append\('tags'/);
});

test('Semantic Backfill Quality: Varied tag distribution (0, 1, 2, 3 tags allowed)', () => {
  const posts = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'posts.json'), 'utf8'));
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, '4+': 0 };

  for (const post of posts) {
    const len = post.tags.length;
    if (len === 0) counts[0]++;
    else if (len === 1) counts[1]++;
    else if (len === 2) counts[2]++;
    else if (len === 3) counts[3]++;
    else counts['4+']++;
  }

  assert.equal(counts['4+'], 0, 'No post can have more than 3 tags');
  assert.ok(counts[0] > 0, '0-tag posts exist where no taxonomy fit exists');
  assert.ok(counts[1] > 0, '1-tag posts exist where 1 core topic fits');
  assert.ok(counts[2] > 0, '2-tag posts exist');
  assert.ok(counts[3] > 0, '3-tag posts exist');

  // Specific semantic checks requested by user
  const twoWires = posts.find(p => p.id === '2026-08-21-daily-1i56f22');
  assert.ok(twoWires.tags.includes('semiconductors'), '"두 개의 와이어" must include semiconductors');

  const godot = posts.find(p => p.id === '2026-08-12-daily-15kwiwr');
  assert.ok(godot.tags.includes('semiconductors'), '"고도(高度)를 기다리며" must include semiconductors');

  const twoPauses = posts.find(p => p.id === '2026-08-10-daily-1evguss');
  assert.ok(twoPauses.tags.includes('semiconductors'), '"멈춘 두 줄기, 번지는 들판" must include semiconductors');

  const semiNext = posts.find(p => p.id === '2026-08-10-weekly-1rva1f6');
  assert.ok(semiNext.tags.includes('semiconductors'), '"반도체 다음의 자리" must include semiconductors');

  const goodCompany = posts.find(p => p.id === '2026-08-15-basics-1cd8c9w');
  assert.equal(goodCompany.tags.length, 0, '"좋은 회사가 왜 좋은 주식은 아닌가" has 0 tags since general valuation concepts do not match narrow topics');
});

test('KO/EN Pair Tag Equality: All translation pairs share identical canonical tags', () => {
  const posts = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'posts.json'), 'utf8'));
  const enPosts = posts.filter(p => p.lang === 'en');

  let pairCount = 0;
  for (const en of enPosts) {
    const ko = posts.find(p => p.lang !== 'en' && (p.translationGroup === en.translationGroup || p.id === en.translationGroup));
    if (ko) {
      assert.deepEqual(en.tags, ko.tags, `Pair mismatch: KO(${ko.id}) vs EN(${en.id})`);
      pairCount++;
    }
  }
  assert.ok(pairCount >= 20, 'At least 20 translation pairs verified');
});

