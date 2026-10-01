#!/usr/bin/env node
/**
 * One-off historical backfill of stored report metadata (PR C).
 *
 * Posts published before the publisher's metadata fix (#151) stored a
 * category sentence as their description, missed the Daily hero quote as a
 * summary and the `.dcv-one .oc` line as a takeaway, and ran some cover rows
 * together into one title. This applies the owner-approved corrections listed
 * in scripts/backfill-report-metadata.manifest.json, and nothing else.
 *
 *   node scripts/backfill-report-metadata.mjs            dry run (default): check and print the plan
 *   node scripts/backfill-report-metadata.mjs --list     dry run, listing every change
 *   node scripts/backfill-report-metadata.mjs --write    apply, regenerate, verify
 *
 * Every manifest change names a post, a field, the rule behind it, the value
 * it replaces and the value it writes:
 * - a field holding the replaced value is changed;
 * - a field already holding the new value is left alone, so a second run
 *   writes nothing;
 * - a field holding anything else stops the run before a byte is written.
 * Each new value must be what its rule reads from the report itself, with the
 * publisher's own readers (assets/admin.js), and every post is scanned so a
 * change the rules would make but the manifest does not approve also stops
 * the run. With --write, data/posts.json is rewritten, the canonical build
 * (scripts/build-search-index.mjs) regenerates data/posts.js and the search
 * artifacts, and the result is checked; any surprise restores every file.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildSearchIndex } from './build-search-index.mjs';
// The publisher's readers, lifted out of assets/admin.js, over the same
// browser-faithful document the metadata tests use.
import { loadAdminDetectors } from '../tests/helpers/admin-detectors.mjs';
import { parseHtml } from '../tests/helpers/html-dom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = 'scripts/backfill-report-metadata.manifest.json';
export const FIELDS = Object.freeze(['title', 'description', 'summary', 'takeaway']);

// Owner decisions (PR C). These are the only new values not read from a report.
// Descriptions that paraphrase a category sentence without matching one
// exactly: blanked by id, never by a similarity rule.
export const NEAR_BOILERPLATE_IDS = Object.freeze(['2026-08-07-daily', '2026-08-03-daily-ely1wy', '2026-08-week1-weekly']);
// A stored summary that kept Markdown's ** in plain-text metadata. Only the
// markers go; the words stay the editor's.
export const MARKDOWN_EMPHASIS_ID = '2026-07-29-research-m2ef0m';

const META = () => globalThis.REPORT_METADATA;
const isBlank = (value) => !String(value ?? '').replace(/\s+/g, ' ').trim();
const squash = (value) => String(value ?? '').replace(/\s+/g, '');
const spaces = (value) => (String(value ?? '').match(/\s/g) || []).length;
// What /api/publish stores for each field (functions/api/publish.js).
const storedSummary = (value) => String(value || '').trim().slice(0, 500);
const storedTakeaway = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 400);

/**
 * Each rule reads one field. Given the post, the value it would replace and
 * the report, it returns the value to write, or null when it does not apply.
 */
export const RULES = Object.freeze({
  // Cover rows the title reader now keeps apart. Only a title that differs
  // from the reading by missing spaces qualifies; a title the editor changed
  // is never rewritten.
  'title-cover-rows': {
    field: 'title',
    derive: ({ before, report }) => {
      const read = report().readers.detectTitle(report().name, report().doc);
      if (!read || read === before) return null;
      if (squash(read) !== squash(before) || spaces(before) >= spaces(read)) return null;
      return read;
    }
  },
  // A category sentence gives way to the report's own meta description, or
  // to nothing when the report has none.
  'description-category-boilerplate': {
    field: 'description',
    derive: ({ before, report }) => {
      if (!META().isCategoryBoilerplate(before)) return null;
      const own = report().readers.readDescription(report().doc);
      return own.source === 'meta-description' ? META().editorialDescription(own.text).slice(0, 700) : '';
    }
  },
  'description-owner-near-boilerplate': {
    field: 'description',
    derive: ({ post, before }) => (NEAR_BOILERPLATE_IDS.includes(post.id) && !isBlank(before) ? '' : null)
  },
  // An empty Daily summary takes the hero quote, the only summary source the
  // owner approved for history.
  'summary-daily-hero-quote': {
    field: 'summary',
    derive: ({ post, before, report }) => {
      if (post.type !== 'daily' || !isBlank(before)) return null;
      const read = report().readers.readSummary(report().doc, post.type);
      return read.source === 'daily-hero-quote' && read.text ? storedSummary(read.text) : null;
    }
  },
  'summary-owner-strip-markdown-emphasis': {
    field: 'summary',
    derive: ({ post, before }) => (post.id === MARKDOWN_EMPHASIS_ID && String(before).includes('**')
      ? String(before).replaceAll('**', '')
      : null)
  },
  // An empty Daily takeaway takes the `.dcv-one .oc` cover line. The older
  // `.dcv-ol` rows and `.cover-oneline` / `.cover-hint` copy stay unread.
  'takeaway-dcv-one-oc': {
    field: 'takeaway',
    derive: ({ post, before, report }) => {
      if (post.type !== 'daily' || !isBlank(before)) return null;
      const read = report().readers.readTakeaway(report().doc);
      return read.source === 'dcv-one-oc' && read.text ? storedTakeaway(read.text) : null;
    }
  }
});

