import {
  FILINGS_TABLE,
  compactDate,
  ensureDisclosureSchema,
  json,
  kstDate,
  parseJsonArray,
  parseJsonObject
} from './_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const now = new Date();
  const todayKst = kstDate(now);
  const queryDate = url.searchParams.get('date');
  const showAll = url.searchParams.get('all') === 'true' || url.searchParams.get('all') === '1';
  const limit = showAll ? 100 : 10;

  try {
    const db = await ensureDisclosureSchema(env);
    let targetReceiptDate = queryDate ? compactDate(queryDate) : '';

    if (!targetReceiptDate || !/^20\d{6}$/.test(targetReceiptDate)) {
      // Find latest date with published disclosures
      const latestRow = await db.prepare(`SELECT rcept_dt FROM ${FILINGS_TABLE}
        WHERE publish_status IN ('auto', 'manual')
        ORDER BY rcept_dt DESC LIMIT 1`).first();
      targetReceiptDate = latestRow?.rcept_dt || compactDate(todayKst);
    }

    const countRow = await db.prepare(`SELECT count(*) as total FROM ${FILINGS_TABLE}
      WHERE publish_status IN ('auto', 'manual') AND rcept_dt = ?`).bind(targetReceiptDate).first();
    const totalPublished = Number(countRow?.total || 0);

    const rows = await db.prepare(`SELECT * FROM ${FILINGS_TABLE}
      WHERE publish_status IN ('auto', 'manual') AND rcept_dt = ?
      ORDER BY rule_score DESC, rcept_no DESC
      LIMIT ?`).bind(targetReceiptDate, limit).all();

    const formattedDate = targetReceiptDate.length === 8
      ? `${targetReceiptDate.slice(0, 4)}-${targetReceiptDate.slice(4, 6)}-${targetReceiptDate.slice(6, 8)}`
      : targetReceiptDate;

    const items = (rows?.results || []).map(row => {
      const aiResult = parseJsonObject(row.ai_json);
      return {
        rceptNo: row.rcept_no,
        corpName: row.corp_name,
        stockCode: row.stock_code,
        corpCls: row.corp_cls,
        reportName: row.report_nm,
        filerName: row.flr_nm,
        receiptDate: row.rcept_dt,
        formattedDate,
        remarks: row.rm,
        sourceUrl: row.source_url,
        isWatchlist: Boolean(row.is_watchlist),
        publishStatus: row.publish_status,
        publishedAt: row.published_at,
        priority: row.rule_priority || 'low',
        score: Number(row.rule_score || 0),
        reasons: parseJsonArray(row.rule_reasons_json),
        ai: row.ai_status === 'done' && aiResult ? {
          status: 'done',
          summary: aiResult.summary || '',
          keyFigures: Array.isArray(aiResult.key_figures) ? aiResult.key_figures : (aiResult.key_figures ? [String(aiResult.key_figures)] : []),
          whatItMeans: aiResult.what_it_means || '',
          watchPoints: Array.isArray(aiResult.watch_points) ? aiResult.watch_points : [],
          impact: aiResult.impact || 'neutral',
          importance: aiResult.importance || 'medium',
          limitation: aiResult.limitation || ''
        } : null
      };
    });

    return json({
      ok: true,
      date: formattedDate,
      receiptDate: targetReceiptDate,
      totalPublished,
      showingCount: items.length,
      hasMore: totalPublished > items.length,
      items
    }, 200, {
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
