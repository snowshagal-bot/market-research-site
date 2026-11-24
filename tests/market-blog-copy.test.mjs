// The blog copy screen (/admin/market/blog/): a published Market Close session
// as a title, a plain-text body and a tag line to paste, beside the session's
// card image. Read-only: it is made of the public record and saves nothing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { marketBlogPost } from '../functions/_market-share-text.js';
import { onRequestGet } from '../functions/api/market/share.js';
import { TABLE_NAME, ensureMarketTable } from '../functions/api/market/_shared.js';
import { makeFormat } from '../functions/_market-date-page.js';
import { ADMIN_ORIGIN, adminHostRouteDecision, isAdminHostnameAllowedPath } from '../functions/_host-policy.js';
import { STAMP_TARGETS, TRACKED_ASSETS } from '../scripts/asset-versions.mjs';
import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const EXAMPLE = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const DATE = EXAMPLE.meta.market_date;
const clone = value => JSON.parse(JSON.stringify(value));
const f = makeFormat('ko');

async function database(records) {
  const db = new SqliteD1();
  const env = { COMMENTS_DB: db };
  await ensureMarketTable(env);
  for (const { date, status = 'final', takeaway = '' } of records) {
    const payload = clone(EXAMPLE);
    payload.meta.market_date = date;
    payload.meta.status = status;
    await db.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) VALUES (?, ?, ?, ?, ?, ?, 'test', ?, '')`)
      .bind(date, payload.meta.schema_version, payload.meta.generated_at, status, JSON.stringify(payload), '2026-09-15T07:10:00.000Z', takeaway).run();
  }
  return env;
}

const get = (env, query = '', posts = []) => onRequestGet({
  request: new Request(`https://admin.snowshagal.com/api/market/share${query}`),
  env,
  loadPostsFn: async () => posts
});

test('the post carries the record’s own session figures as plain text', () => {
  const post = marketBlogPost(EXAMPLE);
  const kospi = EXAMPLE.indices.KOSPI;
  const kosdaq = EXAMPLE.indices.KOSDAQ;
  const [, month, day] = DATE.split('-').map(Number);

  assert.equal(post.date, DATE);
  assert.equal(post.pageUrl, `https://snowshagal.com/market/${DATE}/`);
  assert.ok(post.title.startsWith(`${month}월 ${day}일(`), post.title);
  assert.ok(post.title.includes(`코스피 ${f.number(kospi.close, 2)}(${f.pct(kospi.change_pct)})`), post.title);
  assert.ok(post.title.includes(`코스닥 ${f.number(kosdaq.close, 2)}(${f.pct(kosdaq.change_pct)})`), post.title);

  assert.ok(post.body.includes('15:30 정규장 마감 기준'));
  assert.ok(post.body.includes(`코스피 ${f.number(kospi.close, 2)} (${f.signed(kospi.change, 2)}, ${f.pct(kospi.change_pct)})`));
  const flows = EXAMPLE.krx_investor_trading.markets.KOSPI.investors;
  for (const name of ['외국인', '기관', '개인']) assert.ok(post.body.includes(`${name} ${f.flow(flows[name].net_buy)}`), name);
  assert.ok(post.body.includes(`원/달러 ${f.valueUnit('USDKRW', EXAMPLE.rates_fx_volatility.USDKRW.close)} (15:30 확정)`));
  assert.ok(post.body.includes(`코스피 거래대금 ${f.won(EXAMPLE.market_internals.turnover.KOSPI.value_won)}`));
  assert.ok(post.body.includes(post.pageUrl));
  assert.ok(post.body.endsWith('매수·매도 권유가 아닙니다.'));
  // Plain text: nothing an editor would have to interpret.
  assert.equal(/[<>]/.test(`${post.title}${post.body}${post.tags}`), false);
  assert.ok(post.tags.split(' ').every(tag => tag.startsWith('#') && tag.length > 1));
});

test('the one-line read and the Daily report appear only when the day has them', () => {
  const bare = marketBlogPost(EXAMPLE);
  assert.equal(bare.body.includes('[오늘의 한 줄]'), false);
  assert.equal(bare.body.includes('데일리 리포트'), false);

  const full = marketBlogPost(EXAMPLE, { takeaway: '  낙차를 되감았다.\n ', reportUrl: '/reports/daily-0915' });
  assert.ok(full.body.includes('[오늘의 한 줄]\n낙차를 되감았다.'));
  assert.ok(full.body.includes('이날의 데일리 리포트\nhttps://snowshagal.com/reports/daily-0915'));
});

test('a missing figure leaves its line out instead of borrowing another', () => {
  const payload = clone(EXAMPLE);
  delete payload.indices.KOSDAQ;
  delete payload.krx_investor_trading.markets.KOSDAQ;
  payload.rates_fx_volatility.USDKRW.data_state = 'unavailable';
  payload.section_status = { ...(payload.section_status || {}), market_breadth: { status: 'unavailable', reason: 'source_unavailable' } };
  delete payload.market_internals.turnover.KOSPI;

  const post = marketBlogPost(payload);
  assert.equal(post.title.includes('코스닥'), false);
  assert.equal(post.body.includes('코스닥'), false);
  assert.equal(post.body.includes('원/달러'), false);
  assert.equal(post.body.includes('상승 '), false);
  assert.equal(post.body.includes('[환율 · 시장 폭 · 거래대금]'), false);
  assert.equal(post.body.includes('--'), false);
  assert.ok(post.body.includes('[지수]\n코스피 '));
});

