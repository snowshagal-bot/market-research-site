import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { HOSTILE_CORP, HOSTILE_EVENT_TITLE, HOSTILE_REPORT, seededDatabase } from './helpers/initial-html-fixtures.mjs';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';
import { onRequestGet as feedGet } from '../functions/api/disclosures/feed.js';
import { onRequestGet as calendarGet } from '../functions/api/calendar.js';
import { loadDisclosureFeed } from '../functions/api/disclosures/_feed-data.js';
import { currentKstYearMonth, loadCalendarMonth } from '../functions/_calendar-data.js';
import { buildInitialHtml } from '../functions/_initial-html.js';
import { HOLIDAY_NAMES } from '../functions/_trading-calendar.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const STATIC_CACHE = 'public, max-age=0, must-revalidate';
const SHELLS = {
  '/disclosures/': 'disclosures/index.html',
  '/en/disclosures/': 'en/disclosures/index.html',
  '/calendar/': 'calendar/index.html',
  '/en/calendar/': 'en/calendar/index.html'
};

const db = await seededDatabase();
test.after(() => db.close());
const broken = { prepare() { throw new Error('d1 down'); }, batch() { throw new Error('d1 down'); } };

/** The raw HTTP response body for a page, as a crawler or curl receives it. */
async function page(pathWithQuery, env = { COMMENTS_DB: db }) {
  const url = new URL(`https://snowshagal.com${pathWithQuery}`);
  const shell = await read(SHELLS[url.pathname]);
  const response = await middlewareRequest({
    request: new Request(url),
    env,
    next: async () => new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': STATIC_CACHE } })
  });
  return { response, html: await response.text(), shell };
}

/** Inner HTML of the element with this id, nesting-aware. */
function innerById(html, id) {
  const open = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html);
  if (!open) return null;
  const tag = open[1];
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  pattern.lastIndex = open.index + open[0].length;
  let depth = 1;
  let match;
  while ((match = pattern.exec(html))) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return html.slice(open.index + open[0].length, match.index);
  }
  return null;
}

function openTag(html, id) {
  return new RegExp(`<[a-z][\\w-]*\\b[^>]*\\bid="${id}"[^>]*>`, 'i').exec(html)?.[0] || '';
}

const normalize = (markup) => String(markup).replace(/\s+/g, ' ').replace(/>\s+</g, '><').replace(/\s+>/g, '>').trim();
const count = (html, needle) => html.split(needle).length - 1;
const head = (html) => html.slice(0, html.indexOf('</head>'));

/* ================================================================ disclosures */

test('/disclosures/ ships the latest published filings in the HTTP response, not a loading placeholder', async () => {
  const feed = await loadDisclosureFeed({ COMMENTS_DB: db });
  assert.equal(feed.date, '2026-09-16');
  const { response, html } = await page('/disclosures/');
  assert.equal(response.status, 200);
  const mount = innerById(html, 'disclosures-mount');

  assert.doesNotMatch(mount, /공시 데이터를 불러오는 중입니다/);
  assert.equal(innerById(html, 'disclosures-current-date'), '2026년 9월 16일 (수)');
  assert.equal(innerById(html, 'disclosures-count-badge'), '7건');
  // Five cards by default, in the feed's order, then "view all".
  assert.equal(count(mount, '<article class="disclosure-card'), 5);
  for (const item of feed.items.slice(0, 5)) {
    assert.ok(mount.includes(`data-rcept-no="${item.rceptNo}"`), `${item.rceptNo} shown`);
    assert.ok(mount.includes(`href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rceptNo}"`), `${item.rceptNo} links to DART`);
  }
  for (const item of feed.items.slice(5)) assert.ok(!mount.includes(`data-rcept-no="${item.rceptNo}"`), `${item.rceptNo} folded`);
  assert.match(mount, /오늘의 주요 공시 전체 보기 \(7건\) →/);
  // Company, code, title, correction and priority are all in the raw HTML.
  assert.match(mount, /<strong class="disclosure-corp-name">셀트리온<\/strong>\s*<span class="disclosure-stock-code">068270<\/span>/);
  assert.match(mount, /<h3 class="disclosure-report-title">자기주식취득결과보고서<\/h3>/);
  assert.match(mount, /<span class="disclosure-correction-tag">\[기재정정\]<\/span>/);
  assert.match(mount, /<span class="disclosure-priority-tag tag-(high|medium|low)">(HIGH|MEDIUM|LOW)<\/span>/);
  // Superseded and unpublished filings never reach the page.
  assert.doesNotMatch(html, /대체된공시|비공개공시/);
  assert.match(openTag(html, 'disclosures-mount'), /data-ssr-key="\|0"/);
});

