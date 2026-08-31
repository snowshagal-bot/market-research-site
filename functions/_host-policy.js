export const PUBLIC_ORIGIN = 'https://snowshagal.com';
export const ADMIN_ORIGIN = 'https://admin.snowshagal.com';
export const PUBLIC_HOSTNAME = 'snowshagal.com';
export const PUBLIC_ALIAS_HOSTNAME = 'www.snowshagal.com';
export const ADMIN_HOSTNAME = 'admin.snowshagal.com';
export const PAGES_PRODUCTION_HOSTNAME = 'market-research-site.pages.dev';

export const HOST_CLASS = Object.freeze({
  PUBLIC_PRODUCTION: 'PUBLIC_PRODUCTION',
  PUBLIC_REDIRECT: 'PUBLIC_REDIRECT',
  ADMIN_PRODUCTION: 'ADMIN_PRODUCTION',
  PREVIEW: 'PREVIEW',
  UNKNOWN: 'UNKNOWN'
});

// Phase 1A intentionally keeps the existing apex administrator available.
export const ADMIN_APEX_COMPATIBILITY = false;

const ADMIN_STATIC_PATHS = new Set([
  '/assets/site.css',
  '/assets/ui-polish.css',
  '/assets/admin.js',
  '/assets/admin-manage.js',
  '/assets/admin-manage.css',
  '/assets/admin-analytics.js',
  '/assets/admin-analytics.css',
  '/assets/admin-market.js',
  '/assets/admin-market.css',
  '/assets/market-close.js',
  '/assets/market-close.css',
  '/assets/market-close-mountain.webp',
  '/assets/market-close-mountain-mobile.webp',
  '/assets/locale.js',
  '/assets/site.js',
  '/assets/cover-generator.js',
  '/assets/share-card.js',
  '/data/posts.js',
  '/data/posts.json',
  '/data/tags.js',
  '/contracts/market_close/market_close.schema.json',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/site.webmanifest'
]);

const ADMIN_API_PATHS = new Set([
  '/api/publish',
  '/api/manage',
  '/api/analytics',
  '/api/generate-cover',
  '/api/engagement-stats',
  '/api/comments',
  '/api/disclosures/latest',
  '/api/disclosures/analyze',
  '/api/disclosures/publish',
  '/api/disclosures/sync',
  '/api/disclosures/watchlist',
  '/api/disclosures/feed',
  '/api/market/latest',
  '/api/market/publish',
  '/api/market/date',
  '/api/market/dates',
  '/api/market/range'
]);

const HUMAN_ADMIN_MUTATION_PATHS = new Set([
  '/api/publish',
  '/api/manage',
  '/api/generate-cover',
  '/api/disclosures/analyze',
  '/api/disclosures/publish',
  '/api/disclosures/watchlist'
]);

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function requestUrl(input) {
  try {
    if (input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return input;
    if (input && typeof input.url === 'string') return new URL(input.url);
    return new URL(String(input));
  } catch (_) {
    return null;
  }
}

export function classifyHost(input) {
  const url = requestUrl(input);
  const hostname = String(url?.hostname || '').toLowerCase();
  if (hostname === PUBLIC_HOSTNAME) return HOST_CLASS.PUBLIC_PRODUCTION;
  if (hostname === PUBLIC_ALIAS_HOSTNAME || hostname === PAGES_PRODUCTION_HOSTNAME) return HOST_CLASS.PUBLIC_REDIRECT;
  if (hostname === ADMIN_HOSTNAME) return HOST_CLASS.ADMIN_PRODUCTION;
  if (/^[a-z0-9-]+\.market-research-site\.pages\.dev$/i.test(hostname)) return HOST_CLASS.PREVIEW;
  return HOST_CLASS.UNKNOWN;
}

export function isPublicHost(input) {
  return classifyHost(input) === HOST_CLASS.PUBLIC_PRODUCTION;
}

export function isAdminHost(input) {
  return classifyHost(input) === HOST_CLASS.ADMIN_PRODUCTION;
}

export function isPreviewHost(input) {
  return classifyHost(input) === HOST_CLASS.PREVIEW;
}

export function isHumanAdminHost(input, { compatibilityMode = ADMIN_APEX_COMPATIBILITY, allowPreview = true } = {}) {
  const kind = classifyHost(input);
  return kind === HOST_CLASS.ADMIN_PRODUCTION
    || (compatibilityMode && kind === HOST_CLASS.PUBLIC_PRODUCTION)
    || (allowPreview && kind === HOST_CLASS.PREVIEW);
}

export function expectedHumanAdminOrigin(input, options = {}) {
  const url = requestUrl(input);
  if (!url || !isHumanAdminHost(url, options)) return '';
  const kind = classifyHost(url);
  if (kind === HOST_CLASS.ADMIN_PRODUCTION) return ADMIN_ORIGIN;
  if (kind === HOST_CLASS.PUBLIC_PRODUCTION) return PUBLIC_ORIGIN;
  return url.origin;
}

export function validateHumanAdminMutation(request, options = {}) {
  const method = String(request?.method || 'GET').toUpperCase();
  const expectedOrigin = expectedHumanAdminOrigin(request, options);
  if (!expectedOrigin) return { ok: false, error: 'ADMIN_HOST_BLOCKED', expectedOrigin: '' };
  if (!MUTATION_METHODS.has(method)) return { ok: true, expectedOrigin };
  const suppliedOrigin = String(request.headers.get('origin') || '').trim();
  if (!suppliedOrigin) return { ok: false, error: 'ORIGIN_REQUIRED', expectedOrigin };
  if (suppliedOrigin !== expectedOrigin) return { ok: false, error: 'BAD_ORIGIN', expectedOrigin };
  return { ok: true, expectedOrigin };
}

export function isAdminUiPath(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

export function isAdminHostnameAllowedPath(pathname) {
  if (isAdminUiPath(pathname)) return true;
  if (ADMIN_STATIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/assets/brand/')) return true;
  if (/^\/covers\/.+\.(?:jpe?g|png|webp)$/i.test(pathname)) return true;
  return ADMIN_API_PATHS.has(pathname);
}

export function adminHostRouteDecision(input) {
  const url = requestUrl(input);
  if (!url || classifyHost(url) !== HOST_CLASS.ADMIN_PRODUCTION) return { action: 'pass' };
  return isAdminHostnameAllowedPath(url.pathname)
    ? { action: 'pass' }
    : { action: 'deny', status: 404 };
}

export function apexAdminRouteDecision(input, { compatibilityMode = ADMIN_APEX_COMPATIBILITY } = {}) {
  const url = requestUrl(input);
  if (!url || classifyHost(url) !== HOST_CLASS.PUBLIC_PRODUCTION) return { action: 'pass' };
  const method = String(input?.method || 'GET').toUpperCase();
  if (isAdminUiPath(url.pathname) && !compatibilityMode) {
    if (method === 'GET' || method === 'HEAD') {
      return { action: 'redirect', status: 307, location: `${ADMIN_ORIGIN}${url.pathname}${url.search}` };
    }
    return { action: 'deny', status: 403 };
  }
  if (!compatibilityMode && HUMAN_ADMIN_MUTATION_PATHS.has(url.pathname) && MUTATION_METHODS.has(method)) {
    return { action: 'deny', status: 403 };
  }
  return { action: 'pass' };
}

export const ADMIN_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'"
].join('; ');

export const __test = {
  ADMIN_API_PATHS,
  ADMIN_STATIC_PATHS,
  HUMAN_ADMIN_MUTATION_PATHS,
  MUTATION_METHODS,
  requestUrl
};
