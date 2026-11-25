// /market/investor-flows/ (2026-11-26): net buying by foreign, institutional and
// retail investors at one address — the newest session, its last five published
// sessions, the month so far and foreign net buying by month — from the final
// Market Close rows' krx_investor_trading. Sums add published sessions only and
// say how many of the month's KRX trading days they cover.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import {
  FLOWS_GUIDE,
  guideReads,
  marketFlowsDescription,
  marketFlowsPageHtml,
  marketFlowsTitle,
  marketFlowsView,
  onMarketPageRequest,
  parseMarketPagePath
} from '../functions/_market-date-page.js';
import { glossaryEntries, glossaryTermId } from '../functions/_glossary.js';
import { siteFooter } from '../functions/_footer.js';
import { sitemapXml } from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [SHELL_KO, SHELL_EN, POSTS_JSON, GLOSSARY_JSON, MC_EXAMPLE, MARKET_JS, CSS] = await Promise.all([
  read('market/index.html'), read('en/market/index.html'), read('data/posts.json'), read('data/glossary.json'),
  read('contracts/market_close/market_close.example.json'), read('assets/market-close.js'), read('assets/market-close.css')
]);
const SHELLS = { ko: SHELL_KO, en: SHELL_EN };
const POSTS = JSON.parse(POSTS_JSON);
const GLOSSARY = JSON.parse(GLOSSARY_JSON);

/** A final row: KOSPI and KOSDAQ net buying [foreign, institution, retail] in KRW billion. */
function row(date, kospi, kosdaq = [1, 2, 3], futures = [10, -5, -5]) {
  const investors = ([foreign, institution, individual]) => ({ 외국인: { net_buy: foreign }, 기관: { net_buy: institution }, 개인: { net_buy: individual } });
  return {
    market_date: date,
    published_at: `${date}T07:10:00Z`,
    flows: { KOSPI: { investors: investors(kospi) }, KOSDAQ: { investors: investors(kosdaq) }, KOSPI200선물: { investors: investors(futures) } }
  };
}

// Newest first. November 2026 has 18 KRX trading days to the 25th; 11-06 has no record.
const NOVEMBER = ['2026-11-25', '2026-11-24', '2026-11-23', '2026-11-20', '2026-11-19', '2026-11-18', '2026-11-17', '2026-11-16', '2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02'];
const ROWS = [
  ...NOVEMBER.map((date, index) => row(date, [-(index + 1) * 100, 50, 40])),
  row('2026-10-30', [500, -200, -300]),
  row('2026-10-29', [-100, 100, 0])
];

test('the route: /market/investor-flows/ and /en/market/investor-flows/', () => {
  assert.deepEqual(parseMarketPagePath('/market/investor-flows/'), { lang: 'ko', flows: true, canonical: true });
  assert.deepEqual(parseMarketPagePath('/en/market/investor-flows'), { lang: 'en', flows: true, canonical: false });
  assert.equal(parseMarketPagePath('/market/investor-flow/'), null);
});

