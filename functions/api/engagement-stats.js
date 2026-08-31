import { loadPosts } from '../_seo.js';
import { isHumanAdminHost } from '../_host-policy.js';
import { requireAdmin } from '../_auth.js';
import {
  aggregateRows,
  ensureEngagementSchema,
  json,
  rangeDates,
  secretsMatch
} from './_engagement.js';

function cleanPath(value) {
  let path = String(value || '');
  try { path = decodeURIComponent(path); } catch (_) {}
  return path.replace(/\.html$/i, '').replace(/\/$/, '') || '/';
}

function titleLookup(posts) {
  const titles = new Map([
    ['/', '홈페이지'], ['/en', 'Homepage'], ['/market', 'Market Close'], ['/en/market', 'Market Close'],
    ['/about', 'Snowshagal 소개'], ['/en/about', 'About Snowshagal']
  ]);
  for (const post of posts || []) {
    if (!post?.href || !post?.title) continue;
    const path = post.href.startsWith('/') ? post.href : `/${post.href}`;
    titles.set(cleanPath(path), post.title);
  }
  return (path) => titles.get(cleanPath(path)) || path;
}

export async function onRequestGet({ request, env }) {
  if (!isHumanAdminHost(request)) return json({ ok: false, error: 'ADMIN_HOST_BLOCKED' }, 403);
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.error, message: auth.message }, auth.status);
  if (!env?.COMMENTS_DB) return json({ ok: false, error: 'ENGAGEMENT_NOT_CONFIGURED' }, 503);

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get('days') || 7);
  if (![1, 7, 28].includes(requestedDays)) return json({ ok: false, error: 'INVALID_RANGE' }, 400);
  const range = rangeDates(requestedDays);
  try {
    await ensureEngagementSchema(env.COMMENTS_DB);
    const result = await env.COMMENTS_DB.prepare(`
      SELECT path, country, lang, active_ms, max_scroll, started_at
      FROM engagement_sessions
      WHERE started_at >= ? AND started_at < ?
      ORDER BY started_at DESC
      LIMIT 100000
    `).bind(range.start, range.endExclusive).all();
    let posts = [];
    try { posts = await loadPosts(request, env); } catch (_) {}
    const rows = result?.results || [];
    const aggregated = aggregateRows(rows, titleLookup(posts));
    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      empty: rows.length === 0,
      range: { days: range.days, from: range.from, to: range.to, timezone: range.timezone },
      ...aggregated,
      source: { table: 'engagement_sessions', definition: 'JavaScript tracker page-load sessions' }
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'engagement_stats_failed', message: error?.message || 'unknown' }));
    return json({ ok: false, error: 'ENGAGEMENT_QUERY_FAILED', message: '읽기 행동 통계를 불러오지 못했습니다.' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' });
  return onRequestGet(context);
}

export const __test = { cleanPath, titleLookup };
