import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  findTranslationCounterpart,
  postLanguage,
  reportAlternates,
  reportSeoTags,
  reportSiteUrl
} from '../functions/_seo.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const groupKey = (post) => String(post?.translationGroup || post?.id || '').trim();

test('every translation group holds one report type and at most one post per language (#126)', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const groups = new Map();
  for (const post of posts) {
    const key = groupKey(post);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const types = new Set(members.map((post) => post.type));
    assert.equal(types.size, 1, `group ${key} mixes report types: ${members.map((post) => `${post.id}(${post.type})`).join(', ')}`);
    for (const lang of ['ko', 'en']) {
      const count = members.filter((post) => postLanguage(post) === lang).length;
      assert.ok(count <= 1, `group ${key} has ${count} ${lang} posts`);
    }
    // A group that pairs must pair on the same report date.
    const dates = new Set(members.map((post) => String(post.reportDate || post.date || '').slice(0, 10)));
    assert.equal(dates.size, 1, `group ${key} spans report dates ${[...dates].join(', ')}`);
  }
  // Every translationGroup value names a post that exists.
  const ids = new Set(posts.map((post) => post.id));
  for (const post of posts) {
    if (post.translationGroup) assert.ok(ids.has(post.translationGroup), `${post.id} points at unknown group ${post.translationGroup}`);
  }
});

test('the 09-11 and 08-10 Daily and Weekly pairs link KO and EN of the same report, never across types', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const byId = new Map(posts.map((post) => [post.id, post]));
  const pairs = [
    ['2026-09-11-daily-1sx754u', '2026-09-11-daily-1f4utmk', 'daily'],
    ['2026-09-02-weekly-11ncmn3', '2026-09-11-weekly-17fg5xx', 'weekly'],
    ['2026-08-10-daily-1evguss', '2026-08-10-daily-1bb8z4p', 'daily'],
    ['2026-08-10-weekly-1rva1f6', '2026-08-10-weekly-hez6ok', 'weekly']
  ];
  for (const [koId, enId, type] of pairs) {
    const ko = byId.get(koId);
    const en = byId.get(enId);
    assert.ok(ko && en, `${koId} / ${enId} exist`);
    assert.equal(ko.type, type);
    assert.equal(en.type, type);
    assert.equal(findTranslationCounterpart(posts, ko)?.id, enId);
    assert.equal(findTranslationCounterpart(posts, en)?.id, koId);
    for (const post of [ko, en]) {
      const alternates = reportAlternates(posts, post);
      assert.deepEqual(alternates.map((entry) => entry.lang), ['en', 'ko', 'x-default']);
      assert.equal(alternates.find((entry) => entry.lang === 'ko').href, reportSiteUrl(ko.href));
      assert.equal(alternates.find((entry) => entry.lang === 'en').href, reportSiteUrl(en.href));
      assert.equal(alternates.find((entry) => entry.lang === 'x-default').href, reportSiteUrl(ko.href));
      const tags = reportSeoTags(posts, post);
      assert.ok(tags.includes(`<link rel="canonical" href="${reportSiteUrl(post.href)}">`), 'self canonical');
      // No alternate may point at a report of another type.
      for (const entry of alternates) {
        const target = posts.find((candidate) => reportSiteUrl(candidate.href) === entry.href);
        assert.equal(target?.type, type, `${post.id} hreflang=${entry.lang} points at a ${target?.type}`);
      }
    }
  }
});

test('the EN 09-16 Daily title matches its H1 spacing and the KO pair is intact', async () => {
  const posts = JSON.parse(await read('data/posts.json'));
  const en = posts.find((post) => post.id === '2026-09-16-daily-5msodg');
  assert.equal(en.title, 'Waiting for the Fed, A Narrow Rebound');
  const html = await read(en.href);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(h1, en.title);
  assert.equal(findTranslationCounterpart(posts, en)?.id, '2026-09-16-daily-3yztzq');
  const index = JSON.parse(await read('data/search-index.json'));
  assert.equal(index.find((entry) => entry.id === en.id)?.title, en.title);
});