test('/en/disclosures/ renders the same filings with the English UI', async () => {
  const { html } = await page('/en/disclosures/');
  const mount = innerById(html, 'disclosures-mount');
  assert.equal(innerById(html, 'disclosures-current-date'), 'Sep 16, 2026 (Wed)');
  assert.equal(innerById(html, 'disclosures-count-badge'), '7 filings');
  assert.equal(count(mount, '<article class="disclosure-card'), 5);
  assert.match(mount, /DART Original ↗/);
  assert.match(mount, /View all key filings \(7\) →/);
  assert.doesNotMatch(mount, /Loading disclosure filings/);
});

test('?date= and ?all=1 are applied on the server', async () => {
  const dated = await page('/disclosures/?date=2026-09-15');
  const datedMount = innerById(dated.html, 'disclosures-mount');
  assert.equal(innerById(dated.html, 'disclosures-current-date'), '2026년 9월 15일 (화)');
  assert.equal(innerById(dated.html, 'disclosures-count-badge'), '2건');
  assert.match(datedMount, /현대차/);
  assert.match(datedMount, /KB금융/);
  assert.doesNotMatch(datedMount, /셀트리온|disclosures-expand-all-btn/);
  assert.match(openTag(dated.html, 'disclosures-mount'), /data-ssr-key="2026-09-15\|0"/);

  const all = await page('/disclosures/?all=1');
  const allMount = innerById(all.html, 'disclosures-mount');
  assert.equal(count(allMount, '<article class="disclosure-card'), 7);
  assert.match(allMount, /접기 ▴/);
  assert.match(openTag(all.html, 'disclosures-mount'), /data-ssr-key="\|1"/);

  const both = await page('/en/disclosures/?date=2026-09-16&all=true');
  assert.equal(count(innerById(both.html, 'disclosures-mount'), '<article class="disclosure-card'), 7);
  assert.match(openTag(both.html, 'disclosures-mount'), /data-ssr-key="2026-09-16\|1"/);
});

test('a date with nothing selected renders the empty state, in both languages', async () => {
  const ko = await page('/disclosures/?date=2026-09-14');
  assert.match(innerById(ko.html, 'disclosures-mount'), /<h3>선별된 주요 공시가 없습니다\.<\/h3>/);
  assert.equal(innerById(ko.html, 'disclosures-count-badge'), '0건');
  assert.doesNotMatch(ko.html, /공시 데이터를 불러오는 중입니다/);
  const en = await page('/en/disclosures/?date=2026-09-13');
  assert.match(innerById(en.html, 'disclosures-mount'), /<h3>No key disclosures selected\.<\/h3>/);
});

test('company and filing names from DART are escaped, never inserted as markup', async () => {
  const { html } = await page('/disclosures/?all=1');
  assert.ok(!html.includes(HOSTILE_CORP), 'raw corp name absent');
  assert.ok(!html.includes(HOSTILE_REPORT), 'raw report name absent');
  assert.doesNotMatch(html, /<img src=x|<script>alert/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&amp;Co&quot;/);
  assert.match(html, /주요사항보고서\(&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;\)/);
});

