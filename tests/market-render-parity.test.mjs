// The same record is drawn by two renderers: assets/market-close.js draws
// /market/ TODAY in the browser, functions/_market-date-page.js draws
// /market/YYYY-MM-DD/ on the server. They share one stylesheet and one look, so
// a change to one side has to reach the other. These tests render one payload
// through both and compare what must be the same; what differs on purpose is
// written down here, so a new difference fails instead of going unnoticed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { renderMarketDateMain } from '../functions/_market-date-page.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');
const LOCALE_JS = read('assets/locale.js');
const MARKET_JS = read('assets/market-close.js');
const CSS = read('assets/market-close.css');
const EXAMPLE = JSON.parse(read('contracts/market_close/market_close.example.json'));
const DATE = EXAMPLE.meta.market_date;

// The contract example plus every optional instrument the boards can show
// (Asian indices, VKOSPI, the newer FX pairs and commodities), each copied from
// a sibling and given a collector name unlike the site's, so the names test
// covers every code and shows that the site's own name wins on both pages.
const FIXTURE = (() => {
  const payload = structuredClone(EXAMPLE);
  const extra = {
    indices: { NIKKEI225: 'NASDAQ', SHANGHAI: 'NASDAQ', TAIEX: 'NASDAQ' },
    rates_fx_volatility: { VKOSPI: 'VIX', CNYKRW: 'JPYKRW', EURKRW: 'JPYKRW', USDJPY: 'DXY' },
    commodities_crypto: { BRENT: 'WTI', NATGAS: 'WTI', SILVER: 'GOLD', COMEX_COPPER: 'GOLD' }
  };
  for (const [group, codes] of Object.entries(extra)) {
    for (const [code, from] of Object.entries(codes)) {
      payload[group][code] = { ...structuredClone(payload[group][from]), symbol: code, name: `${code} 수집기 표기` };
    }
  }
  return payload;
})();

// That day's KOFIA yields and a trend that ends on the session, for every code of the record.
const RATES = {
  market_date: DATE, basis_time: '16:00', retrieved_at: `${DATE}T16:40:00+09:00`, source: '금융투자협회 최종호가수익률', published_at: '',
  items: [
    { code: 'KTB3Y', value: 3.642, previous_value: 3.716, change_bp: -7.4 },
    { code: 'KTB10Y', value: 3.857, previous_value: 3.942, change_bp: -8.5 },
    { code: 'CORPAA3Y', value: 4.329, previous_value: 4.39, change_bp: -6.1 },
    { code: 'CD91', value: 3.39, previous_value: 3.38, change_bp: 1 }
  ]
};
const TREND = (() => {
  const series = {};
  for (const group of ['indices', 'rates_fx_volatility', 'commodities_crypto']) {
    for (const [code, item] of Object.entries(FIXTURE[group] || {})) {
      if (typeof item?.close === 'number') series[code] = [item.close * 0.98, item.close * 1.01, item.close];
    }
  }
  for (const item of RATES.items) series[item.code] = [item.value + 0.05, item.value + 0.02, item.value];
  return { sessions: 20, end_date: DATE, dates: ['2026-08-26', '2026-08-27', DATE], series };
})();

