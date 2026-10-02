import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { modifiedReportSources, reportSourceDiffArgs } from '../scripts/report-source-invariant.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repos = [];

after(() => {
  for (const dir of repos) fs.rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function write(cwd, files) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(cwd, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function commit(cwd, files, message) {
  write(cwd, files);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

// An isolated repository whose base commit already holds published reports and site files,
// shaped like this repository. Nothing in the real repository is read or changed.
function baseRepository() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-report-invariant-'));
  repos.push(cwd);
  git(cwd, 'init', '-q');
  for (const [key, value] of [
    ['user.name', 'verify test'], ['user.email', 'verify@example.invalid'],
    ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']
  ]) git(cwd, 'config', key, value);
  const base = commit(cwd, {
    'reports/2026-09-30_Snowshagal_Daily.html': '<h1>KO 09-30</h1>\n',
    'reports/en/2026-09-30_KOSPI_Daily_Report_EN_publish.html': '<h1>EN 09-30</h1>\n',
    'data/posts.json': '[]\n',
    'assets/site.js': 'export const x = 1;\n',
    'docs/PROJECT_STATE.md': '# state\n'
  }, 'base');
  return { cwd, base };
}

const NEW_KO = 'reports/2026-10-02_Snowshagal_Daily.html';
const NEW_EN = 'reports/en/2026-10-02_KOSPI_Daily_Report_EN_publish.html';
const EXISTING_KO = 'reports/2026-09-30_Snowshagal_Daily.html';

test('report invariant lists only modified (M) paths under reports/', () => {
  assert.deepEqual(reportSourceDiffArgs('BASE'), ['diff', '--name-only', '--diff-filter=M', 'BASE', '--', 'reports/']);
});

test('a newly added report (status A) passes the report invariant', () => {
  const { cwd, base } = baseRepository();
  commit(cwd, { [NEW_KO]: '<h1>KO 10-02</h1>\n' }, 'publish');
  assert.equal(git(cwd, 'diff', '--name-status', base, '--', 'reports/'), `A\t${NEW_KO}`);
  assert.deepEqual(modifiedReportSources(base, { cwd }), []);
  // The old command (no status filter) reported the new file as a modification.
  assert.equal(git(cwd, 'diff', '--name-only', base, '--', 'reports/'), NEW_KO);
});

test('a modified existing report (status M) fails and names the report', () => {
  const { cwd, base } = baseRepository();
  commit(cwd, { [EXISTING_KO]: '<h1>KO 09-30 edited</h1>\n' }, 'edit');
  assert.equal(git(cwd, 'diff', '--name-status', base, '--', 'reports/'), `M\t${EXISTING_KO}`);
  assert.deepEqual(modifiedReportSources(base, { cwd }), [EXISTING_KO]);
});

test('an uncommitted edit to an existing report is still caught (base compared with the working tree)', () => {
  const { cwd, base } = baseRepository();
  write(cwd, { [EXISTING_KO]: '<h1>KO 09-30 edited, not committed</h1>\n' });
  assert.deepEqual(modifiedReportSources(base, { cwd }), [EXISTING_KO]);
});

test('mixed: one added and one modified report lists only the modified one', () => {
  const { cwd, base } = baseRepository();
  commit(cwd, { [NEW_KO]: '<h1>KO 10-02</h1>\n', [EXISTING_KO]: '<h1>KO 09-30 edited</h1>\n' }, 'mixed');
  assert.deepEqual(modifiedReportSources(base, { cwd }), [EXISTING_KO]);
});

test('non-report changes (assets, docs, data) do not touch the report invariant', () => {
  const { cwd, base } = baseRepository();
  commit(cwd, {
    'assets/site.js': 'export const x = 2;\n',
    'docs/PROJECT_STATE.md': '# state\nupdated\n',
    'data/posts.json': '[{"id":"x"}]\n'
  }, 'site');
  assert.deepEqual(modifiedReportSources(base, { cwd }), []);
});

test('a publish-shaped diff (new KO and EN reports plus generated data and covers) passes', () => {
  const { cwd, base } = baseRepository();
  commit(cwd, { [NEW_KO]: '<h1>KO 10-02</h1>\n', 'data/posts.json': '[{"id":"ko"}]\n',
    'data/search-index.json': '[]\n', 'covers/2026-10-02-daily-ko.webp': 'img' }, 'publish KO');
  commit(cwd, { [NEW_EN]: '<h1>EN 10-02</h1>\n', 'data/posts.json': '[{"id":"ko"},{"id":"en"}]\n',
    'data/search-index-body-en.js': 'window.X = [];\n', 'covers/2026-10-02-daily-en.webp': 'img' }, 'publish EN');
  assert.deepEqual(modifiedReportSources(base, { cwd }), []);
});

test('verify.mjs runs the report invariant through the shared helper with the same failure message', () => {
  const content = fs.readFileSync(path.join(rootDir, 'scripts/verify.mjs'), 'utf8');
  assert.match(content, /import \{ modifiedReportSources \} from '\.\/report-source-invariant\.mjs';/);
  assert.match(content, /modifiedReportSources\(baseRef, \{ cwd: rootDir \}\)/);
  assert.match(content, /reports\/\*\* source HTML files must not be modified/);
  assert.doesNotMatch(content, /\['diff', '--name-only', baseRef, '--', 'reports\/'\]/);
});
