// The publisher's report readers, taken out of assets/admin.js itself so a
// test exercises the code that ships. admin.js is one IIFE over the publish
// form; its readers are plain functions over a parsed document, which this
// lifts out by name and rebuilds with the same constants.
import { readFile } from 'node:fs/promises';
import '../../assets/report-metadata.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const READERS = [
  'cleanTitle', 'brokenLineText', 'detectTitle', 'detectSubtitle',
  'readDescription', 'summaryText', 'readSummary', 'detectSummary',
  'normalizeTakeaway', 'elementTakeaway', 'readTakeaway', 'detectTakeaway'
];

/**
 * @param {string} [source] admin.js source; defaults to the working tree.
 * @returns the readers, plus COVER_ROWS. A reader the source does not define
 *   is left out, so an older admin.js can be loaded for comparison.
 */
export async function loadAdminDetectors(source) {
  const script = source ?? await read('assets/admin.js');
  const rows = /const COVER_ROWS = (\[[\s\S]*?\]);/.exec(script);
  if (!rows) throw new Error('admin.js no longer declares COVER_ROWS');
  const maxTakeaway = /const MAX_TAKEAWAY_LENGTH = (\d+);/.exec(script)?.[1] || '400';
  const defined = [];
  const bodies = READERS.map((name) => {
    const found = new RegExp(`\\n  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`).exec(script);
    if (!found) return '';
    defined.push(name);
    return found[0];
  }).join('\n');
  // eslint-disable-next-line no-new-func
  return new Function('window', `
    const MAX_TAKEAWAY_LENGTH = ${maxTakeaway};
    const COVER_ROWS = ${rows[1]};
    ${bodies}
    return { COVER_ROWS, ${defined.join(', ')} };
  `)({ REPORT_METADATA: globalThis.REPORT_METADATA });
}
