// Announces a published Market Close session in a Telegram channel: the
// session's card with a short caption, or the caption alone when there is no
// card. One post per session (market_close_posts, migration 0005).
//
// It runs after a final record of today's session is published, and when the
// owner presses the button on /admin/market/blog/. Without TELEGRAM_BOT_TOKEN
// and TELEGRAM_CHAT_ID, or without the table, nothing is sent and nothing else
// changes. Nothing here throws, and the bot token never leaves this file: it
// is not logged, stored or returned.
import { TABLE_NAME, normalizeKrwPairs } from './api/market/_shared.js';
import { kstParts } from './_trading-calendar.js';
import { readMarketCardImage } from './_market-card.js';
import { marketChannelCaption } from './_market-share-text.js';

export const POSTS_TABLE = 'market_close_posts';
export const TELEGRAM_CHANNEL = 'telegram';
// After a publish, how long the post waits for the card before going out
// without it. Browser Rendering measured 10–20 s per capture, and waitUntil
// gives about 30 s after the response.
export const CARD_WAIT_MS = 22000;
const SEND_TIMEOUT_MS = 6000;
// A second attempt for the same session waits this long, whatever the first one's end.
const RETRY_AFTER_MS = 10 * 60 * 1000;
const DETAIL_LIMIT = 200;

export function telegramConfigured(env) {
  return Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID && env?.COMMENTS_DB);
}

// Telegram's own error text ("Bad Request: chat not found"), shortened. The
// token is cut out in case a message ever repeats the request address.
function safeDetail(text, env) {
  const token = String(env?.TELEGRAM_BOT_TOKEN || '');
  let detail = String(text || '').replace(/\s+/g, ' ').trim();
  if (token) detail = detail.split(token).join('[token]');
  return detail.slice(0, DETAIL_LIMIT);
}

