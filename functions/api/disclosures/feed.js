import { json } from './_shared.js';
import { feedQuery, loadDisclosureFeed } from './_feed-data.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const now = new Date();
  const { queryDate, showAll } = feedQuery(url.searchParams);

  try {
    const body = await loadDisclosureFeed(env, { queryDate, showAll, now });
    return json(body, 200, {
      'cache-control': 'public, max-age=30, s-maxage=60'
    });
  } catch (error) {
    console.error('get disclosure feed failed', error);
    return json({ ok: false, error: 'FEED_FAILED', message: '공시 피드를 불러오지 못했습니다.' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' });
  return onRequestGet(context);
}
