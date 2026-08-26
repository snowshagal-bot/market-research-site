import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import {
  FAVICON_TAGS,
  PRODUCTION_ORIGIN,
  SOCIAL_FALLBACK_IMAGE,
  reportSeoTags,
  sitemapXml
} from '../functions/_seo.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const bytes = path => readFile(new URL(`../${path}`, import.meta.url));
const sizeOf = async path => (await stat(new URL(`../${path}`, import.meta.url))).size;

const PUBLIC_PAGES = [
  'index.html', 'en/index.html',
  'about/index.html', 'en/about/index.html',
  'market/index.html', 'en/market/index.html'
];

const HOME_CARD = '/assets/social/snowshagal-home.jpg';
const MARKET_CARD = '/assets/social/market-close-share.jpg';

/* ---------- dependency-free image header readers ---------- */

function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'not a JPEG');
  let offset = 2;
  while (offset < buf.length) {
    assert.equal(buf[offset], 0xff, 'malformed JPEG marker');
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    // SOF0-SOF15, skipping DHT (c4), JPG (c8) and DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error('no JPEG frame header');
}

function pngSize(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG');
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function icoSizes(buf) {
  assert.equal(buf.readUInt16LE(0), 0, 'not an ICO');
  assert.equal(buf.readUInt16LE(2), 1, 'not an ICO');
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const entry = 6 + i * 16;
    return [buf[entry] || 256, buf[entry + 1] || 256];
  });
}

const countOf = (html, pattern) => (html.match(pattern) || []).length;

/* ---------- favicon ---------- */

test('favicon set exists with the expected formats and sizes', async () => {
  const ico = await bytes('favicon.ico');
  assert.deepEqual(icoSizes(ico).sort((a, b) => a[0] - b[0]), [[16, 16], [32, 32], [48, 48]]);

  assert.deepEqual(pngSize(await bytes('favicon-32x32.png')), { width: 32, height: 32 });
  assert.deepEqual(pngSize(await bytes('apple-touch-icon.png')), { width: 180, height: 180 });
  assert.deepEqual(pngSize(await bytes('assets/brand/icon-192.png')), { width: 192, height: 192 });
  assert.deepEqual(pngSize(await bytes('assets/brand/icon-512.png')), { width: 512, height: 512 });
});

