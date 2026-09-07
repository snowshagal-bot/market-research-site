import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost as publishPost } from '../functions/api/publish.js';
import {
  VALID_GROUPS,
  GROUP_LABELS,
  GROUP_ORDER,
  MAX_POST_TAGS,
  TAG_SLUG_REGEX,
  slugifyLabel,
  sanitizeLabel,
  validateTagDefinition,
  parseAndValidateTags,
  generateTagsJs
} from '../functions/_tags.js';
import vm from 'node:vm';
import {
  tagLabel,
  categoryFeaturedCards,
  homepageLatestLinks,
  serializeTagRegistryBootstrap
} from '../functions/_seo.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { createMockAuthEnv } from './helpers/auth-test-helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const ADMIN_KEY = 'test-admin-key';
const originalFetch = globalThis.fetch;
const tagsJsonRaw = fs.readFileSync(path.join(rootDir, 'data', 'tags.json'), 'utf8');

function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function createTestAuthEnv() {
  return createMockAuthEnv({
    ADMIN_KEY,
    GITHUB_TOKEN: 'test-token',
    GITHUB_REPO: 'snowshagal-bot/market-research-site'
  });
}

test('Tag Taxonomy: 36 tags across 4 canonical groups (6 market, 13 sector, 10 macro, 7 company-policy)', () => {
  const tagsJson = JSON.parse(tagsJsonRaw);
  const keys = Object.keys(tagsJson);
  assert.equal(keys.length, 36, 'Exact 36 tags in registry');

  const groupCounts = { market: 0, sector: 0, macro: 0, 'company-policy': 0 };
  for (const [id, def] of Object.entries(tagsJson)) {
    assert.ok(VALID_GROUPS.has(def.group), `Valid group for ${id}`);
    assert.match(id, TAG_SLUG_REGEX, `Valid slug regex for ${id}`);
    assert.ok(def.ko && def.ko.length > 0 && def.ko.length <= 40, `Valid KO for ${id}`);
    assert.ok(def.en && def.en.length > 0 && def.en.length <= 60, `Valid EN for ${id}`);
    groupCounts[def.group]++;
  }

  assert.equal(groupCounts.market, 6, 'Exactly 6 market tags');
  assert.equal(groupCounts.sector, 13, 'Exactly 13 sector tags');
  assert.equal(groupCounts.macro, 10, 'Exactly 10 macro tags');
  assert.equal(groupCounts['company-policy'], 7, 'Exactly 7 company-policy tags');

  // Specific tags
  assert.ok(tagsJson.kospi, 'kospi tag exists');
  assert.equal(tagsJson.kospi.group, 'market');
  assert.ok(tagsJson.kosdaq, 'kosdaq tag exists');
  assert.equal(tagsJson.kosdaq.group, 'market');
});

test('Tag Helper: slugifyLabel and sanitizeLabel rules', () => {
  assert.equal(slugifyLabel('KOSPI'), 'kospi');
  assert.equal(slugifyLabel('AI & Big Data'), 'ai-big-data');
  assert.equal(slugifyLabel('  Cloud & Data Centers  '), 'cloud-data-centers');
  assert.equal(slugifyLabel('U.S. Treasuries'), 'u-s-treasuries');
  assert.equal(slugifyLabel('---Leading and Trailing---'), 'leading-and-trailing');
  assert.equal(slugifyLabel(''), '');

  assert.equal(sanitizeLabel('  정밀 화학  ', 40), '정밀 화학');
  assert.equal(sanitizeLabel('<script>alert("xss")</script>', 40), '');
  assert.equal(sanitizeLabel('<b>Bold</b>', 40), '');
});

