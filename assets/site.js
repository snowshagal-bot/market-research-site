(function(){
  const posts = (window.RESEARCH_POSTS || []).slice().sort((a,b)=>{
    const da=String(a.reportDate||a.date||'');
    const db=String(b.reportDate||b.date||'');
    if(da!==db) return db.localeCompare(da);
    return String(b.registeredAt||'').localeCompare(String(a.registeredAt||''));
  });
  const html = document.documentElement;
  const body = document.body;
  const hero = document.querySelector('.hero');
  const themeBtn = document.querySelector('[data-theme-toggle]');
  const menuBtn = document.querySelector('[data-menu-toggle]');
  const mobileNav = document.querySelector('.mobile-nav');
  const list = document.getElementById('report-list');
  const search = document.getElementById('search-input');
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const navLinks = Array.from(document.querySelectorAll('[data-nav-category]'));
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
  function reportDate(p){ return p.reportDate || p.date || ''; }

  function categoryFeatured(){
    if(active === 'all') return posts.find(p=>p.featured) || posts[0];
    return posts.find(p=>p.type === active) || null;
  }

  function updateFeature(){
    const featured = categoryFeatured();
    const title = document.querySelector('[data-feature-title]');
    const subtitle = document.querySelector('[data-feature-subtitle]');
    const desc = document.querySelector('[data-feature-desc]');
    const link = document.querySelector('[data-feature-link]');
    const type = document.querySelector('[data-feature-type]');
    const date = document.querySelector('[data-feature-date]');

    body.dataset.category = active;
    navLinks.forEach(a=>a.classList.toggle('active',a.dataset.navCategory === active));

    if(!featured){
      if(hero) hero.dataset.empty='true';
      if(type) type.textContent = active === 'note' ? '끄적끄적' : '리포트';
      if(title) title.textContent = '아직 게시된 글이 없습니다';
      if(subtitle) subtitle.textContent = '';
      if(desc) desc.textContent = '새 글이 올라오면 이 영역에 가장 최근 글이 표시됩니다.';
      if(date) date.textContent = '—';
      if(link) link.removeAttribute('href');
      return;
    }

    if(hero) hero.dataset.empty='false';
    if(title) title.textContent=featured.title;
    if(subtitle) subtitle.textContent=featured.subtitle||'';
    if(desc) desc.textContent=featured.description||'';
    if(link) link.href=featured.href;
    if(type) type.textContent=featured.typeLabel;
    if(date) date.textContent=reportDate(featured);
  }

  function render(){
    const q = (search?.value || '').trim().toLowerCase();
    const filtered = posts.filter(p => (active === 'all' || p.type === active) && (!q || `${p.title} ${p.subtitle||''} ${p.typeLabel} ${p.description||''}`.toLowerCase().includes(q)));
    filters.forEach(b=>b.classList.toggle('active',b.dataset.filter===active));
    updateFeature();

    if(!filtered.length){
      list.innerHTML='<div class="empty">조건에 맞는 글이 없습니다.</div>';
      return;
    }
    list.innerHTML = filtered.map(p=>`<a class="report-item" href="${esc(p.href)}"><div><span class="report-type ${esc(p.type)}">${esc(p.typeLabel)}</span><span class="report-date">${esc(reportDate(p))}</span></div><div><div class="report-title">${esc(p.title)}</div><div class="report-subtitle">${esc(p.subtitle||'')}</div></div><span class="report-arrow" aria-hidden="true">→</span></a>`).join('');
  }

  filters.forEach(b=>b.addEventListener('click',()=>{
    active=b.dataset.filter;
    const url = new URL(location.href);
    if(active === 'all') url.searchParams.delete('category'); else url.searchParams.set('category',active);
    history.replaceState(null,'',url);
    render();
  }));
  search?.addEventListener('input',render);
  render();
})();