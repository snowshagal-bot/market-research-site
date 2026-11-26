// The Market Close card: /market/YYYY-MM-DD/card.jpg, the session page's share
// image. Drawn from the published record by Browser Rendering once, kept in D1
// (migration 0004), and never in the way of a publish or a page.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CARD_FALLBACK_IMAGE,
  CARD_TABLE,
  CARD_VERSION,
  __test,
  cardImageUrl,
  CARD_FILL_PER_DAY,
  cardSourceKey,
  cardTakeaway,
  dailyTakeaway,
  ensureMarketCard,
  ensureMarketCards,
  marketCardHtml,
  marketCardPath,
  onMarketCardRequest,
  parseMarketCardPath,
  readMarketCardImage,
  readMarketCardMeta
} from '../functions/_market-card.js';
import { TABLE_NAME, ensureMarketTable } from '../functions/api/market/_shared.js';
import { marketDatePageHtml, onMarketPageRequest } from '../functions/_market-date-page.js';
import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const EXAMPLE = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const MIGRATION = await read('migrations/comments/0004_market_close_cards.sql');
const SHELL = await read('market/index.html');
const DATE = EXAMPLE.meta.market_date;
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const clone = value => JSON.parse(JSON.stringify(value));

/** A database with one final record; `cards: false` leaves the cards table out. */
async function database({ cards = true, generatedAt = EXAMPLE.meta.generated_at, status = 'final', date = DATE } = {}) {
  const db = new SqliteD1();
  const env = { COMMENTS_DB: db, CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_BROWSER_RENDERING_TOKEN: 'render-token-secret' };
  await ensureMarketTable(env);
  const payload = clone(EXAMPLE);
  payload.meta.market_date = date;
  payload.meta.status = status;
  payload.meta.generated_at = generatedAt;
  await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) VALUES (?, ?, ?, ?, ?, ?, ?, '', '')`)
    .bind(date, payload.meta.schema_version, generatedAt, status, JSON.stringify(payload), '2026-09-15T07:10:00.000Z', 'test').run();
  if (cards) db.exec(MIGRATION);
  return { db, env };
}

/** A Browser Rendering stand-in that records each request. */
function renderer({ status = 200, type = 'image/jpeg', bytes = JPEG } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    return new Response(status === 200 ? bytes : 'upstream detail', { status, headers: { 'content-type': type } });
  };
  return { calls, fetchImpl };
}

test('card addresses: one per session and language, nothing else', () => {
  assert.deepEqual(parseMarketCardPath(`/market/${DATE}/card.jpg`), { lang: 'ko', date: DATE });
  assert.deepEqual(parseMarketCardPath(`/en/market/${DATE}/card.jpg`), { lang: 'en', date: DATE });
  for (const path of [`/market/${DATE}/`, `/market/${DATE}/card.png`, `/market/${DATE}/card.jpg/`, '/market/kospi/card.jpg', '/market/archive/card.jpg', `/ko/market/${DATE}/card.jpg`]) {
    assert.equal(parseMarketCardPath(path), null, path);
  }
  assert.equal(marketCardPath(DATE, 'ko'), `/market/${DATE}/card.jpg`);
  assert.equal(marketCardPath(DATE, 'en', 'abc'), `/en/market/${DATE}/card.jpg?v=abc`);
  assert.equal(cardImageUrl({ date: DATE, lang: 'ko', version: 'x1' }), `https://snowshagal.com/market/${DATE}/card.jpg?v=x1`);
});

