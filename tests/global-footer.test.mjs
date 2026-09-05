import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { onRequest as middlewareRequest } from '../functions/_middleware.js';
import { siteFooter, footerCss } from '../functions/_footer.js';
import { STATIC_FOOTER_PAGES } from '../scripts/sync-static-footers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const read = (relPath) => readFile(path.join(rootDir, relPath), 'utf8');

test('siteFooter("ko") generates canonical Korean footer markup with correct nav groups and disclaimers', () => {
  const footer = siteFooter('ko');
  assert.match(footer, /<footer id="site-footer" class="footer site-footer">/);
  assert.match(footer, /<a class="footer-brand site-footer-brand" href="\/" aria-label="Snowshagal Market Research">/);
  assert.match(footer, /<img class="footer-brand-owl site-footer-brand-owl" src="\/assets\/brand\/snowshagal-owl\.webp" alt="" width="232" height="256" loading="lazy" aria-hidden="true">/);
  assert.match(footer, /<p class="footer-tagline site-footer-tagline">시장을 읽어주는 사이트\.<\/p>/);

  // Nav Groups
  assert.match(footer, /<p class="site-footer-heading" aria-hidden="true">리포트<\/p>/);
  assert.match(footer, /<nav class="site-footer-nav" aria-label="푸터 리포트 메뉴">[\s\S]*?<a href="\/daily\/">데일리<\/a>[\s\S]*?<a href="\/weekly\/">위클리<\/a>[\s\S]*?<a href="\/research\/">리서치<\/a>[\s\S]*?<a href="\/notes\/">투자 노트<\/a>[\s\S]*?<a href="\/basics\/">시장 입문<\/a>/);

  assert.match(footer, /<p class="site-footer-heading" aria-hidden="true">마켓<\/p>/);
  assert.match(footer, /<nav class="site-footer-nav" aria-label="푸터 마켓 메뉴">[\s\S]*?<a href="\/market\/">마켓<\/a>[\s\S]*?<a href="\/disclosures\/">공시<\/a>[\s\S]*?<a href="\/calendar\/">캘린더<\/a>/);

  assert.match(footer, /<p class="site-footer-heading" aria-hidden="true">사이트<\/p>/);
  assert.match(footer, /<nav class="site-footer-nav" aria-label="푸터 사이트 메뉴">[\s\S]*?<a href="\/about\/">소개<\/a>[\s\S]*?<a href="mailto:contact@snowshagal\.com">문의<\/a>[\s\S]*?<a href="\/en\/">English<\/a>/);

  // Meta
  assert.match(footer, /<p class="footer-disclaimer site-footer-disclaimer">본 사이트의 리서치와 해설은 정보 제공을 목적으로 하며, 특정 금융투자상품에 대한 투자자문 또는 매수·매도 권유를 제공하지 않습니다\.<\/p>/);
  assert.match(footer, /<p class="footer-copy site-footer-copy">© 2026 SNOWSHAGAL<\/p>/);
});

test('siteFooter("en") generates canonical English footer markup with correct nav groups and disclaimers', () => {
  const footer = siteFooter('en');
  assert.match(footer, /<footer id="site-footer" class="footer site-footer">/);
  assert.match(footer, /<a class="footer-brand site-footer-brand" href="\/en\/" aria-label="Snowshagal Market Research">/);
  assert.match(footer, /<img class="footer-brand-owl site-footer-brand-owl" src="\/assets\/brand\/snowshagal-owl\.webp" alt="" width="232" height="256" loading="lazy" aria-hidden="true">/);
  assert.match(footer, /<p class="footer-tagline site-footer-tagline">A clearer read on the market\.<\/p>/);

  // Nav Groups
  assert.match(footer, /<p class="site-footer-heading" aria-hidden="true">Reports<\/p>/);
  assert.match(footer, /<nav class="site-footer-nav" aria-label="Footer Reports menu">[\s\S]*?<a href="\/en\/daily\/">Daily<\/a>[\s\S]*?<a href="\/en\/weekly\/">Weekly<\/a>[\s\S]*?<a href="\/en\/research\/">Research<\/a>[\s\S]*?<a href="\/en\/notes\/">Investment Note<\/a>[\s\S]*?<a href="\/en\/basics\/">Market Basics<\/a>/);

  assert.match(footer, /<p class="site-footer-heading" aria-hidden="true">Market<\/p>/);
  assert.match(footer, /<nav class="site-footer-nav" aria-label="Footer Market menu">[\s\S]*?<a href="\/en\/market\/">Market<\/a>[\s\S]*?<a href="\/en\/disclosures\/">Disclosure<\/a>[\s\S]*?<a href="\/en\/calendar\/">Calendar<\/a>/);

  assert.match(footer, /<p class="site-footer-heading" aria-hidden="true">Site<\/p>/);
  assert.match(footer, /<nav class="site-footer-nav" aria-label="Footer Site menu">[\s\S]*?<a href="\/en\/about\/">About<\/a>[\s\S]*?<a href="mailto:contact@snowshagal\.com">Contact<\/a>[\s\S]*?<a href="\/">한국어<\/a>/);

  // Meta
  assert.match(footer, /<p class="footer-disclaimer site-footer-disclaimer">Snowshagal provides research and commentary for informational purposes only and does not offer personalized investment advice or recommendations to buy or sell financial products\.<\/p>/);
  assert.match(footer, /<p class="footer-copy site-footer-copy">© 2026 SNOWSHAGAL<\/p>/);
});

