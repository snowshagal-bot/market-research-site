import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const localePath = fileURLToPath(new URL('../assets/locale.js', import.meta.url));

async function localeRuntime() {
  const window = {};
  const context = vm.createContext({ window, Intl, Date, console });
  vm.runInContext(await read('assets/locale.js'), context);
  return window.MARKET_LOCALE;
}

// Market page runtime with the shared locale helper loaded first, exactly as
// the page does (`locale.js` precedes `market-close.js` in the script order).
async function marketRuntime(lang) {
  const document = {
    documentElement: { dataset: { siteLang: lang } },
    body: { dataset: {} },
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(await read('assets/locale.js'), context);
  vm.runInContext(await read('assets/market-close.js'), context);
  return window.MARKET_CLOSE;
}

const NOW = '2026-09-16T12:00:00+09:00';

test('collector +07:00 stamps are shown as Asia/Seoul wall clock without microseconds or ISO text', async () => {
  const locale = await localeRuntime();
  const input = '2026-09-15T19:52:01.276638+07:00';
  assert.equal(locale.formatKstTimestamp(input, 'ko', { now: NOW }), '9월 15일 21:52 KST');
  assert.equal(locale.formatKstTimestamp(input, 'en', { now: NOW }), 'Sep 15, 21:52 KST');
  assert.equal(locale.formatDataUpdated(input, 'ko', { now: NOW }), '데이터 갱신 · 9월 15일 21:52 KST');
  assert.equal(locale.formatDataUpdated(input, 'en', { now: NOW }), 'Data updated · Sep 15, 21:52 KST');
});

test('UTC stamps convert to KST and dates roll over past midnight', async () => {
  const locale = await localeRuntime();
  assert.equal(locale.formatKstTimestamp('2026-09-15T07:06:00Z', 'ko', { now: NOW }), '9월 15일 16:06 KST');
  assert.equal(locale.formatKstTimestamp('2026-09-15T07:06:00Z', 'en', { now: NOW }), 'Sep 15, 16:06 KST');
  assert.equal(locale.formatKstTimestamp('2026-09-15T16:30:00Z', 'en', { now: NOW }), 'Sep 16, 01:30 KST');
  assert.equal(locale.formatKstTimestamp('2026-09-15T16:30:00Z', 'ko', { now: NOW }), '9월 16일 01:30 KST');
  // Midnight in Seoul must print 00, never 24.
  assert.equal(locale.formatKstTimestamp('2026-09-15T15:00:00Z', 'en', { now: NOW }), 'Sep 16, 00:00 KST');
  // A stamp that crosses the year boundary in KST reads as the new year.
  assert.equal(locale.formatKstTimestamp('2025-12-31T15:30:00Z', 'ko', { now: NOW }), '1월 1일 00:30 KST');
});

test('the year appears only when it differs from the current year in Seoul', async () => {
  const locale = await localeRuntime();
  const older = '2025-12-30T07:06:00Z';
  assert.equal(locale.formatKstTimestamp(older, 'ko', { now: NOW }), '2025년 12월 30일 16:06 KST');
  assert.equal(locale.formatKstTimestamp(older, 'en', { now: NOW }), 'Dec 30, 2025, 16:06 KST');
  assert.equal(locale.formatDataUpdated(older, 'ko', { now: NOW }), '데이터 갱신 · 2025년 12월 30일 16:06 KST');
  assert.equal(locale.formatDataUpdated(older, 'en', { now: NOW }), 'Data updated · Dec 30, 2025, 16:06 KST');
  // "Current year" is measured in Seoul as well: 2025-12-31T20:00Z is already 2026 in KST.
  assert.equal(locale.formatKstTimestamp('2026-01-05T03:00:00Z', 'en', { now: '2025-12-31T20:00:00Z' }), 'Jan 5, 12:00 KST');
  assert.equal(locale.formatKstTimestamp(older, 'en', { now: NOW, alwaysYear: true }), 'Dec 30, 2025, 16:06 KST');
});

test('missing or malformed stamps never surface Invalid Date, NaN, or undefined', async () => {
  const locale = await localeRuntime();
  for (const value of [null, undefined, '', '   ', 'not-a-date', '2026-13-45T99:99:99Z', 12345, {}, [], NaN, new Date('garbage')]) {
    assert.equal(locale.formatKstTimestamp(value, 'ko', { now: NOW }), null, `ko ${String(value)}`);
    assert.equal(locale.formatKstTimestamp(value, 'en', { now: NOW }), null, `en ${String(value)}`);
    assert.equal(locale.formatDataUpdated(value, 'en', { now: NOW }), null, `label ${String(value)}`);
  }
  // Offset-less strings are read as UTC, never as the browser's local time.
  assert.equal(locale.formatKstTimestamp('2026-09-15T07:06:00', 'en', { now: NOW }), 'Sep 15, 16:06 KST');
  assert.equal(locale.formatKstTimestamp('2026-09-15T07:06:00.5', 'en', { now: NOW }), 'Sep 15, 16:06 KST');
  assert.equal(locale.formatKstTimestamp('2026-09-15 07:06:00+0000', 'en', { now: NOW }), 'Sep 15, 16:06 KST');
  assert.equal(locale.formatKstTimestamp('2026-09-15T07:06Z', 'en', { now: NOW }), 'Sep 15, 16:06 KST');
});

test('output is identical whatever the host timezone is (UTC, Bangkok, New York, Seoul)', () => {
  const script = `
    const vm = require('node:vm');
    const fs = require('node:fs');
    const window = {};
    const context = vm.createContext({ window, Intl, Date, console });
    vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
    const L = window.MARKET_LOCALE;
    const now = '${NOW}';
    process.stdout.write(JSON.stringify([
      L.formatKstTimestamp('2026-09-15T19:52:01.276638+07:00', 'ko', { now }),
      L.formatKstTimestamp('2026-09-15T19:52:01.276638+07:00', 'en', { now }),
      L.formatKstTimestamp('2026-09-15T07:06:00Z', 'en', { now }),
      L.formatKstTimestamp('2026-09-15T16:30:00Z', 'en', { now }),
      L.formatKstTimestamp('2026-09-15T07:06:00', 'en', { now }),
      L.formatKstTimestamp('2025-12-30T07:06:00Z', 'ko', { now }),
      L.formatDataUpdated(null, 'ko', { now })
    ]));
  `;
  const expected = JSON.stringify([
    '9월 15일 21:52 KST',
    'Sep 15, 21:52 KST',
    'Sep 15, 16:06 KST',
    'Sep 16, 01:30 KST',
    'Sep 15, 16:06 KST',
    '2025년 12월 30일 16:06 KST',
    null
  ]);
  for (const tz of ['UTC', 'Asia/Bangkok', 'America/New_York', 'Asia/Seoul', 'Pacific/Kiritimati']) {
    const result = spawnSync(process.execPath, ['-e', script, localePath], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `TZ=${tz} exited ${result.status}: ${result.stderr}`);
    assert.equal(result.stdout, expected, `TZ=${tz}`);
  }
});

test('the Market page footer prints the shared KST stamp instead of the raw generated_at string', async () => {
  const example = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const rawStamp = example.meta.generated_at;
  assert.match(rawStamp, /\+07:00$/, 'fixture keeps the collector offset so the test proves the conversion');
  const expected = { ko: /데이터 갱신 · (?:\d{4}년 )?8월 30일 18:32 KST · 1\.1\.0/, en: /Data updated · Aug 30(?:, \d{4})?, 18:32 KST · 1\.1\.0/ };
  for (const lang of ['ko', 'en']) {
    const runtime = await marketRuntime(lang);
    const target = { innerHTML: '' };
    runtime.render(structuredClone(example), target);
    const note = target.innerHTML.slice(target.innerHTML.indexOf('market-data-note'));
    assert.match(note, expected[lang], lang);
    assert.doesNotMatch(target.innerHTML, /\+07:00/, `${lang}: collector offset leaked`);
    assert.doesNotMatch(target.innerHTML, /\d{2}:\d{2}:\d{2}\.\d+/, `${lang}: microseconds leaked`);
    assert.doesNotMatch(target.innerHTML, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, `${lang}: ISO timestamp leaked`);
    assert.doesNotMatch(target.innerHTML, /Invalid Date|NaN|undefined/, `${lang}: broken value leaked`);
    assert.doesNotMatch(target.innerHTML, /생성:|Generated:/, `${lang}: old label remains`);
    // The regular-session basis line is a different concept and stays as it was.
    assert.match(target.innerHTML, lang === 'ko' ? /15:30 KST 마감 기준/ : /Korea close as of 15:30 KST/);
  }
});

test('an unparseable generated_at falls back to the site convention `--` without hiding the schema note', async () => {
  const example = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  for (const [lang, label] of [['ko', '데이터 갱신 · --'], ['en', 'Data updated · --']]) {
    for (const broken of [null, '', 'yesterday']) {
      const runtime = await marketRuntime(lang);
      const payload = structuredClone(example);
      payload.meta.generated_at = broken;
      const target = { innerHTML: '' };
      runtime.render(payload, target);
      assert.ok(target.innerHTML.includes(`${label} · 1.1.0`), `${lang} ${String(broken)}`);
      assert.doesNotMatch(target.innerHTML, /Invalid Date|NaN|undefined/);
    }
  }
});

test('every public Market/Home surface loads locale.js before the script that prints the stamp', async () => {
  for (const page of ['market/index.html', 'en/market/index.html', 'index.html', 'en/index.html']) {
    const html = await read(page);
    const localeAt = html.indexOf('/assets/locale.js');
    assert.ok(localeAt > -1, `${page} loads locale.js`);
    const marketAt = html.indexOf('/assets/market-close.js');
    if (marketAt > -1) assert.ok(localeAt < marketAt, `${page}: locale.js precedes market-close.js`);
    // No static page ships a raw collector timestamp either.
    assert.doesNotMatch(html, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+07:00/);
  }
});
