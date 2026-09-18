// Browser-facing search index artifacts.
//
// Every report body is indexed in full — a deliberate product requirement, so
// a keyword deep inside a 12,000 character report is still findable. That makes
// the combined index ~2.4MB, which the search dialog used to download whole
// before it could answer anything.
//
// Splitting it keeps full-body search intact while making the common case cheap:
// the metadata file carries the fields the search dialog reads and nothing
// else, enough to answer title, tag and summary queries immediately. Report
// bodies are shipped per locale, so a Korean reader never downloads the English
// bodies, and the dialog asks for them only once a query is typed.
//
// SEARCH_META_FIELDS is exactly what assets/site.js reads from a search entry
// (matching, ranking, rendering, the tag cloud and the language filter).
// typeLabel, registeredAt and coverImage stay in data/search-index.json, which
// the publisher and the post manager read back, but no browser code reads them
// from the metadata file, so they are not shipped there.
// tests/search-index-lazy-body.test.mjs holds site.js to this list.

export const SEARCH_META_FIELDS = [
  'id', 'lang', 'category', 'title', 'subtitle',
  'date', 'summary', 'tags', 'readingMinutes', 'url'
];

export const SEARCH_INDEX_PATH = 'data/search-index.json';
export const SEARCH_META_PATH = 'data/search-index-meta.js';
export const SEARCH_BODY_PATHS = { ko: 'data/search-index-body-ko.js', en: 'data/search-index-body-en.js' };

export function searchEntryLanguage(item) {
  return item?.lang === 'en' ? 'en' : 'ko';
}

export function searchMetaEntry(item) {
  const entry = {};
  for (const field of SEARCH_META_FIELDS) {
    if (item?.[field] !== undefined) entry[field] = item[field];
  }
  return entry;
}

function bodyScript(bodies) {
  // Merge rather than assign: both locale shards may be present at once.
  return `window.SEARCH_INDEX_BODY = Object.assign(window.SEARCH_INDEX_BODY || {}, ${JSON.stringify(bodies)});\n`;
}

/**
 * Every file the search index is published as, as {path, content} pairs.
 * The build script writes them to disk; the publish and manage functions turn
 * them into Git blobs, so all three writers stay in step.
 */
export function searchIndexArtifacts(searchIndex) {
  const entries = Array.isArray(searchIndex) ? searchIndex : [];
  const bodies = { ko: {}, en: {} };
  for (const item of entries) {
    if (!item?.id) continue;
    bodies[searchEntryLanguage(item)][item.id] = item.bodyText || '';
  }

  return [
    { path: SEARCH_INDEX_PATH, content: `${JSON.stringify(entries, null, 2)}\n` },
    { path: SEARCH_META_PATH, content: `window.SEARCH_INDEX_META = ${JSON.stringify(entries.map(searchMetaEntry))};\n` },
    { path: SEARCH_BODY_PATHS.ko, content: bodyScript(bodies.ko) },
    { path: SEARCH_BODY_PATHS.en, content: bodyScript(bodies.en) }
  ];
}
