import { loadPosts, sitemapXml } from './_seo.js';
import { loadMarketArchive } from './_market-date-page.js';

// Market Close sessions are listed when D1 answers in time; without them the
// sitemap still lists every other page.
export const SITEMAP_MARKET_BUDGET_MS = 2000;

export async function onRequestGet({ request, env }) {
  try {
    const [posts, marketSessions] = await Promise.all([
      loadPosts(request, env),
      loadMarketArchive(env, { budgetMs: SITEMAP_MARKET_BUDGET_MS }).catch((error) => {
        console.error('sitemap market sessions unavailable', error);
        return [];
      })
    ]);
    return new Response(sitemapXml(posts, { marketSessions }), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300'
      }
    });
  } catch (_) {
    return new Response('Sitemap is temporarily unavailable.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
}
