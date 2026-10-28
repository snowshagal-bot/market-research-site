import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyGlossaryList,
  extractGlossaryTerms,
  glossaryEntries,
  glossaryLetter,
  onGlossaryRequest,
  parseGlossaryPath,
  renderGlossaryList,
  serializeGlossary
} from '../functions/_glossary.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');
const PAGES = { ko: read('basics/glossary/index.html'), en: read('en/basics/glossary/index.html') };

/* ------------------------------------------------------------- extraction */

test('both tooltip markups are read, as plain text, first use of each term only', () => {
  const html = `
    <p>Some <span class="term">베이시스<span class="tip">선물 가격 − 현물 지수<span class="mid">·</span> 플러스면 콘탱고</span></span> text.</p>
    <p><button class="term" type="button" data-tip="코스피 대표 200종목으로 만든 지수 &amp; 선물의 기준">코스피200</button></p>
    <p><span class="term">베이시스<span class="tip">두 번째 설명은 버린다</span></span></p>
    <p><span class="term">1,337.30<span class="tip">숫자만 있는 용어는 뺀다</span></span></p>
    <p><span class="term">VIX<span class="tip">짧음</span></span></p>`;
  assert.deepEqual(extractGlossaryTerms(html), [
    { term: '베이시스', tip: '선물 가격 − 현물 지수 · 플러스면 콘탱고' },
    { term: '코스피200', tip: '코스피 대표 200종목으로 만든 지수 & 선물의 기준' }
  ]);
  assert.deepEqual(extractGlossaryTerms(''), []);
});

test('data/glossary.json is one report per line, sorted, empty reports left out', () => {
  const text = serializeGlossary([
    { id: 'b', glossaryTerms: [{ term: 'x', tip: 'tip text here' }] },
    { id: 'a', glossaryTerms: [{ term: 'y', tip: 'another tip' }] },
    { id: 'c', glossaryTerms: [] },
    { id: 'd' }
  ]);
  assert.equal(text, '{\n"a":[{"term":"y","tip":"another tip"}],\n"b":[{"term":"x","tip":"tip text here"}]\n}\n');
  assert.deepEqual(JSON.parse(text), { a: [{ term: 'y', tip: 'another tip' }], b: [{ term: 'x', tip: 'tip text here' }] });
  assert.equal(serializeGlossary([]), '{}\n');
});

test('every report entry in the search index carries the terms its HTML holds', () => {
  const posts = JSON.parse(read('data/posts.json'));
  const index = JSON.parse(read('data/search-index.json'));
  const hrefs = new Map(posts.map((post) => [post.id, post.href]));
  let withTerms = 0;
  for (const entry of index) {
    const href = hrefs.get(entry.id);
    assert.ok(href, entry.id);
    assert.deepEqual(entry.glossaryTerms, extractGlossaryTerms(read(href)), entry.id);
    if (entry.glossaryTerms.length) withTerms += 1;
  }
  assert.ok(withTerms > 100, `${withTerms} reports with terms`);
});

/* -------------------------------------------------------------- selection */

const post = (id, type, lang, date, title = id) => ({ id, type, lang, reportDate: date, title, href: `reports/${lang === 'en' ? 'en/' : ''}${id}.html` });

test('a Market Basics definition wins; dailies count only when repeated and not about one day', () => {
  const posts = [
    post('basics13', 'basics', 'ko', '2026-10-27', '증시 대기자금은 어디로 갔나'),
    post('d1', 'daily', 'ko', '2026-10-28'),
    post('d2', 'daily', 'ko', '2026-10-27'),
    post('d3', 'daily', 'ko', '2026-10-26'),
    post('e1', 'daily', 'en', '2026-10-28')
  ];
  const glossary = {
    basics13: [{ term: '투자자예탁금', tip: '주식을 사려고 증권사 계좌에 넣어 둔 돈.' }],
    d1: [
      { term: '투자자예탁금', tip: '오늘 2조 원 줄었다' },
      { term: '프로그램', tip: '여러 종목을 한 번에 사고파는 자동 주문' },
      { term: '삼성전자', tip: '오늘 지수 상승분의 앞줄' },
      { term: '혼자', tip: '한 번만 나온 데일리 용어' }
    ],
    d2: [{ term: '프로그램', tip: '여러 종목을 한 번에 사고파는 자동 주문' }, { term: '삼성전자', tip: '10월 27일 외국인 순매수 1위' }],
    d3: [{ term: '프로그램', tip: '다른 설명 하나' }],
    e1: [{ term: 'Basis', tip: 'Futures price minus the spot index.' }]
  };
  const ko = glossaryEntries(posts, glossary, 'ko');
  assert.deepEqual(ko.map((entry) => entry.term), ['투자자예탁금', '프로그램']);
  const deposits = ko[0];
  assert.equal(deposits.definition, '주식을 사려고 증권사 계좌에 넣어 둔 돈.');
  assert.deepEqual(deposits.sources.map((source) => source.title), ['증시 대기자금은 어디로 갔나', 'd1']);
  assert.equal(deposits.sources[0].url, '/reports/basics13');
  assert.equal(ko[1].definition, '여러 종목을 한 번에 사고파는 자동 주문');
  assert.equal(ko[1].mentions, 3);
  // The English page has only English reports' terms; one use with no Basics is not enough.
  assert.deepEqual(glossaryEntries(posts, glossary, 'en'), []);
});

