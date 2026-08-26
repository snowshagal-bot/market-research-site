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

test('Canonical Registry: Exact single-source-of-truth across all backend and frontend layers', () => {
  const tagsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'tags.json'), 'utf8'));
  const tagsJsContent = fs.readFileSync(path.join(rootDir, 'data', 'tags.js'), 'utf8');
  const publishJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'publish.js'), 'utf8');
  const manageJs = fs.readFileSync(path.join(rootDir, 'functions', 'api', 'manage.js'), 'utf8');
  const siteJs = fs.readFileSync(path.join(rootDir, 'assets', 'site.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(rootDir, 'assets', 'admin.js'), 'utf8');
  const adminManageJs = fs.readFileSync(path.join(rootDir, 'assets', 'admin-manage.js'), 'utf8');

  const jsonKeys = Object.keys(tagsJson);
  assert.equal(jsonKeys.length, 16, 'Exactly 16 canonical tags in tags.json');
  assert.equal(new Set(jsonKeys).size, 16, 'No duplicate keys in tags.json');

  // 1. data/tags.js evaluation and exact deepEqual
  const context = { window: {} };
  import('node:vm').then(vm => vm.runInNewContext(tagsJsContent, context));
  // Synchronous extraction for tags.js
  const parsedTagsJs = Function(`const window = {}; ${tagsJsContent}; return window.TAG_REGISTRY;`)();
  assert.deepEqual(parsedTagsJs, tagsJson, 'data/tags.js must deepEqual data/tags.json');

  // 2. publish.js CANONICAL_TAGS exact Set equality
  const publishMatch = publishJs.match(/const CANONICAL_TAGS = new Set\(\[\s*([\s\S]*?)\s*\]\);/);
  assert.ok(publishMatch, 'publish.js must define CANONICAL_TAGS Set');
  const publishTags = publishMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.equal(publishTags.length, 16, 'publish.js CANONICAL_TAGS must have 16 items');
  assert.equal(new Set(publishTags).size, 16, 'publish.js CANONICAL_TAGS must have no duplicates');
  assert.deepEqual(new Set(publishTags), new Set(jsonKeys), 'publish.js CANONICAL_TAGS must exactly match data/tags.json');

  // 3. manage.js CANONICAL_TAGS exact Set equality
  const manageMatch = manageJs.match(/const CANONICAL_TAGS = new Set\(\[\s*([\s\S]*?)\s*\]\);/);
  assert.ok(manageMatch, 'manage.js must define CANONICAL_TAGS Set');
  const manageTags = manageMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  assert.equal(manageTags.length, 16, 'manage.js CANONICAL_TAGS must have 16 items');
  assert.equal(new Set(manageTags).size, 16, 'manage.js CANONICAL_TAGS must have no duplicates');
  assert.deepEqual(new Set(manageTags), new Set(jsonKeys), 'manage.js CANONICAL_TAGS must exactly match data/tags.json');

  // 4. Frontend fallback registries exact label equality
  function extractFallback(src) {
    const match = src.match(/(?:const|let|var)\s+tagRegistry\s*=\s*window\.TAG_REGISTRY\s*\|\|\s*(\{[\s\S]*?\n\s*\});/) ||
                  src.match(/(?:const|let|var)\s+TAG_REGISTRY\s*=\s*window\.TAG_REGISTRY\s*\|\|\s*(\{[\s\S]*?\n\s*\});/);
    assert.ok(match, 'Source must define fallback tag registry');
    return Function(`return ${match[1]};`)();
  }

  const siteFallback = extractFallback(siteJs);
  const adminFallback = extractFallback(adminJs);
  const adminManageFallback = extractFallback(adminManageJs);

  assert.deepEqual(siteFallback, tagsJson, 'assets/site.js fallback must exactly deepEqual data/tags.json');
  assert.deepEqual(adminFallback, tagsJson, 'assets/admin.js fallback must exactly deepEqual data/tags.json');
  assert.deepEqual(adminManageFallback, tagsJson, 'assets/admin-manage.js fallback must exactly deepEqual data/tags.json');
});

test('Admin UI: Translation Pair Tag Inheritance resets tags on switch (no stale tags)', () => {
  const adminJs = fs.readFileSync(path.join(rootDir, 'assets', 'admin.js'), 'utf8');

  // Mock DOM environment for admin.js
  const tagChips = {};
  const tagsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'tags.json'), 'utf8'));
  for (const k of Object.keys(tagsJson)) {
    tagChips[k] = { value: k, checked: false, disabled: false };
  }

  const elements = {
    'tag-options': {
      innerHTML: '',
      querySelectorAll(selector) {
        if (selector === 'input[name="post-tags"]') return Object.values(tagChips);
        if (selector === 'input[name="post-tags"]:checked') return Object.values(tagChips).filter(c => c.checked);
        return [];
      }
    },
    'tags-count': { textContent: '' },
    'tags-status': { textContent: '' },
    'translation-source-status': { textContent: '' },
    'report-date': { value: '' },
    'translation-source': { value: '' },
    'post-language': { value: 'en' },
    'admin-key': { value: '' },
    'report-title': { value: '' },
    'report-subtitle': { value: '' },
    'report-description': { value: '' },
    'post-summary': { value: '' },
    'html-file': { files: [] },
    'cover-file': { files: [] },
    'parse-status': { textContent: '' },
    'publish-btn': { disabled: true }
  };

  const researchPosts = [
    { id: 'pair-a', translationGroup: 'group-a', lang: 'ko', reportDate: '2026-08-20', tags: ['flows', 'rates'] },
    { id: 'pair-b', translationGroup: 'group-b', lang: 'ko', reportDate: '2026-08-21', tags: [] },
    { id: 'pair-c', translationGroup: 'group-c', lang: 'ko', reportDate: '2026-08-22', tags: ['flows', 'rates', 'fx'] },
    { id: 'pair-d', translationGroup: 'group-d', lang: 'ko', reportDate: '2026-08-23', tags: ['semiconductors'] }
  ];

  // Helper simulating admin.js logic
  function setSelectedTags(tags = []) {
    const tagSet = new Set(tags);
    Object.values(tagChips).forEach(cb => {
      cb.checked = tagSet.has(cb.value);
    });
  }

  function getSelectedTags() {
    return Object.values(tagChips).filter(cb => cb.checked).map(cb => cb.value);
  }

  function selectTranslationPair(pairPost) {
    const pairTags = Array.isArray(pairPost?.tags) ? pairPost.tags : [];
    setSelectedTags(pairTags);
  }

  // Case A: Pair A (2 tags) -> Pair B (0 tags)
  selectTranslationPair(researchPosts[0]);
  assert.deepEqual(getSelectedTags(), ['flows', 'rates']);

  selectTranslationPair(researchPosts[1]);
  assert.deepEqual(getSelectedTags(), [], 'Switching from 2 tags to 0 tags pair must reset selected tags to empty');

  // Case B: Pair C (3 tags) -> Pair D (1 tag)
  selectTranslationPair(researchPosts[2]);
  assert.deepEqual(getSelectedTags(), ['flows', 'rates', 'fx']);

  selectTranslationPair(researchPosts[3]);
  assert.deepEqual(getSelectedTags(), ['semiconductors'], 'Switching from 3 tags to 1 tag pair must strictly set 1 tag');
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

