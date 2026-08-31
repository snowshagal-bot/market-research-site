import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { __test, onRequestGet } from '../functions/api/analytics.js';

const ENV = {
  ADMIN_KEY: 'test-admin-key',
  CLOUDFLARE_ACCOUNT_ID: 'account-tag',
  CLOUDFLARE_ANALYTICS_API_TOKEN: 'analytics-token-secret',
  CLOUDFLARE_WEB_ANALYTICS_SITE_TAG: 'site-tag-secret'
};

function ref(name, kind = 'OBJECT') {
  return { kind, name, ofType: null };
}

function listRef(name) {
  return { kind: 'LIST', name: null, ofType: { kind: 'NON_NULL', name: null, ofType: ref(name) } };
}

function typeField(name, type, args = []) {
  return { name, type, args };
}

const SCHEMA_TYPES = {
  Viewer: {
    kind: 'OBJECT', name: 'Viewer',
    fields: [typeField('accounts', listRef('Account'), [typeField('filter', ref('AccountFilter_InputObject', 'INPUT_OBJECT'))])]
  },
  Account: {
    kind: 'OBJECT', name: 'Account',
    fields: [typeField('rumPageloadEventsAdaptiveGroups', listRef('RumPageloadGroup'), [
      typeField('filter', ref('RumPageloadFilter_InputObject', 'INPUT_OBJECT')),
      typeField('limit', ref('Int', 'SCALAR')),
      typeField('orderBy', { kind: 'LIST', name: null, ofType: ref('RumPageloadOrderBy', 'ENUM') })
    ])]
  },
  RumPageloadGroup: {
    kind: 'OBJECT', name: 'RumPageloadGroup',
    fields: [
      typeField('count', ref('UInt64', 'SCALAR')),
      typeField('sum', ref('RumPageloadSum')),
      typeField('dimensions', ref('RumPageloadDimensions'))
    ]
  },
  RumPageloadSum: {
    kind: 'OBJECT', name: 'RumPageloadSum',
    fields: [typeField('visits', ref('UInt64', 'SCALAR'))]
  },
  RumPageloadDimensions: {
    kind: 'OBJECT', name: 'RumPageloadDimensions',
    fields: ['date', 'siteTag', 'requestHost', 'requestPath', 'refererHost', 'countryName', 'deviceType', 'userAgentBrowser', 'userAgentOS']
      .map((name) => typeField(name, ref('String', 'SCALAR')))
  },
  RumPageloadFilter_InputObject: {
    kind: 'INPUT_OBJECT', name: 'RumPageloadFilter_InputObject', fields: null,
    inputFields: [
      typeField('date_geq', ref('Date', 'SCALAR')),
      typeField('date_leq', ref('Date', 'SCALAR')),
      typeField('siteTag_in', { kind: 'LIST', name: null, ofType: ref('String', 'SCALAR') }),
      typeField('requestHost_in', { kind: 'LIST', name: null, ofType: ref('String', 'SCALAR') }),
      typeField('requestPath_notlike', ref('String', 'SCALAR')),
      typeField('bot', ref('uint8', 'SCALAR'))
    ]
  },
  RumPageloadOrderBy: {
    kind: 'ENUM', name: 'RumPageloadOrderBy', fields: null,
    enumValues: [{ name: 'date_ASC' }, { name: 'count_DESC' }]
  }
};

function analyticsRows() {
  const row = (dimension, label, count, visits) => ({ count, sum: { visits }, dimensions: { [dimension]: label } });
  return {
    viewer: { accounts: [{
      allTrafficTrend: [row('date', '2026-08-22', 6, 3), row('date', '2026-08-23', 9, 5)],
      trend: [row('date', '2026-08-22', 4, 2), row('date', '2026-08-23', 7, 3)],
      pages: [row('requestPath', '/reports/alpha', 7, 3), row('requestPath', '/', 4, 2)],
      referers: [row('refererHost', '', 3, 2), row('refererHost', 'www.google.com', 5, 2), row('refererHost', 'snowshagal.tistory.com', 2, 1)],
      countries: [row('countryName', 'KR', 9, 4)],
      devices: [row('deviceType', 'desktop', 8, 4)],
      browsers: [row('userAgentBrowser', 'Chrome', 8, 4)],
      operatingSystems: [row('userAgentOS', 'Windows', 8, 4)]
    }] }
  };
}

