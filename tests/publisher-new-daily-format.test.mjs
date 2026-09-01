import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { __test as coverApi } from '../functions/api/generate-cover.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// A stand-in element that keeps the browser's own rules about whitespace: a
// tag contributes none of its own to textContent, so nothing but a <br> or a
// child the detector is told is a row can hold two lines apart, and only on a
// copy. A looser stub that turned every tag into a space would pass code that
// runs a cover's two title rows together.
function stubElement(innerHtml, className = '') {
  const text = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return {
    innerHtml,
    className,
    get textContent() { return text(this.innerHtml); },
    matches(selector) {
      return selector.startsWith('.') && className.split(/\s+/).includes(selector.slice(1));
    },
    get children() {
      const owner = this;
      const found = [];
      const child = /<([a-z0-9]+)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let match;
      while ((match = child.exec(this.innerHtml))) {
        const [raw, tag, inner] = match;
        found.push({
          tagName: tag.toUpperCase(),
          get textContent() { return text(inner); },
          replaceWith(replacement) { owner.innerHtml = owner.innerHtml.replace(raw, replacement); }
        });
      }
      return found;
    },
    cloneNode() { return stubElement(this.innerHtml, className); },
    querySelectorAll(selector) {
      if (selector !== 'br') return [];
      const found = this.innerHtml.match(/<br\b[^>]*>/gi) || [];
      return found.map(() => ({
        replaceWith: (replacement) => { this.innerHtml = this.innerHtml.replace(/<br\b[^>]*>/i, replacement); }
      }));
    }
  };
}

