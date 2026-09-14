import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_TAG_COUNT,
  customTagEntry,
  generateTagsJs,
  isCustomTag,
  normalizeEnglishLabel,
  normalizeLabelText,
  splitTagRegistry,
  tagRegistryProblems,
  validateTagDefinition
} from '../functions/_tags.js';
import { onRequestPost as publishPost } from '../functions/api/publish.js';
import {
  DYNAMIC_DATA_ASSETS,
  STAMP_TARGETS,
  TRACKED_ASSETS,
  computeContentHash,
  findStaleAssetReferences,
  findVersionedDynamicReferences,
  getAssetVersionMap,
  stampAssetVersionsInContent
} from '../scripts/asset-versions.mjs';
import { createMockAuthEnv } from './helpers/auth-test-helper.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(rootDir, rel), 'utf8');
const registry = JSON.parse(read('data/tags.json'));
const ADMIN_KEY = 'test-admin-key';
const originalFetch = globalThis.fetch;

// The canonical taxonomy as PR #109 introduced it (a60ffd4), reduced to what a
// reader sees — id, Korean label, English label, group — and sorted by id.
// Changing a canonical tag on purpose means changing this digest in the same
// commit; a publish never can.
const CANONICAL_DIGEST = '6b327b44f227002ac8980798b75b3b9eb1f8336a4b04c95fe7dc54e84b9ab3d8';
const canonicalDigest = canonical => crypto.createHash('sha256')
  .update(JSON.stringify(Object.keys(canonical).sort().map(id => [id, canonical[id].ko, canonical[id].en, canonical[id].group])))
  .digest('hex');

function withCustomTags(base, count) {
  const out = { ...base };
  for (let i = 1; i <= count; i++) out[`custom-tag-${i}`] = { ko: `커스텀 ${i}`, en: `Custom ${i}`, group: 'market', custom: true };
  return out;
}

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/* ------------------------------------------------ canonical 36 + custom N */

test('the live registry is the 36 canonical tags of #109, unchanged, with custom tags beside them', () => {
  const { canonical, custom } = splitTagRegistry(registry);
  const { canonicalCount, customCount, problems } = tagRegistryProblems(registry);
  assert.deepEqual(problems, []);
  assert.equal(canonicalCount, CANONICAL_TAG_COUNT);
  assert.equal(customCount, Object.keys(custom).length);
  assert.equal(Object.keys(registry).length, canonicalCount + customCount);
  assert.equal(canonicalDigest(canonical), CANONICAL_DIGEST, 'a canonical tag was added, removed or relabelled');
  for (const [id, definition] of Object.entries(custom)) {
    assert.equal(isCustomTag(definition), true, id);
    assert.deepEqual(Object.keys(definition), ['ko', 'en', 'group', 'custom'], `${id} has exactly the stored shape`);
  }
  // Both were added by publishes after #109: f03c26f and 5e9d182.
  assert.equal(isCustomTag(registry['quadruple-witching-day']), true);
  assert.equal(isCustomTag(registry.japan), true);
});

test('36 canonical with no, one or many custom tags passes; 35 or 37 canonical fails', () => {
  const { canonical } = splitTagRegistry(registry);
  assert.deepEqual(tagRegistryProblems(canonical).problems, [], '36 + 0');
  assert.deepEqual(tagRegistryProblems(withCustomTags(canonical, 1)).problems, [], '36 + 1');
  const many = tagRegistryProblems(withCustomTags(canonical, 25));
  assert.deepEqual(many.problems, [], '36 + 25');
  assert.equal(many.customCount, 25);

  const [firstId] = Object.keys(canonical);
  const thirtyFive = { ...canonical };
  delete thirtyFive[firstId];
  assert.match(tagRegistryProblems(thirtyFive).problems.join(), /expected 36, found 35/);

  const thirtySeven = { ...canonical, 'unmarked-extra': { ko: '표시 없음', en: 'Unmarked', group: 'market' } };
  assert.match(tagRegistryProblems(thirtySeven).problems.join(), /expected 36, found 37/);

  // A custom tag that lost its marker is indistinguishable from a 37th canonical one.
  const lostMarker = withCustomTags(canonical, 1);
  delete lostMarker['custom-tag-1'].custom;
  assert.match(tagRegistryProblems(lostMarker).problems.join(), /found 37/);
});

