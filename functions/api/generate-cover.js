const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 25000;
const DEFAULT_RATE_LIMIT_RETRY_MS = 10000;
const MAX_RATE_LIMIT_RETRY_MS = 15000;
const RENDER_VIEWPORT = { width: 480, height: 900 };
const SELECTOR_PRIORITY = ['.cover-frame', '.cover-page', '.cover-screen', '.report-cover'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function classExists(html, selector) {
  const className = selector.slice(1);
  const attributes = html.matchAll(/class\s*=\s*["']([^"']*)["']/gi);
  for (const match of attributes) {
    if (match[1].split(/\s+/).includes(className)) return true;
  }
  return false;
}

async function secretsMatch(left, right) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  if (leftBytes.length !== rightBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) mismatch |= leftBytes[index] ^ rightBytes[index];
  return mismatch === 0;
}

function declaredSelector(html) {
  const meta = html.match(/<meta\b[^>]*name\s*=\s*["']report-cover-selector["'][^>]*>/i)?.[0]
    || html.match(/<meta\b[^>]*content\s*=\s*["'][^"']+["'][^>]*name\s*=\s*["']report-cover-selector["'][^>]*>/i)?.[0];
  return meta?.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '';
}

function selectCaptureSelector(html, preferredSelector = '') {
  const declared = declaredSelector(html);
  if (declared) return declared;
  for (const selector of SELECTOR_PRIORITY) {
    if (classExists(html, selector)) return selector;
  }
  const preferred = String(preferredSelector || '').trim();
  return SELECTOR_PRIORITY.includes(preferred) ? preferred : '';
}

function sanitizedUpstreamError(status) {
  if (status === 401 || status === 403) return 'Browser Rendering 인증 설정을 확인해 주세요.';
  if (status === 429) return '커버 생성 요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  return 'Browser Rendering에서 커버를 생성하지 못했습니다.';
}

function renderingPayload(html, selector) {
  return {
    html,
    viewport: RENDER_VIEWPORT,
    waitForSelector: { selector, visible: true, timeout: 10000 },
    waitForTimeout: 250
  };
}

function tagAttribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || '';
}

function coverFrameCapturePlan(html, selector) {
  if (selector !== '.cover-frame') return null;
  const imageTag = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(match => match[0])
    .find(tag => tagAttribute(tag, 'class').split(/\s+/).includes('cover-art'));
  const sourceWidth = Number(tagAttribute(imageTag || '', 'width'));
  const sourceHeight = Number(tagAttribute(imageTag || '', 'height'));
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const captureHeight = RENDER_VIEWPORT.width * sourceHeight / sourceWidth;
  if (!Number.isFinite(captureHeight) || captureHeight < 80 || captureHeight > RENDER_VIEWPORT.height) return null;
  return {
    addStyleTag: [{
      content: `html,body{margin:0!important;padding:0!important;width:${RENDER_VIEWPORT.width}px!important;min-width:0!important;overflow:hidden!important}.cover-screen{position:fixed!important;inset:0 auto auto 0!important;width:${RENDER_VIEWPORT.width}px!important;max-width:none!important;min-height:0!important;margin:0!important;z-index:2147483647!important}.cover-frame{width:${RENDER_VIEWPORT.width}px!important;max-width:none!important;margin:0!important}.cover-hint{display:none!important}`
    }],
    screenshotOptions: {
      type: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: RENDER_VIEWPORT.width, height: captureHeight, scale: 1 }
    }
  };
}

async function fetchRendering(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function rateLimitRetryMs(response) {
  if (response.status !== 429) return null;
  const raw = response.headers.get('retry-after');
  if (!raw) return DEFAULT_RATE_LIMIT_RETRY_MS;
  const seconds = Number(raw);
  const wait = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(raw) - Date.now();
  if (!Number.isFinite(wait)) return DEFAULT_RATE_LIMIT_RETRY_MS;
  return Math.max(0, Math.min(wait + 250, MAX_RATE_LIMIT_RETRY_MS));
}

async function fetchRenderingWithRetry(url, options) {
  let response = await fetchRendering(url, options);
  const wait = rateLimitRetryMs(response);
  if (wait === null) return response;
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  response = await fetchRendering(url, options);
  return response;
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_KEY || !env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_BROWSER_RENDERING_TOKEN) {
    return json({ error: 'BROWSER_RENDERING_NOT_CONFIGURED', message: '커버 생성 서비스 설정이 필요합니다.' }, 503);
  }

  const suppliedKey = request.headers.get('x-admin-key') || '';
  if (!(await secretsMatch(suppliedKey, env.ADMIN_KEY))) {
    return json({ error: 'UNAUTHORIZED', message: '관리자 키가 올바르지 않습니다.' }, 401);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_HTML_BYTES + 4096) {
    return json({ error: 'HTML_TOO_LARGE', message: 'HTML 파일이 너무 큽니다.' }, 413);
  }

  let input;
  try { input = await request.json(); }
  catch (_) { return json({ error: 'BAD_JSON', message: '커버 생성 요청을 읽을 수 없습니다.' }, 400); }

  const html = typeof input?.html === 'string' ? input.html : '';
  if (!html.trim()) return json({ error: 'HTML_REQUIRED', message: 'HTML 원문이 필요합니다.' }, 400);
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
    return json({ error: 'HTML_TOO_LARGE', message: 'HTML 파일은 5MB 이하여야 합니다.' }, 413);
  }

  const selector = selectCaptureSelector(html, input?.preferredSelector);
  if (!selector) return json({ error: 'COVER_TARGET_NOT_FOUND', message: '캡처할 커버 영역을 찾지 못했습니다.' }, 422);

  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/browser-rendering`;
    const headers = {
      'authorization': `Bearer ${env.CLOUDFLARE_BROWSER_RENDERING_TOKEN}`,
      'content-type': 'application/json'
    };
    const framePlan = coverFrameCapturePlan(html, selector);
    const upstream = await fetchRenderingWithRetry(
      `${endpoint}/screenshot`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...renderingPayload(html, selector),
          viewport: { ...RENDER_VIEWPORT, deviceScaleFactor: 2 },
          ...(framePlan || {
            selector,
            screenshotOptions: { type: 'png', captureBeyondViewport: true }
          })
        })
      }
    );

    if (!upstream.ok) {
      return json({ error: 'BROWSER_RENDERING_FAILED', message: sanitizedUpstreamError(upstream.status) }, 502);
    }
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['image/png', 'image/webp'].includes(contentType)) {
      return json({ error: 'INVALID_RENDER_RESPONSE', message: '커버 이미지 응답 형식이 올바르지 않습니다.' }, 502);
    }
    const bytes = await upstream.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
      return json({ error: 'INVALID_RENDER_SIZE', message: '생성된 커버 이미지 크기가 올바르지 않습니다.' }, 502);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-length': String(bytes.byteLength),
        'cache-control': 'no-store',
        'x-cover-selector': selector
      }
    });
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    return json({
      error: timeout ? 'BROWSER_RENDERING_TIMEOUT' : 'BROWSER_RENDERING_FAILED',
      message: timeout ? '커버 생성 확인이 지연되고 있습니다.' : '커버 생성 서비스에 연결하지 못했습니다.'
    }, timeout ? 504 : 502);
  }
}

export const __test = {
  MAX_HTML_BYTES,
  MAX_IMAGE_BYTES,
  RENDER_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_RETRY_MS,
  MAX_RATE_LIMIT_RETRY_MS,
  RENDER_VIEWPORT,
  SELECTOR_PRIORITY,
  coverFrameCapturePlan,
  fetchRendering,
  fetchRenderingWithRetry,
  rateLimitRetryMs,
  renderingPayload,
  declaredSelector,
  selectCaptureSelector
};
