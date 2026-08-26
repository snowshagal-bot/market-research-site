import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import {
  SEARCH_BODY_PATHS,
  SEARCH_META_PATH,
  searchIndexArtifacts,
  searchMetaEntry
} from '../functions/api/_search-index.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sizeOf = async path => (await stat(new URL(`../${path}`, import.meta.url))).size;

const SAMPLE = [
  {
    id: 'ko-1', lang: 'ko', category: 'daily', typeLabel: '주식 리포트', title: '먼저열리는 밤',
    subtitle: '', date: '2026-08-26', registeredAt: '2026-08-26T04:00:00.000Z',
    summary: '당일 시장의 핵심 흐름.', tags: ['rates'], readingMinutes: 18,
    url: '/reports/ko.html', coverImage: '/covers/ko.webp', bodyText: '한국어 본문 '.repeat(2000)
  },
  {
    id: 'en-1', lang: 'en', category: 'daily', typeLabel: 'Daily', title: 'The Night Opens First',
    subtitle: '', date: '2026-08-26', registeredAt: '2026-08-26T05:00:00.000Z',
    summary: 'A daily report.', tags: ['rates'], readingMinutes: 21,
    url: '/reports/en.html', coverImage: '/covers/en.webp', bodyText: 'English body '.repeat(2000)
  },
  { id: 'legacy', category: 'basics', title: '언어 없음', date: '2026-08-15', tags: [], url: '/reports/legacy.html', bodyText: 'x' }
];

/* ---------------- artifact shape ---------------- */

test('the index is published as one canonical file plus three browser files', () => {
  const artifacts = searchIndexArtifacts(SAMPLE);
  assert.deepEqual(artifacts.map(a => a.path), [
    'data/search-index.json',
    'data/search-index-meta.js',
    'data/search-index-body-ko.js',
    'data/search-index-body-en.js'
  ]);
  // The full index stays the canonical server-side artifact.
  assert.deepEqual(JSON.parse(artifacts[0].content), SAMPLE);
});

test('metadata carries every field except the report body', () => {
  const entry = searchMetaEntry(SAMPLE[0]);
  assert.equal(entry.bodyText, undefined);
  for (const field of ['id', 'lang', 'category', 'title', 'date', 'summary', 'tags', 'readingMinutes', 'url', 'coverImage']) {
    assert.deepEqual(entry[field], SAMPLE[0][field], field);
  }

  const meta = searchIndexArtifacts(SAMPLE)[1].content;
  assert.match(meta, /^window\.SEARCH_INDEX_META = \[/);
  assert.doesNotMatch(meta, /bodyText/);
  assert.doesNotMatch(meta, /한국어 본문/);
});

test('report bodies are split by locale and a missing lang counts as Korean', () => {
  const [, , koShard, enShard] = searchIndexArtifacts(SAMPLE);
  const parse = source => JSON.parse(source.match(/\|\| \{\}, ([\s\S]*)\);\s*$/)[1]);

  const ko = parse(koShard.content);
  const en = parse(enShard.content);

  assert.deepEqual(Object.keys(ko).sort(), ['ko-1', 'legacy']);
  assert.deepEqual(Object.keys(en), ['en-1']);
  assert.match(ko['ko-1'], /한국어 본문/);
  assert.doesNotMatch(koShard.content, /English body/);
  assert.doesNotMatch(enShard.content, /한국어 본문/);
});

test('shards merge rather than overwrite, so both locales can be loaded at once', () => {
  const [, , koShard, enShard] = searchIndexArtifacts(SAMPLE);
  for (const shard of [koShard, enShard]) {
    assert.match(shard.content, /^window\.SEARCH_INDEX_BODY = Object\.assign\(window\.SEARCH_INDEX_BODY \|\| \{\}, /);
  }

  const scope = {};
  const run = source => new Function('window', source)(scope);
  run(koShard.content);
  run(enShard.content);
  assert.deepEqual(Object.keys(scope.SEARCH_INDEX_BODY).sort(), ['en-1', 'ko-1', 'legacy']);
});

test('an empty index still produces every file', () => {
  const artifacts = searchIndexArtifacts([]);
  assert.equal(artifacts.length, 4);
  assert.match(artifacts[1].content, /^window\.SEARCH_INDEX_META = \[\];/);
  assert.match(artifacts[2].content, /\{\}\);/);
});

/* ---------------- shipped files ---------------- */

test('the metadata tier a reader downloads first stays small', async () => {
  const metaBytes = await sizeOf(SEARCH_META_PATH);
  const koBytes = await sizeOf(SEARCH_BODY_PATHS.ko);
  const enBytes = await sizeOf(SEARCH_BODY_PATHS.en);

  // Opening the dialog used to cost the whole index; it now costs the metadata.
  assert.ok(metaBytes < 200 * 1024, `metadata is ${Math.round(metaBytes / 1024)}KB`);
  assert.ok(metaBytes * 5 < koBytes, 'metadata must be far smaller than a body shard');
  // No reader downloads both locales.
  assert.ok(koBytes > 0 && enBytes > 0);
});

