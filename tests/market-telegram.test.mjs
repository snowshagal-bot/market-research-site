// The Telegram post of a Market Close session: the card with a short caption,
// once per session, after today's final record is published or when the owner
// presses the button on /admin/market/blog/. Inert without the channel's
// Secrets or the table (migration 0005), and the bot token stays inside.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CARD_WAIT_MS,
  POSTS_TABLE,
  announceMarketClose,
  ensureMarketTelegramPost,
  marketPostCaption,
  readMarketPost,
  telegramConfigured
} from '../functions/_market-telegram.js';
import { TELEGRAM_CAPTION_LIMIT, marketChannelCaption } from '../functions/_market-share-text.js';
import { CARD_TABLE, cardSourceKey } from '../functions/_market-card.js';
import { makeFormat } from '../functions/_market-date-page.js';
import { TABLE_NAME, ensureMarketTable } from '../functions/api/market/_shared.js';
import { onRequestPost as publish } from '../functions/api/market/publish.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/admin/market-telegram.js';
import { __test as hostPolicy, isAdminHostnameAllowedPath } from '../functions/_host-policy.js';
import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { createAdminSession, createMockAuthDb } from './helpers/auth-test-helper.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const EXAMPLE = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const CARDS_MIGRATION = await read('migrations/comments/0004_market_close_cards.sql');
const POSTS_MIGRATION = await read('migrations/comments/0005_market_close_posts.sql');
const DATE = EXAMPLE.meta.market_date;
// 16:10 KST on the record's own day, and the same time a day later.
const SAME_DAY = new Date(`${DATE}T07:10:00.000Z`);
const NEXT_DAY = new Date(SAME_DAY.getTime() + 24 * 3600 * 1000);
const TOKEN = '123456:telegram-bot-token-secret';
const CHAT = '@snowshagal_test';
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const clone = value => JSON.parse(JSON.stringify(value));
const f = makeFormat('ko');

async function database({ posts = true, card = false, takeaway = '', configured = true, status = 'final' } = {}) {
  const db = new SqliteD1();
  const env = { COMMENTS_DB: db, ...(configured ? { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT } : {}) };
  await ensureMarketTable(env);
  const payload = clone(EXAMPLE);
  payload.meta.status = status;
  await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) VALUES (?, ?, ?, ?, ?, ?, 'test', ?, '')`)
    .bind(DATE, payload.meta.schema_version, payload.meta.generated_at, status, JSON.stringify(payload), SAME_DAY.toISOString(), takeaway).run();
  db.exec(CARDS_MIGRATION);
  if (posts) db.exec(POSTS_MIGRATION);
  if (card) {
    await db.prepare(`INSERT INTO ${CARD_TABLE} (market_date, lang, status, source_key, attempted_at, content_type, image, created_at) VALUES (?, 'ko', 'ready', ?, ?, 'image/jpeg', ?, ?)`)
      .bind(DATE, cardSourceKey(payload.meta.generated_at), SAME_DAY.toISOString(), JPEG, SAME_DAY.toISOString()).run();
  }
  return { db, env };
}

/** A Telegram stand-in that records each request. */
function telegram({ ok = true, status = 200, description = 'Bad Request: chat not found', fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const form = options.body;
    calls.push({ url: String(url), method: String(url).split('/').pop(), chat: form.get('chat_id'), caption: form.get('caption'), text: form.get('text'), photo: form.get('photo') });
    if (fail) throw new TypeError(`fetch failed for ${url}`);
    return new Response(JSON.stringify(ok ? { ok: true, result: { message_id: 4242 } } : { ok: false, description }), { status: ok ? 200 : status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const rows = db => db.prepare(`SELECT * FROM ${POSTS_TABLE}`).all().then(result => result.results);

test('the caption is short plain text with the session figures and the page address', () => {
  const caption = marketChannelCaption(EXAMPLE);
  const kospi = EXAMPLE.indices.KOSPI;
  assert.ok(caption.includes('증시 마감 · 15:30 정규장 기준'));
  assert.ok(caption.includes(`코스피 ${f.number(kospi.close, 2)} (${f.pct(kospi.change_pct)})`));
  assert.ok(caption.includes('코스피 순매수: 외국인 '));
  assert.ok(caption.endsWith(`전체 기록: https://snowshagal.com/market/${DATE}/`));
  assert.equal(/[<>]/.test(caption), false);
  assert.ok(caption.length <= TELEGRAM_CAPTION_LIMIT);

  const withLine = marketChannelCaption(EXAMPLE, { takeaway: '낙차를 되감았다.' });
  assert.ok(withLine.includes('\n\n낙차를 되감았다.\n\n전체 기록:'));
  const long = marketChannelCaption(EXAMPLE, { takeaway: '가'.repeat(3000) });
  assert.ok(long.length <= TELEGRAM_CAPTION_LIMIT, String(long.length));
  assert.ok(long.includes('…') && long.endsWith(`https://snowshagal.com/market/${DATE}/`), 'the line is cut, never the address');
});

