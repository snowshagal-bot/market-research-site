import fs from 'node:fs';
import path from 'node:path';
import {
  STAMP_TARGETS,
  getAssetVersionMap,
  stampAssetVersionsInContent
} from './asset-versions.mjs';
import { syncStaticFooters } from './sync-static-footers.mjs';

const root = process.cwd();
const versionMap = getAssetVersionMap(root);

console.log('--- Current Tracked Asset Content Hashes ---');
for (const [relPath, hash] of Object.entries(versionMap)) {
  console.log(`  ${relPath}: ${hash}`);
}

let changedCount = 0;

// Filter out category landing pages from direct static files since they are generated
const STATIC_TARGETS = STAMP_TARGETS.filter((t) =>
  !t.endsWith('daily/index.html') &&
  !t.endsWith('weekly/index.html') &&
  !t.endsWith('research/index.html') &&
  !t.endsWith('basics/index.html') &&
  !t.endsWith('notes/index.html')
);

syncStaticFooters(root);

for (const relPath of STATIC_TARGETS) {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing stamp target file on disk: ${relPath}`);
  }
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

// Run build-category-pages.mjs to generate 10 category pages with stamped templates
const buildCategoryPagesPath = path.join(root, 'scripts', 'build-category-pages.mjs');
if (fs.existsSync(buildCategoryPagesPath)) {
  await import(`file:///${buildCategoryPagesPath.replace(/\\/g, '/')}`);
  console.log('Rebuilt category landing pages.');
}

console.log(`Done stamping asset versions. (${changedCount} static files modified)`);