test('the card shows the record’s own session figures in both languages', () => {
  const kospi = EXAMPLE.indices.KOSPI;
  const ko = marketCardHtml(EXAMPLE, 'ko');
  assert.match(ko, /<meta name="viewport" content="width=1200">/);
  assert.match(ko, /html,body\{width:1200px;height:630px;overflow:hidden\}/);
  assert.match(ko, new RegExp(`코스피 ${Math.abs(kospi.change_pct).toFixed(2)}% ${kospi.change_pct > 0 ? '상승' : '하락'}`));
  assert.ok(ko.includes(new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2 }).format(kospi.close)));
  assert.ok(ko.includes(`${DATE.replace(/-/g, '.')} (`));
  for (const text of ['15:30 KST 정규장 마감', '코스닥', '외국인', '기관', '개인', '원/달러 · 하나은행 고시', '코스피 거래대금', `snowshagal.com/market/${DATE}/`]) assert.ok(ko.includes(text), text);
  assert.doesNotMatch(ko, /<script|https?:\/\//, 'no script and no outside resource');

  const en = marketCardHtml(EXAMPLE, 'en');
  assert.match(en, new RegExp(`KOSPI ${kospi.change_pct > 0 ? 'up' : 'down'} ${Math.abs(kospi.change_pct).toFixed(2)}%`));
  for (const text of ['Regular session close, 15:30 KST', 'USD/KRW · Hana Bank rate', 'KOSPI turnover', `snowshagal.com/en/market/${DATE}/`]) assert.ok(en.includes(text), text);
  assert.doesNotMatch(en, HANGUL);
});

test('a figure the record lacks leaves its place out; nothing is invented', () => {
  const payload = clone(EXAMPLE);
  payload.meta.schema_version = '1.2.0';
  payload.section_status = { market_breadth: { status: 'unavailable', reason: 'source_validation_failed' } };
  payload.rates_fx_volatility.USDKRW = { data_state: 'unavailable', close: null };
  delete payload.market_internals;
  payload.krx_investor_trading.markets.KOSPI.investors['기관'].net_buy = null;
  payload.indices.KOSDAQ = null;
  const card = marketCardHtml(payload, 'ko');
  assert.doesNotMatch(card, /코스피 종목|원\/달러|코스피 거래대금|class="facts"/);
  assert.doesNotMatch(card, /<span>기관<\/span>/);
  assert.match(card, /<span>외국인<\/span>/);
  assert.equal((card.match(/<div class="index">/g) || []).length, 1);
  assert.doesNotMatch(card, /NaN|undefined|null|--/);

  const hostile = clone(EXAMPLE);
  hostile.meta.market_date = '2026-09-15"><script>alert(1)</script>';
  assert.doesNotMatch(marketCardHtml(hostile, 'ko'), /<script>alert/);
});

test('a final record is captured once and stored; the same record is not drawn twice', async () => {
  const { db, env } = await database();
  const { calls, fetchImpl } = renderer();
  const now = new Date('2026-09-15T07:10:05.000Z');
  assert.deepEqual(await ensureMarketCard(env, DATE, 'ko', { now, fetchImpl }), { status: 'ready', bytes: JPEG.byteLength });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/account/browser-rendering/screenshot');
  assert.equal(calls[0].headers.authorization, 'Bearer render-token-secret');
  assert.deepEqual(calls[0].body.viewport, { width: 1200, height: 630, deviceScaleFactor: 1 });
  assert.deepEqual(calls[0].body.screenshotOptions, { type: 'jpeg', quality: 90 });
  assert.equal(calls[0].body.html, marketCardHtml(EXAMPLE, 'ko'));

  const row = await db.prepare(`SELECT * FROM ${CARD_TABLE} WHERE market_date = ? AND lang = 'ko'`).bind(DATE).first();
  assert.equal(row.status, 'ready');
  assert.equal(row.source_key, cardSourceKey(EXAMPLE.meta.generated_at));
  assert.equal(row.source_key.startsWith(`${CARD_VERSION}:`), true);
  assert.equal(row.content_type, 'image/jpeg');
  assert.deepEqual(Array.from(__test.bytesOf(row.image)), Array.from(JPEG));

  // Same record again, even much later: nothing to do.
  assert.deepEqual(await ensureMarketCard(env, DATE, 'ko', { now: new Date('2026-09-16T00:00:00.000Z'), fetchImpl }), { status: 'skipped' });
  assert.equal(calls.length, 1);

  // Both languages after a publish: Korean is already there, English is drawn.
  const both = await ensureMarketCards(env, DATE, { now: new Date('2026-09-16T00:00:00.000Z'), fetchImpl });
  assert.deepEqual(both.map(item => item.status), ['skipped', 'ready']);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1].body.html, HANGUL);
});