function installCloudflareMock({ empty = false } = {}) {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    calls.push(payload);
    if (payload.query.includes('__schema')) {
      return Response.json({ data: { __schema: { queryType: { name: 'Query', fields: [typeField('viewer', ref('Viewer'))] } } } });
    }
    if (payload.query.includes('__type')) {
      return Response.json({ data: { __type: SCHEMA_TYPES[payload.variables.name] || null } });
    }
    const data = empty
      ? { viewer: { accounts: [{ allTrafficTrend: [], trend: [], pages: [], referers: [], countries: [], devices: [], browsers: [], operatingSystems: [] }] } }
      : analyticsRows();
    return Response.json({ data });
  };
  return calls;
}

function request(key = ENV.ADMIN_KEY, range = 7) {
  return new Request(`https://admin-preview.market-research-site.pages.dev/api/analytics?range=${range}`, {
    headers: key === null ? {} : { 'x-admin-key': key }
  });
}

test('missing and incorrect admin keys are rejected before Cloudflare access', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(); };
  try {
    for (const key of [null, 'wrong-key']) {
      const response = await onRequestGet({ request: request(key), env: ENV });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, 'UNAUTHORIZED');
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('authenticated requests introspect the live schema before querying the RUM dataset', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  __test.resetSchemaCache();
  const calls = installCloudflareMock();
  try {
    const response = await onRequestGet({ request: request(), env: ENV });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.source.dataset, 'rumPageloadEventsAdaptiveGroups');
    assert.equal(data.source.visitsMetric, 'sum.visits');
    assert.equal(data.source.excludeBots, 'Yes');
    assert.deepEqual(data.totals, { visits: 5, pageViews: 11 });
    assert.deepEqual(data.allTrafficTotals, { visits: 8, pageViews: 15 });
    assert.equal(data.topPages[0].label, '/reports/alpha');
    assert.deepEqual(data.referrers.map((item) => item.label), ['Google', 'Direct', 'Tistory']);
    assert.equal(calls[0].query.includes('__schema'), true);
    const query = calls.at(-1).query;
    assert.match(query, /rumPageloadEventsAdaptiveGroups/);
    for (const field of ['date', 'requestPath', 'refererHost', 'countryName', 'deviceType', 'userAgentBrowser', 'userAgentOS']) assert.match(query, new RegExp(`dimensions \\{ ${field} \\}`));
    assert.match(query, /siteTag_in: \["site-tag-secret"\]/);
    assert.match(query, /requestHost_in: \["snowshagal\.com"\]/);
    assert.match(query, /requestPath_notlike: "\/admin\/%"/);
    assert.equal((query.match(/bot: 0/g) || []).length, 7);
    const allTrafficAlias = query.split('\n').find((line) => line.includes('allTrafficTrend:'));
    assert.ok(allTrafficAlias);
    assert.doesNotMatch(allTrafficAlias, /bot: 0/);
    assert.doesNotMatch(query, /market-research-site\.pages\.dev/);
    assert.match(query, /accountTag: "account-tag"/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.doesNotMatch(JSON.stringify(data), /analytics-token-secret|site-tag-secret|account-tag/);
  } finally { globalThis.fetch = originalFetch; }
});

test('production host and admin path exclusions protect human and all-traffic aggregates', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  __test.resetSchemaCache();
  const calls = installCloudflareMock();
  try {
    const response = await onRequestGet({ request: request(), env: ENV });
    assert.equal(response.status, 200);
    const query = calls.at(-1).query;
    assert.equal((query.match(/requestHost_in: \["snowshagal\.com"\]/g) || []).length, 8);
    assert.equal((query.match(/requestPath_notlike: "\/admin\/%"/g) || []).length, 8);
    assert.equal((query.match(/bot: 0/g) || []).length, 7);
    assert.doesNotMatch(query, /pages\.dev|\/admin\/analytics/);
  } finally { globalThis.fetch = originalFetch; }
});

