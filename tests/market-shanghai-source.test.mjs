// The Shanghai Composite close in a 16:05 KST record: Yahoo confirms SSE's
// closing-auction close only around 16:20 KST, so the collector takes the same
// session's close from Tencent Securities' real-time quote when Yahoo has not
// confirmed it yet (publisher, fix/shanghai-close-fallback). The pages name
// that source wherever the record's sources are listed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { MARKET_INDICATORS, marketDatePageHtml, marketIndicatorPageHtml } from '../functions/_market-date-page.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [EXAMPLE, SHELL_KO, SHELL_EN, LOCALE_JS, MARKET_JS] = await Promise.all([
  read('contracts/market_close/market_close.example.json'), read('market/index.html'), read('en/market/index.html'),
  read('assets/locale.js'), read('assets/market-close.js')
]);
const SHELLS = { ko: SHELL_KO, en: SHELL_EN };
const TENCENT = '텐센트 증권 실시간 시세 · sh000001';

function payload(source) {
  const data = JSON.parse(EXAMPLE);
  // A Shanghai close of the record's own date, as the 1.2.0 collector writes it.
  data.indices.SHANGHAI = { ...structuredClone(data.indices.NASDAQ), symbol: '000001.SS', name: '상해종합', close: 3476.47, previous_close: 3548.37, source_date: data.meta.market_date, source };
  return data;
}

const note = html => (html.match(/<div class="market-data-note"><p>([^<]*)<\/p>/) || [])[1] || '';

test('the session page names Tencent Securities only when the record’s Shanghai close came from it', () => {
  assert.equal(note(marketDatePageHtml(SHELLS.ko, payload(TENCENT), 'ko', {})), '데이터 출처: KRX 한국거래소, 네이버 금융, 야후 파이낸스, 텐센트 증권(상해종합)');
  assert.equal(note(marketDatePageHtml(SHELLS.en, payload(TENCENT), 'en', {})), 'Sources: KRX, Naver Finance, Yahoo Finance, Tencent Securities (Shanghai Composite)');
  assert.equal(note(marketDatePageHtml(SHELLS.ko, payload('Yahoo Finance · 000001.SS'), 'ko', {})), '데이터 출처: KRX 한국거래소, 네이버 금융, 야후 파이낸스');
  assert.equal(note(marketDatePageHtml(SHELLS.ko, JSON.parse(EXAMPLE), 'ko', {})), '데이터 출처: KRX 한국거래소, 네이버 금융, 야후 파이낸스');
});

test('TODAY lists Tencent Securities among the record’s sources, in English too', () => {
  for (const [lang, expected] of [['ko', '텐센트 증권 실시간 시세'], ['en', 'Tencent Securities real-time quotes']]) {
    const document = { documentElement: { dataset: { siteLang: lang } }, body: { dataset: {} }, readyState: 'loading', addEventListener() {}, getElementById() { return null; } };
    const window = {};
    const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
    vm.runInContext(LOCALE_JS, context);
    vm.runInContext(MARKET_JS, context);
    const target = { innerHTML: '' };
    window.MARKET_CLOSE.render(payload(TENCENT), target, {});
    const line = note(target.innerHTML);
    assert.ok(line.includes(expected), `${lang}: ${line}`);
    assert.doesNotMatch(line, /sh000001/);
  }
});

test('the Shanghai history page states both sources of its close', () => {
  const shanghai = MARKET_INDICATORS.find(item => item.code === 'SHANGHAI');
  const series = [{ date: '2026-11-25', recordDate: '2026-11-25', publishedAt: '', close: 3476.47, change: -71.9, changePct: -2.03, high: null, low: null }];
  assert.match(marketIndicatorPageHtml(SHELLS.ko, shanghai, series, 'ko'), /야후 파이낸스, 마감 기록 시점에 종가가 확정되지 않았으면 텐센트 증권 실시간 시세/);
  assert.match(marketIndicatorPageHtml(SHELLS.en, shanghai, series, 'en'), /Tencent Securities real-time quotes when Yahoo had not confirmed the close/);
});
