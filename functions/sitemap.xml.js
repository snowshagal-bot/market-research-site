import { loadPosts, sitemapXml } from './_seo.js';

export async function onRequestGet({ request, env }) {
  try {
    const posts = await loadPosts(request, env);
    return new Response(sitemapXml(posts), {
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
