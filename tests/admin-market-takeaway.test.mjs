import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const SCRIPT = await read('assets/admin-market.js');
const EXAMPLE = JSON.parse(await read('contracts/market_close/market_close.example.json'));

const ELEMENT_IDS = [
  'market-json-file', 'market-json-drop', 'market-file-name', 'market-meta-date',
  'market-meta-version', 'market-meta-status', 'market-meta-validation', 'market-validation',
  'market-admin-key', 'market-publish-button', 'market-publish-status', 'market-preview-root',
  'market-takeaway-ko', 'market-takeaway-en', 'market-takeaway-count', 'market-takeaway-date',
  'market-takeaway-loaded'
];

function makeElement(id) {
  const listeners = new Map();
  return {
    id,
    value: '',
    textContent: '',
    className: '',
    hidden: false,
    disabled: false,
    files: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null; },
    click() {},
    // Returns whatever the handlers return, so a test can await an async one.
    fire(type, event = {}) {
      return Promise.all((listeners.get(type) || []).map(handler => handler({ preventDefault() {}, ...event })));
    }
  };
}

/** A promise the test resolves by hand, to control when a lookup answers. */
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const okJson = body => ({ ok: true, status: 200, json: async () => body });
const failed = (status = 503) => ({ ok: false, status, json: async () => ({ error: 'DB_NOT_CONFIGURED' }) });

/**
 * Runs the real admin script against a stub DOM, so these are behaviour tests
 * rather than assertions about the source text.
 */
