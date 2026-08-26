import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/* ------------------------------------------------------------------ harness */

function makeElement(name, attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    name,
    hidden: false,
    href: '',
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    style: { setProperty() {} },
    children: [],
    getAttribute: key => (map.has(key) ? map.get(key) : null),
    setAttribute: (key, val) => map.set(key, String(val)),
    removeAttribute: key => map.delete(key),
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    append() {},
    prepend() {},
    replaceChildren() {},
    insertAdjacentHTML() {},
    insertBefore() {},
    remove() {},
    focus() {},
    select() {},
    setSelectionRange() {},
    attachShadow() { return makeShadowRoot(); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; }
  };
}

// The shell wires up real listeners, so the stub root hands back a node for
// every lookup instead of null. Caching keeps repeat lookups identity-stable.
function makeShadowRoot() {
  const root = makeElement('#shadow-root');
  const cache = new Map();
  const node = key => {
    if (!cache.has(key)) cache.set(key, makeElement(key));
    return cache.get(key);
  };
  root.getElementById = id => node(`#${id}`);
  root.querySelector = selector => node(selector);
  root.querySelectorAll = selector => [node(`all:${selector}`)];
  root.activeElement = null;
  return root;
}

/**
 * Run assets/report-shell.js in a stub document and return window.REPORT_SHELL.
 * `meta` seeds the head tags the share builders read.
 */
async function shellApi({ meta = {}, href = 'https://snowshagal.com/reports/report' } = {}) {
  const script = await read('assets/report-shell.js');

  const nodes = new Map();
  if (meta.canonical) nodes.set('link[rel="canonical"]', makeElement('link', { href: meta.canonical }));
  if (meta.ogTitle) nodes.set('meta[property="og:title"]', makeElement('meta', { content: meta.ogTitle }));
  if (meta.description) nodes.set('meta[name="description"]', makeElement('meta', { content: meta.description }));
  if (meta.ogDescription) nodes.set('meta[property="og:description"]', makeElement('meta', { content: meta.ogDescription }));

  const document = {
    currentScript: { dataset: { category: 'daily', lang: meta.lang || 'ko' } },
    documentElement: makeElement('html'),
    body: Object.assign(makeElement('body'), { firstChild: null }),
    title: meta.title || '',
    readyState: 'complete',
    addEventListener() {},
    createElement: tag => makeElement(tag),
    // Report the comments host as already mounted so mountComments() returns
    // early: this harness is about the share module, and the comment loader's
    // async work would otherwise run against stubs.
    getElementById: id => (id === 'mrs-comments-host' ? makeElement('section') : null),
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: () => [],
    execCommand: () => false
  };

  const window = { MARKET_LOCALE: undefined, addEventListener() {} };
  const context = vm.createContext({
    window,
    document,
    location: { pathname: new URL(href).pathname, href, search: new URL(href).search },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    navigator: { share: undefined, clipboard: undefined },
    fetch: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    console
  });

  vm.runInContext(script, context);
  assert.ok(window.REPORT_SHELL, 'report-shell.js must export its share builders');
  return { api: window.REPORT_SHELL, document, context };
}

const KO_TITLE = '먼저열리는 밤';
const KO_PATH = '/reports/8월 26일 주식리포트_커버통합.html';
const KO_CANONICAL = `https://snowshagal.com${encodeURI(KO_PATH).replace(/\.html$/, '')}`;

/* ------------------------------------------------------------ A. Web Share */

