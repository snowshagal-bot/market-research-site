/**
 * Atom 1.0 feeds of the published reports, one per language.
 *
 *   /rss.xml      Korean   (postLanguage(post) === 'ko')
 *   /en/rss.xml   English  (postLanguage(post) === 'en')
 *
 * The file name keeps the address readers expect; the format is Atom, and
 * the response says so. Everything a reader sees comes from data/posts.json
 * through the same helpers the site itself uses — reportSiteUrl() for the
 * canonical address, reportDescription() for the summary, postLanguage() for
 * the split — so a feed never disagrees with the page it points at.
 *
 * Dates are the site's own clock, not the market's. A report is published to
 * the feed when it was registered here (`registeredAt`, or `registeredDate`
 * read as Korean midnight when there is no timestamp), never on its
 * `reportDate`: a report about last month that goes up today is new today,
 * and a reader that sorts by date should see it at the top. The market date
 * is still told, in words, at the start of the summary. A post with neither
 * registration value is left out rather than dated by guesswork.
 */
import {
  CATEGORY_LANDINGS,
  PRODUCTION_ORIGIN,
  normalizeSitePath,
  postLanguage,
  reportDescription,
  reportSiteUrl
} from './_seo.js';

export const ATOM_CONTENT_TYPE = 'application/atom+xml; charset=utf-8';
export const FEED_LIMIT = 50;
export const FEED_PATHS = Object.freeze({ ko: '/rss.xml', en: '/en/rss.xml' });
const FEED_TITLES = Object.freeze({ ko: 'Snowshagal — 최신 리포트', en: 'Snowshagal — Latest Reports' });
const FEED_HOME = Object.freeze({ ko: '/', en: '/en/' });
const REPORT_DATE_LABEL = Object.freeze({ ko: '기준일', en: 'Report date' });
// A feed with nothing in it still needs an <updated>; this is the day the
// site's first post was registered, and it never moves with the clock.
const EMPTY_FEED_UPDATED = '2026-08-09T00:00:00+09:00';

function feedLang(lang) {
  return lang === 'en' ? 'en' : 'ko';
}

export function feedPath(lang) {
  return FEED_PATHS[feedLang(lang)];
}

export function feedUrl(lang) {
  return `${PRODUCTION_ORIGIN}${feedPath(lang)}`;
}

export function feedTitle(lang) {
  return FEED_TITLES[feedLang(lang)];
}

/**
 * The one <link> a page's <head> carries for its own language's feed.
 * Relative, so it is right on Preview as well as Production.
 */
export function feedDiscoveryTag(lang) {
  const code = feedLang(lang);
  return `<link rel="alternate" type="application/atom+xml" title="Snowshagal (${code.toUpperCase()})" href="${FEED_PATHS[code]}">`;
}

/**
 * Text safe inside an Atom element or attribute. Escapes the five XML
 * characters and drops what XML 1.0 forbids outright: C0 controls other than
 * tab, newline and carriage return, the C1 range, U+FFFE/U+FFFF and unpaired
 * surrogates. HTML escaping alone leaves those in and breaks the parse.
 */
