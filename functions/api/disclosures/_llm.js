import {
  DisclosureError,
  addTokenUsage,
  disclosureConfig,
  kstDate,
  reserveRequest
} from './_shared.js';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const REQUEST_TIMEOUT_MS = 25000;
const MAX_PROMPT_CHARS = 6000;

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: 'Conservative metadata-only summary without invented facts or figures.' },
    what_it_means: { type: 'string', description: 'Brief reader-facing explanation of what this disclosure means for shareholders and market.' },
    watch_points: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Points and conditions to verify in the original DART filing.' },
    impact: { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral'] },
    importance: { type: 'string', enum: ['high', 'medium', 'low'] },
    limitation: { type: 'string', description: 'Disclaimer that this is a metadata-based explanation and the original DART filing must be reviewed.' }
  },
  required: ['summary', 'what_it_means', 'watch_points', 'impact', 'importance', 'limitation']
};

function safeJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (_) { return null; }
}

function figureTokens(value) {
  return String(value || '').match(/\d[\d,.]*%?/g) || [];
}

function assertNoUnsupportedFigures(result, filing) {
  if (!filing) return;
  const sourceText = [
    filing.corpName, filing.stockCode, filing.corpCls, filing.reportName, filing.filerName,
    filing.receiptDate, filing.remarks, filing.ruleScore, ...(filing.ruleReasons || [])
  ].join(' ');
  const allowed = new Set(figureTokens(sourceText));
  const generated = figureTokens([result.summary, result.what_it_means].join(' '));
  const unsupported = generated.filter(token => !allowed.has(token));
  if (unsupported.length) {
    throw new DisclosureError('LLM_UNSUPPORTED_FIGURE', 'AI 응답에 제공된 메타데이터로 확인할 수 없는 수치가 포함되었습니다.', 502);
  }
}

function normalizedAnalysis(value, filing = null) {
  if (!value || typeof value !== 'object') throw new DisclosureError('LLM_BAD_OUTPUT', 'AI 응답을 구조화된 JSON으로 읽지 못했습니다.', 502);
  if (!['positive', 'negative', 'mixed', 'neutral'].includes(value.impact)) throw new DisclosureError('LLM_BAD_OUTPUT', 'AI impact 값이 계약과 다릅니다.', 502);
  if (!['high', 'medium', 'low', 'critical'].includes(value.importance)) {
    value.importance = 'medium';
  }
  const clean = input => String(input || '').replace(/\s+/g, ' ').trim();
  const rawWatchPoints = Array.isArray(value.watch_points) ? value.watch_points : (value.watch_points ? [String(value.watch_points)] : []);

  const result = {
    summary: clean(value.summary).slice(0, 700),
    what_it_means: clean(value.what_it_means || value.meaning).slice(0, 700),
    watch_points: rawWatchPoints.map(clean).filter(Boolean).slice(0, 4),
    impact: value.impact,
    importance: value.importance === 'critical' ? 'high' : value.importance,
    limitation: clean(value.limitation || 'DART 공시 메타데이터 기반 해설이며 세부 조건은 원문을 확인해야 합니다.').slice(0, 260)
  };
  if (!result.summary || !result.what_it_means || !result.limitation) throw new DisclosureError('LLM_BAD_OUTPUT', 'AI 필수 텍스트가 비어 있습니다.', 502);
  assertNoUnsupportedFigures(result, filing);
  return result;
}

