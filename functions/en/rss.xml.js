import { loadPosts } from '../_seo.js';
import { feedResponse, feedUnavailable } from '../_feed.js';

export async function onRequestGet({ request, env }) {
  try {
    const posts = await loadPosts(request, env);
    return feedResponse(posts, 'en');
  } catch (_) {
    return feedUnavailable();
  }
}

// Readers and validators probe with HEAD; answer it like GET (the runtime drops the body).
export const onRequestHead = onRequestGet;