test('spellings merge, the commonest wins, and Korean terms sort before Latin ones', () => {
  const posts = [post('a', 'daily', 'ko', '2026-10-01'), post('b', 'daily', 'ko', '2026-10-02'), post('c', 'basics', 'ko', '2026-10-03')];
  const glossary = {
    a: [{ term: 'Program Trading', tip: '여러 종목 자동 주문' }, { term: 'EPS', tip: '주당순이익. 순이익을 주식 수로 나눈 값' }],
    b: [{ term: 'Program trading', tip: '여러 종목 자동 주문' }, { term: 'EPS', tip: '주당순이익. 순이익을 주식 수로 나눈 값' }],
    c: [{ term: '가이던스', tip: '회사가 내놓는 실적 전망치.' }, { term: 'Program Trading', tip: '여러 종목을 묶어 한 번에 사고파는 매매.' }]
  };
  const entries = glossaryEntries(posts, glossary, 'ko');
  assert.deepEqual(entries.map((entry) => entry.term), ['가이던스', 'EPS', 'Program Trading']);
  assert.equal(entries[2].definition, '여러 종목을 묶어 한 번에 사고파는 매매.');
});

test('terms file under ㄱ…ㅎ (double consonants under their base), A…Z and 0–9', () => {
  assert.equal(glossaryLetter('거래대금'), 'ㄱ');
  assert.equal(glossaryLetter('까다로운'), 'ㄱ');
  assert.equal(glossaryLetter('호가'), 'ㅎ');
  assert.equal(glossaryLetter('eps'), 'E');
  assert.equal(glossaryLetter('5분봉'), '0–9');
});

/* ----------------------------------------------------------------- render */

test('the list goes into the page placeholder with an index and source links', () => {
  const entries = [
    { term: '가이던스', definition: '실적 전망치.', sources: [1, 2, 3, 4].map((n) => ({ title: `글 ${n}`, url: `/reports/r${n}` })), mentions: 4 },
    { term: 'EPS', definition: '주당순이익 <b>.', sources: [{ title: '글 1', url: '/reports/r1' }], mentions: 1 }
  ];
  const list = renderGlossaryList(entries, 'ko');
  assert.match(list, /용어 2개 · 리포트 4편의 설명에서 모았습니다/);
  assert.match(list, /<nav class="glossary-index" aria-label="용어 색인"><a href="#glossary-1">ㄱ<\/a><a href="#glossary-2">E<\/a><\/nav>/);
  assert.match(list, /<dt>가이던스<\/dt><dd><p>실적 전망치\.<\/p>/);
  assert.match(list, /<a href="\/reports\/r3">글 3<\/a> <small>외 1편<\/small>/);
  assert.doesNotMatch(list, /r4/);
  assert.match(list, /주당순이익 &lt;b&gt;\./);
  for (const lang of ['ko', 'en']) {
    const page = applyGlossaryList(PAGES[lang], list);
    assert.match(page, /<div class="glossary-list" data-glossary-list><p class="glossary-count">/);
    assert.doesNotMatch(page, /<p class="glossary-empty">/);
    assert.match(page, new RegExp(`<link rel="canonical" href="https://snowshagal.com${lang === 'en' ? '/en' : ''}/basics/glossary/">`));
  }
  assert.throws(() => applyGlossaryList('<main></main>', list), /placeholder/);
  assert.match(renderGlossaryList([], 'en'), /No terms have been collected yet/);
});

/* ------------------------------------------------------------------ route */

function context(url, { assetsFail = false } = {}) {
  let passed = 0;
  const posts = [post('basics13', 'basics', 'ko', '2026-10-27', '증시 대기자금은 어디로 갔나')];
  const glossary = { basics13: [{ term: '투자자예탁금', tip: '주식을 사려고 증권사 계좌에 넣어 둔 돈.' }] };
  return {
    get passed() { return passed; },
    request: new Request(url),
    env: {
      ASSETS: {
        async fetch(request) {
          if (assetsFail) return new Response('nope', { status: 500 });
          const { pathname } = new URL(request.url);
          if (pathname === '/data/posts.json') return Response.json(posts);
          if (pathname === '/data/glossary.json') return Response.json(glossary);
          return new Response('nf', { status: 404 });
        }
      }
    },
    next: async () => {
      passed += 1;
      const { pathname } = new URL(url);
      const page = pathname.startsWith('/en/') ? PAGES.en : PAGES.ko;
      return new Response(pathname.includes('glossary') ? page : 'static', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
  };
}

test('the route fills the glossary page, redirects to the slash form and leaves /basics/ alone', async () => {
  assert.deepEqual(parseGlossaryPath('/basics/glossary/'), { lang: 'ko', canonical: true });
  assert.deepEqual(parseGlossaryPath('/en/basics/glossary'), { lang: 'en', canonical: false });
  assert.equal(parseGlossaryPath('/basics/'), null);

  let ctx = context('https://snowshagal.com/basics/glossary/');
  let response = await onGlossaryRequest(ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<dt>투자자예탁금<\/dt>/);
  assert.match(html, /href="\/reports\/basics13">증시 대기자금은 어디로 갔나<\/a>/);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300');

  ctx = context('https://snowshagal.com/basics/glossary?x=1');
  response = await onGlossaryRequest(ctx);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://snowshagal.com/basics/glossary/?x=1');

  ctx = context('https://snowshagal.com/basics/');
  response = await onGlossaryRequest(ctx);
  assert.equal(await response.text(), 'static');
  assert.equal(ctx.passed, 1);
});

test('when the data cannot be read the static page goes out with its own note', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const ctx = context('https://snowshagal.com/en/basics/glossary/', { assetsFail: true });
    const response = await onGlossaryRequest(ctx);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<p class="glossary-empty">/);
    assert.equal(ctx.passed, 1, 'the static page is fetched once');
  } finally {
    console.error = originalError;
  }
});
