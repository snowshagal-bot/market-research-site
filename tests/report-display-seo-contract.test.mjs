// PR B2: where a post's stored metadata is shown, and how its search and share
// description is built. The browser scripts are run here with the real
// assets/locale.js next to the server renderers, so a page reads the same in
// its first HTML and after the script re-renders it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import '../assets/locale.js';
import '../assets/report-metadata.js';
import { parseHtml } from './helpers/html-dom.mjs';
import {
  categoryArchiveLinks,
  categoryFeaturedCards,
  homepageLatestLinks,
  homepageReportLinks,
  reportDescription,
  reportSeoTags,
  reportSeoTitle,
  sentence
} from '../functions/_seo.js';
import { buildHomeInitial } from '../functions/_home-initial.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const { editorialBlurb } = globalThis.MARKET_LOCALE;
const TAGS = { rates: { ko: '금리', en: 'Rates', group: 'macro' }, flows: { ko: '수급', en: 'Flows', group: 'market' } };

function post(lang, id, type, date, extra = {}) {
  return {
    id: `${lang}-${id}`, type, lang, date, reportDate: date, registeredAt: `${date}T09:00:00+09:00`,
    title: `${lang === 'en' ? 'Report' : '리포트'} ${id}`, href: `reports/${lang}-${id}.html`,
    readingMinutes: 4, tags: ['rates', 'flows'], ...extra
  };
}

// A. summary + description (and a subtitle and takeaway beside them) → summary
// B. description only (and a subtitle)                              → description
// C. subtitle only (and a takeaway)                                 → no blurb
// D. nothing                                                        → no blurb
const BLURBS = {
  A: { summary: '요약 문장', description: '설명 문장', subtitle: '부제', takeaway: '오늘의 한 줄' },
  B: { description: '설명 문장', subtitle: '부제' },
  C: { subtitle: '부제만 있다', takeaway: '한 줄만 있다' },
  D: {}
};

function corpus(lang) {
  const rows = [
    post(lang, 'daily-a', 'daily', '2026-09-10', BLURBS.A),
    post(lang, 'weekly-b', 'weekly', '2026-09-09', BLURBS.B),
    post(lang, 'research-c', 'research', '2026-09-08', BLURBS.C),
    post(lang, 'note-d', 'note', '2026-09-07', BLURBS.D),
    post(lang, 'daily-b', 'daily', '2026-09-06', BLURBS.B),
    post(lang, 'daily-c', 'daily', '2026-09-05', BLURBS.C),
    post(lang, 'daily-d', 'daily', '2026-09-04', BLURBS.D),
    post(lang, 'basics-d', 'basics', '2026-09-03', { ...BLURBS.D, tags: [] })
  ];
  // Enough older Dailies that the HOME archive has a second page.
  for (let day = 1; day <= 16; day += 1) rows.push(post(lang, `old-${day}`, 'daily', `2026-08-${String(day).padStart(2, '0')}`, BLURBS.A));
  return rows;
}

/* ------------------------------------------------------------ the helper */

test('the editorial blurb is the summary, else the description, else nothing — never the subtitle or takeaway', () => {
  assert.equal(editorialBlurb(BLURBS.A), '요약 문장');
  assert.equal(editorialBlurb(BLURBS.B), '설명 문장');
  assert.equal(editorialBlurb(BLURBS.C), '');
  assert.equal(editorialBlurb(BLURBS.D), '');
  assert.equal(editorialBlurb({ summary: '  두 줄\n요약  ', description: '설명' }), '두 줄 요약');
  assert.equal(editorialBlurb({ summary: '   ', description: '설명' }), '설명');
  assert.equal(editorialBlurb(null), '');
});

/* --------------------------------------------------- reading rendered HTML */