test('unsupported host, admin-prefix, or bot filters fail closed before analytics rows are queried', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const errorLogs = [];
  const originalFields = SCHEMA_TYPES.RumPageloadFilter_InputObject.inputFields;
  let dataQueries = 0;
  SCHEMA_TYPES.RumPageloadFilter_InputObject.inputFields = originalFields.filter((item) => !['requestHost_in', 'requestPath_notlike', 'bot'].includes(item.name));
  __test.resetSchemaCache();
  console.error = (message) => errorLogs.push(message);
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.query.includes('__schema')) {
      return Response.json({ data: { __schema: { queryType: { name: 'Query', fields: [typeField('viewer', ref('Viewer'))] } } } });
    }
    if (payload.query.includes('__type')) {
      return Response.json({ data: { __type: SCHEMA_TYPES[payload.variables.name] || null } });
    }
    dataQueries += 1;
    return Response.json({ data: analyticsRows() });
  };
  try {
    const response = await onRequestGet({ request: request(), env: ENV });
    const data = await response.json();
    assert.equal(response.status, 424);
    assert.equal(data.error, 'ANALYTICS_SCHEMA_UNSUPPORTED');
    assert.equal(data.stage, 'schema:validation');
    assert.match(data.message, /filter:productionHost/);
    assert.match(data.message, /filter:adminPath/);
    assert.match(data.message, /filter:excludeBots/);
    assert.equal(dataQueries, 0);
    assert.match(errorLogs.join('\n'), /"stage":"schema:validation"/);
  } finally {
    SCHEMA_TYPES.RumPageloadFilter_InputObject.inputFields = originalFields;
    __test.resetSchemaCache();
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('zero rows are a successful empty state rather than an API failure', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  __test.resetSchemaCache();
  installCloudflareMock({ empty: true });
  try {
    const response = await onRequestGet({ request: request(), env: ENV });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.empty, true);
    assert.deepEqual(data.totals, { visits: 0, pageViews: 0 });
    assert.deepEqual(data.allTrafficTotals, { visits: 0, pageViews: 0 });
    assert.deepEqual(data.topPages, []);
  } finally { globalThis.fetch = originalFetch; }
});