function parseHtmlDoc(html) {
  const metaTitle = html.match(/<meta\b[^>]*name\s*=\s*["']report-title["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1]
    || html.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']report-title["']/i)?.[1];

  const extractInner = (selector) => {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const match = html.match(new RegExp(`<([a-z0-9]+)\\b[^>]*class\\s*=\\s*["']([^"']*\\b${cls}\\b[^"']*)["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
      if (match) return { inner: match[3], className: match[2] };
    }
    if (selector === 'h1') {
      const match = html.match(/<h1\b[^>]*class\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/h1>/i);
      if (match) return { inner: match[2], className: match[1] };
      const plain = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      if (plain) return { inner: plain[1], className: '' };
    }
    return null;
  };

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const docTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  return {
    title: docTitle,
    querySelector(sel) {
      if (sel === 'meta[name="report-title"]') {
        return metaTitle ? { content: metaTitle } : null;
      }
      const found = extractInner(sel);
      return found !== null ? stubElement(found.inner, found.className) : null;
    }
  };
}

// The real functions out of assets/admin.js, including the list of cover
// families whose children stand for a row, so a change to that list is a
// change to what these tests exercise.
async function loadAdminTitleReader() {
  const adminSource = await read('assets/admin.js');
  const body = (name, signature) => {
    const found = adminSource.match(new RegExp(`function ${name}\\(${signature}\\) \\{([\\s\\S]*?)\\n  \\}`));
    assert.ok(found, `admin.js no longer defines ${name}`);
    return found[1];
  };
  const rows = adminSource.match(/const COVER_ROWS = (\[[\s\S]*?\]);/);
  assert.ok(rows, 'admin.js no longer declares COVER_ROWS');

  const built = new Function(`
    const COVER_ROWS = ${rows[1]};
    function cleanTitle(s) { ${body('cleanTitle', 's')} }
    function brokenLineText(element) { ${body('brokenLineText', 'element')} }
    function detectTitle(name, doc) { ${body('detectTitle', 'name, doc')} }
    return { detectTitle, brokenLineText, COVER_ROWS };
  `)();
  return built;
}

async function loadAdminDetectTitle() {
  return (await loadAdminTitleReader()).detectTitle;
}

test('Title Detection - Case A: .cv-h1 is chosen over generic body h1', async () => {
  const detectTitle = await loadAdminDetectTitle();
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Snowshagal Daily</title></head>
      <body>
        <div class="cvwrap">
          <div class="cv">
            <div class="cv-h1"><em>외국인 순매도 전환,</em><br>코스피 숨고르기 장세</div>
          </div>
        </div>
        <div class="page">
          <h1>4% 되돌린 지수,<br/><em>오른 종목은 열에 넷</em></h1>
        </div>
      </body>
    </html>
  `;
  const doc = parseHtmlDoc(html);
  const title = detectTitle('8월 31일 주식리포트.html', doc);
  assert.equal(title, '외국인 순매도 전환, 코스피 숨고르기 장세');
});

test('Title Detection - Case B: meta[name="report-title"] takes highest priority', async () => {
  const detectTitle = await loadAdminDetectTitle();
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="report-title" content="메타 지정 우선 제목">
        <title>Document Title</title>
      </head>
      <body>
        <div class="cv-h1">커버 제목</div>
        <h1>본문 제목</h1>
      </body>
    </html>
  `;
  const doc = parseHtmlDoc(html);
  const title = detectTitle('report.html', doc);
  assert.equal(title, '메타 지정 우선 제목');
});

test('Title Detection - Case C: document without cover selector falls back to generic h1', async () => {
  const detectTitle = await loadAdminDetectTitle();
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Document Title</title></head>
      <body>
        <h1>일반 리포트 본문 제목</h1>
        <p>내용</p>
      </body>
    </html>
  `;
  const doc = parseHtmlDoc(html);
  const title = detectTitle('report.html', doc);
  assert.equal(title, '일반 리포트 본문 제목');
});

test('Title Detection - Case D: English .cv-h1 is extracted accurately', async () => {
  const detectTitle = await loadAdminDetectTitle();
  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Snowshagal Daily</title></head>
      <body>
        <div class="cvwrap">
          <div class="cv">
            <div class="cv-h1"><em>Foreign Investors Turn Net Sellers,</em><br>KOSPI Enters Consolidation</div>
          </div>
        </div>
        <div class="page">
          <h1>Index Rebounds 4%,<br/><em>Only 4 in 10 Stocks Rise</em></h1>
        </div>
      </body>
    </html>
  `;
  const doc = parseHtmlDoc(html);
  const title = detectTitle('2026-08-31_Daily_EN.html', doc);
  assert.equal(title, 'Foreign Investors Turn Net Sellers, KOSPI Enters Consolidation');
});

test('Real 2026-08-31 KO Daily report title and cover detection', async () => {
  const detectTitle = await loadAdminDetectTitle();
  const koHtml = await read('reports/8월 31일 주식리포트.html');
  const doc = parseHtmlDoc(koHtml);
  const title = detectTitle('8월 31일 주식리포트.html', doc);
  assert.equal(title, '하나가 끌어올린 자리');

  const selector = coverApi.selectCaptureSelector(koHtml);
  assert.equal(selector, '.cv');

  const plan = coverApi.newDailyCoverCapturePlan(koHtml, selector);
  assert.ok(plan);
  assert.deepEqual(plan.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
  assert.match(plan.addStyleTag[0].content, /\.cv\{position:fixed!important/);
});

test('2026-08-31 EN Daily acceptance fixture title and cover detection', async () => {
  const detectTitle = await loadAdminDetectTitle();
  const enHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="report-type" content="daily" />
  <meta name="report-date" content="2026-08-31" />
  <title>2026.08.31 Snowshagal Daily Market Report</title>
  <style>
    .cvwrap{background:#F7F4EE}
    .cv{position:relative;width:min(100%,620px);margin:0 auto;aspect-ratio:2/3;container-type:inline-size;overflow:hidden}
    .cv>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
    .cv-copy{position:absolute;inset:0}
    .cv-h1{position:absolute;left:6.4%;top:15.8%;font-size:22px;font-weight:700}
  </style>
</head>
<body>
  <div class="cvwrap">
    <div class="cv">
      <img src="data:image/webp;base64,AA==" />
      <div class="cv-copy">
        <div class="cv-date">2026.08.31</div>
        <div class="cv-brand">SNOWSHAGAL <b>DAILY</b></div>
        <div class="cv-h1"><em>Foreign Investors Turn Net Sellers,</em><br>KOSPI Enters Consolidation</div>
      </div>
    </div>
  </div>
  <div class="page">
    <h1>Index Rebounds 4%,<br/><em>Only 4 in 10 Stocks Rise</em></h1>
  </div>
</body>
</html>`;

  const doc = parseHtmlDoc(enHtml);
  const title = detectTitle('2026-08-31_Daily_EN.html', doc);
  assert.equal(title, 'Foreign Investors Turn Net Sellers, KOSPI Enters Consolidation');

  const selector = coverApi.selectCaptureSelector(enHtml);
  assert.equal(selector, '.cv');

  const plan = coverApi.newDailyCoverCapturePlan(enHtml, selector);
  assert.ok(plan);
  assert.deepEqual(plan.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
});

test('Cover Detection Regression - prior formats and no-cover document', () => {
  // Weekly
  const weeklyHtml = '<section class="cover cv" id="s0"><div class="cvwrap"></div></section>';
  assert.equal(coverApi.selectCaptureSelector(weeklyHtml), '.cover');

  // Magazine
  const magHtml = '<section class="mag-cover plate"><img class="cv-img" width="900" height="1350"><h1 class="cv-h1">Title</h1></section>';
  assert.equal(coverApi.selectCaptureSelector(magHtml), '.mag-cover');

  // Opener
  const openerHtml = '<section class="opener"><h1>Opener</h1></section>';
  assert.equal(coverApi.selectCaptureSelector(openerHtml), '.opener');

  // Cover Frame
  const frameHtml = '<section class="cover-screen"><div class="cover-frame"></div></section>';
  assert.equal(coverApi.selectCaptureSelector(frameHtml), '.cover-frame');

  // No-cover document
  const noCoverHtml = '<div class="article"><h1>No Cover</h1><p>Body</p></div>';
  assert.equal(coverApi.selectCaptureSelector(noCoverHtml), '');
});

/* ----------------------------------- rows a stylesheet makes, not a <br> --- */

test('a cover that stacks its title with block children reads as two rows', async () => {
  const { detectTitle } = await loadAdminTitleReader();

  // .cvtitle span is display:block in every Market Basics report.
  const basics = detectTitle('x.html', parseHtmlDoc(
    `<html><body><h1 class="cvtitle">How a Selloff<span>Feeds on Itself</span></h1></body></html>`
  ));
  assert.equal(basics, 'How a Selloff Feeds on Itself');

  // .cover-title i is display:block with font-style:normal, so the italic is
  // a row rather than emphasis.
  const daily = detectTitle('x.html', parseHtmlDoc(
    `<html><body><h1 class="cover-title"><i>The Night</i><i>Opens First</i></h1></body></html>`
  ));
  assert.equal(daily, 'The Night Opens First');

  const korean = detectTitle('x.html', parseHtmlDoc(
    `<html><body><h1 class="cover-title"><i>먼저</i><i>열리는 밤</i></h1></body></html>`
  ));
  assert.equal(korean, '먼저 열리는 밤');
});

test('an inline span inside a cover title is left where it reads', async () => {
  const { detectTitle } = await loadAdminTitleReader();

  // .han is a gloss, not a row: no display rule turns it into one. Treating
  // every span as a row would put a space in front of it and change the title.
  const glossed = detectTitle('x.html', parseHtmlDoc(
    `<html><body><h1 class="cover-title">고도<span class="han">(高度)</span>를<br/>기다리며</h1></body></html>`
  ));
  assert.equal(glossed, '고도(高度)를 기다리며');
  assert.doesNotMatch(glossed, /고도 \(/, 'the gloss stays attached to the word it glosses');

  // A span in a family that is not on the list is inline too.
  const other = detectTitle('x.html', parseHtmlDoc(
    `<html><body><h1 class="cv-h1">Same inputs,<em>different answers</em></h1></body></html>`
  ));
  assert.equal(other, 'Same inputs,different answers');
});

test('only the tag its own family uses is read as a row', async () => {
  const { brokenLineText, COVER_ROWS } = await loadAdminTitleReader();
  assert.deepEqual(COVER_ROWS.find(([parent]) => parent === '.cvtitle'), ['.cvtitle', 'span']);

  const readOf = html => brokenLineText(parseHtmlDoc(html).querySelector('.cvtitle'))
    .replace(/\s+/g, ' ').trim();

  // An <i> inside .cvtitle is not that family's row element, so it stays inline.
  assert.equal(readOf('<h1 class="cvtitle">one<i>two</i></h1>'), 'onetwo');
  assert.equal(readOf('<h1 class="cvtitle">one<span>two</span></h1>'), 'one two');
});
