export const FILINGS_TABLE = 'disclosure_filings';
export const WATCHLIST_TABLE = 'disclosure_watchlist';
export const USAGE_TABLE = 'disclosure_usage_daily';
export const STATE_TABLE = 'disclosure_state';

export const DEFAULT_DART_DAILY_BUDGET = 1000;
export const DEFAULT_LLM_DAILY_BUDGET = 12;
export const DEFAULT_LLM_AUTO_DAILY_BUDGET = 4;
export const DEFAULT_LLM_AUTO_SCORE_FLOOR = 10;
export const DEFAULT_LLM_PER_RUN = 2;
export const DEFAULT_MAX_PAGES_PER_CLASS = 10;
export const DEFAULT_LOOKBACK_DAYS = 1;
export const DEFAULT_LATEST_LIMIT = 100;
export const ANALYSIS_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export const DEFAULT_WATCHLIST = [
  { stockCode: '005930', corpCode: '00126380', corpName: '삼성전자', corpCls: 'Y', sortOrder: 1 },
  { stockCode: '000660', corpCode: '00164779', corpName: 'SK하이닉스', corpCls: 'Y', sortOrder: 2 },
  { stockCode: '373220', corpCode: '01515323', corpName: 'LG에너지솔루션', corpCls: 'Y', sortOrder: 3 },
  { stockCode: '207940', corpCode: '00877059', corpName: '삼성바이오로직스', corpCls: 'Y', sortOrder: 4 },
  { stockCode: '005380', corpCode: '00164742', corpName: '현대차', corpCls: 'Y', sortOrder: 5 },
  { stockCode: '000270', corpCode: '00106641', corpName: '기아', corpCls: 'Y', sortOrder: 6 },
  { stockCode: '068270', corpCode: '00413046', corpName: '셀트리온', corpCls: 'Y', sortOrder: 7 },
  { stockCode: '005490', corpCode: '00149944', corpName: 'POSCO홀딩스', corpCls: 'Y', sortOrder: 8 },
  { stockCode: '035420', corpCode: '00266961', corpName: 'NAVER', corpCls: 'Y', sortOrder: 9 },
  { stockCode: '035720', corpCode: '00258801', corpName: '카카오', corpCls: 'Y', sortOrder: 10 },
  { stockCode: '105560', corpCode: '00858365', corpName: 'KB금융', corpCls: 'Y', sortOrder: 11 },
  { stockCode: '055550', corpCode: '00382199', corpName: '신한지주', corpCls: 'Y', sortOrder: 12 },
  { stockCode: '051910', corpCode: '00373847', corpName: 'LG화학', corpCls: 'Y', sortOrder: 13 },
  { stockCode: '006400', corpCode: '00138279', corpName: '삼성SDI', corpCls: 'Y', sortOrder: 14 },
  { stockCode: '012330', corpCode: '00164788', corpName: '현대모비스', corpCls: 'Y', sortOrder: 15 },
  { stockCode: '028260', corpCode: '00149953', corpName: '삼성물산', corpCls: 'Y', sortOrder: 16 },
  { stockCode: '086790', corpCode: '00561565', corpName: '하나금융지주', corpCls: 'Y', sortOrder: 17 },
  { stockCode: '032830', corpCode: '00138288', corpName: '삼성생명', corpCls: 'Y', sortOrder: 18 },
  { stockCode: '066570', corpCode: '00401731', corpName: 'LG전자', corpCls: 'Y', sortOrder: 19 },
  { stockCode: '034730', corpCode: '00181443', corpName: 'SK', corpCls: 'Y', sortOrder: 20 },
  { stockCode: '247540', corpCode: '01198425', corpName: '에코프로비엠', corpCls: 'K', sortOrder: 21 },
  { stockCode: '086520', corpCode: '00628286', corpName: '에코프로', corpCls: 'K', sortOrder: 22 },
  { stockCode: '196170', corpCode: '00984951', corpName: '알테오젠', corpCls: 'K', sortOrder: 23 },
  { stockCode: '028300', corpCode: '00299491', corpName: 'HLB', corpCls: 'K', sortOrder: 24 },
  { stockCode: '042700', corpCode: '00356372', corpName: '한미반도체', corpCls: 'Y', sortOrder: 25 },
  { stockCode: '034020', corpCode: '00164478', corpName: '두산에너빌리티', corpCls: 'Y', sortOrder: 26 },
  { stockCode: '259960', corpCode: '01309854', corpName: '크래프톤', corpCls: 'Y', sortOrder: 27 },
  { stockCode: '003670', corpCode: '00138260', corpName: '포스코퓨처엠', corpCls: 'Y', sortOrder: 28 },
  { stockCode: '010130', corpCode: '00164751', corpName: '고려아연', corpCls: 'Y', sortOrder: 29 },
  { stockCode: '018260', corpCode: '00164760', corpName: '삼성에스디에스', corpCls: 'Y', sortOrder: 30 }
];

