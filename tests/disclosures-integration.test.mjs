import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  FILINGS_TABLE,
  claimFilingForAnalysis,
  compactDate,
  dateDaysAgo,
  disclosureConfig,
  ensureDisclosureSchema,
  kstDate,
  normalizeFiling,
  reserveRequest,
  upsertFiling
} from '../functions/api/disclosures/_shared.js';
import { fetchDisclosureSource } from '../functions/api/disclosures/_source.js';
import { analyzeWithLlm, __test as llmTest } from '../functions/api/disclosures/_llm.js';
import { onRequestPost as syncPost, __test as syncTest } from '../functions/api/disclosures/sync.js';
import { onRequestGet as latestGet } from '../functions/api/disclosures/latest.js';
import { onRequestPost as analyzePost } from '../functions/api/disclosures/analyze.js';

class SqliteStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
  }

  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  row(sql, ...values) {
    return this.database.prepare(sql).get(...values) || null;
  }

  rows(sql, ...values) {
    return this.database.prepare(sql).all(...values);
  }

  close() {
    this.database.close();
  }
}

const ADMIN_KEY = 'integration-admin-secret';
const OPENDART_KEY = 'integration-opendart-secret';
const GEMINI_KEY = 'integration-gemini-secret';
const NOW = new Date('2026-08-30T10:00:00.000Z');
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

function envFor(db, extra = {}) {
  return {
    COMMENTS_DB: db,
    ADMIN_KEY,
    OPENDART_API_KEY: OPENDART_KEY,
    GEMINI_API_KEY: GEMINI_KEY,
    DISCLOSURE_LLM_PROVIDER: 'gemini',
    DISCLOSURE_LLM_MODEL: 'gemini-3.5-flash-lite',
    ...extra
  };
}

function item(number, overrides = {}) {
  return {
    rcept_no: number,
    corp_cls: 'Y',
    corp_name: '테스트기업',
    corp_code: '00123456',
    stock_code: '005930',
    report_nm: '상장폐지(관리종목지정)',
    flr_nm: '테스트기업',
    rcept_dt: compactDate(kstDate(NOW)),
    rm: '',
    ...overrides
  };
}

function validAnalysis(overrides = {}) {
  return {
    headline: '중요 자본조달 공시',
    summary: '유상증자 결정 공시로 원문 확인이 필요합니다.',
    impact: 'mixed',
    urgency: 'high',
    confidence: 80,
    watch_points: ['세부 조건 원문 확인'],
    limitation: '공시 원문이 제공되지 않아 DART 원문 확인이 필요합니다.',
    ...overrides
  };
}

function geminiResponse(analysis = validAnalysis(), status = 200) {
  return new Response(JSON.stringify(status === 200 ? {
    model: 'models/gemini-3.5-flash-lite',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(analysis) }] }],
    usage: { total_input_tokens: 100, total_output_tokens: 50 }
  } : { error: { message: 'upstream failure' } }), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function adminRequest(path, options = {}) {
  return new Request(`https://preview.market-research-site.pages.dev${path}`, {
    ...options,
    headers: { 'x-admin-key': ADMIN_KEY, ...(options.headers || {}) }
  });
}

async function seededDb(filings = []) {
  const d1 = new SqliteD1();
  const db = {
    prepare(sql) { return d1.prepare(sql); },
    batch(statements) { return d1.batch(statements); },
    exec(sql) { return d1.database.exec(sql); },
    row(sql, ...params) { return d1.database.prepare(sql).get(...params); },
    close() { d1.database.close(); },
    database: d1.database
  };
  await ensureDisclosureSchema({ COMMENTS_DB: db });
  for (const f of filings) {
    await upsertFiling(db, normalizeFiling(f, NOW));
  }
  return db;
}

test('duplicate rcept_no is idempotent and a completed AI result is preserved', async () => {
  const db = await seededDb();
  const filing = normalizeFiling(item('20260830000001'), NOW);
  assert.equal(await upsertFiling(db, filing), true);
  assert.equal(db.row(`SELECT ai_status FROM ${FILINGS_TABLE}`).ai_status, 'available');

  await db.prepare(`UPDATE ${FILINGS_TABLE} SET ai_status = 'done', ai_json = ?`).bind(JSON.stringify({ headline: 'custom' })).run();
  assert.equal(await upsertFiling(db, filing), false);
  const preserved = db.row(`SELECT ai_status, ai_json FROM ${FILINGS_TABLE}`);
  assert.equal(preserved.ai_status, 'done');
  assert.equal(JSON.parse(preserved.ai_json).headline, 'custom');
  db.close();
});

