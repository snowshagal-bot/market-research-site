// GET /api/market/share?date=YYYY-MM-DD — a published session as a blog post to
// paste (title, body, tags) for /admin/market/blog/. Without a date it answers
// for the latest final session. Read-only, and made only of the public record.
import { loadPosts } from '../../_seo.js';
import { dailyReportFor, loadMarketDate } from '../../_market-date-page.js';
import { dailyTakeaway } from '../../_market-card.js';
import { marketBlogPost } from '../../_market-share-text.js';
import { TABLE_NAME, MarketDbError, ensureMarketTable, isValidMarketDate, json } from './_shared.js';

// How many recent sessions the page's date list offers.
const RECENT_SESSIONS = 30;

export async function onRequestGet({ request, env, loadPostsFn = loadPosts }) {
  try {
    const requested = new URL(request.url).searchParams.get('date');
    if (requested !== null && !isValidMarketDate(requested)) {
      return json({ error: 'INVALID_DATE', message: '올바른 날짜 형식이 아닙니다 (YYYY-MM-DD).' }, 400);
    }
    const db = await ensureMarketTable(env, { readOnly: true });
    const recent = await db.prepare(`SELECT market_date FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC LIMIT ${RECENT_SESSIONS}`).all();
    const dates = (recent?.results || []).map(row => String(row.market_date));
    const date = requested || dates[0];
    if (!date) return json({ error: 'NO_MARKET_DATA', message: '아직 게시된 Market Close 데이터가 없습니다.' }, 404);

    const [data, posts] = await Promise.all([
      loadMarketDate(env, date),
      Promise.resolve().then(() => loadPostsFn(request, env)).catch(() => [])
    ]);
    if (!data) return json({ error: 'MARKET_DATE_NOT_FOUND', message: '해당 날짜의 Market Close 데이터가 없습니다.' }, 404);

    // The line saved with the record wins over the Daily report's own, as on the home page.
    const post = marketBlogPost(data.payload, {
      takeaway: String(data.payload.takeaway?.ko || '').trim() || dailyTakeaway(posts, date, 'ko'),
      reportUrl: dailyReportFor(posts, date, 'ko')?.url
    });
    return json({ ...post, latest: dates[0] || date, dates });
  } catch (error) {
    if (error instanceof MarketDbError) return json({ error: error.code, message: error.message }, error.status);
    console.error('market share text failed', error);
    return json({ error: 'READ_FAILED', message: 'Market Close 데이터를 불러오지 못했습니다.' }, 500);
  }
}
