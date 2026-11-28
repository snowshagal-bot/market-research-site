import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { MARKET_INDICATORS } from '../functions/_market-indicators.js';
import { possibleTranslationPairs, reportLinkDiagnostics, rewriteReportLinks } from '../functions/_report-links.js';
import { findTranslationCounterpart } from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const posts = JSON.parse(await read('data/posts.json'));
const source = posts.find(post => post.id === '2026-11-20-note-1kci22o');
const koLink = '/reports/20261112_Investment_Insight_Who_Sold_UK_Account';
const enLink = '/reports/en/20261112_Snowshagal_Investment_Insight_No32_Who_Sold_UK_Account_EN';

test('reviewed English links localize only the approved source and revision', () => {
  const original = `<a href="${koLink}">No.32</a>`;
  assert.equal(rewriteReportLinks(original, posts, source), `<a href="${enLink}">No.32</a>`);
  const title = 'Who Sold KRW 214tn in Korean Equities?';
  assert.equal(rewriteReportLinks(`<a href="${koLink}" title="${title}">No.32</a>`, posts, source),
    `<a href="${enLink}" title="${title}">No.32</a>`);
  assert.equal(rewriteReportLinks(original, posts, { ...source, updatedAt: '2026-11-29T00:00:00Z' }), original);
  assert.equal(rewriteReportLinks(original, posts, { ...source, id: 'unreviewed-post' }), original);
  const citation = `<a hreflang="ko-KR" href="${koLink}">한국어 원문</a>`;
  assert.equal(rewriteReportLinks(citation, posts, source), citation);
  const variant = `<a href="${koLink}?a=1&amp;b=2#src-1">No.32</a>`;
  assert.equal(rewriteReportLinks(variant, posts, source), variant);
  const noCounterpart = posts.filter(post => post.href !== `${enLink.slice(1)}.html`);
  assert.equal(rewriteReportLinks(original, noCounterpart, source), original);
});

test('Unicode typo, legacy .html, www, and relative hrefs retain query and fragment', () => {
  const old = '시장을읽는말들_15편_영업이익은83조인데순이익은왜40조인가';
  const links = [
    `<a href='//www.snowshagal.com/reports/${encodeURIComponent(old.normalize('NFD'))}.html?x=1&amp;y=2#sources'>same edition</a>`,
    '<a href="./20261121_Investment_Insight_Nvidia_China_Remote_Access_EN.html#src-1">relative</a>',
    '<a href="https://snowshagal.com.evil.test/reports/missing">external</a>',
    '<script>const sample = \'<a href="/reports/nonexistent">literal</a>\';</script>',
    '<!-- <a href="/reports/nonexistent">comment</a> -->',
    '<a href="#src-1">note</a>'
  ];
  const actual = rewriteReportLinks(links.join(''), posts, source);
  assert.ok(actual.startsWith('<a href="https://snowshagal.com/reports/basics-15-net-income?x=1&amp;y=2#sources">same edition</a>'));
  assert.ok(actual.includes('<a href="/reports/en/20261121_Investment_Insight_Nvidia_China_Remote_Access_EN#src-1">relative</a>'));
  assert.ok(actual.endsWith(links.slice(2).join('')));
  assert.deepEqual(reportLinkDiagnostics(actual, source, posts).map(issue => issue.href), [
    'https://snowshagal.com/reports/basics-15-net-income?x=1&y=2#sources'
  ]);
});

test('a metadata-only review marker applies to exactly its saved revision', () => {
  const changed = '<a href="/market/archive/">Editorial change</a>';
  const original = `<a href="${koLink}">No.32</a>`;
  const updatedAt = '2026-11-29T00:00:00Z';
  const edited = { ...source, updatedAt, reportLinkReviewAt: updatedAt };
  assert.equal(rewriteReportLinks(original, posts, edited), `<a href="${enLink}">No.32</a>`);
  assert.equal(rewriteReportLinks(changed, posts, edited), changed);
  assert.equal(rewriteReportLinks(original, posts, { ...edited, updatedAt: '2026-11-30T00:00:00Z' }), original);
});

