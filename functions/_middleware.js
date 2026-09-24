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
  loadTags,
  postLanguage,
  normalizeSitePath,
  reportSeoTags,
  siteFooter,
  footerCss,
  serializeTagRegistryBootstrap
} from './_seo.js';
import {
  ADMIN_CSP,
  HOST_CLASS,
  adminHostRouteDecision,
  apexAdminRouteDecision,
  classifyHost,
  isAdminHost,
  isHumanAdminHost,
  isAdminUiPath
} from './_host-policy.js';
import { feedDiscoveryTag } from './_feed.js';
import { loadReportFacts } from './_report-facts.js';
import { applyInitialHtmlToRewriter, applyInitialHtmlToString, buildInitialHtml } from './_initial-html.js';
import { buildHomeInitial } from './_home-initial.js';
import { getSession, validateSafeNextUrl } from './_auth.js';

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


/**
 * Attributes of one start tag's source (everything between the tag name and
 * `>`), as the HTML parser sees them: names lower-cased, values unquoted
 * (double, single or none), a bare attribute as ''. Values keep their case,
 * as the HTMLRewriter attribute selectors compare them.
 */
export function tagAttributes(source) {
  const attrs = {};
  for (const match of String(source).matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attrs;
}

/** `rel` as the whitespace-separated token list `[rel~="…"]` matches against. */
export function relTokens(attrs) {
  return String(attrs.rel ?? '').split(/\s+/).filter(Boolean);
}

/**
 * Drops every <name …> start tag whose attributes satisfy `predicate`,
 * whatever the attribute order or quoting — the string-path counterpart of
 * removing the elements an HTMLRewriter selector matches (used for the void
 * <meta> and <link> elements).
 */
export function removeTags(body, name, predicate) {
  const pattern = new RegExp(`<${name}\\b((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'gi');
  return body.replace(pattern, (whole, source) => (predicate(tagAttributes(source)) ? '' : whole));
}

/**
 * The string-path equivalent of HTMLRewriter's setAttribute('lang') on <html>:
 * replaces a double-, single- or un-quoted lang on the first <html> tag, or
 * adds one when there is none. xml:lang and other attributes are left alone.
 */
export function setHtmlLang(body, lang) {
  return body.replace(/<html\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i, (whole, attributes) => {
    const existing = /(\s)lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i;
    const next = existing.test(attributes)
      ? attributes.replace(existing, `$1lang="${lang}"`)
      : ` lang="${lang}"${attributes}`;
    return `<html${next}>`;
  });
}

function replaceCategoryAlternates(body, markup) {
  const withoutAlternates = body.replace(/<link\b(?=[^>]*\brel=["']alternate["'])(?=[^>]*\bhreflang=["'][^"']+["'])[^>]*>/gi, '');
  return markup ? withoutAlternates.replace(/<\/head>/i, `${markup}</head>`) : withoutAlternates;
}

const LEGACY_REPORT_HTML = /^\/reports\/.+\.html$/i;

// /reports/<path>.html → 301 /reports/<path>(?query). Pages answers an existing
// report's .html with its own 308 and a missing one with 404; only that 308 (or a
// file served directly with 200) is upgraded, so missing reports keep their direct
// 404 and any other redirect keeps its own status and Location. url.pathname is
// already percent-encoded, so Hangul paths are not encoded twice.
export function legacyReportHtmlRedirect(request, url, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  if (!LEGACY_REPORT_HTML.test(url.pathname)) return null;
  if (!(response.ok || response.status === 308)) return null;
  return new Response(null, {
    status: 301,
    headers: {
      location: `${url.origin}${url.pathname.replace(/\.html$/i, '')}${url.search}`,
      'cache-control': 'public, max-age=3600'
    }
  });
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

  if (isHumanAdminHost(url) && isAdminUiPath(url.pathname)) {
    const isLoginPath = url.pathname === '/admin/login' || url.pathname === '/admin/login/';
    const session = await getSession(context.request, context.env);
    const isAdmin = Boolean(session?.authenticated && session?.user?.role === 'admin');

    if (isLoginPath) {
      if (isAdmin) {
        const nextTarget = validateSafeNextUrl(url.searchParams.get('next'));
        return new Response(null, {
          status: 302,
          headers: { location: nextTarget, 'cache-control': 'private, no-store, max-age=0' }
        });
      }
    } else {
      if (!isAdmin) {
        const nextParam = url.pathname + url.search;
        const loginUrl = `/admin/login/?next=${encodeURIComponent(nextParam)}`;
        return new Response(null, {
          status: 302,
          headers: { location: loginUrl, 'cache-control': 'private, no-store, max-age=0' }
        });
      }
    }
  }

  let response = await context.next();

  const legacyReportRedirect = legacyReportHtmlRedirect(context.request, url, response);
  if (legacyReportRedirect) return legacyReportRedirect;

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
    let tags = null;
    if ((homeLang || landing) && context.env?.ASSETS?.fetch) {
      try {
        [posts, tags] = await Promise.all([
          loadPosts(context.request, context.env),
          loadTags(context.request, context.env)
        ]);
      } catch (_) {
        try { posts = await loadPosts(context.request, context.env); } catch (_) {}
      }
    }

    // /disclosures/ and /calendar/ (KO/EN): the filings and trading days the
    // page scripts render, rendered into the HTTP response itself. Null when
    // the page is not one of those, or on any failure or timeout, in which case
    // the static shell is served untouched and the scripts fill it as before.
    const initial = await buildInitialHtml(url, context.env);
    // / and /en/: Latest Research, the active notice and the TODAY strip, from
    // the same handlers the page script calls, plus a bootstrap so the script
    // does not request them again. Null on any failure: the shell is served as
    // before and the script fetches everything itself.
    const home = homeLang ? await buildHomeInitial(url, context.env, posts) : null;

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

    if (!engagement && !posts && !initial && !home) return response;
    if (typeof HTMLRewriter === 'undefined') {
      let body = await response.text();
      if (posts && homeLang) {
        body = replaceElementContentsById(body, 'latest-category-cards', homepageLatestLinks(posts, homeLang, tags));
        body = replaceElementContentsById(body, 'report-list', homepageReportLinks(posts, homeLang));
      }
      if (posts && landing) {
        const categoryPosts = (Array.isArray(posts) ? posts : [])
          .filter((p) => postLanguage(p) === landing.lang && p?.type === landing.type && normalizeSitePath(p?.href));
        body = replaceElementContentsById(body, 'category-featured-cards', categoryFeaturedCards(posts, landing.type, landing.lang, tags));
        body = replaceElementContentsById(body, 'category-report-list', categoryArchiveLinks(posts, landing.type, landing.lang));
        if (categoryPosts.length <= 2) {
          body = body.replace(/(<section\b[^>]*\bid=["']category-archive-section["'][^>]*)/i, '$1 hidden');
        }
        if (categoryPosts.length === 0) {
          body = body.replace(/(<section\b[^>]*\bid=["']category-featured-section["'][^>]*)/i, '$1 hidden');
        }
        body = replaceCategoryAlternates(body, landingAlternates);
      }
      if (initial) {
        try { body = applyInitialHtmlToString(body, initial); } catch (error) { console.error('initial html apply failed', error); }
      }
      if (home) {
        try {
          body = applyInitialHtmlToString(body, home);
          if (home.head) body = body.replace(/<\/head>/i, `${home.head}</head>`);
        } catch (error) { console.error('home initial html apply failed', error); }
      }
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
      const latest = homepageLatestLinks(posts, homeLang, tags);
      const archive = homepageReportLinks(posts, homeLang);
      rewriter = rewriter
        .on('#latest-category-cards', { element(element) { element.setInnerContent(latest, { html: true }); } })
        .on('#report-list', { element(element) { element.setInnerContent(archive, { html: true }); } });
    }
    if (posts && landing) {
      const categoryPosts = (Array.isArray(posts) ? posts : [])
        .filter((p) => postLanguage(p) === landing.lang && p?.type === landing.type && normalizeSitePath(p?.href));
      const featuredCards = categoryFeaturedCards(posts, landing.type, landing.lang, tags);
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
    if (initial) rewriter = applyInitialHtmlToRewriter(rewriter, initial);
    if (home) {
      rewriter = applyInitialHtmlToRewriter(rewriter, home);
      if (home.head) rewriter = rewriter.on('head', { element(element) { element.append(home.head, { html: true }); } });
    }
    if (engagement) {
      rewriter = rewriter.on('body', { element(element) { element.append(engagement, { html: true }); } });
    }
    return rewriter.transform(response);
  }

  let decodedPath = url.pathname;
  try { decodedPath = decodeURIComponent(url.pathname); } catch (_) {}

  let active = '';
  // The page language is the matched post's own `lang`; the URL only decides
  // when no post matches. Uploaded files keep whatever <html lang> they were
  // written with, so the final <html lang> is set from this value too.
  let lang = /^\/reports\/en\//i.test(url.pathname) ? 'en' : 'ko';
  if (/시장\s*입문|시장\s*공부|경제\s*공부|주식\s*공부|market[\s_-]*basics|investing[\s_-]*basics|explainer/i.test(decodedPath)) active = 'basics';
  else if (/주식리포트|데일리|daily/i.test(decodedPath)) active = 'daily';
  else if (/위클리|weekly/i.test(decodedPath)) active = 'weekly';
  else if (/비정기|소버린|research/i.test(decodedPath)) active = 'research';
  else if (/투자\s*노트|끄적|note/i.test(decodedPath)) active = 'note';
  let seo = '';
  let tags = null;
  try {
    const [postsRes, tagsRes] = await Promise.allSettled([
      loadPosts(context.request, context.env),
      loadTags(context.request, context.env)
    ]);
    if (tagsRes.status === 'fulfilled' && tagsRes.value) {
      tags = tagsRes.value;
    }
    if (postsRes.status === 'fulfilled') {
      const posts = postsRes.value;
      const post = findPostByPath(posts, url.pathname);
      if (post) {
        lang = postLanguage(post);
        // The published Market Close for the report's date supplies the
        // numbers the <title> and description quote; without one they fall
        // back to dated wording with no numbers.
        const facts = await loadReportFacts(context.env, post);
        seo = reportSeoTags(posts, post, { facts, tagRegistry: tags });
      }
    }
  } catch (_) {}

  const tagBootstrap = serializeTagRegistryBootstrap(tags);
  const shell = `${tagBootstrap}<script src="/assets/locale.js?v=a47c9d5cb9"></script><script src="/assets/report-shell.js?v=43526f9b5f" data-category="${active}" data-lang="${lang}"></script>${engagement}`;
  const footerStyle = `<style id="site-footer-css">${footerCss()}</style>`;
  const footerMarkup = siteFooter(lang);
  // One feed link per page, for the page's own language. Any Atom link the
  // uploaded report happened to carry is dropped first, so there is exactly one.
  const feedLink = feedDiscoveryTag(lang);

  if (typeof HTMLRewriter === 'undefined') {
    let body = await response.text();
    // The same elements the HTMLRewriter selectors below remove, matched by
    // attribute rather than by attribute order.
    if (seo) {
      body = body.replace(/<title>[\s\S]*?<\/title>/i, '');
      body = removeTags(body, 'meta', attrs => (
        attrs.name === 'description'
        || String(attrs.property ?? '').startsWith('og:')
        || String(attrs.name ?? '').startsWith('twitter:')
      ));
    }
    body = removeTags(body, 'link', attrs => (
      attrs.rel === 'canonical'
      || (attrs.rel === 'alternate' && 'hreflang' in attrs)
      || attrs.type === 'application/atom+xml'
      || relTokens(attrs).includes('icon')
      || attrs.rel === 'apple-touch-icon'
      || attrs.rel === 'manifest'
    ));
    body = body.replace(/<\/head>/i, `${FAVICON_TAGS}${seo}${feedLink}${footerStyle}</head>`);
    body = body.replace(/<\/body>/i, `${footerMarkup}${shell}</body>`);
    body = setHtmlLang(body, lang);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  return new HTMLRewriter()
    .on('html', { element(element) { element.setAttribute('lang', lang); } })
    .on('title', { element(element) { if (seo) element.remove(); } })
    .on('link[rel="canonical"]', { element(element) { element.remove(); } })
    .on('link[rel="alternate"][hreflang]', { element(element) { element.remove(); } })
    .on('link[type="application/atom+xml"]', { element(element) { element.remove(); } })
    .on('meta[name="description"]', { element(element) { if (seo) element.remove(); } })
    .on('meta[property^="og:"]', { element(element) { if (seo) element.remove(); } })
    .on('meta[name^="twitter:"]', { element(element) { if (seo) element.remove(); } })
    // Uploaded report HTML carries no icon of its own.
    .on('link[rel~="icon"]', { element(element) { element.remove(); } })
    .on('link[rel="apple-touch-icon"]', { element(element) { element.remove(); } })
    .on('link[rel="manifest"]', { element(element) { element.remove(); } })
    .on('head', { element(element) { element.append(`${FAVICON_TAGS}${seo}${feedLink}${footerStyle}`, { html: true }); } })
    .on('body', {
      element(element) {
        element.append(`${footerMarkup}${shell}`, { html: true });
      }
    })
    .transform(response);
}

export const __test = { findPostByPath, reportSeoTags };
