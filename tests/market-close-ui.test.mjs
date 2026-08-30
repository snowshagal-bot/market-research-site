import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function marketRuntime(lang = 'ko') {
  const script = await read('assets/market-close.js');
  const document = {
    documentElement: { dataset: { siteLang: lang } },
    body: { dataset: {} },
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(script, context);
  return window.MARKET_CLOSE;
}

test('authoritative Market Close contract copies remain internally consistent', async () => {
  const [contract, schemaText, exampleText] = await Promise.all([
    read('contracts/market_close/MARKET_DATA_CONTRACT.md'),
    read('contracts/market_close/market_close.schema.json'),
    read('contracts/market_close/market_close.example.json')
  ]);
  const schema = JSON.parse(schemaText);
  const example = JSON.parse(exampleText);
  assert.equal(example.meta.schema_version, '1.1.0');
  assert.equal(example.meta.status, 'final');
  assert.equal(example.validation.passed, true);
  assert.deepEqual(example.validation.errors, []);
  assert.deepEqual(schema.properties.meta.properties.schema_version.enum, ['1.0.1', '1.1.0']);
  assert.equal(example.krx_groups.sectors.length, 46);
  assert.equal(example.krx_groups.themes.length, 39);
  assert.match(contract, /schema_version/);
});

test('KO and EN Market pages use only the public latest API at runtime', async () => {
  const [ko, en] = await Promise.all([read('market/index.html'), read('en/market/index.html')]);
  for (const page of [ko, en]) {
    assert.match(page, /data-market-source="\/api\/market\/latest"/);
    assert.doesNotMatch(page, /data-market-source="[^\"]*example\.json"/);
    assert.match(page, /data-market-preview-fixture="\/contracts\/market_close\/market_close\.example\.json"/);
    assert.match(page, /src="\/assets\/market-close\.js/);
    assert.match(page, /href="\/assets\/market-close\.css/);
    assert.match(page, /href="\/about\/">소개<\/a>|href="\/en\/about\/">About<\/a>/);
    assert.doesNotMatch(page, /LME|chart\.js|highcharts|plotly/i);
  }
  assert.match(ko, /href="\/market\/" aria-current="page">마켓<\/a>/);
  assert.match(en, /href="\/en\/market\/" aria-current="page">Market<\/a>/);
});

test('Market renderer distinguishes loading, empty, and retryable error states', async () => {
  const [ko, en, script] = await Promise.all([read('market/index.html'), read('en/market/index.html'), read('assets/market-close.js')]);
  assert.match(ko, /class="market-loading" role="status"/);
  assert.match(en, /class="market-loading" role="status"/);
  assert.match(script, /response\.status === 404/);
  assert.match(script, /function renderEmpty/);
  assert.match(script, /class="market-retry"/);
  assert.match(script, /addEventListener\('click', init/);
  assert.match(script, /pages\\\.dev/);
  assert.match(script, /localhost\|127\\\.0\\\.0\\\.1/);
  assert.match(script, /market-preview-notice/);
  assert.doesNotMatch(script, /snowshagal\.com.*example\.json/);
});

test('Market renderer covers every contract section without inventing an intraday chart', async () => {
  const script = await read('assets/market-close.js');
  for (const token of ['indices', 'rates_fx_volatility', 'commodities_crypto', 'krx_investor_trading', 'recent_5d_flows', 'market_breadth', 'program_basis', 'market_internals', 'short_selling', 'market_cap_top10']) {
    assert.match(script, new RegExp(token));
  }
  assert.match(script, /ratioPct/);
  assert.match(script, /value \* 1e9/);
  assert.match(script, /data_state === 'intraday'/);
  assert.match(script, /key === 'USDKRW' \|\| key === 'JPYKRW'/);
  assert.doesNotMatch(script, /LME|canvas|getContext|chart\.js|highcharts|plotly/i);
});

test('KRX flow values keep the Contract KRW billion unit', async () => {
  const [ko, en] = await Promise.all([marketRuntime('ko'), marketRuntime('en')]);
  assert.equal(ko.format.flow(-3676), '−3.68조원');
  assert.equal(ko.format.flow(242), '+2,420억원');
  assert.equal(ko.format.flow(25), '+250억원');
  assert.equal(ko.format.flow(-118), '−1,180억원');
  assert.equal(en.format.flow(-3676), 'KRW −3.68tn');
  assert.equal(en.format.flow(242), 'KRW +242bn');
  assert.equal(en.format.flow(25), 'KRW +25bn');
});

test('FX close/current and US10Y basis-point changes render without mixing value bases', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  for (const lang of ['ko', 'en']) {
    const runtime = await marketRuntime(lang);
    const target = { innerHTML: '' };
    runtime.render(data, target);
    assert.match(target.innerHTML, lang === 'ko' ? /1,372\.50원[\s\S]*15:30 확정[\s\S]*현재[\s\S]*1,372\.65원[\s\S]*▼ 7\.95/ : /₩1,372\.50[\s\S]*15:30 close[\s\S]*Latest[\s\S]*₩1,372\.65[\s\S]*▼ 7\.95/);
    assert.match(target.innerHTML, lang === 'ko' ? /860\.64원[\s\S]*15:30 확정[\s\S]*현재[\s\S]*858\.40원[\s\S]*▼ 7\.99/ : /₩860\.64[\s\S]*15:30 close[\s\S]*Latest[\s\S]*₩858\.40[\s\S]*▼ 7\.99/);
    assert.match(target.innerHTML, /4\.672%[\s\S]*▲ 0\.8bp/);
    assert.doesNotMatch(target.innerHTML, /4\.6bp[\s\S]{0,40}\(-0\.97%\)/);
  }
});

test('flow concentration renders TOP1 and TOP5 together', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const runtime = await marketRuntime('en');
  const target = { innerHTML: '' };
  runtime.render(data, target);
  assert.match(target.innerHTML, /TOP1 20\.6% · TOP5 38\.4%/);
  assert.match(target.innerHTML, /TOP1 31\.2% · TOP5 72\.5%/);
});

test('English company resolver covers every fixture ticker and never leaks Korean company names', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const en = await marketRuntime('en');
  const expected = new Map([
    ['005930', 'Samsung Electronics'], ['000660', 'SK hynix'], ['005935', 'Samsung Electronics Pref.'], ['402340', 'SK Square'],
    ['009150', 'Samsung Electro-Mechanics'], ['005380', 'Hyundai Motor'], ['373220', 'LG Energy Solution'], ['207940', 'Samsung Biologics'],
    ['028260', 'Samsung C&T'], ['105560', 'KB Financial Group'], ['042700', 'Hanmi Semiconductor'], ['047810', 'Korea Aerospace Industries'],
    ['095570', 'AJ Networks'], ['095340', 'ISC'], ['013890', 'Zinus'], ['035420', 'NAVER'],
    ['012750', '012750'], ['032830', '032830'], ['056190', 'SFA'], ['330590', '330590']
  ]);
  const companies = [
    ...data.market_cap_top10,
    ...data.short_selling.top5_by_value,
    ...data.short_selling.top5_by_ratio,
    ...Object.values(data.market_internals.concentration).flatMap(side => Object.values(side))
  ];
  for (const item of companies) {
    const ticker = item.ticker || item.top_ticker;
    assert.equal(en.companyName(item), expected.get(ticker), `missing English company name for ${ticker}`);
    assert.doesNotMatch(en.companyName(item), /[\u3131-\u318e\uac00-\ud7a3]/);
  }
  assert.equal(en.companyName({ ticker: '123456', name: '미등록회사' }), '123456');
});

test('Market layout explicitly supports dark mode, compact mobile widths, and responsive hero assets', async () => {
  const [css, koPage, enPage] = await Promise.all([
    read('assets/market-close.css'),
    read('market/index.html'),
    read('en/market/index.html')
  ]);
  assert.match(css, /html\[data-theme="dark"\] \.market-close-page/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /@media\(max-width:360px\)/);
  assert.match(css, /body\.market-close-page:has\(\.market-loading\)>\.footer\{visibility:hidden\}/);
  assert.match(css, /market-close-mountain\.webp/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?market-close-mountain-mobile\.webp/);
  assert.doesNotMatch(css, /market-close-mountain\.png/);
  for (const page of [koPage, enPage]) {
    assert.match(page, /rel="preload" as="image" href="\/assets\/market-close-mountain\.webp" media="\(min-width: 761px\)"/);
    assert.match(page, /rel="preload" as="image" href="\/assets\/market-close-mountain-mobile\.webp" media="\(max-width: 760px\)"/);
  }
  const [desktopHero, mobileHero] = await Promise.all([
    stat(new URL('../assets/market-close-mountain.webp', import.meta.url)),
    stat(new URL('../assets/market-close-mountain-mobile.webp', import.meta.url))
  ]);
  assert.ok(desktopHero.size <= 300_000);
  assert.ok(mobileHero.size <= 150_000);
});

test('locale switch preserves Market routes and date query parameters', async () => {
  const localeScript = await read('assets/locale.js');
  const window = {};
  const context = vm.createContext({ window, Intl, Date, Set, URLSearchParams });
  vm.runInContext(localeScript, context);
  const localeApi = window.MARKET_LOCALE;

  assert.equal(localeApi.pageLanguagePath('/market/', 'en', ''), '/en/market/');
  assert.equal(localeApi.pageLanguagePath('/en/market/', 'ko', ''), '/market/');
  assert.equal(localeApi.pageLanguagePath('/market/', 'en', '?date=2026-08-27'), '/en/market/?date=2026-08-27');
  assert.equal(localeApi.pageLanguagePath('/en/market/', 'ko', '?date=2026-08-27'), '/market/?date=2026-08-27');
});

test('Market History UI renders navigation strip, previous/next trading days, and calendar drawer', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const runtime = await marketRuntime('ko');
  runtime.state.dates = ['2026-08-28', '2026-08-27', '2026-08-26'];
  runtime.state.latestDate = '2026-08-28';
  runtime.state.earliestDate = '2026-08-26';

  const target = { innerHTML: '', addEventListener() {} };
  runtime.render(data, target);

  assert.match(target.innerHTML, /class="market-history-strip"/);
  assert.match(target.innerHTML, /data-market-action="today"/);
  assert.match(target.innerHTML, /data-market-action="toggle-calendar"/);
  assert.match(target.innerHTML, /class="market-calendar-drawer"/);
  assert.match(target.innerHTML, /class="market-calendar-panel"/);
  assert.match(target.innerHTML, /class="market-cal-weekday"/);
  assert.match(target.innerHTML, /data-target-date="2026-08-27"/);
});

