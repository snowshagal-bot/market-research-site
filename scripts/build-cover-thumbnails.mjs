#!/usr/bin/env node
/**
 * Makes the 450px thumbnail beside each published cover.
 *
 * The homepage draws a cover at 112px on a desktop and at most 140px in the
 * hero, so sending the 900×1350 original to those cards is four times the
 * pixels any screen can show. This writes `covers/<id>-450.webp` next to each
 * `covers/<id>.<ext>`, at the same 2:3 shape, from the same artwork, with
 * nothing cropped and nothing sharpened.
 *
 * It encodes the way the covers themselves are encoded: Chrome's canvas,
 * WebP at quality 0.9, the policy `assets/cover-generator.js` already sets.
 * A headless Chrome does the drawing here so the result matches what the
 * admin's browser would produce for a new report.
 *
 *   node scripts/build-cover-thumbnails.mjs            # only missing or stale
 *   node scripts/build-cover-thumbnails.mjs --force    # redo every one
 *   node scripts/build-cover-thumbnails.mjs --check    # report, write nothing
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const THUMBNAIL_WIDTH = 450;
export const THUMBNAIL_QUALITY = 0.9;   // matches assets/cover-generator.js

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

/** `covers/x.webp` → `covers/x-450.webp`; the thumbnail is always WebP. */
export function thumbnailPathFor(coverPath) {
  const normalized = String(coverPath || '').replace(/^\/+/, '');
  const match = normalized.match(/^(.*)\.(webp|png|jpe?g)$/i);
  return match ? `${match[1]}-${THUMBNAIL_WIDTH}.webp` : '';
}

export function listCovers(root = ROOT) {
  const posts = JSON.parse(readFileSync(path.join(root, 'data', 'posts.json'), 'utf8'));
  const seen = new Set();
  return posts
    .map(post => String(post.coverImage || '').replace(/^\/+/, ''))
    .filter(cover => cover && !seen.has(cover) && seen.add(cover))
    .map(cover => ({ cover, thumbnail: thumbnailPathFor(cover) }));
}

function stale(root, cover, thumbnail) {
  const source = path.join(root, cover);
  const target = path.join(root, thumbnail);
  if (!existsSync(source)) return false;
  if (!existsSync(target)) return true;
  return statSync(target).mtimeMs < statSync(source).mtimeMs;
}

// A page with one job: decode a data URL, draw it into a 450-wide canvas with
// the best resampling the browser offers, and hand back a WebP.
const ENCODER_PAGE = `<!doctype html><meta charset="utf-8"><script>
window.encode = (dataUrl, width, quality) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const height = Math.round(image.naturalHeight * width / image.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    canvas.toBlob(blob => {
      if (!blob || blob.type !== 'image/webp') return reject(new Error('webp encode failed'));
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, width, height, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight });
      reader.readAsDataURL(blob);
    }, 'image/webp', quality);
  };
  image.onerror = () => reject(new Error('decode failed'));
  image.src = dataUrl;
});
</script>`;

