// Shared fixtures for the /disclosures/ and /calendar/ initial-HTML tests.
//
// A real in-memory SQLite database stands in for D1 so the API handlers and
// the server-rendered pages run the exact SQL they run in production. The
// seed deliberately includes what a renderer can get wrong: a correction, an
// AI analysis, a superseded and an unpublished filing, an empty date, more
// than five filings on one date, and names that would break raw HTML.
import { DatabaseSync } from 'node:sqlite';

import {
  FILINGS_TABLE,
  ensureDisclosureSchema,
  normalizeFiling,
  upsertFiling
} from '../../functions/api/disclosures/_shared.js';
import { ensureCalendarEventSchema, upsertEvent } from '../../functions/_calendar-events.js';

class SqliteStatement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async first() { return this.database.prepare(this.sql).get(...this.values) || null; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

export class SqliteD1 {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new SqliteStatement(this.database, sql); }
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
  exec(sql) { return this.database.exec(sql); }
  close() { this.database.close(); }
}

export const SEED_NOW = new Date('2026-09-16T09:00:00.000Z');
export const HOSTILE_CORP = '<img src=x onerror=alert(1)>&Co"';
export const HOSTILE_REPORT = '주요사항보고서(<script>alert("x")</script>)';
export const HOSTILE_EVENT_TITLE = '<b>FOMC</b> & "Rate" Decision';

function filing(number, overrides = {}) {
  return {
    rcept_no: number,
    corp_cls: 'Y',
    corp_name: '테스트기업',
    corp_code: '00123456',
    stock_code: '005930',
    report_nm: '유상증자결정',
    flr_nm: '테스트기업',
    rcept_dt: '20260916',
    rm: '',
    ...overrides
  };
}

const ANALYSIS = {
  summary: '자사주 취득 완료로 주주환원 이행이 확인됐습니다.',
  what_it_means: '유통 주식 수 감소',
  watch_points: ['소각 여부 원문 확인'],
  impact: 'positive',
  importance: 'high',
  limitation: 'DART 공시 메타데이터 기반 해설입니다.'
};

export async function seedDisclosures(db) {
  await ensureDisclosureSchema({ COMMENTS_DB: db });
  const rows = [
    filing('20260916000001', { corp_name: '셀트리온', stock_code: '068270', report_nm: '자기주식취득결과보고서' }),
    filing('20260916000002', { corp_name: '삼성전자', stock_code: '005930', report_nm: '[기재정정]단일판매ㆍ공급계약체결' }),
    filing('20260916000003', { corp_name: HOSTILE_CORP, stock_code: '000001', report_nm: HOSTILE_REPORT }),
    filing('20260916000004', { corp_name: 'SK하이닉스', stock_code: '000660', report_nm: '현금ㆍ현물배당결정' }),
    filing('20260916000005', { corp_name: 'NAVER', stock_code: '035420', report_nm: '타법인주식및출자증권취득결정' }),
    filing('20260916000006', { corp_name: '카카오', stock_code: '035720', report_nm: '유상증자결정' }),
    filing('20260916000007', { corp_name: '기아', stock_code: '000270', report_nm: '자기주식처분결정' }),
    // Superseded and unpublished filings on the same date must not appear.
    filing('20260916000008', { corp_name: '대체된공시', stock_code: '111111', report_nm: '유상증자결정' }),
    filing('20260916000009', { corp_name: '비공개공시', stock_code: '222222', report_nm: '유상증자결정' }),
    filing('20260915000001', { corp_name: '현대차', stock_code: '005380', report_nm: '기업설명회(IR)개최', rcept_dt: '20260915' }),
    filing('20260915000002', { corp_name: 'KB금융', stock_code: '105560', report_nm: '주식소각결정', rcept_dt: '20260915' })
  ];
  for (const row of rows) await upsertFiling(db, normalizeFiling(row, SEED_NOW));
  db.exec(`UPDATE ${FILINGS_TABLE} SET publish_status = 'auto' WHERE rcept_no NOT IN ('20260916000009')`);
  db.exec(`UPDATE ${FILINGS_TABLE} SET superseded_by = '20260916000002' WHERE rcept_no = '20260916000008'`);
  db.database.prepare(`UPDATE ${FILINGS_TABLE} SET ai_status = 'done', ai_json = ? WHERE rcept_no = '20260916000001'`)
    .run(JSON.stringify(ANALYSIS));
  // A 2026-09-14 filing that is published but superseded: the date exists in
  // the table yet has nothing to show.
  await upsertFiling(db, normalizeFiling(filing('20260914000001', { rcept_dt: '20260914' }), SEED_NOW));
  db.exec(`UPDATE ${FILINGS_TABLE} SET publish_status = 'auto', superseded_by = 'x' WHERE rcept_no = '20260914000001'`);
  return db;
}

export async function seedCalendarEvents(db) {
  await ensureDisclosureSchema({ COMMENTS_DB: db });
  await ensureCalendarEventSchema({ COMMENTS_DB: db });
  db.exec(`UPDATE disclosure_watchlist SET calendar_enabled = 1, corp_name_en = 'Samsung Electronics' WHERE stock_code = '005930'`);
  const events = [
    {
      eventDate: '2026-09-16', eventTime: '14:00', timezone: 'America/New_York', market: 'US',
      category: 'monetary_policy', importance: 'high', titleKo: 'FOMC 금리결정', titleEn: HOSTILE_EVENT_TITLE,
      sourceType: 'official', sourceName: 'federal-reserve', sourceUrl: 'https://www.federalreserve.gov/',
      sourceEventId: 'fomc:2026-09-16'
    },
    {
      eventDate: '2026-09-10', eventTime: null, timezone: 'Asia/Seoul', market: 'KR',
      category: 'derivatives_expiry', importance: 'normal', titleKo: 'KOSPI200 옵션 만기', titleEn: 'KOSPI 200 Options Expiration',
      sourceType: 'rule', sourceName: 'krx-expiry-rule', sourceUrl: 'https://global.krx.co.kr/',
      sourceEventId: 'krx-monthly:2026-09'
    },
    {
      eventDate: '2026-09-10', eventTime: '08:30', timezone: 'America/New_York', market: 'US',
      category: 'inflation', importance: 'high', titleKo: '미국 CPI', titleEn: 'US CPI',
      sourceType: 'official', sourceName: 'bls', sourceUrl: 'https://www.bls.gov/', sourceEventId: 'cpi:2026-09'
    },
    {
      eventDate: '2026-09-10', eventTime: '16:00', timezone: 'Asia/Seoul', market: 'KR',
      category: 'earnings', importance: 'normal', titleKo: '실적 발표', titleEn: 'Earnings Release',
      sourceType: 'opendart', sourceName: 'opendart', sourceUrl: 'https://dart.fss.or.kr/', sourceEventId: 'ir:005930:2026-09-10',
      companyStockCode: '005930', companyName: '삼성전자'
    },
    {
      eventDate: '2026-10-07', eventTime: null, timezone: 'Asia/Seoul', market: 'KR',
      category: 'derivatives_expiry', importance: 'normal', titleKo: '10월 옵션 만기', titleEn: 'October Options Expiration',
      sourceType: 'rule', sourceName: 'krx-expiry-rule', sourceUrl: 'https://global.krx.co.kr/', sourceEventId: 'krx-monthly:2026-10'
    }
  ];
  for (const event of events) await upsertEvent(db, event, SEED_NOW);
  return db;
}

export async function seededDatabase() {
  const db = new SqliteD1();
  await seedDisclosures(db);
  await seedCalendarEvents(db);
  return db;
}
