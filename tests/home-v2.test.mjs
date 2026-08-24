import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage presents the Snowshagal brand hero before latest reports and archive', async () => {
  const [html, englishHtml] = await Promise.all([read('index.html'), read('en/index.html')]);
  const order = [
    html.indexOf('class="site-header"'),
    html.indexOf('class="brand-hero"'),
    html.indexOf('class="site-introduction"'),
    html.indexOf('class="section archive-section"'),
    html.indexOf('class="footer"')
  ];
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html, /<strong>SNOWSHAGAL<\/strong><small>MARKET RESEARCH<\/small>/);
  assert.doesNotMatch(html, /class="hero-kicker"/);
  assert.doesNotMatch(englishHtml, /class="hero-kicker"/);
  assert.match(html, /<span>하루의 움직임에서,<\/span><span>다음 흐름까지\.<\/span>/);
  assert.match(html, /한국 시장의 데일리 복기부터 위클리 전망,/);
  assert.match(html, /그리고 투자에 참고할 만한 인사이트까지\./);
  assert.match(html, /class="hero-entries"/);
  assert.doesNotMatch(html, /Login|data-carousel|featured-slide/);
  assert.match(html, /<footer[^>]*>[\s\S]*?<span>SNOWSHAGAL<\/span>/);
  assert.doesNotMatch(html, /Independent Market Research/);
  assert.match(html, /home-v2\.css\?v=20260824-4/);
  assert.match(englishHtml, /home-v2\.css\?v=20260824-4/);
  assert.match(html, /locale\.js\?v=20260824-1/);
  assert.match(englishHtml, /locale\.js\?v=20260824-1/);
  assert.match(html, /site\.js\?v=20260824-4/);
  assert.match(englishHtml, /site\.js\?v=20260824-4/);
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

test('brand hero is fixed while latest cards remain post-driven and responsive', async () => {
  const [script, homeStyles, polishStyles] = await Promise.all([
    read('assets/site.js'),
    read('assets/home-v2.css'),
    read('assets/ui-polish.css')
  ]);
  assert.match(script, /const coreTypes = \['daily', 'weekly', 'research', 'basics'\]/);
  assert.match(script, /\['daily','weekly','research'\]\.map\(type=>latestFor\(type\)\)\.filter\(Boolean\)/);
  assert.match(script, /const visual=post\.coverImage/);
  assert.match(script, /latest-card-cover/);
  assert.match(script, /post\.summary\|\|post\.description\|\|post\.subtitle/);
  assert.match(script, /locale==='en'\?'Read report':'리포트 보기'/);
  assert.match(script, /latest-card-body/);
  assert.match(script, /latest-card-content/);
  assert.match(script, /latest-card-summary/);
  assert.match(script, /latest-card-read/);
  assert.match(script, /latest-card-meta[\s\S]*latest-card-content[\s\S]*latest-card-read/);
  assert.match(script, /post\.title/);
  assert.doesNotMatch(script, /setInterval|autoplay|data-slide|buildCarousel/i);
  assert.match(homeStyles, /\.hero-shell\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(homeStyles, /\.hero-art img\s*\{[\s\S]*?object-fit: cover/);
  assert.match(homeStyles, /\.latest-card-cover img\s*\{[\s\S]*?object-position: center center/);
  assert.match(homeStyles, /\.latest-card-body\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(homeStyles, /\.latest-card\s*\{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(homeStyles, /\.latest-card-content\s*\{[\s\S]*?align-self: center/);
  assert.match(homeStyles, /\.latest-card-read\s*\{[\s\S]*?justify-self: start/);
  assert.match(homeStyles, /\.latest-card-summary\s*\{[\s\S]*?-webkit-line-clamp: 4/);
  assert.match(homeStyles, /@media \(max-width: 760px\)/);
  assert.match(homeStyles, /\.hero-shell\s*\{[\s\S]*?display: flex;[\s\S]*?flex-direction: column/);
  assert.match(homeStyles, /\.latest-cards\s*\{ grid-template-columns: 1fr/);
  assert.match(homeStyles, /@media \(max-width: 760px\)[\s\S]*?\.latest-card-body\s*\{[\s\S]*?grid-template-columns: minmax\(84px, 30%\) minmax\(0, 1fr\)/);
  assert.match(homeStyles, /@media \(max-width: 760px\)[\s\S]*?\.latest-card-summary\s*\{[\s\S]*?-webkit-line-clamp: 3/);
  assert.doesNotMatch(polishStyles, /\.hero-art/);
  const heroAsset = await stat(new URL('../assets/snowshagal-hero.webp', import.meta.url));
  assert.ok(heroAsset.size > 0);
});

test('homepage keeps dynamic latest cards without restoring the old archive hero', async () => {
  const html = await read('index.html');
  assert.doesNotMatch(html, /class="intro-copy"/);
  assert.doesNotMatch(html, /INDEPENDENT ARCHIVE/);
  assert.doesNotMatch(html, /data-carousel/);
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
  assert.match(styles, /\.archive-layout\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(270px, 300px\)/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*?\.archive-layout\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);

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

test('homepage post metadata bypasses stale browser caches now and on later publishes', async () => {
  const [home, englishHome, admin, headers] = await Promise.all([
    read('index.html'),
    read('en/index.html'),
    read('admin/index.html'),
    read('_headers')
  ]);
  assert.match(home, /\/data\/posts\.js\?v=20260824-1/);
  assert.match(englishHome, /\/data\/posts\.js\?v=20260824-1/);
  assert.match(admin, /\.\.\/data\/posts\.js\?v=20260824-1/);
  assert.match(headers, /\/data\/posts\.js\s+Cache-Control: no-cache, no-store, must-revalidate/);
  assert.match(headers, /\/data\/posts\.json\s+Cache-Control: no-cache, no-store, must-revalidate/);
});

test('admin exposes an optional validated cover input', async () => {
  const [html, script] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /id="cover-file"/);
  assert.match(html, /image\/jpeg,image\/png,image\/webp/);
  assert.match(script, /4 \* 1024 \* 1024/);
  assert.match(script, /form\.append\('cover'/);
});
