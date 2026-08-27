import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('homepage desktop and mobile navigation use the About slot for Market', async () => {
  const html = await read('index.html');
  const desktopNav = html.match(/<nav class="main-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  const quickNav = html.match(/<nav class="mobile-quick-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(desktopNav, /href="\/market\/">마켓<\/a>/);
  assert.match(quickNav, /href="\/market\/">마켓<\/a>/);
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
  assert.match(html, /<title>소개 \| Snowshagal Market Research<\/title>/);
  assert.doesNotMatch(html, /name="robots"/);
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
  assert.doesNotMatch(html, /data-menu-toggle/);
  assert.match(html, /src="\/assets\/site\.js\?v=[a-f0-9]{10}"/);
});

test('English About page contains matching editorial About and Contact sections', async () => {
  const html = await read('en/about/index.html');
  assert.match(html, /<html lang="en" data-site-lang="en">/);
  assert.match(html, /<title>About \| Snowshagal Market Research<\/title>/);
  assert.doesNotMatch(html, /name="robots"/);
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
});

test('common site script exits before homepage-only initialization on static pages', async () => {
  const script = await read('assets/site.js');
  const guard = script.indexOf('const isHomepage = Boolean(');
  assert.ok(guard > script.indexOf("themeBtn?.addEventListener('click'"));
  assert.ok(script.indexOf('if(!isHomepage) return;', guard) < script.indexOf('renderHighlights();'));
});

test('mobile navigation exposes 6 horizontal swipe links without hamburger menu', async () => {
  const [koHome, enHome, koMarket, enMarket, koAbout, enAbout] = await Promise.all([
    read('index.html'),
    read('en/index.html'),
    read('market/index.html'),
    read('en/market/index.html'),
    read('about/index.html'),
    read('en/about/index.html')
  ]);

  for (const html of [koHome, koMarket, koAbout]) {
    const quickNav = html.match(/<nav class="mobile-quick-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
    assert.match(quickNav, /href="\/market\/"[^>]*>마켓<\/a>/);
    assert.match(quickNav, /data-nav-category="daily"[^>]*>데일리<\/a>/);
    assert.match(quickNav, /data-nav-category="weekly"[^>]*>위클리<\/a>/);
    assert.match(quickNav, /data-nav-category="research"[^>]*>리서치<\/a>/);
    assert.match(quickNav, /data-nav-category="basics"[^>]*>시장 공부<\/a>/);
    assert.match(quickNav, /data-nav-category="note"[^>]*>끄적끄적<\/a>/);
    assert.doesNotMatch(html, /class="mobile-nav"/);
    assert.doesNotMatch(html, /data-menu-toggle/);
  }

  for (const html of [enHome, enMarket, enAbout]) {
    const quickNav = html.match(/<nav class="mobile-quick-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
    assert.match(quickNav, /href="\/en\/market\/"[^>]*>Market<\/a>/);
    assert.match(quickNav, /data-nav-category="daily"[^>]*>Daily<\/a>/);
    assert.match(quickNav, /data-nav-category="weekly"[^>]*>Weekly<\/a>/);
    assert.match(quickNav, /data-nav-category="research"[^>]*>Research<\/a>/);
    assert.match(quickNav, /data-nav-category="basics"[^>]*>Market Basics<\/a>/);
    assert.match(quickNav, /data-nav-category="note"[^>]*>Notes<\/a>/);
    assert.doesNotMatch(html, /class="mobile-nav"/);
    assert.doesNotMatch(html, /data-menu-toggle/);
  }
});
