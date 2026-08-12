import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { __test, onRequestPost } from '../functions/api/generate-cover.js';

const ENV = {
  ADMIN_KEY: 'test-admin-key',
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_BROWSER_RENDERING_TOKEN: 'server-secret-token'
};

function request(body, key = ENV.ADMIN_KEY) {
  return new Request('https://preview.example/api/generate-cover', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key === null ? {} : { 'x-admin-key': key })
    },
    body: JSON.stringify(body)
  });
}

test('selector priority prefers metadata, then cover-frame before outer wrappers', () => {
  assert.equal(__test.selectCaptureSelector('<meta name="report-cover-selector" content="#hero"><div class="cover-frame">x</div>'), '#hero');
  assert.equal(__test.selectCaptureSelector('<section class="cover-screen"><div class="cover-frame"><img class="cover-art"><div class="cover-copy">title</div></div><span class="cover-hint">hint</span></section>'), '.cover-frame');
  assert.equal(__test.selectCaptureSelector('<div class="cover-page">x</div><section class="cover-screen">y</section>'), '.cover-page');
  assert.deepEqual(__test.SELECTOR_PRIORITY, ['.cover-frame', '.cover-page', '.cover-screen', '.report-cover']);
});

test('raw HTML and selected cover-frame are sent to Cloudflare Browser Rendering', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const call = { url, options, payload: JSON.parse(options.body) };
    calls.push(call);
    if (url.endsWith('/scrape')) {
      return Response.json({
        success: true,
        result: [{
          selector: '.cover-frame',
          results: [{ left: 0, top: 0, width: 465, height: 697.5 }]
        }]
      });
    }
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<section class="cover-screen"><div class="cover-frame"><img class="cover-art"><div class="cover-copy">title</div></div><span class="cover-hint">hint</span></section>';
    const response = await onRequestPost({ request: request({ html, preferredSelector: '.cover-screen' }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-cover-selector'), '.cover-frame');
    assert.equal(calls.length, 2);
    const [scrape, screenshot] = calls;
    assert.ok(scrape.options.signal instanceof AbortSignal);
    assert.ok(screenshot.options.signal instanceof AbortSignal);
    assert.notEqual(scrape.options.signal, screenshot.options.signal);
    assert.equal(scrape.options.signal.aborted, false);
    assert.equal(screenshot.options.signal.aborted, false);
    assert.match(scrape.url, /accounts\/account-id\/browser-rendering\/scrape$/);
    assert.deepEqual(scrape.payload.elements, [{ selector: '.cover-frame' }]);
    assert.equal(scrape.options.headers.authorization, 'Bearer server-secret-token');
    assert.equal(scrape.payload.html, html);
    assert.deepEqual(scrape.payload.viewport, { width: 480, height: 900 });
    assert.equal('deviceScaleFactor' in scrape.payload.viewport, false);

    assert.match(screenshot.url, /accounts\/account-id\/browser-rendering\/screenshot$/);
    assert.equal(screenshot.options.headers.authorization, 'Bearer server-secret-token');
    assert.equal(screenshot.payload.html, html);
    assert.deepEqual(screenshot.payload.viewport, { width: 480, height: 900, deviceScaleFactor: 2 });
    assert.deepEqual(screenshot.payload.screenshotOptions, {
      type: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 465, height: 697.5, scale: 1 }
    });
    assert.equal('selector' in screenshot.payload, false);
    assert.equal('url' in screenshot.payload, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('capture geometry accepts Cloudflare scrape shapes and rejects unsafe dimensions', () => {
  assert.deepEqual(
    __test.captureGeometry({ result: [{ selector: '.cover-frame', results: { left: 7.5, top: 2, width: 465, height: 697.5 } }] }, '.cover-frame'),
    { x: 7.5, y: 2, width: 465, height: 697.5 }
  );
  assert.deepEqual(
    __test.captureGeometry([{ selector: '.cover-frame', results: [{ left: 0, top: 0, width: 480, height: 720 }] }], '.cover-frame'),
    { x: 0, y: 0, width: 480, height: 720 }
  );
  assert.equal(__test.captureGeometry({ result: [{ selector: '.cover-frame', results: { left: -1, top: 0, width: 480, height: 720 } }] }, '.cover-frame'), null);
  assert.equal(__test.captureGeometry({ result: [{ selector: '.cover-frame', results: { left: 0, top: 0, width: 5000, height: 720 } }] }, '.cover-frame'), null);
});

test('Cloudflare Quick Action rate limits are retried once before falling back', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/scrape')) {
      return Response.json({
        success: true,
        result: [{ selector: '.cover-frame', results: { left: 0, top: 0, width: 480, height: 720 } }]
      });
    }
    if (calls.filter(call => call.url.endsWith('/screenshot')).length === 1) {
      return new Response(null, { status: 429, headers: { 'retry-after': '0' } });
    }
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const response = await onRequestPost({
      request: request({ html: '<div class="cover-frame">cover</div>' }),
      env: ENV
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.equal(calls.filter(call => call.url.endsWith('/scrape')).length, 1);
    assert.equal(calls.filter(call => call.url.endsWith('/screenshot')).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rate-limit retry delay is bounded and defaults to the Free-plan interval', () => {
  assert.equal(__test.rateLimitRetryMs(new Response(null, { status: 200 })), null);
  assert.equal(__test.rateLimitRetryMs(new Response(null, { status: 429 })), __test.DEFAULT_RATE_LIMIT_RETRY_MS);
  assert.equal(__test.rateLimitRetryMs(new Response(null, { status: 429, headers: { 'retry-after': '0' } })), 250);
  assert.equal(__test.rateLimitRetryMs(new Response(null, { status: 429, headers: { 'retry-after': '60' } })), __test.MAX_RATE_LIMIT_RETRY_MS);
});

test('missing and incorrect admin authentication are rejected before Browser Rendering', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(); };
  try {
    for (const [key, label] of [[null, 'missing'], ['wrong-key', 'incorrect']]) {
      const response = await onRequestPost({
        request: request({ html: '<div class="cover-frame">cover</div>' }, key),
        env: ENV
      });
      assert.equal(response.status, 401, label);
      assert.equal((await response.json()).error, 'UNAUTHORIZED', label);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare errors are sanitized and secrets remain server-only', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('sensitive upstream details', { status: 403 });
  try {
    const response = await onRequestPost({ request: request({ html: '<div class="cover-frame">cover</div>' }), env: ENV });
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.error, 'BROWSER_RENDERING_FAILED');
    assert.doesNotMatch(JSON.stringify(data), /sensitive upstream details|server-secret-token/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const [generator, admin, html] = await Promise.all([
    readFile(new URL('../assets/cover-generator.js', import.meta.url), 'utf8'),
    readFile(new URL('../assets/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../admin/index.html', import.meta.url), 'utf8')
  ]);
  for (const client of [generator, admin, html]) {
    assert.doesNotMatch(client, /CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_BROWSER_RENDERING_TOKEN|server-secret-token/);
  }
});

test('invalid scrape geometry stops before the screenshot request', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ success: true, result: [{ selector: '.cover-frame', results: [] }] });
  };
  try {
    const response = await onRequestPost({ request: request({ html: '<div class="cover-frame">cover</div>' }), env: ENV });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'INVALID_CAPTURE_GEOMETRY');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('missing configuration and oversized HTML fail before Browser Rendering', async () => {
  const missing = await onRequestPost({ request: request({ html: '<div class="cover-frame">cover</div>' }), env: {} });
  assert.equal(missing.status, 503);

  const oversized = 'x'.repeat(__test.MAX_HTML_BYTES + 1);
  const response = await onRequestPost({ request: request({ html: oversized }), env: ENV });
  assert.equal(response.status, 413);
});
