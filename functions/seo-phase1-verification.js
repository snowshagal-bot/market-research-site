// This identity is deployed only on the separate synthetic verification branch.
// It does not pass any real environment binding to the sitemap handler.
import { onRequestGet as sitemap } from './sitemap.xml.js';

const HOST = 'preview-seo-remediation-phas.market-research-site.pages.dev';
const AUTH_HASH = '5f0ceeafc421dff02108d6c2d9ae8bbc15503e4d89330eb1ef6d4832e5643907';
const REVISION = 'B';
let isolate;

const date = '2026-11-26';
const oldDate = '2026-11-25';
const oldTime = '2026-11-25T07:00:00Z';
const quote = (close, source_date) => ({ close, previous_close: close - 1, source_date, data_state: 'final_close' });
const session = (market_date, published_at, usDate, vix) => ({
  market_date, published_at, optional_closes: JSON.stringify(Array(11).fill(null)),
  indicator_items: JSON.stringify([
    quote(3000, market_date), quote(850, market_date), quote(23585.8, usDate), ...Array(6).fill(null),
    quote(vix, usDate), ...Array(15).fill(null)
  ])
});
const fundDay = (market_date, published_at, forcedSale) => ({ market_date, published_at, payload_json: JSON.stringify({
  items: [{ code: 'FORCED_SALE', value: forcedSale, previous_value: 13700 }, { code: 'DEPOSITS', value: 84000000 }]
}) });

function simulatedEnv(stage, at, failing) {
  const latest = stage !== 'base';
  const extraReport = stage === 'new';
  const posts = [
    { href: 'reports/preview-fixture.html', lang: 'ko', type: 'daily', translationGroup: 'preview-fixture', registeredAt: oldTime },
    { href: 'reports/en/preview-fixture.html', lang: 'en', type: 'daily', translationGroup: 'preview-fixture', registeredAt: oldTime }
  ];
  if (extraReport) posts.push({ href: 'reports/preview-fixture-new.html', lang: 'ko', type: 'daily', registeredAt: at });
  const results = {
    market_close_snapshots: [session(oldDate, oldTime, '2026-11-24', 26.36)],
    market_domestic_rates: [], market_fx_close: [],
    market_funds: [fundDay('2026-11-24', oldTime, 13700)]
  };
  if (latest) {
    results.market_close_snapshots.unshift(session(date, at, oldDate, 28.29));
    results.market_funds.unshift(fundDay(oldDate, at, stage === 'correction' || stage === 'new' ? 8404 : 8403));
  }
  return {
    ASSETS: { fetch: async () => Response.json(posts) },
    COMMENTS_DB: { prepare(sql) {
      const table = sql.match(/FROM (\w+)/)?.[1];
      return { async all() {
        if (table === failing) throw new Error(`Preview fixture failure: ${table}`);
        return { success: true, results: results[table] || [] };
      } };
    } }
  };
}

const location = (request) => ({ colo: request.cf?.colo || null, isolate, revision: REVISION });
const hex = (value) => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (url.hostname !== HOST) return new Response(null, { status: 404 });
  isolate ||= crypto.randomUUID();
  const mode = url.searchParams.get('mode') || '';
  const snapshotKey = new Request(new URL('/sitemap.xml?__sitemap_last_good=1', url));
  const cache = await caches.open('snowshagal-sitemap-v1');
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (mode === 'peek') {
    const stored = await cache.match(snapshotKey);
    return Response.json({ ...location(request), warmed: Boolean(stored) }, { headers });
  }
  const credential = request.headers.get('x-preview-verification') || '';
  if (hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential))) !== AUTH_HASH) {
    return new Response(null, { status: 404, headers });
  }
  if (mode === 'reset' || mode === 'expire') {
    const stored = await cache.match(snapshotKey);
    if (mode === 'reset') {
      await cache.delete(snapshotKey);
      await cache.delete(new Request(new URL('/sitemap.xml?__sitemap_failure=1', url)));
    } else if (stored) {
      await cache.put(snapshotKey, new Response(stored.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2' } }));
    }
    return Response.json({ ...location(request), found: Boolean(stored), mode }, { headers });
  }
  const stage = url.searchParams.get('stage') || 'base';
  const sampleTime = new Date(url.searchParams.get('at') || oldTime);
  const at = Number.isFinite(sampleTime.getTime()) ? sampleTime.toISOString() : oldTime;
  const failing = url.searchParams.get('fail') === 'rates' ? 'market_domestic_rates' : undefined;
  const background = [];
  const response = await sitemap({ request, env: simulatedEnv(stage, at, failing), waitUntil: work => background.push(work) });
  await Promise.all(background);
  const out = new Headers(response.headers);
  out.set('x-seo-handler-cache-control', out.get('cache-control') || '');
  for (const [key, value] of Object.entries(headers)) out.set(key, value);
  out.set('x-seo-fixture-colo', request.cf?.colo || '');
  out.set('x-seo-fixture-isolate', isolate);
  out.set('x-seo-fixture-revision', REVISION);
  return new Response(response.body, { status: response.status, headers: out });
}
