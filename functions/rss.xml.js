import { loadPosts } from './_seo.js';
import { feedResponse, feedUnavailable } from './_feed.js';

export async function onRequestGet({ request, env }) {
  try {
    const posts = await loadPosts(request, env);
    return feedResponse(posts, 'ko');
  } catch (_) {
    return feedUnavailable();
  }
}