test('the superseded single-file index is gone', async () => {
  await assert.rejects(read('data/search-index.js'), /ENOENT/);
  const headers = await read('_headers');
  assert.doesNotMatch(headers, /\/data\/search-index\.js\s/);
});

/* ---------------- site.js wiring ---------------- */

test('search loads metadata first and report bodies in the background', async () => {
  const site = await read('assets/site.js');

  assert.match(site, /const SEARCH_META_SRC = '\/data\/search-index-meta\.js/);
  assert.match(site, /const SEARCH_BODY_SRC = `\/data\/search-index-body-\$\{locale\}\.js/);

  // Opening the dialog renders from metadata, then re-runs when bodies land.
  assert.match(site, /loadSearchMeta\(\(\) => \{[\s\S]*?loadSearchBodies\(\(\) => performSearch/);
  // Scoring reads the body through the shard, never from the metadata entry.
  assert.match(site, /const body = searchBodyText\(item\)\.toLowerCase\(\);/);
  assert.doesNotMatch(site, /item\.bodyText/);
  assert.doesNotMatch(site, /window\.SEARCH_INDEX\b(?!_)/);
});

test('search still degrades to page data when the index cannot be fetched', async () => {
  const site = await read('assets/site.js');
  assert.match(site, /function searchMetaFallback\(\)/);
  assert.match(site, /\.catch\(\(\) => \{ window\.SEARCH_INDEX_META = searchMetaFallback\(\); \}\)/);
});

/* ---------------- archive paging ---------------- */

test('the archive renders one page at a time and offers the rest', async () => {
  const site = await read('assets/site.js');

  assert.match(site, /const ARCHIVE_PAGE = 20;/);
  assert.match(site, /const visible = filtered\.slice\(0, archiveShown\);/);
  assert.match(site, /const remaining = filtered\.length - visible\.length;/);
  // The button reports how many are left and disappears when none are.
  assert.match(site, /remaining > 0[\s\S]*?archive-more[\s\S]*?\$\{remaining\}/);
  assert.match(site, /archiveShown \+= ARCHIVE_PAGE;/);
  // Focus follows the reveal rather than being stranded on a removed button.
  assert.match(site, /list\.querySelectorAll\('\.report-item'\)\[revealedFrom\]\?\.focus\(\)/);
});

test('every control that changes the result set restarts the archive window', async () => {
  const site = await read('assets/site.js');
  const resets = site.match(/archiveShown = ARCHIVE_PAGE;/g) || [];
  // declaration + category, year, month, tag, reset button, popstate
  assert.equal(resets.length, 7);

  for (const control of [
    /activeCategory = button\.dataset\.filter;\s*\r?\n\s*archiveShown = ARCHIVE_PAGE;/,
    /activeYear = e\.target\.value;\s*\r?\n\s*archiveShown = ARCHIVE_PAGE;/,
    /activeMonth = e\.target\.value;\s*\r?\n\s*archiveShown = ARCHIVE_PAGE;/,
    /activeTag = e\.target\.value;\s*\r?\n\s*archiveShown = ARCHIVE_PAGE;/
  ]) assert.match(site, control);
});

test('the load-more control is styled and localised in both languages', async () => {
  const [css, locale] = await Promise.all([read('assets/home-v2.css'), read('assets/locale.js')]);

  assert.match(css, /\.archive-more \{[\s\S]*?width: 100%;/);
  assert.match(css, /\.archive-more:focus-visible \{[\s\S]*?outline:/);
  assert.match(locale, /archiveMore: '더 보기',/);
  assert.match(locale, /archiveMore: 'Show more',/);
});

/* ---------------- publish and manage stay in step ---------------- */

test('the publisher and the post manager emit the same artifact set', async () => {
  const [publish, manage] = await Promise.all([
    read('functions/api/publish.js'),
    read('functions/api/manage.js')
  ]);

  for (const source of [publish, manage]) {
    assert.match(source, /import \{ searchIndexArtifacts \} from ["']\.\/_search-index\.js["'];/);
    // No writer may hand-roll the index paths any more.
    assert.doesNotMatch(source, /window\.SEARCH_INDEX = /);
    assert.doesNotMatch(source, /'data\/search-index\.js'|"data\/search-index\.js"/);
  }
  assert.match(publish, /searchIndexArtifacts\(searchIndex\)/);
  assert.match(manage, /searchIndexArtifacts\(searchIndex\)/);
});
