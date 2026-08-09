export async function onRequest(context) {
  const url = new URL(context.request.url);
  const response = await context.next();

  if (!url.pathname.startsWith('/reports/')) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const homeControl = `
    <div id="mrs-report-home" style="position:fixed!important;top:max(12px,env(safe-area-inset-top))!important;left:max(12px,env(safe-area-inset-left))!important;z-index:2147483647!important;display:block!important;font-family:Inter,Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,-apple-system,sans-serif!important;line-height:1!important;">
      <a href="/" aria-label="홈페이지로 돌아가기" style="display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:40px!important;padding:0 13px!important;border-radius:999px!important;background:rgba(20,24,21,.82)!important;color:#fff!important;border:1px solid rgba(255,255,255,.16)!important;box-shadow:0 4px 16px rgba(0,0,0,.18)!important;backdrop-filter:blur(10px)!important;-webkit-backdrop-filter:blur(10px)!important;text-decoration:none!important;font-size:12px!important;font-weight:800!important;letter-spacing:-.01em!important;">← 홈</a>
    </div>`;

  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.prepend(homeControl, { html: true });
      }
    })
    .transform(response);
}
