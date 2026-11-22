import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { buildSearchIndex } from '../scripts/build-search-index.mjs';

test('rebuilding search artifacts normalizes stored summaries without rewriting report HTML', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-normalization-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'data'));
  fs.mkdirSync(path.join(root, 'reports'));
  const html = '<!doctype html><html><body><h1>Daily</h1><p>AI 반도체\u2060·\u2060데이터센터</p></body></html>';
  fs.writeFileSync(path.join(root, 'reports/daily.html'), html);
  const post = {
    id: 'daily', type: 'daily', lang: 'ko', title: 'Daily',
    href: 'reports/daily.html', readingMinutes: 3,
    summary: '  AI 반도체\u2060·\u2060데이터센터\r\n\t규제  '
  };
  const noSummary = { id: 'other', type: 'daily', title: 'Other', readingMinutes: 1 };
  fs.writeFileSync(path.join(root, 'data/posts.json'), JSON.stringify([post, noSummary]));

  const index = buildSearchIndex(root);
  const read = file => fs.readFileSync(path.join(root, 'data', file), 'utf8');
  const window = {};
  vm.runInNewContext(read('posts.js'), { window });
  vm.runInNewContext(read('search-index-meta.js'), { window });
  const expected = 'AI 반도체·데이터센터 규제';
  for (const entries of [JSON.parse(read('posts.json')), window.RESEARCH_POSTS, index, JSON.parse(read('search-index.json')), window.SEARCH_INDEX_META]) {
    assert.equal(entries[0].summary, expected);
  }
  assert.equal(Object.hasOwn(JSON.parse(read('posts.json'))[1], 'summary'), false);
  assert.equal(fs.readFileSync(path.join(root, 'reports/daily.html'), 'utf8'), html);

  const outputs = ['posts.json', 'posts.js', 'search-index.json', 'search-index-meta.js', 'search-index-body-ko.js', 'search-index-body-en.js', 'glossary.json'];
  const before = outputs.map(read);
  buildSearchIndex(root);
  assert.deepEqual(outputs.map(read), before, 'repeated regeneration must be stable');
});