export const valueOf = (post, field) => (post[field] ?? '');

/**
 * A lazy report reader per post, so posts no rule needs are never parsed.
 * @param {string} root repository root
 * @param {object} readers loadAdminDetectors() result
 */
export function reportReader(root, readers) {
  const cache = new Map();
  return (post) => () => {
    if (!cache.has(post.id)) {
      const file = path.join(root, String(post.href || '').replace(/^\/+/, ''));
      if (!post.href || !fs.existsSync(file)) throw new Error(`${post.id}: report file ${post.href} is missing`);
      cache.set(post.id, { readers, name: path.basename(file), doc: parseHtml(fs.readFileSync(file, 'utf8')) });
    }
    return cache.get(post.id);
  };
}

/** Writes value into a copy of post, keeping the key order /api/publish uses. */
function withField(post, field, value) {
  if (Object.hasOwn(post, field)) return { ...post, [field]: value };
  const anchor = field === 'takeaway' && Object.hasOwn(post, 'summary') ? 'summary' : 'description';
  const next = {};
  for (const [key, existing] of Object.entries(post)) {
    next[key] = existing;
    if (key === anchor) next[field] = value;
  }
  if (!Object.hasOwn(next, field)) next[field] = value;
  return next;
}

/**
 * Checks the manifest against the posts and returns what a write would do.
 * Pure apart from the report reads behind `reportFor`.
 * @param {object[]} posts data/posts.json
 * @param {{expected: object, changes: object[]}} manifest
 * @param {(post: object) => () => object} reportFor
 * @param {object} [rules] RULES, replaceable in tests
 */
export function planBackfill(posts, manifest, reportFor, rules = RULES) {
  const problems = [];
  const pending = [];
  const applied = [];
  const byId = new Map(posts.map((post) => [post.id, post]));
  const listed = new Map();

  for (const change of manifest.changes) {
    const key = `${change.id} ${change.field}`;
    const rule = rules[change.rule];
    if (listed.has(key)) problems.push(`${key}: listed twice`);
    listed.set(key, change);
    if (!rule) { problems.push(`${key}: unknown rule ${change.rule}`); continue; }
    if (rule.field !== change.field) { problems.push(`${key}: ${change.rule} writes ${rule.field}, not ${change.field}`); continue; }
    if (typeof change.before !== 'string' || typeof change.after !== 'string' || change.before === change.after) {
      problems.push(`${key}: before and after must be two different strings`);
      continue;
    }
    const post = byId.get(change.id);
    if (!post) { problems.push(`${key}: no such post`); continue; }

    // The approved new value is what the rule reads now, from the approved old one.
    const derived = rule.derive({ post, before: change.before, report: reportFor(post) });
    if (derived !== change.after) {
      problems.push(`${key}: ${change.rule} gives ${JSON.stringify(derived)}, the manifest approves ${JSON.stringify(change.after)}`);
    }

    const current = valueOf(post, change.field);
    if (current === change.before) pending.push(change);
    else if (current === change.after) applied.push(change);
    else problems.push(`${key}: holds ${JSON.stringify(current)}, neither the approved before nor after`);
  }

  // Nothing the rules would change may be missing from the manifest.
  for (const post of posts) {
    for (const [name, rule] of Object.entries(rules)) {
      const current = valueOf(post, rule.field);
      const after = rule.derive({ post, before: current, report: reportFor(post) });
      if (after === null || after === current) continue;
      const change = listed.get(`${post.id} ${rule.field}`);
      if (!change || change.rule !== name || change.before !== current || change.after !== after) {
        problems.push(`${post.id} ${rule.field}: ${name} would write ${JSON.stringify(after)}, which the manifest does not approve`);
      }
    }
  }

  const counts = Object.fromEntries(FIELDS.map((field) => [field, manifest.changes.filter((change) => change.field === field).length]));
  counts.posts = new Set(manifest.changes.map((change) => change.id)).size;
  for (const [name, expected] of Object.entries(manifest.expected || {})) {
    if (counts[name] !== expected) problems.push(`expected ${expected} ${name} changes, the manifest lists ${counts[name]}`);
  }

  const pendingById = new Map();
  for (const change of pending) pendingById.set(change.id, [...(pendingById.get(change.id) || []), change]);
  const result = posts.map((post) => (pendingById.get(post.id) || [])
    .reduce((next, change) => withField(next, change.field, change.after), post));

  // Only approved fields of approved posts differ, and nothing else moves.
  result.forEach((next, index) => {
    const post = posts[index];
    const approved = new Set((pendingById.get(post.id) || []).map((change) => change.field));
    const oldKeys = Object.keys(post);
    const keptOrder = Object.keys(next).filter((key) => Object.hasOwn(post, key));
    if (JSON.stringify(keptOrder) !== JSON.stringify(oldKeys)) problems.push(`${post.id}: key order changed`);
    for (const key of new Set([...oldKeys, ...Object.keys(next)])) {
      if (JSON.stringify(post[key]) !== JSON.stringify(next[key]) && !approved.has(key)) problems.push(`${post.id} ${key}: unapproved change`);
    }
  });

  return { pending, applied, problems, counts, result };
}