test('every public page and the 404 declare the favicon set exactly once', async () => {
  for (const page of [...PUBLIC_PAGES, '404.html']) {
    const html = await read(page);
    assert.equal(countOf(html, /<link rel="icon" href="\/favicon\.ico" sizes="any">/g), 1, page);
    assert.equal(countOf(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32x32\.png">/g), 1, page);
    assert.equal(countOf(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/g), 1, page);
    assert.equal(countOf(html, /<link rel="manifest" href="\/site\.webmanifest">/g), 1, page);
  }
});

test('the shared shell supplies the same favicon set to uploaded reports', async () => {
  // Report HTML declares no icon of its own, so the middleware appends this.
  for (const fragment of [
    'rel="icon" href="/favicon.ico"',
    'href="/favicon-32x32.png"',
    'rel="apple-touch-icon" href="/apple-touch-icon.png"',
    'rel="manifest" href="/site.webmanifest"'
  ]) assert.ok(FAVICON_TAGS.includes(fragment), fragment);

  const middleware = await read('functions/_middleware.js');
  assert.match(middleware, /FAVICON_TAGS/);
  assert.match(middleware, /link\[rel~="icon"\]/);
  assert.match(middleware, /link\[rel="apple-touch-icon"\]/);
  assert.match(middleware, /link\[rel="manifest"\]/);
});

test('the web manifest is valid and points at real icons', async () => {
  const manifest = JSON.parse(await read('site.webmanifest'));
  assert.equal(manifest.name, 'Snowshagal Market Research');
  assert.deepEqual(manifest.icons.map(icon => icon.src), [
    '/assets/brand/icon-192.png',
    '/assets/brand/icon-512.png'
  ]);
  // No service worker is registered, so the manifest must not claim app display.
  assert.equal(manifest.display, 'browser');
});

/* ---------- social card assets ---------- */

test('both social cards are 1200x630 JPEGs under the sharing size budget', async () => {
  for (const path of ['assets/social/snowshagal-home.jpg', 'assets/social/market-close-share.jpg']) {
    assert.deepEqual(jpegSize(await bytes(path)), { width: 1200, height: 630 }, path);
    const size = await sizeOf(path);
    assert.ok(size <= 300 * 1024, `${path} is ${Math.round(size / 1024)}KB, over the 300KB budget`);
  }
});

/* ---------- page social metadata ---------- */

test('public pages expose exactly one of each social tag, all absolute production URLs', async () => {
  for (const page of PUBLIC_PAGES) {
    const html = await read(page);
    for (const [label, pattern] of [
      ['canonical', /<link rel="canonical"/g],
      ['og:title', /<meta property="og:title"/g],
      ['og:description', /<meta property="og:description"/g],
      ['og:url', /<meta property="og:url"/g],
      ['og:image', /<meta property="og:image"/g],
      ['og:site_name', /<meta property="og:site_name"/g],
      ['twitter:card', /<meta name="twitter:card"/g],
      ['twitter:title', /<meta name="twitter:title"/g],
      ['twitter:description', /<meta name="twitter:description"/g],
      ['twitter:image', /<meta name="twitter:image"/g]
    ]) {
      assert.equal(countOf(html, pattern), 1, `${page}: ${label}`);
    }

    for (const attr of ['og:image', 'twitter:image']) {
      const value = html.match(new RegExp(`(?:property|name)="${attr}" content="([^"]*)"`))[1];
      assert.ok(value.startsWith(`${PRODUCTION_ORIGIN}/`), `${page}: ${attr} must be absolute, got ${value}`);
    }

    assert.match(html, /<meta property="og:site_name" content="Snowshagal">/, page);
    assert.doesNotMatch(html, /pages\.dev|localhost/, page);
    // No X handle has been confirmed, so none is claimed.
    assert.doesNotMatch(html, /twitter:(?:site|creator)/, page);
  }
});

test('the homepages share the brand card and the Market pages share the market card', async () => {
  for (const page of ['index.html', 'en/index.html', 'about/index.html', 'en/about/index.html']) {
    const html = await read(page);
    assert.match(html, new RegExp(`property="og:image" content="${PRODUCTION_ORIGIN}${HOME_CARD}"`), page);
    assert.match(html, new RegExp(`name="twitter:image" content="${PRODUCTION_ORIGIN}${HOME_CARD}"`), page);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, page);
    assert.match(html, /<meta property="og:image:width" content="1200">/, page);
    assert.match(html, /<meta property="og:image:height" content="630">/, page);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+">/, page);
  }

  for (const page of ['market/index.html', 'en/market/index.html']) {
    const html = await read(page);
    assert.match(html, new RegExp(`property="og:image" content="${PRODUCTION_ORIGIN}${MARKET_CARD}"`), page);
    assert.match(html, new RegExp(`name="twitter:image" content="${PRODUCTION_ORIGIN}${MARKET_CARD}"`), page);
    // The heavy PNG stays as on-screen artwork but must never be the share image.
    assert.doesNotMatch(html, /(?:og|twitter):image" content="[^"]*market-close-mountain\.png"/, page);
    assert.match(html, /preload" as="image" href="\/assets\/market-close-mountain\.webp"/, page);
  }
});

test('About is indexable and describes the archive in each language', async () => {
  const ko = await read('about/index.html');
  const en = await read('en/about/index.html');

  for (const [page, html] of [['about/index.html', ko], ['en/about/index.html', en]]) {
    assert.doesNotMatch(html, /name="robots"/, page);
    assert.match(html, /<meta name="description" content="[^"]{40,}">/, page);
    assert.match(html, /hreflang="ko"/, page);
    assert.match(html, /hreflang="en"/, page);
    assert.match(html, /hreflang="x-default"/, page);
  }

  assert.match(ko, /<title>소개 \| Snowshagal Market Research<\/title>/);
  assert.match(ko, /rel="canonical" href="https:\/\/snowshagal\.com\/about\/"/);
  assert.match(ko, /<meta property="og:locale" content="ko_KR">/);
  assert.match(ko, /독립 리서치 아카이브/);

  assert.match(en, /<title>About \| Snowshagal Market Research<\/title>/);
  assert.match(en, /rel="canonical" href="https:\/\/snowshagal\.com\/en\/about\/"/);
  assert.match(en, /<meta property="og:locale" content="en_US">/);
  assert.match(en, /independent research archive/);
});

/* ---------- report social metadata ---------- */

const covered = {
  id: 'ko-cover', lang: 'ko', title: '먼저열리는 밤', href: 'reports/8월 26일.html',
  reportDate: '2026-08-26', summary: '당일 시장의 핵심 흐름을 정리한 데일리 리포트.',
  coverImage: 'covers/2026-08-26-daily.webp'
};
const bare = {
  id: 'ko-bare', lang: 'ko', title: '좋은 회사가 왜 좋은 주식은 아닌가',
  href: 'reports/basics.html', reportDate: '2026-08-15'
};

test('a report with a cover keeps its own artwork and the small X card', async () => {
  const tags = reportSeoTags([covered], covered);
  assert.match(tags, /<meta property="og:image" content="https:\/\/snowshagal\.com\/covers\/2026-08-26-daily\.webp">/);
  assert.match(tags, /<meta name="twitter:image" content="https:\/\/snowshagal\.com\/covers\/2026-08-26-daily\.webp">/);
  // Covers are 900x1350; summary_large_image would centre-crop the title away.
  assert.match(tags, /<meta name="twitter:card" content="summary">/);
  assert.doesNotMatch(tags, /summary_large_image/);
  assert.match(tags, /<meta property="og:site_name" content="Snowshagal">/);
  assert.doesNotMatch(tags, /content="Market Research"/);
  assert.match(tags, /<meta name="twitter:title" content="먼저열리는 밤">/);
  assert.match(tags, /<meta name="twitter:description" content="당일 시장의 핵심 흐름을 정리한 데일리 리포트\.">/);
  assert.match(tags, /<meta property="og:locale" content="ko_KR">/);
});

test('a report without a cover falls back to the landscape brand card', async () => {
  const tags = reportSeoTags([bare], bare);
  const fallback = `${PRODUCTION_ORIGIN}${SOCIAL_FALLBACK_IMAGE}`;
  assert.match(tags, new RegExp(`<meta property="og:image" content="${fallback}">`));
  assert.match(tags, new RegExp(`<meta name="twitter:image" content="${fallback}">`));
  assert.match(tags, /<meta name="twitter:card" content="summary_large_image">/);
  // No summary and no description on this fixture: omit rather than invent one.
  assert.doesNotMatch(tags, /twitter:description|og:description|name="description"/);
});

test('report tags never duplicate and stay on the production origin', () => {
  for (const post of [covered, bare]) {
    const tags = reportSeoTags([post], post);
    for (const pattern of [
      /<link rel="canonical"/g, /<meta property="og:title"/g, /<meta property="og:url"/g,
      /<meta property="og:image"/g, /<meta property="og:site_name"/g, /<meta property="og:locale"/g,
      /<meta name="twitter:card"/g, /<meta name="twitter:title"/g, /<meta name="twitter:image"/g
    ]) assert.equal(countOf(tags, pattern), 1, `${post.id}: ${pattern}`);
    assert.doesNotMatch(tags, /pages\.dev|localhost|content="\//);
  }
});

test('a translated report declares the counterpart locale', () => {
  const ko = { ...covered, translationGroup: 'pair' };
  const en = { id: 'en-cover', lang: 'en', title: 'The Night Opens First', href: 'reports/en/night.html', reportDate: '2026-08-26', translationGroup: 'pair' };
  assert.match(reportSeoTags([ko, en], ko), /<meta property="og:locale:alternate" content="en_US">/);
  assert.match(reportSeoTags([ko, en], en), /<meta property="og:locale:alternate" content="ko_KR">/);
  // An unpaired report must not invent one.
  assert.doesNotMatch(reportSeoTags([bare], bare), /og:locale:alternate/);
});

test('the middleware removes report-supplied social meta so nothing duplicates', async () => {
  const middleware = await read('functions/_middleware.js');
  assert.match(middleware, /meta\[property\^="og:"\]/);
  assert.match(middleware, /meta\[name\^="twitter:"\]/);
  assert.match(middleware, /meta\[name="description"\]/);
});

/* ---------- sitemap ---------- */

test('the sitemap lists both About pages with reciprocal alternates and no duplicates', () => {
  const xml = sitemapXml([]);
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, [
    `${PRODUCTION_ORIGIN}/`,
    `${PRODUCTION_ORIGIN}/en/`,
    `${PRODUCTION_ORIGIN}/about/`,
    `${PRODUCTION_ORIGIN}/en/about/`,
    `${PRODUCTION_ORIGIN}/market/`,
    `${PRODUCTION_ORIGIN}/en/market/`
  ]);
  assert.equal(new Set(locations).size, locations.length, 'duplicate sitemap URL');

  const aboutKo = xml.match(/<url><loc>https:\/\/snowshagal\.com\/about\/<\/loc>[\s\S]*?<\/url>/)[0];
  assert.match(aboutKo, /hreflang="ko" href="https:\/\/snowshagal\.com\/about\/"/);
  assert.match(aboutKo, /hreflang="en" href="https:\/\/snowshagal\.com\/en\/about\/"/);
  assert.match(aboutKo, /hreflang="x-default" href="https:\/\/snowshagal\.com\/about\/"/);
});