const schemaPromises = new WeakMap();

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

export function isProductionRequest(request) {
  try { return new URL(request.url).hostname === 'snowshagal.com'; }
  catch (_) { return false; }
}

export function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export function authorizeAdmin(request, env) {
  const supplied = request.headers.get('x-admin-key') || '';
  return Boolean(env?.ADMIN_KEY && constantTimeEqual(supplied, env.ADMIN_KEY));
}

export function authorizeSync(request, env) {
  if (authorizeAdmin(request, env)) return 'admin-key';
  const supplied = request.headers.get('x-disclosure-sync-key') || '';
  if (env?.DISCLOSURE_SYNC_KEY && constantTimeEqual(supplied, env.DISCLOSURE_SYNC_KEY)) return 'disclosure-sync-key';
  return '';
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizedProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'gemini' || provider === 'openai-compatible' || provider === 'none') return provider;
  return 'none';
}

function parseCorpClasses(value) {
  const allowed = new Set(['Y', 'K', 'N']);
  const parsed = String(value || 'Y,K')
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(item => allowed.has(item));
  return [...new Set(parsed)].slice(0, 3).length ? [...new Set(parsed)].slice(0, 3) : ['Y', 'K'];
}

export function disclosureConfig(env = {}) {
  const inferredPrimary = env.DISCLOSURE_LLM_PROVIDER
    ? normalizedProvider(env.DISCLOSURE_LLM_PROVIDER)
    : env.GEMINI_API_KEY ? 'gemini' : 'none';
  const primaryProvider = inferredPrimary;
  const fallbackProvider = normalizedProvider(env.DISCLOSURE_LLM_FALLBACK_PROVIDER || 'none');
  const defaultModel = primaryProvider === 'gemini' ? 'gemini-3.5-flash-lite' : '';
  return {
    corpClasses: parseCorpClasses(env.DISCLOSURE_CORP_CLASSES),
    dartDailyBudget: boundedInteger(env.DISCLOSURE_DART_DAILY_BUDGET, DEFAULT_DART_DAILY_BUDGET, 50, 19000),
    llmDailyBudget: boundedInteger(env.DISCLOSURE_LLM_DAILY_BUDGET, DEFAULT_LLM_DAILY_BUDGET, 0, 500),
    llmAutoDailyBudget: boundedInteger(env.DISCLOSURE_LLM_AUTO_DAILY_BUDGET, DEFAULT_LLM_AUTO_DAILY_BUDGET, 0, 100),
    llmAutoScoreFloor: boundedInteger(env.DISCLOSURE_LLM_AUTO_SCORE_FLOOR, DEFAULT_LLM_AUTO_SCORE_FLOOR, 0, 20),
    llmPerRun: boundedInteger(env.DISCLOSURE_LLM_PER_RUN, DEFAULT_LLM_PER_RUN, 0, 10),
    maxPagesPerClass: boundedInteger(env.DISCLOSURE_DART_MAX_PAGES_PER_CLASS, DEFAULT_MAX_PAGES_PER_CLASS, 1, 20),
    lookbackDays: boundedInteger(env.DISCLOSURE_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS, 1, 30),
    primaryProvider,
    primaryModel: String(env.DISCLOSURE_LLM_MODEL || defaultModel).trim(),
    fallbackProvider,
    fallbackModel: String(env.DISCLOSURE_LLM_FALLBACK_MODEL || '').trim(),
    openAiBaseUrl: String(env.DISCLOSURE_LLM_BASE_URL || '').trim(),
    opendartConfigured: Boolean(env.OPENDART_API_KEY),
    geminiConfigured: Boolean(env.GEMINI_API_KEY),
    openAiCompatibleConfigured: Boolean(env.DISCLOSURE_LLM_API_KEY && env.DISCLOSURE_LLM_BASE_URL)
  };
}