test('a republished record redraws the card and keeps serving the old one meanwhile', async () => {
  const { db, env } = await database();
  const first = renderer();
  await ensureMarketCard(env, DATE, 'ko', { now: new Date('2026-09-15T07:10:05.000Z'), fetchImpl: first.fetchImpl });
  const before = await readMarketCardMeta(env, DATE, 'ko');
  await db.prepare(`UPDATE ${TABLE_NAME} SET generated_at = ? WHERE market_date = ?`).bind('2026-09-15T18:00:00+09:00', DATE).run();

  // The redraw fails: the earlier image stays, the state says failed, and the next attempt waits.
  const failing = renderer({ status: 429 });
  const later = new Date('2026-09-15T09:30:00.000Z');
  assert.deepEqual(await ensureMarketCard(env, DATE, 'ko', { now: later, fetchImpl: failing.fetchImpl }), { status: 'failed' });
  assert.deepEqual(await readMarketCardMeta(env, DATE, 'ko'), before);
  assert.deepEqual(await ensureMarketCard(env, DATE, 'ko', { now: new Date(later.getTime() + 60000), fetchImpl: failing.fetchImpl }), { status: 'skipped' });
  assert.equal(failing.calls.length, 1, 'no second request inside the retry window');

  const second = renderer({ bytes: Uint8Array.from([0xff, 0xd8, 9, 9, 0xff, 0xd9]) });
  assert.equal((await ensureMarketCard(env, DATE, 'ko', { now: new Date(later.getTime() + __test.RETRY_AFTER_MS + 1000), fetchImpl: second.fetchImpl })).status, 'ready');
  const after = await readMarketCardMeta(env, DATE, 'ko');
  assert.notEqual(after.version, before.version, 'a redrawn card has a new address');
});

test('nothing is drawn without a final record, the renderer’s settings or the table', async () => {
  const { calls, fetchImpl } = renderer();
  const incomplete = await database({ status: 'incomplete' });
  assert.deepEqual(await ensureMarketCard(incomplete.env, DATE, 'ko', { fetchImpl }), { status: 'no_final_record' });
  const { env } = await database();
  assert.deepEqual(await ensureMarketCard(env, '2026-01-02', 'ko', { fetchImpl }), { status: 'no_final_record' });
  assert.deepEqual(await ensureMarketCard({ ...env, CLOUDFLARE_BROWSER_RENDERING_TOKEN: '' }, DATE, 'ko', { fetchImpl }), { status: 'not_configured' });
  const noTable = await database({ cards: false });
  assert.deepEqual(await ensureMarketCard(noTable.env, DATE, 'ko', { fetchImpl }), { status: 'failed' });
  assert.equal(await readMarketCardMeta(noTable.env, DATE, 'ko'), null);
  assert.equal(calls.length, 0);

  // An answer that is not an image is not stored.
  const text = renderer({ type: 'text/html' });
  const fresh = await database();
  assert.deepEqual(await ensureMarketCard(fresh.env, DATE, 'ko', { fetchImpl: text.fetchImpl }), { status: 'failed' });
  assert.equal(await readMarketCardMeta(fresh.env, DATE, 'ko'), null);
});

function cardContext(env, path, { method = 'GET' } = {}) {
  const pending = [];
  return {
    pending,
    context: { request: new Request(`https://snowshagal.com${path}`, { method }), env, waitUntil: promise => pending.push(promise), next: async () => new Response('static', { status: 404 }) }
  };
}

