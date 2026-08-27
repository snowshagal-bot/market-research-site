import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage presents the Snowshagal brand hero before latest reports and archive', async () => {
  const [html, englishHtml] = await Promise.all([read('index.html'), read('en/index.html')]);
  const order = [
    html.indexOf('class="site-header"'),
    html.indexOf('class="brand-hero"'),
    html.indexOf('class="today-strip"'),
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
  assert.match(html, /<footer[^>]*>[\s\S]*?<span[^>]*>SNOWSHAGAL<\/span>/);
  assert.doesNotMatch(html, /Independent Market Research/);
  assert.match(html, /home-v2\.css\?v=20260827-1/);
  assert.match(englishHtml, /home-v2\.css\?v=20260827-1/);
  assert.match(html, /locale\.js\?v=20260827-1/);
  assert.match(englishHtml, /locale\.js\?v=20260827-1/);
  assert.match(html, /site\.js\?v=20260827-1/);
  assert.match(englishHtml, /site\.js\?v=20260827-1/);
  assert.match(html, /market-summary\.js\?v=20260826-1/);
  assert.match(englishHtml, /market-summary\.js\?v=20260826-1/);
});

test('homepage serves a smaller eager hero asset on mobile without changing desktop art', async () => {
  const [html, englishHtml] = await Promise.all([read('index.html'), read('en/index.html')]);
  for (const source of [html, englishHtml]) {
    assert.match(source, /rel="preload" as="image" href="\/assets\/snowshagal-hero\.webp" media="\(min-width: 761px\)"/);
    assert.match(source, /rel="preload" as="image" href="\/assets\/snowshagal-hero-mobile\.webp" media="\(max-width: 760px\)"/);
    assert.match(source, /<picture>[\s\S]*?<source media="\(max-width: 760px\)" srcset="\/assets\/snowshagal-hero-mobile\.webp">[\s\S]*?<img src="\/assets\/snowshagal-hero\.webp"[^>]*fetchpriority="high">[\s\S]*?<\/picture>/);
    assert.doesNotMatch(source, /snowshagal-hero-mobile\.webp[^>]*loading="lazy"/);
  }
  const [desktopHero, mobileHero] = await Promise.all([
    stat(new URL('../assets/snowshagal-hero.webp', import.meta.url)),
    stat(new URL('../assets/snowshagal-hero-mobile.webp', import.meta.url))
  ]);
  assert.ok(desktopHero.size > mobileHero.size);
  assert.ok(mobileHero.size <= 150_000);
});

