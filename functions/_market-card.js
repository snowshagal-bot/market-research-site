// The day's Market Close as one 1200×630 image: /market/YYYY-MM-DD/card.jpg
// (and /en/…). It is the session page's share image (og:image) and the picture
// to post beside a link to that page.
//
// The card is an HTML page drawn from the published record and captured once by
// Cloudflare Browser Rendering (the same account API the cover generator uses),
// then kept in D1 (market_close_cards, migration 0004). It is made when a final
// record is published; a request for the latest session's card that finds none
// starts one more attempt. Nothing here creates the table: without it every
// path answers as if no card existed.
import { escapeHtml } from './_seo.js';
import { TABLE_NAME } from './api/market/_shared.js';
import { longDate, makeFormat, marketDatePath } from './_market-date-page.js';

export const CARD_TABLE = 'market_close_cards';
// Part of the stored row: a change to the card's design or content rule makes
// every stored card stale, so the next publish (or request for the latest
// session) redraws it.
export const CARD_VERSION = '1';
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const CARD_FALLBACK_IMAGE = '/assets/social/market-close-share.jpg';
const PRODUCTION_ORIGIN = 'https://snowshagal.com';
// Browser Rendering measured 10–20 s per capture (2026-11-11); waitUntil gives
// about 30 s after the response.
const RENDER_TIMEOUT_MS = 28000;
// A second attempt for the same card waits this long, whatever the first one's end.
const RETRY_AFTER_MS = 10 * 60 * 1000;
const MAX_CARD_BYTES = 1024 * 1024;
const CARD_PATH = /^\/(en\/)?market\/(\d{4}-\d{2}-\d{2})\/card\.jpg$/;

const html = escapeHtml;
const valid = (value) => typeof value === 'number' && Number.isFinite(value);

/** { lang, date } for a card address, or null. */
export function parseMarketCardPath(pathname) {
  const match = String(pathname || '').match(CARD_PATH);
  return match ? { lang: match[1] ? 'en' : 'ko', date: match[2] } : null;
}