/* ------------------------------------------------------------ normalization */

test('label text: trimmed, whitespace collapsed, NFC, blank is nothing', () => {
  assert.equal(normalizeLabelText(' Japan '), 'Japan');
  assert.equal(normalizeLabelText('Bank   of  Japan'), 'Bank of Japan');
  assert.equal(normalizeLabelText('네\t마녀의\n 날'), '네 마녀의 날');
  assert.equal(normalizeLabelText('   '), '');
  assert.equal(normalizeLabelText('날'), '날', 'decomposed jamo arrive as one syllable');
  assert.equal(normalizeLabelText(undefined), '');
});

test('English label casing: what someone chose is kept; only certain corrections are made', () => {
  assert.equal(normalizeEnglishLabel('japan'), 'Japan');
  assert.equal(normalizeEnglishLabel(' japan '), 'Japan');
  assert.equal(normalizeEnglishLabel('etf'), 'ETF');
  assert.equal(normalizeEnglishLabel('fomc'), 'FOMC');
  assert.equal(normalizeEnglishLabel('sk hynix'), 'SK hynix');
  for (const kept of ['Japan', 'JAPAN', 'AI', 'ETF', 'KOSPI', 'SK hynix', 'iPhone', 'eBay', 'OpenAI', 'Bank of Japan']) {
    assert.equal(normalizeEnglishLabel(kept), kept, `${kept} stands as typed`);
  }
  // Not certain, so not touched: a short word may be an acronym, and not every
  // word of a phrase takes a capital.
  assert.equal(normalizeEnglishLabel('tsmc'), 'tsmc');
  assert.equal(normalizeEnglishLabel('gold'), 'gold');
  assert.equal(normalizeEnglishLabel('bank of japan'), 'bank of japan');
});

test('custom tag validation stores normalized labels and refuses blanks and duplicates', () => {
  const { canonical } = splitTagRegistry(registry);

  const japan = validateTagDefinition({ ko: '  일본  ', en: ' japan ', group: 'market' }, canonical);
  assert.equal(japan.valid, true);
  assert.deepEqual(japan.tag, { id: 'japan', ko: '일본', en: 'Japan', group: 'market' });
  assert.deepEqual(customTagEntry(japan.tag), { ko: '일본', en: 'Japan', group: 'market', custom: true });

  const spaced = validateTagDefinition({ ko: '일본  은행', en: 'Bank   of  Japan', group: 'macro' }, canonical);
  assert.equal(spaced.valid, true);
  assert.equal(spaced.tag.ko, '일본 은행');
  assert.equal(spaced.tag.en, 'Bank of Japan');
  assert.equal(spaced.tag.id, 'bank-of-japan');

  const blankKo = validateTagDefinition({ ko: '   ', en: 'Blank', group: 'market' }, canonical);
  assert.equal(blankKo.valid, false);
  assert.match(blankKo.error, /한국어 태그 이름을 입력하세요/);
  const blankEn = validateTagDefinition({ ko: '빈 영문', en: ' \t ', group: 'market' }, canonical);
  assert.equal(blankEn.valid, false);
  assert.match(blankEn.error, /English 태그 이름을 입력하세요/);

  // Against the live registry, where japan and quadruple-witching-day already exist.
  const sameSlug = validateTagDefinition({ ko: '일본 증시', en: 'JAPAN!', group: 'market' }, registry);
  assert.equal(sameSlug.valid, false);
  assert.match(sameSlug.error, /이미 등록된 태그 ID/);
  const sameKoSpaced = validateTagDefinition({ ko: '  일본 ', en: 'Nippon', group: 'market' }, registry);
  assert.equal(sameKoSpaced.valid, false);
  assert.match(sameKoSpaced.error, /한국어/);
  const sameKoDecomposed = validateTagDefinition({ ko: '일본', en: 'Nihon', group: 'market' }, registry);
  assert.equal(sameKoDecomposed.valid, false, 'the same word in decomposed jamo is still the same label');
});

