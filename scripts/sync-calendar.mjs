#!/usr/bin/env node
/**
 * Triggers the daily market-calendar sync on production.
 *
 * Deliberately the same shape and the same key as the OpenDART sync script:
 * one operator pattern rather than two, and no new secret for a set of
 * sources that need no authentication of their own.
 *
 * A failed run always names what failed. When the answer does not say which
 * source broke, the failure is reported as `internal` at the `orchestration`
 * stage together with the HTTP status and the shape of the answer — never as
 * an empty list.
 */

import { writeFile } from 'node:fs/promises';

const DEFAULT_ORIGIN = 'https://snowshagal.com';
const DEFAULT_TIMEOUT_MS = 120_000;

export const FAILURE_STAGES = Object.freeze(['fetch', 'parse', 'normalize', 'validate', 'publish', 'orchestration']);
export const INTERNAL_SOURCE = 'internal';

export class CalendarSyncError extends Error {
  constructor(kind, message, httpStatus = null) {
    super(message);
    this.name = 'CalendarSyncError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

const shortError = value => String(value?.message || value || '').replace(/\s+/g, ' ').trim().slice(0, 300);

function internalFailure(error, httpStatus = null) {
  return {
    source: INTERNAL_SOURCE,
    stage: 'orchestration',
    error: shortError(error) || 'unknown error',
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    attempt: 1
  };
}

function sanitizeFailure(entry) {
  const httpStatus = Number(entry?.httpStatus);
  const attempt = Number(entry?.attempt);
  return {
    source: shortError(entry?.source || entry?.sourceName) || INTERNAL_SOURCE,
    stage: FAILURE_STAGES.includes(entry?.stage) ? entry.stage : 'orchestration',
    error: shortError(entry?.error) || 'unknown error',
    httpStatus: Number.isInteger(httpStatus) && httpStatus > 0 ? httpStatus : null,
    attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1
  };
}

/**
 * Every failure the answer carries, each with a source and a stage.
 *
 * Preference order: the endpoint's own `failures`; then errored `results`
 * (older deployments sent only those, without a stage); then, if the answer
 * says the run failed without naming anything, one `internal` failure that
 * records the HTTP status and what the answer did contain.
 */
export function collectFailures(payload, { httpStatus = null } = {}) {
  const results = Array.isArray(payload?.results) ? payload.results : [];

  if (Array.isArray(payload?.failures) && payload.failures.length) {
    return payload.failures.map(sanitizeFailure);
  }

  const errored = results.filter(result => result?.status === 'error');
  if (errored.length) {
    return errored.map(result => {
      const status = /^HTTP (\d{3})\b/.exec(String(result.error || ''));
      return sanitizeFailure({
        source: result.sourceName,
        // Older answers had no stage; an HTTP line can only have come from the fetch.
        stage: result.stage || (status || /network/i.test(String(result.error)) ? 'fetch' : 'orchestration'),
        error: result.error,
        httpStatus: result.httpStatus ?? (status ? Number(status[1]) : null),
        attempt: result.attempt
      });
    });
  }

  if (payload?.ok === true) return [];

  const keys = payload && typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload) : [];
  const detail = [
    `ok=${JSON.stringify(payload?.ok ?? null)}`,
    `keys=[${keys.join(',')}]`,
    payload?.error ? `error=${shortError(payload.error)}` : '',
    payload?.message ? `message=${shortError(payload.message)}` : ''
  ].filter(Boolean).join(' ');
  return [internalFailure(`sync answered without naming a failed source (HTTP ${httpStatus ?? 'n/a'}; ${detail})`, httpStatus)];
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
    throw new CalendarSyncError('auth', `calendar sync authentication failed (HTTP ${response.status})`, response.status);
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
      `calendar sync API returned HTTP ${response.status}${errorDetail ? `: ${errorDetail}` : ''}`,
      response.status
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new CalendarSyncError('validation', `calendar sync response is not valid JSON (HTTP ${response.status}): ${error instanceof Error ? error.message : String(error)}`, response.status);
  }

