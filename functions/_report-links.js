import { PRODUCTION_ORIGIN, escapeHtml, findTranslationCounterpart, postLanguage, reportSiteUrl } from './_seo.js';
import { RENAMED_REPORTS, REPORT_LINK_CORRECTIONS } from './_report-link-targets.js';
import { REVIEWED_REPORT_LOCALES } from './_report-link-localizations.js';

const SITE_HOSTS = new Set(['snowshagal.com', 'www.snowshagal.com']);
const BILINGUAL_HUBS = new Set(['/market/', '/basics/', '/daily/', '/notes/']);
const PENDING_REPORTS = new Set(['/reports/basics-22-settlement']);
const KO_EDITION = /\b(?:read\s+in\s+korean|(?:original\s+)?korean\s+(?:edition|version|text|source|report|original|only))\b|\(\s*in\s+korean\s*\)|한국어판|한글판|국문판|한국어\s*원문|국문\s*원문/i;

export function reportLinkPath(pathname) {
  if (!pathname.startsWith('/reports/') || /%2f|%5c/i.test(pathname)) return '';
  try { return decodeURIComponent(pathname).normalize('NFC').replace(/\.html?$/i, ''); } catch (_) { return ''; }
}

function linkTarget(value, base) {
  if (!value?.trim() || value.trim().startsWith('#')) return null;
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol) || !SITE_HOSTS.has(url.host) || url.username || url.password) return null;
    return url;
  } catch (_) { return null; }
}

export function reportLinkIndex(posts) {
  return new Map(posts.map(post => [reportLinkPath(new URL(reportSiteUrl(post.href)).pathname), post]));
}

function correctedPath(path, index) {
  if (index.has(path)) return path;
  return RENAMED_REPORTS[path] || REPORT_LINK_CORRECTIONS[path] || path;
}

function markedKorean(attr, text = '') {
  return ['lang', 'hreflang', 'data-keep-lang'].some(name => /^ko(?:-|$)/i.test(attr(name) || ''))
    || KO_EDITION.test([attr('title'), attr('aria-label'), text].join(' '));
}

function createLinkRewriter(posts, source) {
  const index = reportLinkIndex(posts);
  const sourceUrl = reportSiteUrl(source.href);
  const review = REVIEWED_REPORT_LOCALES[source.id];
  const localized = postLanguage(source) === 'en' && review?.[0] === (source.updatedAt || '') ? new Set(review[1]) : new Set();
  let base = sourceUrl;
  let hasBase = false;

  return {
    base(href) {
      if (hasBase) return;
      hasBase = true;
      try { base = new URL(href, sourceUrl).href; } catch (_) {}
    },
    anchor(attr) {
      const url = linkTarget(attr('href'), base);
      if (!url || attr('download') !== null) return null;
      const path = reportLinkPath(url.pathname);
      const repaired = path ? correctedPath(path, index) : url.pathname;
      const destination = index.get(repaired);
      if (path && !destination && (PENDING_REPORTS.has(path) || attr('data-report-pending') !== null)) return { pending: path };

      let nextPath = destination ? new URL(reportSiteUrl(destination.href)).pathname : url.pathname;
      // A different edition can have different anchors and query semantics.
      // The approved backlinks were checked without either; preserve new variants.
      if (!url.search && !url.hash && localized.has(repaired) && !markedKorean(attr)) {
        if (destination && postLanguage(destination) === 'ko') {
          const alternate = findTranslationCounterpart(posts, destination);
          if (alternate) nextPath = new URL(reportSiteUrl(alternate.href)).pathname;
        } else if (BILINGUAL_HUBS.has(repaired)) {
          nextPath = `/en${repaired}`;
        }
      }

      const www = url.host === 'www.snowshagal.com';
      if (!www && nextPath === url.pathname) return null;
      const suffix = url.href.slice(url.origin.length + url.pathname.length);
      // A root-relative URL remains usable on the local and Preview hosts.
      // Keep an explicit origin when the uploaded document specified one.
      const absolute = www || /^(?:https?:)?\/\//i.test(attr('href').trim()) || new URL(base).origin !== PRODUCTION_ORIGIN;
      return { href: `${absolute ? PRODUCTION_ORIGIN : ''}${nextPath}${suffix}` };
    }
  };
}

