import { searchIndexArtifacts } from './_search-index.js';
import { findLateCoverStyle, lateCoverStyleMessage } from '../_cover-style.js';
import { SOCIAL_REPORT_CARD_DIR } from '../_seo.js';
import { isHumanAdminHost, validateHumanAdminMutation } from '../_host-policy.js';
import { requireAdminMutation } from '../_auth.js';
import {
  MAX_POST_TAGS,
  MAX_NEW_CUSTOM_TAGS_PER_PUBLISH,
  validateTagDefinition,
  parseAndValidateTags,
  generateTagsJs
} from '../_tags.js';

const OWNER = 'snowshagal-bot';
const REPO = 'market-research-site';
const BRANCH = 'main';
const API_VERSION = '2026-03-10';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;
const MAX_TAKEAWAY_LENGTH = 400;

const TYPE_LABELS = {
  daily: '주식 리포트',
  weekly: '위클리 리포트',
  research: '비정기 리서치',
  basics: '시장 입문',
  note: '투자 노트'
};
const EN_TYPE_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  research: 'Research',
  basics: 'Market Basics',
  note: 'Investment Note'
};

function typeLabel(type, lang) {
  return lang === 'en' ? EN_TYPE_LABELS[type] : TYPE_LABELS[type];
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function encodeRepoPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function safeFilename(input) {
  let name = String(input || '').replace(/[\\/:*?"<>|\0]/g, '-').replace(/\s+/g, ' ').trim();
  if (!name) name = 'report.html';
  if (!/\.html?$/i.test(name)) name += '.html';
  return name.slice(0, 180);
}

function coverExtension(file) {
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
  const allowed = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp']
  };
  const mime = String(file?.type || '').toLowerCase();
  return allowed[mime]?.includes(extension) ? extension : '';
}

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function kstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function simpleHash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function secretsMatch(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const aa = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function githubHeaders(token) {
  return {
    'accept': 'application/vnd.github+json',
    'authorization': `Bearer ${token}`,
    'x-github-api-version': API_VERSION,
    'user-agent': 'market-research-site-publisher'
  };
}

// A failure the upstream did not author: an edge between here and GitHub gave
// up on the request. Nothing was decided, so the call can simply be made again.
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
const GH_ATTEMPTS = 3;

/**
 * Git objects are addressed by the hash of their content: creating the same
 * blob, tree or commit twice yields the same object and no second effect, so
 * these calls can be repeated safely. Moving a branch reference cannot, and
 * never is.
 */
function isRepeatable(method, path) {
  if (method === 'GET') return true;
  return method === 'POST' && ['/git/blobs', '/git/trees', '/git/commits'].includes(path);
}

async function gh(token, path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = isRepeatable(method, path) ? GH_ATTEMPTS : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, 500 * (attempt - 1)));

    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
        ...options,
        headers: {
          ...githubHeaders(token),
          ...(options.headers || {})
        }
      });
    } catch (cause) {
      // The request never produced a response at all.
      lastError = new Error(`GitHub ${method} ${path} 요청이 실패했습니다: ${cause?.message || cause}`);
      lastError.status = 0;
      continue;
    }

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { message: text }; }
    if (response.ok) return data;

    // An edge that rejects the request answers in its own words — "error code:
    // 520" and nothing else — so the endpoint and status are recorded here.
    // Without them the publisher reports a number no one can place.
    const detail = data?.message ? `: ${String(data.message).replace(/\s+/g, ' ').trim().slice(0, 200)}` : '';
    const err = new Error(`GitHub ${method} ${path} → ${response.status}${detail}`);
    err.status = response.status;
    err.details = data;
    lastError = err;
    if (!TRANSIENT_STATUS.has(response.status)) throw err;
  }

  throw lastError;
}

/**
 * Turns tree entries that carry file content into blob references.
 *
 * A tree that inlines every file puts the whole search index, both body
 * shards, the posts files and the report into a single request — several
 * megabytes that grow with every report published, and a request that large is
 * what an edge refuses without saying why. Written as blobs first, each file
 * travels on its own and the tree itself is a short list of hashes. What lands
 * in the commit is identical either way: a tree entry naming a blob's hash and
 * one carrying that blob's content mean the same thing to Git.
 */
