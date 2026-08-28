import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
});

test('Verification Gate: .github/workflows/verify.yml exists with pull_request and push triggers', () => {
  const workflowPath = path.join(rootDir, '.github/workflows/verify.yml');
  assert.ok(fs.existsSync(workflowPath), '.github/workflows/verify.yml must exist');

  const content = fs.readFileSync(workflowPath, 'utf8');
  assert.match(content, /name:\s*Verification Gate/);
  assert.match(content, /pull_request:/);
  assert.match(content, /push:/);
  assert.match(content, /workflow_dispatch:/);
  assert.match(content, /actions\/checkout@v4/);
  assert.match(content, /actions\/setup-node@v4/);
  assert.match(content, /node scripts\/verify\.mjs/);
  assert.match(content, /git diff --check/);
});

test('Verification Gate: AGENTS.md instructs running node scripts/verify.mjs', () => {
  const agentsMd = fs.readFileSync(path.join(rootDir, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /node scripts\/verify\.mjs/);
});