export function kstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function compactDate(date) {
  return String(date || '').replace(/-/g, '');
}

export function isIsoDate(value) {
  const raw = String(value || '');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}

export function dateDaysAgo(days, now = new Date()) {
  const currentKstDate = kstDate(now);
  const current = new Date(`${currentKstDate}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() - Math.max(0, Number(days) || 0));
  return current.toISOString().slice(0, 10).replace(/-/g, '');
}

export class DisclosureError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

async function runSchemaMigration(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ${FILINGS_TABLE} (
      rcept_no TEXT PRIMARY KEY,
      corp_cls TEXT NOT NULL,
      corp_name TEXT NOT NULL,
      corp_code TEXT NOT NULL,
      stock_code TEXT NOT NULL DEFAULT '',
      report_nm TEXT NOT NULL,
      flr_nm TEXT NOT NULL DEFAULT '',
      rcept_dt TEXT NOT NULL,
      rm TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL,
      rule_score INTEGER NOT NULL DEFAULT 0,
      rule_priority TEXT NOT NULL DEFAULT 'low',
      rule_reasons_json TEXT NOT NULL DEFAULT '[]',
      ai_eligible INTEGER NOT NULL DEFAULT 0,
      ai_status TEXT NOT NULL DEFAULT 'skipped',
      publish_status TEXT NOT NULL DEFAULT 'admin_only',
      is_watchlist INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL DEFAULT '',
      ai_provider TEXT NOT NULL DEFAULT '',
      ai_model TEXT NOT NULL DEFAULT '',
      ai_json TEXT NOT NULL DEFAULT '',
      ai_error TEXT NOT NULL DEFAULT '',
      ai_analyzed_at TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_disclosure_date_priority ON ${FILINGS_TABLE} (rcept_dt DESC, rule_score DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_disclosure_ai_queue ON ${FILINGS_TABLE} (ai_eligible, ai_status, rcept_dt DESC, rule_score DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_disclosure_published ON ${FILINGS_TABLE} (publish_status, rcept_dt DESC, rule_score DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${WATCHLIST_TABLE} (
      stock_code TEXT PRIMARY KEY,
      corp_code TEXT NOT NULL DEFAULT '',
      corp_name TEXT NOT NULL,
      corp_cls TEXT NOT NULL DEFAULT 'Y',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_disclosure_watchlist_active ON ${WATCHLIST_TABLE} (active, sort_order, corp_name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${USAGE_TABLE} (
      usage_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (usage_date, kind)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
      state_key TEXT PRIMARY KEY,
      state_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
  ]);

  // Ensure new columns exist for preexisting tables
  try {
    const tableInfo = await db.prepare(`PRAGMA table_info(${FILINGS_TABLE})`).all();
    const existingCols = new Set((tableInfo?.results || []).map(r => r.name));
    if (!existingCols.has('publish_status')) {
      await db.prepare(`ALTER TABLE ${FILINGS_TABLE} ADD COLUMN publish_status TEXT NOT NULL DEFAULT 'admin_only'`).run();
    }
    if (!existingCols.has('is_watchlist')) {
      await db.prepare(`ALTER TABLE ${FILINGS_TABLE} ADD COLUMN is_watchlist INTEGER NOT NULL DEFAULT 0`).run();
    }
    if (!existingCols.has('published_at')) {
      await db.prepare(`ALTER TABLE ${FILINGS_TABLE} ADD COLUMN published_at TEXT NOT NULL DEFAULT ''`).run();
    }
  } catch (_) {}

  // Seed default watchlist if empty
  try {
    const countRow = await db.prepare(`SELECT count(*) as count FROM ${WATCHLIST_TABLE}`).first();
    if (Number(countRow?.count || 0) === 0) {
      const now = new Date().toISOString();
      const seedStatements = DEFAULT_WATCHLIST.map(item =>
        db.prepare(`INSERT OR IGNORE INTO ${WATCHLIST_TABLE} (stock_code, corp_code, corp_name, corp_cls, active, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).bind(item.stockCode, item.corpCode, item.corpName, item.corpCls, item.sortOrder, now, now)
      );
      if (seedStatements.length) await db.batch(seedStatements);
    }
  } catch (_) {}
}

