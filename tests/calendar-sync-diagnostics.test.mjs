import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BODY_PREVIEW_LIMIT,
  CLOUDFLARE_ERROR_FIELDS,
  describeErrorResponse,
  runCli,
  syncCalendar
} from '../scripts/sync-calendar.mjs';

// #158: a failed calendar run must say what the failed answer itself said —
// Cloudflare's error fields and cf-ray — without ever printing a secret.

const SYNC_KEY = 'fixture-sync-key-do-not-log-7f3a';
const CF_RAY = '8c1f2a3b4c5d6e7f-ICN';
const NOW = new Date('2026-10-02T14:08:37.000Z');

// A Cloudflare-generated error document with the keys seen in the failed runs.
// Values are fixtures; only the shape matters here.
const CLOUDFLARE_BODY = {
  type: 'https://developers.cloudflare.com/fixture/error-1102/',
  title: 'Fixture worker error',
  status: 502,
  detail: 'Fixture detail sentence.',
  instance: 'fixture-instance',
  error_code: 1102,
  error_name: 'fixture_error_name',
  error_category: 'workers',
  ray_id: '8c1f2a3b4c5d6e7f',
  timestamp: '2026-10-02T14:08:37Z',
  zone: 'snowshagal.com',
  cloudflare_error: true,
  retryable: true,
  retry_after: 60,
  owner_action_required: true,
  what_you_should_do: 'Fixture advice that must not be copied into the report.',
  footer: 'Fixture footer that must not be copied into the report.'
};

const answer = (body, status, contentType, headers = {}) => async () => new Response(
  typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': contentType, ...headers } }
);

/** Runs the real command line against one answer and returns everything it printed or wrote. */
async function run(fetchImpl, key = SYNC_KEY) {
  const logs = [];
  const errors = [];
  const written = [];
  const code = await runCli({
    env: { CALENDAR_SYNC_REPORT: '/tmp/calendar-sync-report.txt' },
    syncImpl: options => syncCalendar({ ...options, key, fetchImpl }),
    now: () => NOW,
    log: line => logs.push(line),
    logError: line => errors.push(line),
    writeReport: async (path, text) => { written.push(text); }
  });
  // The runner writes the report with one trailing newline; compare the report itself.
  return { code, logs, errors, report: (written[0] || '').replace(/\n$/, ''), all: [...logs, ...errors, ...written].join('\n') };
}

