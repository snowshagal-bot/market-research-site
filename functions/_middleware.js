export async function onRequest(context) {
  const url = new URL(context.request.url);
  const response = await context.next();

  if (!url.pathname.startsWith('/reports/')) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let decodedPath = url.pathname;
  try { decodedPath = decodeURIComponent(url.pathname); } catch (_) {}

  let active = '';
  const lang = /^\/reports\/en\//i.test(url.pathname) ? 'en' : 'ko';
  if (/시장\s*공부|경제\s*공부|주식\s*공부|market[\s_-]*basics|investing[\s_-]*basics|explainer/i.test(decodedPath)) active = 'basics';
  else if (/주식리포트|데일리|daily/i.test(decodedPath)) active = 'daily';
  else if (/위클리|weekly/i.test(decodedPath)) active = 'weekly';
  else if (/비정기|소버린|research/i.test(decodedPath)) active = 'research';
  else if (/끄적|note/i.test(decodedPath)) active = 'note';

  const shell = `<script src="/assets/locale.js?v=20260812-1"></script><script src="/assets/report-shell.js?v=20260812-1" data-category="${active}" data-lang="${lang}"></script>`;

  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.append(shell, { html: true });
      }
    })
    .transform(response);
}
