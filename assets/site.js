(function(){
  const posts = window.RESEARCH_POSTS || [];
  const html = document.documentElement;
  const themeBtn = document.querySelector('[data-theme-toggle]');
  const menuBtn = document.querySelector('[data-menu-toggle]');
  const mobileNav = document.querySelector('.mobile-nav');
  const list = document.getElementById('report-list');
  const search = document.getElementById('search-input');
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const params = new URLSearchParams(location.search);
  let active = params.get('category') || 'all';
  function systemTheme(){ return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function applyTheme(value){
    const actual = value === 'system' ? systemTheme() : value;
    html.dataset.theme = actual;
    html.dataset.themePreference = value;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if(themeMeta) themeMeta.setAttribute('content', actual === 'dark' ? '#161816' : '#f5f0e6');
    if(themeBtn){
      themeBtn.setAttribute('aria-label', actual === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
      themeBtn.textContent = actual === 'dark' ? '☀' : '◐';
    }
  }
  const savedTheme = localStorage.getItem('site-theme') || 'system';
  applyTheme(savedTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{
    if((localStorage.getItem('site-theme')||'system') === 'system') applyTheme('system');
  });
  themeBtn?.addEventListener('click',()=>{
    const now = html.dataset.theme;
    const next = now === 'dark' ? 'light' : 'dark';
    localStorage.setItem('site-theme',next);
    applyTheme(next);
  });
  menuBtn?.addEventListener('click',()=>{
    const open = mobileNav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded',String(open));
  });
  function esc(s){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m])); }
  function render(){
    const q = (search?.value || '').trim().toLowerCase();
    const filtered = posts.filter(p => (active === 'all' || p.type === active) && (!q || `${p.title} ${p.subtitle||''} ${p.typeLabel} ${p.description||''}`.toLowerCase().includes(q)));
    filters.forEach(b=>b.classList.toggle('active',b.dataset.filter===active));
    if(!filtered.length){ list.innerHTML='<div class="empty">조건에 맞는 글이 없습니다.</div>'; return; }
    list.innerHTML = filtered.map(p=>`<a class="report-item" href="${esc(p.href)}"><div><span class="report-type ${esc(p.type)}">${esc(p.typeLabel)}</span><span class="report-date">${esc(p.date)}</span></div><div><div class="report-title">${esc(p.title)}</div><div class="report-subtitle">${esc(p.subtitle||'')}</div></div><span class="report-arrow" aria-hidden="true">→</span></a>`).join('');
  }
  filters.forEach(b=>b.addEventListener('click',()=>{ active=b.dataset.filter; render(); }));
  search?.addEventListener('input',render);
  const featured = posts.find(p=>p.featured) || posts[0];
  if(featured){
    document.querySelector('[data-feature-title]').textContent=featured.title;
    document.querySelector('[data-feature-subtitle]').textContent=featured.subtitle||'';
    document.querySelector('[data-feature-desc]').textContent=featured.description||'';
    document.querySelector('[data-feature-link]').href=featured.href;
    document.querySelector('[data-feature-type]').textContent=featured.typeLabel;
    document.querySelector('[data-feature-date]').textContent=featured.date;
  }
  render();
})();