const text = (node) => (node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : null);
function archiveRows(markup) {
  return parseHtml(`<div>${markup}</div>`).querySelectorAll('.report-item').map((row) => ({
    href: row.getAttribute('href'),
    type: text(row.querySelector('.report-type')),
    date: text(row.querySelector('.report-date')),
    title: text(row.querySelector('.report-title')),
    line: text(row.querySelector('.report-subtitle')),
    tags: text(row.querySelector('.report-tags')),
    read: text(row.querySelector('.report-read-label'))
  }));
}
const moreButton = (markup) => text(parseHtml(`<div>${markup}</div>`).querySelector('#archive-more'));
// prefix: 'latest-card' (HOME) or 'category-featured' (landing); the card is `.${prefix}` or `.${prefix}-card`.
function cards(markup, prefix) {
  const card = prefix === 'latest-card' ? '.latest-card' : `.${prefix}-card`;
  return parseHtml(`<div>${markup}</div>`).querySelectorAll(card).map((card) => ({
    href: card.getAttribute('href'),
    meta: text(card.querySelector(`.${prefix}-meta b`)),
    date: text(card.querySelector(`.${prefix}-meta time`)),
    title: text(card.querySelector(`.${prefix}-title`)),
    summary: text(card.querySelector(`.${prefix}-summary`)),
    tags: text(card.querySelector(`.${prefix}-tags`))
  }));
}

/* ----------------------------------------------- the pages' own scripts */

