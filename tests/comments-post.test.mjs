import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const source = await readFile(new URL('../functions/api/comments.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const cloudflareMaxPbkdf2Iterations = 100000;
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const nativeCrypto = globalThis.crypto;
const observedPbkdf2Iterations = [];
const cloudflareCompatibleCrypto = {
  subtle: {
    digest: nativeCrypto.subtle.digest.bind(nativeCrypto.subtle),
    importKey: nativeCrypto.subtle.importKey.bind(nativeCrypto.subtle),
    deriveBits(algorithm, key, length) {
      if (algorithm?.name === 'PBKDF2') {
        observedPbkdf2Iterations.push(algorithm.iterations);
        if (algorithm.iterations > cloudflareMaxPbkdf2Iterations) {
          return Promise.reject(new DOMException(
            `PBKDF2 iterations above ${cloudflareMaxPbkdf2Iterations} are not supported.`,
            'NotSupportedError'
          ));
        }
      }
      return nativeCrypto.subtle.deriveBits(algorithm, key, length);
    }
  },
  getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
  randomUUID: nativeCrypto.randomUUID.bind(nativeCrypto)
};

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: cloudflareCompatibleCrypto
});

async function loadHandlers(scenario) {
  return import(`${moduleUrl}#${scenario}`);
}

class SqliteStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      success: true,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) }
    };
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
  }

  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  rows() {
    return this.database.prepare('SELECT * FROM comments ORDER BY created_at ASC').all();
  }

  run(sql, ...values) {
    return this.database.prepare(sql).run(...values);
  }

  close() {
    this.database.close();
  }
}

const report = '/reports/post-integration-test.html';
const origin = 'https://example.com';
const testIp = '203.0.113.10';
const testAdminKey = 'integration-test-admin-key';
const testPassword = 'test-password-1234';
const testEnv = db => ({ COMMENTS_DB: db, ADMIN_KEY: testAdminKey });

