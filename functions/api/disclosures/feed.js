import {
  FILINGS_TABLE,
  compactDate,
  ensureDisclosureSchema,
  extractBaseReportName,
  extractCorrectionType,
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
      // Find latest date with published, non-superseded disclosures
      const latestRow = await db.prepare(`SELECT rcept_dt FROM ${FILINGS_TABLE}
        WHERE publish_status IN ('auto', 'manual')
          AND (superseded_by = '' OR superseded_by IS NULL)
        ORDER BY rcept_dt DESC LIMIT 1`).first();
      targetReceiptDate = latestRow?.rcept_dt || compactDate(todayKst);
    }

    const countRow = await db.prepare(`SELECT count(*) as total FROM ${FILINGS_TABLE}
      WHERE publish_status IN ('auto', 'manual')
        AND (superseded_by = '' OR superseded_by IS NULL)
        AND rcept_dt = ?`).bind(targetReceiptDate).first();
    const totalPublished = Number(countRow?.total || 0);

    const rows = await db.prepare(`SELECT * FROM ${FILINGS_TABLE}
      WHERE publish_status IN ('auto', 'manual')
        AND (superseded_by = '' OR superseded_by IS NULL)
        AND rcept_dt = ?
      ORDER BY rule_score DESC, rcept_no DESC
      LIMIT ?`).bind(targetReceiptDate, limit).all();

    const formattedDate = targetReceiptDate.length === 8
      ? `${targetReceiptDate.slice(0, 4)}-${targetReceiptDate.slice(4, 6)}-${targetReceiptDate.slice(6, 8)}`
      : targetReceiptDate;

    const items = (rows?.results || []).map(row => {
      const aiResult = parseJsonObject(row.ai_json);
      const baseReportName = extractBaseReportName(row.report_nm);
      const correctionType = extractCorrectionType(row.report_nm);
      const isCorrection = Boolean(correctionType);

      return {
        rceptNo: row.rcept_no,
        priority: row.rule_priority || 'low',
        fact: {
          corpName: row.corp_name,
          stockCode: row.stock_code,
          corpCls: row.corp_cls,
          reportName: row.report_nm,
          baseReportName,
          isCorrection,
          correctionType,
          receiptDate: row.rcept_dt,
          formattedDate,
          sourceUrl: row.source_url
        },
        ai: (row.ai_status === 'done' && aiResult) ? {
          status: 'done',
          summary: aiResult.summary || '',
          whatItMeans: aiResult.what_it_means || '',
          watchPoints: Array.isArray(aiResult.watch_points) ? aiResult.watch_points : [],
          impact: aiResult.impact || 'neutral',
          importance: aiResult.importance || 'medium',
          limitation: aiResult.limitation || 'DART 공시 메타데이터 기반 해설이며 세부 조건은 DART 원문을 확인해야 합니다.'
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