function stub(id = '') {
  const listeners = {};
  return {
    id, hidden: false, textContent: '', innerHTML: '', href: '', src: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    // A copy: a re-render adds its own listener while this one runs.
    click() { for (const fn of [...(listeners.click || [])]) fn({ preventDefault() {} }); },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, hasAttribute() { return false; },
    getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; },
    closest() { return null; }, appendChild() {}, focus() {}, showModal() {}, close() {},
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

/** Runs assets/locale.js and assets/site.js for the homepage; returns its elements. */
async function bootHome(posts, lang, { search = '', calendarDay = '' } = {}) {
  const [locale, site] = await Promise.all([read('assets/locale.js'), read('assets/site.js')]);
  const elements = {};
  const byId = (id) => (elements[id] ||= stub(id));
  const day = Object.assign(stub('day'), { dataset: { calDate: calendarDay } });
  byId('calendar-container').querySelectorAll = (selector) => (selector === '.calendar-day.has-report' ? [day] : []);
  const window = { RESEARCH_POSTS: posts, TAG_REGISTRY: TAGS, addEventListener() {} };
  const context = vm.createContext({
    window,
    console, Intl, URL, URLSearchParams, setTimeout, clearTimeout,
    fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    location: { pathname: lang === 'en' ? '/en/' : '/', search, href: `https://snowshagal.com${lang === 'en' ? '/en/' : '/'}${search}`, replace() {} },
    history: { replaceState() {}, pushState() {} },
    document: {
      documentElement: { lang, dataset: {} },
      body: { classList: { contains: () => true }, dataset: {} },
      readyState: 'complete',
      addEventListener() {},
      createElement: () => stub(),
      getElementById: byId,
      querySelector: (selector) => (selector.startsWith('#') ? byId(selector.slice(1)) : stub()),
      querySelectorAll: () => []
    }
  });
  vm.runInContext(locale, context);
  vm.runInContext(site, context);
  if (calendarDay) day.click();
  return byId;
}

/** Runs assets/locale.js and assets/category-landing.js for one landing page. */
async function bootCategory(posts, lang, category) {
  const [locale, landing] = await Promise.all([read('assets/locale.js'), read('assets/category-landing.js')]);
  const elements = {};
  const byId = (id) => (elements[id] ||= stub(id));
  const sandbox = {
    document: { documentElement: { lang, dataset: {} }, body: { dataset: { category } }, getElementById: byId, querySelectorAll: () => [] },
    RESEARCH_POSTS: posts,
    TAG_REGISTRY: TAGS
  };
  sandbox.window = sandbox;
  vm.runInNewContext(`${locale}\n${landing}`, sandbox);
  return byId;
}

/* ----------------------------------------------------- HOME and categories */

test('HOME archive: an explicit subtitle only, and the first HTML matches the page after site.js runs', async () => {
  for (const lang of ['ko', 'en']) {
    const posts = corpus(lang);
    const server = homepageReportLinks(posts, lang, 20, TAGS);
    const rows = archiveRows(server);
    const byTitle = (id) => rows.find((row) => row.href === `/reports/${lang}-${id}`);
    assert.equal(byTitle('daily-a').line, '부제', `${lang}: A shows its subtitle, not its summary`);
    assert.equal(byTitle('weekly-b').line, '부제', `${lang}: B shows its subtitle, not its description`);
    assert.equal(byTitle('research-c').line, '부제만 있다', `${lang}: C shows its subtitle`);
    assert.equal(byTitle('note-d').line, null, `${lang}: D has no line and no empty element`);
    assert.equal(byTitle('old-16').line, '부제', `${lang}: an older row follows the same rule`);
    assert.doesNotMatch(server, /요약 문장|설명 문장|오늘의 한 줄|한 줄만 있다/, `${lang}: no summary, description or takeaway in the HOME archive`);

    const browser = (await bootHome(posts, lang))('report-list').innerHTML;
    assert.deepEqual(archiveRows(browser), rows, `${lang}: same rows, same order, same visible text`);
    assert.equal(moreButton(browser), moreButton(server), `${lang}: the same "more" button past the first page`);
    assert.ok(moreButton(server), `${lang}: the fixture has a second page`);
  }
});

test('HOME latest cards: the editorial blurb, identical in the first HTML and after site.js runs', async () => {
  for (const lang of ['ko', 'en']) {
    const posts = corpus(lang);
    const server = cards(homepageLatestLinks(posts, lang, TAGS), 'latest-card');
    assert.deepEqual(server.map((card) => card.summary), ['요약 문장', '설명 문장', null], `${lang}: A → summary, B → description, C → none`);
    const browser = cards((await bootHome(posts, lang))('latest-category-cards').innerHTML, 'latest-card');
    assert.deepEqual(browser, server, lang);
  }
});

test('Latest Research slide: the editorial blurb or a hidden empty line, the same from the server and site.js', async () => {
  const url = (lang) => new URL(lang === 'en' ? 'https://snowshagal.com/en/' : 'https://snowshagal.com/');
  const none = async () => null;
  for (const lang of ['ko', 'en']) {
    for (const [extra, expected] of [[BLURBS.A, '요약 문장'], [BLURBS.B, '설명 문장'], [BLURBS.C, ''], [BLURBS.D, '']]) {
      const posts = [post(lang, 'research', 'research', '2026-09-08', extra)];
      const home = await buildHomeInitial(url(lang), {}, posts, { readMarket: none, readNotice: none, readGlobal: none });
      const edit = home.edits.find((item) => item.id === 'hero-featured-snippet');
      const snippet = (await bootHome(posts, lang))('hero-featured-snippet');
      assert.equal(edit.text, expected, `${lang}: server`);
      assert.equal(snippet.textContent, expected, `${lang}: browser`);
      assert.equal(Boolean(edit.attrs && 'hidden' in edit.attrs), !expected, `${lang}: server hides an empty line`);
      assert.equal(snippet.hidden, !expected, `${lang}: browser hides an empty line`);
    }
  }
});

test('category featured cards and archive rows: the editorial blurb, the same from the server and category-landing.js', async () => {
  for (const lang of ['ko', 'en']) {
    const posts = corpus(lang);
    const serverFeatured = cards(categoryFeaturedCards(posts, 'daily', lang, TAGS), 'category-featured');
    const serverArchive = archiveRows(categoryArchiveLinks(posts, 'daily', lang, TAGS));
    // Featured: A then B. Archive: C, D, then the older A rows.
    assert.deepEqual(serverFeatured.map((card) => card.summary), ['요약 문장', '설명 문장'], lang);
    assert.deepEqual(serverArchive.slice(0, 2).map((row) => row.line), [null, null], `${lang}: C and D carry no line — a subtitle is not a blurb`);
    assert.equal(serverArchive[2].line, '요약 문장', lang);
    assert.ok(serverArchive.every((row) => row.type === (lang === 'en' ? 'Daily' : '데일리')), `${lang}: the public category name`);

    const page = await bootCategory(posts, lang, 'daily');
    assert.deepEqual(cards(page('category-featured-cards').innerHTML, 'category-featured'), serverFeatured, `${lang}: featured`);
    assert.deepEqual(archiveRows(page('category-report-list').innerHTML), serverArchive, `${lang}: archive`);
  }
});

test('a category page with no editorial line renders no empty paragraph, placeholder or category sentence', async () => {
  const posts = [post('ko', 'basics-1', 'basics', '2026-09-03'), post('ko', 'basics-2', 'basics', '2026-09-02'), post('ko', 'basics-3', 'basics', '2026-09-01')];
  const featured = categoryFeaturedCards(posts, 'basics', 'ko', TAGS);
  const archive = categoryArchiveLinks(posts, 'basics', 'ko', TAGS);
  assert.doesNotMatch(featured, /category-featured-summary/);
  assert.doesNotMatch(archive, /report-subtitle/);
  const page = await bootCategory(posts, 'ko', 'basics');
  assert.doesNotMatch(page('category-featured-cards').innerHTML, /category-featured-summary/);
  assert.doesNotMatch(page('category-report-list').innerHTML, /report-subtitle/);
  for (const markup of [featured, archive]) assert.doesNotMatch(markup, /기본 개념을 이해하기 쉽게|Snowshagal의/);
});

test('calendar preview: the editorial blurb, and no element at all without one', async () => {
  for (const [extra, expected] of [[BLURBS.A, '요약 문장'], [BLURBS.B, '설명 문장'], [BLURBS.C, null], [BLURBS.D, null]]) {
    const posts = [post('ko', 'weekly', 'weekly', '2026-08-03', extra)];
    const page = await bootHome(posts, 'ko', { search: '?category=weekly&view=calendar&calMonth=2026-08', calendarDay: '2026-08-03' });
    const markup = page('calendar-container').innerHTML;
    assert.match(markup, /calendar-preview-card/, 'the day was selected');
    assert.equal(text(parseHtml(`<div>${markup}</div>`).querySelector('.calendar-preview-summary')), expected);
    if (!expected) assert.doesNotMatch(markup, /calendar-preview-summary/);
  }
});

test('Related Reading takes the editorial blurb; previous and next stay title-only', async () => {
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /const summary = localeApi\?\.editorialBlurb\?\.\(item\) \|\| '';/);
  assert.doesNotMatch(shell, /item\.subtitle \|\| item\.summary/);
  const prevNext = shell.slice(shell.indexOf('prevnextHtml'), shell.indexOf('// Render Related Reading'));
  assert.ok(prevNext.length > 200, 'found the previous/next renderer');
  assert.doesNotMatch(prevNext, /summary|description|subtitle/, 'previous and next show title and meta only');
});

