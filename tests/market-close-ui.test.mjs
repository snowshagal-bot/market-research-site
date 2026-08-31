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
  assert.match(script, /data-market-action="retry"/);
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

test('retry click triggers init/load exactly once without duplicate calls', async () => {
  const script = await read('assets/market-close.js');
  let fetchCount = 0;
  const mockFetch = async (url) => {
    fetchCount++;
    if (url.includes('/api/market/dates')) {
      return { ok: true, json: async () => ({ dates: ['2026-08-28'], latest: '2026-08-28', earliest: '2026-08-28' }) };
    }
    return { ok: true, json: async () => JSON.parse(await read('contracts/market_close/market_close.example.json')) };
  };

  let rootClickListener = null;
  const rootElement = {
    id: 'market-close-root',
    innerHTML: '',
    addEventListener(event, handler) {
      if (event === 'click') rootClickListener = handler;
    },
    removeEventListener() {}
  };

  const document = {
    documentElement: { dataset: { siteLang: 'ko' } },
    body: { dataset: {} },
    readyState: 'complete',
    getElementById(id) {
      if (id === 'market-close-root') return rootElement;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };

  const windowListeners = new Map();
  const window = {
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (windowListeners.has(type)) windowListeners.get(type).delete(listener);
    }
  };

  const context = vm.createContext({
    window,
    document,
    location: { pathname: '/market/', search: '', hostname: 'localhost' },
    fetch: mockFetch,
    Intl,
    Date,
    Set,
    URLSearchParams,
    console
  });
  vm.runInContext(script, context);
  const runtime = window.MARKET_CLOSE;
  await runtime.init();

  assert.ok(rootClickListener, 'click listener should be bound to root');
  const initialFetches = fetchCount;

  // Simulate clicking retry
  const retryEvent = {
    target: {
      closest(sel) {
        if (sel === '[data-market-action]') return { dataset: { marketAction: 'retry' } };
        return null;
      }
    }
  };

  await rootClickListener(retryEvent);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(fetchCount - initialFetches, 2, 'Retry click should trigger exactly 1 init sequence (dates + latest)');
});

test('repeated retries do not accumulate popstate listeners and popstate triggers load exactly once', async () => {
  const script = await read('assets/market-close.js');
  let fetchCount = 0;
  const mockFetch = async (url) => {
    fetchCount++;
    if (url.includes('/api/market/dates')) {
      return { ok: true, json: async () => ({ dates: ['2026-08-28'], latest: '2026-08-28', earliest: '2026-08-28' }) };
    }
    return { ok: true, json: async () => JSON.parse(await read('contracts/market_close/market_close.example.json')) };
  };

  let rootClickListener = null;
  const rootElement = {
    id: 'market-close-root',
    innerHTML: '',
    addEventListener(event, handler) {
      if (event === 'click') rootClickListener = handler;
    },
    removeEventListener() {}
  };

  const document = {
    documentElement: { dataset: { siteLang: 'ko' } },
    body: { dataset: {} },
    readyState: 'complete',
    getElementById(id) {
      if (id === 'market-close-root') return rootElement;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };

  const windowListeners = new Map();
  const window = {
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (windowListeners.has(type)) windowListeners.get(type).delete(listener);
    }
  };

  const location = { pathname: '/market/', search: '', hostname: 'localhost' };
  const context = vm.createContext({
    window,
    document,
    location,
    fetch: mockFetch,
    Intl,
    Date,
    Set,
    URLSearchParams,
    console
  });
  vm.runInContext(script, context);
  const runtime = window.MARKET_CLOSE;

  // Call init 5 times (simulating 5 repeated retries)
  for (let i = 0; i < 5; i++) {
    await runtime.init();
  }

  // Exactly 1 popstate listener registered
  const popstateListeners = windowListeners.get('popstate') || new Set();
  assert.equal(popstateListeners.size, 1, 'Exactly one popstate listener must remain registered');

  // Trigger popstate event once
  const fetchesBeforePopstate = fetchCount;
  location.search = '?date=2026-08-27';
  for (const listener of popstateListeners) {
    listener();
  }
  await new Promise(r => setImmediate(r));

  // Exactly 1 loadAndRender triggered (1 fetch for /api/market/date?date=2026-08-27)
  assert.equal(fetchCount - fetchesBeforePopstate, 1, 'Popstate must trigger exactly 1 load call without duplicate execution');
});