  if (!payload) {
    throw new CalendarSyncError('validation', `calendar sync returned no payload (HTTP ${response.status})`, response.status);
  }

  const failures = collectFailures(payload, { httpStatus: response.status });
  return {
    ok: payload.ok === true && failures.length === 0,
    httpStatus: response.status,
    years: Array.isArray(payload.years) ? payload.years : [],
    failed: failures.map(failure => failure.source),
    failures,
    results: Array.isArray(payload.results) ? payload.results : []
  };
}

const kstStamp = now => new Date(now.getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

/**
 * The failure report written to the log and to the alert issue.
 *
 * It always names at least one source: an empty list is itself reported as an
 * `internal` / `orchestration` failure rather than printed as nothing.
 */
export function formatFailureReport(failures, { now = new Date() } = {}) {
  const list = (Array.isArray(failures) ? failures : []).map(sanitizeFailure);
  if (!list.length) list.push(internalFailure('sync reported a failure without naming any source'));
  const timestamp = `${now.toISOString()} (${kstStamp(now)} KST)`;

  const lines = ['Calendar sync failed', '', 'Failed sources:'];
  for (const failure of list) {
    lines.push(`- ${failure.source}: ${failure.stage} — ${failure.httpStatus ? `HTTP ${failure.httpStatus}` : failure.error}`);
  }
  for (const failure of list) {
    lines.push(
      '',
      `source: ${failure.source}`,
      `stage: ${failure.stage}`,
      `error: ${failure.error}`,
      `http_status: ${failure.httpStatus ?? 'n/a'}`,
      `attempt: ${failure.attempt}`,
      `timestamp: ${timestamp}`
    );
  }
  return lines.join('\n');
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
export function describe(result) {
  if (result.status === 'error') {
    const where = [result.stage, result.httpStatus ? `HTTP ${result.httpStatus}` : ''].filter(Boolean).join(' ');
    return `${result.sourceName || INTERNAL_SOURCE}: ERROR${where ? ` [${where}]` : ''} ${result.error}`;
  }
  if (result.status === 'pending') return `${result.sourceName}: pending (not published yet)`;
  const parts = [`events=${result.events}`];
  if (result.created) parts.push(`created=${result.created}`);
  if (result.changed) parts.push(`changed=${result.changed}`);
  if (result.cancelled) parts.push(`cancelled=${result.cancelled}`);
  if (result.timesUnconfirmed) parts.push(`timesUnconfirmed=${result.timesUnconfirmed}`);
  return `${result.sourceName}: ${parts.join(' ')}`;
}

/** The command line, with its side effects injectable for tests. Returns the exit code. */
export async function runCli({
  args = [],
  env = process.env,
  syncImpl = syncCalendar,
  now = () => new Date(),
  log = console.log,
  logError = console.error,
  writeReport = (path, text) => writeFile(path, text, 'utf8')
} = {}) {
  let failures = [];
  try {
    const result = await syncImpl(parseCliArgs(args));
    for (const entry of result.results || []) log(`  ${describe(entry)}`);
    if (!result.ok) {
      failures = result.failures?.length ? result.failures : [internalFailure('sync reported a failure without naming any source', result.httpStatus)];
    } else {
      log(`PASS market calendar sync: years=${(result.years || []).join(',')} sources=${(result.results || []).length}`);
      return 0;
    }
  } catch (error) {
    const kind = error instanceof CalendarSyncError ? error.kind : 'unknown';
    failures = [internalFailure(`[${kind}] ${shortError(error)}`, error?.httpStatus ?? null)];
  }

  const report = formatFailureReport(failures, { now: now() });
  logError(`FAIL market calendar sync\n${report}`);
  if (env.CALENDAR_SYNC_REPORT) {
    try {
      await writeReport(env.CALENDAR_SYNC_REPORT, `${report}\n`);
    } catch (error) {
      logError(`calendar sync report could not be written: ${shortError(error)}`);
    }
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sync-calendar.mjs')) {
  process.exitCode = await runCli({ args: process.argv.slice(2) });
}
