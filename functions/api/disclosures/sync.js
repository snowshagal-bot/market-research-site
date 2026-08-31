import {
  ANALYSIS_CLAIM_TIMEOUT_MS,
  DisclosureError,
  FILINGS_TABLE,
  authorizeSync,
  claimFilingForAnalysis,
  compactDate,
  disclosureConfig,
  ensureDisclosureSchema,
  getWatchlistStockCodes,
  json,
  kstDate,
  publicFiling,
  releaseAnalysisClaim,
  reserveRequest,
  setState,
  upsertFiling,
  usageSnapshot
} from './_shared.js';
import { fetchDisclosureSource } from './_source.js';
import { analyzeWithLlm } from './_llm.js';

const MAX_BODY_BYTES = 2048;

function filingForAnalysis(row) {
  return {
    rceptNo: row.rcept_no,
    corpCls: row.corp_cls,
    corpName: row.corp_name,
    corpCode: row.corp_code,
    stockCode: row.stock_code,
    reportName: row.report_nm,
    filerName: row.flr_nm,
    receiptDate: row.rcept_dt,
    remarks: row.rm,
    ruleScore: Number(row.rule_score || 0),
    rulePriority: row.rule_priority,
    publishStatus: row.publish_status,
    isWatchlist: Boolean(row.is_watchlist),
    ruleReasons: (() => { try { return JSON.parse(row.rule_reasons_json || '[]'); } catch (_) { return []; } })()
  };
}

async function analyzeQueue(db, env, config, now) {
  const limit = Math.max(0, Number(config.llmPerRun || 0));
  if (limit <= 0) return { attempted: 0, completed: 0, failed: 0, skipped: 'per-run budget is zero' };
  const usageDate = kstDate(now);
  const todayReceiptDate = compactDate(usageDate);
  const autoScoreFloor = Number(config.llmAutoScoreFloor ?? 10);
  const staleBefore = new Date(now.getTime() - ANALYSIS_CLAIM_TIMEOUT_MS).toISOString();

  // Prioritize published items (auto or manual) or today's critical filings
  const rows = await db.prepare(`SELECT * FROM ${FILINGS_TABLE}
    WHERE rcept_dt = ?
      AND ai_eligible = 1
      AND (publish_status IN ('auto', 'manual') OR rule_score >= ?)
      AND (
        ai_status IN ('available', 'pending', 'error') OR (ai_status = 'processing' AND updated_at < ?)
      )
    ORDER BY (CASE WHEN publish_status IN ('auto', 'manual') THEN 1 ELSE 0 END) DESC, rule_score DESC, rcept_no DESC
    LIMIT ?`).bind(todayReceiptDate, autoScoreFloor, staleBefore, Math.max(limit, limit * 3)).all();

  let completed = 0;
  let failed = 0;
  let attempted = 0;
  let stopReason = '';
  for (const row of rows?.results || []) {
    if (attempted >= limit) break;

    const autoBudget = await reserveRequest(db, usageDate, 'llm:auto', config.llmAutoDailyBudget);
    if (!autoBudget.allowed) {
      stopReason = 'LLM_AUTO_BUDGET_EXHAUSTED';
      break;
    }

    const claimed = await claimFilingForAnalysis(db, row.rcept_no, { now });
    if (!claimed) continue;
    attempted += 1;
    try {
      const output = await analyzeWithLlm({ filing: filingForAnalysis(claimed), env, db, now });
      await db.prepare(`UPDATE ${FILINGS_TABLE}
        SET ai_status = 'done', ai_provider = ?, ai_model = ?, ai_json = ?, ai_error = '', ai_analyzed_at = ?, updated_at = ?
        WHERE rcept_no = ? AND ai_status = 'processing'`)
        .bind(output.provider, output.model, JSON.stringify(output.result), new Date().toISOString(), new Date().toISOString(), claimed.rcept_no).run();
      completed += 1;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'disclosure_analyze_failed',
        rceptNo: claimed.rcept_no,
        code: error?.code || 'ANALYZE_FAILED',
        message: error?.message || 'unknown',
        upstreamStatus: error?.upstreamStatus || 0
      }));
      if (error?.code === 'LLM_NOT_CONFIGURED' || error?.code === 'LLM_BUDGET_EXHAUSTED' || error?.code === 'LLM_AUTO_BUDGET_EXHAUSTED') {
        stopReason = error.code;
        await releaseAnalysisClaim(db, claimed.rcept_no, 'available', '', now);
        break;
      }
      await releaseAnalysisClaim(db, claimed.rcept_no, 'error', error?.message || 'AI 분석 실패', now);
      failed += 1;
    }
  }
  return { attempted, completed, failed, stopReason };
}

export async function onRequestPost({ request, env, now = new Date() }) {
  const authSource = await authorizeSync(request, env);
  if (!authSource) return json({ ok: false, error: 'UNAUTHORIZED', message: '공시 동기화 인증에 실패했습니다.' }, 401);

  let input = {};
  let raw = '';
  try { raw = await request.text(); } catch (_) { return json({ ok: false, error: 'INVALID_BODY' }, 400); }
  if (raw.trim()) {
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
    try { input = JSON.parse(raw); } catch (_) { return json({ ok: false, error: 'INVALID_JSON' }, 400); }
  }

  // Server clock is strictly enforced. Client-supplied input.now in request body is intentionally ignored.
  const config = disclosureConfig(env);
  try {
    const db = await ensureDisclosureSchema(env);
    const watchlistCodes = await getWatchlistStockCodes(db);
    const source = await fetchDisclosureSource({
      env,
      db,
      beginDate: String(input.beginDate || ''),
      endDate: String(input.endDate || ''),
      now
    });

    let created = 0;
    for (const filing of source.filings) {
      if (await upsertFiling(db, filing, { watchlistCodes, now })) created += 1;
    }

    const ai = await analyzeQueue(db, env, config, now);
    const syncedAt = new Date().toISOString();
    await setState(db, 'last_sync_at', syncedAt);
    await setState(db, 'last_sync_source', source.provider);
    await setState(db, 'last_sync_range', `${source.beginDate}-${source.endDate}`);
    await setState(db, 'last_sync_auth', authSource);
    await setState(db, 'last_sync_truncated', source.truncated ? '1' : '0');

    const usage = await usageSnapshot(db, kstDate(now));
    const top = await db.prepare(`SELECT * FROM ${FILINGS_TABLE} ORDER BY rcept_dt DESC, rule_score DESC, rcept_no DESC LIMIT 50`).all();
    return json({
      ok: true,
      syncedAt,
      source: {
        provider: source.provider,
        beginDate: source.beginDate,
        endDate: source.endDate,
        fetched: source.filings.length,
        created,
        updated: source.filings.length - created,
        truncated: source.truncated,
        classes: source.classes
      },
      ai,
      usage,
      latest: (top?.results || []).map(publicFiling)
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'disclosure_sync_failed',
      code: error?.code || 'SYNC_FAILED',
      message: error?.message || 'unknown',
      upstreamStatus: error?.upstreamStatus || 0
    }));
    if (error instanceof DisclosureError) return json({ ok: false, error: error.code, message: error.message }, error.status);
    return json({ ok: false, error: 'SYNC_FAILED', message: '공시 동기화에 실패했습니다.' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' });
  return onRequestPost(context);
}

export const __test = { MAX_BODY_BYTES, filingForAnalysis, analyzeQueue };
