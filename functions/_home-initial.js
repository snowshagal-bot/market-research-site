import '../assets/locale.js';
import { onRequestGet as marketLatestGet } from './api/market/latest.js';
import { onRequestGet as globalLatestGet } from './api/market/global/latest.js';
import { onRequestGet as announcementsGet } from './api/announcements.js';
import { EXPECTED_MARKET_DATE_HEADER, KRX_SESSION_HEADER } from './api/market/_shared.js';
import { escapeHtml } from './_initial-html.js';
import { cleanReportHref } from './_seo.js';

/**
 * Initial HTML for the two homepages (/ and /en/): the Latest Research slide,
 * the active notice slide and the TODAY market strip, which the static shell
 * ships as "—" placeholders for assets/site.js to fill.
 *
 * Every value comes from what the browser already reads, from the same code:
 * - Latest Research: the locale's posts, sorted and filtered by assets/locale.js
 *   (the helpers site.js calls), first `research`.
 * - TODAY: the /api/market/latest handler itself, so the page and the API read
 *   the same published row and the same x-market-expected-date; stale/notice
 *   copy comes from locale.js marketCloseAvailability. USD/KRW, US 10Y and GOLD
 *   may be overlaid with the /api/market/global/latest handler's items, judged
 *   by locale.js globalLatestOverlay at this request's time; KOSPI and KOSDAQ
 *   never are.
 * - Notice: the /api/announcements handler itself, items[0].
 *
 * The formatting below mirrors assets/site.js (publishedStripItems,
 * paintTodayStrip, paintTodayTakeaway, initHeroCarousel);
 * tests/home-initial-ssr.test.mjs runs site.js on the same data and requires
 * the same visible output.
 *
 * Nothing here may break the homepage: each source fails, or runs past the
 * budget, on its own and is then simply left to the page script, which fetches
 * it exactly as before. The data the server did render is handed to the script
 * in a JSON bootstrap so it is not requested a second time. Global Latest rides
 * with the strip: its items and the instant they were judged at, so the script
 * reaches the same overlay without a request, and an empty list when the
 * server could not read it (the strip is then the Market Close strip alone).
 */

export const HOME_INITIAL_TIME_BUDGET_MS = 1500;
export const HOME_BOOTSTRAP_ID = 'home-initial-data';

const HOME_PATH = /^\/(en\/?)?$/;
const STRIP_ITEMS = [
  { label: 'KOSPI', group: 'indices', key: 'KOSPI', format: 'index' },
  { label: 'KOSDAQ', group: 'indices', key: 'KOSDAQ', format: 'index' },
  { label: 'USD/KRW', group: 'rates_fx_volatility', key: 'USDKRW', format: 'won' },
  { label: 'US 10Y', group: 'rates_fx_volatility', key: 'US10Y', format: 'rate' },
  { label: 'GOLD', group: 'commodities_crypto', key: 'GOLD', format: 'usd' }
];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HERO_FEATURED_COVER_SIZES = '(max-width: 760px) 140px, 220px';
const DEFAULT_FEATURED_IMAGE = '/assets/social/snowshagal-home.jpg';
const SLIDE_TITLES = {
  ko: { brand: '브랜드', notice: '공지사항', research: '최신 리서치' },
  en: { brand: 'Brand', notice: 'Announcement', research: 'Latest Research' }
};
const EN_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function localeApi() {
  return globalThis.MARKET_LOCALE;
}

/** 'ko' for /, 'en' for /en/, null for every other path. */
export function homeInitialLang(pathname) {
  const match = HOME_PATH.exec(pathname);
  return match ? (match[1] ? 'en' : 'ko') : null;
}

/* ------------------------------------------------------ Latest Research */

function rootPath(path) {
  return `/${String(path || '').replace(/^\/+/, '')}`;
}

function coverThumbnailOf(post) {
  const thumbnail = String(post && post.coverThumbnail || '');
  return /-450\.webp$/i.test(thumbnail) ? rootPath(thumbnail) : '';
}

function formatReadingTime(minutes, lang) {
  if (typeof minutes !== 'number' || minutes <= 0) return '';
  return lang === 'en' ? `${minutes} min read` : `약 ${minutes}분`;
}

/** The post site.js puts on the Latest Research slide, or null. */
export function latestResearchPost(posts, lang) {
  const api = localeApi();
  return api.sortPosts(api.localePosts(posts, lang)).find(post => post.type === 'research') || null;
}