export function applyReportLinksToRewriter(rewriter, posts, source) {
  const handler = createLinkRewriter(posts, source);
  return rewriter
    .on('base[href]', { element(element) { handler.base(element.getAttribute('href')); } })
    .on('a[href]', {
      element(element) {
        const change = handler.anchor(name => {
          const value = element.getAttribute(name);
          return value === null ? null : decodeAttribute(value);
        });
        if (change?.pending) {
          element.removeAttribute('href');
          element.setAttribute('data-pending-report', change.pending);
        } else if (change) {
          element.setAttribute('href', change.href.replace(/&/g, '&amp;'));
        }
      }
    });
}

function decodeAttribute(value) {
  const entities = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (full, token) => {
    if (token[0] !== '#') return entities[token.toLowerCase()] || full;
    const code = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : Number(token.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
  });
}

// String fallback and diagnostics inspect attributes on actual tags. Skip
// literal markup in scripts, styles, examples, and comments.
function visitLinkTags(html, visit) {
  const tags = /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noscript|template)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>(?:[\s\S]*?<\/\1\s*>|[\s\S]*$)|<([a-z][\w:-]*)(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  return html.replace(tags, (match, opaque, tag, attributes, offset) => {
    if (tag?.toLowerCase() !== 'a' && tag?.toLowerCase() !== 'base') return match;
    const attrs = new Map();
    for (const entry of attributes.matchAll(/([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      const name = entry[1].toLowerCase();
      if (!attrs.has(name)) attrs.set(name, { value: decodeAttribute(entry[2] ?? entry[3] ?? entry[4] ?? ''), entry });
    }
    const attr = name => attrs.get(name)?.value ?? null;
    const replacement = visit(tag.toLowerCase(), attr, offset + match.length);
    if (!replacement) return match;
    const { entry } = attrs.get('href');
    const start = 1 + tag.length + entry.index;
    const changed = replacement.pending
      ? `data-pending-report="${escapeHtml(replacement.pending)}"`
      : `href="${escapeHtml(replacement.href)}"`;
    return match.slice(0, start) + changed + match.slice(start + entry[0].length);
  });
}

export function rewriteReportLinks(html, posts, source) {
  const handler = createLinkRewriter(posts, source);
  return visitLinkTags(html, (tag, attr) => {
    if (tag === 'base' && attr('href') !== null) handler.base(attr('href'));
    return tag === 'a' ? handler.anchor(attr) : null;
  });
}

/** Advisory on publish, and checked against deployed HTML by the SEO audit. */
export function reportLinkDiagnostics(html, source, posts, index = reportLinkIndex(posts)) {
  const sourceUrl = reportSiteUrl(source.href);
  let base = sourceUrl;
  let hasBase = false;
  const issues = [];
  visitLinkTags(html, (tag, attr, textStart) => {
    const href = attr('href');
    if (tag === 'base') {
      if (!hasBase && href !== null) {
        hasBase = true;
        try { base = new URL(href, sourceUrl).href; } catch (_) {}
      }
      return null;
    }
    const pending = attr('data-pending-report');
    const url = linkTarget(href, base);
    const path = url ? reportLinkPath(url.pathname) : '';
    if (!path && !reportLinkPath(pending || '')) return null;
    const post = index.get(path);
    if (!post) {
      if (pending || PENDING_REPORTS.has(path) || attr('data-report-pending') !== null) {
        issues.push({ check: 'links.pending-report', href: href || pending });
      } else if (RENAMED_REPORTS[path] && index.has(RENAMED_REPORTS[path])) {
        issues.push({ check: 'links.redirected-report', href, suggested: RENAMED_REPORTS[path] });
      } else if (url) {
        const suggested = correctedPath(path, index);
        issues.push({ check: 'links.broken-report', href, ...(index.has(suggested) ? { suggested } : {}) });
      }
    } else if (postLanguage(source) === 'en' && postLanguage(post) === 'ko') {
      const text = decodeAttribute(html.slice(textStart).match(/^([\s\S]*?)<\/a\s*>/i)?.[1]?.replace(/<[^>]*>/g, ' ') || '');
      const alternate = findTranslationCounterpart(posts, post);
      if (alternate && !markedKorean(attr, text)) issues.push({ check: 'links.korean-edition', href, suggested: reportSiteUrl(alternate.href) });
    }
    return null;
  });
  return issues;
}

export function possibleTranslationPairs(source, posts) {
  if (postLanguage(source) !== 'en' || findTranslationCounterpart(posts, source)) return [];
  const date = source.reportDate || source.date;
  if (!date) return [];
  return posts.filter(post => postLanguage(post) === 'ko' && post.type === source.type
    && (post.reportDate || post.date) === date && !findTranslationCounterpart(posts, post));
}
