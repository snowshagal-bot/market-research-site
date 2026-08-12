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

test('captured covers prefer target or body background and retain the template fallback path', async () => {
  const api = await generatorApi();
  const styles = new Map([
    ['target', 'rgba(0, 0, 0, 0)'],
    ['body', 'rgb(236, 231, 220)'],
    ['html', 'transparent']
  ]);
  const target = { key: 'target' };
  const body = { key: 'body' };
  const documentElement = { key: 'html' };
  const doc = {
    body,
    documentElement,
    defaultView: { getComputedStyle: node => ({ backgroundColor: styles.get(node.key) }) }
  };
  assert.equal(api.captureBackgroundColor(doc, target), 'rgb(236, 231, 220)');

  const source = await read('assets/cover-generator.js');
  assert.match(source, /const fallback = await createTemplateCover\(template\)/);
  assert.match(source, /if \(candidate\.target\) \{[\s\S]*return await captureTarget\(doc, candidate\)/);
});

test('capture serialization inlines computed styles and uses an SVG data URL', async () => {
  const source = await read('assets/cover-generator.js');
  assert.match(source, /cloneWithComputedStyles\(candidate\.target, doc\.defaultView\)/);
  assert.match(source, /clone\.style\.margin = '0'/);
  assert.match(source, /new XMLSerializer\(\)\.serializeToString\(styledClone\)/);
  assert.match(source, /data:image\/svg\+xml;charset=utf-8/);
  assert.doesNotMatch(source, /createObjectURL\(svgBlob\)/);
});

test('the capture frame receives srcdoc before it is attached so blank-frame load cannot win', async () => {
  const source = await read('assets/cover-generator.js');
  const srcdocIndex = source.indexOf("iframe.srcdoc = String(html || '')");
  const appendIndex = source.indexOf('host.appendChild(iframe)', srcdocIndex);
  assert.notEqual(srcdocIndex, -1);
  assert.ok(appendIndex > srcdocIndex);
});

test('admin connects generated files to the existing cover preview and publish payload', async () => {
  const [html, admin] = await Promise.all([read('admin/index.html'), read('assets/admin.js')]);
  assert.match(html, /id="generate-cover-btn"[^>]*disabled>HTML에서 커버 자동 생성/);
  assert.match(html, /cover-generator\.js\?v=20260812-3/);
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
