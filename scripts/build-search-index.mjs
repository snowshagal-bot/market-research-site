import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const postsPath = path.join(rootDir, 'data', 'posts.json');
const outJsonPath = path.join(rootDir, 'data', 'search-index.json');
const outJsPath = path.join(rootDir, 'data', 'search-index.js');

function extractText(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildIndex() {
  const postsRaw = fs.readFileSync(postsPath, 'utf8');
  const posts = JSON.parse(postsRaw);

  const searchIndex = posts.map(post => {
    const reportRelativePath = post.href ? post.href.replace(/^\/+/, '') : '';
    const reportFullPath = path.join(rootDir, reportRelativePath);
    let bodyText = '';
    if (reportRelativePath && fs.existsSync(reportFullPath)) {
      const html = fs.readFileSync(reportFullPath, 'utf8');
      bodyText = extractText(html);
    }

    return {
      id: post.id,
      lang: post.lang || 'ko',
      category: post.type || 'daily',
      typeLabel: post.typeLabel || '',
      title: post.title || '',
      subtitle: post.subtitle || '',
      date: post.reportDate || post.date || '',
      registeredAt: post.registeredAt || '',
      summary: post.summary || post.description || '',
      tags: Array.isArray(post.tags) ? post.tags : [],
      url: post.href ? `/${post.href.replace(/^\/+/, '')}` : '',
      coverImage: post.coverImage ? `/${post.coverImage.replace(/^\/+/, '')}` : '',
      bodyText: bodyText.slice(0, 10000)
    };
  });

  fs.writeFileSync(outJsonPath, JSON.stringify(searchIndex, null, 2), 'utf8');
  fs.writeFileSync(outJsPath, `window.SEARCH_INDEX = ${JSON.stringify(searchIndex)};\n`, 'utf8');
  console.log(`Successfully built search index with ${searchIndex.length} reports.`);
}

buildIndex();
