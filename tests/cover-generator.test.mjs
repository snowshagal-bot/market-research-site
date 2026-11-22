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
            const name = selector.match(/name="([^"]+)"/)?.[1] || 'report-cover-selector';
            const match = html.match(new RegExp(`<meta\\b[^>]*name\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i'));
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
      return selector === 'body section, body div' ? [finalCover] : [];
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

test('a cover section nested in a page shell is captured, with the selector the server would pick', async () => {
  const api = await generatorApi();
  const container = (text, { classes = [], id = '', label = '', visual = false }) => ({
    ...node(text, { visual, children: 4 }),
    classList: classes,
    id,
    getAttribute: name => (name === 'aria-label' ? label : null)
  });
  // Research NO.07: <div class="sheet"> wraps <section class="cv7" id="cover">,
  // so the cover is a grandchild of <body> and its class is not cover-like.
  for (const label of ['리서치 NO.07 표지', 'Research NO.07 cover']) {
    const shell = container('리포트 전체', { classes: ['sheet'] });
    const cover = container('돈은 이미 쌓여 있다', { classes: ['cv7'], id: 'cover', label, visual: true });
    const doc = {
      body: node('본문'),
      querySelector: () => null,
      querySelectorAll: selector => (selector === 'body section, body div' ? [shell, cover] : [])
    };
    const result = api.findCaptureTarget(doc);
    assert.equal(result.target, cover, label);
    assert.equal(result.selector, '#cover', label);
    assert.equal(result.source, 'heuristic', label);
  }

  // /api/generate-cover selects the same element from the same markup, so the
  // suggestion this side sends never competes with the server's own choice.
  const { __test } = await import('../functions/api/generate-cover.js');
  const html = '<!doctype html><html><body><header class="topbar">목차</header><div class="sheet">'
    + '<section class="cv7" id="cover" aria-label="리서치 NO.07 표지"><div class="cv7-bg"><img src="cover.webp"></div>'
    + '<h1>돈은 이미 쌓여 있다</h1></section></div></body></html>';
  assert.equal(__test.selectCaptureSelector(html, ''), '#cover');
  assert.equal(__test.selectCaptureSelector(html, '#cover'), '#cover');
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
  assert.match(source, /body: JSON\.stringify\(\{ html: String\(html \|\| ''\), preferredSelector: selector, preferredMode: mode \}\)/);
  assert.match(source, /method: 'browser-rendering'/);
  assert.match(source, /const fallback = await createTemplateCover\(template\)/);
  assert.match(source, /try \{ return await serverCapture\(html, plan\.selector, token, \{ mode: plan\.mode \}\); \}[\s\S]*createTemplateCover\(template\)/);
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

test('Investment Insights HTML with no formal cover section falls back cleanly to template cover (900x1350)', async () => {
  const api = await generatorApi();
  const noteHtml = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>INVESTMENT INSIGHTS · NO.01 · 미국 자금시장 점검</title>
  </head>
  <body>
    <main class="page">
      <header class="mast">
        <span class="eyebrow">INVESTMENT INSIGHTS · NO.01</span>
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
    category: '투자 인사이트',
    date: '2026-09-15',
    title: '미국 자금시장 점검',
    description: 'SOFR와 역레포 잔액 변화를 통해 보는 단기 유동성 환경'
  };

  const template = api.templateData(templateInput);
  assert.equal(template.category, '투자 인사이트');
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

// ---------------------------------------------------------------------------
// report-cover-mode=first-screen and failures that say why (2026-11-11)
// ---------------------------------------------------------------------------

/** The generator with a fake fetch, image and canvas, recording what is drawn where. */
async function generatorRuntime({ respond, imageSize = { width: 960, height: 1440 } }) {
  const source = await read('assets/cover-generator.js');
  const window = {};
  const requests = [];
  const draws = [];
  const fills = [];
  const context = {
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left',
    fillRect(...args) { fills.push(args); },
    strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
    measureText(text) { return { width: String(text).length * 10 }; },
    drawImage(image, x, y, w, h) { draws.push({ x, y, w, h }); }
  };
  class TestDOMParser { parseFromString(html) { return parserFor(html); } }
  function parserFor(html) {
    const metaContent = name => html.match(new RegExp(`<meta\\b[^>]*name\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    return {
      body: node(html),
      querySelector(selector) {
        if (selector.startsWith('meta[')) {
          const content = metaContent(selector.match(/name="([^"]+)"/)[1]);
          return content ? { content } : null;
        }
        if ((selector === '.cv' || selector === '.cvwrap .cv' || selector === '.cvwrap > .cv') && /class=["'][^"']*\bcv\b/.test(html)) {
          const el = node('cv content', { visual: true, children: 3 });
          el.matches = s => s === '.cv';
          return el;
        }
        return null;
      },
      querySelectorAll() { return []; }
    };
  }
  vm.runInNewContext(source, {
    window,
    Blob,
    DOMParser: TestDOMParser,
    File: class TestFile extends Blob { constructor(parts, name, options) { super(parts, options); this.name = name; } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Image: class TestImage {
      set src(_value) { this.naturalWidth = imageSize.width; this.naturalHeight = imageSize.height; queueMicrotask(() => this.onload()); }
    },
    document: {
      createElement: () => ({ width: 0, height: 0, getContext: () => context, toBlob: (done, type) => done(new Blob(['x'], { type: type || 'image/png' })) })
    },
    fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body), headers: init.headers }); return respond(); }
  });
  return { api: window.MARKET_COVER_GENERATOR, requests, draws, fills };
}