test('official Snowshagal owl branding replaces decorative sparkles without changing functional upload marks', async () => {
  const [home, englishHome, market, englishMarket, about, englishAbout, marketScript, marketStyles, adminMarket] = await Promise.all([
    read('index.html'),
    read('en/index.html'),
    read('market/index.html'),
    read('en/market/index.html'),
    read('about/index.html'),
    read('en/about/index.html'),
    read('assets/market-close.js'),
    read('assets/market-close.css'),
    read('admin/market/index.html')
  ]);

  for (const source of [home, englishHome, market, englishMarket, about, englishAbout]) {
    assert.match(source, /class="brand-owl" src="\/assets\/brand\/snowshagal-owl\.webp"/);
    assert.doesNotMatch(source, /class="brand-mark"|>✦</);
  }

  assert.match(marketScript, /class="market-state-owl" src="\/assets\/brand\/snowshagal-owl\.webp"/);
  assert.doesNotMatch(marketScript, /✦/);
  assert.match(marketStyles, /market-note::after\{content:""[\s\S]*?snowshagal-owl\.webp/);
  assert.doesNotMatch(marketStyles, /content:"✦"/);
  assert.match(adminMarket, /market-json-drop[\s\S]*?>✦<\/span>/);

  const [logoAsset, owlAsset] = await Promise.all([
    stat(new URL('../assets/brand/snowshagal-logo.webp', import.meta.url)),
    stat(new URL('../assets/brand/snowshagal-owl.webp', import.meta.url))
  ]);
  assert.ok(logoAsset.size > 0);
  assert.ok(owlAsset.size > 0);
});

test('desktop and mobile navigation use the approved category order across pages', async () => {
  const pages = [
    ['index.html', ['마켓', '데일리', '위클리', '리서치', '시장 공부', '끄적끄적']],
    ['en/index.html', ['Market', 'Daily', 'Weekly', 'Research', 'Market Basics', 'Notes']],
    ['market/index.html', ['마켓', '데일리', '위클리', '리서치', '시장 공부', '끄적끄적']],
    ['en/market/index.html', ['Market', 'Daily', 'Weekly', 'Research', 'Market Basics', 'Notes']],
    ['about/index.html', ['마켓', '데일리', '위클리', '리서치', '시장 공부', '끄적끄적']],
    ['en/about/index.html', ['Market', 'Daily', 'Weekly', 'Research', 'Market Basics', 'Notes']]
  ];

  for (const [path, expectedLabels] of pages) {
    const source = await read(path);
    const mainNav = source.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    const mainPositions = expectedLabels.map(label => mainNav.indexOf(`>${label}</a>`));
    assert.ok(mainPositions.every(position => position >= 0), `${path} main-nav is missing a requested label`);
    assert.deepEqual(mainPositions, [...mainPositions].sort((a, b) => a - b), `${path} main-nav order`);

    const quickNav = source.match(/<nav class="mobile-quick-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    const quickPositions = expectedLabels.map(label => quickNav.indexOf(`>${label}</a>`));
    assert.ok(quickPositions.every(position => position >= 0), `${path} mobile-quick-nav is missing a requested label`);
    assert.deepEqual(quickPositions, [...quickPositions].sort((a, b) => a - b), `${path} mobile-quick-nav order`);

    const mobileNav = source.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.equal(mobileNav, '', `${path} still contains obsolete mobile-nav`);
  }

  const [brandStyles, marketStyles, reportShell] = await Promise.all([
    read('assets/brand.css'),
    read('assets/market-close.css'),
    read('assets/report-shell.js')
  ]);
  assert.match(brandStyles, /\.main-nav\s*\{\s*font-size: 14px;/);
  assert.match(brandStyles, /@media \(max-width: 760px\)[\s\S]*?\.main-nav\s*\{\s*font-size: 13px;/);
  assert.match(marketStyles, /@media\(max-width:1060px\)\{\.market-close-page \.main-nav\{gap:12px;font-size:13px\}/);
  assert.match(reportShell, /a\{[\s\S]*?font-size:14px/);
  assert.match(reportShell, /@media\(max-width:680px\)[\s\S]*?font-size:12px/);
  assert.ok(reportShell.indexOf('<a href="${marketPath}">${copy.market}</a>') < reportShell.indexOf('?category=daily'));
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
  assert.match(script, /latest-card-title/);
  assert.match(script, /latest-card-copy/);
  assert.match(script, /latest-card-summary/);
  assert.match(script, /latest-card-read/);
  assert.match(script, /latest-card-meta[\s\S]*latest-card-title[\s\S]*latest-card-body[\s\S]*latest-card-copy[\s\S]*latest-card-read/);
  assert.match(script, /post\.title/);
  assert.doesNotMatch(script, /setInterval|autoplay|data-slide|buildCarousel/i);
  assert.match(homeStyles, /\.hero-shell\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(homeStyles, /\.hero-art img\s*\{[\s\S]*?object-fit: cover/);
  assert.match(homeStyles, /\.latest-card-cover img\s*\{[\s\S]*?object-position: center center/);
  assert.match(homeStyles, /\.latest-card-body\s*\{[\s\S]*?grid-template-columns:[\s\S]*?align-items: center/);
  assert.match(homeStyles, /\.latest-card-copy\s*\{[\s\S]*?flex-direction: column;[\s\S]*?align-self: center/);
  assert.match(homeStyles, /\.latest-card-read\s*\{[\s\S]*?margin-top: 12px/);
  assert.doesNotMatch(homeStyles, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
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
  assert.match(script, /archiveIndex\.innerHTML=listedTypes\.map/);
  assert.match(script, /href="\?category=\$\{encodeURIComponent\(type\)\}"/);
  assert.match(script, /counts\[type\]\|\|0/);
  assert.match(script, /const subtitle=post\.subtitle\?/);
  assert.match(script, /const filtered=localeApi\?\.sortPosts\(matched\)/);
  assert.doesNotMatch(script, /sortPostsByRegistration\(matched\)/);
  assert.match(script, /archiveOrderLabel\.textContent=messages\.reportOrder/);
  assert.match(html, /id="archive-order-label">리포트 기준일 최신순/);
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

test('public pages remove hamburger menu and expose horizontal swipe navigation with language pill and active reveal', async () => {
  const [home, enHome, market, enMarket, about, enAbout, siteCss, siteJs] = await Promise.all([
    read('index.html'),
    read('en/index.html'),
    read('market/index.html'),
    read('en/market/index.html'),
    read('about/index.html'),
    read('en/about/index.html'),
    read('assets/site.css'),
    read('assets/site.js')
  ]);

  const publicPages = [home, enHome, market, enMarket, about, enAbout];

  for (const page of publicPages) {
    // 1. No hamburger button or expanded mobile nav
    assert.doesNotMatch(page, /data-menu-toggle/);
    assert.doesNotMatch(page, /class="[^"]*mobile-nav[^"]*"/);

    // 2. Language pill present
    assert.match(page, /class="language-pill"/);

    // 3. Desktop main-nav intact
    assert.match(page, /<nav class="main-nav"[\s\S]*?<\/nav>/);

    // 4. Mobile quick nav has all 6 items
    assert.match(page, /<nav class="mobile-quick-nav"[\s\S]*?<\/nav>/);
  }

  // 5. CSS horizontal scrolling & scrollbar hidden
  assert.match(siteCss, /\.mobile-quick-nav\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(siteCss, /\.mobile-quick-nav\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(siteCss, /\.mobile-quick-nav\s*\{[\s\S]*?scrollbar-width:\s*none/);
  assert.match(siteCss, /\.mobile-quick-nav::-webkit-scrollbar\s*\{\s*display:\s*none/);

  // 6. Language pill styling
  assert.match(siteCss, /\.language-pill\s*\{[\s\S]*?min-width:\s*38px/);

  // 7. Active item initial reveal logic
  assert.match(siteJs, /function scrollActiveMobileNavIntoView\(\)/);
  assert.match(siteJs, /scrollActiveMobileNavIntoView\(\);/);
});

test('homepage presents TODAY market summary strip between brand hero and latest reports with mobile swipe', async () => {
  const [home, enHome, homeCss, siteJs, marketData] = await Promise.all([
    read('index.html'),
    read('en/index.html'),
    read('assets/home-v2.css'),
    read('assets/site.js'),
    read('data/market-summary.js')
  ]);

  // 1. Structure in both pages
  for (const page of [home, enHome]) {
    assert.match(page, /<section class="today-strip" aria-labelledby="today-strip-heading">/);
    assert.match(page, /class="today-strip-head"/);
    assert.match(page, /class="today-strip-eyebrow"/);
    assert.match(page, /class="today-strip-tag">TODAY<\/span>/);
    assert.match(page, /class="today-strip-market-link"/);
    assert.match(page, /class="today-strip-scroll-wrap"/);
    assert.match(page, /id="today-market-grid"/);
    assert.match(page, /class="today-takeaway-row" hidden>/);
    assert.match(page, /id="today-takeaway-link"/);
    assert.match(page, /id="today-takeaway-text"/);
  }

  // 2. Korean specifics
  assert.match(home, /href="\/market\/"/);
  assert.match(home, /class="today-takeaway-label" id="today-takeaway-label">오늘의 한 줄<\/span>/);
  assert.match(home, /id="today-takeaway-link" href="\/market\/">/);

  // 3. English specifics
  assert.match(enHome, /href="\/en\/market\/"/);
  assert.match(enHome, /class="today-takeaway-label" id="today-takeaway-label">Today's takeaway<\/span>/);
  assert.match(enHome, /id="today-takeaway-link" href="\/en\/market\/">/);

  // 4. 5 core indices in markup and data
  for (const sym of ['KOSPI', 'KOSDAQ', 'USD/KRW', 'US 10Y', 'GOLD']) {
    assert.match(home, new RegExp(`<span class="today-label">${sym.replace('/', '\\/')}</span>`));
    assert.match(marketData, new RegExp(`label:\\s*"${sym.replace('/', '\\/')}"`));
  }

  // 5. CSS Desktop & Mobile swipe
  assert.match(homeCss, /\.today-strip\s*\{/);
  assert.match(homeCss, /\.today-strip-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5,\s*1fr\)/);
  assert.match(homeCss, /\.today-strip-grid\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(homeCss, /\.today-strip-grid\s*\{[\s\S]*?scroll-snap-type:\s*x proximity/);
  assert.match(homeCss, /\.today-strip-scroll-wrap\s*\{[\s\S]*?mask-image:\s*linear-gradient/);

  // 6. JS dynamic renderer
  assert.match(siteJs, /function renderTodayMarket\(\)/);
  assert.match(siteJs, /renderTodayMarket\(\);/);

  // 7. Neutral first paint: the markup carries no past trading session at all.
  //    Values arrive only after /api/market/latest settles.
  for (const page of [home, enHome]) {
    assert.match(page, /id="today-strip-date">\u2014<\/span>/);
    assert.match(page, /id="today-market-grid" role="list" aria-busy="true"/);
    assert.equal((page.match(/<span class="today-value">\u2014<\/span>/g) || []).length, 5);
    assert.equal((page.match(/<span class="today-change pending">\u2014<\/span>/g) || []).length, 5);
    assert.match(page, /id="today-takeaway-text"><\/span>/);
    assert.doesNotMatch(page, /class="today-change (?:up|down)"/);
    assert.doesNotMatch(page, /today-takeaway-link" href="\/reports\//);
  }
  // The values the fallback file holds must not be pre-rendered anywhere.
  const summary = JSON.parse(marketData.slice(marketData.indexOf('{'), marketData.lastIndexOf('}') + 1)
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":'));
  for (const item of summary.items) {
    assert.doesNotMatch(home, new RegExp(item.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(enHome, new RegExp(item.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(home, new RegExp(summary.takeaway.ko.slice(0, 12)));
  assert.doesNotMatch(enHome, new RegExp(summary.takeaway.en.slice(0, 20)));
  assert.doesNotMatch(home, new RegExp(summary.dateDisplay.ko));
  assert.doesNotMatch(enHome, new RegExp(summary.dateDisplay.en));
});

