import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import '../assets/locale.js';

const L = globalThis.MARKET_LOCALE;

test('every KRX sector and theme index the site has stored has an English name', async () => {
  // The 85 index codes in Production's Market Close records, 2026-09 to 2026-11.
  assert.equal(L.KRX_GROUP_NAMES.length, 85);
  const codes = new Set();
  for (const [code, ko, en] of L.KRX_GROUP_NAMES) {
    assert.match(code, /^[A-Z0-9]{6}$/, code);
    assert.ok(!codes.has(code), `duplicate ${code}`);
    codes.add(code);
    assert.ok(ko && en, code);
    assert.doesNotMatch(en, /[ㄱ-ㆎ가-힣]/, `${code} English name has Korean`);
    assert.equal(L.krxGroupName({ index_code: code, name: ko }, 'en'), en);
    assert.equal(L.krxGroupName({ index_code: code, name: ko }, 'ko'), ko);
  }
  // A sector shared by KOSPI and KOSDAQ reads the same in both.
  assert.equal(L.krxGroupName({ index_code: 'KGS20P', name: '전기·가스' }, 'en'), 'Electricity & Gas');
  assert.equal(L.krxGroupName({ index_code: 'QGS33P', name: '제약' }, 'en'), L.krxGroupName({ index_code: 'KGS05P', name: '제약' }, 'en'));
});

test('an unknown KRX index keeps its own name; one without a code is found by its Korean name', () => {
  assert.equal(L.krxGroupName({ index_code: 'XGT99P', name: 'KRX 신규 지수' }, 'en'), 'KRX 신규 지수');
  assert.equal(L.krxGroupName({ name: '전기·가스' }, 'en'), 'Electricity & Gas');
  assert.equal(L.krxGroupName(null, 'en'), '');
});
