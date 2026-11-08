// What the publisher reads out of a report before it is published: title,
// description, summary and the Daily one-liner, each from a place the report
// marks as that field, and where it came from.
//
// The readers are the real ones in assets/admin.js (tests/helpers/
// admin-detectors.mjs) over a browser-faithful document (tests/helpers/
// html-dom.mjs), which reads all 137 published reports identically to a
// browser's DOMParser. Fixtures are real reports trimmed to the markup the
// readers look at (tests/fixtures/report-metadata).
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import '../assets/report-metadata.js';
import { parseHtml } from './helpers/html-dom.mjs';
import { loadAdminDetectors } from './helpers/admin-detectors.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const METADATA = globalThis.REPORT_METADATA;
const api = await loadAdminDetectors();
const fixture = async (name) => parseHtml(await read(`tests/fixtures/report-metadata/${name}.html`));
const TITLE_CORPUS = JSON.parse(await read('tests/fixtures/report-metadata/title-corpus.json'));

/* ------------------------------------------------ category boilerplate */

test('the category sentences are every one the publisher ever filled in, and only those', () => {
  const texts = METADATA.CATEGORY_DEFAULT_DESCRIPTIONS.map(entry => entry.text);
  assert.equal(texts.length, 12);
  assert.equal(new Set(texts).size, 12);
  assert.deepEqual(
    METADATA.CATEGORY_DEFAULT_DESCRIPTIONS.filter(entry => entry.retired).map(entry => entry.text),
    ['경제와 투자, 시장 구조의 기본 개념을 이해하기 쉽게 정리한 시장 공부.', '시장과 투자에 관한 생각을 자유롭게 정리한 글.']
  );
});

test('boilerplate is an exact match after whitespace, never a resemblance (M, N)', () => {
  const daily = '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트.';
  // M: the sentence itself, however it is spaced.
  assert.equal(METADATA.isCategoryBoilerplate(daily), true);
  assert.equal(METADATA.isCategoryBoilerplate(`  ${daily.replace(/ /g, '  ')}\n`), true);
  assert.equal(METADATA.isCategoryBoilerplate(daily.replace('흐름과', '흐름과\u200B')), true);
  assert.equal(METADATA.editorialDescription(daily), '');
  // N: close to a category sentence is still the editor's own.
  for (const own of [
    '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트입니다.',
    '당일 시장의 핵심 서사, 수급, 업종, 매크로와 다음 거래일 시나리오를 정리한 데일리 리포트.',
    'A daily report on market breadth, investor flows, sectors, and macro drivers.',
    '당일 시장의 핵심 흐름',
    'A DAILY REPORT ON MARKET TRENDS, INVESTOR FLOWS, SECTORS, AND MACRO DRIVERS.'
  ]) {
    assert.equal(METADATA.isCategoryBoilerplate(own), false, own);
    assert.equal(METADATA.editorialDescription(`  ${own}  `), own);
  }
  assert.equal(METADATA.isCategoryBoilerplate(''), false);
  assert.equal(METADATA.editorialDescription(undefined), '');
});

/* ---------------------------------------------------------- description */

test('a report\'s own meta description is read as its description (E, F, G)', async () => {
  const cases = {
    'e-weekly-ko-meta-description': /^2026년 9월 4주차\(9월 21일~9월 23일\) 한국 증시 주간 리포트\. 코스피 \+2\.71%/,
    'f-research-ko-meta-description': /^2026년 1분기 한국 비금융기업이 돈을 빌리는 쪽에서 남기는 쪽으로 돌아섬/,
    'g-note-ko-meta-description-title': /^9월 30일 미국 8월 PCE와 BEA 2026년 연례 개정 동시 공개/
  };
  for (const [name, pattern] of Object.entries(cases)) {
    const reading = api.readDescription(await fixture(name));
    assert.equal(reading.source, 'meta-description', name);
    assert.match(reading.text, pattern, name);
  }
});