const FIRST_SCREEN_DAILY = '<html><head><meta name="report-cover-mode" content="first-screen"><meta name="report-cover-selector" content=".nc-cover"></head><body><section class="hero nc"><div class="nc-cover"><h1>금리 경고를 넘은 반도체,<br><em>사흘 낙폭의 절반 회복</em></h1></div></section></body></html>';
const TEMPLATE_INPUT = { category: '데일리', date: '2026-11-11', title: '금리 경고를 넘은 반도체, 사흘 낙폭의 절반 회복' };
const pngResponse = (headers = {}) => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png', ...headers } });

test('first-screen mode outranks report-cover-selector, which outranks the heuristics, then the template', async () => {
  const api = await generatorApi();
  assert.deepEqual({ ...api.capturePlan(FIRST_SCREEN_DAILY) }, { mode: 'first-screen', selector: '' });
  assert.deepEqual({ ...api.capturePlan('<head><meta name="report-cover-selector" content=".cv"></head><div class="cv"><img></div>') }, { mode: 'selector', selector: '.cv' });
  assert.deepEqual({ ...api.capturePlan('<div class="cvwrap"><div class="cv"><img></div></div>') }, { mode: 'selector', selector: '.cv' });
  assert.deepEqual({ ...api.capturePlan('<main class="page"><h1>무표지</h1></main>') }, { mode: 'template', selector: '' });
  // Only the exact value turns the mode on.
  assert.deepEqual({ ...api.capturePlan('<head><meta name="report-cover-mode" content="whole-page"></head><main><h1>x</h1></main>') }, { mode: 'template', selector: '' });
});

test('a first-screen capture fills 900×1350 edge to edge, with no padding band', async () => {
  const api = await generatorApi();
  assert.deepEqual({ ...api.fillPlacement(960, 1440) }, { scale: 900 / 960, drawWidth: 900, drawHeight: 1350, x: 0, y: 0 });
  // A capture off by a pixel is cropped centrally, never letterboxed.
  const off = api.fillPlacement(960, 1442);
  assert.ok(off.drawWidth >= 900 && off.drawHeight >= 1350 && off.x <= 0 && off.y <= 0);
  // The padded contain placement stays for other ratios (unchanged behaviour).
  assert.ok(api.containPlacement(1600, 900).x === 32);
});

