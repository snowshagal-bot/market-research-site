import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const SCRIPT = await read('assets/calendar.js');
const STYLES = await read('assets/calendar.css');

/* ------------------------------------------------------------ a stub page */

function makeElement(id = '') {
  const listeners = new Map();
  return {
    id,
    innerHTML: '',
    textContent: '',
    className: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {}, click() {}, scrollIntoView() {},
    fire(type, event = {}) {
      return Promise.all((listeners.get(type) || []).map(handler => handler({ preventDefault() {}, ...event })));
    }
  };
}

/**
 * Runs the real calendar script against a stub page and one API answer, then
 * hands back the markup it produced. The point is the rendering decisions —
 * which day a chip lands on, what a failure says — not the DOM plumbing.
 */
async function render({ lang = 'ko', payload }) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  const context = {
    document: {
      // The page marks its locale on the root element; the script reads that.
      documentElement: { lang, dataset: { siteLang: lang } },
      getElementById: get,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: tag => makeElement(tag),
      addEventListener(type, handler) { if (type === 'DOMContentLoaded') context.__ready = handler; },
      readyState: 'complete',
      body: makeElement()
    },
    window: {
      location: { pathname: lang === 'en' ? '/en/calendar/' : '/calendar/', search: '', href: 'https://snowshagal.com/' },
      history: { replaceState() {}, pushState() {} },
      addEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    },
    location: { pathname: lang === 'en' ? '/en/calendar/' : '/calendar/', search: '', href: 'https://snowshagal.com/' },
    history: { replaceState() {}, pushState() {} },
    navigator: { language: lang },
    fetch: async () => ({ ok: true, status: 200, json: async () => payload }),
    setTimeout: fn => { fn(); return 0; },
    URLSearchParams,
    URL,
    clearTimeout() {},
    console
  };
  context.window.document = context.document;
  vm.runInNewContext(SCRIPT, context);

  // The script binds to DOMContentLoaded when the document is still loading.
  if (context.__ready) await context.__ready();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  return {
    grid: get('calendar-grid-mount').innerHTML,
    detail: () => get('calendar-day-detail-mount').innerHTML,
    get
  };
}

/* -------------------------------------------------------------- a payload */