/* ------------------------------------------------------ SEO description */

const dailyFacts = (date, takeaway = { ko: '', en: '' }) => ({
  kind: 'daily', marketDate: date,
  kospi: { close: 6627.26, pct: -0.8543 }, kosdaq: { close: 812.41, pct: 0.6966 },
  foreignNet: -1571, institutionNet: -904, takeaway
});
const weeklyFacts = { kind: 'weekly', period: { start: '2026-09-14', end: '2026-09-18' }, previousClose: 6600, close: 6590.12, pct: -0.23 };

test('a Daily with a Market Close keeps its facts and its day line: Market takeaway, then takeaway, then summary — never the description', () => {
  const base = { id: 'd', type: 'daily', lang: 'ko', reportDate: '2026-09-15', title: '바람', href: 'reports/d.html', description: '설명은 붙지 않는다' };
  const facts = dailyFacts('2026-09-15');
  const lead = '2026년 9월 15일 코스피 6,627.26 (-0.85%), 코스닥 812.41 (+0.70%) 마감. 외국인 1.57조 순매도 · 기관 9,040억 순매도.';
  assert.equal(reportDescription(base, { facts }), lead);
  assert.equal(reportDescription({ ...base, summary: '요약' }, { facts }), `${lead} 요약.`);
  assert.equal(reportDescription({ ...base, summary: '요약', takeaway: '한 줄' }, { facts }), `${lead} 한 줄.`);
  assert.equal(reportDescription({ ...base, summary: '요약', takeaway: '한 줄' }, { facts: dailyFacts('2026-09-15', { ko: '마켓 한 줄', en: '' }) }), `${lead} 마켓 한 줄.`);
  assert.equal(reportDescription({ ...base, takeaway: '왜 올랐나?' }, { facts }), `${lead} 왜 올랐나?`);
  const en = reportDescription({ ...base, lang: 'en', summary: 'The index held.' }, { facts });
  assert.equal(en, 'Sep 15, 2026: KOSPI closed at 6,627.26 (-0.85%), KOSDAQ 812.41 (+0.70%). Foreign investors net sold KRW 1.57tn; institutions net sold KRW 904bn. The index held.');
});

