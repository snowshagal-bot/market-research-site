import {
  DisclosureError,
  FILINGS_TABLE,
  authorizeAdmin,
  disclosureConfig,
  ensureDisclosureSchema,
  json,
  kstDate,
  publicFiling,
  stateSnapshot,
  usageSnapshot
} from './_shared.js';

function clampLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(200, parsed)) : 100;
}

function priorityFloor(value) {
  const map = { all: 0, low: 0, medium: 5, high: 7, critical: 10 };
  return map[String(value || 'all').toLowerCase()] ?? 0;
}

export async function onRequestGet({ request, env }) {
  if (!authorizeAdmin(request, env)) return json({ ok: false, error: 'UNAUTHORIZED', message: '관리자 인증이 필요합니다.' }, 401);
  try {
    const db = await ensureDisclosureSchema(env);
    const url = new URL(request.url);
    const limit = clampLimit(url.searchParams.get('limit'));
    const floor = priorityFloor(url.searchParams.get('priority'));
    const query = String(url.searchParams.get('q') || '').trim().slice(0, 80);
    const params = [floor];
    let where = 'WHERE rule_score >= ?';
    if (query) {
      where += ' AND (corp_name LIKE ? OR stock_code LIKE ? OR report_nm LIKE ?)';
      const like = `%${query.replace(/[%_]/g, '')}%`;
      params.push(like, like, like);
    }
    params.push(limit);
    const [result, totals] = await Promise.all([
      db.prepare(`SELECT * FROM ${FILINGS_TABLE} ${where}
        ORDER BY rcept_dt DESC, rule_score DESC, rcept_no DESC LIMIT ?`).bind(...params).all(),
      db.prepare(`SELECT COUNT(*) AS stored,
        SUM(CASE WHEN ai_eligible = 1 THEN 1 ELSE 0 END) AS eligible,
        SUM(CASE WHEN ai_status = 'done' THEN 1 ELSE 0 END) AS analyzed,
        SUM(CASE WHEN ai_eligible = 1 AND ai_status IN ('available', 'pending') THEN 1 ELSE 0 END) AS available
        FROM ${FILINGS_TABLE}`).first()
    ]);

    const config = disclosureConfig(env);
    const usageDate = kstDate(new Date());
    const [usage, state] = await Promise.all([usageSnapshot(db, usageDate), stateSnapshot(db)]);
    return json({
      ok: true,
      generatedAt: new Date().toISOString(),
      filings: (result?.results || []).map(publicFiling),
      stats: {
        stored: Number(totals?.stored || 0),
        eligible: Number(totals?.eligible || 0),
        analyzed: Number(totals?.analyzed || 0),
        available: Number(totals?.available || 0)
      },
      usageDate,
      usage,
      state,
      config: {
        sourceProvider: String(env.DISCLOSURE_SOURCE_PROVIDER || 'opendart'),
        corpClasses: config.corpClasses,
        dartDailyBudget: config.dartDailyBudget,
        llmProvider: config.primaryProvider,
        llmModel: config.primaryModel,
        llmFallbackProvider: config.fallbackProvider,
        llmFallbackModel: config.fallbackModel,
        llmDailyBudget: config.llmDailyBudget,
        llmAutoDailyBudget: config.llmAutoDailyBudget,
        llmAutoScoreFloor: config.llmAutoScoreFloor,
        llmPerRun: config.llmPerRun,
        lookbackDays: config.lookbackDays,
        sourceConfigured: config.opendartConfigured,
        llmConfigured: config.primaryProvider === 'gemini'
          ? config.geminiConfigured
          : config.primaryProvider === 'openai-compatible' ? config.openAiCompatibleConfigured : false
      }
    });
  } catch (error) {
    if (error instanceof DisclosureError) return json({ ok: false, error: error.code, message: error.message }, error.status);
    console.error('disclosure latest failed', error);
    return json({ ok: false, error: 'DISCLOSURE_READ_FAILED', message: '공시 데이터를 읽지 못했습니다.' }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' });
  return onRequestGet(context);
}

export const __test = { clampLimit, priorityFloor };
