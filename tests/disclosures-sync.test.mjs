import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  FILINGS_TABLE,
  compactDate,
  ensureDisclosureSchema,
  kstDate,
  normalizeFiling,
  stateSnapshot,
  upsertFiling
} from '../functions/api/disclosures/_shared.js';
import { onRequestPost as syncPost } from '../functions/api/disclosures/sync.js';
import { onRequestGet as feedGet } from '../functions/api/disclosures/feed.js';
import { syncDisclosures, DisclosureSyncError } from '../scripts/sync-disclosures.mjs';
import { createMockAuthDb, createAdminSession } from './helpers/auth-test-helper.mjs';

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

  close() {
    this.database.close();
  }
}

const sharedAuthDb = await createMockAuthDb();
const sharedSession = await createAdminSession(sharedAuthDb);

const TEST_SYNC_KEY = 'test-machine-sync-key-12345';
const NOW = new Date('2026-09-01T07:05:00.000Z');

function mockEnv(db, extra = {}) {
  return {
    AUTH_DB: sharedAuthDb,
    COMMENTS_DB: db,
    DISCLOSURE_SYNC_KEY: TEST_SYNC_KEY,
    OPENDART_API_KEY: 'test-opendart-key',
    GEMINI_API_KEY: 'test-gemini-key',
    DISCLOSURE_LLM_PROVIDER: 'none',
    ...extra
  };
}

function sampleFiling(rceptNo, overrides = {}) {
  return {
    rcept_no: rceptNo,
    corp_cls: 'Y',
    corp_name: '테스트전자',
    corp_code: '00123456',
    stock_code: '005930',
    report_nm: '주요사항보고서(유상증자결정)',
    flr_nm: '테스트전자',
    rcept_dt: compactDate(kstDate(NOW)),
    rm: '',
    ...overrides
  };
}

