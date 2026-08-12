import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { __test, onRequestPost } from '../functions/api/generate-cover.js';

const ENV = {
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_BROWSER_RENDERING_TOKEN: 'server-secret-token'
};

function request(body) {
  return new Request('https://preview.example/api/generate-cover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('selector priority prefers metadata, then cover-frame before outer wrappers', () => {
  assert.equal(__test.selectCaptureSelector('<meta name="report-cover-selector" content="#hero"><div class="cover-frame">x</div>'), '#hero');
  assert.equal(__test.selectCaptureSelector('<section class="cover-screen"><div class="cover-frame">x</div></section>'), '.cover-frame');
  assert.equal(__test.selectCaptureSelector('<div class="cover-page">x</div><section class="cover-screen">y</section>'), '.cover-page');
  assert.deepEqual(__test.SELECTOR_PRIORITY, ['.cover-frame', '.cover-page', '.cover-screen', '.report-cover']);
});

test('raw HTML and selected cover-frame are sent to Cloudflare Browser Rendering', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options, payload: JSON.parse(options.body) };
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<section class="cover-screen"><div class="cover-frame"><img class="cover-art"><div class="cover-copy">title</div></div><span class="cover-hint">hint</span></section>';
    const response = await onRequestPost({ request: request({ html, preferredSelector: '.cover-screen' }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-cover-selector'), '.cover-frame');
    assert.match(call.url, /accounts\/account-id\/browser-rendering\/screenshot$/);
    assert.equal(call.options.headers.authorization, 'Bearer server-secret-token');
    assert.equal(call.payload.html, html);
    assert.equal(call.payload.selector, '.cover-frame');
    assert.deepEqual(call.payload.viewport, { width: 480, height: 900, deviceScaleFactor: 2 });
    assert.equal(call.payload.screenshotOptions.type, 'png');
    assert.equal('url' in call.payload, false);
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

test('missing configuration and oversized HTML fail before Browser Rendering', async () => {
  const missing = await onRequestPost({ request: request({ html: '<div class="cover-frame">cover</div>' }), env: {} });
  assert.equal(missing.status, 503);

  const oversized = 'x'.repeat(__test.MAX_HTML_BYTES + 1);
  const response = await onRequestPost({ request: request({ html: oversized }), env: ENV });
  assert.equal(response.status, 413);
});
