import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { reportDescription } from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * The two readings of a cover's title.
 *
 * `glued` is what a browser's textContent gives back: tags contribute nothing,
 * so a title set across two rows arrives with its rows run together. `spaced`
 * is the same reading with each <br> restored to the space it stood for.
 *
 * Where a cover breaks its rows some other way — an inline element the
 * stylesheet turns into a block — the two readings agree here, and the editor's
 * own wording in the form is what settles it. Those titles are left alone.
 */
function readTitle(html) {
  const opened = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!opened) return null;
  const inner = opened[1];
  const strip = text => text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[​-‍﻿⁠]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    glued: strip(inner),
    spaced: strip(inner.replace(/<br\b[^>]*>/gi, ' ')),
    hasBreak: /<br\b[^>]*>/i.test(inner)
  };
}

test('no published title is its own cover read with the line breaks swallowed', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const glued = [];

  for (const post of posts) {
    if (!post.href) continue;
    let html;
    try { html = await read(post.href); } catch { continue; }
    const reading = readTitle(html);
    // A report whose title the editor set explicitly answers to that, not to
    // its cover markup.
    if (!reading || !reading.hasBreak) continue;
    if (/<meta\s+name=["']report-title["']/i.test(html)) continue;
    if (reading.glued === reading.spaced) continue;

    if (post.title === reading.glued) {
      glued.push(`${post.id}: ${JSON.stringify(post.title)} should read ${JSON.stringify(reading.spaced)}`);
    }
  }

  assert.deepEqual(glued, [], `titles missing the space a <br> stood for:\n  ${glued.join('\n  ')}`);
});

test('the repaired titles are the ones the covers actually set', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const byId = new Map(posts.map(post => [post.id, post.title]));

  // Each of these ran two cover rows together until the reading was fixed.
  // They are named outright so a regeneration that reintroduces the glue is
  // caught here rather than noticed months later in a search result.
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
    '2026-08-29-research-178u9g5': '코인의 뒷면에는 국채가 있다'
  };

  for (const [id, title] of Object.entries(repaired)) {
    assert.equal(byId.get(id), title, id);
  }
});

test('a title the editor spaced by hand is never rewritten from the markup', async () => {
  // 고도<span class="han">(高度)</span>를<br/>기다리며 — the parenthetical is a
  // block in the stylesheet, so the browser reads no space before it and the
  // editor supplied one. Restoring only <br> would take that space away again.
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
