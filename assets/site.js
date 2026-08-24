(function(){
  const localeApi = window.MARKET_LOCALE;
  const html = document.documentElement;
  const body = document.body;
  const locale = localeApi?.siteLanguage(document) || (html.lang === 'en' ? 'en' : 'ko');
  const messages = localeApi?.copy?.[locale] || localeApi?.copy?.ko;
  let savedLanguage = '';
  try { savedLanguage = localStorage.getItem('site-language') || ''; } catch (_) {}
  const preferredHomepage = localeApi?.preferredHomepageRedirect(locale, location.pathname, location.search, savedLanguage) || '';
  if(preferredHomepage){
    location.replace(preferredHomepage);
    return;
  }
  const categories = messages.categories;
  const coreTypes = ['daily', 'weekly', 'research', 'basics'];
  const validTypes = ['all', ...coreTypes, 'note'];
  const allPosts = (window.RESEARCH_POSTS || []).slice();
  const localizedPosts = localeApi?.localePosts(allPosts, locale) || allPosts.filter(post => (post.lang === 'en' ? 'en' : 'ko') === locale);
  const posts = localeApi?.sortPosts(localizedPosts) || localizedPosts.sort((a,b)=>{
    const da=String(a.reportDate||a.date||'');
    const db=String(b.reportDate||b.date||'');
    if(da!==db) return db.localeCompare(da);
    return String(b.registeredAt||'').localeCompare(String(a.registeredAt||''));
  });
  const themeBtn = document.querySelector('[data-theme-toggle]');
  const menuBtn = document.querySelector('[data-menu-toggle]');
  const mobileNav = document.querySelector('.mobile-nav');
  const languageLinks = Array.from(document.querySelectorAll('[data-language-choice]'));
  const list = document.getElementById('report-list');
  const search = document.getElementById('search-input');
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const navLinks = Array.from(document.querySelectorAll('[data-nav-category]'));
  const archiveIndex = document.getElementById('archive-index');
  const archiveOrderLabel = document.getElementById('archive-order-label');
  const params = new URLSearchParams(location.search);
  const requestedCategory = params.get('category') || 'all';
  let active = validTypes.includes(requestedCategory) ? requestedCategory : 'all';

  function systemTheme(){ return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function savedTheme(){
    try { return localStorage.getItem('site-theme') || 'system'; }
    catch (_) { return 'system'; }
  }
  function applyTheme(value){
    const actual = value === 'system' ? systemTheme() : value;
    html.dataset.theme = actual;
    html.dataset.themePreference = value;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const homeTheme = body.classList.contains('home-page');
    if(themeMeta) themeMeta.setAttribute('content', actual === 'dark' ? (homeTheme ? '#101722' : '#161816') : (homeTheme ? '#f7f4ec' : '#f5f0e6'));
    if(themeBtn){
      themeBtn.setAttribute('aria-label', actual === 'dark' ? messages.themeLight : messages.themeDark);
      themeBtn.textContent = actual === 'dark' ? '☀' : '◐';
    }
  }
  applyTheme(savedTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{
    if(savedTheme() === 'system') applyTheme('system');
  });
  themeBtn?.addEventListener('click',()=>{
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('site-theme',next); } catch (_) {}
    applyTheme(next);
  });
  if(menuBtn && mobileNav) menuBtn.addEventListener('click',()=>{
    const open = mobileNav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded',String(open));
    menuBtn.setAttribute('aria-label',open ? messages.menuClose : messages.menuOpen);
  });

  languageLinks.forEach(link=>{
    const target = link.dataset.languageChoice;
    if(!localeApi?.validLanguages.includes(target)) return;
    link.href = localeApi.pageLanguagePath(location.pathname, target, location.search);
    link.addEventListener('click',()=>{
      try { localStorage.setItem('site-language', target); } catch (_) {}
    });
  });

  const isHomepage = Boolean(list && search && document.getElementById('latest-category-cards'));
  if(!isHomepage) return;

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
  }
  function reportDate(post){ return post.reportDate || post.date || ''; }
  function rootPath(path){ return `/${String(path || '').replace(/^\/+/, '')}`; }
  function categoryInfo(type){ return categories[type] || { label: type || (locale === 'en' ? 'Report' : '리포트'), english: 'REPORT', description: '' }; }
  function latestFor(type){ return posts.find(post=>post.type===type) || null; }

  function renderHighlights(){
    const host=document.getElementById('latest-category-cards');
    const highlights=['daily','weekly','research'].map(type=>latestFor(type)).filter(Boolean);
    const section=host.closest('.site-introduction');
    if(section) section.hidden=!highlights.length;
    host.innerHTML=highlights.map(post=>{
      const info=categoryInfo(post.type);
      const summary=String(post.summary||post.description||post.subtitle||'').trim();
      const readLabel=locale==='en'?'Read report':'리포트 보기';
      const visual=post.coverImage
        ? `<span class="latest-card-cover"><img src="${esc(rootPath(post.coverImage))}" alt="" loading="lazy"></span>`
        : '<span class="latest-card-art" aria-hidden="true"></span>';
      const summaryCopy=summary?`<p class="latest-card-summary">${esc(summary)}</p>`:'';
      return `<a class="latest-card latest-card-${esc(post.type)}" href="${esc(rootPath(post.href))}"><span class="latest-card-meta"><b>${esc(info.english)}</b><time datetime="${esc(reportDate(post))}">${esc(reportDate(post))}</time></span><span class="latest-card-content"><strong>${esc(post.title)}</strong><span class="latest-card-body">${visual}${summaryCopy}</span></span><span class="latest-card-read">${esc(readLabel)} <i aria-hidden="true">→</i></span></a>`;
    }).join('');
  }

  function renderNavigation(){
    body.dataset.category=active;
    navLinks.forEach(link=>{
      const current=link.dataset.navCategory===active;
      link.classList.toggle('active',current);
      if(current) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }

  function renderArchiveIndex(){
    if(!archiveIndex) return;
    const counts=localeApi?.categoryCounts(allPosts, locale, [...coreTypes,'note']) || posts.reduce((result,post)=>{
      if(coreTypes.includes(post.type)||post.type==='note') result[post.type]=(result[post.type]||0)+1;
      return result;
    },{});
    archiveIndex.innerHTML=[...coreTypes,'note'].map(type=>{
      const info=categoryInfo(type);
      const current=type===active;
      return `<a class="archive-index-item" href="?category=${encodeURIComponent(type)}"${current?' aria-current="page"':''}><span class="archive-index-row"><strong>${esc(info.label)}</strong><b>${counts[type]||0}</b></span><span class="archive-index-description">${esc(info.description)}</span></a>`;
    }).join('');
  }

  function renderArchive(){
    const query=(search?.value||'').trim().toLowerCase();
    const matched=localeApi?.searchPosts(allPosts, locale, query, active) || localizedPosts.filter(post=>(active==='all'||post.type===active)&&(!query||`${post.title} ${post.subtitle||''} ${post.typeLabel||''} ${post.description||''}`.toLowerCase().includes(query)));
    const filtered=active==='all'
      ? (localeApi?.sortPostsByRegistration(matched) || matched.slice().sort((a,b)=>String(b.registeredAt||b.registeredDate||'').localeCompare(String(a.registeredAt||a.registeredDate||''))))
      : (localeApi?.sortPosts(matched) || matched.slice().sort((a,b)=>String(b.reportDate||b.date||'').localeCompare(String(a.reportDate||a.date||''))));
    if(archiveOrderLabel) archiveOrderLabel.textContent=active==='all'?messages.registrationOrder:messages.reportOrder;
    filters.forEach(button=>{
      const selected=button.dataset.filter===active;
      button.classList.toggle('active',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    renderNavigation();
    renderArchiveIndex();
    if(!filtered.length){
      const message=active==='basics'?messages.basicsEmpty:messages.empty;
      list.innerHTML=`<div class="empty">${esc(message)}</div>`;
      return;
    }
    list.innerHTML=filtered.map(post=>{
      const info=categoryInfo(post.type);
      const subtitle=post.subtitle?`<div class="report-subtitle">${esc(post.subtitle)}</div>`:'';
      return `<a class="report-item" href="${esc(rootPath(post.href))}"><div><span class="report-type ${esc(post.type)}">${esc(info.label)}</span><span class="report-date">${esc(reportDate(post))}</span></div><div><div class="report-title">${esc(post.title)}</div>${subtitle}</div><span class="report-arrow"><span class="report-read-label">${esc(messages.read)}</span><span aria-hidden="true">→</span></span></a>`;
    }).join('');
  }

  filters.forEach(button=>button.addEventListener('click',()=>{
    active=button.dataset.filter;
    const url=new URL(location.href);
    if(active==='all') url.searchParams.delete('category');
    else url.searchParams.set('category',active);
    history.replaceState(null,'',url);
    languageLinks.forEach(link=>{
      const target=link.dataset.languageChoice;
      link.href=localeApi.pageLanguagePath(location.pathname,target,url.search);
    });
    renderArchive();
  }));
  search?.addEventListener('input',renderArchive);

  renderHighlights();
  renderArchive();
})();