test('no description in the report means no description, never a category sentence (A, B)', async () => {
  for (const name of ['a-daily-ko-dcv-oc-div-quote', 'b-daily-en-dcv-oc-div-quote']) {
    assert.deepEqual(api.readDescription(await fixture(name)), { text: '', source: 'none' }, name);
  }
});

test('a category sentence found in a report is set aside and says so (M)', () => {
  for (const { text } of METADATA.CATEGORY_DEFAULT_DESCRIPTIONS) {
    const doc = parseHtml(`<!doctype html><html><head><meta name="description" content="${text}"></head><body></body></html>`);
    assert.deepEqual(api.readDescription(doc), { text: '', source: 'rejected-boilerplate' }, text);
  }
  const own = parseHtml('<!doctype html><html><head><meta name="description" content="당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트입니다."></head></html>');
  assert.equal(api.readDescription(own).source, 'meta-description', 'a near match is kept (N)');
});

/* -------------------------------------------------------------- summary */

test('a Daily\'s summary is the one sentence in its hero, as div.quote or p.quote (A, B, C)', async () => {
  const cases = {
    'a-daily-ko-dcv-oc-div-quote': '종목은 넓게 올랐고, 지수는 반도체 두 종목을 따라 내려간 하루.',
    'b-daily-en-dcv-oc-div-quote': 'Most stocks rose. KOSPI still fell with its two chip heavyweights.',
    'c-daily-ko-p-quote': '메모리에서 오늘 깎인 것은 실적이 아니라 · 다음 발주 시점에 붙어 있던 기대'
  };
  for (const [name, text] of Object.entries(cases)) {
    assert.deepEqual(api.readSummary(await fixture(name), 'daily'), { text, source: 'daily-hero-quote' }, name);
  }
});

test('a Daily hero quote with word joiners around its middle dots comes back without them', () => {
  // The 11-05 Daily set U+2060 on both sides of a · inside its hero sentence.
  const doc = parseHtml('<section class="hero"><div class="quote">AI 반도체\u2060·\u2060데이터센터 설비주는 규제 우려로 급락&nbsp;· 반도체 비중이<br>큰 코스피</div></section>');
  assert.deepEqual(api.readSummary(doc, 'daily'), {
    text: 'AI 반도체·데이터센터 설비주는 규제 우려로 급락 · 반도체 비중이 큰 코스피',
    source: 'daily-hero-quote'
  });
});

test('a quotation in a Research, Basics or Weekly body is never a summary, even if the report were read as a Daily (H)', async () => {
  for (const name of ['h-research-quote', 'h-basics-quote', 'h-weekly-quote']) {
    const html = await read(`tests/fixtures/report-metadata/${name}.html`);
    assert.match(html, /class="[^"]*\bquote\b/, `${name} still carries its .quote`);
    const doc = parseHtml(html);
    for (const type of ['research', 'basics', 'weekly', 'daily']) {
      assert.equal(api.readSummary(doc, type).source, 'none', `${name} as ${type}`);
    }
  }
  // A hero quote belongs to a Daily only.
  const daily = await fixture('a-daily-ko-dcv-oc-div-quote');
  for (const type of ['weekly', 'research', 'note', 'basics', '']) {
    assert.equal(api.readSummary(daily, type).source, 'none', type);
  }
});