export async function ensureDisclosureSchema(env) {
  const db = env?.COMMENTS_DB;
  if (!db) throw new DisclosureError('DB_NOT_CONFIGURED', '공시 모니터 데이터베이스가 연결되지 않았습니다.', 503);
  if (!schemaPromises.has(db)) {
    const promise = runSchemaMigration(db).catch(error => {
      schemaPromises.delete(db);
      throw error;
    });
    schemaPromises.set(db, promise);
  }
  try { await schemaPromises.get(db); }
  catch (error) {
    console.error('disclosure schema init failed', error);
    throw new DisclosureError('DB_INIT_FAILED', '공시 모니터 데이터베이스 초기화에 실패했습니다.', 500);
  }
  return db;
}

export async function reserveRequest(db, usageDate, kind, limit) {
  const safeLimit = Math.max(0, Number(limit) || 0);
  const now = new Date().toISOString();
  const result = await db.prepare(`INSERT INTO ${USAGE_TABLE} (usage_date, kind, request_count, input_tokens, output_tokens, updated_at)
    SELECT ?, ?, 1, 0, 0, ?
    WHERE ? > 0
    ON CONFLICT(usage_date, kind) DO UPDATE SET
      request_count = ${USAGE_TABLE}.request_count + 1,
      updated_at = excluded.updated_at
    WHERE ${USAGE_TABLE}.request_count < ?
    RETURNING request_count`)
    .bind(usageDate, kind, now, safeLimit, safeLimit).all();
  const reserved = result?.results?.[0];
  if (reserved) return { allowed: true, count: Number(reserved.request_count || 0), limit: safeLimit };
  const current = await db.prepare(`SELECT request_count FROM ${USAGE_TABLE} WHERE usage_date = ? AND kind = ? LIMIT 1`)
    .bind(usageDate, kind).first();
  return { allowed: false, count: Number(current?.request_count || 0), limit: safeLimit };
}

export async function recordRequest(db, usageDate, kind) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO ${USAGE_TABLE} (usage_date, kind, request_count, input_tokens, output_tokens, updated_at)
    VALUES (?, ?, 1, 0, 0, ?)
    ON CONFLICT(usage_date, kind) DO UPDATE SET
      request_count = ${USAGE_TABLE}.request_count + 1,
      updated_at = excluded.updated_at`)
    .bind(usageDate, kind, now).run();
}

export async function addTokenUsage(db, usageDate, kind, inputTokens = 0, outputTokens = 0) {
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  if (!input && !output) return;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO ${USAGE_TABLE} (usage_date, kind, request_count, input_tokens, output_tokens, updated_at)
    VALUES (?, ?, 0, ?, ?, ?)
    ON CONFLICT(usage_date, kind) DO UPDATE SET
      input_tokens = ${USAGE_TABLE}.input_tokens + excluded.input_tokens,
      output_tokens = ${USAGE_TABLE}.output_tokens + excluded.output_tokens,
      updated_at = excluded.updated_at`)
    .bind(usageDate, kind, input, output, now).run();
}

export async function usageSnapshot(db, usageDate) {
  const result = await db.prepare(`SELECT kind, request_count, input_tokens, output_tokens FROM ${USAGE_TABLE} WHERE usage_date = ? ORDER BY kind`)
    .bind(usageDate).all();
  const usage = {};
  for (const row of result?.results || []) {
    usage[row.kind] = {
      requests: Number(row.request_count || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0)
    };
  }
  return usage;
}