test('footerCss() exports scoped CSS containing required custom properties, light/dark themes, and responsive rules', () => {
  const css = footerCss();
  assert.match(css, /#site-footer/);
  assert.match(css, /--sf-bg:#f7f3eb/);
  assert.match(css, /--sf-text:#1f2420/);
  assert.match(css, /@media\(prefers-color-scheme:dark\)/);
  assert.match(css, /#site-footer\[data-theme="dark"\]/);
  assert.match(css, /#site-footer\[data-theme="light"\]/);
  assert.match(css, /@media\(max-width:768px\)/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('all static public HTML pages contain canonical siteFooter markup', async () => {
  for (const { file, lang } of STATIC_FOOTER_PAGES) {
    const html = await read(file);
    const expected = siteFooter(lang);
    assert.ok(html.includes(expected), `File ${file} does not contain exact siteFooter("${lang}") markup`);
  }
});

test('all 10 category landing pages contain canonical siteFooter markup', async () => {
  const categoryTypes = ['daily', 'weekly', 'research', 'basics', 'notes'];
  for (const type of categoryTypes) {
    const koHtml = await read(`${type}/index.html`);
    const enHtml = await read(`en/${type}/index.html`);
    assert.ok(koHtml.includes(siteFooter('ko')), `${type}/index.html missing siteFooter('ko')`);
    assert.ok(enHtml.includes(siteFooter('en')), `en/${type}/index.html missing siteFooter('en')`);
  }
});

test('middleware injects footer CSS into head and siteFooter into body for reports', async () => {
  const mockHtml = `<!doctype html><html><head><title>Sample Report</title></head><body><div class="content">Report body</div></body></html>`;
  const next = async () => new Response(mockHtml, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });

  // KO Report
  const koRes = await middlewareRequest({
    request: new Request('https://snowshagal.com/reports/sample.html'),
    next,
    env: {}
  });
  const koBody = await koRes.text();
  assert.match(koBody, /<style id="site-footer-css">[\s\S]*?<\/style><\/head>/);
  assert.match(koBody, /<footer id="site-footer" class="footer site-footer">[\s\S]*?<\/footer><script src="\/assets\/locale\.js/);
  assert.match(koBody, /시장을 읽어주는 사이트\./);

  // EN Report
  const enRes = await middlewareRequest({
    request: new Request('https://snowshagal.com/reports/en/sample.html'),
    next,
    env: {}
  });
  const enBody = await enRes.text();
  assert.match(enBody, /<style id="site-footer-css">[\s\S]*?<\/style><\/head>/);
  assert.match(enBody, /<footer id="site-footer" class="footer site-footer">[\s\S]*?<\/footer><script src="\/assets\/locale\.js/);
  assert.match(enBody, /A clearer read on the market\./);
});

test('report-shell.js defines appendBeforeGlobalFooter and mounts discovery, share, and comments before site-footer', async () => {
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /function appendBeforeGlobalFooter\(node\)\s*\{[\s\S]*?document\.body\.insertBefore\(node,\s*footer\s*\|\|\s*null\);/);
  assert.match(shell, /function applyShellTheme\(\)\s*\{[\s\S]*?const footer = document\.getElementById\('site-footer'\);[\s\S]*?if \(footer\) footer\.dataset\.theme = theme;/);

  // Verify that mountDiscovery, mountShare, mountComments use appendBeforeGlobalFooter instead of direct document.body.appendChild(host)
  const mountCommentsFn = shell.match(/function mountComments\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  const mountDiscoveryFn = shell.match(/function mountDiscovery\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';
  const mountShareFn = shell.match(/function mountShare\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] || '';

  assert.match(mountCommentsFn, /appendBeforeGlobalFooter\(host\);/);
  assert.doesNotMatch(mountCommentsFn, /document\.body\.appendChild\(host\);/);

  assert.match(mountDiscoveryFn, /appendBeforeGlobalFooter\(host\);/);
  assert.doesNotMatch(mountDiscoveryFn, /document\.body\.appendChild\(host\);/);

  assert.match(mountShareFn, /appendBeforeGlobalFooter\(host\);/);
  assert.doesNotMatch(mountShareFn, /document\.body\.appendChild\(host\);/);
});

test('existing internal footers in uploaded reports remain preserved and reports directory is untouched', async () => {
  // Check git status of reports/
  const gitStatus = execSync('git status --porcelain reports/', { cwd: rootDir, encoding: 'utf8' }).trim();
  assert.equal(gitStatus, '', 'reports/ directory must have zero modifications on disk');
});