function harness({ latest = async () => failed() } = {}) {
  const elements = new Map(ELEMENT_IDS.map(id => [id, makeElement(id)]));
  const publishes = [];
  const lookups = [];

  const fetchStub = async (url, init) => {
    if (url === '/api/market/latest') {
      lookups.push(url);
      return latest();
    }
    if (url === '/api/market/publish') {
      publishes.push(JSON.parse(init.body));
      const sent = JSON.parse(init.body).takeaway || {};
      return okJson({
        ok: true,
        market_date: JSON.parse(init.body).market?.meta?.market_date,
        action: 'updated',
        is_latest: true,
        takeaway: { ko: Boolean(sent.ko), en: Boolean(sent.en) }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  vm.runInNewContext(SCRIPT, {
    document: { getElementById: id => elements.get(id) || null },
    window: { MARKET_CLOSE: { render() {} } },
    sessionStorage: { getItem: () => 'test-key', setItem() {} },
    fetch: fetchStub,
    console
  });

  const el = id => elements.get(id);
  const file = elements.get('market-json-file');

  async function choose(marketDate) {
    const payload = { ...EXAMPLE, meta: { ...EXAMPLE.meta, market_date: marketDate } };
    const text = JSON.stringify(payload);
    file.files = [{ name: `${marketDate}.json`, size: text.length, text: async () => text }];
    await file.fire('change');
  }

  async function type(lang, value) {
    const field = el(lang === 'ko' ? 'market-takeaway-ko' : 'market-takeaway-en');
    field.value = value;
    await field.fire('input');
  }

  const publish = () => el('market-publish-button').fire('click');

  return { el, choose, type, publish, publishes, lookups };
}

/* ---------------------------------------------- the boxes belong to a date */

test('moving to another date does not carry the previous day’s lines over', async () => {
  const app = harness();
  await app.choose('2026-08-27');
  await app.type('ko', '27일 문장');
  await app.type('en', 'line for the 27th');

  await app.choose('2026-08-28');
  assert.equal(app.el('market-takeaway-ko').value, '', 'the Korean box must start empty on a new date');
  assert.equal(app.el('market-takeaway-en').value, '', 'the English box must start empty on a new date');

  await app.publish();
  const second = app.publishes.at(-1);
  assert.equal(second.market.meta.market_date, '2026-08-28');
  // Nothing was typed for the 28th, so no language is claimed at all.
  assert.deepEqual(second.takeaway, {}, "the previous date's lines must not be filed under the new one");
});

test('re-selecting the same date keeps what the editor has already written', async () => {
  const app = harness();
  await app.choose('2026-08-27');
  await app.type('ko', '아직 작업 중');
  await app.choose('2026-08-27');
  assert.equal(app.el('market-takeaway-ko').value, '아직 작업 중');

  await app.publish();
  assert.deepEqual(app.publishes.at(-1).takeaway, { ko: '아직 작업 중' });
});

/* ------------------------------------------- a late answer is not accepted */

test('a lookup that answers after the editor has moved on is discarded', async () => {
  const slow = deferred();
  let call = 0;
  const app = harness({
    latest: () => {
      call += 1;
      // The first date's lookup hangs; the second answers at once.
      return call === 1 ? slow.promise : Promise.resolve(failed());
    }
  });

  await app.choose('2026-08-27');
  await app.choose('2026-08-28');

  // The 27th finally answers, long after the 28th is on screen.
  slow.resolve(okJson({ meta: { market_date: '2026-08-27' }, takeaway: { ko: '늦게 도착', en: 'arrived late' } }));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(app.el('market-takeaway-ko').value, '', 'a stale answer must not reach the boxes');
  assert.equal(app.el('market-takeaway-en').value, '');
  assert.equal(app.el('market-takeaway-loaded').hidden, true);

  await app.publish();
  assert.equal(app.publishes.at(-1).market.meta.market_date, '2026-08-28');
  assert.deepEqual(app.publishes.at(-1).takeaway, {});
});

test('an answer for a different date than the one asked about is ignored', async () => {
  const app = harness({
    // D1 holds a newer session than the file being republished.
    latest: async () => okJson({ meta: { market_date: '2026-08-28' }, takeaway: { ko: '다른 날' } })
  });
  await app.choose('2026-08-27');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.el('market-takeaway-ko').value, '');
});

/* ------------------------------------- what a publish claims about a language */

test('a failed lookup still leaves the stored lines alone', async () => {
  // Preview has no D1 at all; republishing corrected numbers must not erase.
  const app = harness({ latest: async () => failed() });
  await app.choose('2026-08-27');
  await new Promise(resolve => setImmediate(resolve));

  await app.publish();
  assert.deepEqual(app.publishes.at(-1).takeaway, {}, 'silence lets the server keep what it has');
  assert.match(app.el('market-takeaway-count').textContent, /한국어 입력 없음 — 저장된 문구 유지/);
});

test('republishing after a prefill without editing claims neither language', async () => {
  const app = harness({
    latest: async () => okJson({ meta: { market_date: '2026-08-27' }, takeaway: { ko: '저장된 한 줄', en: 'stored line' } })
  });
  await app.choose('2026-08-27');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(app.el('market-takeaway-ko').value, '저장된 한 줄');
  assert.equal(app.el('market-takeaway-en').value, 'stored line');
  assert.equal(app.el('market-takeaway-loaded').hidden, false);

  await app.publish();
  // The boxes hold the stored text, but the editor never touched it, so the
  // request says nothing and the row is left as it is.
  assert.deepEqual(app.publishes.at(-1).takeaway, {});
});

test('clearing one prefilled box erases that language and only that one', async () => {
  const app = harness({
    latest: async () => okJson({ meta: { market_date: '2026-08-27' }, takeaway: { ko: '지울 문장', en: 'keep this' } })
  });
  await app.choose('2026-08-27');
  await new Promise(resolve => setImmediate(resolve));

  await app.type('ko', '');

  await app.publish();
  assert.deepEqual(app.publishes.at(-1).takeaway, { ko: '' }, 'only the emptied language is claimed');
  assert.match(app.el('market-takeaway-count').textContent, /한국어 삭제 — KO 홈에서 한 줄 숨김/);
  assert.match(app.el('market-takeaway-count').textContent, /English \d+자/);
});

test('a brand new date with nothing typed publishes with no lines', async () => {
  const app = harness({ latest: async () => okJson({ error: 'NO_MARKET_DATA' }) });
  await app.choose('2026-08-28');
  await new Promise(resolve => setImmediate(resolve));

  await app.publish();
  const request = app.publishes.at(-1);
  assert.equal(request.market.meta.market_date, '2026-08-28');
  assert.deepEqual(request.takeaway, {});
  assert.match(app.el('market-publish-status').textContent, /2026-08-28 저장 완료/);
});

test('typing then clearing a box on a fresh date still erases rather than going silent', async () => {
  const app = harness();
  await app.choose('2026-08-27');
  await app.type('ko', '썼다가');
  await app.type('ko', '');
  await app.publish();
  // Touched is about the editor having had their say, not about the text.
  assert.deepEqual(app.publishes.at(-1).takeaway, { ko: '' });
});
