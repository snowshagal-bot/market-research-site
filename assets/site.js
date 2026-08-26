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
  const languageLinks = Array.from(document.querySelectorAll('[data-language-choice]'));
  const navLinks = Array.from(document.querySelectorAll('[data-nav-category]'));

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
  }
  function reportDate(post){ return post.reportDate || post.date || ''; }
  function rootPath(path){ return `/${String(path || '').replace(/^\/+/, '')}`; }
  function categoryInfo(type){ return categories[type] || { label: type || (locale === 'en' ? 'Report' : '리포트'), english: 'REPORT', description: '' }; }
  function latestFor(type){ return posts.find(post=>post.type===type) || null; }

  // Theme Management
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

  function scrollActiveMobileNavIntoView(){
    const quickNav = document.querySelector('.mobile-quick-nav');
    if (!quickNav) return;
    const activeItem = quickNav.querySelector('a.active, a[aria-current="page"]');
    if (activeItem) {
      const navRect = quickNav.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      if (itemRect.left < navRect.left || itemRect.right > navRect.right) {
        quickNav.scrollLeft = Math.max(0, (activeItem.offsetLeft + activeItem.offsetWidth / 2) - (quickNav.clientWidth / 2));
      }
    }
  }

  languageLinks.forEach(link=>{
    const target = link.dataset.languageChoice;
    if(!localeApi?.validLanguages.includes(target)) return;
    link.href = localeApi.pageLanguagePath(location.pathname, target, location.search);
    link.addEventListener('click',()=>{
      try { localStorage.setItem('site-language', target); } catch (_) {}
    });
  });

  scrollActiveMobileNavIntoView();

  /* ==========================================================================
     Global Search Dialog & Engine
     ========================================================================== */
  const searchTriggers = Array.from(document.querySelectorAll('[data-search-trigger]'));
  const searchDialog = document.getElementById('search-dialog');
  const globalSearchInput = document.getElementById('global-search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const searchResultsList = document.getElementById('search-results-list');
  const searchEmptyState = document.getElementById('search-empty-state');
  const searchQuickTags = document.getElementById('search-quick-tags');
  const searchTagCloud = document.getElementById('search-tag-cloud');
  let lastActiveTrigger = null;
  let isSearchIndexLoading = false;

  function loadSearchIndex(callback){
    if (window.SEARCH_INDEX && Array.isArray(window.SEARCH_INDEX)) {
      if (callback) callback(window.SEARCH_INDEX);
      return;
    }
    if (isSearchIndexLoading) return;
    isSearchIndexLoading = true;
    const script = document.createElement('script');
    script.src = `/data/search-index.js?v=${Date.now()}`;
    script.onload = () => {
      isSearchIndexLoading = false;
      if (callback) callback(window.SEARCH_INDEX || []);
    };
    script.onerror = () => {
      isSearchIndexLoading = false;
      window.SEARCH_INDEX = allPosts.map(p => ({
        ...p,
        category: p.type,
        date: p.reportDate || p.date,
        summary: p.summary || p.description || '',
        tags: p.tags || [],
        url: p.href ? `/${p.href.replace(/^\/+/, '')}` : '',
        bodyText: ''
      }));
      if (callback) callback(window.SEARCH_INDEX);
    };
    document.head.appendChild(script);
  }

  function openSearchDialog(trigger){
    if (!searchDialog) return;
    lastActiveTrigger = trigger || null;
    loadSearchIndex(() => {
      renderSearchTagCloud();
      performSearch(globalSearchInput?.value || '');
    });
    if (typeof searchDialog.showModal === 'function') {
      searchDialog.showModal();
    } else {
      searchDialog.setAttribute('open', '');
    }
    renderSearchTagCloud();
    setTimeout(() => globalSearchInput?.focus(), 50);
  }

  function closeSearchDialog(){
    if (!searchDialog) return;
    if (typeof searchDialog.close === 'function') {
      searchDialog.close();
    } else {
      searchDialog.removeAttribute('open');
    }
    if (lastActiveTrigger && typeof lastActiveTrigger.focus === 'function') {
      lastActiveTrigger.focus();
    }
  }

  searchTriggers.forEach(btn => {
    btn.addEventListener('click', () => openSearchDialog(btn));
  });

  searchDialog?.querySelectorAll('[data-search-close]').forEach(btn => {
    btn.addEventListener('click', closeSearchDialog);
  });

  searchDialog?.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeSearchDialog();
  });

  function highlightMatches(text, queryWords){
    if (!text || !queryWords.length) return esc(text);
    const escapedWords = queryWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
    if (!escapedWords.length) return esc(text);
    const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');
    return esc(text).replace(regex, '<span class="search-highlight">$1</span>');
  }

  function renderSearchTagCloud(){
    if (!searchTagCloud) return;
    const indexData = window.SEARCH_INDEX || allPosts;
    const targetPosts = indexData.filter(p => (p.lang === 'en' ? 'en' : 'ko') === locale);
    const tagCountMap = {};
    targetPosts.forEach(p => {
      if (Array.isArray(p.tags)) {
        p.tags.forEach(tag => {
          if (tag) tagCountMap[tag] = (tagCountMap[tag] || 0) + 1;
        });
      }
    });
    let tags = Object.keys(tagCountMap).sort((a,b) => tagCountMap[b] - tagCountMap[a]);
    if (!tags.length) {
      tags = locale === 'en' ? ['KOSPI', 'FX', 'Rates', 'Semiconductor', 'AI'] : ['KOSPI', '환율', '금리', '반도체', '수급', '연준'];
    }
    searchTagCloud.innerHTML = tags.slice(0, 8).map(tag => {
      return `<button type="button" class="search-tag-chip" data-search-tag="${esc(tag)}">#${esc(tag)}</button>`;
    }).join('');

    searchTagCloud.querySelectorAll('[data-search-tag]').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.dataset.searchTag;
        if (globalSearchInput) {
          globalSearchInput.value = tag;
          if (searchClearBtn) searchClearBtn.hidden = false;
          performSearch(tag);
          globalSearchInput.focus();
        }
      });
    });
  }

  function performSearch(queryStr){
    if (!searchResultsList) return;
    const query = (queryStr || '').trim().toLowerCase();
    if (searchClearBtn) searchClearBtn.hidden = !query;

    if (!query) {
      searchResultsList.innerHTML = '';
      if (searchQuickTags) searchQuickTags.hidden = false;
      if (searchEmptyState) searchEmptyState.hidden = true;
      return;
    }

    if (searchQuickTags) searchQuickTags.hidden = true;

    const indexData = (window.SEARCH_INDEX || allPosts).filter(p => (p.lang === 'en' ? 'en' : 'ko') === locale);
    const queryWords = query.split(/\s+/).filter(Boolean);

    const scored = [];
    indexData.forEach(item => {
      let score = 0;
      const title = (item.title || '').toLowerCase();
      const subtitle = (item.subtitle || '').toLowerCase();
      const summary = (item.summary || item.description || '').toLowerCase();
      const body = (item.bodyText || '').toLowerCase();
      const tags = (Array.isArray(item.tags) ? item.tags : []).map(t => String(t).toLowerCase());

      queryWords.forEach(word => {
        if (title.includes(word)) score += 10;
        if (tags.some(t => t.includes(word))) score += 8;
        if (subtitle.includes(word) || summary.includes(word)) score += 5;
        if (body.includes(word)) score += 2;
      });

      if (score > 0) {
        scored.push({ item, score });
      }
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const da = String(a.item.date || a.item.reportDate || '');
      const db = String(b.item.date || b.item.reportDate || '');
      return db.localeCompare(da);
    });

    if (!scored.length) {
      searchResultsList.innerHTML = '';
      if (searchEmptyState) searchEmptyState.hidden = false;
      return;
    }

    if (searchEmptyState) searchEmptyState.hidden = true;
    searchResultsList.innerHTML = scored.map(({ item }) => {
      const info = categoryInfo(item.category || item.type);
      const highlightedTitle = highlightMatches(item.title, queryWords);
      const highlightedSummary = highlightMatches(item.summary || item.description, queryWords);
      const targetUrl = item.url || rootPath(item.href);

      return `
        <a class="search-result-item" href="${esc(targetUrl)}">
          <div class="search-result-title">${highlightedTitle}</div>
          <div class="search-result-summary">${highlightedSummary}</div>
          <div class="search-result-meta">
            <span class="search-result-type">${esc(info.label)}</span>
            <span>·</span>
            <time datetime="${esc(item.date)}">${esc(item.date)}</time>
          </div>
        </a>
      `;
    }).join('');
  }

  globalSearchInput?.addEventListener('input', (e) => {
    performSearch(e.target.value);
  });

  searchClearBtn?.addEventListener('click', () => {
    if (globalSearchInput) {
      globalSearchInput.value = '';
      performSearch('');
      globalSearchInput.focus();
    }
  });

  /* ==========================================================================
     Homepage Archive & Calendar View Engine
     ========================================================================== */
  const isHomepage = Boolean(document.getElementById('latest-category-cards') && document.getElementById('report-list'));
  if(!isHomepage) return;

  const list = document.getElementById('report-list');
  const calendarContainer = document.getElementById('calendar-container');
  const viewToggle = document.getElementById('archive-view-toggle');
  const viewToggleBtns = Array.from(document.querySelectorAll('.view-toggle-btn'));
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const archiveIndex = document.getElementById('archive-index');
  const archiveOrderLabel = document.getElementById('archive-order-label');
  const filterYear = document.getElementById('filter-year');
  const filterMonth = document.getElementById('filter-month');
  const filterTag = document.getElementById('filter-tag');
  const filterResetBtn = document.getElementById('filter-reset-btn');

  const urlParams = new URLSearchParams(location.search);
  let activeCategory = validTypes.includes(urlParams.get('category')) ? urlParams.get('category') : 'all';
  let activeYear = urlParams.get('year') || 'all';
  let activeMonth = urlParams.get('month') || 'all';
  let activeTag = urlParams.get('tag') || 'all';
  let activeView = (activeCategory === 'daily' || activeCategory === 'weekly') && urlParams.get('view') === 'calendar' ? 'calendar' : 'list';
  let currentCalMonth = urlParams.get('calMonth') || '';
  let selectedCalDate = '';

  function updateUrlState(){
    const url = new URL(location.href);
    if (activeCategory === 'all') url.searchParams.delete('category');
    else url.searchParams.set('category', activeCategory);

    if (activeYear === 'all') url.searchParams.delete('year');
    else url.searchParams.set('year', activeYear);

    if (activeMonth === 'all') url.searchParams.delete('month');
    else url.searchParams.set('month', activeMonth);

    if (activeTag === 'all') url.searchParams.delete('tag');
    else url.searchParams.set('tag', activeTag);

    if ((activeCategory === 'daily' || activeCategory === 'weekly') && activeView === 'calendar') {
      url.searchParams.set('view', 'calendar');
      if (currentCalMonth) url.searchParams.set('calMonth', currentCalMonth);
      else url.searchParams.delete('calMonth');
    } else {
      url.searchParams.delete('view');
      url.searchParams.delete('calMonth');
    }

    history.replaceState(null, '', url);
    languageLinks.forEach(link => {
      const target = link.dataset.languageChoice;
      link.href = localeApi.pageLanguagePath(location.pathname, target, url.search);
    });
  }

  function populateFilterOptions(){
    if (!filterYear || !filterMonth || !filterTag) return;

    const years = new Set();
    const tags = new Set();

    localizedPosts.forEach(post => {
      const d = reportDate(post);
      if (d) {
        const y = d.slice(0, 4);
        if (y) years.add(y);
      }
      if (Array.isArray(post.tags)) {
        post.tags.forEach(t => t && tags.add(t));
      }
    });

    const yearOptions = ['<option value="all">' + (locale === 'en' ? 'All Years' : '연도 전체') + '</option>'];
    Array.from(years).sort().reverse().forEach(y => {
      yearOptions.push(`<option value="${esc(y)}"${y === activeYear ? ' selected' : ''}>${esc(y)}${locale === 'en' ? '' : '년'}</option>`);
    });
    filterYear.innerHTML = yearOptions.join('');

    const monthOptions = ['<option value="all">' + (locale === 'en' ? 'All Months' : '월 전체') + '</option>'];
    for (let m = 1; m <= 12; m++) {
      const mStr = String(m).padStart(2, '0');
      const label = locale === 'en' ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1] : `${m}월`;
      monthOptions.push(`<option value="${mStr}"${mStr === activeMonth ? ' selected' : ''}>${label}</option>`);
    }
    filterMonth.innerHTML = monthOptions.join('');

    const tagOptions = ['<option value="all">' + (locale === 'en' ? 'All Tags' : '태그 전체') + '</option>'];
    Array.from(tags).sort().forEach(t => {
      tagOptions.push(`<option value="${esc(t)}"${t === activeTag ? ' selected' : ''}>#${esc(t)}</option>`);
    });
    filterTag.innerHTML = tagOptions.join('');
  }

  function renderHighlights(){
    const host=document.getElementById('latest-category-cards');
    if (!host) return;
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
      return `<a class="latest-card latest-card-${esc(post.type)}" href="${esc(rootPath(post.href))}"><span class="latest-card-meta"><b>${esc(info.english)}</b><time datetime="${esc(reportDate(post))}">${esc(reportDate(post))}</time></span><strong class="latest-card-title">${esc(post.title)}</strong><span class="latest-card-body">${visual}<span class="latest-card-copy">${summaryCopy}<span class="latest-card-read">${esc(readLabel)} <i aria-hidden="true">→</i></span></span></span></a>`;
    }).join('');
  }

  function renderNavigation(){
    body.dataset.category = activeCategory;
    navLinks.forEach(link => {
      const current = link.dataset.navCategory === activeCategory;
      link.classList.toggle('active', current);
      if (current) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
    scrollActiveMobileNavIntoView();
  }

  function renderArchiveIndex(){
    if(!archiveIndex) return;
    const counts=localeApi?.categoryCounts(allPosts, locale, [...coreTypes,'note']) || posts.reduce((result,post)=>{
      if(coreTypes.includes(post.type)||post.type==='note') result[post.type]=(result[post.type]||0)+1;
      return result;
    },{});
    archiveIndex.innerHTML=[...coreTypes,'note'].map(type=>{
      const info=categoryInfo(type);
      const current=type===activeCategory;
      return `<a class="archive-index-item" href="?category=${encodeURIComponent(type)}"${current?' aria-current="page"':''}><span class="archive-index-row"><strong>${esc(info.label)}</strong><b>${counts[type]||0}</b></span><span class="archive-index-description">${esc(info.description)}</span></a>`;
    }).join('');
  }

  function filterPosts(){
    return localizedPosts.filter(post => {
      if (activeCategory !== 'all' && post.type !== activeCategory) return false;
      const d = reportDate(post);
      if (activeYear !== 'all' && (!d || !d.startsWith(activeYear))) return false;
      if (activeMonth !== 'all' && (!d || d.slice(5, 7) !== activeMonth)) return false;
      if (activeTag !== 'all' && (!Array.isArray(post.tags) || !post.tags.includes(activeTag))) return false;
      return true;
    });
  }

  function renderCalendarView(categoryPosts){
    if (!calendarContainer) return;
    calendarContainer.hidden = false;
    list.hidden = true;

    if (!currentCalMonth) {
      const datesWithReports = categoryPosts.map(p => reportDate(p)).filter(Boolean).sort().reverse();
      currentCalMonth = datesWithReports.length ? datesWithReports[0].slice(0, 7) : new Date().toISOString().slice(0, 7);
    }

    const [yearNum, monthNum] = currentCalMonth.split('-').map(Number);
    const monthTitle = locale === 'en'
      ? `${['January','February','March','April','May','June','July','August','September','October','November','December'][monthNum - 1]} ${yearNum}`
      : `${yearNum}년 ${monthNum}월`;

    const reportsByDate = {};
    categoryPosts.forEach(post => {
      const d = reportDate(post);
      if (d && d.startsWith(currentCalMonth)) {
        if (!reportsByDate[d]) reportsByDate[d] = [];
        reportsByDate[d].push(post);
      }
    });

    const activeDates = Object.keys(reportsByDate).sort().reverse();
    if (!selectedCalDate || !selectedCalDate.startsWith(currentCalMonth)) {
      selectedCalDate = activeDates[0] || '';
    }

    const firstDayIndex = new Date(yearNum, monthNum - 1, 1).getDay();
    const mondayOffset = (firstDayIndex + 6) % 7;
    const totalDaysInMonth = new Date(yearNum, monthNum, 0).getDate();

    const weekdays = locale === 'en'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['월', '화', '수', '목', '금', '토', '일'];

    let daysHtml = '';
    for (let i = 0; i < mondayOffset; i++) {
      daysHtml += '<div class="calendar-day empty" aria-hidden="true"></div>';
    }
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateStr = `${currentCalMonth}-${dayStr}`;
      const hasReport = Boolean(reportsByDate[dateStr]);
      const isSelected = dateStr === selectedCalDate;
      const classes = ['calendar-day'];
      if (hasReport) classes.push('has-report');
      else classes.push('disabled');
      if (isSelected) classes.push('is-selected');

      daysHtml += `
        <button type="button" class="${classes.join(' ')}" data-cal-date="${dateStr}" ${hasReport ? '' : 'disabled'} aria-label="${dateStr}">
          <span>${day}</span>
        </button>
      `;
    }

    let previewHtml = '';
    if (selectedCalDate && reportsByDate[selectedCalDate]) {
      const selectedList = reportsByDate[selectedCalDate];
      const previewHeading = locale === 'en' ? `Reports on ${selectedCalDate}` : `${selectedCalDate} 리포트`;
      previewHtml = `
        <div class="calendar-preview-wrap">
          <h4 class="calendar-preview-heading">${esc(previewHeading)}</h4>
          <div class="calendar-preview-list">
            ${selectedList.map(p => `
              <div class="calendar-preview-card">
                <h5 class="calendar-preview-title">${esc(p.title)}</h5>
                <p class="calendar-preview-summary">${esc(p.summary || p.description || '')}</p>
                <div class="calendar-preview-meta">
                  <span>${esc(categoryInfo(p.type).label)} · ${esc(reportDate(p))}</span>
                  <a class="calendar-preview-link" href="${esc(rootPath(p.href))}">${esc(messages.read)} <span aria-hidden="true">→</span></a>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    calendarContainer.innerHTML = `
      <div class="calendar-card">
        <div class="calendar-header">
          <h3 class="calendar-title">${esc(monthTitle)}</h3>
          <div class="calendar-nav-group">
            <button type="button" class="calendar-nav-btn" id="cal-prev-btn" aria-label="${locale === 'en' ? 'Previous month' : '이전 달'}">‹</button>
            <button type="button" class="calendar-nav-btn" id="cal-next-btn" aria-label="${locale === 'en' ? 'Next month' : '다음 달'}">›</button>
          </div>
        </div>
        <div class="calendar-grid">
          ${weekdays.map(w => `<div class="calendar-weekday">${esc(w)}</div>`).join('')}
          ${daysHtml}
        </div>
        ${previewHtml}
      </div>
    `;

    document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
      let prevM = monthNum - 1;
      let prevY = yearNum;
      if (prevM < 1) { prevM = 12; prevY--; }
      currentCalMonth = `${prevY}-${String(prevM).padStart(2, '0')}`;
      updateUrlState();
      renderCalendarView(categoryPosts);
    });

    document.getElementById('cal-next-btn')?.addEventListener('click', () => {
      let nextM = monthNum + 1;
      let nextY = yearNum;
      if (nextM > 12) { nextM = 1; nextY++; }
      currentCalMonth = `${nextY}-${String(nextM).padStart(2, '0')}`;
      updateUrlState();
      renderCalendarView(categoryPosts);
    });

    calendarContainer.querySelectorAll('.calendar-day.has-report').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedCalDate = btn.dataset.calDate;
        renderCalendarView(categoryPosts);
      });
    });
  }

  function renderArchive(){
    const isCalendarEligible = activeCategory === 'daily' || activeCategory === 'weekly';
    if (viewToggle) {
      viewToggle.hidden = !isCalendarEligible;
    }
    if (!isCalendarEligible) {
      activeView = 'list';
    }

    viewToggleBtns.forEach(btn => {
      const isCurrentView = btn.dataset.view === activeView;
      btn.classList.toggle('active', isCurrentView);
      btn.setAttribute('aria-pressed', String(isCurrentView));
    });

    const matched = filterPosts();
    const filtered=localeApi?.sortPosts(matched) || matched.slice().sort((a,b)=>{
      const byDate = String(b.reportDate||b.date||'').localeCompare(String(a.reportDate||a.date||''));
      return byDate || String(b.registeredAt||'').localeCompare(String(a.registeredAt||''));
    });

    if(archiveOrderLabel) archiveOrderLabel.textContent=messages.reportOrder;
    filters.forEach(button => {
      const selected = button.dataset.filter === activeCategory;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed',String(selected));
    });

    renderNavigation();
    renderArchiveIndex();

    if (activeView === 'calendar' && isCalendarEligible) {
      renderCalendarView(filtered);
      return;
    }

    if (calendarContainer) calendarContainer.hidden = true;
    list.hidden = false;

    if (!filtered.length) {
      const message = activeCategory === 'basics' ? messages.basicsEmpty : messages.empty;
      list.innerHTML = `<div class="empty">${esc(message)}</div>`;
      return;
    }

    list.innerHTML = filtered.map(post => {
      const info = categoryInfo(post.type);
      const subtitle=post.subtitle?`<div class="report-subtitle">${esc(post.subtitle)}</div>`:'';
      return `
        <a class="report-item" href="${esc(rootPath(post.href))}">
          <div>
            <span class="report-type ${esc(post.type)}">${esc(info.label)}</span>
            <span class="report-date">${esc(reportDate(post))}</span>
          </div>
          <div>
            <div class="report-title">${esc(post.title)}</div>
            ${subtitle}
          </div>
          <span class="report-arrow">
            <span class="report-read-label">${esc(messages.read)}</span>
            <span aria-hidden="true">→</span>
          </span>
        </a>
      `;
    }).join('');
  }

  filters.forEach(button => button.addEventListener('click', () => {
    activeCategory = button.dataset.filter;
    if (activeCategory !== 'daily' && activeCategory !== 'weekly') {
      activeView = 'list';
    }
    updateUrlState();
    renderArchive();
  }));

  viewToggleBtns.forEach(btn => btn.addEventListener('click', () => {
    activeView = btn.dataset.view;
    updateUrlState();
    renderArchive();
  }));

  filterYear?.addEventListener('change', (e) => {
    activeYear = e.target.value;
    updateUrlState();
    renderArchive();
  });
  filterMonth?.addEventListener('change', (e) => {
    activeMonth = e.target.value;
    updateUrlState();
    renderArchive();
  });
  filterTag?.addEventListener('change', (e) => {
    activeTag = e.target.value;
    updateUrlState();
    renderArchive();
  });
  filterResetBtn?.addEventListener('click', () => {
    activeYear = 'all';
    activeMonth = 'all';
    activeTag = 'all';
    if (filterYear) filterYear.value = 'all';
    if (filterMonth) filterMonth.value = 'all';
    if (filterTag) filterTag.value = 'all';
    updateUrlState();
    renderArchive();
  });

  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search);
    activeCategory = validTypes.includes(params.get('category')) ? params.get('category') : 'all';
    activeYear = params.get('year') || 'all';
    activeMonth = params.get('month') || 'all';
    activeTag = params.get('tag') || 'all';
    activeView = (activeCategory === 'daily' || activeCategory === 'weekly') && params.get('view') === 'calendar' ? 'calendar' : 'list';
    currentCalMonth = params.get('calMonth') || '';
    if (filterYear) filterYear.value = activeYear;
    if (filterMonth) filterMonth.value = activeMonth;
    if (filterTag) filterTag.value = activeTag;
    renderArchive();
  });

  function renderTodayMarket(){
    const summary = window.TODAY_MARKET_SUMMARY;
    if (!summary) return;
    const dateEl = document.getElementById('today-strip-date');
    const gridEl = document.getElementById('today-market-grid');
    const takeawayTextEl = document.getElementById('today-takeaway-text');
    const takeawayLinkEl = document.getElementById('today-takeaway-link');

    if (dateEl && summary.dateDisplay) {
      dateEl.textContent = summary.dateDisplay[locale] || summary.dateDisplay.ko || summary.dateDisplay.en || 'CLOSE';
    }
    if (gridEl && Array.isArray(summary.items)) {
      gridEl.innerHTML = summary.items.map(item => {
        const dirClass = item.direction === 'down' ? 'down' : 'up';
        const changeVal = typeof item.change === 'object' && item.change !== null
          ? (item.change[locale] || item.change.ko || item.change.en || '')
          : item.change;
        return `<div class="today-item" role="listitem"><span class="today-label">${esc(item.label)}</span><span class="today-value">${esc(item.value)}</span><span class="today-change ${dirClass}">${esc(changeVal)}</span></div>`;
      }).join('');
    }
    if (takeawayTextEl && summary.takeaway) {
      takeawayTextEl.textContent = summary.takeaway[locale] || summary.takeaway.ko || summary.takeaway.en || '';
    }
    if (takeawayLinkEl) {
      const latestDaily = latestFor('daily');
      if (latestDaily) {
        takeawayLinkEl.href = rootPath(latestDaily.href);
      }
    }
  }

  populateFilterOptions();
  renderTodayMarket();
  renderHighlights();
  renderArchive();
})();