const day = (date, day) => ({
  date, day, dayOfWeek: new Date(`${date}T00:00:00Z`).getUTCDay(),
  isWeekend: [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
  krx: { supported: true, trading: true, holiday: false, name: null, specialSession: null },
  nyse: { supported: true, trading: true, holiday: false, name: null, specialSession: null },
  isJointClosure: false
});

function payloadFor(events, { eventsStatus = 'ok' } = {}) {
  const days = [];
  for (let d = 1; d <= 30; d += 1) days.push(day(`2026-09-${String(d).padStart(2, '0')}`, d));
  return {
    ok: true, supported: true, year: 2026, month: 9, serverDate: '2026-09-02',
    marketSupport: { krx: true, nyse: true }, krxPendingMessage: null,
    days, upcoming: [], eventsTimezone: 'Asia/Seoul', eventsStatus, events
  };
}

const fomc = {
  id: 'official:fomc:2026-09-16', market: 'US', category: 'monetary_policy', importance: 'high',
  title: { ko: 'FOMC 금리결정', en: 'FOMC Rate Decision' }, company: null,
  source: { date: '2026-09-16', time: '14:00', timezone: 'America/New_York' },
  display: { date: '2026-09-17', time: '03:00', timezone: 'Asia/Seoul', shifted: true },
  sourceName: 'federal-reserve', status: 'scheduled'
};

const expiry = {
  id: 'rule:krx-monthly:2026-09', market: 'KR', category: 'derivatives_expiry', importance: 'normal',
  title: { ko: 'KOSPI200 월물 옵션 만기', en: 'KOSPI 200 Monthly Options Expiration' }, company: null,
  source: { date: '2026-09-10', time: null, timezone: 'Asia/Seoul' },
  display: { date: '2026-09-10', time: null, timezone: 'Asia/Seoul', shifted: false },
  status: 'scheduled'
};

const briefing = {
  id: 'opendart:dart:20260901000001', market: 'KR', category: 'corporate_event', importance: 'normal',
  title: { ko: '기업설명회(IR)', en: 'Investor Relations Briefing' },
  company: { stockCode: '005930', name: '삼성전자' },
  source: { date: '2026-09-10', time: '14:00', timezone: 'Asia/Seoul' },
  display: { date: '2026-09-10', time: '14:00', timezone: 'Asia/Seoul', shifted: false },
  status: 'scheduled'
};

/* ---------------------------------------------------------------- the grid */

test('an event lands on the day a Seoul reader sees it', async () => {
  const { grid } = await render({ payload: payloadFor([fomc]) });

  const cellFor = date => grid.split(`data-date="${date}"`)[1]?.split('</div>\n        </div>')[0] || '';
  assert.match(cellFor('2026-09-17'), /cal-event-chip/, 'the decision belongs to the 17th in Seoul');
  assert.doesNotMatch(cellFor('2026-09-16'), /cal-event-chip/, 'and not to the 16th, which is its source date');
});

test('a company event shows the company, an economic one shows its name', async () => {
  const { grid } = await render({ payload: payloadFor([briefing, expiry]) });
  assert.match(grid, /삼성전자/);
  assert.match(grid, /KOSPI200 월물 옵션 만기/);
});

test('a busy day shows a couple of events and counts the rest', async () => {
  const many = [1, 2, 3, 4].map(n => ({
    ...expiry, id: `rule:x${n}`, title: { ko: `이벤트 ${n}`, en: `Event ${n}` }
  }));
  const { grid } = await render({ payload: payloadFor(many) });
  assert.match(grid, /cal-event-more/);
  assert.match(grid, /\+2건 더/, 'four events, two shown, two counted');
});

test('a cancelled event is kept out of the grid and out of the count', async () => {
  const { grid } = await render({ payload: payloadFor([{ ...expiry, status: 'cancelled' }]) });
  assert.doesNotMatch(grid, /cal-event-chip/);

  // Three live events and one withdrawn: the counter must say one more,
  // not two, or the cell would promise something the detail card lacks.
  const mixed = [
    { ...expiry, id: 'rule:a', title: { ko: '하나', en: 'One' } },
    { ...expiry, id: 'rule:b', title: { ko: '둘', en: 'Two' } },
    { ...expiry, id: 'rule:c', title: { ko: '셋', en: 'Three' } },
    { ...expiry, id: 'rule:d', title: { ko: '취소된 것', en: 'Withdrawn' }, status: 'cancelled' }
  ];
  const busy = await render({ payload: payloadFor(mixed) });
  assert.match(busy.grid, /\+1건 더/);
  assert.doesNotMatch(busy.grid, /취소된 것/, 'a withdrawn event is not one of the chips');
});

/* ------------------------------------------------------------ the failure */

test('when events cannot be loaded the exchange calendar still renders', async () => {
  const { grid } = await render({ payload: payloadFor([], { eventsStatus: 'unavailable' }) });

  assert.match(grid, /calendar-days-grid/, 'the month grid is untouched');
  assert.match(grid, /calendar-weekdays-row/);
  assert.match(grid, /시장 이벤트 일정을 일시적으로 불러오지 못했습니다\./);
  assert.match(grid, /role="status"/);
});

test('the English page says it in English', async () => {
  const { grid } = await render({ lang: 'en', payload: payloadFor([], { eventsStatus: 'unavailable' }) });
  assert.match(grid, /Market events are temporarily unavailable\./);
  assert.match(grid, /calendar-days-grid/);
});

test('a quiet month says nothing at all', async () => {
  const { grid } = await render({ payload: payloadFor([]) });
  assert.doesNotMatch(grid, /일시적으로 불러오지 못했습니다/);
  assert.doesNotMatch(grid, /calendar-events-notice/);
});

/* ------------------------------------------------------------- the styles */

test('events reuse the existing palette rather than adding one', async () => {
  assert.match(STYLES, /\.cal-event-chip/);
  assert.match(STYLES, /\.calendar-events-notice/);
  // The chips take their accent from the market colours already defined.
  assert.match(STYLES, /\.cal-event-chip\.kr\s*\{[^}]*--cal-krx-color/);
  assert.match(STYLES, /\.cal-event-chip\.us\s*\{[^}]*--cal-nyse-color/);
  // And no new colour family is introduced for them.
  const eventBlock = STYLES.slice(STYLES.indexOf('.cal-event-chip'));
  assert.doesNotMatch(eventBlock, /#[0-9a-f]{6}/i, 'no literal colours outside the token set');
});

test('the narrow breakpoints the rest of the calendar uses are covered', async () => {
  const eventBlock = STYLES.slice(STYLES.indexOf('.cal-event-chip'));
  assert.match(eventBlock, /@media \(max-width: 480px\)/);
  assert.match(eventBlock, /@media \(max-width: 430px\)/);
});

/* ------------------------------------------------- both locales are wired */

test('both calendar pages ship the same script and stylesheet', async () => {
  const [ko, en] = await Promise.all([read('calendar/index.html'), read('en/calendar/index.html')]);
  const hashOf = (page, asset) => new RegExp(`${asset}\\?v=([a-f0-9]{10})`).exec(page)?.[1];
  assert.equal(hashOf(ko, 'calendar\\.js'), hashOf(en, 'calendar\\.js'));
  assert.equal(hashOf(ko, 'calendar\\.css'), hashOf(en, 'calendar\\.css'));
  assert.ok(hashOf(ko, 'calendar\\.js'), 'the script must carry a content hash');
});

test('every category has a name in both locales', async () => {
  for (const category of ['monetary_policy', 'inflation', 'employment', 'earnings', 'corporate_event', 'derivatives_expiry']) {
    assert.ok(SCRIPT.includes(`${category}:`), `${category} must be named for the reader`);
  }
  // Two tables, one per locale.
  assert.equal((SCRIPT.match(/eventCategories: \{/g) || []).length, 2);
  assert.equal((SCRIPT.match(/eventsUnavailable:/g) || []).length, 2);
});

/* --------------------------------------------- how a time is shown to a reader */

test('times are labelled the way a market is spoken of, not by IANA path', async () => {
  const { grid, get } = await render({ payload: payloadFor([fomc]) });
  assert.doesNotMatch(grid, /America\/New_York/, 'the zone identifier is not reader-facing');

  // Open the day the decision lands on in Seoul.
  await get('calendar-grid-mount').fire('click', { target: { closest: () => ({ dataset: { date: '2026-09-17' } }) } });
  const detail = get('calendar-day-detail-mount').innerHTML;
  assert.match(detail, /03:00 KST/);
  assert.match(detail, /현지 14:00 ET/, 'the source clock keeps its own market label');
  assert.doesNotMatch(detail, /America\/New_York/);
  assert.doesNotMatch(detail, /UTC[+-]/, 'a fixed offset is never substituted for the zone');
});

test('the English detail says the same without the Korean word for local', async () => {
  const { get } = await render({ lang: 'en', payload: payloadFor([fomc]) });
  await get('calendar-grid-mount').fire('click', { target: { closest: () => ({ dataset: { date: '2026-09-17' } }) } });
  const detail = get('calendar-day-detail-mount').innerHTML;
  assert.match(detail, /03:00 KST/);
  assert.match(detail, /14:00 ET/);
  assert.doesNotMatch(detail, /America\/New_York/);
});

test('a Korean event shows one clock, because there is only one', async () => {
  const { get } = await render({ payload: payloadFor([briefing]) });
  await get('calendar-grid-mount').fire('click', { target: { closest: () => ({ dataset: { date: '2026-09-10' } }) } });
  const detail = get('calendar-day-detail-mount').innerHTML;
  assert.match(detail, /14:00 KST/);
  assert.doesNotMatch(detail, /현지/, 'the source and the reader share a zone');
});

test('an event with no time says so rather than inventing one', async () => {
  const { get } = await render({ payload: payloadFor([expiry]) });
  await get('calendar-grid-mount').fire('click', { target: { closest: () => ({ dataset: { date: '2026-09-10' } }) } });
  assert.match(get('calendar-day-detail-mount').innerHTML, /시간 미정/);
});

test('a withdrawn event is shown in the detail, marked as withdrawn', async () => {
  const { get } = await render({ payload: payloadFor([{ ...expiry, status: 'cancelled' }]) });
  await get('calendar-grid-mount').fire('click', { target: { closest: () => ({ dataset: { date: '2026-09-10' } }) } });
  const detail = get('calendar-day-detail-mount').innerHTML;
  assert.match(detail, /취소됨/);
  assert.match(detail, /is-cancelled/);
});

test('the source timezone still travels in the API payload', async () => {
  // Only the display is simplified; storage and the API keep the IANA zone,
  // which is what the conversion is computed from.
  assert.equal(fomc.source.timezone, 'America/New_York');
  assert.match(SCRIPT, /ZONE_LABELS/);
  assert.doesNotMatch(SCRIPT, /UTC-[45]/, 'no fixed offset stands in for the zone');
});
