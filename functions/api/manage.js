import { searchIndexArtifacts } from "./_search-index.js";
import { SOCIAL_REPORT_CARD_DIR } from "../_seo.js";

const OWNER = "snowshagal-bot";
const REPO = "market-research-site";
const BRANCH = "main";
const PRODUCTION_HOSTNAME = "snowshagal.com";
const API_VERSION = "2026-03-10";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;

const TYPE_LABELS = {
  daily: "주식 리포트",
  weekly: "위클리 리포트",
  research: "비정기 리서치",
  basics: "시장 공부",
  note: "끄적끄적",
};
const EN_TYPE_LABELS = {
  daily: "Daily",
  weekly: "Weekly",
  research: "Research",
  basics: "Market Basics",
  note: "Notes",
};

function postLanguage(post) {
  return post?.lang === "en" ? "en" : "ko";
}

function typeLabel(type, lang) {
  return lang === "en" ? EN_TYPE_LABELS[type] : TYPE_LABELS[type];
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function encodeRepoPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function secretsMatch(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "market-research-site-admin",
  };
}

async function gh(token, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }

  if (!response.ok) {
    const error = new Error(body?.message || `GitHub API ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function readRepoText(token, path, ref) {
  const file = await gh(token, `/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`);
  if (typeof file?.content === "string" && file.content.trim()) {
    return decodeBase64Utf8(file.content);
  }
  if (!file?.sha) throw new Error(`${path} 파일 내용을 찾을 수 없습니다.`);

  const blob = await gh(token, `/git/blobs/${encodeURIComponent(file.sha)}`);
  if (blob?.encoding !== "base64" || typeof blob.content !== "string" || !blob.content.trim()) {
    throw new Error(`${path} Git blob 내용을 읽을 수 없습니다.`);
  }
  return decodeBase64Utf8(blob.content);
}

function isFile(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function";
}

function isStandaloneHtml(source) {
  return /<!doctype\s+html/i.test(source) && /<html(?:\s|>)/i.test(source) && /<\/html>/i.test(source);
}

function coverExtension(file) {
  const allowedExtensions = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
  };
  const filenameExtension = String(file?.name || "").split(".").pop()?.toLowerCase() || "";
  if (!allowedExtensions[file?.type]?.includes(filenameExtension)) return "";
  return file.type === "image/jpeg" ? "jpg" : filenameExtension;
}

function isManagedPath(path, root) {
  if (typeof path !== "string" || path.includes("\\") || path.startsWith("/") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.length >= 2
    && segments[0] === root
    && segments.slice(1).every((segment) => segment && segment !== "." && segment !== "..");
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

function sortPosts(posts) {
  return posts.sort((left, right) => {
    const dateOrder = String(right.reportDate || right.date || "").localeCompare(String(left.reportDate || left.date || ""));
    if (dateOrder) return dateOrder;
    return String(right.registeredAt || "").localeCompare(String(left.registeredAt || ""));
  });
}

function postsJavaScript(posts) {
  return `window.RESEARCH_POSTS = ${JSON.stringify(posts, null, 2)};\n`;
}

function metadataEntries(posts, searchIndex = null) {
  const entries = [
    {
      path: "data/posts.json",
      mode: "100644",
      type: "blob",
      content: `${JSON.stringify(posts, null, 2)}\n`,
    },
    {
      path: "data/posts.js",
      mode: "100644",
      type: "blob",
      content: postsJavaScript(posts),
    },
  ];

  if (Array.isArray(searchIndex)) {
    entries.push(...searchIndexArtifacts(searchIndex).map((artifact) => ({
      path: artifact.path,
      mode: "100644",
      type: "blob",
      content: artifact.content,
    })));
  }

  return entries;
}

function deletedEntry(path) {
  return { path, mode: "100644", type: "blob", sha: null };
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

async function currentRef(token) {
  return gh(token, `/git/ref/heads/${BRANCH}`);
}

async function createCommit(token, parentSha, baseTreeSha, entries, message) {
  const tree = await gh(token, "/git/trees", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  return gh(token, "/git/commits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
  });
}

async function updateRef(token, originalSha, commitSha) {
  const latestRef = await currentRef(token);
  if (latestRef.object.sha !== originalSha) return false;
  await gh(token, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  return true;
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

const CANONICAL_TAGS = new Set([
  'flows', 'semiconductors', 'rates', 'fx', 'treasuries', 'fed',
  'futures', 'ai', 'cloud-datacenter', 'stablecoins', 'crypto',
  'gold', 'autos', 'energy', 'policy', 'geopolitics'
]);

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

function parseAndValidateTags(inputTags) {
  let rawTags = [];
  if (Array.isArray(inputTags)) {
    rawTags = inputTags;
  } else if (typeof inputTags === 'string') {
    rawTags = inputTags.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
  }
  const normalized = Array.from(new Set(rawTags.map(t => String(t).trim().toLowerCase()))).filter(Boolean);
  if (normalized.length > 3) {
    return { error: '태그는 최대 3개까지만 지정할 수 있습니다.' };
  }
  for (const t of normalized) {
    if (!CANONICAL_TAGS.has(t)) {
      return { error: `허용되지 않은 태그입니다: ${t}` };
    }
  }
  return { tags: normalized };
}

function validateEditableFields(form) {
  const type = String(form.get("type") || "");
  const reportDate = String(form.get("reportDate") || "");
  const title = String(form.get("title") || "").trim();
  if (!TYPE_LABELS[type]) return { error: "지원하지 않는 카테고리입니다." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return { error: "리포트 날짜를 확인해 주세요." };
  if (!title) return { error: "제목을 입력해 주세요." };

  let tagsProvided = false;
  let tags = [];
  if (form.has("tags")) {
    tagsProvided = true;
    const rawInputTags = form.getAll('tags').length > 1 ? form.getAll('tags') : form.get('tags');
    const tagRes = parseAndValidateTags(rawInputTags);
    if (tagRes.error) return { error: tagRes.error, errorCode: "BAD_TAGS" };
    tags = tagRes.tags;
  }

  return {
    type,
    reportDate,
    title,
    subtitle: String(form.get("subtitle") || "").trim(),
    description: String(form.get("description") || "").trim(),
    summaryProvided: form.has("summary"),
    summary: String(form.get("summary") || "").trim().slice(0, 500),
    tagsProvided,
    tags,
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (new URL(request.url).hostname !== PRODUCTION_HOSTNAME) {
    return reply({ ok: false, error: "PREVIEW_READ_ONLY", message: "Preview와 로컬 환경에서는 게시물을 변경할 수 없습니다." }, 403);
  }
  if (!env.ADMIN_KEY || !env.GITHUB_TOKEN) {
    return reply({ ok: false, error: "SERVER_NOT_CONFIGURED", message: "관리자 환경 변수가 설정되지 않았습니다." }, 503);
  }

  if (!secretsMatch(request.headers.get("X-Admin-Key") || "", env.ADMIN_KEY)) {
    return reply({ ok: false, error: "UNAUTHORIZED", message: "관리자 키가 올바르지 않습니다." }, 401);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply({ ok: false, error: "INVALID_FORM", message: "요청 형식을 확인해 주세요." }, 400);
  }

  const action = String(form.get("action") || "");
  const id = String(form.get("id") || "");
  if (!new Set(["update", "delete"]).has(action)) {
    return reply({ ok: false, error: "INVALID_ACTION", message: "지원하지 않는 작업입니다." }, 400);
  }
  if (!id) return reply({ ok: false, error: "INVALID_ID", message: "게시물 ID가 필요합니다." }, 400);

  let editFields = null;
  let replacementHtml = null;
  let coverFile = null;
  let coverAction = "keep";

  if (action === "update") {
    editFields = validateEditableFields(form);
    if (editFields.error) return reply({ ok: false, error: editFields.errorCode || "INVALID_INPUT", message: editFields.error }, 400);

    const file = form.get("file");
    if (isFile(file) && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) return reply({ ok: false, error: "FILE_TOO_LARGE", message: "HTML 파일은 5MB 이하여야 합니다." }, 413);
      replacementHtml = await file.text();
      if (!isStandaloneHtml(replacementHtml)) {
        return reply({ ok: false, error: "INVALID_HTML", message: "독립 실행형 HTML 파일인지 확인해 주세요." }, 400);
      }
    }

    coverAction = String(form.get("coverAction") || "keep");
    if (!new Set(["keep", "replace", "remove"]).has(coverAction)) {
      return reply({ ok: false, error: "INVALID_COVER_ACTION", message: "커버 처리 방식을 확인해 주세요." }, 400);
    }
    const candidate = form.get("cover");
    if (isFile(candidate) && candidate.size > 0) coverFile = candidate;
    if (coverAction === "replace") {
      const extension = coverExtension(coverFile);
      if (!coverFile || !extension) return reply({ ok: false, error: "INVALID_COVER", message: "JPG, PNG 또는 WebP 커버를 선택해 주세요." }, 400);
      if (coverFile.size > MAX_COVER_BYTES) return reply({ ok: false, error: "COVER_TOO_LARGE", message: "커버 이미지는 4MB 이하여야 합니다." }, 413);
    } else if (coverFile) {
      return reply({ ok: false, error: "UNEXPECTED_COVER", message: "커버 교체를 선택한 경우에만 이미지를 첨부할 수 있습니다." }, 400);
    }
  }

  try {
    const ref = await currentRef(env.GITHUB_TOKEN);
    const baseSha = ref.object.sha;
    let parentCommit, postsText, searchIndexText;
    try {
      [parentCommit, postsText, searchIndexText] = await Promise.all([
        gh(env.GITHUB_TOKEN, `/git/commits/${baseSha}`),
        readRepoText(env.GITHUB_TOKEN, "data/posts.json", baseSha),
        readRepoText(env.GITHUB_TOKEN, "data/search-index.json", baseSha),
      ]);
    } catch (err) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_READ_FAILED",
        message: `저장소 데이터 또는 검색 인덱스를 읽는 중 오류가 발생했습니다: ${err.message}`
      }, 500);
    }

    const posts = JSON.parse(postsText);
    let searchIndex;
    try {
      searchIndex = JSON.parse(searchIndexText);
    } catch (err) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_READ_FAILED",
        message: `검색 인덱스 JSON 파싱에 실패했습니다: ${err.message}`
      }, 500);
    }

    if (!hasMatchingUniqueIds(posts, searchIndex)) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_INTEGRITY_FAILED",
        message: "기존 게시물과 검색 인덱스의 ID 목록이 일치하지 않거나 중복 ID가 존재합니다."
      }, 500);
    }

    const postIndex = posts.findIndex((post) => post.id === id);
    if (postIndex < 0) return reply({ ok: false, error: "POST_NOT_FOUND", message: "게시물을 찾을 수 없습니다." }, 404);
    const existing = posts[postIndex];

    const searchIdx = searchIndex.findIndex((item) => item && item.id === id);
    if (searchIdx < 0) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_INTEGRITY_FAILED",
        message: "검색 인덱스에서 해당 게시물 ID를 찾을 수 없습니다."
      }, 500);
    }

    if (!isManagedPath(existing.href, "reports")) {
      return reply({ ok: false, error: "UNSAFE_REPORT_PATH", message: "안전하지 않은 리포트 경로는 변경할 수 없습니다." }, 400);
    }
    if (existing.coverImage && !isManagedPath(existing.coverImage, "covers")) {
      return reply({ ok: false, error: "UNSAFE_COVER_PATH", message: "안전하지 않은 커버 경로는 변경할 수 없습니다." }, 400);
    }
    if (action === "delete" && String(form.get("confirmTitle") || "") !== existing.title) {
      return reply({ ok: false, error: "DELETE_CONFIRMATION_MISMATCH", message: "삭제 확인 제목이 현재 게시물 제목과 일치하지 않습니다." }, 400);
    }

    const entries = [];
    let commitMessage;
    let resultPost = null;

    if (action === "delete") {
      posts.splice(postIndex, 1);
      searchIndex.splice(searchIdx, 1);

      if (!hasMatchingUniqueIds(posts, searchIndex)) {
        return reply({
          ok: false,
          error: "SEARCH_INDEX_INTEGRITY_FAILED",
          message: "삭제 후 데이터 정합성 검증에 실패했습니다."
        }, 500);
      }

      entries.push(deletedEntry(existing.href));
      if (existing.coverImage) entries.push(deletedEntry(existing.coverImage));
      // Only a card that was recorded exists to delete.
      if (existing.shareCardImage) entries.push(deletedEntry(existing.shareCardImage));
      entries.push(...metadataEntries(sortPosts(posts), searchIndex));
      commitMessage = `Delete ${existing.title}`;
    } else {
      const updated = {
        ...existing,
        type: editFields.type,
        typeLabel: typeLabel(editFields.type, postLanguage(existing)),
        date: editFields.reportDate,
        reportDate: editFields.reportDate,
        title: editFields.title,
        subtitle: editFields.subtitle,
        description: editFields.description,
        updatedAt: new Date().toISOString(),
      };
      if (editFields.summaryProvided) {
        if (editFields.summary) updated.summary = editFields.summary;
        else delete updated.summary;
      }

      if (editFields.tagsProvided) {
        updated.tags = editFields.tags;
      }

      if (replacementHtml !== null) {
        entries.push({ path: existing.href, mode: "100644", type: "blob", content: replacementHtml });
        updated.readingMinutes = calculateReadingMinutes(replacementHtml, postLanguage(existing), existing.type);
      }

      if (coverAction === "remove") {
        if (existing.coverImage) entries.push(deletedEntry(existing.coverImage));
        // Nothing to compose a card from any more, so the report falls back to
        // the brand card and the stale card is removed rather than orphaned.
        if (existing.shareCardImage) entries.push(deletedEntry(existing.shareCardImage));
        delete updated.coverImage;
        delete updated.shareCardImage;
      } else if (coverAction === "replace") {
        if (!/^[A-Za-z0-9._-]+$/.test(existing.id)) {
          return reply({ ok: false, error: "UNSAFE_POST_ID", message: "안전하지 않은 게시물 ID에는 커버를 저장할 수 없습니다." }, 400);
        }
        const nextCoverPath = `covers/${existing.id}.${coverExtension(coverFile)}`;
        if (existing.coverImage && existing.coverImage !== nextCoverPath) entries.push(deletedEntry(existing.coverImage));
        const blob = await gh(env.GITHUB_TOKEN, "/git/blobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: encodeBase64(await coverFile.arrayBuffer()), encoding: "base64" }),
        });
        entries.push({ path: nextCoverPath, mode: "100644", type: "blob", sha: blob.sha });
        updated.coverImage = nextCoverPath;

        // Recomposed in the browser from the replacement cover. If that failed
        // the previous card is deleted rather than left beside artwork it no
        // longer depicts; the report falls back to the brand card.
        const cardFile = form.get("shareCard");
        const nextCardPath = `${SOCIAL_REPORT_CARD_DIR}/${existing.id}.jpg`;
        if (cardFile && typeof cardFile.arrayBuffer === "function" && Number(cardFile.size || 0) > 0) {
          const cardBlob = await gh(env.GITHUB_TOKEN, "/git/blobs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content: encodeBase64(await cardFile.arrayBuffer()), encoding: "base64" }),
          });
          entries.push({ path: nextCardPath, mode: "100644", type: "blob", sha: cardBlob.sha });
          updated.shareCardImage = nextCardPath;
        } else {
          if (existing.shareCardImage) entries.push(deletedEntry(existing.shareCardImage));
          delete updated.shareCardImage;
        }
      }

      posts[postIndex] = updated;

      searchIndex[searchIdx] = {
        ...searchIndex[searchIdx],
        category: updated.type,
        typeLabel: updated.typeLabel,
        title: updated.title,
        subtitle: updated.subtitle,
        date: updated.reportDate,
        summary: updated.summary || updated.description,
        tags: Array.isArray(updated.tags) ? updated.tags : [],
        readingMinutes: typeof updated.readingMinutes === 'number' ? updated.readingMinutes : 1,
        coverImage: updated.coverImage ? `/${updated.coverImage.replace(/^\/+/, '')}` : '',
        ...(replacementHtml !== null ? { bodyText: extractSearchText(replacementHtml) } : {})
      };

      if (!hasMatchingUniqueIds(posts, searchIndex)) {
        return reply({
          ok: false,
          error: "SEARCH_INDEX_INTEGRITY_FAILED",
          message: "수정 후 데이터 정합성 검증에 실패했습니다."
        }, 500);
      }

      entries.push(...metadataEntries(sortPosts(posts), searchIndex));
      commitMessage = `Update ${updated.title}`;
      resultPost = updated;
    }

    const commit = await createCommit(env.GITHUB_TOKEN, baseSha, parentCommit.tree.sha, entries, commitMessage);
    if (!(await updateRef(env.GITHUB_TOKEN, baseSha, commit.sha))) {
      return reply({ ok: false, error: "REPOSITORY_CHANGED", message: "저장소가 변경되었습니다. 새로고침 후 다시 시도하세요." }, 409);
    }

    return reply({ ok: true, action, post: resultPost, commit: commit.sha, apiVersion: API_VERSION });
  } catch (error) {
    console.error("post management failed", { status: error?.status, message: error?.message });
    if (error?.status === 409 || error?.status === 422) {
      return reply({ ok: false, error: "REPOSITORY_CHANGED", message: "저장소가 변경되었습니다. 새로고침 후 다시 시도하세요." }, 409);
    }
    return reply({ ok: false, error: "MANAGE_FAILED", message: "게시물 처리에 실패했습니다." }, 500);
  }
}
