#!/usr/bin/env node

const DEFAULT_ORIGIN = 'https://snowshagal.com';
const DEFAULT_TIMEOUT_MS = 120_000;

export class DisclosureSyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'DisclosureSyncError';
    this.kind = kind;
  }
}

export async function syncDisclosures({
  fetchImpl = fetch,
  origin = process.env.PUBLIC_ORIGIN || DEFAULT_ORIGIN,
  key = process.env.DISCLOSURE_SYNC_KEY || '',
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) {
    throw new DisclosureSyncError('configuration', 'DISCLOSURE_SYNC_KEY is not configured');
  }

  const endpoint = `${origin.replace(/\/+$/, '')}/api/disclosures/sync`;
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
    throw new DisclosureSyncError(
      timeout ? 'timeout' : 'network',
      `${timeout ? 'OpenDART sync request timed out' : 'OpenDART sync network failure'}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new DisclosureSyncError('auth', `OpenDART sync authentication failed (HTTP ${response.status})`);
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errBody = await response.json();
      errorDetail = errBody?.message || errBody?.error || '';
    } catch (_) {
      // response is not JSON
    }
    throw new DisclosureSyncError(
      response.status >= 500 ? 'server' : 'http',
      `OpenDART sync API returned HTTP ${response.status}${errorDetail ? `: ${errorDetail}` : ''}`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new DisclosureSyncError('validation', `OpenDART sync response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!payload || payload.ok !== true) {
    throw new DisclosureSyncError('validation', `OpenDART sync failed: ${payload?.message || payload?.error || 'ok !== true'}`);
  }

  return {
    ok: true,
    provider: payload.source?.provider || 'opendart',
    fetched: Number(payload.source?.fetched || 0),
    created: Number(payload.source?.created || 0),
    updated: Number(payload.source?.updated || 0),
    ai_completed: Number(payload.ai?.completed || 0),
    syncedAt: String(payload.syncedAt || '')
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

async function main() {
  try {
    const cliOptions = parseCliArgs(process.argv.slice(2));
    const result = await syncDisclosures(cliOptions);
    console.log(`PASS OpenDART daily sync: fetched=${result.fetched} created=${result.created} updated=${result.updated} ai.completed=${result.ai_completed} syncedAt=${result.syncedAt}`);
  } catch (error) {
    const kind = error instanceof DisclosureSyncError ? error.kind : 'unknown';
    console.error(`FAIL OpenDART daily sync [${kind}]: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sync-disclosures.mjs')) {
  await main();
}
