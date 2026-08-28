#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('================================================================');
console.log('         Snowshagal Repository Verification Gate');
console.log('================================================================\n');

function runStep(stepNum, title, fn) {
  console.log(`[${stepNum}/4] ${title}...`);
  try {
    const result = fn();
    console.log(`  ✔ ${title} passed.\n`);
    return result;
  } catch (err) {
    console.error(`\n❌ FAILED at step [${stepNum}/4]: ${title}`);
    console.error(`Error details: ${err.message}`);
    if (err.details) {
      console.error(err.details);
    }
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// [1/4] Automated tests
// -----------------------------------------------------------------------------
runStep(1, 'Running automated test suites', () => {
  const testsDir = path.join(rootDir, 'tests');
  if (!fs.existsSync(testsDir)) {
    throw new Error(`Tests directory not found: ${testsDir}`);
  }

  const testFiles = fs.readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort()
    .map((f) => path.join('tests', f));

  if (testFiles.length === 0) {
    throw new Error('No .test.mjs files found in tests/ directory');
  }

  console.log(`  Found ${testFiles.length} test suites. Executing node --test...`);
  const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    const err = new Error(`Node test runner exited with code ${result.status}`);
    throw err;
  }
});

// -----------------------------------------------------------------------------
// [2/4] JavaScript & MJS syntax validation
// -----------------------------------------------------------------------------
runStep(2, 'Validating JavaScript & MJS syntax', () => {
  const targetDirs = ['assets', 'functions', 'scripts', 'tests', 'data'];
  const jsFiles = [];

  function scan(dir) {
    const fullDirPath = path.join(rootDir, dir);
    if (!fs.existsSync(fullDirPath)) return;
    const entries = fs.readdirSync(fullDirPath, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        scan(relativePath);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        jsFiles.push(relativePath);
      }
    }
  }

  targetDirs.forEach(scan);
  jsFiles.sort();

  if (jsFiles.length === 0) {
    throw new Error('No JavaScript or MJS files found to check syntax');
  }

  console.log(`  Checking syntax for ${jsFiles.length} JavaScript/MJS files with node --check...`);

  const errors = [];
  for (const relFile of jsFiles) {
    const fullPath = path.join(rootDir, relFile);
    const res = spawnSync(process.execPath, ['--check', fullPath], {
      cwd: rootDir,
      encoding: 'utf8'
    });

    if (res.status !== 0) {
      errors.push({
        file: relFile,
        error: (res.stderr || res.stdout || 'Syntax check failed').trim()
      });
    }
  }

  if (errors.length > 0) {
    const details = errors.map((e) => `  - ${e.file}:\n    ${e.error.replace(/\n/g, '\n    ')}`).join('\n');
    const err = new Error(`Syntax validation failed for ${errors.length} file(s)`);
    err.details = details;
    throw err;
  }

  console.log(`  Checked ${jsFiles.length} files successfully.`);
});

// -----------------------------------------------------------------------------
// [3/4] Repository invariants & integrity
// -----------------------------------------------------------------------------
runStep(3, 'Checking repository invariants & generated artifact integrity', () => {
  // A. posts.json & posts.js sanity & synchronization
  const postsJsonPath = path.join(rootDir, 'data/posts.json');
  const postsJsPath = path.join(rootDir, 'data/posts.js');

  if (!fs.existsSync(postsJsonPath)) {
    throw new Error('Missing data/posts.json');
  }
  if (!fs.existsSync(postsJsPath)) {
    throw new Error('Missing data/posts.js');
  }

  let posts;
  try {
    posts = JSON.parse(fs.readFileSync(postsJsonPath, 'utf8'));
  } catch (parseErr) {
    throw new Error(`Failed to parse data/posts.json: ${parseErr.message}`);
  }

  if (!Array.isArray(posts) || posts.length === 0) {
    throw new Error('data/posts.json must be a non-empty array');
  }

  const postsJsContent = fs.readFileSync(postsJsPath, 'utf8');
  if (!postsJsContent.includes('window.RESEARCH_POSTS =')) {
    throw new Error('data/posts.js must export window.RESEARCH_POSTS');
  }

  const postsFromJs = JSON.parse(postsJsContent.replace(/^window\.RESEARCH_POSTS\s*=\s*/, '').replace(/;\s*$/, ''));
  if (JSON.stringify(posts) !== JSON.stringify(postsFromJs)) {
    throw new Error('data/posts.json and data/posts.js are not synchronized');
  }

  // B. Search index artifacts
  const searchIndexFiles = [
    'data/search-index.json',
    'data/search-index-meta.js',
    'data/search-index-body-ko.js',
    'data/search-index-body-en.js'
  ];
  for (const sFile of searchIndexFiles) {
    if (!fs.existsSync(path.join(rootDir, sFile))) {
      throw new Error(`Missing required search index artifact: ${sFile}`);
    }
  }

  // C. 10 Category landing pages presence
  const categoryLandings = [
    'daily/index.html',
    'weekly/index.html',
    'research/index.html',
    'basics/index.html',
    'notes/index.html',
    'en/daily/index.html',
    'en/weekly/index.html',
    'en/research/index.html',
    'en/basics/index.html',
    'en/notes/index.html'
  ];
  for (const cFile of categoryLandings) {
    if (!fs.existsSync(path.join(rootDir, cFile))) {
      throw new Error(`Missing category landing page: ${cFile}`);
    }
  }

  // D. git diff --check (whitespace & conflict markers)
  console.log('  Running git diff --check for whitespace/conflict markers...');
  const gitDiff = spawnSync('git', ['diff', '--check'], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (gitDiff.status !== 0) {
    const err = new Error('git diff --check detected errors');
    err.details = (gitDiff.stdout || gitDiff.stderr || '').trim();
    throw err;
  }
});

// -----------------------------------------------------------------------------
// [4/4] Verification complete
// -----------------------------------------------------------------------------
console.log('[4/4] Verification complete!');
console.log('================================================================');
console.log('  ✔ All test suites, syntax checks, and invariants passed.');
console.log('================================================================\n');
process.exit(0);