/** The card's path; `version` (the stored row's key) makes a redrawn card a new address. */
export function marketCardPath(date, lang = 'ko', version = '') {
  return `${marketDatePath(date, lang)}card.jpg${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

const COPY = {
  ko: {
    brand: 'MARKET CLOSE', basis: '15:30 KST 정규장 마감',
    weekdays: ['일', '월', '화', '수', '목', '금', '토'],
    kospi: '코스피', kosdaq: '코스닥',
    head: (name, pct, word) => `${name} ${pct}% ${word}`, up: '상승', down: '하락', flat: '보합',
    foreign: '외국인', institution: '기관', individual: '개인', flows: '코스피 투자자별 순매수',
    fx: '원/달러', fxBasis: '15:30 확정', breadth: '코스피 종목', rise: '상승', fall: '하락', turnover: '코스피 거래대금',
    source: '매 거래일 장마감 기록 · 15:30 종가 기준'
  },
  en: {
    brand: 'MARKET CLOSE', basis: 'Regular session close, 15:30 KST',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    kospi: 'KOSPI', kosdaq: 'KOSDAQ',
    head: (name, pct, word) => `${name} ${word} ${pct}%`, up: 'up', down: 'down', flat: 'flat',
    foreign: 'Foreign', institution: 'Institutions', individual: 'Retail', flows: 'KOSPI net buying by investor',
    fx: 'USD/KRW', fxBasis: '15:30 fixing', breadth: 'KOSPI stocks', rise: 'up', fall: 'down', turnover: 'KOSPI turnover',
    source: 'Korea market close, every trading day'
  }
};

function weekday(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The card as a standalone 1200×630 HTML page. Only figures of the record's own
 * regular session: both indices, KOSPI investor flows, the USD/KRW fixing,
 * KOSPI breadth and turnover. A missing figure leaves its place out; nothing is
 * carried from another day.
 */
export function marketCardHtml(payload, lang = 'ko') {
  const key = lang === 'en' ? 'en' : 'ko';
  const copy = COPY[key];
  const f = makeFormat(key);
  const date = payload?.meta?.market_date || '';
  const kospi = payload?.indices?.KOSPI;
  const kosdaq = payload?.indices?.KOSDAQ;
  const investors = payload?.krx_investor_trading?.markets?.KOSPI?.investors || {};
  const fx = payload?.rates_fx_volatility?.USDKRW;
  const breadthOk = payload?.section_status?.market_breadth?.status !== 'unavailable';
  const breadth = breadthOk ? payload?.market_breadth?.KOSPI : null;
  const turnover = payload?.market_internals?.turnover?.KOSPI?.value_won;

  const pct = kospi?.change_pct;
  const word = !valid(pct) || pct === 0 ? copy.flat : pct > 0 ? copy.up : copy.down;
  const headline = valid(pct) ? copy.head(copy.kospi, f.number(Math.abs(pct), 2), word) : copy.kospi;
  const dateLine = key === 'ko'
    ? `${date.replace(/-/g, '.')} (${copy.weekdays[weekday(date)]})`
    : `${copy.weekdays[weekday(date)]}, ${longDate(date, 'en')}`;

  const index = (name, item) => !item || !valid(item.close) ? '' : `<div class="index">
      <p class="label">${html(name)}</p>
      <p class="value">${f.number(item.close, 2)}</p>
      <p class="change ${f.signClass(item.change_pct)}">${f.pct(item.change_pct)}${valid(item.change) ? ` <span>${f.signed(item.change, 2)}</span>` : ''}</p>
    </div>`;

  const flowRows = [['외국인', copy.foreign], ['기관', copy.institution], ['개인', copy.individual]]
    .filter(([name]) => valid(investors[name]?.net_buy))
    .map(([name, label]) => `<li><span>${html(label)}</span><b class="${f.signClass(investors[name].net_buy)}">${html(f.flow(investors[name].net_buy))}</b></li>`).join('');

  const rise = breadth ? (breadth.rise_count ?? breadth.rise) : null;
  const fall = breadth ? (breadth.fall_count ?? breadth.fall) : null;
  const facts = [
    valid(fx?.close) && fx?.data_state !== 'unavailable' ? `<li><span>${html(copy.fx)} · ${html(copy.fxBasis)}</span><b>${html(f.valueUnit('USDKRW', fx.close))}</b></li>` : '',
    valid(rise) && valid(fall) ? `<li><span>${html(copy.breadth)}</span><b><i class="up">${html(copy.rise)} ${f.integer(rise)}</i> · <i class="down">${html(copy.fall)} ${f.integer(fall)}</i></b></li>` : '',
    valid(turnover) ? `<li><span>${html(copy.turnover)}</span><b>${html(f.won(turnover))}</b></li>` : ''
  ].join('');

  return `<!doctype html>
<html lang="${key}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${CARD_WIDTH}">
<title>${html(headline)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;overflow:hidden}
body{background:#f7f3eb;color:#16233b;font-family:"Pretendard","Noto Sans KR","Noto Sans CJK KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;font-variant-numeric:tabular-nums}
.card{position:relative;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;padding:44px 56px 0;border-top:10px solid #16233b}
.top{display:flex;justify-content:space-between;align-items:baseline;font-size:20px;letter-spacing:.08em;color:#5b6472}
.top b{color:#16233b;font-weight:800;letter-spacing:.14em}
.top b span{font-weight:500;color:#8a7a5c}
.head{margin-top:26px;font-family:"Noto Serif KR","Noto Serif CJK KR","Nanum Myeongjo","Times New Roman",serif;font-variant-numeric:lining-nums;font-size:70px;line-height:1.12;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.head .up{color:#b3312c}.head .down{color:#1f4e9c}
.grid{display:grid;grid-template-columns:300px 300px 1fr;gap:0;margin-top:34px;border-top:2px solid #16233b}
.index{padding:22px 24px 0 0}
.index+.index{padding-left:28px;border-left:1px solid #d8d0c2}
.label{font-size:20px;font-weight:700;letter-spacing:.06em;color:#5b6472}
.value{margin-top:6px;font-size:54px;line-height:1.05;font-weight:800;letter-spacing:-.02em}
.change{margin-top:8px;font-size:30px;font-weight:800}
.change span{margin-left:10px;font-size:22px;font-weight:600}
.side{padding:20px 0 0 28px;border-left:1px solid #d8d0c2}
.side h2{font-size:18px;font-weight:700;letter-spacing:.02em;color:#5b6472}
ul{list-style:none}
.side li{display:flex;justify-content:space-between;align-items:baseline;margin-top:9px;font-size:26px}
.side li span{color:#3b4658}
.side li b{font-weight:800}
.facts{display:flex;gap:44px;margin-top:30px;padding-top:18px;border-top:1px solid #d8d0c2}
.facts li{display:flex;flex-direction:column;gap:5px}
.facts span{font-size:17px;color:#5b6472}
.facts b{font-size:26px;font-weight:800}
.facts i{font-style:normal}
.foot{position:absolute;left:56px;right:56px;bottom:26px;display:flex;justify-content:space-between;align-items:baseline;font-size:18px;color:#5b6472}
.foot b{font-size:20px;font-weight:800;color:#16233b;letter-spacing:.01em}
.up{color:#b3312c}.down{color:#1f4e9c}.neutral{color:#16233b}
</style>
</head>
<body>
<div class="card">
  <div class="top"><b>SNOWSHAGAL <span>${html(copy.brand)}</span></b><span>${html(dateLine)} · ${html(copy.basis)}</span></div>
  <h1 class="head"><span class="${f.signClass(pct)}">${html(headline)}</span></h1>
  <div class="grid">
    ${index(copy.kospi, kospi)}
    ${index(copy.kosdaq, kosdaq)}
    ${flowRows ? `<div class="side"><h2>${html(copy.flows)}</h2><ul>${flowRows}</ul></div>` : '<div class="side"></div>'}
  </div>
  ${facts ? `<ul class="facts">${facts}</ul>` : ''}
  <div class="foot"><b>snowshagal.com${html(marketDatePath(date, key))}</b><span>${html(copy.source)}</span></div>
</div>
</body>
</html>`;
}

/* ---------------------------------------------------------------- storage */

function bytesOf(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/** The key a stored card was drawn from: the record's own timestamp and the card design. */
export function cardSourceKey(generatedAt) {
  return `${CARD_VERSION}:${String(generatedAt || '')}`;
}

// A short, URL-safe form of the source key for ?v=.
function versionToken(sourceKey) {
  let hash = 2166136261;
  for (const char of String(sourceKey)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
  return hash.toString(36);
}

/**
 * { date, lang, version } of the session's stored card, or null. Never
 * throws: a missing table or a slow database means "no card".
 */
export async function readMarketCardMeta(env, date, lang) {
  try {
    const row = await env.COMMENTS_DB.prepare(`SELECT source_key FROM ${CARD_TABLE} WHERE market_date = ? AND lang = ? AND image IS NOT NULL LIMIT 1`).bind(date, lang === 'en' ? 'en' : 'ko').first();
    return row ? { date, lang, version: versionToken(row.source_key) } : null;
  } catch (_) {
    return null;
  }
}

/**
 * { bytes, type } of the session's stored card when it was drawn from the
 * record version `generatedAt`, or null. Never throws.
 */
export async function readMarketCardImage(env, date, lang, generatedAt) {
  try {
    const row = await env.COMMENTS_DB.prepare(`SELECT content_type, image FROM ${CARD_TABLE} WHERE market_date = ? AND lang = ? AND source_key = ? AND image IS NOT NULL LIMIT 1`)
      .bind(date, lang === 'en' ? 'en' : 'ko', cardSourceKey(generatedAt)).first();
    const bytes = bytesOf(row?.image);
    return bytes?.byteLength ? { bytes, type: row.content_type || 'image/jpeg' } : null;
  } catch (_) {
    return null;
  }
}

/* ----------------------------------------------------------------- render */

export function cardRenderingConfigured(env) {
  return Boolean(env?.CLOUDFLARE_ACCOUNT_ID && env?.CLOUDFLARE_BROWSER_RENDERING_TOKEN && env?.COMMENTS_DB);
}

async function captureCard(env, page, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/browser-rendering/screenshot`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CLOUDFLARE_BROWSER_RENDERING_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        html: page,
        viewport: { width: CARD_WIDTH, height: CARD_HEIGHT, deviceScaleFactor: 1 },
        screenshotOptions: { type: 'jpeg', quality: 90 }
      }),
      signal: controller.signal
    });
    // Only the status leaves this function: the upstream body can carry account details.
    if (!response.ok) throw new Error(`browser rendering ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'image/jpeg' && type !== 'image/png') throw new Error(`browser rendering returned ${type || 'no type'}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_CARD_BYTES) throw new Error(`card image is ${bytes.byteLength} bytes`);
    return { bytes, type };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Draws and stores the session's card for one language unless a card from the
 * same record already exists or another attempt is under way. Returns what
 * happened; never throws.
 */
export async function ensureMarketCard(env, date, lang = 'ko', { now = new Date(), fetchImpl = fetch } = {}) {
  const key = lang === 'en' ? 'en' : 'ko';
  if (!cardRenderingConfigured(env)) return { status: 'not_configured' };
  const db = env.COMMENTS_DB;
  let claimed = false;
  try {
    const record = await db.prepare(`SELECT status, generated_at, payload_json FROM ${TABLE_NAME} WHERE market_date = ? LIMIT 1`).bind(date).first();
    if (!record || record.status !== 'final') return { status: 'no_final_record' };
    const sourceKey = cardSourceKey(record.generated_at);
    const stamp = now.toISOString();
    const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
    // One attempt at a time per card: the row is taken only when there is no
    // card from this record yet and no attempt in the last ten minutes. A card
    // drawn from an earlier version of the record stays until the new one is stored.
    const claim = await db.prepare(`INSERT INTO ${CARD_TABLE} (market_date, lang, status, source_key, attempted_at)
        VALUES (?1, ?2, 'pending', ?3, ?4)
        ON CONFLICT(market_date, lang) DO UPDATE SET status = 'pending', attempted_at = ?4
        WHERE NOT (${CARD_TABLE}.status = 'ready' AND ${CARD_TABLE}.source_key = ?3) AND ${CARD_TABLE}.attempted_at < ?5`)
      .bind(date, key, sourceKey, stamp, retryBefore).run();
    if (!claim?.meta?.changes) return { status: 'skipped' };
    claimed = true;

    const payload = JSON.parse(record.payload_json);
    const { bytes, type } = await captureCard(env, marketCardHtml(payload, key), fetchImpl);
    await db.prepare(`UPDATE ${CARD_TABLE} SET status = 'ready', source_key = ?3, content_type = ?4, image = ?5, created_at = ?6 WHERE market_date = ?1 AND lang = ?2`)
      .bind(date, key, sourceKey, type, bytes, new Date().toISOString()).run();
    return { status: 'ready', bytes: bytes.byteLength };
  } catch (error) {
    console.error('market card unavailable', date, key, error?.message || error);
    if (claimed) {
      // An earlier image, if any, stays and keeps being served; only the state changes.
      try { await db.prepare(`UPDATE ${CARD_TABLE} SET status = 'failed' WHERE market_date = ? AND lang = ?`).bind(date, key).run(); } catch (_) {}
    }
    return { status: 'failed' };
  }
}

/** Both languages, side by side. For context.waitUntil after a publish. */
export function ensureMarketCards(env, date, options) {
  return Promise.all([ensureMarketCard(env, date, 'ko', options), ensureMarketCard(env, date, 'en', options)]);
}

/* ------------------------------------------------------------------ route */

function fallbackRedirect(url) {
  return new Response(null, {
    status: 302,
    headers: { location: new URL(CARD_FALLBACK_IMAGE, url).toString(), 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
  });
}

/**
 * GET /market/YYYY-MM-DD/card.jpg. The stored image when there is one;
 * otherwise the site's standard Market Close image. For the latest published
 * session only, a missing card starts one drawing in the background.
 */
export async function onMarketCardRequest(context, route) {
  const { request, env } = context;
  const url = new URL(request.url);
  try {
    const db = env.COMMENTS_DB;
    const row = await db.prepare(`SELECT content_type, image, source_key FROM ${CARD_TABLE} WHERE market_date = ? AND lang = ? AND image IS NOT NULL LIMIT 1`).bind(route.date, route.lang).first();
    const bytes = bytesOf(row?.image);
    if (bytes?.byteLength) {
      return new Response(request.method === 'HEAD' ? null : bytes, {
        status: 200,
        headers: {
          'content-type': row.content_type || 'image/jpeg',
          'content-length': String(bytes.byteLength),
          // The address carries ?v= of the record it was drawn from.
          'cache-control': url.searchParams.has('v') ? 'public, max-age=604800, immutable' : 'public, max-age=600',
          etag: `"${versionToken(row.source_key)}"`
        }
      });
    }
    const latest = await db.prepare(`SELECT MAX(market_date) AS market_date FROM ${TABLE_NAME} WHERE status = 'final'`).first();
    if (latest?.market_date === route.date && typeof context.waitUntil === 'function') {
      context.waitUntil(ensureMarketCard(env, route.date, route.lang));
    }
  } catch (error) {
    console.error('market card read failed', error?.message || error);
  }
  return fallbackRedirect(url);
}

export const __test = { versionToken, bytesOf, RETRY_AFTER_MS };
export const cardImageUrl = (meta) => `${PRODUCTION_ORIGIN}${marketCardPath(meta.date, meta.lang, meta.version)}`;
