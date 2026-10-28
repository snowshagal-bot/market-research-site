// The market glossary: /basics/glossary/ and /en/basics/glossary/.
//
// Reports already explain their terms in tooltips, in two markups:
//   <span class="term">TERM<span class="tip">TIP</span></span>
//   <button class="term" data-tip="TIP">TERM</button>
// The publisher extracts them with each report (extractGlossaryTerms) and keeps
// them on the report's search index entry as `glossaryTerms`, so publishing,
// replacing or deleting a report updates them with no extra step. They are
// also written out as data/glossary.json. This page reads that file and
// data/posts.json and builds the glossary at request time. The report HTML is
// only read, never changed.
//
// Daily tooltips sometimes describe that day ("오늘 지수 상승분의 앞줄") rather
// than the term, so a definition is chosen in this order:
//   1. a Market Basics episode's tooltip (written as a definition);
//   2. otherwise, the most repeated tooltip that names no particular day,
//      provided the term is used in at least two reports.
// A term with neither is left out.

export const GLOSSARY_PATH = 'data/glossary.json';
const MAX_TERM_LENGTH = 40;
const MIN_TIP_LENGTH = 8;
const MAX_TIP_LENGTH = 320;
const SOURCES_SHOWN = 3;

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gi, '&');
}

function plainText(markup) {
  return decodeEntities(String(markup || '').replace(/<[^>]+>/g, ' '))
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

/** [{ term, tip }] for one report's HTML, the first tooltip of each term. */
export function extractGlossaryTerms(html) {
  const source = String(html || '');
  const found = [];
  const seen = new Set();
  const add = (rawTerm, rawTip) => {
    const term = plainText(rawTerm);
    const tip = clip(plainText(rawTip), MAX_TIP_LENGTH);
    if (!term || term.length > MAX_TERM_LENGTH || !/[A-Za-z가-힣]/.test(term)) return;
    if (tip.length < MIN_TIP_LENGTH) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ term, tip });
  };
  for (const match of source.matchAll(/<span class="term">([\s\S]{1,200}?)<span class="tip">([\s\S]*?)<\/span><\/span>/g)) add(match[1], match[2]);
  for (const match of source.matchAll(/<button class="term"[^>]*?\bdata-tip="([^"]*)"[^>]*>([\s\S]{1,200}?)<\/button>/g)) add(match[2], match[1]);
  return found;
}

/** data/glossary.json: { postId: [{ term, tip }] }, one report per line. */
export function serializeGlossary(searchIndex) {
  const lines = (Array.isArray(searchIndex) ? searchIndex : [])
    .filter(entry => entry?.id && Array.isArray(entry.glossaryTerms) && entry.glossaryTerms.length)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(entry => `${JSON.stringify(entry.id)}:${JSON.stringify(entry.glossaryTerms)}`);
  return lines.length ? `{\n${lines.join(',\n')}\n}\n` : '{}\n';
}

/* --------------------------------------------------------------- selection */

