import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TRACKED_ASSETS = [
  'assets/site.css',
  'assets/brand.css',
  'assets/language.css',
  'assets/category-state.css',
  'assets/ui-polish.css',
  'assets/home-v2.css',
  'assets/category-landing.css',
  'assets/market-close.css',
  'assets/site.js',
  'assets/category-landing.js',
  'assets/locale.js',
  'assets/market-close.js',
  'assets/report-shell.js',
  'assets/engagement.js',
  'data/tags.js',
  'data/posts.js',
  'data/market-summary.js'
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
 */
export function computeAssetFileHash(rootDir, relPath) {
  const fullPath = path.join(rootDir, relPath);
  const content = fs.readFileSync(fullPath, 'utf8');
  return computeContentHash(content);
}

/**
 * Builds a map of relative asset path -> content hash.
 */
export function getAssetVersionMap(rootDir = process.cwd()) {
  const map = {};
  for (const relPath of TRACKED_ASSETS) {
    try {
      map[relPath] = computeAssetFileHash(rootDir, relPath);
    } catch {
      // Skip if file doesn't exist
    }
  }
  return map;
}

/**
 * Replaces asset query parameters in HTML/JS content with deterministic content hashes.
 */
export function stampAssetVersionsInContent(content, versionMap) {
  let updated = content;

  for (const [relPath, hash] of Object.entries(versionMap)) {
    const escapedPath = relPath.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('((?:href|src)=["\'])(?:\\/|\\.\\.\\/)*(' + escapedPath + ')(?:\\?[^"\']*)?(["\'])', 'g');
    updated = updated.replace(regex, (match, prefix, assetPath, suffix) => {
      const hasRootSlash = match.includes('/' + assetPath);
      const leading = hasRootSlash ? '/' : '';
      return prefix + leading + assetPath + '?v=' + hash + suffix;
    });
  }

  return updated;
}
