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
  const origin = 'https://admin-preview.market-research-site.pages.dev';
  return new Request(`${origin}/api/generate-cover`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...(key === null ? {} : { 'x-admin-key': key })
    },
    body: JSON.stringify(body)
  });
}

test('selector priority prefers metadata, then completed cover structures before outer wrappers', () => {
  assert.equal(__test.selectCaptureSelector('<meta name="report-cover-selector" content="#hero"><div class="cover-frame">x</div>'), '#hero');
  assert.equal(__test.selectCaptureSelector('<section class="cover-screen"><div class="cover-frame"><img class="cover-art"><div class="cover-copy">title</div></div><span class="cover-hint">hint</span></section>'), '.cover-frame');
  assert.equal(__test.selectCaptureSelector('<div class="cover-page">x</div><section class="cover-screen">y</section>'), '.cover-page');
  assert.equal(__test.selectCaptureSelector('<section class="mag-cover plate"><img class="cv-img" width="900" height="1350"><h1 class="cv-h1">반도체 다음의 자리</h1></section><div class="cover">unrelated</div>'), '.mag-cover');
  assert.deepEqual(__test.SELECTOR_PRIORITY, ['.cover-frame', '.cover-page', '.mag-cover', '.cover-screen', '.report-cover', '.cover', '.opener', '.cv']);
});

test('new Daily reports using .cvwrap and .cv select .cv as capture target', () => {
  const html = '<div class="cvwrap"><div class="cv"><img src="data:image/webp;base64,AA=="><div class="cv-copy"><div class="cv-h1">외국인 순매도 전환</div></div></div></div>';
  assert.equal(__test.selectCaptureSelector(html), '.cv');
});

test('Korean and English opener covers are accepted as Browser Rendering targets', () => {
  assert.equal(__test.selectCaptureSelector('<section class="opener" aria-label="표지"><img><h1>두 개의 착시</h1></section>'), '.opener');
  assert.equal(__test.selectCaptureSelector('<section class="opener" aria-label="Cover"><img><h1>Two Illusions</h1></section>'), '.opener');
});

test('date-suffixed standalone image covers are selected without relying on fixed dimensions', () => {
  const html = '<body><section class="final-cover-0824" aria-label="SnowShagal DAILY 커버"><img src="data:image/webp;base64,AA==" alt="선물의 무게"></section><main>report</main></body>';
  assert.equal(__test.standaloneImageCoverSelector(html), '.final-cover-0824');
  assert.equal(__test.selectCaptureSelector(html, 'body'), '.final-cover-0824');
  assert.equal(__test.safePreferredSelector(html, '.final-cover-0824'), '.final-cover-0824');
  assert.equal(__test.safePreferredSelector(html, 'body'), '');
});

