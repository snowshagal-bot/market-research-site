import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  FLOW_NOTABLE_BILLION,
  FLOW_STRONG_BILLION,
  KOSDAQ_UNUSUAL_PCT,
  dailySecondaryFact,
  formatFlowAmount,
  formatSignedPct,
  reportDescription,
  reportSeoTags,
  reportSeoTitle,
  reportStructuredData
} from '../functions/_seo.js';
import {
  extractDailyFacts,
  extractWeeklyFacts,
  loadReportFacts,
  weeklyPeriod
} from '../functions/_report-facts.js';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// A final Market Close payload shaped like /api/market/date, with only the
// fields the SEO layer is allowed to read.
function snapshot(marketDate, { kospi = [6627.26, -0.8543], kosdaq = [812.41, 0.6966], foreign = -1571, institution = -904, status = 'final', kospiState = 'final_close', unit = 'KRW billion', flowDate = marketDate } = {}) {
  return {
    meta: { market_date: marketDate, status, schema_version: '1.1.0', generated_at: `${marketDate}T15:51:41+07:00` },
    indices: {
      KOSPI: { close: kospi[0], change_pct: kospi[1], data_state: kospiState, source_date: marketDate },
      KOSDAQ: kosdaq ? { close: kosdaq[0], change_pct: kosdaq[1], data_state: 'final_close', source_date: marketDate } : undefined
    },
    rates_fx_volatility: { USDKRW: { close: 1359.2, change_pct: 1.12, data_state: 'intraday' } },
    krx_investor_trading: {
      unit,
      markets: { KOSPI: { source_date: flowDate, data_state: '정규장 순매수 확정', investors: { '외국인': { net_buy: foreign }, '기관': { net_buy: institution }, '개인': { net_buy: 832 } } } }
    }
  };
}

const koDaily = { id: 'ko-0915', type: 'daily', lang: 'ko', reportDate: '2026-09-15', title: '바람은 다른 곳으로 갔다', href: 'reports/9월 15일 주식리포트_통합.html', tags: ['kospi', 'kosdaq', 'flows'] };
const enDaily = { id: 'en-0915', type: 'daily', lang: 'en', reportDate: '2026-09-15', title: 'The Wind Moved Elsewhere', href: 'reports/en/2026-09-15_KOSPI_Daily_Report_EN_publish.html', translationGroup: 'g1', tags: ['kospi'] };
const facts0915 = extractDailyFacts(snapshot('2026-09-15'), { takeaway_ko: '', takeaway_en: '' });
const tagRegistry = { kospi: { ko: 'KOSPI', en: 'KOSPI' }, kosdaq: { ko: 'KOSDAQ', en: 'KOSDAQ' }, flows: { ko: '수급', en: 'Flows' }, semiconductors: { ko: '반도체', en: 'Semiconductors' }, rates: { ko: '금리', en: 'Rates' }, policy: { ko: '정책', en: 'Policy' }, treasuries: { ko: '미국채', en: 'U.S. Treasuries' }, stablecoins: { ko: '스테이블코인', en: 'Stablecoins' } };

test('Daily title reads market fact → date → brand and the H1 stays editorial', () => {
  assert.equal(reportSeoTitle(koDaily, { facts: facts0915 }), '코스피 6,627.26 마감 · 외국인 1.57조 순매도 | 9월 15일 증시 | Snowshagal');
  assert.equal(reportSeoTitle(enDaily, { facts: facts0915 }), 'KOSPI 6,627.26 Close · Foreign Net Sell KRW 1.57tn | Sep 15 | Snowshagal');
  // The literary headline is not in the <title> once real numbers exist…
  assert.doesNotMatch(reportSeoTitle(koDaily, { facts: facts0915 }), /바람은 다른 곳으로/);
  // …and it is exactly what the structured data still calls the headline.
  const graph = reportStructuredData(koDaily, { facts: facts0915 })['@graph'];
  const article = graph.find((node) => node['@type'] === 'Article');
  assert.equal(article.headline, '바람은 다른 곳으로 갔다');
  assert.equal(article.description, reportDescription(koDaily, { facts: facts0915 }));
});

