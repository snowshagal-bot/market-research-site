import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function node(text = '', { visual = false, children = 1 } = {}) {
  return {
    textContent: text,
    children: Array.from({ length: children }),
    querySelector(selector) {
      return visual && /img|svg|canvas|video/.test(selector) ? {} : null;
    }
  };
}

async function generatorApi() {
  const source = await read('assets/cover-generator.js');
  const window = {};
  class TestDOMParser {
    parseFromString(html) {
      return {
        body: node(html),
        querySelector(selector) {
          if (selector.startsWith('meta[')) {
            const match = html.match(/<meta\b[^>]*name\s*=\s*["']report-cover-selector["'][^>]*content\s*=\s*["']([^"']+)["']/i);
            return match ? { content: match[1] } : null;
          }
          if (selector === '.cvwrap > .cv' || selector === '.cvwrap .cv' || selector === '.cv') {
            if (/class=["'][^"']*\bcv\b[^"']*["']/.test(html)) {
              const el = node('cv content', { visual: true, children: 3 });
              el.matches = s => s === '.cv';
              return el;
            }
          }
          if (selector === '.cover-frame' && /class=["'][^"']*\bcover-frame\b[^"']*["']/.test(html)) {
            return node('frame', { visual: true });
          }
          if (selector === '.cover-screen' && /class=["'][^"']*\bcover-screen\b[^"']*["']/.test(html)) {
            const frame = /class=["'][^"']*\bcover-frame\b[^"']*["']/.test(html) ? node('frame', { visual: true }) : null;
            const screen = node('screen', { visual: true });
            screen.matches = s => s === '.cover-screen';
            screen.querySelector = s => s === '.cover-frame' ? frame : null;
            return screen;
          }
          if (selector === '.report-cover' && /class=["'][^"']*\breport-cover\b[^"']*["']/.test(html)) {
            return node('report cover', { visual: true });
          }
          if (selector === '.opener' && /class=["'][^"']*\bopener\b[^"']*["']/.test(html)) {
            return node('opener', { visual: true });
          }
          if (selector === '.mag-cover' && /class=["'][^"']*\bmag-cover\b[^"']*["']/.test(html)) {
            return node('mag cover', { visual: true });
          }
          if (selector === '.cover' && /class=["'][^"']*\bcover\b[^"']*["']/.test(html)) {
            return node('cover', { visual: true });
          }
          return null;
        },
        querySelectorAll() {
          return [];
        }
      };
    }
  }
  vm.runInNewContext(source, {
    window,
    document: {},
    Blob,
    DOMParser: TestDOMParser,
    File: class TestFile extends Blob {
      constructor(parts, name, options) { super(parts, options); this.name = name; }
    }
  });
  return window.MARKET_COVER_GENERATOR;
}

test('report-cover-selector metadata wins over heuristic candidates', async () => {
  const api = await generatorApi();
  const declared = node('명시적으로 지정한 커버');
  const heuristic = node('휴리스틱 커버');
  const doc = {
    body: node('본문'),
    querySelector(selector) {
      if (selector === 'meta[name="report-cover-selector"]') return { content: '.special-cover' };
      if (selector === '.special-cover') return declared;
      if (selector === '.cover') return heuristic;
      return null;
    }
  };
  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, declared);
  assert.equal(result.selector, '.special-cover');
  assert.equal(result.source, 'meta');
});

test('new Daily .cvwrap and .cv elements are selected and normalized to .cv', async () => {
  const api = await generatorApi();
  const cvElement = node('외국인 순매도 전환', { visual: true, children: 3 });
  cvElement.matches = sel => sel === '.cv';
  const doc = {
    body: node('리포트 본문', { children: 8 }),
    querySelector(selector) {
      if (selector === '.cvwrap > .cv' || selector === '.cvwrap .cv' || selector === '.cv') return cvElement;
      return null;
    }
  };
  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, cvElement);
  assert.equal(result.selector, '.cv');
  assert.equal(result.source, 'heuristic');
});

test('heuristic cover candidates are used when selector metadata is absent', async () => {
  const api = await generatorApi();
  const coverPage = node('첫 페이지 커버');
  const doc = {
    body: node('짧은 본문'),
    querySelector(selector) {
      if (selector === '.cover-page') return coverPage;
      return null;
    }
  };
  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, coverPage);
  assert.equal(result.selector, '.cover-page');
  assert.equal(result.source, 'heuristic');
});

test('Korean and English opener covers are selected instead of the template fallback', async () => {
  const api = await generatorApi();
  for (const text of ['두 개의 착시', 'Two Illusions']) {
    const opener = node(text, { visual: true, children: 3 });
    const doc = {
      body: node(`${text} report body`, { children: 4 }),
      querySelector(selector) {
        if (selector === '.opener') return opener;
        return null;
      }
    };
    const result = api.findCaptureTarget(doc);
    assert.equal(result.target, opener);
    assert.equal(result.selector, '.opener');
    assert.equal(result.source, 'heuristic');
  }
});

test('completed magazine covers are selected as one overlaid cover instead of the template fallback', async () => {
  const api = await generatorApi();
  const magazineCover = node('반도체 다음의 자리', { visual: true, children: 6 });
  const genericCover = node('unrelated cover');
  const doc = {
    body: node('위클리 리포트 본문', { children: 8 }),
    querySelector(selector) {
      if (selector === '.mag-cover') return magazineCover;
      if (selector === '.cover') return genericCover;
      return null;
    }
  };
  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, magazineCover);
  assert.equal(result.selector, '.mag-cover');
  assert.equal(result.source, 'heuristic');
});

test('date-suffixed standalone image covers are detected regardless of rendered size', async () => {
  const api = await generatorApi();
  const finalCover = node('', { visual: true, children: 2 });
  finalCover.classList = ['final-cover-0824'];
  finalCover.id = '';
  finalCover.getAttribute = name => name === 'aria-label'
    ? '2026년 8월 24일 SnowShagal DAILY 커버 · 선물의 무게'
    : '';
  const doc = {
    body: node('리포트 본문', { children: 8 }),
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === 'body > section, body > div' ? [finalCover] : [];
    }
  };

  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, finalCover);
  assert.equal(result.selector, '.final-cover-0824');
  assert.equal(result.source, 'heuristic');
});

test('a usable cover frame is captured instead of its cover-screen wrapper and hint', async () => {
  const api = await generatorApi();
  const frame = node('', { visual: true });
  const hint = node('아래로 넘겨 리포트 보기');
  const screen = node('완성된 커버 아래로 넘겨 리포트 보기');
  screen.matches = selector => selector === '.cover-screen';
  screen.querySelector = selector => selector === '.cover-frame' ? frame : null;
  screen.children = [frame, hint];
  const doc = {
    body: node('본문'),
    querySelector(selector) {
      if (selector === '.cover-screen') return screen;
      return null;
    }
  };

  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, frame);
  assert.notEqual(result.target, screen);
  assert.equal(result.selector, '.cover-frame');
  assert.equal(result.source, 'heuristic');
});

test('a cover-screen without a usable cover frame remains the capture target', async () => {
  const api = await generatorApi();
  const screen = node('완성된 커버 wrapper', { visual: true });
  screen.matches = selector => selector === '.cover-screen';
  const originalQuerySelector = screen.querySelector;
  screen.querySelector = selector => selector === '.cover-frame' ? null : originalQuerySelector.call(screen, selector);
  const doc = {
    body: node('본문'),
    querySelector(selector) {
      if (selector === '.cover-screen') return screen;
      return null;
    }
  };

  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, screen);
  assert.equal(result.selector, '.cover-screen');
});

test('ambiguous minimal HTML falls through to the standard template path', async () => {
  const api = await generatorApi();
  const doc = { body: node('구조가 애매한 짧은 글'), querySelector: () => null };
  const result = api.findCaptureTarget(doc);
  assert.equal(result.target, null);
  assert.equal(result.source, 'template');
});

test('template data uses report summary, then edited summary, then description and works without any summary', async () => {
  const api = await generatorApi();
  assert.equal(api.templateData({ metaSummary: '메타 요약', summary: '수정 요약', description: '설명' }).summary, '메타 요약');
  assert.equal(api.templateData({ summary: '수정 요약', description: '설명' }).summary, '수정 요약');
  assert.equal(api.templateData({ description: '설명' }).summary, '설명');
  assert.equal(api.templateData({ title: '요약 없는 리포트' }).summary, '');
  assert.equal(api.OUTPUT_WIDTH, 900);
  assert.equal(api.OUTPUT_HEIGHT, 1350);
});

test('cover export prefers a real WebP blob and otherwise retries as PNG', async () => {
  const source = await read('assets/cover-generator.js');
  assert.match(source, /blob\?\.type === 'image\/webp'/);
  assert.match(source, /canvas\.toBlob\(png => finish\(png, 'png'\), 'image\/png'\)/);
});

test('captured HTML covers use centered contain placement without forced cropping', async () => {
  const api = await generatorApi();
  const placement = api.containPlacement(1600, 900);
  assert.equal(api.OUTPUT_WIDTH, 900);
  assert.equal(api.OUTPUT_HEIGHT, 1350);
  assert.equal(placement.drawWidth <= api.OUTPUT_WIDTH, true);
  assert.equal(placement.drawHeight <= api.OUTPUT_HEIGHT, true);
  assert.equal(placement.x >= 0, true);
  assert.equal(placement.y >= 0, true);
  assert.ok(Math.abs(placement.drawWidth / placement.drawHeight - 1600 / 900) < 1e-10);

  const source = await read('assets/cover-generator.js');
  assert.match(source, /Math\.min\(availableWidth \/ sourceWidth, availableHeight \/ sourceHeight\)/);
  assert.doesNotMatch(source, /Math\.max\(OUTPUT_WIDTH \/ width, OUTPUT_HEIGHT \/ height\)/);
  assert.match(source, /context\.drawImage\(image, placement\.x, placement\.y, placement\.drawWidth, placement\.drawHeight\)/);
});

test('two-by-three completed covers render full bleed while other ratios retain contain padding', async () => {
  const api = await generatorApi();
  const fullBleed = api.containPlacement(480, 720);
  assert.ok(Math.abs(fullBleed.x) < 1e-10);
  assert.ok(Math.abs(fullBleed.y) < 1e-10);
  assert.ok(Math.abs(fullBleed.drawWidth - 900) < 1e-10);
  assert.ok(Math.abs(fullBleed.drawHeight - 1350) < 1e-10);

  const contained = api.containPlacement(1600, 900);
  assert.ok(contained.x >= 32 - 1e-10);
  assert.ok(contained.y >= 32 - 1e-10);
  assert.ok(contained.drawWidth <= 900 - 64 + 1e-10);
  assert.ok(contained.drawHeight <= 1350 - 64 + 1e-10);
});

test('HTML targets use the same-origin server capture endpoint and preserve the template fallback', async () => {
  const source = await read('assets/cover-generator.js');
  assert.match(source, /fetch\('\/api\/generate-cover'/);
  assert.match(source, /headers\['x-csrf-token'\] = String\(csrfToken \|\| ''\)/);
  assert.match(source, /body: JSON\.stringify\(\{ html: String\(html \|\| ''\), preferredSelector: selector \}\)/);
  assert.match(source, /method: 'browser-rendering'/);
  assert.match(source, /const fallback = await createTemplateCover\(template\)/);
  assert.match(source, /try \{ return await serverCapture\(html, selector, token\); \}[\s\S]*createTemplateCover\(template\)/);
});

test('configuration and authentication errors are never hidden while missing target uses template fallback', async () => {
  const api = await generatorApi();
  for (const code of ['UNAUTHORIZED', 'BROWSER_RENDERING_NOT_CONFIGURED', 'HTML_TOO_LARGE']) {
    assert.equal(api.canUseTemplateFallback({ code }), false, code);
  }
  for (const code of ['COVER_TARGET_NOT_FOUND', 'COVER_SELECTOR_INVALID', 'BROWSER_RENDERING_FAILED', 'BROWSER_RENDERING_TIMEOUT', 'INVALID_RENDER_RESPONSE', 'INVALID_RENDER_SIZE']) {
    assert.equal(api.canUseTemplateFallback({ code }), true, code);
  }
  assert.equal(api.canUseTemplateFallback(new TypeError('network failure')), true);
});

test('Investment Note HTML with no formal cover section falls back cleanly to template cover (900x1350)', async () => {
  const api = await generatorApi();
  const noteHtml = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>INVESTMENT NOTE · NO.01 · 미국 자금시장 점검</title>
  </head>
  <body>
    <main class="page">
      <header class="mast">
        <span class="eyebrow">INVESTMENT NOTE · NO.01</span>
        <h1>미국 자금시장 점검</h1>
        <p class="lead">SOFR와 역레포 잔액 변화를 통해 보는 단기 유동성 환경</p>
      </header>
      <section class="hero">
        <p>단기 자금 시장의 주요 지표를 점검합니다.</p>
      </section>
    </main>
  </body>
  </html>`;

  const selector = api.preferredSelector(noteHtml);
  assert.equal(selector, '', 'Generic main/page elements must not be treated as server capture selectors');

  const templateInput = {
    category: '투자 노트',
    date: '2026-09-15',
    title: '미국 자금시장 점검',
    description: 'SOFR와 역레포 잔액 변화를 통해 보는 단기 유동성 환경'
  };

  const template = api.templateData(templateInput);
  assert.equal(template.category, '투자 노트');
  assert.equal(template.title, '미국 자금시장 점검');
  assert.equal(template.summary, 'SOFR와 역레포 잔액 변화를 통해 보는 단기 유동성 환경');
  assert.equal(api.OUTPUT_WIDTH, 900);
  assert.equal(api.OUTPUT_HEIGHT, 1350);
});

test('Daily, Weekly, and Research formal covers retain browser capture selectors', async () => {
  const api = await generatorApi();

  // Daily report with .cv
  const dailyHtml = `<html><body><div class="cvwrap"><div class="cv"><img src="chart.png"><h1>Daily Cover</h1></div></div></body></html>`;
  assert.equal(api.preferredSelector(dailyHtml), '.cv');

  // Weekly report with .cover-frame / .mag-cover
  const weeklyHtml = `<html><body><div class="cover-screen"><div class="cover-frame"><img src="cover.png"></div></div></body></html>`;
  assert.equal(api.preferredSelector(weeklyHtml), '.cover-frame');

  // Research report with .report-cover
  const researchHtml = `<html><body><div class="report-cover"><img src="research.png"><h1>Deep Research</h1></div></body></html>`;
  assert.equal(api.preferredSelector(researchHtml), '.report-cover');
});

test('the broken foreignObject rasterization path is no longer used', async () => {
  const source = await read('assets/cover-generator.js');
  assert.doesNotMatch(source, /foreignObject|XMLSerializer|cloneWithComputedStyles|iframe\.srcdoc/);
});

test('admin connects generated files to the existing cover preview and publish payload', async () => {
  const [html, admin] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /id="generate-cover-btn"[^>]*disabled>HTML에서 커버 자동 생성/);
  assert.match(html, /cover-generator\.js\?v=[a-f0-9]{10}/);
  assert.match(html, /admin\.js\?v=[a-f0-9]{10}/);
  assert.match(admin, /window\.MARKET_COVER_GENERATOR\.generate/);
  assert.match(admin, /showCoverPreview\(result\.file, generationReportVersion\)/);
  assert.match(admin, /generationReportVersion !== reportSelectionVersion/);
  assert.match(admin, /coverPreviewImage\.onload = \(\) => \{[\s\S]*selectedCover = file/);
  assert.match(admin, /form\.append\('cover', selectedCover, selectedCover\.name\)/);
  assert.match(admin, /const coverWarning = selectedCover \? ''/);
});

test('manual cover uploads and Preview publish blocking remain in place', async () => {
  const admin = await read('assets/admin.js');
  assert.match(admin, /coverInput\?\.addEventListener\('change'/);
  assert.match(admin, /validateCover\(file\)/);
  assert.match(admin, /isPreviewHost\(location\.hostname\)/);
  assert.match(admin, /Preview와 로컬 환경에서는 실제 게시를 실행할 수 없습니다/);
});
