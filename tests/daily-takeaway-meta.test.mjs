import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { MAX_TAKEAWAY_LENGTH, normalizeTakeaway, readTakeaway, stampTakeaway } from '../scripts/stamp-daily-takeaway.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * The lightweight layout: a Daily whose cover is rebuilt without the markup
 * earlier covers happened to carry. Nothing here is a takeaway marker, which
 * is the whole reason the head tag exists.
 */
const LIGHTWEIGHT_DAILY = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="report-type" content="daily">
<meta name="report-date" content="2026-08-27">
<meta name="description" content="설명이 한 줄을 대신하면 안 된다.">
<title>2026.08.27 코스피 데일리 리포트</title>
</head>
<body>
<section class="cover"><h1>두 개의 와이어</h1></section>
<main><p>본문 첫 문장이 한 줄을 대신하면 안 된다.</p></main>
</body>
</html>
`;

const LINE = '지수는 되돌렸지만 거래대금은 따라오지 않았다.';

/* ------------------------------------------------------- stamping the tag */

test('a lightweight Daily gains a head tag that carries the editor’s line', () => {
  assert.equal(readTakeaway(LIGHTWEIGHT_DAILY), '', 'the layout carries no marker to begin with');

  const { html, action } = stampTakeaway(LIGHTWEIGHT_DAILY, LINE);
  assert.equal(action, 'inserted');
  assert.match(html, /<meta name="report-takeaway" content="지수는 되돌렸지만 거래대금은 따라오지 않았다\.">/);
  assert.equal(readTakeaway(html), LINE);

  // The tag sits after the charset declaration, inside the head.
  const headEnd = html.indexOf('</head>');
  assert.ok(html.indexOf('report-takeaway') < headEnd, 'the tag belongs in the head');
  assert.ok(html.indexOf('<meta charset="utf-8">') < html.indexOf('report-takeaway'));
});

test('nothing else in the document moves', () => {
  const { html } = stampTakeaway(LIGHTWEIGHT_DAILY, LINE);
  const withoutTag = html.replace(/\r?\n<meta name="report-takeaway"[^>]*>/, '');
  assert.equal(withoutTag, LIGHTWEIGHT_DAILY, 'only the one tag is added');
});

test('the line is normalized and capped, never derived', () => {
  const { text } = stampTakeaway(LIGHTWEIGHT_DAILY, '  줄바꿈과\n  여백이​   섞인 문장.  ');
  assert.equal(text, '줄바꿈과 여백이 섞인 문장.');

  const long = stampTakeaway(LIGHTWEIGHT_DAILY, '가'.repeat(500));
  assert.equal(long.text.length, MAX_TAKEAWAY_LENGTH);

  // The title and description are right there and are still not used.
  assert.throws(() => stampTakeaway(LIGHTWEIGHT_DAILY, '   '), /빈 문구/);
  assert.throws(() => stampTakeaway(LIGHTWEIGHT_DAILY, ''), /빈 문구/);
});

test('a quote in the line does not break out of the attribute', () => {
  const { html } = stampTakeaway(LIGHTWEIGHT_DAILY, '"인용"이 섞인 <문장> & 기호.');
  assert.match(html, /content="&quot;인용&quot;이 섞인 &lt;문장&gt; &amp; 기호\."/);
  assert.equal(readTakeaway(html), '"인용"이 섞인 <문장> & 기호.');
});

test('stamping twice replaces rather than repeats', () => {
  const once = stampTakeaway(LIGHTWEIGHT_DAILY, LINE).html;
  const twice = stampTakeaway(once, '고쳐 쓴 한 줄.');
  assert.equal(twice.action, 'replaced');
  assert.equal((twice.html.match(/report-takeaway/g) || []).length, 1);
  assert.equal(readTakeaway(twice.html), '고쳐 쓴 한 줄.');
});

test('a document with no head is refused rather than mangled', () => {
  assert.throws(() => stampTakeaway('<p>조각난 HTML</p>', LINE), /<head>/);
});

test('the CRLF convention of the file is kept', () => {
  const crlf = LIGHTWEIGHT_DAILY.replace(/\n/g, '\r\n');
  const { html } = stampTakeaway(crlf, LINE);
  assert.ok(html.includes('\r\n<meta name="report-takeaway"'), 'a CRLF file stays CRLF');
  assert.doesNotMatch(html.replace(/\r\n/g, ''), /\n/, 'no lone LF is introduced');
});

/* ------------------------------- what the publishing admin makes of them */

/**
 * Mirrors assets/admin.js detectTakeaway against a document, so the four
 * required outcomes are asserted on the same priority order the admin uses.
 * The admin itself is exercised end to end in daily-takeaway-detect.test.mjs.
 */
function detectFrom(html) {
  const meta = /<meta[^>]*name="report-takeaway"[^>]*>/i.exec(html);
  if (meta) {
    const content = /content="([\s\S]*?)"/i.exec(meta[0])?.[1] || '';
    const text = normalizeTakeaway(content.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    if (text) return { text, source: 'meta' };
  }
  const cvOne = /<span[^>]*class="[^"]*\bcv-one\b[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<span/i.exec(html);
  if (cvOne) {
    const text = normalizeTakeaway(cvOne[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '));
    if (text) return { text, source: '.cover-hint .cv-one' };
  }
  return { text: '', source: 'none' };
}

test('1. the new lightweight Daily is detected through its head tag', () => {
  const { html } = stampTakeaway(LIGHTWEIGHT_DAILY, LINE);
  assert.deepEqual(detectFrom(html), { text: LINE, source: 'meta' });
});

test('2. the published 8/26 Daily is still detected through its cover', async () => {
  const html = await read('reports/8월 26일 주식리포트_커버통합.html');
  assert.equal(readTakeaway(html), '', 'it carries no head tag');
  const found = detectFrom(html);
  assert.equal(found.source, '.cover-hint .cv-one', 'the old path must keep working');
  assert.equal(found.text, 'PCE· 엔비디아· 금통위가 한 장에 겹친다');
});

test('3. with both present the head tag wins', async () => {
  const published = await read('reports/8월 26일 주식리포트_커버통합.html');
  const { html } = stampTakeaway(published, '헤드 태그가 이깁니다.');
  const found = detectFrom(html);
  assert.equal(found.source, 'meta');
  assert.equal(found.text, '헤드 태그가 이깁니다.');
  // The cover text is untouched; it is simply outranked.
  assert.match(html, /PCE/);
});

test('4. neither tag nor marker means no line at all', () => {
  const found = detectFrom(LIGHTWEIGHT_DAILY);
  assert.deepEqual(found, { text: '', source: 'none' });
  // Not the title, not the description, not the first sentence.
  assert.doesNotMatch(LIGHTWEIGHT_DAILY.slice(0, 0) + found.text, /코스피 데일리|설명이|본문 첫 문장/);
});

/* ----------------------------------------------- the admin agrees with us */

test('the admin and the stamper normalize identically', async () => {
  const script = await read('assets/admin.js');
  const adminNormalize = /function normalizeTakeaway\(value\) \{[\s\S]*?\n  \}/.exec(script)?.[0] || '';
  assert.ok(adminNormalize, 'the admin must have its own normalizer');
  for (const rule of ['\\u200B-\\u200D\\uFEFF', '\\s+', 'trim()', 'MAX_TAKEAWAY_LENGTH']) {
    assert.ok(adminNormalize.includes(rule), `${rule} must be part of it`);
  }
  assert.match(script, /const MAX_TAKEAWAY_LENGTH = 400;/);
});
