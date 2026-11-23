import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SqliteD1 } from './helpers/initial-html-fixtures.mjs';
import { ensureMarketTable, TABLE_NAME } from '../functions/api/market/_shared.js';
import { onRequestGet, TREND_CODES, TREND_SESSIONS } from '../functions/api/market/trend.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [EXAMPLE, MIGRATION] = await Promise.all([
  read('contracts/market_close/market_close.example.v1.2.0.json'),
  read('migrations/comments/0003_market_domestic_rates.sql')
]);

// Weekdays from 2026-09-01, one per session.
function sessions(count) {
  const dates = [];
  for (let day = new Date(Date.UTC(2026, 8, 1)); dates.length < count; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() % 6) dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

async function database({ count = 24, migrated = true, statusOf = () => 'final' } = {}) {
  const db = new SqliteD1();
  await ensureMarketTable({ COMMENTS_DB: db });
  if (migrated) db.exec(MIGRATION);
  const base = JSON.parse(EXAMPLE);
  sessions(count).forEach((date, index) => {
    const payload = structuredClone(base);
    payload.meta.market_date = date;
    payload.indices.KOSPI.close = 3000 + index;
    payload.rates_fx_volatility.USDKRW.close = 1300 + index / 10;
    db.database.prepare(`INSERT INTO ${TABLE_NAME} (market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en) VALUES (?, ?, ?, ?, ?, ?, 'test', '', '')`)
      .run(date, payload.meta.schema_version, payload.meta.generated_at, statusOf(date, index), JSON.stringify(payload), `${date}T07:10:00Z`);
    if (migrated && index % 2 === 0) {
      const day = { market_date: date, basis_time: '16:00', retrieved_at: `${date}T07:30:00Z`, source: 'test', items: [{ code: 'KTB3Y', value: 3 + index / 100, previous_value: null, change_bp: null }] };
      db.database.prepare(`INSERT INTO market_domestic_rates (market_date, schema_version, basis_time, retrieved_at, payload_json, published_at, auth_source) VALUES (?, '1.0.0', '16:00', ?, ?, ?, 'test')`)
        .run(date, day.retrieved_at, JSON.stringify(day), `${date}T07:31:00Z`);
    }
  });
  return db;
}

const call = (db, query = '') => onRequestGet({ request: new Request(`https://snowshagal.com/api/market/trend${query}`), env: { COMMENTS_DB: db } });

test('the last 20 final sessions, oldest first, with each close and the KOFIA yields of those dates', async () => {
  const db = await database();
  const response = await call(db);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /s-maxage=300/);
  const body = await response.json();
  const all = sessions(24);
  assert.equal(body.sessions, TREND_SESSIONS);
  assert.deepEqual(body.dates, all.slice(-20));
  assert.equal(body.end_date, all[23]);
  assert.deepEqual(body.series.KOSPI, Array.from({ length: 20 }, (_, i) => 3004 + i));
  assert.equal(body.series.USDKRW[19], 1302.3);
  for (const code of TREND_CODES) assert.equal(body.series[code].length, 20, code);
  // Yields stored for every other session; the rest are null, never carried over.
  assert.deepEqual(body.series.KTB3Y.slice(0, 4), [3.04, null, 3.06, null]);
  assert.deepEqual(body.series.CD91, Array(20).fill(null));
});

test('`end` ends the window; an incomplete row is left out; a bad date is refused', async () => {
  const all = sessions(24);
  const db = await database({ statusOf: date => (date === all[5] ? 'incomplete' : 'final') });
  const body = await (await call(db, `?end=${all[9]}`)).json();
  assert.deepEqual(body.dates, all.slice(0, 10).filter(date => date !== all[5]));
  assert.equal(body.end_date, all[9]);
  const bad = await call(db, '?end=2026-9-1');
  assert.equal(bad.status, 400);
});

test('without the rates migration the closes still answer, with empty yields', async () => {
  const db = await database({ count: 3, migrated: false });
  const originalError = console.error;
  console.error = () => {};
  try {
    const body = await (await call(db)).json();
    assert.equal(body.dates.length, 3);
    assert.deepEqual(body.series.KTB3Y, [null, null, null]);
  } finally {
    console.error = originalError;
  }
});

test('an unchanged window answers 304 to its ETag', async () => {
  const db = await database({ count: 5 });
  const first = await call(db);
  const etag = first.headers.get('etag');
  const second = await onRequestGet({ request: new Request('https://snowshagal.com/api/market/trend', { headers: { 'if-none-match': etag } }), env: { COMMENTS_DB: db } });
  assert.equal(second.status, 304);
});
