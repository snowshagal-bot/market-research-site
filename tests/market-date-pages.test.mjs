import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dailyReportFor,
  marketArchivePageHtml,
  marketDateDescription,
  marketDatePageHtml,
  marketDateTitle,
  onMarketPageRequest,
  parseMarketPagePath
} from '../functions/_market-date-page.js';
import { sitemapXml } from '../functions/_seo.js';
import { onRequestGet as sitemapGet } from '../functions/sitemap.xml.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');
const SHELLS = { ko: read('market/index.html'), en: read('en/market/index.html') };
const FIXTURE = JSON.parse(read('contracts/market_close/market_close.example.json'));
const DATE = FIXTURE.meta.market_date;

function payload(overrides = {}) {
  return { ...structuredClone(FIXTURE), ...overrides };
}

/* ------------------------------------------------------------------ paths */

test('session and archive paths are recognised; anything else is left to the static site', () => {
  assert.deepEqual(parseMarketPagePath('/market/2026-10-28/'), { lang: 'ko', date: '2026-10-28', canonical: true });
  assert.deepEqual(parseMarketPagePath('/en/market/2026-10-28/'), { lang: 'en', date: '2026-10-28', canonical: true });
  assert.deepEqual(parseMarketPagePath('/market/2026-10-28'), { lang: 'ko', date: '2026-10-28', canonical: false });
  assert.deepEqual(parseMarketPagePath('/market/archive/'), { lang: 'ko', archive: true, canonical: true });
  assert.deepEqual(parseMarketPagePath('/en/market/archive'), { lang: 'en', archive: true, canonical: false });
  for (const other of ['/market/', '/market/index.html', '/market/2026-02-30/', '/market/2026-10-28/x', '/market/26-10-28/', '/en/market/']) {
    assert.equal(parseMarketPagePath(other), null, other);
  }
});

/* -------------------------------------------------------------------- SEO */

test('the title leads with the full date and the KOSPI close, and reads apart from the Daily title', () => {
  const ko = marketDateTitle(FIXTURE, 'ko');
  const en = marketDateTitle(FIXTURE, 'en');
  assert.equal(ko, '2026년 8월 28일 코스피 종가 6,788.88(-1.79%) · 투자자별 매매동향·환율 | Snowshagal');
  assert.equal(en, 'Aug 28, 2026 KOSPI Close 6,788.88 (-1.79%) · Flows & FX | Snowshagal');
  // The Daily report title for the same day is "8월 28일 코스피 … 마감 | 외국인·기관 수급".
  assert.doesNotMatch(ko, /마감 \|/);
  assert.ok(ko.length <= 70 && en.length <= 70);
});

test('the description quotes closes, KOSPI flows and USD/KRW within 180 characters', () => {
  for (const lang of ['ko', 'en']) {
    const text = marketDateDescription(FIXTURE, lang);
    assert.ok(text.length <= 180, `${lang} ${text.length}`);
    assert.match(text, /6,788\.88/);
    assert.match(text, lang === 'en' ? /USD\/KRW/ : /원\/달러/);
  }
  const noFx = payload({ rates_fx_volatility: {} });
  assert.doesNotMatch(marketDateDescription(noFx, 'ko'), /원\/달러/);
});

/* ------------------------------------------------------------------- page */

function page(lang, data = FIXTURE, context = { prev: '2026-08-27', next: '2026-08-31', report: { url: '/reports/x' } }) {
  return marketDatePageHtml(SHELLS[lang], data, lang, context);
}