test('Daily description carries close, change, flows and the takeaway without repeating the title', () => {
  const ko = reportDescription(koDaily, { facts: facts0915 });
  assert.equal(ko, '2026년 9월 15일 코스피 6,627.26 (-0.85%), 코스닥 812.41 (+0.70%) 마감. 외국인 1.57조 순매도 · 기관 9,040억 순매도.');
  const en = reportDescription(enDaily, { facts: facts0915 });
  assert.equal(en, 'Sep 15, 2026: KOSPI closed at 6,627.26 (-0.85%), KOSDAQ 812.41 (+0.70%). Foreign investors net sold KRW 1.57tn; institutions net sold KRW 904bn.');
  assert.notEqual(ko, reportSeoTitle(koDaily, { facts: facts0915 }));
  assert.ok(!ko.includes('| Snowshagal'));

  // The Market Close row's own takeaway wins, then the post's, then its summary.
  const withRow = extractDailyFacts(snapshot('2026-09-15'), { takeaway_ko: '반도체가 지수를 받쳤다.', takeaway_en: 'Chips held the index.' });
  assert.match(reportDescription(koDaily, { facts: withRow }), /마감\. 외국인 1\.57조 순매도 · 기관 9,040억 순매도\. 반도체가 지수를 받쳤다\.$/);
  assert.match(reportDescription(enDaily, { facts: withRow }), /KRW 904bn\. Chips held the index\.$/);
  assert.match(reportDescription({ ...koDaily, takeaway: '오늘의 한 줄' }, { facts: facts0915 }), /순매도\. 오늘의 한 줄\.$/);
  assert.match(reportDescription({ ...koDaily, summary: '요약 문장이다.' }, { facts: facts0915 }), /순매도\. 요약 문장이다\.$/);
  // Long takeaways are trimmed to the 180-character budget, numbers first.
  const long = reportDescription({ ...koDaily, summary: '가'.repeat(300) }, { facts: facts0915 });
  assert.ok(long.length <= 180 && long.startsWith('2026년 9월 15일 코스피 6,627.26'));
});

test('secondary fact prefers a large foreign flow, then an unusual KOSDAQ move, then a notable flow, then the KOSDAQ close', () => {
  const at = (overrides) => extractDailyFacts(snapshot('2026-09-15', overrides));
  assert.equal(dailySecondaryFact(at({ foreign: FLOW_STRONG_BILLION }), 'ko'), '외국인 5,000억 순매수');
  assert.equal(dailySecondaryFact(at({ foreign: 120, kosdaq: [780.1, -KOSDAQ_UNUSUAL_PCT] }), 'ko'), '코스닥 780.10 (-1.50%)');
  assert.equal(dailySecondaryFact(at({ foreign: 120, kosdaq: [812.41, 0.4] }), 'en'), 'Foreign Net Buy KRW 120bn');
  assert.equal(dailySecondaryFact(at({ foreign: FLOW_NOTABLE_BILLION - 1, kosdaq: [812.41, 0.4] }), 'ko'), '코스닥 812.41 (+0.40%)');
  assert.equal(dailySecondaryFact(at({ foreign: null, kosdaq: null }), 'ko'), '코스피 -0.85%');
  assert.equal(formatFlowAmount(-3338, 'ko'), '3.34조');
  assert.equal(formatFlowAmount(-2300, 'en'), 'KRW 2.3tn');
  assert.equal(formatFlowAmount(904, 'ko'), '9,040억');
  assert.equal(formatSignedPct(0.004), '0.00%');
  assert.equal(formatSignedPct(-3.264), '-3.26%');
});

test('numbers are used only when the snapshot is final, regular-session and for the report date', () => {
  assert.equal(extractDailyFacts(snapshot('2026-09-15', { status: 'partial' })), null);
  assert.equal(extractDailyFacts(snapshot('2026-09-15', { kospiState: 'intraday' })), null);
  assert.equal(extractDailyFacts(null), null);
  const otherUnit = extractDailyFacts(snapshot('2026-09-15', { unit: 'KRW' }));
  assert.equal(otherUnit.foreignNet, null);
  assert.equal(extractDailyFacts(snapshot('2026-09-15', { flowDate: '2026-09-14' })).foreignNet, null);
  assert.equal(extractDailyFacts(snapshot('2026-09-15', { kosdaq: null })).kosdaq, null);
  // Facts for another date never decorate this report.
  const stale = extractDailyFacts(snapshot('2026-09-14'));
  assert.equal(reportSeoTitle(koDaily, { facts: stale }), '9월 15일 증시 마감 · 바람은 다른 곳으로 갔다 | Snowshagal');
  assert.equal(reportSeoTitle(enDaily, { facts: null }), 'Sep 15 Korea Market Close · The Wind Moved Elsewhere | Snowshagal');
  // Without numbers the description keeps the existing dated wording.
  assert.match(reportDescription(koDaily), /^2026년 9월 15일 한국 주식시장 데일리 — 바람은 다른 곳으로 갔다\./);
  for (const text of [reportSeoTitle(koDaily), reportSeoTitle(enDaily), reportDescription(koDaily), reportDescription(enDaily)]) {
    assert.doesNotMatch(text, /\d{1,3}(,\d{3})+\.\d{2}|NaN|undefined|null/);
  }
});

