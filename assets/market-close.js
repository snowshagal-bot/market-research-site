(function (root) {
  'use strict';

  const ko = document.documentElement.dataset.siteLang !== 'en';
  const copy = ko ? {
    title: 'MARKET CLOSE', subtitle: '오늘 시장은 어떻게 마감했나', closeBasis: '15:30 KST 마감 기준', updateNotice: '데이터 업데이트 · 매 거래일 16:05 KST', overseas: '* 해외 시장은 각 시장의 최신 거래일 기준',
    todayMode: 'TODAY', historyMode: 'HISTORY', prevDay: '이전 거래일', nextDay: '다음 거래일',
    calendarToggle: '달력으로 날짜 선택', selectDate: '날짜 선택', closeCalendar: '달력 닫기',
    sections: ['주요 지수', '금리 · 환율 · 변동성', '원자재 · 가상자산', '시장 폭', 'KRX 투자자 매매동향 (당일)', '최근 5거래일 누적 수급', '프로그램 & 베이시스', '시장 내부 지표', '공매도 현황', '시가총액 상위 10종목'],
    open: '시가', high: '고가', low: '저가', previous: '전일', close: '종가', current: '현재', fixedClose: '15:30 확정', intraday: '장중', recentClose: '최근 종가', unavailable: '데이터 없음',
    rise: '상승종목', fall: '하락종목', flat: '보합종목', upper: '상한가', lower: '하한가', riseRatio: '상승비율', fallRatio: '하락비율',
    foreign: '외국인', institution: '기관', individual: '개인', market: '시장', fiveDays: '5거래일', billion: '억원',
    arbitrage: '차익', nonArbitrage: '비차익', total: '전체', netBuy: '순매수', spot: 'KOSPI200 현물', future: '선물', basis: '베이시스',
    turnover: '거래대금', previousTurnover: '전일 거래대금', average5: '5일 평균', ratio5: '5일 평균 대비', concentration: '수급 집중도 (상위 비중)', foreignBuy: '외국인 매수', foreignSell: '외국인 매도', institutionBuy: '기관 매수', institutionSell: '기관 매도', top1: 'TOP1', top5: 'TOP5',
    shortSummary: '시장별 공매도', shortValue: '공매도 거래대금 TOP5', shortRatio: '공매도 비중 TOP5', valueRatio: '거래대금 비중', shortAmount: '공매도 거래대금',
    rank: '순위', stock: '종목명', price: '종가', change: '등락률', marketCap: '시가총액', source: '데이터 출처', generated: '생성',
    latestReport: '오늘의 리포트 보기', historyReport: '이날의 데일리 리포트 보기', noDailyReport: '이날 발행된 데일리 리포트가 없습니다.',
    noteTitle: '숫자 너머의 의미를 해석합니다.', noteBody: '시장 전체 흐름과 한국시장 내부 구조를 한눈에 정리하고, 더 깊은 해설은 Snowshagal 리포트에서 이어갑니다.',
    previewFixture: 'PREVIEW FIXTURE · 실제 게시 데이터가 아닙니다.', emptyTitle: '첫 마감 데이터를 준비하고 있습니다.', emptyBody: '데이터가 게시되면 이곳에서 최신 한국 시장 마감을 확인할 수 있습니다.',
    dateNotFoundTitle: '해당 날짜의 Market Close 데이터가 없습니다.', returnToLatest: '최신 시장으로 돌아가기',
    loadError: '마감 데이터를 불러오지 못했습니다.', retry: '다시 시도',
    rangeLoadError: '기간 데이터를 불러오지 못했습니다.',
    recent5Days: '최근 5거래일', recent20Days: '최근 20거래일',
    sectorThemeBuilding: '업종 · 테마 기간 데이터 축적 중',
    sectorThemeBuildingDesc: (used, total) => `현재 ${used} / ${total} 거래일 · KRX 공식 업종·테마는 v1.1.0 스냅샷부터 누적됩니다.`,
    strongest: '상승 상위', weakest: '하락 상위',
    avgRiseRatio: '평균 상승비율', avgFallRatio: '평균 하락비율',
    advancerDominant: '상승 우세', declinerDominant: '하락 우세', neutralDominant: '중립',
    sessionCount: n => `${n}일`,
    avgCounts: (r, f) => `평균 상승 ${r}개 · 하락 ${f}개`,
    weekdays: ['월', '화', '수', '목', '금', '토', '일'],
    monthFormat: (y, m) => `${y}년 ${m}월`,
    disclosureTitle: 'DISCLOSURE · 오늘의 주요 공시',
    disclosureSubtitle: '선별된 주요 기업 공시 및 핵심 해설',
    viewAllDisclosures: n => `오늘의 주요 공시 전체 보기 (${n}건) →`,
    viewLessDisclosures: '접기 ▴',
    noDisclosures: '오늘 시장에 선별된 주요 공시가 없습니다.',
    factHeading: '핵심 사실',
    whatItMeans: '무엇을 의미하나',
    watchPoints: '확인할 것',
    aiExplanation: 'AI 시장 해설',
    aiAssistNote: '이해 보조용 해석',
    dartOriginal: 'DART 원문 ↗',
    expandExplanation: '해설 보기 ▾',
    collapseExplanation: '해설 닫기 ▴'
  } : {
    title: 'MARKET CLOSE', subtitle: 'How did the Korean market close today?', closeBasis: 'Korea close as of 15:30 KST', updateNotice: 'Data updates · Every trading day at 16:05 KST', overseas: '* Overseas markets use each market’s latest trading session.',
    todayMode: 'TODAY', historyMode: 'HISTORY', prevDay: 'Previous session', nextDay: 'Next session',
    calendarToggle: 'Select date from calendar', selectDate: 'Select date', closeCalendar: 'Close calendar',
    sections: ['Major Indices', 'Rates · FX · Volatility', 'Commodities · Crypto', 'Market Breadth', 'KRX Investor Flows (Daily)', 'Cumulative Flows: Last 5 Sessions', 'Program Trading & Basis', 'Market Internals', 'Short Selling', 'Top 10 by Market Cap'],
    open: 'Open', high: 'High', low: 'Low', previous: 'Prev.', close: 'Close', current: 'Latest', fixedClose: '15:30 close', intraday: 'Intraday', recentClose: 'Recent close', unavailable: 'Unavailable',
    rise: 'Advancers', fall: 'Decliners', flat: 'Unchanged', upper: 'Limit up', lower: 'Limit down', riseRatio: 'Advance ratio', fallRatio: 'Decline ratio',
    foreign: 'Foreign', institution: 'Institution', individual: 'Retail', market: 'Market', fiveDays: '5 sessions', billion: 'KRW 100m',
    arbitrage: 'Arbitrage', nonArbitrage: 'Non-arbitrage', total: 'Total', netBuy: 'Net buy', spot: 'KOSPI 200 spot', future: 'Futures', basis: 'Basis',
    turnover: 'Turnover', previousTurnover: 'Previous', average5: '5-session avg.', ratio5: 'vs. 5-session avg.', concentration: 'Flow Concentration (Top Share)', foreignBuy: 'Foreign buy', foreignSell: 'Foreign sell', institutionBuy: 'Institution buy', institutionSell: 'Institution sell', top1: 'TOP1', top5: 'TOP5',
    shortSummary: 'Market Short Selling', shortValue: 'Top 5 by Short Value', shortRatio: 'Top 5 by Short Ratio', valueRatio: 'Value ratio', shortAmount: 'Short value',
    rank: 'Rank', stock: 'Company', price: 'Close', change: 'Change', marketCap: 'Market cap', source: 'Sources', generated: 'Generated',
    latestReport: 'Read today’s report', historyReport: 'Read this day’s Daily report', noDailyReport: 'No Daily report was published for this date.',
    noteTitle: 'We interpret the meaning beyond the numbers.', noteBody: 'See the market’s broad direction and internal Korean-market structure at a glance, then continue with deeper context in Snowshagal reports.',
    previewFixture: 'PREVIEW FIXTURE · Not published market data.', emptyTitle: 'The first market close is being prepared.', emptyBody: 'The latest Korean market close will appear here once it is published.',
    dateNotFoundTitle: 'No market close data for this date.', returnToLatest: 'Return to latest market',
    loadError: 'Could not load the market close.', retry: 'Try again',
    rangeLoadError: 'Could not load the period data.',
    recent5Days: 'Last 5 Sessions', recent20Days: 'Last 20 Sessions',
    sectorThemeBuilding: 'Sector & theme history is building',
    sectorThemeBuildingDesc: (used, total) => `Currently ${used} / ${total} sessions available`,
    strongest: 'STRONGEST', weakest: 'WEAKEST',
    avgRiseRatio: 'Avg. advance ratio', avgFallRatio: 'Avg. decline ratio',
    advancerDominant: 'Advancer dominant', declinerDominant: 'Decliner dominant', neutralDominant: 'Neutral',
    sessionCount: n => `${n} sessions`,
    avgCounts: (r, f) => `Avg ${r} adv · ${f} dec`,
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    monthFormat: (y, m) => {
      const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return `${names[m - 1]} ${y}`;
    },
    disclosureTitle: 'DISCLOSURE · Today’s Key Filings',
    disclosureSubtitle: 'Selected key corporate filings and takeaways',
    viewAllDisclosures: n => `View all key filings (${n}) →`,
    viewLessDisclosures: 'Collapse ▴',
    noDisclosures: 'No key disclosures selected for this session.',
    factHeading: 'Key Facts',
    whatItMeans: 'What It Means',
    watchPoints: 'Watch Points',
    aiExplanation: 'AI Market Insight',
    aiAssistNote: 'Reader assistance',
    dartOriginal: 'DART Original ↗',
    expandExplanation: 'Details ▾',
    collapseExplanation: 'Collapse ▴'
  };

  const names = {
    NASDAQ: 'NASDAQ Composite', DOW: 'Dow Jones', SP500: 'S&P 500', SOX: 'Philadelphia Semiconductor', VIX: 'VIX', US10Y: 'US 10Y', USDKRW: 'USD/KRW', JPYKRW: 'JPY/KRW (100)', DXY: 'Dollar Index', WTI: 'WTI Crude', GOLD: 'Gold', BITCOIN: 'Bitcoin',
    KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', 'KOSPI200선물': 'KOSPI 200 Futures', '기관': 'Institution', '외국인': 'Foreign', '개인': 'Retail', '차익': 'Arbitrage', '비차익': 'Non-arbitrage', '전체': 'Total'
  };

  const KRX_COMPANY_NAMES_EN = {
    '000660': 'SK hynix',
    '005380': 'Hyundai Motor',
    '005930': 'Samsung Electronics',
    '005935': 'Samsung Electronics Pref.',
    '009150': 'Samsung Electro-Mechanics',
    '013890': 'Zinus',
    '028260': 'Samsung C&T',
    '035420': 'NAVER',
    '042700': 'Hanmi Semiconductor',
    '047810': 'Korea Aerospace Industries',
    '095340': 'ISC',
    '095570': 'AJ Networks',
    '105560': 'KB Financial Group',
    '207940': 'Samsung Biologics',
    '373220': 'LG Energy Solution',
    '402340': 'SK Square'
  };

  const html = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  const number = (value, digits = 2) => valid(value) ? new Intl.NumberFormat(ko ? 'ko-KR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : '--';
  const integer = value => valid(value) ? new Intl.NumberFormat(ko ? 'ko-KR' : 'en-US', { maximumFractionDigits: 0 }).format(value) : '--';
  const signClass = value => !valid(value) || value === 0 ? 'neutral' : value > 0 ? 'up' : 'down';
  const signed = (value, digits = 2) => valid(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value), digits)}` : '--';
  const pct = value => valid(value) ? `${signed(value, 2)}%` : '--';
  const ratioPct = value => valid(value) ? `${number(value * 100, 1)}%` : '--';
  const localName = value => ko ? value : (names[value] || value);
  const dateText = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return html(value || '--');
    const [y, m, d] = value.split('-').map(Number);
    return ko ? `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}` : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  const won = value => {
    if (!valid(value)) return '--';
    const abs = Math.abs(value);
    if (ko) {
      if (abs >= 1e12) return `${number(value / 1e12, 2)}조원`;
      if (abs >= 1e8) return `${number(value / 1e8, 0)}억원`;
      return `${integer(value)}원`;
    }
    if (abs >= 1e12) return `KRW ${number(value / 1e12, 2)}tn`;
    if (abs >= 1e9) return `KRW ${number(value / 1e9, 1)}bn`;
    return `KRW ${integer(value)}`;
  };
  const flow = value => {
    if (!valid(value)) return '--';
    const wonValue = value * 1e9;
    const abs = Math.abs(wonValue);
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    if (ko) {
      if (abs >= 1e12) return `${sign}${number(abs / 1e12, 2)}조원`;
      return `${sign}${number(abs / 1e8, 0)}억원`;
    }
    if (abs >= 1e12) return `KRW ${sign}${number(abs / 1e12, 2)}tn`;
    return `KRW ${sign}${number(abs / 1e9, 0)}bn`;
  };
  const companyName = item => {
    const rawName = String(item?.name ?? item?.top_name ?? '').trim();
    const ticker = String(item?.ticker ?? item?.top_ticker ?? '').trim();
    if (ko) return rawName || ticker || '--';
    if (KRX_COMPANY_NAMES_EN[ticker]) return KRX_COMPANY_NAMES_EN[ticker];
    if (rawName && !/[\u3131-\u318e\uac00-\ud7a3]/i.test(rawName)) return rawName;
    return ticker || '--';
  };
  const instrumentName = (key, item) => ko ? (item?.name || key) : (names[key] || key);
  const valueUnit = (key, value) => {
    if (!valid(value)) return '--';
    if (key === 'US10Y') return `${number(value, 3)}%`;
    if (key === 'USDKRW') return ko ? `${number(value, 2)}원` : `₩${number(value, 2)}`;
    if (key === 'JPYKRW') return ko ? `${number(value, 2)}원` : `₩${number(value, 2)}`;
    if (key === 'WTI' || key === 'GOLD' || key === 'BITCOIN') return `$${number(value, key === 'BITCOIN' ? 0 : 2)}`;
    return number(value, 2);
  };
  const displayValue = (key, item) => {
    if (!item || item.data_state === 'unavailable') return null;
    if (key === 'USDKRW' || key === 'JPYKRW' || key === 'KOSPI' || key === 'KOSDAQ') return item.close;
    return item.data_state === 'intraday' && valid(item.current) ? item.current : item.close;
  };
  const stateText = item => {
    if (!item || item.data_state === 'unavailable') return copy.unavailable;
    if (item.data_state === 'intraday') return copy.intraday;
    return copy.recentClose;
  };
  const metric = (label, value, extra = '') => `<div class="market-metric"><span>${html(label)}</span><strong class="${extra}">${value}</strong></div>`;
  const section = (numberValue, title, body, extra = '') => `<section class="market-section ${extra}" aria-labelledby="market-section-${numberValue}"><h2 id="market-section-${numberValue}"><span>${numberValue}.</span> ${html(title)}</h2>${body}</section>`;

  function instrumentCard(key, item, major = false) {
    const display = displayValue(key, item);
    const movement = item?.change;
    const movementClass = signClass(movement);
    const movementArrow = movementClass === 'up' ? '▲' : movementClass === 'down' ? '▼' : '—';
    const isFx = key === 'USDKRW' || key === 'JPYKRW';
    const changeContent = key === 'US10Y'
      ? `${movementArrow} ${valid(movement) ? `${number(Math.abs(movement * 100), 1)}bp` : '--'}`
      : isFx
        ? `${movementArrow} ${valid(movement) ? number(Math.abs(movement), 2) : '--'} <span>(${pct(item?.change_pct)})</span>`
        : `${movementArrow} ${signed(movement, 2)} <span>(${pct(item?.change_pct)})</span>`;
    const fxContext = isFx ? `<div class="instrument-close-label">${copy.fixedClose}</div><div class="instrument-current"><span>${copy.current}</span><strong>${valueUnit(key, item?.current)}</strong></div>` : '';
    const detail = major ? `<dl class="market-ohlc">
      <div><dt>${copy.open}</dt><dd>${number(item?.open, 2)}</dd></div><div><dt>${copy.high}</dt><dd>${number(item?.high, 2)}</dd></div><div><dt>${copy.low}</dt><dd>${number(item?.low, 2)}</dd></div><div><dt>${copy.previous}</dt><dd>${number(item?.previous_close, 2)}</dd></div>
    </dl>` : '';
    return `<article class="instrument-card ${major ? 'major' : ''}">
      <div class="instrument-heading"><span>${html(instrumentName(key, item))}</span>${item?.ticker ? `<small>${html(item.ticker)}</small>` : ''}</div>
      <strong class="instrument-value">${valueUnit(key, display)}</strong>
      ${fxContext}<div class="instrument-change ${movementClass}">${changeContent}</div>
      ${detail}<div class="instrument-state">${dateText(item?.source_date)} · ${stateText(item)}</div>
    </article>`;
  }

  function dataTable(headings, rows, className = '') {
    return `<div class="market-table-wrap"><table class="market-table ${className}"><thead><tr>${headings.map(item => `<th scope="col">${html(item)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function breadthCard(key, item) {
    return `<article class="breadth-card"><h3>${key}</h3><div class="breadth-counts">
      ${metric(copy.rise, integer(item?.rise), 'up')}${metric(copy.fall, integer(item?.fall), 'down')}${metric(copy.flat, integer(item?.flat))}${metric(copy.upper, integer(item?.upper_limit), 'up')}${metric(copy.lower, integer(item?.lower_limit), 'down')}
    </div><div class="breadth-bar" aria-label="${copy.riseRatio} ${ratioPct(item?.rise_ratio)}, ${copy.fallRatio} ${ratioPct(item?.fall_ratio)}"><span class="advance" style="width:${valid(item?.rise_ratio) ? item.rise_ratio * 100 : 0}%"></span><span class="decline" style="width:${valid(item?.fall_ratio) ? item.fall_ratio * 100 : 0}%"></span></div><div class="breadth-ratios"><span class="up">${copy.riseRatio} ${ratioPct(item?.rise_ratio)}</span><span class="down">${copy.fallRatio} ${ratioPct(item?.fall_ratio)}</span></div></article>`;
  }

  /* ==========================================================================
     Market Close History & Period State & Utilities
     ========================================================================== */
  const state = {
    mode: 'today', // 'today' | '1w' | '1m' | 'history'
    dates: [],
    latestDate: null,
    earliestDate: null,
    currentDate: null,
    isLatest: true,
    calendarOpen: false,
    calYear: null,
    calMonth: null,
    currentPayload: null,
    rangeData: null,
    rangeWindow: null,
    popstateBound: false
  };

  function parseUrlState() {
    const searchParams = new URLSearchParams(location.search);
    const dateParam = searchParams.get('date');
    const viewParam = searchParams.get('view');

    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return { mode: 'history', date: dateParam, view: null };
    }
    if (!dateParam && (viewParam === '1w' || viewParam === '1m')) {
      return { mode: viewParam, date: null, view: viewParam };
    }
    return { mode: 'today', date: null, view: null };
  }

  function findExactDaily(marketDate) {
    if (!marketDate) return null;
    const posts = Array.isArray(root.RESEARCH_POSTS) ? root.RESEARCH_POSTS : [];
    const locale = ko ? 'ko' : 'en';
    return posts.find(post => {
      const isDaily = post?.type === 'daily';
      const postDate = String(post?.reportDate || post?.date || '');
      const matchesDate = postDate === marketDate;
      const postLang = post?.lang || 'ko';
      const matchesLang = postLang === locale;
      return isDaily && matchesDate && matchesLang;
    }) || null;
  }

  function updateLanguageLinks(currentSearch = location.search) {
    const localeApi = root.MARKET_LOCALE;
    const links = typeof document?.querySelectorAll === 'function' ? document.querySelectorAll('[data-language-choice]') : [];
    links.forEach(link => {
      const target = link.dataset?.languageChoice;
      if (localeApi?.pageLanguagePath) {
        link.href = localeApi.pageLanguagePath(location.pathname, target, currentSearch);
      }
    });
  }

  function renderHistoryStrip() {
    const currentIndex = state.dates.indexOf(state.currentDate);
    const hasDates = state.dates.length > 0;
    const canGoNext = hasDates && currentIndex > 0;
    const canGoPrev = hasDates && currentIndex !== -1 && currentIndex < state.dates.length - 1;

    const nextDate = canGoNext ? state.dates[currentIndex - 1] : '';
    const prevDate = canGoPrev ? state.dates[currentIndex + 1] : '';

    const isTodayActive = state.mode === 'today' && !state.calendarOpen;
    const is1wActive = state.mode === '1w' && !state.calendarOpen;
    const is1mActive = state.mode === '1m' && !state.calendarOpen;
    const isHistoryActive = state.mode === 'history' || state.calendarOpen;

    let rightNavHtml = '';
    if (state.mode === '1w' || state.mode === '1m') {
      const w = state.rangeWindow;
      const badgeText = w?.start_date && w?.end_date
        ? `${dateText(w.start_date)} — ${dateText(w.end_date)} · ${w.sessions_used || 0}/${w.required_sessions || (state.mode === '1w' ? 5 : 20)}`
        : '';
      rightNavHtml = `<span class="market-range-badge">${badgeText}</span>`;
    } else {
      rightNavHtml = `
        <button class="market-nav-step" type="button" data-market-action="nav-date" data-target-date="${prevDate}" ${!canGoPrev ? 'disabled' : ''} aria-label="${copy.prevDay}">‹</button>
        <span class="market-current-date">${dateText(state.currentDate)}</span>
        <button class="market-nav-step" type="button" data-market-action="nav-date" data-target-date="${nextDate}" ${!canGoNext ? 'disabled' : ''} aria-label="${copy.nextDay}">›</button>
        <button class="market-calendar-toggle ${state.calendarOpen ? 'active' : ''}" type="button" data-market-action="toggle-calendar" aria-label="${copy.calendarToggle}" aria-expanded="${state.calendarOpen}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
        </button>`;
    }

    return `
      <div class="market-history-strip" role="toolbar" aria-label="Market navigation">
        <div class="market-history-modes">
          <button class="market-mode-btn ${isTodayActive ? 'active' : ''}" type="button" data-market-action="today" ${isTodayActive ? 'aria-current="page"' : ''}>${copy.todayMode}</button>
          <span class="market-mode-divider" aria-hidden="true"></span>
          <button class="market-mode-btn ${is1wActive ? 'active' : ''}" type="button" data-market-action="view-1w" ${is1wActive ? 'aria-current="page"' : ''}>1W</button>
          <span class="market-mode-divider" aria-hidden="true"></span>
          <button class="market-mode-btn ${is1mActive ? 'active' : ''}" type="button" data-market-action="view-1m" ${is1mActive ? 'aria-current="page"' : ''}>1M</button>
          <span class="market-mode-divider" aria-hidden="true"></span>
          <button class="market-mode-btn ${isHistoryActive ? 'active' : ''}" type="button" data-market-action="toggle-calendar" aria-expanded="${state.calendarOpen}" ${state.mode === 'history' ? 'aria-current="page"' : ''}>${copy.historyMode}</button>
        </div>
        <div class="market-history-nav">
          ${rightNavHtml}
        </div>
      </div>
      <div id="market-calendar-drawer" class="market-calendar-drawer" ${state.calendarOpen ? '' : 'hidden'}>
        ${renderCalendarPanel()}
      </div>`;
  }

  function renderCalendarPanel() {
    if (!state.calYear || !state.calMonth) {
      const baseDate = state.currentDate || state.latestDate || new Date().toISOString().slice(0, 10);
      const [y, m] = baseDate.split('-').map(Number);
      state.calYear = y;
      state.calMonth = m;
    }

    const year = state.calYear;
    const month = state.calMonth; // 1-12

    const firstDayIndex = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const startOffset = (firstDayIndex + 6) % 7;

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const daysInPrevMonth = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();

    const dateSet = new Set(state.dates);
    const dayCells = [];

    // Prev month padding
    for (let i = startOffset - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      dayCells.push(`<span class="market-cal-day other-month" aria-hidden="true">${d}</span>`);
    }

    // Current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const hasData = dateSet.has(dateStr);
      const isSelected = dateStr === state.currentDate;

      if (hasData) {
        dayCells.push(`
          <button class="market-cal-day has-data ${isSelected ? 'selected' : ''}" type="button" data-market-action="select-date" data-target-date="${dateStr}" ${isSelected ? 'aria-current="date"' : ''}>
            <span class="day-num">${d}</span>
            <span class="market-cal-dot" aria-hidden="true"></span>
          </button>`);
      } else {
        dayCells.push(`
          <span class="market-cal-day disabled">
            <span class="day-num">${d}</span>
          </span>`);
      }
    }

    const totalCells = dayCells.length;
    const remainder = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remainder; d++) {
      dayCells.push(`<span class="market-cal-day other-month" aria-hidden="true">${d}</span>`);
    }

    return `
      <div class="market-calendar-panel" role="region" aria-label="${copy.selectDate}">
        <div class="market-cal-header">
          <button class="market-cal-nav-btn" type="button" data-market-action="prev-month" aria-label="Previous month">‹</button>
          <span class="market-cal-month-label">${copy.monthFormat(year, month)}</span>
          <button class="market-cal-nav-btn" type="button" data-market-action="next-month" aria-label="Next month">›</button>
        </div>
        <div class="market-cal-grid">
          ${copy.weekdays.map(w => `<span class="market-cal-weekday" aria-hidden="true">${w}</span>`).join('')}
          ${dayCells.join('')}
        </div>
      </div>`;
  }

  /* ==========================================================================
     TODAY & HISTORY Daily Snapshot Renderer
     ========================================================================== */
  function render(data, target = document.getElementById('market-close-root')) {
    if (!target || !data || typeof data !== 'object') return;

    state.currentPayload = data;
    const marketDate = data.meta?.market_date || state.currentDate;
    const isHistory = (state.mode === 'history' || (marketDate && state.latestDate && marketDate !== state.latestDate)) && (!state.isLatest || (state.latestDate && marketDate !== state.latestDate));

    const indices = data.indices || {};
    const rates = data.rates_fx_volatility || {};
    const commodities = data.commodities_crypto || {};
    const flows = data.krx_investor_trading || {};
    const recentFlows = data.recent_5d_flows || {};
    const breadth = data.market_breadth || {};
    const program = data.program_basis || {};
    const internals = data.market_internals || {};
    const shorts = data.short_selling || {};
    const marketCap = data.market_cap_top10 || [];

    const sourceSet = new Set();
    const collect = obj => {
      Object.values(obj || {}).forEach(item => {
        if (item?.source) sourceSet.add(item.source);
      });
    };
    collect(indices); collect(rates); collect(commodities);

    const investorRows = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(marketKey => {
      const marketName = marketKey === 'KOSPI200선물' ? (ko ? '선물' : 'KOSPI 200 Futures') : marketKey;
      const inv = flows.markets?.[marketKey]?.investors || {};
      return [marketName, flow(inv['외국인']?.net_buy), flow(inv['기관']?.net_buy), flow(inv['개인']?.net_buy)];
    });

    const fiveRows = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(marketKey => {
      const marketName = marketKey === 'KOSPI200선물' ? (ko ? '선물' : 'KOSPI 200 Futures') : marketKey;
      const inv = recentFlows.markets?.[marketKey] || {};
      return [marketName, flow(inv['외국인']), flow(inv['기관']), flow(inv['개인'])];
    });

    const programRows = ['차익', '비차익', '전체'].map(key => [
      localName(key),
      valid(program.program_trading?.[key]?.net_buy_won) ? `${won(program.program_trading[key].net_buy_won)}` : '--'
    ]);

    const concentration = internals.concentration || {};
    const concentrationItems = [
      [copy.foreignBuy, concentration['외국인']?.buy],
      [copy.foreignSell, concentration['외국인']?.sell],
      [copy.institutionBuy, concentration['기관']?.buy],
      [copy.institutionSell, concentration['기관']?.sell]
    ].filter(entry => entry[1]);

    const shortList = (items, isRatio = false) => `<ol class="rank-list">${(items || []).map((item, index) => `<li><span>${index + 1}. <b>${html(companyName(item))}</b><small>${html(item?.market || '')}</small></span><strong>${isRatio ? ratioPct(item?.short_value_ratio) : won(item?.short_value_won)}</strong></li>`).join('')}</ol>`;

    const marketCapRows = marketCap.map(item => [
      item?.rank ?? '--',
      `<span class="stock-name"><b>${html(companyName(item))}</b><small>${html(item?.market || '')} · ${html(item?.ticker || '')}</small></span>`,
      valid(item?.close) ? `${number(item.close, 0)}${ko ? '원' : ''}` : '--',
      `<span class="${signClass(item?.change_pct)}">${pct(item?.change_pct)}</span>`,
      won(item?.market_cap_won)
    ]);

    // Exact Daily Report CTA matching
    let reportCtaHtml = '';
    const exactDaily = findExactDaily(marketDate);

    if (exactDaily) {
      const ctaLabel = isHistory ? copy.historyReport : copy.latestReport;
      const cleanHref = exactDaily.href ? exactDaily.href : '#';
      reportCtaHtml = `
        <a class="market-report-cta" href="${html(cleanHref)}">
          <span>${html(ctaLabel)}</span>
          <span class="cta-date-badge" aria-hidden="true">${dateText(exactDaily.reportDate || exactDaily.date)}</span>
          <span aria-hidden="true">→</span>
        </a>`;
    } else if (isHistory) {
      reportCtaHtml = `<p class="market-report-unavailable">${copy.noDailyReport}</p>`;
    }

    const output = `
      <section class="market-hero" aria-labelledby="market-close-heading"><div class="market-wrap market-hero-inner"><div class="market-hero-copy">
        <p class="market-eyebrow">SNOWSHAGAL</p><h1 id="market-close-heading">${copy.title}</h1><p class="market-subtitle">${copy.subtitle}</p>
        <p class="market-date">${dateText(data.meta?.market_date)} · ${copy.closeBasis}</p>
        <p class="market-update">${copy.updateNotice}</p>
        <p class="market-overseas">${copy.overseas}</p>
      </div><div class="market-mountain" aria-hidden="true"></div></div></section>
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div id="market-dashboard-view" class="market-wrap market-dashboard">
        ${section(1, copy.sections[0], `<div class="major-index-grid">${['KOSPI', 'KOSDAQ', 'NASDAQ', 'DOW', 'SP500'].map(key => instrumentCard(key, indices[key], true)).join('')}</div>`)}
        <div class="market-pair">
          ${section(2, copy.sections[1], `<div class="mini-instrument-grid">${['SOX', 'VIX', 'US10Y', 'USDKRW', 'JPYKRW', 'DXY'].map(key => instrumentCard(key, rates[key])).join('')}</div>`)}
          ${section(3, copy.sections[2], `<div class="mini-instrument-grid commodity-grid">${['WTI', 'GOLD', 'BITCOIN'].map(key => instrumentCard(key, commodities[key])).join('')}</div>`)}
        </div>
        ${section(4, copy.sections[3], `<div class="breadth-grid">${['KOSPI', 'KOSDAQ'].map(key => breadthCard(key, breadth[key])).join('')}</div>`)}
        <div class="market-pair market-pair-tables">
          ${section(5, copy.sections[4], dataTable([copy.market, copy.foreign, copy.institution, copy.individual], investorRows))}
          ${section(6, copy.sections[5], `${dataTable([copy.market, copy.foreign, copy.institution, copy.individual], fiveRows)}<p class="unit-note">${dateText(data.recent_5d_flows?.start_date)} – ${dateText(data.recent_5d_flows?.end_date)}</p>`)}
        </div>
        <div class="market-trio">
          ${section(7, copy.sections[6], `<div class="program-grid"><div><h3>${ko ? '프로그램 매매' : 'Program trading'}</h3>${dataTable(['', copy.netBuy], programRows, 'compact')}</div><div class="basis-panel">${metric(copy.spot, number(program.basis?.kospi200_spot, 2))}${metric(program.basis?.future_name || copy.future, number(program.basis?.future, 2))}${metric(copy.basis, signed(program.basis?.basis, 2), signClass(program.basis?.basis))}<span class="state-chip">${html(program.basis?.market_state || '--')}</span></div></div>`)}
          ${section(8, copy.sections[7], `<div class="turnover-grid">${['KOSPI', 'KOSDAQ'].map(key => `<article><h3>${key}</h3>${metric(copy.turnover, won(internals.turnover?.[key]?.value_won))}${metric(copy.average5, won(internals.turnover?.[key]?.average5_value_won))}${metric(copy.ratio5, valid(internals.turnover?.[key]?.ratio5) ? `${number(internals.turnover[key].ratio5, 2)}×` : '--')}</article>`).join('')}</div><h3 class="subsection-title">${copy.concentration}</h3><div class="concentration-grid">${concentrationItems.map(([label, item]) => `<div><span>${label}</span><b>${copy.top1} ${ratioPct(item?.top1_ratio)} · ${copy.top5} ${ratioPct(item?.top5_ratio)}</b><small>${html(companyName(item))}</small></div>`).join('')}</div>`)}
          ${section(9, copy.sections[8], `<div class="short-summary">${['KOSPI', 'KOSDAQ'].map(key => `<article><h3>${key}</h3>${metric(copy.shortAmount, won(shorts.market_summary?.[key]?.short_value_won))}${metric(copy.valueRatio, ratioPct(shorts.market_summary?.[key]?.short_value_ratio))}</article>`).join('')}</div><div class="short-ranks"><div><h3>${copy.shortValue}</h3>${shortList(shorts.top5_by_value)}</div><div><h3>${copy.shortRatio}</h3>${shortList(shorts.top5_by_ratio, true)}</div></div>`)}
        </div>
        <div class="market-bottom-grid">
          ${section(10, copy.sections[9], dataTable([copy.rank, copy.stock, copy.price, copy.change, copy.marketCap], marketCapRows, 'market-cap-table'))}
          <aside class="market-note"><span class="note-quote" aria-hidden="true">“</span><h2>${copy.noteTitle}</h2><p>${copy.noteBody}</p>${reportCtaHtml}</aside>
        </div>
        ${ko ? `
        <section id="market-disclosures-section" class="market-section market-disclosures-section" aria-label="${copy.disclosureTitle}">
          <div class="market-disclosure-header">
            <h2><span>11</span> ${copy.disclosureTitle}</h2>
            <span id="market-disclosure-count" class="disclosure-header-badge"></span>
          </div>
          <p class="market-disclosure-sub">${copy.disclosureSubtitle}</p>
          <div id="market-disclosures-mount" class="market-disclosures-mount" role="region" aria-live="polite">
            <div class="disclosure-loading-state"><p>주요 공시를 불러오는 중입니다...</p></div>
          </div>
        </section>
        ` : ''}
        <div class="market-data-note"><p>${copy.source}: ${html(Array.from(sourceSet).map(item => item.split(' · ')[0]).filter((item, index, all) => all.indexOf(item) === index).join(', '))}</p><p>${copy.generated}: ${html(data.meta?.generated_at || '--')} · ${html(data.meta?.schema_version || '')}</p></div>
      </div>`;
    target.innerHTML = output;
    bindEvents(target);
    if (ko && typeof target?.querySelector === 'function') {
      loadAndRenderDisclosures(marketDate, target.querySelector('#market-disclosures-mount'));
    }
  }

  const disclosureCache = new Map();
  let disclosuresExpanded = false;

  async function loadAndRenderDisclosures(date, mountContainer) {
    if (!mountContainer) return;
    try {
      let data = disclosureCache.get(date);
      if (!data) {
        const url = date ? `/api/disclosures/feed?date=${encodeURIComponent(date)}` : '/api/disclosures/feed';
        const res = await fetch(url);
        if (res.ok) {
          data = await res.json();
          disclosureCache.set(date, data);
        }
      }
      renderDisclosuresMount(mountContainer, data, disclosuresExpanded);
    } catch (_) {
      mountContainer.innerHTML = `<div class="disclosure-empty-state"><p>${copy.noDisclosures}</p></div>`;
    }
  }

  function renderDisclosuresMount(container, feed, isExpanded) {
    if (!container) return;
    const items = feed?.items || [];
    const countBadge = document.getElementById('market-disclosure-count');
    if (countBadge) countBadge.textContent = `${feed?.totalPublished || items.length}`;

    if (!items.length) {
      container.innerHTML = `<div class="disclosure-empty-state"><p>${copy.noDisclosures}</p></div>`;
      return;
    }

    const displayItems = (!isExpanded && items.length > 5) ? items.slice(0, 5) : items;

    const cardsHtml = displayItems.map(item => {
      const hasAi = Boolean(item.ai && item.ai.status === 'done');
      const fact = item.fact || item;
      const rceptNo = html(item.rceptNo || fact.rceptNo || '');
      const corpName = html(fact.corpName || '');
      const stockCode = html(fact.stockCode || '');
      const reportName = html(fact.reportName || '');
      const isCorrection = Boolean(fact.isCorrection);
      const correctionType = html(fact.correctionType || (ko ? '[기재정정]' : '[Correction]'));
      const sourceUrl = html(fact.sourceUrl || '');
      const formattedTime = html(fact.formattedDate || fact.receiptDate || '');
      const priorityClass = html(item.priority || 'low');
      const priorityUpper = html((item.priority || 'low').toUpperCase());

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
                  <span>${copy.expandExplanation}</span>
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
                  ${item.ai.impact ? `<span class="impact-badge impact-${html(item.ai.impact)}">${html(item.ai.impact.toUpperCase())}</span>` : ''}
                </div>
                <div class="insight-content">
                  ${item.ai.summary ? `
                    <div class="insight-summary-block">
                      <p class="insight-summary-text">${html(item.ai.summary)}</p>
                    </div>
                  ` : ''}
                  <div class="insight-row">
                    <strong>${copy.whatItMeans}:</strong>
                    <p>${html(item.ai.whatItMeans || '')}</p>
                  </div>
                  ${item.ai.watchPoints && item.ai.watchPoints.length ? `
                    <div class="insight-row">
                      <strong>${copy.watchPoints}:</strong>
                      <ul class="watchpoints-list">
                        ${item.ai.watchPoints.map(wp => `<li>${html(wp)}</li>`).join('')}
                      </ul>
                    </div>
                  ` : ''}
                </div>
                <p class="insight-limitation">${html(item.ai.limitation || '')}</p>
              </div>
            </div>
          ` : ''}
        </article>
      `;
    }).join('');

    const toggleAllHtml = items.length > 5 ? `
      <div class="disclosure-expand-all-wrap">
        <button type="button" class="disclosure-expand-all-btn">
          ${isExpanded ? copy.viewLessDisclosures : copy.viewAllDisclosures(feed.totalPublished || items.length)}
        </button>
      </div>
    ` : '';

    container.innerHTML = `<div class="disclosure-feed-list">${cardsHtml}</div>${toggleAllHtml}`;
  }

  /* ==========================================================================
     1W & 1M Range Aggregation Renderer
     ========================================================================== */
  function renderRangeInstrumentRow(key, item) {
    if (!item) return '';
    const name = instrumentName(key, item);
    const baseline = valid(item.baseline_value) ? number(item.baseline_value, 2) : '--';
    const end = valid(item.end_value) ? number(item.end_value, 2) : '--';
    const returnStr = valid(item.return_pct) ? `${signed(item.return_pct, 2)}%` : '--';
    const returnCls = signClass(item.return_pct);
    const highLow = (valid(item.period_high) && valid(item.period_low))
      ? `<span class="range-hl">H ${number(item.period_high, 2)} · L ${number(item.period_low, 2)}</span>`
      : '';

    return `
      <div class="range-item-row">
        <div class="range-item-name">
          <strong>${html(name)}</strong>
          ${highLow}
        </div>
        <div class="range-item-values">
          <span class="range-path">${baseline} <span class="range-arrow">→</span> ${end}</span>
          <strong class="range-return ${returnCls}">${returnStr}</strong>
        </div>
      </div>`;
  }

  function renderRangeRatesFxRow(key, item) {
    if (!item) return '';
    const name = instrumentName(key, item);
    const isUs10y = key === 'US10Y';
    const isFx = key === 'USDKRW' || key === 'JPYKRW';

    let baseline = valid(item.baseline_value) ? number(item.baseline_value, isUs10y ? 3 : 2) : '--';
    let end = valid(item.end_value) ? number(item.end_value, isUs10y ? 3 : 2) : '--';
    if (isUs10y && valid(item.baseline_value)) baseline += '%';
    if (isUs10y && valid(item.end_value)) end += '%';

    let mainChange = '';
    let subChange = '';
    let returnCls = 'neutral';

    if (isUs10y) {
      mainChange = valid(item.change_bp) ? `${signed(item.change_bp, 1)}bp` : '--';
      subChange = valid(item.return_pct) ? `(${signed(item.return_pct, 2)}%)` : '';
      returnCls = signClass(item.change_bp);
    } else if (isFx) {
      mainChange = valid(item.change) ? signed(item.change, 2) : '--';
      subChange = valid(item.return_pct) ? `(${signed(item.return_pct, 2)}%)` : '';
      returnCls = signClass(item.change);
    } else {
      mainChange = valid(item.return_pct) ? `${signed(item.return_pct, 2)}%` : '--';
      returnCls = signClass(item.return_pct);
    }

    return `
      <div class="range-item-row">
        <div class="range-item-name">
          <strong>${html(name)}</strong>
        </div>
        <div class="range-item-values">
          <span class="range-path">${baseline} <span class="range-arrow">→</span> ${end}</span>
          <div class="range-change-wrap">
            <strong class="range-return ${returnCls}">${mainChange}</strong>
            ${subChange ? `<span class="range-sub-change ${returnCls}">${subChange}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  function renderRangeFlows(flows) {
    const markets = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'];
    const headings = [copy.market, copy.foreign, copy.institution, copy.individual];
    const sessionsUsed = flows?.sessions_used;
    const rows = markets.map(mKey => {
      const mName = mKey === 'KOSPI200선물' ? (ko ? '선물' : 'KOSPI 200 Futures') : mKey;
      const mData = flows?.markets?.[mKey] || {};
      const cells = ['외국인', '기관', '개인'].map(invKey => {
        const invData = mData[invKey];
        if (!invData || !valid(invData.net_buy) || (valid(sessionsUsed) && invData.observations < sessionsUsed)) {
          return '--';
        }
        return `<span class="${signClass(invData.net_buy)}">${flow(invData.net_buy)}</span>`;
      });
      return [mName, ...cells];
    });

    return `
      <div class="market-table-wrap">
        <table class="market-table">
          <thead>
            <tr>${headings.map(h => `<th scope="col">${html(h)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.map(row => `<tr>${row.map((cell, idx) => idx === 0 ? `<th scope="row">${html(cell)}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="unit-note">${ko ? '단위: 원화 · 기간 누적' : 'Unit: KRW · Cumulative'}</p>`;
  }

  function renderRangeBreadthCard(marketKey, bData) {
    if (!bData) return '';
    const advPct = valid(bData.avg_rise_ratio) ? ratioPct(bData.avg_rise_ratio) : '--';
    const decPct = valid(bData.avg_fall_ratio) ? ratioPct(bData.avg_fall_ratio) : '--';
    const advSessions = valid(bData.advancer_dominant_sessions) ? copy.sessionCount(bData.advancer_dominant_sessions) : '--';
    const decSessions = valid(bData.decliner_dominant_sessions) ? copy.sessionCount(bData.decliner_dominant_sessions) : '--';
    const neutralSessions = valid(bData.neutral_sessions) ? copy.sessionCount(bData.neutral_sessions) : '--';
    const countsNote = (valid(bData.avg_rise_count) && valid(bData.avg_fall_count))
      ? copy.avgCounts(integer(bData.avg_rise_count), integer(bData.avg_fall_count))
      : '';

    return `
      <article class="breadth-card">
        <h3>${marketKey}</h3>
        <div class="range-breadth-stats">
          <div class="market-metric"><span>${copy.avgRiseRatio}</span><strong class="up">${advPct}</strong></div>
          <div class="market-metric"><span>${copy.avgFallRatio}</span><strong class="down">${decPct}</strong></div>
          <div class="market-metric"><span>${copy.advancerDominant}</span><strong>${advSessions}</strong></div>
          <div class="market-metric"><span>${copy.declinerDominant}</span><strong>${decSessions}</strong></div>
          <div class="market-metric"><span>${copy.neutralDominant}</span><strong>${neutralSessions}</strong></div>
        </div>
        <div class="breadth-bar" aria-hidden="true">
          <span class="advance" style="width:${valid(bData.avg_rise_ratio) ? bData.avg_rise_ratio * 100 : 0}%"></span>
          <span class="decline" style="width:${valid(bData.avg_fall_ratio) ? bData.avg_fall_ratio * 100 : 0}%"></span>
        </div>
        ${countsNote ? `<p class="range-breadth-sub">${html(countsNote)}</p>` : ''}
      </article>`;
  }

  function renderRangeGroups(groups, windowData) {
    if (!groups?.coverage_complete) {
      const sData = groups?.sessions_with_data || 0;
      const req = windowData?.required_sessions || 5;
      return `
        <div class="market-group-empty">
          <p class="group-empty-title">${copy.sectorThemeBuilding}</p>
          <p class="group-empty-desc">${copy.sectorThemeBuildingDesc(sData, req)}</p>
        </div>`;
    }

    function renderRankList(title, items, type) {
      return `
        <div class="range-rank-block">
          <h4 class="range-rank-title ${type}">${title}</h4>
          <ul class="rank-list">
            ${items.map(it => `
              <li>
                <span>
                  <b>${html(it.name)}</b>
                  ${it.market ? `<small>${html(it.market)}</small>` : ''}
                </span>
                <strong class="${signClass(it.return_pct)}">${signed(it.return_pct, 2)}%</strong>
              </li>`).join('')}
          </ul>
        </div>`;
    }

    const validSectors = (groups.sectors || []).filter(s => s.complete && valid(s.return_pct));
    validSectors.sort((a, b) => b.return_pct - a.return_pct);
    const topSectors = validSectors.slice(0, 5);
    const bottomSectors = validSectors.length >= 10
      ? validSectors.slice(-5).reverse()
      : validSectors.slice(5).reverse();

    const validThemes = (groups.themes || []).filter(t => t.complete && valid(t.return_pct));
    validThemes.sort((a, b) => b.return_pct - a.return_pct);
    const topThemes = validThemes.slice(0, 5);
    const bottomThemes = validThemes.length >= 10
      ? validThemes.slice(-5).reverse()
      : validThemes.slice(5).reverse();

    return `
      <div class="range-groups-grid">
        <div class="range-group-col">
          <h3 class="group-category-title">${ko ? '업종 (SECTORS)' : 'SECTORS'}</h3>
          <div class="range-rank-pair">
            ${renderRankList(copy.strongest, topSectors, 'up')}
            ${renderRankList(copy.weakest, bottomSectors, 'down')}
          </div>
        </div>
        <div class="range-group-col">
          <h3 class="group-category-title">${ko ? '테마 (THEMES)' : 'THEMES'}</h3>
          <div class="range-rank-pair">
            ${renderRankList(copy.strongest, topThemes, 'up')}
            ${renderRankList(copy.weakest, bottomThemes, 'down')}
          </div>
        </div>
      </div>`;
  }

  function renderRangeView(data, period, target = document.getElementById('market-close-root')) {
    if (!target || !data || typeof data !== 'object') return;

    state.rangeData = data;
    state.rangeWindow = data.window || null;

    const pTitle = period === '1w' ? copy.recent5Days : copy.recent20Days;
    const w = data.window || {};
    const dateRangeStr = w.start_date && w.end_date ? `${dateText(w.start_date)} — ${dateText(w.end_date)}` : '';
    const statusNote = w.complete
      ? (ko ? `${w.required_sessions}거래일 기준` : `${w.required_sessions}-session window`)
      : (ko ? `현재 누적 · ${w.sessions_used || 0} / ${w.required_sessions || (period === '1w' ? 5 : 20)} 거래일` : `Partial · ${w.sessions_used || 0} / ${w.required_sessions || (period === '1w' ? 5 : 20)} sessions`);

    const indices = data.instruments?.indices || {};
    const rates = data.instruments?.rates_fx_volatility || {};
    const commodities = data.instruments?.commodities_crypto || {};

    const output = `
      <section class="market-hero" aria-labelledby="market-range-heading"><div class="market-wrap market-hero-inner"><div class="market-hero-copy">
        <p class="market-eyebrow">SNOWSHAGAL</p><h1 id="market-range-heading">${html(pTitle)}</h1><p class="market-subtitle">${dateRangeStr}</p>
        <p class="market-date">${html(statusNote)}</p>
        <p class="market-update">${copy.updateNotice}</p>
      </div><div class="market-mountain" aria-hidden="true"></div></div></section>
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div id="market-dashboard-view" class="market-wrap market-dashboard market-range-dashboard">
        ${section('01', ko ? '주요 지수' : 'Major Indices', `
          <div class="range-items-grid">
            ${['KOSPI', 'KOSDAQ', 'NASDAQ', 'SP500', 'SOX'].map(k => k === 'SOX' ? renderRangeInstrumentRow(k, rates[k]) : renderRangeInstrumentRow(k, indices[k])).join('')}
          </div>`)}
        <div class="market-pair">
          ${section('02', ko ? '금리 · 환율 · 변동성' : 'Rates · FX · Volatility', `
            <div class="range-items-grid">
              ${['US10Y', 'USDKRW', 'JPYKRW', 'DXY', 'VIX'].map(k => renderRangeRatesFxRow(k, rates[k])).join('')}
            </div>`)}
          ${section('03', ko ? '자산별 성과' : 'Cross Asset Performance', `
            <div class="range-items-grid">
              ${['WTI', 'GOLD', 'BITCOIN'].map(k => renderRangeInstrumentRow(k, commodities[k])).join('')}
            </div>`)}
        </div>
        <div class="market-pair market-pair-tables">
          ${section('04', ko ? '투자자 누적 수급' : 'Cumulative Investor Flows', renderRangeFlows(data.flows))}
          ${section('05', ko ? '시장 폭 (평균)' : 'Market Breadth', `
            <div class="breadth-grid">
              ${['KOSPI', 'KOSDAQ'].map(k => renderRangeBreadthCard(k, data.breadth?.[k])).join('')}
            </div>`)}
        </div>
        ${section('06', ko ? 'KRX 업종 · 테마' : 'KRX Sectors & Themes', renderRangeGroups(data.krx_groups, data.window))}
      </div>`;

    target.innerHTML = output;
    bindEvents(target);
  }

  function bindEvents(container) {
    if (typeof container?.addEventListener === 'function') {
      container.removeEventListener?.('click', onContainerClick);
      container.addEventListener('click', onContainerClick);
    }
  }

  async function onContainerClick(event) {
    const toggleAiBtn = event.target.closest('.disclosure-toggle-ai-btn');
    if (toggleAiBtn) {
      const rceptNo = toggleAiBtn.dataset.toggleRcept;
      const panel = document.getElementById(`ai-panel-${rceptNo}`);
      if (panel) {
        const isExpanded = toggleAiBtn.getAttribute('aria-expanded') === 'true';
        toggleAiBtn.setAttribute('aria-expanded', !isExpanded);
        panel.hidden = isExpanded;
        const labelSpan = toggleAiBtn.querySelector('span');
        if (labelSpan) labelSpan.textContent = isExpanded ? copy.expandExplanation : copy.collapseExplanation;
      }
      return;
    }

    const expandAllBtn = event.target.closest('.disclosure-expand-all-btn');
    if (expandAllBtn) {
      disclosuresExpanded = !disclosuresExpanded;
      const mount = document.getElementById('market-disclosures-mount');
      const marketDate = state.currentPayload?.meta?.market_date || state.currentDate;
      let feedData = disclosureCache.get(marketDate);
      if (disclosuresExpanded && feedData && (feedData.hasMore || (feedData.showingCount && feedData.totalPublished && feedData.showingCount < feedData.totalPublished))) {
        try {
          const url = marketDate ? `/api/disclosures/feed?date=${encodeURIComponent(marketDate)}&all=1` : '/api/disclosures/feed?all=1';
          const res = await fetch(url);
          if (res.ok) {
            feedData = await res.json();
            disclosureCache.set(marketDate, feedData);
          }
        } catch (_) {}
      }
      if (mount && feedData) {
        renderDisclosuresMount(mount, feedData, disclosuresExpanded);
      }
      return;
    }

    const button = event.target.closest('[data-market-action]');
    if (!button) return;

    const action = button.dataset.marketAction;

    if (action === 'today') {
      state.calendarOpen = false;
      navigateToMode('today');
    } else if (action === 'view-1w') {
      state.calendarOpen = false;
      navigateToMode('1w');
    } else if (action === 'view-1m') {
      state.calendarOpen = false;
      navigateToMode('1m');
    } else if (action === 'toggle-calendar') {
      state.calendarOpen = !state.calendarOpen;
      const drawer = document.getElementById('market-calendar-drawer');
      if (drawer) {
        drawer.hidden = !state.calendarOpen;
        drawer.innerHTML = renderCalendarPanel();
      }
      const modes = document.querySelectorAll('.market-history-modes .market-mode-btn');
      if (modes[0]) modes[0].classList.toggle('active', state.mode === 'today' && !state.calendarOpen);
      if (modes[1]) modes[1].classList.toggle('active', state.mode === '1w' && !state.calendarOpen);
      if (modes[2]) modes[2].classList.toggle('active', state.mode === '1m' && !state.calendarOpen);
      if (modes[3]) {
        modes[3].classList.toggle('active', state.mode === 'history' || state.calendarOpen);
        modes[3].setAttribute('aria-expanded', String(state.calendarOpen));
      }
      const toggleBtn = document.querySelector('.market-calendar-toggle');
      if (toggleBtn) {
        toggleBtn.classList.toggle('active', state.calendarOpen);
        toggleBtn.setAttribute('aria-expanded', String(state.calendarOpen));
      }
    } else if (action === 'prev-month') {
      if (state.calMonth === 1) {
        state.calYear -= 1;
        state.calMonth = 12;
      } else {
        state.calMonth -= 1;
      }
      const drawer = document.getElementById('market-calendar-drawer');
      if (drawer) drawer.innerHTML = renderCalendarPanel();
    } else if (action === 'next-month') {
      if (state.calMonth === 12) {
        state.calYear += 1;
        state.calMonth = 1;
      } else {
        state.calMonth += 1;
      }
      const drawer = document.getElementById('market-calendar-drawer');
      if (drawer) drawer.innerHTML = renderCalendarPanel();
    } else if (action === 'select-date' || action === 'nav-date') {
      const targetDate = button.dataset.targetDate;
      if (targetDate) {
        state.calendarOpen = false;
        navigateToMode('history', targetDate);
      }
    } else if (action === 'retry') {
      init();
    }
  }

  async function navigateToMode(mode, targetDate = null, replaceState = false) {
    let nextSearch = '';
    if (mode === 'history' && targetDate) {
      nextSearch = `?date=${encodeURIComponent(targetDate)}`;
    } else if (mode === '1w') {
      nextSearch = '?view=1w';
    } else if (mode === '1m') {
      nextSearch = '?view=1m';
    } else {
      nextSearch = '';
    }

    const nextUrl = `${location.pathname}${nextSearch}`;
    if (!replaceState) {
      history.pushState(null, '', nextUrl);
    } else {
      history.replaceState(null, '', nextUrl);
    }
    updateLanguageLinks(nextSearch);

    await loadAndRender(mode, targetDate);
  }

  async function loadAndRender(mode = 'today', targetDate = null) {
    const rootEl = document.getElementById('market-close-root');
    if (!rootEl) return;

    state.mode = mode;
    state.currentDate = targetDate;
    state.isLatest = mode === 'today';

    const dashboardView = document.getElementById('market-dashboard-view');
    if (dashboardView) {
      dashboardView.classList.add('is-loading');
    }

    try {
      if (mode === '1w' || mode === '1m') {
        const endpoint = `/api/market/range?period=${mode}`;
        const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          return renderRangeError(mode, rootEl);
        }
        const data = await response.json();
        renderRangeView(data, mode, rootEl);
      } else if (mode === 'history' && targetDate) {
        const dateEndpoint = `/api/market/date?date=${encodeURIComponent(targetDate)}`;
        const response = await fetch(dateEndpoint, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          if (response.status === 404) {
            return renderDateNotFound(targetDate, rootEl);
          }
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        render(data, rootEl);
      } else {
        // Today
        const source = document.body.dataset.marketSource || '/api/market/latest';
        const response = await fetch(source, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          if (await renderPreviewFixture(rootEl)) return;
          if (response.status === 404) return renderEmpty(rootEl);
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        state.currentDate = data.meta?.market_date || null;
        render(data, rootEl);
      }
    } catch (error) {
      console.error('Failed to load market close data', error);
      renderError(rootEl);
    }
  }

  function renderDateNotFound(dateStr, target = document.getElementById('market-close-root')) {
    if (!target) return;
    target.innerHTML = `
      <section class="market-hero" aria-labelledby="market-close-heading"><div class="market-wrap market-hero-inner"><div class="market-hero-copy">
        <p class="market-eyebrow">SNOWSHAGAL</p><h1 id="market-close-heading">${copy.title}</h1><p class="market-subtitle">${copy.subtitle}</p>
        <p class="market-date">${dateText(dateStr)} · ${copy.closeBasis}</p>
        <p class="market-update">${copy.updateNotice}</p>
      </div><div class="market-mountain" aria-hidden="true"></div></div></section>
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div class="market-wrap">
        <section class="market-state market-not-found" role="alert">
          <img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true">
          <h1>${copy.dateNotFoundTitle}</h1>
          <p>${dateText(dateStr)}</p>
          <button class="market-return-btn" type="button" data-market-action="today">${copy.returnToLatest}</button>
        </section>
      </div>`;
    bindEvents(target);
  }

  function renderRangeError(period, target = document.getElementById('market-close-root')) {
    if (!target) return;
    const pTitle = period === '1w' ? copy.recent5Days : copy.recent20Days;
    target.innerHTML = `
      <section class="market-hero" aria-labelledby="market-range-heading"><div class="market-wrap market-hero-inner"><div class="market-hero-copy">
        <p class="market-eyebrow">SNOWSHAGAL</p><h1 id="market-range-heading">${html(pTitle)}</h1><p class="market-subtitle">—</p>
      </div><div class="market-mountain" aria-hidden="true"></div></div></section>
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div class="market-wrap">
        <section class="market-state" role="alert">
          <img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true">
          <h1>${copy.rangeLoadError}</h1>
          <button class="market-retry" type="button" data-market-action="retry">${copy.retry}</button>
        </section>
      </div>`;
    bindEvents(target);
  }

  function renderError(target = document.getElementById('market-close-root')) {
    if (!target) return;
    target.innerHTML = `<section class="market-state" role="alert"><img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true"><h1>${copy.loadError}</h1><button class="market-retry" type="button" data-market-action="retry">${copy.retry}</button></section>`;
    bindEvents(target);
  }

  function renderEmpty(target = document.getElementById('market-close-root')) {
    if (!target) return;
    target.innerHTML = `<section class="market-state"><img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true"><h1>${copy.emptyTitle}</h1><p>${copy.emptyBody}</p></section>`;
  }

  function isPreviewFixtureHost() {
    return /(?:^|\.)pages\.dev$/i.test(location.hostname) || /^(?:localhost|127\.0\.0\.1)$/i.test(location.hostname);
  }

  async function renderPreviewFixture(target) {
    const fixture = document.body.dataset.marketPreviewFixture;
    if (!fixture || !isPreviewFixtureHost()) return false;
    try {
      const response = await fetch(fixture, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return false;
      const data = await response.json();
      if (data.meta?.market_date && !state.dates.includes(data.meta.market_date)) {
        state.dates = [data.meta.market_date];
        state.latestDate = data.meta.market_date;
        state.earliestDate = data.meta.market_date;
      }
      state.currentDate = data.meta?.market_date || null;
      render(data, target);
      target.insertAdjacentHTML('afterbegin', `<div class="market-preview-notice" role="status">${copy.previewFixture}</div>`);
      return true;
    } catch (_) { return false; }
  }

  async function initDatesList() {
    try {
      const res = await fetch('/api/market/dates', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        state.dates = Array.isArray(data?.dates) ? data.dates : [];
        state.latestDate = data?.latest || null;
        state.earliestDate = data?.earliest || null;
      }
    } catch (_) {}
  }

  function onPopState() {
    const { mode, date } = parseUrlState();
    updateLanguageLinks(location.search);
    loadAndRender(mode, date);
  }

  async function init() {
    if (!document.getElementById('market-close-root')) return;

    if (!state.popstateBound && typeof window?.addEventListener === 'function') {
      window.removeEventListener?.('popstate', onPopState);
      window.addEventListener('popstate', onPopState);
      state.popstateBound = true;
    }

    await initDatesList();

    const { mode, date } = parseUrlState();
    updateLanguageLinks(location.search);
    await loadAndRender(mode, date);
  }

  root.MARKET_CLOSE = {
    render,
    renderRangeView,
    format: { number, pct, ratioPct, won, flow },
    displayValue,
    companyName,
    findExactDaily,
    parseUrlState,
    navigateToMode,
    init,
    loadAndRender,
    onPopState,
    state
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