test('the /market/ shell gets the session head, a server-rendered <main> and no dashboard script', () => {
  for (const lang of ['ko', 'en']) {
    const html = page(lang);
    const other = lang === 'en' ? 'ko' : 'en';
    const self = `https://snowshagal.com${lang === 'en' ? '/en' : ''}/market/${DATE}/`;
    assert.equal((html.match(/<title>/g) || []).length, 1);
    assert.match(html, new RegExp(`<link rel="canonical" href="${self}">`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${self}">`));
    assert.match(html, new RegExp(`hreflang="ko" href="https://snowshagal.com/market/${DATE}/"`));
    assert.match(html, new RegExp(`hreflang="en" href="https://snowshagal.com/en/market/${DATE}/"`));
    assert.match(html, new RegExp(`hreflang="x-default" href="https://snowshagal.com/market/${DATE}/"`));
    assert.match(html, new RegExp(`data-language-choice="${other}" href="${other === 'en' ? '/en' : ''}/market/${DATE}/"`));
    assert.doesNotMatch(html, /market-close\.js/);
    assert.doesNotMatch(html, /id="market-close-root"/);
    assert.doesNotMatch(html, /data-market-source/);
    // Header, footer, search and theme scripts stay.
    assert.match(html, /<header class="site-header">/);
    assert.match(html, /<footer id="site-footer"/);
    assert.match(html, /\/assets\/site\.js\?v=/);
    // The numbers are in the response itself.
    assert.match(html, /<h1 id="market-date-heading">/);
    assert.match(html, /6,788\.88/);
    assert.match(html, new RegExp(`href="${lang === 'en' ? '/en' : ''}/market/2026-08-27/" rel="prev"`));
    assert.match(html, new RegExp(`href="${lang === 'en' ? '/en' : ''}/market/2026-08-31/" rel="next"`));
    assert.match(html, new RegExp(`href="${lang === 'en' ? '/en' : ''}/market/archive/"`));
    assert.match(html, new RegExp(`href="${lang === 'en' ? '/en' : ''}/market/\\?date=${DATE}"`));
    assert.match(html, /class="market-report-cta" href="\/reports\/x"/);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const webPage = ld['@graph'].find((item) => item['@type'] === 'WebPage');
    assert.equal(webPage.url, self);
    assert.equal(webPage.inLanguage, lang);
    assert.deepEqual(webPage.breadcrumb.itemListElement.map((item) => item.position), [1, 2, 3, 4]);
  }
});

test('sections without data are left out and numbered in order; a 1.2.0 incomplete window says so', () => {
  const sectionTitles = (html) => [...html.matchAll(/<h2 id="market-section-\d+"><span>(\d+)\.<\/span> ([^<]+)<\/h2>/g)].map((m) => `${m[1]} ${m[2]}`);
  const full = sectionTitles(page('ko'));
  assert.ok(full.includes('07 KRX 업종 · 테마 등락률'), full.join(' | '));

  const bare = payload({ krx_groups: undefined, short_selling: undefined, market_cap_top10: [] });
  const titles = sectionTitles(page('ko', bare));
  assert.ok(!titles.some((title) => /업종|공매도|시가총액/.test(title)), titles.join(' | '));
  assert.deepEqual(titles.map((title) => title.slice(0, 2)), titles.map((_, index) => String(index + 1).padStart(2, '0')));

  const incomplete = payload({
    meta: { ...FIXTURE.meta, schema_version: '1.2.0' },
    section_status: { five_day_flows: { status: 'incomplete', available_sessions: 3, expected_sessions: 5, missing_sessions: [] }, market_breadth: { status: 'unavailable' } }
  });
  const html = page('ko', incomplete);
  assert.match(html, /데이터 불완전 · 3\/5 거래일 확보/);
  assert.match(html, /이날 시장 폭 데이터 없음/);
  assert.doesNotMatch(html, /class="breadth-card"/);
});

test('every sector and theme is listed in the page, not only the top and bottom five', () => {
  const html = page('ko');
  for (const item of [...FIXTURE.krx_groups.sectors, ...FIXTURE.krx_groups.themes]) {
    assert.ok(html.includes(item.name.replace(/&/g, '&amp;')), item.name);
  }
});

test('the Daily report link is the same-language Daily for that date', () => {
  const posts = [
    { type: 'daily', lang: 'ko', reportDate: DATE, href: 'reports/8월 28일 주식리포트.html' },
    { type: 'daily', lang: 'en', reportDate: DATE, href: 'reports/en/daily-0828.html' },
    { type: 'weekly', lang: 'ko', reportDate: DATE, href: 'reports/weekly.html' }
  ];
  assert.deepEqual(dailyReportFor(posts, DATE, 'ko'), { url: '/reports/8%EC%9B%94%2028%EC%9D%BC%20%EC%A3%BC%EC%8B%9D%EB%A6%AC%ED%8F%AC%ED%8A%B8' });
  assert.deepEqual(dailyReportFor(posts, DATE, 'en'), { url: '/reports/en/daily-0828' });
  assert.equal(dailyReportFor(posts, '2026-08-27', 'ko'), null);
});

test('the archive lists every session by month, newest first, each linking to its page', () => {
  const rows = [
    { market_date: '2026-09-01', kospi_close: 6835.8, kospi_pct: 0.23, kosdaq_close: 830.1, kosdaq_pct: -0.5, foreign_net: -492, usdkrw: 1370 },
    { market_date: '2026-08-31', kospi_close: 6820.02, kospi_pct: 0.46, kosdaq_close: 828, kosdaq_pct: 0.1, foreign_net: 640, usdkrw: 1368.5 }
  ];
  const ko = marketArchivePageHtml(SHELLS.ko, rows, 'ko');
  assert.match(ko, /<link rel="canonical" href="https:\/\/snowshagal.com\/market\/archive\/">/);
  assert.match(ko, /<h2 id="archive-2026-09">2026년 9월<\/h2>/);
  assert.ok(ko.indexOf('2026-09-01/') < ko.indexOf('2026-08-31/'));
  assert.match(ko, /href="\/market\/2026-08-31\/">8월 31일\(월\)<\/a>/);
  const en = marketArchivePageHtml(SHELLS.en, rows, 'en');
  assert.match(en, /href="\/en\/market\/2026-09-01\/">Tue, Sep 1<\/a>/);
  assert.match(en, /data-language-choice="ko" href="\/market\/archive\/"/);
});

test('a shell that lost a replaced piece fails loudly instead of shipping the dashboard head', () => {
  const broken = SHELLS.ko.replace(/<link rel="canonical" href="[^"]*">/, '');
  assert.throws(() => marketDatePageHtml(broken, FIXTURE, 'ko'), /missing canonical/);
});

/* ------------------------------------------------------------------ route */

function row(date, overrides = {}) {
  const data = payload({ meta: { ...FIXTURE.meta, market_date: date } });
  return { market_date: date, status: 'final', published_at: `${date}T07:10:00Z`, payload_json: JSON.stringify(data), takeaway_ko: '', takeaway_en: '', prev_date: null, next_date: null, ...overrides };
}

function marketDb(rows, { hang = false } = {}) {
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() { return { success: true }; },
        async first() {
          if (hang) return new Promise(() => {});
          if (/FROM sqlite_master/.test(sql)) return null;
          if (/WHERE market_date = \?1/.test(sql)) {
            const found = rows.find((item) => item.market_date === args[0]);
            if (!found) return null;
            const finals = rows.filter((item) => item.status === 'final').map((item) => item.market_date).sort();
            return {
              ...found,
              prev_date: finals.filter((d) => d < args[0]).at(-1) || null,
              next_date: finals.find((d) => d > args[0]) || null
            };
          }
          return null;
        },
        async all() {
          if (hang) return new Promise(() => {});
          if (/json_extract/.test(sql)) {
            return {
              results: rows.filter((item) => item.status === 'final').sort((a, b) => b.market_date.localeCompare(a.market_date)).map((item) => {
                const p = JSON.parse(item.payload_json);
                return { market_date: item.market_date, published_at: item.published_at, kospi_close: p.indices.KOSPI.close, kospi_pct: p.indices.KOSPI.change_pct, kosdaq_close: p.indices.KOSDAQ.close, kosdaq_pct: p.indices.KOSDAQ.change_pct, foreign_net: p.krx_investor_trading.markets.KOSPI.investors['외국인'].net_buy, usdkrw: p.rates_fx_volatility.USDKRW.close };
              })
            };
          }
          return { results: [] };
        }
      };
    }
  };
}

