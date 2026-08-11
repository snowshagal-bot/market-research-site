(function(){
  const categories = {
    daily: { label: '데일리', english: 'DAILY', description: '오늘 시장의 흐름과 수급을 기록합니다.' },
    weekly: { label: '위클리', english: 'WEEKLY', description: '한 주의 시장을 복기하고 다음 변수를 살핍니다.' },
    research: { label: '비정기', english: 'RESEARCH', description: '산업·기업·정책의 구조적 변화를 깊이 읽습니다.' },
    basics: { label: '시장 공부', english: 'MARKET BASICS', description: '경제와 투자의 기본 개념을 차분히 설명합니다.' },
    note: { label: '끄적끄적', english: 'NOTES', description: '시장과 투자에 관한 짧은 생각을 기록합니다.' }
  };
  const coreTypes = ['daily', 'weekly', 'research', 'basics'];
  const validTypes = ['all', ...coreTypes, 'note'];
  const posts = (window.RESEARCH_POSTS || []).slice().sort((a,b)=>{
    const da=String(a.reportDate||a.date||'');
    const db=String(b.reportDate||b.date||'');
    if(da!==db) return db.localeCompare(da);
    return String(b.registeredAt||'').localeCompare(String(a.registeredAt||''));
  });
  const html = document.documentElement;
  const body = document.body;
  const themeBtn = document.querySelector('[data-theme-toggle]');
  const menuBtn = document.querySelector('[data-menu-toggle]');
  const mobileNav = document.querySelector('.mobile-nav');
  const list = document.getElementById('report-list');
  const search = document.getElementById('search-input');
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const navLinks = Array.from(document.querySelectorAll('[data-nav-category]'));
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
      themeBtn.setAttribute('aria-label', actual === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
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
  menuBtn?.addEventListener('click',()=>{
    const open = mobileNav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded',String(open));
    menuBtn.setAttribute('aria-label',open ? '메뉴 닫기' : '메뉴 열기');
  });

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
  }
  function reportDate(post){ return post.reportDate || post.date || ''; }
  function categoryInfo(type){ return categories[type] || { label: type || '리포트', english: 'REPORT' }; }
  function latestFor(type){ return posts.find(post=>post.type===type) || null; }

  const slides = coreTypes.map(type=>latestFor(type)).filter(Boolean);
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
      return `<img src="${esc(post.coverImage)}" alt="${esc(post.title)} 커버 이미지" loading="eager">`;
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
    stage.setAttribute('aria-label',`${slideIndex + 1}/${slides.length} ${info.label} 대표 리포트`);
    slideCategory.textContent = info.label;
    slideDate.textContent = reportDate(post);
    slideDate.dateTime = reportDate(post);
    slideTitle.textContent = post.title;
    slideSubtitle.textContent = post.subtitle || '';
    slideSubtitle.hidden = !post.subtitle;
    slideDescription.textContent = post.description || info.description;
    slideLink.href = post.href;
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
      return `<button type="button" role="tab" aria-controls="featured-slide" aria-selected="${index===slideIndex}" tabindex="${index===slideIndex?0:-1}" data-slide-tab="${index}" aria-label="${esc(info.label)} 대표 리포트 보기">${esc(info.label)}</button>`;
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
    host.innerHTML=highlights.map(post=>{
      const info=categoryInfo(post.type);
      return `<a class="latest-card" href="${esc(post.href)}"><span>${esc(info.label)} · ${esc(reportDate(post))}</span><strong>${esc(post.title)}</strong><i aria-hidden="true">→</i></a>`;
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

  function renderArchive(){
    const query=(search?.value||'').trim().toLowerCase();
    const filtered=posts.filter(post=>(active==='all'||post.type===active)&&(!query||`${post.title} ${post.subtitle||''} ${post.typeLabel||''} ${post.description||''}`.toLowerCase().includes(query)));
    filters.forEach(button=>{
      const selected=button.dataset.filter===active;
      button.classList.toggle('active',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    renderNavigation();
    if(!filtered.length){
      const message=active==='basics'?'시장 공부 글이 아직 없습니다.':'조건에 맞는 글이 없습니다.';
      list.innerHTML=`<div class="empty">${message}</div>`;
      return;
    }
    list.innerHTML=filtered.map(post=>{
      const info=categoryInfo(post.type);
      return `<a class="report-item" href="${esc(post.href)}"><div><span class="report-type ${esc(post.type)}">${esc(info.label)}</span><span class="report-date">${esc(reportDate(post))}</span></div><div><div class="report-title">${esc(post.title)}</div><div class="report-subtitle">${esc(post.subtitle||'')}</div></div><span class="report-arrow" aria-hidden="true">→</span></a>`;
    }).join('');
  }

  filters.forEach(button=>button.addEventListener('click',()=>{
    active=button.dataset.filter;
    const url=new URL(location.href);
    if(active==='all') url.searchParams.delete('category');
    else url.searchParams.set('category',active);
    history.replaceState(null,'',url);
    const matchingSlide=slides.findIndex(post=>post.type===active);
    if(matchingSlide>=0) setSlide(matchingSlide);
    renderArchive();
  }));
  search?.addEventListener('input',renderArchive);

  buildCarousel();
  renderHighlights();
  renderArchive();
})();
