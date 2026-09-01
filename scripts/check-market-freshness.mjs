#!/usr/bin/env node
import { validateProductionFreshness, validateSourceFreshness } from '../functions/api/market/_freshness.js';

const PRODUCTION_URL = 'https://snowshagal.com/api/market/latest';

export class MarketFreshnessError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'MarketFreshnessError';
    this.kind = kind;
  }
}

export async function checkProductionMarketFreshness({
  fetchImpl = fetch,
  now = new Date(),
  url = PRODUCTION_URL,
  timeoutMs = 15_000
} = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Snowshagal-Market-Freshness-Alert/1.0'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new MarketFreshnessError(
      timeout ? 'timeout' : 'network',
      `${timeout ? 'Production MARKET request timed out' : 'Production MARKET network failure'}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    throw new MarketFreshnessError(
      response.status >= 500 ? 'server' : 'http',
      `Production MARKET API returned HTTP ${response.status}`
    );
  }
  let payload;
  try { payload = await response.json(); }
  catch (error) {
    throw new MarketFreshnessError('validation', `Production MARKET response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sources = validateSourceFreshness(payload);
  if (!sources.passed) {
    throw new MarketFreshnessError('validation', `Production MARKET source freshness failed: ${sources.errors.join(' | ')}`);
  }
  const production = validateProductionFreshness(payload, now);
  if (!production.passed) throw new MarketFreshnessError('stale', production.message);
  return {
    market_date: production.actual,
    expected_market_date: production.expected,
    source_freshness: 'passed'
  };
}

async function main() {
  try {
    const result = await checkProductionMarketFreshness();
    console.log(`PASS Production MARKET freshness: expected=${result.expected_market_date} actual=${result.market_date} sources=${result.source_freshness}`);
  } catch (error) {
    const kind = error instanceof MarketFreshnessError ? error.kind : 'unknown';
    console.error(`FAIL Production MARKET freshness [${kind}]: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-market-freshness.mjs')) {
  await main();
}
