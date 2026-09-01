import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const PAGE = await read('admin/disclosures/index.html');

/* --------------------------------------------------------------- the form */

test('a company is added with both purposes chosen, not inferred', async () => {
  assert.match(PAGE, /id="wl-add-disclosure"/);
  assert.match(PAGE, /id="wl-add-calendar"/);
  assert.match(PAGE, /id="wl-add-name-en"/);

  // Both default to on, which is what the seeded companies already are.
  assert.match(PAGE, /id="wl-add-disclosure" checked/);
  assert.match(PAGE, /id="wl-add-calendar" checked/);

  // And both travel with the request.
  assert.match(PAGE, /action: 'add', stockCode, corpName, corpNameEn, corpCls, disclosureEnabled, calendarEnabled/);
});

test('a company with neither purpose is refused before it is sent', async () => {
  assert.match(PAGE, /if \(!disclosureEnabled && !calendarEnabled\)/);
  assert.match(PAGE, /공시 중요기업 또는 캘린더 추적 중 하나는 선택해야 합니다/);
});

test('the English name is optional, and marked as such', async () => {
  assert.match(PAGE, /영문명 \(선택\)/);
});

/* --------------------------------------------------------------- the list */

test('each company shows its two switches independently', async () => {
  assert.match(PAGE, /data-flag="disclosure"/);
  assert.match(PAGE, /data-flag="calendar"/);
  assert.match(PAGE, /w\.disclosureEnabled \? 'checked' : ''/);
  assert.match(PAGE, /w\.calendarEnabled \? 'checked' : ''/);
  // The header names them the way the operator thinks of them.
  assert.match(PAGE, /<span>회사<\/span><span>공시 중요기업<\/span><span>캘린더 추적<\/span>/);
});

test('flipping one switch sends only that one', async () => {
  assert.match(PAGE, /const body = \{ action: 'flags', stockCode \};/);
  assert.match(PAGE, /if \(flag === 'disclosure'\) body\.disclosureEnabled = enabled;/);
  assert.match(PAGE, /else body\.calendarEnabled = enabled;/);
});

test('the list is redrawn from the answer, so the screen matches what was saved', async () => {
  const handler = /async function setWatchlistFlag\([\s\S]*?\n  \}/.exec(PAGE)?.[0] || '';
  assert.ok(handler, 'the flag handler must exist');
  assert.match(handler, /watchlist = data\.watchlist \|\| \[\];/);
  assert.match(handler, /renderWatchlist\(\);/);
  // A refused change puts the switch back rather than leaving a lie on screen.
  assert.match(handler, /input\.checked = previous;/);
  assert.match(handler, /setStatus\(e\.message, true\);/);
});

test('the panel says what each switch is for', async () => {
  assert.match(PAGE, /공시 중요기업은 MARKET 자동게시 우선순위에, 캘린더 추적은 기업 일정 수집에 쓰입니다\. 두 설정은 독립적입니다\./);
});

/* ------------------------------------------------- the surrounding rules */

test('the panel is still admin-only and still uses the existing auth', async () => {
  assert.match(PAGE, /<meta name="robots" content="noindex/);
  // Every mutation goes through the same authenticated endpoint as before.
  const calls = [...PAGE.matchAll(/request\('([^']+)'/g)].map(match => match[1]);
  for (const path of calls) assert.match(path, /^\/api\//);
  assert.ok(calls.includes('/api/disclosures/watchlist'));
});

test('adding and removing still refresh the count in the button', async () => {
  const occurrences = PAGE.match(/관심기업 관리 \(\$\{watchlist\.length\}\)/g) || [];
  assert.ok(occurrences.length >= 3, 'load, add and remove each refresh it');
});

test('the rows stay legible on a narrow screen', async () => {
  assert.match(PAGE, /@media\(max-width:720px\)\{[^}]*\.wl-add-form\{grid-template-columns:1fr 1fr\}/);
  assert.match(PAGE, /\.wl-row\{grid-template-columns:minmax\(0,1fr\) 64px 64px 36px/);
});

/* ------------------------------------------- the API the panel talks to */

test('the watchlist endpoint accepts the flags action', async () => {
  const api = await read('functions/api/disclosures/watchlist.js');
  assert.match(api, /if \(action === 'flags'\)/);
  assert.match(api, /setWatchlistFlags\(db, input\.stockCode, \{/);
  assert.match(api, /add, delete, toggle, flags/);
  // Mutation still requires an authenticated admin on an allowed origin.
  assert.match(api, /humanAdminHostAllowed\(request\)/);
  assert.match(api, /authorizeAdmin\(request, env\)/);
  assert.match(api, /humanAdminMutationPolicy\(request, env\)/);
});
