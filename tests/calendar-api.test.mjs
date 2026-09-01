import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequestGet } from '../functions/api/calendar.js';

test('GET /api/calendar: default request returns current KST month trading calendar', async () => {
  const request = new Request('https://snowshagal.com/api/calendar');
  const now = new Date('2026-09-01T07:00:00Z'); // 16:00 KST on Sep 1, 2026
  const response = await onRequestGet({ request, now });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.match(response.headers.get('cache-control'), /public/);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.supported, true);
  assert.equal(data.year, 2026);
  assert.equal(data.month, 9);
  assert.equal(data.serverDate, '2026-09-01');
  assert.equal(data.marketSupport.krx, true);
  assert.equal(data.marketSupport.nyse, true);
  assert.equal(data.days.length, 30);
  assert.ok(Array.isArray(data.upcoming));
  assert.ok(data.upcoming.length > 0);
});

test('GET /api/calendar: 2026-10 and 2026-12 queries return matching months', async () => {
  // Test 2026-10
  const reqOct = new Request('https://snowshagal.com/api/calendar?year=2026&month=10');
  const resOct = await onRequestGet({ request: reqOct, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(resOct.status, 200);
  const dataOct = await resOct.json();
  assert.equal(dataOct.ok, true);
  assert.equal(dataOct.year, 2026);
  assert.equal(dataOct.month, 10);
  assert.equal(dataOct.days.length, 31);
  // Oct 9 is Hangul Day in KRX
  const oct9 = dataOct.days.find(d => d.date === '2026-10-09');
  assert.ok(oct9);
  assert.equal(oct9.krx.holiday, true);

  // Test 2026-12
  const reqDec = new Request('https://snowshagal.com/api/calendar?year=2026&month=12');
  const resDec = await onRequestGet({ request: reqDec, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(resDec.status, 200);
  const dataDec = await resDec.json();
  assert.equal(dataDec.ok, true);
  assert.equal(dataDec.year, 2026);
  assert.equal(dataDec.month, 12);
  assert.equal(dataDec.days.length, 31);
});

test('GET /api/calendar: 2027 partial market support (NYSE supported, KRX pending)', async () => {
  const request = new Request('https://snowshagal.com/api/calendar?year=2027&month=1');
  const response = await onRequestGet({ request, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.supported, true);
  assert.equal(data.year, 2027);
  assert.equal(data.month, 1);
  assert.equal(data.marketSupport.krx, false);
  assert.equal(data.marketSupport.nyse, true);
  assert.ok(data.krxPendingMessage);
  assert.equal(data.days.length, 31);

  // Check 2027-01-01: NYSE New Year holiday, KRX pending
  const jan1 = data.days.find(d => d.date === '2027-01-01');
  assert.ok(jan1);
  assert.equal(jan1.nyse.supported, true);
  assert.equal(jan1.nyse.holiday, true);
  assert.equal(jan1.krx.supported, false);
});

test('GET /api/calendar: unsupported year 2028 returns fail-closed state', async () => {
  const request = new Request('https://snowshagal.com/api/calendar?year=2028&month=1');
  const response = await onRequestGet({ request, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.supported, false);
  assert.equal(data.year, 2028);
  assert.match(data.message, /2028 calendar deferred — official schedule incomplete/);
  assert.deepEqual(data.days, []);
});

test('GET /api/calendar: invalid query parameters return 400', async () => {
  const request = new Request('https://snowshagal.com/api/calendar?year=invalid&month=13');
  const response = await onRequestGet({ request, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(response.status, 400);

  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, 'INVALID_QUERY');
});