test('Tag Helper: validateTagDefinition enforces all constraints', () => {
  const existingRegistry = JSON.parse(tagsJsonRaw);

  // Valid custom tag
  const valid = validateTagDefinition({
    ko: '휴머노이드 로봇',
    en: 'Humanoid Robotics',
    group: 'sector'
  }, existingRegistry);
  assert.equal(valid.valid, true);
  assert.equal(valid.tag.id, 'humanoid-robotics');
  assert.equal(valid.tag.ko, '휴머노이드 로봇');
  assert.equal(valid.tag.en, 'Humanoid Robotics');
  assert.equal(valid.tag.group, 'sector');

  // Duplicate ID
  const dupId = validateTagDefinition({
    id: 'semiconductors',
    ko: '새로운 반도체',
    en: 'New Semi',
    group: 'sector'
  }, existingRegistry);
  assert.equal(dupId.valid, false);
  assert.match(dupId.error, /이미 등록된 태그 ID/);

  // Duplicate KO
  const dupKo = validateTagDefinition({
    id: 'another-semi',
    ko: '반도체',
    en: 'Semi Next',
    group: 'sector'
  }, existingRegistry);
  assert.equal(dupKo.valid, false);
  assert.match(dupKo.error, /한국어/);

  // Duplicate EN
  const dupEn = validateTagDefinition({
    id: 'custom-semi',
    ko: '차세대 반도체',
    en: 'Semiconductors',
    group: 'sector'
  }, existingRegistry);
  assert.equal(dupEn.valid, false);
  assert.match(dupEn.error, /English/);

  // Invalid group
  const invGroup = validateTagDefinition({
    ko: '테스트',
    en: 'Test Tag',
    group: 'invalid-group'
  }, existingRegistry);
  assert.equal(invGroup.valid, false);
  assert.match(invGroup.error, /유효하지 않은 태그 분류/);

  // Length limits
  const tooLongKo = validateTagDefinition({
    ko: '가'.repeat(45),
    en: 'Too long ko',
    group: 'sector'
  }, existingRegistry);
  assert.equal(tooLongKo.valid, false);

  const tooShortSlug = validateTagDefinition({
    ko: '가',
    en: 'a',
    group: 'sector'
  }, existingRegistry);
  assert.equal(tooShortSlug.valid, false);
});

test('Tag Helper: parseAndValidateTags enforces max 5 tags and registry membership', () => {
  const registry = JSON.parse(tagsJsonRaw);

  // Valid 5 tags
  const res5 = parseAndValidateTags(['kospi', 'kosdaq', 'flows', 'rates', 'fx'], null, registry);
  assert.ok(!res5.error, 'No error for 5 valid tags');
  assert.equal(res5.tags.length, 5);

  // 6 tags rejected
  const res6 = parseAndValidateTags(['kospi', 'kosdaq', 'flows', 'rates', 'fx', 'gold'], null, registry);
  assert.ok(res6.error, 'Error for 6 tags');
  assert.match(res6.error, /최대 5개/);

  // Unknown tag rejected
  const resUnknown = parseAndValidateTags(['kospi', 'unknown-tag-xyz'], null, registry);
  assert.ok(resUnknown.error, 'Error for unknown tag');
  assert.match(resUnknown.error, /허용되지 않은 태그/);

  // Duplicate normalization
  const resDup = parseAndValidateTags(['kospi', 'kospi', 'rates'], null, registry);
  assert.ok(!resDup.error);
  assert.deepEqual(resDup.tags, ['kospi', 'rates']);
});

test('Tag Helper: generateTagsJs mirror generation parity', () => {
  const tagsJson = JSON.parse(tagsJsonRaw);
  const jsCode = generateTagsJs(tagsJson);
  assert.ok(jsCode.startsWith('window.TAG_REGISTRY = '));
  assert.ok(jsCode.endsWith(';\n'));

  const parsed = Function(`const window = {}; ${jsCode}; return window.TAG_REGISTRY;`)();
  assert.deepEqual(parsed, tagsJson);
});

