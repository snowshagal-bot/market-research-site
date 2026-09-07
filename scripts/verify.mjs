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
// [3/4] Repository invariants & integrity (including committed + uncommitted diffs)
// -----------------------------------------------------------------------------
runStep(3, 'Checking repository invariants & git diff whitespace checks', () => {
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

  // B. tags.json & tags.js sanity & synchronization
  const tagsJsonPath = path.join(rootDir, 'data/tags.json');
  const tagsJsPath = path.join(rootDir, 'data/tags.js');

  if (!fs.existsSync(tagsJsonPath)) {
    throw new Error('Missing data/tags.json');
  }
  if (!fs.existsSync(tagsJsPath)) {
    throw new Error('Missing data/tags.js');
  }

  let tags;
  try {
    tags = JSON.parse(fs.readFileSync(tagsJsonPath, 'utf8'));
  } catch (parseErr) {
    throw new Error(`Failed to parse data/tags.json: ${parseErr.message}`);
  }

  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
    throw new Error('data/tags.json must be a non-empty object dictionary');
  }

  const tagEntries = Object.entries(tags);
  if (tagEntries.length === 0) {
    throw new Error('data/tags.json must contain at least one tag definition');
  }

  const tagsJsContent = fs.readFileSync(tagsJsPath, 'utf8');
  if (!tagsJsContent.includes('window.TAG_REGISTRY =')) {
    throw new Error('data/tags.js must export window.TAG_REGISTRY');
  }

  const tagsFromJs = JSON.parse(tagsJsContent.replace(/^window\.TAG_REGISTRY\s*=\s*/, '').replace(/;\s*$/, ''));
  if (JSON.stringify(tags) !== JSON.stringify(tagsFromJs)) {
    throw new Error('data/tags.json and data/tags.js are not synchronized');
  }

  const validGroups = new Set(['market', 'sector', 'macro', 'company-policy']);
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const koSeen = new Map();
  const enSeen = new Map();

  for (const [id, def] of tagEntries) {
    if (!slugRegex.test(id) || id.length < 2 || id.length > 48) {
      throw new Error(`Invalid tag slug '${id}' in data/tags.json: must be 2-48 lowercase alphanumeric/hyphen characters`);
    }
    if (!def || typeof def !== 'object') {
      throw new Error(`Tag '${id}' definition must be an object`);
    }
    if (typeof def.ko !== 'string' || !def.ko.trim() || def.ko.length > 40) {
      throw new Error(`Tag '${id}' must have a valid Korean label (1-40 chars)`);
    }
    if (typeof def.en !== 'string' || !def.en.trim() || def.en.length > 60) {
      throw new Error(`Tag '${id}' must have a valid English label (1-60 chars)`);
    }
    if (!validGroups.has(def.group)) {
      throw new Error(`Tag '${id}' has invalid group '${def.group}'. Valid groups: ${[...validGroups].join(', ')}`);
    }

    const normKo = def.ko.toLowerCase().replace(/\s+/g, ' ').trim();
    const normEn = def.en.toLowerCase().replace(/\s+/g, ' ').trim();
    if (koSeen.has(normKo)) {
      throw new Error(`Duplicate Korean tag label '${def.ko}' found in '${id}' and '${koSeen.get(normKo)}'`);
    }
    if (enSeen.has(normEn)) {
      throw new Error(`Duplicate English tag label '${def.en}' found in '${id}' and '${enSeen.get(normEn)}'`);
    }
    koSeen.set(normKo, id);
    enSeen.set(normEn, id);
  }

  // Cross-reference with posts.json
  for (const post of posts) {
    const pTags = Array.isArray(post.tags) ? post.tags : [];
    if (pTags.length > 5) {
      throw new Error(`Post '${post.id}' exceeds maximum tag limit of 5 (has ${pTags.length})`);
    }
    const seenPostTags = new Set();
    for (const t of pTags) {
      if (!tags[t]) {
        throw new Error(`Post '${post.id}' uses unregistered tag '${t}' not in data/tags.json`);
      }
      if (seenPostTags.has(t)) {
        throw new Error(`Post '${post.id}' contains duplicate tag '${t}'`);
      }
      seenPostTags.add(t);
    }
  }

  // C. Search index artifacts
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

  // D. Git Diff Checks (both Committed Changes and Uncommitted Working Tree)
  function getGitOutput(args) {
    const res = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' });
    return res.status === 0 ? res.stdout.trim() : null;
  }

  // 1. Resolve base ref for committed diff comparison
  let baseRef = null;
  if (process.env.VERIFY_BASE_REF && process.env.VERIFY_BASE_REF !== '0000000000000000000000000000000000000000') {
    if (getGitOutput(['rev-parse', '--verify', process.env.VERIFY_BASE_REF])) {
      baseRef = process.env.VERIFY_BASE_REF;
    }
  }

  if (!baseRef && process.env.GITHUB_BASE_REF) {
    const remoteRef = `origin/${process.env.GITHUB_BASE_REF}`;
    if (getGitOutput(['rev-parse', '--verify', remoteRef])) {
      baseRef = remoteRef;
    } else if (getGitOutput(['rev-parse', '--verify', process.env.GITHUB_BASE_REF])) {
      baseRef = process.env.GITHUB_BASE_REF;
    }
  }

  if (!baseRef) {
    if (getGitOutput(['rev-parse', '--verify', 'origin/main'])) {
      baseRef = 'origin/main';
    } else if (getGitOutput(['rev-parse', '--verify', 'main'])) {
      baseRef = 'main';
    } else if (getGitOutput(['rev-parse', '--verify', 'HEAD~1'])) {
      baseRef = 'HEAD~1';
    }
  }

  // 2. Committed changes check
  if (baseRef) {
    const headSha = getGitOutput(['rev-parse', 'HEAD']);
    const baseSha = getGitOutput(['rev-parse', baseRef]);
    const mergeBase = getGitOutput(['merge-base', baseRef, 'HEAD']);

    let committedRange;
    if (mergeBase && mergeBase !== headSha) {
      committedRange = `${baseRef}...HEAD`;
    } else if (getGitOutput(['rev-parse', '--verify', 'HEAD~1'])) {
      committedRange = 'HEAD~1...HEAD';
    } else {
      committedRange = 'HEAD^!';
    }

    console.log(`  Running git diff --check on committed changes (${committedRange})...`);
    const committedDiff = spawnSync('git', ['diff', '--check', committedRange], {
      cwd: rootDir,
      encoding: 'utf8'
    });

    if (committedDiff.status !== 0) {
      const err = new Error(`git diff --check detected whitespace or conflict markers in committed changes (${committedRange})`);
      err.details = (committedDiff.stdout || committedDiff.stderr || '').trim();
      throw err;
    }
  } else {
    console.log('  Running git diff-tree --check on HEAD commit...');
    const diffTree = spawnSync('git', ['diff-tree', '--check', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    if (diffTree.status !== 0) {
      const err = new Error('git diff-tree --check detected whitespace/conflict errors in HEAD commit');
      err.details = (diffTree.stdout || diffTree.stderr || '').trim();
      throw err;
    }
  }

  // 3. Uncommitted working tree check
  console.log('  Running git diff --check on uncommitted working tree...');
  const workingTreeDiff = spawnSync('git', ['diff', '--check'], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (workingTreeDiff.status !== 0) {
    const err = new Error('git diff --check detected errors in uncommitted working tree');
    err.details = (workingTreeDiff.stdout || workingTreeDiff.stderr || '').trim();
    throw err;
  }

  // 4. Staged index check
  const stagedDiff = spawnSync('git', ['diff', '--cached', '--check'], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (stagedDiff.status !== 0) {
    const err = new Error('git diff --cached --check detected errors in staged changes');
    err.details = (stagedDiff.stdout || stagedDiff.stderr || '').trim();
    throw err;
  }

  // 5. Invariant: reports/** directory must not have modified HTML files
  if (baseRef) {
    const reportDiff = spawnSync('git', ['diff', '--name-only', baseRef, '--', 'reports/'], {
      cwd: rootDir,
      encoding: 'utf8'
    });
    if (reportDiff.status === 0 && reportDiff.stdout.trim().length > 0) {
      const changed = reportDiff.stdout.trim().split(/\r?\n/).filter(Boolean);
      if (changed.length > 0) {
        const err = new Error(`reports/** source HTML files must not be modified (${changed.length} file(s) changed)`);
        err.details = changed.join('\n');
        throw err;
      }
    }
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
