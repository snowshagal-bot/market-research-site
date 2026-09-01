(() => {
  const lang = document.documentElement.dataset.siteLang === 'en' ? 'en' : 'ko';
  const ko = lang === 'ko';

  const copy = ko ? {
    title: 'DISCLOSURE',
    subtitle: '오늘의 주요 공시',
    countBadge: n => `${n}건`,
    todayBtn: '오늘',
    prevDay: '이전 날짜',
    nextDay: '다음 날짜',
    noDisclosuresTitle: '선별된 주요 공시가 없습니다.',
    noDisclosuresDesc: '선택한 날짜에 게시된 주요 기업 공시가 없습니다.',
    loadingTitle: '공시 데이터를 불러오는 중입니다...',
    errorTitle: '공시 데이터를 불러오지 못했습니다.',
    errorDesc: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    retryBtn: '다시 시도',
    viewAll: n => `오늘의 주요 공시 전체 보기 (${n}건) →`,
    viewLess: '접기 ▴',
    factHeading: '핵심 사실',
    whatItMeans: '무엇을 의미하나',
    watchPoints: '확인할 것',
    aiExplanation: 'AI 시장 해설',
    aiAssistNote: '이해 보조용 해석',
    dartOriginal: 'DART 원문 ↗',
    expandDetails: '해설 보기 ▾',
    collapseDetails: '해설 닫기 ▴',
    weekdays: ['일', '월', '화', '수', '목', '금', '토']
  } : {
    title: 'DISCLOSURE',
    subtitle: 'Today’s Key Filings',
    countBadge: n => `${n} ${n === 1 ? 'filing' : 'filings'}`,
    todayBtn: 'Today',
    prevDay: 'Previous date',
    nextDay: 'Next date',
    noDisclosuresTitle: 'No key disclosures selected.',
    noDisclosuresDesc: 'There are no selected key corporate filings for this date.',
    loadingTitle: 'Loading disclosure filings...',
    errorTitle: 'Could not load disclosures.',
    errorDesc: 'A temporary error occurred. Please try again in a moment.',
    retryBtn: 'Try again',
    viewAll: n => `View all key filings (${n}) →`,
    viewLess: 'Collapse ▴',
    factHeading: 'Key Facts',
    whatItMeans: 'What It Means',
    watchPoints: 'Watch Points',
    aiExplanation: 'AI Market Insight',
    aiAssistNote: 'Reader assistance',
    dartOriginal: 'DART Original ↗',
    expandDetails: 'Details ▾',
    collapseDetails: 'Collapse ▴',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  };

  const state = {
    selectedDate: null,
    todayDate: null,
    feedData: null,
    isExpanded: false,
    loading: false
  };

  const cache = new Map();

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateDisplay(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = copy.weekdays[dateObj.getUTCDay()];
    return ko ? `${y}년 ${m}월 ${d}일 (${dayOfWeek})` : `${dateObj.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d}, ${y} (${dayOfWeek})`;
  }

  function shiftDate(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    dateObj.setUTCDate(dateObj.getUTCDate() + days);
    return dateObj.toISOString().slice(0, 10);
  }

  function parseUrlState() {
    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get('date');
    const allParam = params.get('all');
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      state.selectedDate = dateParam;
    }
    if (allParam === '1' || allParam === 'true') {
      state.isExpanded = true;
    }
  }

  function updateUrlState(replace = false) {
    const url = new URL(window.location.href);
    if (state.selectedDate) {
      url.searchParams.set('date', state.selectedDate);
    } else {
      url.searchParams.delete('date');
    }
    if (state.isExpanded) {
      url.searchParams.set('all', '1');
    } else {
      url.searchParams.delete('all');
    }
    if (replace) {
      window.history.replaceState({}, '', url.toString());
    } else {
      window.history.pushState({}, '', url.toString());
    }
  }

  async function fetchFeed(dateStr, all = false) {
    const key = `${dateStr || 'today'}_${all ? 'all' : 'default'}`;
    if (cache.has(key)) {
      return cache.get(key);
    }
    const params = new URLSearchParams();
    if (dateStr) params.set('date', dateStr);
    if (all) params.set('all', '1');
    const qs = params.toString();
    const url = qs ? `/api/disclosures/feed?${qs}` : '/api/disclosures/feed';

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cache.set(key, data);
    return data;
  }

  async function loadData() {
    const mount = document.getElementById('disclosures-mount');
    const dateDisplay = document.getElementById('disclosures-current-date');
    const countBadge = document.getElementById('disclosures-count-badge');
    const nextBtn = document.getElementById('disclosures-next-btn');

    state.loading = true;
    if (mount) {
      mount.innerHTML = `
        <div class="disclosures-state-box">
          <p>${copy.loadingTitle}</p>
        </div>
      `;
    }

    try {
      const data = await fetchFeed(state.selectedDate, state.isExpanded);
      state.feedData = data;
      state.selectedDate = data.marketDate || state.selectedDate;
      if (!state.todayDate && data.marketDate) {
        state.todayDate = data.marketDate;
      }

      if (dateDisplay) {
        dateDisplay.textContent = formatDateDisplay(state.selectedDate);
      }
      if (countBadge) {
        const total = data.totalPublished || (data.items ? data.items.length : 0);
        countBadge.textContent = copy.countBadge(total);
      }
      if (nextBtn && state.todayDate) {
        nextBtn.disabled = state.selectedDate >= state.todayDate;
      }

      renderFeed(data);
    } catch (err) {
      if (mount) {
        mount.innerHTML = `
          <div class="disclosures-state-box">
            <h3>${copy.errorTitle}</h3>
            <p>${copy.errorDesc}</p>
            <button type="button" class="disclosures-retry-btn" id="disclosures-retry-btn">${copy.retryBtn}</button>
          </div>
        `;
        document.getElementById('disclosures-retry-btn')?.addEventListener('click', loadData);
      }
    } finally {
      state.loading = false;
    }
  }

  function renderFeed(data) {
    const mount = document.getElementById('disclosures-mount');
    if (!mount) return;

    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      mount.innerHTML = `
        <div class="disclosures-state-box">
          <h3>${copy.noDisclosuresTitle}</h3>
          <p>${copy.noDisclosuresDesc}</p>
        </div>
      `;
      return;
    }

    const displayItems = (!state.isExpanded && items.length > 5) ? items.slice(0, 5) : items;

    const cardsHtml = displayItems.map(item => {
      const hasAi = Boolean(item.ai && item.ai.status === 'done');
      const fact = item.fact || item;
      const rceptNo = escapeHtml(item.rceptNo || fact.rceptNo || '');
      const corpName = escapeHtml(fact.corpName || '');
      const stockCode = escapeHtml(fact.stockCode || '');
      const reportName = escapeHtml(fact.reportName || '');
      const isCorrection = Boolean(fact.isCorrection);
      const correctionType = escapeHtml(fact.correctionType || (ko ? '[기재정정]' : '[Correction]'));
      const sourceUrl = escapeHtml(fact.sourceUrl || '');
      const formattedTime = escapeHtml(fact.formattedDate || fact.receiptDate || '');
      const priorityClass = escapeHtml(item.priority || 'low');
      const priorityUpper = escapeHtml((item.priority || 'low').toUpperCase());

      return `
        <article class="disclosure-card priority-${priorityClass}" data-rcept-no="${rceptNo}">
          <div class="disclosure-card-main">
            <div class="disclosure-card-top">
              <div class="disclosure-corp-group">
                <strong class="disclosure-corp-name">${corpName}</strong>
                ${stockCode ? `<span class="disclosure-stock-code">${stockCode}</span>` : ''}
                ${isCorrection ? `<span class="disclosure-correction-tag">${correctionType}</span>` : ''}
                <span class="disclosure-priority-tag tag-${priorityClass}">${priorityUpper}</span>
              </div>
              <time class="disclosure-time">${formattedTime}</time>
            </div>
            <h3 class="disclosure-report-title">${reportName}</h3>
            <div class="disclosure-card-actions">
              <a class="disclosure-dart-btn" href="${sourceUrl}" target="_blank" rel="noopener noreferrer" aria-label="DART 전자공시 원문 열기">
                ${copy.dartOriginal}
              </a>
              ${hasAi ? `
                <button type="button" class="disclosure-toggle-ai-btn" data-toggle-rcept="${rceptNo}" aria-expanded="false">
                  <span>${copy.expandDetails}</span>
                </button>
              ` : ''}
            </div>
          </div>
          ${hasAi ? `
            <div class="disclosure-ai-panel" id="ai-panel-${rceptNo}" hidden>
              <div class="disclosure-fact-box">
                <h4 class="fact-box-title">${copy.factHeading}</h4>
                <p class="fact-official-title">${reportName}</p>
                <div class="fact-meta-row">
                  <span>${corpName}${stockCode ? ` (${stockCode})` : ''}</span>
                  <span>${formattedTime}</span>
                </div>
              </div>
              <div class="disclosure-insight-box">
                <div class="insight-box-header">
                  <h4 class="insight-title">${copy.aiExplanation}</h4>
                  <span class="insight-disclaimer-pill">${copy.aiAssistNote}</span>
                  ${item.ai.impact ? `<span class="impact-badge impact-${escapeHtml(item.ai.impact)}">${escapeHtml(item.ai.impact.toUpperCase())}</span>` : ''}
                </div>
                <div class="insight-content">
                  ${item.ai.summary ? `
                    <div class="insight-summary-block">
                      <p class="insight-summary-text">${escapeHtml(item.ai.summary)}</p>
                    </div>
                  ` : ''}
                  <div class="insight-row">
                    <strong>${copy.whatItMeans}:</strong>
                    <p>${escapeHtml(item.ai.whatItMeans || '')}</p>
                  </div>
                  ${item.ai.watchPoints && item.ai.watchPoints.length ? `
                    <div class="insight-row">
                      <strong>${copy.watchPoints}:</strong>
                      <ul class="watchpoints-list">
                        ${item.ai.watchPoints.map(wp => `<li>${escapeHtml(wp)}</li>`).join('')}
                      </ul>
                    </div>
                  ` : ''}
                </div>
                <p class="insight-limitation">${escapeHtml(item.ai.limitation || '')}</p>
              </div>
            </div>
          ` : ''}
        </article>
      `;
    }).join('');

    const toggleAllHtml = items.length > 5 ? `
      <div class="disclosures-expand-all-wrap">
        <button type="button" class="disclosures-expand-all-btn" id="disclosures-expand-all-btn">
          ${state.isExpanded ? copy.viewLess : copy.viewAll(data.totalPublished || items.length)}
        </button>
      </div>
    ` : '';

    mount.innerHTML = `<div class="disclosures-feed-list">${cardsHtml}</div>${toggleAllHtml}`;
  }

  function bindEvents() {
    document.getElementById('disclosures-prev-btn')?.addEventListener('click', () => {
      if (!state.selectedDate) return;
      state.selectedDate = shiftDate(state.selectedDate, -1);
      updateUrlState();
      loadData();
    });

    document.getElementById('disclosures-next-btn')?.addEventListener('click', () => {
      if (!state.selectedDate) return;
      if (state.todayDate && state.selectedDate >= state.todayDate) return;
      state.selectedDate = shiftDate(state.selectedDate, 1);
      updateUrlState();
      loadData();
    });

    document.getElementById('disclosures-today-btn')?.addEventListener('click', () => {
      state.selectedDate = null;
      updateUrlState();
      loadData();
    });

    const mount = document.getElementById('disclosures-mount');
    mount?.addEventListener('click', async (event) => {
      const toggleAiBtn = event.target.closest('.disclosure-toggle-ai-btn');
      if (toggleAiBtn) {
        const rceptNo = toggleAiBtn.dataset.toggleRcept;
        const panel = document.getElementById(`ai-panel-${rceptNo}`);
        if (panel) {
          const isExpanded = toggleAiBtn.getAttribute('aria-expanded') === 'true';
          toggleAiBtn.setAttribute('aria-expanded', !isExpanded);
          panel.hidden = isExpanded;
          const labelSpan = toggleAiBtn.querySelector('span');
          if (labelSpan) labelSpan.textContent = isExpanded ? copy.expandDetails : copy.collapseDetails;
        }
        return;
      }

      const expandAllBtn = event.target.closest('#disclosures-expand-all-btn');
      if (expandAllBtn) {
        state.isExpanded = !state.isExpanded;
        updateUrlState();
        if (state.isExpanded && state.feedData && (state.feedData.hasMore || (state.feedData.showingCount && state.feedData.totalPublished && state.feedData.showingCount < state.feedData.totalPublished))) {
          try {
            const fullData = await fetchFeed(state.selectedDate, true);
            state.feedData = fullData;
          } catch (_) {}
        }
        renderFeed(state.feedData);
      }
    });

    window.addEventListener('popstate', () => {
      parseUrlState();
      loadData();
    });
  }

  function init() {
    parseUrlState();
    bindEvents();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