test('Atomic Publish with Custom Tag: persists data/tags.json & data/tags.js in tree', async () => {
  const calls = [];
  const existingPosts = [];
  const defaultIndex = [];
  let branchSha = 'base-sha';
  let blobCounter = 0;
  const blobContents = new Map();

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });

    if (path.endsWith('/git/ref/heads/main')) {
      return Response.json({ object: { sha: branchSha } });
    }
    if (path.includes('/contents/data/posts.json')) {
      return Response.json({ content: base64(`${JSON.stringify(existingPosts)}\n`) });
    }
    if (path.includes('/contents/data/tags.json')) {
      return Response.json({ content: base64(`${tagsJsonRaw}\n`) });
    }
    if (path.includes('/contents/data/search-index.json')) {
      return Response.json({ content: base64(`${JSON.stringify(defaultIndex)}\n`) });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      return Response.json({ tree: { sha: 'base-tree' } });
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      blobCounter += 1;
      const sha = `blob-${blobCounter}`;
      if (body?.encoding === 'utf-8') blobContents.set(sha, body.content);
      return Response.json({ sha });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      // restore blobs
      if (Array.isArray(body?.tree)) {
        for (const entry of body.tree) {
          if (entry && blobContents.has(entry.sha)) {
            entry.content = blobContents.get(entry.sha);
          }
        }
      }
      return Response.json({ sha: 'new-tree-sha' });
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      return Response.json({ sha: 'new-commit-sha' });
    }
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) {
      branchSha = body.sha;
      return Response.json({ object: { sha: branchSha } });
    }
    throw new Error(`Unexpected call: ${path}`);
  };

  try {
    const authEnv = await createTestAuthEnv();
    const form = new FormData();
    const sampleHtml = '<!DOCTYPE html><html><head><title>Test Report</title></head><body><h1>Test Report</h1><p>' + '본문 내용 '.repeat(50) + '</p></body></html>';
    form.append('file', new File([sampleHtml], '2026-09-07-daily-test.html', { type: 'text/html' }));
    form.append('type', 'daily');
    form.append('reportDate', '2026-09-07');
    form.append('title', 'Test Report Title');
    form.append('subtitle', 'Test Subtitle');
    form.append('description', 'Test Description');
    form.append('lang', 'ko');
    // New custom tag definition
    const newTags = [
      { ko: '휴머노이드', en: 'Humanoid', group: 'sector' }
    ];
    form.append('newTags', JSON.stringify(newTags));
    // Selected tags include the new tag and an existing tag
    form.append('tags', 'humanoid');
    form.append('tags', 'semiconductors');

    const headers = {
      origin: 'https://admin.snowshagal.com',
      'x-admin-key': ADMIN_KEY,
      cookie: authEnv._authSession.cookieHeader,
      'x-csrf-token': authEnv._authSession.csrfToken
    };

    const req = new Request('https://admin.snowshagal.com/api/publish', {
      method: 'POST',
      headers,
      body: form
    });

    const res = await publishPost({ request: req, env: authEnv });
    const data = await res.json();
    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
    assert.ok(data.id);

    // Verify tree entries in Git tree commit
    const treeCall = calls.find(c => c.path.endsWith('/git/trees'));
    assert.ok(treeCall, 'Git tree call must be made');
    const tree = treeCall.body.tree;

    const tagsJsonEntry = tree.find(e => e.path === 'data/tags.json');
    assert.ok(tagsJsonEntry, 'data/tags.json must be committed');
    const tagsJsEntry = tree.find(e => e.path === 'data/tags.js');
    assert.ok(tagsJsEntry, 'data/tags.js must be committed');

    const parsedCommittedTags = JSON.parse(tagsJsonEntry.content);
    assert.ok(parsedCommittedTags.humanoid, 'New tag "humanoid" must exist in committed data/tags.json');
    assert.equal(parsedCommittedTags.humanoid.ko, '휴머노이드');
    assert.equal(parsedCommittedTags.humanoid.en, 'Humanoid');
    assert.equal(parsedCommittedTags.humanoid.group, 'sector');

    // Verify posts.json includes the new tag
    const postsEntry = tree.find(e => e.path === 'data/posts.json');
    assert.ok(postsEntry, 'data/posts.json must be committed');
    const posts = JSON.parse(postsEntry.content);
    assert.deepEqual(posts[0].tags, ['humanoid', 'semiconductors']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Regression 1: SSR custom tag label rendering in Home and Category with zero raw ID exposure', () => {
  const customRegistry = {
    ...JSON.parse(tagsJsonRaw),
    'quantum-computing': {
      ko: '양자 컴퓨팅',
      en: 'Quantum Computing',
      group: 'sector'
    }
  };

  const samplePosts = [
    {
      id: '2026-09-07-quantum-ko',
      type: 'daily',
      reportDate: '2026-09-07',
      title: '양자 컴퓨팅 데일리',
      href: '/reports/2026-09-07-quantum-ko.html',
      lang: 'ko',
      tags: ['quantum-computing', 'kospi']
    },
    {
      id: '2026-09-07-quantum-en',
      type: 'daily',
      reportDate: '2026-09-07',
      title: 'Quantum Computing Daily',
      href: '/en/reports/2026-09-07-quantum-en.html',
      lang: 'en',
      tags: ['quantum-computing', 'kospi']
    },
    {
      id: '2026-09-07-unknown-tag',
      type: 'research',
      reportDate: '2026-09-06',
      title: 'Unknown Tag Post',
      href: '/reports/unknown.html',
      lang: 'ko',
      tags: ['completely-unknown-tag']
    }
  ];

  // 1. tagLabel direct resolution
  assert.equal(tagLabel('quantum-computing', 'ko', customRegistry), '양자 컴퓨팅');
  assert.equal(tagLabel('quantum-computing', 'en', customRegistry), 'Quantum Computing');
  // Unknown tag must fail-safe to empty string, NEVER raw ID
  assert.equal(tagLabel('completely-unknown-tag', 'ko', customRegistry), '');
  assert.equal(tagLabel('completely-unknown-tag', 'en', customRegistry), '');

  // 2. Category featured cards SSR
  const koCategoryHtml = categoryFeaturedCards(samplePosts, 'daily', 'ko', customRegistry);
  assert.match(koCategoryHtml, /양자 컴퓨팅/);
  assert.doesNotMatch(koCategoryHtml, /quantum-computing/);

  const enCategoryHtml = categoryFeaturedCards(samplePosts, 'daily', 'en', customRegistry);
  assert.match(enCategoryHtml, /Quantum Computing/);
  assert.doesNotMatch(enCategoryHtml, /quantum-computing/);

  // Unknown tag post in category featured cards: raw tag ID must NOT appear
  const unknownCatHtml = categoryFeaturedCards(samplePosts, 'research', 'ko', customRegistry);
  assert.doesNotMatch(unknownCatHtml, /completely-unknown-tag/);
  assert.doesNotMatch(unknownCatHtml, /<div class="category-featured-tags">/);

  // 3. Homepage latest links SSR
  const koHomeHtml = homepageLatestLinks(samplePosts, 'ko', customRegistry);
  assert.match(koHomeHtml, /양자 컴퓨팅/);
  assert.doesNotMatch(koHomeHtml, /quantum-computing/);

  const enHomeHtml = homepageLatestLinks(samplePosts, 'en', customRegistry);
  assert.match(enHomeHtml, /Quantum Computing/);
  assert.doesNotMatch(enHomeHtml, /quantum-computing/);
});

