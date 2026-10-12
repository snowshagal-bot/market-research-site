import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import '../assets/locale.js';
import '../assets/home-editorial.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const posts = [
  { type: 'daily', lang: 'ko', title: '이전 글', href: 'reports/old.html', reportDate: '2026-10-07' },
  { type: 'daily', lang: 'ko', title: '수급 <확인>', href: 'reports/daily-ko.html', reportDate: '2026-10-08', summary: '작성자의 요약', description: '설명', subtitle: '부제', takeaway: '한 줄', tags: ['flows'] },
  { type: 'research', lang: 'ko', title: '최신 리서치', href: 'reports/research.html', reportDate: '2026-10-12' },
  { type: 'daily', lang: 'en', title: 'Reading flows', href: 'reports/en/daily.html', reportDate: '2026-10-09', description: 'The author’s description.', tags: ['flows'] }
];
const tags = { flows: { ko: '수급', en: 'Flows' } };

test('editorial lead uses the latest daily in its locale, canonical URL and the actual blurb', () => {
  const ko = HOME_EDITORIAL.render(posts, 'ko', tags);
  const en = HOME_EDITORIAL.render(posts, 'en', tags);
  assert.match(ko, /수급 &lt;확인&gt;/);
  assert.match(ko, /href="\/reports\/daily-ko"/);
  assert.match(ko, /작성자의 요약/);
  assert.doesNotMatch(ko, /이전 글|최신 리서치|Reading flows|부제|한 줄/);
  assert.match(en, /Reading flows/);
  assert.match(en, /The author’s description\./);
  assert.match(en, /href="\/en\/market\/"/);
  assert.match(en, /href="\/en\/about\/"/);
  assert.doesNotMatch(en, /수급|작성자/);
});

test('no daily means no invented view or opposite-language fallback; missing optional content is omitted', () => {
  assert.equal(HOME_EDITORIAL.render(posts.filter(post => post.lang === 'ko'), 'en', tags), '');
  assert.equal(HOME_EDITORIAL.render([], 'ko', tags), '');
  assert.doesNotMatch(HOME_EDITORIAL.render(posts, 'ko', null), /home-daily-topics/);
  const html = HOME_EDITORIAL.render([{ ...posts[0], subtitle: 'not a summary', takeaway: 'not a summary' }], 'ko');
  assert.doesNotMatch(html, /home-daily-summary|home-daily-topics|not a summary/);
  const hostile = HOME_EDITORIAL.render([{ ...posts[1], summary: '<img src=x onerror=alert(1)>', title: '<script>x</script>' }], 'ko');
  assert.doesNotMatch(hostile, /<script>|<img/);
  assert.match(hostile, /&lt;script&gt;/);
});

test('server and browser share identical editorial output for both locales', async () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(await read('assets/locale.js'), context);
  vm.runInContext(await read('assets/home-editorial.js'), context);
  for (const lang of ['ko', 'en']) {
    assert.equal(context.window.HOME_EDITORIAL.render(posts, lang, tags), HOME_EDITORIAL.render(posts, lang, tags));
  }
});
