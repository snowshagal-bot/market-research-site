#!/usr/bin/env node
/**
 * Stamps `<meta name="report-takeaway">` into a Daily report's <head>.
 *
 * The homepage TODAY strip shows a Daily's one-liner only when the report says
 * what that line is. Covers have carried it in their own markup, which changes
 * whenever the layout does; this tag does not. It is the first thing the
 * publishing admin looks for, so a report that carries it keeps working no
 * matter how its cover is rebuilt.
 *
 *   node scripts/stamp-daily-takeaway.mjs <report.html> "오늘의 한 줄"
 *   node scripts/stamp-daily-takeaway.mjs <report.html> --check
 *
 * The line is the editor's. Nothing here derives one from the title, the
 * description or the body: with no line there is no tag, and the homepage
 * hides that row rather than showing words nobody chose.
 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

export const MAX_TAKEAWAY_LENGTH = 400;
const TAG = /<meta\s+name=(["'])report-takeaway\1[^>]*>/i;

/** Same normalization the publishing admin applies, so both agree on the value. */
export function normalizeTakeaway(value) {
  return String(value || '')
    // Zero-width characters sit inside cover copy as break hints.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TAKEAWAY_LENGTH);
}

function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Reads back whatever tag the document already carries. */
export function readTakeaway(html) {
  const tag = TAG.exec(String(html || ''))?.[0];
  if (!tag) return '';
  const content = /content=(["'])([\s\S]*?)\1/i.exec(tag)?.[2] || '';
  return normalizeTakeaway(content
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

/**
 * Returns the document with the tag set, or throws when there is nothing to
 * set or nowhere to put it. Never rewrites anything but this one tag.
 */
export function stampTakeaway(html, line) {
  const text = normalizeTakeaway(line);
  if (!text) throw new Error('빈 문구로는 meta를 만들지 않습니다.');
  const source = String(html);
  const tag = `<meta name="report-takeaway" content="${escapeAttribute(text)}">`;

  if (TAG.test(source)) return { html: source.replace(TAG, tag), text, action: 'replaced' };

  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  // After the charset declaration when there is one, so the tag is parsed with
  // the encoding already settled; otherwise straight after <head>.
  const charset = /<meta\s+charset=[^>]*>/i.exec(source);
  if (charset) {
    const at = charset.index + charset[0].length;
    return { html: `${source.slice(0, at)}${newline}${tag}${source.slice(at)}`, text, action: 'inserted' };
  }
  const head = /<head\b[^>]*>/i.exec(source);
  if (!head) throw new Error('<head>를 찾지 못했습니다. Daily HTML이 맞는지 확인하세요.');
  const at = head.index + head[0].length;
  return { html: `${source.slice(0, at)}${newline}${tag}${source.slice(at)}`, text, action: 'inserted' };
}

async function main(argv) {
  const [file, ...rest] = argv;
  if (!file) {
    console.error('사용법: node scripts/stamp-daily-takeaway.mjs <report.html> "오늘의 한 줄"');
    console.error('        node scripts/stamp-daily-takeaway.mjs <report.html> --check');
    process.exitCode = 2;
    return;
  }
  const html = await readFile(file, 'utf8');

  if (rest[0] === '--check' || rest.length === 0) {
    const current = readTakeaway(html);
    console.log(current
      ? `report-takeaway: "${current}" (${current.length}자)`
      : 'report-takeaway 없음 — 홈페이지 TODAY에서는 한 줄이 숨겨집니다.');
    return;
  }

  const line = rest.join(' ');
  let result;
  try { result = stampTakeaway(html, line); }
  catch (error) { console.error(error.message); process.exitCode = 1; return; }

  if (result.html === html) {
    console.log(`이미 같은 문구입니다: "${result.text}"`);
    return;
  }
  await writeFile(file, result.html, 'utf8');
  const verb = result.action === 'replaced' ? '교체' : '삽입';
  console.log(`${verb} 완료 · "${result.text}" (${result.text.length}자)`);
  if (normalizeTakeaway(line).length < String(line).trim().length) {
    console.log(`  ※ 원문이 ${MAX_TAKEAWAY_LENGTH}자를 넘어 잘렸습니다.`);
  }
}

// Run only when invoked directly, so the functions above stay importable.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('stamp-daily-takeaway.mjs')) {
  await main(process.argv.slice(2));
}
