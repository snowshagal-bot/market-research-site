import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { reportDescription } from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * The cover families whose children stand for a row rather than for emphasis.
 * Each pair is display:block in the stylesheet of every report that uses it,
 * and the list is kept in step with COVER_ROWS in assets/admin.js.
 */
const COVER_ROWS = [
  ['cover-title', 'i'],
  ['cover-oneline', 'i'],
  ['cover-idx', 'i'],
  ['cv-one', 'i'],
  ['cvtitle', 'span']
];

const collapse = text => text
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/[​-‍﻿⁠]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * The two readings of one element's markup.
 *
 * `glued` is what a browser's textContent gives back: no tag contributes a
 * space of its own, so a value set on two rows arrives with the rows run
 * together. `spaced` is the same reading with each row restored — a <br>, and
 * a child of a family listed above.
 *
 * Anywhere else the two agree, and the value the editor typed into the form is
 * what settles it.
 */
function readings(openTag, inner) {
  const family = /class="([^"]*)"/.exec(openTag)?.[1] || '';
  const rowTag = COVER_ROWS.find(([parent]) => family.split(/\s+/).includes(parent))?.[1];
  let spaced = inner.replace(/<br\b[^>]*>/gi, ' ');
  if (rowTag) {
    spaced = spaced.replace(new RegExp(`<${rowTag}\\b[^>]*>([\\s\\S]*?)</${rowTag}>`, 'gi'), ' $1 ');
  }
  return {
    glued: collapse(inner.replace(/<[^>]+>/g, '')),
    spaced: collapse(spaced.replace(/<[^>]+>/g, ''))
  };
}

// The closing tag has to be the one that opened, or a wrapper full of <i>
// rows ends at the first </i> and the reading is only its first row.
function firstElement(html, pattern) {
  const found = pattern.exec(html);
  if (!found) return null;
  const [, tag, inner] = found;
  assert.ok(tag && inner !== undefined, 'the pattern must capture a tag and its contents');
  return readings(found[0].slice(0, found[0].indexOf('>') + 1), inner);
}

const titleOf = html => firstElement(html, /<(h1)\b[^>]*>([\s\S]*?)<\/\1>/i);
const summaryOf = html => firstElement(
  html,
  /<([a-z0-9]+)\b[^>]*class="[^"]*\bcover-(?:oneline|summary|description)\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i
);

test('no published title is its own cover read with the rows run together', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const glued = [];

  for (const post of posts) {
    if (!post.href) continue;
    let html;
    try { html = await read(post.href); } catch { continue; }
    if (/<meta\s+name=["']report-title["']/i.test(html)) continue;

    const reading = titleOf(html);
    if (!reading || reading.glued === reading.spaced) continue;
    if (post.title === reading.glued) {
      glued.push(`${post.id}: ${JSON.stringify(post.title)} should read ${JSON.stringify(reading.spaced)}`);
    }
  }

  assert.deepEqual(glued, [], `titles missing a space the layout shows:\n  ${glued.join('\n  ')}`);
});

test('no stored summary is its own cover read with the rows run together', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const glued = [];

  for (const post of posts) {
    if (!post.href || !post.summary) continue;
    let html;
    try { html = await read(post.href); } catch { continue; }

    const reading = summaryOf(html);
    if (!reading || reading.glued === reading.spaced) continue;
    if (collapse(post.summary) === reading.glued) {
      glued.push(`${post.id}: ${JSON.stringify(post.summary.slice(0, 60))} should read ${JSON.stringify(reading.spaced.slice(0, 60))}`);
    }
  }

  assert.deepEqual(glued, [], `summaries missing a space the layout shows:\n  ${glued.join('\n  ')}`);
});

test('a stored summary reaches a search result on one line', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const ragged = posts
    .filter(post => post.summary && post.summary !== collapse(post.summary))
    .map(post => `${post.id}: ${JSON.stringify(post.summary.slice(0, 50))}`);
  assert.deepEqual(ragged, [], `summaries carrying raw line breaks:\n  ${ragged.join('\n  ')}`);
});