export async function setState(db, key, value) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO ${STATE_TABLE} (state_key, state_value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value, updated_at = excluded.updated_at`)
    .bind(String(key), String(value), now).run();
}

export async function stateSnapshot(db) {
  const result = await db.prepare(`SELECT state_key, state_value, updated_at FROM ${STATE_TABLE}`).all();
  const state = {};
  for (const row of result?.results || []) {
    state[row.state_key] = { value: row.state_value, updatedAt: row.updated_at };
  }
  return state;
}

const SPECIFIC_RULES = [
  { points: 10, label: '상장·감사 리스크', re: /(상장폐지|관리종목|거래정지|감사의견|감사보고서.*의견|부도|회생절차|파산|횡령|배임|영업정지)/i },
  { points: 8, label: '지배구조·사업구조 변경', re: /(최대주주.*변경|합병|회사분할|분할합병|주식교환|주식이전|영업양수|영업양도)/i },
  { points: 7, label: '자본조달·주식수 변화', re: /(유상증자|무상증자|감자|전환사채|신주인수권부사채|교환사채|증권신고서.*지분|자기주식.*취득|자기주식.*처분)/i },
  { points: 7, label: '대형 계약·투자', re: /(단일판매|공급계약|타법인.*주식.*취득|타법인.*주식.*처분|유형자산.*양수|유형자산.*양도|신규시설투자|시설투자)/i },
  { points: 6, label: '실적 변화', re: /(잠정.*실적|영업.*실적|매출액.*손익구조|실적.*전망|영업이익.*변동)/i },
  { points: 6, label: '법적·재무 부담', re: /(소송|채무보증|담보제공|금전대여|채무인수|채권은행.*관리절차|생산중단)/i },
  { points: 4, label: '주주환원', re: /(현금.*배당|현물.*배당|주식배당|자기주식.*소각)/i },
  { points: 3, label: '경영진 변화', re: /(대표이사.*변경|대표집행임원.*변경)/i },
  { points: 2, label: '투자판단 공시', re: /(투자판단|공정공시)/i }
];

const MAJOR_REPORT_RULE = { points: 5, label: '주요사항보고', re: /주요사항보고서/i };
const ROUTINE_REPORT = /(사업보고서|반기보고서|분기보고서|주주총회소집공고|의결권대리행사권유|임원.?주요주주.*소유상황보고서|기업지배구조보고서)/i;
const CORRECTION = /^\[(?:기재정정|첨부정정|첨부추가|변경등록|발행조건확정|정정제출요구|정정명령부과)\]/i;

export function scoreDisclosure(filing = {}) {
  const reportName = String(filing.report_nm || filing.reportName || '').trim();
  const remarks = String(filing.rm || '').trim();
  if (!reportName) return { score: 0, priority: 'low', reasons: [], aiEligible: false };
  if (remarks.includes('철')) return { score: 0, priority: 'low', reasons: ['철회 공시'], aiEligible: false };

  let score = 0;
  const reasons = [];
  let specificMatched = false;

  for (const rule of SPECIFIC_RULES) {
    if (!rule.re.test(reportName)) continue;
    score += rule.points;
    reasons.push(rule.label);
    specificMatched = true;
  }

  if (!specificMatched && MAJOR_REPORT_RULE.re.test(reportName)) {
    score += MAJOR_REPORT_RULE.points;
    reasons.push(MAJOR_REPORT_RULE.label);
  } else if (specificMatched && MAJOR_REPORT_RULE.re.test(reportName)) {
    reasons.push(MAJOR_REPORT_RULE.label);
  }

  if (CORRECTION.test(reportName) && score > 0) {
    score += 1;
    reasons.push('중요 공시 정정');
  }

  if (ROUTINE_REPORT.test(reportName) && score < 6) {
    score = Math.min(score, 2);
    if (!reasons.length) reasons.push('정기·절차 공시');
  }

  const priority = score >= 10 ? 'critical' : score >= 7 ? 'high' : score >= 5 ? 'medium' : 'low';
  return {
    score,
    priority,
    reasons: [...new Set(reasons)].slice(0, 5),
    aiEligible: score >= 5
  };
}

export function normalizeFiling(item = {}, now = new Date()) {
  const rule = scoreDisclosure(item);
  const rceptNo = String(item.rcept_no || '').trim();
  return {
    rceptNo,
    corpCls: String(item.corp_cls || '').trim(),
    corpName: String(item.corp_name || '').trim().slice(0, 160),
    corpCode: String(item.corp_code || '').trim(),
    stockCode: String(item.stock_code || '').trim(),
    reportName: String(item.report_nm || '').trim().slice(0, 500),
    filerName: String(item.flr_nm || '').trim().slice(0, 160),
    receiptDate: String(item.rcept_dt || '').trim(),
    remarks: String(item.rm || '').trim().slice(0, 80),
    sourceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}`,
    ruleScore: rule.score,
    rulePriority: rule.priority,
    ruleReasons: rule.reasons,
    aiEligible: rule.aiEligible,
    firstSeenAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export async function getWatchlist(db) {
  const result = await db.prepare(`SELECT stock_code, corp_code, corp_name, corp_cls, active, sort_order, created_at, updated_at
    FROM ${WATCHLIST_TABLE}
    ORDER BY sort_order ASC, corp_name ASC`).all();
  return (result?.results || []).map(row => ({
    stockCode: row.stock_code,
    corpCode: row.corp_code,
    corpName: row.corp_name,
    corpCls: row.corp_cls,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getWatchlistStockCodes(db) {
  const result = await db.prepare(`SELECT stock_code FROM ${WATCHLIST_TABLE} WHERE active = 1`).all();
  return new Set((result?.results || []).map(r => r.stock_code));
}

export async function addWatchlistCompany(db, { stockCode, corpCode = '', corpName, corpCls = 'Y', sortOrder = 0 }) {
  const safeStock = String(stockCode || '').trim();
  const safeName = String(corpName || '').trim();
  if (!safeStock || !safeName) throw new DisclosureError('INVALID_INPUT', '종목코드와 회사명은 필수입니다.', 400);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO ${WATCHLIST_TABLE} (stock_code, corp_code, corp_name, corp_cls, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(stock_code) DO UPDATE SET
      corp_name = excluded.corp_name,
      corp_code = CASE WHEN excluded.corp_code != '' THEN excluded.corp_code ELSE ${WATCHLIST_TABLE}.corp_code END,
      corp_cls = excluded.corp_cls,
      active = 1,
      updated_at = excluded.updated_at`)
    .bind(safeStock, String(corpCode || '').trim(), safeName, String(corpCls || 'Y').trim().toUpperCase(), Number(sortOrder) || 0, now, now).run();

  // Update existing filings for this stock code to is_watchlist = 1
  await db.prepare(`UPDATE ${FILINGS_TABLE} SET is_watchlist = 1, updated_at = ? WHERE stock_code = ?`).bind(now, safeStock).run();
  // Auto-publish eligible high score filings
  await db.prepare(`UPDATE ${FILINGS_TABLE} SET
      publish_status = 'auto',
      published_at = CASE WHEN published_at = '' OR published_at IS NULL THEN ? ELSE published_at END,
      updated_at = ?
    WHERE stock_code = ? AND rule_score >= 7 AND publish_status = 'admin_only'`)
    .bind(now, now, safeStock).run();

  return { stockCode: safeStock, corpName: safeName, active: true };
}

export async function removeWatchlistCompany(db, stockCode) {
  const safeStock = String(stockCode || '').trim();
  if (!safeStock) throw new DisclosureError('INVALID_INPUT', '종목코드가 필요합니다.', 400);
  const now = new Date().toISOString();
  await db.prepare(`DELETE FROM ${WATCHLIST_TABLE} WHERE stock_code = ?`).bind(safeStock).run();
  await db.prepare(`UPDATE ${FILINGS_TABLE} SET is_watchlist = 0, updated_at = ? WHERE stock_code = ?`).bind(now, safeStock).run();
  // Unpublish auto-published filings for removed company
  await db.prepare(`UPDATE ${FILINGS_TABLE} SET publish_status = 'admin_only', updated_at = ? WHERE stock_code = ? AND publish_status = 'auto'`).bind(now, safeStock).run();
  return { stockCode: safeStock, deleted: true };
}

export async function toggleWatchlistActive(db, stockCode, active) {
  const safeStock = String(stockCode || '').trim();
  const isActive = Boolean(active);
  const now = new Date().toISOString();
  await db.prepare(`UPDATE ${WATCHLIST_TABLE} SET active = ?, updated_at = ? WHERE stock_code = ?`)
    .bind(isActive ? 1 : 0, now, safeStock).run();
  await db.prepare(`UPDATE ${FILINGS_TABLE} SET is_watchlist = ?, updated_at = ? WHERE stock_code = ?`)
    .bind(isActive ? 1 : 0, now, safeStock).run();
  if (!isActive) {
    await db.prepare(`UPDATE ${FILINGS_TABLE} SET publish_status = 'admin_only', updated_at = ? WHERE stock_code = ? AND publish_status = 'auto'`).bind(now, safeStock).run();
  } else {
    await db.prepare(`UPDATE ${FILINGS_TABLE} SET
        publish_status = 'auto',
        published_at = CASE WHEN published_at = '' OR published_at IS NULL THEN ? ELSE published_at END,
        updated_at = ?
      WHERE stock_code = ? AND rule_score >= 7 AND publish_status = 'admin_only'`)
      .bind(now, now, safeStock).run();
  }
  return { stockCode: safeStock, active: isActive };
}

export async function setFilingPublishStatus(db, rceptNo, publishStatus, now = new Date()) {
  const safeStatus = (publishStatus === 'manual' || publishStatus === 'auto') ? publishStatus : 'admin_only';
  const timestamp = now.toISOString();
  const publishedAtVal = safeStatus === 'admin_only' ? '' : timestamp;
  const result = await db.prepare(`UPDATE ${FILINGS_TABLE} SET
      publish_status = ?,
      published_at = CASE WHEN ? = 'admin_only' THEN '' ELSE (CASE WHEN published_at != '' AND published_at IS NOT NULL THEN published_at ELSE ? END) END,
      updated_at = ?
    WHERE rcept_no = ?
    RETURNING *`)
    .bind(safeStatus, safeStatus, publishedAtVal, timestamp, rceptNo).all();
  const row = result?.results?.[0];
  if (!row) throw new DisclosureError('NOT_FOUND', '해당 공시를 찾을 수 없습니다.', 404);
  return publicFiling(row);
}

export async function upsertFiling(db, filing, { watchlistCodes = null } = {}) {
  if (!/^\d{14}$/.test(filing.rceptNo)) return false;
  const initialAiStatus = filing.aiEligible ? 'available' : 'skipped';
  const isWatchlist = watchlistCodes ? (watchlistCodes.has(filing.stockCode) ? 1 : 0) : 0;
  const autoPublish = Boolean(isWatchlist && filing.ruleScore >= 7);
  const initialPublishStatus = autoPublish ? 'auto' : 'admin_only';
  const initialPublishedAt = autoPublish ? filing.firstSeenAt : '';

  const inserted = await db.prepare(`INSERT INTO ${FILINGS_TABLE} (
      rcept_no, corp_cls, corp_name, corp_code, stock_code, report_nm, flr_nm, rcept_dt, rm, source_url,
      rule_score, rule_priority, rule_reasons_json, ai_eligible, ai_status, publish_status, is_watchlist,
      published_at, first_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rcept_no) DO NOTHING
    RETURNING rcept_no`)
    .bind(
      filing.rceptNo, filing.corpCls, filing.corpName, filing.corpCode, filing.stockCode, filing.reportName,
      filing.filerName, filing.receiptDate, filing.remarks, filing.sourceUrl, filing.ruleScore, filing.rulePriority,
      JSON.stringify(filing.ruleReasons), filing.aiEligible ? 1 : 0, initialAiStatus, initialPublishStatus, isWatchlist,
      initialPublishedAt, filing.firstSeenAt, filing.updatedAt
    ).all();
  if (inserted?.results?.length) return true;

  await db.prepare(`UPDATE ${FILINGS_TABLE} SET
      corp_cls = ?,
      corp_name = ?,
      corp_code = ?,
      stock_code = ?,
      report_nm = ?,
      flr_nm = ?,
      rcept_dt = ?,
      rm = ?,
      source_url = ?,
      rule_score = ?,
      rule_priority = ?,
      rule_reasons_json = ?,
      ai_eligible = ?,
      is_watchlist = ?,
      publish_status = CASE
        WHEN ${FILINGS_TABLE}.publish_status = 'manual' THEN 'manual'
        WHEN ? = 1 AND ? >= 7 THEN 'auto'
        WHEN ${FILINGS_TABLE}.publish_status = 'auto' AND (? = 0 OR ? < 7) THEN 'admin_only'
        ELSE ${FILINGS_TABLE}.publish_status
      END,
      published_at = CASE
        WHEN ${FILINGS_TABLE}.publish_status = 'manual' THEN ${FILINGS_TABLE}.published_at
        WHEN ? = 1 AND ? >= 7 AND (${FILINGS_TABLE}.published_at = '' OR ${FILINGS_TABLE}.published_at IS NULL) THEN ?
        ELSE ${FILINGS_TABLE}.published_at
      END,
      ai_status = CASE
        WHEN ? = 0 THEN 'skipped'
        WHEN ${FILINGS_TABLE}.ai_status IN ('done', 'processing') THEN ${FILINGS_TABLE}.ai_status
        WHEN ${FILINGS_TABLE}.ai_status = 'error' THEN 'error'
        ELSE 'available'
      END,
      updated_at = ?
    WHERE rcept_no = ?`)
    .bind(
      filing.corpCls, filing.corpName, filing.corpCode, filing.stockCode, filing.reportName,
      filing.filerName, filing.receiptDate, filing.remarks, filing.sourceUrl, filing.ruleScore,
      filing.rulePriority, JSON.stringify(filing.ruleReasons), filing.aiEligible ? 1 : 0,
      isWatchlist,
      isWatchlist, filing.ruleScore, isWatchlist, filing.ruleScore,
      isWatchlist, filing.ruleScore, filing.updatedAt,
      filing.aiEligible ? 1 : 0, filing.updatedAt, filing.rceptNo
    ).run();
  return false;
}

export async function claimFilingForAnalysis(db, rceptNo, { allowDone = false, now = new Date() } = {}) {
  const claimedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - ANALYSIS_CLAIM_TIMEOUT_MS).toISOString();
  const statuses = allowDone ? "'available', 'pending', 'error', 'done'" : "'available', 'pending', 'error'";
  const result = await db.prepare(`UPDATE ${FILINGS_TABLE}
    SET ai_status = 'processing', ai_error = '', updated_at = ?
    WHERE rcept_no = ? AND ai_eligible = 1 AND (
      ai_status IN (${statuses}) OR (ai_status = 'processing' AND updated_at < ?)
    )
    RETURNING *`).bind(claimedAt, rceptNo, staleBefore).all();
  return result?.results?.[0] || null;
}

export async function releaseAnalysisClaim(db, rceptNo, status, errorMessage = '', now = new Date()) {
  const safeStatus = status === 'error' ? 'error' : (status === 'available' || status === 'pending' ? 'available' : 'available');
  await db.prepare(`UPDATE ${FILINGS_TABLE}
    SET ai_status = ?, ai_error = ?, updated_at = ?
    WHERE rcept_no = ? AND ai_status = 'processing'`)
    .bind(safeStatus, String(errorMessage || '').slice(0, 300), now.toISOString(), rceptNo).run();
}

export function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

export function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) { return null; }
}

export function publicFiling(row) {
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
    sourceUrl: row.source_url,
    publishStatus: row.publish_status || 'admin_only',
    isWatchlist: Boolean(row.is_watchlist),
    publishedAt: row.published_at || '',
    rule: {
      score: Number(row.rule_score || 0),
      priority: row.rule_priority || 'low',
      reasons: parseJsonArray(row.rule_reasons_json),
      aiEligible: Boolean(row.ai_eligible)
    },
    ai: {
      status: row.ai_status || 'skipped',
      provider: row.ai_provider || '',
      model: row.ai_model || '',
      result: parseJsonObject(row.ai_json),
      error: row.ai_error || '',
      analyzedAt: row.ai_analyzed_at || ''
    },
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at
  };
}

export const __test = {
  RULES: SPECIFIC_RULES,
  SPECIFIC_RULES,
  MAJOR_REPORT_RULE,
  ROUTINE_REPORT,
  CORRECTION,
  DEFAULT_WATCHLIST,
  boundedInteger,
  normalizedProvider,
  parseCorpClasses,
  resetSchemaCache() { schemaPromises.clear?.(); }
};