function assets() {
  return {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/market/') return new Response(SHELLS.ko, { status: 200 });
      if (pathname === '/en/market/') return new Response(SHELLS.en, { status: 200 });
      if (pathname === '/__not-found__') return new Response('<title>404</title>', { status: 404 });
      if (pathname === '/data/posts.json') return new Response('[]', { status: 200 });
      return new Response('nf', { status: 404 });
    }
  };
}

function call(url, db, options = {}) {
  let passed = false;
  const context = {
    request: new Request(url),
    env: { COMMENTS_DB: db, ASSETS: assets() },
    next: async () => { passed = true; return new Response('static', { status: 200 }); }
  };
  return onMarketPageRequest(context, { loadPostsFn: async () => [], ...options }).then((response) => ({ response, passed }));
}

test('the route serves a final session, redirects to the slash form and leaves other paths alone', async () => {
  const rows = [row('2026-08-27'), row('2026-08-28'), row('2026-08-31', { status: 'incomplete' })];
  const db = marketDb(rows);

  let { response, passed } = await call('https://snowshagal.com/market/2026-08-28/', db);
  assert.equal(response.status, 200);
  assert.equal(passed, false);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /<h1 id="market-date-heading">2026년 8월 28일 한국 증시 마감<\/h1>/);
  assert.match(html, /href="\/market\/2026-08-27\/" rel="prev"/);
  assert.doesNotMatch(html, /rel="next"/, 'an incomplete later row is not a next session');

  ({ response } = await call('https://snowshagal.com/en/market/2026-08-28?x=1', db));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://snowshagal.com/en/market/2026-08-28/?x=1');

  for (const missing of ['https://snowshagal.com/market/2026-08-29/', 'https://snowshagal.com/market/2026-08-31/']) {
    ({ response } = await call(missing, db));
    assert.equal(response.status, 404, missing);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  }

  for (const other of ['https://snowshagal.com/market/', 'https://snowshagal.com/market/2026-02-30/']) {
    ({ passed } = await call(other, db));
    assert.equal(passed, true, other);
  }

  ({ response } = await call('https://snowshagal.com/en/market/archive/', db));
  assert.equal(response.status, 200);
  const archive = await response.text();
  assert.match(archive, /href="\/en\/market\/2026-08-28\/"/);
  assert.doesNotMatch(archive, /2026-08-31\//);
});