const DATA_FILES = [
  'data/posts.json',
  'data/posts.js',
  'data/search-index.json',
  'data/search-index-meta.js',
  'data/search-index-body-ko.js',
  'data/search-index-body-en.js'
];

/** Throws unless the canonical build turned `migrated` into exactly the expected files. */
function checkRegeneration(root, before, migrated, pending) {
  const read = (file) => fs.readFileSync(path.join(root, file));
  const serialized = JSON.stringify(migrated, null, 2);
  if (read('data/posts.json').toString('utf8') !== `${serialized}\n`) {
    throw new Error('data/posts.json after the build differs from the approved result (readingMinutes or another field moved)');
  }
  if (read('data/posts.js').toString('utf8') !== `window.RESEARCH_POSTS = ${serialized};\n`) {
    throw new Error('data/posts.js is not the canonical serialization of data/posts.json');
  }
  for (const file of ['data/search-index-body-ko.js', 'data/search-index-body-en.js']) {
    if (!read(file).equals(before[file])) throw new Error(`${file} changed; report bodies must not`);
  }
  const oldIndex = JSON.parse(before['data/search-index.json'].toString('utf8'));
  const newIndex = JSON.parse(read('data/search-index.json').toString('utf8'));
  const touched = new Set(pending.map((change) => change.id));
  if (JSON.stringify(oldIndex.map((entry) => entry.id)) !== JSON.stringify(newIndex.map((entry) => entry.id))) {
    throw new Error('data/search-index.json entries changed order or membership');
  }
  newIndex.forEach((entry, index) => {
    for (const key of new Set([...Object.keys(entry), ...Object.keys(oldIndex[index])])) {
      if (JSON.stringify(entry[key]) === JSON.stringify(oldIndex[index][key])) continue;
      if (!touched.has(entry.id) || !['title', 'summary'].includes(key)) {
        throw new Error(`data/search-index.json ${entry.id} ${key}: unapproved change`);
      }
    }
  });
}

function describe(plan) {
  const byRule = {};
  for (const change of [...plan.pending, ...plan.applied]) {
    const kind = change.rule === 'description-category-boilerplate' ? `${change.rule} → ${change.after ? 'report meta' : 'blank'}` : change.rule;
    byRule[kind] = byRule[kind] || { pending: 0, applied: 0 };
    byRule[kind][plan.pending.includes(change) ? 'pending' : 'applied'] += 1;
  }
  const lines = [`manifest: ${FIELDS.map((field) => `${field} ${plan.counts[field]}`).join(', ')}; posts ${plan.counts.posts}`];
  for (const [rule, count] of Object.entries(byRule).sort()) lines.push(`  ${rule}: ${count.pending} to write, ${count.applied} already applied`);
  lines.push(`to write: ${plan.pending.length} field(s) on ${new Set(plan.pending.map((change) => change.id)).size} post(s); already applied: ${plan.applied.length}`);
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2), root = ROOT) {
  const write = argv.includes('--write');
  const list = argv.includes('--list');
  const unknown = argv.filter((arg) => !['--write', '--list', '--dry-run'].includes(arg));
  if (unknown.length) throw new Error(`unknown option ${unknown.join(' ')}`);

  const posts = JSON.parse(fs.readFileSync(path.join(root, 'data/posts.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST_PATH), 'utf8'));
  const readers = await loadAdminDetectors();
  const plan = planBackfill(posts, manifest, reportReader(root, readers));

  console.log(`corpus: ${posts.length} posts`);
  console.log(describe(plan));
  if (list) {
    for (const change of plan.pending) console.log(`  ${change.id} ${change.field} [${change.rule}]: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`);
  }
  if (plan.problems.length) {
    console.error(`\nSTOP — ${plan.problems.length} problem(s); nothing was written:`);
    for (const problem of plan.problems) console.error(`  - ${problem}`);
    return 1;
  }
  if (!write) {
    console.log('\ndry run: nothing written (pass --write to apply)');
    return 0;
  }
  if (!plan.pending.length) {
    console.log('\nalready applied: nothing to write');
    return 0;
  }

  const before = Object.fromEntries(DATA_FILES.map((file) => [file, fs.readFileSync(path.join(root, file))]));
  try {
    fs.writeFileSync(path.join(root, 'data/posts.json'), `${JSON.stringify(plan.result, null, 2)}\n`, 'utf8');
    buildSearchIndex(root);
    checkRegeneration(root, before, plan.result, plan.pending);
  } catch (error) {
    for (const [file, content] of Object.entries(before)) fs.writeFileSync(path.join(root, file), content);
    console.error(`\nSTOP — ${error.message}; every data file was restored`);
    return 1;
  }
  console.log(`\nwritten: ${plan.pending.length} field(s); data/posts.js and the search artifacts regenerated; report bodies unchanged`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
