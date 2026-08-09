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

  const script = `
<script>
(() => {
  const active = ${JSON.stringify(active)};
  const BAR_H = 52;

  function mountReportNav() {
    if (document.getElementById('mrs-nav-host')) return;

    const spacer = document.createElement('div');
    spacer.id = 'mrs-nav-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.setProperty('display', 'block', 'important');
    spacer.style.setProperty('width', '100%', 'important');
    spacer.style.setProperty('height', BAR_H + 'px', 'important');
    spacer.style.setProperty('min-height', BAR_H + 'px', 'important');
    spacer.style.setProperty('max-height', BAR_H + 'px', 'important');
    spacer.style.setProperty('margin', '0', 'important');
    spacer.style.setProperty('padding', '0', 'important');
    spacer.style.setProperty('border', '0', 'important');
    spacer.style.setProperty('flex', '0 0 ' + BAR_H + 'px', 'important');
    if (document.body.firstChild) document.body.insertBefore(spacer, document.body.firstChild);
    else document.body.appendChild(spacer);

    const host = document.createElement('div');
    host.id = 'mrs-nav-host';
    host.style.setProperty('all', 'initial', 'important');
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('top', '0', 'important');
    host.style.setProperty('left', '0', 'important');
    host.style.setProperty('right', '0', 'important');
    host.style.setProperty('width', '100vw', 'important');
    host.style.setProperty('height', BAR_H + 'px', 'important');
    host.style.setProperty('z-index', '2147483647', 'important');
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('pointer-events', 'auto', 'important');
    host.style.setProperty('transform', 'none', 'important');
    host.style.setProperty('zoom', '1', 'important');

    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = \`
      :host { all: initial; }
      * { box-sizing: border-box; }
      .bar {
        width: 100%;
        height: 52px;
        background: rgba(247,243,235,.97);
        border-bottom: 1px solid #d8d0c2;
        box-shadow: 0 1px 8px rgba(20,24,21,.05);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        font-family: Inter, Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', system-ui, -apple-system, sans-serif;
      }
      .inner {
        width: min(1180px, 100%);
        height: 100%;
        margin: 0 auto;
        padding: 0 22px;
        display: flex;
        align-items: center;
        gap: 6px;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
      }
      .inner::-webkit-scrollbar { display: none; }
      a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 34px;
        padding: 0 12px;
        border-radius: 999px;
        color: #535850;
        text-decoration: none;
        white-space: nowrap;
        font-size: 13px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: -.015em;
        border: 1px solid transparent;
        transition: background .15s ease, color .15s ease, border-color .15s ease;
        cursor: pointer;
      }
      a:hover { background: #ebe5da; color: #1f2420; }
      .home { color: #1f2420; font-weight: 850; }
      .active { background: #222622; color: #fff; border-color: #222622; }
      .active:hover { background: #222622; color: #fff; }
      .divider { width: 1px; height: 20px; background: #d8d0c2; flex: 0 0 auto; margin: 0 3px; }
      .brand { margin-left: auto; font-size: 11px; font-weight: 800; letter-spacing: .12em; color: #8a877f; white-space: nowrap; }
      @media (max-width: 680px) {
        .inner { width: 100%; margin: 0; padding: 0 8px; gap: 2px; }
        a { min-height: 32px; padding: 0 10px; font-size: 12px; }
        .divider { margin: 0 1px; }
        .brand { display: none; }
      }
    \`;

    const bar = document.createElement('nav');
    bar.className = 'bar';
    bar.setAttribute('aria-label', '리포트 사이트 메뉴');
    bar.innerHTML = \`
      <div class="inner">
        <a class="home" href="/">← 홈</a>
        <span class="divider" aria-hidden="true"></span>
        <a class="${active === 'daily' ? 'active' : ''}" href="/?category=daily">주식</a>
        <a class="${active === 'weekly' ? 'active' : ''}" href="/?category=weekly">위클리</a>
        <a class="${active === 'research' ? 'active' : ''}" href="/?category=research">비정기</a>
        <a class="${active === 'note' ? 'active' : ''}" href="/?category=note">끄적끄적</a>
        <span class="brand">MARKET RESEARCH</span>
      </div>\`;

    root.append(style, bar);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountReportNav, { once: true });
  else mountReportNav();
})();
</script>`;

  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.append(script, { html: true });
      }
    })
    .transform(response);
}