function researchEdits(post, lang) {
  const href = cleanReportHref(post.href);
  const reading = formatReadingTime(post.readingMinutes, lang);
  const cover = post.coverImage ? rootPath(post.coverImage) : '';
  const thumbnail = cover ? coverThumbnailOf(post) : '';
  const image = { src: cover || DEFAULT_FEATURED_IMAGE, alt: post.title || '' };
  if (cover && thumbnail) {
    image.srcset = `${thumbnail} 450w, ${cover} 900w`;
    image.sizes = HERO_FEATURED_COVER_SIZES;
  }
  return [
    { id: 'hero-featured-date', text: post.reportDate || post.date || '—' },
    reading
      ? { id: 'hero-featured-reading', text: reading, removeAttrs: ['hidden'] }
      : { id: 'hero-featured-reading', attrs: { hidden: '' } },
    { id: 'hero-featured-title-link', text: post.title || '', attrs: { href } },
    { id: 'hero-featured-snippet', text: String(post.summary || post.subtitle || post.description || '').trim() },
    { id: 'hero-featured-action-btn', attrs: { href } },
    { id: 'hero-featured-img-link', attrs: { href } },
    { id: 'hero-featured-img', attrs: image, removeAttrs: cover && thumbnail ? [] : ['srcset', 'sizes'] }
  ];
}

/* ---------------------------------------------------------------- notice */

export function formatAnnouncementDate(isoString, isEn) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) return '—';
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const day = String(kst.getUTCDate()).padStart(2, '0');
  if (isEn) return `${EN_MONTHS[kst.getUTCMonth()]} ${day}, ${year}`;
  return `${year}.${String(kst.getUTCMonth() + 1).padStart(2, '0')}.${day}`;
}

function noticeEdits(notice, lang) {
  const date = formatAnnouncementDate(notice.exposureStartAt || notice.createdAt, lang === 'en');
  return [
    { id: 'hero-notice-date', text: date },
    { id: 'hero-notice-title', text: notice.title || '' },
    { id: 'hero-notice-snippet', text: notice.content || '' },
    { id: 'notice-dialog-date', text: date },
    { id: 'notice-dialog-title', text: notice.title || '' },
    { id: 'notice-dialog-content', text: notice.content || '' }
  ];
}

/** Slide order, counter and controls exactly as initHeroCarousel leaves them after goTo(0). */
function carouselEdits({ research, notice, lang }) {
  const titles = SLIDE_TITLES[lang];
  const slides = [['hero-slide-1', titles.brand]];
  if (notice) slides.push(['hero-slide-notice', titles.notice]);
  if (research) slides.push(['hero-slide-2', titles.research]);
  const total = slides.length;
  const edits = slides.map(([id, title], index) => ({
    id,
    attrs: { 'aria-label': `${index + 1} of ${total}: ${title}`, 'aria-hidden': index === 0 ? 'false' : 'true' }
  }));
  if (notice) edits.push({ id: 'hero-slide-notice', removeAttrs: ['hidden'] });
  if (!research) edits.push({ id: 'hero-slide-2', attrs: { hidden: '' } });
  edits.push(
    { id: 'carousel-total', text: String(total).padStart(2, '0') },
    { id: 'carousel-current', text: '01' },
    total <= 1
      ? { id: 'hero-carousel-controls', attrs: { hidden: '' } }
      : { id: 'hero-carousel-controls', removeAttrs: ['hidden'] },
    { id: 'hero-carousel-prev', attrs: { disabled: '', 'aria-disabled': 'true' } },
    total <= 1
      ? { id: 'hero-carousel-next', attrs: { disabled: '', 'aria-disabled': 'true' } }
      : { id: 'hero-carousel-next', attrs: { 'aria-disabled': 'false' }, removeAttrs: ['disabled'] }
  );
  return edits;
}

/* ----------------------------------------------------------- TODAY strip */

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function decimal(value, digits, lang) {
  return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function stripDateLabel(value) {
  if (!ISO_DATE.test(String(value || ''))) return '';
  const [year, month, day] = String(value).split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day))).toUpperCase();
}

function declaredUnavailable(payload) {
  if (payload?.meta?.schema_version !== '1.2.0') return new Set();
  const listed = payload?.section_status?.global_indicators?.unavailable;
  return new Set(Array.isArray(listed) ? listed.filter(code => code !== 'KOSPI' && code !== 'KOSDAQ') : []);
}

