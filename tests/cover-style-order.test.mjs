import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { COVER_CONTAINERS, findLateCoverStyle, lateCoverStyleMessage } from '../functions/_cover-style.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * The judgement lives in functions/_cover-style.js so that this gate and the
 * publish preflight cannot drift apart: a report CI would reject is refused at
 * upload, before it reaches Production.
 */

test('a report never sizes its cover with a rule that arrives after the cover', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const late = [];

  for (const post of posts) {
    if (!post.href) continue;
    let html;
    try { html = await read(post.href); } catch { continue; }
    const found = findLateCoverStyle(html);
    if (found) {
      late.push(`${post.id}: .${found.container} is at ${found.elementAt} but its sizing rule is at ${found.ruleAt} (${found.percent}% into the file)`);
    }
  }

  assert.deepEqual(late, [], `cover sizing arrives too late to reserve the box:\n  ${late.join('\n  ')}`);
});

test('the repaired reports carry their cover rules in the head', async () => {
  const files = [
    'reports/위클리_2026.08.4주차 위클리.html',
    'reports/en/2026-08-29_Korea_Weekly_Report_EN.html',
    'reports/9월 1일 주식리포트_커버통합.html',
    'reports/9월 2일 주식리포트_커버통합.html',
    'reports/en/9월 2일 주식리포트_커버통합_en.html'
  ];

  for (const file of files) {
    const html = await read(file);
    const headEnd = html.toLowerCase().indexOf('</head>');
    assert.ok(headEnd > 0, `${file}: no </head>`);
    assert.equal(findLateCoverStyle(html), null, `${file}: cover sizing still arrives late`);

    // And the rule is genuinely inside the head, not merely early in the body.
    const container = COVER_CONTAINERS.find(name => new RegExp(`class="[^"]*\\b${name}\\b`, 'i').test(html));
    assert.ok(container, `${file}: no cover container found`);
    const rule = new RegExp(`\\.${container}(?![\\w-])[^{}]{0,200}\\{[^{}]*(?:aspect-ratio|position|height)\\s*:`, 'i').exec(html);
    assert.ok(rule && rule.index < headEnd, `${file}: .${container} is sized at ${rule ? rule.index : 'nowhere'}, after </head> at ${headEnd}`);
  }
});

test('moving the block changed where the rules are, not what they say', async () => {
  const weekly = await read('reports/위클리_2026.08.4주차 위클리.html');
  assert.match(weekly, /\.cv\{position:relative;width:100%;aspect-ratio:2\/3;overflow:hidden;background:#EFEDE4\}/);
  assert.match(weekly, /\.cv img\{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block\}/);

  const daily = await read('reports/9월 1일 주식리포트_커버통합.html');
  assert.match(daily, /body\.cover-edition \.dcv\{[^}]*position:relative[^}]*\}/);
  assert.match(daily, /body\.cover-edition \.dcv-copy\{position:absolute;inset:0\}/);

  // The 9/2 pair carries the same declarations under a renamed block id.
  for (const file of ['reports/9월 2일 주식리포트_커버통합.html', 'reports/en/9월 2일 주식리포트_커버통합_en.html']) {
    const html = await read(file);
    assert.match(html, /<style id="daily-cover">/);
    assert.match(html, /body\.cover-edition \.dcv\{[^}]*position:relative[^}]*\}/, file);
    assert.match(html, /body\.cover-edition \.dcv-copy\{position:absolute;inset:0\}/, file);
    assert.equal(html.split('<style id="daily-cover">').length - 1, 1, `${file}: the block appears more than once`);
  }

  for (const [file, marker] of [
    ['reports/위클리_2026.08.4주차 위클리.html', '.cv{position:relative;width:100%;aspect-ratio:2/3'],
    ['reports/en/2026-08-29_Korea_Weekly_Report_EN.html', '.cv{position:relative;width:100%;aspect-ratio:2/3'],
    ['reports/9월 1일 주식리포트_커버통합.html', 'body.cover-edition .dcv-copy{position:absolute;inset:0}']
  ]) {
    const html = await read(file);
    assert.equal(html.split(marker).length - 1, 1, `${file}: cover rule appears more than once`);
  }
});

/* ------------------------------------------- what the shared judgement says */

const COVER = '<section class="dcv"><img class="dcv-img" src="x.webp"><div class="dcv-copy">t</div></section>';
const SIZING = '<style id="daily-cover">body.cover-edition .dcv{position:relative;width:100%}</style>';
const page = (...parts) => `<!doctype html><html><head><style>.page{color:#000}</style>${parts[0] || ''}</head><body class="cover-edition">${parts.slice(1).join('')}</body></html>`;

test('the judgement names the late rule, and leaves everything else alone', () => {
  // Late: the rule is behind the cover it sizes.
  const late = findLateCoverStyle(page('', COVER, SIZING));
  assert.ok(late, 'a rule after the cover is late');
  assert.equal(late.container, 'dcv');
  assert.ok(late.ruleAt > late.elementAt);
  assert.match(lateCoverStyleMessage(late), /표지 크기를 정하는 CSS\(\.dcv\)/);

  // In the head: fine.
  assert.equal(findLateCoverStyle(page(SIZING, COVER)), null);

  // A body <style> that does not size a cover container is fine, and most of
  // the published set has one.
  assert.equal(findLateCoverStyle(page(SIZING, COVER, '<style id="daily-fix">.page .bul{display:block}</style>')), null);
  assert.equal(findLateCoverStyle(page('', '<div class="page">t</div>', '<style>.page{margin:0}</style>')), null);

  // No cover container, or a container with no sizing rule anywhere: nothing
  // to be late.
  assert.equal(findLateCoverStyle(page('', '<p>plain</p>')), null);
  assert.equal(findLateCoverStyle(page('', COVER)), null);

  // A late rule that only paints is not a sizing rule.
  assert.equal(findLateCoverStyle(page('', COVER, '<style>body.cover-edition .dcv{background:#fff;color:#000}</style>')), null);

  assert.equal(findLateCoverStyle(''), null);
  assert.equal(findLateCoverStyle(null), null);
});

test('an inline image between the cover and its rule does not hide the distance', () => {
  // The payloads are dropped before scanning, which is what makes this quick;
  // the offsets must still come out in the right order.
  const payload = `<img src="data:image/webp;base64,${'A'.repeat(400000)}">`;
  const late = findLateCoverStyle(page('', COVER, payload, SIZING));
  assert.ok(late, 'a rule behind 400KB of image is still behind the cover');
  assert.ok(late.ruleAt > late.elementAt);
});
