import {
  DisclosureError,
  FILINGS_TABLE,
  authorizeAdmin,
  claimFilingForAnalysis,
  ensureDisclosureSchema,
  json,
  publicFiling,
  releaseAnalysisClaim
} from './_shared.js';
import { analyzeWithLlm } from './_llm.js';

const MAX_BODY_BYTES = 1024;

function filingForAnalysis(row) {
  let reasons = [];
  try { reasons = JSON.parse(row.rule_reasons_json || '[]'); } catch (_) {}
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
    ruleReasons: Array.isArray(reasons) ? reasons : []
  };
}

export async function onRequestPost({ request, env }) {
  if (!authorizeAdmin(request, env)) return json({ ok: false, error: 'UNAUTHORIZED', message: '관리자 인증이 필요합니다.' }, 401);
  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > MAX_BODY_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  let raw = '';
  try { raw = await request.text(); } catch (_) { return json({ ok: false, error: 'INVALID_BODY' }, 400); }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (_) { return json({ ok: false, error: 'INVALID_JSON' }, 400); }
  const rceptNo = String(body?.rceptNo || '').trim();
  if (!/^\d{14}$/.test(rceptNo)) return json({ ok: false, error: 'BAD_RECEIPT_NO', message: '접수번호를 확인해 주세요.' }, 400);

  try {
    const db = await ensureDisclosureSchema(env);
    const row = await db.prepare(`SELECT * FROM ${FILINGS_TABLE} WHERE rcept_no = ? LIMIT 1`).bind(rceptNo).first();
    if (!row) return json({ ok: false, error: 'NOT_FOUND', message: '저장된 공시를 찾지 못했습니다.' }, 404);
    if (!row.ai_eligible) return json({ ok: false, error: 'NOT_AI_ELIGIBLE', message: '규칙 기준상 AI 분석 대상이 아닌 공시입니다.' }, 409);
    const claimed = await claimFilingForAnalysis(db, rceptNo, { allowDone: true });
    if (!claimed) return json({ ok: false, error: 'ANALYSIS_IN_PROGRESS', message: '이 공시는 이미 AI 분석 중입니다.' }, 409);

    try {
      const output = await analyzeWithLlm({ filing: filingForAnalysis(claimed), env, db });
      const now = new Date().toISOString();
      await db.prepare(`UPDATE ${FILINGS_TABLE}
        SET ai_status = 'done', ai_provider = ?, ai_model = ?, ai_json = ?, ai_error = '', ai_analyzed_at = ?, updated_at = ?
        WHERE rcept_no = ? AND ai_status = 'processing'`)
        .bind(output.provider, output.model, JSON.stringify(output.result), now, now, rceptNo).run();
      const updated = await db.prepare(`SELECT * FROM ${FILINGS_TABLE} WHERE rcept_no = ? LIMIT 1`).bind(rceptNo).first();
      return json({ ok: true, filing: publicFiling(updated) });
    } catch (error) {
      console.error(JSON.stringify({
        event: 'disclosure_analyze_failed',
        rceptNo,
        code: error?.code || 'ANALYZE_FAILED',
        message: error?.message || 'unknown',
        upstreamStatus: error?.upstreamStatus || 0
      }));
      const available = error?.code === 'LLM_NOT_CONFIGURED' || error?.code === 'LLM_BUDGET_EXHAUSTED';
      await releaseAnalysisClaim(db, rceptNo, available ? 'available' : 'error', available ? '' : error?.message || 'AI 분석 실패');
      throw error;
    }
  } catch (error) {
    if (error instanceof DisclosureError) return json({ ok: false, error: error.code, message: error.message }, error.status);
    console.error('disclosure analyze failed', error);
    return json({ ok: false, error: 'ANALYZE_FAILED', message: '공시 AI 분석에 실패했습니다.' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' });
  return onRequestPost(context);
}

export const __test = { MAX_BODY_BYTES, filingForAnalysis };