/** site.js stripFigures: the formatted value and movement of one quote, or null. */
function stripFigures(spec, quote, lang) {
  if (!quote || !finiteNumber(quote.close)) return null;
  const movement = spec.format === 'index' || spec.format === 'usd' ? quote.change_pct : quote.change;
  if (!finiteNumber(movement)) return null;
  const arrow = movement < 0 ? '▼' : '▲';
  const size = Math.abs(movement);
  let value;
  let change;
  if (spec.format === 'index') {
    value = decimal(quote.close, 2, lang);
    change = `${arrow} ${decimal(size, 2, lang)}%`;
  } else if (spec.format === 'usd') {
    value = `$${decimal(quote.close, 2, lang)}`;
    change = `${arrow} ${decimal(size, 2, lang)}%`;
  } else if (spec.format === 'won') {
    value = decimal(quote.close, 2, lang);
    change = lang === 'en' ? `${arrow} ₩${decimal(size, 1, lang)}` : `${arrow} ${decimal(size, 1, lang)}원`;
  } else {
    value = `${decimal(quote.close, 2, lang)}%`;
    change = `${arrow} ${Math.round(size * 100)}bp`;
  }
  return { value, change, direction: movement < 0 ? 'down' : 'up' };
}

/** site.js publishedStripItems: all five items or null. */
export function publishedStripItems(payload, lang, overlay = null) {
  const api = localeApi();
  const soft = declaredUnavailable(payload);
  const latest = overlay?.items || {};
  const marketDate = ISO_DATE.test(String(payload?.meta?.market_date || '')) ? payload.meta.market_date : '';
  const overlaid = spec => (api.isGlobalLatestCode(spec.key) && latest[spec.key]) || null;
  const mixed = STRIP_ITEMS.some(overlaid);
  const basis = (kind, source) => (mixed ? api.todayStripBasis(kind, source, lang) : '');
  const items = STRIP_ITEMS.map(spec => {
    const quote = payload?.[spec.group]?.[spec.key];
    const snapshot = stripFigures(spec, quote, lang);
    if (!snapshot && !soft.has(spec.key)) return null;
    const item = overlaid(spec);
    if (item) {
      const figures = stripFigures(spec, { close: item.value, change: item.change, change_pct: item.change_pct }, lang);
      if (figures) return { label: spec.label, ...figures, basis: basis('latest', item) };
    }
    if (!snapshot) return { label: spec.label, value: '--', change: '', direction: 'flat', basis: '' };
    const kind = api.isGlobalLatestCode(spec.key) ? 'snapshot' : 'krx';
    return { label: spec.label, ...snapshot, basis: basis(kind, kind === 'krx' ? { source_date: marketDate } : quote) };
  }).filter(Boolean);
  return items.length === STRIP_ITEMS.length ? items : null;
}

/**
 * site.js todayStripSession for a live published session, or null.
 * `globalLatest` is { items, now } or null.
 */
export function liveStripSession(payload, expectedDate, posts, lang, krxSession = null, globalLatest = null) {
  const marketDate = ISO_DATE.test(String(payload?.meta?.market_date || '')) ? payload.meta.market_date : '';
  if (!marketDate) return null;
  const overlay = globalLatest ? localeApi().globalLatestOverlay(globalLatest.items, payload, globalLatest.now) : null;
  const items = publishedStripItems(payload, lang, overlay);
  if (!items) return null;
  const api = localeApi();
  const localized = api.sortPosts(api.localePosts(posts, lang));
  const daily = localized.find(post => post.type === 'daily' && (post.reportDate || post.date || '') === marketDate) || null;
  const override = String(payload?.takeaway?.[lang] || '').trim();
  const dailyLine = String(daily?.takeaway || '').replace(/\s+/g, ' ').trim();
  const availability = api.marketCloseAvailability(marketDate, expectedDate, lang) || { stale: false };
  // Today's KRX session, separate from freshness (site.js todayStripSession).
  const krx = api.krxSessionDisplay(krxSession, lang, { latestDate: marketDate }) || null;
  return { marketDate, items, takeaway: override || dailyLine, daily, availability, krx };
}

