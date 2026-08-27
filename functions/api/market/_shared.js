export const SCHEMA_VERSION = '1.0.1';
export const MAX_PAYLOAD_BYTES = 512 * 1024;
export const TABLE_NAME = 'market_close_snapshots';
export const SCHEMA_PATH = '/contracts/market_close/market_close.schema.json';
// The editorial one-liner is written by hand while the market payload is
// machine-generated, so it is stored beside the session rather than inside
// the contract. Keeping them on one row is what makes it impossible for the
// homepage to show one date's numbers under another date's sentence.
export const MAX_TAKEAWAY_LENGTH = 400;

const schemaPromises = new WeakMap();

export function json(body, status = 200, cacheControl = 'no-store', extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      ...extraHeaders
    }
  });
}

export function isProductionRequest(request) {
  try { return new URL(request.url).hostname === 'snowshagal.com'; }
  catch (_) { return false; }
}

function constantTimeEqual(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export function authorizePublish(request, env) {
  const marketKey = request.headers.get('x-market-publish-key') || '';
  const adminKey = request.headers.get('x-admin-key') || '';
  if (env.MARKET_PUBLISH_KEY && constantTimeEqual(marketKey, env.MARKET_PUBLISH_KEY)) return 'market-publish-key';
  if (env.ADMIN_KEY && constantTimeEqual(adminKey, env.ADMIN_KEY)) return 'admin-key';
  return '';
}

export async function ensureMarketTable(env) {
  const db = env.COMMENTS_DB;
  if (!db) throw new MarketDbError('DB_NOT_CONFIGURED', 'Market Close 데이터베이스가 연결되지 않았습니다.', 503);
  if (!schemaPromises.has(db)) {
    const promise = (async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        market_date TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        published_at TEXT NOT NULL,
        auth_source TEXT NOT NULL,
        takeaway_ko TEXT NOT NULL DEFAULT '',
        takeaway_en TEXT NOT NULL DEFAULT ''
      )`).run();
      // Tables created before the one-liner existed need the columns added.
      for (const column of ['takeaway_ko', 'takeaway_en']) {
        try { await db.prepare(`ALTER TABLE ${TABLE_NAME} ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`).run(); }
        catch (_) { /* already present */ }
      }
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_market_close_generated ON ${TABLE_NAME} (generated_at)`).run();
    })().catch(error => {
      schemaPromises.delete(db);
      throw error;
    });
    schemaPromises.set(db, promise);
  }
  try { await schemaPromises.get(db); }
  catch (error) {
    console.error('market close schema init failed', error);
    throw new MarketDbError('DB_INIT_FAILED', 'Market Close 데이터베이스 초기화에 실패했습니다.', 500);
  }
  return db;
}

export class MarketDbError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function loadMarketSchema(request, env) {
  if (!env?.ASSETS?.fetch) throw new MarketDbError('SCHEMA_UNAVAILABLE', 'Market Close JSON Schema를 불러올 수 없습니다.', 500);
  try {
    const response = await env.ASSETS.fetch(new Request(new URL(SCHEMA_PATH, request.url), { headers: { accept: 'application/json' } }));
    if (!response.ok) throw new Error(`SCHEMA_HTTP_${response.status}`);
    const schema = await response.json();
    if (schema?.properties?.meta?.properties?.schema_version?.const !== SCHEMA_VERSION) throw new Error('SCHEMA_VERSION_MISMATCH');
    return schema;
  } catch (error) {
    console.error('market close schema load failed', error);
    throw new MarketDbError('SCHEMA_UNAVAILABLE', 'Market Close JSON Schema를 불러올 수 없습니다.', 500);
  }
}

function resolveRef(reference, rootSchema) {
  if (!String(reference || '').startsWith('#/')) return null;
  return reference.slice(2).split('/').reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], rootSchema);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, expected) {
  const types = Array.isArray(expected) ? expected : [expected];
  return types.some(type => {
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'integer') return Number.isSafeInteger(value);
    if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (type === 'array') return Array.isArray(value);
    if (type === 'null') return value === null;
    return typeof value === type;
  });
}

function isDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function validateNode(value, schema, path, errors, rootSchema) {
  if (!schema || errors.length >= 100) return;
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, rootSchema);
    if (!resolved) errors.push(`${path}: 지원하지 않는 schema reference입니다.`);
    else validateNode(value, resolved, path, errors, rootSchema);
    return;
  }
  if (schema.anyOf) {
    const passed = schema.anyOf.some(candidate => {
      const candidateErrors = [];
      validateNode(value, candidate, path, candidateErrors, rootSchema);
      return candidateErrors.length === 0;
    });
    if (!passed) errors.push(`${path}: 허용된 형식과 일치하지 않습니다.`);
    return;
  }
  if (schema.const !== undefined && !Object.is(value, schema.const)) errors.push(`${path}: ${JSON.stringify(schema.const)} 값이어야 합니다.`);
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) errors.push(`${path}: 허용되지 않은 값입니다.`);
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path}: ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type} 형식이어야 합니다 (현재 ${valueType(value)}).`);
    return;
  }
  if (schema.format === 'date' && !isDate(value)) errors.push(`${path}: YYYY-MM-DD 날짜여야 합니다.`);
  if (schema.format === 'date-time' && !isDateTime(value)) errors.push(`${path}: ISO 8601 date-time이어야 합니다.`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: 최소값은 ${schema.minimum}입니다.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: 최대값은 ${schema.maximum}입니다.`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 항목이 최소 ${schema.minItems}개 필요합니다.`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: 항목은 최대 ${schema.maxItems}개입니다.`);
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, `${path}[${index}]`, errors, rootSchema));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: 필수 필드가 없습니다.`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) errors.push(`${path}.${key}: 계약에 없는 필드입니다.`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validateNode(value[key], childSchema, `${path}.${key}`, errors, rootSchema);
    }
  }
  for (const part of schema.allOf || []) validateNode(value, part, path, errors, rootSchema);
  if (schema.if) {
    const conditionErrors = [];
    validateNode(value, schema.if, path, conditionErrors, rootSchema);
    validateNode(value, conditionErrors.length === 0 ? schema.then : schema.else, path, errors, rootSchema);
  }
}

export function validateMarketPayload(payload, schema) {
  const errors = [];
  if (!schema || typeof schema !== 'object') errors.push('$: JSON Schema가 없습니다.');
  else validateNode(payload, schema, '$', errors, schema);
  if (payload?.meta?.status !== 'final') errors.push('$.meta.status: publish API는 final 데이터만 허용합니다.');
  if (payload?.meta?.schema_version !== SCHEMA_VERSION) errors.push(`$.meta.schema_version: ${SCHEMA_VERSION}이어야 합니다.`);
  if (payload?.validation?.passed !== true) errors.push('$.validation.passed: true여야 합니다.');
  if (!Array.isArray(payload?.validation?.errors) || payload.validation.errors.length !== 0) errors.push('$.validation.errors: 비어 있어야 합니다.');
  return { passed: errors.length === 0, errors: Array.from(new Set(errors)).slice(0, 100) };
}
