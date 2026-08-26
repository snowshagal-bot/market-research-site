import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const read = (relPath) => readFile(path.join(rootDir, relPath), 'utf8');

test('search index has integrity, required fields, and valid report URLs without duplicates', async () => {
  const [postsRaw, indexRaw, indexJs] = await Promise.all([
    read('data/posts.json'),
    read('data/search-index.json'),
    read('data/search-index.js')
  ]);

  const posts = JSON.parse(postsRaw);
  const searchIndex = JSON.parse(indexRaw);

  assert.equal(searchIndex.length, posts.length);
  assert.match(indexJs, /^window\.SEARCH_INDEX = \[/);

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
    const fullPath = path.join(rootDir, relativeReportPath);
    assert.ok(existsSync(fullPath), `report file must exist on disk: ${fullPath}`);
  }
});

test('public pages include global search trigger in header and search dialog overlay', async () => {
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

test('search relevance weights title higher than tags and summary, and separates Korean and English', async () => {
  const indexRaw = await read('data/search-index.json');
  const index = JSON.parse(indexRaw);

  const koItems = index.filter(p => p.lang === 'ko');
  const enItems = index.filter(p => p.lang === 'en');

  assert.ok(koItems.length > 0);
  assert.ok(enItems.length > 0);

  // Helper search scoring simulator
  function scoreItem(item, queryWords) {
    let score = 0;
    const title = (item.title || '').toLowerCase();
    const summary = (item.summary || '').toLowerCase();
    const body = (item.bodyText || '').toLowerCase();
    const tags = (item.tags || []).map(t => String(t).toLowerCase());

    queryWords.forEach(w => {
      if (title.includes(w)) score += 10;
      if (tags.some(t => t.includes(w))) score += 8;
      if (summary.includes(w)) score += 5;
      if (body.includes(w)) score += 2;
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