function stripEdits(session, lang) {
  const { availability } = session;
  const dateLabel = availability.stale ? availability.dateLabel : stripDateLabel(session.marketDate);
  const notice = availability.stale ? availability.notice : '';
  const transparency = availability.transparencyNotice;
  const grid = session.items.map(item => (
    `<div class="today-item" role="listitem"><span class="today-label">${escapeHtml(item.label)}</span><span class="today-value">${escapeHtml(item.value)}</span><span class="today-change ${item.direction}">${escapeHtml(item.change)}</span>${item.basis ? `<span class="today-basis">${escapeHtml(item.basis)}</span>` : ''}</div>`
  )).join('');
  const edits = [
    ...(session.krx
      ? [
        { id: 'today-strip-heading', attrs: { 'data-session': 'closed' } },
        { id: 'today-strip-tag', text: session.krx.label },
        {
          id: 'today-strip-date',
          text: availability.stale
            ? `${availability.tag} · ${availability.dateLabel}`
            : `${session.krx.lastCloseLabel} · ${stripDateLabel(session.marketDate)}`
        }
      ]
      : [
        { id: 'today-strip-heading', removeAttrs: ['data-session'] },
        { id: 'today-strip-tag', text: availability.stale ? availability.tag : 'TODAY' },
        dateLabel ? { id: 'today-strip-date', text: dateLabel } : null
      ]),
    notice
      ? { id: 'today-strip-notice', text: notice, removeAttrs: ['hidden'] }
      : { id: 'today-strip-notice', text: '', attrs: { hidden: '' } },
    transparency
      ? {
        id: 'today-strip-transparency',
        html: `<div class="market-transparency-card"><h3 class="market-transparency-title">${escapeHtml(transparency.title)}</h3><div class="market-transparency-body">${transparency.body.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div></div>`,
        removeAttrs: ['hidden']
      }
      : { id: 'today-strip-transparency', html: '', attrs: { hidden: '' } },
    { id: 'today-market-grid', html: grid, removeAttrs: ['aria-busy'] },
    { id: 'today-takeaway-link', attrs: { href: session.daily ? cleanReportHref(session.daily.href) : (lang === 'en' ? '/en/market/' : '/market/') } }
  ].filter(Boolean);
  if (session.takeaway) {
    edits.push(
      { id: 'today-takeaway-row', removeAttrs: ['hidden'] },
      { id: 'today-takeaway-label', text: localeApi().copy[lang].takeawayLabel },
      { id: 'today-takeaway-text', text: session.takeaway }
    );
  } else {
    edits.push({ id: 'today-takeaway-row', attrs: { hidden: '' } }, { id: 'today-takeaway-text', text: '' });
  }
  return edits;
}

/* ------------------------------------------------------------- bootstrap */

/** The published payload cut down to what site.js reads for the strip. */
function bootstrapPayload(payload, lang) {
  // source_date, data_state and retrieved_at: the overlay's newer-than-snapshot
  // test and the snapshot basis line.
  const pick = ({ close, change, change_pct: changePct, source_date: sourceDate, data_state: dataState, retrieved_at: retrievedAt }) => (
    { close, change, change_pct: changePct, source_date: sourceDate, data_state: dataState, retrieved_at: retrievedAt }
  );
  const out = {
    meta: { market_date: payload.meta.market_date, schema_version: payload.meta.schema_version },
    takeaway: { [lang]: String(payload?.takeaway?.[lang] || '') }
  };
  const unavailable = payload?.section_status?.global_indicators?.unavailable;
  if (Array.isArray(unavailable)) out.section_status = { global_indicators: { unavailable: unavailable.slice() } };
  for (const spec of STRIP_ITEMS) {
    const quote = payload?.[spec.group]?.[spec.key];
    if (quote && typeof quote === 'object') {
      out[spec.group] = out[spec.group] || {};
      out[spec.group][spec.key] = pick(quote);
    }
  }
  return out;
}

/**
 * JSON for a `<script type="application/json">` block. `<`, `>` and `&` are
 * escaped so no value can close the element or open a comment, and U+2028/29
 * so the text stays valid wherever it is read.
 */
