const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 25000;
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classExists(html, selector) {
  const className = selector.slice(1);
  const attributes = html.matchAll(/class\s*=\s*["']([^"']*)["']/gi);
  for (const match of attributes) {
    if (match[1].split(/\s+/).includes(className)) return true;
  }
  return false;
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

export async function onRequestPost({ request, env }) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_BROWSER_RENDERING_TOKEN) {
    return json({ error: 'BROWSER_RENDERING_NOT_CONFIGURED', message: '커버 생성 서비스 설정이 필요합니다.' }, 503);
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/browser-rendering/screenshot`,
      {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${env.CLOUDFLARE_BROWSER_RENDERING_TOKEN}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          html,
          selector,
          viewport: { width: 480, height: 900, deviceScaleFactor: 2 },
          waitForSelector: { selector, visible: true, timeout: 10000 },
          waitForTimeout: 250,
          screenshotOptions: { type: 'png', captureBeyondViewport: true }
        }),
        signal: controller.signal
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
  } finally {
    clearTimeout(timer);
  }
}

export const __test = {
  MAX_HTML_BYTES,
  MAX_IMAGE_BYTES,
  RENDER_TIMEOUT_MS,
  SELECTOR_PRIORITY,
  declaredSelector,
  selectCaptureSelector
};
