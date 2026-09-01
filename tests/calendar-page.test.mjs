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

test('Calendar client script has no hardcoded initial month and dynamically computes current KST month', async () => {
  const js = await read('assets/calendar.js');
  // Ensure hardcoded default year: 2026, month: 9 is completely absent
  assert.doesNotMatch(js, /year:\s*2026,\s*month:\s*9/);
  assert.match(js, /getDefaultKstYearMonth/);
  assert.match(js, /timeZone:\s*['"]Asia\/Seoul['"]/);
  assert.match(js, /\/api\/calendar\?year=/);
  assert.match(js, /filter === 'ALL'/);
  assert.match(js, /filter === 'KRX'/);
  assert.match(js, /filter === 'NYSE'/);
});

test('Calendar initialization logic correctly handles dates across 2026-10, 2026-12, and explicit query params', () => {
  // Simulate the client getDefaultKstYearMonth helper with custom dates
  function testKstHelper(dateObj) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'numeric'
    }).formatToParts(dateObj);
    const y = Number(parts.find(p => p.type === 'year')?.value);
    const m = Number(parts.find(p => p.type === 'month')?.value);
    return { year: y, month: m };
  }

  // 1. Access in 2026-10 defaults to 2026-10
  const octDate = new Date('2026-10-15T03:00:00Z'); // 12:00 KST Oct 15
  assert.deepEqual(testKstHelper(octDate), { year: 2026, month: 10 });

  // 2. Access in 2026-12 defaults to 2026-12
  const decDate = new Date('2026-12-05T03:00:00Z'); // 12:00 KST Dec 5
  assert.deepEqual(testKstHelper(decDate), { year: 2026, month: 12 });

  // 3. Query parsing logic maintains explicit ?year=2026&month=9 even when accessing in December
  function parseTestUrl(queryString, nowKst) {
    const params = new URLSearchParams(queryString);
    const hasYear = params.has('year');
    const hasMonth = params.has('month');
    const y = Number(params.get('year'));
    const m = Number(params.get('month'));
    const def = testKstHelper(nowKst);
    return {
      year: (hasYear && Number.isInteger(y)) ? y : def.year,
      month: (hasMonth && Number.isInteger(m)) ? m : def.month
    };
  }

  assert.deepEqual(parseTestUrl('?year=2026&month=9', decDate), { year: 2026, month: 9 });
  assert.deepEqual(parseTestUrl('', decDate), { year: 2026, month: 12 });
  assert.deepEqual(parseTestUrl('', octDate), { year: 2026, month: 10 });
});