test('a concurrent source refresh cannot reset a live AI claim to available', async () => {
  const db = await seededDb([item('20260830000001')]);
  const claimed = await claimFilingForAnalysis(db, '20260830000001', { now: NOW });
  assert.ok(claimed);
  await upsertFiling(db, normalizeFiling(item('20260830000001'), NOW));
  const row = db.row(`SELECT ai_status FROM ${FILINGS_TABLE} WHERE rcept_no = '20260830000001'`);
  assert.equal(row.ai_status, 'processing');
  db.close();
});

test('daily quota reservation is atomic and cannot exceed its ceiling', async () => {
  const db = await seededDb();
  const reservations = await Promise.all([
    reserveRequest(db, '2026-08-30', 'llm:total', 2),
    reserveRequest(db, '2026-08-30', 'llm:total', 2),
    reserveRequest(db, '2026-08-30', 'llm:total', 2)
  ]);
  assert.equal(reservations.filter(row => row.allowed).length, 2);
  assert.equal(db.row('SELECT request_count FROM disclosure_usage_daily WHERE usage_date = ? AND kind = ?', '2026-08-30', 'llm:total').request_count, 2);
  db.close();
});

test('KST lookback date does not drift to the previous UTC day', () => {
  assert.equal(dateDaysAgo(0, new Date('2026-08-30T16:30:00Z')), '20260831');
  assert.equal(dateDaysAgo(6, new Date('2026-08-30T16:30:00Z')), '20260825');
});

test('OpenDART status 000 paginates and normalizes every result', async () => {
  const db = await seededDb();
  const pages = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    pages.push(Number(parsed.searchParams.get('page_no')));
    const page = Number(parsed.searchParams.get('page_no'));
    return new Response(JSON.stringify({
      status: '000', total_page: 2, total_count: 2,
      list: [item(page === 1 ? '20260830000001' : '20260830000002')]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const source = await fetchDisclosureSource({
    env: envFor(db, { DISCLOSURE_CORP_CLASSES: 'Y', DISCLOSURE_LOOKBACK_DAYS: '1' }), db, now: NOW
  });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(source.filings.length, 2);
  assert.equal(source.truncated, false);
  assert.match(source.filings[0].sourceUrl, /^https:\/\/dart\.fss\.or\.kr\//);
  db.close();
});

test('OpenDART status 013 is a successful empty source result', async () => {
  const db = await seededDb();
  globalThis.fetch = async () => new Response(JSON.stringify({ status: '013', message: '조회된 데이터가 없습니다.' }), { status: 200 });
  const source = await fetchDisclosureSource({ env: envFor(db, { DISCLOSURE_CORP_CLASSES: 'K' }), db, now: NOW });
  assert.deepEqual(source.filings, []);
  assert.equal(source.classes[0].totalPage, 0);
  db.close();
});

test('OpenDART page cap is explicit and marks a result truncated', async () => {
  const db = await seededDb();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ status: '000', total_page: 3, total_count: 3, list: [item('20260830000001')] }), { status: 200 });
  };
  const source = await fetchDisclosureSource({
    env: envFor(db, { DISCLOSURE_CORP_CLASSES: 'Y', DISCLOSURE_DART_MAX_PAGES_PER_CLASS: '1' }), db, now: NOW
  });
  assert.equal(calls, 1);
  assert.equal(source.truncated, true);
  db.close();
});

test('OpenDART quota status 020 and malformed JSON fail visibly', async () => {
  const db = await seededDb();
  globalThis.fetch = async () => new Response(JSON.stringify({ status: '020', message: '요청 제한' }), { status: 200 });
  await assert.rejects(
    fetchDisclosureSource({ env: envFor(db, { DISCLOSURE_CORP_CLASSES: 'Y' }), db, now: NOW }),
    error => error.code === 'OPENDART_API_ERROR' && error.status === 429
  );
  globalThis.fetch = async () => new Response('<html>bad</html>', { status: 200 });
  await assert.rejects(
    fetchDisclosureSource({ env: envFor(db, { DISCLOSURE_CORP_CLASSES: 'Y' }), db, now: NOW }),
    error => error.code === 'OPENDART_BAD_RESPONSE'
  );
  db.close();
});