async function publishWithNewTags({ registryText, newTags, tags }) {
  const calls = [];
  const blobContents = new Map();
  let blobCounter = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const route = `${url.pathname}${url.search}`;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: route, method, body });
    if (route.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'base-sha' } });
    if (route.includes('/contents/data/posts.json')) return Response.json({ content: base64('[]\n') });
    if (route.includes('/contents/data/tags.json')) return Response.json({ content: base64(registryText) });
    if (route.includes('/contents/data/search-index.json')) return Response.json({ content: base64('[]\n') });
    if (method === 'GET' && route.includes('/git/commits/')) return Response.json({ tree: { sha: 'base-tree' } });
    if (method === 'POST' && route.endsWith('/git/blobs')) {
      const sha = `blob-${++blobCounter}`;
      if (body?.encoding === 'utf-8') blobContents.set(sha, body.content);
      return Response.json({ sha });
    }
    if (method === 'POST' && route.endsWith('/git/trees')) {
      for (const entry of body?.tree || []) if (entry && blobContents.has(entry.sha)) entry.content = blobContents.get(entry.sha);
      return Response.json({ sha: 'new-tree-sha' });
    }
    if (method === 'POST' && route.endsWith('/git/commits')) return Response.json({ sha: 'new-commit-sha' });
    if (method === 'PATCH' && route.endsWith('/git/refs/heads/main')) return Response.json({ object: { sha: body.sha } });
    throw new Error(`Unexpected call: ${route}`);
  };
  try {
    const env = await createMockAuthEnv({ ADMIN_KEY, GITHUB_TOKEN: 'test-token', GITHUB_REPO: 'snowshagal-bot/market-research-site' });
    const form = new FormData();
    const html = '<!DOCTYPE html><html><head><title>Tag Report</title></head><body><h1>Tag Report</h1><p>' + '본문 내용 '.repeat(50) + '</p></body></html>';
    form.append('file', new File([html], '2026-09-07-daily-tag-normalization.html', { type: 'text/html' }));
    form.append('type', 'daily');
    form.append('reportDate', '2026-09-07');
    form.append('title', 'Tag Normalization Report');
    form.append('subtitle', '');
    form.append('description', 'Tag normalization');
    form.append('lang', 'ko');
    form.append('newTags', JSON.stringify(newTags));
    for (const tag of tags) form.append('tags', tag);
    const request = new Request('https://admin.snowshagal.com/api/publish', {
      method: 'POST',
      headers: { origin: 'https://admin.snowshagal.com', 'x-admin-key': ADMIN_KEY, cookie: env._authSession.cookieHeader, 'x-csrf-token': env._authSession.csrfToken },
      body: form
    });
    const response = await publishPost({ request, env });
    const data = await response.json();
    const tree = calls.find(call => call.path.endsWith('/git/trees'))?.body?.tree || null;
    return { status: response.status, data, tree, file: name => tree?.find(entry => entry.path === name)?.content };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('a publish stores a new custom tag normalized and marked, and leaves the canonical 36 alone', async () => {
  const { canonical } = splitTagRegistry(registry);
  const { status, data, file } = await publishWithNewTags({
    registryText: `${JSON.stringify(canonical, null, 2)}\n`,
    newTags: [{ ko: '  일본  ', en: ' japan ', group: 'market' }],
    tags: ['japan', 'kospi']
  });
  assert.equal(status, 200, JSON.stringify(data));
  const committed = JSON.parse(file('data/tags.json'));
  assert.deepEqual(committed.japan, { ko: '일본', en: 'Japan', group: 'market', custom: true });
  assert.deepEqual(Function(`const window = {}; ${file('data/tags.js')}; return window.TAG_REGISTRY;`)(), committed);
  const shape = tagRegistryProblems(committed);
  assert.deepEqual(shape.problems, []);
  assert.equal(shape.customCount, 1);
  assert.equal(canonicalDigest(splitTagRegistry(committed).canonical), CANONICAL_DIGEST);
});

test('a publish refuses a blank label and two new tags that share a slug, before anything is written', async () => {
  const { canonical } = splitTagRegistry(registry);
  const registryText = `${JSON.stringify(canonical, null, 2)}\n`;

  const blank = await publishWithNewTags({ registryText, newTags: [{ ko: '   ', en: 'Blank Label', group: 'market' }], tags: ['blank-label'] });
  assert.equal(blank.status, 400);
  assert.equal(blank.data.error, 'BAD_CUSTOM_TAG');
  assert.equal(blank.tree, null);

  const twice = await publishWithNewTags({
    registryText,
    newTags: [{ ko: '휴머노이드', en: 'Humanoid', group: 'sector' }, { ko: '휴머노이드 로봇', en: 'humanoid', group: 'sector' }],
    tags: ['humanoid']
  });
  assert.equal(twice.status, 400);
  assert.match(twice.data.message, /이미 등록된 태그 ID/);
  assert.equal(twice.tree, null);
});

/* ------------------------------------------------ tags.js as dynamic data */

test('data/tags.js is dynamic data: never content-hashed, never version-stamped, never cached', () => {
  assert.equal(TRACKED_ASSETS.includes('data/tags.js'), false);
  assert.equal(DYNAMIC_DATA_ASSETS.includes('data/tags.js'), true);
  assert.deepEqual(TRACKED_ASSETS.filter(asset => DYNAMIC_DATA_ASSETS.includes(asset)), [], 'no asset is both');
  assert.match(read('_headers'), /\/data\/tags\.js\s+Cache-Control:\s*no-cache, no-store, must-revalidate/);
  for (const file of STAMP_TARGETS) {
    assert.deepEqual(findVersionedDynamicReferences(read(file)), [], `${file} pins no dynamic data version`);
  }
  assert.equal(
    stampAssetVersionsInContent('<script src="/data/tags.js?v=121f43e8ae"></script>', getAssetVersionMap(rootDir)),
    '<script src="/data/tags.js"></script>',
    'stamping strips a leftover tags.js version'
  );
});

test('a publish that rewrites tags.js leaves the stale-asset check passing', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tags-dynamic-'));
  try {
    for (const asset of TRACKED_ASSETS) {
      fs.mkdirSync(path.dirname(path.join(scratch, asset)), { recursive: true });
      fs.copyFileSync(path.join(rootDir, asset), path.join(scratch, asset));
    }
    fs.mkdirSync(path.join(scratch, 'data'), { recursive: true });
    const rewritten = generateTagsJs(withCustomTags(registry, 1));
    fs.writeFileSync(path.join(scratch, 'data', 'tags.js'), rewritten);
    assert.notEqual(computeContentHash(rewritten), computeContentHash(read('data/tags.js')), 'the registry really changed');

    const versionMap = getAssetVersionMap(scratch);
    assert.equal(versionMap['data/tags.js'], undefined);
    for (const file of STAMP_TARGETS) {
      assert.deepEqual(findStaleAssetReferences(read(file), versionMap), [], `${file} after a custom tag publish`);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a stale runtime script or stylesheet still fails the check', () => {
  const versionMap = getAssetVersionMap(rootDir);
  const html = read('index.html');
  assert.deepEqual(findStaleAssetReferences(html, versionMap), []);

  for (const asset of ['assets/site.js', 'assets/site.css', 'assets/report-shell.js']) {
    const current = versionMap[asset];
    const stale = `<script src="/${asset}?v=0000000000"></script><link href="/${asset}">`;
    const found = findStaleAssetReferences(stale, versionMap).filter(item => item.assetPath === asset);
    assert.deepEqual(found, [
      { assetPath: asset, expected: current, actual: '0000000000' },
      { assetPath: asset, expected: current, actual: null }
    ], `${asset}: a wrong hash and a missing hash are both stale`);
  }
});