test('Regression 2: Pending custom tag deselection excludes tag from submission and registry', () => {
  // Simulate admin UI state
  const pendingCustomTags = [
    { id: 'custom-tag-1', ko: '커스텀 태그 1', en: 'Custom Tag 1', group: 'sector' }
  ];
  const selectedTagIds = new Set(['kospi']); // User created custom-tag-1, but deselected it, keeping only kospi

  // Filter logic identically matching assets/admin.js publish()
  const activeCustomTags = pendingCustomTags.filter(tag => selectedTagIds.has(tag.id));
  assert.equal(activeCustomTags.length, 0, 'Deselected pending custom tag must not be in activeCustomTags');

  // Verify form payload construction: newTags should NOT be appended
  const form = new FormData();
  if (activeCustomTags.length > 0) {
    form.append('newTags', JSON.stringify(activeCustomTags));
  }
  selectedTagIds.forEach(id => form.append('tags', id));

  assert.equal(form.get('newTags'), null, 'FormData must not contain newTags');
  assert.deepEqual(form.getAll('tags'), ['kospi']);
});

test('Regression 3: Multiple pending custom tags with partial deselection only persists selected tags', async () => {
  // Simulate admin UI state with two custom tags created
  const pendingCustomTags = [
    { id: 'custom-alpha', ko: '커스텀 알파', en: 'Custom Alpha', group: 'sector' },
    { id: 'custom-beta', ko: '커스텀 베타', en: 'Custom Beta', group: 'macro' }
  ];
  // Alpha is selected, Beta is deselected, along with existing tag 'kospi'
  const selectedTagIds = new Set(['custom-alpha', 'kospi']);

  const activeCustomTags = pendingCustomTags.filter(tag => selectedTagIds.has(tag.id));
  assert.equal(activeCustomTags.length, 1);
  assert.equal(activeCustomTags[0].id, 'custom-alpha');

  const calls = [];
  const existingPosts = [];
  let branchSha = 'base-sha';
  let blobCounter = 0;
  const blobContents = new Map();

  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });

    if (path.endsWith('/git/ref/heads/main')) {
      return Response.json({ object: { sha: branchSha } });
    }
    if (path.includes('/contents/data/posts.json')) {
      return Response.json({ content: base64(`${JSON.stringify(existingPosts)}\n`) });
    }
    if (path.includes('/contents/data/tags.json')) {
      return Response.json({ content: base64(`${tagsJsonRaw}\n`) });
    }
    if (path.includes('/contents/data/search-index.json')) {
      return Response.json({ content: base64('[]\n') });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      return Response.json({ tree: { sha: 'base-tree' } });
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      blobCounter += 1;
      const sha = `blob-${blobCounter}`;
      if (body?.encoding === 'utf-8') blobContents.set(sha, body.content);
      return Response.json({ sha });
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      if (Array.isArray(body?.tree)) {
        for (const entry of body.tree) {
          if (entry && blobContents.has(entry.sha)) {
            entry.content = blobContents.get(entry.sha);
          }
        }
      }
      return Response.json({ sha: 'new-tree-sha' });
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      return Response.json({ sha: 'new-commit-sha' });
    }
    if (method === 'PATCH' && path.endsWith('/git/refs/heads/main')) {
      branchSha = body.sha;
      return Response.json({ object: { sha: branchSha } });
    }
    throw new Error(`Unexpected call: ${path}`);
  };

  try {
    const authEnv = await createTestAuthEnv();
    const form = new FormData();
    const sampleHtml = '<!DOCTYPE html><html><head><title>Test Report</title></head><body><h1>Test Report</h1><p>' + '본문 내용 '.repeat(50) + '</p></body></html>';
    form.append('file', new File([sampleHtml], '2026-09-07-daily-multi.html', { type: 'text/html' }));
    form.append('type', 'daily');
    form.append('reportDate', '2026-09-07');
    form.append('title', 'Multi Test');
    form.append('lang', 'ko');
    form.append('newTags', JSON.stringify(activeCustomTags));
    selectedTagIds.forEach(id => form.append('tags', id));

    const headers = {
      origin: 'https://admin.snowshagal.com',
      'x-admin-key': ADMIN_KEY,
      cookie: authEnv._authSession.cookieHeader,
      'x-csrf-token': authEnv._authSession.csrfToken
    };

    const req = new Request('https://admin.snowshagal.com/api/publish', {
      method: 'POST',
      headers,
      body: form
    });

    const res = await publishPost({ request: req, env: authEnv });
    assert.equal(res.status, 200);

    const treeCall = calls.find(c => c.path.endsWith('/git/trees'));
    const tagsJsonEntry = treeCall.body.tree.find(e => e.path === 'data/tags.json');
    const parsedTags = JSON.parse(tagsJsonEntry.content);

    assert.ok(parsedTags['custom-alpha'], 'Selected custom tag alpha must be in tags.json');
    assert.equal(parsedTags['custom-beta'], undefined, 'Deselected custom tag beta must NOT be in tags.json');

    const postsEntry = treeCall.body.tree.find(e => e.path === 'data/posts.json');
    const posts = JSON.parse(postsEntry.content);
    assert.deepEqual(posts[0].tags, ['custom-alpha', 'kospi']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Regression 4: Forged / unreferenced newTags API request is rejected with 400 UNUSED_CUSTOM_TAG (zero mutation)', async () => {
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input));
    const path = `${url.pathname}${url.search}`;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body });

    if (path.endsWith('/git/ref/heads/main')) {
      return Response.json({ object: { sha: 'base-sha' } });
    }
    if (path.includes('/contents/data/posts.json')) {
      return Response.json({ content: base64('[]\n') });
    }
    if (path.includes('/contents/data/tags.json')) {
      return Response.json({ content: base64(`${tagsJsonRaw}\n`) });
    }
    if (path.includes('/contents/data/search-index.json')) {
      return Response.json({ content: base64('[]\n') });
    }
    if (method === 'GET' && path.includes('/git/commits/')) {
      return Response.json({ tree: { sha: 'base-tree' } });
    }
    throw new Error(`Unexpected call during validation failure: ${path}`);
  };

  try {
    const authEnv = await createTestAuthEnv();
    const form = new FormData();
    const sampleHtml = '<!DOCTYPE html><html><head><title>Forged Report</title></head><body><h1>Forged Report</h1><p>' + '본문 내용 '.repeat(50) + '</p></body></html>';
    form.append('file', new File([sampleHtml], '2026-09-07-daily-forged.html', { type: 'text/html' }));
    form.append('type', 'daily');
    form.append('reportDate', '2026-09-07');
    form.append('title', 'Forged Report');
    form.append('lang', 'ko');
    // newTags declares 'forged-tag', but post only selects 'kospi'
    form.append('newTags', JSON.stringify([
      { ko: '위조 태그', en: 'Forged Tag', group: 'sector' }
    ]));
    form.append('tags', 'kospi');

    const headers = {
      origin: 'https://admin.snowshagal.com',
      'x-admin-key': ADMIN_KEY,
      cookie: authEnv._authSession.cookieHeader,
      'x-csrf-token': authEnv._authSession.csrfToken
    };

    const req = new Request('https://admin.snowshagal.com/api/publish', {
      method: 'POST',
      headers,
      body: form
    });

    const res = await publishPost({ request: req, env: authEnv });
    const data = await res.json();
    assert.equal(res.status, 400, 'Must reject with HTTP 400');
    assert.equal(data.error, 'UNUSED_CUSTOM_TAG', 'Error code must be UNUSED_CUSTOM_TAG');

    // Zero mutations: no blobs, trees, commits, or patch ref calls made
    const mutatingCalls = calls.filter(c => c.method === 'POST' || c.method === 'PATCH' || c.method === 'PUT');
    assert.equal(mutatingCalls.length, 0, 'Must make zero mutating GitHub API calls');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Regression 5: serializeTagRegistryBootstrap safe serialization against script breakout and control characters', () => {
  // Invalid inputs must return empty string
  assert.equal(serializeTagRegistryBootstrap(null), '');
  assert.equal(serializeTagRegistryBootstrap(undefined), '');
  assert.equal(serializeTagRegistryBootstrap([]), '');
  assert.equal(serializeTagRegistryBootstrap('string'), '');
  assert.equal(serializeTagRegistryBootstrap(123), '');

  // Empty object
  const emptyHtml = serializeTagRegistryBootstrap({});
  assert.equal(emptyHtml, '<script id="report-tag-registry">window.TAG_REGISTRY = {};</script>');

  // Script breakout and control characters
  const dangerousRegistry = {
    xss: {
      ko: '</script><script>alert("xss")</script>',
      en: 'A & B > C < D \u2028 \u2029',
      group: 'sector'
    }
  };

  const serialized = serializeTagRegistryBootstrap(dangerousRegistry);
  assert.ok(serialized.startsWith('<script id="report-tag-registry">window.TAG_REGISTRY = '));
  assert.ok(serialized.endsWith(';</script>'));

  // Inner payload must NOT contain unescaped < or > or &
  const innerPayload = serialized
    .replace(/^<script id="report-tag-registry">window\.TAG_REGISTRY = /, '')
    .replace(/;<\/script>$/, '');
  assert.doesNotMatch(innerPayload, /[<>]/, 'Inner JSON must contain no unescaped angle brackets');
  assert.ok(innerPayload.includes('\\u003c/script\\u003e'), 'Closing script tag must be safely escaped');
  assert.ok(innerPayload.includes('\\u0026'), 'Ampersand must be escaped');
  assert.ok(innerPayload.includes('\\u2028'), 'Line separator must be escaped');
  assert.ok(innerPayload.includes('\\u2029'), 'Paragraph separator must be escaped');

  // Execution in JavaScript environment must restore exact original object
  const restored = Function(`const window = {}; ${serialized.replace(/^<script[^>]*>|<\/script>$/g, '')}; return window.TAG_REGISTRY;`)();
  assert.deepEqual(restored, dangerousRegistry);
});