test('without the Secrets nothing is read, sent or stored', async () => {
  const { db, env } = await database({ configured: false });
  const api = telegram();
  assert.equal(telegramConfigured(env), false);
  assert.deepEqual(await ensureMarketTelegramPost(env, DATE, { now: SAME_DAY, fetchImpl: api.fetchImpl }), { status: 'not_configured' });
  assert.deepEqual(await announceMarketClose(env, DATE, new Promise(() => {}), { now: SAME_DAY, fetchImpl: api.fetchImpl }), { status: 'not_configured' }, 'it does not wait for the card either');
  assert.equal(api.calls.length, 0);
  assert.deepEqual(await rows(db), []);
});

test('today’s session is posted once, with the card of the same record', async () => {
  const { db, env } = await database({ card: true, takeaway: '오늘의 한 줄' });
  const api = telegram();
  const first = await ensureMarketTelegramPost(env, DATE, { now: SAME_DAY, fetchImpl: api.fetchImpl });
  assert.deepEqual(first, { status: 'sent', withCard: true });
  assert.equal(api.calls.length, 1);
  const call = api.calls[0];
  assert.equal(call.url, `https://api.telegram.org/bot${TOKEN}/sendPhoto`);
  assert.equal(call.chat, CHAT);
  assert.ok(call.caption.includes('오늘의 한 줄') && call.caption.includes(`/market/${DATE}/`));
  assert.equal(call.photo.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await call.photo.arrayBuffer()), JPEG);

  const [row] = await rows(db);
  assert.equal(row.status, 'sent');
  assert.equal(row.message_id, '4242');
  assert.equal(row.with_card, 1);
  assert.equal(JSON.stringify(row).includes(TOKEN), false);

  // Publishing the record again, or asking again, never posts twice.
  assert.deepEqual(await ensureMarketTelegramPost(env, DATE, { now: new Date(SAME_DAY.getTime() + 3600 * 1000), fetchImpl: api.fetchImpl }), { status: 'already_sent' });
  assert.deepEqual(await ensureMarketTelegramPost(env, DATE, { now: NEXT_DAY, fetchImpl: api.fetchImpl, force: true }), { status: 'already_sent' });
  assert.equal(api.calls.length, 1);
  assert.deepEqual(await readMarketPost(env, DATE), { status: 'sent', attemptedAt: SAME_DAY.toISOString(), withCard: true, detail: '', postedAt: row.posted_at });
});

test('without a card of this record the caption goes out as a message', async () => {
  const { db, env } = await database();
  // A card drawn from an earlier version of the record is not this session's picture.
  await db.prepare(`INSERT INTO ${CARD_TABLE} (market_date, lang, status, source_key, attempted_at, content_type, image, created_at) VALUES (?, 'ko', 'ready', 'old-version', ?, 'image/jpeg', ?, ?)`).bind(DATE, SAME_DAY.toISOString(), JPEG, SAME_DAY.toISOString()).run();
  const api = telegram();
  assert.deepEqual(await ensureMarketTelegramPost(env, DATE, { now: SAME_DAY, fetchImpl: api.fetchImpl }), { status: 'sent', withCard: false });
  assert.equal(api.calls[0].method, 'sendMessage');
  assert.ok(api.calls[0].text.includes(`https://snowshagal.com/market/${DATE}/`));
  assert.equal(api.calls[0].photo, null);
});

test('only today’s final session is announced on its own', async () => {
  const api = telegram();
  const old = await database({ card: true });
  assert.deepEqual(await ensureMarketTelegramPost(old.env, DATE, { now: NEXT_DAY, fetchImpl: api.fetchImpl }), { status: 'not_today' });
  assert.deepEqual(await announceMarketClose(old.env, DATE, Promise.resolve(), { now: NEXT_DAY, fetchImpl: api.fetchImpl }), { status: 'not_today' });
  const provisional = await database({ status: 'provisional' });
  assert.deepEqual(await ensureMarketTelegramPost(provisional.env, DATE, { now: SAME_DAY, fetchImpl: api.fetchImpl }), { status: 'no_final_record' });
  assert.deepEqual(await ensureMarketTelegramPost(old.env, '2026-01-02', { now: SAME_DAY, fetchImpl: api.fetchImpl, force: true }), { status: 'no_final_record' });
  assert.equal(api.calls.length, 0);
  assert.deepEqual(await rows(old.db), []);

  // The owner's button posts an older session.
  assert.deepEqual(await ensureMarketTelegramPost(old.env, DATE, { now: NEXT_DAY, fetchImpl: api.fetchImpl, force: true }), { status: 'sent', withCard: true });
});