test('a database failure serves the untouched static shell with 200, and the API contract is unchanged', async () => {
  const { response, html, shell } = await page('/disclosures/', { COMMENTS_DB: broken });
  assert.equal(response.status, 200);
  assert.equal(innerById(html, 'disclosures-mount'), innerById(shell, 'disclosures-mount'));
  assert.match(html, /공시 데이터를 불러오는 중입니다/);
  assert.doesNotMatch(html, /data-ssr-key/);
  const noDb = await page('/en/disclosures/', {});
  assert.equal(noDb.response.status, 200);
  assert.match(noDb.html, /Loading disclosure filings/);
  const api = await feedGet({ request: new Request('https://snowshagal.com/api/disclosures/feed'), env: { COMMENTS_DB: broken } });
  assert.equal(api.status, 500);
});

test('a database slower than the time budget falls back to the static shell', async () => {
  const hanging = { prepare() { return { bind() { return this; }, first: () => new Promise(() => {}), all: () => new Promise(() => {}), run: () => new Promise(() => {}) }; }, batch: () => new Promise(() => {}) };
  const started = Date.now();
  const result = await buildInitialHtml(new URL('https://snowshagal.com/disclosures/'), { COMMENTS_DB: hanging }, { budgetMs: 40 });
  assert.equal(result, null);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await buildInitialHtml(new URL('https://snowshagal.com/market/'), { COMMENTS_DB: db }), null, 'other pages are untouched');
});

/* =================================================================== calendar */

test('/calendar/ ships the current Seoul month, its holidays, upcoming schedule and events in the HTTP response', async () => {
  const current = currentKstYearMonth(new Date());
  for (const [path, label] of [['/calendar/', `${current.year}년 ${current.month}월`], ['/en/calendar/', `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][current.month - 1]} ${current.year}`]]) {
    const { response, html } = await page(path);
    assert.equal(response.status, 200);
    assert.equal(innerById(html, 'calendar-month-label'), label, path);
    const grid = innerById(html, 'calendar-grid-mount');
    assert.doesNotMatch(grid, /거래 일정을 불러오는 중입니다/);
    const tag = openTag(html, 'calendar-grid-mount');
    assert.match(tag, new RegExp(`data-ssr-year="${current.year}"`));
    assert.match(tag, new RegExp(`data-ssr-month="${current.month}"`));
    assert.match(tag, /data-ssr-filter="ALL"/);
    const daysInMonth = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
    if (current.year <= 2027) {
      assert.equal(count(grid, 'class="calendar-day-cell ') - count(grid, 'calendar-day-cell empty'), daysInMonth);
    }
  }
});

test('?year=&month= renders that month with KRX/NYSE holidays, special sessions, events and the upcoming list', async () => {
  const ko = await page('/calendar/?year=2026&month=9');
  const grid = innerById(ko.html, 'calendar-grid-mount');
  assert.equal(innerById(ko.html, 'calendar-month-label'), '2026년 9월');
  assert.equal(count(grid, 'data-date="2026-09-'), 30);
  assert.ok(grid.includes(`KRX ${HOLIDAY_NAMES.KRX['2026-09-24'].ko}`), 'KRX Chuseok');
  assert.ok(grid.includes(`NYSE ${HOLIDAY_NAMES.NYSE['2026-09-07'].ko}`), 'NYSE Labor Day');
  // 09-10 carries three events: two chips and "+1".
  const tenth = grid.slice(grid.indexOf('data-date="2026-09-10"'), grid.indexOf('data-date="2026-09-11"'));
  assert.equal(count(tenth, 'class="cal-event-chip'), 2);
  assert.match(tenth, /\+1건 더/);
  assert.match(grid, /class="cal-event-chip kr" title="실적 발표">삼성전자</);
  // The FOMC decision at 14:00 ET on 09-16 is 03:00 KST on 09-17.
  const seventeenth = grid.slice(grid.indexOf('data-date="2026-09-17"'), grid.indexOf('data-date="2026-09-18"'));
  assert.match(seventeenth, /FOMC 금리결정/);
  const upcoming = innerById(ko.html, 'calendar-upcoming-mount');
  assert.match(upcoming, /<h2>다가오는 거래 일정<\/h2>/);
  assert.ok(count(upcoming, 'class="upcoming-event-card"') > 0);

  const en = await page('/en/calendar/?year=2026&month=9');
  const enGrid = innerById(en.html, 'calendar-grid-mount');
  assert.equal(innerById(en.html, 'calendar-month-label'), 'September 2026');
  assert.ok(enGrid.includes(`KRX ${HOLIDAY_NAMES.KRX['2026-09-24'].en}`));
  assert.match(enGrid, />Samsung Electronics</);
  assert.match(innerById(en.html, 'calendar-upcoming-mount'), /Upcoming Trading Schedule/);
});

