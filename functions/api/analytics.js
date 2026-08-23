const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const DATASET = 'rumPageloadEventsAdaptiveGroups';
const PRODUCTION_HOSTNAME = 'snowshagal.com';
const ADMIN_PATH_PREFIX = '/admin/';
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

function analyticsError(code, message, status = 424, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, details);
  return error;
}

function classifyGraphQLError(message) {
  const value = String(message || '').toLowerCase();
  if (/complexity|too many|cost|query limit/.test(value)) return 'QUERY_COMPLEXITY';
  if (/unknown (?:argument|field)|cannot query field|validation/.test(value)) return 'QUERY_VALIDATION';
  if (/permission|access denied|not authorized|authorization/.test(value)) return 'PERMISSION';
  if (/rate limit|too many requests/.test(value)) return 'RATE_LIMIT';
  return 'GRAPHQL_ERROR';
}

function logAnalyticsFailure(error) {
  console.error(JSON.stringify({
    scope: 'admin-analytics',
    code: error?.code || 'ANALYTICS_QUERY_FAILED',
    stage: error?.stage || 'unknown',
    upstreamStatus: error?.upstreamStatus || null,
    upstreamCodes: error?.upstreamCodes || [],
    upstreamReasons: error?.upstreamReasons || []
  }));
}

async function graphQL(token, query, variables = {}, stage = 'unknown') {
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
    catch (_) {
      throw analyticsError('ANALYTICS_BAD_RESPONSE', 'Cloudflare Analytics 응답을 읽을 수 없습니다.', 424, {
        stage,
        upstreamStatus: response.status
      });
    }
    if (!response.ok || payload?.errors?.length) {
      const status = response.status === 401 || response.status === 403 ? 503 : 502;
      throw analyticsError('ANALYTICS_QUERY_FAILED', 'Cloudflare Analytics 데이터 조회에 실패했습니다.', status === 502 ? 424 : status, {
        stage,
        upstreamStatus: response.status,
        upstreamCodes: (payload?.errors || []).map((item) => String(item?.extensions?.code || '').replace(/[^A-Z0-9_-]/gi, '').slice(0, 40)).filter(Boolean).slice(0, 5),
        upstreamReasons: [...new Set((payload?.errors || []).map((item) => classifyGraphQLError(item?.message)))].slice(0, 5)
      });
    }
    return payload?.data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw analyticsError('ANALYTICS_TIMEOUT', 'Cloudflare Analytics 응답이 지연되고 있습니다.', 504, { stage });
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
  const data = await graphQL(token, TYPE_QUERY, { name }, `schema:type:${name}`);
  return data?.__type || null;
}