function postRequest(payload, { ip = testIp, requestOrigin = origin } = {}) {
  return new Request(`${origin}/api/comments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'CF-Connecting-IP': ip,
      origin: requestOrigin
    },
    body: JSON.stringify(payload)
  });
}

function deleteRequest(id, password) {
  return new Request(`${origin}/api/comments`, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      origin
    },
    body: JSON.stringify({ id, report, password })
  });
}

function validPayload(overrides = {}) {
  return {
    report,
    nickname: '테스터',
    body: '댓글 POST 통합 테스트',
    password: testPassword,
    website: '',
    ...overrides
  };
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

const encoder = new TextEncoder();
const postDb = new SqliteD1();
const postHandlers = await loadHandlers('post-success');
const postStartedAt = performance.now();
const postResponse = await postHandlers.onRequestPost({
  request: postRequest(validPayload()),
  env: testEnv(postDb)
});
const postDurationMs = performance.now() - postStartedAt;
const postBody = await postResponse.json();

assert.equal(postResponse.status, 201);
assert.equal(postBody.ok, true);

const storedRows = postDb.rows();
assert.equal(storedRows.length, 1);
const stored = storedRows[0];
assert.equal(stored.report_key, report);
assert.equal(stored.nickname, '테스터');
assert.equal(stored.body, '댓글 POST 통합 테스트');
assert.equal(stored.deleted_at, null);
assert.match(stored.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

const expectedIpDigest = await crypto.subtle.digest(
  'SHA-256', encoder.encode(`${testIp}|${testAdminKey}`)
);
assert.equal(stored.ip_hash, bytesToBase64(new Uint8Array(expectedIpDigest)));

const storedSalt = Buffer.from(stored.password_salt, 'base64');
assert.equal(storedSalt.length, 16);
const passwordKey = await crypto.subtle.importKey(
  'raw', encoder.encode(testPassword), 'PBKDF2', false, ['deriveBits']
);
const expectedPasswordHash = await crypto.subtle.deriveBits({
  name: 'PBKDF2',
  salt: storedSalt,
  iterations: 100000,
  hash: 'SHA-256'
}, passwordKey, 256);
const storedHashMatch = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9+/]{43}=)$/.exec(stored.password_hash);
assert.ok(storedHashMatch);
assert.equal(Number(storedHashMatch[1]), 100000);
assert.equal(storedHashMatch[2], bytesToBase64(new Uint8Array(expectedPasswordHash)));

const getResponse = await postHandlers.onRequestGet({
  request: new Request(`${origin}/api/comments?report=${encodeURIComponent(report)}`),
  env: testEnv(postDb)
});

assert.equal(getResponse.status, 200);
assert.deepEqual(await getResponse.json(), {
  ok: true,
  comments: [postBody.comment]
});

const wrongPasswordResponse = await postHandlers.onRequestDelete({
  request: deleteRequest(postBody.comment.id, 'wrong-password'),
  env: testEnv(postDb)
});
assert.equal(wrongPasswordResponse.status, 401);
assert.equal((await wrongPasswordResponse.json()).error, 'BAD_PASSWORD');
assert.equal(postDb.rows()[0].deleted_at, null);

const correctPasswordResponse = await postHandlers.onRequestDelete({
  request: deleteRequest(postBody.comment.id, testPassword),
  env: testEnv(postDb)
});
assert.equal(correctPasswordResponse.status, 200);
assert.equal((await correctPasswordResponse.json()).ok, true);
assert.notEqual(postDb.rows()[0].deleted_at, null);

const afterDeleteResponse = await postHandlers.onRequestGet({
  request: new Request(`${origin}/api/comments?report=${encodeURIComponent(report)}`),
  env: testEnv(postDb)
});
assert.equal(afterDeleteResponse.status, 200);
assert.deepEqual(await afterDeleteResponse.json(), { ok: true, comments: [] });
postDb.close();

const invalidHashDb = new SqliteD1();
const invalidHashHandlers = await loadHandlers('invalid-hash');
const invalidHashPostResponse = await invalidHashHandlers.onRequestPost({
  request: postRequest(validPayload(), { ip: '203.0.113.11' }),
  env: testEnv(invalidHashDb)
});
assert.equal(invalidHashPostResponse.status, 201);
const invalidHashComment = (await invalidHashPostResponse.json()).comment;
const validHashBody = invalidHashDb.rows()[0].password_hash.split('$')[2];

invalidHashDb.run(
  'UPDATE comments SET password_hash = ? WHERE id = ?',
  `unknown$100000$${validHashBody}`,
  invalidHashComment.id
);
const unknownHashResponse = await invalidHashHandlers.onRequestDelete({
  request: deleteRequest(invalidHashComment.id, testPassword),
  env: testEnv(invalidHashDb)
});
assert.equal(unknownHashResponse.status, 401);
assert.equal(invalidHashDb.rows()[0].deleted_at, null);

invalidHashDb.run(
  'UPDATE comments SET password_hash = ? WHERE id = ?',
  `pbkdf2-sha256$100001$${validHashBody}`,
  invalidHashComment.id
);
const unsupportedIterationsResponse = await invalidHashHandlers.onRequestDelete({
  request: deleteRequest(invalidHashComment.id, testPassword),
  env: testEnv(invalidHashDb)
});
assert.equal(unsupportedIterationsResponse.status, 401);
assert.equal(invalidHashDb.rows()[0].deleted_at, null);
invalidHashDb.close();

const rateDb = new SqliteD1();
const rateHandlers = await loadHandlers('rate-limit');
for (let index = 0; index < 5; index += 1) {
  const response = await rateHandlers.onRequestPost({
    request: postRequest(validPayload({ body: `rate-limit-${index}` })),
    env: testEnv(rateDb)
  });
  assert.equal(response.status, 201);
}

const limitedResponse = await rateHandlers.onRequestPost({
  request: postRequest(validPayload({ body: 'rate-limit-blocked' })),
  env: testEnv(rateDb)
});

assert.equal(limitedResponse.status, 429);
assert.equal((await limitedResponse.json()).error, 'RATE_LIMIT');
assert.equal(rateDb.rows().length, 5);
rateDb.close();

const invalidDb = new SqliteD1();
const invalidHandlers = await loadHandlers('invalid-input');
const invalidCases = [
  [validPayload({ report: '/not-a-report.html' }), 'BAD_REPORT'],
  [validPayload({ nickname: 'x' }), 'BAD_NICKNAME'],
  [validPayload({ body: '' }), 'BAD_BODY'],
  [validPayload({ password: '123' }), 'BAD_PASSWORD']
];

for (const [payload, expectedError] of invalidCases) {
  const response = await invalidHandlers.onRequestPost({
    request: postRequest(payload),
    env: testEnv(invalidDb)
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, expectedError);
}

const badJsonResponse = await invalidHandlers.onRequestPost({
  request: new Request(`${origin}/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: '{'
  }),
  env: testEnv(invalidDb)
});
assert.equal(badJsonResponse.status, 400);
assert.equal((await badJsonResponse.json()).error, 'BAD_JSON');

const badOriginResponse = await invalidHandlers.onRequestPost({
  request: postRequest(validPayload(), { requestOrigin: 'https://attacker.example' }),
  env: testEnv(invalidDb)
});
assert.equal(badOriginResponse.status, 403);
assert.equal((await badOriginResponse.json()).error, 'BAD_ORIGIN');
assert.equal(invalidDb.rows().length, 0);
invalidDb.close();

const benchmarkKey = await crypto.subtle.importKey(
  'raw', encoder.encode('benchmark-password'), 'PBKDF2', false, ['deriveBits']
);
const benchmarkSalt = crypto.getRandomValues(new Uint8Array(16));
const pbkdf2Samples = [];
for (let index = 0; index < 5; index += 1) {
  const startedAt = performance.now();
  await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: benchmarkSalt,
    iterations: 100000,
    hash: 'SHA-256'
  }, benchmarkKey, 256);
  pbkdf2Samples.push(performance.now() - startedAt);
}

assert.equal(Math.max(...observedPbkdf2Iterations), cloudflareMaxPbkdf2Iterations);
await assert.rejects(
  crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: benchmarkSalt,
    iterations: 100001,
    hash: 'SHA-256'
  }, benchmarkKey, 256),
  error => error?.name === 'NotSupportedError'
);

const pbkdf2AverageMs = pbkdf2Samples.reduce((sum, value) => sum + value, 0) / pbkdf2Samples.length;
console.log(JSON.stringify({
  result: 'comments POST integration tests passed',
  postDurationMs: Number(postDurationMs.toFixed(3)),
  pbkdf2Ms: {
    min: Number(Math.min(...pbkdf2Samples).toFixed(3)),
    average: Number(pbkdf2AverageMs.toFixed(3)),
    max: Number(Math.max(...pbkdf2Samples).toFixed(3))
  }
}));

Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
