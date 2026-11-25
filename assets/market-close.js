(function (root) {
  'use strict';

  const ko = document.documentElement.dataset.siteLang !== 'en';
  const copy = ko ? {
    title: 'MARKET CLOSE', subtitle: '오늘 시장은 어떻게 마감했나', closeBasis: '15:30 KST 마감 기준', updateNotice: '데이터 업데이트 · 매 거래일 16:05 KST', overseas: '* 해외 시장은 각 시장의 최신 거래일 기준',
    todayMode: 'TODAY', historyMode: 'HISTORY', prevDay: '이전 거래일', nextDay: '다음 거래일',
    calendarToggle: '달력으로 날짜 선택', selectDate: '날짜 선택', closeCalendar: '달력 닫기',
    sections: ['주요 지수', '금리 · 환율 · 변동성', '원자재 · 가상자산', '시장 폭', 'KRX 투자자 매매동향 (당일)', '최근 5거래일 누적 수급', '프로그램 & 베이시스', '시장 내부 지표', '공매도 현황', '시가총액 상위 10종목'],
    ratesTitle: '국내 금리', rateState: '16:00 최종호가', ratesNote: '금융투자협회 최종호가수익률 · 16:00 KST 기준 · 대비는 금융투자협회 전일 값 대비(bp)',
    open: '시가', high: '고가', low: '저가', previous: '전일', close: '종가', current: '현재', fixedClose: '15:30 확정', intraday: '장중', recentClose: '최근 종가', unavailable: '데이터 없음',
    asiaTitle: '아시아 증시', localHoliday: '현지 휴장',
    latestClose: '종가', snapshotBasis: '마감 시점', asOf: stamp => `${stamp} 기준`,
    rise: '상승종목', fall: '하락종목', flat: '보합종목', upper: '상한가', lower: '하한가', riseRatio: '상승비율', fallRatio: '하락비율',
    foreign: '외국인', institution: '기관', individual: '개인', market: '시장', fiveDays: '5거래일', billion: '억원',
    arbitrage: '차익', nonArbitrage: '비차익', total: '전체', netBuy: '순매수', spot: 'KOSPI200 현물', future: '선물', basis: '베이시스',
    rankingsTitle: '등락률 · 거래대금 상위 종목',
    rankGainers: '상승률 상위', rankLosers: '하락률 상위', rankTurnover: '거래대금 상위', high52: '52주 신고가', high52Basis: '장중 기준 · 네이버 금융 집계', low52: '52주 신저가', stocksUnit: '종목', limitUp: '상한가', limitDown: '하한가', tradingValue: '거래대금', rankingsNone: '해당 종목 없음', rankingsUnavailable: '이날 종목 순위 데이터 없음', rankingsNote: '주식 종목만(ETF·ETN 제외) · 15:30 정규장 종가 · 등락률은 KRX 전일 종가 대비 · 네이버 금융 순위를 장 마감 후 15:35~15:39에 저장',
    turnover: '거래대금', previousTurnover: '전일 거래대금', average5: '5일 평균', ratio5: '5일 평균 대비', concentration: '수급 집중도 (상위 비중)', concentrationUnavailable: '정규장 기준 값 없음', regularUnavailable: '정규장 기준 값 없음', foreignBuy: '외국인 매수', foreignSell: '외국인 매도', institutionBuy: '기관 매수', institutionSell: '기관 매도', top1: 'TOP1', top5: 'TOP5',
    shortSummary: '시장별 공매도', shortValue: '공매도 거래대금 TOP5', shortRatio: '공매도 비중 TOP5', valueRatio: '거래대금 비중', shortAmount: '공매도 거래대금', shortRatioScope: '거래대금 비중은 KRX+NXT 합산 정규시장 거래대금 대비입니다.',
    rank: '순위', stock: '종목명', price: '종가', change: '등락률', marketCap: '시가총액', source: '데이터 출처', generated: '데이터 갱신',
    sessionPage: '이 거래일 마감 기록', archivePage: '날짜별 마감 기록 전체', sectorsPage: '업종·테마 등락률 순위', flowsPage: '투자자별 수급 · 월간 누적', indicatorsPage: '지표별 일별 기록',
    latestReport: '오늘의 리포트 보기', historyReport: '이날의 데일리 리포트 보기', noDailyReport: '이날 발행된 데일리 리포트가 없습니다.',
    noteTitle: '숫자 너머의 의미를 해석합니다.', noteBody: '시장 전체 흐름과 한국시장 내부 구조를 한눈에 정리하고, 더 깊은 해설은 Snowshagal 리포트에서 이어갑니다.',
    previewFixture: 'PREVIEW FIXTURE · 실제 게시 데이터가 아닙니다.', emptyTitle: '첫 마감 데이터를 준비하고 있습니다.', emptyBody: '데이터가 게시되면 이곳에서 최신 한국 시장 마감을 확인할 수 있습니다.',
    dateNotFoundTitle: '해당 날짜의 Market Close 데이터가 없습니다.', returnToLatest: '최신 시장으로 돌아가기',
    loadError: '마감 데이터를 불러오지 못했습니다.', retry: '다시 시도',
    fallbackNotice: '실시간 시장 데이터를 일시적으로 불러올 수 없습니다. 기본 시장 개요를 표시합니다.',
    rangeLoadError: '기간 데이터를 불러오지 못했습니다.',
    recent5Days: '최근 5거래일', recent20Days: '최근 20거래일',
    sectorThemeBuilding: '업종 · 테마 기간 데이터 축적 중',
    sectorThemeBuildingDesc: (used, total) => `현재 ${used} / ${total} 거래일 · KRX 공식 업종·테마는 v1.1.0 스냅샷부터 누적됩니다.`,
    fiveDayIncomplete: (used, total) => `데이터 불완전 · ${used}/${total} 거래일 확보`,
    fiveDayMissing: days => `${days} 데이터 없음`,
    breadthUnavailable: '이날 시장 폭 데이터 없음',
    breadthUnavailableDesc: '등락 종목 수를 확인하지 못해 표시하지 않습니다.',
    strongest: '상승 상위', weakest: '하락 상위',
    avgRiseRatio: '평균 상승비율', avgFallRatio: '평균 하락비율',
    advancerDominant: '상승 우세', declinerDominant: '하락 우세', neutralDominant: '중립',
    sessionCount: n => `${n}일`,
    avgCounts: (r, f) => `평균 상승 ${r}개 · 하락 ${f}개`,
    weekdays: ['월', '화', '수', '목', '금', '토', '일'],
    monthFormat: (y, m) => `${y}년 ${m}월`,
    pageEyebrow: '한국 증시 마감 기록', pageTitle: md => `${md} 한국 증시 마감`, pageTitleToday: '오늘 한국 증시 마감', pageLead: '거래일을 골라 그날의 종가와 수급, 주요 지표를 확인하세요.',
    dateLabel: '조회할 거래일', latestMode: '최근 마감', weekMode: '5거래일', monthMode: '20거래일', archiveLink: '전체 기록', indicatorLink: '지표별 기록', closeOf: md => `${md} 마감`, regularBasis: '정규장 15:30 KST 기준',
    regularClose: '정규장 종가', trendLabel: '최근 20거래일 종가',
    summaryTitle: '그날의 요약', summaryHead: (pctText, word) => `코스피 ${pctText}% ${word}`, upWord: '상승', downWord: '하락', flatWord: '보합',
    breadthPhrase: (count, ratio, word) => `코스피 ${count}종목 ${word}(${ratio})`, foreignPhrase: (amount, word) => `외국인 ${amount} ${word}`, netBuyWord: '순매수', netSellWord: '순매도',
    terms: { breadth: '시장 폭', program: '프로그램 매매', basis: '베이시스', short: '공매도' },
    fxSummary: '원/달러', fixingNote: md => `${md} 15:30 매매기준율`, vixSummary: '미국 변동성 VIX', usCloseNote: md => `${md} 미국장 마감`,
    krTitle: '한국 시장', krCaption: '수급, 등락 종목, 주요 종목 종가', flowsTitle: '투자자별 순매수', flowDay: '당일', flowFive: '최근 5거래일', flowNote: '양수는 순매수, 음수는 순매도',
    breadthCaption: '상승 · 보합 · 하락', statsTitle: '거래 · 프로그램 · 공매도', programTotal: '프로그램 순매수', turnoverOf: name => `${name} 거래대금`, ratio5Text: value => `5일 평균의 ${value}배`,
    shortRatioOf: name => `공매도 비중 · ${name}`, detailsMore: '공매도 상위 · 수급 집중도', topTitle: '시가총액 상위 10',
    globalTitle: '해외 · 금리 · 환율 · 원자재', globalCaption: '추이는 최근 20거래일 · 지표를 누르면 일별 기록',
    boards: { world: '해외 증시 · 변동성', rates: '금리', fx: '환율', commodities: '원자재 · 가상자산' },
    boardNotes: { world: '미국 지수 · 아시아 각 시장 최근 마감', rates: '국내 금융투자협회 16:00 최종호가', fx: '원화는 15:30 매매기준율', commodities: '달러 기준' },
    tabs: { world: '해외 증시', rates: '금리', fx: '환율', commodities: '원자재' },
    colIndicator: '지표', colValue: '값', colChange: '전일 대비', colTrend: '추이', ratesPending: '국내 금리는 16:00 KST 이후 게시됩니다.',
    marketNames: { KOSPI: '코스피', KOSDAQ: '코스닥', 'KOSPI200선물': '선물' },
    breadthShort: { rise: '상승', flat: '보합', fall: '하락', upper: '상한', lower: '하한' }
  } : {
    title: 'MARKET CLOSE', subtitle: 'How did the Korean market close today?', closeBasis: 'Korea close as of 15:30 KST', updateNotice: 'Data updates · Every trading day at 16:05 KST', overseas: '* Overseas markets use each market’s latest trading session.',
    todayMode: 'TODAY', historyMode: 'HISTORY', prevDay: 'Previous session', nextDay: 'Next session',
    calendarToggle: 'Select date from calendar', selectDate: 'Select date', closeCalendar: 'Close calendar',
    sections: ['Major Indices', 'Rates · FX · Volatility', 'Commodities · Crypto', 'Market Breadth', 'KRX Investor Flows (Daily)', 'Cumulative Flows: Last 5 Sessions', 'Program Trading & Basis', 'Market Internals', 'Short Selling', 'Top 10 by Market Cap'],
    ratesTitle: 'Korean Bond Yields', rateState: '16:00 KOFIA', ratesNote: 'KOFIA final quote yields, 16:00 KST · Change in bp against KOFIA’s previous-day value',
    open: 'Open', high: 'High', low: 'Low', previous: 'Prev.', close: 'Close', current: 'Latest', fixedClose: '15:30 fixing', intraday: 'Intraday', recentClose: 'Recent close', unavailable: 'Unavailable',
    asiaTitle: 'Asian Markets', localHoliday: 'Local holiday',
    latestClose: 'Close', snapshotBasis: 'At KRX close', asOf: stamp => `As of ${stamp}`,
    rise: 'Advancers', fall: 'Decliners', flat: 'Unchanged', upper: 'Limit up', lower: 'Limit down', riseRatio: 'Advance ratio', fallRatio: 'Decline ratio',
    foreign: 'Foreign', institution: 'Institution', individual: 'Retail', market: 'Market', fiveDays: '5 sessions', billion: 'KRW 100m',
    arbitrage: 'Arbitrage', nonArbitrage: 'Non-arbitrage', total: 'Total', netBuy: 'Net buy', spot: 'KOSPI 200 spot', future: 'Futures', basis: 'Basis',
    rankingsTitle: 'Top Movers & Most Traded',
    rankGainers: 'Top gainers', rankLosers: 'Top losers', rankTurnover: 'Most traded by value', high52: '52-week highs', high52Basis: 'intraday · Naver Finance count', low52: '52-week lows', stocksUnit: '', limitUp: 'Limit up', limitDown: 'Limit down', tradingValue: 'Value', rankingsNone: 'None', rankingsUnavailable: 'Stock rankings unavailable for this session', rankingsNote: 'Stocks only (ETFs and ETNs excluded) · regular-session close at 15:30 KST · change against the previous KRX close · Naver Finance rankings saved after the close, 15:35–15:39 KST',
    turnover: 'Turnover', previousTurnover: 'Previous', average5: '5-session avg.', ratio5: 'vs. 5-session avg.', concentration: 'Flow Concentration (Top Share)', concentrationUnavailable: 'No regular-session value', regularUnavailable: 'No regular-session value', foreignBuy: 'Foreign buy', foreignSell: 'Foreign sell', institutionBuy: 'Institution buy', institutionSell: 'Institution sell', top1: 'TOP1', top5: 'TOP5',
    shortSummary: 'Market Short Selling', shortValue: 'Top 5 by Short Value', shortRatio: 'Top 5 by Short Ratio', valueRatio: 'Value ratio', shortAmount: 'Short value', shortRatioScope: 'Value ratio is against KRX+NXT combined regular-session turnover.',
    rank: 'Rank', stock: 'Company', price: 'Close', change: 'Change', marketCap: 'Market cap', source: 'Sources', generated: 'Data updated',
    sessionPage: 'This session’s record', archivePage: 'All sessions by date', sectorsPage: 'Sector & theme rankings', flowsPage: 'Investor flows by month', indicatorsPage: 'Daily history by indicator',
    latestReport: 'Read today’s report', historyReport: 'Read this day’s Daily report', noDailyReport: 'No Daily report was published for this date.',
    noteTitle: 'We interpret the meaning beyond the numbers.', noteBody: 'See the market’s broad direction and internal Korean-market structure at a glance, then continue with deeper context in Snowshagal reports.',
    previewFixture: 'PREVIEW FIXTURE · Not published market data.', emptyTitle: 'The first market close is being prepared.', emptyBody: 'The latest Korean market close will appear here once it is published.',
    dateNotFoundTitle: 'No market close data for this date.', returnToLatest: 'Return to latest market',
    loadError: 'Could not load the market close.', retry: 'Try again',
    fallbackNotice: 'Live market data is temporarily unavailable. Showing the latest available market overview.',
    rangeLoadError: 'Could not load the period data.',
    recent5Days: 'Last 5 Sessions', recent20Days: 'Last 20 Sessions',
    sectorThemeBuilding: 'Sector & theme history is building',
    sectorThemeBuildingDesc: (used, total) => `Currently ${used} / ${total} sessions available`,
    fiveDayIncomplete: (used, total) => `Incomplete data · ${used}/${total} sessions available`,
    fiveDayMissing: days => `No data for ${days}`,
    breadthUnavailable: 'Market breadth unavailable for this session',
    breadthUnavailableDesc: 'Advance/decline counts could not be confirmed, so none are shown.',
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
    pageEyebrow: 'Korea market close archive', pageTitle: md => `Korea Market Close · ${md}`, pageTitleToday: 'Korea Market Close Today', pageLead: 'Pick a trading day to see its closes, investor flows and key indicators.',
    dateLabel: 'Trading day', latestMode: 'Latest close', weekMode: '5 sessions', monthMode: '20 sessions', archiveLink: 'All sessions', indicatorLink: 'Indicator history', closeOf: md => `Close of ${md}`, regularBasis: 'Regular session, 15:30 KST',
    regularClose: 'Regular close', trendLabel: 'Last 20 sessions',
    summaryTitle: 'The day in brief', summaryHead: (pctText, word) => `KOSPI ${word} ${pctText}%`, upWord: 'up', downWord: 'down', flatWord: 'flat',
    breadthPhrase: (count, ratio, word) => `${count} KOSPI stocks ${word} (${ratio})`, foreignPhrase: (amount, word) => `foreign investors ${word} ${amount}`, netBuyWord: 'net bought', netSellWord: 'net sold',
    terms: { breadth: 'Market Breadth', program: 'Program Trading', basis: 'Basis', short: 'Short Selling' },
    fxSummary: 'USD/KRW', fixingNote: md => `${md} · 15:30 reference rate`, vixSummary: 'US volatility · VIX', usCloseNote: md => `${md} · US close`,
    krTitle: 'Korean Market', krCaption: 'Flows, advancers and decliners, top stocks', flowsTitle: 'Net Buying by Investor', flowDay: 'Today', flowFive: 'Last 5 sessions', flowNote: 'Positive is net buying, negative net selling',
    breadthCaption: 'Advancers · unchanged · decliners', statsTitle: 'Turnover · Program · Short Selling', programTotal: 'Program net buy', turnoverOf: name => `${name} turnover`, ratio5Text: value => `${value}× the 5-session avg.`,
    shortRatioOf: name => `Short ratio · ${name}`, detailsMore: 'Top short selling · flow concentration', topTitle: 'Top 10 by Market Cap',
    globalTitle: 'Overseas · Rates · FX · Commodities', globalCaption: 'Trend over the last 20 sessions · Select an indicator for its daily history',
    boards: { world: 'Overseas Markets · Volatility', rates: 'Rates', fx: 'FX', commodities: 'Commodities · Crypto' },
    boardNotes: { world: 'US indices · each Asian market’s latest close', rates: 'Korean yields: KOFIA 16:00 final quotes', fx: 'KRW pairs: 15:30 reference rate', commodities: 'In US dollars' },
    tabs: { world: 'Markets', rates: 'Rates', fx: 'FX', commodities: 'Commodities' },
    colIndicator: 'Indicator', colValue: 'Value', colChange: 'Change', colTrend: 'Trend', ratesPending: 'Korean yields are published after 16:00 KST.',
    marketNames: { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', 'KOSPI200선물': 'KOSPI 200 Futures' },
    breadthShort: { rise: 'Up', flat: 'Flat', fall: 'Down', upper: 'limit', lower: 'limit' }
  };

  const names = {
    NASDAQ: 'NASDAQ Composite', DOW: 'Dow Jones', SP500: 'S&P 500', NIKKEI225: 'Nikkei 225', SHANGHAI: 'Shanghai Composite', TAIEX: 'TAIEX', SOX: 'Philadelphia Semiconductor', VIX: 'VIX', VKOSPI: 'VKOSPI', US10Y: 'US 10Y', USDKRW: 'USD/KRW', JPYKRW: 'JPY/KRW (100)', DXY: 'Dollar Index', WTI: 'WTI Crude', GOLD: 'Gold', BITCOIN: 'Bitcoin',
    CNYKRW: 'CNY/KRW', EURKRW: 'EUR/KRW', USDJPY: 'USD/JPY', BRENT: 'Brent Crude', NATGAS: 'Natural Gas', SILVER: 'Silver', COMEX_COPPER: 'Copper',
    KTB3Y: 'KTB 3Y', KTB10Y: 'KTB 10Y', CORPAA3Y: 'Corporate AA- 3Y', CD91: 'CD 91-day',
    KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', 'KOSPI200선물': 'KOSPI 200 Futures', '기관': 'Institution', '외국인': 'Foreign', '개인': 'Retail', '차익': 'Arbitrage', '비차익': 'Non-arbitrage', '전체': 'Total'
  };

  const KRX_COMPANY_NAMES_EN = {
    '000660': 'SK hynix',
    '005380': 'Hyundai Motor',
    '005930': 'Samsung Electronics',
    '005935': 'Samsung Electronics Pref.',
    '009150': 'Samsung Electro-Mechanics',
    '013890': 'Zinus',
    '012450': 'Hanwha Aerospace',
    '028260': 'Samsung C&T',
    '034020': 'Doosan Enerbility',
    '035420': 'NAVER',
    '042660': 'Hanwha Ocean',
    '042700': 'Hanmi Semiconductor',
    '047810': 'Korea Aerospace Industries',
    '055550': 'Shinhan Financial Group',
    '068270': 'Celltrion',
    '095340': 'ISC',
    '095570': 'AJ Networks',
    '105560': 'KB Financial Group',
    '207940': 'Samsung Biologics',
    '329180': 'HD Hyundai Heavy Industries',
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
  // `generated_at` is the collector's refresh stamp (often written with a
  // +07:00 offset). It is shown only through the shared KST formatter so no
  // reader sees the raw ISO string, microseconds, or their own timezone.
  const generatedAtText = value => {
    const locale = root.MARKET_LOCALE;
    const formatted = locale && typeof locale.formatDataUpdated === 'function' ? locale.formatDataUpdated(value, ko ? 'ko' : 'en') : null;
    return formatted || `${copy.generated} · --`;
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
  // A net amount with an explicit sign, as in the investor flow tables (+ / U+2212).
  const signedWon = value => {
    if (!valid(value)) return '--';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    const text = won(Math.abs(value));
    return ko ? `${sign}${text}` : text.replace(/^KRW /, `KRW ${sign}`);
  };
  // The collector's basis labels are Korean; EN shows its own words.
  const BASIS_STATES_EN = { '콘탱고': 'Contango', '백워데이션': 'Backwardation', '중립': 'Flat' };
  const futureLabel = name => {
    const text = String(name || '').trim();
    if (!text) return copy.future;
    if (ko) return text;
    const month = /\((\d{4})\)/.exec(text);
    return month ? `${copy.future} (${month[1]})` : copy.future;
  };
  const basisState = value => (ko ? value : BASIS_STATES_EN[value]) || value || '--';
  // The collector's source labels (Korean). EN shows English names; KRX is always a source.
  const SOURCES_EN = {
    'Npay 지수 실시간': 'Naver Pay index quotes',
    '네이버 금융 지수 일봉': 'Naver Finance daily index',
    '네이버 금융': 'Naver Finance',
    '네이버 금융 하나은행 15:30 회차별 매매기준율 + Yahoo 현재가': 'Hana Bank 15:30 reference rate (Naver Finance) + Yahoo Finance latest'
  };
  const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
  const sourceLine = labels => {
    const unique = [ko ? 'KRX 한국거래소' : 'KRX', ...labels.map(item => item.split(' · ')[0])]
      // An unknown Korean label never reaches the English page; it is at least Naver Finance.
      .map(item => (ko ? item : SOURCES_EN[item] || (HANGUL.test(item) ? (/네이버|Npay/.test(item) ? 'Naver Finance' : '') : item)))
      .filter((item, index, all) => item && all.indexOf(item) === index);
    return unique.join(', ');
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
  // The 1W/1M aggregate carries no display name, so the Korean page needs its own (the TODAY
  // payload's names, the same words).
  const namesKo = {
    KOSPI: '코스피', KOSDAQ: '코스닥', NASDAQ: '나스닥 종합', DOW: '다우존스', SP500: 'S&P 500', NIKKEI225: '닛케이225', SHANGHAI: '상해종합', TAIEX: '대만 가권', SOX: '필라델피아 반도체',
    VIX: 'VIX 변동성', VKOSPI: 'VKOSPI', US10Y: '미국 국채 10년', USDKRW: '원/달러', JPYKRW: '원/100엔', DXY: '달러인덱스',
    WTI: 'WTI 원유', GOLD: '금 선물', BITCOIN: '비트코인',
    CNYKRW: '원/위안', EURKRW: '원/유로', USDJPY: '엔/달러', BRENT: '브렌트유', NATGAS: '천연가스', SILVER: '은 선물', COMEX_COPPER: '구리 선물',
    KTB3Y: '국고채 3년', KTB10Y: '국고채 10년', CORPAA3Y: '회사채 AA- 3년', CD91: 'CD 91일'
  };
  // KRW pairs whose close is the 15:30 Hana Bank fixing; the others are quotes.
  const FIXING_CODES = ['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW'];
  const isFixing = key => FIXING_CODES.includes(key);
  // Added 2026-11: a record made before them has no such item.
  const OPTIONAL_CODES = ['CNYKRW', 'EURKRW', 'USDJPY', 'BRENT', 'NATGAS', 'SILVER', 'COMEX_COPPER', 'VKOSPI', 'NIKKEI225', 'SHANGHAI', 'TAIEX'];
  // Asian indices: dated the local session; a local holiday carries the previous close.
  const ASIA_CODES = ['NIKKEI225', 'SHANGHAI', 'TAIEX'];
  // Decimal places of a price and its change (Bitcoin prices are whole dollars).
  const digitsOf = key => (key === 'NATGAS' || key === 'COMEX_COPPER' ? 3 : 2);
  // Each instrument has a daily history page at /market/{code in lower case}/
  // (copper: /market/copper/), as functions/_market-indicators.js lists them.
  // An optional one is linked only beside a value: until a record has one,
  // its page does not exist.
  // KOFIA yields (Domestic Rates): their own dataset, joined to the session by
  // date; a card exists only beside a stored value, so its page exists too.
  const RATE_CODES = ['KTB3Y', 'KTB10Y', 'CORPAA3Y', 'CD91'];
  const HISTORY_CODES = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'DOW', 'SP500', 'SOX', 'VIX', 'US10Y', 'USDKRW', 'JPYKRW', 'DXY', 'WTI', 'GOLD', 'BITCOIN', ...OPTIONAL_CODES, ...RATE_CODES];
  const historySlug = key => (key === 'COMEX_COPPER' ? 'copper' : key.toLowerCase());
  const historyLink = (key, text, hasValue = true) => HISTORY_CODES.includes(key) && (hasValue || !OPTIONAL_CODES.includes(key))
    ? `<a class="instrument-history-link" href="${ko ? '' : '/en'}/market/${historySlug(key)}/">${text}</a>`
    : text;
  // A failed instrument may carry its code as its name; the Korean page then uses its own word.
  // The site's own name first, so a code reads the same on every date and on
  // the dated pages; the record's name only for a code the site has no name for.
  const instrumentName = (key, item) => ko ? (namesKo[key] || (item?.name && item.name !== key ? item.name : '') || key) : (names[key] || key);
  const groupName = item => {
    const locale = root.MARKET_LOCALE;
    return locale && typeof locale.krxGroupName === 'function' ? locale.krxGroupName(item, ko ? 'ko' : 'en') : String(item?.name || '');
  };
  const valueUnit = (key, value) => {
    if (!valid(value)) return '--';
    if (key === 'US10Y') return `${number(value, 3)}%`;
    if (RATE_CODES.includes(key)) return `${number(value, key === 'CD91' ? 2 : 3)}%`;
    if (isFixing(key)) return ko ? `${number(value, 2)}원` : `₩${number(value, 2)}`;
    if (key === 'USDJPY') return ko ? `${number(value, 2)}엔` : `¥${number(value, 2)}`;
    if (key === 'BITCOIN') return `$${number(value, 0)}`;
    if (['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER'].includes(key)) return `$${number(value, digitsOf(key))}`;
    return number(value, 2);
  };
  const displayValue = (key, item) => {
    if (!item || item.data_state === 'unavailable') return null;
    if (isFixing(key) || key === 'KOSPI' || key === 'KOSDAQ') return item.close;
    return item.data_state === 'intraday' && valid(item.current) ? item.current : item.close;
  };
  // The basis of a record figure (no Global Latest overlay). A KRW reference
  // rate is the 15:30 fixing, whatever the record calls it. A figure still
  // trading at capture says when it was read ("장중 · 16:10 KST"; just "장중"
  // when the record has no capture time). A close is "최근 종가" on TODAY and
  // "종가" on a past date, as on that date's own page.
  const stateText = (key, item, history = false) => {
    if (!item || item.data_state === 'unavailable') return copy.unavailable;
    if (isFixing(key)) return copy.fixedClose;
    if (item.data_state === 'intraday') {
      const time = root.MARKET_LOCALE?.intradayCaptureTime?.(item) || '';
      return time ? `${copy.intraday} · ${time}` : copy.intraday;
    }
    return history ? copy.close : copy.recentClose;
  };
  const metric = (label, value, extra = '') => `<div class="market-metric"><span>${html(label)}</span><strong class="${extra}">${value}</strong></div>`;
  const section = (numberValue, title, body, extra = '') => `<section class="market-section ${extra}" aria-labelledby="market-section-${numberValue}"><h2 id="market-section-${numberValue}"><span>${numberValue}.</span> ${html(title)}</h2>${body}</section>`;

  // The basis of a Global Latest figure: its session date and state, and for
  // an intraday value the moment it was observed (as_of, in KST).
  function latestStateHtml(latest) {
    const state = `${dateText(latest.source_date)} · ${latest.data_state === 'final_close' ? copy.latestClose : copy.intraday}`;
    if (latest.data_state !== 'intraday') return state;
    const stamp = root.MARKET_LOCALE?.formatKstTimestamp?.(latest.as_of, ko ? 'ko' : 'en');
    return stamp ? `${state}<span class="instrument-asof">${html(copy.asOf(stamp))}</span>` : state;
  }

  // `view.latest`: a Global Latest item shown in place of the snapshot figure
  // (TODAY only). Only its own value, change, previous close and basis are
  // shown; the snapshot's 15:30 fixing and open/high/low belong to another
  // moment and are left out. `view.mixed`: some row on the page is
  // overlaid, so a snapshot figure that was intraday when the Market Close
  // was captured says so ("마감 시점") instead of "장중".
  function instrumentView(key, item, view = {}) {
    const latest = view.latest || null;
    const display = latest ? latest.value : displayValue(key, item);
    const movement = latest ? latest.change : item?.change;
    const movementPct = latest ? latest.change_pct : item?.change_pct;
    const movementClass = signClass(movement);
    const movementArrow = movementClass === 'up' ? '▲' : movementClass === 'down' ? '▼' : '—';
    const isFx = isFixing(key);
    const changeContent = key === 'US10Y'
      ? `${movementArrow} ${valid(movement) ? `${number(Math.abs(movement * 100), 1)}bp` : '--'}`
      : isFx || key === 'KOSPI' || key === 'KOSDAQ'
        ? `${movementArrow} ${valid(movement) ? number(Math.abs(movement), 2) : '--'} <span>(${pct(movementPct)})</span>`
        : `${movementArrow} ${signed(movement, digitsOf(key))} <span>(${pct(movementPct)})</span>`;
    // A KRW pair shows its 15:30 fixing only. The record's other figure for it
    // (`current`) was read when the record was made and carries no time of its
    // own, so it is not shown as "현재" (2026-11-23 review).
    const fxContext = '';
    // On TODAY with a Global Latest overlay, a record figure that was trading
    // at capture reads "마감 시점" (with its capture time) next to the newer rows.
    const captured = !isFx && item?.data_state === 'intraday' ? root.MARKET_LOCALE?.intradayCaptureTime?.(item) || '' : '';
    const snapshotState = view.mixed && !isFx && item?.data_state === 'intraday'
      ? (captured ? `${copy.snapshotBasis} · ${captured}` : copy.snapshotBasis)
      : stateText(key, item, view.history === true);
    // An Asian index dated before the session: its market was closed that day.
    const localHoliday = ASIA_CODES.includes(key) && /^\d{4}-\d{2}-\d{2}$/.test(String(item?.source_date || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(view.marketDate || '')) && item.source_date < view.marketDate;
    const stateHtml = latest ? latestStateHtml(latest) : `${dateText(item?.source_date)} · ${snapshotState}${localHoliday ? ` · ${copy.localHoliday}` : ''}`;
    const basisAttr = latest ? ' data-basis="latest"' : view.mixed ? ' data-basis="snapshot"' : '';
    return { latest, display, movementClass, changeContent, fxContext, stateHtml, basisAttr, name: historyLink(key, html(instrumentName(key, item)), valid(display)) };
  }

  // A label that names a glossary term links to its entry. The id is functions/_glossary.js glossaryTermId:
  // the term in lower case, every run of spaces or punctuation as one hyphen.
  const glossaryHref = term => `${ko ? '' : '/en'}/basics/glossary/#term-${String(term).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')}`;
  const termLink = (text, term) => (term ? `<a class="mk-term" href="${html(glossaryHref(term))}">${html(text)}</a>` : html(text));

  // A trend line of finite values, oldest first: { line, area, cx, cy } in a w×h box, or null.
  function sparkGeometry(values, w, h, pad) {
    const series = Array.isArray(values) ? values : [];
    // The series ends on the session shown: without that day's value there is
    // no line, or its last point would be an earlier session's.
    if (!valid(series[series.length - 1])) return null;
    const points = series.filter(valid);
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min;
    // A series that never moved is a level line through the middle of the box.
    const y = value => (span ? pad + (max - value) / span * (h - 2 * pad) : h / 2);
    const xy = points.map((value, index) => [pad + index * (w - 2 * pad) / (points.length - 1), y(value)]);
    const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const [cx, cy] = xy[xy.length - 1];
    return { line, area: `${pad},${h} ${line} ${w - pad},${h}`, cx: cx.toFixed(1), cy: cy.toFixed(1) };
  }

  // `stretch`: fills its box's width (the index cards); otherwise a fixed small line with an end dot.
  function trendSvg(values, { w = 88, h = 26, pad = 3, stretch = false } = {}) {
    const g = sparkGeometry(values, w, h, pad);
    if (!g) return '';
    return `<svg class="mk-spark${stretch ? ' mk-spark-wide' : ''}" viewBox="0 0 ${w} ${h}" width="${stretch ? '100%' : w}" height="${h}"${stretch ? ' preserveAspectRatio="none"' : ''} aria-hidden="true" focusable="false"><polygon class="mk-spark-area" points="${g.area}"></polygon><polyline class="mk-spark-line" points="${g.line}"${stretch ? ' vector-effect="non-scaling-stroke"' : ''}></polyline>${stretch ? '' : `<circle class="mk-spark-dot" cx="${g.cx}" cy="${g.cy}" r="2.2"></circle>`}</svg>`;
  }

  const trendOf = (trend, key) => (trend && trend.series && Array.isArray(trend.series[key]) ? trend.series[key] : null);

  // One row of the quote board: name and basis, value, change, trend.
  function boardRow(key, item, view = {}) {
    const v = instrumentView(key, item, view);
    const line = trendSvg(trendOf(view.trend, key));
    return `<tr class="mk-row"${v.basisAttr} data-code="${html(key)}">
      <th scope="row"><span class="mk-row-name">${v.name}</span><span class="mk-row-state">${v.stateHtml}</span></th>
      <td class="mk-row-value"><strong>${valueUnit(key, v.display)}</strong>${v.fxContext}</td>
      <td class="mk-row-change ${v.movementClass}">${v.changeContent}</td>
      <td class="mk-row-trend">${line || '<span class="mk-trend-empty">—</span>'}</td>
    </tr>`;
  }

  // One KOFIA yield of the session: the afternoon (16:00 KST) value and
  // KOFIA's own change against its previous-day value, in basis points.
  function domesticRateRow(item, day, trend) {
    const movementClass = signClass(item.change_bp);
    const arrow = movementClass === 'up' ? '▲' : movementClass === 'down' ? '▼' : '—';
    const basis = day.basis_time === '16:00' ? copy.rateState : `${html(day.basis_time)} ${copy.rateState.replace(/^16:00 /, '')}`;
    const line = trendSvg(trendOf(trend, item.code));
    return `<tr class="mk-row rate-row" data-rate-code="${html(item.code)}">
      <th scope="row"><span class="mk-row-name">${historyLink(item.code, html(instrumentName(item.code, null)))}</span><span class="mk-row-state">${dateText(day.market_date)} · ${basis}</span></th>
      <td class="mk-row-value"><strong>${valueUnit(item.code, item.value)}</strong></td>
      <td class="mk-row-change ${movementClass}">${arrow} ${valid(item.change_bp) ? `${number(Math.abs(item.change_bp), 1)}bp` : '--'}</td>
      <td class="mk-row-trend">${line || '<span class="mk-trend-empty">—</span>'}</td>
    </tr>`;
  }

  // The session's KOFIA yields (rows), or '' when its day is not stored (yet).
  function domesticRateRows(day, marketDate, trend) {
    if (!day || day.market_date !== marketDate || !Array.isArray(day.items)) return '';
    return day.items.filter(item => RATE_CODES.includes(item?.code) && valid(item.value)).map(item => domesticRateRow(item, day, trend)).join('');
  }

  function boardCard(id, title, note, rows, extra = '') {
    return `<section class="mk-card mk-board" data-board="${id}" aria-labelledby="mk-board-${id}">
      <div class="mk-card-head"><h3 id="mk-board-${id}">${html(title)}</h3><span class="mk-card-note">${html(note)}</span></div>
      <div class="mk-table-wrap"><table class="mk-table mk-board-table"><thead><tr><th scope="col">${copy.colIndicator}</th><th scope="col">${copy.colValue}</th><th scope="col">${copy.colChange}</th><th scope="col" class="mk-col-trend">${copy.colTrend}</th></tr></thead><tbody>${rows}</tbody></table></div>${extra}
    </section>`;
  }

  // A net flow's small bar: right of the middle for net buying, left for net selling,
  // scaled to the largest absolute value in its table.
  function flowBar(value, max) {
    if (!valid(value) || !valid(max) || max <= 0) return '';
    const width = Math.max(Math.abs(value) / max * 50, 1.5);
    const x = value >= 0 ? 50 : 50 - width;
    return `<svg class="mk-flow-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="mk-flow-track" x="0" y="0" width="100" height="8"></rect><rect class="mk-flow-fill ${value >= 0 ? 'up' : 'down'}" x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="8"></rect><rect class="mk-flow-mid" x="49.6" y="0" width="0.8" height="8"></rect></svg>`;
  }

  // Net flows of the three markets (KRW billion per the contract), as a table with bars.
  function flowTable(rowsByMarket) {
    const values = rowsByMarket.flatMap(row => row.values).filter(valid);
    const max = values.length ? Math.max(...values.map(Math.abs)) : 0;
    return `<div class="mk-table-wrap"><table class="mk-table mk-flow-table"><thead><tr><th scope="col">${copy.market}</th><th scope="col">${copy.foreign}</th><th scope="col">${copy.institution}</th><th scope="col">${copy.individual}</th></tr></thead><tbody>${rowsByMarket.map(row => `<tr><th scope="row">${html(row.name)}</th>${row.values.map(value => `<td><span class="mk-flow-value ${signClass(value)}">${flow(value)}</span>${flowBar(value, max)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function breadthBlock(key, item) {
    const name = copy.marketNames[key] || key;
    const rise = item?.rise_count ?? item?.rise;
    const fall = item?.fall_count ?? item?.fall;
    const flat = item?.flat;
    const total = [rise, flat, fall].every(valid) ? rise + flat + fall : null;
    const share = value => (valid(total) && total > 0 && valid(value) ? value / total * 100 : 0);
    const limit = (label, value) => (valid(value) && value > 0 ? ` (${label} ${integer(value)})` : '');
    // The head names the larger side: the advance ratio on a day more stocks rose than fell.
    const advancing = valid(item?.rise_ratio) && valid(item?.fall_ratio) && item.rise_ratio > item.fall_ratio;
    return `<div class="mk-breadth" data-market="${html(key)}">
      <div class="mk-breadth-head"><span>${html(name)}</span>${advancing ? `<b class="up">${copy.riseRatio} ${ratioPct(item.rise_ratio)}</b>` : `<b class="down">${copy.fallRatio} ${ratioPct(item?.fall_ratio)}</b>`}</div>
      <div class="mk-breadth-bar" role="img" aria-label="${copy.riseRatio} ${ratioPct(item?.rise_ratio)}, ${copy.fallRatio} ${ratioPct(item?.fall_ratio)}"><span class="advance" style="width:${share(rise).toFixed(2)}%"></span><span class="flat" style="width:${share(flat).toFixed(2)}%"></span><span class="decline" style="width:${share(fall).toFixed(2)}%"></span></div>
      <div class="mk-breadth-counts"><span class="up">${copy.breadthShort.rise} ${integer(item?.rise)}${limit(copy.breadthShort.upper, item?.upper_limit)}</span><span>${copy.breadthShort.flat} ${integer(flat)}</span><span class="down">${copy.breadthShort.fall} ${integer(item?.fall)}${limit(copy.breadthShort.lower, item?.lower_limit)}</span></div>
    </div>`;
  }

  const shortDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
    const [, m, d] = value.split('-').map(Number);
    return `${m}/${d}`;
  };

  // KOSPI or KOSDAQ: the regular close, its change, the 20-session trend and the day's range.
  function indexCard(key, item, view = {}) {
    const v = instrumentView(key, item, view);
    const trend = trendOf(view.trend, key);
    const dates = view.trend && Array.isArray(view.trend.dates) ? view.trend.dates : [];
    const firstIndex = Array.isArray(trend) ? trend.findIndex(valid) : -1;
    const line = trendSvg(trend, { w: 340, h: 64, pad: 3, stretch: true });
    return `<article class="mk-card mk-index" data-code="${html(key)}">
      <div class="mk-index-head"><span class="mk-index-name">${v.name}</span><span class="mk-index-label">${copy.regularClose}</span></div>
      <strong class="mk-index-value">${valueUnit(key, v.display)}</strong>
      <div class="mk-index-change ${v.movementClass}">${v.changeContent}</div>
      ${line ? `<div class="mk-index-trend">${line}<div class="mk-index-axis"><span>${shortDate(dates[firstIndex])}</span><span>${copy.trendLabel}</span><span>${shortDate(dates[dates.length - 1])}</span></div></div>` : ''}
      <dl class="mk-ohlc"><div><dt>${copy.open}</dt><dd>${number(item?.open, 2)}</dd></div><div><dt>${copy.high}</dt><dd>${number(item?.high, 2)}</dd></div><div><dt>${copy.low}</dt><dd>${number(item?.low, 2)}</dd></div><div><dt>${copy.previous}</dt><dd>${number(item?.previous_close, 2)}</dd></div></dl>
      <div class="mk-index-state">${v.stateHtml}</div>
    </article>`;
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
    // The session /api/market/latest says should already be published
    // (x-market-expected-date, from functions/_trading-calendar.js).
    expectedDate: null,
    // Today's KRX session (x-krx-session, functions/_trading-calendar.js
    // krxSessionStatus), independent of the expectation above.
    krxSession: null,
    // Each loadAndRender call takes a number; a response that arrives after
    // a newer call started is dropped, so a slow TODAY can never paint over
    // HISTORY (or the other way round).
    loadToken: 0,
    popstateBound: false
  };
  const GLOBAL_LATEST_ENDPOINT = '/api/market/global/latest';
  const GLOBAL_LATEST_SERVED_AT_HEADER = 'x-global-latest-served-at';
  // TODAY never waits longer than this for Global Latest.
  const GLOBAL_LATEST_WAIT_MS = 2500;

  // { items, servedAt } from /api/market/global/latest, or null on any
  // failure, on a late answer, or without the locale policy to judge it by
  // (then nothing is requested).
  function fetchGlobalLatest() {
    if (typeof fetch !== 'function' || typeof root.MARKET_LOCALE?.globalLatestOverlay !== 'function') return Promise.resolve(null);
    let timer = null;
    let pending;
    try {
      pending = fetch(GLOBAL_LATEST_ENDPOINT, { headers: { Accept: 'application/json' } });
    } catch (_) {
      return Promise.resolve(null);
    }
    const request = Promise.resolve(pending)
      .then(response => (response.ok
        ? response.json().then(body => ({
          items: Array.isArray(body?.items) ? body.items : [],
          servedAt: response.headers?.get?.(GLOBAL_LATEST_SERVED_AT_HEADER) || ''
        }))
        : null))
      .catch(() => null);
    if (typeof setTimeout !== 'function') return request;
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), GLOBAL_LATEST_WAIT_MS); });
    return Promise.race([request, deadline]).then(result => {
      clearTimeout(timer);
      return result;
    });
  }
  const DOMESTIC_RATES_ENDPOINT = '/api/market/rates/date';
  const MARKET_FUNDS_ENDPOINT = '/api/market/funds/date';
  // The session's KOFIA yields (`date` or 'latest'): the stored day, or null on
  // any failure, a missing day or a late answer. They are published after the
  // close record (KOFIA computes them at 16:00 KST), so their absence is normal.
  function fetchDomesticRates(date) {
    return fetchStoredDay(DOMESTIC_RATES_ENDPOINT, date);
  }
  // The session's KOFIA market funds (`date` or 'latest'), the same way. KOFIA
  // publishes them a business day after the session.
  function fetchMarketFunds(date) {
    return fetchStoredDay(MARKET_FUNDS_ENDPOINT, date);
  }
  function fetchStoredDay(endpoint, date) {
    if (typeof fetch !== 'function' || !date) return Promise.resolve(null);
    let timer = null;
    let pending;
    try {
      pending = fetch(`${endpoint}?date=${encodeURIComponent(date)}`, { headers: { Accept: 'application/json' } });
    } catch (_) {
      return Promise.resolve(null);
    }
    const request = Promise.resolve(pending)
      .then(response => (response && response.ok ? response.json().then(body => body?.day || null) : null))
      .catch(() => null);
    if (typeof setTimeout !== 'function') return request;
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), GLOBAL_LATEST_WAIT_MS); });
    return Promise.race([request, deadline]).then(result => {
      clearTimeout(timer);
      return result;
    });
  }
  const TREND_ENDPOINT = '/api/market/trend';
  // The last 20 sessions' closes up to `date` (or the newest), for the small
  // trend lines: the body, or null on any failure or a late answer. The page
  // never waits on it longer than on Global Latest, and draws no line without it.
  function fetchTrend(date) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    let timer = null;
    let pending;
    try {
      pending = fetch(date ? `${TREND_ENDPOINT}?end=${encodeURIComponent(date)}` : TREND_ENDPOINT, { headers: { Accept: 'application/json' } });
    } catch (_) {
      return Promise.resolve(null);
    }
    const request = Promise.resolve(pending)
      .then(response => (response && response.ok ? response.json() : null))
      .catch(() => null);
    if (typeof setTimeout !== 'function') return request;
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(null), GLOBAL_LATEST_WAIT_MS); });
    return Promise.race([request, deadline]).then(result => {
      clearTimeout(timer);
      return result;
    });
  }
  const EXPECTED_MARKET_DATE_HEADER = 'x-market-expected-date';
  const KRX_SESSION_HEADER = 'x-krx-session';

  // TODAY view only: a KRX holiday or weekend is the market resting, not missing
  // data, so it is its own quiet line and never replaces the stale/outage notice
  // below, which still appears when the close on screen is also behind.
  function sessionNotice(marketDate, isHistory) {
    if (isHistory || state.mode !== 'today') return '';
    const display = root.MARKET_LOCALE?.krxSessionDisplay?.(state.krxSession, ko ? 'ko' : 'en', { latestDate: marketDate });
    if (!display) return '';
    return `<div class="market-session" role="note"><p class="market-session-badge">${html(display.label)}</p><p class="market-session-note">${display.sentences.map(html).join(' ')}</p></div>`;
  }

  // TODAY view only: when the latest close is older than the expected session,
  // name the last verified close and the session that is not provided.
  // 그 날짜를 열었을 때만 보이는 과거 데이터 한계 안내. payload는 그대로 둔다.
  function integrityNotice(marketDate) {
    const notice = root.MARKET_LOCALE?.marketIntegrityNotice?.(marketDate, ko ? 'ko' : 'en');
    if (!notice) return '';
    return `<div class="market-integrity" role="note"><h2 class="market-transparency-title">${html(notice.title)}</h2><div class="market-transparency-body">${notice.body.map(line => `<p>${html(line)}</p>`).join('')}</div></div>`;
  }

  function availabilityNotice(marketDate, isHistory) {
    if (isHistory || state.mode !== 'today') return '';
    const availability = root.MARKET_LOCALE?.marketCloseAvailability?.(marketDate, state.expectedDate, ko ? 'ko' : 'en');
    if (!availability?.stale) return '';
    const tNotice = availability.transparencyNotice;
    const transparencyHtml = tNotice ? (
      `<div class="market-transparency-card">` +
        `<h2 class="market-transparency-title">${html(tNotice.title)}</h2>` +
        `<div class="market-transparency-body">${tNotice.body.map(line => `<p>${html(line)}</p>`).join('')}</div>` +
      `</div>`
    ) : '';
    const noteHtml = availability.notice ? `<p class="market-availability-note">${html(availability.notice)}</p>` : '';
    return `<div class="market-availability" role="status"><p class="market-availability-badge">${html(availability.badge)}</p>${noteHtml}${transparencyHtml}</div>`;
  }

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

  // The selected day, written out: "2026년 11월 23일 월" / "Mon, Nov 23, 2026".
  function fullDateText(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return html(value || '--');
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (ko) return `${y}년 ${m}월 ${d}일 ${copy.weekdays[(date.getUTCDay() + 6) % 7]}`;
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  }

  // Heading of the day: "11월 23일" / "Nov 23".
  function monthDayText(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return html(value || '--');
    const [, m, d] = value.split('-').map(Number);
    return ko ? `${m}월 ${d}일` : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, d)));
  }

  // The page heading every view shares: what this is, the day or period, and its notices.
  function pageHead(title, lead, notices = '', headingId = 'market-close-heading') {
    return `<section class="mk-head" aria-labelledby="${headingId}"><div class="market-wrap">
      <p class="mk-eyebrow">${html(copy.pageEyebrow)}</p>
      <h1 id="${headingId}">${title}</h1>
      ${lead ? `<p class="mk-lead">${lead}</p>` : ''}
      <p class="mk-meta"><span class="market-update">${copy.updateNotice}</span><span class="market-overseas">${copy.overseas.replace(/^\*\s*/, '')}</span></p>
      ${notices}
    </div></section>`;
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
    const isRange = state.mode === '1w' || state.mode === '1m';
    const calendarIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';

    let navHtml;
    if (isRange) {
      const w = state.rangeWindow;
      const badgeText = w?.start_date && w?.end_date
        ? `${dateText(w.start_date)} — ${dateText(w.end_date)} · ${w.sessions_used || 0}/${w.required_sessions || (state.mode === '1w' ? 5 : 20)}`
        : '';
      navHtml = `<span class="market-range-badge">${badgeText}</span>
        <button class="market-calendar-toggle mk-date-btn mk-date-btn-quiet ${state.calendarOpen ? 'active' : ''}" type="button" data-market-action="toggle-calendar" aria-label="${copy.calendarToggle}" aria-expanded="${state.calendarOpen}">${calendarIcon}</button>`;
    } else {
      navHtml = `
        <button class="market-nav-step mk-step" type="button" data-market-action="nav-date" data-target-date="${prevDate}" ${!canGoPrev ? 'disabled' : ''} aria-label="${copy.prevDay}">‹<span class="mk-step-text"> ${copy.prevDay}</span></button>
        <button class="market-calendar-toggle mk-date-btn ${state.calendarOpen ? 'active' : ''}" type="button" data-market-action="toggle-calendar" aria-label="${copy.calendarToggle}" aria-expanded="${state.calendarOpen}">${calendarIcon}<span class="market-current-date">${fullDateText(state.currentDate)}</span><span class="mk-caret" aria-hidden="true">▾</span></button>
        <button class="market-nav-step mk-step" type="button" data-market-action="nav-date" data-target-date="${nextDate}" ${!canGoNext ? 'disabled' : ''} aria-label="${copy.nextDay}"><span class="mk-step-text">${copy.nextDay} </span>›</button>`;
    }

    return `
      <div class="mk-datebar market-history-strip" role="toolbar" aria-label="Market navigation">
        <span class="mk-datebar-label">${copy.dateLabel}</span>
        <div class="mk-datebar-nav market-history-nav${isRange ? ' mk-datebar-range' : ''}">${navHtml}</div>
        <div class="mk-datebar-modes">
          <div class="market-history-modes" role="group" aria-label="${ko ? '보기' : 'View'}">
            <button class="market-mode-btn ${isTodayActive ? 'active' : ''}" type="button" data-market-action="today" ${isTodayActive ? 'aria-current="page"' : ''}>${copy.latestMode}</button>
            <button class="market-mode-btn ${is1wActive ? 'active' : ''}" type="button" data-market-action="view-1w" ${is1wActive ? 'aria-current="page"' : ''}>${copy.weekMode}</button>
            <button class="market-mode-btn ${is1mActive ? 'active' : ''}" type="button" data-market-action="view-1m" ${is1mActive ? 'aria-current="page"' : ''}>${copy.monthMode}</button>
          </div>
          <span class="mk-datebar-links">
            <a class="mk-archive-link" href="${ko ? '/market/' : '/en/market/'}archive/">${copy.archiveLink} <span aria-hidden="true">↗</span></a>
            <a class="mk-archive-link mk-indicator-link" href="${ko ? '/market/' : '/en/market/'}archive/#indicators">${copy.indicatorLink} <span aria-hidden="true">↗</span></a>
          </span>
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
  // `options.globalLatest` ({ items, now }) is passed by the TODAY load only,
  // and is applied only while the page is on TODAY: HISTORY, 1W and 1M are
  // always the Market Close alone, whatever was fetched before.
  function render(data, target = document.getElementById('market-close-root'), options = {}) {
    if (!target || !data || typeof data !== 'object') return;

    state.currentPayload = data;
    const marketDate = data.meta?.market_date || state.currentDate;
    const isHistory = (state.mode === 'history' || (marketDate && state.latestDate && marketDate !== state.latestDate)) && (!state.isLatest || (state.latestDate && marketDate !== state.latestDate));
    const latestInput = options.globalLatest;
    const overlay = latestInput && state.mode === 'today' && !isHistory
      ? root.MARKET_LOCALE?.globalLatestOverlay?.(latestInput.items, data, latestInput.now) || null
      : null;
    const latestItems = overlay?.items || {};
    const mixed = Object.keys(latestItems).length > 0;
    // Trend lines only when they end on the session shown: never a line that stops earlier or later.
    const trend = options.trend && Array.isArray(options.trend.dates) && options.trend.end_date === marketDate ? options.trend : null;
    // KOSPI and KOSDAQ are never Global Latest instruments: their figures are
    // the Market Close exactly as without an overlay.
    const krx = key => key === 'KOSPI' || key === 'KOSDAQ';
    const viewOf = key => ({ latest: krx(key) ? null : latestItems[key] || null, mixed: !krx(key) && mixed, marketDate, trend, history: isHistory });

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
    const shown = (group, key) => group[key] || !OPTIONAL_CODES.includes(key);

    const sourceSet = new Set();
    const collect = obj => {
      Object.values(obj || {}).forEach(item => {
        if (item?.source) sourceSet.add(item.source);
      });
    };
    collect(indices); collect(rates); collect(commodities);

    // Contract 1.2.0 SOFT: unavailable breadth shows its state, never old counts.
    const breadthUnavailable = data.meta?.schema_version === '1.2.0' && data.section_status?.market_breadth?.status === 'unavailable';

    /* ---- the day in brief ---- */
    const kospiPct = indices.KOSPI?.change_pct;
    const kospiWord = !valid(kospiPct) || kospiPct === 0 ? copy.flatWord : kospiPct > 0 ? copy.upWord : copy.downWord;
    const headline = valid(kospiPct) ? copy.summaryHead(number(Math.abs(kospiPct), 2), kospiWord) : html(instrumentName('KOSPI', indices.KOSPI));
    const kospiBreadth = breadth.KOSPI;
    const breadthPart = !breadthUnavailable && kospiBreadth && valid(kospiPct) && kospiPct !== 0
      ? (kospiPct < 0
        ? copy.breadthPhrase(integer(kospiBreadth.fall_count ?? kospiBreadth.fall), ratioPct(kospiBreadth.fall_ratio), copy.downWord)
        : copy.breadthPhrase(integer(kospiBreadth.rise_count ?? kospiBreadth.rise), ratioPct(kospiBreadth.rise_ratio), copy.upWord))
      : '';
    const foreignNet = flows.markets?.KOSPI?.investors?.['외국인']?.net_buy;
    const foreignPart = valid(foreignNet) && foreignNet !== 0
      ? copy.foreignPhrase(flow(Math.abs(foreignNet)).replace('+', ''), foreignNet > 0 ? copy.netBuyWord : copy.netSellWord)
      : '';
    const usdkrw = rates.USDKRW;
    const vix = instrumentView('VIX', rates.VIX, viewOf('VIX'));
    const vixPct = vix.latest ? vix.latest.change_pct : rates.VIX?.change_pct;
    const summary = `<article class="mk-summary" aria-labelledby="mk-summary-title">
      <p class="mk-summary-eyebrow" id="mk-summary-title">${copy.summaryTitle}</p>
      <p class="mk-summary-head">${headline}</p>
      ${breadthPart || foreignPart ? `<p class="mk-summary-sub">${[breadthPart, foreignPart].filter(Boolean).map(html).join(' · ')}</p>` : ''}
      <div class="mk-summary-stats">
        <div><span>${copy.fxSummary}</span><strong>${valueUnit('USDKRW', usdkrw?.data_state === 'unavailable' ? null : usdkrw?.close)}</strong><small>${copy.fixingNote(shortDate(usdkrw?.source_date || marketDate))}</small></div>
        <div><span>${copy.vixSummary}</span><strong>${valueUnit('VIX', vix.display)}${valid(vixPct) ? ` <em class="${signClass(vixPct)}">${pct(vixPct)}</em>` : ''}</strong><small>${vix.latest ? latestStateHtml(vix.latest) : shortDate(rates.VIX?.source_date) ? copy.usCloseNote(shortDate(rates.VIX.source_date)) : ''}</small></div>
      </div>
    </article>`;

    /* ---- Korean market ---- */
    const marketOrder = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'];
    const dayRows = marketOrder.map(key => {
      const inv = flows.markets?.[key]?.investors || {};
      return { name: copy.marketNames[key], values: [inv['외국인']?.net_buy, inv['기관']?.net_buy, inv['개인']?.net_buy] };
    });
    const fiveRows = marketOrder.map(key => {
      const inv = recentFlows.markets?.[key] || {};
      return { name: copy.marketNames[key], values: [inv['외국인'], inv['기관'], inv['개인']] };
    });
    // Contract 1.2.0: a last-5-session window missing a session carries no
    // cumulative numbers, only its availability. Never sum fewer sessions
    // into the five-session slot.
    const fiveDayStatus = data.meta?.schema_version === '1.2.0' ? data.section_status?.five_day_flows : null;
    const fiveDayIncomplete = !!fiveDayStatus && fiveDayStatus.status !== 'complete';
    const fiveDayBody = fiveDayIncomplete
      ? `<div class="market-group-empty market-five-day-status" role="note"><p class="group-empty-title">${html(copy.fiveDayIncomplete(fiveDayStatus.available_sessions ?? 0, fiveDayStatus.expected_sessions ?? 5))}</p>${
        (fiveDayStatus.missing_sessions || []).length ? `<p class="group-empty-desc">${html(copy.fiveDayMissing(fiveDayStatus.missing_sessions.map(monthDayText).join(', ')))}</p>` : ''}</div>`
      : `${flowTable(fiveRows)}<p class="mk-unit">${dateText(recentFlows.start_date)} – ${dateText(recentFlows.end_date)}</p>`;
    const flowsCard = `<section class="mk-card mk-flows" aria-labelledby="mk-flows-title">
      <div class="mk-card-head"><h3 id="mk-flows-title">${copy.flowsTitle}</h3>
        <div class="mk-toggle" role="group" aria-label="${html(copy.flowsTitle)}">
          <button type="button" class="mk-toggle-btn" data-market-action="flow-period" data-period="day" aria-pressed="true">${copy.flowDay}</button>
          <button type="button" class="mk-toggle-btn" data-market-action="flow-period" data-period="five" aria-pressed="false">${copy.flowFive}</button>
        </div>
      </div>
      <div class="mk-flow-panel" data-flow-panel="day">${flowTable(dayRows)}</div>
      <div class="mk-flow-panel" data-flow-panel="five" hidden>${fiveDayBody}</div>
      <p class="mk-unit">${copy.flowNote}</p>
    </section>`;

    const breadthCardHtml = `<section class="mk-card mk-breadth-card" aria-labelledby="mk-breadth-title">
      <div class="mk-card-head"><h3 id="mk-breadth-title">${termLink(copy.sections[3], copy.terms.breadth)}</h3><span class="mk-card-note">${copy.breadthCaption}</span></div>
      ${breadthUnavailable
        ? `<div class="market-group-empty market-breadth-status" role="note"><p class="group-empty-title">${html(copy.breadthUnavailable)}</p><p class="group-empty-desc">${html(copy.breadthUnavailableDesc)}</p></div>`
        : ['KOSPI', 'KOSDAQ'].map(key => breadthBlock(key, breadth[key])).join('')}
    </section>`;

    const programItem = key => program.program_trading?.[key]?.net_buy_won;
    const stat = (label, value, sub = '', cls = '', term = '') => `<div class="mk-stat"><span>${termLink(label, term)}</span><strong class="${cls}">${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const stats = [
      ...['KOSPI', 'KOSDAQ'].map(key => stat(copy.turnoverOf(copy.marketNames[key]), won(internals.turnover?.[key]?.value_won), valid(internals.turnover?.[key]?.ratio5) ? html(copy.ratio5Text(number(internals.turnover[key].ratio5, 2))) : '')),
      stat(copy.programTotal, valid(programItem('전체')) ? signedWon(programItem('전체')) : '--', `${localName('차익')} ${valid(programItem('차익')) ? signedWon(programItem('차익')) : '--'} · ${localName('비차익')} ${valid(programItem('비차익')) ? signedWon(programItem('비차익')) : '--'}`, signClass(programItem('전체')), copy.terms.program),
      stat(copy.basis, signed(program.basis?.basis, 2), `<span class="state-chip">${html(basisState(program.basis?.market_state))}</span> ${html(copy.spot)} ${number(program.basis?.kospi200_spot, 2)} · <span>${html(futureLabel(program.basis?.future_name))}</span> ${number(program.basis?.future, 2)}`, signClass(program.basis?.basis), copy.terms.basis),
      ...['KOSPI', 'KOSDAQ'].map(key => stat(copy.shortRatioOf(copy.marketNames[key]), ratioPct(shorts.market_summary?.[key]?.short_value_ratio), `${copy.shortAmount} ${won(shorts.market_summary?.[key]?.short_value_won)}`, '', copy.terms.short))
    ].join('');

    const concentration = internals.concentration || {};
    const concentrationItems = [
      [copy.foreignBuy, concentration['외국인']?.buy],
      [copy.foreignSell, concentration['외국인']?.sell],
      [copy.institutionBuy, concentration['기관']?.buy],
      [copy.institutionSell, concentration['기관']?.sell]
    ].filter(entry => entry[1]);
    const shortScopeNote = ['KOSPI', 'KOSDAQ'].some(key => /NXT/.test(String(shorts.market_summary?.[key]?.coverage_scope || '')))
      ? `<p class="unit-note">${html(copy.shortRatioScope)}</p>` : '';
    const shortList = (items, isRatio = false) => !(items || []).length ? `<p class="unit-note">${copy.regularUnavailable}</p>` : `<ol class="rank-list">${(items || []).map((item, index) => `<li><span>${index + 1}. <b>${html(companyName(item))}</b><small>${html(item?.market || '')}</small></span><strong>${isRatio ? ratioPct(item?.short_value_ratio) : won(item?.short_value_won)}</strong></li>`).join('')}</ol>`;
    const statsCard = `<section class="mk-card mk-stats-card" aria-labelledby="mk-stats-title">
      <div class="mk-card-head"><h3 id="mk-stats-title">${copy.statsTitle}</h3></div>
      <div class="mk-stats">${stats}</div>
      <details class="mk-details"><summary>${copy.detailsMore}</summary>
        <div class="short-ranks"><div><h4>${copy.shortValue}</h4>${shortList(shorts.top5_by_value)}</div><div><h4>${copy.shortRatio}</h4>${shortList(shorts.top5_by_ratio, true)}</div></div>${shortScopeNote}
        <h4 class="subsection-title">${copy.concentration}</h4><div class="concentration-grid">${concentrationItems.length ? concentrationItems.map(([label, item]) => `<div><span>${label}</span><b>${copy.top1} ${ratioPct(item?.top1_ratio)} · ${copy.top5} ${ratioPct(item?.top5_ratio)}</b><small>${html(companyName(item))}</small></div>`).join('') : `<p class="unit-note">${copy.concentrationUnavailable}</p>`}</div>
      </details>
    </section>`;

    const topCard = `<section class="mk-card mk-top-card" aria-labelledby="mk-top-title">
      <div class="mk-card-head"><h3 id="mk-top-title">${copy.topTitle}</h3><span class="mk-card-note">${copy.regularClose}</span></div>
      <div class="mk-table-wrap"><table class="mk-table mk-cap-table"><thead><tr><th scope="col">${copy.stock}</th><th scope="col">${copy.price}</th><th scope="col">${copy.change}</th><th scope="col" class="mk-col-cap">${copy.marketCap}</th></tr></thead><tbody>${marketCap.map(item => `<tr><th scope="row"><span class="mk-rank">${html(item?.rank ?? '--')}</span><span class="stock-name"><b>${html(companyName(item))}</b><small>${html(item?.market || '')} · ${html(item?.ticker || '')}</small></span></th><td>${valid(item?.close) ? `${number(item.close, 0)}${ko ? '원' : ''}` : '--'}</td><td><span class="${signClass(item?.change_pct)}">${pct(item?.change_pct)}</span></td><td class="mk-col-cap">${won(item?.market_cap_won)}</td></tr>`).join('')}</tbody></table></div>
    </section>`;

    // Stock rankings (SOFT, optional): a record made before 2026-11-23 has no
    // status and shows no card; an unavailable one says so.
    const rankingState = data.meta?.schema_version === '1.2.0' ? data.section_status?.stock_rankings?.status : undefined;
    const rankingMarkets = data.stock_rankings?.markets;
    // Trading value in a ranking row: short, so a small stock's value fits one line.
    const rankingWon = value => {
      if (!valid(value)) return '--';
      const abs = Math.abs(value);
      if (abs >= 1e9) return won(value);
      if (ko) return abs >= 1e8 ? `${number(value / 1e8, 1)}억원` : `${number(value / 1e4, 0)}만원`;
      return `KRW ${number(value / 1e6, 0)}M`;
    };
    const rankingRow = (item, index, kind) => {
      const limit = item?.price_limit === 'upper' ? `<em class="ranking-limit up">${html(copy.limitUp)}</em>`
        : item?.price_limit === 'lower' ? `<em class="ranking-limit down">${html(copy.limitDown)}</em>` : '';
      const close = valid(item?.close) ? `${number(item.close, 0)}${ko ? '원' : ''}` : '--';
      const turnover = kind === 'top_turnover';
      const detail = turnover
        ? `${close} · <span class="${signClass(item?.change_pct)}">${pct(item?.change_pct)}</span>`
        : `${close} · ${html(copy.tradingValue)} ${rankingWon(item?.trading_value_won)}`;
      return `<li><span class="ranking-rank">${index + 1}</span><span class="ranking-stock"><span class="ranking-name"><b>${html(companyName(item))}</b>${limit}</span><small>${detail}</small></span><strong class="${turnover ? 'neutral' : signClass(item?.change_pct)}">${turnover ? rankingWon(item?.trading_value_won) : pct(item?.change_pct)}</strong></li>`;
    };
    const rankingBlock = (title, rows, kind) => `<div class="ranking-block"><h4>${html(title)}</h4>${(rows || []).length
      ? `<ol class="ranking-list">${rows.map((item, index) => rankingRow(item, index, kind)).join('')}</ol>`
      : `<p class="unit-note">${html(copy.rankingsNone)}</p>`}</div>`;
    const rankingCount = value => `<b>${integer(value)}</b>${copy.stocksUnit ? html(copy.stocksUnit) : ''}`;
    const rankingsBody = !rankingState ? ''
      : rankingState !== 'complete' || !rankingMarkets ? `<p class="unit-note">${html(copy.rankingsUnavailable)}</p>`
        : `<div class="ranking-markets">${['KOSPI', 'KOSDAQ'].filter(key => rankingMarkets[key]).map(key => {
          const item = rankingMarkets[key];
          return `<article class="ranking-market"><div class="ranking-market-head"><h4>${key}</h4><p class="ranking-52w"><span>${html(copy.high52)} ${rankingCount(item.new_high_52w)}</span><span>${html(copy.low52)} ${rankingCount(item.new_low_52w)}</span><span class="ranking-52w-basis">${html(copy.high52Basis)}</span></p></div><div class="ranking-lists">${rankingBlock(copy.rankGainers, item.top_gainers, 'top_gainers')}${rankingBlock(copy.rankLosers, item.top_losers, 'top_losers')}${rankingBlock(copy.rankTurnover, item.top_turnover, 'top_turnover')}</div></article>`;
        }).join('')}</div><p class="mk-unit">${html(copy.rankingsNote)}</p>`;
    // KOFIA market funds (their own dataset, a business day late). A past date
    // shows its own day only; TODAY shows the newest stored day up to the
    // record's date, at most 10 days older, with its date on the card.
    const funds = options.marketFunds;
    const fundsAge = funds && marketDate && /^\d{4}-\d{2}-\d{2}$/.test(String(funds.market_date || ''))
      ? (Date.parse(`${marketDate}T00:00:00Z`) - Date.parse(`${funds.market_date}T00:00:00Z`)) / 86400000
      : null;
    const fundsShown = funds && (isHistory ? funds.market_date === marketDate : fundsAge !== null && fundsAge >= 0 && fundsAge <= 10);
    const fundsCard = fundsShown ? root.MARKET_LOCALE?.marketFundsCard?.(funds, ko ? 'ko' : 'en', { dateLabel: dateText(funds.market_date) }) || '' : '';
    const rankingsCard = rankingsBody ? `<section class="mk-card mk-rankings-card" aria-labelledby="mk-rankings-title">
      <div class="mk-card-head"><h3 id="mk-rankings-title">${html(copy.rankingsTitle)}</h3><span class="mk-card-note">${copy.regularClose}</span></div>
      ${rankingsBody}
    </section>` : '';

    /* ---- overseas, rates, FX, commodities ---- */
    const row = (group, key) => boardRow(key, group[key], viewOf(key));
    const worldRows = [
      ...['NASDAQ', 'DOW', 'SP500'].map(key => row(indices, key)),
      row(rates, 'SOX'),
      ...ASIA_CODES.filter(key => indices[key]).map(key => row(indices, key)),
      ...['VIX', 'VKOSPI'].filter(key => shown(rates, key)).map(key => row(rates, key))
    ].join('');
    const kofiaRows = domesticRateRows(options.domesticRates, marketDate, trend);
    const ratesRows = `${row(rates, 'US10Y')}${kofiaRows}`;
    const fxRows = ['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY'].filter(key => shown(rates, key)).map(key => row(rates, key)).join('');
    const commodityRows = ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER', 'BITCOIN'].filter(key => shown(commodities, key)).map(key => row(commodities, key)).join('');
    const boardIds = ['world', 'rates', 'fx', 'commodities'];
    const boards = `<div class="mk-board-tabs" role="group" aria-label="${html(copy.globalTitle)}">${boardIds.map((id, index) => `<button type="button" class="mk-board-tab" data-market-action="board-tab" data-board-tab="${id}" aria-pressed="${index === 0}">${copy.tabs[id]}</button>`).join('')}</div>
      <div class="mk-boards" data-active-board="world">
        <div class="mk-board-col">
          ${boardCard('world', copy.boards.world, copy.boardNotes.world, worldRows)}
          ${boardCard('rates', copy.boards.rates, copy.boardNotes.rates, ratesRows, kofiaRows ? `<p class="mk-unit">${html(copy.ratesNote)}</p>` : (isHistory ? '' : `<p class="mk-unit">${html(copy.ratesPending)}</p>`))}
        </div>
        <div class="mk-board-col">
          ${boardCard('fx', copy.boards.fx, copy.boardNotes.fx, fxRows)}
          ${boardCard('commodities', copy.boards.commodities, copy.boardNotes.commodities, commodityRows)}
        </div>
      </div>`;

    // Exact Daily Report link for the shown session.
    const exactDaily = findExactDaily(marketDate);
    let reportCtaHtml = '';
    if (exactDaily) {
      const cleanHref = exactDaily.href
        ? `https://snowshagal.com/${String(exactDaily.href).replace(/^\/+/, '').replace(/\.html?$/i, '')}`
        : '#';
      reportCtaHtml = `<a class="market-report-cta" href="${html(cleanHref)}">${html(isHistory ? copy.historyReport : copy.latestReport)} <span aria-hidden="true">↗</span></a>`;
    } else if (isHistory) {
      reportCtaHtml = `<p class="market-report-unavailable">${copy.noDailyReport}</p>`;
    }

    const notices = `${sessionNotice(marketDate, isHistory)}${availabilityNotice(marketDate, isHistory)}${integrityNotice(marketDate)}`;
    const output = `
      ${pageHead(/^\d{4}-\d{2}-\d{2}$/.test(String(marketDate || '')) ? html(copy.pageTitle(monthDayText(marketDate))) : copy.pageTitleToday, html(copy.pageLead), notices ? `<div class="mk-notices">${notices}</div>` : '')}
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div id="market-dashboard-view" class="market-wrap market-dashboard mk-dashboard" data-global-latest="${Object.keys(latestItems).length}">
        <div class="mk-close-line"><p><b>${html(copy.closeOf(monthDayText(marketDate)))}</b> <span>${copy.regularBasis}</span></p>${reportCtaHtml}</div>
        <div class="mk-top">
          ${indexCard('KOSPI', indices.KOSPI, viewOf('KOSPI'))}
          ${indexCard('KOSDAQ', indices.KOSDAQ, viewOf('KOSDAQ'))}
          ${summary}
        </div>
        <section class="mk-section" aria-labelledby="mk-kr-title">
          <div class="mk-section-head"><h2 id="mk-kr-title">${copy.krTitle}</h2><span>${copy.krCaption}</span></div>
          <div class="mk-grid mk-grid-kr">${flowsCard}${breadthCardHtml}</div>
          <div class="mk-grid mk-grid-kr2">${statsCard}${topCard}</div>
          ${fundsCard ? `<div class="mk-funds-row">${fundsCard}</div>` : ''}
          ${rankingsCard ? `<div class="mk-grid-full">${rankingsCard}</div>` : ''}
        </section>
        <section class="mk-section" aria-labelledby="mk-global-title">
          <div class="mk-section-head"><h2 id="mk-global-title">${copy.globalTitle}</h2><span>${copy.globalCaption}</span></div>
          ${boards}
        </section>
        <div class="market-data-note"><p>${copy.source}: ${html(sourceLine(Array.from(sourceSet)))}</p><p>${html(generatedAtText(data.meta?.generated_at))} · ${html(data.meta?.schema_version || '')}</p></div>
        <p class="market-archive-links">${/^\d{4}-\d{2}-\d{2}$/.test(String(marketDate || '')) ? `<a href="${ko ? '/market/' : '/en/market/'}${html(marketDate)}/">${html(copy.sessionPage)} →</a>` : ''}<a href="${ko ? '/market/' : '/en/market/'}archive/">${html(copy.archivePage)} →</a><a href="${ko ? '/market/' : '/en/market/'}sectors/">${html(copy.sectorsPage)} →</a><a href="${ko ? '/market/' : '/en/market/'}investor-flows/">${html(copy.flowsPage)} →</a><a href="${ko ? '/market/' : '/en/market/'}archive/#indicators">${html(copy.indicatorsPage)} →</a></p>
      </div>`;
    target.innerHTML = output;
    bindEvents(target);
  }

  /* ==========================================================================
     1W & 1M Range Aggregation Renderer
     ========================================================================== */
  // An optional indicator is shown once the window starts with it, so a period never
  // compares against a day it was not recorded.
  const rangeShown = (key, item) => Boolean(item) && (!OPTIONAL_CODES.includes(key) || valid(item.baseline_value));

  // The period's line: the value before the window (baseline_value, where the
  // period return starts) and each session's value after it. Drawn only when the
  // window ends with a value (trendSvg), so it always ends on the figure shown.
  function rangeTrend(item) {
    if (!valid(item?.baseline_value) || !Array.isArray(item?.series) || !item.series.length) return '';
    const line = trendSvg([item.baseline_value, ...item.series], { w: 160, h: 30, pad: 3 });
    return line ? `<div class="range-item-trend">${line}</div>` : '';
  }

  function renderRangeInstrumentRow(key, item) {
    if (!rangeShown(key, item)) return '';
    const name = instrumentName(key, item);
    const baseline = valid(item.baseline_value) ? number(item.baseline_value, digitsOf(key)) : '--';
    const end = valid(item.end_value) ? number(item.end_value, digitsOf(key)) : '--';
    const returnStr = valid(item.return_pct) ? `${signed(item.return_pct, 2)}%` : '--';
    const returnCls = signClass(item.return_pct);
    const highLow = (valid(item.period_high) && valid(item.period_low))
      ? `<span class="range-hl">H ${number(item.period_high, digitsOf(key))} · L ${number(item.period_low, digitsOf(key))}</span>`
      : '';

    return `
      <div class="range-item-row">
        <div class="range-item-name">
          <strong>${historyLink(key, html(name))}</strong>
          ${highLow}
        </div>
        ${rangeTrend(item)}
        <div class="range-item-values">
          <span class="range-path">${baseline} <span class="range-arrow">→</span> ${end}</span>
          <strong class="range-return ${returnCls}">${returnStr}</strong>
        </div>
      </div>`;
  }

  function renderRangeRatesFxRow(key, item) {
    if (!rangeShown(key, item)) return '';
    const name = instrumentName(key, item);
    const isUs10y = key === 'US10Y';
    const isFx = isFixing(key);

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
          <strong>${historyLink(key, html(name))}</strong>
        </div>
        ${rangeTrend(item)}
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
                  <b>${html(groupName(it))}</b>
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
      ${pageHead(html(pTitle), [dateRangeStr, html(statusNote)].filter(Boolean).join(' · '), '', 'market-range-heading')}
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div id="market-dashboard-view" class="market-wrap market-dashboard market-range-dashboard">
        ${section('01', ko ? '주요 지수' : 'Major Indices', `
          <div class="range-items-grid">
            ${['KOSPI', 'KOSDAQ', 'NASDAQ', 'DOW', 'SP500', 'SOX', ...ASIA_CODES].map(k => k === 'SOX' ? renderRangeInstrumentRow(k, rates[k]) : renderRangeInstrumentRow(k, indices[k])).join('')}
          </div>`)}
        <div class="market-pair">
          ${section('02', ko ? '금리 · 환율 · 변동성' : 'Rates · FX · Volatility', `
            <div class="range-items-grid">
              ${['US10Y', 'USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY', 'VIX', 'VKOSPI'].map(k => renderRangeRatesFxRow(k, rates[k])).join('')}
            </div>`)}
          ${section('03', ko ? '자산별 성과' : 'Cross Asset Performance', `
            <div class="range-items-grid">
              ${['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER', 'BITCOIN'].map(k => renderRangeInstrumentRow(k, commodities[k])).join('')}
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
    } else if (action === 'flow-period') {
      // Today's flows or the last five sessions': one table shown at a time.
      const card = button.closest('.mk-flows');
      const period = button.dataset.period;
      card?.querySelectorAll('[data-market-action="flow-period"]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.period === period)));
      card?.querySelectorAll('[data-flow-panel]').forEach(panel => { panel.hidden = panel.dataset.flowPanel !== period; });
    } else if (action === 'board-tab') {
      // Phone width: one board at a time (the CSS reads data-active-board); wider screens show all four.
      const tab = button.dataset.boardTab;
      const section = button.closest('.mk-section');
      const boards = section?.querySelector('.mk-boards');
      if (boards) boards.dataset.activeBoard = tab;
      section?.querySelectorAll('[data-market-action="board-tab"]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.boardTab === tab)));
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

    const token = ++state.loadToken;
    const superseded = () => token !== state.loadToken;
    state.mode = mode;
    state.currentDate = targetDate;
    state.isLatest = mode === 'today';

    const dashboardView = document.getElementById('market-dashboard-view');
    // The server's first HTML already holds the newest session (data-ssr-date):
    // keep it at full strength while TODAY loads; dim anything else.
    if (dashboardView && !(mode === 'today' && dashboardView.dataset?.ssrDate)) {
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
        if (superseded()) return;
        renderRangeView(data, mode, rootEl);
      } else if (mode === 'history' && targetDate) {
        const dateEndpoint = `/api/market/date?date=${encodeURIComponent(targetDate)}`;
        const ratesRequest = fetchDomesticRates(targetDate);
        const fundsRequest = fetchMarketFunds(targetDate);
        const trendRequest = fetchTrend(targetDate);
        const response = await fetch(dateEndpoint, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          if (response.status === 404) {
            return renderDateNotFound(targetDate, rootEl);
          }
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const [domesticRates, marketFunds, trend] = await Promise.all([ratesRequest, fundsRequest, trendRequest]);
        if (superseded()) return;
        render(data, rootEl, { domesticRates, marketFunds, trend });
      } else {
        // Today: the Market Close, and Global Latest for the global cards,
        // requested together; a Global Latest failure only leaves it out.
        const latestRequest = fetchGlobalLatest();
        // The newest stored KOFIA day; shown only when it is the record's own date.
        const ratesRequest = fetchDomesticRates('latest');
        // The newest stored market funds day; usually the session before the record's.
        const fundsRequest = fetchMarketFunds('latest');
        const trendRequest = fetchTrend(null);
        const source = document.body.dataset.marketSource || '/api/market/latest';
        const response = await fetch(source, { headers: { Accept: 'application/json' } });
        if (!response.ok) {
          if (await renderPreviewFixture(rootEl)) return;
          if (response.status === 404) {
            const hasStatic = Boolean(rootEl.querySelector('#market-dashboard-view') || rootEl.querySelector('.market-section'));
            if (hasStatic) return renderFallbackNotice(rootEl);
            return renderEmpty(rootEl);
          }
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const [latest, domesticRates, marketFunds, trend] = await Promise.all([latestRequest, ratesRequest, fundsRequest, trendRequest]);
        if (superseded()) return;
        state.currentDate = data.meta?.market_date || null;
        state.expectedDate = response.headers?.get?.(EXPECTED_MARKET_DATE_HEADER) || null;
        state.krxSession = root.MARKET_LOCALE?.parseKrxSessionHeader?.(response.headers?.get?.(KRX_SESSION_HEADER)) || null;
        const globalLatest = latest
          ? { items: latest.items, now: root.MARKET_LOCALE.globalLatestNow(latest.servedAt, Date.now()) }
          : null;
        render(data, rootEl, { globalLatest, domesticRates, marketFunds, trend });
      }
    } catch (error) {
      console.error('Failed to load market close data', error);
      const hasStatic = Boolean(rootEl.querySelector('#market-dashboard-view') || rootEl.querySelector('.market-section'));
      if (mode === 'today' && hasStatic) {
        renderFallbackNotice(rootEl);
      } else {
        renderError(rootEl);
      }
    }
  }

  function renderFallbackNotice(target = document.getElementById('market-close-root')) {
    if (!target) return;
    const dashboardView = target.querySelector('#market-dashboard-view');
    if (dashboardView) {
      dashboardView.classList.remove('is-loading');
    }
    let notice = target.querySelector('#market-fallback-notice');
    if (!notice) {
      const noticeHtml = `
        <div class="market-wrap">
          <aside id="market-fallback-notice" class="market-fallback-notice" role="status" aria-live="polite">
            <p class="market-fallback-text">${copy.fallbackNotice}</p>
            <button class="market-fallback-retry" type="button" data-market-action="retry">${copy.retry}</button>
          </aside>
        </div>`;
      if (dashboardView) {
        dashboardView.insertAdjacentHTML('beforebegin', noticeHtml);
      } else {
        target.insertAdjacentHTML('afterbegin', noticeHtml);
      }
    }
    bindEvents(target);
  }

  function renderDateNotFound(dateStr, target = document.getElementById('market-close-root')) {
    if (!target) return;
    target.innerHTML = `
      ${pageHead(html(copy.pageTitle(monthDayText(dateStr))), html(copy.pageLead))}
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div class="market-wrap">
        <section class="market-state market-not-found" role="alert">
          <img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true">
          <h2>${copy.dateNotFoundTitle}</h2>
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
      ${pageHead(html(pTitle), '', '', 'market-range-heading')}
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div class="market-wrap">
        <section class="market-state" role="alert">
          <img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true">
          <h2>${copy.rangeLoadError}</h2>
          <button class="market-retry" type="button" data-market-action="retry">${copy.retry}</button>
        </section>
      </div>`;
    bindEvents(target);
  }

  function renderError(target = document.getElementById('market-close-root')) {
    if (!target) return;
    const hasStatic = Boolean(target.querySelector('#market-dashboard-view') || target.querySelector('.market-section'));
    if (hasStatic) {
      renderFallbackNotice(target);
      return;
    }
    target.innerHTML = `
      ${pageHead(copy.pageTitleToday, html(copy.pageLead))}
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div class="market-wrap">
        <section class="market-state" role="alert">
          <img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true">
          <h2>${copy.loadError}</h2>
          <button class="market-retry" type="button" data-market-action="retry">${copy.retry}</button>
        </section>
      </div>`;
    bindEvents(target);
  }

  function renderEmpty(target = document.getElementById('market-close-root')) {
    if (!target) return;
    const hasStatic = Boolean(target.querySelector('#market-dashboard-view') || target.querySelector('.market-section'));
    if (hasStatic) {
      renderFallbackNotice(target);
      return;
    }
    target.innerHTML = `
      ${pageHead(copy.pageTitleToday, html(copy.pageLead))}
      <div class="market-wrap">
        ${renderHistoryStrip()}
      </div>
      <div class="market-wrap">
        <section class="market-state">
          <img class="market-state-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true">
          <h2>${copy.emptyTitle}</h2>
          <p>${copy.emptyBody}</p>
        </section>
      </div>`;
    bindEvents(target);
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
    const rootEl = document.getElementById('market-close-root');
    if (!rootEl) return;

    bindEvents(rootEl);

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
    renderFallbackNotice,
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
