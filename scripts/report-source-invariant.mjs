import { spawnSync } from 'node:child_process';

// Report source HTML is append-only. Publishing a report adds a new file under reports/
// (git status A), which is normal; changing a report that already exists in the base
// (status M) is what the Verification Gate refuses. Only modified paths are listed, so a
// newly published report never trips the gate. The comparison is the base against the
// working tree, as before, so an uncommitted edit to an existing report is caught too.
export function reportSourceDiffArgs(baseRef) {
  return ['diff', '--name-only', '--diff-filter=M', baseRef, '--', 'reports/'];
}

// Existing report sources modified since `baseRef`. Empty when git cannot answer, as before.
export function modifiedReportSources(baseRef, { cwd }) {
  const result = spawnSync('git', reportSourceDiffArgs(baseRef), { cwd, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

// `git diff --check` problems the gate fails on. Report HTML is published exactly as it
// was uploaded and is never edited afterwards, so whitespace inside reports/ is not the
// gate's to judge: a trailing space in a new report used to turn the gate red on every
// such publish with nothing to fix. Conflict markers still fail everywhere, reports too.
// Each problem is a `path:line: message` header followed by the offending `+` lines.
export function diffCheckProblems(output) {
  const problems = [];
  let skipping = false;
  for (const line of String(output || '').split(/\r?\n/)) {
    const header = line.startsWith('+') ? null : line.match(/^(.+?):(\d+): (.+)$/);
    if (header) skipping = header[1].startsWith('reports/') && !/conflict marker/i.test(header[3]);
    if (!skipping && line) problems.push(line);
  }
  return problems.join('\n');
}
