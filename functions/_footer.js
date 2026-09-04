export function siteFooter(lang = 'ko') {
  const isEn = lang === 'en';
  const prefix = isEn ? '/en' : '';
  const homePath = isEn ? '/en/' : '/';

  const tagline = isEn ? 'A clearer read on the market.' : '시장을 읽어주는 사이트.';
  const reportsHeading = isEn ? 'Reports' : '리포트';
  const marketHeading = isEn ? 'Market' : '마켓';
  const siteHeading = isEn ? 'Site' : '사이트';

  const reportsNavAria = isEn ? 'Footer Reports menu' : '푸터 리포트 메뉴';
  const marketNavAria = isEn ? 'Footer Market menu' : '푸터 마켓 메뉴';
  const siteNavAria = isEn ? 'Footer Site menu' : '푸터 사이트 메뉴';

  const labels = isEn
    ? {
        daily: 'Daily',
        weekly: 'Weekly',
        research: 'Research',
        note: 'Investment Note',
        basics: 'Market Basics',
        market: 'Market',
        disclosures: 'Disclosure',
        calendar: 'Calendar',
        about: 'About',
        contact: 'Contact',
        langSwitch: '한국어',
        langSwitchHref: '/'
      }
    : {
        daily: '데일리',
        weekly: '위클리',
        research: '리서치',
        note: '투자 노트',
        basics: '시장 입문',
        market: '마켓',
        disclosures: '공시',
        calendar: '캘린더',
        about: '소개',
        contact: '문의',
        langSwitch: 'English',
        langSwitchHref: '/en/'
      };

  const disclaimer = isEn
    ? 'Snowshagal provides research and commentary for informational purposes only and does not offer personalized investment advice or recommendations to buy or sell financial products.'
    : '본 사이트의 리서치와 해설은 정보 제공을 목적으로 하며, 특정 금융투자상품에 대한 투자자문 또는 매수·매도 권유를 제공하지 않습니다.';

  return `<footer id="site-footer" class="footer site-footer">
  <div class="site-wrap">
    <div class="footer-primary site-footer-primary">
      <div class="footer-brand-col site-footer-brand-col">
        <a class="footer-brand site-footer-brand" href="${homePath}" aria-label="Snowshagal Market Research">
          <img class="footer-brand-owl site-footer-brand-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" loading="lazy" aria-hidden="true">
          <span>SNOWSHAGAL</span>
        </a>
        <p class="footer-tagline site-footer-tagline">${tagline}</p>
      </div>
      <div class="site-footer-nav-groups">
        <div class="site-footer-group">
          <p class="site-footer-heading" aria-hidden="true">${reportsHeading}</p>
          <nav class="site-footer-nav" aria-label="${reportsNavAria}">
            <a href="${prefix}/daily/">${labels.daily}</a>
            <a href="${prefix}/weekly/">${labels.weekly}</a>
            <a href="${prefix}/research/">${labels.research}</a>
            <a href="${prefix}/notes/">${labels.note}</a>
            <a href="${prefix}/basics/">${labels.basics}</a>
          </nav>
        </div>
        <div class="site-footer-group">
          <p class="site-footer-heading" aria-hidden="true">${marketHeading}</p>
          <nav class="site-footer-nav" aria-label="${marketNavAria}">
            <a href="${prefix}/market/">${labels.market}</a>
            <a href="${prefix}/disclosures/">${labels.disclosures}</a>
            <a href="${prefix}/calendar/">${labels.calendar}</a>
          </nav>
        </div>
        <div class="site-footer-group">
          <p class="site-footer-heading" aria-hidden="true">${siteHeading}</p>
          <nav class="site-footer-nav" aria-label="${siteNavAria}">
            <a href="${prefix}/about/">${labels.about}</a>
            <a href="mailto:contact@snowshagal.com">${labels.contact}</a>
            <a href="${labels.langSwitchHref}">${labels.langSwitch}</a>
          </nav>
        </div>
      </div>
    </div>
    <div class="footer-meta site-footer-meta">
      <p class="footer-disclaimer site-footer-disclaimer">${disclaimer}</p>
      <p class="footer-copy site-footer-copy">© 2026 SNOWSHAGAL</p>
    </div>
  </div>
</footer>`;
}