function analysisPrompt(filing) {
  return `당신은 Snowshagal 마켓 독자를 위한 공시 해설 도우미다. 아래 정보는 OpenDART 공시 목록의 메타데이터(제목 및 속성)이다.
공시 본문 전체가 아닌 제목과 메타데이터만 주어졌으므로, 본문에 있을 법한 구체적인 금액이나 비율 등 숫자를 절대 지어내지 말 것.

[공시 메타데이터]
- 회사명: ${filing.corpName} (${filing.stockCode || '종목코드 없음'})
- 시장: ${filing.corpCls === 'Y' ? '유가증권(KOSPI)' : (filing.corpCls === 'K' ? '코스닥(KOSDAQ)' : filing.corpCls)}
- 공시명: ${filing.reportName}
- 제출인: ${filing.filerName || '없음'}
- 접수일: ${filing.receiptDate}
- 비고: ${filing.remarks || '없음'}
- 중요도 규칙 점수: ${filing.ruleScore}점 (${filing.rulePriority})
- 주요 키워드: ${(filing.ruleReasons || []).join(', ') || '없음'}

[작성 지침]
1. summary (핵심 사실): 메타데이터에 기재된 사실만 1~2문장으로 객관적 요약.
2. what_it_means (무엇을 의미하나): 일반 투자자가 이해하기 쉽게 시장 및 주주 관점에서의 의미와 영향을 짧게 해설 (원문에 없는 숫자 창작 금지).
3. watch_points (확인할 것): DART 원문에서 추가로 점검해야 할 조건(전환가액, 조달 목적, 보호예수, 계약상대방 등)을 2~4개 리스트로 제시.
4. impact: positive / negative / mixed / neutral 중 선택.
5. importance: high / medium / low 중 선택.
6. limitation: "DART 공시 메타데이터 기반의 이해 보조 해설이며, 세부 조건과 최종 수치는 DART 원문을 확인해야 합니다."`.slice(0, MAX_PROMPT_CHARS);
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) {
    if (error?.name === 'AbortError') throw new DisclosureError('LLM_TIMEOUT', 'AI 공급자 응답 시간이 초과되었습니다.', 504, { upstreamStatus: 504 });
    throw error;
  }
  finally { clearTimeout(timer); }
}