test('first-screen generation asks the server for the first screen and draws it without margins', async () => {
  const { api, requests, draws } = await generatorRuntime({ respond: () => pngResponse({ 'x-cover-mode': 'first-screen' }) });
  const result = await api.generate({ html: FIRST_SCREEN_DAILY, template: TEMPLATE_INPUT, csrfToken: 'csrf' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/generate-cover');
  assert.equal(requests[0].body.preferredMode, 'first-screen');
  assert.equal(requests[0].body.preferredSelector, '');
  assert.equal(requests[0].headers['x-csrf-token'], 'csrf');
  assert.equal(result.method, 'browser-rendering');
  assert.equal(result.mode, 'first-screen');
  assert.equal(result.selector, '');
  assert.deepEqual(draws, [{ x: 0, y: 0, w: 900, h: 1350 }]);

  // A first screen that comes back taller than 2:3 still covers the whole
  // canvas: no 32px band, no background showing.
  const tall = await generatorRuntime({ respond: () => pngResponse({ 'x-cover-mode': 'first-screen' }), imageSize: { width: 960, height: 1500 } });
  await tall.api.generate({ html: FIRST_SCREEN_DAILY, template: TEMPLATE_INPUT });
  const [draw] = tall.draws;
  assert.ok(draw.x <= 0 && draw.y <= 0 && draw.x + draw.w >= 900 && draw.y + draw.h >= 1350, JSON.stringify(draw));
});

test('a failed capture falls back to the template only with the attempt and the reason spelled out', async () => {
  const { api } = await generatorRuntime({
    respond: () => new Response(JSON.stringify({ error: 'BROWSER_RENDERING_TIMEOUT', message: '커버 렌더링이 40초 안에 끝나지 않았습니다.', timeoutMs: 40000 }), { status: 504, headers: { 'content-type': 'application/json' } })
  });
  const result = await api.generate({ html: FIRST_SCREEN_DAILY, template: TEMPLATE_INPUT, csrfToken: 'csrf' });
  assert.equal(result.method, 'template');
  assert.equal(result.attemptedMode, 'first-screen');
  assert.equal(result.captureErrorCode, 'BROWSER_RENDERING_TIMEOUT');
  assert.equal(result.captureError, '커버 렌더링이 40초 안에 끝나지 않았습니다. (BROWSER_RENDERING_TIMEOUT · HTTP 504 · 제한 40초)');

  const upstream = await generatorRuntime({
    respond: () => new Response(JSON.stringify({ error: 'BROWSER_RENDERING_FAILED', message: '커버 생성 요청이 많습니다. 잠시 후 다시 시도해 주세요.', upstreamStatus: 429 }), { status: 502 })
  });
  const limited = await upstream.api.generate({ html: '<head><meta name="report-cover-selector" content=".cv"></head><div class="cv"><img></div>', template: TEMPLATE_INPUT });
  assert.equal(limited.attemptedSelector, '.cv');
  assert.match(limited.captureError, /BROWSER_RENDERING_FAILED · HTTP 502 · Cloudflare 429/);
});

test('a report with nothing to capture gets the template with the reason, not a silent success', async () => {
  const { api, requests } = await generatorRuntime({ respond: () => pngResponse() });
  const result = await api.generate({ html: '<main class="page"><h1>무표지</h1></main>', template: TEMPLATE_INPUT });
  assert.equal(requests.length, 0);
  assert.equal(result.method, 'template');
  assert.equal(result.captureErrorCode, 'COVER_TARGET_NOT_FOUND');
  assert.match(result.captureError, /report-cover-mode 또는 report-cover-selector/);
});

test('authentication and configuration errors still stop generation instead of becoming a template', async () => {
  const { api } = await generatorRuntime({
    respond: () => new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: '관리자 인증이 필요합니다.' }), { status: 401 })
  });
  await assert.rejects(api.generate({ html: FIRST_SCREEN_DAILY, template: TEMPLATE_INPUT }), error => error.code === 'UNAUTHORIZED' && error.status === 401);
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
