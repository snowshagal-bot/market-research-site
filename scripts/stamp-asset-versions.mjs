import fs from 'node:fs';
import path from 'node:path';
import { getAssetVersionMap, stampAssetVersionsInContent } from './asset-versions.mjs';

const root = process.cwd();
const versionMap = getAssetVersionMap(root);

console.log('--- Current Asset Content Hashes ---');
for (const [relPath, hash] of Object.entries(versionMap)) {
  console.log(`  ${relPath}: ${hash}`);
}

// 1. Files to directly stamp
const STATIC_FILES_TO_STAMP = [
  'index.html',
  'en/index.html',
  'about/index.html',
  'en/about/index.html',
  'market/index.html',
  'en/market/index.html',
  'admin/index.html',
  'admin/manage/index.html',
  'admin/market/index.html',
  'admin/analytics/index.html',
  'functions/_middleware.js',
  'scripts/build-category-pages.mjs'
];

let changedCount = 0;

for (const relPath of STATIC_FILES_TO_STAMP) {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) continue;
  const original = fs.readFileSync(fullPath, 'utf8');
  const stamped = stampAssetVersionsInContent(original, versionMap);
  if (original !== stamped) {
    fs.writeFileSync(fullPath, stamped, 'utf8');
    console.log(`Updated: ${relPath}`);
    changedCount++;
  } else {
    console.log(`Unchanged: ${relPath}`);
  }
}

// 2. Run build-category-pages.mjs to generate 10 category pages with stamped templates
const buildCategoryPagesPath = path.join(root, 'scripts', 'build-category-pages.mjs');
if (fs.existsSync(buildCategoryPagesPath)) {
  await import(`file:///${buildCategoryPagesPath.replace(/\\/g, '/')}`);
  console.log('Rebuilt category landing pages.');
}

console.log(`Done stamping asset versions. (${changedCount} static files modified)`);