function safeUpstreamMessage(value, fallback) {
  const safe = String(value || fallback || 'AI 공급자 요청 실패')
    .replace(/https?:\/\/\S+/gi, '[upstream-url]')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]')
    .replace(/(?:api[_-]?key|key|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return safe.slice(0, 220);
}

function retryableProviderError(error) {
  const upstream = Number(error?.upstreamStatus || 0);
  return error?.code === 'LLM_TIMEOUT' || error?.code === 'LLM_BAD_OUTPUT' || error?.code === 'LLM_UNSUPPORTED_FIGURE'
    || upstream === 429 || upstream >= 500;
}

function interactionOutputText(payload) {
  if (payload?.output_text) return String(payload.output_text).trim();
  const outputs = [];
  for (const step of Array.isArray(payload?.steps) ? payload.steps : []) {
    if (step?.type !== 'model_output') continue;
    for (const part of Array.isArray(step.content) ? step.content : []) {
      if (part?.type === 'text' && part.text) outputs.push(part.text);
    }
  }
  return outputs.join('\n').trim();
}

function geminiModelName(model) {
  const value = String(model || '').trim();
  if (!value) return '';
  return value.startsWith('models/') ? value : `models/${value}`;
}

async function geminiAnalyze(filing, env, model) {
  if (!env.GEMINI_API_KEY) throw new DisclosureError('GEMINI_NOT_CONFIGURED', 'GEMINI_API_KEY가 설정되지 않았습니다.', 503);
  const resolvedModel = geminiModelName(model);
  const response = await fetchWithTimeout(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      model: resolvedModel,
      input: analysisPrompt(filing),
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: ANALYSIS_SCHEMA
      },
      generation_config: {
        max_output_tokens: 700,
        thinking_level: 'minimal'
      },
      store: false
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const rawError = payload?.error?.message || '';
    const message = safeUpstreamMessage(rawError, `Gemini HTTP ${response.status}`);
    const isLocationBlocked = rawError.includes('location') || rawError.includes('not available in your current location');
    const errorCode = isLocationBlocked ? 'LLM_LOCATION_BLOCKED' : 'GEMINI_API_ERROR';
    const error = new DisclosureError(errorCode, message, response.status === 429 ? 429 : 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  const parsed = normalizedAnalysis(safeJson(interactionOutputText(payload)), filing);
  return {
    provider: 'gemini',
    model: String(payload?.model || resolvedModel),
    result: parsed,
    inputTokens: Number(payload?.usage?.total_input_tokens || 0),
    outputTokens: Number(payload?.usage?.total_output_tokens || 0)
  };
}

async function openAiCompatibleAnalyze(filing, env, model, config) {
  const apiKey = env.DISCLOSURE_LLM_API_KEY;
  const baseUrl = config.openAiBaseUrl.replace(/\/+$/, '');
  if (!apiKey || !baseUrl) throw new DisclosureError('OPENAI_NOT_CONFIGURED', 'OpenAI 호환 API 설정이 완료되지 않았습니다.', 503);
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output only JSON matching the schema.' },
        { role: 'user', content: `${analysisPrompt(filing)}\n\n반드시 다음 JSON 스키마를 따르라: ${JSON.stringify(ANALYSIS_SCHEMA)}` }
      ]
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = safeUpstreamMessage(payload?.error?.message, `OpenAI 호환 공급자 HTTP ${response.status}`);
    const error = new DisclosureError('OPENAI_API_ERROR', message, response.status === 429 ? 429 : 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  const rawText = payload?.choices?.[0]?.message?.content || '';
  const parsed = normalizedAnalysis(safeJson(rawText), filing);
  return {
    provider: 'openai-compatible',
    model: String(payload?.model || model || 'gpt-4o-mini'),
    result: parsed,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0)
  };
}

async function executeProvider(provider, model, filing, env, config) {
  if (provider === 'gemini') return geminiAnalyze(filing, env, model || config.primaryModel);
  if (provider === 'openai-compatible') return openAiCompatibleAnalyze(filing, env, model || config.fallbackModel, config);
  throw new DisclosureError('LLM_PROVIDER_UNSUPPORTED', `지원하지 않는 AI 공급자입니다: ${provider}`, 503);
}

function providerConfigured(provider, env, config) {
  if (provider === 'gemini') return Boolean(env.GEMINI_API_KEY);
  if (provider === 'openai-compatible') return Boolean(env.DISCLOSURE_LLM_API_KEY && config.openAiBaseUrl);
  return false;
}

export async function analyzeWithLlm({ filing, env, db, now = new Date() }) {
  const config = disclosureConfig(env);
  if (config.primaryProvider === 'none') {
    throw new DisclosureError('LLM_NOT_CONFIGURED', 'AI 분석 공급자가 설정되지 않았습니다.', 503);
  }
  const usageDate = kstDate(now);
  const budget = await reserveRequest(db, usageDate, 'llm:total', config.llmDailyBudget);
  if (!budget.allowed) throw new DisclosureError('LLM_BUDGET_EXHAUSTED', `AI 일일 호출 예산(${budget.limit})에 도달했습니다.`, 429);

  const attempts = [
    { provider: config.primaryProvider, model: config.primaryModel },
    ...(config.fallbackProvider !== 'none' && config.fallbackProvider !== config.primaryProvider
      ? [{ provider: config.fallbackProvider, model: config.fallbackModel }]
      : [])
  ];

  let lastError = null;
  for (const attempt of attempts) {
    if (!attempt.provider || attempt.provider === 'none' || !providerConfigured(attempt.provider, env, config)) continue;
    try {
      const output = await executeProvider(attempt.provider, attempt.model, filing, env, config);
      await addTokenUsage(db, usageDate, 'llm:total', output.inputTokens, output.outputTokens);
      return output;
    } catch (error) {
      lastError = error;
      if (!retryableProviderError(error)) break;
    }
  }
  throw lastError || new DisclosureError('LLM_ANALYSIS_FAILED', 'AI 분석에 실패했습니다.', 502);
}

export const __test = {
  GEMINI_INTERACTIONS_URL,
  ANALYSIS_SCHEMA,
  analysisPrompt,
  safeJson,
  normalizedAnalysis,
  assertNoUnsupportedFigures,
  interactionOutputText,
  geminiModelName,
  providerConfigured,
  retryableProviderError,
  safeUpstreamMessage
};
