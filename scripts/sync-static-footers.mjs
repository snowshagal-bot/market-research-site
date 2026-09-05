import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteFooter } from '../functions/_footer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const STATIC_FOOTER_PAGES = [
  { file: 'index.html', lang: 'ko' },
  { file: 'en/index.html', lang: 'en' },
  { file: 'about/index.html', lang: 'ko' },
  { file: 'en/about/index.html', lang: 'en' },
  { file: 'market/index.html', lang: 'ko' },
  { file: 'en/market/index.html', lang: 'en' },
  { file: 'disclosures/index.html', lang: 'ko' },
  { file: 'en/disclosures/index.html', lang: 'en' },
  { file: 'calendar/index.html', lang: 'ko' },
  { file: 'en/calendar/index.html', lang: 'en' },
  { file: '404.html', lang: 'ko' }
];

export function syncStaticFooters(root = rootDir) {
  let updatedCount = 0;
  for (const { file, lang } of STATIC_FOOTER_PAGES) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Static page not found: ${file}`);
    }
    const html = fs.readFileSync(fullPath, 'utf8');
    const footerRegex = /<footer\b[\s\S]*?<\/footer>/i;
    if (!footerRegex.test(html)) {
      throw new Error(`No <footer> element found in ${file}`);
    }
    const expectedFooter = siteFooter(lang);
    const updated = html.replace(footerRegex, expectedFooter);
    if (updated !== html) {
      fs.writeFileSync(fullPath, updated, 'utf8');
      updatedCount++;
      console.log(`Updated footer in: ${file}`);
    } else {
      console.log(`Footer already up-to-date in: ${file}`);
    }
  }
  return updatedCount;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Syncing static public page footers...');
  const count = syncStaticFooters();
  console.log(`Finished syncing footers (${count} static files modified).`);

  const buildCatPages = path.join(rootDir, 'scripts', 'build-category-pages.mjs');
  if (fs.existsSync(buildCatPages)) {
    await import(`file:///${buildCatPages.replace(/\\/g, '/')}`);
    console.log('Rebuilt category landing pages.');
  }
}