test('English Korean hub warnings preserve explicit Korean citations and exclude the brand home', () => {
  const plain = '<a href="https://www.snowshagal.com/market?view=weekly#section">Market</a>';
  const intentional = '<a href="/basics/"><em>Read the Korean original</em></a><a href="/daily/" hreflang="ko">Daily</a>';
  assert.deepEqual(reportLinkDiagnostics(plain + intentional + '<a href="/">SNOWSHAGAL</a>', source, posts), [
    { check: 'links.korean-hub', href: 'https://www.snowshagal.com/market?view=weekly#section', suggested: '/en/market/?view=weekly#section' }
  ]);
});

test('future links keep their labels, reopen once registered, and remain distinguishable from 404s', () => {
  const pending = '/reports/basics-22-settlement';
  const original = `<a class="next" href="${pending}">Part 22</a>`;
  const planned = rewriteReportLinks(original, posts, source);
  assert.equal(planned, `<a class="next" data-pending-report="${pending}">Part 22</a>`);
  assert.deepEqual(reportLinkDiagnostics(planned + '<a href="/reports/typo">typo</a>', source, posts).map(issue => issue.check),
    ['links.pending-report', 'links.broken-report']);
  const published = [...posts, { id: 'part-22', lang: 'ko', href: 'reports/basics-22-settlement.html' }];
  assert.equal(rewriteReportLinks(original, published, source), original);
  assert.deepEqual(reportLinkDiagnostics(`<a href="${koLink}"><em>Read the Korean original</em></a>`, source, posts), []);
});

test('only confirmed bilingual editions share each repaired translation group', () => {
  for (const [ko, en] of [
    ['2026-08-03-daily-181n1pj', '2026-08-03-daily-ely1wy'],
    ['2026-11-24-research-1ylfgyu', '2026-11-24-research-at00qm']
  ]) {
    const korean = posts.find(post => post.id === ko);
    const english = posts.find(post => post.id === en);
    assert.equal(findTranslationCounterpart(posts, korean), english);
    assert.equal(findTranslationCounterpart(posts, english), korean);
  }
  const english = { id: 'en-draft', lang: 'en', date: '2026-11-24', type: 'research' };
  const korean = { id: 'ko-draft', date: '2026-11-24', type: 'research' };
  assert.deepEqual(possibleTranslationPairs(english, [english, korean]), [korean]);
  assert.equal(findTranslationCounterpart([english, korean], english), null);
});

test('language switch targets the same market and disclosure page in both directions', async () => {
  const context = { window: {}, URLSearchParams };
  vm.runInNewContext(await read('assets/locale.js'), context);
  const { pageLanguagePath } = context.window.MARKET_LOCALE;
  for (const slug of [...MARKET_INDICATORS.map(indicator => indicator.slug), 'archive', 'sectors', 'investor-flows', '2026-11-24']) {
    assert.equal(pageLanguagePath(`/market/${slug}/`, 'en'), `/en/market/${slug}/`);
    assert.equal(pageLanguagePath(`/en/market/${slug}/`, 'ko'), `/market/${slug}/`);
  }
  assert.equal(pageLanguagePath('/disclosures/index.html', 'en', '?date=2026-11-24&all=true&junk=1'), '/en/disclosures/?date=2026-11-24&all=1');
  assert.equal(pageLanguagePath('/en/disclosures/', 'ko', '?date=bad&all=0'), '/disclosures/');
  assert.equal(pageLanguagePath('/market/unknown/', 'en'), '/en/');
});

test('report language switch resolves extensionless and encoded Unicode canonical paths', async () => {
  const context = { window: {}, URLSearchParams };
  vm.runInNewContext(await read('assets/locale.js'), context);
  const { findCounterpart } = context.window.MARKET_LOCALE;
  const canonical = `/reports/${encodeURIComponent('8월 3일 주식리포트_커버통합'.normalize('NFD'))}`;
  assert.equal(findCounterpart(posts, canonical, 'en')?.id, '2026-08-03-daily-ely1wy');
  assert.equal(findCounterpart(posts, '/reports/en/2026-08-03_KOSPI_Daily_Report_EN', 'ko')?.id, '2026-08-03-daily-181n1pj');
});