test('URL state parsing prioritizes date over view and handles invalid combinations', async () => {
  const script = await read('assets/market-close.js');

  function parseFor(search) {
    const window = {};
    const context = vm.createContext({
      window,
      document: { documentElement: { dataset: { siteLang: 'ko' } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
      location: { search, pathname: '/market/' },
      Intl, Date, Set, URLSearchParams, console
    });
    vm.runInContext(script, context);
    const res = window.MARKET_CLOSE.parseUrlState();
    return { mode: res.mode, date: res.date, view: res.view };
  }

  assert.deepEqual(parseFor(''), { mode: 'today', date: null, view: null });
  assert.deepEqual(parseFor('?view=1w'), { mode: '1w', date: null, view: '1w' });
  assert.deepEqual(parseFor('?view=1m'), { mode: '1m', date: null, view: '1m' });
  assert.deepEqual(parseFor('?date=2026-08-27'), { mode: 'history', date: '2026-08-27', view: null });
  assert.deepEqual(parseFor('?date=2026-08-27&view=1w'), { mode: 'history', date: '2026-08-27', view: null });
  assert.deepEqual(parseFor('?view=invalid'), { mode: 'today', date: null, view: null });
});

test('locale.js preserves date and view queries across language transitions', async () => {
  const script = await read('assets/locale.js');
  const window = {};
  const context = vm.createContext({ window, Intl, Date, Set, URLSearchParams, console });
  vm.runInContext(script, context);
  const localeApi = window.MARKET_LOCALE;

  // 1W query preservation
  assert.equal(localeApi.pageLanguagePath('/market/', 'en', '?view=1w'), '/en/market/?view=1w');
  assert.equal(localeApi.pageLanguagePath('/en/market/', 'ko', '?view=1w'), '/market/?view=1w');

  // 1M query preservation
  assert.equal(localeApi.pageLanguagePath('/market/', 'en', '?view=1m'), '/en/market/?view=1m');
  assert.equal(localeApi.pageLanguagePath('/en/market/', 'ko', '?view=1m'), '/market/?view=1m');

  // Date query preservation
  assert.equal(localeApi.pageLanguagePath('/market/', 'en', '?date=2026-08-27'), '/en/market/?date=2026-08-27');
  assert.equal(localeApi.pageLanguagePath('/en/market/', 'ko', '?date=2026-08-27'), '/market/?date=2026-08-27');

  // Base market without queries
  assert.equal(localeApi.pageLanguagePath('/market/', 'en', ''), '/en/market/');
  assert.equal(localeApi.pageLanguagePath('/en/market/', 'ko', ''), '/market/');
});

test('renderRangeView formats complete vs incomplete windows, instruments, rates, flows and breadth', async () => {
  const script = await read('assets/market-close.js');

  const partialPayload = {
    aggregation_version: '1.0.0',
    period: '1w',
    window: {
      start_date: '2026-08-25',
      end_date: '2026-08-28',
      dates: ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'],
      sessions_used: 4,
      required_sessions: 5,
      complete: false
    },
    instruments: {
      indices: {
        KOSPI: { baseline_value: 6696.96, end_value: 6788.88, return_pct: 1.37, period_high: 6996.12, period_low: 6408.82, observations: 4, complete: false }
      },
      rates_fx_volatility: {
        SOX: { baseline_value: 11500, end_value: 11882.17, return_pct: 3.32, observations: 4, complete: false },
        US10Y: { baseline_value: 4.60, end_value: 4.72, change_bp: 12.0, return_pct: 2.61, observations: 4, complete: false },
        USDKRW: { baseline_value: 1370.0, end_value: 1380.0, change: 10.0, return_pct: 0.73, observations: 4, complete: false }
      },
      commodities_crypto: {
        WTI: { baseline_value: 75.0, end_value: 77.25, return_pct: 3.0, observations: 4, complete: false }
      }
    },
    flows: {
      unit: 'KRW billion',
      sessions_used: 4,
      markets: {
        KOSPI: {
          외국인: { net_buy: -5551, observations: 4, complete: false },
          기관: { net_buy: 1200, observations: 4, complete: false },
          개인: { net_buy: 4351, observations: 4, complete: false }
        }
      }
    },
    breadth: {
      KOSPI: {
        avg_rise_ratio: 0.603,
        avg_fall_ratio: 0.352,
        avg_rise_count: 548,
        avg_fall_count: 320,
        advancer_dominant_sessions: 3,
        decliner_dominant_sessions: 1,
        neutral_sessions: 0,
        observations: 4,
        complete: false
      }
    },
    krx_groups: {
      sessions_with_data: 0,
      sessions_used: 4,
      coverage_complete: false,
      sectors: [],
      themes: []
    }
  };

  for (const lang of ['ko', 'en']) {
    const window = {};
    const context = vm.createContext({
      window,
      document: { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
      location: { search: '?view=1w', pathname: '/market/' },
      Intl, Date, Set, URLSearchParams, console
    });
    vm.runInContext(script, context);
    const runtime = window.MARKET_CLOSE;

    const target = { innerHTML: '', addEventListener() {} };
    runtime.renderRangeView(partialPayload, '1w', target);
    const html = target.innerHTML;

    // Window partial status
    assert.match(html, lang === 'ko' ? /현재 누적 · 4 \/ 5 거래일/ : /Partial · 4 \/ 5 sessions/);
    assert.match(html, lang === 'ko' ? /최근 5거래일/ : /Last 5 Sessions/);

    // KOSPI index & SOX
    assert.match(html, /6,696\.96/);
    assert.match(html, /6,788\.88/);
    assert.match(html, /\+1\.37%/);
    assert.match(html, /11,882\.17/);

    // Rates US10Y bp
    assert.match(html, /\+12\.0bp/);
    assert.match(html, /4\.600%[\s\S]*→[\s\S]*4\.720%/);

    // FX USDKRW
    assert.match(html, /\+10\.00/);

    // Money flows
    assert.match(html, lang === 'ko' ? /−5\.55조원/ : /KRW −5\.55tn/);

    // Breadth
    assert.match(html, /60\.3%/);
    assert.match(html, /35\.2%/);
    assert.match(html, lang === 'ko' ? /3일/ : /3 sessions/);

    // Groups incomplete empty state
    assert.match(html, /market-group-empty/);
    assert.match(html, lang === 'ko' ? /업종 · 테마 기간 데이터 축적 중/ : /Sector & theme history is building/);
  }
});

test('renderRangeFlows suppresses numeric sum when observations are less than sessions_used', async () => {
  const script = await read('assets/market-close.js');
  const window = {};
  const context = vm.createContext({
    window,
    document: { documentElement: { dataset: { siteLang: 'ko' } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    location: { search: '?view=1w', pathname: '/market/' },
    Intl, Date, Set, URLSearchParams, console
  });
  vm.runInContext(script, context);
  const runtime = window.MARKET_CLOSE;

  const payload = {
    aggregation_version: '1.0.0',
    period: '1w',
    window: { start_date: '2026-08-25', end_date: '2026-08-28', dates: ['2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'], sessions_used: 4, required_sessions: 5, complete: false },
    instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} },
    flows: {
      unit: 'KRW billion',
      sessions_used: 4,
      markets: {
        KOSPI: {
          외국인: { net_buy: -5551, observations: 4, complete: false },
          기관: { net_buy: 1200, observations: 3, complete: false },
          개인: { net_buy: 4351, observations: 4, complete: false }
        }
      }
    },
    breadth: {},
    krx_groups: { sessions_with_data: 0, sessions_used: 4, coverage_complete: false, sectors: [], themes: [] }
  };

  const target = { innerHTML: '', addEventListener() {} };
  runtime.renderRangeView(payload, '1w', target);
  const html = target.innerHTML;

  assert.match(html, /−5\.55조원/, 'foreign with 4/4 observations in 4-session window is rendered');
  assert.match(html, /<td>--<\/td>/, 'institution with 3/4 observations in 4-session window is hidden as --');
});

test('history strip active states and aria-current reflect calendar open and history mode', async () => {
  const script = await read('assets/market-close.js');
  const window = {};
  const context = vm.createContext({
    window,
    document: { documentElement: { dataset: { siteLang: 'ko' } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    location: { search: '?view=1w', pathname: '/market/' },
    Intl, Date, Set, URLSearchParams, console
  });
  vm.runInContext(script, context);
  const runtime = window.MARKET_CLOSE;

  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));

  // 1. In 1W mode, calendar closed
  runtime.state.mode = '1w';
  runtime.state.calendarOpen = false;
  const target1 = { innerHTML: '', addEventListener() {} };
  runtime.renderRangeView({ aggregation_version: '1.0.0', period: '1w', window: { sessions_used: 4, required_sessions: 5 }, instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} }, flows: { markets: {} }, breadth: {}, krx_groups: { coverage_complete: false } }, '1w', target1);
  assert.match(target1.innerHTML, /class="market-mode-btn active" type="button" data-market-action="view-1w" aria-current="page">1W/);
  assert.doesNotMatch(target1.innerHTML, /class="market-mode-btn active" type="button" data-market-action="toggle-calendar"/);

  // 2. In 1W mode, calendar OPEN -> 1W inactive, HISTORY active
  runtime.state.mode = '1w';
  runtime.state.calendarOpen = true;
  const target2 = { innerHTML: '', addEventListener() {} };
  runtime.renderRangeView({ aggregation_version: '1.0.0', period: '1w', window: { sessions_used: 4, required_sessions: 5 }, instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} }, flows: { markets: {} }, breadth: {}, krx_groups: { coverage_complete: false } }, '1w', target2);
  assert.doesNotMatch(target2.innerHTML, /class="market-mode-btn active" type="button" data-market-action="view-1w"/);
  assert.match(target2.innerHTML, /class="market-mode-btn active" type="button" data-market-action="toggle-calendar" aria-expanded="true"/);

  // 3. In HISTORY mode (date selected) -> HISTORY has aria-current="page"
  runtime.state.mode = 'history';
  runtime.state.currentDate = '2026-08-27';
  runtime.state.calendarOpen = false;
  const target3 = { innerHTML: '', addEventListener() {} };
  runtime.render(data, target3);
  assert.match(target3.innerHTML, /class="market-mode-btn active" type="button" data-market-action="toggle-calendar" aria-expanded="false" aria-current="page"/);
});