test('Weekly title states the week move, tag themes and the Monday–Friday period; Research is topic-first', () => {
  assert.deepEqual(weeklyPeriod('2026-09-05'), { start: '2026-08-31', end: '2026-09-04' }, 'Saturday report covers the week that ended');
  assert.deepEqual(weeklyPeriod('2026-09-06'), { start: '2026-08-31', end: '2026-09-04' }, 'Sunday too');
  assert.deepEqual(weeklyPeriod('2026-09-11'), { start: '2026-09-07', end: '2026-09-11' });
  assert.deepEqual(weeklyPeriod('2026-12-30'), { start: '2026-12-28', end: '2027-01-01' });
  assert.equal(weeklyPeriod('nope'), null);

  const rows = [
    { market_date: '2026-08-27', payload_json: JSON.stringify(snapshot('2026-08-27', { kospi: [6800, 0.1] })) },
    { market_date: '2026-08-28', payload_json: JSON.stringify(snapshot('2026-08-28', { kospi: [6788.88, -0.2] })) },
    { market_date: '2026-09-01', payload_json: JSON.stringify(snapshot('2026-09-01', { kospi: [6750, -0.5] })) },
    { market_date: '2026-09-04', payload_json: JSON.stringify(snapshot('2026-09-04', { kospi: [6687.21, -1.2] })) },
    { market_date: '2026-09-07', payload_json: JSON.stringify(snapshot('2026-09-07', { kospi: [6900, 3] })) }
  ];
  const weekly = extractWeeklyFacts(rows, weeklyPeriod('2026-09-05'));
  assert.equal(weekly.previousDate, '2026-08-28');
  assert.equal(weekly.closeDate, '2026-09-04');
  assert.ok(Math.abs(weekly.pct - -1.4976) < 0.001);
  assert.equal(extractWeeklyFacts(rows.slice(2), weeklyPeriod('2026-09-05')), null, 'no prior close means no week move');
  assert.equal(extractWeeklyFacts([rows[0], { market_date: '2026-09-04', payload_json: JSON.stringify(snapshot('2026-09-04', { status: 'partial' })) }], weeklyPeriod('2026-09-05')), null);

  // Both ends must be the exact KRX sessions; a nearer published row never
  // stands in for a missing one (the Preview D1 once held 08-28 and 09-09
  // only, which would have printed a false +3.87% for Sep 7–11).
  const row = (date, close) => ({ market_date: date, payload_json: JSON.stringify(snapshot(date, { kospi: [close, 0] })) });
  const sep7to11 = weeklyPeriod('2026-09-11');
  assert.equal(extractWeeklyFacts([row('2026-08-28', 6788.88), row('2026-09-09', 7051.64)], sep7to11), null, 'gap on both ends');
  assert.equal(extractWeeklyFacts([row('2026-09-04', 6687.21), row('2026-09-10', 7033.92)], sep7to11), null, 'last session missing');
  assert.equal(extractWeeklyFacts([row('2026-09-03', 6700), row('2026-09-11', 6909.91)], sep7to11), null, 'previous session missing');
  const exact = extractWeeklyFacts([row('2026-09-04', 6687.21), row('2026-09-09', 7051.64), row('2026-09-11', 6909.91)], sep7to11);
  assert.equal(exact.previousDate, '2026-09-04');
  assert.equal(exact.closeDate, '2026-09-11');
  assert.ok(Math.abs(exact.pct - 3.3302) < 0.001);
  // A row whose payload names another date is not that session's close.
  const mislabeled = { market_date: '2026-09-11', payload_json: JSON.stringify(snapshot('2026-09-10', { kospi: [7033.92, 0] })) };
  assert.equal(extractWeeklyFacts([row('2026-09-04', 6687.21), mislabeled], sep7to11), null);
  // Chuseok (09-24, 09-25 closed): the week ends on Wednesday 09-23.
  const chuseok = extractWeeklyFacts([row('2026-09-18', 7000), row('2026-09-23', 7070)], weeklyPeriod('2026-09-25'));
  assert.equal(chuseok.closeDate, '2026-09-23');
  assert.ok(Math.abs(chuseok.pct - 1) < 1e-9);
  // No KRX calendar for 2027 yet: no number rather than a guessed session.
  assert.equal(extractWeeklyFacts([row('2026-12-24', 7000), row('2026-12-30', 7100)], weeklyPeriod('2027-01-01')), null);

  const koWeekly = { type: 'weekly', lang: 'ko', reportDate: '2026-09-05', title: '받침보다 센 바람', href: 'reports/위클리_2026년 9월 1주차 위클리.html', tags: ['semiconductors', 'rates', 'policy'] };
  const enWeekly = { ...koWeekly, lang: 'en', title: 'Winds Stronger Than the Support', href: 'reports/en/2026-09-06_Korea_Weekly_Report_EN.html' };
  assert.equal(reportSeoTitle(koWeekly, { facts: weekly, tagRegistry }), '코스피 주간 -1.50% · 반도체·금리·정책 | 8월 31일–9월 4일 | Snowshagal');
  assert.equal(reportSeoTitle(enWeekly, { facts: weekly, tagRegistry }), 'KOSPI Week -1.50% · Semiconductors, Rates, Policy | Aug 31–Sep 4 | Snowshagal');
  assert.equal(reportDescription(koWeekly, { facts: weekly, tagRegistry }), '2026년 8월 31일–9월 4일 코스피 주간 -1.50% (6,788.88 → 6,687.21). 다음 주 변수: 반도체·금리·정책.');
  assert.equal(reportDescription(enWeekly, { facts: weekly, tagRegistry }), 'Aug 31–Sep 4, 2026: KOSPI -1.50% for the week (6,788.88 → 6,687.21). Key variables ahead: Semiconductors, Rates, Policy.');
  // Without a computable move the title still names the period and the report, no number.
  assert.equal(reportSeoTitle(koWeekly, { tagRegistry }), '8월 31일–9월 4일 주간 시장 전망 · 받침보다 센 바람 | Snowshagal');
  assert.equal(reportSeoTitle(enWeekly), 'Aug 31–Sep 4 Korea Market Weekly · Winds Stronger Than the Support | Snowshagal');
  // Tags unknown to the registry fall back to the editorial title as the catalyst slot.
  assert.equal(reportSeoTitle(koWeekly, { facts: weekly, tagRegistry: null }), '코스피 주간 -1.50% · 받침보다 센 바람 | 8월 31일–9월 4일 | Snowshagal');

  const koResearch = { type: 'research', lang: 'ko', reportDate: '2026-08-29', title: '코인의 뒷면에는 국채가 있다', href: 'reports/r.html', tags: ['treasuries', 'stablecoins', 'crypto'] };
  assert.equal(reportSeoTitle(koResearch, { tagRegistry }), '코인의 뒷면에는 국채가 있다 | 미국채·스테이블코인 리서치 | Snowshagal');
  assert.equal(reportSeoTitle({ ...koResearch, lang: 'en', title: 'Behind the Coin Are Treasuries' }, { tagRegistry }), 'Behind the Coin Are Treasuries | U.S. Treasuries, Stablecoins Research | Snowshagal');
  assert.equal(reportSeoTitle({ ...koResearch, tags: [] }, { tagRegistry }), '2026년 8월 29일 한국 시장 심층 리서치 | 코인의 뒷면에는 국채가 있다 | Snowshagal');
  // A Daily shape is never forced onto Research.
  assert.doesNotMatch(reportSeoTitle(koResearch, { facts: facts0915, tagRegistry }), /코스피 6,627/);
});

