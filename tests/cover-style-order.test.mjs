import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * The containers a report uses to hold its cover, and the properties that give
 * one its height before the artwork arrives.
 *
 * A rule that sizes one of these has to reach the browser before the element
 * it sizes. When it arrives afterwards — and in these reports "afterwards"
 * means behind several hundred kilobytes of inline image — the cover is laid
 * out once without it and again with it, and everything below the cover moves.
 *
 * The list is deliberately closed. A `<style>` in the body is not itself a
 * problem, and most of the published set has one; only a late rule for one of
 * these containers is. A new cover family has to be added here on purpose,
 * with its own measurement, rather than guessed at.
 */
const COVER_CONTAINERS = ['dcv', 'cv', 'cover', 'cover-screen', 'cover-image-wrap', 'cvwrap', 'cover-frame', 'cvtitle'];
const SIZING = /(?:^|[;{\s])(?:aspect-ratio|height|min-height|position)\s*:/;

const RULE = /([^{}]{1,300}?)\{([^{}]{0,600})\}/g;

/** Where the first element carrying this class appears in the document. */
function elementAt(html, className) {
  const found = new RegExp(`<[a-z0-9]+[^>]*class="[^"]*\\b${className}\\b[^"]*"`, 'i').exec(html);
  return found ? found.index : -1;
}

/** Where the first rule that would size that container appears. */
function sizingRuleAt(html, className) {
  const token = new RegExp(`\\.${className.replace(/[-]/g, '\\-')}(?![\\w-])`);
  RULE.lastIndex = 0;
  let match;
  while ((match = RULE.exec(html))) {
    const selector = match[1].replace(/\s+/g, ' ');
    if (token.test(selector) && SIZING.test(match[2])) return match.index;
  }
  return -1;
}

test('a report never sizes its cover with a rule that arrives after the cover', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const late = [];

  for (const post of posts) {
    if (!post.href) continue;
    let html;
    try { html = await read(post.href); } catch { continue; }
    // The inline images are most of these files and hold no CSS. Dropping the
    // payloads keeps the offsets in order while making the scan quick.
    html = html.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, 'data:,');

    for (const container of COVER_CONTAINERS) {
      const element = elementAt(html, container);
      if (element < 0) continue;
      const rule = sizingRuleAt(html, container);
      if (rule < 0) continue;
      if (rule > element) {
        const percent = Math.round((rule / html.length) * 100);
        late.push(`${post.id}: .${container} is at ${element} but its sizing rule is at ${rule} (${percent}% into the file)`);
      }
      break; // the outermost container this report uses is the one that matters
    }
  }

  assert.deepEqual(late, [], `cover sizing arrives too late to reserve the box:\n  ${late.join('\n  ')}`);
});

test('the three repaired reports carry their cover rules in the head', async () => {
  const files = [
    'reports/위클리_2026.08.4주차 위클리.html',
    'reports/en/2026-08-29_Korea_Weekly_Report_EN.html',
    'reports/9월 1일 주식리포트_커버통합.html'
  ];

  for (const file of files) {
    const html = await read(file);
    const headEnd = html.toLowerCase().indexOf('</head>');
    assert.ok(headEnd > 0, `${file}: no </head>`);

    const container = COVER_CONTAINERS.find(name => elementAt(html, name) >= 0);
    assert.ok(container, `${file}: no cover container found`);
    const rule = sizingRuleAt(html, container);
    assert.ok(rule >= 0, `${file}: no sizing rule for .${container}`);
    assert.ok(rule < headEnd, `${file}: .${container} is sized at ${rule}, after </head> at ${headEnd}`);
  }
});

test('moving the block changed where the rules are, not what they say', async () => {
  // Each cover block still declares exactly what it declared before, so the
  // finished page is the page it always was.
  const weekly = await read('reports/위클리_2026.08.4주차 위클리.html');
  assert.match(weekly, /\.cv\{position:relative;width:100%;aspect-ratio:2\/3;overflow:hidden;background:#EFEDE4\}/);
  assert.match(weekly, /\.cv img\{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block\}/);

  const daily = await read('reports/9월 1일 주식리포트_커버통합.html');
  assert.match(daily, /body\.cover-edition \.dcv\{[^}]*position:relative[^}]*\}/);
  assert.match(daily, /body\.cover-edition \.dcv-copy\{position:absolute;inset:0\}/);

  // And each block sits in one piece, not copied into two places.
  for (const [file, marker] of [
    ['reports/위클리_2026.08.4주차 위클리.html', '.cv{position:relative;width:100%;aspect-ratio:2/3'],
    ['reports/en/2026-08-29_Korea_Weekly_Report_EN.html', '.cv{position:relative;width:100%;aspect-ratio:2/3'],
    ['reports/9월 1일 주식리포트_커버통합.html', 'body.cover-edition .dcv-copy{position:absolute;inset:0}']
  ]) {
    const html = await read(file);
    assert.equal(html.split(marker).length - 1, 1, `${file}: cover rule appears more than once`);
  }
});