test('the card address serves the stored image, and the standard image until there is one', async () => {
  const { db, env } = await database();
  const { fetchImpl } = renderer();
  await ensureMarketCard(env, DATE, 'ko', { fetchImpl });
  const meta = await readMarketCardMeta(env, DATE, 'ko');

  const served = await onMarketPageRequest(cardContext(env, `${marketCardPath(DATE, 'ko', meta.version)}`).context);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/jpeg');
  assert.equal(served.headers.get('cache-control'), 'public, max-age=604800, immutable');
  assert.deepEqual(Array.from(new Uint8Array(await served.arrayBuffer())), Array.from(JPEG));
  const plain = await onMarketPageRequest(cardContext(env, `/market/${DATE}/card.jpg`).context);
  assert.equal(plain.headers.get('cache-control'), 'public, max-age=600');
  const head = await onMarketPageRequest(cardContext(env, `/market/${DATE}/card.jpg`, { method: 'HEAD' }).context);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(JPEG.byteLength));

  // No English card yet. This is the latest session, so one drawing starts in
  // the background (through the global fetch, replaced here so no request leaves).
  const originalFetch = globalThis.fetch;
  const background = renderer();
  globalThis.fetch = background.fetchImpl;
  try {
    const missing = cardContext(env, `/en/market/${DATE}/card.jpg`);
    const fallback = await onMarketPageRequest(missing.context);
    assert.equal(fallback.status, 302);
    assert.equal(fallback.headers.get('location'), `https://snowshagal.com${CARD_FALLBACK_IMAGE}`);
    assert.equal(fallback.headers.get('cache-control'), 'no-store');
    assert.equal(missing.pending.length, 1);
    assert.deepEqual(await Promise.all(missing.pending), [{ status: 'ready', bytes: JPEG.byteLength }]);
    assert.equal(background.calls.length, 1);
    assert.equal((await onMarketPageRequest(cardContext(env, `/en/market/${DATE}/card.jpg`).context)).status, 200);
  } finally { globalThis.fetch = originalFetch; }

  // An older session without a card answers with the standard image and starts nothing.
  await db.prepare(`DELETE FROM ${CARD_TABLE} WHERE lang = 'en'`).run();
  await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) SELECT '2026-12-30', schema_version, generated_at, status, payload_json, published_at, auth_source, '', '' FROM ${TABLE_NAME} WHERE market_date = ?`).bind(DATE).run();
  const older = cardContext(env, `/en/market/${DATE}/card.jpg`);
  assert.equal((await onMarketPageRequest(older.context)).status, 302);
  assert.equal(older.pending.length, 0);
  // Neither does a date with no record, or a database without the table.
  const unknown = cardContext(env, '/market/2026-01-02/card.jpg');
  assert.equal((await onMarketPageRequest(unknown.context)).status, 302);
  assert.equal(unknown.pending.length, 0);
  const noTable = await database({ cards: false });
  const bare = cardContext(noTable.env, `/market/${DATE}/card.jpg`);
  assert.equal((await onMarketPageRequest(bare.context)).status, 302);
  assert.equal(bare.pending.length, 0);
});

test('the session page shares its card once drawn, and the standard image before', () => {
  const context = { prev: null, next: null, report: null };
  const standard = 'https://snowshagal.com/assets/social/market-close-share.jpg';
  const before = marketDatePageHtml(SHELL, EXAMPLE, 'ko', context);
  assert.ok(before.includes(`<meta property="og:image" content="${standard}">`));
  assert.ok(before.includes(`<meta name="twitter:image" content="${standard}">`));

  const card = { date: DATE, lang: 'ko', version: 'k3x9' };
  const after = marketDatePageHtml(SHELL, EXAMPLE, 'ko', { ...context, card });
  const image = `https://snowshagal.com/market/${DATE}/card.jpg?v=k3x9`;
  assert.ok(after.includes(`<meta property="og:image" content="${image}">`));
  assert.ok(after.includes(`<meta name="twitter:image" content="${image}">`));
  assert.doesNotMatch(after, /market-close-share\.jpg/);
  assert.match(after, /<meta property="og:image:width" content="1200">\s*<meta property="og:image:height" content="630">/);
  assert.doesNotMatch(after, /<meta property="og:image:alt" content="Snowshagal Market Close">/);
  assert.equal((after.match(/property="og:image"/g) || []).length, 1);
});

test('publishing a final record starts both cards after the answer and never depends on them', async () => {
  const source = await read('functions/api/market/publish.js');
  const hook = source.slice(source.indexOf('const isLatest ='), source.indexOf('return json({ ok: true'));
  assert.match(hook, /payload\.meta\.status === 'final' && typeof context\.waitUntil === 'function'/);
  // The same drawing is handed to the Telegram announcement (tests/market-telegram.test.mjs).
  assert.match(hook, /const cards = ensureMarketCards\(env, payload\.meta\.market_date, \{ posts: cardPosts\(request, env\) \}\);\s+context\.waitUntil\(cards\);/);
  assert.doesNotMatch(hook, /await (?:ensureMarketCards|cards|announceMarketClose)/);
});

