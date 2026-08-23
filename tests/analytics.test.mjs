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
    fields: ['date', 'siteTag', 'requestPath', 'refererHost', 'countryName', 'deviceType', 'userAgentBrowser', 'userAgentOS']
      .map((name) => typeField(name, ref('String', 'SCALAR')))
  },
  RumPageloadFilter_InputObject: {
    kind: 'INPUT_OBJECT', name: 'RumPageloadFilter_InputObject', fields: null,
    inputFields: [
      typeField('date_geq', ref('Date', 'SCALAR')),
      typeField('date_leq', ref('Date', 'SCALAR')),
      typeField('siteTag_in', { kind: 'LIST', name: null, ofType: ref('String', 'SCALAR') })
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
      ? { viewer: { accounts: [{ trend: [], pages: [], referers: [], countries: [], devices: [], browsers: [], operatingSystems: [] }] } }
      : analyticsRows();
    return Response.json({ data });
  };
  return calls;
}

function request(key = ENV.ADMIN_KEY, range = 7) {
  return new Request(`https://preview.example/api/analytics?range=${range}`, {
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
    assert.deepEqual(data.totals, { visits: 5, pageViews: 11 });
    assert.equal(data.topPages[0].label, '/reports/alpha');
    assert.deepEqual(data.referrers.map((item) => item.label), ['Google', 'Direct', 'Tistory']);
    assert.equal(calls[0].query.includes('__schema'), true);
    const query = calls.at(-1).query;
    assert.match(query, /rumPageloadEventsAdaptiveGroups/);
    for (const field of ['date', 'requestPath', 'refererHost', 'countryName', 'deviceType', 'userAgentBrowser', 'userAgentOS']) assert.match(query, new RegExp(`dimensions \\{ ${field} \\}`));
    assert.match(query, /siteTag_in: \["site-tag-secret"\]/);
    assert.match(query, /accountTag: "account-tag"/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.doesNotMatch(JSON.stringify(data), /analytics-token-secret|site-tag-secret|account-tag/);
  } finally { globalThis.fetch = originalFetch; }
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
    assert.deepEqual(data.topPages, []);
  } finally { globalThis.fetch = originalFetch; }
});

test('Cloudflare GraphQL errors are distinct from zero data and sanitized', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  __test.resetSchemaCache();
  globalThis.fetch = async () => Response.json({ errors: [{ message: 'internal account detail' }] });
  try {
    const response = await onRequestGet({ request: request(), env: ENV });
    const data = await response.json();
    assert.equal(response.status, 502);
    assert.equal(data.ok, false);
    assert.equal(data.error, 'ANALYTICS_QUERY_FAILED');
    assert.doesNotMatch(data.message, /internal account detail/);
  } finally { globalThis.fetch = originalFetch; }
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
    dimensions: { date: 'date', path: 'requestPath', referer: 'refererHost', country: 'countryName', device: 'deviceType', browser: 'userAgentBrowser', os: 'userAgentOS' },
    visits: { container: 'sum', field: 'visits' },
    filters: { start: 'datetime_geq', end: 'datetime_lt', siteTag: 'siteTag_in', siteTagList: true, datetime: true },
    countOrder: 'count_DESC', dateOrder: 'date_ASC'
  }, 'account', 'site', { start: '2026-08-17', end: '2026-08-23' });
  assert.match(datetimeQuery, /datetime_geq: "2026-08-17T00:00:00\.000Z"/);
  assert.match(datetimeQuery, /datetime_lt: "2026-08-24T00:00:00\.000Z"/);
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

test('analytics page keeps secrets server-side and renders authenticated zero data without breaking', async () => {
  const html = await readFile(new URL('../admin/analytics/index.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../assets/admin-analytics.js', import.meta.url), 'utf8');
  assert.match(html, /meta name="robots" content="noindex,nofollow"/);
  assert.match(html, /사용자 국적이 아닌 접속 위치 기준 국가/);
  assert.match(html, /href="\.\.\/manage\/">게시물 관리/);
  assert.doesNotMatch(`${html}\n${client}`, /CLOUDFLARE_(?:ACCOUNT_ID|ANALYTICS_API_TOKEN|WEB_ANALYTICS_SITE_TAG)|analytics-token-secret|site-tag-secret/);

  const ids = ['analytics-admin-key', 'analytics-load', 'analytics-dashboard', 'analytics-status', 'metric-visits', 'metric-pageviews', 'metric-depth', 'analytics-period', 'analytics-empty', 'trend-chart', 'top-pages', 'top-referers', 'top-countries', 'top-devices', 'top-browsers', 'top-os', 'analytics-source'];
  const elements = Object.fromEntries(ids.map((id) => [id, element(id)]));
  elements['analytics-dashboard'].hidden = true;
  const ranges = [1, 7, 28].map((range) => { const button = element(); button.dataset.range = String(range); return button; });
  const theme = element();
  const context = {
    console,
    Intl,
    fetch: async () => Response.json({
      ok: true, generatedAt: '2026-08-23T00:00:00.000Z', empty: true,
      range: { days: 7, from: '2026-08-17', to: '2026-08-23', timezone: 'UTC' },
      totals: { visits: 0, pageViews: 0 }, trend: [], topPages: [], referrers: [], countries: [], devices: [], browsers: [], operatingSystems: [],
      source: { dataset: 'rumPageloadEventsAdaptiveGroups' }
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
  assert.equal(elements['analytics-empty'].hidden, false);
  assert.match(elements['analytics-status'].textContent, /아직 수집된 데이터가 없습니다/);
});
