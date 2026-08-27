import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequestPost as publishRequest } from '../functions/api/market/publish.js';
import { onRequestGet as latestRequest } from '../functions/api/market/latest.js';
import { MAX_TAKEAWAY_LENGTH, TABLE_NAME } from '../functions/api/market/_shared.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const PAYLOAD = JSON.parse(await read('contracts/market_close/market_close.example.json'));
const SCHEMA = await read('contracts/market_close/market_close.schema.json');

/**
 * Minimal D1 stand-in: one table, keyed by market_date, with the columns the
 * shared schema creates plus whatever ALTER TABLE adds.
 */
function fakeDb({ alterError = null } = {}) {
  const rows = new Map();
  const statements = [];
  return {
    rows,
    statements,
    prepare(sql) {
      statements.push(sql);
      return {
        bind(...args) { return this._bound(args); },
        _bound(args) {
          return {
            async run() {
              if (/^INSERT INTO/.test(sql)) {
                const [market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en] = args;
                rows.set(market_date, { market_date, schema_version, generated_at, status, payload_json, published_at, auth_source, takeaway_ko, takeaway_en });
              }
              return { success: true };
            },
            async first() {
              if (/WHERE market_date = \?/.test(sql)) return rows.get(args[0]) || null;
              return null;
            }
          };
        },
        async run() {
          if (/ALTER TABLE/.test(sql) && alterError) throw alterError;
          return { success: true };
        },
        async first() {
          const all = [...rows.values()].sort((a, b) => b.market_date.localeCompare(a.market_date));
          if (/ORDER BY market_date DESC/.test(sql)) return all[0] || null;
          return null;
        }
      };
    }
  };
}

function env(db) {
  return {
    COMMENTS_DB: db,
    ADMIN_KEY: 'secret',
    ASSETS: { fetch: async () => new Response(SCHEMA, { headers: { 'content-type': 'application/json' } }) }
  };
}

function publish(db, body) {
  return publishRequest({
    request: new Request('https://snowshagal.com/api/market/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'secret' },
      body: JSON.stringify(body)
    }),
    env: env(db)
  });
}

function latest(db, ifNoneMatch) {
  const headers = ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {};
  return latestRequest({ request: new Request('https://snowshagal.com/api/market/latest', { headers }), env: env(db) });
}

/* ------------------------------------------------------- storing the line */

test('the one-liner is stored on the same row as the session it describes', async () => {
  const db = fakeDb();
  const response = await publish(db, {
    market: PAYLOAD,
    takeaway: { ko: '한 줄 요약', en: 'One line' }
  });
  assert.ok(response.status === 200 || response.status === 201, `status ${response.status}`);
  assert.deepEqual((await response.json()).takeaway, { ko: true, en: true });

  const row = db.rows.get(PAYLOAD.meta.market_date);
  assert.equal(row.takeaway_ko, '한 줄 요약');
  assert.equal(row.takeaway_en, 'One line');
  // The machine-generated document is stored unchanged beside it.
  assert.deepEqual(JSON.parse(row.payload_json), PAYLOAD);
});

test('the bare contract document still publishes, with no line', async () => {
  const db = fakeDb();
  const response = await publish(db, PAYLOAD);
  assert.ok(response.ok, `status ${response.status}`);
  const row = db.rows.get(PAYLOAD.meta.market_date);
  assert.equal(row.takeaway_ko, '');
  assert.equal(row.takeaway_en, '');
});

test('each language is stored independently', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '한국어만' } });
  const row = db.rows.get(PAYLOAD.meta.market_date);
  assert.equal(row.takeaway_ko, '한국어만');
  // A missing English line is empty, never filled from Korean.
  assert.equal(row.takeaway_en, '');
});

test('an over-long line is refused rather than truncated', async () => {
  const db = fakeDb();
  const response = await publish(db, { market: PAYLOAD, takeaway: { ko: 'ㄱ'.repeat(MAX_TAKEAWAY_LENGTH + 1) } });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, 'TAKEAWAY_TOO_LONG');
  assert.equal(db.rows.size, 0, 'nothing may be stored on a rejected publish');
});

test('republishing the same date replaces the line', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '처음', en: 'first' } });
  await publish(db, { market: PAYLOAD, takeaway: { ko: '고침', en: 'second' } });
  const row = db.rows.get(PAYLOAD.meta.market_date);
  assert.equal(row.takeaway_ko, '고침');
  assert.equal(row.takeaway_en, 'second');
});

