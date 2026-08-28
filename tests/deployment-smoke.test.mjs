import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SmokeFailure, normalizeLocationHeader, runSmoke } from '../scripts/smoke-site.mjs';
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

const marketPayload = {
  meta: {
    market_date: '2026-08-29',
    generated_at: '2026-08-29T01:00:00Z',
    schema_version: '1.0.1',
    status: 'final'
  },
  indices: { KOSPI: { close: 1 } },
  validation: { passed: true, errors: [] }
};

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
      response.end(html(`https://snowshagal.com${pathname}`));
      return;
    }
    if (pathname === '/reports/ko-smoke.html' || pathname === '/reports/en/en-smoke.html') {
      const clean = options.wrongRedirect ? '/wrong-report' : pathname.replace(/\.html$/, '');
      response.writeHead(308, { location: clean });
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
        response.end(options.invalidJson ? '{broken' : JSON.stringify(marketPayload));
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
      runSmoke({ origin, mode: options.noindex ? 'preview' : 'production', posts, logger: quiet, enforceOrigin: false }),
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

test('deployment smoke accepts valid 200 pages, 308 redirects, 404, sitemap, and API JSON', async () => {
  await withServer({}, async origin => {
    const result = await runSmoke({ origin, mode: 'production', posts, logger: quiet, enforceOrigin: false });
    assert.equal(result.failed, 0);
    assert.equal(result.passed, result.total);
    assert.equal(result.total, 20);
  });
});

test('Preview mode requires and accepts the existing noindex policy', async () => {
  await withServer({ noindex: true }, async origin => {
    const result = await runSmoke({ origin, mode: 'preview', posts, logger: quiet });
    assert.equal(result.failed, 0);
  });
});

test('deployment smoke rejects an unexpected page 500', async () => {
  await expectFailure({ page500: true }, 'category /weekly/', /expected HTTP 200, received 500/);
});

test('deployment smoke rejects a wrong legacy redirect destination', async () => {
  await expectFailure({ wrongRedirect: true }, 'legacy KO report redirect', /expected redirect/);
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

test('deployment smoke rejects comments GET 503 instead of treating a missing binding as PASS', async () => {
  await expectFailure({ noindex: true, comments503: true }, 'comments read API', /expected HTTP 200, received 503/);
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
