import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  META_SRC,
  QUERY_CORPUS,
  bodySrc,
  bootSearch,
  currentFiles,
  fullFieldMeta
} from './helpers/search-harness.mjs';
import { SEARCH_META_FIELDS, searchIndexArtifacts } from '../functions/api/_search-index.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const files = await currentFiles();
const bodyRequests = (search) => search.requests.filter(src => src.includes('search-index-body'));

/* 1 */
test('opening the dialog loads metadata only, never a body shard', async () => {
  for (const lang of ['ko', 'en']) {
    const search = await bootSearch({ lang, files });
    assert.deepEqual(search.requests, [], 'nothing before the dialog opens');
    await search.open();
    assert.deepEqual(search.requests, [META_SRC]);
    await search.settle(META_SRC);
    assert.deepEqual(bodyRequests(search), [], `${lang}: no body after meta loads with an empty box`);
    await search.close();
    assert.deepEqual(bodyRequests(search), [], `${lang}: closing without a query costs no body`);
  }
});

/* 2, 7, 8 */
test('the first query shows metadata results at once and requests only this locale\'s body, once', async () => {
  for (const [lang, other, query] of [['ko', 'en', '반도체'], ['en', 'ko', 'semiconductor']]) {
    const search = await bootSearch({ lang, files });
    await search.open();
    await search.settle(META_SRC);
    await search.type(query);
    assert.ok(search.resultIds().length > 0, `${lang}: metadata results before the body`);
    assert.deepEqual(bodyRequests(search), [bodySrc(lang)], `${lang}: exactly one body request, own locale`);
    assert.ok(!search.requests.includes(bodySrc(other)), `${lang}: never the other locale`);
    await search.type(`${query} `);
    await search.type(query.slice(0, 2));
    assert.equal(bodyRequests(search).length, 1, `${lang}: further queries while loading add no request`);
    await search.settle(bodySrc(lang));
    await search.type(query);
    assert.equal(bodyRequests(search).length, 1, `${lang}: no request after the body is in`);
  }
});

/* 3 */
test('a body-only match appears once the body arrives', async () => {
  for (const [lang, query] of [['ko', '6거래일'], ['en', 'indicating']]) {
    const search = await bootSearch({ lang, files });
    await search.open();
    await search.settle(META_SRC);
    await search.type(query);
    assert.deepEqual(search.resultIds(), [], `${lang}: nothing from metadata`);
    assert.equal(search.empty.hidden, false, `${lang}: empty state while the body loads`);
    await search.settle(bodySrc(lang));
    assert.ok(search.resultIds().length > 0, `${lang}: body matches added`);
    assert.equal(search.empty.hidden, true);
    assert.match(search.results.innerHTML, /<span class="search-highlight">/);
  }
});