test('a table created before the line existed gains the columns', async () => {
  const shared = await read('functions/api/market/_shared.js');
  assert.match(shared, /takeaway_ko TEXT NOT NULL DEFAULT ''/);
  assert.match(shared, /ALTER TABLE \$\{TABLE_NAME\} ADD COLUMN \$\{column\} TEXT NOT NULL DEFAULT ''/);
  // A duplicate-column error on an already-migrated table must not be fatal.
  const db = fakeDb({ alterError: new Error('duplicate column name: takeaway_ko') });
  const response = await publish(db, { market: PAYLOAD, takeaway: { ko: '이주 후' } });
  assert.ok(response.ok, `status ${response.status}`);
  assert.equal(db.rows.get(PAYLOAD.meta.market_date).takeaway_ko, '이주 후');
  assert.ok(TABLE_NAME.length > 0);
});

/* ------------------------------------------------------- serving the line */

test('the latest session hands back its own line', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '한 줄', en: 'One line' } });

  const response = await latest(db);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.meta.market_date, PAYLOAD.meta.market_date);
  assert.deepEqual(body.takeaway, { ko: '한 줄', en: 'One line' });
  // The market data itself is untouched by the addition.
  assert.deepEqual(body.indices, PAYLOAD.indices);
});

test('a session published without a line returns empty strings, not nulls', async () => {
  const db = fakeDb();
  await publish(db, PAYLOAD);
  const body = await (await latest(db)).json();
  assert.deepEqual(body.takeaway, { ko: '', en: '' });
});

/* ---------------------------------------------- the admin writes them both */

test('the Market Close admin submits the line with the same market_date', async () => {
  const [script, markup] = await Promise.all([read('assets/admin-market.js'), read('admin/market/index.html')]);

  assert.match(markup, /id="market-takeaway-ko"/);
  assert.match(markup, /id="market-takeaway-en"/);
  assert.match(markup, /maxlength="400"/);
  // The form says what an empty language means, so it is a choice not an accident.
  assert.match(markup, /손대지 않은 언어는 그대로 유지되고, 직접 지우고 게시하면 그 언어만 삭제/);

  // One request carries the numbers and the lines, so they cannot be saved
  // under different dates.
  assert.match(script, /const envelope = JSON\.stringify\(\{ market: payload, takeaway \}\);/);
  assert.match(script, /body: envelope/);
  assert.doesNotMatch(script, /body: raw \}/);
});

/* ------------------------------------------------- the static file's role */

test('the static file survives only as the emergency fallback', async () => {
  const [site, summary] = await Promise.all([read('assets/site.js'), read('data/market-summary.js')]);

  // Still present, so a total API failure has something to show.
  assert.match(summary, /window\.TODAY_MARKET_SUMMARY = \{/);
  assert.match(summary, /marketDate:/);
  assert.match(summary, /takeaway:/);

  // A live session takes its line from the payload, never from the static file.
  assert.match(site, /return \{ marketDate: publishedDate, items, takeaway: localeTakeaway\(payload\?\.takeaway\), live: true \}/);
  // The fallback record is used whole: its date, numbers and line together.
  assert.match(site, /takeaway: localeTakeaway\(summary\?\.takeaway\)/);
  // Locales never substitute for one another.
  assert.match(site, /return String\(source\?\.\[locale\] \|\| ''\)\.trim\(\);/);
  assert.doesNotMatch(site, /summary\?\.takeaway\?\.ko \|\| summary\?\.takeaway\?\.en/);
});

/* ------------------------------------- every surface asks for the same file */

test('report pages request the same locale.js build as the rest of the site', async () => {
  const files = [
    'index.html', 'en/index.html', 'market/index.html', 'en/market/index.html',
    'about/index.html', 'en/about/index.html', 'admin/index.html', 'admin/market/index.html',
    'functions/_middleware.js'
  ];
  const versions = new Set();
  for (const file of files) {
    const source = await read(file);
    for (const [, version] of source.matchAll(/locale\.js\?v=([\w-]+)/g)) versions.add(version);
  }
  // Reports get their locale.js from the middleware rather than their own HTML,
  // so a bump made only in the page templates leaves readers on a stale copy.
  assert.equal(versions.size, 1, `locale.js is pinned to several builds: ${[...versions].join(', ')}`);
});

/* ------------------------------------------- a cached copy goes stale */

test('editing only the one-liner moves the ETag and re-sends the body', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '첫 문장', en: 'First line' } });
  const first = await latest(db);
  const etagA = first.headers.get('etag');
  assert.ok(etagA, 'the response must carry an ETag');
  assert.deepEqual((await first.json()).takeaway, { ko: '첫 문장', en: 'First line' });

  // Same Market Close document, same market_date, only the line is different.
  await publish(db, { market: PAYLOAD, takeaway: { ko: '고친 문장', en: 'Second line' } });
  const second = await latest(db);
  const etagB = second.headers.get('etag');
  assert.notEqual(etagB, etagA, 'the tag must move when the line changes');

  // A reader holding the old tag gets the new line, not a 304.
  const revalidated = await latest(db, etagA);
  assert.equal(revalidated.status, 200);
  assert.deepEqual((await revalidated.json()).takeaway, { ko: '고친 문장', en: 'Second line' });
  assert.equal(revalidated.headers.get('etag'), etagB);
});