test('the view: the newest session, five published sessions with their total, months with their KRX trading days', () => {
  const view = marketFlowsView(ROWS);
  assert.equal(view.date, '2026-11-25');
  assert.deepEqual(view.recent.map(item => item.date), ['2026-11-25', '2026-11-24', '2026-11-23', '2026-11-20', '2026-11-19']);
  assert.deepEqual(view.recentTotals.KOSPI, { 외국인: -1500, 기관: 250, 개인: 200 });
  assert.deepEqual(view.recentTotals.KOSDAQ, { 외국인: 5, 기관: 10, 개인: 15 });
  const [november, october] = view.months;
  assert.equal(november.month, '2026-11');
  assert.equal(november.sessions, 17);
  assert.equal(november.expected, 18, 'November 2 to 25 has 18 KRX trading days; 11-06 has no record');
  assert.equal(november.totals.KOSPI['외국인'], -(17 * 18 / 2) * 100);
  assert.deepEqual([november.start, november.end], ['2026-11-02', '2026-11-25']);
  // The first month on record counts from its first record, not from the 1st.
  assert.deepEqual([october.month, october.sessions, october.expected, october.totals.KOSPI['외국인']], ['2026-10', 2, 2, 400]);
  // A session missing a figure is left out; a sum over a gap is not invented.
  const gap = marketFlowsView([ROWS[0], { ...ROWS[1], flows: null }, ...ROWS.slice(2)]);
  assert.deepEqual(gap.recent.map(item => item.date), ['2026-11-25', '2026-11-23', '2026-11-20', '2026-11-19', '2026-11-18']);
  const partial = marketFlowsView([row('2026-11-25', [-100, 50, 40], [1, null, 3]), ...ROWS.slice(1)]);
  assert.equal(partial.recentTotals.KOSDAQ['기관'], null);
  // Nothing to show when the newest session has no figure.
  assert.equal(marketFlowsView([{ ...ROWS[0], flows: null }, ...ROWS.slice(1)]), null);
  assert.equal(marketFlowsView([]), null);
});

test('the page: title and description name the day’s figures; the five parts and their notes', () => {
  const view = marketFlowsView(ROWS);
  assert.equal(marketFlowsTitle(view, 'ko'), '오늘 외국인 순매수·순매도 (11월 25일) · 코스피·코스닥 투자자별 매매동향 | Snowshagal');
  assert.equal(marketFlowsTitle(view, 'en'), 'Korea Foreign Investor Net Buying, Nov 25, 2026: KOSPI & KOSDAQ Flows | Snowshagal');
  const description = marketFlowsDescription(view, 'ko');
  assert.ok(description.length <= 180, description);
  assert.match(description, /^2026년 11월 25일 투자자별 순매수\. 코스피 외국인 −1,000억원, 기관 \+500억원, 개인 \+400억원\./);

  const ko = marketFlowsPageHtml(SHELLS.ko, view, 'ko', { posts: POSTS });
  assert.match(ko, /<h1 id="market-flows-heading">외국인 · 기관 · 개인 순매수<\/h1>/);
  assert.match(ko, /<link rel="canonical" href="https:\/\/snowshagal\.com\/market\/investor-flows\/">/);
  assert.match(ko, /hreflang="en" href="https:\/\/snowshagal\.com\/en\/market\/investor-flows\/"/);
  for (const title of ['11월 25일 순매수', '최근 5거래일 일별', '2026년 11월 누적', '월별 외국인 순매수', '외국인 수급 읽는 법']) {
    assert.match(ko, new RegExp(`</span> ${title}</h2>`), title);
  }
  assert.match(ko, /<a href="\/market\/2026-11-19\/">11월 19일\(목\)<\/a>/);
  assert.match(ko, /2026\.11\.19 – 2026\.11\.25 · 게시된 5거래일/);
  assert.match(ko, /2026\.11\.02 – 2026\.11\.25 · 게시된 17거래일 \(이 기간 KRX 거래일 18일 중\)/);
  assert.match(ko, /<th scope="row">2026년 11월<\/th><td><span class="mk-flow-value down">−15.30조원<\/span><\/td><td><span class="mk-flow-value up">\+170억원<\/span><\/td><td>17 \/ 18<\/td>/);
  assert.match(ko, /<th scope="row">2026년 10월<\/th>[\s\S]*?<td>2<\/td>/);
  assert.match(ko, /<a class="mk-term" href="\/basics\/glossary\/#term-순매수">순매수<\/a>/);
  assert.match(ko, /<a href="\/reports\/basics-data-guide-01-krx-net-buying">외국인은 오늘 무엇을 사고팔았나<\/a>/);

  const en = marketFlowsPageHtml(SHELLS.en, view, 'en', { posts: POSTS });
  assert.match(en, /Net Buying on Nov 25<\/h2>/);
  assert.match(en, /November 2026 So Far<\/h2>/);
  assert.match(en, /of 18 KRX trading days/);
  assert.doesNotMatch(en, /외국인 수급|함께 읽기|순매수<\/h2>/);
  for (const name of ['market-flows-pair', 'market-flows-market', 'market-flows-table']) assert.match(CSS, new RegExp(`\\.${name}[{ ,:]`), name);
});

