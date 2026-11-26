// KRW pairs (2026-11-26). A record's close for USD/KRW, JPY/KRW, CNY/KRW and
// EUR/KRW is Hana Bank's posted rate from its last round before 15:30 KST, and
// its previous_close is the same series on the previous business day. The
// collector's own `change` is a Yahoo quote at capture minus that previous rate
// (two series), so every reader now takes the move from close and previous
// close, and no page calls the bank's rate "15:30 매매기준율" — 3편 of the data
// guide teaches that the 15:30 rate, the official 매매기준율 and a bank's
// posted rate are three different numbers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { KRW_PAIR_CODES, normalizeKrwPairs } from '../functions/api/market/_shared.js';
import { onRequestGet as dateRequest } from '../functions/api/market/date.js';
import { INDICATOR_GUIDES, onMarketPageRequest } from '../functions/_market-date-page.js';
import '../assets/locale.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [EXAMPLE, SHELL_KO, SHELL_EN, MARKET_JS, DATE_PAGE_JS, CARD_JS, SHARE_JS] = await Promise.all([
  read('contracts/market_close/market_close.example.json'), read('market/index.html'), read('en/market/index.html'),
  read('assets/market-close.js'), read('functions/_market-date-page.js'), read('functions/_market-card.js'), read('functions/_market-share-text.js')
]);
const L = globalThis.MARKET_LOCALE;

// 2026-11-23 as recorded: Hana 1,346.80 against 1,336.00 on 11-20, while the
// record's own change was a 16:05 Yahoo quote (1,344.88) minus 1,336.00.
function record(date = '2026-11-23') {
  const payload = JSON.parse(EXAMPLE);
  payload.meta.market_date = date;
  payload.meta.status = 'final';
  Object.assign(payload.rates_fx_volatility.USDKRW, { close: 1346.8, current: 1344.88, previous_close: 1336, change: 8.88, change_pct: 0.665, source_date: date });
  return payload;
}

test('normalizeKrwPairs: the move is close against previous close, for the four KRW pairs only', () => {
  const payload = record();
  const vix = { ...payload.rates_fx_volatility.VIX };
  payload.rates_fx_volatility.EURKRW = { close: 1480.87, previous_close: 1467.46, change: 10.54, change_pct: 0.72 };
  payload.rates_fx_volatility.CNYKRW = { close: 201.88, previous_close: null, change: 1.68, change_pct: 0.84 };
  normalizeKrwPairs(payload);
  const usd = payload.rates_fx_volatility.USDKRW;
  assert.equal(Number(usd.change.toFixed(2)), 10.8);
  assert.equal(Number(usd.change_pct.toFixed(3)), 0.808);
  assert.equal(Number(payload.rates_fx_volatility.EURKRW.change.toFixed(2)), 13.41);
  // Without the previous posted rate there is no move, never the mixed one.
  assert.equal(payload.rates_fx_volatility.CNYKRW.change, null);
  assert.equal(payload.rates_fx_volatility.CNYKRW.change_pct, null);
  assert.deepEqual(payload.rates_fx_volatility.VIX, vix, 'other instruments are untouched');
  assert.deepEqual([...KRW_PAIR_CODES], ['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW']);
  assert.equal(normalizeKrwPairs(null), null);
});

