import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage v2 exposes the requested information architecture and carousel controls', async () => {
  const [html, englishHtml] = await Promise.all([read('index.html'), read('en/index.html')]);
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
  assert.match(html, /home-v2\.css\?v=20260813-1/);
  assert.match(englishHtml, /home-v2\.css\?v=20260813-1/);
  assert.match(html, /locale\.js\?v=20260824-1/);
  assert.match(englishHtml, /locale\.js\?v=20260824-1/);
  assert.match(html, /site\.js\?v=20260824-1/);
  assert.match(englishHtml, /site\.js\?v=20260824-1/);
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
  const [script, homeStyles, polishStyles] = await Promise.all([
    read('assets/site.js'),
    read('assets/home-v2.css'),
    read('assets/ui-polish.css')
  ]);
  assert.match(script, /const coreTypes = \['daily', 'weekly', 'research', 'basics'\]/);
  assert.match(script, /coreTypes\.map\(type=>latestFor\(type\)\)\.filter\(Boolean\)/);
  assert.match(script, /if\(post\.coverImage\)/);
  assert.match(script, /cover-fallback/);
  assert.match(script, /post\.summary \|\| post\.description \|\| info\.description/);
  assert.match(script, /touchstart/);
  assert.match(script, /touchend/);
  assert.doesNotMatch(script, /setInterval|autoplay/i);
  assert.match(homeStyles, /Homepage cover sizing and fallback spacing stay local/);
  assert.match(homeStyles, /\.carousel-cover>img\{object-position:center center\}/);
  assert.match(homeStyles, /\.cover-fallback strong\{max-width:13ch;font-size:25px/);
  const midWidthStart = homeStyles.indexOf('@media(min-width:761px) and (max-width:960px)');
  assert.notEqual(midWidthStart, -1);
  const midWidthEnd = homeStyles.indexOf('@media(min-width:961px)', midWidthStart);
  const midWidthOverride = homeStyles.slice(midWidthStart, midWidthEnd);
  assert.match(midWidthOverride, /\.featured-carousel\{[^}]*border-radius:0[^}]*box-shadow:none/);
  assert.match(midWidthOverride, /\.carousel-stage\{[^}]*grid-template-columns:minmax\([^)]+\) minmax\([^)]+\)/);
  assert.match(midWidthOverride, /\.carousel-cover\{[^}]*grid-column:1[^}]*padding:0[^}]*border-right:/);
  assert.match(midWidthOverride, /\.carousel-copy\{[^}]*grid-column:2/);
  const desktopStart = homeStyles.indexOf('@media(min-width:961px)');
  assert.notEqual(desktopStart, -1);
  const desktopOverride = homeStyles.slice(desktopStart);
  assert.match(desktopOverride, /\.featured-carousel\{[^}]*border-radius:0[^}]*box-shadow:none/);
  assert.match(desktopOverride, /\.carousel-stage\{[^}]*grid-template-columns:minmax\([^)]+\) minmax\([^)]+\)/);
  assert.match(desktopOverride, /\.carousel-cover\{[^}]*grid-column:1[^}]*padding:0[^}]*border-right:/);
  assert.match(desktopOverride, /\.carousel-copy\{[^}]*grid-column:2/);
  assert.match(desktopOverride, /\.latest-card\{[^}]*min-height:/);
  assert.match(homeStyles, /@media\(max-width:760px\)\{\.v2-hero/);
  assert.match(homeStyles, /\.carousel-cover\{order:1/);
  assert.match(homeStyles, /\.carousel-copy\{order:2/);
  assert.doesNotMatch(polishStyles, /\.cover-category/);
});

test('homepage removes the introduction copy while preserving the carousel and latest cards', async () => {
  const html = await read('index.html');
  assert.doesNotMatch(html, /class="intro-copy"/);
  assert.doesNotMatch(html, /INDEPENDENT ARCHIVE/);
  assert.match(html, /data-carousel/);
  assert.match(html, /id="latest-category-cards"/);
});

test('homepage archive uses a responsive two-column index with dynamic category counts', async () => {
  const [html, script, styles, posts] = await Promise.all([
    read('index.html'),
    read('assets/site.js'),
    read('assets/home-v2.css'),
    read('data/posts.json').then(JSON.parse)
  ]);
  assert.match(html, /class="archive-layout"/);
  assert.match(html, /class="archive-index"/);
  assert.match(html, /id="archive-index"/);
  assert.match(html, /class="archive-about" href="\/about\/"/);
  assert.match(script, /categoryCounts\(allPosts, locale/);
  assert.match(script, /archiveIndex\.innerHTML=\[\.\.\.coreTypes,'note'\]\.map/);
  assert.match(script, /href="\?category=\$\{encodeURIComponent\(type\)\}"/);
  assert.match(script, /counts\[type\]\|\|0/);
  assert.match(script, /const subtitle=post\.subtitle\?/);
  assert.match(script, /active==='all'[\s\S]*sortPostsByRegistration\(matched\)[\s\S]*sortPosts\(matched\)/);
  assert.match(html, /id="archive-order-label">홈페이지 등록일 최신순/);
  assert.match(styles, /\.archive-layout\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(270px,300px\)/);
  assert.match(styles, /@media\(max-width:960px\)\{\.archive-layout\{grid-template-columns:minmax\(0,1fr\)/);

  const allowedTypes = new Set(['daily', 'weekly', 'research', 'basics', 'note']);
  assert.ok(Array.isArray(posts));
  assert.ok(posts.every(post => allowedTypes.has(post.type)));
});

test('existing post metadata supports an optional coverImage without snapshotting production state', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  assert.ok(Array.isArray(posts));
  assert.ok(posts.every(post => typeof post.href === 'string'));
  assert.ok(posts.every(post => !Object.hasOwn(post, 'coverImage') || typeof post.coverImage === 'string'));
});

test('admin exposes an optional validated cover input', async () => {
  const [html, script] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /id="cover-file"/);
  assert.match(html, /image\/jpeg,image\/png,image\/webp/);
  assert.match(script, /4 \* 1024 \* 1024/);
  assert.match(script, /form\.append\('cover'/);
});