test('?market= filters the server-rendered grid and marks the active filter', async () => {
  const { html } = await page('/calendar/?year=2026&month=9&market=krx');
  const grid = innerById(html, 'calendar-grid-mount');
  assert.ok(grid.includes(`KRX ${HOLIDAY_NAMES.KRX['2026-09-24'].ko}`));
  assert.ok(!grid.includes(`NYSE ${HOLIDAY_NAMES.NYSE['2026-09-07'].ko}`), 'NYSE holiday filtered out');
  assert.doesNotMatch(grid, /cal-event-chip us/);
  assert.match(openTag(html, 'calendar-grid-mount'), /data-ssr-filter="KRX"/);
  assert.match(html, /<button type="button" class="calendar-filter-btn active" data-filter="KRX">/);
  assert.match(html, /<button type="button" class="calendar-filter-btn" data-filter="ALL">/);
  assert.match(html, /<button type="button" class="calendar-filter-btn" data-filter="NYSE">/);
});

test('an event-store failure keeps the exchange calendar and shows the unavailable notice', async () => {
  const { response, html } = await page('/calendar/?year=2026&month=9', { COMMENTS_DB: broken });
  assert.equal(response.status, 200);
  const grid = innerById(html, 'calendar-grid-mount');
  assert.ok(grid.includes(`KRX ${HOLIDAY_NAMES.KRX['2026-09-24'].ko}`));
  assert.doesNotMatch(grid, /cal-event-chip/);
  assert.match(grid, /시장 이벤트 일정을 일시적으로 불러오지 못했습니다\./);
  const noDb = await page('/en/calendar/?year=2026&month=9', {});
  assert.match(innerById(noDb.html, 'calendar-grid-mount'), /Market events are temporarily unavailable\./);
});

test('KRX-pending and deferred years render their existing notices', async () => {
  const pending = await page('/calendar/?year=2027&month=1');
  assert.match(innerById(pending.html, 'calendar-grid-mount'), /KRX\(한국\) 2027년 거래 일정은 한국거래소 공식 발표 후 순차 반영 예정입니다/);
  assert.match(innerById(pending.html, 'calendar-grid-mount'), /data-date="2027-01-04"/);
  const krxOnly = await page('/en/calendar/?year=2027&month=1&market=KRX');
  assert.match(innerById(krxOnly.html, 'calendar-grid-mount'), /<h3>KRX 2027 schedule pending official release<\/h3>/);
  const deferred = await page('/calendar/?year=2028&month=1');
  assert.match(innerById(deferred.html, 'calendar-grid-mount'), /<h3>2028 calendar deferred — official schedule incomplete<\/h3>/);
  assert.match(innerById(deferred.html, 'calendar-grid-mount'), /해당 연도 일정은 공식 확정 후 순차 업데이트됩니다\./);
  assert.equal(innerById(deferred.html, 'calendar-upcoming-mount').trim(), '');
});

test('queries the page script ignores are ignored on the server too', async () => {
  const current = currentKstYearMonth(new Date());
  const { html } = await page('/calendar/?year=2019&month=13&market=LSE');
  assert.equal(innerById(html, 'calendar-month-label'), `${current.year}년 ${current.month}월`);
  assert.match(openTag(html, 'calendar-grid-mount'), /data-ssr-filter="ALL"/);
});

test('event titles are escaped in text and in title attributes', async () => {
  const { html } = await page('/en/calendar/?year=2026&month=9');
  assert.ok(!html.includes(HOSTILE_EVENT_TITLE));
  assert.doesNotMatch(html, /<b>FOMC<\/b>/);
  assert.match(html, /title="&lt;b&gt;FOMC&lt;\/b&gt; &amp; &quot;Rate&quot; Decision">&lt;b&gt;FOMC&lt;\/b&gt; &amp; &quot;Rate&quot; Decision</);
});