test('Gemini malformed JSON is rejected and still consumes one protected attempt', async () => {
  const db = await seededDb();
  globalThis.fetch = async () => new Response(JSON.stringify({
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'not json' }] }]
  }), { status: 200 });
  await assert.rejects(
    analyzeWithLlm({ filing: normalizeFiling(item('20260830000001'), NOW), env: envFor(db), db, now: NOW }),
    error => error.code === 'LLM_BAD_OUTPUT'
  );
  assert.equal(db.row("SELECT request_count FROM disclosure_usage_daily WHERE kind = 'llm:total'").request_count, 1);
  db.close();
});

test('AI output validation rejects figures absent from filing metadata', () => {
  assert.throws(
    () => llmTest.normalizedAnalysis(validAnalysis({ summary: '계약금액 500억원으로 추정됩니다.' }), normalizeFiling(item('20260830000001'), NOW)),
    error => error.code === 'LLM_UNSUPPORTED_FIGURE'
  );
});

test('retryable Gemini failure falls back, but authentication failure does not', async () => {
  const db = await seededDb();
  const env = envFor(db, {
    DISCLOSURE_LLM_FALLBACK_PROVIDER: 'openai-compatible',
    DISCLOSURE_LLM_FALLBACK_MODEL: 'fallback-model',
    DISCLOSURE_LLM_BASE_URL: 'https://fallback.example/v1',
    DISCLOSURE_LLM_API_KEY: 'fallback-secret'
  });
  let calls = 0;
  globalThis.fetch = async url => {
    calls += 1;
    if (String(url).includes('generativelanguage')) return geminiResponse(validAnalysis(), 500);
    return new Response(JSON.stringify({
      model: 'fallback-model', choices: [{ message: { content: JSON.stringify(validAnalysis()) } }],
      usage: { prompt_tokens: 90, completion_tokens: 40 }
    }), { status: 200 });
  };
  const output = await analyzeWithLlm({ filing: normalizeFiling(item('20260830000001'), NOW), env, db, now: NOW });
  assert.equal(output.provider, 'openai-compatible');
  assert.equal(calls, 2);

  const secondDb = await seededDb();
  let authCalls = 0;
  globalThis.fetch = async () => {
    authCalls += 1;
    return new Response(JSON.stringify({ error: { message: 'invalid API key' } }), { status: 401 });
  };
  await assert.rejects(
    analyzeWithLlm({ filing: normalizeFiling(item('20260830000002'), NOW), env: envFor(secondDb, {
      DISCLOSURE_LLM_FALLBACK_PROVIDER: 'openai-compatible',
      DISCLOSURE_LLM_FALLBACK_MODEL: 'fallback-model',
      DISCLOSURE_LLM_BASE_URL: 'https://fallback.example/v1',
      DISCLOSURE_LLM_API_KEY: 'fallback-secret'
    }), db: secondDb, now: NOW }),
    error => error.code === 'GEMINI_API_ERROR'
  );
  assert.equal(authCalls, 1);
  db.close();
  secondDb.close();
});

test('sync AI queue obeys per-run limit and does not reprocess completed rows', async () => {
  const filings = Array.from({ length: 4 }, (_, index) => item(`2026083000000${index + 1}`));
  const db = await seededDb(filings);
  globalThis.fetch = async () => geminiResponse();
  const cfg = disclosureConfig(envFor(db, { DISCLOSURE_LLM_PER_RUN: '2', DISCLOSURE_LLM_AUTO_DAILY_BUDGET: '10' }));
  const first = await syncTest.analyzeQueue(db, envFor(db), cfg, NOW);
  assert.deepEqual({ attempted: first.attempted, completed: first.completed, failed: first.failed }, { attempted: 2, completed: 2, failed: 0 });
  assert.equal(db.row(`SELECT COUNT(*) AS count FROM ${FILINGS_TABLE} WHERE ai_status = 'done'`).count, 2);
  const second = await syncTest.analyzeQueue(db, envFor(db), cfg, NOW);
  assert.equal(second.completed, 2);
  assert.equal(db.row(`SELECT COUNT(*) AS count FROM ${FILINGS_TABLE} WHERE ai_status = 'done'`).count, 4);
  db.close();
});

