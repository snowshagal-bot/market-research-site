(function(){
  const localeApi = window.MARKET_LOCALE;
  const html = document.documentElement;
  const body = document.body;
  const locale = localeApi?.siteLanguage(document) || (html.lang === 'en' ? 'en' : 'ko');
  const messages = localeApi?.copy?.[locale] || localeApi?.copy?.ko;
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
    if(themeMeta) themeMeta.setAttribute('content', actual === 'dark' ? '#161816' : '#f5f0e6');
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

  const isHomepage = Boolean(list && search && document.querySelector('[data-carousel]') && document.getElementById('latest-category-cards'));
  if(!isHomepage) return;

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
  }
  function reportDate(post){ return post.reportDate || post.date || ''; }
  function rootPath(path){ return `/${String(path || '').replace(/^\/+/, '')}`; }
  function categoryInfo(type){ return categories[type] || { label: type || (locale === 'en' ? 'Report' : '리포트'), english: 'REPORT', description: '' }; }
  function latestFor(type){ return posts.find(post=>post.type===type) || null; }

  const slides = localeApi?.latestByCore(allPosts, locale, coreTypes) || coreTypes.map(type=>latestFor(type)).filter(Boolean);
  let slideIndex = Math.max(0, slides.findIndex(post=>post.type===active));
  const carousel = document.querySelector('[data-carousel]');
  const stage = document.getElementById('featured-slide');
  const tabs = document.querySelector('[data-carousel-tabs]');
  const previous = document.querySelector('[data-slide-prev]');
  const next = document.querySelector('[data-slide-next]');
  const slideCategory = document.querySelector('[data-slide-category]');
  const slideDate = document.querySelector('[data-slide-date]');
  const slideTitle = document.querySelector('[data-slide-title]');
  const slideSubtitle = document.querySelector('[data-slide-subtitle]');
  const slideDescription = document.querySelector('[data-slide-description]');
  const slideLink = document.querySelector('[data-slide-link]');
  const slideCover = document.querySelector('[data-slide-cover]');
  const slideCurrent = document.querySelector('[data-slide-current]');
  const slideTotal = document.querySelector('[data-slide-total]');

  function coverMarkup(post){
    const info = categoryInfo(post.type);
    if(post.coverImage){
      const alt = locale === 'en' ? `${post.title} ${messages.coverAlt}` : `${post.title} ${messages.coverAlt}`;
      return `<img src="${esc(rootPath(post.coverImage))}" alt="${esc(alt)}" loading="eager">`;
    }
    return `<div class="cover-fallback" data-fallback-category="${esc(post.type)}"><span class="cover-brand">MARKET RESEARCH</span><span class="cover-category">${esc(info.english)}</span><strong>${esc(post.title)}</strong><time datetime="${esc(reportDate(post))}">${esc(reportDate(post))}</time></div>`;
  }

  function setSlide(index, focusTab=false){
    if(!slides.length){
      carousel.hidden = true;
      return;
    }
    slideIndex = (index + slides.length) % slides.length;
    const post = slides[slideIndex];
    const info = categoryInfo(post.type);
    stage.dataset.category = post.type;
    stage.setAttribute('aria-label',`${slideIndex + 1}/${slides.length} ${info.label} ${messages.representative}`);
    slideCategory.textContent = info.label;
    slideDate.textContent = reportDate(post);
    slideDate.dateTime = reportDate(post);
    slideTitle.textContent = post.title;
    slideSubtitle.textContent = post.subtitle || '';
    slideSubtitle.hidden = !post.subtitle;
    slideDescription.textContent = post.description || info.description;
    slideLink.href = rootPath(post.href);
    slideCover.innerHTML = coverMarkup(post);
    slideCurrent.textContent = String(slideIndex + 1).padStart(2,'0');
    slideTotal.textContent = String(slides.length).padStart(2,'0');
    tabs.querySelectorAll('[role="tab"]').forEach((tab,tabIndex)=>{
      const selected = tabIndex === slideIndex;
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if(selected && focusTab) tab.focus();
    });
    stage.classList.remove('slide-refresh');
    requestAnimationFrame(()=>stage.classList.add('slide-refresh'));
  }

  function buildCarousel(){
    if(!slides.length){
      carousel.hidden = true;
      return;
    }
    tabs.innerHTML = slides.map((post,index)=>{
      const info=categoryInfo(post.type);
      const label = locale === 'en' ? `View featured ${info.label} report` : `${info.label} 대표 리포트 보기`;
      return `<button type="button" role="tab" aria-controls="featured-slide" aria-selected="${index===slideIndex}" tabindex="${index===slideIndex?0:-1}" data-slide-tab="${index}" aria-label="${esc(label)}">${esc(info.label)}</button>`;
    }).join('');
    tabs.querySelectorAll('[data-slide-tab]').forEach(tab=>tab.addEventListener('click',()=>setSlide(Number(tab.dataset.slideTab))));
    previous.disabled = slides.length < 2;
    next.disabled = slides.length < 2;
    previous.addEventListener('click',()=>setSlide(slideIndex-1));
    next.addEventListener('click',()=>setSlide(slideIndex+1));
    tabs.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      if(event.key==='Home') setSlide(0,true);
      else if(event.key==='End') setSlide(slides.length-1,true);
      else setSlide(slideIndex+(event.key==='ArrowRight'?1:-1),true);
    });
    let touchStartX=0;
    let touchStartY=0;
    stage.addEventListener('touchstart',event=>{
      const touch=event.changedTouches[0];
      touchStartX=touch.clientX;
      touchStartY=touch.clientY;
    },{passive:true});
    stage.addEventListener('touchend',event=>{
      const touch=event.changedTouches[0];
      const dx=touch.clientX-touchStartX;
      const dy=touch.clientY-touchStartY;
      if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.4) setSlide(slideIndex+(dx<0?1:-1));
    },{passive:true});
    setSlide(slideIndex);
  }

  function renderHighlights(){
    const host=document.getElementById('latest-category-cards');
    const highlights=['daily','weekly','research'].map(type=>latestFor(type)).filter(Boolean);
    const section=host.closest('.site-introduction');
    if(section) section.hidden=!highlights.length;
    host.innerHTML=highlights.map(post=>{
      const info=categoryInfo(post.type);
      return `<a class="latest-card" href="${esc(rootPath(post.href))}"><span>${esc(info.label)} · ${esc(reportDate(post))}</span><strong>${esc(post.title)}</strong><i aria-hidden="true">→</i></a>`;
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
    const filtered=localeApi?.searchPosts(allPosts, locale, query, active) || posts.filter(post=>(active==='all'||post.type===active)&&(!query||`${post.title} ${post.subtitle||''} ${post.typeLabel||''} ${post.description||''}`.toLowerCase().includes(query)));
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
    const matchingSlide=slides.findIndex(post=>post.type===active);
    if(matchingSlide>=0) setSlide(matchingSlide);
    renderArchive();
  }));
  search?.addEventListener('input',renderArchive);

  buildCarousel();
  renderHighlights();
  renderArchive();
})();