test('standalone image cover is sent to Browser Rendering as its complete section', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<body><section class="final-cover-0824" aria-label="SnowShagal DAILY 커버"><img src="data:image/webp;base64,AA=="><a class="site-hit">site</a></section><main>report</main></body>';
    const response = await onRequestPost({ request: request({ html, preferredSelector: 'body' }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-cover-selector'), '.final-cover-0824');
    assert.equal(payload.selector, '.final-cover-0824');
    assert.deepEqual(payload.screenshotOptions, { type: 'png', captureBeyondViewport: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('opener capture sends the complete overlaid cover to Browser Rendering', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<section class="opener" aria-label="Cover"><img src="data:image/webp;base64,AA=="><div class="bot"><h1>Two Illusions</h1></div></section>';
    const response = await onRequestPost({ request: request({ html, preferredSelector: '.opener' }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-cover-selector'), '.opener');
    assert.equal(payload.selector, '.opener');
    assert.equal(payload.html, html);
    assert.deepEqual(payload.screenshotOptions, { type: 'png', captureBeyondViewport: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weekly reports using a section.cover root select the real cover instead of the template fallback', () => {
  const html = '<section class="cover cv" id="s0"><div class="cvwrap"><img class="cvart" width="900" height="1350"></div></section>';
  assert.equal(__test.selectCaptureSelector(html, '.cover'), '.cover');
});

test('completed weekly section.cover uses one full-bleed Browser Rendering clip', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<style>.cvwrap{position:relative;aspect-ratio:2/3}</style><div class="app"><section class="cover cv" id="s0"><div class="cvwrap"><img class="cvart" width="900" height="1350"></div></section></div>';
    const response = await onRequestPost({ request: request({ html, preferredSelector: '.cover' }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-cover-selector'), '.cover');
    assert.equal('selector' in payload, false);
    assert.equal(payload.html, html);
    assert.deepEqual(payload.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
    assert.match(payload.addStyleTag[0].content, /\.cover\.cv\{position:fixed!important/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('completed mag-cover captures the image and overlay copy as one full-bleed cover', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<section class="mag-cover plate" id="s0"><img class="cv-img" width="900" height="1350" src="data:image/webp;base64,AA=="><span class="cv-date">2026.08.10</span><h1 class="cv-h1">반도체 다음의 자리</h1><div class="cv-bottom">weekly details</div></section>';
    const response = await onRequestPost({ request: request({ html }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-cover-selector'), '.mag-cover');
    assert.equal('selector' in payload, false);
    assert.equal(payload.html, html);
    assert.deepEqual(payload.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
    assert.match(payload.addStyleTag[0].content, /\.mag-cover\.plate\{position:fixed!important/);
    assert.match(payload.html, /class="cv-h1"/);
    assert.match(payload.html, /class="cv-bottom"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('magazine capture plan derives the complete cover ratio from cv-img without selecting the image alone', () => {
  const html = '<section class="mag-cover plate"><img class="cv-img" width="900" height="1350"><h1 class="cv-h1">title</h1></section>';
  const plan = __test.magazineCoverCapturePlan(html, '.mag-cover');
  assert.deepEqual(plan.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
  assert.ok(__test.magazineCoverCapturePlan('<section class="plate mag-cover"><img class="cv-img" width="480" height="720"></section>', '.mag-cover'));
  assert.equal(__test.magazineCoverCapturePlan(html, '.cv-img'), null);
  assert.equal(__test.magazineCoverCapturePlan('<section class="mag-cover">generic</section>', '.mag-cover'), null);
});

test('new daily capture plan generates full-bleed 2:3 clip and fixed styling', () => {
  const html = '<div class="cvwrap"><div class="cv"><img src="data:image/webp;base64,AA=="><div class="cv-copy"><div class="cv-h1">외국인 순매도 전환</div></div></div></div>';
  const plan = __test.newDailyCoverCapturePlan(html, '.cv');
  assert.ok(plan);
  assert.deepEqual(plan.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
  assert.match(plan.addStyleTag[0].content, /\.cv\{position:fixed!important;inset:0 auto auto 0!important/);
  assert.match(plan.addStyleTag[0].content, /\.cvwrap\{width:480px!important/);
  assert.equal(__test.newDailyCoverCapturePlan('<div class="unrelated">test</div>', '.cv'), null);
});

test('new Daily .cv structure executes full-bleed Browser Rendering screenshot without body bleed', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<style>.cv{aspect-ratio:2/3}</style><div class="cvwrap"><div class="cv"><img src="data:image/webp;base64,AA=="><div class="cv-copy"><div class="cv-h1">외국인 순매도 전환, 코스피 숨고르기 장세</div></div></div></div><div class="page"><h1>본문 내용</h1></div>';
    const response = await onRequestPost({ request: request({ html }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-cover-selector'), '.cv');
    assert.equal('selector' in payload, false);
    assert.equal(payload.html, html);
    assert.deepEqual(payload.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
    assert.match(payload.addStyleTag[0].content, /\.cv\{position:fixed!important/);
    assert.match(payload.html, /class="cv-h1"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('non-weekly .cover candidates retain the general selector screenshot path', () => {
  assert.equal(__test.weeklyCoverCapturePlan('<section class="cover">generic</section>', '.cover'), null);
  assert.equal(__test.weeklyCoverCapturePlan('<style>.cvwrap{aspect-ratio:2/3}</style><section class="cover cv"><div class="cvwrap"></div></section>', '.cover').screenshotOptions.clip.height, 720);
});

test('raw HTML and selected cover-frame are sent to Cloudflare Browser Rendering', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const call = { url, options, payload: JSON.parse(options.body) };
    calls.push(call);
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const html = '<section class="cover-screen"><div class="cover-frame"><img class="cover-art" width="900" height="1350"><div class="cover-copy">title</div></div><span class="cover-hint">hint</span></section>';
    const response = await onRequestPost({ request: request({ html, preferredSelector: '.cover-screen' }), env: ENV });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-cover-selector'), '.cover-frame');
    assert.equal(calls.length, 1);
    const [screenshot] = calls;
    assert.ok(screenshot.options.signal instanceof AbortSignal);
    assert.equal(screenshot.options.signal.aborted, false);
    assert.match(screenshot.url, /accounts\/account-id\/browser-rendering\/screenshot$/);
    assert.equal(screenshot.options.headers.authorization, 'Bearer server-secret-token');
    assert.equal(screenshot.payload.html, html);
    assert.deepEqual(screenshot.payload.viewport, { width: 480, height: 900, deviceScaleFactor: 2 });
    assert.deepEqual(screenshot.payload.screenshotOptions, {
      type: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 480, height: 720, scale: 1 }
    });
    assert.match(screenshot.payload.addStyleTag[0].content, /\.cover-screen\{position:fixed!important;inset:0 auto auto 0!important/);
    assert.match(screenshot.payload.addStyleTag[0].content, /\.cover-frame\{width:480px!important/);
    assert.match(screenshot.payload.addStyleTag[0].content, /\.cover-hint\{display:none!important\}/);
    assert.equal('selector' in screenshot.payload, false);
    assert.equal('url' in screenshot.payload, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cover-frame capture plan derives its ratio from the complete cover art', () => {
  const plan = __test.coverFrameCapturePlan('<div class="cover-frame"><img class="cover-art extra" width="900" height="1350"><div class="cover-copy">title</div></div>', '.cover-frame');
  assert.deepEqual(plan.screenshotOptions.clip, { x: 0, y: 0, width: 480, height: 720, scale: 1 });
  assert.equal(__test.coverFrameCapturePlan('<div class="cover-frame">no sized art</div>', '.cover-frame'), null);
  assert.equal(__test.coverFrameCapturePlan('<img class="cover-art" width="900" height="1350">', '.cover-page'), null);
});

test('Cloudflare Quick Action rate limits are retried once before falling back', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.filter(call => call.url.endsWith('/screenshot')).length === 1) {
      return new Response(null, { status: 429, headers: { 'retry-after': '0' } });
    }
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const response = await onRequestPost({
      request: request({ html: '<div class="cover-frame"><img class="cover-art" width="900" height="1350">cover</div>' }),
      env: ENV
    });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
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

test('missing configuration and oversized HTML fail before Browser Rendering', async () => {
  const missing = await onRequestPost({ request: request({ html: '<div class="cover-frame">cover</div>' }), env: {} });
  assert.equal(missing.status, 503);

  const oversized = 'x'.repeat(__test.MAX_HTML_BYTES + 1);
  const response = await onRequestPost({ request: request({ html: oversized }), env: ENV });
  assert.equal(response.status, 413);
});