test('titles and descriptions escape &, <, ₩ and % safely and leave canonical, hreflang and social tags as they were', () => {
  const posts = [koDaily, enDaily, { ...koDaily, id: 'ko-pair', translationGroup: 'g1', href: 'reports/pair.html' }];
  const spiky = extractDailyFacts(snapshot('2026-09-15'), { takeaway_ko: 'A & B <c> ₩1,000 & 5%', takeaway_en: 'A & B <c> ₩1,000 & 5%' });
  const tags = reportSeoTags(posts, enDaily, { facts: spiky, tagRegistry });
  assert.match(tags, /<title>KOSPI 6,627\.26 Close · Foreign Net Sell KRW 1\.57tn \| Sep 15 \| Snowshagal<\/title>/);
  assert.match(tags, /<meta name="description" content="[^"]*A &amp; B &lt;c&gt; ₩1,000 &amp; 5%\."/);
  assert.doesNotMatch(tags, /content="[^"]*<c>/);
  assert.match(tags, /<link rel="canonical" href="https:\/\/snowshagal\.com\/reports\/en\/2026-09-15_KOSPI_Daily_Report_EN_publish">/);
  assert.match(tags, /hreflang="ko" href="https:\/\/snowshagal\.com\/reports\/pair"/);
  assert.match(tags, /hreflang="en"/);
  assert.match(tags, /hreflang="x-default"/);
  // Social titles keep the editorial headline; only <title> and description changed.
  assert.match(tags, /<meta property="og:title" content="The Wind Moved Elsewhere">/);
  assert.match(tags, /<meta name="twitter:title" content="The Wind Moved Elsewhere">/);
  assert.match(tags, /"headline":"The Wind Moved Elsewhere"/);
  const jsonLd = tags.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1];
  assert.doesNotMatch(jsonLd, /<c>|&amp;/);
  assert.ok(JSON.parse(jsonLd)['@graph'][1].description.includes('A & B <c> ₩1,000 & 5%'));
  // Without options the tags are the same shape they always were.
  const plain = reportSeoTags(posts, enDaily);
  assert.match(plain, /<title>Sep 15 Korea Market Close · The Wind Moved Elsewhere \| Snowshagal<\/title>/);
  assert.match(plain, /<meta name="description" content="Korean market daily report — Sep 15, 2026: The Wind Moved Elsewhere\./);
});

