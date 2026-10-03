#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';

import { previousTradingDate, shiftDate } from '../functions/_trading-calendar.js';
import { DISCLOSURE_SCHEDULE_SLOT_UTC, scheduledSyncDate } from '../functions/api/disclosures/_shared.js';
import { describeErrorResponse, formatDiagnostics } from './sync-calendar.mjs';

const DEFAULT_ORIGIN = 'https://snowshagal.com';
const DEFAULT_TIMEOUT_MS = 120_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const OPENDART_PAGE_ROWS = 100;

// The workflow's cron slot; the server derives the same date for its Date Guard.
export const SCHEDULE_SLOT_UTC = DISCLOSURE_SCHEDULE_SLOT_UTC;

export class DisclosureSyncError extends Error {
  constructor(kind, message, { httpStatus = null, diagnostics = null } = {}) {
    super(message);
    this.name = 'DisclosureSyncError';
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.diagnostics = diagnostics;
  }
}

const isIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const compact = date => date.replace(/-/g, '');
const expand = value => (/^\d{8}$/.test(String(value || '')) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : String(value || ''));
const isWeekend = date => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

export function kstDateString(now = new Date()) {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The KST date a scheduled run is for, however late GitHub starts it. */
export function scheduledTargetDate(now = new Date()) {
  return scheduledSyncDate(now);
}

/**
 * The previous KRX trading day, which every run reads again so that one failed
 * or skipped day comes back with the next run. A year the KRX calendar does not
 * cover yet falls back to the previous weekday instead of failing the sync.
 */
export function catchUpDate(target) {
  try {
    return previousTradingDate(target, 'KRX');
  } catch (_) {
    let candidate = shiftDate(target, -1);
    while (isWeekend(candidate)) candidate = shiftDate(candidate, -1);
    return candidate;
  }
}

/**
 * What one run reads. `date` (a manual backfill) is exactly that day; a scheduled
 * run is its logical date plus the catch-up day; a manual run without a date is
 * KST today plus the catch-up day.
 */
export function resolveSyncWindow({ mode = 'manual', date = '', now = new Date() } = {}) {
  const today = kstDateString(now);
  if (date) {
    if (!isIsoDate(date)) throw new DisclosureSyncError('configuration', `sync date must be YYYY-MM-DD, received ${JSON.stringify(String(date).slice(0, 40))}`);
    if (date > today) throw new DisclosureSyncError('configuration', `sync date ${date} is after KST today (${today})`);
    return { mode: 'date', targetDate: date, beginDate: date, endDate: date };
  }
  const targetDate = mode === 'scheduled' ? scheduledTargetDate(now) : today;
  return { mode: mode === 'scheduled' ? 'scheduled' : 'manual', targetDate, beginDate: catchUpDate(targetDate), endDate: targetDate };
}

/** OpenDART list calls one answer cost: one per page, at least one per class. */
export function pagesRead(classes) {
  return (Array.isArray(classes) ? classes : [])
    .reduce((sum, item) => sum + Math.max(1, Math.ceil(Number(item?.fetchedRows || 0) / OPENDART_PAGE_ROWS)), 0);
}

function describeClasses(classes) {
  return (Array.isArray(classes) ? classes : [])
    .map(item => `${item.corpClass}: ${item.fetchedRows}/${item.reportedTotal} rows, ${Math.max(1, Math.ceil(Number(item.fetchedRows || 0) / OPENDART_PAGE_ROWS))}/${item.totalPage} pages`)
    .join('; ');
}

export async function syncDisclosures({
  fetchImpl = fetch,
  origin = process.env.PUBLIC_ORIGIN || DEFAULT_ORIGIN,
  key = process.env.DISCLOSURE_SYNC_KEY || '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  window = null
} = {}) {
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) {
    throw new DisclosureSyncError('configuration', 'DISCLOSURE_SYNC_KEY is not configured');
  }

  // `scheduled` asks the server to judge "today" by its own schedule slot date
  // (Date Guard); a backfill or manual window keeps KST today.
  const requested = window
    ? { beginDate: compact(window.beginDate), endDate: compact(window.endDate), ...(window.mode === 'scheduled' ? { scheduled: true } : {}) }
    : {};
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
      body: JSON.stringify(requested),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new DisclosureSyncError(
      timeout ? 'timeout' : 'network',
      `${timeout ? 'OpenDART sync request timed out' : 'OpenDART sync network failure'}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Read once: the same text is parsed and, for a failed answer, described.
  let text = '';
  try { text = await response.text(); } catch (_) { text = ''; }
  const failed = !response.ok;
  const diagnostics = failed ? describeErrorResponse(response, text, { secrets: [trimmedKey] }) : null;

  if (response.status === 401 || response.status === 403) {
    throw new DisclosureSyncError('auth', `OpenDART sync authentication failed (HTTP ${response.status})`, { httpStatus: response.status, diagnostics });
  }

  if (failed) {
    let errorDetail = '';
    try {
      const errBody = JSON.parse(text);
      errorDetail = errBody?.message || errBody?.error || '';
    } catch (_) {
      // response is not JSON
    }
    throw new DisclosureSyncError(
      response.status >= 500 ? 'server' : 'http',
      `OpenDART sync API returned HTTP ${response.status}${errorDetail ? `: ${String(errorDetail).split(trimmedKey).join('[redacted]')}` : ''}`,
      { httpStatus: response.status, diagnostics }
    );
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new DisclosureSyncError('validation', `OpenDART sync response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!payload || payload.ok !== true) {
    throw new DisclosureSyncError('validation', `OpenDART sync failed: ${payload?.message || payload?.error || 'ok !== true'}`);
  }

  const source = payload.source || {};
  if (window && (source.beginDate !== requested.beginDate || source.endDate !== requested.endDate)) {
    throw new DisclosureSyncError(
      'validation',
      `OpenDART sync answered for ${expand(source.beginDate) || '?'}..${expand(source.endDate) || '?'}, not the requested ${window.beginDate}..${window.endDate}`
    );
  }
  // A capped read is not a sync: the oldest filings of the window were never fetched.
  if (source.truncated === true) {
    throw new DisclosureSyncError(
      'truncated',
      `OpenDART returned more filings than one run reads for ${expand(source.beginDate)}..${expand(source.endDate)} (${describeClasses(source.classes)}); raise DISCLOSURE_DART_MAX_PAGES_PER_CLASS (at most 20) or sync the dates one by one`
    );
  }

  return {
    ok: true,
    provider: source.provider || 'opendart',
    fetched: Number(source.fetched || 0),
    created: Number(source.created || 0),
    updated: Number(source.updated || 0),
    ai_completed: Number(payload.ai?.completed || 0),
    syncedAt: String(payload.syncedAt || ''),
    beginDate: expand(source.beginDate),
    endDate: expand(source.endDate),
    truncated: false,
    classes: Array.isArray(source.classes) ? source.classes : [],
    pages: pagesRead(source.classes),
    publishDate: expand(source.publishDate)
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
    } else if (args[i] === '--date' && args[i + 1]) {
      options.date = args[++i];
    } else if (args[i] === '--scheduled') {
      options.scheduled = true;
    }
  }
  return options;
}

