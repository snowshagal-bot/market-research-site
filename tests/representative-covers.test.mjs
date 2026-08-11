import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, rootUrl));

const expectedCovers = new Map([
  ['2026-08-10-daily-1evguss', 'covers/2026-08-10-daily-1evguss.webp'],
  ['2026-08-week1-weekly', 'covers/2026-08-week1-weekly.webp'],
  ['2026-08-09-sovereign-ai', 'covers/2026-08-09-sovereign-ai.webp']
]);

test('representative carousel posts use synchronized static WebP covers', async () => {
  const jsonPosts = JSON.parse(await read('data/posts.json'));
  const script = (await read('data/posts.js')).toString('utf8');
  const scriptPosts = JSON.parse(script.slice(script.indexOf('['), script.lastIndexOf(']') + 1));

  assert.deepEqual(scriptPosts, jsonPosts);
  assert.deepEqual(
    jsonPosts.filter(post => Object.hasOwn(post, 'coverImage')).map(post => post.id).sort(),
    [...expectedCovers.keys()].sort()
  );

  for (const [id, coverImage] of expectedCovers) {
    const post = jsonPosts.find(candidate => candidate.id === id);
    assert.ok(post, `missing representative post ${id}`);
    assert.equal(post.coverImage, coverImage);
    await access(new URL(coverImage, rootUrl));

    const image = await read(coverImage);
    assert.equal(image.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(image.subarray(8, 12).toString('ascii'), 'WEBP');
  }
});

test('coverless posts still use the homepage typography fallback', async () => {
  const [script, styles] = await Promise.all([
    read('assets/site.js').then(buffer => buffer.toString('utf8')),
    read('assets/home-v2.css').then(buffer => buffer.toString('utf8'))
  ]);

  assert.match(script, /if\(post\.coverImage\)/);
  assert.match(script, /class="cover-fallback"/);
  assert.match(styles, /\.cover-fallback/);
});
