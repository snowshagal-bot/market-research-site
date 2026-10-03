#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { validateProductionFreshness, validateSourceFreshness } from '../functions/api/market/_freshness.js';

const PRODUCTION_ORIGIN = 'https://snowshagal.com';
const CATEGORY_SLUG = {
  daily: 'daily',
  weekly: 'weekly',
  research: 'research',
  basics: 'basics',
  note: 'notes'
};
const LOCALES = ['ko', 'en'];
const CATEGORY_TYPES = Object.keys(CATEGORY_SLUG);

// Cloudflare marks a Pages deployment complete a few seconds before every edge
// serves its new files. In 20 of 80 publish runs (2026-08-31..10-02) the report
// that commit had just added answered 404 between 2.1 and 10.1 s after the
// check-run completed, while a neighbouring request already got 200. Only the
// latest-report checks wait that out, only for 404, and all of them share one
// window that starts with the smoke; a 404 still there afterwards fails.
export const REPORT_PROPAGATION_WINDOW_MS = 90_000;
export const REPORT_PROPAGATION_INTERVAL_MS = 5_000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export class SmokeFailure extends Error {
  constructor(result) {
    super(`${result.failed} deployment smoke check(s) failed.`);
    this.name = 'SmokeFailure';
    this.result = result;
  }
}

export function cleanReportPath(href) {
  const raw = String(href || '').trim().replace(/^\/+/, '');
  if (!raw.startsWith('reports/') || !/\.html$/i.test(raw)) {
    throw new Error(`Invalid stored report href: ${href}`);
  }
  return `/${raw.replace(/\.html$/i, '')}`;
}

function physicalReportPath(href) {
  const raw = String(href || '').trim().replace(/^\/+/, '');
  if (!raw.startsWith('reports/') || !/\.html$/i.test(raw)) {
    throw new Error(`Invalid stored report href: ${href}`);
  }
  return `/${raw}`;
}

function postLocale(post) {
  return post?.lang === 'en' ? 'en' : 'ko';
}

function latestPost(posts, locale) {
  const candidates = posts.filter(post => postLocale(post) === locale && post?.href);
  candidates.sort((left, right) => {
    const date = String(right.reportDate || '').localeCompare(String(left.reportDate || ''));
    if (date) return date;
    const registered = String(right.registeredAt || right.registeredDate || '')
      .localeCompare(String(left.registeredAt || left.registeredDate || ''));
    if (registered) return registered;
    return String(right.id || '').localeCompare(String(left.id || ''));
  });
  if (!candidates[0]) throw new Error(`No published ${locale.toUpperCase()} report found in data/posts.json.`);
  return candidates[0];
}

function categoryPath(locale, type) {
  const prefix = locale === 'en' ? '/en' : '';
  return `${prefix}/${CATEGORY_SLUG[type]}/`;
}

function canonicalFromHtml(html) {
  for (const tag of String(html || '').match(/<link\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes[match[1].toLowerCase()] = match[3];
    }
    if (String(attributes.rel || '').toLowerCase().split(/\s+/).includes('canonical')) {
      return attributes.href || '';
    }
  }
  return '';
}