function mockOpendartResponse(filings = [sampleFiling('20260901000001')]) {
  return new Response(JSON.stringify({
    status: '000',
    message: '정상',
    page_no: 1,
    page_count: 10,
    total_count: filings.length,
    total_page: 1,
    list: filings
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

// --------------------------------------------------------------------------
// 1. syncDisclosures CLI script unit tests
// --------------------------------------------------------------------------

test('syncDisclosures: throws configuration error if key is empty', async () => {
  await assert.rejects(
    () => syncDisclosures({ key: '' }),
    (error) => {
      assert.ok(error instanceof DisclosureSyncError);
      assert.equal(error.kind, 'configuration');
      return true;
    }
  );
});

test('syncDisclosures: successfully processes 200 response and extracts counts', async () => {
  const mockFetch = async (url, opts) => {
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers['x-disclosure-sync-key'], TEST_SYNC_KEY);
    return new Response(JSON.stringify({
      ok: true,
      syncedAt: '2026-09-01T07:05:01.000Z',
      source: {
        provider: 'opendart',
        fetched: 5,
        created: 2,
        updated: 3
      },
      ai: {
        completed: 1
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await syncDisclosures({
    fetchImpl: mockFetch,
    origin: 'https://snowshagal.com',
    key: TEST_SYNC_KEY
  });

  assert.equal(result.ok, true);
  assert.equal(result.fetched, 5);
  assert.equal(result.created, 2);
  assert.equal(result.updated, 3);
  assert.equal(result.ai_completed, 1);
  assert.equal(result.syncedAt, '2026-09-01T07:05:01.000Z');
});

test('syncDisclosures: maps HTTP 401 to auth error', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), { status: 401 });
  await assert.rejects(
    () => syncDisclosures({ fetchImpl: mockFetch, key: 'wrong-key' }),
    (error) => {
      assert.ok(error instanceof DisclosureSyncError);
      assert.equal(error.kind, 'auth');
      return true;
    }
  );
});

test('syncDisclosures: maps HTTP 403 to auth error', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ ok: false, error: 'FORBIDDEN' }), { status: 403 });
  await assert.rejects(
    () => syncDisclosures({ fetchImpl: mockFetch, key: 'wrong-key' }),
    (error) => {
      assert.ok(error instanceof DisclosureSyncError);
      assert.equal(error.kind, 'auth');
      return true;
    }
  );
});

test('syncDisclosures: maps HTTP 500 to server error', async () => {
  const mockFetch = async () => new Response(JSON.stringify({ ok: false, error: 'SYNC_FAILED', message: 'DART error' }), { status: 500 });
  await assert.rejects(
    () => syncDisclosures({ fetchImpl: mockFetch, key: TEST_SYNC_KEY }),
    (error) => {
      assert.ok(error instanceof DisclosureSyncError);
      assert.equal(error.kind, 'server');
      assert.match(error.message, /HTTP 500/);
      return true;
    }
  );
});

test('syncDisclosures: maps invalid JSON to validation error', async () => {
  const mockFetch = async () => new Response('not a json', { status: 200, headers: { 'content-type': 'text/plain' } });
  await assert.rejects(
    () => syncDisclosures({ fetchImpl: mockFetch, key: TEST_SYNC_KEY }),
    (error) => {
      assert.ok(error instanceof DisclosureSyncError);
      assert.equal(error.kind, 'validation');
      return true;
    }
  );
});

test('syncDisclosures: maps network failure to network error', async () => {
  const mockFetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(
    () => syncDisclosures({ fetchImpl: mockFetch, key: TEST_SYNC_KEY }),
    (error) => {
      assert.ok(error instanceof DisclosureSyncError);
      assert.equal(error.kind, 'network');
      return true;
    }
  );
});

// --------------------------------------------------------------------------
// 2. Integration with /api/disclosures/sync endpoint & idempotency
// --------------------------------------------------------------------------

test('Integration: machine sync records disclosure-sync-key and updates last_sync_at', async () => {
  const d1 = new SqliteD1();
  const db = { prepare: (sql) => d1.prepare(sql), batch: (s) => d1.batch(s), close: () => d1.close() };
  await ensureDisclosureSchema({ COMMENTS_DB: db });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => mockOpendartResponse([sampleFiling('20260901000001')]);

  try {
    const req = new Request('https://snowshagal.com/api/disclosures/sync', {
      method: 'POST',
      headers: {
        'x-disclosure-sync-key': TEST_SYNC_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const env = mockEnv(db);
    const res = await syncPost({ request: req, env, now: NOW });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.source.created, 1);
    assert.equal(data.source.updated, 0);

    const states = await stateSnapshot(db);
    assert.equal(states.last_sync_auth?.value, 'disclosure-sync-key');
    assert.ok(Boolean(states.last_sync_at?.value));
  } finally {
    globalThis.fetch = originalFetch;
    d1.close();
  }
});

test('Integration: repeated sync on same date is idempotent with 0 duplicate rows', async () => {
  const d1 = new SqliteD1();
  const db = { prepare: (sql) => d1.prepare(sql), batch: (s) => d1.batch(s), close: () => d1.close() };
  await ensureDisclosureSchema({ COMMENTS_DB: db });

  const sampleFilings = [
    sampleFiling('20260901000001', { report_nm: '주요사항보고서(유상증자결정)' }),
    sampleFiling('20260901000002', { report_nm: '대표이사변경' })
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => mockOpendartResponse(sampleFilings);

  try {
    const env = mockEnv(db);

    // First sync (e.g. 15:55 manual admin sync)
    const req1 = new Request('https://admin.snowshagal.com/api/disclosures/sync', {
      method: 'POST',
      headers: {
        ...sharedSession.headers,
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const res1 = await syncPost({ request: req1, env, now: new Date('2026-09-01T06:55:00.000Z') });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.source.created, 2);
    assert.equal(data1.source.updated, 0);
    const states1 = await stateSnapshot(db);
    assert.equal(states1.last_sync_auth?.value, 'admin-session');

    // Second sync (e.g. 16:05 machine sync)
    const req2 = new Request('https://snowshagal.com/api/disclosures/sync', {
      method: 'POST',
      headers: {
        'x-disclosure-sync-key': TEST_SYNC_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });
    const res2 = await syncPost({ request: req2, env, now: new Date('2026-09-01T07:05:00.000Z') });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.source.created, 0); // No new rows created!
    assert.equal(data2.source.updated, 2); // 2 existing rows updated cleanly
    const states2 = await stateSnapshot(db);
    assert.equal(states2.last_sync_auth?.value, 'disclosure-sync-key');

    // Verify row count in D1 table is exactly 2 (no duplicates)
    const countRow = await db.prepare(`SELECT count(*) as count FROM ${FILINGS_TABLE}`).first();
    assert.equal(countRow.count, 2);

    // Verify public feed contains the filings
    const feedRes = await feedGet({ request: new Request('https://snowshagal.com/api/disclosures/feed'), env });
    assert.equal(feedRes.status, 200);
    const feedData = await feedRes.json();
    assert.equal(feedData.ok, true);
    assert.ok(Array.isArray(feedData.items));
  } finally {
    globalThis.fetch = originalFetch;
    d1.close();
  }
});

test('Integration: invalid machine key without admin session returns 401', async () => {
  const d1 = new SqliteD1();
  const db = { prepare: (sql) => d1.prepare(sql), batch: (s) => d1.batch(s), close: () => d1.close() };
  await ensureDisclosureSchema({ COMMENTS_DB: db });

  const req = new Request('https://snowshagal.com/api/disclosures/sync', {
    method: 'POST',
    headers: {
      'x-disclosure-sync-key': 'incorrect-key',
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  });

  const env = mockEnv(db);
  const res = await syncPost({ request: req, env, now: NOW });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'UNAUTHORIZED');
  d1.close();
});
