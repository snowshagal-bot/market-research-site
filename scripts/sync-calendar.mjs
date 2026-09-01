#!/usr/bin/env node
/**
 * Triggers the daily market-calendar sync on production.
 *
 * Deliberately the same shape and the same key as the OpenDART sync script:
 * one operator pattern rather than two, and no new secret for a set of
 * sources that need no authentication of their own.
 */

const DEFAULT_ORIGIN = 'https://snowshagal.com';
const DEFAULT_TIMEOUT_MS = 120_000;

export class CalendarSyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'CalendarSyncError';
    this.kind = kind;
  }
}

export async function syncCalendar({
  fetchImpl = fetch,
  origin = process.env.PUBLIC_ORIGIN || DEFAULT_ORIGIN,
  key = process.env.DISCLOSURE_SYNC_KEY || '',
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) {
    throw new CalendarSyncError('configuration', 'DISCLOSURE_SYNC_KEY is not configured');
  }

  const endpoint = `${origin.replace(/\/+$/, '')}/api/calendar/sync`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-disclosure-sync-key': trimmedKey,
        'user-agent': 'Snowshagal-Disclosure-Daily-Sync/1.0'
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new CalendarSyncError(
      timeout ? 'timeout' : 'network',
      `${timeout ? 'calendar sync request timed out' : 'calendar sync network failure'}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new CalendarSyncError('auth', `calendar sync authentication failed (HTTP ${response.status})`);
  }

  // 502 is how the endpoint reports that some sources failed, and its body
  // still lists what every source did. That detail is the point of the run,
  // so it is read rather than thrown away.
  if (!response.ok && response.status !== 502) {
    let errorDetail = '';
    try {
      const errBody = await response.json();
      errorDetail = errBody?.message || errBody?.error || '';
    } catch (_) {
      // response is not JSON
    }
    throw new CalendarSyncError(
      response.status >= 500 ? 'server' : 'http',
      `calendar sync API returned HTTP ${response.status}${errorDetail ? `: ${errorDetail}` : ''}`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new CalendarSyncError('validation', `calendar sync response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!payload) {
    throw new CalendarSyncError('validation', 'calendar sync returned no payload');
  }

  return {
    ok: payload.ok === true,
    years: Array.isArray(payload.years) ? payload.years : [],
    failed: Array.isArray(payload.failed) ? payload.failed : [],
    results: Array.isArray(payload.results) ? payload.results : []
  };
}

function parseCliArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--origin' && args[i + 1]) {
      options.origin = args[++i];
    } else if (args[i] === '--key' && args[i + 1]) {
      options.key = args[++i];
    } else if (args[i] === '--timeout' && args[i + 1]) {
      options.timeoutMs = Number(args[++i]) || DEFAULT_TIMEOUT_MS;
    }
  }
  return options;
}

/**
 * One line per source, because that is what an operator reads first. A year
 * a source has not published yet is reported as pending rather than counted
 * as a failure — the run only fails when a source that should have answered
 * did not.
 */
function describe(result) {
  if (result.status === 'error') return `${result.sourceName}: ERROR ${result.error}`;
  if (result.status === 'pending') return `${result.sourceName}: pending (not published yet)`;
  const parts = [`events=${result.events}`];
  if (result.created) parts.push(`created=${result.created}`);
  if (result.changed) parts.push(`changed=${result.changed}`);
  if (result.cancelled) parts.push(`cancelled=${result.cancelled}`);
  if (result.timesUnconfirmed) parts.push(`timesUnconfirmed=${result.timesUnconfirmed}`);
  return `${result.sourceName}: ${parts.join(' ')}`;
}

async function main() {
  try {
    const cliOptions = parseCliArgs(process.argv.slice(2));
    const result = await syncCalendar(cliOptions);
    for (const entry of result.results || []) console.log(`  ${describe(entry)}`);
    if (!result.ok) {
      throw new CalendarSyncError('source', `sources failed: ${(result.failed || []).join(', ')}`);
    }
    console.log(`PASS market calendar sync: years=${(result.years || []).join(',')} sources=${(result.results || []).length}`);
  } catch (error) {
    const kind = error instanceof CalendarSyncError ? error.kind : 'unknown';
    console.error(`FAIL market calendar sync [${kind}]: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sync-calendar.mjs')) {
  await main();
}