test('migration 0004 is idempotent and matches the reference schema', async () => {
  const db = new SqliteD1();
  db.exec(MIGRATION);
  db.exec(MIGRATION);
  const columns = (await db.prepare(`PRAGMA table_info(${CARD_TABLE})`).all()).results.map(column => column.name);
  assert.deepEqual(columns, ['market_date', 'lang', 'status', 'source_key', 'attempted_at', 'content_type', 'image', 'created_at']);
  const reference = await read('db/schema.sql');
  const body = sql => sql.match(/CREATE TABLE IF NOT EXISTS market_close_cards \(([\s\S]*?)\);/)[1].replace(/\s+/g, ' ').trim();
  assert.equal(body(reference), body(MIGRATION));
});

test('the latest session page starts a missing card; an older page or a page with a card does not', async () => {
  const { db, env } = await database();
  env.ASSETS = { fetch: async request => new URL(request.url).pathname.endsWith('/market/')
    ? new Response(SHELL, { headers: { 'content-type': 'text/html' } })
    : new Response('[]', { headers: { 'content-type': 'application/json' } }) };
  const originalFetch = globalThis.fetch;
  const background = renderer();
  globalThis.fetch = background.fetchImpl;
  try {
    const first = cardContext(env, `/market/${DATE}/`);
    const page = await onMarketPageRequest(first.context);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /market-close-share\.jpg/, 'this response still carries the standard image');
    assert.equal(first.pending.length, 1);
    assert.deepEqual(await Promise.all(first.pending), [{ status: 'ready', bytes: JPEG.byteLength }]);

    // With the card stored, the page shares it and starts nothing.
    const second = cardContext(env, `/market/${DATE}/`);
    assert.ok((await (await onMarketPageRequest(second.context)).text()).includes(`og:image" content="https://snowshagal.com/market/${DATE}/card.jpg?v=`));
    assert.equal(second.pending.length, 0);

    // The English page has no card yet and a later session exists: the visit
    // asks for a fill, which waits a minute after the Korean drawing.
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) SELECT '2026-12-30', schema_version, generated_at, status, payload_json, published_at, auth_source, '', '' FROM ${TABLE_NAME} WHERE market_date = ?`).bind(DATE).run();
    const older = cardContext(env, `/en/market/${DATE}/`);
    assert.equal((await onMarketPageRequest(older.context)).status, 200);
    assert.equal(older.pending.length, 1);
    assert.deepEqual(await Promise.all(older.pending), [{ status: 'skipped' }]);
    assert.equal(background.calls.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

const DAILY_KO = '외국인 순매수에 코스피가 반등, 반도체가 지수를 끌어올렸다';
const DAILY_EN = 'Foreign buying lifted the KOSPI, led by chipmakers';
const posts = (date = DATE) => [
  { type: 'daily', lang: 'ko', reportDate: date, takeaway: `${DAILY_KO}⁠`, href: 'reports/daily/ko.html' },
  { type: 'daily', lang: 'en', reportDate: date, takeaway: DAILY_EN, href: 'reports/daily/en.html' },
  { type: 'note', lang: 'ko', reportDate: date, takeaway: '노트의 한 줄은 쓰지 않는다' }
];

test('the card carries the day’s takeaway: the record’s own line first, else the Daily’s in the same language', () => {
  assert.equal(cardTakeaway('', posts(), DATE, 'ko'), DAILY_KO, 'zero-width characters are dropped');
  assert.equal(cardTakeaway('', posts(), DATE, 'en'), DAILY_EN);
  assert.equal(cardTakeaway('  편집자가   고친 한 줄 ', posts(), DATE, 'ko'), '편집자가 고친 한 줄');
  assert.equal(cardTakeaway('', posts('2026-01-02'), DATE, 'ko'), '', 'another day’s Daily is never used');
  assert.equal(cardTakeaway('', null, DATE, 'ko'), '');
  assert.equal(dailyTakeaway(posts(), DATE, 'en'), DAILY_EN);

  const plain = marketCardHtml(EXAMPLE, 'ko');
  assert.doesNotMatch(plain, /<p class="say"|class="card has-say"/);
  const withLine = marketCardHtml(EXAMPLE, 'ko', { takeaway: DAILY_KO });
  assert.match(withLine, /<div class="card has-say">/);
  assert.ok(withLine.includes(`<p class="say">${DAILY_KO}</p>`));
  assert.match(withLine, /-webkit-line-clamp:2/);
  const hostile = marketCardHtml(EXAMPLE, 'en', { takeaway: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(hostile, /<img src=x/);

  // A card without a line keeps the key it had before lines existed.
  assert.equal(cardSourceKey('2026-09-15T16:05:00+09:00'), `${CARD_VERSION}:2026-09-15T16:05:00+09:00`);
  assert.equal(cardSourceKey('2026-09-15T16:05:00+09:00', '   '), cardSourceKey('2026-09-15T16:05:00+09:00'));
  const lined = cardSourceKey('2026-09-15T16:05:00+09:00', DAILY_KO);
  assert.ok(lined.startsWith(`${cardSourceKey('2026-09-15T16:05:00+09:00')}#`));
  assert.notEqual(lined, cardSourceKey('2026-09-15T16:05:00+09:00', '다른 한 줄'));
});

