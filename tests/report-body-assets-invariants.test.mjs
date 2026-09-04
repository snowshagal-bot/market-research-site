// Repository invariants for Research body pictures (report-assets/):
// every recorded file is the post's own, exists, and is exactly the set its
// HTML references; every file under report-assets/ belongs to a post.
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import { BODY_ASSET_ROOT, isBodyAssetPath, magicMime, referencedBodyAssets } from '../functions/_body-assets.js';

const root = new URL('../', import.meta.url);
const text = path => readFile(new URL(path, root), 'utf8');
const exists = async path => { try { return (await stat(new URL(path, root))).isFile(); } catch { return false; } };

async function walk(dir) {
  let entries;
  try { entries = await readdir(new URL(`${dir}/`, root), { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

test('bodyAssets are the post\'s own hashed files, once each, and every one is in the repository', async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  const problems = [];
  for (const post of posts) {
    if (!('bodyAssets' in post)) continue;
    if (!Array.isArray(post.bodyAssets) || !post.bodyAssets.length) { problems.push(`${post.id}: bodyAssets present but empty`); continue; }
    const seen = new Set();
    for (const path of post.bodyAssets) {
      if (!isBodyAssetPath(path, post.id)) problems.push(`${post.id}: ${path} is not ${BODY_ASSET_ROOT}/${post.id}/<16 hex>.(webp|png|jpg)`);
      if (seen.has(path)) problems.push(`${post.id}: ${path} recorded twice`);
      seen.add(path);
      if (!(await exists(path))) problems.push(`${post.id}: ${path} missing from the repository`);
      else {
        const bytes = new Uint8Array(await readFile(new URL(path, root)));
        const magic = magicMime(bytes);
        const ext = path.split('.').pop();
        const expected = ext === 'jpg' ? 'jpeg' : ext;
        if (magic !== expected) problems.push(`${post.id}: ${path} is ${magic || 'not an image'}, named .${ext}`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('a report references exactly the body files recorded for it', async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  const problems = [];
  for (const post of posts) {
    if (!post.href || !(await exists(post.href))) continue;
    const html = await text(post.href);
    const referenced = referencedBodyAssets(html, post.id);
    const recorded = Array.isArray(post.bodyAssets) ? post.bodyAssets : [];
    const a = [...referenced].sort().join('\n'), b = [...recorded].sort().join('\n');
    if (a !== b) problems.push(`${post.id}: HTML references [${referenced.join(', ')}] but bodyAssets records [${recorded.join(', ')}]`);
    // and nothing under another post's directory
    const foreign = [...html.matchAll(new RegExp(`/${BODY_ASSET_ROOT}/([^/"' )]+)/`, 'g'))].map(m => m[1]).filter(id => id !== post.id);
    if (foreign.length) problems.push(`${post.id}: references another post's body files: ${[...new Set(foreign)].join(', ')}`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test(`every file under ${BODY_ASSET_ROOT}/ belongs to a post that records it`, async () => {
  const posts = JSON.parse(await text('data/posts.json'));
  const recorded = new Set(posts.flatMap(post => Array.isArray(post.bodyAssets) ? post.bodyAssets : []));
  const files = await walk(BODY_ASSET_ROOT);
  const orphans = files.filter(file => !recorded.has(file));
  assert.deepEqual(orphans, [], `orphaned body files:\n${orphans.join('\n')}`);
});