test('Cloudflare GraphQL errors are distinct from zero data and sanitized', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const errorLogs = [];
  __test.resetSchemaCache();
  globalThis.fetch = async () => Response.json({ errors: [{ message: 'internal account detail' }] });
  console.error = (message) => errorLogs.push(message);
  try {
    const response = await onRequestGet({ request: request(), env: ENV });
    const data = await response.json();
    assert.equal(response.status, 424);
    assert.equal(data.ok, false);
    assert.equal(data.error, 'ANALYTICS_QUERY_FAILED');
    assert.equal(data.stage, 'schema:root');
    assert.doesNotMatch(data.message, /internal account detail/);
    assert.match(errorLogs.join('\n'), /"stage":"schema:root"/);
    assert.doesNotMatch(errorLogs.join('\n'), /internal account detail|analytics-token-secret|site-tag-secret/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('missing server secrets are reported only after successful admin authentication', async () => {
  const missingAdmin = await onRequestGet({ request: request(), env: {} });
  assert.equal(missingAdmin.status, 503);
  assert.equal((await missingAdmin.json()).error, 'SERVER_NOT_CONFIGURED');
  const missingAnalytics = await onRequestGet({ request: request(), env: { ADMIN_KEY: ENV.ADMIN_KEY } });
  assert.equal(missingAnalytics.status, 503);
  assert.equal((await missingAnalytics.json()).error, 'ANALYTICS_NOT_CONFIGURED');
});

test('date ranges and referer buckets are deterministic', () => {
  assert.deepEqual(__test.rangeDates(7, new Date('2026-08-23T21:00:00Z')), { start: '2026-08-17', end: '2026-08-23' });
  assert.equal(__test.refererBucket(''), 'Direct');
  assert.equal(__test.refererBucket('https://www.google.co.kr/search'), 'Google');
  assert.equal(__test.refererBucket('blog.tistory.com'), 'Tistory');
  assert.equal(__test.refererBucket('https://example.com/path'), 'example.com');
  assert.equal(__test.classifyGraphQLError('query exceeded complexity budget'), 'QUERY_COMPLEXITY');
  assert.equal(__test.classifyGraphQLError('Cannot query field foo'), 'QUERY_VALIDATION');
  assert.equal(__test.classifyGraphQLError('permission denied'), 'PERMISSION');
  assert.deepEqual(__test.normalizeTrend([
    { count: 2, sum: { visits: 1 }, dimensions: { datetimeHour: '2026-08-22T10:00:00Z' } },
    { count: 3, sum: { visits: 2 }, dimensions: { datetimeHour: '2026-08-22T11:00:00Z' } },
    { count: 4, sum: { visits: 2 }, dimensions: { datetimeHour: '2026-08-23T10:00:00Z' } }
  ], 'datetimeHour', { visits: { container: 'sum', field: 'visits' } }, 7), [
    { date: '2026-08-22', visits: 3, pageViews: 5 },
    { date: '2026-08-23', visits: 2, pageViews: 4 }
  ]);
  const datetimeQuery = __test.buildAnalyticsQuery({
    dataset: __test.DATASET,
    dimensions: { date: 'date', host: 'requestHost', path: 'requestPath', referer: 'refererHost', country: 'countryName', device: 'deviceType', browser: 'userAgentBrowser', os: 'userAgentOS' },
    visits: { container: 'sum', field: 'visits' },
    filters: { start: 'datetime_geq', end: 'datetime_lt', siteTag: 'siteTag_in', siteTagList: true, host: 'requestHost_in', hostList: true, excludeAdminPath: 'requestPath_notlike', excludeBots: 'bot', excludeBotsList: false, excludeBotsEnum: false, excludeBotsZero: true, datetime: true },
    countOrder: 'count_DESC', dateOrder: 'date_ASC'
  }, 'account', 'site', { start: '2026-08-17', end: '2026-08-23' });
  assert.match(datetimeQuery, /datetime_geq: "2026-08-17T00:00:00\.000Z"/);
  assert.match(datetimeQuery, /datetime_lt: "2026-08-24T00:00:00\.000Z"/);
  assert.match(datetimeQuery, /requestHost_in: \["snowshagal\.com"\]/);
  assert.match(datetimeQuery, /requestPath_notlike: "\/admin\/%"/);
  assert.equal((datetimeQuery.match(/bot: 0/g) || []).length, 7);
});

function element(id = '') {
  const listeners = new Map();
  const children = [];
  const classes = new Set();
  return {
    id, value: '', textContent: '', hidden: false, disabled: false, dataset: {}, title: '', style: {}, children,
    className: '', firstChild: null,
    classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    addEventListener(type, handler) { listeners.set(type, handler); },
    emit(type, event = {}) { return listeners.get(type)?.({ key: '', preventDefault() {}, ...event }); },
    setAttribute(name, value) { this[name] = String(value); },
    appendChild(child) { children.push(child); this.firstChild = children[0] || null; },
    append(...items) { items.forEach((item) => this.appendChild(item)); },
    removeChild(child) { const index = children.indexOf(child); if (index >= 0) children.splice(index, 1); this.firstChild = children[0] || null; },
    focus() {}
  };
}

test('analytics page keeps secrets server-side and renders Bots excluded versus All traffic', async () => {
  const html = await readFile(new URL('../admin/analytics/index.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../assets/admin-analytics.js', import.meta.url), 'utf8');
  assert.match(html, /meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /사용자 국적이 아닌 접속 위치 기준 국가/);
  assert.match(html, /Bots excluded/);
  assert.match(html, /모든 자동화 트래픽이 제거됐다는 의미는 아닙니다/);
  assert.match(html, /Exclude Bots = Yes/);
  assert.match(html, /All traffic/);
  assert.match(html, /읽기 행동 \/ Engagement/);
  assert.match(html, /Reading sessions/);
  assert.match(html, /수집 기능 배포 이후 데이터부터 제공/);
  assert.match(html, /접속 국가\/지역은 네트워크 접속 위치이며 사용자의 국적을 의미하지 않습니다/);
  assert.match(html, /class="table-scroll"/);
  assert.doesNotMatch(`${html}\n${client}`, /Human only/);
  assert.match(html, /href="\.\.\/manage\/">게시물 관리/);
  assert.doesNotMatch(`${html}\n${client}`, /CLOUDFLARE_(?:ACCOUNT_ID|ANALYTICS_API_TOKEN|WEB_ANALYTICS_SITE_TAG)|analytics-token-secret|site-tag-secret/);

  const ids = ['analytics-admin-key', 'analytics-load', 'analytics-dashboard', 'analytics-status', 'metric-visits', 'metric-pageviews', 'metric-depth', 'metric-visits-all', 'metric-pageviews-all', 'metric-depth-all', 'analytics-period', 'analytics-empty', 'trend-chart', 'top-pages', 'top-referers', 'top-countries', 'top-devices', 'top-browsers', 'top-os', 'analytics-source', 'engagement-status', 'engagement-sessions', 'engagement-average', 'engagement-median', 'engagement-scroll', 'engagement-30s', 'engagement-1m', 'engagement-3m', 'engagement-90', 'engagement-empty', 'engagement-pages', 'engagement-countries', 'engagement-source'];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  elements['analytics-dashboard'].hidden = true;
  const ranges = [1, 7, 28].map((range) => { const button = element(); button.dataset.range = String(range); return button; });
  const theme = element();
  const context = {
    console,
    Intl,
    fetch: async (url) => Response.json(String(url).includes('engagement-stats') ? {
      ok: true, generatedAt: '2026-08-23T00:00:00.000Z', empty: false,
      range: { days: 7, from: '2026-08-17', to: '2026-08-23', timezone: 'UTC' },
      overall: { sessions: 3, avgActiveMs: 98000, medianActiveMs: 42000, avgMaxScroll: 76.5, over30sRate: 66.7, over1mRate: 33.3, over3mRate: 0, over90ScrollRate: 33.3 },
      pages: [{ path: '/reports/sample', lang: 'ko', title: '샘플 리포트', sessions: 3, avgActiveMs: 98000, medianActiveMs: 42000, avgMaxScroll: 76.5, over1mRate: 33.3, over90ScrollRate: 33.3 }],
      countries: [{ country: 'KR', sessions: 3, avgActiveMs: 98000, medianActiveMs: 42000, avgMaxScroll: 76.5 }]
    } : {
      ok: true, generatedAt: '2026-08-23T00:00:00.000Z', empty: false,
      range: { days: 7, from: '2026-08-17', to: '2026-08-23', timezone: 'UTC' },
      totals: { visits: 1, pageViews: 2 }, allTrafficTotals: { visits: 2, pageViews: 3 }, trend: [], topPages: [], referrers: [], countries: [], devices: [], browsers: [], operatingSystems: [],
      source: { dataset: 'rumPageloadEventsAdaptiveGroups', excludeBots: 'Yes' }
    }),
    sessionStorage: { getItem: () => '', setItem() {} },
    localStorage: { setItem() {} },
    document: {
      documentElement: { dataset: {} },
      getElementById: (id) => elements[id],
      querySelectorAll: () => ranges,
      querySelector: () => theme,
      createElement: () => element()
    },
    window: {}
  };
  vm.runInNewContext(client, context);
  elements['analytics-admin-key'].value = 'test-admin-key';
  await context.window.__adminAnalyticsTest.loadAnalytics(7);
  assert.equal(elements['analytics-dashboard'].hidden, false);
  assert.equal(elements['analytics-empty'].hidden, true);
  assert.equal(elements['metric-visits'].textContent, '1');
  assert.equal(elements['metric-pageviews'].textContent, '2');
  assert.equal(elements['metric-visits-all'].textContent, '2');
  assert.equal(elements['metric-pageviews-all'].textContent, '3');
  assert.equal(elements['engagement-sessions'].textContent, '3');
  assert.equal(elements['engagement-average'].textContent, '1분 38초');
  assert.equal(elements['engagement-median'].textContent, '42초');
  assert.equal(elements['engagement-pages'].children.length, 1);
  assert.equal(elements['engagement-countries'].children.length, 1);
  context.window.__adminAnalyticsTest.renderTrend([{ date: '2026-08-26', visits: 7, pageViews: 12 }]);
  const trendColumn = elements['trend-chart'].children[0];
  assert.equal(trendColumn.tabIndex, 0);
  assert.equal(trendColumn['aria-label'], '2026-08-26, Visits 7, Page views 12');
  assert.equal(trendColumn.children.some((child) => child.className === 'trend-tooltip'), true);
  assert.match(elements['analytics-source'].textContent, /Bots excluded: Exclude Bots = Yes/);
  assert.match(elements['analytics-status'].textContent, /통계 조회가 완료됐습니다/);

  context.fetch = async () => new Response('error code: 502\n', {
    status: 502,
    headers: { 'content-type': 'text/plain; charset=UTF-8', 'cf-ray': 'test-ray-SIN' }
  });
  await context.window.__adminAnalyticsTest.loadAnalytics(7);
  assert.match(elements['analytics-status'].textContent, /HTTP 502/);
  assert.match(elements['analytics-status'].textContent, /text\/plain; charset=UTF-8/);
  assert.match(elements['analytics-status'].textContent, /CF-Ray test-ray-SIN/);
});
