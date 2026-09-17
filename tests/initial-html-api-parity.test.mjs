import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { seededDatabase } from './helpers/initial-html-fixtures.mjs';
import { GOLDEN_NOW, FEED_CASES, CALENDAR_CASES } from './helpers/api-golden-cases.mjs';
import { onRequestGet as feedGet } from '../functions/api/disclosures/feed.js';
import { onRequestGet as calendarGet } from '../functions/api/calendar.js';

// tests/fixtures/initial-html-api-golden.json was captured from the feed and
// calendar handlers before their data logic moved into the shared server
// helpers the initial HTML now uses. Every body, status and cache header must
// still match byte for byte.
const golden = JSON.parse(await readFile(new URL('./fixtures/initial-html-api-golden.json', import.meta.url), 'utf8'));
const broken = { prepare() { throw new Error('d1 down'); }, batch() { throw new Error('d1 down'); } };

async function withFixedNow(fn) {
  const RealDate = Date;
  const fixed = new RealDate(GOLDEN_NOW).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  try { return await fn(RealDate); } finally { globalThis.Date = RealDate; }
}

async function snapshot(response) {
  return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.text() };
}

test('the disclosure feed API answers byte-for-byte as before the refactor', async () => {
  assert.equal(golden.now, GOLDEN_NOW);
  const db = await seededDatabase();
  try {
    await withFixedNow(async () => {
      for (const query of FEED_CASES) {
        const response = await feedGet({ request: new Request(`https://snowshagal.com/api/disclosures/feed${query}`), env: { COMMENTS_DB: db } });
        assert.deepEqual(await snapshot(response), golden.feed[query], `feed ${query || '(default)'}`);
      }
      const failed = await feedGet({ request: new Request('https://snowshagal.com/api/disclosures/feed'), env: { COMMENTS_DB: broken } });
      assert.deepEqual(await snapshot(failed), golden.feed['[d1-broken]'], 'feed with a failing database');
    });
  } finally { db.close(); }
});

test('the calendar API answers byte-for-byte as before the refactor', async () => {
  const db = await seededDatabase();
  try {
    await withFixedNow(async (RealDate) => {
      for (const query of CALENDAR_CASES) {
        const response = await calendarGet({ request: new Request(`https://snowshagal.com/api/calendar${query}`), env: { COMMENTS_DB: db }, now: new RealDate(GOLDEN_NOW) });
        assert.deepEqual(await snapshot(response), golden.calendar[query], `calendar ${query || '(default)'}`);
      }
      const failed = await calendarGet({ request: new Request('https://snowshagal.com/api/calendar?year=2026&month=9'), env: { COMMENTS_DB: broken }, now: new RealDate(GOLDEN_NOW) });
      assert.deepEqual(await snapshot(failed), golden.calendar['[d1-broken]?year=2026&month=9'], 'calendar with a failing database');
    });
  } finally { db.close(); }
});