/* ======================================================== contract around SSR */

test('head tags, canonical, hreflang and cache headers are exactly the static ones', async () => {
  for (const path of Object.keys(SHELLS)) {
    const { response, html, shell } = await page(path);
    assert.equal(head(html), head(shell), `${path} head unchanged`);
    assert.equal(response.headers.get('cache-control'), STATIC_CACHE, `${path} cache-control unchanged`);
    assert.equal(response.headers.get('etag'), null);
  }
});

/* ============================================ the page scripts take over cleanly */

function element(id, html = '', attrs = {}) {
  const listeners = {};
  return {
    id,
    innerHTML: html,
    textContent: '',
    hidden: false,
    disabled: false,
    dataset: { ...attrs },
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, fn) { listeners[type] = fn; },
    querySelector() { return null; },
    setAttribute() {},
    getAttribute() { return null; },
    listeners
  };
}

function dataAttributes(tag) {
  const out = {};
  for (const [, name, value] of tag.matchAll(/data-ssr-([a-z-]+)="([^"]*)"/g)) {
    out[`ssr${name.replace(/(^|-)([a-z])/g, (_, dash, ch) => ch.toUpperCase())}`] = value;
  }
  return out;
}

async function runScript(script, { lang, search, elements, fetchImpl, NowDate = Date }) {
  const byId = new Map(elements.map(el => [el.id, el]));
  const filterButtons = ['ALL', 'KRX', 'NYSE'].map(filter => ({ dataset: { filter }, classList: { toggle() {} }, addEventListener() {} }));
  const window = {
    location: { search, href: `https://snowshagal.com/x${search}` },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {}
  };
  const document = {
    documentElement: { dataset: { siteLang: lang } },
    readyState: 'complete',
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (selector) => (selector === '.calendar-filter-btn' ? filterButtons : []),
    addEventListener() {}
  };
  const errors = [];
  const context = vm.createContext({
    window, document, fetch: fetchImpl, URL, URLSearchParams, Intl, Date: NowDate, Map, Set, console: { ...console, error: (...a) => errors.push(a) }
  });
  vm.runInContext(await read(script), context);
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
  return { byId, errors };
}

const apiFetch = (handler, env = { COMMENTS_DB: db }) => async (url) => handler({ request: new Request(`https://snowshagal.com${url}`), env });

