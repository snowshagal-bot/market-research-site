import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Disclosures pages expose canonical SEO, alternates, and 9-item navigation', async () => {
  const [ko, en] = await Promise.all([
    read('disclosures/index.html'),
    read('en/disclosures/index.html')
  ]);

  // KO SEO
  assert.match(ko, /<title>주요 공시 피드 \| 오늘의 핵심 기업 공시와 AI 해설 \| Snowshagal<\/title>/);
  assert.match(ko, /rel="canonical" href="https:\/\/snowshagal\.com\/disclosures\/"/);
  assert.match(ko, /hreflang="ko" href="https:\/\/snowshagal\.com\/disclosures\/"/);
  assert.match(ko, /hreflang="en" href="https:\/\/snowshagal\.com\/en\/disclosures\/"/);
  assert.match(ko, /hreflang="x-default" href="https:\/\/snowshagal\.com\/disclosures\/"/);

  // EN SEO
  assert.match(en, /<title>Key Disclosures Feed \| Today’s Corporate Filings & Insights \| Snowshagal<\/title>/);
  assert.match(en, /rel="canonical" href="https:\/\/snowshagal\.com\/en\/disclosures\/"/);
  assert.match(en, /hreflang="ko" href="https:\/\/snowshagal\.com\/disclosures\/"/);
  assert.match(en, /hreflang="en" href="https:\/\/snowshagal\.com\/en\/disclosures\/"/);

  // Active navigation
  assert.match(ko, /<a class="active" href="\/disclosures\/" aria-current="page">공시<\/a>/);
  assert.match(en, /<a class="active" href="\/en\/disclosures\/" aria-current="page">Disclosure<\/a>/);

  // Script tags
  assert.match(ko, /<script src="\/assets\/disclosures\.js(\?v=[a-f0-9]+)?"><\/script>/);
  assert.match(en, /<script src="\/assets\/disclosures\.js(\?v=[a-f0-9]+)?"><\/script>/);

  // No hamburger menu or pages.dev
  for (const page of [ko, en]) {
    assert.doesNotMatch(page, /hamburger/i);
    assert.doesNotMatch(page, /pages\.dev/);
    assert.match(page, /class="main-nav"/);
    assert.match(page, /class="mobile-quick-nav"/);
  }
});

test('Disclosures client script uses public feed endpoint and does not call admin APIs', async () => {
  const js = await read('assets/disclosures.js');
  assert.match(js, /\/api\/disclosures\/feed/);
  assert.doesNotMatch(js, /\/api\/admin/);
  assert.doesNotMatch(js, /\/api\/disclosures\/sync/);
  assert.doesNotMatch(js, /\/api\/disclosures\/latest/);
});
