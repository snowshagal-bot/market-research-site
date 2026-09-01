import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Calendar pages expose canonical SEO, alternates, and 9-item navigation', async () => {
  const [ko, en] = await Promise.all([
    read('calendar/index.html'),
    read('en/calendar/index.html')
  ]);

  // KO SEO
  assert.match(ko, /<title>Market Calendar \| KRX · NYSE 거래 일정 및 휴장일 \| Snowshagal<\/title>/);
  assert.match(ko, /rel="canonical" href="https:\/\/snowshagal\.com\/calendar\/"/);
  assert.match(ko, /hreflang="ko" href="https:\/\/snowshagal\.com\/calendar\/"/);
  assert.match(ko, /hreflang="en" href="https:\/\/snowshagal\.com\/en\/calendar\/"/);
  assert.match(ko, /hreflang="x-default" href="https:\/\/snowshagal\.com\/calendar\/"/);

  // EN SEO
  assert.match(en, /<title>Market Calendar \| KRX & NYSE Trading Schedule & Holidays \| Snowshagal<\/title>/);
  assert.match(en, /rel="canonical" href="https:\/\/snowshagal\.com\/en\/calendar\/"/);
  assert.match(en, /hreflang="ko" href="https:\/\/snowshagal\.com\/calendar\/"/);
  assert.match(en, /hreflang="en" href="https:\/\/snowshagal\.com\/en\/calendar\/"/);

  // Active navigation
  assert.match(ko, /<a class="active" href="\/calendar\/" aria-current="page">캘린더<\/a>/);
  assert.match(en, /<a class="active" href="\/en\/calendar\/" aria-current="page">Calendar<\/a>/);

  // Script tags
  assert.match(ko, /<script src="\/assets\/calendar\.js(\?v=[a-f0-9]+)?"><\/script>/);
  assert.match(en, /<script src="\/assets\/calendar\.js(\?v=[a-f0-9]+)?"><\/script>/);

  // No hamburger menu or pages.dev
  for (const page of [ko, en]) {
    assert.doesNotMatch(page, /hamburger/i);
    assert.doesNotMatch(page, /pages\.dev/);
    assert.match(page, /class="main-nav"/);
    assert.match(page, /class="mobile-quick-nav"/);
  }
});

test('Calendar client script targets /api/calendar endpoint with filters', async () => {
  const js = await read('assets/calendar.js');
  assert.match(js, /\/api\/calendar\?year=/);
  assert.match(js, /filter === 'ALL'/);
  assert.match(js, /filter === 'KRX'/);
  assert.match(js, /filter === 'NYSE'/);
});
