// /api/admin/market-telegram — the Telegram post of a Market Close session,
// for /admin/market/blog/.
//   GET  ?date=YYYY-MM-DD  whether the channel is set up, the session's post
//                          state and the caption a post would carry.
//   POST { date }          posts the session now (once per session).
// Both need the administrator session; POST also the admin Origin and the
// session's CSRF token. The bot token is never part of an answer.
import { recordAuditEvent, requireAdmin, requireAdminMutation } from '../../_auth.js';
import { isValidMarketDate } from '../market/_shared.js';
import { ensureMarketTelegramPost, marketPostCaption, readMarketPost, telegramConfigured } from '../../_market-telegram.js';

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store, max-age=0', 'x-content-type-options': 'nosniff' }
  });
}

const authError = (result) => reply({ ok: false, error: result.error, message: result.message }, result.status);
const invalidDate = () => reply({ ok: false, error: 'INVALID_DATE', message: '올바른 날짜 형식이 아닙니다 (YYYY-MM-DD).' }, 400);

async function state(env, date) {
  const [post, caption] = await Promise.all([readMarketPost(env, date), marketPostCaption(env, date)]);
  return { ok: true, date, configured: telegramConfigured(env), post, caption };
}

export async function onRequestGet({ request, env }) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return authError(auth);
  const date = new URL(request.url).searchParams.get('date');
  if (!isValidMarketDate(date)) return invalidDate();
  return reply(await state(env, date));
}

export async function onRequestPost({ request, env, now = new Date(), fetchImpl = fetch }) {
  const auth = await requireAdminMutation(request, env);
  if (!auth.ok) return authError(auth);
  const body = await request.json().catch(() => null);
  const date = body?.date;
  if (!isValidMarketDate(date)) return invalidDate();
  if (!telegramConfigured(env)) {
    return reply({ ok: false, error: 'TELEGRAM_NOT_CONFIGURED', message: '텔레그램 채널이 설정되지 않았습니다.' }, 409);
  }
  const result = await ensureMarketTelegramPost(env, date, { now, fetchImpl, force: true });
  await recordAuditEvent(env.AUTH_DB, { eventType: 'market.telegram_post', userId: auth.user.id, metadata: { date, status: result.status } });
  const messages = {
    sent: '텔레그램 채널에 올렸습니다.',
    already_sent: '이 날짜는 이미 올렸습니다.',
    skipped: '방금 다른 시도가 진행 중입니다. 잠시 뒤 다시 확인해 주세요.',
    no_final_record: '이 날짜의 게시된 장마감 기록이 없습니다.',
    failed: `올리지 못했습니다${result.detail ? `: ${result.detail}` : '.'}`
  };
  const status = result.status === 'sent' ? 200 : result.status === 'no_final_record' ? 404 : result.status === 'failed' ? 502 : 409;
  return reply({ ...(await state(env, date)), ok: result.status === 'sent', result: result.status, message: messages[result.status] || result.status }, status);
}

export async function onRequest(context) {
  if (context.request.method === 'GET') return onRequestGet(context);
  if (context.request.method === 'POST') return onRequestPost(context);
  return reply({ ok: false, error: 'METHOD_NOT_ALLOWED', message: '허용되지 않은 요청입니다.' }, 405);
}
