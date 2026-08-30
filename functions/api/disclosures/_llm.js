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
    headline: { type: 'string', description: 'Metadata-only headline without invented facts or figures.' },
    summary: { type: 'string', description: 'Conservative metadata-only summary without invented facts or figures.' },
    impact: { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral'] },
    urgency: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    watch_points: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    limitation: { type: 'string', description: 'State that the filing body was not provided and must be checked.' }
  },
  required: ['headline', 'summary', 'impact', 'urgency', 'confidence', 'watch_points', 'limitation']
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
  const generated = figureTokens([result.headline, result.summary, ...(result.watch_points || [])].join(' '));
  const unsupported = generated.filter(token => !allowed.has(token));
  if (unsupported.length) {
    throw new DisclosureError('LLM_UNSUPPORTED_FIGURE', 'AI 응답에 제공된 메타데이터로 확인할 수 없는 수치가 포함되었습니다.', 502);
  }
}

function normalizedAnalysis(value, filing = null) {
  if (!value || typeof value !== 'object') throw new DisclosureError('LLM_BAD_OUTPUT', 'AI 응답을 구조화된 JSON으로 읽지 못했습니다.', 502);
  if (!['positive', 'negative', 'mixed', 'neutral'].includes(value.impact)) throw new DisclosureError('LLM_BAD_OUTPUT', 'AI impact 값이 계약과 다릅니다.', 502);
  if (!['critical', 'high', 'medium', 'low'].includes(value.urgency)) throw new DisclosureError('LLM_BAD_OUTPUT', 'AI urgency 값이 계약과 다릅니다.', 502);
  if (!Number.isInteger(value.confidence) || value.confidence < 0 || value.confidence > 100) throw new DisclosureError('LLM_BAD_OUTPUT', 'AI confidence 값이 계약과 다릅니다.', 502);
  if (!Array.isArray(value.watch_points) || value.watch_points.length > 4) throw new DisclosureError('LLM_BAD_OUTPUT', 'AI watch_points 값이 계약과 다릅니다.', 502);
  const clean = input => String(input || '').replace(/\s+/g, ' ').trim();
  const result = {
    headline: clean(value.headline).slice(0, 180),
    summary: clean(value.summary).slice(0, 700),
    impact: value.impact,
    urgency: value.urgency,
    confidence: value.confidence,
    watch_points: value.watch_points.map(clean).filter(Boolean).slice(0, 4),
    limitation: clean(value.limitation).slice(0, 260)
  };
  if (!result.headline || !result.summary || !result.limitation) throw new DisclosureError('LLM_BAD_OUTPUT', 'AI 필수 텍스트가 비어 있습니다.', 502);
  assertNoUnsupportedFigures(result, filing);
  return result;
}

function analysisPrompt(filing) {
  return `당신은 한국 주식시장 공시를 분류하는 보조 분석기다. 아래 정보는 OpenDART 공시 목록의 메타데이터이며 공시 원문이 아니다.\n\n회사: ${filing.corpName}\n종목코드: ${filing.stockCode || '없음'}\n시장구분: ${filing.corpCls}\n공시명: ${filing.reportName}\n제출인: ${filing.filerName || '없음'}\n접수일: ${filing.receiptDate}\n비고: ${filing.remarks || '없음'}\n규칙 점수: ${filing.ruleScore}\n규칙 사유: ${(filing.ruleReasons || []).join(', ') || '없음'}\n\n투자판단을 대신하지 말고, 제목과 메타데이터에서 확실히 알 수 있는 범위만 요약하라. 금액, 계약상대, 기간, 실적 수치 등 원문에 없는 정보를 절대 추정하지 마라. 위 메타데이터에 실제로 적힌 숫자가 아니라면 headline, summary, watch_points에 어떤 숫자도 쓰지 마라. limitation에는 반드시 공시 원문이 제공되지 않았고 DART 원문 확인이 필요하다고 밝혀라.`.slice(0, MAX_PROMPT_CHARS);
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
    const message = safeUpstreamMessage(payload?.error?.message, `Gemini HTTP ${response.status}`);
    const error = new DisclosureError('GEMINI_API_ERROR', message, response.status === 429 ? 429 : 502);
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
  if (!env.DISCLOSURE_LLM_API_KEY || !config.openAiBaseUrl) {
    throw new DisclosureError('OPENAI_COMPATIBLE_NOT_CONFIGURED', 'OpenAI 호환 LLM 환경변수가 설정되지 않았습니다.', 503);
  }
  const endpoint = `${config.openAiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.DISCLOSURE_LLM_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: analysisPrompt(filing) }],
      response_format: { type: 'json_object' },
      max_tokens: 700
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = safeUpstreamMessage(payload?.error?.message, `LLM HTTP ${response.status}`);
    const error = new DisclosureError('OPENAI_COMPATIBLE_API_ERROR', message, response.status === 429 ? 429 : 502);
    error.upstreamStatus = response.status;
    throw error;
  }
  const text = payload?.choices?.[0]?.message?.content || '';
  return {
    provider: 'openai-compatible',
    model: String(payload?.model || model),
    result: normalizedAnalysis(safeJson(text), filing),
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0)
  };
}

async function callProvider(provider, filing, env, model, config) {
  if (provider === 'gemini') return geminiAnalyze(filing, env, model);
  if (provider === 'openai-compatible') return openAiCompatibleAnalyze(filing, env, model, config);
  throw new DisclosureError('LLM_PROVIDER_UNSUPPORTED', `지원하지 않는 LLM 공급자입니다: ${provider}`, 503);
}

function providerConfigured(provider, env, config) {
  if (provider === 'gemini') return Boolean(env.GEMINI_API_KEY);
  if (provider === 'openai-compatible') return Boolean(env.DISCLOSURE_LLM_API_KEY && config.openAiBaseUrl);
  return false;
}

export async function analyzeWithLlm({ filing, env, db, now = new Date() }) {
  const config = disclosureConfig(env);
  const usageDate = kstDate(now);
  const primary = config.primaryProvider;
  if (primary === 'none' || !providerConfigured(primary, env, config)) {
    throw new DisclosureError('LLM_NOT_CONFIGURED', '공시 AI 분석 공급자가 설정되지 않았습니다.', 503);
  }

  const budget = await reserveRequest(db, usageDate, 'llm:total', config.llmDailyBudget);
  if (!budget.allowed) throw new DisclosureError('LLM_BUDGET_EXHAUSTED', `AI 내부 일일 호출 예산(${budget.limit})에 도달했습니다.`, 429);

  const attempts = [
    { provider: primary, model: config.primaryModel },
    ...(config.fallbackProvider !== 'none' && config.fallbackProvider !== primary
      ? [{ provider: config.fallbackProvider, model: config.fallbackModel }]
      : [])
  ];

  let lastError = null;
  for (const attempt of attempts) {
    if (!attempt.model || !providerConfigured(attempt.provider, env, config)) continue;
    try {
      const output = await callProvider(attempt.provider, filing, env, attempt.model, config);
      await addTokenUsage(db, usageDate, `llm:${output.provider}`, output.inputTokens, output.outputTokens);
      return output;
    } catch (error) {
      lastError = error;
      const retryable = retryableProviderError(error);
      if (!retryable) break;
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
