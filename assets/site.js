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
  // 끄적끄적 is a real category with nothing in it yet. Rather than leading
  // readers to an empty result, its entry points appear once a note exists.
  const hasNotes = posts.some(post => post.type === 'note');
  const listedTypes = hasNotes ? [...coreTypes, 'note'] : [...coreTypes];
  if (!hasNotes) {
    document.querySelectorAll('[data-nav-category="note"], [data-filter="note"]')
      .forEach(element => { element.hidden = true; });
  }

  function esc(value){
    return String(value ?? '').replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[character]));
  }
  function reportDate(post){ return post.reportDate || post.date || ''; }
  function rootPath(path){ return `/${String(path || '').replace(/^\/+/, '')}`; }
  function categoryInfo(type){ return categories[type] || { label: type || (locale === 'en' ? 'Report' : '리포트'), english: 'REPORT', description: '' }; }
  function latestFor(type){ return posts.find(post=>post.type===type) || null; }

  const TAG_REGISTRY = window.TAG_REGISTRY || {
    "flows": { "ko": "수급", "en": "Flows" },
    "semiconductors": { "ko": "반도체", "en": "Semiconductors" },
    "rates": { "ko": "금리", "en": "Rates" },
    "fx": { "ko": "환율", "en": "FX" },
    "treasuries": { "ko": "미국채", "en": "U.S. Treasuries" },
    "fed": { "ko": "연준", "en": "Fed" },
    "futures": { "ko": "선물·파생", "en": "Futures & Derivatives" },
    "ai": { "ko": "AI", "en": "AI" },
    "cloud-datacenter": { "ko": "클라우드·데이터센터", "en": "Cloud & Data Centers" },
    "stablecoins": { "ko": "스테이블코인", "en": "Stablecoins" },
    "crypto": { "ko": "가상자산", "en": "Crypto" },
    "gold": { "ko": "금", "en": "Gold" },
    "autos": { "ko": "자동차", "en": "Autos" },
    "energy": { "ko": "에너지", "en": "Energy" },
    "policy": { "ko": "정책", "en": "Policy" },
    "geopolitics": { "ko": "지정학", "en": "Geopolitics" }
  };

  function tagLabel(tagKey, loc) {
    const l = loc || locale;
    const entry = TAG_REGISTRY[tagKey];
    return entry ? (entry[l] || entry.ko || tagKey) : tagKey;
  }

  function formatTags(tags, loc) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return tags.map(t => tagLabel(t, loc)).filter(Boolean).join(' · ');
  }

  function formatReadingTime(mins, loc) {
    if (typeof mins !== 'number' || mins <= 0) return '';
    const l = loc || locale;
    if (l === 'en') {
      return `${mins} min read`;
    }
    return `약 ${mins}분`;
  }

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

  /* Search index ------------------------------------------------------------
     Two tiers. The metadata file is ~34KB and answers title, tag and summary
     queries immediately; report bodies are ~1.2MB per locale and load in the
     background, so a body-only match appears a moment later instead of holding
     the whole dialog hostage. A Korean reader never downloads English bodies.
  -------------------------------------------------------------------------- */
  const SEARCH_META_SRC = '/data/search-index-meta.js?v=20260827-1';
  const SEARCH_BODY_SRC = `/data/search-index-body-${locale}.js?v=20260827-1`;
  let searchMetaState = '';
  let searchBodyState = '';

  function loadScriptOnce(src){
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(src));
      document.head.appendChild(script);
    });
  }

  // Without the index the dialog still searches what the page already has.
  function searchMetaFallback(){
    return allPosts.map(post => ({
      ...post,
      category: post.type,
      date: post.reportDate || post.date,
      summary: post.summary || post.description || '',
      tags: post.tags || [],
      url: post.href ? `/${post.href.replace(/^\/+/, '')}` : ''
    }));
  }

  function loadSearchMeta(onReady){
    if (searchMetaState === 'ready') { onReady(); return; }
    if (searchMetaState === 'loading') return;
    searchMetaState = 'loading';
    loadScriptOnce(SEARCH_META_SRC)
      .catch(() => { window.SEARCH_INDEX_META = searchMetaFallback(); })
      .then(() => {
        if (!Array.isArray(window.SEARCH_INDEX_META)) window.SEARCH_INDEX_META = searchMetaFallback();
        searchMetaState = 'ready';
        onReady();
      });
  }

  // Fetched for its own sake, not awaited: results are already on screen.
  function loadSearchBodies(onReady){
    if (searchBodyState === 'ready' || searchBodyState === 'loading') return;
    searchBodyState = 'loading';
    loadScriptOnce(SEARCH_BODY_SRC)
      .catch(() => { window.SEARCH_INDEX_BODY = window.SEARCH_INDEX_BODY || {}; })
      .then(() => {
        window.SEARCH_INDEX_BODY = window.SEARCH_INDEX_BODY || {};
        searchBodyState = 'ready';
        onReady();
      });
  }

  function searchEntries(){
    const entries = Array.isArray(window.SEARCH_INDEX_META) ? window.SEARCH_INDEX_META : searchMetaFallback();
    return entries.filter(entry => (entry.lang === 'en' ? 'en' : 'ko') === locale);
  }

  function searchBodyText(entry){
    return (window.SEARCH_INDEX_BODY && window.SEARCH_INDEX_BODY[entry.id]) || '';
  }

  function openSearchDialog(trigger){
    if (!searchDialog) return;
    lastActiveTrigger = trigger || null;
    loadSearchMeta(() => {
      renderSearchTagCloud();
      performSearch(globalSearchInput?.value || '');
      // Re-run once report bodies land so body-only matches join the list.
      loadSearchBodies(() => performSearch(globalSearchInput?.value || ''));
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

  function extractBodySnippet(bodyText, queryWords, snippetLength = 140) {
    if (!bodyText || !queryWords.length) return '';
    const lowerBody = bodyText.toLowerCase();
    let firstIdx = -1;
    for (const w of queryWords) {
      const idx = lowerBody.indexOf(w.toLowerCase());
      if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
        firstIdx = idx;
      }
    }
    if (firstIdx === -1) {
      return bodyText.slice(0, snippetLength) + (bodyText.length > snippetLength ? '…' : '');
    }
    const start = Math.max(0, firstIdx - 50);
    const end = Math.min(bodyText.length, firstIdx + snippetLength - 50);
    let snippet = bodyText.slice(start, end).trim();
    if (start > 0) snippet = '…' + snippet;
    if (end < bodyText.length) snippet = snippet + '…';
    return snippet;
  }

  function renderSearchTagCloud(){
    if (!searchTagCloud) return;
    const targetPosts = searchEntries();
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
      // Suggested searches curated list
      tags = locale === 'en' ? ['KOSPI', 'FX', 'Rates', 'Semiconductor', 'Fed'] : ['KOSPI', '환율', '금리', '반도체', '수급', '연준'];
    }
    searchTagCloud.innerHTML = tags.slice(0, 8).map(tag => {
      return `<button type="button" class="search-tag-chip" data-search-tag="${esc(tag)}">${esc(tag)}</button>`;
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

    const indexData = searchEntries();
    const queryWords = query.split(/\s+/).filter(Boolean);

    const scored = [];
    indexData.forEach(item => {
      let score = 0;
      let titleMatched = false;
      let tagMatched = false;
      let summaryMatched = false;
      let bodyMatched = false;

      const title = (item.title || '').toLowerCase();
      const subtitle = (item.subtitle || '').toLowerCase();
      const summary = (item.summary || item.description || '').toLowerCase();
      const body = searchBodyText(item).toLowerCase();
      const rawTags = Array.isArray(item.tags) ? item.tags : [];
      const localizedTagTerms = [];
      rawTags.forEach(t => {
        localizedTagTerms.push(String(t).toLowerCase());
        const entry = TAG_REGISTRY[t];
        if (entry?.ko) localizedTagTerms.push(entry.ko.toLowerCase());
        if (entry?.en) localizedTagTerms.push(entry.en.toLowerCase());
      });

      queryWords.forEach(word => {
        if (title.includes(word)) { score += 10; titleMatched = true; }
        if (localizedTagTerms.some(t => t.includes(word))) { score += 8; tagMatched = true; }
        if (subtitle.includes(word) || summary.includes(word)) { score += 5; summaryMatched = true; }
        if (body.includes(word)) { score += 2; bodyMatched = true; }
      });

      if (score > 0) {
        scored.push({
          item,
          score,
          isBodyOnlyMatch: bodyMatched && !titleMatched && !tagMatched && !summaryMatched
        });
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
    searchResultsList.innerHTML = scored.map(({ item, isBodyOnlyMatch }) => {
      const info = categoryInfo(item.category || item.type);
      const highlightedTitle = highlightMatches(item.title, queryWords);
      let summaryContent = '';
      const itemBody = searchBodyText(item);
      if (isBodyOnlyMatch && itemBody) {
        const rawSnippet = extractBodySnippet(itemBody, queryWords, 150);
        summaryContent = highlightMatches(rawSnippet, queryWords);
      } else {
        summaryContent = highlightMatches(item.summary || item.description, queryWords);
      }
      const targetUrl = item.url || rootPath(item.href);
      const readingTimeStr = formatReadingTime(item.readingMinutes, locale);
      const tagsStr = formatTags(item.tags, locale);
      const tagsHtml = tagsStr ? `<div class="search-result-tags">${esc(tagsStr)}</div>` : '';

      return `
        <a class="search-result-item" href="${esc(targetUrl)}">
          <div class="search-result-title">${highlightedTitle}</div>
          <div class="search-result-summary">${summaryContent}</div>
          ${tagsHtml}
          <div class="search-result-meta">
            <span class="search-result-type">${esc(info.label)}</span>
            <span>·</span>
            <time datetime="${esc(item.date)}">${esc(item.date)}</time>
            <span>·</span>
            <span>${esc(readingTimeStr)}</span>
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
  // The archive grows by a report a day, so only the first page is rendered
  // and the reader asks for more. Any change to the result set starts over.
  const ARCHIVE_PAGE = 20;
  let archiveShown = ARCHIVE_PAGE;
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

    if (tags.size === 0) {
      filterTag.hidden = true;
      const tagLabelEl = filterTag.closest('label');
      if (tagLabelEl) tagLabelEl.hidden = true;
    } else {
      filterTag.hidden = false;
      const tagLabelEl = filterTag.closest('label');
      if (tagLabelEl) tagLabelEl.hidden = false;
      const tagOptions = ['<option value="all">' + (locale === 'en' ? 'All Tags' : '태그 전체') + '</option>'];
      Array.from(tags).sort().forEach(t => {
        const label = tagLabel(t, locale);
        tagOptions.push(`<option value="${esc(t)}"${t === activeTag ? ' selected' : ''}>${esc(label)}</option>`);
      });
      filterTag.innerHTML = tagOptions.join('');
    }
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
      const readingTimeStr = formatReadingTime(post.readingMinutes, locale);
      const readingSuffix = readingTimeStr ? ` · ${readingTimeStr}` : '';
      const tagsStr = formatTags(post.tags, locale);
      const tagsHtml = tagsStr ? `<div class="latest-card-tags">${esc(tagsStr)}</div>` : '';

      return `<a class="latest-card latest-card-${esc(post.type)}" href="${esc(rootPath(post.href))}">
        <span class="latest-card-meta">
          <b>${esc(info.english)}${esc(readingSuffix)}</b>
          <time datetime="${esc(reportDate(post))}">${esc(reportDate(post))}</time>
        </span>
        <strong class="latest-card-title">${esc(post.title)}</strong>
        <span class="latest-card-body">
          ${visual}
          <span class="latest-card-copy">
            ${summaryCopy}
            ${tagsHtml}
            <span class="latest-card-read">${esc(readLabel)} <i aria-hidden="true">→</i></span>
          </span>
        </span>
      </a>`;
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
    const counts=localeApi?.categoryCounts(allPosts, locale, listedTypes) || posts.reduce((result,post)=>{
      if(coreTypes.includes(post.type)||post.type==='note') result[post.type]=(result[post.type]||0)+1;
      return result;
    },{});
    archiveIndex.innerHTML=listedTypes.map(type=>{
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
            ${selectedList.map(p => {
              const readingTimeStr = formatReadingTime(p.readingMinutes, locale);
              const tagsStr = formatTags(p.tags, locale);
              const tagsHtml = tagsStr ? `<div class="calendar-preview-tags">${esc(tagsStr)}</div>` : '';
              return `
              <div class="calendar-preview-card">
                <h5 class="calendar-preview-title">${esc(p.title)}</h5>
                <p class="calendar-preview-summary">${esc(p.summary || p.description || '')}</p>
                ${tagsHtml}
                <div class="calendar-preview-meta">
                  <span>${esc(categoryInfo(p.type).label)} · ${esc(readingTimeStr)}</span>
                  <a class="calendar-preview-link" href="${esc(rootPath(p.href))}">${esc(messages.read)} <span aria-hidden="true">→</span></a>
                </div>
              </div>
            `;}).join('')}
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

    const visible = filtered.slice(0, archiveShown);
    const remaining = filtered.length - visible.length;
    list.innerHTML = visible.map(post => {
      const info = categoryInfo(post.type);
      const subtitle=post.subtitle?`<div class="report-subtitle">${esc(post.subtitle)}</div>`:'';
      const readingTimeStr = formatReadingTime(post.readingMinutes, locale);
      const tagsStr = formatTags(post.tags, locale);
      const tagsHtml = tagsStr ? `<div class="report-tags">${esc(tagsStr)}</div>` : '';

      return `
        <a class="report-item" href="${esc(rootPath(post.href))}">
          <div>
            <span class="report-type ${esc(post.type)}">${esc(info.label)}</span>
            <span class="report-date">${esc(reportDate(post))} · ${esc(readingTimeStr)}</span>
          </div>
          <div>
            <div class="report-title">${esc(post.title)}</div>
            ${subtitle}
            ${tagsHtml}
          </div>
          <span class="report-arrow">
            <span class="report-read-label">${esc(messages.read)}</span>
            <span aria-hidden="true">→</span>
          </span>
        </a>
      `;
    }).join('') + (remaining > 0
      ? `<button type="button" class="archive-more" id="archive-more">${esc(messages.archiveMore)} <span>${remaining}</span></button>`
      : '');

    const moreButton = list.querySelector('#archive-more');
    moreButton?.addEventListener('click', () => {
      const revealedFrom = visible.length;
      archiveShown += ARCHIVE_PAGE;
      renderArchive();
      // Send the reader to the first row that just appeared rather than
      // leaving focus on a button that may no longer exist.
      list.querySelectorAll('.report-item')[revealedFrom]?.focus();
    });
  }

  filters.forEach(button => button.addEventListener('click', () => {
    activeCategory = button.dataset.filter;
    archiveShown = ARCHIVE_PAGE;
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
    archiveShown = ARCHIVE_PAGE;
    updateUrlState();
    renderArchive();
  });
  filterMonth?.addEventListener('change', (e) => {
    activeMonth = e.target.value;
    archiveShown = ARCHIVE_PAGE;
    updateUrlState();
    renderArchive();
  });
  filterTag?.addEventListener('change', (e) => {
    activeTag = e.target.value;
    archiveShown = ARCHIVE_PAGE;
    updateUrlState();
    renderArchive();
  });
  filterResetBtn?.addEventListener('click', () => {
    activeYear = 'all';
    activeMonth = 'all';
    activeTag = 'all';
    archiveShown = ARCHIVE_PAGE;
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
    archiveShown = ARCHIVE_PAGE;
    activeView = (activeCategory === 'daily' || activeCategory === 'weekly') && params.get('view') === 'calendar' ? 'calendar' : 'list';
    currentCalMonth = params.get('calMonth') || '';
    if (filterYear) filterYear.value = activeYear;
    if (filterMonth) filterMonth.value = activeMonth;
    if (filterTag) filterTag.value = activeTag;
    renderArchive();
  });

  /* Today strip -------------------------------------------------------------
     `/api/market/latest` is the single source of truth for both the numbers and
     the market date, so the strip shows the same session that /market/ renders.
     data/market-summary.js is used only when that request fails, and then its
     own `marketDate` is what gets displayed.

     A render is atomic: date, numbers and the one-liner are always painted from
     one session, so the strip can never show one date's numbers next to another
     date's report. The one-liner link resolves strictly by
     `reportDate === displayed marketDate`; with no such daily report it falls
     back to Market Close instead of opening a different day's report.

     With a live session the one-liner comes from D1 when an editor typed one
     there, and otherwise from that same day's daily report in this same
     locale. Neither a different date nor a different language can supply it,
     and with the API down the static record answers alone.

     Freshness is whatever `market_date` the API returns. The calendar date is
     never consulted: on a weekend or holiday the last trading session is the
     current data, not stale data.
  -------------------------------------------------------------------------- */
  const MARKET_LATEST_ENDPOINT = '/api/market/latest';
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TODAY_STRIP_ITEMS = [
    { label: 'KOSPI', group: 'indices', key: 'KOSPI', format: 'index' },
    { label: 'KOSDAQ', group: 'indices', key: 'KOSDAQ', format: 'index' },
    { label: 'USD/KRW', group: 'rates_fx_volatility', key: 'USDKRW', format: 'won' },
    { label: 'US 10Y', group: 'rates_fx_volatility', key: 'US10Y', format: 'rate' },
    { label: 'GOLD', group: 'commodities_crypto', key: 'GOLD', format: 'usd' }
  ];

  function finiteNumber(value){ return typeof value === 'number' && Number.isFinite(value); }
  function isoDate(value){ return ISO_DATE.test(String(value || '')) ? String(value) : ''; }
  function decimal(value, digits){
    return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  }
  function stripDateLabel(value){
    const date = isoDate(value);
    if (!date) return '';
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, day))).toUpperCase();
  }

  // Build the strip from a published Market Close payload. Returns null unless
  // every item resolves, so a changed contract falls back to the static file as
  // a whole instead of mixing two sources into one row.
  function publishedStripItems(payload){
    const items = TODAY_STRIP_ITEMS.map(spec => {
      const quote = payload?.[spec.group]?.[spec.key];
      if (!quote || !finiteNumber(quote.close)) return null;
      const movement = spec.format === 'index' || spec.format === 'usd' ? quote.change_pct : quote.change;
      if (!finiteNumber(movement)) return null;
      const arrow = movement < 0 ? '▼' : '▲';
      const size = Math.abs(movement);
      let value = '';
      let change = '';
      if (spec.format === 'index') {
        value = decimal(quote.close, 2);
        change = `${arrow} ${decimal(size, 2)}%`;
      } else if (spec.format === 'usd') {
        value = `$${decimal(quote.close, 2)}`;
        change = `${arrow} ${decimal(size, 2)}%`;
      } else if (spec.format === 'won') {
        value = decimal(quote.close, 2);
        change = locale === 'en' ? `${arrow} ₩${decimal(size, 1)}` : `${arrow} ${decimal(size, 1)}원`;
      } else {
        value = `${decimal(quote.close, 2)}%`;
        change = `${arrow} ${Math.round(size * 100)}bp`;
      }
      return { label: spec.label, value, change, direction: movement < 0 ? 'down' : 'up' };
    }).filter(Boolean);
    return items.length === TODAY_STRIP_ITEMS.length ? items : null;
  }

  function staticStripItems(summary){
    if (!Array.isArray(summary?.items) || !summary.items.length) return null;
    return summary.items.map(item => ({
      label: item.label,
      value: item.value,
      change: typeof item.change === 'object' && item.change !== null
        ? (item.change[locale] || item.change.ko || item.change.en || '')
        : item.change,
      direction: item.direction === 'down' ? 'down' : 'up'
    }));
  }

  // One session in, one consistent strip out.
  function localeTakeaway(source){
    // Locales are independent: an empty Korean line is never filled with the
    // English one, or the other way round.
    return String(source?.[locale] || '').trim();
  }

  // One session in, one consistent strip out. The published record carries its
  // own one-liner, so a live session never borrows the static file's — that is
  // what would put an older sentence under today's numbers.
  // Only this locale's daily for exactly this session's date. `posts` is
  // already scoped to the locale, so a Korean home never reads an English
  // daily; and the date must match, so yesterday's report never speaks for
  // today's numbers.
  function dailyForDate(marketDate){
    if (!marketDate) return null;
    return posts.find(post => post.type === 'daily' && reportDate(post) === marketDate) || null;
  }
  function postTakeaway(post){
    return String(post?.takeaway || '').replace(/\s+/g, ' ').trim();
  }

  function todayStripSession(payload){
    const summary = window.TODAY_MARKET_SUMMARY;
    const publishedDate = isoDate(payload?.meta?.market_date);
    if (publishedDate) {
      const items = publishedStripItems(payload);
      if (items) {
        const daily = dailyForDate(publishedDate);
        // What the editor typed into /admin/market/ wins, because it exists
        // only when someone chose to override. Otherwise the same session's
        // daily supplies the line by itself, which is the everyday path.
        const override = localeTakeaway(payload?.takeaway);
        return { marketDate: publishedDate, items, takeaway: override || postTakeaway(daily), daily, live: true };
      }
    }
    // Emergency fallback only, and then the whole static record is used: its
    // date, its numbers and its one-liner together, never mixed with the API.
    const staticItems = staticStripItems(summary);
    if (!staticItems) return null;
    const staticDate = isoDate(summary?.marketDate);
    return {
      marketDate: staticDate,
      items: staticItems,
      // The static record's own line and nothing else. With the API down
      // there is no live session to match a daily against, so pulling one
      // in would be the mixing this fallback exists to avoid.
      takeaway: localeTakeaway(summary?.takeaway),
      daily: dailyForDate(staticDate),
      live: false
    };
  }

  function paintTodayStrip(session){
    if (!session) return;
    const dateEl = document.getElementById('today-strip-date');
    const gridEl = document.getElementById('today-market-grid');
    const dateLabel = stripDateLabel(session.marketDate)
      || window.TODAY_MARKET_SUMMARY?.dateDisplay?.[locale]
      || '';
    if (dateEl && dateLabel) dateEl.textContent = dateLabel;
    if (gridEl) {
      gridEl.innerHTML = session.items.map(item => (
        `<div class="today-item" role="listitem"><span class="today-label">${esc(item.label)}</span><span class="today-value">${esc(item.value)}</span><span class="today-change ${item.direction}">${esc(item.change)}</span></div>`
      )).join('');
      gridEl.removeAttribute('aria-busy');
    }
    paintTodayTakeaway(session);
  }

  // The one-liner belongs to the session on screen or it is not shown at all.
  function paintTodayTakeaway(session){
    const marketDate = session?.marketDate || '';
    const rowEl = document.querySelector('.today-takeaway-row');
    const labelEl = document.getElementById('today-takeaway-label');
    const textEl = document.getElementById('today-takeaway-text');
    const linkEl = document.getElementById('today-takeaway-link');
    // The one-liner belongs to the session on screen, so it needs no date
    // comparison: it either came with these numbers or there is none.
    const text = session?.takeaway || '';
    // The daily for this same session; with none, Market Close. A daily
    // published later under this date is picked up on the next load, and it
    // brings its one-liner with it.
    const daily = session?.daily || null;
    // Rewrite the href on every paint, the hidden one included. Leaving the
    // previous session's href in place would keep a link to another day's
    // report one CSS rule away from being clickable.
    if (linkEl) linkEl.href = daily ? rootPath(daily.href) : (locale === 'en' ? '/en/market/' : '/market/');
    if (!text) {
      if (rowEl) rowEl.hidden = true;
      // Clear it as well as hide it, for the same reason the href is always
      // rewritten: a hidden row holding another session's sentence is one
      // stylesheet away from showing it.
      if (textEl) textEl.textContent = '';
      return;
    }
    if (rowEl) rowEl.hidden = false;
    if (labelEl) labelEl.textContent = messages.takeawayLabel;
    if (textEl) textEl.textContent = text;
  }

  function fetchPublishedMarketClose(){
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(MARKET_LATEST_ENDPOINT, { headers: { Accept: 'application/json' } })
      .then(response => (response.ok ? response.json() : null))
      .catch(() => null);
  }

  // The markup ships a neutral placeholder, so there is exactly one paint and it
  // happens after the request settles. Painting the static file first would put
  // a past session on screen for a frame whenever the network was slow, which is
  // the opposite of market-summary.js being a failure-only fallback.
  function renderTodayMarket(){
    if (!document.querySelector('.today-strip')) return;
    return fetchPublishedMarketClose().then(payload => {
      const session = todayStripSession(payload);
      paintTodayStrip(session);
      return session;
    });
  }

  /* Hero Carousel -----------------------------------------------------------
     Two-slide manual editorial carousel on the homepage:
     - Slide 01: Brand Hero (static SSR copy & entries)
     - Slide 02: Latest Daily report (dynamically bound from locale posts)
     Manual controls only (no automatic timers). Supports click, keyboard, and touch swipe.
  -------------------------------------------------------------------------- */
  function initHeroCarousel() {
    const heroSection = document.querySelector('.brand-hero');
    const slide1 = document.getElementById('hero-slide-1');
    const slide2 = document.getElementById('hero-slide-2');
    const prevBtn = document.getElementById('hero-carousel-prev');
    const nextBtn = document.getElementById('hero-carousel-next');
    const counterCurrent = document.getElementById('carousel-current');
    if (!heroSection || !slide1 || !slide2) return null;

    // Find the latest research for this locale
    const latestResearch = posts.find(p => p.type === 'research');

    if (latestResearch) {
      const dateEl = document.getElementById('hero-featured-date');
      const readingEl = document.getElementById('hero-featured-reading');
      const titleLink = document.getElementById('hero-featured-title-link');
      const snippetEl = document.getElementById('hero-featured-snippet');
      const actionBtn = document.getElementById('hero-featured-action-btn');
      const imgLink = document.getElementById('hero-featured-img-link');
      const imgEl = document.getElementById('hero-featured-img');

      const href = rootPath(latestResearch.href);
      const dateStr = reportDate(latestResearch);
      const readingStr = formatReadingTime(latestResearch.readingMinutes, locale);
      const copySnippet = String(latestResearch.summary || latestResearch.subtitle || latestResearch.description || '').trim();

      if (dateEl) dateEl.textContent = dateStr || '—';
      if (readingEl) {
        if (readingStr) {
          readingEl.textContent = readingStr;
          readingEl.hidden = false;
        } else {
          readingEl.hidden = true;
        }
      }
      if (titleLink) {
        titleLink.textContent = latestResearch.title || '';
        titleLink.href = href;
      }
      if (snippetEl) snippetEl.textContent = copySnippet;
      if (actionBtn) actionBtn.href = href;
      if (imgLink) imgLink.href = href;
      if (imgEl) {
        imgEl.src = latestResearch.coverImage ? rootPath(latestResearch.coverImage) : '/assets/social/snowshagal-home.jpg';
        imgEl.alt = latestResearch.title || '';
      }
    } else {
      // If there are no research posts at all, hide slide 2 and controls
      const controls = document.querySelector('.hero-carousel-controls');
      if (controls) controls.hidden = true;
      slide2.hidden = true;
    }

    let activeIndex = 0;

    function goTo(index) {
      activeIndex = Math.max(0, Math.min(1, index));
      if (activeIndex === 0) {
        slide1.classList.add('active');
        slide1.setAttribute('aria-hidden', 'false');
        slide2.classList.remove('active');
        slide2.setAttribute('aria-hidden', 'true');
        if (prevBtn) { prevBtn.disabled = true; prevBtn.setAttribute('aria-disabled', 'true'); }
        if (nextBtn) { nextBtn.disabled = false; nextBtn.setAttribute('aria-disabled', 'false'); }
        if (counterCurrent) counterCurrent.textContent = '01';
      } else {
        slide1.classList.remove('active');
        slide1.setAttribute('aria-hidden', 'true');
        slide2.classList.add('active');
        slide2.setAttribute('aria-hidden', 'false');
        if (prevBtn) { prevBtn.disabled = false; prevBtn.setAttribute('aria-disabled', 'false'); }
        if (nextBtn) { nextBtn.disabled = true; nextBtn.setAttribute('aria-disabled', 'true'); }
        if (counterCurrent) counterCurrent.textContent = '02';
      }
    }

    prevBtn?.addEventListener('click', () => goTo(0));
    nextBtn?.addEventListener('click', () => goTo(1));

    // Keyboard navigation
    heroSection.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        goTo(0);
      } else if (e.key === 'ArrowRight') {
        goTo(1);
      }
    });

    // Touch / swipe for mobile
    let touchStartX = 0;
    let touchStartY = 0;
    heroSection.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0]?.clientX || 0;
      touchStartY = e.touches[0]?.clientY || 0;
    }, { passive: true });

    heroSection.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0]?.clientX || 0;
      const touchEndY = e.changedTouches[0]?.clientY || 0;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) {
        if (deltaX < 0) goTo(1); // Swipe left -> Next
        else goTo(0); // Swipe right -> Prev
      }
    }, { passive: true });

    goTo(0);

    const controller = { goTo, getActiveIndex: () => activeIndex, latestResearch };
    window.__heroCarouselTest = controller;
    return controller;
  }

  populateFilterOptions();
  initHeroCarousel();
  renderTodayMarket();
  renderHighlights();
  renderArchive();
})();
