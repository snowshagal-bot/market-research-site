import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARKET_INDICATORS,
  dailyReportFor,
  marketIndicatorPageHtml,
  marketIndicatorPath,
  marketIndicatorSeries,
  marketIndicatorStats,
  marketIndicatorTitle,
  marketArchivePageHtml,
  marketDateDescription,
  marketDatePageHtml,
  marketDateTitle,
  marketSectorsDescription,
  marketSectorsPageHtml,
  marketSectorsView,
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

test('the source line names only the real sources, and the short ratio says it includes NXT', () => {
  for (const [lang, source, scope] of [
    ['ko', '데이터 출처: KRX 한국거래소, 네이버 금융, 야후 파이낸스', '거래대금 비중은 KRX+NXT 합산 정규시장 거래대금 대비입니다.'],
    ['en', 'Sources: KRX, Naver Finance, Yahoo Finance', 'Value ratio is against KRX+NXT combined regular-session turnover.']
  ]) {
    const html = page(lang);
    assert.ok(html.includes(source), lang);
    assert.ok(html.includes(scope), lang);
    assert.doesNotMatch(html, /Infomax|인포맥스/);
  }
  const data = payload();
  for (const key of ['KOSPI', 'KOSDAQ']) delete data.short_selling.market_summary[key].coverage_scope;
  assert.doesNotMatch(page('ko', data), /KRX\+NXT 합산 정규시장 거래대금 대비/);
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

// schemaFails: the sqlite_master probe and the DDL throw, as D1 did for about
// one Production read in ten on 2026-11-23; ordinary reads still answer.
function marketDb(rows, { hang = false, schemaFails = false } = {}) {
  const schemaStatement = sql => /FROM sqlite_master|^\s*(CREATE|ALTER)\b/i.test(sql);
  return {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async run() {
          if (schemaFails && schemaStatement(sql)) throw new Error('D1_ERROR: Network connection lost.');
          return { success: true };
        },
        async first() {
          if (hang) return new Promise(() => {});
          if (schemaFails && schemaStatement(sql)) throw new Error('D1_ERROR: Network connection lost.');
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
          const indicatorPath = sql.match(/'\$\.(indices|rates_fx_volatility|commodities_crypto)\.([A-Z0-9]+)'\) AS item/);
          if (indicatorPath) {
            return {
              results: rows.filter((item) => item.status === 'final').sort((a, b) => b.market_date.localeCompare(a.market_date))
                .map((item) => ({ market_date: item.market_date, published_at: item.published_at, item: JSON.stringify(JSON.parse(item.payload_json)[indicatorPath[1]]?.[indicatorPath[2]] ?? null) }))
            };
          }
          if (/'\$\.krx_groups'/.test(sql)) {
            return {
              results: rows.filter((item) => item.status === 'final').sort((a, b) => b.market_date.localeCompare(a.market_date)).slice(0, 20)
                .map((item) => ({ market_date: item.market_date, published_at: item.published_at, krx_groups: JSON.stringify(JSON.parse(item.payload_json).krx_groups ?? null) }))
            };
          }
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

test('session, archive and history pages still answer when the schema init fails', async () => {
  const rows = [row('2026-08-27'), row('2026-08-28')];
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    for (const url of ['https://snowshagal.com/market/2026-08-28/', 'https://snowshagal.com/en/market/archive/', 'https://snowshagal.com/market/usdkrw/', 'https://snowshagal.com/en/market/kospi/']) {
      const { response } = await call(url, marketDb(rows, { schemaFails: true }));
      assert.equal(response.status, 200, url);
    }
  } finally {
    console.error = originalError;
  }
  // The session page's KOFIA lookup fails soft and logs on its own; the market
  // table lines all say the read went ahead.
  const marketLines = logs.filter(line => /^market close schema/.test(line));
  assert.ok(marketLines.length > 0 && marketLines.every(line => /^market close schema init failed, reading anyway: CREATE TABLE failed: D1_ERROR/.test(line)), logs.join('\n'));
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

/* ------------------------------------------------------- sectors & themes */

// `count` sessions, newest first, each moving every index by `step` percent.
function groupRows(count, step = 1) {
  const dates = [];
  const day = new Date(Date.UTC(2026, 9, 28));
  while (dates.length < count) {
    if (day.getUTCDay() % 6 !== 0) dates.push(day.toISOString().slice(0, 10));
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return dates.map((date, index) => {
    const factor = (1 + step / 100) ** (count - index);
    const scale = (items) => items.map((item, rank) => {
      const close = Number((1000 * factor * (1 + rank / 1000)).toFixed(2));
      const previous = close / (1 + step / 100);
      return { ...item, close, change: close - previous, change_pct: step + rank / 100, previous_close: undefined };
    });
    return { market_date: date, published_at: `${date}T07:10:00Z`, krx_groups: { sectors: scale(FIXTURE.krx_groups.sectors), themes: scale(FIXTURE.krx_groups.themes) } };
  });
}

test('the sectors view ranks the latest session and the 5- and 20-session windows', () => {
  assert.deepEqual(parseMarketPagePath('/market/sectors/'), { lang: 'ko', sectors: true, canonical: true });
  assert.deepEqual(parseMarketPagePath('/en/market/sectors'), { lang: 'en', sectors: true, canonical: false });

  const view = marketSectorsView(groupRows(20));
  assert.equal(view.date, '2026-10-28');
  assert.equal(view.sectors.length, 46);
  assert.equal(view.themes.length, 39);
  assert.ok(view.sectors[0].change_pct >= view.sectors.at(-1).change_pct);
  assert.equal(view.week.sessions, 5);
  assert.equal(view.week.end, '2026-10-28');
  assert.equal(view.week.sectors.length, 46);
  assert.equal(view.month.sectors.length, 46);
  // Five sessions of +1% compound to about +5.1%.
  assert.ok(Math.abs(view.week.sectors[0].return_pct - (1.01 ** 5 - 1) * 100) < 0.05, view.week.sectors[0].return_pct);

  const short = marketSectorsView(groupRows(3));
  assert.equal(short.week, null);
  assert.equal(short.month, null);
  assert.equal(marketSectorsView([{ market_date: '2026-10-28', krx_groups: null }, ...groupRows(5)]), null);
});

test('the sectors page lists every index and the windows it has, with its own head', () => {
  for (const lang of ['ko', 'en']) {
    const html = marketSectorsPageHtml(SHELLS[lang], marketSectorsView(groupRows(20)), lang);
    const self = `https://snowshagal.com${lang === 'en' ? '/en' : ''}/market/sectors/`;
    assert.match(html, new RegExp(`<link rel="canonical" href="${self}">`));
    assert.match(html, /hreflang="en" href="https:\/\/snowshagal.com\/en\/market\/sectors\/"/);
    assert.match(html, lang === 'en' ? /<title>Korea Sector &amp; Theme Index Rankings, Oct 28, 2026 \| Snowshagal<\/title>/ : /<title>오늘 업종별 등락률·KRX 테마지수 순위 \(10월 28일\) \| Snowshagal<\/title>/);
    for (const item of [...FIXTURE.krx_groups.sectors, ...FIXTURE.krx_groups.themes]) {
      const name = globalThis.MARKET_LOCALE.krxGroupName(item, lang);
      assert.ok(html.includes(name.replace(/&/g, '&amp;')), name);
    }
    // The English page names every KRX index in English (assets/locale.js), none in Korean.
    if (lang === 'en') assert.doesNotMatch(html.slice(html.indexOf('<main'), html.indexOf('</main>')), /[ㄱ-ㆎ가-힣]/);
    const titles = [...html.matchAll(/<h2 id="market-section-\d+"><span>(\d+)\.<\/span> ([^<]+)<\/h2>/g)].map((m) => m[2]);
    assert.equal(titles.length, 4, titles.join(' | '));
    assert.match(html, new RegExp(`href="${lang === 'en' ? '/en' : ''}/market/2026-10-28/"`));
    assert.ok(marketSectorsDescription(marketSectorsView(groupRows(20)), lang).length <= 180);
  }
  const short = marketSectorsPageHtml(SHELLS.ko, marketSectorsView(groupRows(3)), 'ko');
  assert.equal([...short.matchAll(/<h2 id="market-section-/g)].length, 2);
});

test('the sectors route serves the page, and 404s when the newest session has no sectors', async () => {
  const rows = groupRows(6).map((item) => row(item.market_date, {
    payload_json: JSON.stringify(payload({ meta: { ...FIXTURE.meta, market_date: item.market_date }, krx_groups: item.krx_groups }))
  }));
  let { response } = await call('https://snowshagal.com/market/sectors/', marketDb(rows));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1 id="market-sectors-heading">업종 · 테마 등락률 순위<\/h1>/);
  assert.match(html, /최근 5거래일 누적/);
  assert.doesNotMatch(html, /최근 20거래일 누적/);

  const bare = [row('2026-10-29', { payload_json: JSON.stringify(payload({ meta: { ...FIXTURE.meta, market_date: '2026-10-29' }, krx_groups: undefined })) }), ...rows];
  ({ response } = await call('https://snowshagal.com/market/sectors/', marketDb(bare)));
  assert.equal(response.status, 404);

  ({ response } = await call('https://snowshagal.com/market/sectors', marketDb(rows)));
  assert.equal(response.status, 301);
});

test('session pages and the archive link to the sectors page, and the sitemap lists it', () => {
  assert.match(page('ko'), /href="\/market\/sectors\/">업종·테마 5일·20일 순위 →<\/a>/);
  assert.match(marketArchivePageHtml(SHELLS.en, [], 'en'), /href="\/en\/market\/sectors\/"/);
  const xml = sitemapXml([], { marketSessions: [{ market_date: '2026-10-28', published_at: '2026-10-28T07:10:35Z' }] });
  assert.match(xml, /<loc>https:\/\/snowshagal.com\/market\/sectors\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/snowshagal.com\/en\/market\/sectors\/<\/loc>/);
});


/* --------------------------------------------------- indicator histories */

const indicator = (code) => MARKET_INDICATORS.find((item) => item.code === code);

// One stored row per session: the item for one instrument, as D1 returns it.
function indicatorRow(marketDate, item) {
  return { market_date: marketDate, published_at: `${marketDate}T07:10:00Z`, item: JSON.stringify(item) };
}

test('every instrument has a history path; anything else under /market/ is left alone', () => {
  assert.equal(MARKET_INDICATORS.length, 29);
  assert.equal(MARKET_INDICATORS.filter((item) => item.optional).length, 15);
  assert.equal(MARKET_INDICATORS.filter((item) => item.domestic).length, 4);
  for (const item of MARKET_INDICATORS) {
    assert.equal(item.slug, item.code === 'COMEX_COPPER' ? 'copper' : item.code.toLowerCase());
    assert.deepEqual(parseMarketPagePath(`/market/${item.slug}/`), { lang: 'ko', indicator: item, canonical: true });
    assert.deepEqual(parseMarketPagePath(`/en/market/${item.slug}`), { lang: 'en', indicator: item, canonical: false });
    assert.equal(marketIndicatorPath(item.code, 'en'), `/en/market/${item.slug}/`);
  }
  for (const other of ['/market/foo/', '/market/KOSPI/', '/market/kospi200/', '/market/index.html', '/market/comex_copper/']) assert.equal(parseMarketPagePath(other), null, other);
});

test('a U.S. value is dated by its U.S. session and listed once; its change is against its own previous close', () => {
  const vix = indicator('VIX');
  const series = marketIndicatorSeries([
    indicatorRow('2026-11-20', { close: 28.44, previous_close: 24.56, source_date: '2026-11-19', data_state: 'final_close' }),
    // A KRX session after a U.S. holiday carries the same U.S. close again.
    indicatorRow('2026-11-19', { close: 24.56, previous_close: 25.46, source_date: '2026-11-18', data_state: 'final_close' }),
    indicatorRow('2026-11-18', { close: 24.56, previous_close: 25.46, source_date: '2026-11-18', data_state: 'final_close' }),
    indicatorRow('2026-11-17', { close: null, data_state: 'unavailable' })
  ], vix);
  assert.deepEqual(series.map((point) => [point.date, point.recordDate]), [['2026-11-19', '2026-11-20'], ['2026-11-18', '2026-11-18']]);
  assert.ok(Math.abs(series[0].change - 3.88) < 1e-9);
  assert.ok(Math.abs(series[0].changePct - (28.44 / 24.56 - 1) * 100) < 1e-9);
});

test('the 15:30 rate changes against the previous fixing, a snapshot against the previous record', () => {
  const fx = marketIndicatorSeries([
    // The payload's own change is against the live quote (1,335.89); the page uses the fixing.
    indicatorRow('2026-11-20', { close: 1336, current: 1335.89, previous_close: 1330.2, change: 5.69, source_date: '2026-11-20' }),
    indicatorRow('2026-11-19', { close: 1330.2, previous_close: 1333.2, source_date: '2026-11-19' })
  ], indicator('USDKRW'));
  assert.ok(Math.abs(fx[0].change - 5.8) < 1e-9);
  const gold = marketIndicatorSeries([
    indicatorRow('2026-11-20', { close: 3561, previous_close: 3685.5, source_date: '2026-11-20' }),
    indicatorRow('2026-11-19', { close: 3735.3, previous_close: 3741.9, source_date: '2026-11-19' })
  ], indicator('GOLD'));
  assert.ok(Math.abs(gold[0].change - (3561 - 3735.3)) < 1e-9, 'against the previous record, not the settlement');
  assert.equal(gold[1].change, null, 'the oldest record has nothing to compare with');
});

test('the summary picks the 1-week and 1-month references and the record high and low', () => {
  const dates = ['2026-11-20', '2026-11-19', '2026-11-13', '2026-11-12', '2026-10-20', '2026-10-19', '2026-08-25'];
  const closes = [100, 99, 98, 120, 90, 80, 85];
  const series = marketIndicatorSeries(dates.map((date, i) => indicatorRow(date, { close: closes[i], previous_close: closes[i] - 1, source_date: date })), indicator('KOSPI'));
  const stats = marketIndicatorStats(series);
  assert.equal(stats.latest.date, '2026-11-20');
  assert.equal(stats.week.date, '2026-11-13');
  assert.equal(stats.month.date, '2026-10-20');
  assert.equal(stats.first.date, '2026-08-25');
  assert.deepEqual([stats.high.date, stats.low.date], ['2026-11-12', '2026-10-19']);
});

function fixtureRows(code, count = 25) {
  const item = indicator(code);
  const base = FIXTURE[item.group][code];
  const rows = [];
  const day = new Date(Date.UTC(2026, 9, 28));
  for (let i = 0; rows.length < count; i += 1) {
    if (day.getUTCDay() % 6 !== 0) {
      const date = day.toISOString().slice(0, 10);
      const close = base.close * (1 + (rows.length % 5) / 100);
      rows.push(indicatorRow(date, { ...base, close, previous_close: close * 0.99, source_date: date, high: close + 1, low: close - 1 }));
    }
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return rows;
}

test('a history page has its own head, a summary, a chart, a table by month and links to the sessions', () => {
  for (const lang of ['ko', 'en']) {
    const usdkrw = indicator('USDKRW');
    const series = marketIndicatorSeries(fixtureRows('USDKRW'), usdkrw);
    const html = marketIndicatorPageHtml(SHELLS[lang], usdkrw, series, lang);
    const self = `https://snowshagal.com${lang === 'en' ? '/en' : ''}/market/usdkrw/`;
    const head = html.slice(0, html.indexOf('</head>'));
    assert.equal((head.match(/<title>/g) || []).length, 1);
    assert.ok(head.includes(`<title>${marketIndicatorTitle(usdkrw, series, lang).replace(/&/g, '&amp;')}</title>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${self}">`));
    assert.match(html, /hreflang="ko" href="https:\/\/snowshagal.com\/market\/usdkrw\/"/);
    assert.match(html, /hreflang="en" href="https:\/\/snowshagal.com\/en\/market\/usdkrw\/"/);
    assert.match(html, /"@type":"BreadcrumbList"/);
    assert.doesNotMatch(html, /market-close\.js/);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    assert.equal((main.match(/class="indicator-stat"/g) || []).length, 6);
    assert.match(main, /<figure class="indicator-chart">/);
    assert.ok((main.match(/class="indicator-chart-tick"/g) || []).length >= 2);
    assert.equal((main.match(/<rect /g) || []).length, series.length, 'one hover band per value');
    assert.equal((main.match(/<tr>/g) || []).length - (main.match(/<thead>/g) || []).length, series.length);
    assert.match(main, new RegExp(`href="${lang === 'en' ? '/en' : ''}/market/2026-10-28/"`));
    assert.equal((main.match(/class="indicator-links"/g) || []).length, 1);
    assert.equal((main.match(/<a href="(?:\/en)?\/market\/[a-z0-9]+\/">/g) || []).length >= 13, true);
    assert.doesNotMatch(main, /href="(?:\/en)?\/market\/usdkrw\/"/, 'no link to itself');
    if (lang === 'en') assert.doesNotMatch(main, /[ㄱ-ㆎ가-힣]/);
  }
});

test('KRX indices list their high and low; the 10-year yield moves in basis points', () => {
  const kospi = marketIndicatorPageHtml(SHELLS.ko, indicator('KOSPI'), marketIndicatorSeries(fixtureRows('KOSPI'), indicator('KOSPI')), 'ko');
  assert.match(kospi, /<table class="market-table market-indicator-table with-range">/);
  assert.match(kospi, /<th scope="col">고가<\/th><th scope="col">저가<\/th>/);
  const us10y = marketIndicatorPageHtml(SHELLS.en, indicator('US10Y'), marketIndicatorSeries(fixtureRows('US10Y'), indicator('US10Y')), 'en');
  assert.match(us10y, /[+−]\d+\.\dbp/);
  assert.doesNotMatch(us10y, /<th scope="col">Change %<\/th>/);
  assert.match(us10y, /Dates are U\.S\. trading days/);
});

test('the history route serves the page, redirects to the slash form, 404s without data and 503s when D1 hangs', async () => {
  const rows = [row('2026-08-27'), row('2026-08-28'), row('2026-08-31', { status: 'incomplete' })];
  let { response, passed } = await call('https://snowshagal.com/market/usdkrw/', marketDb(rows));
  assert.equal(response.status, 200);
  assert.equal(passed, false);
  const html = await response.text();
  assert.match(html, /<h1 id="market-indicator-heading">원\/달러 환율 일별 기록<\/h1>/);
  assert.match(html, /href="\/market\/2026-08-28\/"/);
  assert.doesNotMatch(html, /href="\/market\/2026-08-31\/"/, 'an incomplete row is not listed');
  ({ response } = await call('https://snowshagal.com/en/market/kospi', marketDb(rows)));
  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://snowshagal.com/en/market/kospi/');
  ({ response } = await call('https://snowshagal.com/market/kospi/', marketDb([])));
  assert.equal(response.status, 404);
  ({ response, passed } = await call('https://snowshagal.com/market/unknown/', marketDb(rows)));
  assert.equal(passed, true);
  ({ response } = await call('https://snowshagal.com/market/kospi/', marketDb(rows, { hang: true }), { budgetMs: 20 }));
  assert.equal(response.status, 503);
});

test('the sitemap lists every history page in both languages; the archive and session cards link to them', () => {
  const xml = sitemapXml([], { marketSessions: [{ market_date: '2026-10-28', published_at: '2026-10-28T07:10:35Z' }] });
  // The optional indicators (2026-11) appear once a record has their value; this one has none.
  for (const item of MARKET_INDICATORS.filter((entry) => entry.optional)) assert.doesNotMatch(xml, new RegExp(`/market/${item.slug}/`));
  for (const item of MARKET_INDICATORS.filter((entry) => !entry.optional)) {
    assert.match(xml, new RegExp(`<loc>https://snowshagal.com/market/${item.slug}/</loc><lastmod>2026-10-28</lastmod><xhtml:link rel="alternate" hreflang="ko" href="https://snowshagal.com/market/${item.slug}/"/><xhtml:link rel="alternate" hreflang="en" href="https://snowshagal.com/en/market/${item.slug}/"/>`));
    assert.match(xml, new RegExp(`<loc>https://snowshagal.com/en/market/${item.slug}/</loc>`));
  }
  const archive = marketArchivePageHtml(SHELLS.ko, [{ market_date: '2026-10-28', kospi_close: 1, kospi_pct: 0, kosdaq_close: 1, kosdaq_pct: 0, foreign_net: 0, usdkrw: 1 }], 'ko');
  const nav = archive.slice(archive.indexOf('id="indicators"'), archive.indexOf('</nav>', archive.indexOf('id="indicators"')));
  assert.equal((nav.match(/<a href="\/market\/[a-z0-9]+\/">/g) || []).length, 14);
  const session = page('en');
  for (const slug of ['kospi', 'nasdaq', 'usdkrw', 'bitcoin']) assert.match(session, new RegExp(`<a class="instrument-history-link" href="/en/market/${slug}/">`));
});