test('past lookback filings stay in available status and are never auto-queued during sync', async () => {
  const pastFiling = item('20260825000001', { rcept_dt: '20260825' });
  const db = await seededDb([pastFiling]);
  const config = disclosureConfig(envFor(db));
  const result = await syncTest.analyzeQueue(db, envFor(db), config, NOW);
  assert.deepEqual(result, { attempted: 0, completed: 0, failed: 0, stopReason: '' });
  assert.equal(db.row(`SELECT ai_status FROM ${FILINGS_TABLE} WHERE rcept_no = '20260825000001'`).ai_status, 'available');
  db.close();
});

test('AI-disabled sync leaves eligible rows in available status instead of failing collection', async () => {
  const db = await seededDb([item('20260830000001')]);
  const cfg = disclosureConfig(envFor(db, { GEMINI_API_KEY: '', DISCLOSURE_LLM_PROVIDER: 'none' }));
  const result = await syncTest.analyzeQueue(db, envFor(db, {
    GEMINI_API_KEY: '', DISCLOSURE_LLM_PROVIDER: 'none'
  }), cfg, NOW);
  assert.equal(result.stopReason, 'LLM_NOT_CONFIGURED');
  assert.equal(db.row(`SELECT ai_status FROM ${FILINGS_TABLE}`).ai_status, 'available');
  db.close();
});

test('missing OpenDART secret fails with an explicit configuration error before quota use', async () => {
  const db = await seededDb();
  await assert.rejects(
    fetchDisclosureSource({
      env: envFor(db, { OPENDART_API_KEY: '', DISCLOSURE_CORP_CLASSES: 'Y' }),
      db,
      now: NOW
    }),
    error => error.code === 'OPENDART_NOT_CONFIGURED' && error.status === 503
  );
  assert.equal(db.row(`SELECT COUNT(*) AS count FROM disclosure_usage_daily`).count, 0);
  db.close();
});

test('provider failure does not roll back collected filings and repeated sync stays duplicate-free', async () => {
  const db = await seededDb();
  globalThis.fetch = async url => {
    if (String(url).includes('opendart')) {
      return new Response(JSON.stringify({ status: '000', total_page: 1, total_count: 1, list: [item('20260830000001', { rcept_dt: compactDate(kstDate(new Date())) })] }), { status: 200 });
    }
    return geminiResponse(validAnalysis(), 500);
  };
  const request = () => adminRequest('/api/disclosures/sync', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  const first = await syncPost({ request: request(), env: envFor(db, { DISCLOSURE_CORP_CLASSES: 'Y' }) });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.source.created, 1);
  assert.equal(firstBody.ai.failed, 1);
  assert.equal(db.row(`SELECT COUNT(*) AS count FROM ${FILINGS_TABLE}`).count, 1);

  const second = await syncPost({ request: request(), env: envFor(db, { DISCLOSURE_CORP_CLASSES: 'Y' }) });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).source.created, 0);
  assert.equal(db.row(`SELECT COUNT(*) AS count FROM ${FILINGS_TABLE}`).count, 1);
  db.close();
});

test('manual AI reanalysis updates one eligible filing and increments quota', async () => {
  const db = await seededDb([item('20260830000001')]);
  db.database.prepare(`UPDATE ${FILINGS_TABLE} SET ai_status = 'done', ai_json = ?`).run(JSON.stringify(validAnalysis({ headline: 'old' })));
  globalThis.fetch = async () => geminiResponse(validAnalysis({ headline: 'new headline' }));
  const response = await analyzePost({
    request: adminRequest('/api/disclosures/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rceptNo: '20260830000001' })
    }),
    env: envFor(db)
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.filing.ai.result.headline, 'new headline');
  assert.equal(db.row("SELECT request_count FROM disclosure_usage_daily WHERE kind = 'llm:total'").request_count, 1);
  db.close();
});

