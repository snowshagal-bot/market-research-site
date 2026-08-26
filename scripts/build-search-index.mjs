import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function extractReportText(html) {
  if (!html) return '';
  
  // 1. Remove non-content blocks and templates
  let clean = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<dialog\b[\s\S]*?<\/dialog>/gi, ' ');

  // 2. Strip HTML tags
  clean = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  // 3. Remove common repetitive boilerplate noise
  const boilerplates = [
    /SNOWSHAGAL/gi,
    /MARKET RESEARCH/gi,
    /시장을 읽어주는 사이트/gi,
    /본 사이트의 리서치와 해설은 정보 제공을 목적으로 하며[^.]+투자자문[^.]+않습니다\.?/gi,
    /This site's research and commentary are for informational purposes only[^.]+investment advice[^.]*\.?/gi,
    /Scroll down for the report/gi,
    /Read report/gi,
    /리포트 보기/gi,
    /리포트 읽기/gi,
    /Tistory/gi
  ];
  for (const bp of boilerplates) {
    clean = clean.replace(bp, ' ');
  }

  // 4. Normalize spaces without truncating
  return clean.replace(/\s+/g, ' ').trim();
}

export const extractSearchText = extractReportText;

export function extractReadingText(html) {
  if (!html) return '';

  let clean = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<dialog\b[\s\S]*?<\/dialog>/gi, ' ')
    // Remove closed details elements (keep open details if any)
    .replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/gi, ' ')
    // Remove elements with hidden attribute
    .replace(/<([a-z0-9]+)[^>]*\bhidden\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  const boilerplates = [
    /SNOWSHAGAL/gi,
    /MARKET RESEARCH/gi,
    /시장을 읽어주는 사이트/gi,
    /본 사이트의 리서치와 해설은 정보 제공을 목적으로 하며[^.]+투자자문[^.]+않습니다\.?/gi,
    /This site's research and commentary are for informational purposes only[^.]+investment advice[^.]*\.?/gi,
    /Scroll down for the report/gi,
    /Read report/gi,
    /리포트 보기/gi,
    /리포트 읽기/gi,
    /Tistory/gi
  ];
  for (const bp of boilerplates) {
    clean = clean.replace(bp, ' ');
  }

  return clean.replace(/\s+/g, ' ').trim();
}

export const READING_SPEED = {
  ko: 500, // 500 characters / min (non-whitespace)
  en: 220  // 220 words / min
};

export function calculateReadingMinutes(html, lang = 'ko') {
  const readingText = extractReadingText(html);
  if (!readingText) return 1;
  const isEn = lang === 'en';
  if (isEn) {
    const words = readingText.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / READING_SPEED.en));
  } else {
    const nonWsChars = readingText.replace(/\s+/g, '').length;
    return Math.max(1, Math.ceil(nonWsChars / READING_SPEED.ko));
  }
}

export function buildSearchIndex(targetRootDir) {
  const root = targetRootDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const postsPath = path.join(root, 'data', 'posts.json');
  const outJsonPath = path.join(root, 'data', 'search-index.json');
  const outJsPath = path.join(root, 'data', 'search-index.js');

  const postsRaw = fs.readFileSync(postsPath, 'utf8');
  const posts = JSON.parse(postsRaw);

  const searchIndex = posts.map(post => {
    const reportRelativePath = post.href ? post.href.replace(/^\/+/, '') : '';
    const reportFullPath = path.join(root, reportRelativePath);
    let bodyText = '';
    let readingMinutes = post.readingMinutes;

    if (reportRelativePath && fs.existsSync(reportFullPath)) {
      const html = fs.readFileSync(reportFullPath, 'utf8');
      bodyText = extractReportText(html);
      if (typeof readingMinutes !== 'number' || readingMinutes < 1) {
        readingMinutes = calculateReadingMinutes(html, post.lang || 'ko');
      }
    } else if (typeof readingMinutes !== 'number' || readingMinutes < 1) {
      readingMinutes = 1;
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
      readingMinutes: readingMinutes,
      url: post.href ? `/${post.href.replace(/^\/+/, '')}` : '',
      coverImage: post.coverImage ? `/${post.coverImage.replace(/^\/+/, '')}` : '',
      bodyText: bodyText // Full text indexing without 10,000 char truncation
    };
  });

  fs.writeFileSync(outJsonPath, JSON.stringify(searchIndex, null, 2) + '\n', 'utf8');
  fs.writeFileSync(outJsPath, `window.SEARCH_INDEX = ${JSON.stringify(searchIndex)};\n`, 'utf8');
  return searchIndex;
}

if (process.argv[1] && process.argv[1].endsWith('build-search-index.mjs')) {
  const index = buildSearchIndex();
  console.log(`Successfully built search index with ${index.length} reports.`);
}