test('a Daily without a Market Close uses its editorial blurb, else the facts of the page — never its takeaway', () => {
  const base = { id: 'd', type: 'daily', lang: 'en', reportDate: '2026-09-15', title: 'The Wind Moved Elsewhere', href: 'reports/d.html' };
  assert.equal(reportDescription({ ...base, ...BLURBS.A }), '요약 문장');
  assert.equal(reportDescription({ ...base, ...BLURBS.B }), '설명 문장');
  assert.equal(reportDescription({ ...base, ...BLURBS.C }), 'Sep 15, 2026 Daily — The Wind Moved Elsewhere.');
  assert.equal(reportDescription({ ...base, lang: 'ko', title: '바람은 다른 곳으로 갔다', ...BLURBS.C }), '2026년 9월 15일 데일리 — 바람은 다른 곳으로 갔다.');
});

test('a Weekly with facts adds its summary only — not its description, not a takeaway; without facts it uses its blurb', () => {
  const base = { id: 'w', type: 'weekly', lang: 'ko', reportDate: '2026-09-20', title: '되찾은 자리', href: 'reports/w.html', tags: ['rates'] };
  const lead = '2026년 9월 14일–9월 18일 코스피 주간 -0.23% (6,600.00 → 6,590.12). 다음 주 변수: 금리.';
  const withFacts = (extra) => reportDescription({ ...base, ...extra }, { facts: weeklyFacts, tagRegistry: TAGS });
  assert.equal(withFacts({}), lead);
  assert.equal(withFacts({ description: '코스피 -0.23% 주간 리포트' }), lead, 'the description repeats the week and stays out');
  assert.equal(withFacts({ takeaway: '한 줄' }), lead);
  assert.equal(withFacts({ summary: '잃은 자리를 이틀에 되찾았다', description: '설명' }), `${lead} 잃은 자리를 이틀에 되찾았다.`);
  assert.equal(reportDescription({ ...base, description: '설명만 있다' }), '설명만 있다');
  assert.equal(reportDescription({ ...base, summary: '요약', description: '설명' }), '요약');
  assert.equal(reportDescription(base), '2026년 9월 20일 위클리 — 되찾은 자리.');
});

test('Research, Investment Note and Market Basics use the editorial blurb as written, else the facts of the page', () => {
  const research = { id: 'r', type: 'research', lang: 'en', reportDate: '2026-09-19', title: 'Are Humanoids Really Working?', href: 'reports/r.html' };
  assert.equal(reportDescription({ ...research, description: 'Units shipped are not work done.' }), 'Units shipped are not work done.');
  assert.equal(reportDescription(research), 'Sep 19, 2026 Research — Are Humanoids Really Working?');
  const note = { id: 'n', type: 'note', lang: 'ko', reportDate: '2026-09-29', title: '사흘치 금리를 하루에', href: 'reports/n.html' };
  assert.equal(reportDescription({ ...note, description: '추석 휴장 사흘 동안 미국 10년 금리 +21bp' }), '추석 휴장 사흘 동안 미국 10년 금리 +21bp');
  assert.equal(reportDescription(note), '2026년 9월 29일 투자 노트 — 사흘치 금리를 하루에.');
  const basics = { id: 'b', type: 'basics', lang: 'ko', reportDate: '2026-08-29', title: '1코인은 어떻게 1달러가 되는가?', href: 'reports/b.html' };
  assert.equal(reportDescription(basics), '2026년 8월 29일 시장 입문 — 1코인은 어떻게 1달러가 되는가?');
  assert.equal(reportDescription({ ...basics, lang: 'en', title: 'How Does 1 Coin Become $1?' }), 'Aug 29, 2026 Market Basics — How Does 1 Coin Become $1?');
  // Only the pieces that exist, and never an empty description.
  assert.equal(reportDescription({ type: 'basics', lang: 'en', title: 'Untitled Draft' }), 'Market Basics — Untitled Draft.');
  assert.equal(reportDescription({ type: 'note', lang: 'ko', reportDate: '2026-09-01' }), '2026년 9월 1일 투자 노트.');
  assert.equal(reportDescription({}), '리포트.');
});

