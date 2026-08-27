import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const ELEMENT_IDS = [
  'archive-index', 'archive-order-label', 'archive-view-toggle', 'cal-next-btn', 'cal-prev-btn',
  'calendar-container', 'filter-month', 'filter-reset-btn', 'filter-tag', 'filter-year',
  'global-search-input', 'latest-category-cards', 'report-list', 'search-clear-btn', 'search-dialog',
  'search-empty-state', 'search-quick-tags', 'search-results-list', 'search-tag-cloud',
  'today-market-grid', 'today-strip-date', 'today-takeaway-label', 'today-takeaway-link',
  'today-takeaway-text'
];

const SELECTOR_NODES = [
  '.today-strip', '.today-takeaway-row', '.mobile-quick-nav', '[data-theme-toggle]',
  'meta[name="theme-color"]'
];

const DASH = '—';

function makeElement(name) {
  const attrs = new Map();
  return {
    name,
    attrs,
    dataset: {},
    textContent: '',
    innerHTML: '',
    href: '',
    value: '',
    hidden: false,
    style: {},
    offsetLeft: 0,
    offsetWidth: 0,
    clientWidth: 0,
    scrollLeft: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(key, val) { attrs.set(key, String(val)); },
    removeAttribute(key) { attrs.delete(key); },
    getAttribute(key) { return attrs.has(key) ? attrs.get(key) : null; },
    appendChild() {},
    removeChild() {},
    remove() {},
    focus() {},
    blur() {},
    scrollIntoView() {},
    showModal() {},
    close() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  };
}

// The daily reports the strip is allowed to link to. 08-27 is deliberately absent
// so an unmatched market date has nothing to fall onto.
const POSTS = [
  {
    id: 'ko-0826', type: 'daily', typeLabel: '주식 리포트', lang: 'ko',
    date: '2026-08-26', reportDate: '2026-08-26', registeredAt: '2026-08-26T04:00:00.000Z',
    title: '먼저열리는 밤', description: '', tags: [], href: 'reports/2026-08-26-ko.html'
  },
  {
    id: 'ko-0825', type: 'daily', typeLabel: '주식 리포트', lang: 'ko',
    date: '2026-08-25', reportDate: '2026-08-25', registeredAt: '2026-08-25T04:00:00.000Z',
    title: '낙차를 되감다', description: '', tags: [], href: 'reports/2026-08-25-ko.html'
  },
  {
    id: 'ko-0828', type: 'daily', typeLabel: '주식 리포트', lang: 'ko',
    date: '2026-08-28', reportDate: '2026-08-28', registeredAt: '2026-08-28T04:00:00.000Z',
    title: '금요일의 종가', description: '', tags: [], href: 'reports/2026-08-28-ko.html'
  },
  {
    id: 'en-0826', type: 'daily', typeLabel: 'Daily', lang: 'en',
    date: '2026-08-26', reportDate: '2026-08-26', registeredAt: '2026-08-26T05:00:00.000Z',
    title: 'The Night Opens First', description: '', tags: [], href: 'reports/en/2026-08-26-en.html'
  },
  {
    id: 'en-0825', type: 'daily', typeLabel: 'Daily', lang: 'en',
    date: '2026-08-25', reportDate: '2026-08-25', registeredAt: '2026-08-25T05:00:00.000Z',
    title: 'Rewinding the Drop', description: '', tags: [], href: 'reports/en/2026-08-25-en.html'
  }
];

// data/market-summary.js stand-in: the fallback, one session behind the API.
const STATIC_SUMMARY = {
  marketDate: '2026-08-25',
  dateDisplay: { ko: 'AUG 25', en: 'AUG 25' },
  takeaway: {
    ko: '낙차를 되감았지만, 시장의 무게중심은 아직 돌아오지 않았다.',
    en: 'The market retraced the selloff, but its center of gravity has yet to return.'
  },
  items: [
    { id: 'kospi', label: 'KOSPI', value: '6,742.74', change: '▲ 0.68%', direction: 'up' },
    { id: 'kosdaq', label: 'KOSDAQ', value: '827.15', change: '▲ 1.70%', direction: 'up' },
    { id: 'usdkrw', label: 'USD/KRW', value: '1,386.10', change: { ko: '▲ 3.7원', en: '▲ ₩3.7' }, direction: 'up' },
    { id: 'us10y', label: 'US 10Y', value: '4.70%', change: '▼ 4bp', direction: 'down' },
    { id: 'gold', label: 'GOLD', value: '$4,694.60', change: '▲ 1.16%', direction: 'up' }
  ]
};

