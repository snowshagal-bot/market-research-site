import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
  INDEXNOW_KEY, INDEXNOW_HOST, INDEXNOW_KEY_LOCATION, INDEXNOW_ENDPOINTS,
  changedUrls, indexNowPayload, ownUrl, sitemapUrls, settle, submit, accepted, main
} from '../scripts/indexnow.mjs';
import { isRepoInternalPath } from '../functions/_middleware.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const ORIGIN = 'https://snowshagal.com';

const koDaily = { id: 'ko-1111', type: 'daily', lang: 'ko', reportDate: '2026-11-11', title: '금리 경고를 넘은 반도체', href: 'reports/2026-11-11_Snowshagal_Daily.html', readingMinutes: 6 };
const enDaily = { id: 'en-1111', type: 'daily', lang: 'en', reportDate: '2026-11-11', title: 'Chips Defy Rate Fears', href: 'reports/en/2026-11-11_Snowshagal_Daily_EN.html', translationGroup: 'ko-1111' };
const basics = { id: 'b13', type: 'basics', lang: 'ko', reportDate: '2026-06-04', title: '증시 대기자금은 어디로 갔나', href: 'reports/시장을읽는말들_13편_증시대기자금은어디로갔나.html' };

test('the key file sits at the root and holds exactly the key, as the protocol checks it', async () => {
  assert.match(INDEXNOW_KEY, /^[A-Za-z0-9-]{8,128}$/);
  assert.equal(await read(`${INDEXNOW_KEY}.txt`), INDEXNOW_KEY);
  assert.equal(INDEXNOW_KEY_LOCATION, `${ORIGIN}/${INDEXNOW_KEY}.txt`);
  assert.equal(isRepoInternalPath(`/${INDEXNOW_KEY}.txt`), false, 'the middleware serves it');
  // One key file: a second would leave the engines guessing which is current.
  const roots = (await readdir(new URL('../', import.meta.url))).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));
  assert.deepEqual(roots, [`${INDEXNOW_KEY}.txt`]);
});

test('a new Daily sends its report and its session page; the address is the canonical one', () => {
  const urls = changedUrls([], [koDaily, enDaily]);
  assert.deepEqual(urls.map(({ url, expect, reason }) => [url, expect, reason]), [
    [`${ORIGIN}/reports/2026-11-11_Snowshagal_Daily`, 'live', 'added'],
    [`${ORIGIN}/market/2026-11-11/`, 'live', 'session'],
    [`${ORIGIN}/reports/en/2026-11-11_Snowshagal_Daily_EN`, 'live', 'added'],
    [`${ORIGIN}/en/market/2026-11-11/`, 'live', 'session']
  ]);
  // A Korean file name is percent-encoded, without .html, as the sitemap lists it.
  const [korean] = changedUrls([], [basics]);
  assert.equal(korean.url, `${ORIGIN}/reports/${encodeURIComponent('시장을읽는말들_13편_증시대기자금은어디로갔나')}`);
  assert.equal(changedUrls([], [basics]).length, 1, 'only a Daily brings a session page');
});

test('a visible change sends the report again; a change nobody sees sends nothing', () => {
  assert.deepEqual(changedUrls([koDaily], [{ ...koDaily, readingMinutes: 7, coverThumbnail: 'covers/x-450.webp' }]), []);
  for (const change of [{ title: '다른 제목' }, { seoTitle: '검색 제목' }, { tags: ['kospi'] }, { reportDate: '2026-11-12' }, { translationGroup: 'x' }, { summary: '요약' }]) {
    assert.deepEqual(changedUrls([koDaily], [{ ...koDaily, ...change }]).map(({ reason }) => reason), ['updated'], JSON.stringify(change));
  }
  // A post moved to a new file: the new address is live, the old one gone.
  const moved = changedUrls([basics], [{ ...basics, href: 'reports/basics-13-deposits.html' }]);
  assert.deepEqual(moved.map(({ url, expect, reason }) => [url.replace(ORIGIN, ''), expect, reason]), [
    ['/reports/basics-13-deposits', 'live', 'updated'],
    [`/reports/${encodeURIComponent('시장을읽는말들_13편_증시대기자금은어디로갔나')}`, 'gone', 'moved']
  ]);
  // A deleted post: its address is announced as gone.
  assert.deepEqual(changedUrls([koDaily, enDaily], [enDaily]).map(({ expect, reason }) => [expect, reason]), [['gone', 'removed']]);
  // Only reports: anything without a reports/ href is not an address of ours to send.
  assert.deepEqual(changedUrls([], [{ id: 'x', type: 'daily', href: 'https://example.com/a.html' }, { id: 'y' }]), []);
});