export function footerCss() {
  return `#site-footer{--sf-bg:#f7f3eb;--sf-line:#d8d0c2;--sf-text:#1f2420;--sf-text-2:#535850;--sf-muted:#666c67;--sf-focus:#344b40;background:var(--sf-bg);color:var(--sf-text);border-top:1px solid var(--sf-line);padding:44px 0 calc(32px + env(safe-area-inset-bottom,0px));font-family:Inter,Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;line-height:1.55;box-sizing:border-box;display:block;position:relative;clear:both;width:100%}#site-footer *{box-sizing:border-box}@media(prefers-color-scheme:dark){#site-footer{--sf-bg:#1c1f1c;--sf-line:#3b423c;--sf-text:#edf0ec;--sf-text-2:#b9c0ba;--sf-muted:#8f968f;--sf-focus:#a8c1b1}}html[data-theme="dark"] #site-footer,[data-theme="dark"] #site-footer,#site-footer[data-theme="dark"]{--sf-bg:#1c1f1c;--sf-line:#3b423c;--sf-text:#edf0ec;--sf-text-2:#b9c0ba;--sf-muted:#8f968f;--sf-focus:#a8c1b1}html[data-theme="light"] #site-footer,[data-theme="light"] #site-footer,#site-footer[data-theme="light"]{--sf-bg:#f7f3eb;--sf-line:#d8d0c2;--sf-text:#1f2420;--sf-text-2:#535850;--sf-muted:#666c67;--sf-focus:#344b40}#site-footer .site-wrap{width:min(calc(100% - 44px),1180px);margin:0 auto}#site-footer .site-footer-primary{display:flex;justify-content:space-between;align-items:flex-start;gap:48px;padding-bottom:28px;border-bottom:1px solid var(--sf-line)}#site-footer .site-footer-brand-col{max-width:380px}#site-footer .site-footer-brand{display:inline-flex;align-items:center;gap:9px;font-family:Georgia,"Times New Roman",serif;font-size:15px;font-weight:850;letter-spacing:.14em;color:var(--sf-text);line-height:1;text-decoration:none}#site-footer .site-footer-brand-owl{display:block;width:22px;height:auto;flex:0 0 auto}html[data-theme="dark"] #site-footer .site-footer-brand-owl,#site-footer[data-theme="dark"] .site-footer-brand-owl{filter:drop-shadow(0 1px 4px rgba(151,183,225,.18))}#site-footer .site-footer-tagline{margin:10px 0 0;font-size:13px;line-height:1.5;color:var(--sf-text-2);letter-spacing:-.01em;word-break:keep-all}#site-footer .site-footer-nav-groups{display:flex;gap:44px 56px;flex-wrap:wrap}#site-footer .site-footer-group{min-width:110px}#site-footer .site-footer-heading{margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--sf-muted)}#site-footer .site-footer-nav{display:flex;flex-direction:column;gap:9px}#site-footer .site-footer-nav a{font-size:13px;font-weight:700;color:var(--sf-text-2);text-decoration:none;line-height:1.4;white-space:nowrap;transition:color .15s ease}#site-footer .site-footer-nav a:hover{color:var(--sf-text)}#site-footer .site-footer-nav a:focus-visible,#site-footer .site-footer-brand:focus-visible{outline:2px solid var(--sf-focus);outline-offset:2px}#site-footer .site-footer-meta{display:flex;justify-content:space-between;align-items:baseline;gap:28px;padding-top:20px}#site-footer .site-footer-disclaimer{margin:0;font-size:11px;line-height:1.65;color:var(--sf-muted);max-width:68ch;word-break:keep-all}#site-footer .site-footer-copy{margin:0;font-size:11px;color:var(--sf-muted);white-space:nowrap;letter-spacing:.04em;flex-shrink:0}@media(max-width:768px){#site-footer{padding:32px 0 calc(24px + env(safe-area-inset-bottom,0px))}#site-footer .site-wrap{width:min(calc(100% - 32px),1180px)}#site-footer .site-footer-primary{flex-direction:column;align-items:flex-start;gap:28px;padding-bottom:22px}#site-footer .site-footer-brand-col{max-width:100%}#site-footer .site-footer-nav-groups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 20px;width:100%}#site-footer .site-footer-meta{flex-direction:column;align-items:flex-start;gap:12px;padding-top:16px}#site-footer .site-footer-copy{order:2}#site-footer .site-footer-disclaimer{order:1}}`;
}
