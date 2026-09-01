/**
 * Fetching the text of a filing, so a date can be read out of it.
 *
 * The list OpenDART returns has no document body, and its structured APIs
 * cover periodic-report history rather than forward schedules. To learn when a
 * briefing is actually held, the filing itself has to be opened.
 *
 * Two official routes exist:
 *
 *   OpenDART /api/document.xml — requires the API key and returns a ZIP whose
 *     entries are the filing's XML. Every call spends the same daily quota the
 *     disclosure sync depends on, and the archive has to be unpacked before
 *     anything can be read.
 *
 *   dart.fss.or.kr viewer — the page the public DART link already points at.
 *     No key, plain HTML, and it is the document this site's own "원문 보기"
 *     link opens, so a reader checking the calendar against the source sees
 *     exactly what was parsed.
 *
 * The viewer is used. It needs no credential, it can be verified end to end,
 * and it keeps the filing quota for the sync that cannot do without it. Its
 * requests are still counted against the same budget, because they are still
 * requests to DART and an operator watching one number should see all of them.
 *
 * Two details are not optional. The viewer serves MS949, not UTF-8, so the
 * bytes are decoded rather than read as text — reading them as UTF-8 turns
 * every Korean label into noise and every extraction into a miss. And the
 * document lives behind a two-step lookup: the shell names the document number,
 * and only then can the body be requested.
 */

const RECEIPT_NO = /^\d{14}$/;
const VIEWER_ORIGIN = 'https://dart.fss.or.kr';

/** The link a reader follows, and the page the shell lookup starts from. */
export const filingUrl = rceptNo => `${VIEWER_ORIGIN}/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}`;

export const USER_AGENT = 'Mozilla/5.0 (compatible; SnowshagalCalendarBot/1.0; +https://snowshagal.com)';

export class DocumentFetchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** DART serves MS949; anything else would arrive as mojibake and match nothing. */
function decodeDocument(buffer, contentType = '') {
  const declared = /charset=([\w-]+)/i.exec(String(contentType))?.[1];
  const encoding = (declared || 'euc-kr').toLowerCase();
  try {
    return new TextDecoder(encoding === 'ms949' ? 'euc-kr' : encoding).decode(buffer);
  } catch (_) {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

async function readAs(response) {
  const buffer = await response.arrayBuffer();
  return decodeDocument(buffer, response.headers?.get?.('content-type') || '');
}

/**
 * The shell page names the document to fetch:
 *   viewDoc("20260330800567", "11194491", "0", "0", "0", "HTML")
 * Without those arguments there is no body to ask for, and a filing that does
 * not yield them is skipped rather than guessed at.
 */
export function parseViewerArgs(shellHtml) {
  const match = /viewDoc\(\s*"(\d{14})"\s*,\s*"(\d+)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"/.exec(String(shellHtml || ''));
  if (!match) return null;
  return {
    rcpNo: match[1],
    dcmNo: match[2],
    eleId: match[3] || '0',
    offset: match[4] || '0',
    length: match[5] || '0',
    dtd: match[6] || 'HTML'
  };
}

export function viewerUrl({ rcpNo, dcmNo, eleId, offset, length, dtd }) {
  const params = new URLSearchParams({ rcpNo, dcmNo, eleId, offset, length, dtd });
  return `${VIEWER_ORIGIN}/report/viewer.do?${params}`;
}

/**
 * Returns the filing's rendered text, or throws. Two requests per filing: the
 * shell, then the body. Callers budget for both.
 */
export const REQUESTS_PER_DOCUMENT = 2;

export async function fetchFilingDocument(rceptNo, { fetchImpl = fetch } = {}) {
  if (!RECEIPT_NO.test(String(rceptNo))) {
    throw new DocumentFetchError('BAD_RECEIPT_NO', `receipt number must be 14 digits: ${rceptNo}`);
  }
  const headers = { 'user-agent': USER_AGENT, referer: `${VIEWER_ORIGIN}/` };

  const shellResponse = await fetchImpl(filingUrl(rceptNo), { headers });
  if (!shellResponse.ok) {
    throw new DocumentFetchError('SHELL_HTTP', `filing shell returned HTTP ${shellResponse.status}`);
  }
  const args = parseViewerArgs(await readAs(shellResponse));
  if (!args) throw new DocumentFetchError('NO_VIEWER_ARGS', 'the filing page no longer names its document');

  const bodyResponse = await fetchImpl(viewerUrl(args), { headers });
  if (!bodyResponse.ok) {
    throw new DocumentFetchError('BODY_HTTP', `filing body returned HTTP ${bodyResponse.status}`);
  }
  const text = await readAs(bodyResponse);
  if (!text.trim()) throw new DocumentFetchError('EMPTY_BODY', 'the filing body was empty');
  return text;
}

export const __test = { decodeDocument };