test('the disclosures script re-renders exactly what the server sent, and keeps it if its first fetch fails', async () => {
  for (const [path, lang, search] of [['/disclosures/', 'ko', ''], ['/en/disclosures/', 'en', '?date=2026-09-15'], ['/disclosures/', 'ko', '?all=1'], ['/disclosures/', 'ko', '?date=2026-09-14']]) {
    const { html } = await page(`${path}${search}`);
    const serverMount = innerById(html, 'disclosures-mount');
    const mount = element('disclosures-mount', serverMount, dataAttributes(openTag(html, 'disclosures-mount')));
    const dateEl = element('disclosures-current-date');
    const countEl = element('disclosures-count-badge');
    const renders = [];
    let current = serverMount;
    Object.defineProperty(mount, 'innerHTML', { get: () => current, set: (value) => { renders.push(value); current = value; } });

    await runScript('assets/disclosures.js', {
      lang, search,
      elements: [mount, dateEl, countEl, element('disclosures-next-btn'), element('disclosures-prev-btn'), element('disclosures-today-btn')],
      fetchImpl: apiFetch(feedGet)
    });
    assert.equal(renders.length, 1, `${lang}${search}: no loading box before the data`);
    assert.equal(normalize(current), normalize(serverMount), `${lang}${search}: identical markup`);
    assert.equal(dateEl.textContent, innerById(html, 'disclosures-current-date'), `${lang}${search}: same date label`);
    assert.equal(countEl.textContent, innerById(html, 'disclosures-count-badge'), `${lang}${search}: same count`);

    // First fetch fails: the server content stays.
    let failedCurrent = serverMount;
    const failing = element('disclosures-mount', serverMount, dataAttributes(openTag(html, 'disclosures-mount')));
    Object.defineProperty(failing, 'innerHTML', { get: () => failedCurrent, set: (value) => { failedCurrent = value; } });
    await runScript('assets/disclosures.js', {
      lang, search,
      elements: [failing, element('disclosures-current-date'), element('disclosures-count-badge'), element('disclosures-next-btn'), element('disclosures-prev-btn'), element('disclosures-today-btn')],
      fetchImpl: async () => { throw new Error('offline'); }
    });
    assert.equal(failedCurrent, serverMount, `${lang}${search}: kept on failure`);
  }

  // Without server content (static shell), the script behaves as before.
  let shellCurrent = '<p>loading</p>';
  const shellMount = element('disclosures-mount');
  const shellRenders = [];
  Object.defineProperty(shellMount, 'innerHTML', { get: () => shellCurrent, set: (value) => { shellRenders.push(value); shellCurrent = value; } });
  await runScript('assets/disclosures.js', {
    lang: 'ko', search: '',
    elements: [shellMount, element('disclosures-current-date'), element('disclosures-count-badge'), element('disclosures-next-btn'), element('disclosures-prev-btn'), element('disclosures-today-btn')],
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.match(shellRenders[0], /공시 데이터를 불러오는 중입니다/);
  assert.match(shellCurrent, /공시 데이터를 불러오지 못했습니다/);
});

test('the calendar script re-renders exactly what the server sent, stays on its month, and keeps it if its first fetch fails', async () => {
  // A browser clock in a different month must not move the page off the server's month.
  const RealDate = Date;
  class FarFutureDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [RealDate.UTC(2029, 4, 15)])); }
    static now() { return RealDate.UTC(2029, 4, 15); }
  }

  for (const [path, lang, search] of [['/calendar/', 'ko', ''], ['/en/calendar/', 'en', '?year=2026&month=9'], ['/calendar/', 'ko', '?year=2026&month=9&market=NYSE'], ['/calendar/', 'ko', '?year=2028&month=1']]) {
    const { html } = await page(`${path}${search}`);
    const serverGrid = innerById(html, 'calendar-grid-mount');
    const serverUpcoming = innerById(html, 'calendar-upcoming-mount');
    const attrs = dataAttributes(openTag(html, 'calendar-grid-mount'));
    const grid = element('calendar-grid-mount', serverGrid, attrs);
    const upcoming = element('calendar-upcoming-mount', serverUpcoming);
    const label = element('calendar-month-label');
    const requested = [];

    const { byId } = await runScript('assets/calendar.js', {
      lang, search, NowDate: FarFutureDate,
      elements: [grid, upcoming, label, element('cal-prev-btn'), element('cal-next-btn'), element('cal-today-btn')],
      fetchImpl: async (url) => { requested.push(url); return calendarGet({ request: new Request(`https://snowshagal.com${url}`), env: { COMMENTS_DB: db } }); }
    });
    assert.equal(requested[0], `/api/calendar?year=${attrs.ssrYear}&month=${attrs.ssrMonth}`, `${lang}${search}: fetches the server's month`);
    assert.equal(label.textContent, innerById(html, 'calendar-month-label'), `${lang}${search}: same month label`);
    assert.equal(normalize(byId.get('calendar-grid-mount').innerHTML), normalize(serverGrid), `${lang}${search}: identical grid`);
    assert.equal(normalize(byId.get('calendar-upcoming-mount').innerHTML), normalize(serverUpcoming), `${lang}${search}: identical upcoming`);

    const failingGrid = element('calendar-grid-mount', serverGrid, attrs);
    await runScript('assets/calendar.js', {
      lang, search, NowDate: FarFutureDate,
      elements: [failingGrid, element('calendar-upcoming-mount', serverUpcoming), element('calendar-month-label'), element('cal-prev-btn'), element('cal-next-btn'), element('cal-today-btn')],
      fetchImpl: async () => { throw new Error('offline'); }
    });
    assert.equal(failingGrid.innerHTML, serverGrid, `${lang}${search}: kept on failure`);
  }
});