/* 4 */
test('a query changed while the body loads is the one re-run, never the old one', async () => {
  const search = await bootSearch({ lang: 'ko', files });
  await search.open();
  await search.settle(META_SRC);
  await search.type('삼성');
  await search.type('반도체');
  await search.type('SK하이닉스');
  await search.settle(bodySrc('ko'));
  const afterLoad = search.snapshot();

  // A fresh page that searched only the final query with the body present.
  const reference = await bootSearch({ lang: 'ko', files });
  await reference.open();
  await reference.settle(META_SRC);
  await reference.type('SK하이닉스');
  await reference.settle(bodySrc('ko'));
  assert.deepEqual(afterLoad, reference.snapshot());
  assert.match(afterLoad.html, /search-highlight">sk하이닉스</i);
  assert.doesNotMatch(afterLoad.html, /search-highlight">삼성</);

  // The box changes between the download starting and it landing: the landing
  // re-runs what is in the box then.
  const late = await bootSearch({ lang: 'en', files });
  await late.open();
  await late.settle(META_SRC);
  await late.type('Samsung');
  late.input.value = 'SK hynix'; // typed but its input event not yet handled
  await late.settle(bodySrc('en'));
  assert.match(late.results.innerHTML, /search-highlight">SK</i);
});

/* 5 */
test('clearing the query never requests a body', async () => {
  const search = await bootSearch({ lang: 'ko', files });
  await search.open();
  await search.settle(META_SRC);
  await search.type('   ');
  await search.clear();
  await search.type('');
  assert.deepEqual(bodyRequests(search), []);
  assert.equal(search.results.innerHTML, '');
});

/* 6 */
test('reopening the dialog never requests the body again', async () => {
  const search = await bootSearch({ lang: 'en', files });
  await search.open();
  await search.settle(META_SRC);
  await search.type('SK hynix');
  await search.settle(bodySrc('en'));
  await search.close();
  await search.open();
  await search.type('7,000');
  await search.close();
  await search.open();
  assert.equal(bodyRequests(search).length, 1);
  assert.equal(search.requests.filter(src => src === META_SRC).length, 1, 'metadata also loaded once');
});

test('a body arriving after the dialog closed changes nothing on screen', async () => {
  const search = await bootSearch({ lang: 'ko', files });
  await search.open();
  await search.settle(META_SRC);
  await search.type('6거래일');
  const beforeClose = search.snapshot();
  await search.close();
  await search.settle(bodySrc('ko'));
  assert.deepEqual(search.snapshot(), beforeClose);
  // Reopening shows the full result with the body now present.
  await search.open();
  assert.ok(search.resultIds().length > 0);
});

/* 9 */
test('a failed body load leaves metadata search working', async () => {
  const search = await bootSearch({ lang: 'ko', files });
  await search.open();
  await search.settle(META_SRC);
  await search.type('반도체');
  const metadataOnly = search.resultIds();
  await search.settle(bodySrc('ko'), { fail: true });
  assert.deepEqual(search.resultIds(), metadataOnly, 'results kept after the failure');
  await search.type('선물·파생');
  assert.ok(search.resultIds().length > 0, 'metadata search still answers');
  await search.type('WGBI');
  assert.ok(search.resultIds().length > 0);
  assert.equal(bodyRequests(search).length, 1, 'no retry loop');
});

/* 10 */
test('final results are identical to the previous loading order and the full-field metadata, for the whole corpus', async () => {
  const beforeFiles = { ...files, [META_SRC]: await fullFieldMeta() };
  for (const lang of ['ko', 'en']) {
    // Before: every metadata field, bodies requested when the dialog opens.
    // The previous page asked for the body as the dialog opened, so every query
    // ran with the body already present; load it first to reproduce that.
    const before = await bootSearch({ lang, files: beforeFiles });
    await before.open();
    await before.settle(META_SRC);
    await before.type('x');
    await before.settle(bodySrc(lang));
    await before.type('');

    // After: slim metadata, bodies requested by the first query.
    const after = await bootSearch({ lang, files });
    await after.open();
    await after.settle(META_SRC);

    for (const [kind, query] of QUERY_CORPUS[lang]) {
      await before.type(query);
      await after.type(query);
      if (after.pending.some(script => script.src === bodySrc(lang))) await after.settle(bodySrc(lang));
      assert.deepEqual(after.snapshot(), before.snapshot(), `${lang} ${kind}: "${query}"`);
    }
    // The corpus exercises matches and a no-result query in both locales.
    assert.ok(QUERY_CORPUS[lang].some(([kind]) => kind === 'no result'));
  }
});

/* ---- artifact contract ---- */

test('the metadata carries exactly the fields the search dialog reads', async () => {
  const site = await read('assets/site.js');
  const searchSection = site.slice(site.indexOf('Global Search Dialog & Engine'), site.indexOf('Homepage Archive & Calendar View Engine'));
  for (const unused of ['typeLabel', 'registeredAt', 'coverImage']) {
    assert.ok(!SEARCH_META_FIELDS.includes(unused), `${unused} not shipped`);
    assert.doesNotMatch(searchSection, new RegExp(`\\.${unused}\\b`), `${unused} is not read by search`);
  }
  for (const used of ['id', 'lang', 'category', 'title', 'subtitle', 'date', 'summary', 'tags', 'readingMinutes', 'url']) {
    assert.ok(SEARCH_META_FIELDS.includes(used), `${used} shipped`);
    assert.match(searchSection, new RegExp(`\\.${used}\\b`), `${used} is read by search`);
  }
  const meta = JSON.parse((await read('data/search-index-meta.js')).replace(/^window\.SEARCH_INDEX_META = /, '').replace(/;\s*$/, ''));
  for (const entry of meta) {
    for (const key of Object.keys(entry)) assert.ok(SEARCH_META_FIELDS.includes(key), `${entry.id}.${key}`);
  }
});

test('every writer emits the same four artifacts and the body shards match the index byte for byte', async () => {
  const index = JSON.parse(await read('data/search-index.json'));
  const artifacts = searchIndexArtifacts(index);
  assert.deepEqual(artifacts.map(a => a.path), ['data/search-index.json', 'data/search-index-meta.js', 'data/search-index-body-ko.js', 'data/search-index-body-en.js']);
  for (const artifact of artifacts) {
    assert.equal(artifact.content, await read(artifact.path), `${artifact.path} is exactly what the writers produce`);
  }
  const [publish, manage, build] = await Promise.all([read('functions/api/publish.js'), read('functions/api/manage.js'), read('scripts/build-search-index.mjs')]);
  for (const source of [publish, manage, build]) assert.match(source, /searchIndexArtifacts\(searchIndex\)/);
});
