import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('authoritative Market Close contract copies remain internally consistent', async () => {
  const [contract, schemaText, exampleText] = await Promise.all([
    read('contracts/market_close/MARKET_DATA_CONTRACT.md'),
    read('contracts/market_close/market_close.schema.json'),
    read('contracts/market_close/market_close.example.json')
  ]);
  const schema = JSON.parse(schemaText);
  const example = JSON.parse(exampleText);
  assert.equal(example.meta.schema_version, '1.0.1');
  assert.equal(example.meta.status, 'final');
  assert.equal(example.validation.passed, true);
  assert.deepEqual(example.validation.errors, []);
  assert.equal(schema.properties.meta.properties.schema_version.const, '1.0.1');
  assert.match(contract, /schema_version/);
});

test('KO and EN Market pages use only the public latest API at runtime', async () => {
  const [ko, en] = await Promise.all([read('market/index.html'), read('en/market/index.html')]);
  for (const page of [ko, en]) {
    assert.match(page, /data-market-source="\/api\/market\/latest"/);
    assert.doesNotMatch(page, /data-market-source="[^\"]*example\.json"/);
    assert.match(page, /src="\/assets\/market-close\.js/);
    assert.match(page, /href="\/assets\/market-close\.css/);
    assert.match(page, /href="\/about\/">About<\/a>|href="\/en\/about\/">About<\/a>/);
    assert.doesNotMatch(page, /LME|chart\.js|highcharts|plotly/i);
  }
  assert.match(ko, /href="\/market\/" aria-current="page">마켓<\/a>/);
  assert.match(en, /href="\/en\/market\/" aria-current="page">Market<\/a>/);
});

test('Market renderer distinguishes loading, empty, and retryable error states', async () => {
  const [ko, en, script] = await Promise.all([read('market/index.html'), read('en/market/index.html'), read('assets/market-close.js')]);
  assert.match(ko, /class="market-loading" role="status"/);
  assert.match(en, /class="market-loading" role="status"/);
  assert.match(script, /response\.status === 404/);
  assert.match(script, /function renderEmpty/);
  assert.match(script, /class="market-retry"/);
  assert.match(script, /addEventListener\('click', init/);
});

test('Market renderer covers every contract section without inventing an intraday chart', async () => {
  const script = await read('assets/market-close.js');
  for (const token of ['indices', 'rates_fx_volatility', 'commodities_crypto', 'krx_investor_trading', 'recent_5d_flows', 'market_breadth', 'program_basis', 'market_internals', 'short_selling', 'market_cap_top10']) {
    assert.match(script, new RegExp(token));
  }
  assert.match(script, /ratioPct/);
  assert.match(script, /value \/ 1e8/);
  assert.match(script, /data_state === 'intraday'/);
  assert.match(script, /key === 'USDKRW' \|\| key === 'JPYKRW'/);
  assert.doesNotMatch(script, /LME|canvas|getContext|chart\.js|highcharts|plotly/i);
});

test('Market layout explicitly supports dark mode and compact mobile widths', async () => {
  const css = await read('assets/market-close.css');
  assert.match(css, /html\[data-theme="dark"\] \.market-close-page/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /@media\(max-width:360px\)/);
  assert.match(css, /market-close-mountain\.png/);
});

test('locale switch preserves Market routes', async () => {
  const locale = await read('assets/locale.js');
  assert.match(locale, /\/en\\\/market/);
  assert.match(locale, /'\/en\/market\/' : '\/market\/'/);
});
