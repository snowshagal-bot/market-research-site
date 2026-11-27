import { loadPosts, sitemapXml } from './_seo.js';
import { MARKET_INDICATORS } from './_market-indicators.js';
import { loadSitemapMarketSessions, sitemapMarketMetadata } from './_market-sitemap.js';
import { loadDomesticRatesDays } from './api/market/rates/_shared.js';
import { loadMarketFundsDays } from './api/market/funds/_shared.js';
import { loadFxCloseDays } from './api/market/fx/_shared.js';

export const SITEMAP_MARKET_BUDGET_MS = 2000;
const CACHE_BUDGET_MS = 500;
const SNAPSHOT_TTL = 7 * 24 * 60 * 60;
const XML_TYPE = 'application/xml; charset=utf-8';

function withinBudget(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function cacheKey(request, key) {
  return new Request(new URL(`/sitemap.xml?__sitemap_${key}=1`, request.url));
}

async function cacheOperation(operation) {
  try { return await withinBudget(operation(), CACHE_BUDGET_MS); }
  catch (error) {
    console.warn('sitemap_cache_unavailable', String(error?.message || error));
    return undefined;
  }
}

async function readSnapshot(cache, key) {
  if (!cache) return undefined;
  return cacheOperation(async () => {
    const stored = await cache.match(key);
    if (!stored) return undefined;
    const snapshot = await stored.json();
    if (!snapshot?.xml?.endsWith('</urlset>\n') || !snapshot.indicatorState || !snapshot.counts || !Number.isFinite(snapshot.readAt)) {
      throw new Error('Invalid last-known-good snapshot');
    }
    return snapshot;
  });
}

function cacheEntry(body, headers = {}) {
  return Response.json(body, { headers: { 'cache-control': `public, max-age=${SNAPSHOT_TTL}`, ...headers } });
}

function xmlResponse(xml, fresh) {
  return new Response(xml, {
    headers: {
      'content-type': XML_TYPE,
      'cache-control': fresh ? 'public, max-age=300' : 'no-store',
      'x-sitemap-source': fresh ? 'fresh' : 'last-known-good'
    }
  });
}

async function rememberSuccess(cache, key, recoveryKey, snapshot) {
  if (!cache) return;
  const latest = await cacheOperation(() => cache.match(key));
  if (Number(latest?.headers.get('x-sitemap-read-at')) > snapshot.readAt) return;
  await cacheOperation(() => cache.put(key, cacheEntry(snapshot, { 'x-sitemap-read-at': String(snapshot.readAt) })));
  const failure = await cacheOperation(async () => (await cache.match(recoveryKey))?.json());
  if (failure && failure.readAt <= snapshot.readAt) {
    console.info('sitemap_recovered', { failedSources: failure.failedSources, urls: snapshot.counts.total });
    await cacheOperation(() => cache.delete(recoveryKey));
  }
}

function missingMarketUrls(failedSources, counts, sessions) {
  if (failedSources.includes('sessions') || failedSources.includes('generation')) {
    if (counts) return counts.market;
    return sessions ? 2 * (sessions.length + MARKET_INDICATORS.length + 3) : null;
  }
  return (failedSources.includes('rates') ? (counts?.rates ?? 2 * MARKET_INDICATORS.filter(item => item.domestic).length) : 0)
    + (failedSources.includes('funds') ? (counts?.funds ?? 2 * MARKET_INDICATORS.filter(item => item.funds).length) : 0);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const key = cacheKey(request, 'last_good');
  const recoveryKey = cacheKey(request, 'failure');
  const handle = async (work) => {
    if (typeof context.waitUntil === 'function') context.waitUntil(work);
    else await work;
  };
  const readAt = Date.now();
  // A named Cache API namespace keeps the internal JSON off the HTTP cache path.
  const cachePromise = globalThis.caches
    ? cacheOperation(() => globalThis.caches.open('snowshagal-sitemap-v1'))
    : Promise.resolve(undefined);
  const sources = {
    posts: loadPosts(request, env),
    sessions: loadSitemapMarketSessions(env),
    rates: loadDomesticRatesDays(env, { strict: true }),
    funds: loadMarketFundsDays(env, { strict: true }),
    fx: loadFxCloseDays(env, { strict: true })
  };
  const names = Object.keys(sources);
  const reads = Promise.allSettled(names.map(name => withinBudget(sources[name], SITEMAP_MARKET_BUDGET_MS)));
  const cache = await cachePromise;
  const [previous, results] = await Promise.all([readSnapshot(cache, key), reads]);
  const data = {};
  const failures = {};
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') data[names[index]] = result.value;
    else failures[names[index]] = String(result.reason?.message || result.reason);
  });

  if (!Object.keys(failures).length) {
    try {
      const { rateCodes, indicatorState, indicatorLastmods, counts } = sitemapMarketMetadata({
        sessions: data.sessions, rateDays: data.rates, fundDays: data.funds, fxDays: data.fx
      }, previous, Date.now());
      const xml = sitemapXml(data.posts, { marketSessions: data.sessions, rateCodes, indicatorLastmods });
      const snapshot = {
        xml, readAt, indicatorState,
        counts: { ...counts, total: xml.split('<url>').length - 1, reports: data.posts.length }
      };
      await handle(rememberSuccess(cache, key, recoveryKey, snapshot));
      return xmlResponse(xml, true);
    } catch (error) {
      failures.generation = String(error?.message || error);
    }
  }

  const failedSources = Object.keys(failures);
  console.error('sitemap_generation_failed', {
    failures,
    potentialMissingMarketUrls: missingMarketUrls(failedSources, previous?.counts, data.sessions),
    potentialMissingReportUrls: failures.posts ? (previous?.counts.reports ?? null) : 0,
    recovery: previous ? 'serving-last-known-good' : 'pending'
  });
  if (cache) await handle(cacheOperation(() => cache.put(recoveryKey, cacheEntry({ readAt, failedSources }))));
  if (previous) return xmlResponse(previous.xml, false);
  return new Response('Sitemap is temporarily unavailable.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' }
  });
}
