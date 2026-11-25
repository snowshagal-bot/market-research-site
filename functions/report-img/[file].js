import { IMAGE_MIME, findReportImage } from '../_report-images.js';

// /report-img/<hash>.<ext>?r=<report path>: one large image of an uploaded
// report, which the middleware moved out of the page (functions/_report-images.js).
// The report file is the only source:
// - the image is the one whose base64 hashes to <hash>;
// - a changed report gets new hashes, so an address never serves other bytes;
// - the response is cached as immutable, in the browser and at the edge.
const FILE = /^([0-9a-f]{16})\.(webp|jpg|png|gif)$/;
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** A report page path as the middleware writes it: under /reports/, nothing else. */
export function isReportPath(value) {
  const path = String(value || '');
  return path.length > 9 && path.length <= 600
    && path.startsWith('/reports/')
    && !/[?#\\]|\/\/|(?:^|\/)\.{1,2}(?:\/|$)|%2e%2e|%2f|%5c/i.test(path);
}

function notFound() {
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const match = FILE.exec(String(params?.file || ''));
  const report = url.searchParams.get('r') || '';
  if (!match || !isReportPath(report) || !env?.ASSETS?.fetch) return notFound();

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(request).catch(() => null);
    if (hit) return hit;
  }

  let page;
  try { page = await env.ASSETS.fetch(new Request(new URL(report, url))); } catch (_) { return notFound(); }
  if (!page.ok || !String(page.headers.get('content-type') || '').includes('text/html')) return notFound();
  const found = await findReportImage(await page.text(), match[1]);
  if (!found || IMAGE_MIME[match[2]] !== found.mime) return notFound();

  const response = new Response(found.bytes, {
    headers: {
      'content-type': found.mime,
      'cache-control': IMMUTABLE,
      'x-content-type-options': 'nosniff'
    }
  });
  if (cache) {
    const stored = cache.put(request, response.clone()).catch(() => null);
    if (typeof context.waitUntil === 'function') context.waitUntil(stored);
  }
  return response;
}

export const onRequestHead = onRequestGet;