test('a database that does not answer gets a quick 503, not a hung page', async () => {
  const started = Date.now();
  const { response } = await call('https://snowshagal.com/market/2026-08-28/', marketDb([], { hang: true }), { budgetMs: 30 });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  assert.ok(Date.now() - started < 2000);
});

/* ---------------------------------------------------------------- sitemap */

test('the sitemap lists the archive and every session in both languages, paired', () => {
  const xml = sitemapXml([], { marketSessions: [{ market_date: '2026-10-28', published_at: '2026-10-28T07:10:35Z' }, { market_date: '2026-10-27', published_at: '' }] });
  for (const loc of ['/market/archive/', '/en/market/archive/', '/market/2026-10-28/', '/en/market/2026-10-28/', '/market/2026-10-27/', '/en/market/2026-10-27/']) {
    assert.match(xml, new RegExp(`<loc>https://snowshagal.com${loc}</loc>`), loc);
  }
  assert.match(xml, /<loc>https:\/\/snowshagal.com\/market\/2026-10-28\/<\/loc><lastmod>2026-10-28<\/lastmod><xhtml:link rel="alternate" hreflang="ko" href="https:\/\/snowshagal.com\/market\/2026-10-28\/"\/><xhtml:link rel="alternate" hreflang="en" href="https:\/\/snowshagal.com\/en\/market\/2026-10-28\/"\/>/);
  assert.doesNotMatch(sitemapXml([]), /market\/archive/);
});

test('the sitemap still answers when the database is missing', async () => {
  const env = { ASSETS: { fetch: async () => new Response('[]', { status: 200 }) } };
  const response = await sitemapGet({ request: new Request('https://snowshagal.com/sitemap.xml'), env });
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /market\/archive/);
});