test('A. the share payload uses the canonical URL and drops query and hash', async () => {
  const { api } = await shellApi({
    href: `https://snowshagal.com${KO_PATH}?category=daily&utm_source=x#section-3`,
    meta: { canonical: KO_CANONICAL, ogTitle: KO_TITLE, description: '당일 시장의 핵심 흐름.' }
  });

  const url = api.canonicalShareUrl();
  assert.equal(url, KO_CANONICAL);
  assert.doesNotMatch(url, /\?|#/);
  assert.equal(api.shareTitle(), KO_TITLE);
  assert.equal(api.shareText(), '당일 시장의 핵심 흐름.');
});

test('A2. with no canonical link the address bar is stripped instead of shared raw', async () => {
  const { api } = await shellApi({
    href: 'https://snowshagal.com/reports/plain?a=1#b',
    meta: { ogTitle: 'Plain' }
  });
  assert.equal(api.canonicalShareUrl(), 'https://snowshagal.com/reports/plain');
});

test('A3. title and description fall back in the documented order', async () => {
  const withOg = await shellApi({ meta: { ogTitle: 'OG title', title: 'Document title' } });
  assert.equal(withOg.api.shareTitle(), 'OG title');

  const withoutOg = await shellApi({ meta: { title: 'Document title' } });
  assert.equal(withoutOg.api.shareTitle(), 'Document title');

  const ogDescOnly = await shellApi({ meta: { ogDescription: 'og description' } });
  assert.equal(ogDescOnly.api.shareText(), 'og description');

  const neither = await shellApi({ meta: {} });
  assert.equal(neither.api.shareText(), '');
});

/* -------------------------------------------- B. native vs popover routing */

test('B. the popover is used unless the device has a coarse pointer and no hover', async () => {
  const { api } = await shellApi();

  // no navigator.share at all -> popover
  assert.equal(api.prefersNativeShare({}), false);
  assert.equal(api.prefersNativeShare({ share: undefined }), false);

  // The routing question is asked of matchMedia, never of a user agent string.
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /\(pointer: coarse\) and \(hover: none\)/);
  assert.doesNotMatch(shell, /navigator\.userAgent|userAgentData|iPhone|Android/);
});

/* ----------------------------------------------- C-E. direct share targets */

test('C. the X intent encodes a Korean title and a Korean report path', async () => {
  const { api } = await shellApi();
  const link = api.shareLinks(KO_CANONICAL, KO_TITLE).x;
  const parsed = new URL(link);

  assert.equal(parsed.origin + parsed.pathname, 'https://x.com/intent/tweet');
  assert.equal(parsed.searchParams.get('text'), KO_TITLE);
  assert.equal(parsed.searchParams.get('url'), KO_CANONICAL);
  // Nothing raw survives into the query string.
  assert.doesNotMatch(parsed.search, /먼저열리는|[ ]/);
  assert.match(parsed.search, /%/);
});

test('D. Facebook receives the canonical URL and nothing else', async () => {
  const { api } = await shellApi();
  const parsed = new URL(api.shareLinks(KO_CANONICAL, KO_TITLE).facebook);
  assert.equal(parsed.origin + parsed.pathname, 'https://www.facebook.com/sharer/sharer.php');
  assert.equal(parsed.searchParams.get('u'), KO_CANONICAL);
  assert.deepEqual([...parsed.searchParams.keys()], ['u']);
});

test('E. LinkedIn receives the canonical URL', async () => {
  const { api } = await shellApi();
  const parsed = new URL(api.shareLinks(KO_CANONICAL, KO_TITLE).linkedin);
  assert.equal(parsed.origin + parsed.pathname, 'https://www.linkedin.com/sharing/share-offsite/');
  assert.equal(parsed.searchParams.get('url'), KO_CANONICAL);
  assert.deepEqual([...parsed.searchParams.keys()], ['url']);
});

test('E2. the direct list is exactly Copy Link, X, Facebook and LinkedIn', async () => {
  const { api } = await shellApi();
  assert.deepEqual(Object.keys(api.shareLinks('https://snowshagal.com/x', 'T')).sort(),
    ['facebook', 'linkedin', 'x']);

  const shell = await read('assets/report-shell.js');
  for (const removed of [/reddit\.com/i, /wa\.me|whatsapp/i, /t\.me|telegram/i, /bsky\.app|bluesky/i, /mailto:/i]) {
    assert.doesNotMatch(shell, removed, `${removed} must not appear in this PR`);
  }
});

/* ------------------------------------------------- L-M. Instagram / Kakao */

