import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  REPORT_PROPAGATION_INTERVAL_MS,
  REPORT_PROPAGATION_WINDOW_MS,
  SmokeFailure,
  normalizeLocationHeader,
  runSmoke
} from '../scripts/smoke-site.mjs';
import { waitForCloudflareDeployment } from '../scripts/wait-for-cloudflare-deployment.mjs';

const posts = [
  {
    id: 'ko-smoke',
    type: 'daily',
    lang: 'ko',
    reportDate: '2026-08-29',
    registeredAt: '2026-08-29T01:00:00Z',
    href: 'reports/ko-smoke.html'
  },
  {
    id: 'en-smoke',
    type: 'daily',
    lang: 'en',
    reportDate: '2026-08-29',
    registeredAt: '2026-08-29T01:00:00Z',
    href: 'reports/en/en-smoke.html'
  }
];

const categoryRoutes = new Set([
  '/daily/', '/weekly/', '/research/', '/basics/', '/notes/',
  '/en/daily/', '/en/weekly/', '/en/research/', '/en/basics/', '/en/notes/'
]);

const SMOKE_NOW = new Date('2026-09-01T08:00:00Z');

const marketPayload = {
  meta: {
    market_date: '2026-09-01',
    generated_at: '2026-09-01T08:00:00Z',
    schema_version: '1.0.1',
    status: 'final'
  },
  indices: {
    KOSPI: { close: 1, source_date: '2026-09-01', data_state: 'final_close' },
    KOSDAQ: { close: 1, source_date: '2026-09-01', data_state: 'final_close' },
    NASDAQ: { close: 1, source_date: '2026-08-31', data_state: 'final_close' },
    DOW: { close: 1, source_date: '2026-08-31', data_state: 'final_close' },
    SP500: { close: 1, source_date: '2026-08-31', data_state: 'final_close' }
  },
  rates_fx_volatility: {
    SOX: { close: 1, source_date: '2026-08-31', data_state: 'final_close' },
    VIX: { close: 1, source_date: '2026-08-31', data_state: 'final_close' },
    US10Y: { close: 1, source_date: '2026-08-31', data_state: 'final_close' },
    USDKRW: { close: 1, source_date: '2026-09-01', data_state: 'final_close' },
    JPYKRW: { close: 1, source_date: '2026-09-01', data_state: 'final_close' },
    DXY: { close: 1, source_date: '2026-09-01', data_state: 'intraday' }
  },
  commodities_crypto: {
    WTI: { close: 1, source_date: '2026-09-01', data_state: 'intraday' },
    GOLD: { close: 1, source_date: '2026-09-01', data_state: 'intraday' },
    BITCOIN: { close: 1, source_date: '2026-09-01', data_state: 'intraday' }
  },
  validation: { passed: true, errors: [] }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function html(canonical) {
  return `<!doctype html><html><head><link rel="canonical" href="${canonical}"></head><body>ok</body></html>`;
}

async function withServer(options, fn) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch (_) { pathname = url.pathname; }

    if (options.page500 && pathname === '/weekly/') {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('broken');
      return;
    }

    // Per-path answers in order, the last one repeating; 'ok' falls through to
    // the normal route below.
    const sequence = options.sequence?.[pathname];
    if (sequence) {
      const seen = options.requests.get(pathname) || 0;
      options.requests.set(pathname, seen + 1);
      const status = sequence[Math.min(seen, sequence.length - 1)];
      if (status !== 'ok') {
        response.writeHead(status, { 'content-type': 'text/html', 'cf-ray': `fixture-${seen + 1}-ICN` });
        response.end('not served yet');
        return;
      }
    }
    if (pathname === options.missingCategory) {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('missing');
      return;
    }

    const commonHeaders = options.noindex ? { 'x-robots-tag': 'noindex, nofollow' } : {};
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html', ...commonHeaders });
      response.end(html('https://snowshagal.com/'));
      return;
    }
    if (pathname === '/en/') {
      response.writeHead(200, { 'content-type': 'text/html', ...commonHeaders });
      response.end(html('https://snowshagal.com/en/'));
      return;
    }
    if (categoryRoutes.has(pathname)) {
      response.writeHead(200, { 'content-type': 'text/html', ...commonHeaders });
      response.end('<!doctype html><title>category</title>');
      return;
    }
    if (pathname === '/reports/ko-smoke' || pathname === '/reports/en/en-smoke') {
      response.writeHead(200, { 'content-type': 'text/html', ...commonHeaders });
      response.end(html(options.wrongCanonical ? 'https://snowshagal.com/elsewhere' : `https://snowshagal.com${pathname}`));
      return;
    }
    if (pathname === '/reports/ko-smoke.html' || pathname === '/reports/en/en-smoke.html') {
      const clean = options.wrongRedirect ? '/wrong-report' : pathname.replace(/\.html$/, '');
      response.writeHead(options.legacyStatus || 301, { location: clean });
      response.end();
      return;
    }
    if (pathname === '/__snowshagal_smoke_missing_74__') {
      response.writeHead(404, { 'content-type': 'text/html', ...commonHeaders });
      response.end('missing');
      return;
    }
    if (pathname === '/sitemap.xml') {
      const daily = options.missingSitemapUrl ? '' : '<loc>https://snowshagal.com/daily/</loc>';
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end(`<?xml version="1.0"?><urlset><url><loc>https://snowshagal.com/</loc></url><url>${daily}</url><url><loc>https://snowshagal.com/en/daily/</loc></url></urlset>`);
      return;
    }
    if (pathname === '/api/market/latest') {
      if (options.market503) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'DB_NOT_CONFIGURED' }));
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(options.invalidJson ? '{broken' : JSON.stringify(options.marketPayload || marketPayload));
      }
      return;
    }
    if (pathname === '/api/comments') {
      if (options.comments503) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'DB_NOT_CONFIGURED' }));
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, comments: [] }));
      }
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try { return await fn(origin); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const quiet = { log() {}, error() {} };

async function expectFailure(options, expectedName, expectedMessage) {
  await withServer(options, async origin => {
    await assert.rejects(
      runSmoke({ origin, mode: options.noindex ? 'preview' : 'production', posts, logger: quiet, enforceOrigin: false, now: SMOKE_NOW }),
      error => {
        assert.ok(error instanceof SmokeFailure);
        const failed = error.result.checks.find(item => item.name === expectedName);
        assert.ok(failed, `missing failed check ${expectedName}`);
        assert.match(failed.message, expectedMessage);
        return true;
      }
    );
  });
}

test('deployment smoke accepts valid 200 pages, 301 redirects, 404, sitemap, and API JSON', async () => {
  await withServer({}, async origin => {
    const result = await runSmoke({ origin, mode: 'production', posts, logger: quiet, enforceOrigin: false, now: SMOKE_NOW });
    assert.equal(result.failed, 0);
    assert.equal(result.passed, result.total);
    assert.equal(result.total, 20);
  });
});

test('Preview mode requires and accepts the existing noindex policy', async () => {
  await withServer({ noindex: true }, async origin => {
    const result = await runSmoke({ origin, mode: 'preview', posts, logger: quiet, now: SMOKE_NOW });
    assert.equal(result.failed, 0);
  });
});

test('Production mode rejects HTTP, another hostname, and a non-default port', async () => {
  for (const origin of [
    'http://snowshagal.com',
    'https://example.com',
    'https://snowshagal.com:8443'
  ]) {
    await assert.rejects(
      runSmoke({ origin, mode: 'production', posts, logger: quiet }),
      /restricted to https:\/\/snowshagal\.com/
    );
  }
});

test('deployment smoke rejects an unexpected page 500', async () => {
  await expectFailure({ page500: true }, 'category /weekly/', /expected HTTP 200, received 500/);
});

test('deployment smoke rejects a wrong legacy redirect destination', async () => {
  await expectFailure({ wrongRedirect: true }, 'legacy KO report redirect', /expected redirect/);
});

test('deployment smoke requires the legacy report redirect to be a permanent 301', async () => {
  await expectFailure({ legacyStatus: 308 }, 'legacy KO report redirect', /expected HTTP 301, received 308/);
});

test('deployment smoke recovers Cloudflare UTF-8 redirect headers exposed as latin1 by Node fetch', () => {
  const location = '/reports/8월 28일 주식리포트';
  const latin1 = Buffer.from(location, 'utf8').toString('latin1');
  assert.equal(normalizeLocationHeader(latin1), location);
});

test('deployment smoke rejects a missing populated category in sitemap', async () => {
  await expectFailure({ missingSitemapUrl: true }, 'sitemap', /missing populated category/);
});

test('deployment smoke rejects invalid API JSON', async () => {
  await expectFailure({ invalidJson: true }, 'market API', /invalid JSON/);
});

test('deployment smoke rejects Preview API 503 instead of treating a missing binding as PASS', async () => {
  await expectFailure({ noindex: true, market503: true }, 'market API', /expected HTTP 200, received 503/);
});

test('deployment smoke rejects a stale Production market_date despite HTTP 200', async () => {
  const stale = clone(marketPayload);
  stale.meta.market_date = '2026-08-31';
  stale.meta.generated_at = '2026-08-31T08:00:00Z';
  for (const code of ['KOSPI', 'KOSDAQ']) stale.indices[code].source_date = '2026-08-31';
  for (const code of ['NASDAQ', 'DOW', 'SP500']) stale.indices[code].source_date = '2026-08-28';
  for (const code of ['SOX', 'VIX', 'US10Y']) stale.rates_fx_volatility[code].source_date = '2026-08-28';
  for (const code of ['USDKRW', 'JPYKRW', 'DXY']) stale.rates_fx_volatility[code].source_date = '2026-08-31';
  for (const code of ['WTI', 'GOLD', 'BITCOIN']) stale.commodities_crypto[code].source_date = '2026-08-31';
  await expectFailure({ marketPayload: stale }, 'market API', /Production market_date is stale: expected 2026-09-01, received 2026-08-31/);
});

test('deployment smoke rejects stale per-market source dates despite a current snapshot', async () => {
  const staleSource = clone(marketPayload);
  staleSource.indices.NASDAQ.source_date = '2026-08-27';
  await expectFailure({ marketPayload: staleSource }, 'market API', /source freshness failed.*NASDAQ.*expected 2026-08-31.*2026-08-27/);
});

test('deployment smoke rejects comments GET 503 instead of treating a missing binding as PASS', async () => {
  await expectFailure({ noindex: true, comments503: true }, 'comments read API', /expected HTTP 200, received 503/);
});

/** Runs the Production smoke on a fake clock: sleeping advances time, nothing really waits. */
async function runWithClock(options) {
  let now = 0;
  const sleeps = [];
  const logs = [];
  const errors = [];
  const requests = new Map();
  const outcome = await withServer({ ...options, requests }, async origin => {
    try {
      return await runSmoke({
        origin,
        mode: 'production',
        posts,
        enforceOrigin: false,
        now: SMOKE_NOW,
        logger: { log: line => logs.push(line), error: line => errors.push(line) },
        clock: () => now,
        sleepImpl: async ms => { sleeps.push(ms); now += ms; }
      });
    } catch (error) {
      assert.ok(error instanceof SmokeFailure, String(error));
      return error.result;
    }
  });
  return { result: outcome, sleeps, slept: sleeps.reduce((sum, ms) => sum + ms, 0), logs, errors, requests };
}

const failedCheck = (result, name) => result.checks.find(item => item.name === name && !item.ok);

test('a just-published report that answers 404 for a few seconds passes once every edge serves it', async () => {
  const run = await runWithClock({ sequence: { '/reports/ko-smoke': [404, 404, 'ok'] } });
  assert.equal(run.result.failed, 0);
  assert.equal(run.result.total, 20);
  assert.equal(run.requests.get('/reports/ko-smoke'), 3);
  assert.deepEqual(run.sleeps, [REPORT_PROPAGATION_INTERVAL_MS, REPORT_PROPAGATION_INTERVAL_MS]);
  const retries = run.logs.filter(line => line.startsWith('RETRY latest KO report'));
  assert.equal(retries.length, 2);
  assert.match(retries[0], /HTTP 404 on attempt 1 \(cf-ray fixture-1-ICN\); asking again in 5\.0s, window closes in 90\.0s$/);
  assert.ok(run.logs.includes('PASS latest KO report (attempts=3, waited 10.0s, propagation window 90.0s)'));
  // A check that never saw a 404 logs exactly as before.
  assert.ok(run.logs.includes('PASS legacy KO report redirect'));
});

test('the legacy .html redirect of a just-published report gets the same 404 grace', async () => {
  const run = await runWithClock({ sequence: { '/reports/en/en-smoke.html': [404, 'ok'] } });
  assert.equal(run.result.failed, 0);
  assert.equal(run.requests.get('/reports/en/en-smoke.html'), 2);
  assert.ok(run.logs.includes('PASS legacy EN report redirect (attempts=2, waited 5.0s, propagation window 90.0s)'));
});

test('a report that stays 404 still fails after the bounded window, with its attempts and last answer', async () => {
  const run = await runWithClock({ sequence: { '/reports/ko-smoke': [404] } });
  const attempts = REPORT_PROPAGATION_WINDOW_MS / REPORT_PROPAGATION_INTERVAL_MS + 1;
  assert.equal(run.result.failed, 1);
  assert.equal(run.requests.get('/reports/ko-smoke'), attempts);
  assert.equal(run.slept, REPORT_PROPAGATION_WINDOW_MS);
  const message = `/reports/ko-smoke: expected HTTP 200, received 404 (attempts=${attempts}, waited 90.0s, propagation window 90.0s, last cf-ray fixture-${attempts}-ICN)`;
  assert.equal(failedCheck(run.result, 'latest KO report').message, message);
  assert.ok(run.errors.includes(`FAIL latest KO report: ${message}`));
});

test('every report check shares one window, so several missing reports cannot multiply the wait', async () => {
  const run = await runWithClock({
    sequence: {
      '/reports/ko-smoke': [404],
      '/reports/ko-smoke.html': [404],
      '/reports/en/en-smoke': [404],
      '/reports/en/en-smoke.html': [404]
    }
  });
  assert.equal(run.result.failed, 4);
  assert.equal(run.slept, REPORT_PROPAGATION_WINDOW_MS);
  for (const pathname of ['/reports/ko-smoke.html', '/reports/en/en-smoke', '/reports/en/en-smoke.html']) {
    assert.equal(run.requests.get(pathname), 1, pathname);
  }
  assert.match(
    failedCheck(run.result, 'latest EN report').message,
    /received 404 \(attempts=1, waited 0\.0s, propagation window 90\.0s, last cf-ray fixture-1-ICN\)$/
  );
});

test('only 404 is asked again: any other report error fails on the answer it got', async () => {
  const immediate = await runWithClock({ sequence: { '/reports/ko-smoke': [500] } });
  assert.deepEqual(immediate.sleeps, []);
  assert.equal(immediate.requests.get('/reports/ko-smoke'), 1);
  assert.equal(failedCheck(immediate.result, 'latest KO report').message, '/reports/ko-smoke: expected HTTP 200, received 500');

  const after404 = await runWithClock({ sequence: { '/reports/en/en-smoke': [404, 503] } });
  assert.equal(after404.sleeps.length, 1);
  assert.equal(
    failedCheck(after404.result, 'latest EN report').message,
    '/reports/en/en-smoke: expected HTTP 200, received 503 (attempts=2, waited 5.0s, propagation window 90.0s)'
  );

  const legacy308 = await runWithClock({ sequence: { '/reports/ko-smoke.html': [404, 308] } });
  assert.match(failedCheck(legacy308.result, 'legacy KO report redirect').message, /expected HTTP 301, received 308 \(attempts=2,/);
});

test('the 404 grace is limited to the latest reports: a 404 anywhere else fails at once', async () => {
  const run = await runWithClock({ missingCategory: '/en/notes/' });
  assert.deepEqual(run.sleeps, []);
  assert.equal(run.result.failed, 1);
  assert.equal(failedCheck(run.result, 'category /en/notes/').message, '/en/notes/: expected HTTP 200, received 404');
});

test('a report that appears after a 404 is still held to its canonical', async () => {
  const run = await runWithClock({ sequence: { '/reports/ko-smoke': [404, 'ok'] }, wrongCanonical: true });
  assert.match(failedCheck(run.result, 'latest KO report').message, /canonical mismatch/);
});

test('the propagation window fits in the smoke job together with the Cloudflare wait before it', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deployment-smoke.yml', import.meta.url), 'utf8');
  const jobMs = Number(/timeout-minutes:\s*(\d+)/.exec(workflow)[1]) * 60_000;
  const cloudflareWaitMs = 36 * 5000; // wait-for-cloudflare-deployment.mjs defaults
  assert.ok(REPORT_PROPAGATION_WINDOW_MS + cloudflareWaitMs <= jobMs / 2);
});

function checkRun(status, conclusion = null) {
  return {
    name: 'Cloudflare Pages',
    status,
    conclusion,
    head_sha: 'a'.repeat(40),
    external_id: 'deployment-preview-id',
    details_url: 'https://dash.cloudflare.com/example',
    app: { slug: 'cloudflare-workers-and-pages' }
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('Cloudflare wait polls this exact SHA until the real Pages check succeeds', async () => {
  const responses = [
    jsonResponse({ check_runs: [] }),
    jsonResponse({ check_runs: [checkRun('in_progress')] }),
    jsonResponse({ check_runs: [checkRun('completed', 'success')] })
  ];
  let sleeps = 0;
  const result = await waitForCloudflareDeployment({
    repository: 'snowshagal-bot/market-research-site',
    sha: 'a'.repeat(40),
    token: 'test-token',
    fetchImpl: async () => responses.shift(),
    sleepImpl: async () => { sleeps += 1; },
    intervalMs: 0,
    maxAttempts: 3,
    logger: quiet
  });
  assert.equal(result.id, 'deployment-preview-id');
  assert.equal(result.headSha, 'a'.repeat(40));
  assert.equal(sleeps, 2);
});

test('Cloudflare wait fails immediately when the exact deployment check fails', async () => {
  await assert.rejects(
    waitForCloudflareDeployment({
      repository: 'snowshagal-bot/market-research-site',
      sha: 'a'.repeat(40),
      token: 'test-token',
      fetchImpl: async () => jsonResponse({ check_runs: [checkRun('completed', 'failure')] }),
      sleepImpl: async () => {},
      intervalMs: 0,
      maxAttempts: 3,
      logger: quiet
    }),
    /conclusion=failure/
  );
});

test('Cloudflare wait times out and never starts smoke when no deployment signal appears', async () => {
  let calls = 0;
  await assert.rejects(
    waitForCloudflareDeployment({
      repository: 'snowshagal-bot/market-research-site',
      sha: 'a'.repeat(40),
      token: 'test-token',
      fetchImpl: async () => { calls += 1; return jsonResponse({ check_runs: [] }); },
      sleepImpl: async () => {},
      intervalMs: 0,
      maxAttempts: 3,
      logger: quiet
    }),
    /Production smoke was not started/
  );
  assert.equal(calls, 3);
});

test('repository verification stays hermetic and deployment smoke is a separate bounded workflow', async () => {
  const verify = await readFile(new URL('../scripts/verify.mjs', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/deployment-smoke.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(verify, /smoke-site\.mjs|snowshagal\.com/);
  assert.match(workflow, /name:\s*Deployment Smoke/);
  assert.match(workflow, /push:[\s\S]*branches:[\s\S]*- main/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /checks:\s*read/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.ok(workflow.indexOf('wait-for-cloudflare-deployment.mjs') < workflow.indexOf('smoke-site.mjs'));
  assert.match(workflow, /--sha "\$\{\{ github\.sha \}\}"/);
});