test('a failed attempt keeps Telegram’s own reason, waits ten minutes, and the button may retry at once', async () => {
  const { db, env } = await database({ card: true });
  const refused = telegram({ ok: false, status: 400, description: `Bad Request: chat not found ${TOKEN}` });
  const failed = await ensureMarketTelegramPost(env, DATE, { now: SAME_DAY, fetchImpl: refused.fetchImpl });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.detail, 'Bad Request: chat not found [token]');
  assert.equal(JSON.stringify(await rows(db)).includes(TOKEN), false);

  const api = telegram();
  const soon = new Date(SAME_DAY.getTime() + 60 * 1000);
  assert.deepEqual(await ensureMarketTelegramPost(env, DATE, { now: soon, fetchImpl: api.fetchImpl }), { status: 'skipped' });
  assert.equal(api.calls.length, 0);
  assert.deepEqual(await ensureMarketTelegramPost(env, DATE, { now: soon, fetchImpl: api.fetchImpl, force: true }), { status: 'sent', withCard: true });

  // A network error names no address, so the token cannot ride along.
  const other = await database();
  const down = telegram({ fail: true });
  assert.deepEqual(await ensureMarketTelegramPost(other.env, DATE, { now: SAME_DAY, fetchImpl: down.fetchImpl }), { status: 'failed', detail: 'network error' });
  // Past the retry window the automatic path tries again.
  assert.deepEqual(await ensureMarketTelegramPost(other.env, DATE, { now: new Date(SAME_DAY.getTime() + 11 * 60 * 1000), fetchImpl: api.fetchImpl }), { status: 'sent', withCard: false });
});

test('without the table nothing is sent and nothing throws', async () => {
  const { env } = await database({ posts: false, card: true });
  const api = telegram();
  assert.deepEqual(await ensureMarketTelegramPost(env, DATE, { now: SAME_DAY, fetchImpl: api.fetchImpl }), { status: 'failed', detail: 'internal error' });
  assert.equal(api.calls.length, 0);
  assert.equal(await readMarketPost(env, DATE), null);
  assert.ok((await marketPostCaption(env, DATE)).includes('증시 마감'));
});

test('after a publish the post waits for the card, but not for long', async () => {
  assert.ok(CARD_WAIT_MS <= 24000, 'the wait and the send must fit in waitUntil’s 30 seconds');
  const ready = await database({ card: true });
  const api = telegram();
  assert.deepEqual(await announceMarketClose(ready.env, DATE, Promise.resolve(), { now: SAME_DAY, fetchImpl: api.fetchImpl }), { status: 'sent', withCard: true });

  // A drawing that never finishes: the caption goes out alone after the wait.
  const slow = await database();
  const started = Date.now();
  assert.deepEqual(await announceMarketClose(slow.env, DATE, new Promise(() => {}), { now: SAME_DAY, fetchImpl: api.fetchImpl, waitMs: 30 }), { status: 'sent', withCard: false });
  assert.ok(Date.now() - started < 2000);
  // A drawing that failed does not stop the post.
  const broken = await database();
  assert.deepEqual(await announceMarketClose(broken.env, DATE, Promise.reject(new Error('render')), { now: SAME_DAY, fetchImpl: api.fetchImpl }), { status: 'sent', withCard: false });
});

test('the publish handler hands the card drawing to the announcement, and stays inert without Secrets', async () => {
  const source = await read('functions/api/market/publish.js');
  assert.match(source, /const cards = ensureMarketCards\(env, payload\.meta\.market_date\);\s+context\.waitUntil\(cards\);/);
  assert.match(source, /context\.waitUntil\(announceMarketClose\(env, payload\.meta\.market_date, cards\)\);/);
  assert.equal(typeof publish, 'function');
});

async function admin(options = {}) {
  const base = await database(options);
  const authDb = await createMockAuthDb();
  const session = await createAdminSession(authDb, {});
  return { ...base, session, env: { ...base.env, AUTH_DB: authDb } };
}

