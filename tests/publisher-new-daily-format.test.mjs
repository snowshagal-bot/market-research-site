import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { __test as coverApi } from '../functions/api/generate-cover.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function parseHtmlDoc(html) {
  const metaTitle = html.match(/<meta\b[^>]*name\s*=\s*["']report-title["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1]
    || html.match(/<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']report-title["']/i)?.[1];

  const extractText = (selector) => {
    if (selector.startsWith('.')) {
      const cls = selector.slice(1);
      const match = html.match(new RegExp(`<([a-z0-9]+)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
      if (match) return match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (selector === 'h1') {
      const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      if (match) return match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
      const text = extractText(sel);
      return text !== null ? { textContent: text } : null;
    }
  };
}

async function loadAdminDetectTitle() {
  const adminSource = await read('assets/admin.js');
  const match = adminSource.match(/function detectTitle\(name, doc\) \{([\s\S]*?)\n  \}/);
  const cleanTitleMatch = adminSource.match(/function cleanTitle\(s\) \{([\s\S]*?)\n  \}/);
  const cleanTitleFn = new Function(`return function cleanTitle(s) { ${cleanTitleMatch[1]} }`)();
  const fn = new Function('cleanTitle', `return function detectTitle(name, doc) { ${match[1]} }`);
  return fn(cleanTitleFn);
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