test('the API, the session page and the history page show the same 11-23 move', async () => {
  const db = new SqliteD1();
  db.database.prepare(`CREATE TABLE market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  for (const date of ['2026-11-20', '2026-11-23']) {
    const payload = record(date);
    if (date === '2026-11-20') Object.assign(payload.rates_fx_volatility.USDKRW, { close: 1336, previous_close: 1330.2, change: 5.69, change_pct: 0.428 });
    db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source) VALUES (?, ?, ?, 'final', ?, ?, 'test')`)
      .run(date, payload.meta.schema_version, payload.meta.generated_at, JSON.stringify(payload), `${date}T07:10:00Z`);
  }
  const env = { COMMENTS_DB: db, ASSETS: { fetch: async request => new Response(new URL(request.url).pathname.startsWith('/en/') ? SHELL_EN : SHELL_KO) } };

  const api = await (await dateRequest({ request: new Request('https://snowshagal.com/api/market/date?date=2026-11-23'), env })).json();
  assert.equal(Number(api.rates_fx_volatility.USDKRW.change.toFixed(2)), 10.8);

  const page = async path => (await onMarketPageRequest({ request: new Request(`https://snowshagal.com${path}`), env, next: async () => new Response('static') }, { loadPostsFn: async () => [] })).text();
  const session = await page('/market/2026-11-23/');
  const usdRow = session.slice(session.indexOf('data-code="USDKRW"'), session.indexOf('</tr>', session.indexOf('data-code="USDKRW"')));
  assert.match(usdRow, /1,346\.80원/);
  assert.match(usdRow, /▲ 10\.80 <span>\(\+0\.81%\)<\/span>/);
  assert.match(usdRow, /2026\.11\.23 · 하나은행 고시/);
  assert.doesNotMatch(usdRow, /8\.88/);
  assert.match(session, /<small>[^<]*하나은행 고시\(15:30 직전\)<\/small>/);
  assert.match(session, /원화는 하나은행 고시\(15:30 직전 회차\)/);

  const history = await page('/market/usdkrw/');
  assert.match(history, /하나은행 고시 매매기준율\(15:30 직전 회차, 네이버 금융\) · 대비는 전 거래일 고시값 대비/);
  assert.match(history, /<a href="\/market\/2026-11-23\/">11월 23일\(월\)<\/a><\/th><td>1,346\.80원<\/td><td><span class="up">\+10\.80<\/span>/);
  const english = await page('/en/market/usdkrw/');
  assert.match(english, /Hana Bank posted rate, last round before 15:30 KST/);
  assert.doesNotMatch(english, /15:30 rate|reference rate \(Hana/);
});

test('no page calls a bank\'s rate "15:30 매매기준율", "15:30 환율" or a "15:30 fixing"', () => {
  for (const [name, source] of Object.entries({ MARKET_JS, DATE_PAGE_JS, CARD_JS, SHARE_JS })) {
    assert.doesNotMatch(source, /15:30 매매기준율|15:30 환율|15:30 fixing|15:30 reference rate|'15:30 rate'/, name);
  }
  // The USD/KRW guide names the three numbers 3편 teaches and says which this is.
  const ko = INDICATOR_GUIDES.USDKRW.ko.paragraphs.join(' ');
  assert.match(ko, /오후 3시 30분 기준가도, 서울외국환중개가 고시하는 공식 \[\[매매기준율\]\]도 아닙니다/);
  assert.match(ko, /은행 고시 매매기준율/);
  assert.doesNotMatch(ko, /고시한 \[\[매매기준율\]\]/);
  assert.match(INDICATOR_GUIDES.USDKRW.en.paragraphs.join(' '), /neither the Seoul FX market’s 3:30 p\.m\. rate nor the official/);
});

test('a live KRW quote stands in only before that day\'s record, and says it is live', () => {
  const live = (asOf) => ({ code: 'USDKRW', ticker: 'KRW=X', value: 1343.51, previous_close: 1342.65, change: 0.86, change_pct: (1343.51 / 1342.65 - 1) * 100, source_date: asOf.slice(0, 10), as_of: asOf, retrieved_at: asOf, data_state: 'intraday' });
  const payloadOf = date => ({ rates_fx_volatility: { USDKRW: { source_date: date, retrieved_at: `${date}T07:05:00Z`, close: 1342.7 } } });
  // 17:00 KST on 11-26, after the 11-26 record: the record stays.
  assert.equal(L.globalLatestOverlay([live('2026-11-26T08:00:00Z')], payloadOf('2026-11-26'), '2026-11-26T08:10:00Z').reasons.USDKRW, 'record_covers_session');
  // 11:00 KST on 11-27, before the 11-27 record: the live quote stands in.
  assert.equal(L.globalLatestOverlay([live('2026-11-27T02:00:00Z')], payloadOf('2026-11-26'), '2026-11-27T02:10:00Z').reasons.USDKRW, 'fresh');
  // 08:30 KST on 11-27 is still a later KST day than the record, even though the UTC date is 11-26.
  assert.equal(L.globalLatestOverlay([live('2026-11-26T23:30:00Z')], payloadOf('2026-11-26'), '2026-11-26T23:40:00Z').reasons.USDKRW, 'fresh');
  // Other instruments keep their own rule.
  const dxy = { ...live('2026-11-26T08:00:00Z'), code: 'DXY', ticker: 'DX-Y.NYB', value: 99.1, previous_close: 99, change: 0.1, change_pct: (99.1 / 99 - 1) * 100 };
  assert.equal(L.globalLatestOverlay([dxy], { rates_fx_volatility: { DXY: { source_date: '2026-11-26', retrieved_at: '2026-11-26T07:05:00Z' } } }, '2026-11-26T08:10:00Z').reasons.DXY, 'fresh');

  assert.equal(L.todayStripBasis('latest', { code: 'USDKRW', source_date: '2026-11-27', data_state: 'intraday' }, 'ko'), '11/27 · 실시간(야후)');
  assert.equal(L.todayStripBasis('latest', { code: 'USDKRW', source_date: '2026-11-27', data_state: 'intraday' }, 'en'), 'NOV 27 · LIVE (YAHOO)');
  assert.equal(L.todayStripBasis('snapshot', { source_date: '2026-11-26', data_state: 'intraday' }, 'ko', 'USDKRW'), '11/26 · 하나은행 고시');
  assert.equal(L.todayStripBasis('snapshot', { source_date: '2026-11-26', data_state: 'final_close' }, 'ko', 'GOLD'), '11/26 · 종가');
  assert.equal(L.todayStripBasis('latest', { code: 'GOLD', source_date: '2026-11-26', data_state: 'intraday' }, 'ko'), '11/26 · 장중');
});

