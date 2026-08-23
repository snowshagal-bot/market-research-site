const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const DATASET = 'rumPageloadEventsAdaptiveGroups';
const REQUEST_TIMEOUT_MS = 12000;
const SCHEMA_CACHE_MS = 15 * 60 * 1000;
const RANGE_DAYS = new Set([1, 7, 28]);

let schemaCache = null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function secretsMatch(left, right) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  if (leftBytes.length !== rightBytes.length) return false;
  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) mismatch |= leftBytes[index] ^ rightBytes[index];
  return mismatch === 0;
}

function analyticsError(code, message, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function graphQL(token, query, variables = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });
    let payload;
    try { payload = await response.json(); }
    catch (_) { throw analyticsError('ANALYTICS_BAD_RESPONSE', 'Cloudflare Analytics 응답을 읽을 수 없습니다.'); }
    if (!response.ok || payload?.errors?.length) {
      const status = response.status === 401 || response.status === 403 ? 503 : 502;
      throw analyticsError('ANALYTICS_QUERY_FAILED', 'Cloudflare Analytics 데이터 조회에 실패했습니다.', status);
    }
    return payload?.data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw analyticsError('ANALYTICS_TIMEOUT', 'Cloudflare Analytics 응답이 지연되고 있습니다.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const TYPE_REF = `kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }`;
const TYPE_QUERY = `query AnalyticsType($name: String!) {
  __type(name: $name) {
    kind
    name
    fields { name type { ${TYPE_REF} } args { name type { ${TYPE_REF} } } }
    inputFields { name type { ${TYPE_REF} } }
    enumValues { name }
  }
}`;

function namedType(type) {
  let current = type;
  while (current?.ofType) current = current.ofType;
  return current?.name || '';
}

function includesKind(type, kind) {
  let current = type;
  while (current) {
    if (current.kind === kind) return true;
    current = current.ofType;
  }
  return false;
}

function field(type, name) {
  return type?.fields?.find((item) => item.name === name) || null;
}

function firstAvailable(names, candidates) {
  return candidates.find((name) => names.has(name)) || '';
}

async function inspectType(token, name) {
  if (!name) return null;
  const data = await graphQL(token, TYPE_QUERY, { name });
  return data?.__type || null;
}

async function discoverSchema(token) {
  const now = Date.now();
  if (schemaCache?.expiresAt > now) return schemaCache.value;

  const rootData = await graphQL(token, `query AnalyticsRoot {
    __schema { queryType { name fields { name type { ${TYPE_REF} } } } }
  }`);
  const queryType = rootData?.__schema?.queryType;
  const viewerField = queryType?.fields?.find((item) => item.name === 'viewer');
  const viewerType = await inspectType(token, namedType(viewerField?.type));
  const accountsField = field(viewerType, 'accounts');
  const accountType = await inspectType(token, namedType(accountsField?.type));
  const datasetField = field(accountType, DATASET);

  if (!viewerField || !accountsField || !datasetField) {
    throw analyticsError('ANALYTICS_SCHEMA_UNSUPPORTED', `${DATASET} dataset을 현재 계정 schema에서 사용할 수 없습니다.`);
  }

  const groupType = await inspectType(token, namedType(datasetField.type));
  const dimensionsField = field(groupType, 'dimensions');
  const sumField = field(groupType, 'sum');
  const uniqField = field(groupType, 'uniq');
  const [dimensionsType, sumType, uniqType] = await Promise.all([
    inspectType(token, namedType(dimensionsField?.type)),
    inspectType(token, namedType(sumField?.type)),
    inspectType(token, namedType(uniqField?.type))
  ]);

  const filterArg = datasetField.args?.find((item) => item.name === 'filter');
  const orderArg = datasetField.args?.find((item) => item.name === 'orderBy');
  const [filterType, orderType] = await Promise.all([
    inspectType(token, namedType(filterArg?.type)),
    inspectType(token, namedType(orderArg?.type))
  ]);

  const dimensionNames = new Set(dimensionsType?.fields?.map((item) => item.name) || []);
  const sumNames = new Set(sumType?.fields?.map((item) => item.name) || []);
  const uniqNames = new Set(uniqType?.fields?.map((item) => item.name) || []);
  const orderNames = new Set(orderType?.enumValues?.map((item) => item.name) || []);

  const dimensions = {
    date: firstAvailable(dimensionNames, ['date', 'datetimeDay', 'datetimeHour', 'datetimeFifteenMinutes', 'datetimeMinute']),
    siteTag: firstAvailable(dimensionNames, ['siteTag']),
    path: firstAvailable(dimensionNames, ['requestPath', 'path']),
    referer: firstAvailable(dimensionNames, ['refererHost', 'refererPath', 'referer', 'referrerHost']),
    country: firstAvailable(dimensionNames, ['countryName', 'country']),
    device: firstAvailable(dimensionNames, ['deviceType']),
    browser: firstAvailable(dimensionNames, ['userAgentBrowser', 'browserName', 'browser']),
    os: firstAvailable(dimensionNames, ['userAgentOS', 'osName', 'operatingSystem', 'os'])
  };
  const visits = sumNames.has('visits')
    ? { container: 'sum', field: 'visits' }
    : uniqNames.has('visits')
      ? { container: 'uniq', field: 'visits' }
      : null;
  const startFilter = filterType?.inputFields?.find((item) => ['date_geq', 'datetimeDay_geq', 'datetime_geq'].includes(item.name));
  const endFilter = filterType?.inputFields?.find((item) => ['date_leq', 'datetimeDay_leq', 'datetime_leq', 'datetime_lt'].includes(item.name));
  const siteFilter = filterType?.inputFields?.find((item) => ['siteTag_in', 'siteTag'].includes(item.name));
  const filters = {
    start: startFilter?.name || '',
    end: endFilter?.name || '',
    siteTag: siteFilter?.name || '',
    siteTagList: includesKind(siteFilter?.type, 'LIST'),
    datetime: Boolean(startFilter?.name.startsWith('datetime'))
  };
  const missing = Object.entries(dimensions).filter(([, value]) => !value).map(([name]) => `dimension:${name}`);
  if (!field(groupType, 'count')) missing.push('metric:count');
  if (!visits) missing.push('metric:visits');
  if (!filters.start || !filters.end || !filters.siteTag) missing.push('filter:date/siteTag');
  if (missing.length) {
    throw analyticsError('ANALYTICS_SCHEMA_UNSUPPORTED', `Web Analytics schema에 필요한 항목이 없습니다: ${missing.join(', ')}`);
  }

  const value = {
    dataset: DATASET,
    dimensions,
    visits,
    filters,
    countOrder: orderNames.has('count_DESC') ? 'count_DESC' : '',
    dateOrder: orderNames.has(`${dimensions.date}_ASC`) ? `${dimensions.date}_ASC` : ''
  };
  schemaCache = { value, expiresAt: now + SCHEMA_CACHE_MS };
  return value;
}

function dateString(date) {
  return date.toISOString().slice(0, 10);
}

function rangeDates(days, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start: dateString(start), end: dateString(end) };
}