test('sentences keep the punctuation they end with and gain a full stop only when they have none', () => {
  assert.equal(sentence('질문?'), '질문?');
  assert.equal(sentence('문장.'), '문장.');
  assert.equal(sentence('문장'), '문장.');
  assert.equal(sentence('감탄!'), '감탄!');
  assert.equal(sentence('여운…'), '여운…');
  assert.equal(sentence('끝。'), '끝。');
  assert.equal(sentence('질문?”'), '질문?”');
  assert.equal(sentence('He asked "why?"'), 'He asked "why?"');
  assert.equal(sentence("(as noted.)"), '(as noted.)');
  assert.equal(sentence('  두 줄\n문장  '), '두 줄 문장.');
  assert.equal(sentence(''), '');
});

test('every published post: a unique, non-empty description with no "?." or "..", no category sentence and no generic Snowshagal line', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const retired = /Snowshagal의 .* 콘텐츠입니다|A Snowshagal .* covering the market context|시장 흐름과 핵심 변수를 정리한|covering the market context and key variables/;
  const descriptions = posts.map((entry) => reportDescription(entry, { tagRegistry: TAGS }));
  assert.equal(new Set(descriptions).size, posts.length);
  descriptions.forEach((description, index) => {
    const id = posts[index].id;
    assert.ok(description && description.length <= 180, id);
    assert.doesNotMatch(description, /\?\.|!\.|[^.]\.\.(?!\.)|^\.\./, `${id}: ${description}`);
    assert.doesNotMatch(description, retired, id);
    assert.ok(!globalThis.REPORT_METADATA.CATEGORY_DEFAULT_DESCRIPTIONS.some((entry) => description.includes(entry.text.replace(/\.$/, ''))), id);
  });
});

test('the meta, Open Graph, X and JSON-LD descriptions are one text, including the factual fallback', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const attribute = (value) => value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const entry of posts) {
    const tags = reportSeoTags(posts, entry);
    const meta = (name) => attribute(new RegExp(`<meta ${name} content="([^"]*)">`).exec(tags)[1]);
    const article = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(tags)[1])['@graph'].find((node) => node['@type'] === 'Article');
    const expected = reportDescription(entry);
    assert.deepEqual([meta('name="description"'), meta('property="og:description"'), meta('name="twitter:description"'), article.description], [expected, expected, expected, expected], entry.id);
  }
});

test('the SEO title reads none of the blurb fields', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  for (const entry of posts) {
    const bare = { ...entry };
    for (const field of ['summary', 'description', 'subtitle', 'takeaway']) delete bare[field];
    const filled = { ...entry, summary: 'S', description: 'D', subtitle: 'T', takeaway: 'K' };
    assert.equal(reportSeoTitle(bare), reportSeoTitle(entry), entry.id);
    assert.equal(reportSeoTitle(filled), reportSeoTitle(entry), entry.id);
  }
});

test('the search index still carries summary || description (#147), untouched by the display rules', async () => {
  const [posts, index] = await Promise.all([read('data/posts.json'), read('data/search-index.json')].map((p) => p.then(JSON.parse)));
  const byId = new Map(posts.map((entry) => [entry.id, entry]));
  for (const entry of index) {
    const source = byId.get(entry.id);
    assert.equal(entry.summary, source.summary || source.description || '', entry.id);
  }
});