test('every guide link resolves: glossary terms in both languages, related reads with their translations', () => {
  for (const lang of ['ko', 'en']) {
    const ids = new Set(glossaryEntries(POSTS, GLOSSARY, lang).map(entry => glossaryTermId(entry.term)));
    const terms = FLOWS_GUIDE[lang].paragraphs.flatMap(text => [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(match => match[2] || match[1]));
    assert.ok(terms.length >= 3, lang);
    for (const term of terms) assert.ok(ids.has(glossaryTermId(term)), `${lang}: "${term}" is in the glossary`);
    assert.equal(guideReads(FLOWS_GUIDE, POSTS, lang).length, FLOWS_GUIDE.related.length, lang);
  }
});

test('served from D1; 404 without a session; listed in the sitemap, the footer and every market page’s links', async () => {
  const db = new SqliteD1();
  db.database.prepare(`CREATE TABLE market_close_snapshots (market_date TEXT PRIMARY KEY, schema_version TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, published_at TEXT NOT NULL, auth_source TEXT NOT NULL, takeaway_ko TEXT NOT NULL DEFAULT '', takeaway_en TEXT NOT NULL DEFAULT '')`).run();
  const call = path => onMarketPageRequest({
    request: new Request(`https://snowshagal.com${path}`),
    env: { COMMENTS_DB: db, ASSETS: { fetch: async request => new Response(new URL(request.url).pathname.startsWith('/en/') ? SHELLS.en : SHELLS.ko, { status: new URL(request.url).pathname === '/__not-found__' ? 404 : 200 }) } },
    next: async () => new Response('static')
  }, { loadPostsFn: async () => POSTS });
  assert.equal((await call('/market/investor-flows/')).status, 404);
  for (const [date, status] of [['2026-11-24', 'final'], ['2026-11-25', 'final'], ['2026-11-26', 'provisional']]) {
    const payload = JSON.parse(MC_EXAMPLE);
    payload.meta.market_date = date;
    payload.meta.status = status;
    db.database.prepare(`INSERT INTO market_close_snapshots (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source) VALUES (?, ?, ?, ?, ?, ?, 'test')`)
      .run(date, payload.meta.schema_version, payload.meta.generated_at, status, JSON.stringify(payload), `${date}T07:10:00Z`);
  }
  const page = await call('/en/market/investor-flows/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-market-date="2026-11-25"/, 'the newest final session, not the provisional one');
  assert.match(html, /What Did Foreign Investors Buy and Sell Today\?/);
  assert.equal((await call('/market/investor-flows')).status, 301);

  const sitemap = sitemapXml([], { marketSessions: [{ market_date: '2026-11-25', published_at: '2026-11-25T07:10:00Z', optional_closes: null }] });
  assert.match(sitemap, /<loc>https:\/\/snowshagal\.com\/market\/investor-flows\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/snowshagal\.com\/en\/market\/investor-flows\/<\/loc>/);
  assert.match(siteFooter('ko'), /<a href="\/market\/investor-flows\/">투자자별 수급<\/a>/);
  assert.match(siteFooter('en'), /<a href="\/en\/market\/investor-flows\/">Investor Flows<\/a>/);
  assert.match(SHELL_KO, /<a href="\/market\/investor-flows\/">투자자별 수급 · 월간 누적 →<\/a>/);
  assert.match(SHELL_EN, /<a href="\/en\/market\/investor-flows\/">Investor flows by month →<\/a>/);
  assert.match(MARKET_JS, /investor-flows\/">\$\{html\(copy\.flowsPage\)\} →<\/a>/);
  const session = await (await call('/market/2026-11-25/')).text();
  assert.match(session, /<a href="\/market\/investor-flows\/">투자자별 수급 · 월간 누적 →<\/a>/);
});