test('an unchanged session still answers 304 to its own tag', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '그대로' } });
  const etag = (await latest(db)).headers.get('etag');
  const again = await latest(db, etag);
  assert.equal(again.status, 304, 'caching must still work when nothing moved');
});

/* ------------------------------- who is allowed to change which language */

test('the automated pipeline republishing bare numbers keeps the editor’s lines', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '지켜져야 한다', en: 'must survive' } });

  // The unattended job posts the contract document with no envelope.
  const response = await publish(db, PAYLOAD);
  assert.ok(response.ok, `status ${response.status}`);
  const row = db.rows.get(PAYLOAD.meta.market_date);
  assert.equal(row.takeaway_ko, '지켜져야 한다');
  assert.equal(row.takeaway_en, 'must survive');
  assert.deepEqual((await response.json()).takeaway, { ko: true, en: true });
});

test('an envelope naming one language leaves the other untouched', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '옛 한국어', en: 'old english' } });

  // Only ko is named, so only ko moves.
  await publish(db, { market: PAYLOAD, takeaway: { ko: '새 한국어' } });
  const row = db.rows.get(PAYLOAD.meta.market_date);
  assert.equal(row.takeaway_ko, '새 한국어');
  assert.equal(row.takeaway_en, 'old english');
});

test('an explicit empty string erases that language', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '지울 문장', en: 'keep me' } });

  // The admin form always sends both keys, so an empty box is a decision.
  const response = await publish(db, { market: PAYLOAD, takeaway: { ko: '', en: 'keep me' } });
  const row = db.rows.get(PAYLOAD.meta.market_date);
  assert.equal(row.takeaway_ko, '');
  assert.equal(row.takeaway_en, 'keep me');
  assert.deepEqual((await response.json()).takeaway, { ko: false, en: true });

  // And the homepage sees the erasure rather than a stale line.
  assert.deepEqual((await (await latest(db)).json()).takeaway, { ko: '', en: 'keep me' });
});

test('whitespace is not a line', async () => {
  const db = fakeDb();
  await publish(db, { market: PAYLOAD, takeaway: { ko: '실제 문장' } });
  await publish(db, { market: PAYLOAD, takeaway: { ko: '   ' } });
  assert.equal(db.rows.get(PAYLOAD.meta.market_date).takeaway_ko, '');
});

/* --------------------------------------------- migration failure handling */

test('a duplicate column is ignored but a real migration failure is not', async () => {
  const shared = await read('functions/api/market/_shared.js');
  assert.match(shared, /if \(!isDuplicateColumnError\(error\)\) throw error;/);
  assert.match(shared, /duplicate column name/i);
  // The old blanket catch would have hidden a broken table.
  assert.doesNotMatch(shared, /catch \(_\) \{ \/\* already present \*\/ \}/);

  const db = fakeDb({ alterError: new Error('database disk image is malformed') });
  const response = await publish(db, { market: PAYLOAD, takeaway: { ko: '실패해야 한다' } });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'DB_INIT_FAILED');
  assert.equal(db.rows.size, 0, 'a failed migration must not write rows');
});

test('the admin form is wired to the preservation rule', async () => {
  const [script, markup] = await Promise.all([read('assets/admin-market.js'), read('admin/market/index.html')]);

  // How the form behaves is covered by tests/admin-market-takeaway.test.mjs,
  // which runs this script against a stub DOM. These are the two ends of the
  // wire: the markup it needs, and the request shape the server rule expects.
  assert.match(markup, /id="market-takeaway-loaded"/);
  assert.match(script, /loadStoredTakeaway\(payload\.meta\?\.market_date\)/);
  assert.match(script, /const envelope = JSON\.stringify\(\{ market: payload, takeaway \}\);/);
  // An untouched language must be omitted, never sent as an empty string.
  assert.doesNotMatch(script, /takeaway: \{ ko: takeawayKo/);
});