export function serializeHomeBootstrap(data) {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script id="${HOME_BOOTSTRAP_ID}" type="application/json">${json}</script>`;
}

/* --------------------------------------------------------------- sources */

function withinBudget(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })
  ]);
}

/** { payload, expectedDate, krxSession } from the /api/market/latest handler, or null. */
async function readMarketLatest(url, env, now) {
  const request = new Request(new URL('/api/market/latest', url), { headers: { accept: 'application/json' } });
  const response = await marketLatestGet({ request, env, now });
  if (response.status !== 200) return null;
  return {
    payload: await response.json(),
    expectedDate: response.headers.get(EXPECTED_MARKET_DATE_HEADER) || '',
    krxSession: localeApi().parseKrxSessionHeader(response.headers.get(KRX_SESSION_HEADER))
  };
}

const GLOBAL_ITEM_KEYS = ['code', 'value', 'previous_close', 'change', 'change_pct', 'source_date', 'as_of', 'retrieved_at', 'data_state'];

/** { items } from the /api/market/global/latest handler, or null on failure. */
async function readGlobalLatest(url, env, now) {
  const request = new Request(new URL('/api/market/global/latest', url), { headers: { accept: 'application/json' } });
  const response = await globalLatestGet({ request, env, now });
  if (response.status !== 200) return null;
  const body = await response.json();
  return { items: Array.isArray(body?.items) ? body.items : [] };
}

/** The strip's Global Latest items, cut down to what the overlay reads. */
function bootstrapGlobalItems(items) {
  const api = localeApi();
  const strip = new Set(STRIP_ITEMS.map(spec => spec.key).filter(code => api.isGlobalLatestCode(code)));
  return (Array.isArray(items) ? items : [])
    .filter(item => item && typeof item === 'object' && strip.has(item.code))
    .map(item => Object.fromEntries(GLOBAL_ITEM_KEYS.map(key => [key, item[key] ?? null])));
}

/** { notice } (items[0] or null) from the /api/announcements handler, or null on failure. */
async function readActiveNotice(url, env, now) {
  const request = new Request(new URL('/api/announcements', url), { headers: { accept: 'application/json' } });
  const response = await announcementsGet({ request, env, now });
  if (!response.ok) return null;
  const data = await response.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return { notice: items[0] || null };
}

function settle(promise, label) {
  return promise.catch(error => {
    console.error('home initial source unavailable', label, error?.message || error);
    return null;
  });
}

/**
 * The edits and bootstrap for one homepage request, or null when this is not
 * a homepage or nothing could be rendered. Market and notice are read in
 * parallel under one budget and fail independently.
 */
export async function buildHomeInitial(url, env, posts, { now = new Date(), budgetMs = HOME_INITIAL_TIME_BUDGET_MS, readMarket = readMarketLatest, readNotice = readActiveNotice, readGlobal = readGlobalLatest } = {}) {
  const lang = homeInitialLang(url.pathname);
  if (!lang) return null;
  try {
    const [market, notice, global] = await Promise.all([
      withinBudget(settle(readMarket(url, env, now), 'market'), budgetMs),
      withinBudget(settle(readNotice(url, env, now), 'notice'), budgetMs),
      withinBudget(settle(readGlobal(url, env, now), 'global latest'), budgetMs)
    ]);
    const edits = [];
    const bootstrap = {};

    // The carousel depends on both the research post and the notice, so it is
    // rendered only when both are known; otherwise site.js builds it as before.
    const hasPosts = Array.isArray(posts);
    const research = hasPosts ? latestResearchPost(posts, lang) : null;
    if (hasPosts && notice) {
      if (research) edits.push(...researchEdits(research, lang));
      if (notice.notice) edits.push(...noticeEdits(notice.notice, lang));
      edits.push(...carouselEdits({ research, notice: notice.notice, lang }));
      const item = notice.notice;
      bootstrap.announcement = item
        ? { title: item.title || '', content: item.content || '', exposureStartAt: item.exposureStartAt || null, createdAt: item.createdAt || null }
        : null;
    } else if (research) {
      // Without the notice the slide count is unknown, but the research slide's
      // own content is not: render it and leave the counter to the script.
      edits.push(...researchEdits(research, lang));
    }

    // Judged once, at this request's time; the bootstrap carries both the
    // items and that instant so site.js reaches the same figures.
    const globalLatest = { items: bootstrapGlobalItems(global?.items), now: new Date(now).toISOString() };
    const session = market && hasPosts ? liveStripSession(market.payload, market.expectedDate, posts, lang, market.krxSession, globalLatest) : null;
    if (session) {
      edits.push(...stripEdits(session, lang));
      bootstrap.market = { payload: bootstrapPayload(market.payload, lang), expectedDate: market.expectedDate, krxSession: market.krxSession || null };
      bootstrap.globalLatest = { items: globalLatest.items, judgedAt: globalLatest.now };
    }

    if (!edits.length) return null;
    return {
      edits,
      classToggles: [],
      head: Object.keys(bootstrap).length ? serializeHomeBootstrap(bootstrap) : ''
    };
  } catch (error) {
    console.error('home initial html unavailable', error?.message || error);
    return null;
  }
}
