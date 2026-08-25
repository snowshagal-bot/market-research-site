import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage desktop and mobile navigation use the About slot for Market', async () => {
  const html = await read('index.html');
  const desktopNav = html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const mobileNav = html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(desktopNav, /href="\/market\/">마켓<\/a>/);
  assert.match(mobileNav, /href="\/market\/">마켓<\/a>/);
  assert.match(html, /<footer[\s\S]*href="\/about\/">소개<\/a>/);
  assert.match(html, /<footer[\s\S]*href="\/about\/#contact">문의<\/a>/);
});

test('shared report shell links to Market', async () => {
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /const marketPath = locale === 'en' \? '\/en\/market\/' : '\/market\/'/);
  assert.match(shell, /href="\$\{marketPath\}">\$\{copy\.market\}<\/a>/);
});

test('About page contains editorial introduction, contact, and simplified footer', async () => {
  const html = await read('about/index.html');
  assert.match(html, /<title>소개 · Market Research<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.equal((html.match(/href="\/market\/">마켓<\/a>/g) || []).length, 2);
  assert.match(html, /<footer[\s\S]*href="\/about\/">소개<\/a>/);
  assert.match(html, /<footer[\s\S]*href="\/about\/#contact">문의<\/a>/);
  assert.match(html, /<footer[\s\S]*contact@snowshagal\.com/);
  assert.match(html, /<section class="about-section" aria-labelledby="section-about-heading">[\s\S]*?<h2[^>]*>소개<\/h2>/);
  assert.match(html, /<section id="contact" class="about-section" aria-labelledby="section-contact-heading">[\s\S]*?<h2[^>]*>문의<\/h2>/);
  assert.doesNotMatch(html, /<h2[^>]*>방법론<\/h2>/);
  assert.doesNotMatch(html, /<h2[^>]*>정정 원칙<\/h2>/);
  assert.doesNotMatch(html, /class="about-nav"/);
  assert.match(html, /mailto:contact@snowshagal\.com/);
  assert.match(html, /data-theme-toggle/);
  assert.match(html, /data-menu-toggle/);
  assert.match(html, /src="\/assets\/site\.js\?v=20260824-5"/);
});

test('English About page contains matching editorial About and Contact sections', async () => {
  const html = await read('en/about/index.html');
  assert.match(html, /<html lang="en" data-site-lang="en">/);
  assert.match(html, /<title>About · Market Research<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.equal((html.match(/href="\/en\/market\/">Market<\/a>/g) || []).length, 2);
  assert.match(html, /<footer[\s\S]*href="\/en\/about\/">About<\/a>/);
  assert.match(html, /<footer[\s\S]*href="\/en\/about\/#contact">Contact<\/a>/);
  assert.match(html, /<footer[\s\S]*contact@snowshagal\.com/);
  assert.match(html, /<section class="about-section" aria-labelledby="section-about-heading">[\s\S]*?<h2[^>]*>About<\/h2>/);
  assert.match(html, /<section id="contact" class="about-section" aria-labelledby="section-contact-heading">[\s\S]*?<h2[^>]*>Contact<\/h2>/);
  assert.doesNotMatch(html, /<h2[^>]*>Methodology<\/h2>/);
  assert.doesNotMatch(html, /<h2[^>]*>Corrections Policy<\/h2>/);
  assert.doesNotMatch(html, /class="about-nav"/);
  assert.match(html, /mailto:contact@snowshagal\.com/);
  assert.match(html, /data-language-choice="ko"/);
  assert.match(html, /data-language-choice="en"/);
});

test('common site script exits before homepage-only initialization on static pages', async () => {
  const script = await read('assets/site.js');
  const guard = script.indexOf('const isHomepage = Boolean(');
  assert.ok(guard > script.indexOf("themeBtn?.addEventListener('click'"));
  assert.ok(guard > script.indexOf("menuBtn.addEventListener('click'"));
  assert.ok(script.indexOf('if(!isHomepage) return;', guard) < script.indexOf('renderHighlights();'));
});