// A D1 stand-in that answers the two queries the facts loader makes.
function fakeDb(rowsByDate) {
  const rows = Object.entries(rowsByDate).map(([market_date, value]) => ({ market_date, payload_json: JSON.stringify(value.payload), takeaway_ko: value.takeaway_ko || '', takeaway_en: value.takeaway_en || '' })).sort((a, b) => a.market_date.localeCompare(b.market_date));
  return {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) { args = values; return statement; },
        async run() { return { success: true }; },
        async first() { return rows.find((row) => row.market_date === args[0]) || null; },
        async all() { return { results: rows.filter((row) => row.market_date >= args[0] && row.market_date <= args[1]) }; }
      };
      return statement;
    }
  };
}

test('loadReportFacts reads the Market Close row for the report date and never throws', async () => {
  const env = { COMMENTS_DB: fakeDb({ '2026-09-15': { payload: snapshot('2026-09-15'), takeaway_ko: '행에 적힌 한 줄' } }) };
  const facts = await loadReportFacts(env, koDaily);
  assert.equal(facts.kind, 'daily');
  assert.equal(facts.kospi.close, 6627.26);
  assert.equal(facts.takeaway.ko, '행에 적힌 한 줄');
  assert.equal(await loadReportFacts(env, { ...koDaily, reportDate: '2026-09-16' }), null, 'unpublished date');
  assert.equal(await loadReportFacts({}, koDaily), null, 'no binding');
  assert.equal(await loadReportFacts({ COMMENTS_DB: { prepare() { throw new Error('boom'); } } }, koDaily), null, 'D1 failure');
  assert.equal(await loadReportFacts(env, { type: 'research', reportDate: '2026-09-15' }), null);

  const weeklyEnv = { COMMENTS_DB: fakeDb({
    '2026-08-28': { payload: snapshot('2026-08-28', { kospi: [6788.88, -0.2] }) },
    '2026-09-04': { payload: snapshot('2026-09-04', { kospi: [6687.21, -1.2] }) }
  }) };
  const weekly = await loadReportFacts(weeklyEnv, { type: 'weekly', reportDate: '2026-09-05' });
  assert.equal(weekly.kind, 'weekly');
  assert.deepEqual(weekly.period, { start: '2026-08-31', end: '2026-09-04' });
});

