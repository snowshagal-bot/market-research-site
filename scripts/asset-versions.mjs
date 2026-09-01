import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * All mutable frontend code assets (CSS/JS) and static registries that must be
 * stamped with deterministic content hashes (?v=<10-char-sha256>).
 */
export const TRACKED_ASSETS = [
  // Core site styles
  'assets/site.css',
  'assets/brand.css',
  'assets/language.css',
  'assets/category-state.css',
  'assets/ui-polish.css',
  'assets/home-v2.css',
  'assets/category-landing.css',
  'assets/market-close.css',
  'assets/disclosures.css',
  'assets/calendar.css',

  // Core site scripts
  'assets/site.js',
  'assets/category-landing.js',
  'assets/locale.js',
  'assets/market-close.js',
  'assets/disclosures.js',
  'assets/calendar.js',
  'assets/report-shell.js',
  'assets/engagement.js',

  // Admin styles & scripts
  'assets/admin.js',
  'assets/admin-manage.css',
  'assets/admin-manage.js',
  'assets/admin-market.css',
  'assets/admin-market.js',
  'assets/admin-announcements.css',
  'assets/admin-announcements.js',
  'assets/admin-analytics.css',
  'assets/admin-analytics.js',
  'assets/cover-generator.js',
  'assets/share-card.js',

  // Static canonical registry (only changes on code deploy)
  'data/tags.js'
];

/**
 * Dynamic data assets that change on runtime actions (e.g. Admin publish/manage,
 * market close updates, search index builds).
 * These rely strictly on _headers (no-cache, must-revalidate) and MUST NOT have
 * content hash query parameters in HTML/JS.
 */
export const DYNAMIC_DATA_ASSETS = [
  'data/posts.js',
  'data/posts.json',
  'data/market-summary.js',
  'data/search-index-meta.js',
  'data/search-index-body-ko.js',
  'data/search-index-body-en.js',
  'data/search-index.json'
];

/**
 * Single source of truth for all public HTML files and generator templates that
 * reference tracked assets and must be stamped / validated.
 */
export const STAMP_TARGETS = [
  'index.html',
  'en/index.html',
  'about/index.html',
  'en/about/index.html',
  'market/index.html',
  'en/market/index.html',
  'disclosures/index.html',
  'en/disclosures/index.html',
  'calendar/index.html',
  'en/calendar/index.html',
  'admin/index.html',
  'admin/manage/index.html',
  'admin/market/index.html',
  'admin/market/announcements/index.html',
  'admin/analytics/index.html',
  'functions/_middleware.js',
  'scripts/build-category-pages.mjs',
  'daily/index.html',
  'weekly/index.html',
  'research/index.html',
  'basics/index.html',
  'notes/index.html',
  'en/daily/index.html',
  'en/weekly/index.html',
  'en/research/index.html',
  'en/basics/index.html',
  'en/notes/index.html'
];

/**
 * Compute a deterministic 10-char SHA-256 content hash for an asset file.
 * Normalizes CRLF to LF so hash is identical across Windows and Linux.
 */
export function computeContentHash(fileContent) {
  const normalized = typeof fileContent === 'string'
    ? fileContent.replace(/\r\n/g, '\n')
    : fileContent;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 10);
}

/**
 * Reads an asset file from disk and returns its content hash.
 * FAIL-CLOSED: Throws immediately if a tracked asset file does not exist on disk.
 */
export function computeAssetFileHash(rootDir, relPath) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing tracked asset on disk: ${relPath} (expected at ${fullPath})`);
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  return computeContentHash(content);
}

/**
 * Builds a map of relative asset path -> content hash for all TRACKED_ASSETS.
 * FAIL-CLOSED: Fails if any tracked asset is missing.
 */
export function getAssetVersionMap(rootDir = process.cwd()) {
  const map = {};
  for (const relPath of TRACKED_ASSETS) {
    map[relPath] = computeAssetFileHash(rootDir, relPath);
  }
  return map;
}

/**
 * Replaces asset query parameters in content:
 * 1. TRACKED_ASSETS get exact ?v=<10-char-hash>.
 * 2. DYNAMIC_DATA_ASSETS have any ?v=... stripped so they rely on HTTP no-cache headers.
 */
export function stampAssetVersionsInContent(content, versionMap) {
  let updated = content;

  // 1. Stamp tracked assets with content hashes
  for (const [relPath, hash] of Object.entries(versionMap)) {
    const escapedPath = relPath.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('((?:href|src)=["\'])(?:\\/|\\.\\.\\/)*(' + escapedPath + ')(?:\\?[^"\']*)?(["\'])', 'g');
    updated = updated.replace(regex, (match, prefix, assetPath, suffix) => {
      const hasRootSlash = match.includes('/' + assetPath);
      const leading = hasRootSlash ? '/' : '';
      return prefix + leading + assetPath + '?v=' + hash + suffix;
    });
  }

  // 2. Strip any query params from dynamic data assets
  for (const relPath of DYNAMIC_DATA_ASSETS) {
    const escapedPath = relPath.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('((?:href|src)=["\'])(?:\\/|\\.\\.\\/)*(' + escapedPath + ')(?:\\?[^"\']*)?(["\'])', 'g');
    updated = updated.replace(regex, (match, prefix, assetPath, suffix) => {
      const hasRootSlash = match.includes('/' + assetPath);
      const leading = hasRootSlash ? '/' : '';
      return prefix + leading + assetPath + suffix;
    });
  }

  return updated;
}
