(function (root) {
  'use strict';

  const ko = document.documentElement.dataset.siteLang !== 'en';
  const copy = ko ? {
    title: 'MARKET CLOSE', subtitle: '오늘 시장은 어떻게 마감했나', closeBasis: '15:30 KST 마감 기준', overseas: '* 해외 시장은 각 시장의 최신 거래일 기준',
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
    weekdays: ['월', '화', '수', '목', '금', '토', '일'],
    monthFormat: (y, m) => `${y}년 ${m}월`
  } : {
    title: 'MARKET CLOSE', subtitle: 'How did the Korean market close today?', closeBasis: 'Korea close as of 15:30 KST', overseas: '* Overseas markets use each market’s latest trading session.',
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
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    monthFormat: (y, m) => {
      const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return `${names[m - 1]} ${y}`;
    }
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
     Market Close History State & Utilities
     ========================================================================== */
  const state = {
    dates: [],
    latestDate: null,
    earliestDate: null,
    currentDate: null,
    isLatest: true,
    calendarOpen: false,
    calYear: null,
    calMonth: null,
    currentPayload: null
  };

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

    return `
      <div class="market-history-strip" role="toolbar" aria-label="Market date navigation">
        <div class="market-history-modes">
          <button class="market-mode-btn ${state.isLatest && !state.calendarOpen ? 'active' : ''}" type="button" data-market-action="today" ${state.isLatest && !state.calendarOpen ? 'aria-pressed="true"' : ''}>${copy.todayMode}</button>
          <span class="market-mode-divider" aria-hidden="true"></span>
          <button class="market-mode-btn ${!state.isLatest || state.calendarOpen ? 'active' : ''}" type="button" data-market-action="toggle-calendar" aria-expanded="${state.calendarOpen}">${copy.historyMode}</button>
        </div>
        <div class="market-history-nav">
          <button class="market-nav-step" type="button" data-market-action="nav-date" data-target-date="${prevDate}" ${!canGoPrev ? 'disabled' : ''} aria-label="${copy.prevDay}">‹</button>
          <span class="market-current-date">${dateText(state.currentDate)}</span>
          <button class="market-nav-step" type="button" data-market-action="nav-date" data-target-date="${nextDate}" ${!canGoNext ? 'disabled' : ''} aria-label="${copy.nextDay}">›</button>
          <button class="market-calendar-toggle ${state.calendarOpen ? 'active' : ''}" type="button" data-market-action="toggle-calendar" aria-label="${copy.calendarToggle}" aria-expanded="${state.calendarOpen}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
          </button>
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

    // First day of month (0 = Sunday, 1 = Monday, ...)
    const firstDayIndex = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    // Monday-first index: Monday=0, Tuesday=1, ..., Sunday=6
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

    // Next month padding to fill complete weeks
    const totalCells = dayCells.length;
    const remainder = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remainder; d++) {
      dayCells.push(`<span class="market-cal-day other-month" aria-hidden="true">${d}</span>`);
    }

    return `
      <div class="market-calendar-panel" role="region" aria-label="${copy.selectDate}">
        <div class="market-cal-header">
          <button class="market-cal-nav-btn" type="button" data-market-action="prev-month" aria-label="Previous month">‹</button>
          <span class="market-cal-month-title">${copy.monthFormat(year, month)}</span>
          <button class="market-cal-nav-btn" type="button" data-market-action="next-month" aria-label="Next month">›</button>
        </div>
        <div class="market-cal-grid">
          ${copy.weekdays.map(w => `<span class="market-cal-weekday" aria-hidden="true">${html(w)}</span>`).join('')}
          ${dayCells.join('')}
        </div>
      </div>`;
  }

  function render(data, target = document.getElementById('market-close-root')) {
    if (!target) return;
    state.currentPayload = data;
    state.currentDate = data.meta?.market_date;
    state.isLatest = (!state.latestDate || state.currentDate === state.latestDate);

    // Sync calendar view month with current date
    if (state.currentDate && /^\d{4}-\d{2}-\d{2}$/.test(state.currentDate)) {
      const [y, m] = state.currentDate.split('-').map(Number);
      state.calYear = y;
      state.calMonth = m;
    }

    const i = data.indices || {};
    const rate = data.rates_fx_volatility || {};
    const commodity = data.commodities_crypto || {};
    const investor = data.krx_investor_trading?.markets || {};
    const five = data.recent_5d_flows?.markets || {};
    const breadth = data.market_breadth || {};
    const program = data.program_basis || {};
    const internals = data.market_internals || {};
    const shorts = data.short_selling || {};
    const marketCap = Array.isArray(data.market_cap_top10) ? data.market_cap_top10 : [];

    // Exact Daily matching for the current market date
    const daily = findExactDaily(state.currentDate);

    const sourceSet = new Set();
    [...Object.values(i), ...Object.values(rate), ...Object.values(commodity)].forEach(item => item?.source && sourceSet.add(item.source));

    const investorRows = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(market => {
      const values = investor[market]?.investors || {};
      return [html(localName(market)), `<span class="${signClass(values['외국인']?.net_buy)}">${flow(values['외국인']?.net_buy)}</span>`, `<span class="${signClass(values['기관']?.net_buy)}">${flow(values['기관']?.net_buy)}</span>`, `<span class="${signClass(values['개인']?.net_buy)}">${flow(values['개인']?.net_buy)}</span>`];
    });
    const fiveRows = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(market => [html(localName(market)), ...['외국인', '기관', '개인'].map(kind => `<span class="${signClass(five[market]?.[kind])}">${flow(five[market]?.[kind])}</span>`)]);
    const programRows = ['차익', '비차익', '전체'].map(kind => [html(localName(kind)), `<span class="${signClass(program.program_trading?.[kind]?.net_buy_won)}">${won(program.program_trading?.[kind]?.net_buy_won)}</span>`]);
    const concentration = internals.concentration || {};
    const concentrationItems = [
      [copy.foreignBuy, concentration['외국인']?.buy], [copy.foreignSell, concentration['외국인']?.sell], [copy.institutionBuy, concentration['기관']?.buy], [copy.institutionSell, concentration['기관']?.sell]
    ];
    const shortList = (items, ratioMode = false) => `<ol class="rank-list">${(items || []).map(item => `<li><span><b>${html(companyName(item))}</b><small>${html(item.market)}</small></span><strong>${ratioMode ? ratioPct(item.short_value_ratio) : won(item.short_value_won)}</strong></li>`).join('')}</ol>`;
    const marketCapRows = marketCap.map(item => [integer(item.rank), `<span class="stock-name"><b>${html(companyName(item))}</b><small>${html(item.ticker)}</small></span>`, integer(item.close), `<span class="${signClass(item.change_pct)}">${pct(item.change_pct)}</span>`, won(item.market_cap_won)]);

    let reportCtaHtml = '';
    if (daily) {
      const ctaLabel = state.isLatest ? copy.latestReport : copy.historyReport;
      const dateBadge = state.isLatest ? '' : ` <small class="cta-date-badge">(${dateText(state.currentDate)} Daily)</small>`;
      reportCtaHtml = `<a class="market-report-cta ${state.isLatest ? '' : 'history-cta'}" href="/${html(String(daily.href).replace(/^\/+/, ''))}">${ctaLabel}${dateBadge} <span aria-hidden="true">→</span></a>`;
    } else if (!state.isLatest) {
      reportCtaHtml = `<p class="market-report-unavailable">${copy.noDailyReport}</p>`;
    }

    const output = `
      <section class="market-hero" aria-labelledby="market-close-heading"><div class="market-wrap market-hero-inner"><div class="market-hero-copy">
        <p class="market-eyebrow">SNOWSHAGAL</p><h1 id="market-close-heading">${copy.title}</h1><p class="market-subtitle">${copy.subtitle}</p>
        <p class="market-date">${dateText(data.meta?.market_date)} · ${copy.closeBasis}</p><p class="market-overseas">${copy.overseas}</p>
      </div><div class="market-mountain" aria-hidden="true"></div></div></section>
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div class="market-wrap market-dashboard" id="market-dashboard-view">
        ${section(1, copy.sections[0], `<div class="major-index-grid">${['KOSPI', 'KOSDAQ', 'NASDAQ', 'DOW', 'SP500'].map(key => instrumentCard(key, i[key], true)).join('')}</div>`, 'section-wide')}
        <div class="market-pair market-pair-top">
          ${section(2, copy.sections[1], `<div class="mini-instrument-grid">${['SOX', 'VIX', 'US10Y', 'USDKRW', 'JPYKRW', 'DXY'].map(key => instrumentCard(key, rate[key])).join('')}</div>`)}
          ${section(3, copy.sections[2], `<div class="mini-instrument-grid commodity-grid">${['WTI', 'GOLD', 'BITCOIN'].map(key => instrumentCard(key, commodity[key])).join('')}</div>`)}
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
        <div class="market-data-note"><p>${copy.source}: ${html(Array.from(sourceSet).map(item => item.split(' · ')[0]).filter((item, index, all) => all.indexOf(item) === index).join(', '))}</p><p>${copy.generated}: ${html(data.meta?.generated_at || '--')} · ${html(data.meta?.schema_version || '')}</p></div>
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
    const button = event.target.closest('[data-market-action]');
    if (!button) return;

    const action = button.dataset.marketAction;

    if (action === 'today') {
      state.calendarOpen = false;
      navigateToDate(null);
    } else if (action === 'toggle-calendar') {
      state.calendarOpen = !state.calendarOpen;
      const drawer = document.getElementById('market-calendar-drawer');
      if (drawer) {
        drawer.hidden = !state.calendarOpen;
        drawer.innerHTML = renderCalendarPanel();
      }
      const modes = document.querySelectorAll('.market-history-modes .market-mode-btn');
      if (modes[0]) modes[0].classList.toggle('active', state.isLatest && !state.calendarOpen);
      if (modes[1]) modes[1].classList.toggle('active', !state.isLatest || state.calendarOpen);
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
        navigateToDate(targetDate);
      }
    } else if (action === 'retry') {
      init();
    }
  }

  async function navigateToDate(targetDate, replaceState = false) {
    const isReturningToLatest = !targetDate || targetDate === state.latestDate;
    const nextSearch = isReturningToLatest ? '' : `?date=${encodeURIComponent(targetDate)}`;
    const nextUrl = `${location.pathname}${nextSearch}`;

    if (!replaceState) {
      history.pushState(null, '', nextUrl);
    }
    updateLanguageLinks(nextSearch);

    await loadAndRender(targetDate);
  }

  async function loadAndRender(targetDate) {
    const rootEl = document.getElementById('market-close-root');
    if (!rootEl) return;

    const dashboardView = document.getElementById('market-dashboard-view');
    if (dashboardView) {
      dashboardView.classList.add('is-loading');
    }

    try {
      let data;
      if (!targetDate) {
        // Load latest
        const source = document.body.dataset.marketSource || '/api/market/latest';
        const response = await fetch(source, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          if (await renderPreviewFixture(rootEl)) return;
          if (response.status === 404) return renderEmpty(rootEl);
          throw new Error(`HTTP ${response.status}`);
        }
        data = await response.json();
      } else {
        // Load specific date
        const dateEndpoint = `/api/market/date?date=${encodeURIComponent(targetDate)}`;
        const response = await fetch(dateEndpoint, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          if (response.status === 404) {
            return renderDateNotFound(targetDate, rootEl);
          }
          throw new Error(`HTTP ${response.status}`);
        }
        data = await response.json();
      }

      render(data, rootEl);
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
    const params = new URLSearchParams(location.search);
    const d = params.get('date');
    updateLanguageLinks(location.search);
    loadAndRender(d);
  }

  async function init() {
    if (!document.getElementById('market-close-root')) return;

    if (!state.popstateBound && typeof window?.addEventListener === 'function') {
      window.removeEventListener?.('popstate', onPopState);
      window.addEventListener('popstate', onPopState);
      state.popstateBound = true;
    }

    await initDatesList();

    const searchParams = new URLSearchParams(location.search);
    const dateQuery = searchParams.get('date');

    updateLanguageLinks(location.search);

    await loadAndRender(dateQuery);
  }

  root.MARKET_CLOSE = {
    render,
    format: { number, pct, ratioPct, won, flow },
    displayValue,
    companyName,
    findExactDaily,
    init,
    loadAndRender,
    onPopState,
    state
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
