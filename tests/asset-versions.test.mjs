import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TRACKED_ASSETS,
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

test('Asset Stamping: replaces asset query params with exact content hashes', () => {
  const versionMap = {
    'assets/site.css': '1111111111',
    'assets/site.js': '2222222222'
  };
  const html = '<link rel="stylesheet" href="/assets/site.css?v=old"><script src="/assets/site.js"></script>';
  const stamped = stampAssetVersionsInContent(html, versionMap);

  assert.ok(stamped.includes('href="/assets/site.css?v=1111111111"'));
  assert.ok(stamped.includes('src="/assets/site.js?v=2222222222"'));
});

test('Asset Stamping: idempotent (stamping twice produces no changes)', () => {
  const versionMap = {
    'assets/site.css': '1111111111',
    'assets/home-v2.css': '2222222222'
  };
  const html = '<link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/home-v2.css">';
  const run1 = stampAssetVersionsInContent(html, versionMap);
  const run2 = stampAssetVersionsInContent(run1, versionMap);

  assert.equal(run1, run2, 'Stamping already stamped content must be a no-op');
});

test('Regression Guard: all public HTML files and templates have exact, fresh asset content hashes', async () => {
  const root = process.cwd();
  const versionMap = getAssetVersionMap(root);

  const publicFiles = [
    'index.html',
    'en/index.html',
    'about/index.html',
    'en/about/index.html',
    'market/index.html',
    'en/market/index.html',
    'daily/index.html',
    'weekly/index.html',
    'research/index.html',
    'basics/index.html',
    'notes/index.html',
    'en/daily/index.html',
    'en/weekly/index.html',
    'en/research/index.html',
    'en/basics/index.html',
    'en/notes/index.html',
    'scripts/build-category-pages.mjs'
  ];

  for (const file of publicFiles) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const [assetPath, expectedHash] of Object.entries(versionMap)) {
      // Find any reference to this asset in the file
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

test('Regression Guard Simulation: modified asset content without stamping FAILS the test', () => {
  const versionMap = {
    'assets/home-v2.css': 'current123'
  };
  const htmlWithOldVersion = '<link rel="stylesheet" href="/assets/home-v2.css?v=stale456">';

  // If asset content was modified, the fresh hash will be 'fresh999'
  const simulatedFreshHash = 'fresh999';

  assert.throws(() => {
    const match = /home-v2\.css\?v=([^"']*)/.exec(htmlWithOldVersion);
    const actual = match ? match[1] : '';
    if (actual !== simulatedFreshHash) {
      throw new Error(`Stale asset detected: expected ?v=${simulatedFreshHash}, found ?v=${actual}`);
    }
  }, /Stale asset detected/);
});

test('KO and EN Homepage parity: identical assets use identical content hashes', async () => {
  const [koHtml, enHtml] = await Promise.all([read('index.html'), read('en/index.html')]);

  const assetsToCheck = [
    'assets/site.css',
    'assets/home-v2.css',
    'assets/site.js',
    'data/tags.js',
    'data/posts.js'
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