async function send(env, method, body, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', body, signal: controller.signal });
    const answer = await response.json().catch(() => null);
    if (!response.ok || !answer?.ok) return { ok: false, detail: safeDetail(answer?.description || `HTTP ${response.status}`, env) };
    return { ok: true, messageId: String(answer.result?.message_id ?? '') };
  } catch (error) {
    return { ok: false, detail: error?.name === 'AbortError' ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

function sendPost(env, caption, card, fetchImpl) {
  const form = new FormData();
  form.set('chat_id', String(env.TELEGRAM_CHAT_ID));
  if (card) {
    form.set('caption', caption);
    form.set('photo', new Blob([card.bytes], { type: card.type }), 'market-close.jpg');
    return send(env, 'sendPhoto', form, fetchImpl);
  }
  form.set('text', caption);
  return send(env, 'sendMessage', form, fetchImpl);
}

/** The stored state of a session's post, or null. Never throws. */
export async function readMarketPost(env, date) {
  try {
    const row = await env.COMMENTS_DB.prepare(`SELECT status, attempted_at, with_card, detail, posted_at FROM ${POSTS_TABLE} WHERE market_date = ? AND channel = ? LIMIT 1`).bind(date, TELEGRAM_CHANNEL).first();
    if (!row) return null;
    return { status: row.status, attemptedAt: row.attempted_at, withCard: Boolean(row.with_card), detail: row.detail || '', postedAt: row.posted_at || '' };
  } catch (_) {
    return null;
  }
}

/** The caption a session's post would carry, or '' without a final record. Never throws. */
export async function marketPostCaption(env, date) {
  try {
    const record = await env.COMMENTS_DB.prepare(`SELECT status, payload_json, takeaway_ko FROM ${TABLE_NAME} WHERE market_date = ? LIMIT 1`).bind(date).first();
    if (!record || record.status !== 'final') return '';
    return marketChannelCaption(normalizeKrwPairs(JSON.parse(record.payload_json)), { takeaway: record.takeaway_ko });
  } catch (_) {
    return '';
  }
}

/**
 * Posts the session once. Without `force` only today's session (KST) is
 * posted, so publishing an older record again announces nothing; `force` is
 * the owner's own button. Returns what happened; never throws.
 */
export async function ensureMarketTelegramPost(env, date, { now = new Date(), fetchImpl = fetch, force = false } = {}) {
  if (!telegramConfigured(env)) return { status: 'not_configured' };
  if (!force && kstParts(now).date !== date) return { status: 'not_today' };
  const db = env.COMMENTS_DB;
  let claimed = false;
  try {
    const record = await db.prepare(`SELECT status, generated_at, payload_json, takeaway_ko FROM ${TABLE_NAME} WHERE market_date = ? LIMIT 1`).bind(date).first();
    if (!record || record.status !== 'final') return { status: 'no_final_record' };
    const stamp = now.toISOString();
    const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
    // One attempt at a time, and never a second post for a session already sent.
    // The owner's button may try again at once after a failed attempt.
    const claim = await db.prepare(`INSERT INTO ${POSTS_TABLE} (market_date, channel, status, attempted_at)
        VALUES (?1, ?2, 'pending', ?3)
        ON CONFLICT(market_date, channel) DO UPDATE SET status = 'pending', attempted_at = ?3, detail = NULL
        WHERE ${POSTS_TABLE}.status != 'sent'
          AND (${POSTS_TABLE}.attempted_at < ?4 OR (?5 = 1 AND ${POSTS_TABLE}.status = 'failed'))`)
      .bind(date, TELEGRAM_CHANNEL, stamp, retryBefore, force ? 1 : 0).run();
    if (!claim?.meta?.changes) {
      const existing = await readMarketPost(env, date);
      return { status: existing?.status === 'sent' ? 'already_sent' : 'skipped' };
    }
    claimed = true;

    const caption = marketChannelCaption(normalizeKrwPairs(JSON.parse(record.payload_json)), { takeaway: record.takeaway_ko });
    const card = await readMarketCardImage(env, date, 'ko', record.generated_at);
    const result = await sendPost(env, caption, card, fetchImpl);
    if (!result.ok) {
      console.error('market telegram post failed', date, result.detail);
      await db.prepare(`UPDATE ${POSTS_TABLE} SET status = 'failed', detail = ?3 WHERE market_date = ?1 AND channel = ?2`).bind(date, TELEGRAM_CHANNEL, result.detail).run();
      return { status: 'failed', detail: result.detail };
    }
    await db.prepare(`UPDATE ${POSTS_TABLE} SET status = 'sent', message_id = ?3, with_card = ?4, detail = NULL, posted_at = ?5 WHERE market_date = ?1 AND channel = ?2`)
      .bind(date, TELEGRAM_CHANNEL, result.messageId, card ? 1 : 0, new Date().toISOString()).run();
    return { status: 'sent', withCard: Boolean(card) };
  } catch (error) {
    // The message is the database's or the JSON parser's; requests to Telegram never throw out of send().
    console.error('market telegram post unavailable', date, error?.message || error);
    if (claimed) {
      try { await db.prepare(`UPDATE ${POSTS_TABLE} SET status = 'failed', detail = 'internal error' WHERE market_date = ? AND channel = ? AND status = 'pending'`).bind(date, TELEGRAM_CHANNEL).run(); } catch (_) {}
    }
    return { status: 'failed', detail: 'internal error' };
  }
}

/**
 * For context.waitUntil after a publish: waits for the card drawing that the
 * publish started (`cards`), but no longer than CARD_WAIT_MS, then posts with
 * whatever card exists. Does nothing, and waits for nothing, when the channel
 * is not configured or the record is not today's session.
 */
export async function announceMarketClose(env, date, cards, { now = new Date(), fetchImpl = fetch, waitMs = CARD_WAIT_MS } = {}) {
  if (!telegramConfigured(env)) return { status: 'not_configured' };
  if (kstParts(now).date !== date) return { status: 'not_today' };
  let timer;
  try {
    await Promise.race([
      Promise.resolve(cards).catch(() => null),
      new Promise(resolve => { timer = setTimeout(resolve, waitMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
  return ensureMarketTelegramPost(env, date, { now, fetchImpl });
}