test('simultaneous manual analyze clicks claim one filing only once', async () => {
  const db = await seededDb([item('20260830000001')]);
  let releaseFetch;
  let notifyStarted;
  let calls = 0;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const released = new Promise(resolve => { releaseFetch = resolve; });
  globalThis.fetch = async () => {
    calls += 1;
    notifyStarted();
    await released;
    return geminiResponse();
  };
  const request = () => adminRequest('/api/disclosures/analyze', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rceptNo: '20260830000001' })
  });
  const firstPromise = analyzePost({ request: request(), env: envFor(db) });
  await started;
  const second = await analyzePost({ request: request(), env: envFor(db) });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error, 'ANALYSIS_IN_PROGRESS');
  releaseFetch();
  assert.equal((await firstPromise).status, 200);
  assert.equal(calls, 1);
  db.close();
});

test('latest API supports search and priority filtering while returning true stored totals', async () => {
  const db = await seededDb([
    item('20260830000001', { corp_name: '알파전자' }),
    item('20260830000002', { corp_name: '베타소프트', report_nm: '분기보고서 (2026.06)' })
  ]);
  const response = await latestGet({
    request: adminRequest('/api/disclosures/latest?q=알파&priority=high&limit=20'),
    env: envFor(db)
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.filings.length, 1);
  assert.equal(payload.filings[0].corpName, '알파전자');
  assert.equal(payload.stats.stored, 2);
  db.close();
});

test('unauthorized disclosure APIs fail before D1 or provider access', async () => {
  const requests = [
    syncPost({ request: new Request('https://preview.example/api/disclosures/sync', { method: 'POST', body: '{}' }), env: {} }),
    latestGet({ request: new Request('https://preview.example/api/disclosures/latest'), env: {} }),
    analyzePost({ request: new Request('https://preview.example/api/disclosures/analyze', { method: 'POST', body: '{}' }), env: {} })
  ];
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map(response => response.status), [401, 401, 401]);
});

test('D1 initialization failure is sanitized and does not call OpenDART', async () => {
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; return new Response('{}'); };
  const brokenDb = {
    prepare() { return { bind() { return this; }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }; },
    async batch() { throw new Error('database disk image is malformed'); }
  };
  const response = await syncPost({
    request: adminRequest('/api/disclosures/sync', { method: 'POST', body: '{}' }),
    env: envFor(brokenDb)
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'DB_INIT_FAILED');
  assert.equal(providerCalls, 0);
});

test('secret values never appear in admin source or authenticated API responses', async () => {
  const db = await seededDb();
  const response = await latestGet({ request: adminRequest('/api/disclosures/latest'), env: envFor(db) });
  const body = await response.text();
  for (const secret of [ADMIN_KEY, OPENDART_KEY, GEMINI_KEY]) assert.equal(body.includes(secret), false);
  const staticSource = await Promise.all([
    readFile(new URL('../admin/disclosures/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/disclosures/_source.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/disclosures/_llm.js', import.meta.url), 'utf8')
  ]).then(parts => parts.join('\n'));
  for (const secret of [ADMIN_KEY, OPENDART_KEY, GEMINI_KEY]) assert.equal(staticSource.includes(secret), false);
  assert.doesNotMatch(staticSource, /AIza[0-9A-Za-z_-]{20,}/);
  db.close();
});

test('all five admin pages expose the same disclosure navigation destination', async () => {
  const pages = [
    ['../admin/index.html', 'href="./disclosures/"'],
    ['../admin/manage/index.html', 'href="../disclosures/"'],
    ['../admin/analytics/index.html', 'href="../disclosures/"'],
    ['../admin/market/index.html', 'href="../disclosures/"'],
    ['../admin/disclosures/index.html', 'href="./" aria-current="page">공시 모니터']
  ];
  for (const [path, expected] of pages) {
    const html = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.ok(html.includes(expected), `${path} must include disclosure nav parity`);
  }
});

test('disclosure admin remains responsive at desktop, 430px, and 360px widths', async () => {
  const html = await readFile(new URL('../admin/disclosures/index.html', import.meta.url), 'utf8');
  assert.match(html, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /@media\(max-width:800px\)/);
  assert.match(html, /@media\(max-width:430px\)/);
  assert.match(html, /grid-template-columns:1fr 1fr/);
  assert.match(html, /viewport-fit=cover/);
});
