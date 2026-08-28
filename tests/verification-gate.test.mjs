import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Verification Gate: scripts/verify.mjs exists and contains expected verification steps', () => {
  const verifyPath = path.join(rootDir, 'scripts/verify.mjs');
  assert.ok(fs.existsSync(verifyPath), 'scripts/verify.mjs must exist');

  const content = fs.readFileSync(verifyPath, 'utf8');
  assert.match(content, /Running automated test suites/);
  assert.match(content, /Validating JavaScript & MJS syntax/);
  assert.match(content, /Checking repository invariants/);
  assert.match(content, /node --check/);
  assert.match(content, /git diff --check/);
  // Committed diff & base ref resolution
  assert.match(content, /VERIFY_BASE_REF/);
  assert.match(content, /GITHUB_BASE_REF/);
  assert.match(content, /merge-base/);
  assert.match(content, /git diff --cached --check/);
});

test('Verification Gate: .github/workflows/verify.yml exists with fetch-depth 0, triggers, and base ref handling', () => {
  const workflowPath = path.join(rootDir, '.github/workflows/verify.yml');
  assert.ok(fs.existsSync(workflowPath), '.github/workflows/verify.yml must exist');

  const content = fs.readFileSync(workflowPath, 'utf8');
  assert.match(content, /name:\s*Verification Gate/);
  assert.match(content, /pull_request:/);
  assert.match(content, /push:/);
  assert.match(content, /workflow_dispatch:/);
  assert.match(content, /actions\/checkout@v4/);
  assert.match(content, /fetch-depth:\s*0/);
  assert.match(content, /actions\/setup-node@v4/);
  assert.match(content, /VERIFY_BASE_REF/);
  assert.match(content, /node scripts\/verify\.mjs/);
  assert.match(content, /git diff --check/);
});

test('Verification Gate: AGENTS.md instructs running node scripts/verify.mjs', () => {
  const agentsMd = fs.readFileSync(path.join(rootDir, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /node scripts\/verify\.mjs/);
});

test('Verification Gate: Committed whitespace errors are caught and fail git diff --check on commit range', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-whitespace-test-'));
  try {
    spawnSync('git', ['init', '-b', 'main'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.name', 'Verification Test'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.email', 'verify@test.local'], { cwd: tempDir });

    // Base commit on main
    fs.writeFileSync(path.join(tempDir, 'file.js'), 'export const clean = 1;\n');
    spawnSync('git', ['add', 'file.js'], { cwd: tempDir });
    spawnSync('git', ['commit', '-m', 'Base commit on main'], { cwd: tempDir });

    // Feature branch with trailing whitespace error
    spawnSync('git', ['checkout', '-b', 'feature-branch'], { cwd: tempDir });
    fs.writeFileSync(path.join(tempDir, 'file.js'), 'export const clean = 1;\nexport const dirty = 2;   \n');
    spawnSync('git', ['add', 'file.js'], { cwd: tempDir });
    spawnSync('git', ['commit', '-m', 'Commit with trailing whitespace'], { cwd: tempDir });

    // Test git diff --check on range main...feature-branch
    const failedCheck = spawnSync('git', ['diff', '--check', 'main...feature-branch'], {
      cwd: tempDir,
      encoding: 'utf8'
    });

    assert.notEqual(failedCheck.status, 0, 'Committed whitespace error must cause non-zero exit');
    const output = (failedCheck.stdout || failedCheck.stderr || '');
    assert.match(output, /trailing whitespace/, 'Diff check must report trailing whitespace');

    // Test clean fix passes on HEAD~1...HEAD
    fs.writeFileSync(path.join(tempDir, 'file.js'), 'export const clean = 1;\nexport const clean2 = 2;\n');
    spawnSync('git', ['add', 'file.js'], { cwd: tempDir });
    spawnSync('git', ['commit', '-m', 'Fix whitespace error'], { cwd: tempDir });

    const passCheck = spawnSync('git', ['diff', '--check', 'HEAD~1...HEAD'], {
      cwd: tempDir,
      encoding: 'utf8'
    });
    assert.equal(passCheck.status, 0, 'Clean commit diff must pass with code 0');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