async function toBlobEntries(token, entries) {
  const resolved = [];
  for (const entry of entries) {
    if (typeof entry?.content !== 'string') {
      resolved.push(entry);
      continue;
    }
    const blob = await gh(token, '/git/blobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: entry.content, encoding: 'utf-8' })
    });
    const { content, ...rest } = entry;
    resolved.push({ ...rest, sha: blob.sha });
  }
  return resolved;
}

async function readRepoText(token, path, ref) {
  const file = await gh(token, `/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`);
  if (typeof file?.content === 'string' && file.content.trim()) {
    return decodeBase64Utf8(file.content);
  }
  if (!file?.sha) throw new Error(`${path} 파일 내용을 찾을 수 없습니다.`);

  const blob = await gh(token, `/git/blobs/${encodeURIComponent(file.sha)}`);
  if (blob?.encoding !== 'base64' || typeof blob.content !== 'string' || !blob.content.trim()) {
    throw new Error(`${path} Git blob 내용을 읽을 수 없습니다.`);
  }
  return decodeBase64Utf8(blob.content);
}

async function currentRef(token) {
  return gh(token, `/git/ref/heads/${encodeURIComponent(BRANCH)}`);
}

async function updateRef(token, originalSha, commitSha) {
  const latestRef = await currentRef(token);
  if (latestRef.object.sha !== originalSha) return false;
  await gh(token, `/git/refs/heads/${encodeURIComponent(BRANCH)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha: commitSha, force: false })
  });
  return true;
}

function extractSearchText(html) {
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
  for (const bp of boilerplates) clean = clean.replace(bp, ' ');
  return clean.replace(/\s+/g, ' ').trim();
}

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


function removeSourceGlossaryContainers(html) {
  if (!html) return '';

  let raw = String(html);

  // 1. Details elements handling (parser/depth tracking)
  let cursor = 0;
  let result = '';
  const detailsPattern = /<details\b([^>]*)>/gi;
  let dMatch;

  while ((dMatch = detailsPattern.exec(raw)) !== null) {
    const startIndex = dMatch.index;
    result += raw.slice(cursor, startIndex);

    const attrs = dMatch[1];
    const isOpen = /\bopen\b/i.test(attrs);

    let depth = 1;
    let pos = detailsPattern.lastIndex;
    const subPattern = /<\/?details\b[^>]*>/gi;
    subPattern.lastIndex = pos;

    let subMatch;
    let endIndex = raw.length;
    while ((subMatch = subPattern.exec(raw)) !== null) {
      if (subMatch[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          endIndex = subMatch.index + subMatch[0].length;
          break;
        }
      } else if (!subMatch[0].endsWith('/>')) {
        depth++;
      }
    }

    const fullDetails = raw.slice(startIndex, endIndex);
    cursor = endIndex;
    detailsPattern.lastIndex = cursor;

    const summaryMatch = fullDetails.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    const summaryText = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const isSource = /출처|자료와\s*출처|데이터\s*기준|참고자료|sources?|references?|citations?|cited\s*material/i.test(summaryText) ||
                     /id=["'](?:detail-sources|src)["']|class=["'][^"']*\bsrc\b/i.test(attrs);
    const isGlossary = /용어|glossary|key\s*terms?|definitions?/i.test(summaryText) ||
                       /id=["']detail-glossary["']|class=["'][^"']*\bgloss\b/i.test(attrs);

    if (!isSource && !isGlossary && isOpen) {
      const inner = fullDetails.replace(/^<details\b[^>]*>/i, '').replace(/<\/details>$/i, '');
      result += ' ' + inner + ' ';
    } else {
      result += ' ';
    }
  }
  result += raw.slice(cursor);
  raw = result;

  // 2. Container blocks with source/glossary classes or ids (nested tag safe)
  const targetTagNames = ['section', 'div', 'aside', 'dl', 'ul', 'ol', 'p', 'article'];
  const containerPattern = new RegExp(`<(${targetTagNames.join('|')})\\b([^>]*(?:id|class)=["'][^"']*(?:detail-sources|detail-glossary|sourcecopy|termblk|srclist|glossary|srcs\\b)[^"']*["'][^>]*)>`, 'gi');

  cursor = 0;
  result = '';
  let cMatch;

  while ((cMatch = containerPattern.exec(raw)) !== null) {
    const startIndex = cMatch.index;
    result += raw.slice(cursor, startIndex);

    const tagName = cMatch[1].toLowerCase();
    let depth = 1;
    let pos = containerPattern.lastIndex;
    const subPattern = new RegExp(`<\/?${tagName}\\b[^>]*>`, 'gi');
    subPattern.lastIndex = pos;

    let subMatch;
    let endIndex = raw.length;
    while ((subMatch = subPattern.exec(raw)) !== null) {
      if (subMatch[0].startsWith('</')) {
        depth--;
        if (depth === 0) {
          endIndex = subMatch.index + subMatch[0].length;
          break;
        }
      } else if (!subMatch[0].endsWith('/>')) {
        depth++;
      }
    }

    cursor = endIndex;
    containerPattern.lastIndex = cursor;
    result += ' ';
  }
  result += raw.slice(cursor);
  raw = result;

  // 3. Inline tip spans
  raw = raw.replace(/<span\s+class=["']tip["']>([\s\S]*?)<\/span>/gi, ' ');

  return raw;
}

function extractReadingText(html) {
  if (!html) return '';

  let raw = String(html);

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

  raw = removeSourceGlossaryContainers(raw);

  return cleanInlineText(raw);
}

function calculateRawWeightedMinutes(html, lang = 'ko') {
  if (!html) return 1;
  const isEn = lang === 'en';

  let raw = String(html);

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

  raw = removeSourceGlossaryContainers(raw);

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

  const speed = isEn ? 220 : 600;
  return Math.max(1, Math.ceil(weightedEquivalent / speed));
}

function calculateLegacyReadingMinutes(html, lang = 'ko') {
  const readingText = extractReadingText(html);
  if (!readingText) return 1;
  const isEn = lang === 'en';
  if (isEn) {
    const words = readingText.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 220));
  } else {
    const nonWsChars = readingText.replace(/\s+/g, '').length;
    return Math.max(1, Math.ceil(nonWsChars / 500));
  }
}

function calculateReadingMinutes(html, lang = 'ko', type = 'daily') {
  const normalizedType = String(type || 'daily').toLowerCase();

  // 1. Daily, Weekly, Research: v2 Weighted with -5 min adjustment (min 3)
  if (normalizedType === 'daily' || normalizedType === 'weekly' || normalizedType === 'research') {
    const rawWeighted = calculateRawWeightedMinutes(html, lang);
    return Math.max(3, rawWeighted - 5);
  }

  // 2. Basics: v2 Weighted without -5 min adjustment (min 1)
  if (normalizedType === 'basics') {
    const rawWeighted = calculateRawWeightedMinutes(html, lang);
    return Math.max(1, rawWeighted);
  }

  // 3. Market, Notes: Explicitly excluded from Reading Time v2, preserving legacy calculation
  return calculateLegacyReadingMinutes(html, lang);
}


function hasMatchingUniqueIds(posts, searchIndex) {
  if (!Array.isArray(posts) || !Array.isArray(searchIndex)) return false;
  const postIds = posts.map(x => x?.id).filter(Boolean);
  const indexIds = searchIndex.map(x => x?.id).filter(Boolean);

  if (postIds.length !== posts.length) return false;
  if (indexIds.length !== searchIndex.length) return false;

  const postSet = new Set(postIds);
  const indexSet = new Set(indexIds);

  if (postSet.size !== postIds.length) return false;
  if (indexSet.size !== indexIds.length) return false;
  if (postSet.size !== indexSet.size) return false;

  return [...postSet].every(id => indexSet.has(id));
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await requireAdminMutation(request, env);
  if (!auth.ok) {
    return reply({ error: auth.error, message: auth.message }, auth.status);
  }

  if (!isHumanAdminHost(request, { allowPreview: false })) {
    return reply({ error: 'PREVIEW_READ_ONLY', message: 'Preview와 로컬 환경에서는 게시할 수 없습니다.' }, 403);
  }

  if (!env.GITHUB_TOKEN) {
    return reply({
      error: 'SERVER_NOT_CONFIGURED',
      message: 'Cloudflare에 GITHUB_TOKEN 비밀값을 먼저 설정해야 합니다.'
    }, 503);
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return reply({ error: 'BAD_FORM', message: '게시 데이터를 읽을 수 없습니다.' }, 400);
  }

  const file = form.get('file');
  const cover = form.get('cover');
  // Composed in the browser from the same cover. Optional: without it the
  // report simply falls back to the brand card.
  const shareCard = form.get('shareCard');
  // The 450px thumbnail the homepage cards draw from, made in the browser
  // from the same cover. Optional in the same way: without it the cards show
  // the original, which is only heavier, not missing.
  const coverThumbnail = form.get('coverThumbnail');
  const type = String(form.get('type') || '').trim();
  const lang = String(form.get('lang') || '').trim();
  const translationGroup = String(form.get('translationGroup') || '').trim();
  const reportDate = String(form.get('reportDate') || '').trim();
  const title = String(form.get('title') || '').trim().slice(0, 180);
  const subtitle = String(form.get('subtitle') || '').trim().slice(0, 240);
  const description = String(form.get('description') || '').trim().slice(0, 700);
  const summary = String(form.get('summary') || '').trim().slice(0, 500);
  // The TODAY one-liner the report itself carried. Only a Daily has one:
  // the strip shows a market session, and nothing else stands in for it.
  const takeaway = type === 'daily'
    ? String(form.get('takeaway') || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAKEAWAY_LENGTH)
    : '';
  const filename = safeFilename(form.get('filename') || file?.name || 'report.html');

  if (!file || typeof file.text !== 'function') return reply({ error: 'NO_FILE', message: 'HTML 파일이 없습니다.' }, 400);
  if (!TYPE_LABELS[type]) return reply({ error: 'BAD_TYPE', message: '카테고리를 확인하세요.' }, 400);
  if (!['ko', 'en'].includes(lang)) return reply({ error: 'BAD_LANG', message: '언어는 ko 또는 en이어야 합니다.' }, 400);
  if (translationGroup && (!/^[A-Za-z0-9._:-]+$/.test(translationGroup) || translationGroup.length > 180)) {
    return reply({ error: 'BAD_TRANSLATION_GROUP', message: '번역 연결 정보를 확인하세요.' }, 400);
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(reportDate)) return reply({ error: 'BAD_DATE', message: '리포트 기준일을 확인하세요.' }, 400);
  if (!title) return reply({ error: 'NO_TITLE', message: '제목을 입력하세요.' }, 400);
  if (Number(file.size || 0) > MAX_FILE_BYTES) return reply({ error: 'FILE_TOO_LARGE', message: '현재 게시기는 5MB 이하 HTML 파일만 지원합니다.' }, 413);

  const hasCover = Boolean(cover && typeof cover.arrayBuffer === 'function' && Number(cover.size || 0) > 0);
  const coverExt = hasCover ? coverExtension(cover) : '';
  if (hasCover && !coverExt) return reply({ error: 'BAD_COVER_TYPE', message: '대표 커버는 JPG, PNG, WebP 이미지만 지원합니다.' }, 400);
  if (hasCover && Number(cover.size || 0) > MAX_COVER_BYTES) return reply({ error: 'COVER_TOO_LARGE', message: '대표 커버 이미지는 4MB 이하여야 합니다.' }, 413);

  const html = await file.text();
  if (!/<(?:!doctype\s+html|html\b)/i.test(html.slice(0, 10000))) {
    return reply({ error: 'NOT_HTML', message: '독립 실행형 HTML 파일인지 확인하세요.' }, 400);
  }
  // Checked here, before anything reaches GitHub. The repository gate catches
  // this too, but by then the report is already on Production and the shift is
  // already being served; refusing the upload is the only place it can be
  // stopped in time.
  const lateCoverStyle = findLateCoverStyle(html);
  if (lateCoverStyle) {
    return reply({ error: 'LATE_COVER_STYLE', message: lateCoverStyleMessage(lateCoverStyle), detail: lateCoverStyle }, 400);
  }

  let newTagsInput = [];
  const rawNewTags = form.get('newTags') || form.get('new_tags');
  if (rawNewTags) {
    try {
      newTagsInput = typeof rawNewTags === 'string' ? JSON.parse(rawNewTags) : rawNewTags;
      if (!Array.isArray(newTagsInput)) {
        return reply({ error: 'BAD_NEW_TAGS', message: '새 태그 목록은 배열 형식이어야 합니다.' }, 400);
      }
    } catch (err) {
      return reply({ error: 'BAD_NEW_TAGS', message: '새 태그 JSON 형식이 올바르지 않습니다.' }, 400);
    }
  }
  if (newTagsInput.length > MAX_NEW_CUSTOM_TAGS_PER_PUBLISH) {
    return reply({ error: 'TOO_MANY_NEW_TAGS', message: `새 태그는 한 번에 최대 ${MAX_NEW_CUSTOM_TAGS_PER_PUBLISH}개까지만 등록할 수 있습니다.` }, 400);
  }

  const rawInputTags = form.getAll('tags').length > 1 ? form.getAll('tags') : form.get('tags');
  let rawParsedTags = [];
  if (Array.isArray(rawInputTags)) rawParsedTags = rawInputTags;
  else if (typeof rawInputTags === 'string') rawParsedTags = rawInputTags.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
  const normalizedRawTags = Array.from(new Set(rawParsedTags.map(t => String(t).trim().toLowerCase()))).filter(Boolean);
  if (normalizedRawTags.length > MAX_POST_TAGS) {
    return reply({ error: 'BAD_TAGS', message: `태그는 최대 ${MAX_POST_TAGS}개까지만 지정할 수 있습니다.` }, 400);
  }

  const token = env.GITHUB_TOKEN;
  const reportPath = lang === 'en' ? `reports/en/${filename}` : `reports/${filename}`;
  const href = reportPath;
  const now = new Date();
  const registeredAt = now.toISOString();
  const registeredDate = kstDate(now);

  try {
    const ref = await currentRef(token);
    const baseSha = ref.object.sha;
    const [parentCommit, postsText, tagsText] = await Promise.all([
      gh(token, `/git/commits/${baseSha}`),
      readRepoText(token, 'data/posts.json', baseSha),
      readRepoText(token, 'data/tags.json', baseSha)
    ]);
    let posts = JSON.parse(postsText);
    if (!Array.isArray(posts)) throw new Error('posts.json 형식이 올바르지 않습니다.');
    let tagRegistry = JSON.parse(tagsText);
    if (!tagRegistry || typeof tagRegistry !== 'object') throw new Error('tags.json 형식이 올바르지 않습니다.');

    let hasNewTags = false;
    const validatedNewTags = [];
    for (const def of newTagsInput) {
      const tagValidationResult = validateTagDefinition(def, tagRegistry);
      if (!tagValidationResult.valid) {
        return reply({ error: 'BAD_CUSTOM_TAG', message: tagValidationResult.error }, 400);
      }
      tagRegistry[tagValidationResult.tag.id] = {
        ko: tagValidationResult.tag.ko,
        en: tagValidationResult.tag.en,
        group: tagValidationResult.tag.group
      };
      validatedNewTags.push(tagValidationResult.tag);
      hasNewTags = true;
    }

    let pairedPost = null;
    if (translationGroup) {
      const targetLanguage = lang === 'en' ? 'ko' : 'en';
      pairedPost = posts.find(post => {
        const postLanguage = post?.lang === 'en' ? 'en' : 'ko';
        const postTranslationKey = String(post?.translationGroup || post?.id || '');
        return postLanguage === targetLanguage && postTranslationKey === translationGroup;
      });
      if (!pairedPost) {
        return reply({ error: 'BAD_TRANSLATION_GROUP', message: '선택한 번역 짝을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택하세요.' }, 400);
      }
      const pairedDate = String(pairedPost.reportDate || pairedPost.date || '');
      if (pairedDate !== reportDate) {
        return reply({ error: 'PAIR_DATE_MISMATCH', message: `리포트 기준일은 번역 짝과 같은 ${pairedDate || '날짜'}이어야 합니다.` }, 400);
      }
    }

    const tagValidation = parseAndValidateTags(rawInputTags, pairedPost?.tags, tagRegistry, { max: MAX_POST_TAGS });
    if (tagValidation.error) {
      return reply({ error: 'BAD_TAGS', message: tagValidation.error }, 400);
    }
    const tags = tagValidation.tags;

    // Server-side defense: verify that every declared new tag is actually referenced in the post's final tags
    if (validatedNewTags.length > 0) {
      const finalTagSet = new Set(tags);
      for (const newTag of validatedNewTags) {
        if (!finalTagSet.has(newTag.id)) {
          return reply({
            error: 'UNUSED_CUSTOM_TAG',
            message: `신규 등록 태그 '${newTag.id}'가 게시물의 최종 태그에 포함되지 않았습니다.`
          }, 400);
        }
      }
    }
    const readingMinutes = calculateReadingMinutes(html, lang, type);

    if (posts.some(p => p.href === href)) {
      return reply({ error: 'DUPLICATE', message: '같은 파일명의 리포트가 이미 등록되어 있습니다. 파일명을 확인하세요.' }, 409);
    }

    const id = `${reportDate}-${type}-${simpleHash(`${lang}|${filename}|${title}|${reportDate}`)}`;
    const coverPath = hasCover ? `covers/${id}.${coverExt}` : null;
    // A cover does not imply a card: composing one can fail and publishing
    // continues without it, so the metadata records only what is committed.
    const hasShareCard = Boolean(
      coverPath && shareCard && typeof shareCard.arrayBuffer === 'function'
      && Number(shareCard.size || 0) > 0 && Number(shareCard.size || 0) <= MAX_COVER_BYTES
    );
    const shareCardPath = hasShareCard ? `${SOCIAL_REPORT_CARD_DIR}/${id}.jpg` : null;
    // The thumbnail is only ever WebP and only ever beside a cover; its name
    // is derived from the cover's, which is how the cards find it.
    const hasCoverThumbnail = Boolean(
      coverPath && coverThumbnail && typeof coverThumbnail.arrayBuffer === 'function'
      && Number(coverThumbnail.size || 0) > 0 && Number(coverThumbnail.size || 0) <= MAX_COVER_BYTES
      && String(coverThumbnail.type || '').toLowerCase() === 'image/webp'
    );
    const coverThumbnailPath = hasCoverThumbnail ? coverPath.replace(/\.[a-z0-9]+$/i, '-450.webp') : null;
    const post = {
      id,
      type,
      typeLabel: typeLabel(type, lang),
      lang,
      date: reportDate,
      reportDate,
      registeredDate,
      registeredAt,
      legacyImport: false,
      title,
      subtitle,
      description,
      ...(summary ? { summary } : {}),
      // Distinct from summary: one is a description of the report, the
      // other is the sentence the homepage strip shows for that session.
      ...(takeaway ? { takeaway } : {}),
      tags,
      readingMinutes,
      href,
      ...(translationGroup ? { translationGroup } : {}),
      ...(coverPath ? { coverImage: coverPath } : {}),
      ...(shareCardPath ? { shareCardImage: shareCardPath } : {}),
      // Recorded only when the file is in this same commit, so the homepage
      // cards never name a thumbnail that was merely expected.
      ...(coverThumbnailPath ? { coverThumbnail: coverThumbnailPath } : {})
    };

    const originalPostsLength = posts.length;

    // Automatic Search Index update (Fail-Closed)
    let searchIndex;
    try {
      const searchIndexText = await readRepoText(token, 'data/search-index.json', baseSha);
      searchIndex = JSON.parse(searchIndexText);
    } catch (err) {
      return reply({
        error: 'SEARCH_INDEX_READ_FAILED',
        message: `검색 인덱스를 읽는 중 오류가 발생했습니다: ${err.message}`
      }, 500);
    }

    if (!hasMatchingUniqueIds(posts, searchIndex)) {
      return reply({
        error: 'SEARCH_INDEX_INTEGRITY_FAILED',
        message: '기존 게시물과 검색 인덱스의 ID 목록이 일치하지 않거나 중복 ID가 존재합니다.'
      }, 500);
    }

    const normalizedReportHref = href.replace(/^\/+/, '');
    const cleanPublicUrl = normalizedReportHref.startsWith('reports/')
      ? `/${normalizedReportHref.replace(/\.html?$/i, '')}`
      : `/${normalizedReportHref}`;

    const searchEntry = {
      id,
      lang,
      category: type,
      typeLabel: typeLabel(type, lang),
      title,
      subtitle,
      date: reportDate,
      registeredAt,
      summary: summary || description,
      tags,
      readingMinutes,
      url: cleanPublicUrl,
      coverImage: coverPath ? `/${coverPath.replace(/^\/+/, '')}` : '',
      bodyText: extractSearchText(html)
    };

    const existingIndexIdx = searchIndex.findIndex(item => item && item.id === id);
    if (existingIndexIdx >= 0) {
      searchIndex[existingIndexIdx] = searchEntry;
    } else {
      searchIndex.push(searchEntry);
    }

    posts.push(post);

    if (!hasMatchingUniqueIds(posts, searchIndex)) {
      return reply({
        error: 'SEARCH_INDEX_INTEGRITY_FAILED',
        message: '갱신 후 게시물과 검색 인덱스의 ID 정합성 검증에 실패했습니다.'
      }, 500);
    }

    posts.sort((a, b) => {
      const da = String(a.reportDate || a.date || '');
      const db = String(b.reportDate || b.date || '');
      if (da !== db) return db.localeCompare(da);
      return String(b.registeredAt || '').localeCompare(String(a.registeredAt || ''));
    });

    searchIndex.sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return String(b.registeredAt || '').localeCompare(String(a.registeredAt || ''));
    });

    const postsJson = `${JSON.stringify(posts, null, 2)}\n`;
    const postsJs = `window.RESEARCH_POSTS = ${JSON.stringify(posts, null, 2)};\n`;
    const searchIndexBlobs = searchIndexArtifacts(searchIndex)
      .map((artifact) => ({ path: artifact.path, mode: '100644', type: 'blob', content: artifact.content }));

    const baseTree = parentCommit.tree.sha;

    let shareCardEntry = null;
    if (shareCardPath) {
      const cardBytes = new Uint8Array(await shareCard.arrayBuffer());
      const cardBlob = await gh(token, '/git/blobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: encodeBase64(cardBytes), encoding: 'base64' })
      });
      shareCardEntry = { path: shareCardPath, mode: '100644', type: 'blob', sha: cardBlob.sha };
    }

    let coverThumbnailEntry = null;
    if (coverThumbnailPath) {
      const thumbnailBytes = new Uint8Array(await coverThumbnail.arrayBuffer());
      const thumbnailBlob = await gh(token, '/git/blobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: encodeBase64(thumbnailBytes), encoding: 'base64' })
      });
      coverThumbnailEntry = { path: coverThumbnailPath, mode: '100644', type: 'blob', sha: thumbnailBlob.sha };
    }

    let coverEntry = null;
    if (coverPath) {
      const coverBytes = new Uint8Array(await cover.arrayBuffer());
      const coverBlob = await gh(token, '/git/blobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: encodeBase64(coverBytes), encoding: 'base64' })
      });
      coverEntry = { path: coverPath, mode: '100644', type: 'blob', sha: coverBlob.sha };
    }

    let tagsBlobs = [];
    if (hasNewTags) {
      const tagsJson = `${JSON.stringify(tagRegistry, null, 2)}\n`;
      const tagsJs = generateTagsJs(tagRegistry);
      tagsBlobs = [
        { path: 'data/tags.json', mode: '100644', type: 'blob', content: tagsJson },
        { path: 'data/tags.js', mode: '100644', type: 'blob', content: tagsJs }
      ];
    }

    const treeEntries = await toBlobEntries(token, [
      { path: reportPath, mode: '100644', type: 'blob', content: html },
      ...(coverEntry ? [coverEntry] : []),
      ...(shareCardEntry ? [shareCardEntry] : []),
      ...(coverThumbnailEntry ? [coverThumbnailEntry] : []),
      { path: 'data/posts.json', mode: '100644', type: 'blob', content: postsJson },
      { path: 'data/posts.js', mode: '100644', type: 'blob', content: postsJs },
      ...searchIndexBlobs,
      ...tagsBlobs
    ]);

    const tree = await gh(token, '/git/trees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTree, tree: treeEntries })
    });

    const commit = await gh(token, '/git/commits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `Publish ${reportDate} ${typeLabel(type, lang)}: ${title}`,
        tree: tree.sha,
        parents: [baseSha]
      })
    });

    if (!(await updateRef(token, baseSha, commit.sha))) {
      return reply({
        error: 'REPOSITORY_CHANGED',
        message: '저장소가 변경되었습니다. 새로고침 후 다시 게시하세요.'
      }, 409);
    }

    return reply({
      ok: true,
      id,
      reportDate,
      registeredDate,
      registeredAt,
      reportUrl: `/${href.split('/').map(encodeURIComponent).join('/')}`,
      coverImage: coverPath,
      lang,
      translationGroup: translationGroup || null,
      commitSha: commit.sha
    });
  } catch (err) {
    console.error('publish failed', err);
    if (err.status === 401 || err.status === 403) {
      return reply({ error: 'GITHUB_AUTH', message: 'GitHub 토큰 권한을 확인하세요. 저장소 Contents 쓰기 권한이 필요합니다.' }, 502);
    }
    if (err.status === 409 || err.status === 422) {
      return reply({ error: 'REPOSITORY_CHANGED', message: '저장소가 변경되었습니다. 새로고침 후 다시 게시하세요.' }, 409);
    }
    return reply({ error: 'PUBLISH_FAILED', message: err.message || '게시 처리 중 오류가 발생했습니다.' }, 500);
  }
}
