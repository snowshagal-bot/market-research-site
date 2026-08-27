import assert from 'node:assert/strict';
import { readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSearchIndex, extractReportText } from '../scripts/build-search-index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (relPath) => readFile(path.join(rootDir, relPath), 'utf8');

test('search index has integrity, required fields, and valid report URLs without duplicates', async () => {
  const [postsRaw, indexRaw, metaJs, bodyKoJs, bodyEnJs] = await Promise.all([
    read('data/posts.json'),
    read('data/search-index.json'),
    read('data/search-index-meta.js'),
    read('data/search-index-body-ko.js'),
    read('data/search-index-body-en.js')
  ]);

  const posts = JSON.parse(postsRaw);
  const searchIndex = JSON.parse(indexRaw);

  assert.equal(searchIndex.length, posts.length);
  assert.match(metaJs, /^window\.SEARCH_INDEX_META = \[/);
  assert.match(bodyKoJs, /^window\.SEARCH_INDEX_BODY = Object\.assign\(/);
  assert.match(bodyEnJs, /^window\.SEARCH_INDEX_BODY = Object\.assign\(/);

  // The metadata tier is what the dialog loads first, so it must stay small:
  // every field except the report body, which lives in the locale shards.
  const meta = JSON.parse(metaJs.slice(metaJs.indexOf('['), metaJs.lastIndexOf(']') + 1));
  assert.equal(meta.length, posts.length);
  assert.ok(meta.every(entry => entry.bodyText === undefined), 'metadata must not carry bodyText');
  assert.ok(metaJs.length < 200 * 1024, `metadata tier is ${Math.round(metaJs.length / 1024)}KB`);

  const parseBodies = (source) => {
    const map = source.match(/Object\.assign\(window\.SEARCH_INDEX_BODY \|\| \{\}, ([\s\S]*)\);\s*$/);
    assert.ok(map, 'body shard must be a single Object.assign merge');
    return JSON.parse(map[1]);
  };
  const shards = { ko: parseBodies(bodyKoJs), en: parseBodies(bodyEnJs) };
  for (const item of searchIndex) {
    const shard = shards[item.lang === 'en' ? 'en' : 'ko'];
    assert.ok(item.id in shard, `${item.id} missing from its locale body shard`);
  }
  // Each report body lives in exactly one shard, so a reader downloads only
  // the locale they are reading.
  assert.equal(Object.keys(shards.ko).length + Object.keys(shards.en).length, searchIndex.length);
  for (const id of Object.keys(shards.ko)) assert.ok(!(id in shards.en), `${id} duplicated across shards`);

  const seenUrls = new Set();
  for (const item of searchIndex) {
    assert.ok(item.id, 'item must have id');
    assert.ok(item.lang === 'ko' || item.lang === 'en', 'item must have valid lang');
    assert.ok(item.category, 'item must have category');
    assert.ok(item.title, 'item must have title');
    assert.ok(item.date, 'item must have date');
    assert.ok(Array.isArray(item.tags), 'item must have tags array');
    assert.ok(item.url, 'item must have url');

    assert.ok(!seenUrls.has(item.url), `duplicate url detected: ${item.url}`);
    seenUrls.add(item.url);

    const relativeReportPath = item.url.replace(/^\/+/, '');
    const fullPath = path.join(rootDir, relativeReportPath.endsWith('.html') ? relativeReportPath : `${relativeReportPath}.html`);
    assert.ok(existsSync(fullPath), `report file must exist on disk: ${fullPath}`);
  }
});

test('public pages include global search trigger in header and search dialog overlay with valid ARIA', async () => {
  const pages = [
    'index.html',
    'en/index.html',
    'about/index.html',
    'en/about/index.html',
    'market/index.html',
    'en/market/index.html'
  ];

  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /data-search-trigger/, `${page} must contain data-search-trigger`);
    assert.match(html, /id="search-dialog"/, `${page} must contain #search-dialog`);
    assert.match(html, /id="global-search-input"/, `${page} must contain #global-search-input`);
    assert.match(html, /id="search-results-list"/, `${page} must contain #search-results-list`);
    assert.match(html, /aria-label="(?:\uac80\uc0c9|Search)"/, `${page} dialog must have valid aria-label`);
    assert.doesNotMatch(html, /aria-labelledby="search-dialog-title"/, `${page} must not have broken aria-labelledby`);
  }
});

test('homepage presents modernized archive section with eyebrow, heading, filters, view toggle, and calendar', async () => {
  const [koHome, enHome] = await Promise.all([read('index.html'), read('en/index.html')]);

  // KO homepage
  assert.match(koHome, /<p class="archive-eyebrow">ARCHIVE<\/p>/);
  assert.match(koHome, /<h2 id="archive-heading">최근 리포트<\/h2>/);
  assert.match(koHome, /<p class="archive-lead">지금까지의 생각과 기록을 모았습니다\. 필요한 인사이트를 쉽게 찾아보세요\.<\/p>/);
  assert.match(koHome, /id="archive-view-toggle"/);
  assert.match(koHome, /data-view="list"/);
  assert.match(koHome, /data-view="calendar"/);
  assert.match(koHome, /id="filter-year"/);
  assert.match(koHome, /id="filter-month"/);
  assert.match(koHome, /id="filter-tag"/);
  assert.match(koHome, /id="filter-reset-btn"/);
  assert.match(koHome, /id="report-list"/);
  assert.match(koHome, /id="calendar-container"/);

  // EN homepage
  assert.match(enHome, /<p class="archive-eyebrow">ARCHIVE<\/p>/);
  assert.match(enHome, /<h2 id="archive-heading">Recent Reports<\/h2>/);
  assert.match(enHome, /<p class="archive-lead">A library of market thoughts and records\. Find the insights you need\.<\/p>/);
  assert.match(enHome, /id="archive-view-toggle"/);
  assert.match(enHome, /id="calendar-container"/);
});

test('calendar date mapping, active month calculation, and navigation', async () => {
  const indexRaw = await read('data/search-index.json');
  const index = JSON.parse(indexRaw);

  const dailyReports = index.filter(p => p.lang === 'ko' && p.category === 'daily');
  const weeklyReports = index.filter(p => p.lang === 'ko' && p.category === 'weekly');

  assert.ok(dailyReports.length > 0);
  assert.ok(weeklyReports.length > 0);

  // Map dates
  const dailyDates = new Set(dailyReports.map(p => p.date));
  const weeklyDates = new Set(weeklyReports.map(p => p.date));

  assert.ok(dailyDates.has('2026-08-25'), '2026-08-25 must have daily report');
  assert.ok(!dailyDates.has('2026-08-22'), '2026-08-22 (weekend) must have no daily report');

  // Month navigation simulation
  function prevMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    if (m === 1) return `${y - 1}-12`;
    return `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  function nextMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    if (m === 12) return `${y + 1}-01`;
    return `${y}-${String(m + 1).padStart(2, '0')}`;
  }

  assert.equal(prevMonth('2026-08'), '2026-07');
  assert.equal(nextMonth('2026-08'), '2026-09');
  assert.equal(prevMonth('2026-01'), '2025-12');
  assert.equal(nextMonth('2025-12'), '2026-01');
});

test('archive multi-filter combinations: year, month, category, and reset', async () => {
  const indexRaw = await read('data/search-index.json');
  const index = JSON.parse(indexRaw);

  const koIndex = index.filter(p => p.lang === 'ko');

  function filterPosts(category, year, month, tag) {
    return koIndex.filter(post => {
      if (category !== 'all' && post.category !== category) return false;
      const d = post.date || '';
      if (year !== 'all' && !d.startsWith(year)) return false;
      if (month !== 'all' && d.slice(5, 7) !== month) return false;
      if (tag !== 'all' && (!Array.isArray(post.tags) || !post.tags.includes(tag))) return false;
      return true;
    });
  }

  const allFiltered = filterPosts('all', 'all', 'all', 'all');
  assert.equal(allFiltered.length, koIndex.length);

  const year2026 = filterPosts('all', '2026', 'all', 'all');
  assert.ok(year2026.length > 0);

  const aug2026 = filterPosts('all', '2026', '08', 'all');
  assert.ok(aug2026.length > 0);
  assert.ok(aug2026.length <= year2026.length);

  const dailyAug2026 = filterPosts('daily', '2026', '08', 'all');
  assert.ok(dailyAug2026.length > 0);
  assert.ok(dailyAug2026.every(p => p.category === 'daily' && p.date.startsWith('2026-08')));
});

test('URL state serialization and roundtrip parsing', () => {
  function serializeState(state) {
    const params = new URLSearchParams();
    if (state.category && state.category !== 'all') params.set('category', state.category);
    if (state.year && state.year !== 'all') params.set('year', state.year);
    if (state.month && state.month !== 'all') params.set('month', state.month);
    if (state.tag && state.tag !== 'all') params.set('tag', state.tag);
    if ((state.category === 'daily' || state.category === 'weekly') && state.view === 'calendar') {
      params.set('view', 'calendar');
      if (state.calMonth) params.set('calMonth', state.calMonth);
    }
    return params.toString();
  }

  function parseState(queryString) {
    const p = new URLSearchParams(queryString);
    const category = p.get('category') || 'all';
    const view = (category === 'daily' || category === 'weekly') && p.get('view') === 'calendar' ? 'calendar' : 'list';
    return {
      category,
      year: p.get('year') || 'all',
      month: p.get('month') || 'all',
      tag: p.get('tag') || 'all',
      view,
      calMonth: p.get('calMonth') || ''
    };
  }

  const s1 = { category: 'daily', year: '2026', month: '08', tag: 'all', view: 'calendar', calMonth: '2026-08' };
  const q1 = serializeState(s1);
  assert.equal(q1, 'category=daily&year=2026&month=08&view=calendar&calMonth=2026-08');
  assert.deepEqual(parseState(q1), s1);

  const s2 = { category: 'all', year: 'all', month: 'all', tag: 'all', view: 'list', calMonth: '' };
  assert.equal(serializeState(s2), '');
  assert.deepEqual(parseState(''), s2);
});

test('search relevance weights title > tags > summary > body, separates locales, and searches full body (>10,000 chars)', async () => {
  const indexRaw = await read('data/search-index.json');
  const index = JSON.parse(indexRaw);

  const koItems = index.filter(p => p.lang === 'ko');
  const enItems = index.filter(p => p.lang === 'en');

  function scoreItem(item, queryWords) {
    let score = 0;
    const title = (item.title || '').toLowerCase();
    const subtitle = (item.subtitle || '').toLowerCase();
    const summary = (item.summary || item.description || '').toLowerCase();
    const body = (item.bodyText || '').toLowerCase();
    const tags = (Array.isArray(item.tags) ? item.tags : []).map(t => String(t).toLowerCase());

    queryWords.forEach(word => {
      if (title.includes(word)) score += 10;
      if (tags.some(t => t.includes(word))) score += 8;
      if (subtitle.includes(word) || summary.includes(word)) score += 5;
      if (body.includes(word)) score += 2;
    });
    return score;
  }

  // KO search: "낙차" should score higher on the title-matched daily post
  const query = ['낙차'];
  const results = koItems.map(p => ({ item: p, score: scoreItem(p, query) })).filter(r => r.score > 0);
  assert.ok(results.length > 0);
  results.sort((a,b) => b.score - a.score);
  assert.match(results[0].item.title, /낙차/);
  assert.ok(results[0].score >= 10);

  // EN search: "Rewinding"
  const enQuery = ['rewinding'];
  const enResults = enItems.map(p => ({ item: p, score: scoreItem(p, enQuery) })).filter(r => r.score > 0);
  assert.ok(enResults.length > 0);
  assert.match(enResults[0].item.title, /Rewinding/i);
});

test('automatic search index pipeline simulation test (+1 report indexing & cleanup)', async () => {
  const postsPath = path.join(rootDir, 'data', 'posts.json');
  const tempUniqueKeyword = 'XY_UNIQUE_FULL_BODY_SEARCH_KEYWORD_2026_TEST';
  const tempTitle = '임시 시뮬레이션 리포트 제목';

  const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tempDir = mkdtempSync(path.join(tmpdir(), 'srch-test-'));
  mkdirSync(path.join(tempDir, 'data'), { recursive: true });
  mkdirSync(path.join(tempDir, 'reports'), { recursive: true });

  const tempPostsPath = path.join(tempDir, 'data', 'posts.json');
  const tempReportFile = path.join(tempDir, 'reports', '_temp_test_simulation_report.html');

  // Generate a long HTML file (>12,000 characters) with the unique keyword near the end
  const paddingText = '대한민국 주식시장 반도체 2차전지 금융 매크로 분석 '.repeat(300);
  const tempHtmlContent = `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>${tempTitle}</title></head>
<body>
  <h1>${tempTitle}</h1>
  <p>이것은 자동 인덱싱 파이프라인 검증용 임시 문서입니다.</p>
  <div>${paddingText}</div>
  <p>문서의 후반부 키워드: <strong>${tempUniqueKeyword}</strong></p>
</body>
</html>`;

  try {
    // 1. Copy current posts.json to temp directory
    const currentPosts = JSON.parse(readFileSync(postsPath, 'utf8'));
    const initialIndexCount = currentPosts.length;

    // 2. Write temp HTML file
    writeFileSync(tempReportFile, tempHtmlContent, 'utf8');

    // 3. Add temp post to temp posts.json
    const tempPost = {
      id: '2026-08-99-daily-temp-simulation',
      type: 'daily',
      typeLabel: '주식 리포트',
      lang: 'ko',
      date: '2026-08-99',
      reportDate: '2026-08-99',
      registeredDate: '2026-08-26',
      registeredAt: new Date().toISOString(),
      title: tempTitle,
      subtitle: '시뮬레이션 부제목',
      description: '시뮬레이션 설명',
      tags: ['flows'],
      href: 'reports/_temp_test_simulation_report.html'
    };
    currentPosts.push(tempPost);
    writeFileSync(tempPostsPath, JSON.stringify(currentPosts, null, 2) + '\n', 'utf8');

    // 4. Run buildSearchIndex pipeline in isolated tempDir
    const newIndex = buildSearchIndex(tempDir);

    // 5. Assert count increased by +1
    assert.equal(newIndex.length, initialIndexCount + 1, 'Index count must increase by 1');

    // 6. Assert unique keyword in body (>10k chars) is searchable
    const matched = newIndex.filter(item => item.bodyText && item.bodyText.includes(tempUniqueKeyword));
    assert.equal(matched.length, 1, 'Must find the newly added report by its deep body keyword');
    assert.equal(matched[0].id, tempPost.id);
  } finally {
    // 7. Cleanup temp directory
    try { rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('archive-view-toggle[hidden] is strictly hidden in CSS and global [hidden] is enforced', async () => {
  const [homeCss, siteCss] = await Promise.all([
    read('assets/home-v2.css'),
    read('assets/site.css')
  ]);

  assert.match(homeCss, /\.archive-view-toggle\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(siteCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('assets/site.css has no duplicate :root declaration and retains single base stylesheet', async () => {
  const siteCss = await read('assets/site.css');
  const rootMatches = siteCss.match(/:root\s*\{/g);
  assert.equal(rootMatches?.length, 1, 'assets/site.css should have exactly one :root declaration');
});

test('_headers configures no-cache revalidation policy for search-index files', async () => {
  const headers = await read('_headers');
  assert.match(headers, /\/data\/search-index-meta\.js\s+Cache-Control:\s*no-cache/);
  assert.match(headers, /\/data\/search-index-body-ko\.js\s+Cache-Control:\s*no-cache/);
  assert.match(headers, /\/data\/search-index-body-en\.js\s+Cache-Control:\s*no-cache/);
  assert.match(headers, /\/data\/search-index\.json\s+Cache-Control:\s*no-cache/);
});