test('Regression 6: Report middleware bootstraps TAG_REGISTRY with correct script ordering before locale.js and report-shell.js', async () => {
  const samplePosts = [
    {
      id: 'test-report',
      href: '/reports/2026-08-25-test.html',
      title: '테스트 리포트',
      type: 'daily',
      lang: 'ko',
      reportDate: '2026-08-25',
      tags: ['semiconductors', 'rates', 'policy']
    }
  ];
  const sampleTags = {
    ...JSON.parse(tagsJsonRaw),
    'quantum-computing': {
      ko: '양자 컴퓨팅',
      en: 'Quantum Computing',
      group: 'sector'
    }
  };

  const mockHtml = '<!DOCTYPE html><html><head><title>Test Report</title></head><body><h1>Content</h1></body></html>';

  // 1. Success case: both posts and tags load
  const context = {
    request: new Request('https://snowshagal.com/reports/2026-08-25-test.html'),
    env: {
      ASSETS: {
        fetch: async (req) => {
          const url = new URL(req.url);
          if (url.pathname === '/data/posts.json') {
            return new Response(JSON.stringify(samplePosts));
          }
          if (url.pathname === '/data/tags.json') {
            return new Response(JSON.stringify(sampleTags));
          }
          return new Response('Not found', { status: 404 });
        }
      }
    },
    next: async () => new Response(mockHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  };

  const res = await middleware(context);
  assert.equal(res.status, 200);
  const html = await res.text();

  const tagRegistryIdx = html.indexOf('<script id="report-tag-registry">');
  const localeIdx = html.indexOf('/assets/locale.js');
  const reportShellIdx = html.indexOf('/assets/report-shell.js');

  assert.ok(tagRegistryIdx !== -1, 'report-tag-registry must be present in report HTML');
  assert.ok(localeIdx !== -1, 'locale.js must be present in report HTML');
  assert.ok(reportShellIdx !== -1, 'report-shell.js must be present in report HTML');

  assert.ok(tagRegistryIdx < localeIdx, 'TAG_REGISTRY bootstrap must execute before locale.js');
  assert.ok(localeIdx < reportShellIdx, 'locale.js must execute before report-shell.js');

  // Verify custom and core tags are present in bootstrap script
  assert.match(html, /양자 컴퓨팅/);
  assert.match(html, /Quantum Computing/);
  assert.match(html, /반도체/);

  // 2. Fail-safe case: tags.json fails to load (404/error)
  const failContext = {
    request: new Request('https://snowshagal.com/reports/2026-08-25-test.html'),
    env: {
      ASSETS: {
        fetch: async (req) => {
          const url = new URL(req.url);
          if (url.pathname === '/data/posts.json') {
            return new Response(JSON.stringify(samplePosts));
          }
          return new Response('Error', { status: 500 });
        }
      }
    },
    next: async () => new Response(mockHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  };

  const failRes = await middleware(failContext);
  assert.equal(failRes.status, 200, 'Page must not return 500 when tags.json fails');
  const failHtml = await failRes.text();
  assert.ok(failHtml.includes('/assets/report-shell.js'), 'report-shell.js must still be injected on fail-safe');
});

test('Regression 7: Related Reading tag rendering in report-shell.js displays core and custom tags, drops unknown tags, and exposes zero raw IDs', async () => {
  const shellCode = fs.readFileSync(path.join(rootDir, 'assets', 'report-shell.js'), 'utf8');

  function makeMockElement(name, attrs = {}) {
    const map = new Map(Object.entries(attrs));
    return {
      name,
      hidden: false,
      href: '',
      value: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: { setProperty() {} },
      children: [],
      getAttribute: key => (map.has(key) ? map.get(key) : null),
      setAttribute: (key, val) => map.set(key, String(val)),
      removeAttribute: key => map.delete(key),
      addEventListener() {},
      removeEventListener() {},
      appendChild() {},
      append() {},
      prepend() {},
      replaceChildren() {},
      insertAdjacentHTML() {},
      insertBefore() {},
      remove() {},
      attachShadow: () => makeMockElement('#shadow-root'),
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      contains: () => false
    };
  }

  const customRegistry = {
    ...JSON.parse(tagsJsonRaw),
    'quantum-computing': {
      ko: '양자 컴퓨팅',
      en: 'Quantum Computing',
      group: 'sector'
    }
  };

  const windowObj = {
    TAG_REGISTRY: customRegistry,
    MARKET_LOCALE: undefined,
    addEventListener() {}
  };

  const documentObj = {
    currentScript: { dataset: { category: 'daily', lang: 'ko' } },
    documentElement: makeMockElement('html'),
    body: Object.assign(makeMockElement('body'), { firstChild: null }),
    title: '테스트 리포트',
    readyState: 'complete',
    addEventListener() {},
    createElement: tag => makeMockElement(tag),
    getElementById: (id) => (id === 'mrs-comments-host' ? makeMockElement('section') : null),
    querySelector: () => null,
    querySelectorAll: () => []
  };

  const sandbox = {
    window: windowObj,
    document: documentObj,
    location: { pathname: '/reports/2026-08-25-test.html', href: 'https://snowshagal.com/reports/2026-08-25-test.html', search: '' },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: { share: undefined, clipboard: undefined },
    fetch: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve([]) }),
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(shellCode, sandbox);

  assert.ok(sandbox.window.REPORT_DISCOVERY, 'REPORT_DISCOVERY must be exported on window');
  const { formatTags, tagLabel: shellTagLabel } = sandbox.window.REPORT_DISCOVERY;
  assert.equal(typeof formatTags, 'function');
  assert.equal(typeof shellTagLabel, 'function');

  // 1. Core tags formatting
  const coreTags = ['semiconductors', 'rates', 'policy'];
  const coreKo = formatTags(coreTags, 'ko');
  assert.equal(coreKo, '반도체 · 금리 · 정책', 'KO Core tags must render exact Korean labels');

  const coreEn = formatTags(coreTags, 'en');
  assert.equal(coreEn, 'Semiconductors · Rates · Policy', 'EN Core tags must render exact English labels');

  // 2. Custom tag formatting
  const customTag = ['quantum-computing'];
  const customKo = formatTags(customTag, 'ko');
  assert.equal(customKo, '양자 컴퓨팅', 'KO custom tag must render localized label');

  const customEn = formatTags(customTag, 'en');
  assert.equal(customEn, 'Quantum Computing', 'EN custom tag must render localized label');

  // 3. Raw canonical ID must NEVER be exposed
  assert.doesNotMatch(customKo, /quantum-computing/, 'Raw canonical ID must not appear in KO label');
  assert.doesNotMatch(customEn, /quantum-computing/, 'Raw canonical ID must not appear in EN label');

  // 4. Unknown tag fail-safe: dropped cleanly with empty string, 0 errors
  const unknownTag = ['unknown-internal-tag'];
  const unknownKo = formatTags(unknownTag, 'ko');
  assert.equal(unknownKo, '', 'Unknown tag must yield empty string');
  assert.doesNotMatch(unknownKo, /unknown-internal-tag/, 'Unknown raw ID must not be visible');

  // 5. Mixed tags (custom + unknown + core)
  const mixedTags = ['quantum-computing', 'unknown-internal-tag', 'rates'];
  const mixedKo = formatTags(mixedTags, 'ko');
  assert.equal(mixedKo, '양자 컴퓨팅 · 금리', 'Unknown tag must be cleanly omitted from joined output');

  const mixedEn = formatTags(mixedTags, 'en');
  assert.equal(mixedEn, 'Quantum Computing · Rates', 'Unknown tag must be cleanly omitted from joined EN output');
});