test('the middleware injects fact-based tags for a published report and dated fallbacks without a Market Close row', async () => {
  const posts = [koDaily, enDaily];
  const source = '<!doctype html><html><head><title>2026.09.15 Snowshagal Daily · Cover Edition</title><meta name="description" content="uploaded"></head><body><h1>The Wind Moved Elsewhere</h1></body></html>';
  const render = async (env) => (await middlewareRequest({
    request: new Request('https://snowshagal.com/reports/en/2026-09-15_KOSPI_Daily_Report_EN_publish'),
    env,
    next: async () => new Response(source, { headers: { 'content-type': 'text/html' } })
  })).text();
  const assets = { fetch: async (request) => (String(request.url).includes('tags.json') ? Response.json(tagRegistry) : Response.json(posts)) };

  const withFacts = await render({ ASSETS: assets, COMMENTS_DB: fakeDb({ '2026-09-15': { payload: snapshot('2026-09-15') } }) });
  assert.match(withFacts, /<title>KOSPI 6,627\.26 Close · Foreign Net Sell KRW 1\.57tn \| Sep 15 \| Snowshagal<\/title>/);
  assert.match(withFacts, /<meta name="description" content="Sep 15, 2026: KOSPI closed at 6,627\.26 \(-0\.85%\), KOSDAQ 812\.41 \(\+0\.70%\)\. Foreign investors net sold KRW 1\.57tn; institutions net sold KRW 904bn\.">/);
  assert.equal((withFacts.match(/<title>/g) || []).length, 1, 'the uploaded title is replaced, not duplicated');
  assert.doesNotMatch(withFacts, /content="uploaded"/);
  assert.match(withFacts, /<h1>The Wind Moved Elsewhere<\/h1>/, 'H1 is untouched');

  const withoutFacts = await render({ ASSETS: assets });
  assert.match(withoutFacts, /<title>Sep 15 Korea Market Close · The Wind Moved Elsewhere \| Snowshagal<\/title>/);
  assert.doesNotMatch(withoutFacts, /6,627/);
});

test('every published post still gets a unique, non-empty title and description with and without facts', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const registry = JSON.parse(await read('data/tags.json'));
  const withoutFacts = posts.map((post) => reportSeoTitle(post, { tagRegistry: registry }));
  assert.equal(new Set(withoutFacts).size, posts.length);
  const facts = extractDailyFacts(snapshot('2026-09-15'));
  for (const post of posts) {
    const options = { facts: post.type === 'daily' && post.reportDate === '2026-09-15' ? facts : null, tagRegistry: registry };
    const title = reportSeoTitle(post, options);
    const description = reportDescription(post, options);
    assert.ok(title.endsWith('| Snowshagal'), title);
    assert.ok(description.length > 0 && description.length <= 180, `${post.id}: ${description.length}`);
    assert.notEqual(description, title);
    assert.doesNotMatch(`${title} ${description}`, /NaN|undefined|Invalid Date/);
  }
});

test('Market data pages carry the data-page title on every head tag so they do not compete with dated Daily pages', async () => {
  const ko = await read('market/index.html');
  const en = await read('en/market/index.html');
  assert.match(ko, /<title>코스피·코스닥 마감, 원달러 환율 \| 한국 시장 데이터 \| Snowshagal<\/title>/);
  assert.match(ko, /<meta property="og:title" content="코스피·코스닥 마감, 원달러 환율 \| 한국 시장 데이터 \| Snowshagal">/);
  assert.match(ko, /<meta name="twitter:title" content="코스피·코스닥 마감, 원달러 환율 \| 한국 시장 데이터 \| Snowshagal">/);
  assert.match(en, /<title>KOSPI &amp; KOSDAQ Close, USD\/KRW \| Korea Market Data \| Snowshagal<\/title>/);
  assert.match(en, /<meta property="og:title" content="KOSPI &amp; KOSDAQ Close, USD\/KRW \| Korea Market Data \| Snowshagal">/);
  assert.doesNotMatch(en, /<title>KOSPI & KOSDAQ|content="KOSPI & KOSDAQ/, 'ampersand is escaped in markup attributes and the title');
  assert.match(en, /"name":"KOSPI & KOSDAQ Close, USD\/KRW \| Korea Market Data"/, 'JSON-LD name matches the title unescaped');
  for (const page of [ko, en]) {
    assert.doesNotMatch(page, /Today’s Korean Market Close|오늘의 한국 시장 마감 \| Snowshagal/);
    assert.match(page, /rel="canonical" href="https:\/\/snowshagal\.com\/(en\/)?market\/"/);
  }
});
