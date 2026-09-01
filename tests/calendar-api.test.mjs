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
  assert.equal(data.days.length, 30);
  assert.ok(Array.isArray(data.upcoming));
  assert.ok(data.upcoming.length > 0);
});

test('GET /api/calendar: specific year and month query returns matching month', async () => {
  const request = new Request('https://snowshagal.com/api/calendar?year=2026&month=5');
  const response = await onRequestGet({ request, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.year, 2026);
  assert.equal(data.month, 5);
  assert.equal(data.days.length, 31);

  // May 1 is Labor Day in KRX
  const may1 = data.days.find(d => d.date === '2026-05-01');
  assert.ok(may1);
  assert.equal(may1.krx.holiday, true);
  assert.equal(may1.nyse.holiday, false);
});

test('GET /api/calendar: unsupported year 2027 returns fail-closed state', async () => {
  const request = new Request('https://snowshagal.com/api/calendar?year=2027&month=1');
  const response = await onRequestGet({ request, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(response.status, 200);

  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.supported, false);
  assert.equal(data.year, 2027);
  assert.match(data.message, /2027 calendar deferred — official schedule incomplete/);
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