test('renderRangeView with complete coverage renders strongest and weakest sector/theme rankings', async () => {
  const script = await read('assets/market-close.js');

  const completePayload = {
    aggregation_version: '1.0.0',
    period: '1w',
    window: {
      start_date: '2026-08-24',
      end_date: '2026-08-28',
      dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'],
      sessions_used: 5,
      required_sessions: 5,
      complete: true
    },
    instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} },
    flows: { markets: {} },
    breadth: {},
    krx_groups: {
      sessions_with_data: 5,
      sessions_used: 5,
      coverage_complete: true,
      sectors: [
        { index_code: 'KGS01', name: '화학', market: 'KOSPI', return_pct: 4.5, complete: true },
        { index_code: 'KGS02', name: '반도체', market: 'KOSPI', return_pct: 3.2, complete: true },
        { index_code: 'KGS03', name: '건설', market: 'KOSPI', return_pct: -2.8, complete: true },
        { index_code: 'KGS04', name: '불완전업종', market: 'KOSPI', return_pct: 5.0, complete: false } // must be excluded
      ],
      themes: [
        { index_code: 'KT01', name: '2차전지', return_pct: 6.1, complete: true },
        { index_code: 'KT02', name: '바이오', return_pct: -3.5, complete: true }
      ]
    }
  };

  const window = {};
  const context = vm.createContext({
    window,
    document: { documentElement: { dataset: { siteLang: 'ko' } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    location: { search: '?view=1w', pathname: '/market/' },
    Intl, Date, Set, URLSearchParams, console
  });
  vm.runInContext(script, context);
  const runtime = window.MARKET_CLOSE;

  const target = { innerHTML: '', addEventListener() {} };
  runtime.renderRangeView(completePayload, '1w', target);
  const html = target.innerHTML;

  assert.match(html, /5거래일 기준/);
  assert.match(html, /range-groups-grid/);
  assert.match(html, /화학/);
  assert.match(html, /\+4\.50%/);
  assert.match(html, /건설/);
  assert.match(html, /−2\.80%/);
  assert.match(html, /2차전지/);
  assert.doesNotMatch(html, /불완전업종/, 'Incomplete sector must not be included in ranking');
});