test('findExactDaily strictly matches post.reportDate and locale with zero fallback to latest daily', async () => {
  const script = await read('assets/market-close.js');
  const mockPosts = [
    { type: 'daily', reportDate: '2026-08-28', lang: 'ko', href: 'reports/daily-0828.html', title: '8/28 Daily KO' },
    { type: 'daily', reportDate: '2026-08-28', lang: 'en', href: 'reports/en/daily-0828.html', title: '8/28 Daily EN' },
    { type: 'daily', reportDate: '2026-08-26', lang: 'ko', href: 'reports/daily-0826.html', title: '8/26 Daily KO' }
  ];

  const window = { RESEARCH_POSTS: mockPosts };
  const document = {
    documentElement: { dataset: { siteLang: 'ko' } },
    body: { dataset: {} },
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(script, context);
  const runtime = window.MARKET_CLOSE;

  // 1. Exact match on 2026-08-28
  const daily0828 = runtime.findExactDaily('2026-08-28');
  assert.ok(daily0828);
  assert.equal(daily0828.reportDate, '2026-08-28');
  assert.equal(daily0828.lang, 'ko');

  // 2. Exact match on 2026-08-26
  const daily0826 = runtime.findExactDaily('2026-08-26');
  assert.ok(daily0826);
  assert.equal(daily0826.reportDate, '2026-08-26');

  // 3. No match on 2026-08-27 -> MUST be null, NEVER fallback to 0828
  const daily0827 = runtime.findExactDaily('2026-08-27');
  assert.equal(daily0827, null, 'Must NOT fallback to latest daily when date is missing');

  // 4. Render CTA behavior on historical date with vs without Daily
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  runtime.state.latestDate = '2026-08-28';

  // Render on 2026-08-26 (historical date with matching daily)
  const d26 = JSON.parse(JSON.stringify(data));
  d26.meta.market_date = '2026-08-26';
  const targetWithDaily = { innerHTML: '', addEventListener() {} };
  runtime.render(d26, targetWithDaily);
  assert.match(targetWithDaily.innerHTML, /이날의 데일리 리포트 보기/);
  assert.match(targetWithDaily.innerHTML, /reports\/daily-0826\.html/);

  // Render on 2026-08-27 (historical date without matching daily)
  const d27 = JSON.parse(JSON.stringify(data));
  d27.meta.market_date = '2026-08-27';
  const targetWithoutDaily = { innerHTML: '', addEventListener() {} };
  runtime.render(d27, targetWithoutDaily);
  assert.match(targetWithoutDaily.innerHTML, /이날 발행된 데일리 리포트가 없습니다\./);
  assert.doesNotMatch(targetWithoutDaily.innerHTML, /reports\/daily-0828\.html/);
});

test('public pages keep mobile navigation elements outside header-row', async () => {
  function extractDivContent(html, pattern) {
    const match = html.match(pattern);
    if (!match) return null;
    const startIdx = match.index + match[0].length;
    let depth = 1;
    let cursor = startIdx;
    while (depth > 0 && cursor < html.length) {
      const nextOpen = html.indexOf('<div', cursor);
      const nextClose = html.indexOf('</div>', cursor);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        cursor = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) return html.slice(startIdx, nextClose);
        cursor = nextClose + 6;
      }
    }
    return null;
  }

  const pages = [
    'index.html',
    'en/index.html',
    'about/index.html',
    'en/about/index.html',
    'market/index.html',
    'en/market/index.html'
  ];

  for (const pagePath of pages) {
    const html = await read(pagePath);
    const headerRow = extractDivContent(html, /<div[^>]*class="[^"]*header-row[^"]*"[^>]*>/);
    assert.ok(headerRow, `header-row not found in ${pagePath}`);
    assert.doesNotMatch(
      headerRow,
      /class="[^"]*mobile-quick-nav[^"]*"/,
      `mobile-quick-nav is improperly nested inside header-row in ${pagePath}`
    );
    assert.doesNotMatch(
      headerRow,
      /class="[^"]*mobile-nav[^"]*"/,
      `mobile-nav is improperly nested inside header-row in ${pagePath}`
    );
  }
});
