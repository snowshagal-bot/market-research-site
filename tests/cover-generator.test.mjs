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
  vm.runInNewContext(source, { window, document: {}, Blob, File: class TestFile extends Blob {
    constructor(parts, name, options) { super(parts, options); this.name = name; }
  } });
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
  assert.match(source, /'x-admin-key': String\(adminKey \|\| ''\)/);
  assert.match(source, /body: JSON\.stringify\(\{ html: String\(html \|\| ''\), preferredSelector: selector \}\)/);
  assert.match(source, /method: 'browser-rendering'/);
  assert.match(source, /const fallback = await createTemplateCover\(template\)/);
  assert.match(source, /try \{ return await serverCapture\(html, selector, adminKey\); \}[\s\S]*createTemplateCover\(template\)/);
});

test('the broken foreignObject rasterization path is no longer used', async () => {
  const source = await read('assets/cover-generator.js');
  assert.doesNotMatch(source, /foreignObject|XMLSerializer|cloneWithComputedStyles|iframe\.srcdoc/);
});

test('admin connects generated files to the existing cover preview and publish payload', async () => {
  const [html, admin] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /id="generate-cover-btn"[^>]*disabled>HTML에서 커버 자동 생성/);
  assert.match(html, /cover-generator\.js\?v=20260812-6/);
  assert.match(html, /admin\.js\?v=20260812-9/);
  assert.match(admin, /adminKey: adminKey\.value\.trim\(\)/);
  assert.match(admin, /showCoverPreview\(result\.file, generationReportVersion\)/);
  assert.match(admin, /generationReportVersion !== reportSelectionVersion/);
  assert.match(admin, /coverPreviewImage\.onload = \(\) => \{[\s\S]*selectedCover = file/);
  assert.match(admin, /if \(selectedCover\) form\.append\('cover', selectedCover, selectedCover\.name\)/);
  assert.match(admin, /const coverWarning = selectedCover \? ''/);
});

test('manual cover uploads and Preview publish blocking remain in place', async () => {
  const admin = await read('assets/admin.js');
  assert.match(admin, /coverInput\?\.addEventListener\('change'/);
  assert.match(admin, /validateCover\(file\)/);
  assert.match(admin, /isPreviewHost\(location\.hostname\)/);
  assert.match(admin, /Preview와 로컬 환경에서는 실제 게시를 실행할 수 없습니다/);
});
