#!/usr/bin/env node
// IndexNow: tell Naver and Bing which public addresses a push to main added,
// changed or removed, once Production answers for them. Each engine shares
// what it receives with the other IndexNow engines (Yandex, Seznam, …).
//
// The key is public by design: search engines check it by reading
// https://snowshagal.com/<key>.txt, which holds the key itself. It is not a
// secret and lives in the repository.
//
//   node scripts/indexnow.mjs --before <sha> --after <sha>   a push (the workflow)
//   node scripts/indexnow.mjs --sitemap                       every address in the live sitemap
//   node scripts/indexnow.mjs --urls <url> [<url> …]          these addresses
//   add --dry-run to print what would be sent without sending it
//
// Only status codes are printed; nothing the engines answer is echoed.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reportSiteUrl } from '../functions/_seo.js';
import { marketDatePath } from '../functions/_market-date-page.js';

export const INDEXNOW_KEY = 'e3a7311e145f89bfae40b28bc392c102';
export const INDEXNOW_HOST = 'snowshagal.com';
export const PRODUCTION_ORIGIN = `https://${INDEXNOW_HOST}`;
export const INDEXNOW_KEY_LOCATION = `${PRODUCTION_ORIGIN}/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINTS = Object.freeze([
  Object.freeze({ name: 'naver', url: 'https://searchadvisor.naver.com/indexnow' }),
  Object.freeze({ name: 'bing', url: 'https://www.bing.com/indexnow' })
]);
// The protocol takes up to 10,000 addresses in one request.
export const INDEXNOW_BATCH = 10000;

// Fields whose change shows on the page or in a search result. A change to
// anything else (a reading-time recount, a cover thumbnail) is not news.
export const VISIBLE_FIELDS = Object.freeze([
  'href', 'type', 'lang', 'title', 'subtitle', 'description', 'summary', 'takeaway',
  'seoTitle', 'reportDate', 'date', 'tags', 'coverImage', 'shareCardImage', 'translationGroup'
]);

const list = (value) => (Array.isArray(value) ? value : []);
const isReport = (post) => typeof post?.href === 'string' && /^\/?reports\/.+\.html?$/i.test(post.href);
const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const isoDate = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '');

/**
 * The addresses one change to data/posts.json touches, each with what is
 * expected of it: `live` (answers 200) or `gone` (no longer answers 200).
 * A new Daily brings its session page (/market/<date>/), which already
 * exists when the Daily goes up after the close; it is sent only if it
 * answers.
 */
export function changedUrls(beforePosts, afterPosts) {
  const before = new Map(list(beforePosts).filter(isReport).map((post) => [post.id, post]));
  const after = new Map(list(afterPosts).filter(isReport).map((post) => [post.id, post]));
  const out = new Map();
  const add = (url, expect, reason) => { if (!out.has(url)) out.set(url, { url, expect, reason }); };

  for (const [id, post] of after) {
    const old = before.get(id);
    if (!old) {
      add(reportSiteUrl(post.href), 'live', 'added');
      const date = isoDate(post.reportDate || post.date);
      if (post.type === 'daily' && date) add(`${PRODUCTION_ORIGIN}${marketDatePath(date, post.lang === 'en' ? 'en' : 'ko')}`, 'live', 'session');
      continue;
    }
    if (VISIBLE_FIELDS.some((field) => !same(old[field], post[field]))) {
      add(reportSiteUrl(post.href), 'live', 'updated');
      if (!same(old.href, post.href)) add(reportSiteUrl(old.href), 'gone', 'moved');
    }
  }
  for (const [id, post] of before) {
    if (!after.has(id)) add(reportSiteUrl(post.href), 'gone', 'removed');
  }
  return [...out.values()];
}

/** The request body the protocol defines. */
export function indexNowPayload(urls) {
  return {
    host: INDEXNOW_HOST,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: [...urls]
  };
}

/** Only this site's own https addresses are ever sent. */
export function ownUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && url.host === INDEXNOW_HOST ? url.href : '';
  } catch (_) {
    return '';
  }
}

export function sitemapUrls(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((match) => ownUrl(match[1].replace(/&amp;/g, '&')))
    .filter(Boolean);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until each address is in the state expected of it, so an engine that
 * crawls at once finds the page rather than the deploy still in flight.
 * Returns the addresses ready to send; the rest are left out and named.
 */
export async function settle(entries, { fetchImpl = fetch, timeoutMs = 10 * 60 * 1000, intervalMs = 15000, now = Date.now, wait = sleep } = {}) {
  const pending = new Map(entries.map((entry) => [entry.url, entry]));
  const ready = [];
  const deadline = now() + timeoutMs;
  for (;;) {
    for (const entry of [...pending.values()]) {
      let status = 0;
      try {
        status = (await fetchImpl(entry.url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'snowshagal-indexnow/1.0' } })).status;
      } catch (_) {}
      const done = entry.expect === 'gone' ? status !== 0 && status !== 200 : status === 200;
      if (done) { ready.push(entry); pending.delete(entry.url); }
      else if (entry.reason === 'session' && status !== 0 && status !== 200) pending.delete(entry.url);
    }
    if (pending.size === 0 || now() >= deadline) break;
    await wait(intervalMs);
  }
  return { ready, skipped: [...pending.values()] };
}

/** POSTs to every endpoint; returns [{ name, status }]. */
export async function submit(urls, { fetchImpl = fetch, endpoints = INDEXNOW_ENDPOINTS } = {}) {
  const results = [];
  for (const endpoint of endpoints) {
    for (let start = 0; start < urls.length; start += INDEXNOW_BATCH) {
      let status = 0;
      try {
        const response = await fetchImpl(endpoint.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify(indexNowPayload(urls.slice(start, start + INDEXNOW_BATCH)))
        });
        status = response.status;
      } catch (_) {}
      results.push({ name: endpoint.name, status });
    }
  }
  return results;
}

// 200 sent, 202 received with the key still being checked.
export const accepted = (status) => status === 200 || status === 202;

function postsAt(sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`not a commit: ${sha}`);
  try {
    return JSON.parse(execFileSync('git', ['show', `${sha}:data/posts.json`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  } catch (_) {
    return null;
  }
}

function argument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || '' : '';
}

export async function main(args = process.argv.slice(2), { fetchImpl = fetch, log = console.log, settleOptions = {} } = {}) {
  const dryRun = args.includes('--dry-run');
  let entries;
  if (args.includes('--sitemap')) {
    const response = await fetchImpl(`${PRODUCTION_ORIGIN}/sitemap.xml`, { headers: { 'user-agent': 'snowshagal-indexnow/1.0' } });
    if (response.status !== 200) throw new Error(`sitemap answered ${response.status}`);
    entries = sitemapUrls(await response.text()).map((url) => ({ url, expect: 'live', reason: 'sitemap' }));
  } else if (args.includes('--urls')) {
    const raw = args.slice(args.indexOf('--urls') + 1).filter((value) => !value.startsWith('--')).join(' ');
    const urls = raw.split(/\s+/).filter(Boolean);
    const bad = urls.filter((value) => !ownUrl(value));
    if (bad.length) throw new Error(`not a ${PRODUCTION_ORIGIN} address: ${bad.join(' ')}`);
    entries = [...new Set(urls.map(ownUrl))].map((url) => ({ url, expect: 'live', reason: 'requested' }));
  } else {
    const before = postsAt(argument(args, '--before'));
    const after = postsAt(argument(args, '--after'));
    if (!after) throw new Error('data/posts.json is unreadable at --after');
    // The first push of a new history has no "before": nothing to compare.
    entries = before ? changedUrls(before, after) : [];
  }

  for (const entry of entries) log(`${entry.reason.padEnd(9)} ${entry.url}`);
  if (entries.length === 0) { log('IndexNow: nothing changed for search engines.'); return 0; }

  const { ready, skipped } = entries.every((entry) => entry.reason === 'sitemap')
    ? { ready: entries, skipped: [] }
    : await settle(entries, { fetchImpl, ...settleOptions });
  for (const entry of skipped) log(`not ready, left out: ${entry.url}`);
  if (ready.length === 0) { log('IndexNow: no address was ready; nothing sent.'); return skipped.some((entry) => entry.reason !== 'session') ? 1 : 0; }
  if (dryRun) { log(`IndexNow dry run: ${ready.length} address(es) would go to ${INDEXNOW_ENDPOINTS.map((endpoint) => endpoint.name).join(', ')}.`); return 0; }

  const results = await submit(ready.map((entry) => entry.url), { fetchImpl });
  for (const result of results) log(`IndexNow ${result.name}: ${result.status || 'no answer'}`);
  return results.every((result) => accepted(result.status)) ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => { process.exitCode = code; }, (error) => { console.error(`IndexNow failed: ${error.message}`); process.exitCode = 1; });
}
