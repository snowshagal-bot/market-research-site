// Indicator guides (2026-11-26, KOSPI first): a page people reach from search
// gets the latest session's line with links to that day's record and Daily,
// and a hand-written "about" section with glossary links and related Market
// Basics reads. Pages without a guide are unchanged.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import {
  INDICATOR_GUIDES,
  MARKET_INDICATORS,
  guideReads,
  marketIndicatorPageHtml,
  onMarketPageRequest
} from '../functions/_market-date-page.js';
import { glossaryEntries, glossaryTermId } from '../functions/_glossary.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [SHELL_KO, SHELL_EN, POSTS_JSON, GLOSSARY_JSON, MC_EXAMPLE, CSS] = await Promise.all([
  read('market/index.html'), read('en/market/index.html'), read('data/posts.json'), read('data/glossary.json'),
  read('contracts/market_close/market_close.example.json'), read('assets/market-close.css')
]);
const SHELLS = { ko: SHELL_KO, en: SHELL_EN };
const POSTS = JSON.parse(POSTS_JSON);
const GLOSSARY = JSON.parse(GLOSSARY_JSON);
const KOSPI = MARKET_INDICATORS.find(item => item.code === 'KOSPI');
const NASDAQ = MARKET_INDICATORS.find(item => item.code === 'NASDAQ');
const byCode = code => MARKET_INDICATORS.find(item => item.code === code);
const SERIES = [
  { date: '2026-11-25', recordDate: '2026-11-25', publishedAt: '2026-11-25T07:10:00Z', close: 4697.51, change: -308.52, changePct: -6.16, high: 4950.1, low: 4690.2 },
  { date: '2026-11-24', recordDate: '2026-11-24', publishedAt: '2026-11-24T07:10:00Z', close: 5006.03, change: 297.49, changePct: 6.32, high: 5010.2, low: 4790.1 }
];
const LATEST = {
  ko: { date: '2026-11-25', line: '미국 반도체 하루 만에 반락, 코스피 6% 급락해 전날 상승분 모두 반납', report: { url: '/reports/2026-11-25_Daily' } },
  en: { date: '2026-11-25', line: 'U.S. chips reverse, and the KOSPI gives back the whole previous day.', report: null }
};

const block = (html, open) => {
  const start = html.indexOf(open);
  return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start) + 10);
};