test('a Daily published after the record redraws the card with its line, and Telegram still finds the card', async () => {
  const { db, env } = await database();
  const start = new Date('2026-09-15T07:10:05.000Z');
  const first = renderer();
  await ensureMarketCard(env, DATE, 'ko', { now: start, fetchImpl: first.fetchImpl, posts: [] });
  assert.doesNotMatch(first.calls[0].body.html, /class="say"/);

  // The Daily is out: the stored card is stale, and is redrawn once the retry window has passed.
  const later = new Date(start.getTime() + __test.RETRY_AFTER_MS + 1000);
  const second = renderer({ bytes: Uint8Array.from([0xff, 0xd8, 7, 7, 0xff, 0xd9]) });
  assert.equal((await ensureMarketCard(env, DATE, 'ko', { now: later, fetchImpl: second.fetchImpl, posts: Promise.resolve(posts()) })).status, 'ready');
  assert.ok(second.calls[0].body.html.includes(`<p class="say">${DAILY_KO}</p>`));
  const row = await db.prepare(`SELECT source_key FROM ${CARD_TABLE} WHERE market_date = ? AND lang = 'ko'`).bind(DATE).first();
  assert.equal(row.source_key, cardSourceKey(EXAMPLE.meta.generated_at, DAILY_KO));
  // Same line again: nothing to do.
  assert.deepEqual(await ensureMarketCard(env, DATE, 'ko', { now: new Date(later.getTime() + __test.RETRY_AFTER_MS * 2), fetchImpl: second.fetchImpl, posts: Promise.resolve(posts()) }), { status: 'skipped' });
  assert.equal(second.calls.length, 1);

  // The record's own line wins over the Daily's.
  await db.prepare(`UPDATE ${TABLE_NAME} SET takeaway_ko = ? WHERE market_date = ?`).bind('편집자의 한 줄', DATE).run();
  const third = renderer();
  assert.equal((await ensureMarketCard(env, DATE, 'ko', { now: new Date(later.getTime() + __test.RETRY_AFTER_MS * 3), fetchImpl: third.fetchImpl, posts: posts() })).status, 'ready');
  assert.ok(third.calls[0].body.html.includes('<p class="say">편집자의 한 줄</p>'));

  // The Telegram post looks the card up by the record version alone.
  const image = await readMarketCardImage(env, DATE, 'ko', EXAMPLE.meta.generated_at);
  assert.deepEqual(Array.from(image.bytes), Array.from(JPEG));
  assert.equal(await readMarketCardImage(env, DATE, 'ko', '2026-09-15T18:00:00+09:00'), null);
  assert.equal(await readMarketCardImage(env, DATE, 'ko', EXAMPLE.meta.generated_at.slice(0, -1)), null, 'a key that only starts the same does not match');
});