async function withChrome(fn) {
  const chrome = CHROME_CANDIDATES.find(candidate => existsSync(candidate));
  if (!chrome) throw new Error('No Chrome found; set CHROME_PATH');
  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(path.join(tmpdir(), 'thumb-'));
  const child = spawn(chrome, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch { /* starting */ }
      await new Promise(r => setTimeout(r, 300));
    }
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id; pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
      setTimeout(() => { if (pending.delete(n)) reject(new Error(`${method} timed out`)); }, 120000);
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(ENCODER_PAGE)}` });
    await new Promise(r => setTimeout(r, 800));
    return await fn(async (dataUrl) => {
      const { result } = await send('Runtime.evaluate', {
        expression: `window.encode(${JSON.stringify(dataUrl)}, ${THUMBNAIL_WIDTH}, ${THUMBNAIL_QUALITY}).then(r => JSON.stringify(r))`,
        awaitPromise: true, returnByValue: true
      });
      return JSON.parse(result.value);
    });
  } finally {
    child.kill();
    await new Promise(r => setTimeout(r, 400));
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows holds it briefly */ }
  }
}

/**
 * Records in `posts.json` which thumbnails are actually on disk, as
 * `coverThumbnail`, and drops the field where the file is not. The homepage
 * renders from this field alone, never from an assumption that the file
 * exists, so the metadata and the files are made to agree here. Returns how
 * many posts changed; the derived `posts.js` and search index are rebuilt
 * when any did.
 */
export async function recordThumbnails(root = ROOT, log = console.log) {
  const postsPath = path.join(root, 'data', 'posts.json');
  const raw = readFileSync(postsPath, 'utf8');
  const posts = JSON.parse(raw);
  let changed = 0;
  for (const post of posts) {
    const cover = String(post.coverImage || '').replace(/^\/+/, '');
    const thumbnail = cover ? thumbnailPathFor(cover) : '';
    const present = thumbnail && existsSync(path.join(root, thumbnail));
    if (present && post.coverThumbnail !== thumbnail) { post.coverThumbnail = thumbnail; changed += 1; }
    if (!present && post.coverThumbnail !== undefined) { delete post.coverThumbnail; changed += 1; }
  }
  if (changed) {
    const newline = raw.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(postsPath, JSON.stringify(posts, null, 2).replace(/\n/g, newline) + newline);
    const { buildSearchIndex } = await import('./build-search-index.mjs');
    buildSearchIndex(root);
    log(`${changed} post(s) had their coverThumbnail metadata updated; posts.js and the search index were rebuilt`);
  }
  return changed;
}

export async function buildThumbnails({ root = ROOT, force = false, check = false, log = console.log } = {}) {
  const covers = listCovers(root);
  const todo = covers.filter(({ cover, thumbnail }) => existsSync(path.join(root, cover)) && (force || stale(root, cover, thumbnail)));
  const summary = { covers: covers.length, written: 0, skipped: covers.length - todo.length, missing: todo.map(t => t.thumbnail), recorded: 0 };
  if (check) {
    const posts = JSON.parse(readFileSync(path.join(root, 'data', 'posts.json'), 'utf8'));
    const unrecorded = covers.filter(({ cover, thumbnail }) => existsSync(path.join(root, thumbnail))
      && !posts.some(post => String(post.coverImage || '').replace(/^\/+/, '') === cover && post.coverThumbnail === thumbnail)).length;
    log(`${covers.length} covers, ${todo.length} thumbnail(s) would be written, ${unrecorded} present but not recorded in posts.json`);
    return summary;
  }
  if (todo.length) {
    await withChrome(async (encode) => {
      for (const { cover, thumbnail } of todo) {
        const bytes = readFileSync(path.join(root, cover));
        const mime = /\.png$/i.test(cover) ? 'image/png' : /\.jpe?g$/i.test(cover) ? 'image/jpeg' : 'image/webp';
        const out = await encode(`data:${mime};base64,${bytes.toString('base64')}`);
        const webp = Buffer.from(out.dataUrl.split(',')[1], 'base64');
        writeFileSync(path.join(root, thumbnail), webp);
        summary.written += 1;
        log(`  ${thumbnail}  ${out.sourceWidth}x${out.sourceHeight} -> ${out.width}x${out.height}  ${Math.round(bytes.length / 1024)}KB -> ${Math.round(webp.length / 1024)}KB`);
      }
    });
    summary.missing = [];
  }
  summary.recorded = await recordThumbnails(root, log);
  log(`${summary.written} thumbnail(s) written, ${summary.skipped} already current, ${summary.recorded} metadata change(s)`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildThumbnails({ force: process.argv.includes('--force'), check: process.argv.includes('--check') })
    .catch(error => { console.error(error); process.exit(1); });
}