function gqlString(value) {
  return JSON.stringify(String(value));
}

function filterDateValue(date, end = false) {
  return `${date}T${end ? '23:59:59.999' : '00:00:00.000'}Z`;
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return dateString(value);
}

function buildSelection(schema, dimension) {
  return `count ${schema.visits.container} { ${schema.visits.field} } dimensions { ${dimension} }`;
}

function buildAnalyticsQuery(schema, accountId, siteTag, dates) {
  const start = schema.filters.datetime ? filterDateValue(dates.start) : dates.start;
  const end = schema.filters.datetime
    ? schema.filters.end.endsWith('_lt')
      ? filterDateValue(nextDate(dates.end))
      : filterDateValue(dates.end, true)
    : dates.end;
  const site = schema.filters.siteTagList ? `[${gqlString(siteTag)}]` : gqlString(siteTag);
  const filter = `{ ${schema.filters.start}: ${gqlString(start)}, ${schema.filters.end}: ${gqlString(end)}, ${schema.filters.siteTag}: ${site} }`;
  const datasetArgs = (limit, orderBy = '') => `filter: ${filter}, limit: ${limit}${orderBy ? `, orderBy: [${orderBy}]` : ''}`;
  const topOrder = schema.countOrder;
  const aliases = [
    `trend: ${schema.dataset}(${datasetArgs(1000, schema.dateOrder)}) { ${buildSelection(schema, schema.dimensions.date)} }`,
    `pages: ${schema.dataset}(${datasetArgs(100, topOrder)}) { ${buildSelection(schema, schema.dimensions.path)} }`,
    `referers: ${schema.dataset}(${datasetArgs(100, topOrder)}) { ${buildSelection(schema, schema.dimensions.referer)} }`,
    `countries: ${schema.dataset}(${datasetArgs(100, topOrder)}) { ${buildSelection(schema, schema.dimensions.country)} }`,
    `devices: ${schema.dataset}(${datasetArgs(100, topOrder)}) { ${buildSelection(schema, schema.dimensions.device)} }`,
    `browsers: ${schema.dataset}(${datasetArgs(100, topOrder)}) { ${buildSelection(schema, schema.dimensions.browser)} }`,
    `operatingSystems: ${schema.dataset}(${datasetArgs(100, topOrder)}) { ${buildSelection(schema, schema.dimensions.os)} }`
  ];
  return `query AdminAnalytics {
    viewer {
      accounts(filter: { accountTag: ${gqlString(accountId)} }) {
        ${aliases.join('\n        ')}
      }
    }
  }`;
}

function metricValue(row, schema) {
  return Number(row?.[schema.visits.container]?.[schema.visits.field] || 0);
}

