import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => Number.parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('light-mode muted UI text meets the WCAG AA normal-text target', () => {
  for (const background of ['#f5f0e6', '#fbf8f1', '#f7f3eb']) {
    assert.ok(contrast('#666c67', background) >= 4.5, `${background} contrast must be at least 4.5:1`);
  }
});

test('homepage exposes category state and has no placeholder footer links', async () => {
  const [html, script] = await Promise.all([read('index.html'), read('assets/site.js')]);
  assert.match(html, /data-filter="all" aria-pressed="true"/);
  assert.equal((html.match(/data-filter="(?:daily|weekly|research|basics|note)" aria-pressed="false"/g) || []).length, 5);
  assert.match(script, /setAttribute\('aria-pressed',String\(selected\)\)/);
  assert.match(script, /setAttribute\('aria-current','page'\)/);
  assert.doesNotMatch(html, /<footer[\s\S]*?href="#"/);
});

test('admin theme control synchronizes visual theme, label, icon, and theme-color', async () => {
  const script = await read('assets/admin.js');
  assert.match(script, /html\.dataset\.theme = actual/);
  assert.match(script, /meta\[name="theme-color"\]/);
  assert.match(script, /라이트 모드로 전환/);
  assert.match(script, /actual === 'dark' \? '☀' : '◐'/);
});

test('shared report shell reuses site theme and exposes accessible comment fields and current navigation', async () => {
  const script = await read('assets/report-shell.js');
  assert.match(script, /localStorage\.getItem\('site-theme'\)/);
  assert.match(script, /host\.dataset\.theme = theme/);
  assert.equal((script.match(/aria-current=\"true\"/g) || []).length, 5);
  for (const label of ['닉네임', '삭제용 비밀번호', '댓글 내용']) {
    assert.match(script, new RegExp(`aria-label="${label}"`));
  }
  assert.match(script, /:focus-visible/);
});
