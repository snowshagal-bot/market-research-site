export const ENGAGEMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS engagement_sessions (
    session_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    country TEXT,
    lang TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    active_ms INTEGER NOT NULL DEFAULT 0,
    max_scroll INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS idx_engagement_started ON engagement_sessions (started_at)',
  'CREATE INDEX IF NOT EXISTS idx_engagement_path_started ON engagement_sessions (path, started_at)',
  'CREATE INDEX IF NOT EXISTS idx_engagement_country_started ON engagement_sessions (country, started_at)'
];

let schemaPromise;

export function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'private, no-store, max-age=0',
      ...extraHeaders
    }
  });
}

export async function secretsMatch(actual, expected) {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = [encoder.encode(String(actual)), encoder.encode(String(expected))];
  if (a.length !== b.length) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode('snowshagal-admin-auth'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const [left, right] = await Promise.all([
    crypto.subtle.sign('HMAC', key, a),
    crypto.subtle.sign('HMAC', key, b)
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) diff |= leftBytes[index] ^ rightBytes[index];
  return diff === 0;
}

export async function ensureEngagementSchema(db) {
  if (!db) throw new Error('ENGAGEMENT_DB_NOT_CONFIGURED');
  if (!schemaPromise) {
    schemaPromise = Promise.all(ENGAGEMENT_SCHEMA.map((statement) => db.prepare(statement).run()))
      .catch((error) => {
        schemaPromise = undefined;
        throw error;
      });
  }
  return schemaPromise;
}

export function resetSchemaCache() {
  schemaPromise = undefined;
}

export function isExcludedPath(path) {
  return /^\/(?:admin|api|cdn-cgi)(?:\/|$)/i.test(String(path || ''));
}

export function normalizePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) return null;
  if (!value.startsWith('/') || value.startsWith('//') || /[?#\\\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function languageForPath(path) {
  return /^\/en(?:\/|$)/i.test(path) || /^\/reports\/en(?:\/|$)/i.test(path) ? 'en' : 'ko';
}

export function normalizeCountry(value) {
  const country = String(value || '').toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'XX';
}

export function rangeDates(days, now = new Date()) {
  const allowed = [1, 7, 28];
  const selected = allowed.includes(Number(days)) ? Number(days) : 7;
  const endExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(endExclusive.getTime() - selected * 86400000);
  return {
    days: selected,
    from: start.toISOString().slice(0, 10),
    to: new Date(endExclusive.getTime() - 1).toISOString().slice(0, 10),
    start: start.toISOString(),
    endExclusive: endExclusive.toISOString(),
    timezone: 'UTC'
  };
}

function roundedAverage(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function rate(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : 0;
}

export function metrics(rows) {
  const active = rows.map((row) => Math.max(0, Number(row.active_ms) || 0));
  const scroll = rows.map((row) => Math.min(100, Math.max(0, Number(row.max_scroll) || 0)));
  return {
    sessions: rows.length,
    avgActiveMs: roundedAverage(active),
    medianActiveMs: median(active),
    avgMaxScroll: scroll.length ? Math.round((scroll.reduce((sum, value) => sum + value, 0) / scroll.length) * 10) / 10 : 0,
    over30sRate: rate(active.filter((value) => value >= 30000).length, rows.length),
    over1mRate: rate(active.filter((value) => value >= 60000).length, rows.length),
    over3mRate: rate(active.filter((value) => value >= 180000).length, rows.length),
    over90ScrollRate: rate(scroll.filter((value) => value >= 90).length, rows.length)
  };
}

function grouped(rows, keyForRow) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyForRow(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

export function aggregateRows(rows, titleForPath = (path) => path) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const pages = [...grouped(safeRows, (row) => `${row.lang || languageForPath(row.path)}\u0000${row.path}`).entries()]
    .map(([key, pageRows]) => {
      const [lang, path] = key.split('\u0000');
      return { path, lang, title: titleForPath(path, lang) || path, ...metrics(pageRows) };
    })
    .sort((a, b) => b.sessions - a.sessions || b.avgActiveMs - a.avgActiveMs || a.path.localeCompare(b.path))
    .slice(0, 20);
  const countries = [...grouped(safeRows, (row) => normalizeCountry(row.country)).entries()]
    .map(([country, countryRows]) => ({ country, ...metrics(countryRows) }))
    .sort((a, b) => b.sessions - a.sessions || b.avgActiveMs - a.avgActiveMs || a.country.localeCompare(b.country));
  return { overall: metrics(safeRows), pages, countries };
}

export const __test = { resetSchemaCache, median, rate, roundedAverage };