function normalizeGroups(rows, dimension, schema, limit = 10) {
  const combined = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const rawLabel = row?.dimensions?.[dimension];
    const label = String(rawLabel || '').trim() || '알 수 없음';
    const current = combined.get(label) || { label, visits: 0, pageViews: 0 };
    current.visits += metricValue(row, schema);
    current.pageViews += Number(row?.count || 0);
    combined.set(label, current);
  }
  return [...combined.values()]
    .sort((left, right) => right.pageViews - left.pageViews || right.visits - left.visits || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function refererBucket(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === '알 수 없음' || normalized === '(direct)') return 'Direct';
  let host = normalized.toLowerCase();
  try { host = new URL(normalized.includes('://') ? normalized : `https://${normalized}`).hostname.toLowerCase(); }
  catch (_) { host = normalized.toLowerCase().split('/')[0]; }
  host = host.replace(/^www\./, '');
  if (host === 'google.com' || host.endsWith('.google.com') || /^google\.[a-z.]+$/.test(host)) return 'Google';
  if (host === 'tistory.com' || host.endsWith('.tistory.com')) return 'Tistory';
  return host || '기타';
}

function normalizeReferers(rows, dimension, schema) {
  const buckets = new Map();
  for (const item of normalizeGroups(rows, dimension, schema, 100)) {
    const label = refererBucket(item.label);
    const current = buckets.get(label) || { label, visits: 0, pageViews: 0 };
    current.visits += item.visits;
    current.pageViews += item.pageViews;
    buckets.set(label, current);
  }
  return [...buckets.values()]
    .sort((left, right) => right.pageViews - left.pageViews || right.visits - left.visits)
    .slice(0, 10);
}

function normalizeTrend(rows, dimension, schema, days) {
  const dates = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const raw = String(row?.dimensions?.[dimension] || '').trim();
    const date = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const current = dates.get(date) || { date, visits: 0, pageViews: 0 };
    current.visits += metricValue(row, schema);
    current.pageViews += Number(row?.count || 0);
    dates.set(date, current);
  }
  return [...dates.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-days);
}

function normalizeAnalytics(data, schema, days, dates) {
  const account = data?.viewer?.accounts?.[0];
  if (!account) throw analyticsError('ANALYTICS_ACCOUNT_NOT_FOUND', 'Cloudflare Analytics 계정 데이터를 찾지 못했습니다.');
  const trend = normalizeTrend(account.trend, schema.dimensions.date, schema, days);
  const totals = trend.reduce((result, item) => ({
    visits: result.visits + item.visits,
    pageViews: result.pageViews + item.pageViews
  }), { visits: 0, pageViews: 0 });
  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    range: { days, from: dates.start, to: dates.end, timezone: 'UTC' },
    totals,
    trend,
    topPages: normalizeGroups(account.pages, schema.dimensions.path, schema),
    referrers: normalizeReferers(account.referers, schema.dimensions.referer, schema),
    countries: normalizeGroups(account.countries, schema.dimensions.country, schema),
    devices: normalizeGroups(account.devices, schema.dimensions.device, schema),
    browsers: normalizeGroups(account.browsers, schema.dimensions.browser, schema),
    operatingSystems: normalizeGroups(account.operatingSystems, schema.dimensions.os, schema),
    source: {
      dataset: schema.dataset,
      dimensions: schema.dimensions,
      visitsMetric: `${schema.visits.container}.${schema.visits.field}`
    }
  };
  result.empty = result.totals.visits === 0 && result.totals.pageViews === 0;
  return result;
}

export async function onRequestGet({ request, env }) {
  if (!env.ADMIN_KEY) {
    return json({ ok: false, error: 'SERVER_NOT_CONFIGURED', message: '관리자 인증 설정이 필요합니다.' }, 503);
  }
  const suppliedKey = request.headers.get('x-admin-key') || '';
  if (!(await secretsMatch(suppliedKey, env.ADMIN_KEY))) {
    return json({ ok: false, error: 'UNAUTHORIZED', message: '관리자 키가 올바르지 않습니다.' }, 401);
  }
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_ANALYTICS_API_TOKEN || !env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG) {
    return json({ ok: false, error: 'ANALYTICS_NOT_CONFIGURED', message: 'Cloudflare Analytics 환경 변수 설정이 필요합니다.' }, 503);
  }

  const requestedDays = Number(new URL(request.url).searchParams.get('range') || 7);
  const days = RANGE_DAYS.has(requestedDays) ? requestedDays : 7;
  try {
    const schema = await discoverSchema(env.CLOUDFLARE_ANALYTICS_API_TOKEN);
    const dates = rangeDates(days);
    const query = buildAnalyticsQuery(schema, env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG, dates);
    const data = await graphQL(env.CLOUDFLARE_ANALYTICS_API_TOKEN, query);
    return json(normalizeAnalytics(data, schema, days, dates));
  } catch (error) {
    return json({
      ok: false,
      error: error?.code || 'ANALYTICS_QUERY_FAILED',
      message: error?.message || 'Cloudflare Analytics 데이터 조회에 실패했습니다.'
    }, error?.status || 502);
  }
}

export const __test = {
  DATASET,
  GRAPHQL_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  TYPE_QUERY,
  namedType,
  includesKind,
  discoverSchema,
  rangeDates,
  buildAnalyticsQuery,
  normalizeGroups,
  normalizeReferers,
  normalizeTrend,
  normalizeAnalytics,
  refererBucket,
  resetSchemaCache() { schemaCache = null; }
};
