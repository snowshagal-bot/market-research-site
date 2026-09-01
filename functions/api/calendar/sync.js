/**
 * The daily pass over the calendar's sources.
 *
 * Once a day is enough: official release schedules are published months ahead
 * and change rarely. It reuses the same key and the same production-only rule
 * as the disclosure sync, so there is one way in rather than two.
 *
 * The answer says what each source did, because that is what an operator needs
 * when something stops working — but it is an authenticated endpoint, and none
 * of it reaches the public calendar.
 */

import { authorizeSync, humanAdminHostAllowed } from '../disclosures/_shared.js';
import { ensureCalendarEventSchema, getSourceRuns } from '../../_calendar-events.js';
import { runCalendarSync } from '../../_calendar-sync.js';

const PRODUCTION_HOST = 'snowshagal.com';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

export async function onRequestPost({ request, env, now = new Date() }) {
  // Preview deployments read the same sources but write to no database worth
  // writing to, and a second writer would fight the real one.
  if (new URL(request.url).hostname !== PRODUCTION_HOST) {
    return json({ ok: false, error: 'PRODUCTION_ONLY', message: '캘린더 동기화는 Production에서만 실행됩니다.' }, 403);
  }
  const authSource = await authorizeSync(request, env);
  if (!authSource) {
    return json({ ok: false, error: 'UNAUTHORIZED', message: '동기화 인증에 실패했습니다.' }, 401);
  }

  let db;
  try {
    db = await ensureCalendarEventSchema(env);
  } catch (error) {
    console.error('calendar sync: schema unavailable', error);
    return json({ ok: false, error: 'DB_UNAVAILABLE', message: '캘린더 데이터베이스를 사용할 수 없습니다.' }, 503);
  }

  const outcome = await runCalendarSync(db, { env, fetchImpl: fetch, now });

  // A failed source is a real failure and the workflow should see it, but the
  // sources that did answer have already been written and are not rolled back.
  return json({
    ok: outcome.ok,
    authSource,
    years: outcome.years,
    failed: outcome.failed,
    results: outcome.results,
    sources: await getSourceRuns(db)
  }, outcome.ok ? 200 : 502);
}

/** A read-only view of how each source last fared, for the admin surface. */
export async function onRequestGet({ request, env }) {
  if (!humanAdminHostAllowed(request)) return json({ ok: false, error: 'ADMIN_HOST_BLOCKED' }, 403);
  const authSource = await authorizeSync(request, env);
  if (!authSource) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  try {
    const db = await ensureCalendarEventSchema(env);
    return json({ ok: true, sources: await getSourceRuns(db) });
  } catch (error) {
    console.error('calendar sync status failed', error);
    return json({ ok: false, error: 'DB_UNAVAILABLE' }, 503);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'GET') return onRequestGet(context);
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
}