function clientHtml(lang, payload = FIXTURE, trend = TREND) {
  const document = { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(LOCALE_JS, context);
  vm.runInContext(MARKET_JS, context);
  const target = { innerHTML: '' };
  window.MARKET_CLOSE.render(structuredClone(payload), target, { domesticRates: RATES, trend });
  return target.innerHTML;
}

function serverHtml(lang, payload = FIXTURE, trend = TREND) {
  return renderMarketDateMain(structuredClone(payload), lang, { domesticRates: RATES, trend, prev: '2026-08-27', next: null });
}

const text = (fragment) => fragment.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function blocks(html, open, close) {
  const found = [];
  for (let at = 0; ;) {
    const start = html.indexOf(open, at);
    if (start < 0) return found;
    const end = html.indexOf(close, start);
    assert.ok(end > start, `unclosed ${open}`);
    found.push(html.slice(start, end + close.length));
    at = end + close.length;
  }
}
const inner = (fragment, pattern) => text((fragment.match(pattern) || ['', ''])[1]);

// One quote-board row as { code, name, value, change, line }.
function rows(html) {
  return blocks(html, '<tr class="mk-row', '</tr>').map(row => ({
    code: (row.match(/data-(?:code|rate-code)="([A-Z0-9_]+)"/) || [])[1],
    name: inner(row, /<span class="mk-row-name">([\s\S]*?)<\/span>/),
    value: inner(row, /<td class="mk-row-value"><strong>([\s\S]*?)<\/strong>/),
    change: inner(row, /<td class="mk-row-change[^"]*">([\s\S]*?)<\/td>/),
    line: /<svg class="mk-spark"/.test(row)
  }));
}

// TODAY's Korean board names, which the session page uses too (2026-11-23).
// The record's own name is used for neither: GOLD was "국제 금" in the
// collector's earlier records and "금 선물" later.
const KO_BOARD_NAMES = {
  NASDAQ: '나스닥 종합', DOW: '다우존스', SP500: 'S&P 500', SOX: '필라델피아 반도체', NIKKEI225: '닛케이225', SHANGHAI: '상해종합', TAIEX: '대만 가권',
  VIX: 'VIX 변동성', VKOSPI: 'VKOSPI', US10Y: '미국 국채 10년', KTB3Y: '국고채 3년', KTB10Y: '국고채 10년', CORPAA3Y: '회사채 AA- 3년', CD91: 'CD 91일',
  USDKRW: '원/달러', JPYKRW: '원/100엔', CNYKRW: '원/위안', EURKRW: '원/유로', DXY: '달러인덱스', USDJPY: '엔/달러',
  WTI: 'WTI 원유', BRENT: '브렌트유', NATGAS: '천연가스', GOLD: '금 선물', SILVER: '은 선물', COMEX_COPPER: '구리 선물', BITCOIN: '비트코인'
};

for (const lang of ['ko', 'en']) {
  test(`${lang}: the quote boards hold the same rows, values, changes and trend lines on TODAY and on the session page`, () => {
    const client = clientHtml(lang);
    const server = serverHtml(lang);
    const boardIds = html => [...html.matchAll(/data-board="([a-z]+)"/g)].map(match => match[1]);
    assert.deepEqual(boardIds(client), ['world', 'rates', 'fx', 'commodities']);
    assert.deepEqual(boardIds(server), boardIds(client));

    const a = rows(client);
    const b = rows(server);
    // Every instrument the boards can show is in this payload.
    assert.deepEqual(a.map(row => row.code).sort(), Object.keys(KO_BOARD_NAMES).sort(), 'rows on TODAY');
    assert.deepEqual(b.map(row => row.code), a.map(row => row.code), 'row order');
    for (const [index, row] of a.entries()) {
      assert.equal(b[index].value, row.value, `${row.code} value`);
      assert.equal(b[index].change, row.change, `${row.code} change`);
      assert.equal(b[index].line, row.line, `${row.code} trend line`);
      assert.equal(row.line, true, `${row.code} has a trend line in this fixture`);
      assert.equal(b[index].name, row.name, `${row.code} name`);
      if (lang === 'ko') assert.equal(row.name, KO_BOARD_NAMES[row.code], `${row.code} Korean name`);
      assert.doesNotMatch(row.name, /수집기 표기|국제 금/, `${row.code} uses the site's name, not the record's`);
    }
  });

  test(`${lang}: index cards, flows, breadth, stats, the day in brief and the top 10 read the same on both`, () => {
    const client = clientHtml(lang);
    const server = serverHtml(lang);
    // The index cards differ only in their last line: TODAY states how fresh
    // the figure was at capture, a dated page calls it the close.
    const cards = html => blocks(html, '<article class="mk-card mk-index"', '</article>').map(card => text(card.replace(/<div class="mk-index-state">[\s\S]*?<\/div>/, '')));
    assert.equal(cards(client).length, 2);
    assert.deepEqual(cards(server), cards(client));

    const flowValues = html => [...html.matchAll(/class="mk-flow-value[^"]*">([^<]*)</g)].map(match => match[1]);
    assert.equal(flowValues(client).length, 18, 'the day and the last five sessions, three markets by three investors');
    assert.deepEqual(flowValues(server), flowValues(client));

    for (const [label, open, close] of [
      ['breadth', '<div class="mk-breadth"', '</div>\n    </div>'],
      ['stats', '<div class="mk-stat">', '</div>'],
      ['the day in brief', '<article class="mk-summary"', '</article>'],
      ['top 10', '<table class="mk-table mk-cap-table"', '</table>']
    ]) {
      const left = blocks(client, open, close).map(text);
      assert.ok(left.length > 0, `${label} on TODAY`);
      assert.deepEqual(blocks(server, open, close).map(text), left, label);
    }

    // Card titles: the session page adds the sectors and themes card, nothing else.
    const titles = html => blocks(html, '<div class="mk-card-head">', '</div>').map(head => inner(head, /<h3[^>]*>([\s\S]*?)<\/h3>/));
    const groupsTitle = lang === 'en' ? 'KRX Sectors & Themes' : 'KRX 업종 · 테마 등락률';
    assert.deepEqual(titles(server).filter(title => title !== groupsTitle), titles(client));
    assert.ok(titles(server).includes(groupsTitle));
    const sections = html => blocks(html, '<div class="mk-section-head">', '</div>').map(text);
    assert.deepEqual(sections(server), sections(client));
  });
}

test('both renderers use the same mk- classes, and every one of them is styled', () => {
  const classes = html => new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/)).filter(name => name.startsWith('mk-')));
  const client = classes(clientHtml('ko'));
  const server = classes(serverHtml('ko'));
  // What only one of the two pages has: the date bar with its calendar and view
  // buttons, the flow toggle, the phone board tabs and the fixing-versus-latest
  // line on TODAY; the static boards, sub-headings and the sectors card on a
  // session page.
  const CLIENT_ONLY = ['mk-archive-link', 'mk-board-tab', 'mk-board-tabs', 'mk-caret', 'mk-date-btn', 'mk-datebar-label', 'mk-datebar-modes', 'mk-datebar-nav', 'mk-fixing', 'mk-flow-panel', 'mk-lead', 'mk-step', 'mk-step-text', 'mk-toggle', 'mk-toggle-btn'];
  const SERVER_ONLY = ['mk-boards-static', 'mk-card-link', 'mk-grid-full', 'mk-groups-card', 'mk-subhead'];
  assert.deepEqual([...client].filter(name => !server.has(name)).sort(), CLIENT_ONLY);
  assert.deepEqual([...server].filter(name => !client.has(name)).sort(), SERVER_ONLY);

  // Hooks that carry no rule of their own (their parts are styled through other classes).
  const UNSTYLED_HOOKS = new Set(['mk-breadth-card', 'mk-cap-table', 'mk-datebar-nav', 'mk-flow-panel', 'mk-groups-card', 'mk-index', 'mk-row', 'mk-stats-card']);
  for (const name of new Set([...client, ...server])) {
    const styled = new RegExp(`\\.${name}(?![\\w-])`).test(CSS);
    assert.ok(styled || UNSTYLED_HOOKS.has(name), `${name} has no rule in market-close.css`);
  }
});

