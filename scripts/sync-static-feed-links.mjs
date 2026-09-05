// Puts each static public page's feed discovery <link> in its <head>, from the
// one helper the middleware and the category build also use, so nobody edits
// 21 heads by hand. Running it again changes nothing: any existing Atom link
// is removed first, then exactly one is written back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedDiscoveryTag } from '../functions/_feed.js';
import { STATIC_PUBLIC_PAGES } from './static-public-pages.mjs';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '..');

export const STATIC_FEED_PAGES = STATIC_PUBLIC_PAGES;
const ATOM_LINK = /[ \t]*<link\b[^>]*type="application\/atom\+xml"[^>]*>[ \t]*\r?\n?/gi;

/** The page with its Atom link removed and exactly one written back. */
export function withFeedLink(html, lang) {
  const newline = html.includes('\r\n') ? '\r\n' : '\n';
  const stripped = html.replace(ATOM_LINK, '');
  const tag = feedDiscoveryTag(lang);
  const canonical = /<link\b[^>]*rel="canonical"[^>]*>/i.exec(stripped);
  if (canonical) {
    const at = canonical.index + canonical[0].length;
    return `${stripped.slice(0, at)}${newline}${tag}${stripped.slice(at)}`;
  }
  const head = /<\/head>/i.exec(stripped);
  if (!head) throw new Error('No </head> to place the feed link before');
  return `${stripped.slice(0, head.index)}${tag}${newline}${stripped.slice(head.index)}`;
}

export function syncStaticFeedLinks(root = rootDir) {
  let updatedCount = 0;
  for (const { file, lang } of STATIC_FEED_PAGES) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) throw new Error(`Static page not found: ${file}`);
    const html = fs.readFileSync(fullPath, 'utf8');
    const updated = withFeedLink(html, lang);
    if (updated !== html) {
      fs.writeFileSync(fullPath, updated, 'utf8');
      updatedCount++;
      console.log(`Updated feed link in: ${file}`);
    } else {
      console.log(`Feed link already up-to-date in: ${file}`);
    }
  }
  return updatedCount;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Syncing static public page feed links...');
  const count = syncStaticFeedLinks();
  console.log(`Finished syncing feed links (${count} static files modified).`);
}