test('every guide link resolves: glossary terms exist in that language, related reads exist (with the English translation)', () => {
  for (const [code, guide] of Object.entries(INDICATOR_GUIDES)) {
    assert.ok(MARKET_INDICATORS.some(item => item.code === code), code);
    for (const lang of ['ko', 'en']) {
      const ids = new Set(glossaryEntries(POSTS, GLOSSARY, lang).map(entry => glossaryTermId(entry.term)));
      const terms = guide[lang].paragraphs.flatMap(text => [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(match => match[2] || match[1]));
      assert.ok(terms.length >= 3, `${code} ${lang} links some terms`);
      for (const term of terms) assert.ok(ids.has(glossaryTermId(term)), `${code} ${lang}: "${term}" is in the glossary`);
      assert.equal(guideReads(guide, POSTS, lang).length, guide.related.length, `${code} ${lang}: every related read resolves`);
    }
  }
});

test('the KOSPI page: the latest session block first, then the summary, the chart and "코스피란" with glossary links and reads', () => {
  const ko = marketIndicatorPageHtml(SHELLS.ko, KOSPI, SERIES, 'ko', undefined, { posts: POSTS, latest: LATEST.ko });
  const latest = block(ko, '<section class="indicator-latest"');
  assert.match(latest, /<h2 id="indicator-latest-title">11월 25일 마감<\/h2>/);
  assert.match(latest, /<p class="indicator-latest-line">미국 반도체 하루 만에 반락, 코스피 6% 급락해 전날 상승분 모두 반납<\/p>/);
  assert.match(latest, /<a href="\/market\/2026-11-25\/">그날 전체 마감 기록 →<\/a><a href="\/reports\/2026-11-25_Daily">이날의 데일리 리포트 ↗<\/a>/);
  assert.ok(ko.indexOf('indicator-latest') < ko.indexOf('market-section-1'), 'the block comes before the summary');
  const about = block(ko, '<section class="market-section" aria-labelledby="market-section-3"');
  assert.match(about, /<span>03\.<\/span> 코스피란<\/h2>/);
  assert.match(about, /<a class="mk-term" href="\/basics\/glossary\/#term-시가총액-가중">시가총액 가중<\/a>/);
  assert.match(about, /<a class="mk-term" href="\/basics\/glossary\/#term-종가">종가<\/a>/);
  assert.match(about, /<h3>함께 읽기<\/h3>/);
  assert.match(about, /<a href="\/reports\/basics-16-index">지수는 무엇으로 만드나<\/a>/);
  assert.ok(ko.indexOf('market-section-3') < ko.indexOf('indicator-table-note'), 'before the monthly tables');

  const en = marketIndicatorPageHtml(SHELLS.en, KOSPI, SERIES, 'en', undefined, { posts: POSTS, latest: LATEST.en });
  assert.match(block(en, '<section class="indicator-latest"'), /<h2 id="indicator-latest-title">Close on Nov 25<\/h2>[\s\S]*?Full close record for the day →<\/a><\/p>/);
  assert.doesNotMatch(block(en, '<section class="indicator-latest"'), /Daily report/);
  assert.match(en, /What is the KOSPI\?<\/h2>/);
  assert.match(en, /<a class="mk-term" href="\/en\/basics\/glossary\/#term-closing-price">closing price<\/a>/);
  assert.match(en, /href="\/reports\/en\/Snowshagal_Market_Basics_16_What_Goes_Into_a_Stock_Index_EN">What Goes Into a Stock Index\?<\/a>/);
  assert.doesNotMatch(en, /코스피란|함께 읽기|그날 전체 마감 기록/);
});

test('without posts or a line the block still links the session; pages without a guide are unchanged', () => {
  const bare = marketIndicatorPageHtml(SHELLS.ko, KOSPI, SERIES, 'ko', undefined, { latest: { date: '2026-11-25', line: '', report: null } });
  assert.match(block(bare, '<section class="indicator-latest"'), /<h2 id="indicator-latest-title">11월 25일 마감<\/h2>\s*<p class="indicator-latest-links"><a href="\/market\/2026-11-25\/">/);
  assert.doesNotMatch(bare, /<h3>함께 읽기<\/h3>/);
  assert.match(bare, /코스피란<\/h2>/);
  const nasdaq = marketIndicatorPageHtml(SHELLS.ko, NASDAQ, SERIES, 'ko', undefined, { posts: POSTS, latest: LATEST.ko });
  assert.doesNotMatch(nasdaq, /indicator-latest|indicator-guide|market-section-3/);
  for (const name of ['indicator-latest', 'indicator-latest-line', 'indicator-latest-links', 'indicator-guide', 'indicator-guide-reads']) {
    assert.match(CSS, new RegExp(`\\.${name}[{ ,:]`), `${name} is styled`);
  }
});

test('KOSDAQ, VKOSPI, USD/KRW, investor deposits, margin loans and forced selling carry their own guide; the three Market Funds pages have no latest-session block', () => {
  const titles = {
    KOSDAQ: ['코스닥이란', 'What is the KOSDAQ?', '/reports/basics-16-index'],
    VKOSPI: ['VKOSPI란', 'What is the VKOSPI?', '/reports/basics-21-expiration-day'],
    USDKRW: ['원/달러 환율이란', 'What is the USD/KRW rate?', '/reports/20261009_Investment_Note_Won_Strength_Bill'],
    DEPOSITS: ['투자자예탁금이란', 'What are investor deposits?', '/reports/basics-13-deposits'],
    CREDIT: ['신용융자 잔고란', 'What are margin loans?', '/reports/basics-20-margin-call'],
    FORCED_SALE: ['반대매매 금액이란', 'What is the forced-selling figure?', '/reports/basics-data-guide-02-margin-call-by-broker']
  };
  for (const [code, [ko, en, read]] of Object.entries(titles)) {
    const indicator = byCode(code);
    const funds = ['DEPOSITS', 'CREDIT', 'FORCED_SALE'].includes(code);
    const latest = funds ? undefined : LATEST.ko;
    const page = marketIndicatorPageHtml(SHELLS.ko, indicator, SERIES, 'ko', undefined, { posts: POSTS, latest });
    const about = block(page, '<section class="market-section" aria-labelledby="market-section-3"');
    assert.ok(about.includes(`<span>03.</span> ${ko}</h2>`), `${code} ko title`);
    assert.ok(about.includes('<a class="mk-term" href="/basics/glossary/#term-'), `${code} ko terms`);
    assert.ok(about.includes(`<a href="${read}">`), `${code} ko read`);
    if (funds) assert.doesNotMatch(page, /indicator-latest/);
    else assert.match(block(page, '<section class="indicator-latest"'), /11월 25일 마감/, code);
    const english = marketIndicatorPageHtml(SHELLS.en, indicator, SERIES, 'en', undefined, { posts: POSTS });
    assert.ok(english.includes(`${en}</h2>`), `${code} en title`);
    assert.ok(english.includes('<a class="mk-term" href="/en/basics/glossary/#term-'), `${code} en terms`);
    assert.ok(!english.includes(ko) && !english.includes('함께 읽기'), `${code} en has no Korean guide text`);
  }
});

test('the route: /market/kospi/ carries the record’s own line, else the Daily’s, and the Daily link', async () => {
  const db = new SqliteD1();
  db.database.prepare(`CREATE TABLE market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  const insert = (date, takeaway) => {
    const payload = JSON.parse(MC_EXAMPLE);
    payload.meta.market_date = date;
    payload.meta.status = 'final';
    db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko) VALUES (?, ?, ?, 'final', ?, ?, 'test', ?)`)
      .run(date, payload.meta.schema_version, payload.meta.generated_at, JSON.stringify(payload), `${date}T07:10:00Z`, takeaway);
  };
  insert('2026-11-24', '');
  insert('2026-11-25', '');
  const daily = { id: 'd-1125', type: 'daily', lang: 'ko', reportDate: '2026-11-25', date: '2026-11-25', title: '데일리', href: 'reports/2026-11-25_Daily.html', takeaway: '데일리의 한 줄' };
  const route = async (posts) => {
    const response = await onMarketPageRequest({
      request: new Request('https://snowshagal.com/market/kospi/'),
      env: { COMMENTS_DB: db, ASSETS: { fetch: async () => new Response(SHELLS.ko) } },
      next: async () => new Response('static')
    }, { loadPostsFn: async () => posts });
    assert.equal(response.status, 200);
    return block(await response.text(), '<section class="indicator-latest"');
  };
  const fromDaily = await route([daily]);
  assert.match(fromDaily, /<p class="indicator-latest-line">데일리의 한 줄<\/p>/);
  assert.match(fromDaily, /<a href="\/reports\/2026-11-25_Daily">이날의 데일리 리포트 ↗<\/a>/);
  db.database.prepare(`UPDATE market_close_snapshots SET takeaway_ko = '기록에 넣은 한 줄' WHERE market_date = '2026-11-25'`).run();
  assert.match(await route([daily]), /<p class="indicator-latest-line">기록에 넣은 한 줄<\/p>/);
  // No posts at all: the block still names the session.
  assert.match(await route([]), /<a href="\/market\/2026-11-25\/">그날 전체 마감 기록 →<\/a><\/p>/);
});
