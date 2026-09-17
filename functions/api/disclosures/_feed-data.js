import {
  FILINGS_TABLE,
  compactDate,
  ensureDisclosureSchema,
  extractBaseReportName,
  extractCorrectionType,
  kstDate,
  parseJsonObject
} from './_shared.js';

/**
 * The public disclosure feed, as one server-side computation.
 *
 * `/api/disclosures/feed` and the server-rendered `/disclosures/` page both
 * call this, so the JSON a browser fetches and the HTML a crawler reads are
 * the same selection: the same date, the same filings, the same order.
 */

/** Query parsing exactly as the feed endpoint has always read it. */
export function feedQuery(searchParams) {
  return {
    queryDate: searchParams.get('date'),
    showAll: searchParams.get('all') === 'true' || searchParams.get('all') === '1'
  };
}

/**
 * Returns the feed body (`ok: true` shape). Throws when the database cannot be
 * read; callers decide what a failure looks like for them.
 */
export async function loadDisclosureFeed(env, { queryDate = null, showAll = false, now = new Date() } = {}) {
  const todayKst = kstDate(now);
  const limit = showAll ? 100 : 10;

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

  return {
    ok: true,
    date: formattedDate,
    receiptDate: targetReceiptDate,
    totalPublished,
    showingCount: items.length,
    hasMore: totalPublished > items.length,
    items
  };
}