test('the API answers for the latest final session, or the one asked for', async () => {
  const env = await database([{ date: '2026-09-14' }, { date: '2026-09-15' }, { date: '2026-09-16', status: 'provisional' }]);

  const latest = await get(env);
  assert.equal(latest.status, 200);
  assert.equal(latest.headers.get('cache-control'), 'no-store');
  const body = await latest.json();
  assert.equal(body.date, '2026-09-15');
  assert.equal(body.latest, '2026-09-15');
  assert.deepEqual(body.dates, ['2026-09-15', '2026-09-14']);
  assert.ok(body.title.startsWith('9월 15일('));
  assert.ok(body.body.includes('https://snowshagal.com/market/2026-09-15/'));

  const older = await (await get(env, '?date=2026-09-14')).json();
  assert.equal(older.date, '2026-09-14');
  assert.equal(older.latest, '2026-09-15');

  assert.equal((await get(env, '?date=2026-09-16')).status, 404, 'a record that is not final is not offered');
  assert.equal((await get(env, '?date=2026-09-01')).status, 404);
  assert.equal((await get(env, '?date=yesterday')).status, 400);
  assert.equal((await get(await database([]))).status, 404);
});

test('the line saved with the record wins over the Daily report’s own', async () => {
  const posts = [
    { type: 'daily', lang: 'en', reportDate: '2026-09-15', href: 'reports/en/daily-0915.html', takeaway: 'English line' },
    { type: 'daily', lang: 'ko', reportDate: '2026-09-15', href: 'reports/daily-0915.html', takeaway: '데일리의 한 줄' },
    { type: 'weekly', lang: 'ko', reportDate: '2026-09-15', href: 'reports/weekly.html', takeaway: '위클리' }
  ];
  const fromDaily = await (await get(await database([{ date: '2026-09-15' }]), '', posts)).json();
  assert.ok(fromDaily.body.includes('[오늘의 한 줄]\n데일리의 한 줄'));
  assert.ok(fromDaily.body.includes('https://snowshagal.com/reports/daily-0915'));
  assert.equal(fromDaily.body.includes('English line'), false);

  const override = await (await get(await database([{ date: '2026-09-15', takeaway: '직접 넣은 한 줄' }]), '', posts)).json();
  assert.ok(override.body.includes('[오늘의 한 줄]\n직접 넣은 한 줄'));
  assert.equal(override.body.includes('데일리의 한 줄'), false);

  const none = await (await get(await database([{ date: '2026-09-15' }]))).json();
  assert.equal(none.body.includes('[오늘의 한 줄]'), false);
});

test('the admin host serves the screen, its files, the text and the card, and nothing more of /market/', () => {
  for (const pathname of [
    '/admin/market/blog/',
    '/assets/admin-market-blog.js',
    '/assets/admin-market-blog.css',
    '/api/market/share',
    '/market/2026-11-24/card.jpg',
    '/en/market/2026-11-24/card.jpg'
  ]) assert.equal(isAdminHostnameAllowedPath(pathname), true, pathname);
  for (const pathname of [
    '/market/',
    '/market/2026-11-24/',
    '/market/2026-11-24/card.png',
    '/market/2026-11-24/card.jpg/',
    '/market/archive/card.jpg',
    '/assets/social/market-close-share.jpg'
  ]) assert.equal(isAdminHostnameAllowedPath(pathname), false, pathname);
  assert.deepEqual(adminHostRouteDecision(`${ADMIN_ORIGIN}/market/2026-11-24/card.jpg`), { action: 'pass' });
  assert.deepEqual(adminHostRouteDecision(`${ADMIN_ORIGIN}/market/2026-11-24/`), { action: 'deny', status: 404 });
});

test('the screen has its fields, copy buttons and card controls, and stays out of search', async () => {
  const html = await read('admin/market/blog/index.html');
  for (const id of ['blog-date', 'blog-reload', 'blog-status', 'blog-title', 'blog-body', 'blog-tags', 'blog-image', 'blog-image-copy', 'blog-image-save', 'blog-image-retry', 'blog-image-status', 'blog-page-link']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  for (const target of ['blog-title', 'blog-body', 'blog-tags']) assert.ok(html.includes(`data-copy="${target}"`), target);
  assert.ok(html.includes('<meta name="robots" content="noindex,nofollow">'));
  assert.match(html, /href="\.\/" aria-current="page">블로그용 글<\/a>/);
  assert.match(html, /src="\/assets\/admin-market-blog\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /href="\/assets\/admin-market-blog\.css\?v=[0-9a-f]{10}"/);
  assert.ok(STAMP_TARGETS.includes('admin/market/blog/index.html'));
  assert.ok(TRACKED_ASSETS.includes('assets/admin-market-blog.js') && TRACKED_ASSETS.includes('assets/admin-market-blog.css'));
});

test('every admin page links to the blog copy screen', async () => {
  const links = {
    'admin/index.html': './market/blog/',
    'admin/manage/index.html': '../market/blog/',
    'admin/analytics/index.html': '../market/blog/',
    'admin/disclosures/index.html': '../market/blog/',
    'admin/market/index.html': './blog/',
    'admin/market/announcements/index.html': '../blog/'
  };
  for (const [page, href] of Object.entries(links)) {
    assert.ok((await read(page)).includes(`<a href="${href}">블로그용 글</a>`), page);
  }
});

test('the client asks only its own origin and never follows the card’s fallback redirect', async () => {
  const script = await read('assets/admin-market-blog.js');
  assert.ok(script.includes("fetch(`/api/market/share"));
  assert.ok(script.includes("redirect: 'manual'"));
  assert.ok(script.includes("'image/png'"), 'the clipboard takes PNG only');
  assert.equal(/https?:\/\//.test(script), false, 'no absolute address: the admin CSP allows self only');
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(script), false);
  assert.equal(/\b(?:confirm|alert|prompt)\(/.test(script), false);
});