function assertStatus(response, expected, label, detail = '') {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, received ${response.status}${detail}`);
  }
}

function assertJsonResponse(response, label) {
  const contentType = response.headers.get('content-type') || '';
  if (!/application\/json/i.test(contentType)) {
    throw new Error(`${label}: expected JSON content-type, received ${contentType || '(missing)'}`);
  }
}

function validateMarketPayload(payload) {
  const required = [
    ['meta.market_date', payload?.meta?.market_date],
    ['meta.generated_at', payload?.meta?.generated_at],
    ['meta.schema_version', payload?.meta?.schema_version],
    ['meta.status', payload?.meta?.status]
  ];
  for (const [field, value] of required) {
    if (typeof value !== 'string' || !value) throw new Error(`market API: missing ${field}`);
  }
  if (payload.meta.status !== 'final') throw new Error('market API: meta.status is not final');
  if (!payload.indices || typeof payload.indices !== 'object' || Array.isArray(payload.indices)) {
    throw new Error('market API: indices object is missing');
  }
  if (payload?.validation?.passed !== true || !Array.isArray(payload?.validation?.errors)) {
    throw new Error('market API: validation contract is invalid');
  }
}

function validateCommentsPayload(payload) {
  if (payload?.ok !== true || !Array.isArray(payload?.comments)) {
    throw new Error('comments API: expected { ok: true, comments: [] } contract');
  }
}

export function normalizeLocationHeader(value) {
  const raw = String(value || '');
  if (!raw || !Array.from(raw).every(character => character.charCodeAt(0) <= 255)) return raw;
  const recovered = Buffer.from(raw, 'latin1').toString('utf8');
  return recovered.includes('\uFFFD') ? raw : recovered;
}

function normalizeOrigin(origin) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Smoke origin must use HTTP or HTTPS.');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.origin;
}

function validateModeOrigin(origin, mode) {
  const url = new URL(origin);
  const hostname = url.hostname;
  if (mode === 'production' && (
    url.protocol !== 'https:' ||
    hostname !== 'snowshagal.com' ||
    url.port !== ''
  )) {
    throw new Error('Production smoke is restricted to https://snowshagal.com.');
  }
  if (mode === 'preview' && hostname === 'snowshagal.com') {
    throw new Error('Preview smoke must never target the Production hostname.');
  }
}

export async function runSmoke({
  origin,
  mode,
  posts,
  fetchImpl = fetch,
  logger = console,
  enforceOrigin = true,
  now = new Date(),
  sleepImpl = sleep,
  clock = Date.now,
  propagationWindowMs = REPORT_PROPAGATION_WINDOW_MS,
  propagationIntervalMs = REPORT_PROPAGATION_INTERVAL_MS
}) {
  if (!['production', 'preview'].includes(mode)) throw new Error('Mode must be production or preview.');
  if (!Array.isArray(posts) || posts.length === 0) throw new Error('Smoke requires current data/posts.json records.');

  const baseOrigin = normalizeOrigin(origin);
  if (enforceOrigin) validateModeOrigin(baseOrigin, mode);

  const latest = {
    ko: latestPost(posts, 'ko'),
    en: latestPost(posts, 'en')
  };
  const checks = [];
  const propagationDeadline = clock() + propagationWindowMs;

  async function check(name, fn) {
    try {
      const note = await fn();
      checks.push({ name, ok: true });
      logger.log(`PASS ${name}${note ? ` (${note})` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({ name, ok: false, message });
      logger.error(`FAIL ${name}: ${message}`);
    }
  }

  async function request(pathname, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('accept')) headers.set('accept', '*/*');
    headers.set('user-agent', 'Snowshagal-Deployment-Smoke/1.0');
    return fetchImpl(new URL(pathname, baseOrigin), { ...options, headers });
  }

  // A newly published report: a 404 is asked again every few seconds until the
  // shared propagation window closes. Any other status returns at once and is
  // judged by the caller exactly as before.
  async function requestPublishedReport(name, pathname, options) {
    const started = clock();
    let attempt = 1;
    for (;;) {
      const response = await request(pathname, options);
      if (response.status !== 404 || clock() + propagationIntervalMs > propagationDeadline) {
        const summary = `attempts=${attempt}, waited ${seconds(clock() - started)}, propagation window ${seconds(propagationWindowMs)}`;
        let failureDetail = '';
        if (response.status === 404) failureDetail = ` (${summary}, last cf-ray ${response.headers.get('cf-ray') || 'n/a'})`;
        else if (attempt > 1) failureDetail = ` (${summary})`;
        return { response, retried: attempt > 1 ? summary : '', failureDetail };
      }
      try { await response.body?.cancel(); } catch (_) {}
      logger.log(`RETRY ${name}: HTTP 404 on attempt ${attempt} (cf-ray ${response.headers.get('cf-ray') || 'n/a'}); asking again in ${seconds(propagationIntervalMs)}, window closes in ${seconds(Math.max(0, propagationDeadline - clock()))}`);
      await sleepImpl(propagationIntervalMs);
      attempt += 1;
    }
  }

  for (const route of ['/', '/en/']) {
    await check(`page ${route}`, async () => {
      const response = await request(route, { headers: { accept: 'text/html' } });
      assertStatus(response, 200, route);
      const html = await response.text();
      const expectedCanonical = `${PRODUCTION_ORIGIN}${route}`;
      if (canonicalFromHtml(html) !== expectedCanonical) {
        throw new Error(`${route}: canonical is not ${expectedCanonical}`);
      }
      const robots = response.headers.get('x-robots-tag') || '';
      if (mode === 'preview' && !/noindex/i.test(robots)) {
        throw new Error(`${route}: Preview response is missing X-Robots-Tag noindex`);
      }
      if (mode === 'production' && /noindex/i.test(robots)) {
        throw new Error(`${route}: Production response must not be noindex`);
      }
    });
  }

  for (const locale of LOCALES) {
    for (const type of CATEGORY_TYPES) {
      const route = categoryPath(locale, type);
      await check(`category ${route}`, async () => {
        const response = await request(route, { headers: { accept: 'text/html' } });
        assertStatus(response, 200, route);
      });
    }
  }

  for (const locale of LOCALES) {
    const post = latest[locale];
    const cleanPath = cleanReportPath(post.href);
    const legacyPath = physicalReportPath(post.href);

    const latestName = `latest ${locale.toUpperCase()} report`;
    await check(latestName, async () => {
      const { response, retried, failureDetail } = await requestPublishedReport(latestName, cleanPath, { headers: { accept: 'text/html' } });
      assertStatus(response, 200, cleanPath, failureDetail);
      const html = await response.text();
      const expectedCanonical = `${PRODUCTION_ORIGIN}${encodeURI(cleanPath)}`;
      const actualCanonical = canonicalFromHtml(html);
      if (decodeURI(actualCanonical) !== decodeURI(expectedCanonical)) {
        throw new Error(`${cleanPath}: canonical mismatch (${actualCanonical || 'missing'})`);
      }
      return retried;
    });

    const legacyName = `legacy ${locale.toUpperCase()} report redirect`;
    await check(legacyName, async () => {
      const { response, retried, failureDetail } = await requestPublishedReport(legacyName, legacyPath, { redirect: 'manual' });
      assertStatus(response, 301, legacyPath, failureDetail);
      const location = normalizeLocationHeader(response.headers.get('location'));
      if (!location) throw new Error(`${legacyPath}: redirect location is missing`);
      const actual = new URL(location, baseOrigin);
      const expected = new URL(cleanPath, baseOrigin);
      if (decodeURI(actual.href) !== decodeURI(expected.href)) {
        throw new Error(`${legacyPath}: expected redirect to ${expected.href}, received ${actual.href}`);
      }
      return retried;
    });
  }

  await check('deterministic 404', async () => {
    const response = await request('/__snowshagal_smoke_missing_74__', { redirect: 'manual' });
    assertStatus(response, 404, 'missing route');
  });

  await check('sitemap', async () => {
    const response = await request('/sitemap.xml', { headers: { accept: 'application/xml,text/xml' } });
    assertStatus(response, 200, '/sitemap.xml');
    const contentType = response.headers.get('content-type') || '';
    if (!/(application|text)\/xml/i.test(contentType)) {
      throw new Error(`/sitemap.xml: expected XML content-type, received ${contentType || '(missing)'}`);
    }
    const xml = await response.text();
    if (!xml.includes(`${PRODUCTION_ORIGIN}/`)) throw new Error('sitemap: Production origin is missing');
    for (const locale of LOCALES) {
      for (const type of CATEGORY_TYPES) {
        const hasPosts = posts.some(post => postLocale(post) === locale && post.type === type);
        if (!hasPosts) continue;
        const expected = `${PRODUCTION_ORIGIN}${categoryPath(locale, type)}`;
        if (!xml.includes(expected)) throw new Error(`sitemap: missing populated category ${expected}`);
      }
    }
  });

  await check('market API', async () => {
    const response = await request('/api/market/latest', { headers: { accept: 'application/json' } });
    assertStatus(response, 200, '/api/market/latest');
    assertJsonResponse(response, '/api/market/latest');
    let payload;
    try { payload = await response.json(); }
    catch (error) { throw new Error(`/api/market/latest: invalid JSON (${error.message})`); }
    validateMarketPayload(payload);
    if (mode === 'production') {
      const sourceFreshness = validateSourceFreshness(payload);
      if (!sourceFreshness.passed) {
        throw new Error(`market API: source freshness failed (${sourceFreshness.errors.join(' | ')})`);
      }
      const productionFreshness = validateProductionFreshness(payload, now);
      if (!productionFreshness.passed) throw new Error(`market API: ${productionFreshness.message}`);
    }
  });

  await check('comments read API', async () => {
    const report = cleanReportPath(latest.ko.href);
    const url = new URL('/api/comments', baseOrigin);
    url.searchParams.set('report', report);
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Snowshagal-Deployment-Smoke/1.0'
      }
    });
    assertStatus(response, 200, '/api/comments');
    assertJsonResponse(response, '/api/comments');
    let payload;
    try { payload = await response.json(); }
    catch (error) { throw new Error(`/api/comments: invalid JSON (${error.message})`); }
    validateCommentsPayload(payload);
  });

  const failed = checks.filter(item => !item.ok).length;
  const result = { origin: baseOrigin, mode, total: checks.length, passed: checks.length - failed, failed, checks };
  if (failed) throw new SmokeFailure(result);
  return result;
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--origin', '--mode'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values[arg.slice(2)] = value;
    index += 1;
  }
  if (!values.origin || !values.mode) throw new Error('Usage: node scripts/smoke-site.mjs --origin <url> --mode <production|preview>');
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/smoke-site.mjs --origin <url> --mode <production|preview>');
    return;
  }
  const posts = JSON.parse(await fs.readFile(path.join(rootDir, 'data', 'posts.json'), 'utf8'));
  try {
    const result = await runSmoke({ origin: args.origin, mode: args.mode, posts });
    console.log(`Deployment smoke passed: ${result.passed}/${result.total}`);
  } catch (error) {
    if (error instanceof SmokeFailure) {
      console.error(`Deployment smoke failed: ${error.result.passed}/${error.result.total} passed`);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('smoke-site.mjs')) {
  await main();
}
