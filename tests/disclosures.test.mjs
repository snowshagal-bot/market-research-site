import assert from 'node:assert/strict';
import test from 'node:test';
import { disclosureConfig, scoreDisclosure, normalizeFiling } from '../functions/api/disclosures/_shared.js';
import { __test as sourceTest } from '../functions/api/disclosures/_source.js';
import { __test as llmTest } from '../functions/api/disclosures/_llm.js';
import { __test as latestTest } from '../functions/api/disclosures/latest.js';

test('Disclosure rules: material financing disclosure is AI eligible', () => {
  const result = scoreDisclosure({ report_nm: '주요사항보고서(유상증자결정)' });
  assert.ok(result.score >= 7);
  assert.ok(['high', 'critical'].includes(result.priority));
  assert.equal(result.aiEligible, true);
  assert.ok(result.reasons.includes('자본조달·주식수 변화'));
});

test('Disclosure rules: routine quarterly report stays low priority', () => {
  const result = scoreDisclosure({ report_nm: '분기보고서 (2026.06)' });
  assert.ok(result.score <= 2);
  assert.equal(result.aiEligible, false);
});

test('Disclosure rules: withdrawn filing is never sent to AI', () => {
  const result = scoreDisclosure({ report_nm: '주요사항보고서(합병결정)', rm: '철' });
  assert.equal(result.score, 0);
  assert.equal(result.aiEligible, false);
});

test('Disclosure normalization: builds canonical DART viewer link', () => {
  const filing = normalizeFiling({
    rcept_no: '20260830001234', corp_cls: 'Y', corp_name: '테스트', corp_code: '00123456', stock_code: '005930',
    report_nm: '단일판매ㆍ공급계약체결', flr_nm: '테스트', rcept_dt: '20260830', rm: ''
  }, new Date('2026-08-30T10:00:00Z'));
  assert.equal(filing.rceptNo, '20260830001234');
  assert.match(filing.sourceUrl, /rcpNo=20260830001234/);
  assert.equal(filing.aiEligible, true);
});

test('Disclosure config: provider can be swapped without caller changes', () => {
  const gemini = disclosureConfig({ GEMINI_API_KEY: 'x' });
  assert.equal(gemini.primaryProvider, 'gemini');
  assert.ok(gemini.primaryModel.startsWith('gemini-'));

  const compatible = disclosureConfig({
    DISCLOSURE_LLM_PROVIDER: 'openai-compatible',
    DISCLOSURE_LLM_MODEL: 'example-model',
    DISCLOSURE_LLM_API_KEY: 'x',
    DISCLOSURE_LLM_BASE_URL: 'https://provider.example/v1'
  });
  assert.equal(compatible.primaryProvider, 'openai-compatible');
  assert.equal(compatible.primaryModel, 'example-model');
  assert.equal(compatible.openAiCompatibleConfigured, true);
});

test('OpenDART adapter: list request contains only provider-specific query parameters', () => {
  const url = sourceTest.buildOpenDartUrl('secret-key', {
    beginDate: '20260829', endDate: '20260830', corpClass: 'K', pageNo: 2
  });
  assert.equal(url.origin + url.pathname, sourceTest.OPENDART_LIST_URL);
  assert.equal(url.searchParams.get('crtfc_key'), 'secret-key');
  assert.equal(url.searchParams.get('corp_cls'), 'K');
  assert.equal(url.searchParams.get('page_count'), '100');
  assert.equal(url.searchParams.get('page_no'), '2');
});

test('LLM adapter: Gemini Interactions output text is extracted and JSON normalized', () => {
  const text = llmTest.interactionOutputText({ steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"summary":"공급계약 체결 요약","key_figures":[],"what_it_means":"시장 영향 해설","impact":"mixed","importance":"high","watch_points":["대금 지급 조건 확인"],"limitation":"DART 원문 확인 필요"}' }] }] });
  const parsed = llmTest.safeJson(text);
  const normalized = llmTest.normalizedAnalysis(parsed);
  assert.equal(normalized.summary, '공급계약 체결 요약');
  assert.equal(normalized.what_it_means, '시장 영향 해설');
  assert.equal(normalized.importance, 'high');
  assert.equal(normalized.impact, 'mixed');
});

test('LLM adapter: prompt explicitly forbids inventing unavailable figures', () => {
  const prompt = llmTest.analysisPrompt({
    corpName: '회사', stockCode: '000000', corpCls: 'Y', reportName: '공급계약체결', filerName: '회사', receiptDate: '20260830', remarks: '', ruleScore: 7, ruleReasons: ['대형 계약·투자']
  });
  assert.match(prompt, /지어내지 말 것/);
  assert.match(prompt, /공시 메타데이터/);
});

test('Disclosure latest filters: priority floors and limits are bounded', () => {
  assert.equal(latestTest.priorityFloor('high'), 7);
  assert.equal(latestTest.priorityFloor('critical'), 10);
  assert.equal(latestTest.clampLimit('999'), 200);
  assert.equal(latestTest.clampLimit('0'), 1);
});
