import { FAVICON_TAGS, PRODUCTION_ORIGIN, findPostByPath, loadPosts, reportSeoTags } from './_seo.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const isProduction = url.hostname === new URL(PRODUCTION_ORIGIN).hostname;
  let response = await context.next();

  if (!isProduction) {
    const headers = new Headers(response.headers);
    headers.set('x-robots-tag', 'noindex, nofollow');
    response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  // Preserve Pages redirects and real error responses. In particular, a missing
  // report must keep the root 404 page/status instead of receiving report UI.
  if (!response.ok) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const engagement = isProduction && !/^\/(?:admin|api|cdn-cgi)(?:\/|$)/i.test(url.pathname)
    ? '<script src="/assets/engagement.js?v=20260826-1" defer></script>'
    : '';

  if (!url.pathname.startsWith('/reports/')) {
    if (!engagement) return response;
    if (typeof HTMLRewriter === 'undefined') {
      const body = await response.text();
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return new Response(body.replace(/<\/body>/i, `${engagement}</body>`), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }
    return new HTMLRewriter()
      .on('body', { element(element) { element.append(engagement, { html: true }); } })
      .transform(response);
  }

  let decodedPath = url.pathname;
  try { decodedPath = decodeURIComponent(url.pathname); } catch (_) {}

  let active = '';
  const lang = /^\/reports\/en\//i.test(url.pathname) ? 'en' : 'ko';
  if (/시장\s*공부|경제\s*공부|주식\s*공부|market[\s_-]*basics|investing[\s_-]*basics|explainer/i.test(decodedPath)) active = 'basics';
  else if (/주식리포트|데일리|daily/i.test(decodedPath)) active = 'daily';
  else if (/위클리|weekly/i.test(decodedPath)) active = 'weekly';
  else if (/비정기|소버린|research/i.test(decodedPath)) active = 'research';
  else if (/끄적|note/i.test(decodedPath)) active = 'note';

  const shell = `<script src="/assets/locale.js?v=20260824-2"></script><script src="/assets/report-shell.js?v=20260827-1" data-category="${active}" data-lang="${lang}"></script>${engagement}`;
  let seo = '';
  try {
    const posts = await loadPosts(context.request, context.env);
    const post = findPostByPath(posts, url.pathname);
    if (post) seo = reportSeoTags(posts, post);
  } catch (_) {}

  return new HTMLRewriter()
    .on('link[rel="canonical"]', { element(element) { element.remove(); } })
    .on('link[rel="alternate"][hreflang]', { element(element) { element.remove(); } })
    .on('meta[name="description"]', { element(element) { if (seo) element.remove(); } })
    .on('meta[property^="og:"]', { element(element) { if (seo) element.remove(); } })
    .on('meta[name^="twitter:"]', { element(element) { if (seo) element.remove(); } })
    // Uploaded report HTML carries no icon of its own.
    .on('link[rel~="icon"]', { element(element) { element.remove(); } })
    .on('link[rel="apple-touch-icon"]', { element(element) { element.remove(); } })
    .on('link[rel="manifest"]', { element(element) { element.remove(); } })
    .on('head', { element(element) { element.append(`${FAVICON_TAGS}${seo}`, { html: true }); } })
    .on('body', {
      element(element) {
        element.append(shell, { html: true });
      }
    })
    .transform(response);
}

export const __test = { findPostByPath, reportSeoTags };