const kstStamp = date => `${date.toISOString()} (${new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')} KST)`;

/** The failure report the log and the alert issue quote. */
export function formatFailureReport({ window, error, now = new Date() }) {
  const lines = [
    'OpenDART daily sync failed',
    '',
    `target_date: ${window?.targetDate || 'unknown'}${window ? ` (${window.mode})` : ''}`,
    `range: ${window ? `${window.beginDate}..${window.endDate}` : 'unknown'}`,
    `error: [${error?.kind || 'unknown'}] ${error instanceof Error ? error.message : String(error)}`,
    `http_status: ${error?.httpStatus ?? 'n/a'}`,
    `timestamp: ${kstStamp(now)}`
  ];
  const described = formatDiagnostics(error?.diagnostics || null);
  if (described.length) lines.push('', ...described);
  return lines.join('\n');
}

/**
 * The command line: resolves the window, syncs, prints one line, and writes the
 * machine-readable result the alert step reads (`DISCLOSURE_SYNC_RESULT`).
 */
export async function runCli({
  args = process.argv.slice(2),
  env = process.env,
  syncImpl = syncDisclosures,
  now = () => new Date(),
  log = line => console.log(line),
  logError = line => console.error(line),
  writeResult = (path, text) => writeFile(path, text, 'utf8')
} = {}) {
  const cliOptions = parseCliArgs(args);
  const date = cliOptions.date || String(env.SYNC_DATE || '').trim();
  const mode = cliOptions.scheduled || env.SYNC_EVENT === 'schedule' ? 'scheduled' : 'manual';
  let window = null;
  let outcome;
  try {
    window = resolveSyncWindow({ mode, date, now: now() });
    const result = await syncImpl({ ...cliOptions, window });
    log(`PASS OpenDART daily sync: target=${window.targetDate} (${window.mode}) range=${window.beginDate}..${window.endDate} fetched=${result.fetched} created=${result.created} updated=${result.updated} pages=${result.pages} publishDate=${result.publishDate || 'n/a'} ai.completed=${result.ai_completed} syncedAt=${result.syncedAt}`);
    outcome = { ok: true, ...window, fetched: result.fetched, created: result.created, updated: result.updated, pages: result.pages, publishDate: result.publishDate, syncedAt: result.syncedAt };
  } catch (error) {
    const kind = error instanceof DisclosureSyncError ? error.kind : 'unknown';
    logError(`FAIL OpenDART daily sync [${kind}]: ${error instanceof Error ? error.message : String(error)}`);
    const report = formatFailureReport({ window, error, now: now() });
    const diagnostics = formatDiagnostics(error?.diagnostics || null);
    if (diagnostics.length) logError(diagnostics.join('\n'));
    outcome = { ok: false, kind, message: error instanceof Error ? error.message : String(error), ...(window || {}), report };
  }
  if (env.DISCLOSURE_SYNC_RESULT) {
    try { await writeResult(env.DISCLOSURE_SYNC_RESULT, `${JSON.stringify(outcome, null, 2)}\n`); }
    catch (error) { logError(`could not write the sync result: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return outcome.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sync-disclosures.mjs')) {
  process.exitCode = await runCli();
}
