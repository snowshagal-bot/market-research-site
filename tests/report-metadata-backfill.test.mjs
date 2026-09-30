import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import '../assets/report-metadata.js';
import { buildSearchIndex, calculateReadingMinutes } from '../scripts/build-search-index.mjs';
import { MANIFEST_PATH, main, planBackfill } from '../scripts/backfill-report-metadata.mjs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// Two stand-in rules, so the plan's bookkeeping is tested apart from the
// report readers: a blank summary takes the report's quote, and one category
// sentence is blanked.
const RULES = {
  quote: { field: 'summary', derive: ({ before, report }) => (before === '' ? report().quote : null) },
  category: { field: 'description', derive: ({ before }) => (before === 'Category sentence.' ? '' : null) }
};
const reportFor = (post) => () => ({ quote: `Quote of ${post.id}.` });
const posts = () => [
  { id: 'a', type: 'daily', title: 'A', description: 'Category sentence.', tags: ['x'], href: 'reports/a.html' },
  { id: 'b', type: 'daily', title: 'B', description: 'Own words.', summary: 'Kept.', href: 'reports/b.html' }
];
const manifest = (changes, expected = { summary: 1, description: 1, posts: 1 }) => ({ expected, changes });
const APPROVED = [
  { id: 'a', field: 'description', rule: 'category', before: 'Category sentence.', after: '' },
  { id: 'a', field: 'summary', rule: 'quote', before: '', after: 'Quote of a.' }
];

test('an approved change is written only over its approved before value, and nothing else moves', () => {
  const plan = planBackfill(posts(), manifest(APPROVED), reportFor, RULES);
  assert.deepEqual(plan.problems, []);
  assert.equal(plan.pending.length, 2);
  assert.deepEqual(plan.result[0], { id: 'a', type: 'daily', title: 'A', description: '', summary: 'Quote of a.', tags: ['x'], href: 'reports/a.html' });
  // A new field sits where /api/publish puts it, after the description.
  assert.deepEqual(Object.keys(plan.result[0]), ['id', 'type', 'title', 'description', 'summary', 'tags', 'href']);
  assert.deepEqual(plan.result[1], posts()[1]);
});

test('a second run finds every change applied and writes nothing', () => {
  const first = planBackfill(posts(), manifest(APPROVED), reportFor, RULES);
  const second = planBackfill(first.result, manifest(APPROVED), reportFor, RULES);
  assert.deepEqual(second.problems, []);
  assert.equal(second.pending.length, 0);
  assert.equal(second.applied.length, 2);
  assert.deepEqual(second.result, first.result);
});

test('a field holding neither the approved before nor after stops the plan', () => {
  const edited = posts();
  edited[0].description = 'Edited by hand.';
  const plan = planBackfill(edited, manifest(APPROVED), reportFor, RULES);
  assert.ok(plan.problems.some((problem) => problem.startsWith('a description: holds "Edited by hand."')), plan.problems.join('\n'));
});

test('a change the rules would make but the manifest does not approve stops the plan', () => {
  const plan = planBackfill(posts(), manifest(APPROVED.slice(0, 1), { description: 1, posts: 1 }), reportFor, RULES);
  assert.ok(plan.problems.some((problem) => problem.startsWith('a summary: quote would write "Quote of a."')), plan.problems.join('\n'));
});

test('an approved value the rule does not read from the report stops the plan', () => {
  const tampered = APPROVED.map((change) => (change.field === 'summary' ? { ...change, after: 'Something else.' } : change));
  const plan = planBackfill(posts(), manifest(tampered), reportFor, RULES);
  assert.ok(plan.problems.some((problem) => problem.includes('quote gives "Quote of a.", the manifest approves "Something else."')), plan.problems.join('\n'));
});

test('counts that differ from the expected ones, unknown rules and misfiled fields stop the plan', () => {
  assert.ok(planBackfill(posts(), manifest(APPROVED, { summary: 2, description: 1, posts: 1 }), reportFor, RULES)
    .problems.includes('expected 2 summary changes, the manifest lists 1'));
  assert.ok(planBackfill(posts(), manifest([...APPROVED, { id: 'b', field: 'title', rule: 'guess', before: 'B', after: 'C' }]), reportFor, RULES)
    .problems.includes('b title: unknown rule guess'));
  assert.ok(planBackfill(posts(), manifest([...APPROVED, { id: 'b', field: 'title', rule: 'quote', before: 'B', after: 'C' }]), reportFor, RULES)
    .problems.includes('b title: quote writes summary, not title'));
});

