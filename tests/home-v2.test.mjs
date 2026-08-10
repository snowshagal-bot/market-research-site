import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage v2 exposes the requested information architecture and carousel controls', async () => {
  const html = await read('index.html');
  const order = [
    html.indexOf('class="site-header"'),
    html.indexOf('class="v2-hero"'),
    html.indexOf('class="site-introduction"'),
    html.indexOf('class="section archive-section"'),
    html.indexOf('class="footer"')
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /aria-label="이전 대표 리포트"/);
  assert.match(html, /aria-label="다음 대표 리포트"/);
  assert.match(html, /role="tablist"/);
});

test('basics is added without replacing notes across public and admin controls', async () => {
  const [html, admin, adminScript, middleware, shell] = await Promise.all([
    read('index.html'),
    read('admin/index.html'),
    read('assets/admin.js'),
    read('functions/_middleware.js'),
    read('assets/report-shell.js')
  ]);
  for (const source of [html, admin, shell]) {
    assert.match(source, /basics/);
    assert.match(source, /시장 공부/);
    assert.match(source, /note/);
    assert.match(source, /끄적끄적/);
  }
  assert.ok(adminScript.includes('market\\s*basics'));
  assert.ok(adminScript.includes('investing\\s*basics'));
  assert.match(middleware, /active = 'basics'/);
});

test('carousel uses one latest post per core category, never autoplay, and supports fallback covers', async () => {
  const script = await read('assets/site.js');
  assert.match(script, /const coreTypes = \['daily', 'weekly', 'research', 'basics'\]/);
  assert.match(script, /coreTypes\.map\(type=>latestFor\(type\)\)\.filter\(Boolean\)/);
  assert.match(script, /if\(post\.coverImage\)/);
  assert.match(script, /cover-fallback/);
  assert.match(script, /touchstart/);
  assert.match(script, /touchend/);
  assert.doesNotMatch(script, /setInterval|autoplay/i);
});

test('existing post metadata remains valid without coverImage', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  assert.ok(posts.length > 0);
  assert.ok(posts.every(post => typeof post.href === 'string'));
  assert.ok(posts.some(post => !Object.hasOwn(post, 'coverImage')));
});

test('admin exposes an optional validated cover input', async () => {
  const [html, script] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /id="cover-file"/);
  assert.match(html, /image\/jpeg,image\/png,image\/webp/);
  assert.match(script, /4 \* 1024 \* 1024/);
  assert.match(script, /form\.append\('cover'/);
});
