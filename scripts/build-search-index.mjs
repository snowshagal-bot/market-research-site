import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function cleanInlineText(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countUnits(text, isEn = false) {
  if (!text) return 0;
  if (isEn) return text.split(/\s+/).filter(Boolean).length;
  return text.replace(/\s+/g, '').length;
}

export function extractReportText(html) {
  if (!html) return '';

  // 1. Remove non-content blocks and templates (scripts, styles, nav, header, footer, dialog)
  // NOTE: <details> (open & closed), sources, glossary remain 100% searchable in search index!
  let clean = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<dialog\b[\s\S]*?<\/dialog>/gi, ' ');

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

  return cleanInlineText(clean);
}

export const extractSearchText = extractReportText;

export function extractReadingText(html) {
  if (!html) return '';

  let raw = String(html);

  // 1. Strip non-content / hidden / scripts / styles / nav / header / footer / dialog
  raw = raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<dialog\b[\s\S]*?<\/dialog>/gi, ' ')
    .replace(/<([a-z0-9]+)[^>]*\bhidden\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

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
  for (const bp of boilerplates) raw = raw.replace(bp, ' ');

  // 2. Identify and strip Source & Glossary blocks (0%) and closed details (0%)
  raw = raw.replace(/<details\b([^>]*)>([\s\S]*?)<\/details>/gi, (match, attrs, inner) => {
    const summaryMatch = inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    const summaryText = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const isSource = /출처|자료와\s*출처|데이터\s*기준|참고자료|sources?|references?|citations?|cited\s*material/i.test(summaryText) ||
                     /id=["'](?:detail-sources|src)["']|class=["'][^"']*\bsrc\b/i.test(attrs);
    const isGlossary = /용어|glossary|key\s*terms?|definitions?/i.test(summaryText) ||
                       /id=["']detail-glossary["']|class=["'][^"']*\bgloss\b/i.test(attrs);
    const isOpen = /\bopen\b/i.test(attrs);

    if (isSource || isGlossary || !isOpen) {
      return ' ';
    }
    return inner;
  });

  const sourceGlossaryPattern = /<(?:section|div|aside|dl|ul|ol|p)\b([^>]*(?:id|class)=["'][^"']*(?:detail-sources|detail-glossary|sourcecopy|termblk|srclist|glossary|srcs\b)[^"']*["'][^>]*)>[\s\S]*?<\/(?:section|div|aside|dl|ul|ol|p)>/gi;
  for (let pass = 0; pass < 3; pass++) {
    raw = raw.replace(sourceGlossaryPattern, ' ');
  }
  raw = raw.replace(/<span\s+class=["']tip["']>([\s\S]*?)<\/span>/gi, ' ');

  return cleanInlineText(raw);
}

export const READING_SPEED = {
  ko: 600, // 600 weighted characters / min (non-whitespace)
  en: 220  // 220 weighted words / min
};

export function calculateRawWeightedMinutes(html, lang = 'ko') {
  if (!html) return 1;
  const isEn = lang === 'en';

  let raw = String(html);

  // 1. Strip non-content / hidden / scripts / styles / nav / header / footer / dialog
  raw = raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<dialog\b[\s\S]*?<\/dialog>/gi, ' ')
    .replace(/<([a-z0-9]+)[^>]*\bhidden\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

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
  for (const bp of boilerplates) raw = raw.replace(bp, ' ');

  // 2. Identify and strip Source & Glossary blocks (0%) and closed details (0%)
  raw = raw.replace(/<details\b([^>]*)>([\s\S]*?)<\/details>/gi, (match, attrs, inner) => {
    const summaryMatch = inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    const summaryText = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const isSource = /출처|자료와\s*출처|데이터\s*기준|참고자료|sources?|references?|citations?|cited\s*material/i.test(summaryText) ||
                     /id=["'](?:detail-sources|src)["']|class=["'][^"']*\bsrc\b/i.test(attrs);
    const isGlossary = /용어|glossary|key\s*terms?|definitions?/i.test(summaryText) ||
                       /id=["']detail-glossary["']|class=["'][^"']*\bgloss\b/i.test(attrs);
    const isOpen = /\bopen\b/i.test(attrs);

    if (isSource || isGlossary || !isOpen) {
      return ' ';
    }
    return inner;
  });

  const sourceGlossaryPattern = /<(?:section|div|aside|dl|ul|ol|p)\b([^>]*(?:id|class)=["'][^"']*(?:detail-sources|detail-glossary|sourcecopy|termblk|srclist|glossary|srcs\b)[^"']*["'][^>]*)>[\s\S]*?<\/(?:section|div|aside|dl|ul|ol|p)>/gi;
  for (let pass = 0; pass < 3; pass++) {
    raw = raw.replace(sourceGlossaryPattern, ' ');
  }
  raw = raw.replace(/<span\s+class=["']tip["']>([\s\S]*?)<\/span>/gi, ' ');

  // 3. Extract Categories into Weighted Buckets
  let narrativeText = '';
  let listText = '';
  let dataText = '';
  let headingText = '';
  let chartMetaText = '';

  // 3a. Headings / Labels (D: 30%)
  raw = raw.replace(/<(h[1-6]|legend)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => {
    headingText += ' ' + cleanInlineText(inner);
    return ' ';
  });
  raw = raw.replace(/<(?:div|span|p)\b[^>]*class=["'][^"']*(?:slab|srcline|sec-hd|subhd|eyebrow|gnum|reader-head|cover-date|cover-brand|fsn|fdate|flow-title|keyflow-title|h1sub|section-split-title|section-subline)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p)>/gi, (m, inner) => {
    headingText += ' ' + cleanInlineText(inner);
    return ' ';
  });

  // 3b. Captions / Chart Meta (E: 20%)
  raw = raw.replace(/<(figcaption|caption)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => {
    chartMetaText += ' ' + cleanInlineText(inner);
    return ' ';
  });
  raw = raw.replace(/<(?:p|div|span)\b[^>]*class=["'][^"']*(?:cap|dcap|lcap|axis|legend|chart-meta|unit|note|basisnote|follow-note|svg-note|svg-time)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)>/gi, (m, inner) => {
    chartMetaText += ' ' + cleanInlineText(inner);
    return ' ';
  });

  // 3c. Tables & Data Grids / KPI cards / Timelines (C: 30%)
  raw = raw.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (m, inner) => {
    dataText += ' ' + cleanInlineText(inner);
    return ' ';
  });
  raw = raw.replace(/<(?:div|section|aside|ul|ol|dl)\b([^>]*(?:class|id)=["'][^"']*(?:sectorboard|sectorcol|kpi-grid|num-grid|stat-card|timeline-data|timeline-card|dash-item|today-item|bignum|flow-hub|keyflow-grid|keyflow-item|keyfocus-card|stat-chip|stat-row|erncards|grid\b|dtable|dwrap|fnums|krow|chips3|hchips|hidx|breadth-row|brh|brm|fih|fii|flow-card|overview-indicators|p1-overview|timeline|sply|schedule-timeline|ranks|segpane|probbar)[^"']*["'][^>]*)>([\s\S]*?)<\/(?:div|section|aside|ul|ol|dl)>/gi, (m, attrs, inner) => {
    dataText += ' ' + cleanInlineText(inner);
    return ' ';
  });

  // 3d. Lists (B: 80%)
  raw = raw.replace(/<(li|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => {
    listText += ' ' + cleanInlineText(inner);
    return ' ';
  });
  raw = raw.replace(/<(?:div|span|p)\b[^>]*class=["'][^"']*(?:ed-item|fitem|ed-list|flist)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p)>/gi, (m, inner) => {
    listText += ' ' + cleanInlineText(inner);
    return ' ';
  });

  // 3e. Narrative Text (A: 100%)
  narrativeText = cleanInlineText(raw);

  const narrativeUnits = countUnits(narrativeText, isEn);
  const listUnits = countUnits(listText, isEn);
  const dataUnits = countUnits(dataText, isEn);
  const headingUnits = countUnits(headingText, isEn);
  const chartMetaUnits = countUnits(chartMetaText, isEn);

  const weightedEquivalent = (narrativeUnits * 1.0) +
                             (listUnits * 0.8) +
                             (dataUnits * 0.3) +
                             (headingUnits * 0.3) +
                             (chartMetaUnits * 0.2);

  const speed = isEn ? READING_SPEED.en : READING_SPEED.ko;
  return Math.max(1, Math.ceil(weightedEquivalent / speed));
}

export function calculateReadingMinutes(html, lang = 'ko', type = 'daily') {
  const rawWeighted = calculateRawWeightedMinutes(html, lang);
  const normalizedType = String(type || 'daily').toLowerCase();

  // Daily, Weekly, Research: -5 minutes perceptual adjustment (minimum 3 min)
  if (normalizedType === 'daily' || normalizedType === 'weekly' || normalizedType === 'research') {
    return Math.max(3, rawWeighted - 5);
  }

  // Basics or other categories: raw weighted calculation without -5 min reduction (minimum 1 min)
  return Math.max(1, rawWeighted);
}

export function buildSearchIndex(targetRootDir) {
  const root = targetRootDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const postsPath = path.join(root, 'data', 'posts.json');
  const postsJsPath = path.join(root, 'data', 'posts.js');
  const outJsonPath = path.join(root, 'data', 'search-index.json');
  const outJsPath = path.join(root, 'data', 'search-index.js');

  const postsRaw = fs.readFileSync(postsPath, 'utf8');
  const posts = JSON.parse(postsRaw);

  const updatedPosts = posts.map(post => {
    const reportRelativePath = post.href ? post.href.replace(/^\/+/, '') : '';
    const reportFullPath = path.join(root, reportRelativePath);
    let readingMinutes = post.readingMinutes;

    if (reportRelativePath && fs.existsSync(reportFullPath)) {
      const html = fs.readFileSync(reportFullPath, 'utf8');
      readingMinutes = calculateReadingMinutes(html, post.lang || 'ko', post.type);
    } else if (typeof readingMinutes !== 'number' || readingMinutes < 1) {
      readingMinutes = 1;
    }

    return {
      ...post,
      readingMinutes
    };
  });

  fs.writeFileSync(postsPath, JSON.stringify(updatedPosts, null, 2) + '\n', 'utf8');
  fs.writeFileSync(postsJsPath, `window.RESEARCH_POSTS = ${JSON.stringify(updatedPosts, null, 2)};\n`, 'utf8');

  const searchIndex = updatedPosts.map(post => {
    const reportRelativePath = post.href ? post.href.replace(/^\/+/, '') : '';
    const reportFullPath = path.join(root, reportRelativePath);
    let bodyText = '';

    if (reportRelativePath && fs.existsSync(reportFullPath)) {
      const html = fs.readFileSync(reportFullPath, 'utf8');
      bodyText = extractReportText(html);
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
      readingMinutes: post.readingMinutes,
      url: post.href ? `/${post.href.replace(/^\/+/, '')}` : '',
      coverImage: post.coverImage ? `/${post.coverImage.replace(/^\/+/, '')}` : '',
      bodyText: bodyText // Full text indexing without truncation
    };
  });

  fs.writeFileSync(outJsonPath, JSON.stringify(searchIndex, null, 2) + '\n', 'utf8');
  fs.writeFileSync(outJsPath, `window.SEARCH_INDEX = ${JSON.stringify(searchIndex)};\n`, 'utf8');
  return searchIndex;
}

if (process.argv[1] && process.argv[1].endsWith('build-search-index.mjs')) {
  const index = buildSearchIndex();
  console.log(`Successfully built search index and synced posts with ${index.length} reports.`);
}