// End to end on a throwaway copy of the data layout, with the real rules and readers.
function scratchSite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-'));
  fs.mkdirSync(path.join(root, 'data'));
  fs.mkdirSync(path.join(root, 'reports'));
  fs.mkdirSync(path.join(root, 'scripts'));
  const html = '<!doctype html><html lang="en"><head><title>Two Rooms</title></head><body>'
    + '<div class="dcv-one"><span class="oc">One line for the day.</span></div>'
    + '<section class="hero"><h1>Two Rooms</h1><div class="quote">The hero sentence of the day.</div></section>'
    + '<main><p>Body text of the report.</p></main></body></html>';
  fs.writeFileSync(path.join(root, 'reports/a.html'), html);
  const post = {
    id: '2026-09-30-daily-a', type: 'daily', typeLabel: 'Daily', lang: 'en', date: '2026-09-30', reportDate: '2026-09-30',
    title: 'Two Rooms', subtitle: '', description: 'A daily report on market trends, investor flows, sectors, and macro drivers.',
    tags: [], readingMinutes: calculateReadingMinutes(html, 'en', 'daily'), href: 'reports/a.html'
  };
  fs.writeFileSync(path.join(root, 'data/posts.json'), `${JSON.stringify([post], null, 2)}\n`);
  buildSearchIndex(root);
  const changes = [
    { id: post.id, field: 'description', rule: 'description-category-boilerplate', before: post.description, after: '' },
    { id: post.id, field: 'summary', rule: 'summary-daily-hero-quote', before: '', after: 'The hero sentence of the day.' },
    { id: post.id, field: 'takeaway', rule: 'takeaway-dcv-one-oc', before: '', after: 'One line for the day.' }
  ];
  fs.writeFileSync(path.join(root, MANIFEST_PATH), JSON.stringify({ expected: { title: 0, description: 1, summary: 1, takeaway: 1, posts: 1 }, changes }));
  return root;
}
const snapshot = (root) => Object.fromEntries(fs.readdirSync(path.join(root, 'data')).map((file) => [file, fs.readFileSync(path.join(root, 'data', file), 'utf8')]));
const quietly = async (run) => {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try { return await run(); } finally { Object.assign(console, { log, error }); }
};

test('the tool writes nothing on a dry run, writes and regenerates once, then finds nothing left to do', async () => {
  const root = scratchSite();
  try {
    const initial = snapshot(root);
    assert.equal(await quietly(() => main([], root)), 0);
    assert.deepEqual(snapshot(root), initial);

    assert.equal(await quietly(() => main(['--write'], root)), 0);
    const [post] = JSON.parse(fs.readFileSync(path.join(root, 'data/posts.json'), 'utf8'));
    assert.equal(post.description, '');
    assert.equal(post.summary, 'The hero sentence of the day.');
    assert.equal(post.takeaway, 'One line for the day.');
    const written = snapshot(root);
    assert.equal(written['posts.js'], `window.RESEARCH_POSTS = ${JSON.stringify([post], null, 2)};\n`);
    assert.equal(JSON.parse(written['search-index.json'])[0].summary, 'The hero sentence of the day.');
    assert.equal(written['search-index-body-en.js'], initial['search-index-body-en.js']);

    assert.equal(await quietly(() => main(['--write'], root)), 0);
    assert.deepEqual(snapshot(root), written);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the tool writes nothing when a field holds a value the manifest does not expect', async () => {
  const root = scratchSite();
  try {
    const posts = JSON.parse(fs.readFileSync(path.join(root, 'data/posts.json'), 'utf8'));
    posts[0].description = 'Written by the editor after the manifest.';
    fs.writeFileSync(path.join(root, 'data/posts.json'), `${JSON.stringify(posts, null, 2)}\n`);
    const before = snapshot(root);
    assert.equal(await quietly(() => main(['--write'], root)), 1);
    assert.deepEqual(snapshot(root), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no published post stores a category sentence as its description', () => {
  const stored = JSON.parse(read('data/posts.json'))
    .filter((post) => globalThis.REPORT_METADATA.isCategoryBoilerplate(post.description))
    .map((post) => post.id);
  assert.deepEqual(stored, []);
});