test('3편 is linked from /market/usdkrw/, every session page and TODAY, in each language', async () => {
  assert.deepEqual(L.usdkrwGuide('ko'), { href: '/reports/basics-data-guide-03-usdkrw-closing-rate', text: '이 숫자는 몇 시 값인가 → 환율 숫자 읽는 법' });
  assert.equal(L.usdkrwGuide('en').href, '/reports/en/basics-data-guide-03-usdkrw-closing-rate_EN');

  const db = new SqliteD1();
  db.database.prepare(`CREATE TABLE market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  const payload = record('2026-11-23');
  db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source) VALUES (?, ?, ?, 'final', ?, ?, 'test')`)
    .run('2026-11-23', payload.meta.schema_version, payload.meta.generated_at, JSON.stringify(payload), '2026-11-23T07:10:00Z');
  const env = { COMMENTS_DB: db, ASSETS: { fetch: async request => new Response(new URL(request.url).pathname.startsWith('/en/') ? SHELL_EN : SHELL_KO) } };
  const page = async path => (await onMarketPageRequest({ request: new Request(`https://snowshagal.com${path}`), env, next: async () => new Response('static') }, { loadPostsFn: async () => [] })).text();

  const ko = '<a href="/reports/basics-data-guide-03-usdkrw-closing-rate">이 숫자는 몇 시 값인가 → 환율 숫자 읽는 법</a>';
  const en = '<a href="/reports/en/basics-data-guide-03-usdkrw-closing-rate_EN">What time is this number? → How to read the USD/KRW rate</a>';
  // /market/usdkrw/: right under the basis line, only on USD/KRW.
  const history = await page('/market/usdkrw/');
  assert.ok(history.includes(`<p class="mk-guide-link">${ko}</p>`));
  assert.ok(history.indexOf('mk-guide-link') > history.indexOf('class="mk-meta"') && history.indexOf('mk-guide-link') < history.indexOf('</section>', history.indexOf('class="mk-meta"')));
  assert.ok((await page('/en/market/usdkrw/')).includes(`<p class="mk-guide-link">${en}</p>`));
  assert.ok(!(await page('/market/jpykrw/')).includes('mk-guide-link'));
  // A session page: under the USD/KRW summary note and under the FX board.
  const session = await page('/market/2026-11-23/');
  assert.ok(session.includes(`<a class="mk-summary-guide" href="/reports/basics-data-guide-03-usdkrw-closing-rate">`));
  const fxBoard = session.slice(session.indexOf('data-board="fx"'), session.indexOf('</section>', session.indexOf('data-board="fx"')));
  assert.ok(fxBoard.includes(`<p class="mk-board-guide">${ko}</p>`));
  assert.ok((await page('/en/market/2026-11-23/')).includes(`<p class="mk-board-guide">${en}</p>`));
  // TODAY draws the same two links.
  for (const call of ["usdkrwGuideLink('mk-summary-guide')", '<p class="mk-board-guide">${usdkrwGuideLink()}</p>']) assert.ok(MARKET_JS.includes(call), call);
});