test('toggle-calendar click dynamically switches active state from 1W to HISTORY and back on close', async () => {
  const script = await read('assets/market-close.js');

  class ClassList {
    constructor() { this.classes = new Set(); }
    toggle(cls, force) {
      if (force === undefined) {
        if (this.classes.has(cls)) this.classes.delete(cls);
        else this.classes.add(cls);
      } else if (force) {
        this.classes.add(cls);
      } else {
        this.classes.delete(cls);
      }
    }
    contains(cls) { return this.classes.has(cls); }
  }

  const modeButtons = [
    { dataset: { marketAction: 'today' }, classList: new ClassList(), setAttribute() {} },
    { dataset: { marketAction: 'view-1w' }, classList: new ClassList(), setAttribute() {} },
    { dataset: { marketAction: 'view-1m' }, classList: new ClassList(), setAttribute() {} },
    { dataset: { marketAction: 'toggle-calendar' }, classList: new ClassList(), setAttribute() {} }
  ];

  let rootClickListener = null;
  const drawerEl = { hidden: true, innerHTML: '' };
  const toggleBtn = { classList: new ClassList(), setAttribute() {} };
  const rootElement = {
    id: 'market-close-root',
    innerHTML: '',
    addEventListener(event, handler) {
      if (event === 'click') rootClickListener = handler;
    }
  };

  const document = {
    documentElement: { dataset: { siteLang: 'ko' } },
    body: { dataset: {} },
    readyState: 'complete',
    getElementById(id) {
      if (id === 'market-close-root') return rootElement;
      if (id === 'market-calendar-drawer') return drawerEl;
      return null;
    },
    querySelector(sel) {
      if (sel === '.market-calendar-toggle') return toggleBtn;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '.market-history-modes .market-mode-btn') return modeButtons;
      return [];
    },
    addEventListener() {}
  };

  const window = {};
  const context = vm.createContext({
    window,
    document,
    location: { pathname: '/market/', search: '?view=1w', hostname: 'localhost' },
    fetch: async () => ({ ok: true, json: async () => ({ dates: ['2026-08-28'] }) }),
    Intl, Date, Set, URLSearchParams, console
  });
  vm.runInContext(script, context);
  const runtime = window.MARKET_CLOSE;

  // Initialize in 1W mode
  runtime.state.mode = '1w';
  runtime.state.calendarOpen = false;
  runtime.renderRangeView({ aggregation_version: '1.0.0', period: '1w', window: { sessions_used: 4, required_sessions: 5 }, instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} }, flows: { markets: {} }, breadth: {}, krx_groups: { coverage_complete: false } }, '1w', rootElement);
  modeButtons[1].classList.toggle('active', true);

  // 1. Simulate clicking toggle-calendar
  const clickToggleEvent = {
    target: {
      closest(sel) {
        if (sel === '[data-market-action]') return { dataset: { marketAction: 'toggle-calendar' } };
        return null;
      }
    }
  };

  await rootClickListener(clickToggleEvent);

  // Check state & classes after open
  assert.equal(runtime.state.calendarOpen, true, 'calendar must be open');
  assert.equal(modeButtons[1].classList.contains('active'), false, '1W must be inactive when calendar is open');
  assert.equal(modeButtons[3].classList.contains('active'), true, 'HISTORY must be active when calendar is open');

  // 2. Click toggle-calendar again to close
  await rootClickListener(clickToggleEvent);

  assert.equal(runtime.state.calendarOpen, false, 'calendar must be closed');
  assert.equal(modeButtons[1].classList.contains('active'), true, '1W must be restored to active when calendar is closed');
  assert.equal(modeButtons[3].classList.contains('active'), false, 'HISTORY must be inactive when calendar is closed in 1W mode');
});

