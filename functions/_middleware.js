import {
  FAVICON_TAGS,
  CATEGORY_SLUGS,
  categoryAlternateTags,
  categoryHasPosts,
  categoryLandingFromPath,
  categoryFeaturedCards,
  categoryArchiveLinks,
  categoryReportLinks,
  findPostByPath,
  homepageLatestLinks,
  homepageReportLinks,
  loadPosts,
  postLanguage,
  normalizeSitePath,
  reportSeoTags
} from './_seo.js';
import {
  ADMIN_CSP,
  HOST_CLASS,
  adminHostRouteDecision,
  apexAdminRouteDecision,
  classifyHost,
  isAdminHost,
  isAdminUiPath
} from './_host-policy.js';

function policyResponse(status, error) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
}

function withAdminHeaders(response, { html = false } = {}) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store, max-age=0');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-robots-tag', 'noindex, nofollow');
  if (html) headers.set('content-security-policy', ADMIN_CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function replaceElementContentsById(body, id, markup) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(<[^>]+id=["']${escaped}["'][^>]*>)[\\s\\S]*?(<\\/[^>]+>)`, 'i');
  return body.replace(pattern, `$1${markup}$2`);
}

function removeCategoryNavLinks(body, types) {
  return types.reduce((html, type) => {
    const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<a\\b(?=[^>]*\\bdata-nav-category=["']${escaped}["'])[^>]*>[\\s\\S]*?<\\/a>`, 'gi');
    return html.replace(pattern, '');
  }, body);
}

function replaceCategoryAlternates(body, markup) {
  const withoutAlternates = body.replace(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\bhreflang=["'][^"']+["'])[^>]*>/gi, '');
  return markup ? withoutAlternates.replace(/<\/head>/i, `${markup}</head>`) : withoutAlternates;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const hostClass = classifyHost(url);
  const isProduction = hostClass === HOST_CLASS.PUBLIC_PRODUCTION;
  const adminDecision = adminHostRouteDecision(context.request);
  if (adminDecision.action === 'deny') return policyResponse(adminDecision.status, 'ADMIN_HOST_PATH_BLOCKED');
  const apexDecision = apexAdminRouteDecision(context.request);
  if (apexDecision.action === 'deny') return policyResponse(apexDecision.status, 'APEX_ADMIN_BLOCKED');
  if (apexDecision.action === 'redirect') {
    return new Response(null, {
      status: apexDecision.status,
      headers: { location: apexDecision.location, 'cache-control': 'private, no-store, max-age=0' }
    });
  }
  let response = await context.next();

  if (isAdminHost(url)) {
    const contentType = response.headers.get('content-type') || '';
    response = withAdminHeaders(response, {
      html: isAdminUiPath(url.pathname) && contentType.includes('text/html')
    });
  }

  if (!isProduction && !isAdminHost(url)) {
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
    ? '<script src="/assets/engagement.js?v=4fd1735fcd" defer></script>'
    : '';

  if (!url.pathname.startsWith('/reports/')) {
    const homeLang = url.pathname === '/' ? 'ko' : (/^\/en\/?$/.test(url.pathname) ? 'en' : '');
    const landing = categoryLandingFromPath(url.pathname);
    let posts = null;
    if ((homeLang || landing) && context.env?.ASSETS?.fetch) {
      try { posts = await loadPosts(context.request, context.env); } catch (_) {}
    }

    const pageLang = homeLang || landing?.lang || '';
    const unavailableCategories = posts && pageLang
      ? Object.keys(CATEGORY_SLUGS).filter((type) => !categoryHasPosts(posts, type, pageLang))
      : [];
    const landingAlternates = posts && landing ? categoryAlternateTags(posts, landing.type) : '';
    if (isProduction && posts && landing && !categoryHasPosts(posts, landing.type, landing.lang)) {
      const headers = new Headers(response.headers);
      headers.set('x-robots-tag', 'noindex, follow');
      response = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    if (!engagement && !posts) return response;
    if (typeof HTMLRewriter === 'undefined') {
      let body = await response.text();
      if (posts && homeLang) {
        body = replaceElementContentsById(body, 'latest-category-cards', homepageLatestLinks(posts, homeLang));
        body = replaceElementContentsById(body, 'report-list', homepageReportLinks(posts, homeLang));
      }
      if (posts && landing) {
        const categoryPosts = (Array.isArray(posts) ? posts : [])
          .filter((p) => postLanguage(p) === landing.lang && p?.type === landing.type && normalizeSitePath(p?.href));
        body = replaceElementContentsById(body, 'category-featured-cards', categoryFeaturedCards(posts, landing.type, landing.lang));
        body = replaceElementContentsById(body, 'category-report-list', categoryArchiveLinks(posts, landing.type, landing.lang));
        if (categoryPosts.length <= 2) {
          body = body.replace(/(<section\b[^>]*\bid=["']category-archive-section["'][^>]*)/i, '$1 hidden');
        }
        if (categoryPosts.length === 0) {
          body = body.replace(/(<section\b[^>]*\bid=["']category-featured-section["'][^>]*)/i, '$1 hidden');
        }
        body = replaceCategoryAlternates(body, landingAlternates);
      }
      if (posts && pageLang) body = removeCategoryNavLinks(body, unavailableCategories);
      if (engagement) body = body.replace(/<\/body>/i, `${engagement}</body>`);
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    let rewriter = new HTMLRewriter();
    if (posts && homeLang) {
      const latest = homepageLatestLinks(posts, homeLang);
      const archive = homepageReportLinks(posts, homeLang);
      rewriter = rewriter
        .on('#latest-category-cards', { element(element) { element.setInnerContent(latest, { html: true }); } })
        .on('#report-list', { element(element) { element.setInnerContent(archive, { html: true }); } });
    }
    if (posts && landing) {
      const categoryPosts = (Array.isArray(posts) ? posts : [])
        .filter((p) => postLanguage(p) === landing.lang && p?.type === landing.type && normalizeSitePath(p?.href));
      const featuredCards = categoryFeaturedCards(posts, landing.type, landing.lang);
      const archiveLinks = categoryArchiveLinks(posts, landing.type, landing.lang);
      rewriter = rewriter
        .on('#category-featured-cards', {
          element(element) { element.setInnerContent(featuredCards, { html: true }); }
        })
        .on('#category-report-list', {
          element(element) { element.setInnerContent(archiveLinks, { html: true }); }
        })
        .on('link[rel="alternate"][hreflang]', { element(element) { element.remove(); } })
        .on('head', { element(element) { if (landingAlternates) element.append(landingAlternates, { html: true }); } });
      if (categoryPosts.length <= 2) {
        rewriter = rewriter.on('#category-archive-section', {
          element(element) { element.setAttribute('hidden', ''); }
        });
      }
      if (categoryPosts.length === 0) {
        rewriter = rewriter.on('#category-featured-section', {
          element(element) { element.setAttribute('hidden', ''); }
        });
      }
    }
    for (const type of unavailableCategories) {
      rewriter = rewriter.on(`[data-nav-category="${type}"]`, {
        element(element) { element.remove(); }
      });
    }
    if (engagement) {
      rewriter = rewriter.on('body', { element(element) { element.append(engagement, { html: true }); } });
    }
    return rewriter.transform(response);
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

  let hasNotes = false;
  let seo = '';
  try {
    const posts = await loadPosts(context.request, context.env);
    const post = findPostByPath(posts, url.pathname);
    if (post) seo = reportSeoTags(posts, post);
    // Scoped to the report's own language, so the fixed nav matches the
    // homepage a reader would land on.
    hasNotes = posts.some((candidate) => (
      candidate?.type === 'note' && (candidate?.lang === 'en' ? 'en' : 'ko') === lang
    ));
  } catch (_) {}

  // Built after the post data is read so the shell knows whether 끄적끄적 has
  // anything in it, and the fixed report nav matches the homepage.
  const shell = `<script src="/assets/locale.js?v=3b5552cdd4"></script><script src="/assets/report-shell.js?v=5d566fd0c8" data-category="${active}" data-lang="${lang}" data-notes="${hasNotes ? '1' : '0'}"></script>${engagement}`;

  return new HTMLRewriter()
    .on('title', { element(element) { if (seo) element.remove(); } })
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