export function xmlText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function validCalendarDate(text) {
  const match = ISO_DATE.exec(String(text || ''));
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** An RFC 3339 timestamp from an ISO timestamp, or null when it is not one. */
export function atomTimestamp(value) {
  const text = String(value || '').trim();
  if (!ISO_TIMESTAMP.test(text)) return null;
  const epoch = Date.parse(text);
  if (!Number.isFinite(epoch)) return null;
  return new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** A date-only registration read as Korean midnight, or null. */
export function atomDateAtKst(value) {
  const text = String(value || '').trim();
  return validCalendarDate(text) ? `${text}T00:00:00+09:00` : null;
}

/**
 * When a post was published here and last touched, or null when the
 * registration is missing or unreadable — such a post is skipped, never
 * dated from reportDate.
 */
export function entryDates(post) {
  const published = atomTimestamp(post?.registeredAt) || atomDateAtKst(post?.registeredDate);
  if (!published) return null;
  const publishedAt = Date.parse(published);
  let updated = atomTimestamp(post?.updatedAt);
  // Never announce an update that precedes the publication.
  if (!updated || Date.parse(updated) < publishedAt) updated = published;
  return { published, updated, publishedAt, updatedAt: Date.parse(updated) };
}

function isReportPost(post) {
  return post && typeof post.href === 'string' && /^reports\/.+\.html?$/i.test(normalizeSitePath(post.href));
}

/**
 * The entries a language's feed carries, newest registration first, with a
 * deterministic order for equal timestamps, at most FEED_LIMIT.
 */
export function feedEntries(posts, lang) {
  const code = feedLang(lang);
  const entries = [];
  for (const post of Array.isArray(posts) ? posts : []) {
    if (!isReportPost(post) || postLanguage(post) !== code) continue;
    const dates = entryDates(post);
    if (!dates) continue;
    entries.push({ post, url: reportSiteUrl(post.href), ...dates });
  }
  entries.sort((a, b) => (b.publishedAt - a.publishedAt) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0) || String(a.post.id || '').localeCompare(String(b.post.id || '')));
  return entries.slice(0, FEED_LIMIT);
}

/** The summary: the market date in words, then the description the site uses. */
export function entrySummary(post, lang) {
  const code = feedLang(lang);
  const description = reportDescription(post);
  const reportDate = String(post?.reportDate || '').trim();
  if (!validCalendarDate(reportDate)) return description;
  return `${REPORT_DATE_LABEL[code]} ${reportDate} · ${description}`;
}

function entryXml(entry, lang) {
  const { post, url, published, updated } = entry;
  const code = feedLang(lang);
  const title = String(post.title || '').replace(/\s+/g, ' ').trim() || url;
  const type = String(post.type || '').trim();
  const label = CATEGORY_LANDINGS[type]?.[code]?.heading || '';
  const category = type
    ? `<category term="${xmlText(type)}"${label ? ` label="${xmlText(label)}"` : ''}/>`
    : '';
  return '<entry>'
    + `<title>${xmlText(title)}</title>`
    + `<id>${xmlText(url)}</id>`
    + `<link rel="alternate" href="${xmlText(url)}"/>`
    + `<published>${published}</published>`
    + `<updated>${updated}</updated>`
    + category
    + `<summary type="text">${xmlText(entrySummary(post, code))}</summary>`
    + '</entry>';
}

/** The whole Atom document for one language. */
export function atomFeedXml(posts, lang) {
  const code = feedLang(lang);
  const entries = feedEntries(posts, code);
  const updated = entries.length
    ? entries.reduce((latest, entry) => (entry.updatedAt > latest.updatedAt ? entry : latest), entries[0]).updated
    : EMPTY_FEED_UPDATED;
  return '<?xml version="1.0" encoding="utf-8"?>\n'
    + `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${code}">`
    + `<title>${xmlText(FEED_TITLES[code])}</title>`
    + `<id>${xmlText(feedUrl(code))}</id>`
    + `<link rel="self" type="application/atom+xml" href="${xmlText(feedUrl(code))}"/>`
    + `<link rel="alternate" href="${xmlText(`${PRODUCTION_ORIGIN}${FEED_HOME[code]}`)}"/>`
    + `<updated>${updated}</updated>`
    + '<author><name>Snowshagal</name></author>'
    + entries.map(entry => entryXml(entry, code)).join('')
    + '</feed>\n';
}

/**
 * The response for a feed route: the same shape as the sitemap's, and the
 * same fail-closed policy — a posts.json that cannot be read is a 503 that
 * says nothing about why.
 */
export function feedResponse(posts, lang) {
  return new Response(atomFeedXml(posts, lang), {
    headers: {
      'content-type': ATOM_CONTENT_TYPE,
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff'
    }
  });
}

export function feedUnavailable() {
  return new Response('Feed is temporarily unavailable.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  });
}
