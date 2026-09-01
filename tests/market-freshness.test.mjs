import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expectedLatestKrxTradingDate,
  isTradingDate,
  previousTradingDate,
  validateProductionFreshness,
  validateSourceFreshness
} from '../functions/api/market/_freshness.js';
import { MarketFreshnessError, checkProductionMarketFreshness } from '../scripts/check-market-freshness.mjs';

function snapshot(marketDate, usSourceDate) {
  const item = sourceDate => ({ source_date: sourceDate, data_state: 'final_close' });
  return {
    meta: { market_date: marketDate },
    indices: {
      KOSPI: item(marketDate),
      KOSDAQ: item(marketDate),
      NASDAQ: item(usSourceDate),
      DOW: item(usSourceDate),
      SP500: item(usSourceDate)
    },
    rates_fx_volatility: {
      SOX: item(usSourceDate),
      VIX: item(usSourceDate),
      US10Y: item(usSourceDate),
      USDKRW: item(marketDate),
      JPYKRW: item(marketDate),
      DXY: item(marketDate)
    },
    commodities_crypto: {
      WTI: item(marketDate),
      GOLD: item(marketDate),
      BITCOIN: item(marketDate)
    }
  };
}

test('KRX freshness uses today only after the close grace period', () => {
  assert.equal(
    expectedLatestKrxTradingDate(new Date('2026-09-01T07:29:00Z')),
    '2026-08-31'
  );
  assert.equal(
    expectedLatestKrxTradingDate(new Date('2026-09-01T07:30:00Z')),
    '2026-09-01'
  );
});

test('KRX special session (CSAT day 2026-11-19) applies 1-hour grace after delayed 16:30 close', () => {
  // Before 17:30 KST on CSAT day, freshness expects previous trading date
  assert.equal(
    expectedLatestKrxTradingDate(new Date('2026-11-19T07:05:00Z')), // 16:05 KST (during session)
    '2026-11-18'
  );
  assert.equal(
    expectedLatestKrxTradingDate(new Date('2026-11-19T08:29:00Z')), // 17:29 KST
    '2026-11-18'
  );
  // At 17:30 KST (1h grace after 16:30 close), freshness expects today (2026-11-19)
  assert.equal(
    expectedLatestKrxTradingDate(new Date('2026-11-19T08:30:00Z')), // 17:30 KST
    '2026-11-19'
  );
});

test('KRX public holiday does not create a false stale alert', () => {
  assert.equal(isTradingDate('2026-05-25', 'KRX'), false);
  assert.equal(
    expectedLatestKrxTradingDate(new Date('2026-05-25T08:00:00Z')),
    '2026-05-22'
  );
});

test('NYSE holiday resolves the latest completed US session without a false positive', () => {
  assert.equal(isTradingDate('2026-09-07', 'NYSE'), false);
  assert.equal(previousTradingDate('2026-09-08', 'NYSE'), '2026-09-04');
  assert.deepEqual(validateSourceFreshness(snapshot('2026-09-08', '2026-09-04')), {
    passed: true,
    errors: []
  });
});

test('normal multi-market dates pass with KRX today and US previous session', () => {
  assert.deepEqual(validateSourceFreshness(snapshot('2026-09-01', '2026-08-31')), {
    passed: true,
    errors: []
  });
});

test('2026-08-31 snapshot rejects the observed stale 2026-08-27 US source regression', () => {
  const result = validateSourceFreshness(snapshot('2026-08-31', '2026-08-27'));
  assert.equal(result.passed, false);
  assert.ok(result.errors.some(error => /NASDAQ.*expected 2026-08-28.*2026-08-27/.test(error)));
  assert.ok(result.errors.some(error => /US10Y.*expected 2026-08-28.*2026-08-27/.test(error)));
});

test('stale FX, commodity and crypto source dates fail independently', () => {
  const payload = snapshot('2026-09-01', '2026-08-31');
  payload.rates_fx_volatility.USDKRW.source_date = '2026-08-31';
  payload.commodities_crypto.WTI.source_date = '2026-08-31';
  payload.commodities_crypto.BITCOIN.source_date = '2026-08-31';
  const result = validateSourceFreshness(payload);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some(error => /USDKRW/.test(error)));
  assert.ok(result.errors.some(error => /WTI/.test(error)));
  assert.ok(result.errors.some(error => /BITCOIN/.test(error)));
});

test('Production health passes current and fails stale snapshots', () => {
  const now = new Date('2026-09-01T08:00:00Z');
  assert.equal(validateProductionFreshness(snapshot('2026-09-01', '2026-08-31'), now).passed, true);
  const stale = validateProductionFreshness(snapshot('2026-08-31', '2026-08-28'), now);
  assert.equal(stale.passed, false);
  assert.equal(stale.expected, '2026-09-01');
  assert.equal(stale.actual, '2026-08-31');
});

test('scheduled health checker distinguishes current, stale, server, network and timeout states', async () => {
  const now = new Date('2026-09-01T08:00:00Z');
  const current = snapshot('2026-09-01', '2026-08-31');
  const result = await checkProductionMarketFreshness({
    now,
    fetchImpl: async () => Response.json(current)
  });
  assert.equal(result.market_date, '2026-09-01');

  const stale = snapshot('2026-08-31', '2026-08-28');
  await assert.rejects(
    checkProductionMarketFreshness({ now, fetchImpl: async () => Response.json(stale) }),
    error => error instanceof MarketFreshnessError && error.kind === 'stale'
  );
  await assert.rejects(
    checkProductionMarketFreshness({ now, fetchImpl: async () => new Response('{}', { status: 500 }) }),
    error => error instanceof MarketFreshnessError && error.kind === 'server'
  );
  await assert.rejects(
    checkProductionMarketFreshness({ now, fetchImpl: async () => { throw new TypeError('offline'); } }),
    error => error instanceof MarketFreshnessError && error.kind === 'network'
  );
  const timeout = new Error('slow');
  timeout.name = 'TimeoutError';
  await assert.rejects(
    checkProductionMarketFreshness({ now, fetchImpl: async () => { throw timeout; } }),
    error => error instanceof MarketFreshnessError && error.kind === 'timeout'
  );
});