test('A: a Cloudflare 502 reports every allowlisted field with its value and the cf-ray header', async () => {
  const { code, report } = await run(answer(CLOUDFLARE_BODY, 502, 'application/json', { 'cf-ray': CF_RAY }));
  assert.equal(code, 1);
  // The existing line stays: the answer still names no source.
  assert.match(report, /- internal: orchestration — HTTP 502/);
  assert.match(report, /\n\nResponse diagnostics:\nhttp_status: 502\ncontent_type: application\/json\ncf_ray: 8c1f2a3b4c5d6e7f-ICN\n/);
  for (const field of CLOUDFLARE_ERROR_FIELDS) {
    assert.match(report, new RegExp(`^cloudflare\\.${field}: ${String(CLOUDFLARE_BODY[field]).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'), field);
  }
  // Only the allowlist: the rest of the document is not copied.
  for (const field of ['timestamp', 'zone', 'retry_after', 'owner_action_required', 'what_you_should_do', 'footer']) {
    assert.doesNotMatch(report, new RegExp(`cloudflare\\.${field}`), field);
  }
  assert.doesNotMatch(report, /Fixture advice|Fixture footer|body_preview/);
});

test('A: a non-502 Cloudflare error (thrown as a server error) carries the same diagnostics', async () => {
  const { code, report } = await run(answer({ ...CLOUDFLARE_BODY, status: 520 }, 520, 'application/json', { 'cf-ray': CF_RAY }));
  assert.equal(code, 1);
  assert.match(report, /error: \[server\] calendar sync API returned HTTP 520/);
  assert.match(report, /cf_ray: 8c1f2a3b4c5d6e7f-ICN\ncloudflare\.type: /);
  assert.match(report, /^cloudflare\.error_code: 1102$/m);
});

test('B: our own 502 keeps every named source failure first, then only status, content-type and cf-ray', async () => {
  const { code, report } = await run(answer({
    ok: false, years: [2026, 2027], failed: ['bea'],
    failures: [{ source: 'bea', stage: 'fetch', error: 'HTTP 503', httpStatus: 503, attempt: 1 }],
    results: [
      { sourceName: 'federal-reserve', status: 'ok', events: 16 },
      { sourceName: 'bea', status: 'error', stage: 'fetch', error: 'HTTP 503', httpStatus: 503, attempt: 1 }
    ]
  }, 502, 'application/json; charset=utf-8', { 'cf-ray': CF_RAY }));
  assert.equal(code, 1);
  assert.match(report, /^Calendar sync failed\n\nFailed sources:\n- bea: fetch — HTTP 503\n\nsource: bea\nstage: fetch\nerror: HTTP 503\nhttp_status: 503\n/);
  assert.match(report, /\n\nResponse diagnostics:\nhttp_status: 502\ncontent_type: application\/json; charset=utf-8\ncf_ray: 8c1f2a3b4c5d6e7f-ICN$/);
  assert.doesNotMatch(report, /cloudflare\.|body_preview/);
});

test('C: an HTML 502 gives cf-ray and a preview capped at the limit', async () => {
  const html = `<!DOCTYPE html><html><head><title>502 Bad gateway</title></head><body>${'<p>gateway</p>'.repeat(400)}</body></html>`;
  assert.ok(html.length > BODY_PREVIEW_LIMIT * 4);
  const { code, report } = await run(answer(html, 502, 'text/html; charset=UTF-8', { 'cf-ray': CF_RAY }));
  assert.equal(code, 1);
  assert.match(report, /error: \[validation\] calendar sync response is not valid JSON \(HTTP 502\)/);
  assert.match(report, /content_type: text\/html; charset=UTF-8\ncf_ray: 8c1f2a3b4c5d6e7f-ICN\n/);
  const preview = /^body_preview \((\d+) of (\d+) chars\): (.*)$/m.exec(report);
  assert.ok(preview, 'preview line present');
  assert.equal(Number(preview[1]), BODY_PREVIEW_LIMIT);
  assert.equal(Number(preview[2]), html.length);
  assert.ok(preview[3].startsWith('<!DOCTYPE html><html><head><title>502 Bad gateway</title>'));
  assert.ok(preview[3].length <= BODY_PREVIEW_LIMIT + 1, `preview length ${preview[3].length}`);
  assert.ok(preview[3].endsWith('…'));
});

test('D: malformed JSON does not crash the logger and is previewed', async () => {
  const broken = '{"error_code": 1102, "ray_id": ';
  const { code, report } = await run(answer(broken, 502, 'application/json', { 'cf-ray': CF_RAY }));
  assert.equal(code, 1);
  assert.match(report, /\[validation\] calendar sync response is not valid JSON \(HTTP 502\)/);
  assert.match(report, /^body_preview \(31 of 31 chars\): \{"error_code": 1102, "ray_id":$/m);
  // A plain-text answer without cf-ray still reports what it can.
  const plain = await run(answer('upstream connect error', 503, 'text/plain'));
  assert.match(plain.report, /cf_ray: n\/a\nbody_preview \(22 of 22 chars\): upstream connect error$/);
});

test('E: the sync key never reaches the log, the report or the alert, even when an answer echoes it', async () => {
  let sentKey = null;
  const echoing = body => async (_url, init) => {
    sentKey = init.headers['x-disclosure-sync-key'];
    return answer(body, 502, typeof body === 'string' ? 'text/html' : 'application/json', { 'cf-ray': `${SYNC_KEY}-ICN` })();
  };
  for (const body of [
    `<html><body>request carried ${SYNC_KEY} and Authorization: Bearer ${SYNC_KEY}</body></html>`,
    { ...CLOUDFLARE_BODY, detail: `echo ${SYNC_KEY}`, instance: SYNC_KEY }
  ]) {
    const { code, all, report } = await run(echoing(body));
    assert.equal(sentKey, SYNC_KEY, 'the request really carried the key');
    assert.equal(code, 1);
    assert.ok(!all.includes(SYNC_KEY), 'the key value is printed nowhere');
    assert.ok(!all.toLowerCase().includes('x-disclosure-sync-key'), 'no request header is printed');
    assert.match(report, /\[redacted\]/);
  }
});

test('F: a successful run prints exactly what it printed before and writes no report', async () => {
  const body = {
    ok: true, years: [2026, 2027], failed: [],
    results: [
      { sourceName: 'federal-reserve', status: 'ok', events: 16, timesUnconfirmed: 9 },
      { sourceName: 'bank-of-korea-2027', status: 'pending', events: 0 },
      { sourceName: 'opendart-corporate', status: 'ok', events: 2, created: 2 }
    ]
  };
  const result = await syncCalendar({ key: SYNC_KEY, fetchImpl: answer(body, 200, 'application/json', { 'cf-ray': CF_RAY }) });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics, null);

  const { code, logs, errors, report } = await run(answer(body, 200, 'application/json', { 'cf-ray': CF_RAY }));
  assert.equal(code, 0);
  assert.deepEqual(logs, [
    '  federal-reserve: events=16 timesUnconfirmed=9',
    '  bank-of-korea-2027: pending (not published yet)',
    '  opendart-corporate: events=2 created=2',
    'PASS market calendar sync: years=2026,2027 sources=3'
  ]);
  assert.deepEqual(errors, []);
  assert.equal(report, '');
});

test('an authentication failure keeps its message and adds only the answer diagnostics', async () => {
  const { code, report } = await run(answer({ ok: false, error: 'UNAUTHORIZED' }, 401, 'application/json'));
  assert.equal(code, 1);
  assert.match(report, /error: \[auth\] calendar sync authentication failed \(HTTP 401\)/);
  assert.match(report, /Response diagnostics:\nhttp_status: 401\ncontent_type: application\/json\ncf_ray: n\/a$/);
});

test('describeErrorResponse keeps fields bounded and reads no header other than content-type and cf-ray', () => {
  const read = [];
  const headers = { get: name => { read.push(name); return name === 'cf-ray' ? CF_RAY : 'application/json'; } };
  const diagnostics = describeErrorResponse(
    { status: 502, headers },
    JSON.stringify({ ...CLOUDFLARE_BODY, detail: 'x'.repeat(5000) }),
    { secrets: [SYNC_KEY] }
  );
  assert.deepEqual(read.sort(), ['cf-ray', 'content-type']);
  assert.deepEqual(Object.keys(diagnostics.cloudflare), CLOUDFLARE_ERROR_FIELDS);
  assert.ok(diagnostics.cloudflare.detail.length <= 301);
  assert.equal(diagnostics.bodyPreview, null);
});