test('the request body is the one the protocol defines, and only our own https addresses go in it', () => {
  assert.deepEqual(indexNowPayload([`${ORIGIN}/a`]), { host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: INDEXNOW_KEY_LOCATION, urlList: [`${ORIGIN}/a`] });
  assert.equal(ownUrl(`${ORIGIN}/reports/a`), `${ORIGIN}/reports/a`);
  for (const other of ['http://snowshagal.com/a', 'https://www.snowshagal.com/a', 'https://example.com/a', 'https://snowshagal.com.evil.test/a', 'javascript:alert(1)', '']) {
    assert.equal(ownUrl(other), '', other);
  }
  assert.deepEqual(sitemapUrls(`<urlset><url><loc>${ORIGIN}/</loc></url><url><loc> ${ORIGIN}/reports/a?x=1&amp;y=2 </loc></url><url><loc>https://example.com/b</loc></url></urlset>`),
    [`${ORIGIN}/`, `${ORIGIN}/reports/a?x=1&y=2`]);
  assert.deepEqual(INDEXNOW_ENDPOINTS.map(({ name, url }) => [name, url]), [
    ['naver', 'https://searchadvisor.naver.com/indexnow'],
    ['bing', 'https://www.bing.com/indexnow']
  ]);
});

// A fake clock and fetch: each address answers from its own list of statuses.
function fakeNetwork(statuses) {
  const calls = [];
  let clock = 0;
  return {
    calls,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body });
      const queue = statuses[url];
      const status = Array.isArray(queue) ? (queue.length > 1 ? queue.shift() : queue[0]) : (queue ?? 404);
      if (status === 'throw') throw new Error('offline');
      return { status, text: async () => '' };
    }
  };
}

test('an address is sent only once Production answers for it as expected', async () => {
  const a = `${ORIGIN}/reports/a`;
  const gone = `${ORIGIN}/reports/old`;
  const session = `${ORIGIN}/market/2026-11-11/`;
  const never = `${ORIGIN}/reports/never`;
  const net = fakeNetwork({ [a]: [404, 404, 200], [gone]: [200, 404], [session]: [404], [never]: [404] });
  const { ready, skipped } = await settle([
    { url: a, expect: 'live', reason: 'added' },
    { url: gone, expect: 'gone', reason: 'removed' },
    { url: session, expect: 'live', reason: 'session' },
    { url: never, expect: 'live', reason: 'added' }
  ], { fetchImpl: net.fetchImpl, now: net.now, wait: net.wait, timeoutMs: 60000, intervalMs: 15000 });
  assert.deepEqual(ready.map(({ url }) => url).sort(), [a, gone].sort());
  // A session page that does not exist is dropped, not waited for.
  assert.deepEqual(skipped.map(({ url }) => url), [never]);
  assert.ok(net.calls.every(({ method }) => method === 'GET'));
});

