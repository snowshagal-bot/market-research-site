import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Market admin exposes file selection, contract status, preview, auth, and publish controls', async () => {
  const html = await read('admin/market/index.html');
  for (const id of ['market-json-file', 'market-meta-date', 'market-meta-version', 'market-meta-status', 'market-meta-validation', 'market-publish-button', 'market-preview-root']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /accept="\.json,application\/json"/);
  assert.match(html, /meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /src="(?:(?:\.\.\/)+|\/)assets\/admin-market\.js/);
});

test('all admin pages link to the Market Close uploader', async () => {
  const pages = await Promise.all(['admin/index.html', 'admin/manage/index.html', 'admin/analytics/index.html'].map(read));
  assert.match(pages[0], /href="\.\/market\/">Market Close<\/a>/);
  assert.match(pages[1], /href="\.\.\/market\/">Market Close<\/a>/);
  assert.match(pages[2], /href="\.\.\/market\/">Market Close<\/a>/);
});

test('all admin pages expose the announcement manager', async () => {
  const pages = await Promise.all([
    'admin/index.html',
    'admin/manage/index.html',
    'admin/analytics/index.html',
    'admin/market/index.html',
    'admin/disclosures/index.html',
    'admin/market/announcements/index.html'
  ].map(read));
  assert.match(pages[0], /href="\.\/market\/announcements\/">공지 관리<\/a>/);
  assert.match(pages[1], /href="\.\.\/market\/announcements\/">공지 관리<\/a>/);
  assert.match(pages[2], /href="\.\.\/market\/announcements\/">공지 관리<\/a>/);
  assert.match(pages[3], /href="\.\/announcements\/">공지 관리<\/a>/);
  assert.match(pages[4], /href="\.\.\/market\/announcements\/">공지 관리<\/a>/);
  assert.match(pages[5], /href="\.\/" aria-current="page">공지 관리<\/a>/);
});

test('admin client gates supported final payloads and keeps both secrets out of static code', async () => {
  const script = await read('assets/admin-market.js');
  assert.match(script, /SUPPORTED_VERSIONS/);
  assert.match(script, /'1\.0\.1', '1\.1\.0'/);
  assert.match(script, /status !== 'final'/);
  assert.match(script, /validation\?\.passed !== true/);
  assert.match(script, /x-csrf-token/);
  assert.doesNotMatch(script, /market-secret|admin-secret|MARKET_PUBLISH_KEY|ADMIN_KEY\s*=/);
});