const DAY_SPECIFIC = /(오늘|이날|어제|전일|전날|\btoday\b|\byesterday\b|\b\d{1,2}\/\d{1,2}\b|\d{1,2}월 ?\d{1,2}일|\b\d{2}\.\d{2}\b|\bas of\b|기준일|발동|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/i;

function postLang(post) {
  return post?.lang === 'en' ? 'en' : 'ko';
}

function postDate(post) {
  return String(post?.reportDate || post?.date || '');
}

function reportUrl(post) {
  const path = String(post?.href || '').replace(/^\/+/, '').replace(/\.html?$/i, '');
  return `/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * The glossary for one language: entries sorted for that language, each
 * { term, definition, sources: [{ title, url, type, date }], mentions }.
 */
export function glossaryEntries(posts, glossary, lang) {
  const byId = new Map((Array.isArray(posts) ? posts : []).filter(post => post?.id && post?.href).map(post => [post.id, post]));
  const groups = new Map();
  for (const [id, terms] of Object.entries(glossary && typeof glossary === 'object' ? glossary : {})) {
    const post = byId.get(id);
    if (!post || postLang(post) !== lang || !Array.isArray(terms)) continue;
    for (const item of terms) {
      const term = String(item?.term || '').trim();
      const tip = String(item?.tip || '').trim();
      if (!term || !tip) continue;
      const key = term.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ term, tip, post });
    }
  }

  const entries = [];
  for (const uses of groups.values()) {
    const newestFirst = [...uses].sort((a, b) => postDate(b.post).localeCompare(postDate(a.post)));
    const basics = newestFirst.find(use => use.post.type === 'basics');
    let definition = basics?.tip || '';
    if (!definition && uses.length >= 2) {
      const counts = new Map();
      for (const use of uses) {
        if (DAY_SPECIFIC.test(use.tip)) continue;
        counts.set(use.tip, (counts.get(use.tip) || 0) + 1);
      }
      definition = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }
    if (!definition) continue;

    const spellings = new Map();
    for (const use of uses) spellings.set(use.term, (spellings.get(use.term) || 0) + 1);
    const term = [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];

    const ordered = [...newestFirst].sort((a, b) => (a.post.type === 'basics' ? 0 : 1) - (b.post.type === 'basics' ? 0 : 1));
    const sources = [];
    const seen = new Set();
    for (const use of ordered) {
      if (seen.has(use.post.id)) continue;
      seen.add(use.post.id);
      sources.push({ title: String(use.post.title || ''), url: reportUrl(use.post), type: use.post.type, date: postDate(use.post) });
    }
    entries.push({ term, definition, sources, mentions: sources.length });
  }

  const collator = new Intl.Collator(lang === 'en' ? 'en' : 'ko', { sensitivity: 'base', numeric: true });
  // The page's own script first, then the other, then terms that start with a digit.
  const rank = (term) => /^[가-힣]/.test(term) ? (lang === 'en' ? 1 : 0) : /^[A-Za-z]/.test(term) ? (lang === 'en' ? 0 : 1) : 2;
  return entries.sort((a, b) => rank(a.term) - rank(b.term) || collator.compare(a.term, b.term));
}

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const BASE_INITIAL = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' };

/** The index heading a term files under: ㄱ…ㅎ, A…Z, or 0–9. */
export function glossaryLetter(term) {
  const first = String(term || '').trim().charAt(0);
  const code = first.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const initial = INITIALS[Math.floor((code - 0xac00) / 588)];
    return BASE_INITIAL[initial] || initial;
  }
  if (/[A-Za-z]/.test(first)) return first.toUpperCase();
  return '0–9';
}

/* ------------------------------------------------------------------ render */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COPY = {
  ko: {
    index: '용어 색인',
    count: (terms, reports) => `용어 ${terms}개 · 리포트 ${reports}편의 설명에서 모았습니다.`,
    sources: '나온 글',
    more: n => `외 ${n}편`,
    empty: '아직 정리된 용어가 없습니다.'
  },
  en: {
    index: 'Term index',
    count: (terms, reports) => `${terms} terms, gathered from the explanations in ${reports} reports.`,
    sources: 'Used in',
    more: n => `and ${n} more`,
    empty: 'No terms have been collected yet.'
  }
};

/** The list placed inside the page's [data-glossary-list] element. */
export function renderGlossaryList(entries, lang) {
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  if (!entries.length) return `<p class="glossary-empty">${escapeHtml(copy.empty)}</p>`;
  const letters = new Map();
  for (const entry of entries) {
    const letter = glossaryLetter(entry.term);
    if (!letters.has(letter)) letters.set(letter, []);
    letters.get(letter).push(entry);
  }
  const reports = new Set(entries.flatMap(entry => entry.sources.map(source => source.url))).size;
  const ids = new Map([...letters.keys()].map((letter, index) => [letter, `glossary-${index + 1}`]));
  const index = `<nav class="glossary-index" aria-label="${escapeHtml(copy.index)}">${[...letters.keys()].map(letter => `<a href="#${ids.get(letter)}">${escapeHtml(letter)}</a>`).join('')}</nav>`;
  const sections = [...letters].map(([letter, items]) => `<section class="glossary-letter" id="${ids.get(letter)}" aria-labelledby="${ids.get(letter)}-h"><h2 id="${ids.get(letter)}-h">${escapeHtml(letter)}</h2><dl class="glossary-terms">${items.map(entry => {
    const shown = entry.sources.slice(0, SOURCES_SHOWN);
    const rest = entry.sources.length - shown.length;
    const sources = `<p class="glossary-sources"><span>${escapeHtml(copy.sources)}</span> ${shown.map(source => `<a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>`).join('<span aria-hidden="true"> · </span>')}${rest > 0 ? ` <small>${escapeHtml(copy.more(rest))}</small>` : ''}</p>`;
    return `<div class="glossary-entry"><dt>${escapeHtml(entry.term)}</dt><dd><p>${escapeHtml(entry.definition)}</p>${sources}</dd></div>`;
  }).join('')}</dl></section>`).join('');
  return `<p class="glossary-count">${escapeHtml(copy.count(entries.length, reports))}</p>${index}${sections}`;
}

const LIST_PLACEHOLDER = /(<div class="glossary-list" data-glossary-list>)[\s\S]*?(<\/div><!-- \/glossary-list -->)/;

/** The static page with its list filled in. Throws if the placeholder is gone. */
export function applyGlossaryList(page, listHtml) {
  if (!LIST_PLACEHOLDER.test(page)) throw new Error('glossary page is missing its list placeholder');
  return page.replace(LIST_PLACEHOLDER, (_, open, close) => `${open}${listHtml}${close}`);
}

/* ------------------------------------------------------------------- route */

export function parseGlossaryPath(pathname) {
  const match = String(pathname || '').match(/^\/(en\/)?basics\/glossary(\/?)$/);
  if (!match) return null;
  return { lang: match[1] ? 'en' : 'ko', canonical: match[2] === '/' };
}

async function assetJson(env, url, path) {
  const response = await env.ASSETS.fetch(new Request(new URL(path, url)));
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

/**
 * functions/basics/[[path]].js and functions/en/basics/[[path]].js. Only the
 * glossary path is handled; /basics/ and anything else go on to the static
 * site. When the data cannot be read the static page goes out as it is, with
 * its own short note in place of the list.
 */
export async function onGlossaryRequest(context) {
  const url = new URL(context.request.url);
  const route = parseGlossaryPath(url.pathname);
  if (!route) return context.next();
  if (!route.canonical) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const response = await context.next();
  if (!response.ok || !String(response.headers.get('content-type') || '').includes('text/html')) return response;
  const page = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  try {
    const [posts, glossary] = await Promise.all([
      assetJson(context.env, url, '/data/posts.json'),
      assetJson(context.env, url, `/${GLOSSARY_PATH}`)
    ]);
    const body = applyGlossaryList(page, renderGlossaryList(glossaryEntries(posts, glossary, route.lang), route.lang));
    headers.set('cache-control', 'public, max-age=300');
    return new Response(body, { status: 200, headers });
  } catch (error) {
    console.error('glossary list unavailable', error);
    return new Response(page, { status: response.status, headers });
  }
}
