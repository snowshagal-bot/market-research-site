export async function onRequest(context) {
  const url = new URL(context.request.url);
  const response = await context.next();

  if (!url.pathname.startsWith('/reports/')) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let decodedPath = url.pathname;
  try { decodedPath = decodeURIComponent(url.pathname); } catch (_) {}

  let active = '';
  if (/주식리포트|데일리|daily/i.test(decodedPath)) active = 'daily';
  else if (/위클리|weekly/i.test(decodedPath)) active = 'weekly';
  else if (/비정기|소버린|research/i.test(decodedPath)) active = 'research';
  else if (/끄적|note/i.test(decodedPath)) active = 'note';

  const itemStyle = 'display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:34px!important;padding:0 11px!important;border-radius:999px!important;text-decoration:none!important;white-space:nowrap!important;font-size:12px!important;font-weight:750!important;letter-spacing:-.015em!important;color:#525750!important;border:1px solid transparent!important;';
  const activeStyle = 'background:#222622!important;color:#fff!important;border-color:#222622!important;';

  const nav = `
    <nav id="mrs-report-nav" aria-label="리포트 사이트 메뉴" style="position:sticky!important;top:0!important;z-index:2147483647!important;width:100%!important;box-sizing:border-box!important;display:block!important;background:rgba(247,243,235,.96)!important;border-bottom:1px solid #d8d0c2!important;backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;font-family:Inter,Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,-apple-system,sans-serif!important;line-height:1!important;padding-top:env(safe-area-inset-top,0px)!important;">
      <div style="min-height:48px!important;display:flex!important;align-items:center!important;gap:4px!important;overflow-x:auto!important;overscroll-behavior-x:contain!important;scrollbar-width:none!important;padding:6px max(10px,env(safe-area-inset-right)) 6px max(10px,env(safe-area-inset-left))!important;box-sizing:border-box!important;">
        <a href="/" style="${itemStyle}font-weight:900!important;color:#1f2420!important;">← 홈</a>
        <span aria-hidden="true" style="width:1px!important;height:20px!important;background:#d8d0c2!important;flex:0 0 auto!important;margin:0 2px!important;"></span>
        <a href="/?category=daily" style="${itemStyle}${active === 'daily' ? activeStyle : ''}">주식</a>
        <a href="/?category=weekly" style="${itemStyle}${active === 'weekly' ? activeStyle : ''}">위클리</a>
        <a href="/?category=research" style="${itemStyle}${active === 'research' ? activeStyle : ''}">비정기</a>
        <a href="/?category=note" style="${itemStyle}${active === 'note' ? activeStyle : ''}">끄적끄적</a>
      </div>
    </nav>`;

  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.prepend(nav, { html: true });
      }
    })
    .transform(response);
}