function quote(close, change, changePct) {
  return { close, current: close, change, change_pct: changePct, previous_close: close - change };
}

const KO_LINE = '낙차를 되감았지만, 시장의 무게중심은 아직 돌아오지 않았다.';
const EN_LINE = 'The market retraced the selloff, but its centre of gravity has yet to return.';

/** The published session, optionally carrying its own editorial one-liner. */
function marketPayload(marketDate, takeaway) {
  return {
    ...(takeaway ? { takeaway } : {}),
    meta: { market_date: marketDate, schema_version: '1.0.1', status: 'final' },
    indices: {
      KOSPI: quote(6808.21, 65.47, 0.9709702583816112),
      KOSDAQ: quote(826.87, -0.28, -0.03385117572386783)
    },
    rates_fx_volatility: {
      USDKRW: quote(1384.7, -1.31, -0.09451659451659059),
      US10Y: quote(4.638999938964844, -0.065, -1.381802641114245)
    },
    commodities_crypto: {
      GOLD: quote(4689.7001953125, 51.6, 1.1125223961816726)
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}

/**
 * Boot locale.js + site.js against a stub DOM seeded with the neutral markup the
 * two homepages actually ship. Returns without waiting for the request, so a
 * test can inspect the DOM while /api/market/latest is still in flight.
 *
 * `respond` receives the requested URL and returns a Response-like promise.
 */
async function bootHomepage({ lang = 'ko', respond, summary = STATIC_SUMMARY, posts = POSTS } = {}) {
  const [localeScript, siteScript] = await Promise.all([read('assets/locale.js'), read('assets/site.js')]);

  const elements = new Map(ELEMENT_IDS.map(id => [id, makeElement(id)]));
  const selectors = new Map(SELECTOR_NODES.map(sel => [sel, makeElement(sel)]));
  const requestedUrls = [];

  // Seed the neutral initial state. tests/home-v2.test.mjs asserts the shipped
  // HTML matches exactly this.
  const marketPath = lang === 'en' ? '/en/market/' : '/market/';
  elements.get('today-strip-date').textContent = DASH;
  elements.get('today-market-grid').innerHTML = Array.from({ length: 5 }, () => (
    `<div class="today-item" role="listitem"><span class="today-label">X</span><span class="today-value">${DASH}</span><span class="today-change pending">${DASH}</span></div>`
  )).join('');
  elements.get('today-market-grid').setAttribute('aria-busy', 'true');
  elements.get('today-takeaway-label').textContent = lang === 'en' ? "Today's takeaway" : '오늘의 한 줄';
  elements.get('today-takeaway-text').textContent = '';
  elements.get('today-takeaway-link').href = marketPath;
  selectors.get('.today-takeaway-row').hidden = true;

  const document = {
    documentElement: Object.assign(makeElement('html'), { lang, dataset: { siteLang: lang } }),
    head: makeElement('head'),
    body: makeElement('body'),
    readyState: 'complete',
    addEventListener() {},
    createElement: () => makeElement('created'),
    getElementById: id => elements.get(id) || null,
    querySelector: sel => selectors.get(sel) || null,
    querySelectorAll: () => []
  };

  const window = {
    RESEARCH_POSTS: posts,
    TODAY_MARKET_SUMMARY: summary,
    addEventListener() {}
  };

  const context = vm.createContext({
    window,
    document,
    location: { pathname: lang === 'en' ? '/en/' : '/', search: '', href: 'https://snowshagal.com/', replace() {} },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: url => { requestedUrls.push(url); return respond(url); },
    setTimeout,
    clearTimeout,
    Intl,
    URL,
    URLSearchParams,
    console
  });

  vm.runInContext(localeScript, context);
  vm.runInContext(siteScript, context);

  const nodes = {
    date: elements.get('today-strip-date'),
    grid: elements.get('today-market-grid'),
    label: elements.get('today-takeaway-label'),
    text: elements.get('today-takeaway-text'),
    link: elements.get('today-takeaway-link'),
    row: selectors.get('.today-takeaway-row')
  };

  async function flush() {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
  }

  return { nodes, flush, requestedUrls };
}

/** Boot and wait for the request to settle; returns the final strip nodes. */
async function runHomepage({ fetchResult = null, ...rest } = {}) {
  const respond = () => (fetchResult
    ? Promise.resolve({ ok: true, json: () => Promise.resolve(fetchResult) })
    : Promise.resolve({ ok: false, status: 503, json: () => Promise.reject(new Error('no body')) }));
  const boot = await bootHomepage({ ...rest, respond });
  await boot.flush();
  return { ...boot.nodes, requestedUrls: boot.requestedUrls };
}

test('A. published Market Close wins over the static fallback and links its own daily report', async () => {
  const strip = await runHomepage({ fetchResult: marketPayload('2026-08-26', { ko: KO_LINE, en: EN_LINE }) });

  assert.deepEqual(strip.requestedUrls, ['/api/market/latest']);
  assert.equal(strip.date.textContent, 'AUG 26');

  // Numbers come from the API, not from the 08-25 static file.
  assert.match(strip.grid.innerHTML, /6,808\.21/);
  assert.match(strip.grid.innerHTML, /▲ 0\.97%/);
  assert.doesNotMatch(strip.grid.innerHTML, /6,742\.74/);
  assert.equal(strip.grid.getAttribute('aria-busy'), null);

  // The one-liner points at the daily report for the displayed session.
  assert.equal(strip.row.hidden, false);
  assert.equal(strip.link.href, '/reports/2026-08-26-ko.html');
  // The line comes with the session, not from the static file.
  assert.equal(strip.text.textContent, KO_LINE);
  assert.equal(strip.label.textContent, '오늘의 한 줄');
});

test('A2. a live session with no line of its own never borrows the static one', async () => {
  // 08-26 numbers, no takeaway published yet, 08-25 line still in the static file.
  const strip = await runHomepage({ fetchResult: marketPayload('2026-08-26') });

  assert.equal(strip.date.textContent, 'AUG 26');
  assert.match(strip.grid.innerHTML, /6,808\.21/);
  // Numbers stay; only the one-liner row goes.
  assert.equal(strip.row.hidden, true);
  assert.equal(strip.text.textContent, '');
  assert.notEqual(strip.text.textContent, STATIC_SUMMARY.takeaway.ko);
  // The link is still resolved for this session, never left on a stale value.
  assert.equal(strip.link.href, '/reports/2026-08-26-ko.html');
});

test('A3. a published line replaces whatever the static file says', async () => {
  const fresh = '오늘은 지수보다 수급이 먼저 움직였다.';
  const strip = await runHomepage({ fetchResult: marketPayload('2026-08-26', { ko: fresh, en: EN_LINE }) });
  assert.equal(strip.text.textContent, fresh);
  assert.notEqual(strip.text.textContent, STATIC_SUMMARY.takeaway.ko);
});

test('B. a failed market request falls back to the static file and links that same date', async () => {
  const strip = await runHomepage({ fetchResult: null });

  assert.equal(strip.date.textContent, 'AUG 25');
  assert.match(strip.grid.innerHTML, /6,742\.74/);
  assert.doesNotMatch(strip.grid.innerHTML, /6,808\.21/);

  // Emergency fallback: the whole static record is used together — its date,
  // its numbers and its line — and must not open the 08-26 report.
  assert.equal(strip.row.hidden, false);
  assert.equal(strip.text.textContent, STATIC_SUMMARY.takeaway.ko);
  assert.equal(strip.label.textContent, '오늘의 한 줄');
  assert.equal(strip.link.href, '/reports/2026-08-25-ko.html');
  assert.doesNotMatch(strip.link.href, /2026-08-26/);
});

test('C. a weekend market date is current data, not stale data', async () => {
  // Friday's close is what the API returns all weekend; nothing may downgrade it.
  const strip = await runHomepage({ fetchResult: marketPayload('2026-08-28', { ko: KO_LINE, en: EN_LINE }) });

  assert.equal(strip.date.textContent, 'AUG 28');
  assert.match(strip.grid.innerHTML, /6,808\.21/);
  assert.equal(strip.row.hidden, false);
  assert.equal(strip.link.href, '/reports/2026-08-28-ko.html');

  // Freshness is decided by the API's market_date alone, never by the calendar.
  const siteJs = await read('assets/site.js');
  assert.doesNotMatch(siteJs, /Asia\/Seoul/);
});

test('D. a market date with no matching daily report links Market Close, not another day', async () => {
  const strip = await runHomepage({ fetchResult: marketPayload('2026-08-27') });

  assert.equal(strip.date.textContent, 'AUG 27');
  // No 08-27 daily and no 08-27 editorial line: the row carries nothing.
  assert.equal(strip.row.hidden, true);
  assert.doesNotMatch(strip.link.href, /reports\//);
});

test('D2. a session with a line but no daily report links Market Close', async () => {
  const strip = await runHomepage({ fetchResult: marketPayload('2026-08-27', { ko: KO_LINE, en: EN_LINE }) });

  // The line belongs to the displayed session so it shows, but there is still
  // no 08-27 report to open.
  assert.equal(strip.row.hidden, false);
  assert.equal(strip.text.textContent, KO_LINE);
  assert.equal(strip.link.href, '/market/');
  assert.doesNotMatch(strip.link.href, /2026-08-26|2026-08-28/);
});

test('E. Korean and English render the same session and the same date', async () => {
  const payload = marketPayload('2026-08-26', { ko: KO_LINE, en: EN_LINE });
  const [ko, en] = await Promise.all([
    runHomepage({ lang: 'ko', fetchResult: payload }),
    runHomepage({ lang: 'en', fetchResult: payload })
  ]);

  assert.equal(ko.date.textContent, en.date.textContent);
  assert.equal(en.date.textContent, 'AUG 26');
  assert.equal(en.link.href, '/reports/en/2026-08-26-en.html');
  assert.equal(en.text.textContent, EN_LINE);
  assert.equal(ko.text.textContent, KO_LINE);
  assert.equal(en.label.textContent, "Today's takeaway");
});

test('E2. English falls back to the English Market Close page', async () => {
  const strip = await runHomepage({ lang: 'en', fetchResult: marketPayload('2026-08-27', { ko: KO_LINE, en: EN_LINE }) });
  assert.equal(strip.row.hidden, false);
  assert.equal(strip.link.href, '/en/market/');
  assert.doesNotMatch(strip.link.href, /reports\//);
});

/* ------------------------------------------- locales are independent */

test('H. a Korean-only line shows in Korean and hides in English', async () => {
  const payload = marketPayload('2026-08-26', { ko: KO_LINE, en: '' });
  const ko = await runHomepage({ lang: 'ko', fetchResult: payload });
  const en = await runHomepage({ lang: 'en', fetchResult: payload });

  assert.equal(ko.row.hidden, false);
  assert.equal(ko.text.textContent, KO_LINE);
  // The Korean sentence must never stand in for the missing English one.
  assert.equal(en.row.hidden, true);
  assert.equal(en.text.textContent, '');
  // Numbers and the link are unaffected on both sides.
  assert.equal(en.date.textContent, 'AUG 26');
  assert.match(en.grid.innerHTML, /6,808\.21/);
  assert.equal(en.link.href, '/reports/en/2026-08-26-en.html');
});

test('H2. an English-only line shows in English and hides in Korean', async () => {
  const payload = marketPayload('2026-08-26', { ko: '', en: EN_LINE });
  const ko = await runHomepage({ lang: 'ko', fetchResult: payload });
  const en = await runHomepage({ lang: 'en', fetchResult: payload });

  assert.equal(en.row.hidden, false);
  assert.equal(en.text.textContent, EN_LINE);
  assert.equal(ko.row.hidden, true);
  assert.equal(ko.text.textContent, '');
  assert.equal(ko.date.textContent, 'AUG 26');
  assert.equal(ko.link.href, '/reports/2026-08-26-ko.html');
});

test('H3. a daily published later is picked up without touching the line', async () => {
  // 08-27 has a line but no report yet.
  const payload = marketPayload('2026-08-27', { ko: KO_LINE, en: EN_LINE });
  const before = await runHomepage({ fetchResult: payload });
  assert.equal(before.link.href, '/market/');

  // The same session once an 08-27 daily exists.
  const after = await runHomepage({
    fetchResult: payload,
    posts: [...POSTS, { id: 'ko-0827', type: 'daily', lang: 'ko', date: '2026-08-27', reportDate: '2026-08-27', registeredAt: '2026-08-27T04:00:00.000Z', title: '새 데일리', description: '', tags: [], href: 'reports/2026-08-27-ko.html' }]
  });
  assert.equal(after.link.href, '/reports/2026-08-27-ko.html');
  assert.equal(after.text.textContent, KO_LINE);
});

test('the strip never mixes API numbers with static numbers', async () => {
  // An incomplete payload is rejected as a whole rather than topped up.
  const partial = marketPayload('2026-08-26', { ko: '살아남으면 안 되는 문장', en: 'must not survive' });
  delete partial.commodities_crypto.GOLD;
  const strip = await runHomepage({ fetchResult: partial });

  assert.equal(strip.date.textContent, 'AUG 25');
  assert.match(strip.grid.innerHTML, /6,742\.74/);
  assert.doesNotMatch(strip.grid.innerHTML, /6,808\.21/);
  // Falling back means the whole static record, so the rejected payload's line
  // must not come along with it either.
  assert.equal(strip.text.textContent, STATIC_SUMMARY.takeaway.ko);
});

test('F. while the request is in flight nothing from the static fallback is painted', async () => {
  const pending = deferred();
  const { nodes, flush, requestedUrls } = await bootHomepage({
    respond: () => pending.promise.then(payload => ({ ok: true, json: () => Promise.resolve(payload) }))
  });
  // The request is already out; the DOM must still be the neutral placeholder.
  await flush();
  assert.deepEqual(requestedUrls, ['/api/market/latest']);

  assert.equal(nodes.date.textContent, DASH);
  assert.notEqual(nodes.date.textContent, 'AUG 25');
  assert.doesNotMatch(nodes.grid.innerHTML, /6,742\.74|827\.15|1,386\.10|4\.70%|4,694\.60/);
  assert.equal(nodes.grid.getAttribute('aria-busy'), 'true');
  assert.equal(nodes.row.hidden, true);
  assert.equal(nodes.text.textContent, '');
  assert.notEqual(nodes.text.textContent, STATIC_SUMMARY.takeaway.ko);
  assert.equal(nodes.link.href, '/market/');
  assert.doesNotMatch(nodes.link.href, /reports\//);

  // Only once the published session arrives does anything render.
  pending.resolve(marketPayload('2026-08-26', { ko: KO_LINE, en: EN_LINE }));
  await flush();

  assert.equal(nodes.date.textContent, 'AUG 26');
  assert.match(nodes.grid.innerHTML, /6,808\.21/);
  assert.equal(nodes.grid.getAttribute('aria-busy'), null);
  assert.equal(nodes.row.hidden, false);
  assert.equal(nodes.text.textContent, KO_LINE);
  assert.equal(nodes.link.href, '/reports/2026-08-26-ko.html');
  assert.doesNotMatch(nodes.grid.innerHTML, /6,742\.74/);
});

test('F2. the English homepage holds the same neutral state while in flight', async () => {
  const pending = deferred();
  const { nodes, flush } = await bootHomepage({
    lang: 'en',
    respond: () => pending.promise.then(payload => ({ ok: true, json: () => Promise.resolve(payload) }))
  });
  await flush();

  assert.equal(nodes.date.textContent, DASH);
  assert.equal(nodes.row.hidden, true);
  assert.equal(nodes.link.href, '/en/market/');
  assert.doesNotMatch(nodes.grid.innerHTML, /6,742\.74/);

  pending.resolve(marketPayload('2026-08-26', { ko: KO_LINE, en: EN_LINE }));
  await flush();

  assert.equal(nodes.date.textContent, 'AUG 26');
  assert.equal(nodes.link.href, '/reports/en/2026-08-26-en.html');
});

test('G. the fallback is painted only after the request actually fails', async () => {
  const pending = deferred();
  const { nodes, flush } = await bootHomepage({
    respond: () => pending.promise
  });
  await flush();

  // Still neutral: a slow failure is not an excuse to show the fallback early.
  assert.equal(nodes.date.textContent, DASH);
  assert.equal(nodes.row.hidden, true);
  assert.doesNotMatch(nodes.grid.innerHTML, /6,742\.74/);

  pending.resolve({ ok: false, status: 503, json: () => Promise.reject(new Error('no body')) });
  await flush();

  assert.equal(nodes.date.textContent, 'AUG 25');
  assert.match(nodes.grid.innerHTML, /6,742\.74/);
  assert.match(nodes.grid.innerHTML, /827\.15/);
  assert.match(nodes.grid.innerHTML, /1,386\.10/);
  assert.match(nodes.grid.innerHTML, /4\.70%/);
  assert.match(nodes.grid.innerHTML, /4,694\.60/);
  assert.equal(nodes.grid.getAttribute('aria-busy'), null);
  assert.equal(nodes.row.hidden, false);
  assert.equal(nodes.label.textContent, '오늘의 한 줄');
  assert.equal(nodes.text.textContent, STATIC_SUMMARY.takeaway.ko);
  assert.equal(nodes.link.href, '/reports/2026-08-25-ko.html');
});

test('G2. a rejected request also keeps the neutral state until it settles', async () => {
  const pending = deferred();
  const { nodes, flush } = await bootHomepage({
    respond: () => pending.promise.then(() => { throw new Error('network down'); })
  });
  await flush();
  assert.equal(nodes.date.textContent, DASH);

  pending.resolve(null);
  await flush();
  assert.equal(nodes.date.textContent, 'AUG 25');
  assert.equal(nodes.link.href, '/reports/2026-08-25-ko.html');
});

test('site.js paints the strip exactly once, after the request settles', async () => {
  const siteJs = await read('assets/site.js');
  const body = siteJs.slice(siteJs.indexOf('function renderTodayMarket()'));
  const renderBody = body.slice(0, body.indexOf('\n  }') + 4);
  // No pre-fetch paint: every paintTodayStrip call sits inside the fetch continuation.
  assert.doesNotMatch(renderBody, /paintTodayStrip\(todayStripSession\(null\)\)/);
  assert.equal((renderBody.match(/paintTodayStrip\(/g) || []).length, 1);
  assert.match(renderBody, /fetchPublishedMarketClose\(\)\.then/);
});

test('homepage markup exposes the nodes the strip renders into', async () => {
  const [home, enHome] = await Promise.all([read('index.html'), read('en/index.html')]);
  for (const page of [home, enHome]) {
    assert.match(page, /id="today-strip-date"/);
    assert.match(page, /id="today-market-grid"/);
    assert.match(page, /id="today-takeaway-label"/);
    assert.match(page, /id="today-takeaway-link"/);
    assert.match(page, /id="today-takeaway-text"/);
  }
});

/* ==========================================================================
   P4.1 — the same day's Daily supplies the one-liner by itself.
   ======================================================================== */

const DAILY_KO_LINE = '지수는 되돌렸지만 거래대금은 따라오지 않았다.';
const DAILY_EN_LINE = 'The index recovered; turnover did not follow.';
const OVERRIDE_KO = '편집자가 직접 고쳐 쓴 한 줄.';

/** Dailies that carry their own takeaway, the way P4.1 publishes them. */
const LINKED_POSTS = [
  {
    id: 'ko-0827', type: 'daily', typeLabel: '주식 리포트', lang: 'ko',
    date: '2026-08-27', reportDate: '2026-08-27', registeredAt: '2026-08-27T04:00:00.000Z',
    title: '두 개의 와이어', description: '', tags: [], href: 'reports/2026-08-27-ko.html',
    takeaway: DAILY_KO_LINE
  },
  {
    id: 'en-0827', type: 'daily', typeLabel: 'Daily', lang: 'en',
    date: '2026-08-27', reportDate: '2026-08-27', registeredAt: '2026-08-27T05:00:00.000Z',
    title: 'Two Wires', description: '', tags: [], href: 'reports/en/2026-08-27-en.html',
    takeaway: DAILY_EN_LINE
  },
  {
    // The day before: close enough to be tempting, and still the wrong session.
    id: 'ko-0826', type: 'daily', typeLabel: '주식 리포트', lang: 'ko',
    date: '2026-08-26', reportDate: '2026-08-26', registeredAt: '2026-08-26T04:00:00.000Z',
    title: '먼저 열리는 밤', description: '', tags: [], href: 'reports/2026-08-26-ko.html',
    takeaway: '어제의 한 줄이다.'
  }
];

test('I. a Daily supplies the one-liner when nobody typed an override', async () => {
  const strip = await runHomepage({
    posts: LINKED_POSTS,
    fetchResult: marketPayload('2026-08-27')
  });
  assert.equal(strip.row.hidden, false);
  assert.equal(strip.text.textContent, DAILY_KO_LINE);
  assert.equal(strip.link.href, '/reports/2026-08-27-ko.html');
});

test('I2. English reads its own Daily, not the Korean one', async () => {
  const strip = await runHomepage({
    lang: 'en',
    posts: LINKED_POSTS,
    fetchResult: marketPayload('2026-08-27')
  });
  assert.equal(strip.text.textContent, DAILY_EN_LINE);
  assert.equal(strip.link.href, '/reports/en/2026-08-27-en.html');
});

test('J. a typed override outranks the Daily, and still links the Daily', async () => {
  const strip = await runHomepage({
    posts: LINKED_POSTS,
    fetchResult: marketPayload('2026-08-27', { ko: OVERRIDE_KO, en: '' })
  });
  assert.equal(strip.text.textContent, OVERRIDE_KO);
  assert.equal(strip.link.href, '/reports/2026-08-27-ko.html');

  // The override is per language: English had none, so its Daily still speaks.
  const english = await runHomepage({
    lang: 'en',
    posts: LINKED_POSTS,
    fetchResult: marketPayload('2026-08-27', { ko: OVERRIDE_KO, en: '' })
  });
  assert.equal(english.text.textContent, DAILY_EN_LINE);
});

test('K. yesterday’s Daily never speaks for today’s numbers', async () => {
  // Only the 26th and 27th exist; the session is the 29th.
  const strip = await runHomepage({
    posts: LINKED_POSTS,
    fetchResult: marketPayload('2026-08-29')
  });
  assert.equal(strip.row.hidden, true, 'a different date must not supply the line');
  assert.equal(strip.link.href, '/market/');
});

test('L. a Daily in the other language is not borrowed', async () => {
  // The English daily for the 27th exists; the Korean one does not.
  const englishOnly = LINKED_POSTS.filter(post => post.lang === 'en');
  const strip = await runHomepage({
    posts: englishOnly,
    fetchResult: marketPayload('2026-08-27')
  });
  assert.equal(strip.row.hidden, true, 'Korean must not read the English daily');
  assert.equal(strip.link.href, '/market/');
});

test('M. a same-date Daily with no line hides the row but keeps the link', async () => {
  const withoutLine = LINKED_POSTS.map(post => (
    post.id === 'ko-0827' ? { ...post, takeaway: '' } : post
  ));
  const strip = await runHomepage({
    posts: withoutLine,
    fetchResult: marketPayload('2026-08-27')
  });
  assert.equal(strip.row.hidden, true);
  assert.equal(strip.link.href, '/reports/2026-08-27-ko.html', 'the report is still worth linking');
});

test('N. with the API down the static record answers alone', async () => {
  const posts = LINKED_POSTS.map(post => (
    // A daily for the static record's own date, carrying a different line.
    post.id === 'ko-0827'
      ? { ...post, id: 'ko-0825', date: '2026-08-25', reportDate: '2026-08-25', href: 'reports/2026-08-25-ko.html', takeaway: '데일리가 들고 있는 다른 문장.' }
      : post
  ));
  const strip = await runHomepage({ posts, fetchResult: null });

  assert.equal(strip.date.textContent, 'AUG 25');
  // The static record's own line, not the daily's, even though one matches.
  assert.equal(strip.text.textContent, STATIC_SUMMARY.takeaway.ko);
  assert.notEqual(strip.text.textContent, '데일리가 들고 있는 다른 문장.');
});

test('O. before the Daily is published the strip points at Market Close', async () => {
  const strip = await runHomepage({
    posts: LINKED_POSTS.filter(post => post.reportDate !== '2026-08-27'),
    fetchResult: marketPayload('2026-08-27')
  });
  assert.equal(strip.row.hidden, true);
  assert.equal(strip.link.href, '/market/');
});

test('P. publishing the Daily later fills the row on the next load', async () => {
  const payload = marketPayload('2026-08-27');
  const before = await runHomepage({
    posts: LINKED_POSTS.filter(post => post.reportDate !== '2026-08-27'),
    fetchResult: payload
  });
  assert.equal(before.row.hidden, true);

  const after = await runHomepage({ posts: LINKED_POSTS, fetchResult: payload });
  assert.equal(after.row.hidden, false);
  assert.equal(after.text.textContent, DAILY_KO_LINE);
  assert.equal(after.link.href, '/reports/2026-08-27-ko.html');
});

test('Q. a Daily line is normalized before it reaches the strip', async () => {
  const messy = LINKED_POSTS.map(post => (
    post.id === 'ko-0827' ? { ...post, takeaway: '  줄바꿈과\n  여백이   섞인 문장.  ' } : post
  ));
  const strip = await runHomepage({ posts: messy, fetchResult: marketPayload('2026-08-27') });
  assert.equal(strip.text.textContent, '줄바꿈과 여백이 섞인 문장.');
});