test('L. no Instagram share endpoint or deep link exists in the shell', async () => {
  const shell = await read('assets/report-shell.js');
  assert.doesNotMatch(shell, /instagram\.com\/share|instagram:\/\/|ig:\/\//i);
  // Instagram is reached through the OS share sheet, and that is what the copy says.
  assert.match(shell, /기기 공유 메뉴에서 선택/);
  assert.match(shell, /Use your device share menu for Instagram/);
});

test('M. no Kakao SDK, app key or custom scheme exists in the shell', async () => {
  const shell = await read('assets/report-shell.js');
  assert.doesNotMatch(shell, /kakao\.link|Kakao\.init|kakaolink:|kakaotalk:|developers\.kakao|kakao_js_key/i);
  assert.doesNotMatch(shell, /appkey|javascriptkey|app_key/i);
  // Kakao appears only in the copy telling readers to use the OS share sheet.
  assert.match(shell, /Instagram·KakaoTalk 등은 기기 공유 메뉴에서 선택/);
  assert.doesNotMatch(shell, /https?:\/\/[^'"\s]*kakao/i);
});

/* ------------------------------------------------------ J-K. copy link */

test('J-K. copy uses the clipboard when present and a selection fallback when not', async () => {
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /navigator\.clipboard\?\.writeText/);
  assert.match(shell, /document\.execCommand\('copy'\)/);
  // Last resort: show the URL in a field the reader can select.
  assert.match(shell, /showUrlForManualCopy/);
  assert.match(shell, /shareCopyManual/);
});

/* --------------------------------------------------------- N. cancellation */

test('N. cancelling a share is not surfaced as an error', async () => {
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /error\?\.name !== 'AbortError'/);
  assert.doesNotMatch(shell, /alert\(\s*copy\.share/);
});

/* --------------------------------------------- popover keyboard and focus */

test('the desktop popover is wired for expansion, escape, outside click and focus', async () => {
  const shell = await read('assets/report-shell.js');
  assert.match(shell, /aria-haspopup="true" aria-expanded="false" aria-controls="share-popover"/);
  assert.match(shell, /trigger\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(shell, /trigger\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(shell, /items\(\)\[0\]\?\.focus\(\)/);
  assert.match(shell, /event\.key !== 'Escape'/);
  assert.match(shell, /event\.composedPath/);
  assert.match(shell, /trigger\.focus\(\)/);
});

/* ------------------------------------------------------- O. mount coverage */

test('O. the shell mounts share for every category and both locales', async () => {
  const shell = await read('assets/report-shell.js');
  const middleware = await read('functions/_middleware.js');

  // Share sits between the report body and the comments.
  assert.match(shell, /mountReportNav\(\);\s*mountShare\(\);\s*mountComments\(\);/);
  // Nothing in mountShare is conditional on the category.
  const body = shell.slice(shell.indexOf('function mountShare()'), shell.indexOf('function mount()'));
  assert.doesNotMatch(body, /active ===/);

  // Every category still resolves through the same injected shell.
  for (const category of ['basics', 'daily', 'weekly', 'research', 'note']) {
    assert.match(middleware, new RegExp(`active = '${category}'`));
  }
  assert.match(middleware, /report-shell\.js\?v=20260827-2/);
});

/* --------------------------------------------------------------- P. copy */

test('P. Korean and English share copy are both complete', async () => {
  const shell = await read('assets/report-shell.js');
  const keys = ['shareHeading', 'sharePrompt', 'shareAction', 'shareCopy', 'shareCopied', 'shareCopyManual', 'shareFailed', 'shareAppsHint'];
  for (const key of keys) {
    assert.equal((shell.match(new RegExp(`${key}:`, 'g')) || []).length, 2, `${key} must exist in both locales`);
  }
  assert.match(shell, /shareHeading: '공유', sharePrompt: '이 리포트를 공유하기'/);
  assert.match(shell, /shareHeading: 'Share', sharePrompt: 'Share this report'/);
  assert.match(shell, /shareCopied: '링크를 복사했습니다'/);
  assert.match(shell, /shareCopied: 'Link copied'/);
});

/* ---------------------------------------------- progressive enhancement */

test('the share panel is isolated and cannot reflow the report or the comments', async () => {
  const shell = await read('assets/report-shell.js');
  const body = shell.slice(shell.indexOf('function mountShare()'), shell.indexOf('function mount()'));

  assert.match(body, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(body, /host\.id = 'mrs-share-host'/);
  // Mounted as its own block element, so nothing upstream is re-laid out.
  assert.match(body, /document\.body\.appendChild\(host\)/);
  assert.doesNotMatch(body, /document\.body\.style|documentElement\.style/);
  // Accessibility basics.
  assert.match(body, /role="status" aria-live="polite"/);
  assert.match(body, /aria-hidden="true"/);
});

test('the shell exports only pure builders for tests', async () => {
  const { api } = await shellApi();
  assert.deepEqual(Object.keys(api).sort(),
    ['canonicalShareUrl', 'prefersNativeShare', 'shareLinks', 'shareText', 'shareTitle']);
  for (const value of Object.values(api)) assert.equal(typeof value, 'function');
});