async function discoverSchema(token) {
  const now = Date.now();
  if (schemaCache?.expiresAt > now) return schemaCache.value;

  const rootData = await graphQL(token, `query AnalyticsRoot {
    __schema { queryType { name fields { name type { ${TYPE_REF} } } } }
  }`, {}, 'schema:root');
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
    host: firstAvailable(dimensionNames, ['requestHost', 'host']),
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
  const hostFilter = filterType?.inputFields?.find((item) => ['requestHost_in', 'requestHost', 'host_in', 'host'].includes(item.name));
  const adminPathFilter = filterType?.inputFields?.find((item) => ['requestPath_notlike', 'path_notlike'].includes(item.name));
  const excludeBotsFilter = filterType?.inputFields?.find((item) => item.name === 'excludeBots');
  const excludeBotsType = (() => {
    let current = excludeBotsFilter?.type;
    while (current?.ofType) current = current.ofType;
    return current;
  })();
  const filters = {
    start: startFilter?.name || '',
    end: endFilter?.name || '',
    siteTag: siteFilter?.name || '',
    siteTagList: includesKind(siteFilter?.type, 'LIST'),
    host: hostFilter?.name || '',
    hostList: includesKind(hostFilter?.type, 'LIST'),
    excludeAdminPath: adminPathFilter?.name || '',
    excludeBots: excludeBotsFilter?.name || '',
    excludeBotsList: includesKind(excludeBotsFilter?.type, 'LIST'),
    excludeBotsEnum: excludeBotsType?.kind === 'ENUM',
    datetime: Boolean(startFilter?.name.startsWith('datetime'))
  };
  const missing = Object.entries(dimensions).filter(([, value]) => !value).map(([name]) => `dimension:${name}`);
  if (!field(groupType, 'count')) missing.push('metric:count');
  if (!visits) missing.push('metric:visits');
  if (!filters.start || !filters.end || !filters.siteTag) missing.push('filter:date/siteTag');
  if (!filters.host) missing.push('filter:productionHost');
  if (!filters.excludeAdminPath) missing.push('filter:adminPath');
  if (!filters.excludeBots) missing.push('filter:excludeBots');
  if (missing.length) {
    throw analyticsError('ANALYTICS_SCHEMA_UNSUPPORTED', `Web Analytics schema에 필요한 항목이 없습니다: ${missing.join(', ')}`, 424, {
      stage: 'schema:validation'
    });
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
  const host = schema.filters.hostList ? `[${gqlString(PRODUCTION_HOSTNAME)}]` : gqlString(PRODUCTION_HOSTNAME);
  const baseFilter = `${schema.filters.start}: ${gqlString(start)}, ${schema.filters.end}: ${gqlString(end)}, ${schema.filters.siteTag}: ${site}, ${schema.filters.host}: ${host}, ${schema.filters.excludeAdminPath}: ${gqlString(`${ADMIN_PATH_PREFIX}%`)}`;
  const excludeBotsValue = schema.filters.excludeBotsEnum ? 'Yes' : gqlString('Yes');
  const excludeBots = schema.filters.excludeBotsList ? `[${excludeBotsValue}]` : excludeBotsValue;
  const humanFilter = `{ ${baseFilter}, ${schema.filters.excludeBots}: ${excludeBots} }`;
  const allTrafficFilter = `{ ${baseFilter} }`;
  const datasetArgs = (filter, limit, orderBy = '') => `filter: ${filter}, limit: ${limit}${orderBy ? `, orderBy: [${orderBy}]` : ''}`;
  const topOrder = schema.countOrder;
  const aliases = [
    `allTrafficTrend: ${schema.dataset}(${datasetArgs(allTrafficFilter, 1000, schema.dateOrder)}) { ${buildSelection(schema, schema.dimensions.date)} }`,
    `trend: ${schema.dataset}(${datasetArgs(humanFilter, 1000, schema.dateOrder)}) { ${buildSelection(schema, schema.dimensions.date)} }`,
    `pages: ${schema.dataset}(${datasetArgs(humanFilter, 100, topOrder)}) { ${buildSelection(schema, schema.dimensions.path)} }`,
    `referers: ${schema.dataset}(${datasetArgs(humanFilter, 100, topOrder)}) { ${buildSelection(schema, schema.dimensions.referer)} }`,
    `countries: ${schema.dataset}(${datasetArgs(humanFilter, 100, topOrder)}) { ${buildSelection(schema, schema.dimensions.country)} }`,
    `devices: ${schema.dataset}(${datasetArgs(humanFilter, 100, topOrder)}) { ${buildSelection(schema, schema.dimensions.device)} }`,
    `browsers: ${schema.dataset}(${datasetArgs(humanFilter, 100, topOrder)}) { ${buildSelection(schema, schema.dimensions.browser)} }`,
    `operatingSystems: ${schema.dataset}(${datasetArgs(humanFilter, 100, topOrder)}) { ${buildSelection(schema, schema.dimensions.os)} }`
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
  const allTrafficTrend = normalizeTrend(account.allTrafficTrend, schema.dimensions.date, schema, days);
  const totals = trend.reduce((result, item) => ({
    visits: result.visits + item.visits,
    pageViews: result.pageViews + item.pageViews
  }), { visits: 0, pageViews: 0 });
  const allTrafficTotals = allTrafficTrend.reduce((result, item) => ({
    visits: result.visits + item.visits,
    pageViews: result.pageViews + item.pageViews
  }), { visits: 0, pageViews: 0 });
  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    range: { days, from: dates.start, to: dates.end, timezone: 'UTC' },
    totals,
    allTrafficTotals,
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
      visitsMetric: `${schema.visits.container}.${schema.visits.field}`,
      excludeBots: 'Yes'
    }
  };
  result.empty = result.totals.visits === 0 && result.totals.pageViews === 0
    && result.allTrafficTotals.visits === 0 && result.allTrafficTotals.pageViews === 0;
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
    const data = await graphQL(env.CLOUDFLARE_ANALYTICS_API_TOKEN, query, {}, 'analytics:data');
    return json(normalizeAnalytics(data, schema, days, dates));
  } catch (error) {
    logAnalyticsFailure(error);
    return json({
      ok: false,
      error: error?.code || 'ANALYTICS_QUERY_FAILED',
      message: error?.message || 'Cloudflare Analytics 데이터 조회에 실패했습니다.',
      stage: error?.stage || 'unknown'
    }, error?.status || 424);
  }
}

export const __test = {
  DATASET,
  GRAPHQL_ENDPOINT,
  PRODUCTION_HOSTNAME,
  ADMIN_PATH_PREFIX,
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
  classifyGraphQLError,
  resetSchemaCache() { schemaCache = null; }
};
