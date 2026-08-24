import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function marketRuntime(lang = 'ko') {
  const script = await read('assets/market-close.js');
  const document = {
    documentElement: { dataset: { siteLang: lang } },
    body: { dataset: {} },
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = {};
  const context = vm.createContext({ window, document, location: { hostname: 'localhost' }, Intl, Date, Set, console });
  vm.runInContext(script, context);
  return window.MARKET_CLOSE;
}

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
    assert.match(page, /data-market-preview-fixture="\/contracts\/market_close\/market_close\.example\.json"/);
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
  assert.match(script, /pages\\\.dev/);
  assert.match(script, /localhost\|127\\\.0\\\.0\\\.1/);
  assert.match(script, /market-preview-notice/);
  assert.doesNotMatch(script, /snowshagal\.com.*example\.json/);
});

test('Market renderer covers every contract section without inventing an intraday chart', async () => {
  const script = await read('assets/market-close.js');
  for (const token of ['indices', 'rates_fx_volatility', 'commodities_crypto', 'krx_investor_trading', 'recent_5d_flows', 'market_breadth', 'program_basis', 'market_internals', 'short_selling', 'market_cap_top10']) {
    assert.match(script, new RegExp(token));
  }
  assert.match(script, /ratioPct/);
  assert.match(script, /value \* 1e9/);
  assert.match(script, /data_state === 'intraday'/);
  assert.match(script, /key === 'USDKRW' \|\| key === 'JPYKRW'/);
  assert.doesNotMatch(script, /LME|canvas|getContext|chart\.js|highcharts|plotly/i);
});

test('KRX flow values use the Contract v1.0.1 KRW billion unit', async () => {
  const [ko, en] = await Promise.all([marketRuntime('ko'), marketRuntime('en')]);
  assert.equal(ko.format.flow(-3676), '−3.68조원');
  assert.equal(ko.format.flow(242), '+2,420억원');
  assert.equal(ko.format.flow(25), '+250억원');
  assert.equal(ko.format.flow(-118), '−1,180억원');
  assert.equal(en.format.flow(-3676), 'KRW −3.68tn');
  assert.equal(en.format.flow(242), 'KRW +242bn');
  assert.equal(en.format.flow(25), 'KRW +25bn');
});

test('FX close/current and US10Y basis-point changes render without mixing value bases', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  for (const lang of ['ko', 'en']) {
    const runtime = await marketRuntime(lang);
    const target = { innerHTML: '' };
    runtime.render(data, target);
    assert.match(target.innerHTML, lang === 'ko' ? /1,381\.70원[\s\S]*15:30 확정[\s\S]*현재[\s\S]*1,383\.36원[\s\S]*▼ 2\.44/ : /₩1,381\.70[\s\S]*15:30 close[\s\S]*Latest[\s\S]*₩1,383\.36[\s\S]*▼ 2\.44/);
    assert.match(target.innerHTML, lang === 'ko' ? /869\.27원[\s\S]*15:30 확정[\s\S]*현재[\s\S]*867\.30원[\s\S]*▼ 4\.52/ : /₩869\.27[\s\S]*15:30 close[\s\S]*Latest[\s\S]*₩867\.30[\s\S]*▼ 4\.52/);
    assert.match(target.innerHTML, /4\.692%[\s\S]*▼ 4\.6bp/);
    assert.doesNotMatch(target.innerHTML, /4\.6bp[\s\S]{0,40}\(-0\.97%\)/);
  }
});

test('flow concentration renders TOP1 and TOP5 together', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const runtime = await marketRuntime('en');
  const target = { innerHTML: '' };
  runtime.render(data, target);
  assert.match(target.innerHTML, /TOP1 5\.6% · TOP5 17\.4%/);
  assert.match(target.innerHTML, /TOP1 41\.0% · TOP5 87\.2%/);
});

test('English company resolver covers every fixture ticker and never leaks Korean company names', async () => {
  const data = JSON.parse(await read('contracts/market_close/market_close.example.json'));
  const en = await marketRuntime('en');
  const expected = new Map([
    ['005930', 'Samsung Electronics'], ['000660', 'SK hynix'], ['005935', 'Samsung Electronics Pref.'], ['402340', 'SK Square'],
    ['009150', 'Samsung Electro-Mechanics'], ['005380', 'Hyundai Motor'], ['373220', 'LG Energy Solution'], ['207940', 'Samsung Biologics'],
    ['028260', 'Samsung C&T'], ['105560', 'KB Financial Group'], ['042700', 'Hanmi Semiconductor'], ['047810', 'Korea Aerospace Industries'],
    ['095570', 'AJ Networks'], ['095340', 'ISC'], ['013890', 'Zinus'], ['035420', 'NAVER']
  ]);
  const companies = [
    ...data.market_cap_top10,
    ...data.short_selling.top5_by_value,
    ...data.short_selling.top5_by_ratio,
    ...Object.values(data.market_internals.concentration).flatMap(side => Object.values(side))
  ];
  for (const item of companies) {
    const ticker = item.ticker || item.top_ticker;
    assert.equal(en.companyName(item), expected.get(ticker), `missing English company name for ${ticker}`);
    assert.doesNotMatch(en.companyName(item), /[\u3131-\u318e\uac00-\ud7a3]/);
  }
  assert.equal(en.companyName({ ticker: '123456', name: '미등록회사' }), '123456');
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