test('older sessions are filled a few a day, one a minute; the latest session is never held back', async () => {
  const { db, env } = await database();
  const insert = date => db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) SELECT ?, schema_version, generated_at, status, payload_json, published_at, auth_source, '', '' FROM ${TABLE_NAME} WHERE market_date = ?`).bind(date, DATE).run();
  await insert('2026-09-14');
  await insert('2026-09-11');
  const now = new Date('2026-11-25T03:00:00.000Z'); // 12:00 KST
  const { calls, fetchImpl } = renderer();

  assert.equal((await ensureMarketCard(env, '2026-09-14', 'ko', { now, fetchImpl, fill: true })).status, 'ready');
  // Thirty seconds later another fill waits; a drawing of the latest session does not.
  const soon = new Date(now.getTime() + 30000);
  assert.deepEqual(await ensureMarketCard(env, '2026-09-11', 'ko', { now: soon, fetchImpl, fill: true }), { status: 'skipped' });
  assert.equal((await ensureMarketCard(env, DATE, 'ko', { now: soon, fetchImpl })).status, 'ready');
  assert.equal(calls.length, 2);
  assert.equal((await ensureMarketCard(env, '2026-09-11', 'ko', { now: new Date(soon.getTime() + 61000), fetchImpl, fill: true })).status, 'ready');

  // The day's allowance counts every attempt since midnight KST, failed ones too.
  const stamp = new Date(now.getTime() + 5 * 60000).toISOString();
  for (let i = 0; i < CARD_FILL_PER_DAY; i += 1) {
    await db.prepare(`INSERT INTO ${CARD_TABLE} (market_date, lang, status, source_key, attempted_at) VALUES (?, 'en', 'failed', 'x', ?)`).bind(`2026-08-${String(i + 1).padStart(2, '0')}`, stamp).run();
  }
  const afterAllowance = new Date(now.getTime() + 10 * 60000);
  assert.deepEqual(await ensureMarketCard(env, '2026-09-14', 'en', { now: afterAllowance, fetchImpl, fill: true }), { status: 'skipped' });
  assert.equal((await ensureMarketCard(env, DATE, 'en', { now: afterAllowance, fetchImpl })).status, 'ready', 'the latest session is outside the allowance');
  // After midnight KST (15:00 UTC) the allowance starts again.
  assert.equal((await ensureMarketCard(env, '2026-09-14', 'en', { now: new Date('2026-11-25T15:01:00.000Z'), fetchImpl, fill: true })).status, 'ready');
  assert.equal(calls.length, 5);
});

test('a session page whose card lacks the Daily’s line starts a redraw; an older one as a fill', async () => {
  const { db, env } = await database();
  env.ASSETS = { fetch: async request => new URL(request.url).pathname.endsWith('/market/')
    ? new Response(SHELL, { headers: { 'content-type': 'text/html' } })
    : new Response(JSON.stringify(posts()), { headers: { 'content-type': 'application/json' } }) };
  const start = new Date(Date.now() - __test.RETRY_AFTER_MS - 120000);
  await ensureMarketCard(env, DATE, 'ko', { now: start, fetchImpl: renderer().fetchImpl, posts: [] });
  await ensureMarketCard(env, DATE, 'en', { now: start, fetchImpl: renderer().fetchImpl, posts: [] });
  const originalFetch = globalThis.fetch;
  const background = renderer();
  globalThis.fetch = background.fetchImpl;
  try {
    const latest = cardContext(env, `/market/${DATE}/`);
    const page = await (await onMarketPageRequest(latest.context)).text();
    assert.ok(page.includes(`og:image" content="https://snowshagal.com/market/${DATE}/card.jpg?v=`), 'the stale card is still shared meanwhile');
    assert.deepEqual(await Promise.all(latest.pending), [{ status: 'ready', bytes: JPEG.byteLength }]);
    assert.ok(background.calls[0].body.html.includes(DAILY_KO));
    // Now current: the next visit starts nothing.
    const again = cardContext(env, `/market/${DATE}/`);
    await onMarketPageRequest(again.context);
    assert.equal(again.pending.length, 0);

    // The English page of a session that is no longer the latest asks for a
    // fill, which waits for the quiet minute after the Korean drawing.
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) SELECT '2026-12-30', schema_version, generated_at, status, payload_json, published_at, auth_source, '', '' FROM ${TABLE_NAME} WHERE market_date = ?`).bind(DATE).run();
    const older = cardContext(env, `/en/market/${DATE}/`);
    await onMarketPageRequest(older.context);
    assert.deepEqual(await Promise.all(older.pending), [{ status: 'skipped' }]);
    assert.equal(background.calls.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});