test('the repaired titles are the ones the covers actually set', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const byId = new Map(posts.map(post => [post.id, post.title]));

  // Ten ran their rows together across a <br>, five across a child the
  // stylesheet turns into a block. They are named outright so a regeneration
  // that reintroduces the glue is caught here rather than in a search result.
  const repaired = {
    '2026-09-02-note-1ojta7j': 'WGBI, Three Tranches Left',
    '2026-09-02-note-xgdd5t': 'WGBI, 남은 세 번',
    '2026-09-01-daily-1uv21dp': 'An Index Held Up, Every KOSDAQ Top 10 Constituent Fell',
    '2026-09-01-daily-1oq37xo': '붙잡힌 시장 가라앉은 지수',
    '2026-09-01-note-1k5d647': 'September 15: A Check on U.S. Money Markets',
    '2026-09-01-note-u23dp3': '9월 15일, 미국 자금시장 점검',
    '2026-08-29-weekly-4xkdij': 'While One Pillar Took a Breather',
    '2026-08-04-weekly-q9jryh': '한 축이 쉬는 동안',
    '2026-08-29-research-15pk9zq': 'Behind the Coin Are Treasuries',
    '2026-08-29-research-178u9g5': '코인의 뒷면에는 국채가 있다',
    '2026-08-26-daily-15udspv': 'The Night Opens First',
    '2026-08-26-daily-1ufok0a': '먼저 열리는 밤',
    '2026-08-20-basics-1txn8bp': 'How a Selloff Feeds on Itself',
    '2026-08-20-basics-1jqzwpd': '급락은 어떻게 더 큰 급락을 만드는가',
    '2026-08-15-basics-ntseyw': 'A Good Company Isn’t Always a Good Stock'
  };

  for (const [id, title] of Object.entries(repaired)) {
    assert.equal(byId.get(id), title, id);
  }
});

test('the repaired summaries keep their own words and gain only spaces', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const byId = new Map(posts.map(post => [post.id, post.summary]));

  // Nothing here is rewritten: each pair differs by whitespace alone.
  const repaired = {
    '2026-08-21-daily-16tx7f1': '193 stocks up. 683 stocks down.',
    '2026-08-19-daily-otvpwu': 'As the 30-year yield hit a high, the biggest prior winners were sold first',
    '2026-08-18-daily-tfmejq': 'The memory catalyst stayed with SK Hynix, while institutional and non-arbitrage selling cut breadth to 22%.',
    '2026-08-13-daily-1nnspvd': 'The Index Rose Like the Tide 533 Left in the Mudflats',
    '2026-08-11-daily-yxlmio': 'One ship on the ripples. The waters ahead are still dark.',
    '2026-08-24-daily-og5aig': 'As oil prices and interest rates cool. Returning hands.',
    '2026-08-16-research-141u5l9': 'GPU는 채권이 될 수 있을까? 칩 위에 붙은 이자를 알아보자.'
  };

  for (const [id, summary] of Object.entries(repaired)) {
    assert.equal(byId.get(id), summary, id);
  }
});

test('a title the editor spaced by hand is never rewritten from the markup', async () => {
  // 고도<span class="han">(高度)</span>를<br/>기다리며 — the gloss is inline, so
  // the browser reads no space before it and the editor supplied one. Reading
  // every span as a row would take that space back out.
  const posts = JSON.parse(await read('data/posts.json'));
  const post = posts.find(entry => entry.id === '2026-08-12-daily-15kwiwr');
  assert.ok(post, 'the 高度 report is still published');
  assert.equal(post.title, '고도 (高度)를 기다리며');
});

test('a report describes itself with its own line rather than its category', () => {
  const base = {
    id: 'r-1', type: 'daily', lang: 'ko', href: 'reports/r-1.html',
    date: '2026-09-01', reportDate: '2026-09-01',
    title: '붙잡힌 시장 가라앉은 지수',
    description: '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트.'
  };

  const generic = reportDescription(base);
  assert.match(generic, /붙잡힌 시장 가라앉은 지수/);
  assert.match(generic, /당일 시장의 핵심 흐름/, 'with nothing better, the category line still stands in');

  const withLine = reportDescription({ ...base, takeaway: '지수를 올린 쪽은 회사가 산 자기 주식' });
  assert.match(withLine, /지수를 올린 쪽은 회사가 산 자기 주식/);
  assert.doesNotMatch(withLine, /당일 시장의 핵심 흐름/, 'the report own words displace the boilerplate');
  assert.match(withLine, /2026년 9월 1일/, 'the date still leads');
  assert.match(withLine, /붙잡힌 시장 가라앉은 지수/, 'and the title is still named');
});

test('two reports from one day and one category still describe themselves apart', () => {
  const shared = {
    type: 'daily', lang: 'ko', date: '2026-09-01', reportDate: '2026-09-01',
    description: '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트.'
  };
  const first = reportDescription({ ...shared, id: 'a', href: 'reports/a.html', title: '붙잡힌 시장', takeaway: '지수를 올린 쪽은 회사가 산 자기 주식' });
  const second = reportDescription({ ...shared, id: 'b', href: 'reports/b.html', title: '붙잡힌 시장', takeaway: '오른 종목은 열에 넷' });
  assert.notEqual(first, second);
});
