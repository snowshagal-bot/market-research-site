import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TRACKED_ASSETS,
  DYNAMIC_DATA_ASSETS,
  STAMP_TARGETS,
  computeAssetFileHash,
  computeContentHash,
  getAssetVersionMap,
  stampAssetVersionsInContent
} from '../scripts/asset-versions.mjs';

const read = (relPath) => readFile(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('Asset Hashing: deterministic and normalizes CRLF/LF', () => {
  const contentLF = '.test { color: red; }\n';
  const contentCRLF = '.test { color: red; }\r\n';

  const hashLF = computeContentHash(contentLF);
  const hashCRLF = computeContentHash(contentCRLF);

  assert.equal(hashLF.length, 10);
  assert.equal(hashLF, hashCRLF, 'CRLF and LF must produce identical content hashes');
});

test('Asset Hashing: content change produces different hash', () => {
  const hashA = computeContentHash('.btn { padding: 4px; }');
  const hashB = computeContentHash('.btn { padding: 5px; }');

  assert.notEqual(hashA, hashB, 'Different content must produce different hashes');
});

test('Fail-Closed: computeAssetFileHash throws if tracked asset is missing on disk', () => {
  assert.throws(() => {
    computeAssetFileHash(process.cwd(), 'assets/non-existent-file-xyz.css');
  }, /Missing tracked asset on disk/);
});

test('Asset Stamping: replaces tracked asset query params and strips dynamic data queries', () => {
  const versionMap = {
    'assets/site.css': '1111111111',
    'assets/site.js': '2222222222'
  };
  const html = '<link rel="stylesheet" href="/assets/site.css?v=old"><script src="/assets/site.js"></script><script src="/data/posts.js?v=20260824-1"></script>';
  const stamped = stampAssetVersionsInContent(html, versionMap);

  assert.ok(stamped.includes('href="/assets/site.css?v=1111111111"'));
  assert.ok(stamped.includes('src="/assets/site.js?v=2222222222"'));
  assert.ok(stamped.includes('src="/data/posts.js"'));
  assert.ok(!stamped.includes('/data/posts.js?v='));
});

test('Asset Stamping: idempotent (stamping twice produces no changes)', () => {
  const versionMap = {
    'assets/site.css': '1111111111',
    'assets/home-v2.css': '2222222222'
  };
  const html = '<link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/home-v2.css"><script src="/data/posts.js?v=old"></script>';
  const run1 = stampAssetVersionsInContent(html, versionMap);
  const run2 = stampAssetVersionsInContent(run1, versionMap);

  assert.equal(run1, run2, 'Stamping already stamped content must be a no-op');
});

test('Regression Guard: all STAMP_TARGETS have exact, fresh content hashes for all TRACKED_ASSETS', async () => {
  const root = process.cwd();
  const versionMap = getAssetVersionMap(root);

  for (const file of STAMP_TARGETS) {
    const fullPath = path.join(root, file);
    assert.ok(fs.existsSync(fullPath), `STAMP_TARGET file must exist on disk: ${file}`);
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const [assetPath, expectedHash] of Object.entries(versionMap)) {
      const escaped = assetPath.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:href|src)=["'](?:\\/|\\.\\.\\/)*${escaped}(?:\\?v=([^"']*))?["']`, 'g');
      let match;
      while ((match = regex.exec(content)) !== null) {
        const actualVersion = match[1];
        assert.equal(
          actualVersion,
          expectedHash,
          `Stale asset query in ${file} for ${assetPath}: expected ?v=${expectedHash}, found ?v=${actualVersion || '(none)'}`
        );
      }
    }
  }
});

test('Regression Guard: No legacy manual date-based ?v=20... queries remain in STAMP_TARGETS or assets', async () => {
  const root = process.cwd();

  const filesToCheck = [
    ...STAMP_TARGETS,
    'assets/site.js',
    'assets/category-landing.js',
    'assets/admin.js',
    'assets/admin-manage.js',
    'assets/admin-market.js',
    'assets/admin-analytics.js',
    'assets/cover-generator.js',
    'assets/share-card.js'
  ];

  for (const file of filesToCheck) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    const match = content.match(/\?v=20\d{6}(?:-\d+)?/g);
    assert.equal(
      match,
      null,
      `Legacy date-based version query found in ${file}: ${JSON.stringify(match)}`
    );
  }
});

test('Dynamic Data Separation: data/posts.js and data/market-summary.js do NOT have ?v= query params in HTML', async () => {
  const root = process.cwd();
  for (const file of STAMP_TARGETS) {
    const fullPath = path.join(root, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const dataAsset of DYNAMIC_DATA_ASSETS) {
      const escaped = dataAsset.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:href|src)=["'](?:\\/|\\.\\.\\/)*${escaped}\?v=[^"']*["']`, 'g');
      const match = content.match(regex);
      assert.equal(
        match,
        null,
        `Dynamic data asset ${dataAsset} in ${file} should not have a ?v= query: ${match}`
      );
    }
  }
});

test('Dynamic Data Separation Guard: modifying posts.js content does NOT break asset version tests', () => {
  const root = process.cwd();
  // Simulating a runtime publish modifying data/posts.js content
  const simulatedModifiedPostsContent = 'window.RESEARCH_POSTS = [{ id: "new-report-today" }];';
  const simulatedHash = computeContentHash(simulatedModifiedPostsContent);

  // Since data/posts.js is NOT in TRACKED_ASSETS, getAssetVersionMap ignores it
  const versionMap = getAssetVersionMap(root);
  assert.equal(versionMap['data/posts.js'], undefined, 'data/posts.js must not be tracked in versionMap');
  assert.equal(TRACKED_ASSETS.includes('data/posts.js'), false, 'data/posts.js must not be in TRACKED_ASSETS');
});

test('KO and EN Homepage parity: identical tracked assets use identical content hashes', async () => {
  const [koHtml, enHtml] = await Promise.all([read('index.html'), read('en/index.html')]);

  const assetsToCheck = [
    'assets/site.css',
    'assets/home-v2.css',
    'assets/site.js',
    'assets/brand.css',
    'assets/language.css',
    'data/tags.js'
  ];

  for (const asset of assetsToCheck) {
    const regex = new RegExp(`${asset.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')}\\?v=([a-f0-9]{10})`);
    const koMatch = koHtml.match(regex);
    const enMatch = enHtml.match(regex);

    assert.ok(koMatch, `${asset} must have content hash in KO homepage`);
    assert.ok(enMatch, `${asset} must have content hash in EN homepage`);
    assert.equal(koMatch[1], enMatch[1], `${asset} must have matching content hash between KO and EN`);
  }
});

test('_headers Cache-Control Guard: all dynamic search and data assets declare no-cache, no-store, must-revalidate', async () => {
  const headersContent = await read('_headers');

  for (const asset of DYNAMIC_DATA_ASSETS) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\/${escaped}\\s+Cache-Control:\\s+([^\\r\\n]+)`);
    const match = headersContent.match(regex);
    assert.ok(match, `_headers must explicitly declare Cache-Control rule for /${asset}`);
    const cacheControlValue = match[1].trim();
    assert.equal(
      cacheControlValue,
      'no-cache, no-store, must-revalidate',
      `/${asset} in _headers must be "no-cache, no-store, must-revalidate", found "${cacheControlValue}"`
    );
    assert.doesNotMatch(
      cacheControlValue,
      /max-age=\d+/,
      `/${asset} in _headers must not declare a long max-age policy`
    );
  }
});