test('a session without that day’s VIX draws no VIX line on either page', () => {
  const payload = structuredClone(FIXTURE);
  payload.rates_fx_volatility.VIX = { ...payload.rates_fx_volatility.VIX, close: null, change: null, change_pct: null };
  const trend = { ...TREND, series: { ...TREND.series, VIX: [18.2, 19.1, null] } };
  const vix = html => rows(html).find(row => row.code === 'VIX');
  const client = clientHtml('ko', payload, trend);
  assert.equal(vix(client).line, false, 'TODAY');
  assert.equal(vix(serverHtml('ko', payload, trend)).line, false, 'session page');
  // The other rows keep theirs.
  assert.equal(rows(client).find(row => row.code === 'NASDAQ').line, true);
});

test('the same four labels link to their glossary entries on TODAY and on the session page', async () => {
  const { glossaryTermHref } = await import('../functions/_glossary.js');
  const termLinks = html => [...html.matchAll(/<a class="mk-term" href="([^"]+)">([^<]+)<\/a>/g)].map(([, href, label]) => ({ href, label }));
  const expected = {
    ko: [['시장 폭', '시장 폭'], ['프로그램 순매수', '프로그램 매매'], ['베이시스', '베이시스'], ['공매도 비중 · 코스피', '공매도'], ['공매도 비중 · 코스닥', '공매도']],
    en: [['Market Breadth', 'Market Breadth'], ['Program net buy', 'Program Trading'], ['Basis', 'Basis'], ['Short ratio · KOSPI', 'Short Selling'], ['Short ratio · KOSDAQ', 'Short Selling']]
  };
  for (const lang of ['ko', 'en']) {
    const client = termLinks(clientHtml(lang));
    // The browser builds the address itself; it must be the glossary's own id for that term.
    assert.deepEqual(client, expected[lang].map(([label, term]) => ({ href: glossaryTermHref(term, lang), label })), lang);
    assert.deepEqual(termLinks(serverHtml(lang)), client, `${lang} session page`);
  }
});