test('both engines get the same body; 200 and 202 are accepted, anything else is not', async () => {
  const net = fakeNetwork({ 'https://searchadvisor.naver.com/indexnow': [202], 'https://www.bing.com/indexnow': [200] });
  const results = await submit([`${ORIGIN}/reports/a`], { fetchImpl: net.fetchImpl });
  assert.deepEqual(results, [{ name: 'naver', status: 202 }, { name: 'bing', status: 200 }]);
  assert.deepEqual(net.calls.map(({ method }) => method), ['POST', 'POST']);
  assert.deepEqual(JSON.parse(net.calls[0].body), indexNowPayload([`${ORIGIN}/reports/a`]));
  assert.equal(net.calls[0].body, net.calls[1].body);
  assert.deepEqual([200, 202, 400, 403, 422, 429, 0].map(accepted), [true, true, false, false, false, false, false]);
});

test('the command sends requested addresses, refuses foreign ones, and fails when an engine refuses', async () => {
  const url = `${ORIGIN}/reports/a`;
  // A fake clock, so an address that never answers is given up on at once.
  let clock = 0;
  const settleOptions = { now: () => clock, wait: async (ms) => { clock += ms; } };
  const lines = [];
  const ok = fakeNetwork({ [url]: [200], 'https://searchadvisor.naver.com/indexnow': [200], 'https://www.bing.com/indexnow': [202] });
  assert.equal(await main(['--urls', `${url} ${url}`], { fetchImpl: ok.fetchImpl, log: (line) => lines.push(line), settleOptions }), 0);
  assert.equal(ok.calls.filter(({ method }) => method === 'POST').length, 2);
  assert.deepEqual(JSON.parse(ok.calls.find(({ method }) => method === 'POST').body).urlList, [url], 'sent once');
  assert.ok(lines.includes('IndexNow naver: 200') && lines.includes('IndexNow bing: 202'));

  const dry = fakeNetwork({ [url]: [200] });
  assert.equal(await main(['--urls', url, '--dry-run'], { fetchImpl: dry.fetchImpl, log: () => {}, settleOptions }), 0);
  assert.equal(dry.calls.filter(({ method }) => method === 'POST').length, 0, 'a dry run sends nothing');

  const refused = fakeNetwork({ [url]: [200], 'https://searchadvisor.naver.com/indexnow': [403], 'https://www.bing.com/indexnow': [200] });
  assert.equal(await main(['--urls', url], { fetchImpl: refused.fetchImpl, log: () => {}, settleOptions }), 1);

  await assert.rejects(main(['--urls', 'https://example.com/a'], { fetchImpl: ok.fetchImpl, log: () => {}, settleOptions }), /not a https:\/\/snowshagal\.com address/);

  const map = fakeNetwork({ [`${ORIGIN}/sitemap.xml`]: [200], 'https://searchadvisor.naver.com/indexnow': [200], 'https://www.bing.com/indexnow': [200] });
  const fetchSitemap = async (target, options) => (target === `${ORIGIN}/sitemap.xml`
    ? { status: 200, text: async () => `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${url}</loc></url></urlset>` }
    : map.fetchImpl(target, options));
  assert.equal(await main(['--sitemap'], { fetchImpl: fetchSitemap, log: () => {}, settleOptions }), 0);
  assert.deepEqual(JSON.parse(map.calls.find(({ method }) => method === 'POST').body).urlList, [`${ORIGIN}/`, url]);
});

test('the workflow runs on pushes that touch the posts, reads nothing secret, and keeps inputs out of the shell', async () => {
  const workflow = await read('.github/workflows/indexnow.yml');
  assert.match(workflow, /on:\n  push:\n    branches:\n      - main\n    paths:\n      - data\/posts\.json\n  workflow_dispatch:/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.match(workflow, /node scripts\/indexnow\.mjs --before "\$BEFORE" --after "\$AFTER"/);
  // Workflow inputs reach the script through env, never pasted into the script text.
  const runBlocks = [...workflow.matchAll(/run: \|\n([\s\S]*?)(?=\n\n|\n {6}- name:|$)/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(runBlocks, /\$\{\{/);
});