function adminRequest(session, method = 'GET', body = null, { query = '', origin = 'https://admin.snowshagal.com', csrf = session?.csrfToken } = {}) {
  return new Request(`https://admin.snowshagal.com/api/admin/market-telegram${query}`, {
    method,
    headers: { ...(session ? { cookie: session.cookieHeader } : {}), origin, ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : null
  });
}

test('the admin API shows the state to the administrator only', async () => {
  const { env, session } = await admin({ card: true });
  assert.equal((await adminGet({ request: adminRequest(null, 'GET', null, { query: `?date=${DATE}` }), env })).status, 401);
  assert.equal((await adminGet({ request: adminRequest(session, 'GET', null, { query: '?date=today' }), env })).status, 400);

  const response = await adminGet({ request: adminRequest(session, 'GET', null, { query: `?date=${DATE}` }), env });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const text = await response.text();
  assert.equal(text.includes(TOKEN), false);
  const body = JSON.parse(text);
  assert.equal(body.configured, true);
  assert.equal(body.post, null);
  assert.ok(body.caption.includes(`/market/${DATE}/`));

  const off = await admin({ configured: false });
  const offBody = await (await adminGet({ request: adminRequest(off.session, 'GET', null, { query: `?date=${DATE}` }), env: off.env })).json();
  assert.equal(offBody.configured, false);
});

test('the admin button posts once, and only with the session, Origin and CSRF token', async () => {
  const { env, session, db } = await admin({ card: true });
  const api = telegram();
  const post = (request) => adminPost({ request, env, now: NEXT_DAY, fetchImpl: api.fetchImpl });

  assert.equal((await post(adminRequest(null, 'POST', { date: DATE }))).status, 401);
  assert.equal((await post(adminRequest(session, 'POST', { date: DATE }, { origin: 'https://snowshagal.com' }))).status, 403);
  assert.equal((await post(adminRequest(session, 'POST', { date: DATE }, { csrf: 'wrong' }))).status, 403);
  assert.equal((await post(adminRequest(session, 'POST', { date: 'nope' }))).status, 400);
  assert.equal(api.calls.length, 0);
  assert.deepEqual(await rows(db), []);

  const sent = await post(adminRequest(session, 'POST', { date: DATE }));
  assert.equal(sent.status, 200);
  const body = await sent.json();
  assert.equal(body.ok, true);
  assert.equal(body.result, 'sent');
  assert.equal(body.post.status, 'sent');
  assert.equal(body.post.withCard, true);
  assert.equal(api.calls.length, 1);

  const again = await post(adminRequest(session, 'POST', { date: DATE }));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).result, 'already_sent');
  assert.equal(api.calls.length, 1);

  const off = await admin({ configured: false });
  const refused = await adminPost({ request: adminRequest(off.session, 'POST', { date: DATE }), env: off.env, now: NEXT_DAY, fetchImpl: api.fetchImpl });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'TELEGRAM_NOT_CONFIGURED');

  const down = await admin();
  const failed = await adminPost({ request: adminRequest(down.session, 'POST', { date: DATE }), env: down.env, now: NEXT_DAY, fetchImpl: telegram({ ok: false, status: 403, description: 'Forbidden: bot is not a member of the channel chat' }).fetchImpl });
  assert.equal(failed.status, 502);
  const failedBody = await failed.json();
  assert.equal(failedBody.ok, false);
  assert.ok(failedBody.message.includes('bot is not a member'));
  assert.equal(failedBody.post.status, 'failed');
});

test('the admin host admits the API and treats its POST as a human-admin mutation', () => {
  assert.equal(isAdminHostnameAllowedPath('/api/admin/market-telegram'), true);
  assert.equal(hostPolicy.HUMAN_ADMIN_MUTATION_PATHS.has('/api/admin/market-telegram'), true);
});

test('the migration is idempotent, matches db/schema.sql and touches no other table', async () => {
  const db = new SqliteD1();
  db.exec(POSTS_MIGRATION);
  db.exec(POSTS_MIGRATION);
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map(row => row.name);
  assert.deepEqual(tables, [POSTS_TABLE]);
  const body = sql => sql.match(/CREATE TABLE IF NOT EXISTS market_close_posts \(([\s\S]*?)\);/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(body(await read('db/schema.sql')), body(POSTS_MIGRATION));
  assert.equal(/\b(?:DROP|ALTER|DELETE|UPDATE)\b/i.test(POSTS_MIGRATION.replace(/^--.*$/gm, '')), false);
});

test('the screen shows the channel state and asks for a second press before posting', async () => {
  const html = await read('admin/market/blog/index.html');
  for (const id of ['blog-telegram-badge', 'blog-telegram-status', 'blog-telegram-caption', 'blog-telegram-send']) assert.ok(html.includes(`id="${id}"`), id);
  const script = await read('assets/admin-market-blog.js');
  assert.ok(script.includes("fetch('/api/admin/market-telegram'"));
  assert.ok(script.includes("'x-csrf-token': await csrf()"));
  assert.ok(script.includes('한 번 더 누르면 채널에 올립니다'));
  assert.equal(/TELEGRAM_BOT_TOKEN|api\.telegram\.org/.test(`${html}${script}`), false);
});