test('summary sources are read in order: report-summary, data-report-summary, Daily hero, legacy markers', () => {
  const doc = (head, body) => parseHtml(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
  const hero = '<section class="hero"><div><div class="quote">히어로 문장</div></div></section>';
  const marked = '<div data-report-summary="표시된 요약"></div>';
  const legacy = '<section class="opener"><p class="stand">레거시 요약</p></section>';
  const all = doc('<meta name="report-summary" content="메타 요약">', `${marked}${hero}${legacy}`);
  assert.deepEqual(api.readSummary(all, 'daily'), { text: '메타 요약', source: 'report-summary' });
  assert.deepEqual(api.readSummary(doc('', `${marked}${hero}${legacy}`), 'daily'), { text: '표시된 요약', source: 'data-report-summary' });
  assert.deepEqual(api.readSummary(doc('', `<p data-report-summary>요소 안의 요약</p>${hero}`), 'daily'), { text: '요소 안의 요약', source: 'data-report-summary' });
  assert.deepEqual(api.readSummary(doc('', `${hero}${legacy}`), 'daily'), { text: '히어로 문장', source: 'daily-hero-quote' });
  assert.deepEqual(api.readSummary(doc('', `${hero}${legacy}`), 'research'), { text: '레거시 요약', source: 'legacy-marker', selector: '.opener .stand' });
  // The old covers' one-liner is a takeaway, not a summary.
  assert.deepEqual(api.readSummary(doc('', '<p class="cover-oneline">커버 원라인</p>'), 'daily'), { text: '', source: 'none' });
});

/* ------------------------------------------------------------- takeaway */

test('the September Daily covers hand over their one-liner (A, B, C, D)', async () => {
  const cases = {
    'a-daily-ko-dcv-oc-div-quote': ['종목은 넓게, 지수는 두 종목을 따라', 'dcv-one-oc'],
    'b-daily-en-dcv-oc-div-quote': ['Stocks rose broadly. Two chip heavyweights dragged KOSPI lower.', 'dcv-one-oc'],
    'c-daily-ko-p-quote': ['금요일의 지수 상승은 넘어오지 못하고, 주말의 재료만 건너온 개장', 'dcv-one-oc'],
    // Two <i> rows, display:block on the cover, joined as the cover reads.
    'd-daily-ko-dcv-ol': ['월러 연준 이사의 동결 시사 반도체는 위로 보험은 아래로', 'dcv-ol'],
    'd-daily-en-dcv-ol': ['Waller points to a September hold Chips up, insurers down', 'dcv-ol']
  };
  for (const [name, [text, source]] of Object.entries(cases)) {
    const reading = api.readTakeaway(await fixture(name));
    assert.equal(reading.text, text, name);
    assert.equal(reading.source, source, name);
  }
});

test('a .dcv-one .oc line broken with <br> comes back as one line', () => {
  const doc = parseHtml('<div class="dcv-one"><span class="ol">TODAY IN ONE LINE</span><span class="oc">Oil pressured the morning;<br/>buying support held the 7,000 line</span></div>');
  assert.equal(api.readTakeaway(doc).text, 'Oil pressured the morning; buying support held the 7,000 line');
});

test('takeaway sources are read in order, and the label is never taken for the line', () => {
  const cover = '<div class="dcv-one"><span class="ol">오늘의 한 줄</span><span class="oc">표지 한 줄</span></div>';
  const doc = (head, body) => parseHtml(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
  assert.equal(api.readTakeaway(doc('<meta name="report-takeaway" content="헤드 한 줄">', `<p data-report-takeaway="표시 한 줄"></p>${cover}`)).source, 'report-takeaway');
  assert.equal(api.readTakeaway(doc('', `<p data-report-takeaway="표시 한 줄"></p>${cover}`)).source, 'data-report-takeaway');
  assert.deepEqual(api.readTakeaway(doc('', `${cover}<p class="cv-line">v2 한 줄</p>`)), { text: '표지 한 줄', source: 'dcv-one-oc', selector: '.dcv-one .oc' });
  assert.equal(api.readTakeaway(doc('', '<p class="cv-line">v2 한 줄</p><p class="cover-oneline">원라인</p>')).selector, '.cv-line');
  assert.deepEqual(api.readTakeaway(doc('', '<p>본문 첫 문장</p>')), { text: '', source: 'none' });
});

/* ---------------------------------------------------------------- title */

test('title rows the cover draws as lines keep their break (I, J, K)', async () => {
  assert.equal(api.detectTitle('x.html', await fixture('g-note-ko-meta-description-title')), '물가를 재는 자가 바뀐다');
  assert.equal(api.detectTitle('x.html', await fixture('j-note-en-title')), 'Inflation Gets a New Ruler');
  assert.equal(api.detectTitle('x.html', await fixture('k-daily-en-dcv-line-title')), 'Same Level, Different Market');
  // The Daily cover's own h1 is named, not left to "the first h1".
  assert.equal(api.detectTitle('x.html', await fixture('a-daily-ko-dcv-oc-div-quote')), '넓게 올랐고, 무겁게 내렸다');
  assert.equal(api.detectTitle('x.html', await fixture('b-daily-en-dcv-oc-div-quote')), 'Broad Gains, Heavyweight Losses');
});

test('styling inside one word is never split into two (L)', async () => {
  // <em>자</em>가 is one word with an accented syllable, not two rows.
  const note = parseHtml('<h1 class="cv-title"><span class="l1">물가를 재는</span><span class="l2"><em>자</em>가 바뀐다</span></h1>');
  assert.equal(api.detectTitle('x.html', note), '물가를 재는 자가 바뀐다');
  assert.doesNotMatch(api.detectTitle('x.html', note), /자 가/);
  // An inline gloss inside .cover-title stays exactly as the markup reads.
  assert.equal(api.detectTitle('x.html', await fixture('l-daily-ko-inline-gloss-title')), '고도(高度)를 기다리며');
  // Only the row families listed in COVER_ROWS are rows: a span elsewhere is inline.
  const plain = parseHtml('<h1><span>Two</span><span>Words</span></h1>');
  assert.equal(api.detectTitle('x.html', plain), 'TwoWords');
});

test('a class the report\'s stylesheet makes display:block is a row of the title', () => {
  // Investment Insight No.20 (2026-10-31): plain .cover h1, rows set by class.
  const stacked = parseHtml('<style>.cover h1 .l1,.cover h1 .l2{display:block;color:#1b2230}\n.cover h1 .l3{display:block;position:relative}</style>'
    + '<section class="cover"><h1><span class="l1">The Fed Tilts Toward</span><span class="l2"><span class="pen">a December Hike.</span></span>'
    + '<span class="l3">What Comes Next Hinges on <span class="red">Oil</span></span></h1></section>');
  assert.equal(api.detectTitle('x.html', stacked), 'The Fed Tilts Toward a December Hike. What Comes Next Hinges on Oil');
  // Investment Note 2026-10-29: text rows split by <br>, then a .h1b deck line.
  const deck = parseHtml('<style>.h1b{display:block;margin-top:16px}\n.h1b u{text-decoration:none}</style>'
    + '<h1>성장률 <span class="est">전망</span> <span class="g">3.8%</span>인데<br>지갑은 <span class="mk">그대로</span>'
    + '<span class="h1b">반도체 돈은 <u>내년 1분기 성과급</u>으로 넘어온다</span></h1>');
  assert.equal(api.detectTitle('x.html', deck), '성장률 전망 3.8%인데 지갑은 그대로 반도체 돈은 내년 1분기 성과급으로 넘어온다');
  // Investment Insight No.22 (2026-11-02): rows set by a tag selector, an
  // accent span inside a row left inline.
  const tagRows = parseHtml('<style>h1>span{display:block}\nh1 .am{color:#f0b04a}</style>'
    + '<section class="cover"><h1><span class="l1">삼성전자 환원</span><span class="l2">최대 110조원,</span>'
    + '<span class="l3">남은 <span class="am">55~75조원</span>은</span><span class="l4"><span class="u">1월에 갈린다</span></span></h1></section>');
  assert.equal(api.detectTitle('x.html', tagRows), '삼성전자 환원 최대 110조원, 남은 55~75조원은 1월에 갈린다');
  const enRows = parseHtml('<style>h1>span{display:block}</style>'
    + '<h1><span class="l1">SAMSUNG\'S RETURNS</span><span class="l2">UP TO ₩110tn</span><span class="l3">₩<span class="am">55–75tn</span> STILL OPEN</span></h1>');
  assert.equal(api.detectTitle('x.html', enRows), 'SAMSUNG\'S RETURNS UP TO ₩110tn ₩55–75tn STILL OPEN');
  // inline-block, a pseudo-element or a hover state is not a row.
  const inline = parseHtml('<style>.a{display:inline-block}.b::before{display:block}.c:hover{display:block}</style>'
    + '<h1><span class="a">자</span>가<span class="b">바</span>뀐<span class="c">다</span></h1>');
  assert.equal(api.detectTitle('x.html', inline), '자가바뀐다');
});

test('a title class that names the box around the h1 gives the h1, not the box', () => {
  // Investment Insight No.21 (2026-11-01): div.cv-title holds a kicker, the
  // h1, a subtitle and a list of figures.
  const boxed = parseHtml('<section class="cover"><div class="cv-title">'
    + '<p class="kick">Snowshagal 투자 인사이트 · 실적 현황판<i>2026.11.01</i></p>'
    + '<h1>AI <span class="q">3</span>분기<br>현황판</h1>'
    + '<p class="subt">빅테크에서 메모리·전력기기까지,<br>AI 공급망 12곳의 3분기 성적</p>'
    + '<dl class="meta"><div><dt>발표</dt><dd>10곳</dd></div></dl></div></section>');
  assert.equal(api.detectTitle('x.html', boxed), 'AI 3분기 현황판');
  // A .cv-title that is the heading itself still reads its own rows.
  const heading = parseHtml('<h1 class="cv-title"><span class="l1">물가를 재는</span><span class="l2">자가 바뀐다</span></h1>');
  assert.equal(api.detectTitle('x.html', heading), '물가를 재는 자가 바뀐다');
});

test('the three new row families are exactly the ones the covers use', () => {
  const rows = api.COVER_ROWS.map(([parent, child]) => `${parent} ${child}`);
  for (const pair of ['.cv-title span', '.dcv-h1 span', '.dcv-ol i']) assert.ok(rows.includes(pair), pair);
});

/* -------------------------------------------------------- whole corpus */

const posts = JSON.parse(await read('data/posts.json'));
const reports = await Promise.all(posts.map(async post => ({ post, doc: parseHtml(await read(post.href)) })));

// A stored title may be the editor's own (the publish form lets them change
// it), so a title that reads differently from its cover is allowed, and so is
// one the editor spaced by hand ("고도 (高度)를 기다리며"). One that has the
// cover's words with fewer spaces is not: that is two cover rows run
// together, the failure this reader exists to prevent.
const spaces = text => (text.match(/\s/g) || []).length;
const spacingOnly = (stored, read) => stored !== read
  && stored.replace(/\s+/g, '') === read.replace(/\s+/g, '')
  && spaces(stored) < spaces(read);

test('no published title differs from its cover by spacing alone, except the ones awaiting the backfill', () => {
  const { pendingBackfill } = TITLE_CORPUS;
  const glued = [];
  let identical = 0;
  for (const { post, doc } of reports) {
    const read = api.detectTitle(post.href.split('/').pop(), doc);
    if (Object.hasOwn(pendingBackfill, post.id)) {
      assert.equal(read, pendingBackfill[post.id], `${post.id} is read with its rows apart`);
      assert.ok(spacingOnly(post.title, read), `${post.id} is fixed in the data now; take it out of pendingBackfill`);
      continue;
    }
    if (read === post.title) identical += 1;
    else if (spacingOnly(post.title, read)) glued.push(`${post.id}: stored ${JSON.stringify(post.title)} · cover reads ${JSON.stringify(read)}`);
  }
  assert.deepEqual(glued, [], `titles that differ from their cover by spacing alone:\n  ${glued.join('\n  ')}`);
  // Nearly every title is the cover's own words; a handful are the editor's.
  assert.ok(identical >= posts.length - Object.keys(pendingBackfill).length - 10, `${identical} of ${posts.length}`);
});

test('across the corpus no description is a category sentence and no summary crosses a report type', () => {
  const summarySources = {};
  for (const { post, doc } of reports) {
    const description = api.readDescription(doc);
    assert.equal(METADATA.isCategoryBoilerplate(description.text), false, post.id);
    if (description.source === 'meta-description') assert.ok(description.text, post.id);
    const summary = api.readSummary(doc, post.type);
    if (summary.source === 'daily-hero-quote') assert.equal(post.type, 'daily', `${post.id}: a hero quote is a Daily summary only`);
    summarySources[summary.source] = (summarySources[summary.source] || 0) + 1;
    if (post.type === 'daily' && doc.querySelector('section.hero .quote')) {
      assert.equal(summary.source, 'daily-hero-quote', `${post.id}: a Daily hero quote is its summary`);
    }
  }
  assert.ok(summarySources['daily-hero-quote'] >= 42);
});

test('every September Daily cover yields its one-liner, from the field it carries', () => {
  for (const { post, doc } of reports) {
    if (post.type !== 'daily') continue;
    const reading = api.readTakeaway(doc);
    if (doc.querySelector('.dcv-one .oc')) assert.equal(reading.source, 'dcv-one-oc', post.id);
    else if (doc.querySelector('.dcv-one .dcv-ol')) assert.equal(reading.source, 'dcv-ol', post.id);
    if (reading.source !== 'none') assert.ok(reading.text.length > 0 && reading.text.length <= 400, post.id);
    assert.doesNotMatch(reading.text, /오늘의 한 줄|TODAY IN ONE LINE/i, `${post.id}: the label is not the line`);
  }
});

test('the fixtures are real reports, trimmed', async () => {
  for (const name of await readdir(new URL('./fixtures/report-metadata/', import.meta.url))) {
    if (!name.endsWith('.html')) continue;
    const html = await read(`tests/fixtures/report-metadata/${name}`);
    assert.match(html, /Trimmed from reports\//, name);
    assert.ok(html.length < 4000, `${name} stays small`);
  }
});

/* ---------------------------------------------------------- report date */

test('the report date comes from the report itself, never from a later date it quotes', async () => {
  const at = new Date('2026-11-04T14:00:00Z');
  // NO.25 quotes the new Congress's opening day, 2027.1.3, in its description
  // ahead of any other date; it was published as a 2027 post.
  for (const href of ['reports/20261104_Investment_Insight_Midterm_Scoreboard.html',
    'reports/en/20261104_Snowshagal_Investment_Insight_No25_US_Midterms_Scoreboard_EN.html']) {
    const html = await read(href);
    assert.equal(api.detectDate(href.split('/').pop(), parseHtml(html), html, at), '2026-11-04', href);
  }

  // The publisher passes the parsed document and the raw HTML it came from.
  const doc = (body, head = '') => `<html><head>${head}</head><body>${body}</body></html>`;
  const date = (name, html, now = at) => api.detectDate(name, parseHtml(html), html, now);
  // Its own meta wins, then its article metadata, then a date in its file name.
  assert.equal(date('20261104_x.html', doc('', '<meta name="report-date" content="2026-11-03">')), '2026-11-03');
  assert.equal(date('x.html', doc('', '<script type="application/ld+json">{"datePublished": "2026-11-02"}</script>')), '2026-11-02');
  assert.equal(date('20261104_Report.html', doc('<p>2027.1.3 개원</p>')), '2026-11-04');
  assert.equal(date('2026-10-03_Korea_Weekly_Report_EN.html', doc('')), '2026-10-03');
  // A byline, as the reports write one.
  assert.equal(date('x.html', doc('<p>2027.1.3 개원</p><p>발행 2026.11.04 · 읽는 시간 15분</p>')), '2026-11-04');
  assert.equal(date('x.html', doc('<p class="byl">Published Nov. 4, 2026</p>')), '2026-11-04');
  // Prose is not a byline: the first date that is not in the future is read instead.
  assert.equal(date('x.html', doc('<p>The data was published June 10, 2026 and revised on 2026.06.12.</p>'), new Date('2026-08-13T00:00:00Z')), '2026-06-12');
  // A date after tomorrow is not a report date; with nothing else, the field stays empty.
  assert.equal(date('x.html', doc('<p>새 의회는 2027.1.3 개원</p>')), '');
  assert.equal(date('x.html', doc('<p>2026.11.05 장 시작 전</p>')), '2026-11-05', 'tomorrow is allowed, for a time zone ahead');
});