test('Market hero renders the update timestamp notice across TODAY, 1W, 1M, and HISTORY in KO and EN', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const [koRuntime, enRuntime, css] = await Promise.all([
    marketRuntime('ko'),
    marketRuntime('en'),
    read('assets/market-close.css')
  ]);

  // 1. KO TODAY
  const koTodayTarget = { innerHTML: '', addEventListener() {} };
  koRuntime.render(data, koTodayTarget);
  assert.match(
    koTodayTarget.innerHTML,
    /<p class="market-date">2026\.08\.28 · 15:30 KST 마감 기준<\/p>\s*<p class="market-update">데이터 업데이트 · 매 거래일 16:05 KST<\/p>\s*<p class="market-overseas">\* 해외 시장은 각 시장의 최신 거래일 기준<\/p>/
  );

  // 2. EN TODAY
  const enTodayTarget = { innerHTML: '', addEventListener() {} };
  enRuntime.render(data, enTodayTarget);
  assert.match(
    enTodayTarget.innerHTML,
    /<p class="market-date">Aug 28, 2026 · Korea close as of 15:30 KST<\/p>\s*<p class="market-update">Data updates · Every trading day at 16:05 KST<\/p>\s*<p class="market-overseas">\* Overseas markets use each market’s latest trading session\.<\/p>/
  );

  // 3. KO & EN HISTORY
  koRuntime.state.mode = 'history';
  koRuntime.state.latestDate = '2026-08-28';
  koRuntime.state.currentDate = '2026-08-27';
  const koHistoryTarget = { innerHTML: '', addEventListener() {} };
  koRuntime.render(data, koHistoryTarget);
  assert.match(koHistoryTarget.innerHTML, /<p class="market-update">데이터 업데이트 · 매 거래일 16:05 KST<\/p>/);

  enRuntime.state.mode = 'history';
  enRuntime.state.latestDate = '2026-08-28';
  enRuntime.state.currentDate = '2026-08-27';
  const enHistoryTarget = { innerHTML: '', addEventListener() {} };
  enRuntime.render(data, enHistoryTarget);
  assert.match(enHistoryTarget.innerHTML, /<p class="market-update">Data updates · Every trading day at 16:05 KST<\/p>/);

  // 4. KO & EN 1W
  const rangePayload1w = {
    aggregation_version: '1.0.0',
    period: '1w',
    window: { start_date: '2026-08-25', end_date: '2026-08-28', sessions_used: 4, required_sessions: 5, complete: false },
    instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} },
    flows: { markets: {} },
    breadth: {},
    krx_groups: { coverage_complete: false }
  };
  const ko1wTarget = { innerHTML: '', addEventListener() {} };
  koRuntime.renderRangeView(rangePayload1w, '1w', ko1wTarget);
  assert.match(
    ko1wTarget.innerHTML,
    /<p class="market-date">현재 누적 · 4 \/ 5 거래일<\/p>\s*<p class="market-update">데이터 업데이트 · 매 거래일 16:05 KST<\/p>/
  );

  const en1wTarget = { innerHTML: '', addEventListener() {} };
  enRuntime.renderRangeView(rangePayload1w, '1w', en1wTarget);
  assert.match(
    en1wTarget.innerHTML,
    /<p class="market-date">Partial · 4 \/ 5 sessions<\/p>\s*<p class="market-update">Data updates · Every trading day at 16:05 KST<\/p>/
  );

  // 5. KO & EN 1M
  const rangePayload1m = {
    aggregation_version: '1.0.0',
    period: '1m',
    window: { start_date: '2026-08-01', end_date: '2026-08-28', sessions_used: 20, required_sessions: 20, complete: true },
    instruments: { indices: {}, rates_fx_volatility: {}, commodities_crypto: {} },
    flows: { markets: {} },
    breadth: {},
    krx_groups: { coverage_complete: false }
  };
  const ko1mTarget = { innerHTML: '', addEventListener() {} };
  koRuntime.renderRangeView(rangePayload1m, '1m', ko1mTarget);
  assert.match(
    ko1mTarget.innerHTML,
    /<p class="market-date">20거래일 기준<\/p>\s*<p class="market-update">데이터 업데이트 · 매 거래일 16:05 KST<\/p>/
  );

  const en1mTarget = { innerHTML: '', addEventListener() {} };
  enRuntime.renderRangeView(rangePayload1m, '1m', en1mTarget);
  assert.match(
    en1mTarget.innerHTML,
    /<p class="market-date">20-session window<\/p>\s*<p class="market-update">Data updates · Every trading day at 16:05 KST<\/p>/
  );

  // 6. CSS invariants
  assert.match(css, /\.market-date,\s*\.market-update,\s*\.market-overseas/);
  assert.match(css, /\.market-update\{margin-top:2px;font-size:11px;line-height:1\.4\}/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*?\.market-update\{font-size:11px;line-height:1\.4\}/);
});
