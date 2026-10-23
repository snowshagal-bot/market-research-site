// One public-site Google tag. Kept in the response layer so existing and newly
// published standalone reports receive it without changing their source HTML.
export const GA4_MEASUREMENT_ID = 'G-L3XBBY93CG';

// A literal browser asset, never a serialized server function: Cloudflare's
// bundler adds helpers such as __name to server functions, and those helpers
// do not exist in the visitor's browser when Function#toString is injected.
const GA4_INITIALIZER = String.raw`(function initializeGoogleAnalytics(measurementId) {
  function start() {
    // Defence in depth: Preview, local and administrator visits must never
    // enter the public property's visitor counts.
    if (location.protocol !== 'https:' || location.hostname !== 'snowshagal.com'
      || /^\/(?:admin|api|cdn-cgi)(?:\/|$)/i.test(location.pathname)) return;
    if (window.__snowshagalGA4 || typeof window.gtag === 'function'
      || document.querySelector('script[src*="googletagmanager.com/"],script[src*="google-analytics.com/"],iframe[src*="googletagmanager.com/"]')
      || (window.dataLayer && (!Array.isArray(window.dataLayer)
        || window.dataLayer.some(entry => entry?.[0] === 'config' || entry?.['gtm.start'])))) return;

    let referrer = '';
    try {
      const url = new URL(document.referrer);
      // A search engine's origin is sufficient for organic attribution. Never
      // forward its search terms, credentials, query, fragment or private path.
      if (/^https?:$/.test(url.protocol)) referrer = url.origin + '/';
    } catch (_) {}

    window.__snowshagalGA4 = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('set', {
      page_location: location.origin + location.pathname,
      page_referrer: referrer,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    });
    // config supplies the one initial page_view. There is no second manual
    // page_view and no history listener: current history changes are filters,
    // not SPA document navigation. See docs/GA4.md for required stream settings.
    window.gtag('config', measurementId, { send_page_view: true });

    // Google's official asynchronous gtag.js loader, inserted only after the
    // duplicate check. Waiting for parsing also detects tags in uploaded bodies
    // and reads the final SEO title; it never blocks rendering or site scripts.
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurementId;
    script.referrerPolicy = 'strict-origin';
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})`;

export function ga4Tag(url) {
  if (url.protocol !== 'https:' || url.hostname !== 'snowshagal.com'
    || /^\/(?:admin|api|cdn-cgi)(?:\/|$)/i.test(url.pathname)) return '';
  return `<script data-snowshagal-ga4="${GA4_MEASUREMENT_ID}">${GA4_INITIALIZER}('${GA4_MEASUREMENT_ID}');</script>`;
}

export function appendGa4ToHtml(html, tag) {
  // Idempotent if a response passes through the middleware more than once.
  if (!tag || /<script\b[^>]*\bdata-snowshagal-ga4\s*=/i.test(html)) return html;
  return html.replace(/<\/head>/i, () => `${tag}</head>`);
}

export function applyGa4ToRewriter(rewriter, tag) {
  if (!tag) return rewriter;
  return rewriter
    .on('script[data-snowshagal-ga4]', { element(element) { element.remove(); } })
    .on('head', { element(element) { element.append(tag, { html: true }); } });
}
