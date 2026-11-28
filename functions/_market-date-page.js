// One page per published KRX session: /market/YYYY-MM-DD/ (KO) and
// /en/market/YYYY-MM-DD/ (EN), plus the list of every session at
// /market/archive/ and /en/market/archive/.
//
// /market/ shows the latest close and builds everything in the browser, so a
// crawler sees no numbers and no past session has an address of its own.
// These pages are rendered on the server, numbers included, from the same
// final Market Close rows /api/market/date serves (D1
// `market_close_snapshots`). Nothing is collected or stored for them.
//
// The page is the /market/ shell, with the head rewritten for the session and
// <main> replaced. The shell keeps the header, footer, search and theme
// scripts. The dashboard script is dropped, so nothing repaints the page.
// Classes come from assets/market-close.css, so the sections look like
// /market/. Number formats follow assets/market-close.js.
import {
  PRODUCTION_ORIGIN,
  escapeHtml,
  findTranslationCounterpart,
  formatFlowAmount,
  formatIndexLevel,
  formatSignedPct,
  loadPosts,
  reportSiteUrl,
  organizationStructuredData,
  serializeJsonLd,
  websiteStructuredData
} from './_seo.js';
import '../assets/locale.js';
import { TABLE_NAME, ensureMarketTable, normalizeKrwPairs } from './api/market/_shared.js';
import { applyFxClose } from './api/market/_fx-merge.js';
import { temporaryDataPage } from './_temporary-page.js';
import { loadFxCloseDay, loadFxCloseDays } from './api/market/fx/_shared.js';
import { aggregateKrxGroups } from './api/market/_aggregate.js';
import { loadTrend } from './api/market/trend.js';
import { cardImageUrl, cardTakeaway, ensureMarketCard, marketCardIsStale, onMarketCardRequest, parseMarketCardPath, readMarketCardMeta } from './_market-card.js';
import { glossaryTermHref } from './_glossary.js';
import { isMarketYearSupported, isTradingDate, shiftDate } from './_trading-calendar.js';
import {
  domesticRateCodesIn,
  loadDomesticRateCodes,
  loadDomesticRatesDay,
  loadDomesticRatesDays
} from './api/market/rates/_shared.js';
import {
  loadMarketFundCodes,
  loadMarketFundsDay,
  loadMarketFundsDays,
  marketFundCodesIn
} from './api/market/funds/_shared.js';
import {
  MARKET_INDICATORS,
  OPTIONAL_INDICATOR_CLOSES_SQL,
  availableIndicatorCodes,
  isDomesticRateIndicator,
  isMarketFundIndicator,
  isOptionalIndicator,
  listedIndicators,
  marketIndicatorBySlug,
  marketIndicatorPath
} from './_market-indicators.js';

export { MARKET_INDICATORS, availableIndicatorCodes, listedIndicators, marketIndicatorBySlug, marketIndicatorPath };

// KRW pairs whose close is Hana Bank's posted rate from its last round before 15:30 KST.
const FIXING_CODES = new Set(['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW']);
// Asian indices (kind `asia`): dated the local session; on a local holiday the
// record carries the previous close with its own, earlier date.
const ASIA_CODES = Object.freeze(['NIKKEI225', 'SHANGHAI', 'TAIEX']);
// Decimal places of a price and its change (Bitcoin prices are whole dollars).
const digitsOf = (key) => (key === 'NATGAS' || key === 'COMEX_COPPER' ? 3 : 2);
const USD_PRICED = new Set(['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER']);
// Yields: values in percent, changes in basis points.
const isYield = (key) => key === 'US10Y' || isDomesticRateIndicator(key);
// KOFIA publishes bond yields with 3 decimals and the CD rate with 2.
const rateDigits = (key) => (key === 'CD91' ? 2 : 3);

export const MARKET_DATE_TIME_BUDGET_MS = 5000;
// The trend lines decorate a session page; it never waits longer than this for them.
export const MARKET_TREND_BUDGET_MS = 1500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const html = escapeHtml;
const valid = (value) => typeof value === 'number' && Number.isFinite(value);

/* ------------------------------------------------------------------ paths */

export function marketDatePath(date, lang = 'ko') {
  return `${lang === 'en' ? '/en' : ''}/market/${date}/`;
}

export function marketArchivePath(lang = 'ko') {
  return `${lang === 'en' ? '/en' : ''}/market/archive/`;
}

/**
 * { lang, date } for a session page, { lang, archive: true } for the list,
 * { lang, sectors: true } for the sector and theme rankings,
 * { lang, flows: true } for net buying by investor type,
 * { lang, indicator } for one instrument's daily history,
 * or null for any other path. `canonical` is false when the path lacks the
 * trailing slash the canonical address has.
 */
export function parseMarketPagePath(pathname) {
  const match = String(pathname || '').match(/^\/(en\/)?market\/(\d{4}-\d{2}-\d{2}|archive|sectors|[a-z0-9]+(?:-[a-z0-9]+)*)(\/?)$/);
  if (!match) return null;
  const lang = match[1] ? 'en' : 'ko';
  const canonical = match[3] === '/';
  if (match[2] === 'archive') return { lang, archive: true, canonical };
  if (match[2] === 'sectors') return { lang, sectors: true, canonical };
  if (match[2] === 'investor-flows') return { lang, flows: true, canonical };
  const indicator = marketIndicatorBySlug(match[2]);
  if (indicator) return { lang, indicator, canonical };
  if (!isCalendarDate(match[2])) return null;
  return { lang, date: match[2], canonical };
}

function isCalendarDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/* ------------------------------------------------------------- formatting */

const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KO_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateParts(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "2026년 10월 28일" / "Oct 28, 2026" */
export function longDate(value, lang) {
  const { y, m, d } = dateParts(value);
  return lang === 'en' ? `${EN_MONTHS_SHORT[m - 1]} ${d}, ${y}` : `${y}년 ${m}월 ${d}일`;
}

/** "10월 28일(수)" / "Wed, Oct 28" */
function dayLabel(value, lang) {
  const { m, d, weekday } = dateParts(value);
  return lang === 'en' ? `${EN_WEEKDAYS[weekday]}, ${EN_MONTHS_SHORT[m - 1]} ${d}` : `${m}월 ${d}일(${KO_WEEKDAYS[weekday]})`;
}

/** "2026.10.28" / "Oct 28, 2026" — the stamp the dashboard prints. */
function dotDate(value, lang) {
  if (!ISO_DATE.test(String(value || ''))) return html(value || '--');
  const { y, m, d } = dateParts(value);
  return lang === 'en' ? `${EN_MONTHS_SHORT[m - 1]} ${String(d).padStart(2, '0')}, ${y}` : `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
}

export function makeFormat(lang) {
  const ko = lang !== 'en';
  const number = (value, digits = 2) => valid(value)
    ? new Intl.NumberFormat(ko ? 'ko-KR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    : '--';
  const integer = (value) => valid(value) ? new Intl.NumberFormat(ko ? 'ko-KR' : 'en-US', { maximumFractionDigits: 0 }).format(value) : '--';
  const signClass = (value) => !valid(value) || value === 0 ? 'neutral' : value > 0 ? 'up' : 'down';
  const signed = (value, digits = 2) => valid(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value), digits)}` : '--';
  const pct = (value) => valid(value) ? `${signed(value, 2)}%` : '--';
  const ratioPct = (value) => valid(value) ? `${number(value * 100, 1)}%` : '--';
  const won = (value) => {
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
  // Investor flows arrive in KRW billion.
  const flow = (value) => {
    if (!valid(value)) return '--';
    const abs = Math.abs(value * 1e9);
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    if (ko) return abs >= 1e12 ? `${sign}${number(abs / 1e12, 2)}조원` : `${sign}${number(abs / 1e8, 0)}억원`;
    return abs >= 1e12 ? `KRW ${sign}${number(abs / 1e12, 2)}tn` : `KRW ${sign}${number(abs / 1e9, 0)}bn`;
  };
  const valueUnit = (key, value) => {
    if (!valid(value)) return '--';
    if (key === 'US10Y') return `${number(value, 3)}%`;
    if (isDomesticRateIndicator(key)) return `${number(value, rateDigits(key))}%`;
    if (isMarketFundIndicator(key)) return globalThis.MARKET_LOCALE.marketFundAmount(value, ko ? 'ko' : 'en');
    if (FIXING_CODES.has(key)) return ko ? `${number(value, 2)}원` : `₩${number(value, 2)}`;
    if (key === 'USDJPY') return ko ? `${number(value, 2)}엔` : `¥${number(value, 2)}`;
    if (key === 'BITCOIN') return `$${number(value, 0)}`;
    if (USD_PRICED.has(key)) return `$${number(value, digitsOf(key))}`;
    return number(value, 2);
  };
  return { ko, number, integer, signClass, signed, pct, ratioPct, won, flow, valueUnit };
}

/* ------------------------------------------------------------------- copy */

const COPY = {
  ko: {
    eyebrow: '일별 마감 기록',
    heading: date => `${longDate(date, 'ko')} 한국 증시 마감`,
    closeBasis: '15:30 KST 정규장 마감 기준',
    overseas: '* 해외 지수·원자재는 각 시장의 최신 거래일 종가',
    sections: ['주요 지수', '투자자별 매매동향 (당일)', '최근 5거래일 누적 수급', '금리 · 환율 · 변동성', '원자재 · 가상자산', '시장 폭', 'KRX 업종 · 테마 등락률', '시가총액 상위 10종목', '공매도 현황', '국내 금리'],
    asiaTitle: '아시아 증시', localHoliday: '현지 휴장',
    open: '시가', high: '고가', low: '저가', previous: '전일', closeState: '종가', fixedClose: '하나은행 고시', seoulClose: '15:30 기준가', provisionalBank: '잠정 · 하나은행 고시', intraday: '장중', unavailable: '데이터 없음',
    market: '시장', foreign: '외국인', institution: '기관', individual: '개인', futures: '선물',
    fiveDays: (start, end) => `${start} – ${end}`,
    fiveDayIncomplete: (used, total) => `데이터 불완전 · ${used}/${total} 거래일 확보`,
    rise: '상승', fall: '하락', flat: '보합', upper: '상한가', lower: '하한가', riseRatio: '상승비율', fallRatio: '하락비율',
    breadthUnavailable: '이날 시장 폭 데이터 없음',
    sectors: '업종', themes: '테마', strongest: '상승 상위', weakest: '하락 상위',
    allSectors: n => `업종 전체 ${n}개 보기`, allThemes: n => `테마 전체 ${n}개 보기`,
    groupColumns: ['순위', '이름', '시장', '종가', '등락률'],
    capColumns: ['순위', '종목명', '종가', '등락률', '시가총액'],
    rankingsTitle: '등락률 · 거래대금 상위 종목',
    rankGainers: '상승률 상위', rankLosers: '하락률 상위', rankTurnover: '거래대금 상위', high52: '52주 신고가', high52Basis: '장중 기준 · 네이버 금융 집계', low52: '52주 신저가', stocksUnit: '종목', limitUp: '상한가', limitDown: '하한가', tradingValue: '거래대금', rankingsNone: '해당 종목 없음', rankingsUnavailable: '이날 종목 순위 데이터 없음', rankingsNote: '주식 종목만(ETF·ETN 제외) · 15:30 정규장 종가 · 등락률은 KRX 전일 종가 대비 · 네이버 금융 순위를 장 마감 후 15:35~15:39에 저장',
    shortAmount: '공매도 거래대금', valueRatio: '거래대금 비중', shortRatioScope: '거래대금 비중은 KRX+NXT 합산 정규시장 거래대금 대비입니다.', shortValue: '공매도 거래대금 TOP5', shortRatio: '공매도 비중 TOP5', regularUnavailable: '정규장 기준 값 없음',
    prev: '이전 거래일', next: '다음 거래일', archive: '전체 마감 기록', dashboard: '대시보드에서 보기', latest: '최신 마감',
    report: '이날의 데일리 리포트', noReport: '이날 발행된 데일리 리포트가 없습니다.',
    breadcrumbHome: '홈', breadcrumbMarket: '마켓',
    rateState: '16:00 최종호가', ratesNote: '금융투자협회 최종호가수익률 · 16:00 KST 기준 · 대비는 금융투자협회 전일 값 대비(bp)',
    source: '데이터 출처: KRX 한국거래소, 네이버 금융, 야후 파이낸스', ecosSource: ', 한국은행 ECOS(원/달러 15:30)', tencentSource: ', 텐센트 증권(상해종합)',
    disclaimer: '투자 판단의 참고 자료이며, 매수·매도 권유가 아닙니다.',
    unit: '단위: 원 · 순매수는 매수-매도',
    sectorsPage: '업종·테마 5일·20일 순위', sectorsLink: '업종·테마 등락률 순위', flowsLink: '투자자별 수급 · 월간 누적',
    noteTitle: '숫자 너머의 의미를 해석합니다.', noteBody: '이날 시장의 흐름과 배경은 Snowshagal 데일리 리포트에서 이어서 읽을 수 있습니다.'
  },
  en: {
    eyebrow: 'Daily close record',
    heading: date => `Korea Stock Market Close: ${longDate(date, 'en')}`,
    closeBasis: 'Regular session close, 15:30 KST',
    overseas: '* Overseas indices and commodities use each market’s latest close.',
    sections: ['Major Indices', 'Investor Flows (Daily)', 'Cumulative Flows: Last 5 Sessions', 'Rates · FX · Volatility', 'Commodities · Crypto', 'Market Breadth', 'KRX Sectors & Themes', 'Top 10 by Market Cap', 'Short Selling', 'Korean Bond Yields'],
    asiaTitle: 'Asian Markets', localHoliday: 'Local holiday',
    open: 'Open', high: 'High', low: 'Low', previous: 'Prev.', closeState: 'Close', fixedClose: 'Hana Bank rate', seoulClose: '3:30 p.m. rate', provisionalBank: 'Provisional · Hana Bank rate', intraday: 'Intraday', unavailable: 'Unavailable',
    market: 'Market', foreign: 'Foreign', institution: 'Institution', individual: 'Retail', futures: 'KOSPI 200 Futures',
    fiveDays: (start, end) => `${start} – ${end}`,
    fiveDayIncomplete: (used, total) => `Incomplete data · ${used}/${total} sessions available`,
    rise: 'Advancers', fall: 'Decliners', flat: 'Unchanged', upper: 'Limit up', lower: 'Limit down', riseRatio: 'Advance ratio', fallRatio: 'Decline ratio',
    breadthUnavailable: 'Market breadth unavailable for this session',
    sectors: 'Sectors', themes: 'Themes', strongest: 'Strongest', weakest: 'Weakest',
    allSectors: n => `All ${n} sectors`, allThemes: n => `All ${n} themes`,
    groupColumns: ['Rank', 'Name', 'Market', 'Close', 'Change'],
    capColumns: ['Rank', 'Company', 'Close', 'Change', 'Market cap'],
    rankingsTitle: 'Top Movers & Most Traded',
    rankGainers: 'Top gainers', rankLosers: 'Top losers', rankTurnover: 'Most traded by value', high52: '52-week highs', high52Basis: 'intraday · Naver Finance count', low52: '52-week lows', stocksUnit: '', limitUp: 'Limit up', limitDown: 'Limit down', tradingValue: 'Value', rankingsNone: 'None', rankingsUnavailable: 'Stock rankings unavailable for this session', rankingsNote: 'Stocks only (ETFs and ETNs excluded) · regular-session close at 15:30 KST · change against the previous KRX close · Naver Finance rankings saved after the close, 15:35–15:39 KST',
    shortAmount: 'Short value', valueRatio: 'Value ratio', shortRatioScope: 'Value ratio is against KRX+NXT combined regular-session turnover.', shortValue: 'Top 5 by Short Value', shortRatio: 'Top 5 by Short Ratio', regularUnavailable: 'No regular-session value',
    prev: 'Previous session', next: 'Next session', archive: 'All sessions', dashboard: 'Open in the dashboard', latest: 'Latest close',
    report: 'Daily report for this session', noReport: 'No Daily report was published for this session.',
    breadcrumbHome: 'Home', breadcrumbMarket: 'Market',
    rateState: '16:00 KOFIA', ratesNote: 'KOFIA final quote yields, 16:00 KST · Change in bp against KOFIA’s previous-day value',
    source: 'Sources: KRX, Naver Finance, Yahoo Finance', ecosSource: ', Bank of Korea ECOS (USD/KRW 3:30 p.m.)', tencentSource: ', Tencent Securities (Shanghai Composite)',
    disclaimer: 'For reference only; not a recommendation to buy or sell.',
    unit: 'Net buying = buys minus sells',
    sectorsPage: 'Sector & theme 5- and 20-session rankings', sectorsLink: 'Sector & theme rankings', flowsLink: 'Investor flows by month',
    noteTitle: 'We interpret the meaning beyond the numbers.', noteBody: 'Continue with the Snowshagal Daily report for the story behind this session.'
  }
};

const INDEX_NAMES_EN = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', NASDAQ: 'NASDAQ Composite', DOW: 'Dow Jones', SP500: 'S&P 500', NIKKEI225: 'Nikkei 225', SHANGHAI: 'Shanghai Composite', TAIEX: 'TAIEX', SOX: 'Philadelphia Semiconductor', VIX: 'VIX', VKOSPI: 'VKOSPI', US10Y: 'US 10Y', USDKRW: 'USD/KRW', JPYKRW: 'JPY/KRW (100)', DXY: 'Dollar Index', WTI: 'WTI Crude', GOLD: 'Gold', BITCOIN: 'Bitcoin', CNYKRW: 'CNY/KRW', EURKRW: 'EUR/KRW', USDJPY: 'USD/JPY', BRENT: 'Brent Crude', NATGAS: 'Natural Gas', SILVER: 'Silver', COMEX_COPPER: 'Copper', KTB3Y: 'KTB 3Y', KTB10Y: 'KTB 10Y', CORPAA3Y: 'Corporate AA- 3Y', CD91: 'CD 91-day' };
// The same Korean names as TODAY's quote boards (assets/market-close.js namesKo);
// tests/market-render-parity.test.mjs keeps the two lists equal.
const INDEX_NAMES_KO = { KOSPI: '코스피', KOSDAQ: '코스닥', NASDAQ: '나스닥 종합', DOW: '다우존스', SP500: 'S&P 500', NIKKEI225: '닛케이225', SHANGHAI: '상해종합', TAIEX: '대만 가권', SOX: '필라델피아 반도체', VIX: 'VIX 변동성', VKOSPI: 'VKOSPI', US10Y: '미국 국채 10년', USDKRW: '원/달러', JPYKRW: '원/100엔', DXY: '달러인덱스', WTI: 'WTI 원유', GOLD: '금 선물', BITCOIN: '비트코인', CNYKRW: '원/위안', EURKRW: '원/유로', USDJPY: '엔/달러', BRENT: '브렌트유', NATGAS: '천연가스', SILVER: '은 선물', COMEX_COPPER: '구리 선물', KTB3Y: '국고채 3년', KTB10Y: '국고채 10년', CORPAA3Y: '회사채 AA- 3년', CD91: 'CD 91일' };
const KRX_COMPANY_NAMES_EN = {
  '000660': 'SK hynix', '005380': 'Hyundai Motor', '005930': 'Samsung Electronics', '005935': 'Samsung Electronics Pref.',
  '009150': 'Samsung Electro-Mechanics', '012450': 'Hanwha Aerospace', '028260': 'Samsung C&T', '034020': 'Doosan Enerbility',
  '035420': 'NAVER', '042660': 'Hanwha Ocean', '055550': 'Shinhan Financial Group', '068270': 'Celltrion', '105560': 'KB Financial Group',
  '207940': 'Samsung Biologics', '329180': 'HD Hyundai Heavy Industries', '373220': 'LG Energy Solution', '402340': 'SK Square'
};

function instrumentName(key, lang) {
  return lang === 'en' ? (INDEX_NAMES_EN[key] || key) : (INDEX_NAMES_KO[key] || key);
}

function companyName(item, lang) {
  const name = String(item?.name || '').trim();
  const ticker = String(item?.ticker || '').trim();
  if (lang !== 'en') return name || ticker || '--';
  if (KRX_COMPANY_NAMES_EN[ticker]) return KRX_COMPANY_NAMES_EN[ticker];
  if (name && !/[ㄱ-ㆎ가-힣]/.test(name)) return name;
  return ticker || '--';
}

/* -------------------------------------------------------------------- SEO */

function kospi(payload) { return payload?.indices?.KOSPI; }
function kosdaq(payload) { return payload?.indices?.KOSDAQ; }
function kospiFlows(payload) { return payload?.krx_investor_trading?.markets?.KOSPI?.investors || {}; }

function closeWithPct(item) {
  if (!valid(item?.close)) return '';
  return valid(item?.change_pct) ? `${formatIndexLevel(item.close)}(${formatSignedPct(item.change_pct)})` : formatIndexLevel(item.close);
}

/**
 * Title for one session. Leads with the full date and "코스피 종가" — the
 * shape of the date + figure searches GSC shows — and names the data the
 * page holds, so it reads differently from the Daily report title for the
 * same day, which leads with the editorial close.
 */
export function marketDateTitle(payload, lang) {
  const date = payload?.meta?.market_date;
  const k = kospi(payload);
  if (lang === 'en') {
    const close = valid(k?.close) ? ` ${formatIndexLevel(k.close)}${valid(k.change_pct) ? ` (${formatSignedPct(k.change_pct)})` : ''}` : '';
    return `${longDate(date, 'en')} KOSPI Close${close} · Flows & FX | Snowshagal`;
  }
  const close = valid(k?.close) ? ` ${closeWithPct(k)}` : '';
  return `${longDate(date, 'ko')} 코스피 종가${close} · 투자자별 매매동향·환율 | Snowshagal`;
}

function flowSentence(value, investor, lang) {
  if (!valid(value) || value === 0) return '';
  const amount = formatFlowAmount(value, lang);
  if (lang === 'en') return `${investor} ${value > 0 ? 'net bought' : 'net sold'} ${amount}`;
  return `${investor} ${amount} ${value > 0 ? '순매수' : '순매도'}`;
}

export function marketDateDescription(payload, lang) {
  const date = payload?.meta?.market_date;
  const k = kospi(payload);
  const q = kosdaq(payload);
  const fx = payload?.rates_fx_volatility?.USDKRW;
  const inv = kospiFlows(payload);
  const parts = [];
  if (lang === 'en') {
    const closes = [valid(k?.close) ? `KOSPI ${closeWithPct(k).replace('(', ' (')}` : '', valid(q?.close) ? `KOSDAQ ${closeWithPct(q).replace('(', ' (')}` : ''].filter(Boolean).join(', ');
    if (closes) parts.push(`${longDate(date, 'en')} close: ${closes}.`);
    const flows = [flowSentence(inv['외국인']?.net_buy, 'Foreign investors', 'en'), flowSentence(inv['기관']?.net_buy, 'institutions', 'en')].filter(Boolean).join(', ');
    if (flows) parts.push(`${flows} on KOSPI.`);
    if (valid(fx?.close)) parts.push(`USD/KRW ${formatIndexLevel(fx.close)}.`);
    parts.push('Sector and theme moves, market breadth and the top 10 by market cap.');
  } else {
    const closes = [valid(k?.close) ? `코스피 ${closeWithPct(k)}` : '', valid(q?.close) ? `코스닥 ${closeWithPct(q)}` : ''].filter(Boolean).join(', ');
    if (closes) parts.push(`${longDate(date, 'ko')} ${closes} 마감.`);
    const flows = [flowSentence(inv['외국인']?.net_buy, '외국인', 'ko'), flowSentence(inv['기관']?.net_buy, '기관', 'ko')].filter(Boolean).join(', ');
    if (flows) parts.push(`코스피 ${flows}.`);
    if (valid(fx?.close)) parts.push(`원/달러 ${formatIndexLevel(fx.close)}원.`);
    parts.push('업종·테마 등락률, 시장 폭, 시가총액 상위 종목까지 숫자로 정리.');
  }
  let text = parts.join(' ');
  // Drop trailing sentences rather than cut one in half.
  while (text.length > 180 && parts.length > 1) {
    parts.pop();
    text = parts.join(' ');
  }
  return text;
}

export function marketArchiveTitle(lang) {
  return lang === 'en'
    ? 'Korea Market Close Archive: KOSPI, KOSDAQ & USD/KRW by Date | Snowshagal'
    : '날짜별 한국 증시 마감 기록 · 코스피·코스닥 종가, 원달러 환율 | Snowshagal';
}

export function marketArchiveDescription(lang) {
  return lang === 'en'
    ? 'Browse Korean market closes by month and trading day. Compare KOSPI, KOSDAQ, foreign net flows and USD/KRW, then open each session’s detailed market record.'
    : '날짜별 한국 증시 마감 데이터를 월별로 모은 아카이브입니다. 코스피·코스닥 종가와 등락률, 외국인 순매수, 원/달러 환율을 함께 비교하고 각 거래일의 상세 기록에서 투자자 수급과 주요 시장 지표를 확인할 수 있습니다.';
}

function breadcrumbJsonLd(items) {
  return {
    '@type': 'BreadcrumbList',
    'itemListElement': items.map((item, index) => ({ '@type': 'ListItem', 'position': index + 1, 'name': item.name, 'item': item.url }))
  };
}

function pageJsonLd({ lang, title, description, canonical, breadcrumb, datePublished }) {
  const page = {
    '@type': 'WebPage',
    '@id': `${canonical}#webpage`,
    'url': canonical,
    'name': title.replace(/ \| Snowshagal$/, ''),
    'description': description,
    'inLanguage': lang,
    'isPartOf': websiteStructuredData(),
    'publisher': { '@id': organizationStructuredData(lang)['@id'] },
    'breadcrumb': breadcrumbJsonLd(breadcrumb)
  };
  if (datePublished) page.datePublished = datePublished;
  return { '@context': 'https://schema.org', '@graph': [organizationStructuredData(lang), page] };
}

/* ------------------------------------------------------------- sections */

function section(number, title, body) {
  const id = `market-section-${number}`;
  return `<section class="market-section" aria-labelledby="${id}"><h2 id="${id}"><span>${String(number).padStart(2, '0')}.</span> ${html(title)}</h2>${body}</section>`;
}

function dataTable(headings, rows, className = '') {
  return `<div class="market-table-wrap"><table class="market-table ${className}"><thead><tr>${headings.map(item => `<th scope="col">${html(item)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* --------------------------------------------- the redesigned page parts */

// The same page as /market/ TODAY (assets/market-close.js), server-rendered for
// one session and without the parts that need a script: both flow tables are
// shown, and every quote board at every width.
const PAGE_COPY = {
  ko: {
    regularClose: '정규장 종가', trendLabel: '최근 20거래일 종가', closeOf: md => `${md} 마감`, regularBasis: '정규장 15:30 KST 기준',
    summaryTitle: '그날의 요약', summaryHead: (pctText, word) => `코스피 ${pctText}% ${word}`, up: '상승', down: '하락', flat: '보합',
    breadthPhrase: (count, ratio, word) => `코스피 ${count}종목 ${word}(${ratio})`, foreignPhrase: (amount, word) => `외국인 ${amount} ${word}`, netBuy: '순매수', netSell: '순매도',
    fxSummary: '원/달러', fixingNote: md => `${md} 하나은행 고시(15:30 직전)`, seoulNote: md => `${md} 서울 외환시장 15:30 기준가`, provisionalNote: md => `${md} 잠정 · 하나은행 고시(15:30 직전)`, vixSummary: '미국 변동성 VIX', usCloseNote: md => `${md} 미국장 마감`,
    krTitle: '한국 시장', krCaption: '수급, 등락 종목, 주요 종목 종가', flowsTitle: '투자자별 순매수', flowDay: '당일', flowFive: '최근 5거래일', flowNote: '양수는 순매수, 음수는 순매도',
    breadthTitle: '시장 폭', breadthCaption: '상승 · 보합 · 하락', breadthShort: { rise: '상승', flat: '보합', fall: '하락', upper: '상한', lower: '하한' },
    statsTitle: '거래 · 프로그램 · 공매도', turnoverOf: name => `${name} 거래대금`, ratio5Text: value => `5일 평균의 ${value}배`, programTotal: '프로그램 순매수', arbitrage: '차익', nonArbitrage: '비차익',
    basis: '베이시스', spot: 'KOSPI200 현물', shortRatioOf: name => `공매도 비중 · ${name}`, detailsMore: '공매도 상위 5',
    topTitle: '시가총액 상위 10', groupsTitle: 'KRX 업종 · 테마 등락률', globalTitle: '해외 · 금리 · 환율 · 원자재', globalCaption: '추이는 최근 20거래일 · 지표를 누르면 일별 기록',
    boards: { world: '해외 증시 · 변동성', rates: '금리', fx: '환율', commodities: '원자재 · 가상자산' },
    boardNotes: { world: '미국 지수 · 아시아 각 시장 최근 마감', rates: '국내 금융투자협회 16:00 최종호가', fx: '원화는 하나은행 고시(15:30 직전 회차)', fxSeoul: '원/달러는 서울 외환시장 15:30 기준가(한국은행), 그 밖의 원화는 하나은행 고시', fxProvisional: '원/달러는 잠정 하나은행 고시, 한국은행 15:30 기준가가 나오면 바뀜', commodities: '달러 기준' },
    columns: ['지표', '값', '전일 대비', '추이'], marketNames: { KOSPI: '코스피', KOSDAQ: '코스닥', 'KOSPI200선물': '선물' },
    dateLabel: '거래일', pageEyebrow: '한국 증시 마감 기록', stock: '종목명', future: '선물', terms: { breadth: '시장 폭', program: '프로그램 매매', basis: '베이시스', short: '공매도' }, price: '종가', change: '등락률', marketCap: '시가총액'
  },
  en: {
    regularClose: 'Regular close', trendLabel: 'Last 20 sessions', closeOf: md => `Close of ${md}`, regularBasis: 'Regular session, 15:30 KST',
    summaryTitle: 'The day in brief', summaryHead: (pctText, word) => `KOSPI ${word} ${pctText}%`, up: 'up', down: 'down', flat: 'flat',
    breadthPhrase: (count, ratio, word) => `${count} KOSPI stocks ${word} (${ratio})`, foreignPhrase: (amount, word) => `foreign investors ${word} ${amount}`, netBuy: 'net bought', netSell: 'net sold',
    fxSummary: 'USD/KRW', fixingNote: md => `${md} · Hana Bank rate before 15:30`, seoulNote: md => `${md} · Seoul FX market 3:30 p.m. rate`, provisionalNote: md => `${md} · provisional Hana Bank rate before 15:30`, vixSummary: 'US volatility · VIX', usCloseNote: md => `${md} · US close`,
    krTitle: 'Korean Market', krCaption: 'Flows, advancers and decliners, top stocks', flowsTitle: 'Net Buying by Investor', flowDay: 'Today', flowFive: 'Last 5 sessions', flowNote: 'Positive is net buying, negative net selling',
    breadthTitle: 'Market Breadth', breadthCaption: 'Advancers · unchanged · decliners', breadthShort: { rise: 'Up', flat: 'Flat', fall: 'Down', upper: 'limit', lower: 'limit' },
    statsTitle: 'Turnover · Program · Short Selling', turnoverOf: name => `${name} turnover`, ratio5Text: value => `${value}× the 5-session avg.`, programTotal: 'Program net buy', arbitrage: 'Arbitrage', nonArbitrage: 'Non-arbitrage',
    basis: 'Basis', spot: 'KOSPI 200 spot', shortRatioOf: name => `Short ratio · ${name}`, detailsMore: 'Top 5 short selling',
    topTitle: 'Top 10 by Market Cap', groupsTitle: 'KRX Sectors & Themes', globalTitle: 'Overseas · Rates · FX · Commodities', globalCaption: 'Trend over the last 20 sessions · Select an indicator for its daily history',
    boards: { world: 'Overseas Markets · Volatility', rates: 'Rates', fx: 'FX', commodities: 'Commodities · Crypto' },
    boardNotes: { world: 'US indices · each Asian market’s latest close', rates: 'Korean yields: KOFIA 16:00 final quotes', fx: 'KRW pairs: Hana Bank posted rate (last round before 15:30)', fxSeoul: 'USD/KRW: Seoul FX market 3:30 p.m. rate (Bank of Korea); other KRW pairs: Hana Bank posted rate', fxProvisional: 'USD/KRW: provisional Hana Bank rate until the Bank of Korea 3:30 p.m. rate is out', commodities: 'In US dollars' },
    columns: ['Indicator', 'Value', 'Change', 'Trend'], marketNames: { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', 'KOSPI200선물': 'KOSPI 200 Futures' },
    dateLabel: 'Trading day', pageEyebrow: 'Korea market close archive', stock: 'Company', future: 'Futures', terms: { breadth: 'Market Breadth', program: 'Program Trading', basis: 'Basis', short: 'Short Selling' }, price: 'Close', change: 'Change', marketCap: 'Market cap'
  }
};

const shortDate = (value) => {
  if (!ISO_DATE.test(String(value || ''))) return '';
  const [, m, d] = value.split('-').map(Number);
  return `${m}/${d}`;
};

function monthDayText(value, lang) {
  if (!ISO_DATE.test(String(value || ''))) return html(value || '--');
  const [, m, d] = value.split('-').map(Number);
  return lang === 'en' ? `${EN_MONTHS[m - 1].slice(0, 3)} ${d}` : `${m}월 ${d}일`;
}

/**
 * The page head every market page shares: breadcrumb, eyebrow, title, the
 * summary or lead, and one meta line. `summary` is markup; the rest is text.
 */
function pageHead({ id, breadcrumb, eyebrow, title, summary = '', lead = '', meta = [], after = '' }) {
  return `<section class="mk-head" aria-labelledby="${id}"><div class="market-wrap">
      <p class="market-breadcrumb">${breadcrumb}</p>
      <p class="mk-eyebrow">${html(eyebrow)}</p>
      <h1 id="${id}">${html(title)}</h1>
      ${summary ? `<p class="market-date-summary">${summary}</p>` : ''}
      ${lead ? `<p class="mk-lead">${html(lead)}</p>` : ''}
      ${meta.length ? `<p class="mk-meta">${meta.map(item => `<span>${html(item)}</span>`).join('')}</p>` : ''}
      ${after}
    </div></section>`;
}

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

function trendSvg(values, { w = 88, h = 26, pad = 3, stretch = false } = {}) {
  const g = sparkGeometry(values, w, h, pad);
  if (!g) return '';
  return `<svg class="mk-spark${stretch ? ' mk-spark-wide' : ''}" viewBox="0 0 ${w} ${h}" width="${stretch ? '100%' : w}" height="${h}"${stretch ? ' preserveAspectRatio="none"' : ''} aria-hidden="true" focusable="false"><polygon class="mk-spark-area" points="${g.area}"></polygon><polyline class="mk-spark-line" points="${g.line}"${stretch ? ' vector-effect="non-scaling-stroke"' : ''}></polyline>${stretch ? '' : `<circle class="mk-spark-dot" cx="${g.cx}" cy="${g.cy}" r="2.2"></circle>`}</svg>`;
}

const trendOf = (trend, key) => (trend && trend.series && Array.isArray(trend.series[key]) ? trend.series[key] : null);

// Value, change and basis of one instrument of the record, as on its card before.
function instrumentParts(key, item, f, copy, lang, marketDate) {
  const isFx = FIXING_CODES.has(key);
  const movementClass = f.signClass(item?.change);
  const arrow = movementClass === 'up' ? '▲' : movementClass === 'down' ? '▼' : '—';
  const change = key === 'US10Y'
    ? `${arrow} ${valid(item?.change) ? `${f.number(Math.abs(item.change * 100), 1)}bp` : '--'}`
    : isFx || key === 'KOSPI' || key === 'KOSDAQ'
      ? `${arrow} ${valid(item?.change) ? f.number(Math.abs(item.change), 2) : '--'} <span>(${f.pct(item?.change_pct)})</span>`
      : `${arrow} ${f.signed(item?.change, digitsOf(key))} <span>(${f.pct(item?.change_pct)})</span>`;
  // An Asian index dated before the session: its market was closed that day.
  const localHoliday = ASIA_CODES.includes(key) && ISO_DATE.test(String(item?.source_date || '')) && ISO_DATE.test(String(marketDate)) && item.source_date < marketDate;
  // The same basis as TODAY (assets/market-close.js stateText): a KRW pair is
  // Hana Bank's posted rate (last round before 15:30); a figure still trading when the record was made says so,
  // with its capture time ("장중 · 16:10 KST"), and is never called a close.
  const intraday = !isFx && item?.data_state === 'intraday';
  const captured = intraday ? globalThis.MARKET_LOCALE.intradayCaptureTime(item) : '';
  const basis = !item || item.data_state === 'unavailable'
    ? copy.unavailable
    : isFx ? fxStateLabel(key, item, copy) : intraday ? (captured ? `${copy.intraday} · ${captured}` : copy.intraday) : copy.closeState;
  const state = `${dotDate(item?.source_date, lang)} · ${basis}${localHoliday ? ` · ${copy.localHoliday}` : ''}`;
  // An optional indicator's page exists once a record has its value.
  const history = marketIndicatorPath(key, lang) && (!isOptionalIndicator(key) || valid(item?.close)) ? marketIndicatorPath(key, lang) : null;
  const name = history ? `<a class="instrument-history-link" href="${history}">${html(instrumentName(key, lang))}</a>` : html(instrumentName(key, lang));
  // The figure TODAY shows (displayValue): the record's own reading for one still trading.
  return { movementClass, change, state, name, value: f.valueUnit(key, intraday && valid(item?.current) ? item.current : item?.close) };
}

function indexCard(key, item, f, copy, pc, lang, marketDate, trend) {
  const v = instrumentParts(key, item, f, copy, lang, marketDate);
  const series = trendOf(trend, key);
  const dates = trend && Array.isArray(trend.dates) ? trend.dates : [];
  const first = Array.isArray(series) ? series.findIndex(valid) : -1;
  const line = trendSvg(series, { w: 340, h: 64, pad: 3, stretch: true });
  return `<article class="mk-card mk-index" data-code="${key}">
      <div class="mk-index-head"><span class="mk-index-name">${v.name}</span><span class="mk-index-label">${html(pc.regularClose)}</span></div>
      <strong class="mk-index-value">${v.value}</strong>
      <div class="mk-index-change ${v.movementClass}">${v.change}</div>
      ${line ? `<div class="mk-index-trend">${line}<div class="mk-index-axis"><span>${shortDate(dates[first])}</span><span>${html(pc.trendLabel)}</span><span>${shortDate(dates[dates.length - 1])}</span></div></div>` : ''}
      <dl class="mk-ohlc"><div><dt>${copy.open}</dt><dd>${f.number(item?.open, 2)}</dd></div><div><dt>${copy.high}</dt><dd>${f.number(item?.high, 2)}</dd></div><div><dt>${copy.low}</dt><dd>${f.number(item?.low, 2)}</dd></div><div><dt>${copy.previous}</dt><dd>${f.number(item?.previous_close, 2)}</dd></div></dl>
      <div class="mk-index-state">${v.state}</div>
    </article>`;
}

function boardRow(key, item, f, copy, lang, marketDate, trend) {
  const v = instrumentParts(key, item, f, copy, lang, marketDate);
  const line = trendSvg(trendOf(trend, key));
  return `<tr class="mk-row" data-code="${key}">
      <th scope="row"><span class="mk-row-name">${v.name}</span><span class="mk-row-state">${v.state}</span></th>
      <td class="mk-row-value"><strong>${v.value}</strong></td>
      <td class="mk-row-change ${v.movementClass}">${v.change}</td>
      <td class="mk-row-trend">${line || '<span class="mk-trend-empty">—</span>'}</td>
    </tr>`;
}

// One KOFIA yield of the session (Domestic Rates, joined by date). The change
// is KOFIA's own: against its previous-day value, in basis points.
function domesticRateRow(item, day, f, copy, lang, trend) {
  const movementClass = f.signClass(item.change_bp);
  const arrow = movementClass === 'up' ? '▲' : movementClass === 'down' ? '▼' : '—';
  const history = marketIndicatorPath(item.code, lang);
  const name = html(instrumentName(item.code, lang));
  const line = trendSvg(trendOf(trend, item.code));
  return `<tr class="mk-row rate-row" data-rate-code="${html(item.code)}">
      <th scope="row"><span class="mk-row-name">${history ? `<a class="instrument-history-link" href="${history}">${name}</a>` : name}</span><span class="mk-row-state">${dotDate(day.market_date, lang)} · ${html(day.basis_time === '16:00' ? copy.rateState : `${day.basis_time} ${copy.rateState.replace(/^16:00 /, '')}`)}</span></th>
      <td class="mk-row-value"><strong>${f.valueUnit(item.code, item.value)}</strong></td>
      <td class="mk-row-change ${movementClass}">${arrow} ${valid(item.change_bp) ? `${f.number(Math.abs(item.change_bp), 1)}bp` : '--'}</td>
      <td class="mk-row-trend">${line || '<span class="mk-trend-empty">—</span>'}</td>
    </tr>`;
}

/** The session's KOFIA yields as quote-board rows, or '' when that day has none. */
export function domesticRatesBody(day, lang, trend = null) {
  const items = Array.isArray(day?.items) ? day.items.filter(item => isDomesticRateIndicator(item?.code) && valid(item.value)) : [];
  if (!items.length) return '';
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  const f = makeFormat(lang);
  return items.map(item => domesticRateRow(item, day, f, copy, lang, trend)).join('');
}

/*
 * What a KRW pair's figure is (contracts/fx_close/): USD/KRW is the Seoul FX
 * market's 15:30 rate once FX Close has the day ('seoul_1530'), or the record's
 * Hana Bank rate marked provisional until then ('bank_provisional'); the other
 * pairs, and USD/KRW before FX Close exists, are Hana Bank's posted rate.
 */
function fxStateLabel(key, item, copy) {
  if (key === 'USDKRW' && item?.basis === 'seoul_1530') return copy.seoulClose;
  if (key === 'USDKRW' && item?.basis === 'bank_provisional') return copy.provisionalBank;
  return copy.fixedClose;
}

function fxSummaryNote(fx, pc) {
  if (fx?.basis === 'seoul_1530') return pc.seoulNote;
  if (fx?.basis === 'bank_provisional') return pc.provisionalNote;
  return pc.fixingNote;
}

function fxBoardNote(usd, pc) {
  if (usd?.basis === 'seoul_1530') return pc.boardNotes.fxSeoul;
  if (usd?.basis === 'bank_provisional') return pc.boardNotes.fxProvisional;
  return pc.boardNotes.fx;
}

/** The link to 3편 (assets/locale.js usdkrwGuide), as an ordinary <a>. */
function usdkrwGuideLink(lang, className = '') {
  const guide = globalThis.MARKET_LOCALE.usdkrwGuide(lang);
  return `<a${className ? ` class="${className}"` : ''} href="${html(guide.href)}">${html(guide.text)}</a>`;
}

function boardCard(id, title, note, rows, pc, extra = '') {
  return `<section class="mk-card mk-board" data-board="${id}" aria-labelledby="mk-board-${id}">
      <div class="mk-card-head"><h3 id="mk-board-${id}">${html(title)}</h3><span class="mk-card-note">${html(note)}</span></div>
      <div class="mk-table-wrap"><table class="mk-table mk-board-table"><thead><tr>${pc.columns.map((label, index) => `<th scope="col"${index === 3 ? ' class="mk-col-trend"' : ''}>${html(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>${extra}
    </section>`;
}

function flowBar(value, max) {
  if (!valid(value) || !valid(max) || max <= 0) return '';
  const width = Math.max(Math.abs(value) / max * 50, 1.5);
  const x = value >= 0 ? 50 : 50 - width;
  return `<svg class="mk-flow-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="mk-flow-track" x="0" y="0" width="100" height="8"></rect><rect class="mk-flow-fill ${value >= 0 ? 'up' : 'down'}" x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="8"></rect><rect class="mk-flow-mid" x="49.6" y="0" width="0.8" height="8"></rect></svg>`;
}

// Net flows of the three markets (KRW billion per the contract), as a table with bars.
function flowTable(rowsByMarket, f, copy) {
  const values = rowsByMarket.flatMap(row => row.values).filter(valid);
  const max = values.length ? Math.max(...values.map(Math.abs)) : 0;
  return `<div class="mk-table-wrap"><table class="mk-table mk-flow-table"><thead><tr><th scope="col">${html(copy.market)}</th><th scope="col">${html(copy.foreign)}</th><th scope="col">${html(copy.institution)}</th><th scope="col">${html(copy.individual)}</th></tr></thead><tbody>${rowsByMarket.map(row => `<tr><th scope="row">${html(row.name)}</th>${row.values.map(value => `<td><span class="mk-flow-value ${f.signClass(value)}">${f.flow(value)}</span>${flowBar(value, max)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/**
 * Stock rankings of the session (SOFT, optional): per market the top five
 * gainers, losers and stocks by trading value, and how many stocks set a
 * 52-week high or low. A record made before 2026-11-23 has no status and shows
 * nothing; an unavailable one says so and never shows another day's lists.
 */
// Trading value in a ranking row: short, so a small stock's value fits one line.
function rankingWon(value, f) {
  if (!valid(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1e9) return f.won(value);
  if (f.ko) return abs >= 1e8 ? `${f.number(value / 1e8, 1)}억원` : `${f.number(value / 1e4, 0)}만원`;
  return `KRW ${f.number(value / 1e6, 0)}M`;
}

function rankingRow(item, index, kind, f, copy, lang) {
  const limit = item?.price_limit === 'upper' ? `<em class="ranking-limit up">${html(copy.limitUp)}</em>`
    : item?.price_limit === 'lower' ? `<em class="ranking-limit down">${html(copy.limitDown)}</em>` : '';
  const close = valid(item?.close) ? `${f.number(item.close, 0)}${f.ko ? '원' : ''}` : '--';
  const turnover = kind === 'top_turnover';
  const detail = turnover
    ? `${close} · <span class="${f.signClass(item?.change_pct)}">${f.pct(item?.change_pct)}</span>`
    : `${close} · ${html(copy.tradingValue)} ${rankingWon(item?.trading_value_won, f)}`;
  const main = turnover ? rankingWon(item?.trading_value_won, f) : f.pct(item?.change_pct);
  return `<li><span class="ranking-rank">${index + 1}</span><span class="ranking-stock"><span class="ranking-name"><b>${html(companyName(item, lang))}</b>${limit}</span><small>${detail}</small></span><strong class="${turnover ? 'neutral' : f.signClass(item?.change_pct)}">${main}</strong></li>`;
}

/** The body of the rankings card; '' when the record carries no rankings status. */
export function stockRankingsBody(payload, status, f, copy, lang) {
  const state = status?.stock_rankings?.status;
  if (!state) return '';
  const markets = payload?.stock_rankings?.markets;
  if (state !== 'complete' || !markets) return `<p class="unit-note">${html(copy.rankingsUnavailable)}</p>`;
  const block = (title, rows, kind) => `<div class="ranking-block"><h4>${html(title)}</h4>${(rows || []).length
    ? `<ol class="ranking-list">${rows.map((item, index) => rankingRow(item, index, kind, f, copy, lang)).join('')}</ol>`
    : `<p class="unit-note">${html(copy.rankingsNone)}</p>`}</div>`;
  const count = value => `<b>${f.integer(value)}</b>${copy.stocksUnit ? html(copy.stocksUnit) : ''}`;
  const cards = ['KOSPI', 'KOSDAQ'].filter(key => markets[key]).map(key => {
    const item = markets[key];
    return `<article class="ranking-market"><div class="ranking-market-head"><h4>${key}</h4><p class="ranking-52w"><span>${html(copy.high52)} ${count(item.new_high_52w)}</span><span>${html(copy.low52)} ${count(item.new_low_52w)}</span><span class="ranking-52w-basis">${html(copy.high52Basis)}</span></p></div><div class="ranking-lists">${block(copy.rankGainers, item.top_gainers, 'top_gainers')}${block(copy.rankLosers, item.top_losers, 'top_losers')}${block(copy.rankTurnover, item.top_turnover, 'top_turnover')}</div></article>`;
  }).join('');
  return `<div class="ranking-markets">${cards}</div><p class="mk-unit">${html(copy.rankingsNote)}</p>`;
}

function breadthBlock(key, item, f, copy, pc) {
  const rise = item?.rise_count ?? item?.rise;
  const fall = item?.fall_count ?? item?.fall;
  const flat = item?.flat;
  const total = [rise, flat, fall].every(valid) ? rise + flat + fall : null;
  const share = value => (valid(total) && total > 0 && valid(value) ? value / total * 100 : 0);
  const limit = (label, value) => (valid(value) && value > 0 ? ` (${label} ${f.integer(value)})` : '');
  // The head names the larger side: the advance ratio on a day more stocks rose than fell.
  const advancing = valid(item?.rise_ratio) && valid(item?.fall_ratio) && item.rise_ratio > item.fall_ratio;
  return `<div class="mk-breadth" data-market="${key}">
      <div class="mk-breadth-head"><span>${html(pc.marketNames[key])}</span>${advancing ? `<b class="up">${copy.riseRatio} ${f.ratioPct(item.rise_ratio)}</b>` : `<b class="down">${copy.fallRatio} ${f.ratioPct(item?.fall_ratio)}</b>`}</div>
      <div class="mk-breadth-bar" role="img" aria-label="${copy.riseRatio} ${f.ratioPct(item?.rise_ratio)}, ${copy.fallRatio} ${f.ratioPct(item?.fall_ratio)}"><span class="advance" style="width:${share(rise).toFixed(2)}%"></span><span class="flat" style="width:${share(flat).toFixed(2)}%"></span><span class="decline" style="width:${share(fall).toFixed(2)}%"></span></div>
      <div class="mk-breadth-counts"><span class="up">${pc.breadthShort.rise} ${f.integer(item?.rise)}${limit(pc.breadthShort.upper, item?.upper_limit)}</span><span>${pc.breadthShort.flat} ${f.integer(flat)}</span><span class="down">${pc.breadthShort.fall} ${f.integer(item?.fall)}${limit(pc.breadthShort.lower, item?.lower_limit)}</span></div>
    </div>`;
}

function rankList(title, items, type, f, field = 'change_pct') {
  return `<div class="range-rank-block"><h4 class="range-rank-title ${type}">${html(title)}</h4><ul class="rank-list">${items.map(it => `<li><span><b>${html(it.name)}</b>${it.market ? `<small>${html(it.market)}</small>` : ''}</span><strong class="${f.signClass(it[field])}">${f.pct(it[field])}</strong></li>`).join('')}</ul></div>`;
}

// Rows for a ranked sector or theme list. Themes carry no market, so the
// market column is left out when no item has one.
// KRX's sector and theme names, in English on the English pages (assets/locale.js).
function localizedGroups(items, lang) {
  if (!Array.isArray(items)) return items;
  const name = globalThis.MARKET_LOCALE.krxGroupName;
  return lang === 'en' ? items.map(item => ({ ...item, name: name(item, 'en') })) : items;
}

function localizedSectorsView(view, lang) {
  if (lang !== 'en' || !view) return view;
  const period = item => item && { ...item, sectors: localizedGroups(item.sectors, lang), themes: localizedGroups(item.themes, lang) };
  return { ...view, sectors: localizedGroups(view.sectors, lang), themes: localizedGroups(view.themes, lang), week: period(view.week), month: period(view.month) };
}

function groupColumns(items, copy) {
  return items.some(item => item.market) ? copy.groupColumns : copy.groupColumns.filter((_, index) => index !== 2);
}

function groupRows(items, f, field) {
  const withMarket = items.some(item => item.market);
  return items.map((item, index) => [
    String(index + 1),
    html(item.name),
    ...(withMarket ? [html(item.market || '--')] : []),
    f.number(item.close ?? item.end_value, 2),
    `<span class="${f.signClass(item[field])}">${f.pct(item[field])}</span>`
  ]);
}

// `field`: change_pct for one session, return_pct for a period from
// aggregateKrxGroups (which then carries end_value as its close).
function groupBlock(title, allLabel, items, f, copy, field = 'change_pct') {
  const ranked = (items || []).filter(item => valid(item?.[field])).sort((a, b) => b[field] - a[field]);
  if (!ranked.length) return '';
  const top = ranked.slice(0, 5);
  const bottom = ranked.length >= 10 ? ranked.slice(-5).reverse() : ranked.slice(5).reverse();
  const rows = groupRows(ranked, f, field);
  return `<div class="range-group-col"><h3 class="group-category-title">${html(title)}</h3>
      <div class="range-rank-pair">${rankList(copy.strongest, top, 'up', f, field)}${bottom.length ? rankList(copy.weakest, bottom, 'down', f, field) : ''}</div>
      <details class="market-date-all"><summary>${html(allLabel(ranked.length))}</summary>${dataTable(groupColumns(ranked, copy), rows, 'compact market-sector-table')}</details>
    </div>`;
}

/* --------------------------------------------------------------- the page */

/**
 * The <main> for one session. `context`: { prev, next, report } where prev
 * and next are neighbouring published dates (or null) and report is the
 * Daily report post for this date in this language (or null).
 */
export function renderMarketDateMain(payload, lang, context = {}) {
  const key = lang === 'en' ? 'en' : 'ko';
  const copy = COPY[key];
  const pc = PAGE_COPY[key];
  const f = makeFormat(lang);
  const date = payload.meta.market_date;
  const indices = payload.indices || {};
  const rates = payload.rates_fx_volatility || {};
  const commodities = payload.commodities_crypto || {};
  const flows = payload.krx_investor_trading?.markets || {};
  const five = payload.recent_5d_flows || {};
  const breadth = payload.market_breadth || {};
  const program = payload.program_basis || {};
  const internals = payload.market_internals || {};
  const rawGroups = payload.krx_groups || {};
  const groups = { ...rawGroups, sectors: localizedGroups(rawGroups.sectors, lang), themes: localizedGroups(rawGroups.themes, lang) };
  const caps = Array.isArray(payload.market_cap_top10) ? payload.market_cap_top10 : [];
  const shorts = payload.short_selling || {};
  const status = payload.meta?.schema_version === '1.2.0' ? payload.section_status || {} : {};
  // Trend lines only when they end on this session.
  const trend = context.trend && Array.isArray(context.trend.dates) && context.trend.end_date === date ? context.trend : null;

  // A label that names a glossary term links to its entry (/basics/glossary/#term-…), as on TODAY.
  const termLink = (text, term) => (term ? `<a class="mk-term" href="${html(glossaryTermHref(term, lang))}">${html(text)}</a>` : html(text));

  const k = kospi(payload);
  const q = kosdaq(payload);
  const fx = rates.USDKRW;
  const inv = kospiFlows(payload);
  const summary = [
    valid(k?.close) ? `${key === 'en' ? 'KOSPI' : '코스피'} <b>${f.number(k.close, 2)}</b> <span class="${f.signClass(k.change_pct)}">(${f.pct(k.change_pct)})</span>` : '',
    valid(q?.close) ? `${key === 'en' ? 'KOSDAQ' : '코스닥'} <b>${f.number(q.close, 2)}</b> <span class="${f.signClass(q.change_pct)}">(${f.pct(q.change_pct)})</span>` : '',
    valid(inv['외국인']?.net_buy) ? `${copy.foreign} <b class="${f.signClass(inv['외국인'].net_buy)}">${f.flow(inv['외국인'].net_buy)}</b>` : '',
    valid(fx?.close) ? `${key === 'en' ? 'USD/KRW' : '원/달러'} <b>${f.valueUnit('USDKRW', fx.close)}</b>` : ''
  ].filter(Boolean).map(item => `<span class="market-date-fact">${item}</span>`).join('<span class="market-date-sep" aria-hidden="true"> · </span>');
  const takeaway = String(payload.takeaway?.[key] || '').trim();

  const base = key === 'en' ? '/en/market/' : '/market/';
  const nav = `<nav class="market-date-nav mk-datebar" aria-label="${html(copy.archive)}">
      ${context.prev ? `<a class="market-date-nav-link prev" href="${marketDatePath(context.prev, lang)}" rel="prev"><span aria-hidden="true">‹</span> ${html(copy.prev)} <small>${html(dayLabel(context.prev, lang))}</small></a>` : '<span class="market-date-nav-link prev" aria-hidden="true"></span>'}
      <a class="market-date-nav-link archive" href="${marketArchivePath(lang)}">${html(copy.archive)}</a>
      ${context.next ? `<a class="market-date-nav-link next" href="${marketDatePath(context.next, lang)}" rel="next">${html(copy.next)} <small>${html(dayLabel(context.next, lang))}</small> <span aria-hidden="true">›</span></a>` : `<a class="market-date-nav-link next" href="${base}">${html(copy.latest)} <span aria-hidden="true">›</span></a>`}
    </nav>`;

  /* ---- the day in brief ---- */
  const kospiPct = k?.change_pct;
  const word = !valid(kospiPct) || kospiPct === 0 ? pc.flat : kospiPct > 0 ? pc.up : pc.down;
  const headline = valid(kospiPct) ? pc.summaryHead(f.number(Math.abs(kospiPct), 2), word) : instrumentName('KOSPI', lang);
  const breadthUnavailable = status.market_breadth?.status === 'unavailable';
  const kb = breadth.KOSPI;
  const breadthPart = !breadthUnavailable && kb && valid(kospiPct) && kospiPct !== 0
    ? (kospiPct < 0
      ? pc.breadthPhrase(f.integer(kb.fall_count ?? kb.fall), f.ratioPct(kb.fall_ratio), pc.down)
      : pc.breadthPhrase(f.integer(kb.rise_count ?? kb.rise), f.ratioPct(kb.rise_ratio), pc.up))
    : '';
  const foreignNet = inv['외국인']?.net_buy;
  const foreignPart = valid(foreignNet) && foreignNet !== 0 ? pc.foreignPhrase(f.flow(Math.abs(foreignNet)).replace('+', ''), foreignNet > 0 ? pc.netBuy : pc.netSell) : '';
  const vix = rates.VIX;
  const summaryCard = `<article class="mk-summary" aria-labelledby="mk-summary-title">
      <p class="mk-summary-eyebrow" id="mk-summary-title">${html(pc.summaryTitle)}</p>
      <p class="mk-summary-head">${html(headline)}</p>
      ${breadthPart || foreignPart ? `<p class="mk-summary-sub">${[breadthPart, foreignPart].filter(Boolean).map(html).join(' · ')}</p>` : ''}
      <div class="mk-summary-stats">
        <div><span>${html(pc.fxSummary)}</span><strong>${f.valueUnit('USDKRW', fx?.data_state === 'unavailable' ? null : fx?.close)}</strong><small>${html(fxSummaryNote(fx, pc)(shortDate(fx?.source_date || date)))}</small>${usdkrwGuideLink(lang, 'mk-summary-guide')}</div>
        <div><span>${html(pc.vixSummary)}</span><strong>${f.valueUnit('VIX', vix?.data_state === 'unavailable' ? null : vix?.close)}${valid(vix?.change_pct) ? ` <em class="${f.signClass(vix.change_pct)}">${f.pct(vix.change_pct)}</em>` : ''}</strong><small>${shortDate(vix?.source_date) ? html(pc.usCloseNote(shortDate(vix.source_date))) : ''}</small></div>
      </div>
    </article>`;

  /* ---- Korean market ---- */
  const order = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'];
  const dayRows = order.map(m => ({ name: pc.marketNames[m], values: ['외국인', '기관', '개인'].map(investor => flows[m]?.investors?.[investor]?.net_buy) }));
  const fiveStatus = status.five_day_flows;
  const fiveBody = fiveStatus && fiveStatus.status !== 'complete'
    ? `<div class="market-group-empty market-five-day-status" role="note"><p class="group-empty-title">${html(copy.fiveDayIncomplete(fiveStatus.available_sessions ?? 0, fiveStatus.expected_sessions ?? 5))}</p></div>`
    : five.markets
      ? `${flowTable(order.map(m => ({ name: pc.marketNames[m], values: ['외국인', '기관', '개인'].map(investor => five.markets?.[m]?.[investor]) })), f, copy)}<p class="mk-unit">${html(copy.fiveDays(dotDate(five.start_date, lang), dotDate(five.end_date, lang)))}</p>`
      : '';
  const flowsCard = `<section class="mk-card mk-flows" aria-labelledby="mk-flows-title">
      <div class="mk-card-head"><h3 id="mk-flows-title">${html(pc.flowsTitle)}</h3></div>
      <h4 class="mk-subhead">${html(pc.flowDay)}</h4>${flowTable(dayRows, f, copy)}
      ${fiveBody ? `<h4 class="mk-subhead">${html(pc.flowFive)}</h4>${fiveBody}` : ''}
      <p class="mk-unit">${html(pc.flowNote)}</p>
    </section>`;
  const breadthCardHtml = `<section class="mk-card mk-breadth-card" aria-labelledby="mk-breadth-title">
      <div class="mk-card-head"><h3 id="mk-breadth-title">${termLink(pc.breadthTitle, pc.terms.breadth)}</h3><span class="mk-card-note">${html(pc.breadthCaption)}</span></div>
      ${breadthUnavailable ? `<p class="unit-note">${html(copy.breadthUnavailable)}</p>` : ['KOSPI', 'KOSDAQ'].filter(m => breadth[m]).map(m => breadthBlock(m, breadth[m], f, copy, pc)).join('')}
    </section>`;

  const programItem = name => program.program_trading?.[name]?.net_buy_won;
  // A net amount with an explicit sign (+ / U+2212), as in the flow tables.
  const signedWon = value => {
    if (!valid(value)) return '--';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    const text = f.won(Math.abs(value));
    return f.ko ? `${sign}${text}` : text.replace(/^KRW /, `KRW ${sign}`);
  };
  const basisState = value => (f.ko ? value : { 콘탱고: 'Contango', 백워데이션: 'Backwardation', 중립: 'Flat' }[value]) || value || '--';
  // The futures contract behind the basis, as TODAY names it: "선물(2612)" / "Futures (2612)".
  const futureLabel = name => {
    const text = String(name || '').trim();
    if (!text) return pc.future;
    if (f.ko) return text;
    const month = /\((\d{4})\)/.exec(text);
    return month ? `${pc.future} (${month[1]})` : pc.future;
  };
  const stat = (label, value, sub = '', cls = '', term = '') => `<div class="mk-stat"><span>${termLink(label, term)}</span><strong class="${cls}">${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const shortSummary = shorts.market_summary || {};
  const stats = [
    ...['KOSPI', 'KOSDAQ'].filter(m => internals.turnover?.[m]).map(m => stat(pc.turnoverOf(pc.marketNames[m]), f.won(internals.turnover[m].value_won), valid(internals.turnover[m].ratio5) ? html(pc.ratio5Text(f.number(internals.turnover[m].ratio5, 2))) : '')),
    program.program_trading ? stat(pc.programTotal, signedWon(programItem('전체')), `${html(pc.arbitrage)} ${signedWon(programItem('차익'))} · ${html(pc.nonArbitrage)} ${signedWon(programItem('비차익'))}`, f.signClass(programItem('전체')), pc.terms.program) : '',
    program.basis ? stat(pc.basis, f.signed(program.basis.basis, 2), `<span class="state-chip">${html(basisState(program.basis.market_state))}</span> ${html(pc.spot)} ${f.number(program.basis.kospi200_spot, 2)}${valid(program.basis.future) ? ` · <span>${html(futureLabel(program.basis.future_name))}</span> ${f.number(program.basis.future, 2)}` : ''}`, f.signClass(program.basis.basis), pc.terms.basis) : '',
    ...['KOSPI', 'KOSDAQ'].filter(m => shortSummary[m]).map(m => stat(pc.shortRatioOf(pc.marketNames[m]), f.ratioPct(shortSummary[m].short_value_ratio), `${html(copy.shortAmount)} ${f.won(shortSummary[m].short_value_won)}`, '', pc.terms.short))
  ].filter(Boolean).join('');
  const shortScopeNote = ['KOSPI', 'KOSDAQ'].some(m => /NXT/.test(String(shortSummary[m]?.coverage_scope || '')))
    ? `<p class="unit-note">${html(copy.shortRatioScope)}</p>` : '';
  const shortList = (items, isRatio) => !(items || []).length
    ? `<p class="unit-note">${html(copy.regularUnavailable)}</p>`
    : `<ol class="rank-list">${items.map((item, index) => `<li><span>${index + 1}. <b>${html(companyName(item, lang))}</b><small>${html(item?.market || '')}</small></span><strong>${isRatio ? f.ratioPct(item?.short_value_ratio) : f.won(item?.short_value_won)}</strong></li>`).join('')}</ol>`;
  const shortRanks = shortSummary.KOSPI || shortSummary.KOSDAQ
    ? `<details class="mk-details"><summary>${html(pc.detailsMore)}</summary><div class="short-ranks"><div><h4>${html(copy.shortValue)}</h4>${shortList(shorts.top5_by_value, false)}</div><div><h4>${html(copy.shortRatio)}</h4>${shortList(shorts.top5_by_ratio, true)}</div></div>${shortScopeNote}</details>`
    : '';
  const statsCard = stats ? `<section class="mk-card mk-stats-card" aria-labelledby="mk-stats-title">
      <div class="mk-card-head"><h3 id="mk-stats-title">${html(pc.statsTitle)}</h3></div>
      <div class="mk-stats">${stats}</div>${shortRanks}
    </section>` : '';
  const topCard = caps.length ? `<section class="mk-card mk-top-card" aria-labelledby="mk-top-title">
      <div class="mk-card-head"><h3 id="mk-top-title">${html(pc.topTitle)}</h3><span class="mk-card-note">${html(pc.regularClose)}</span></div>
      <div class="mk-table-wrap"><table class="mk-table mk-cap-table"><thead><tr><th scope="col">${html(pc.stock)}</th><th scope="col">${html(pc.price)}</th><th scope="col">${html(pc.change)}</th><th scope="col" class="mk-col-cap">${html(pc.marketCap)}</th></tr></thead><tbody>${caps.map(item => `<tr><th scope="row"><span class="mk-rank">${html(item?.rank ?? '--')}</span><span class="stock-name"><b>${html(companyName(item, lang))}</b><small>${html(item?.market || '')} · ${html(item?.ticker || '')}</small></span></th><td>${valid(item?.close) ? `${f.number(item.close, 0)}${f.ko ? '원' : ''}` : '--'}</td><td><span class="${f.signClass(item?.change_pct)}">${f.pct(item?.change_pct)}</span></td><td class="mk-col-cap">${f.won(item?.market_cap_won)}</td></tr>`).join('')}</tbody></table></div>
    </section>` : '';
  // Stock rankings follow the session's own stats; a record without their status shows no card.
  // KOFIA market funds of this session (Market Funds, joined by date; published a business day later).
  // A session page shows its own day only. TODAY (context.fundsMaxAgeDays,
  // as assets/market-close.js does) shows the newest day up to the record's
  // date, at most that many days older, under its own date.
  const fundsDate = String(context.marketFunds?.market_date || '');
  const fundsAge = ISO_DATE.test(fundsDate) ? (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${fundsDate}T00:00:00Z`)) / 86400000 : null;
  const fundsShown = context.fundsMaxAgeDays ? fundsAge !== null && fundsAge >= 0 && fundsAge <= context.fundsMaxAgeDays : fundsDate === date;
  const fundsCard = fundsShown
    ? globalThis.MARKET_LOCALE.marketFundsCard(context.marketFunds, key, { dateLabel: dotDate(fundsDate, key) })
    : '';
  const rankingsBody = stockRankingsBody(payload, status, f, copy, lang);
  const rankingsCard = rankingsBody ? `<section class="mk-card mk-rankings-card" aria-labelledby="mk-rankings-title">
      <div class="mk-card-head"><h3 id="mk-rankings-title">${html(copy.rankingsTitle)}</h3><span class="mk-card-note">${html(pc.regularClose)}</span></div>
      ${rankingsBody}
    </section>` : '';
  const sectorBlock = groupBlock(copy.sectors, copy.allSectors, groups.sectors, f, copy);
  const themeBlock = groupBlock(copy.themes, copy.allThemes, groups.themes, f, copy);
  const groupsCard = sectorBlock || themeBlock
    ? `<section class="mk-card mk-groups-card" aria-labelledby="mk-groups-title">
      <div class="mk-card-head"><h3 id="mk-groups-title">${html(pc.groupsTitle)}</h3><a class="mk-card-link" href="${marketSectorsPath(lang)}">${html(copy.sectorsPage)} →</a></div>
      <div class="range-groups-grid">${sectorBlock}${themeBlock}</div>
    </section>`
    : '';

  /* ---- overseas, rates, FX, commodities ---- */
  const row = (group, code) => boardRow(code, group[code], f, copy, lang, date, trend);
  const worldRows = [
    ...['NASDAQ', 'DOW', 'SP500'].filter(code => indices[code]).map(code => row(indices, code)),
    ...(rates.SOX ? [row(rates, 'SOX')] : []),
    ...ASIA_CODES.filter(code => indices[code]).map(code => row(indices, code)),
    ...['VIX', 'VKOSPI'].filter(code => rates[code]).map(code => row(rates, code))
  ].join('');
  const kofiaRows = context.domesticRates?.market_date === date ? domesticRatesBody(context.domesticRates, lang, trend) : '';
  const ratesRows = `${rates.US10Y ? row(rates, 'US10Y') : ''}${kofiaRows}`;
  const fxRows = ['USDKRW', 'JPYKRW', 'CNYKRW', 'EURKRW', 'DXY', 'USDJPY'].filter(code => rates[code]).map(code => row(rates, code)).join('');
  const commodityRows = ['WTI', 'BRENT', 'NATGAS', 'GOLD', 'SILVER', 'COMEX_COPPER', 'BITCOIN'].filter(code => commodities[code]).map(code => row(commodities, code)).join('');
  const boards = `<div class="mk-boards mk-boards-static">
      <div class="mk-board-col">
        ${worldRows ? boardCard('world', pc.boards.world, pc.boardNotes.world, worldRows, pc) : ''}
        ${ratesRows ? boardCard('rates', pc.boards.rates, pc.boardNotes.rates, ratesRows, pc, kofiaRows ? `<p class="mk-unit">${html(copy.ratesNote)}</p>` : '') : ''}
      </div>
      <div class="mk-board-col">
        ${fxRows ? boardCard('fx', pc.boards.fx, fxBoardNote(rates.USDKRW, pc), fxRows, pc, `<p class="mk-board-guide">${usdkrwGuideLink(lang)}</p>`) : ''}
        ${commodityRows ? boardCard('commodities', pc.boards.commodities, pc.boardNotes.commodities, commodityRows, pc) : ''}
      </div>
    </div>`;

  const report = context.report
    ? `<a class="market-report-cta" href="${html(context.report.url)}">${html(copy.report)} <span aria-hidden="true">↗</span></a>`
    : `<p class="market-report-unavailable">${html(copy.noReport)}</p>`;
  const meta = [copy.closeBasis, copy.overseas.replace(/^\*\s*/, '')];

  const dashboard = `<div class="mk-close-line"><p><b>${html(pc.closeOf(monthDayText(date, lang)))}</b> <span>${html(pc.regularBasis)}</span></p>${report}</div>
    <div class="mk-top">
      ${k ? indexCard('KOSPI', k, f, copy, pc, lang, date, trend) : ''}
      ${q ? indexCard('KOSDAQ', q, f, copy, pc, lang, date, trend) : ''}
      ${summaryCard}
    </div>
    <section class="mk-section" aria-labelledby="mk-kr-title">
      <div class="mk-section-head"><h2 id="mk-kr-title">${html(pc.krTitle)}</h2><span>${html(pc.krCaption)}</span></div>
      <div class="mk-grid mk-grid-kr">${flowsCard}${breadthCardHtml}</div>
      ${statsCard || topCard ? `<div class="mk-grid mk-grid-kr2">${statsCard}${topCard}</div>` : ''}
      ${fundsCard ? `<div class="mk-funds-row">${fundsCard}</div>` : ''}
      ${rankingsCard ? `<div class="mk-grid-full">${rankingsCard}</div>` : ''}
      ${groupsCard ? `<div class="mk-grid-full">${groupsCard}</div>` : ''}
    </section>
    <section class="mk-section" aria-labelledby="mk-global-title">
      <div class="mk-section-head"><h2 id="mk-global-title">${html(pc.globalTitle)}</h2><span>${html(pc.globalCaption)}</span></div>
      ${boards}
    </section>
    <p class="market-archive-links"><a class="market-date-dashboard" href="${base}?date=${html(date)}">${html(copy.dashboard)} →</a><a href="${marketArchivePath(lang)}">${html(copy.archive)} →</a><a href="${marketSectorsPath(lang)}">${html(copy.sectorsLink)} →</a><a href="${marketFlowsPath(lang)}">${html(copy.flowsLink)} →</a></p>
    <div class="market-data-note"><p>${html(sessionSource(payload, copy))}</p><p>${html(copy.disclaimer)}</p></div>`;
  // /market/ TODAY's first HTML (functions/_initial-html.js) takes the dashboard alone.
  if (context.dashboardOnly) return dashboard;

  return `<main id="market-date-root" class="market-date-page" data-market-date="${html(date)}">
  ${pageHead({
    id: 'market-date-heading',
    breadcrumb: `<a href="${key === 'en' ? '/en/' : '/'}">${html(copy.breadcrumbHome)}</a> › <a href="${base}">${html(copy.breadcrumbMarket)}</a> › <a href="${marketArchivePath(lang)}">${html(copy.archive)}</a>`,
    eyebrow: pc.pageEyebrow,
    title: copy.heading(date),
    summary,
    lead: takeaway,
    meta
  })}
  <div class="market-wrap">${nav}</div>
  <div class="market-wrap mk-dashboard market-dashboard">
    ${dashboard}
  </div>
  <div class="market-wrap">${nav}</div>
</main>`;
}

// The record's sources: the fixed list, plus Tencent Securities when the
// Shanghai Composite close came from its real-time quote (Yahoo had not
// confirmed the close by the 16:05 KST record).
const TENCENT_SOURCE = '텐센트 증권 실시간 시세';
function sessionSource(payload, copy) {
  const tencent = String(payload?.indices?.SHANGHAI?.source || '').split(' · ')[0] === TENCENT_SOURCE;
  const ecos = payload?.rates_fx_volatility?.USDKRW?.basis === 'seoul_1530';
  return `${copy.source}${ecos ? copy.ecosSource : ''}${tencent ? copy.tencentSource : ''}`;
}

/** The <main> for the list of sessions, newest first, grouped by month. */
export function renderMarketArchiveMain(rows, lang, rateCodes = []) {
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  const f = makeFormat(lang);
  const base = lang === 'en' ? '/en/market/' : '/market/';
  const months = new Map();
  for (const row of rows) {
    const key = row.market_date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(row);
  }
  const headings = lang === 'en'
    ? ['Date', 'KOSPI', 'KOSDAQ', 'Foreign (KOSPI)', 'USD/KRW']
    : ['날짜', '코스피', '코스닥', '외국인(코스피)', '원/달러'];
  const cell = (close, pct) => valid(close) ? `${f.number(close, 2)} <span class="${f.signClass(pct)}">${f.pct(pct)}</span>` : '--';
  const blocks = [...months].map(([month, items]) => {
    const [y, m] = month.split('-').map(Number);
    const title = lang === 'en' ? `${EN_MONTHS[m - 1]} ${y}` : `${y}년 ${m}월`;
    const tableRows = items.map(row => [
      `<a href="${marketDatePath(row.market_date, lang)}">${html(dayLabel(row.market_date, lang))}</a>`,
      cell(row.kospi_close, row.kospi_pct),
      cell(row.kosdaq_close, row.kosdaq_pct),
      `<span class="${f.signClass(row.foreign_net)}">${f.flow(row.foreign_net)}</span>`,
      f.valueUnit('USDKRW', row.usdkrw)
    ]);
    return `<section class="market-section" aria-labelledby="archive-${month}"><h2 id="archive-${month}">${html(title)}</h2>${dataTable(headings, tableRows, 'market-archive-table')}</section>`;
  }).join('\n');
  const heading = lang === 'en' ? 'Korea Market Close Archive' : '날짜별 한국 증시 마감 기록';
  const lead = lang === 'en'
    ? 'Every published session, newest first. Each date opens that session’s full record.'
    : '게시된 모든 거래일을 최신순으로 정리했습니다. 날짜를 누르면 그날의 전체 마감 기록이 열립니다.';
  return `<main id="market-date-root" class="market-date-page market-archive-page">
  ${pageHead({
    id: 'market-archive-heading',
    breadcrumb: `<a href="${lang === 'en' ? '/en/' : '/'}">${html(copy.breadcrumbHome)}</a> › <a href="${base}">${html(copy.breadcrumbMarket)}</a>`,
    eyebrow: PAGE_COPY[lang === 'en' ? 'en' : 'ko'].pageEyebrow,
    title: heading,
    lead,
    meta: [copy.closeBasis]
  })}
  <div class="market-wrap market-dashboard">
${blocks}
    <nav class="indicator-links" id="indicators" aria-labelledby="indicators-heading"><h2 id="indicators-heading">${html(lang === 'en' ? 'Daily history by indicator' : '지표별 일별 기록')}</h2><div>${marketIndicatorLinks(lang, availableIndicatorCodes(rows, rateCodes)).map(link => `<a href="${link.href}">${html(link.name)}</a>`).join('')}</div></nav>
    <p class="market-archive-links"><a href="${marketSectorsPath(lang)}">${html(copy.sectorsLink)} →</a><a href="${marketFlowsPath(lang)}">${html(copy.flowsLink)} →</a></p>
    <div class="market-data-note"><p>${html(copy.source)}</p><p>${html(copy.disclaimer)}</p></div>
  </div>
</main>`;
}

/* ------------------------------------------------------------- the shell */

const SHELL_REPLACEMENTS = [
  ['title', /<title>[^<]*<\/title>/],
  ['description', /<meta name="description" content="[^"]*">/],
  ['canonical', /<link rel="canonical" href="[^"]*">/],
  ['alternates', /<link rel="alternate" hreflang="ko" href="[^"]*">\s*<link rel="alternate" hreflang="en" href="[^"]*">\s*<link rel="alternate" hreflang="x-default" href="[^"]*">/],
  ['ogTitle', /<meta property="og:title" content="[^"]*">/],
  ['ogDescription', /<meta property="og:description" content="[^"]*">/],
  ['ogUrl', /<meta property="og:url" content="[^"]*">/],
  ['twitterTitle', /<meta name="twitter:title" content="[^"]*">/],
  ['twitterDescription', /<meta name="twitter:description" content="[^"]*">/],
  ['jsonLd', /<script type="application\/ld\+json">[\s\S]*?<\/script>/],
  ['body', /<body class="market-close-page"[^>]*>/],
  ['languagePill', /<a class="language-pill" data-language-choice="(?:en|ko)" href="[^"]*"/],
  ['main', /<main id="market-close-root">[\s\S]*?<\/main>/],
  ['dashboardScript', /<script src="\/assets\/market-close\.js[^"]*"><\/script>\n?/]
];

/**
 * The /market/ (or /en/market/) shell with its head and <main> replaced.
 * Throws when the shell no longer has one of the pieces replaced here, so a
 * change to market/index.html cannot quietly ship a page with the dashboard's
 * title or canonical.
 */
export function applyMarketShell(shell, page) {
  const other = page.lang === 'en' ? 'ko' : 'en';
  const values = {
    title: `<title>${html(page.title)}</title>`,
    description: `<meta name="description" content="${html(page.description)}">`,
    canonical: `<link rel="canonical" href="${html(page.canonical)}">`,
    alternates: [
      `<link rel="alternate" hreflang="ko" href="${html(page.alternates.ko)}">`,
      `<link rel="alternate" hreflang="en" href="${html(page.alternates.en)}">`,
      `<link rel="alternate" hreflang="x-default" href="${html(page.alternates.ko)}">`
    ].join('\n'),
    ogTitle: `<meta property="og:title" content="${html(page.title)}">`,
    ogDescription: `<meta property="og:description" content="${html(page.description)}">`,
    ogUrl: `<meta property="og:url" content="${html(page.canonical)}">`,
    twitterTitle: `<meta name="twitter:title" content="${html(page.title)}">`,
    twitterDescription: `<meta name="twitter:description" content="${html(page.description)}">`,
    jsonLd: `<script type="application/ld+json">${serializeJsonLd(page.jsonLd)}</script>`,
    body: '<body class="market-close-page market-date-body">',
    languagePill: `<a class="language-pill" data-language-choice="${other}" href="${html(page.alternates[other].replace(PRODUCTION_ORIGIN, ''))}"`,
    main: page.main,
    dashboardScript: ''
  };
  let out = shell;
  for (const [key, pattern] of SHELL_REPLACEMENTS) {
    if (!pattern.test(out)) throw new Error(`market shell is missing ${key}`);
    out = out.replace(pattern, () => values[key]);
  }
  // The dashboard script uses this list for its Daily-report links. These
  // server-rendered pages already have their links.
  out = out.replace(/<script src="\/data\/posts\.js"><\/script>\n?/, '');
  // A page with a picture of its own (the session's card) shares that instead
  // of the dashboard's standard image. The shell's 1200×630 size tags fit both.
  if (page.image) {
    out = out
      .replace(/<meta property="og:image" content="[^"]*">/, () => `<meta property="og:image" content="${html(page.image)}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, () => `<meta name="twitter:image" content="${html(page.image)}">`);
    if (page.imageAlt) out = out.replace(/<meta property="og:image:alt" content="[^"]*">/, () => `<meta property="og:image:alt" content="${html(page.imageAlt)}">`);
  }
  return out;
}

export function marketDatePageHtml(shell, payload, lang, context = {}) {
  const date = payload.meta.market_date;
  const title = marketDateTitle(payload, lang);
  const description = marketDateDescription(payload, lang);
  const canonical = `${PRODUCTION_ORIGIN}${marketDatePath(date, lang)}`;
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  return applyMarketShell(shell, {
    lang,
    title,
    description,
    canonical,
    alternates: { ko: `${PRODUCTION_ORIGIN}${marketDatePath(date, 'ko')}`, en: `${PRODUCTION_ORIGIN}${marketDatePath(date, 'en')}` },
    jsonLd: pageJsonLd({
      lang,
      title,
      description,
      canonical,
      datePublished: String(context.publishedAt || '').slice(0, 10) || undefined,
      breadcrumb: [
        { name: copy.breadcrumbHome, url: `${PRODUCTION_ORIGIN}${lang === 'en' ? '/en/' : '/'}` },
        { name: copy.breadcrumbMarket, url: `${PRODUCTION_ORIGIN}${lang === 'en' ? '/en/market/' : '/market/'}` },
        { name: copy.archive, url: `${PRODUCTION_ORIGIN}${marketArchivePath(lang)}` },
        { name: longDate(date, lang), url: canonical }
      ]
    }),
    // The session's own card once it has been drawn; the shell's image until then.
    image: context.card ? cardImageUrl(context.card) : '',
    imageAlt: context.card ? title : '',
    main: renderMarketDateMain(payload, lang, context)
  });
}

export function marketArchivePageHtml(shell, rows, lang, rateCodes = []) {
  const title = marketArchiveTitle(lang);
  const description = marketArchiveDescription(lang);
  const canonical = `${PRODUCTION_ORIGIN}${marketArchivePath(lang)}`;
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  return applyMarketShell(shell, {
    lang,
    title,
    description,
    canonical,
    alternates: { ko: `${PRODUCTION_ORIGIN}${marketArchivePath('ko')}`, en: `${PRODUCTION_ORIGIN}${marketArchivePath('en')}` },
    jsonLd: pageJsonLd({
      lang,
      title,
      description,
      canonical,
      breadcrumb: [
        { name: copy.breadcrumbHome, url: `${PRODUCTION_ORIGIN}${lang === 'en' ? '/en/' : '/'}` },
        { name: copy.breadcrumbMarket, url: `${PRODUCTION_ORIGIN}${lang === 'en' ? '/en/market/' : '/market/'}` },
        { name: copy.archive, url: canonical }
      ]
    }),
    main: renderMarketArchiveMain(rows, lang, rateCodes)
  });
}

/* ------------------------------------------------------------------- data */

function withinBudget(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// The source snapshot is already usable. Give the optional ECOS override part
// of the remaining time so a slow FX lookup cannot block the whole page.
function optionalFxBudget(deadline) {
  return Math.min(MARKET_TREND_BUDGET_MS, Math.floor((deadline - Date.now()) / 2));
}

/**
 * { payload, prev, next, publishedAt } for a final session, or null when the
 * date has no final row. Throws on a database failure or timeout.
 */
export async function loadMarketDate(env, date, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs;
  return withinBudget((async () => {
    const db = await ensureMarketTable(env, { readOnly: true });
    const row = await db.prepare(`SELECT market_date, status, published_at, payload_json, takeaway_ko, takeaway_en,
        (SELECT MAX(market_date) FROM ${TABLE_NAME} WHERE market_date < ?1 AND status = 'final') AS prev_date,
        (SELECT MIN(market_date) FROM ${TABLE_NAME} WHERE market_date > ?1 AND status = 'final') AS next_date
      FROM ${TABLE_NAME} WHERE market_date = ?1 LIMIT 1`).bind(date).first();
    if (!row || row.status !== 'final') return null;
    const payload = normalizeKrwPairs(JSON.parse(row.payload_json));
    if (payload?.meta?.market_date !== date || payload?.meta?.status !== 'final') {
      throw new Error(`Invalid final market snapshot for ${date}`);
    }
    // USD/KRW: the day's ECOS 15:30 rate once FX Close has it (contracts/fx_close/).
    const fxBudget = optionalFxBudget(deadline);
    if (fxBudget > 0) {
      const fx = await withinBudget(loadFxCloseDay(env, date), fxBudget).catch(() => undefined);
      applyFxClose(payload, fx);
    }
    payload.takeaway = { ko: String(row.takeaway_ko || ''), en: String(row.takeaway_en || '') };
    return { payload, prev: row.prev_date || null, next: row.next_date || null, publishedAt: row.published_at || '' };
  })(), budgetMs);
}

/** Every final session, newest first, with the figures the archive lists. */
export async function loadMarketArchive(env, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  const deadline = Date.now() + budgetMs;
  return withinBudget((async () => {
    const db = await ensureMarketTable(env, { readOnly: true });
    const result = await db.prepare(`SELECT market_date, published_at,
        json_extract(payload_json, '$.indices.KOSPI.close') AS kospi_close,
        json_extract(payload_json, '$.indices.KOSPI.change_pct') AS kospi_pct,
        json_extract(payload_json, '$.indices.KOSDAQ.close') AS kosdaq_close,
        json_extract(payload_json, '$.indices.KOSDAQ.change_pct') AS kosdaq_pct,
        json_extract(payload_json, '$.krx_investor_trading.markets.KOSPI.investors."외국인".net_buy') AS foreign_net,
        json_extract(payload_json, '$.rates_fx_volatility.USDKRW.close') AS usdkrw,
        ${OPTIONAL_INDICATOR_CLOSES_SQL} AS optional_closes
      FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC`).all();
    const rows = (result?.results || []).filter(row => ISO_DATE.test(String(row?.market_date || '')));
    // USD/KRW: each day's ECOS 15:30 rate where FX Close has it (contracts/fx_close/).
    const fxBudget = optionalFxBudget(deadline);
    const fxDays = fxBudget > 0
      ? await withinBudget(loadFxCloseDays(env), fxBudget).catch(() => undefined)
      : undefined;
    for (const row of fxDays ? rows : []) {
      const item = fxDays.get(row.market_date)?.items?.find(entry => entry?.code === 'USDKRW');
      if (item && valid(item.value)) row.usdkrw = item.value;
    }
    return rows;
  })(), budgetMs);
}

/** The Daily report for `date` in `lang`, as { url }, or null. */
export function dailyReportFor(posts, date, lang) {
  const post = (Array.isArray(posts) ? posts : []).find(item => (
    item?.type === 'daily'
    && String(item?.reportDate || item?.date || '') === date
    && (item?.lang === 'en' ? 'en' : 'ko') === lang
    && typeof item?.href === 'string'
  ));
  if (!post) return null;
  const path = post.href.replace(/^\/+/, '').replace(/\.html?$/i, '');
  return { url: `/${path.split('/').map(encodeURIComponent).join('/')}` };
}

/* ------------------------------------------------------------- the route */

const PAGE_CACHE_CONTROL = 'public, max-age=300';

function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': PAGE_CACHE_CONTROL, ...headers }
  });
}

// The site's 404 page with its 404 status, as for any other missing path.
async function notFound(env, url) {
  try {
    const page = await env?.ASSETS?.fetch(new Request(new URL('/__not-found__', url)));
    if (page && page.status === 404) return htmlResponse(page.body, 404, { 'x-robots-tag': 'noindex' });
  } catch (_) {}
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' } });
}

async function loadShell(env, url, lang) {
  const response = await env.ASSETS.fetch(new Request(new URL(lang === 'en' ? '/en/market/' : '/market/', url)));
  if (!response.ok) throw new Error(`market shell ${response.status}`);
  return response.text();
}

/**
 * functions/market/[[path]].js and functions/en/market/[[path]].js. Any path
 * that is not a session or the archive goes on to the static site, so
 * /market/ itself is untouched.
 */
export async function onMarketPageRequest(context, { loadPostsFn, budgetMs = MARKET_DATE_TIME_BUDGET_MS, trendBudgetMs = MARKET_TREND_BUDGET_MS } = {}) {
  const { request, env } = context;
  const url = new URL(request.url);
  // /market/YYYY-MM-DD/card.jpg: the session's share image.
  const card = parseMarketCardPath(url.pathname);
  if (card) return onMarketCardRequest(context, card);
  const route = parseMarketPagePath(url.pathname);
  if (!route) return context.next();
  if (!route.canonical) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);

  try {
    if (route.indicator?.funds) {
      // A guided fund page names related reads (no latest-session block: KOFIA publishes a day later).
      const postsPromise = INDICATOR_GUIDES[route.indicator.code] ? Promise.resolve().then(() => (loadPostsFn || loadPosts)(request, env)).catch(() => []) : Promise.resolve([]);
      const [{ days, rows }, shell, rateCodes, posts] = await Promise.all([loadMarketFundIndicator(env, { budgetMs }), loadShell(env, url, route.lang), rateCodesWithin(env, budgetMs), postsPromise]);
      const series = marketFundSeries(days, route.indicator, new Set(rows.map(row => row.market_date)));
      if (!series.length) return notFound(env, url);
      return htmlResponse(marketIndicatorPageHtml(shell, route.indicator, series, route.lang, availableIndicatorCodes(rows, [...rateCodes, ...marketFundCodesIn(days)]), { posts }));
    }
    if (route.indicator?.domestic) {
      const [{ days, rows }, shell] = await Promise.all([loadDomesticRateIndicator(env, { budgetMs }), loadShell(env, url, route.lang)]);
      const series = domesticRateSeries(days, route.indicator, new Set(rows.map(row => row.market_date)));
      if (!series.length) return notFound(env, url);
      return htmlResponse(marketIndicatorPageHtml(shell, route.indicator, series, route.lang, availableIndicatorCodes(rows, domesticRateCodesIn(days))));
    }
    if (route.indicator) {
      const guided = Boolean(INDICATOR_GUIDES[route.indicator.code]);
      // A guided page also names the latest session's line and Daily; both fail soft.
      const postsPromise = guided ? Promise.resolve().then(() => (loadPostsFn || loadPosts)(request, env)).catch(() => []) : Promise.resolve([]);
      const [rows, shell, rateCodes, posts] = await Promise.all([loadMarketIndicator(env, route.indicator, { budgetMs }), loadShell(env, url, route.lang), rateCodesWithin(env, budgetMs), postsPromise]);
      // /market/usdkrw/: the ECOS 15:30 rates once FX Close holds any (ECOS days only).
      const fxDays = route.indicator.code === 'USDKRW' ? await withinBudget(loadFxCloseDays(env), budgetMs).catch(() => undefined) : undefined;
      const fxSeoul = Boolean(fxDays && fxDays.size);
      const series = marketIndicatorSeries(fxSeoul ? usdKrwFxRows(rows, fxDays) : rows, route.indicator);
      if (!series.length) return notFound(env, url);
      let context = {};
      if (guided) {
        const date = series[0].recordDate;
        const own = await withinBudget(loadRecordTakeaway(env, date), Math.min(budgetMs, trendBudgetMs)).catch(() => null);
        context = {
          posts,
          latest: { date, line: cardTakeaway(own?.[route.lang], posts, date, route.lang), report: dailyReportFor(posts, date, route.lang) }
        };
      }
      if (fxSeoul) context.fxSeoul = true;
      return htmlResponse(marketIndicatorPageHtml(shell, route.indicator, series, route.lang, availableIndicatorCodes(rows, rateCodes), context));
    }
    if (route.flows) {
      const postsPromise = Promise.resolve().then(() => (loadPostsFn || loadPosts)(request, env)).catch(() => []);
      const [rows, shell, posts] = await Promise.all([loadMarketFlows(env, { budgetMs }), loadShell(env, url, route.lang), postsPromise]);
      const view = marketFlowsView(rows);
      if (!view) return notFound(env, url);
      return htmlResponse(marketFlowsPageHtml(shell, view, route.lang, { posts }));
    }
    if (route.sectors) {
      const [rows, shell] = await Promise.all([loadMarketSectors(env, { budgetMs }), loadShell(env, url, route.lang)]);
      const view = marketSectorsView(rows);
      if (!view) return notFound(env, url);
      return htmlResponse(marketSectorsPageHtml(shell, view, route.lang));
    }
    if (route.archive) {
      const [rows, shell, rateCodes] = await Promise.all([loadMarketArchive(env, { budgetMs }), loadShell(env, url, route.lang), rateCodesWithin(env, budgetMs)]);
      if (!rows.length) return notFound(env, url);
      return htmlResponse(marketArchivePageHtml(shell, rows, route.lang, rateCodes));
    }
    const postsPromise = Promise.resolve().then(() => (loadPostsFn || loadPosts)(request, env)).catch(() => []);
    // The session's KOFIA yields fail soft: without them the page is as before.
    const ratesPromise = withinBudget(loadDomesticRatesDay(env, route.date), budgetMs).catch(() => null);
    // So do its KOFIA market funds, published a business day after the session.
    const fundsPromise = withinBudget(loadMarketFundsDay(env, route.date), budgetMs).catch(() => null);
    // The trend lines fail soft too, on a shorter budget of their own: a slow
    // read leaves the cards and rows without lines instead of holding the page.
    const trendPromise = withinBudget(loadSessionTrend(env, route.date), Math.min(budgetMs, trendBudgetMs)).catch(() => null);
    // Whether the session's card exists yet; the page never waits long for the answer.
    const cardPromise = withinBudget(readMarketCardMeta(env, route.date, route.lang), Math.min(budgetMs, trendBudgetMs)).catch(() => null);
    const [data, shell, posts, domesticRates, trend, cardMeta, marketFunds] = await Promise.all([loadMarketDate(env, route.date, { budgetMs }), loadShell(env, url, route.lang), postsPromise, ratesPromise, trendPromise, cardPromise, fundsPromise]);
    if (!data) return notFound(env, url);
    // The latest session's card is drawn when its record is published. A visit
    // to the page starts another drawing in the background when that card is
    // missing or stale (the attempt failed, or the Daily's takeaway came out
    // since): one per ten minutes. An older session's page does the same as a
    // fill, within the day's allowance (CARD_FILL_PER_DAY).
    const takeaway = cardTakeaway(data.payload.takeaway?.[route.lang], posts, route.date, route.lang);
    if (marketCardIsStale(cardMeta, data.payload, takeaway) && typeof context.waitUntil === 'function') {
      context.waitUntil(ensureMarketCard(env, route.date, route.lang, { posts, fill: Boolean(data.next) }));
    }
    return htmlResponse(marketDatePageHtml(shell, data.payload, route.lang, {
      prev: data.prev,
      next: data.next,
      publishedAt: data.publishedAt,
      report: dailyReportFor(posts, route.date, route.lang),
      domesticRates,
      marketFunds,
      trend,
      card: cardMeta
    }));
  } catch (error) {
    console.error('market date page unavailable', error);
    return temporaryDataPage('market', route.lang);
  }
}

/* ------------------------------------------------------- sectors & themes */

// /market/sectors/ and /en/market/sectors/: every KRX sector and theme index
// ranked by its move in the latest published session, and over the last 5 and
// 20 published sessions. The period figures come from aggregateKrxGroups, the
// same rule as the dashboard's 1W and 1M views.

export function marketSectorsPath(lang = 'ko') {
  return `${lang === 'en' ? '/en' : ''}/market/sectors/`;
}

const SECTORS_COPY = {
  ko: {
    eyebrow: 'KRX 업종·테마 지수',
    heading: '업종 · 테마 등락률 순위',
    breadcrumb: '업종 · 테마',
    lead: date => `${longDate(date, 'ko')} 마감 기준으로 KRX 업종지수와 테마지수를 등락률 순으로 정리했습니다. 최근 5거래일·20거래일 누적 순위도 함께 봅니다.`,
    strongest: (kind, name, pct) => `가장 강한 ${kind} <b>${name}</b> ${pct}`,
    sector: '업종', theme: '테마',
    basis: 'KRX 업종·테마 지수 종가 기준 · 매 거래일 마감 후 갱신',
    note: '지수 가격의 등락률이며, 투자자별 매매동향(수급)이 아닙니다.',
    sections: ['업종지수 등락률', '테마지수 등락률', '최근 5거래일 누적', '최근 20거래일 누적'],
    window: (start, end, n) => `${start} – ${end} · 게시된 ${n}거래일 기준`,
    session: '이날 전체 마감 기록', archive: '전체 마감 기록',
    title: date => `오늘 업종별 등락률·KRX 테마지수 순위 (${dateParts(date).m}월 ${dateParts(date).d}일) | Snowshagal`,
    description: (date, top, bottom, theme) => [
      `${longDate(date, 'ko')} KRX 업종·테마 지수 등락률 순위.`,
      top ? `가장 강한 업종 ${top.name} ${formatSignedPct(top.change_pct)}${bottom ? `, 가장 약한 업종 ${bottom.name} ${formatSignedPct(bottom.change_pct)}` : ''}.` : '',
      theme ? `테마 1위 ${theme.name} ${formatSignedPct(theme.change_pct)}.` : '',
      '최근 5거래일·20거래일 누적 순위까지.'
    ]
  },
  en: {
    eyebrow: 'KRX sector & theme indices',
    heading: 'Korea Sector & Theme Rankings',
    breadcrumb: 'Sectors & Themes',
    lead: date => `KRX sector and theme indices ranked by their move at the ${longDate(date, 'en')} close, with cumulative rankings over the last 5 and 20 sessions.`,
    strongest: (kind, name, pct) => `Strongest ${kind} <b>${name}</b> ${pct}`,
    sector: 'sector', theme: 'theme',
    basis: 'KRX sector and theme index closes · Updated after every session',
    note: 'Index price moves, not investor flows.',
    sections: ['Sector Indices', 'Theme Indices', 'Last 5 Sessions, Cumulative', 'Last 20 Sessions, Cumulative'],
    window: (start, end, n) => `${start} – ${end} · ${n} published sessions`,
    session: 'Full record for this session', archive: 'All sessions',
    title: date => `Korea Sector & Theme Index Rankings, ${longDate(date, 'en')} | Snowshagal`,
    description: (date, top, bottom, theme) => [
      `KRX sector and theme index rankings for ${longDate(date, 'en')}.`,
      top ? `Strongest sector: ${top.name} ${formatSignedPct(top.change_pct)}${bottom ? `; weakest: ${bottom.name} ${formatSignedPct(bottom.change_pct)}` : ''}.` : '',
      theme ? `Top theme: ${theme.name} ${formatSignedPct(theme.change_pct)}.` : '',
      'Plus 5- and 20-session cumulative rankings.'
    ]
  }
};

function rankedBy(items, field) {
  return (Array.isArray(items) ? items : []).filter(item => valid(item?.[field])).sort((a, b) => b[field] - a[field]);
}

/**
 * The figures the page shows, from the newest final rows (newest first, each
 * { market_date, published_at, krx_groups }), or null when the newest
 * session carries no sectors.
 */
export function marketSectorsView(rows) {
  const latest = rows[0];
  if (!latest || !rankedBy(latest.krx_groups?.sectors, 'change_pct').length) return null;
  const period = (sessions) => {
    if (rows.length < sessions) return null;
    const window = rows.slice(0, sessions).reverse();
    const groups = aggregateKrxGroups(window.map(row => ({ krx_groups: row.krx_groups })), window.length, sessions);
    const complete = (items) => (items || []).filter(item => item.complete);
    return { start: window[0].market_date, end: window.at(-1).market_date, sessions, sectors: complete(groups.sectors), themes: complete(groups.themes) };
  };
  return {
    date: latest.market_date,
    publishedAt: latest.published_at || '',
    sectors: rankedBy(latest.krx_groups.sectors, 'change_pct'),
    themes: rankedBy(latest.krx_groups.themes, 'change_pct'),
    week: period(5),
    month: period(20)
  };
}

export function marketSectorsTitle(view, lang) {
  return SECTORS_COPY[lang === 'en' ? 'en' : 'ko'].title(view.date);
}

export function marketSectorsDescription(view, lang) {
  view = localizedSectorsView(view, lang);
  const parts = SECTORS_COPY[lang === 'en' ? 'en' : 'ko']
    .description(view.date, view.sectors[0], view.sectors.length > 1 ? view.sectors.at(-1) : null, view.themes[0])
    .filter(Boolean);
  let text = parts.join(' ');
  while (text.length > 180 && parts.length > 1) {
    parts.pop();
    text = parts.join(' ');
  }
  return text;
}

export function renderMarketSectorsMain(view, lang) {
  view = localizedSectorsView(view, lang);
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  const sc = SECTORS_COPY[lang === 'en' ? 'en' : 'ko'];
  const f = makeFormat(lang);
  const base = lang === 'en' ? '/en/market/' : '/market/';
  const fullTable = (items) => dataTable(groupColumns(items, copy), groupRows(items, f, 'change_pct'), 'compact market-sector-table');
  const periodBody = (period) => {
    if (!period || (!period.sectors.length && !period.themes.length)) return '';
    const blocks = `${groupBlock(copy.sectors, copy.allSectors, period.sectors, f, copy, 'return_pct')}${groupBlock(copy.themes, copy.allThemes, period.themes, f, copy, 'return_pct')}`;
    return `<div class="range-groups-grid">${blocks}</div><p class="unit-note">${html(sc.window(dotDate(period.start, lang), dotDate(period.end, lang), period.sessions))}</p>`;
  };
  const top = view.sectors[0];
  const topTheme = view.themes[0];
  const summary = [
    top ? sc.strongest(sc.sector, html(top.name), `<span class="${f.signClass(top.change_pct)}">${f.pct(top.change_pct)}</span>`) : '',
    topTheme ? sc.strongest(sc.theme, html(topTheme.name), `<span class="${f.signClass(topTheme.change_pct)}">${f.pct(topTheme.change_pct)}</span>`) : ''
  ].filter(Boolean).map(item => `<span class="market-date-fact">${item}</span>`).join('<span class="market-date-sep" aria-hidden="true"> · </span>');

  let n = 0;
  const part = (index, body) => body ? section(++n, sc.sections[index], body) : '';
  const sectorsPart = part(0, view.sectors.length ? fullTable(view.sectors) : '');
  const themesPart = part(1, view.themes.length ? fullTable(view.themes) : '');
  const weekPart = part(2, periodBody(view.week));
  const monthPart = part(3, periodBody(view.month));
  const links = `<p class="market-archive-links"><a href="${marketDatePath(view.date, lang)}">${html(sc.session)} →</a><a href="${marketArchivePath(lang)}">${html(sc.archive)} →</a></p>`;

  return `<main id="market-date-root" class="market-date-page market-sectors-page" data-market-date="${html(view.date)}">
  ${pageHead({
    id: 'market-sectors-heading',
    breadcrumb: `<a href="${lang === 'en' ? '/en/' : '/'}">${html(copy.breadcrumbHome)}</a> › <a href="${base}">${html(copy.breadcrumbMarket)}</a> › ${html(sc.breadcrumb)}`,
    eyebrow: sc.eyebrow,
    title: sc.heading,
    summary,
    meta: [`${dotDate(view.date, lang)} · ${sc.basis}`, sc.note.replace(/^\*\s*/, '')]
  })}
  <div class="market-wrap market-dashboard">
    <p class="market-sectors-lead">${html(sc.lead(view.date))}</p>
    <div class="market-pair market-pair-tables">${sectorsPart}${themesPart}</div>
${[weekPart, monthPart].filter(Boolean).join('\n')}
    ${links}
    <div class="market-data-note"><p>${html(copy.source)}</p><p>${html(copy.disclaimer)}</p></div>
  </div>
</main>`;
}

export function marketSectorsPageHtml(shell, view, lang) {
  const title = marketSectorsTitle(view, lang);
  const description = marketSectorsDescription(view, lang);
  const canonical = `${PRODUCTION_ORIGIN}${marketSectorsPath(lang)}`;
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  const sc = SECTORS_COPY[lang === 'en' ? 'en' : 'ko'];
  return applyMarketShell(shell, {
    lang,
    title,
    description,
    canonical,
    alternates: { ko: `${PRODUCTION_ORIGIN}${marketSectorsPath('ko')}`, en: `${PRODUCTION_ORIGIN}${marketSectorsPath('en')}` },
    jsonLd: pageJsonLd({
      lang,
      title,
      description,
      canonical,
      datePublished: String(view.publishedAt || '').slice(0, 10) || undefined,
      breadcrumb: [
        { name: copy.breadcrumbHome, url: `${PRODUCTION_ORIGIN}${lang === 'en' ? '/en/' : '/'}` },
        { name: copy.breadcrumbMarket, url: `${PRODUCTION_ORIGIN}${lang === 'en' ? '/en/market/' : '/market/'}` },
        { name: sc.breadcrumb, url: canonical }
      ]
    }),
    main: renderMarketSectorsMain(view, lang)
  });
}

/** The newest 20 final sessions' KRX groups, newest first. */
export async function loadMarketSectors(env, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  return withinBudget((async () => {
    const db = await ensureMarketTable(env, { readOnly: true });
    const result = await db.prepare(`SELECT market_date, published_at, json_extract(payload_json, '$.krx_groups') AS krx_groups
      FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC LIMIT 20`).all();
    return (result?.results || [])
      .filter(row => ISO_DATE.test(String(row?.market_date || '')))
      .map(row => {
        let groups = row.krx_groups;
        if (typeof groups === 'string') {
          try { groups = JSON.parse(groups); } catch (_) { groups = null; }
        }
        return { market_date: row.market_date, published_at: row.published_at || '', krx_groups: groups && typeof groups === 'object' ? groups : null };
      });
  })(), budgetMs);
}

/* --------------------------------------------------------- investor flows */

// /market/investor-flows/ and /en/market/investor-flows/: net buying by
// foreign, institutional and retail investors at one address — the newest
// session, its last five published sessions day by day, the month so far, and
// foreign net buying by month. Nothing new is collected: every figure is a
// final Market Close row's krx_investor_trading (KRX, KRW billion). Sums only
// add published sessions, and say how many of the month's KRX trading days
// they cover, so a month with a missing record is never passed off as KRX's
// own monthly total.

export function marketFlowsPath(lang = 'ko') {
  return `${lang === 'en' ? '/en' : ''}/market/investor-flows/`;
}

const FLOW_INVESTORS = ['외국인', '기관', '개인'];
const FLOW_STOCK_MARKETS = ['KOSPI', 'KOSDAQ'];

const FLOWS_COPY = {
  ko: {
    eyebrow: '투자자별 매매동향',
    heading: '외국인 · 기관 · 개인 순매수',
    breadcrumb: '투자자별 수급',
    lead: date => `${longDate(date, 'ko')} 마감 기준 외국인·기관·개인의 코스피·코스닥 순매수입니다. 최근 5거래일 일별 값, 이번 달 누적, 월별 외국인 순매수를 한곳에 모았습니다.`,
    fact: market => `${market} 외국인`,
    basis: 'KRX 투자자별 거래실적 · 정규장 마감 후 확정치 · 매 거래일 갱신',
    sign: '양수는 순매수, 음수는 순매도',
    sections: [date => `${monthDayText(date, 'ko')} 순매수`, () => '최근 5거래일 일별', month => `${month} 누적`, () => '월별 외국인 순매수'],
    day: '날짜', total: '합계', month: '월', sessions: '거래일',
    window: (start, end, n) => `${start} – ${end} · 게시된 ${n}거래일`,
    monthWindow: (start, end, n, expected) => `${start} – ${end} · 게시된 ${n}거래일${expected > n ? ` (이 기간 KRX 거래일 ${expected}일 중)` : ''}`,
    sessionsOf: (n, expected) => (expected > n ? `${n} / ${expected}` : String(n)),
    monthsNote: '거래일은 이 사이트에 마감 기록이 게시된 날 수입니다. 기록이 빠진 날이 있는 달은 “게시일 / KRX 거래일”로 적었고, 그 달 합계는 KRX 공식 월간 합계와 다를 수 있습니다.',
    monthName: month => `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`,
    session: '이날 전체 마감 기록', archive: '날짜별 마감 기록 전체',
    title: date => `오늘 외국인 순매수·순매도 (${dateParts(date).m}월 ${dateParts(date).d}일) · 코스피·코스닥 투자자별 매매동향 | Snowshagal`,
    description: (date, parts) => [
      `${longDate(date, 'ko')} 투자자별 순매수.`,
      ...parts.map(({ market, foreign, institution, individual }) => `${market} 외국인 ${foreign}, 기관 ${institution}, 개인 ${individual}.`),
      '최근 5거래일·이번 달 누적과 월별 외국인 순매수까지.'
    ]
  },
  en: {
    eyebrow: 'Investor flows',
    heading: 'Foreign, Institutional and Retail Net Buying',
    breadcrumb: 'Investor Flows',
    lead: date => `Net buying by foreign, institutional and retail investors on the KOSPI and KOSDAQ at the ${longDate(date, 'en')} close, with the last five sessions day by day, the month so far and foreign net buying by month.`,
    fact: market => `${market} foreign`,
    basis: 'KRX trading by investor type · Final figures after the regular session · Updated every session',
    sign: 'Positive is net buying, negative net selling',
    sections: [date => `Net Buying on ${monthDayText(date, 'en')}`, () => 'Last 5 Sessions, Day by Day', month => `${month} So Far`, () => 'Foreign Net Buying by Month'],
    day: 'Date', total: 'Total', month: 'Month', sessions: 'Sessions',
    window: (start, end, n) => `${start} – ${end} · ${n} published sessions`,
    monthWindow: (start, end, n, expected) => `${start} – ${end} · ${n} published sessions${expected > n ? ` (of ${expected} KRX trading days)` : ''}`,
    sessionsOf: (n, expected) => (expected > n ? `${n} / ${expected}` : String(n)),
    monthsNote: 'Sessions are the days with a close record published on this site. A month missing a record shows “published / KRX trading days”, and its total may differ from KRX’s own monthly figure.',
    monthName: month => `${EN_MONTHS[Number(month.slice(5, 7)) - 1]} ${Number(month.slice(0, 4))}`,
    session: 'Full record for this session', archive: 'All sessions by date',
    title: date => `Korea Foreign Investor Net Buying, ${longDate(date, 'en')}: KOSPI & KOSDAQ Flows | Snowshagal`,
    description: (date, parts) => [
      `Net buying by investor type on ${longDate(date, 'en')}.`,
      ...parts.map(({ market, foreign, institution, individual }) => `${market}: foreign ${foreign}, institutions ${institution}, retail ${individual}.`),
      'Plus the last five sessions, the month so far and foreign net buying by month.'
    ]
  }
};

/**
 * The reading guide under the tables, written like INDICATOR_GUIDES:
 * [[text|term]] links the glossary; related reads are Korean post ids.
 */
export const FLOWS_GUIDE = Object.freeze({
  related: ['2026-11-18-basics-143x6rj', '2026-11-12-note-43vr2c', '2026-11-20-note-g01c86', '2026-08-11-basics-1e0xeuz'],
  ko: {
    title: '외국인 수급 읽는 법',
    paragraphs: [
      '이 페이지의 값은 한국거래소가 정규장 마감 뒤 집계한 투자자별 [[순매수]](산 금액 − 판 금액)입니다. [[개인·외국인·기관]] 밖에도 [[기타법인]] 같은 주체가 있어, 세 값을 더해도 0이 되지는 않습니다.',
      '외국인 순매도가 크다고 곧 지수가 떨어지는 것은 아닙니다. 같은 날 [[기관합계]]와 개인이 얼마를 받아 갔는지, 매도가 몇 종목에 몰렸는지를 함께 봐야 합니다. 외국인 매매는 [[원/달러]] 환율이나 [[코스피200 선물]] 포지션과 함께 움직이는 날이 많아, 당일 표에는 선물 행도 함께 적었습니다.',
      '누적 값은 이 사이트에 마감 기록이 게시된 거래일만 더한 것입니다. 종목별로 무엇을 사고팔았는지는 KRX 정보데이터시스템에서 직접 조회할 수 있고, 조회 방법은 아래 첫 번째 글에 정리했습니다.'
    ]
  },
  en: {
    title: 'How to Read Foreign Flows',
    paragraphs: [
      'Values on this page are the Korea Exchange’s count of [[net buying|net purchases]] (amount bought minus amount sold) by investor type after the regular session. Besides the [[retail, foreign and institutional|retail · foreign · institutional]] groups there are others such as [[other corporations|Other corporations]], so the three figures do not add up to zero.',
      'Heavy foreign selling does not by itself mean the index falls. What [[institutions (total)]] and retail investors absorbed that day, and how many stocks the selling was concentrated in, matter as much. Foreign trading often moves with the [[USD/KRW]] rate and with [[KOSPI 200 futures]] positions, so the day table also shows the futures row.',
      'Cumulative figures add only the sessions with a close record published on this site. What foreigners bought and sold stock by stock can be looked up in the KRX Data Marketplace; the first read below shows how.'
    ]
  }
});

function flowNet(row, market, investor) {
  const value = row?.flows?.[market]?.investors?.[investor]?.net_buy;
  return valid(value) ? value : null;
}

/** KRX trading days from start to end (inclusive), or 0 when a year is not in the calendar. */
function krxTradingDaysBetween(start, end) {
  let count = 0;
  for (let day = start; day <= end; day = shiftDate(day, 1)) {
    if (!isMarketYearSupported('KRX', Number(day.slice(0, 4)))) return 0;
    if (isTradingDate(day, 'KRX')) count += 1;
  }
  return count;
}

/**
 * The figures the page shows, from the final rows newest first (each
 * { market_date, published_at, flows }), or null when the newest session has
 * no KOSPI foreign figure. Sessions without one are left out of every sum.
 */
export function marketFlowsView(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const list = all.filter(row => ISO_DATE.test(String(row?.market_date || '')) && flowNet(row, 'KOSPI', '외국인') !== null);
  const latest = list[0];
  if (!latest || latest !== all[0]) return null;
  const sumOf = (items, market, investor) => {
    const values = items.map(row => flowNet(row, market, investor));
    return values.every(value => value !== null) ? values.reduce((a, b) => a + b, 0) : null;
  };
  const totals = items => Object.fromEntries(FLOW_STOCK_MARKETS.map(market => [market, Object.fromEntries(FLOW_INVESTORS.map(investor => [investor, sumOf(items, market, investor)]))]));
  const recent = list.slice(0, 5);
  const byMonth = new Map();
  for (const row of list) {
    const month = row.market_date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(row);
  }
  const firstDate = list.at(-1).market_date;
  const months = [...byMonth].map(([month, items]) => {
    const start = items.at(-1).market_date;
    const end = items[0].market_date;
    // A month counts the KRX trading days from its 1st (the first record's day
    // in the first month on record) to its last record.
    const from = month === firstDate.slice(0, 7) ? firstDate : `${month}-01`;
    return { month, start, end, sessions: items.length, expected: krxTradingDaysBetween(from, end), totals: totals(items) };
  });
  return {
    date: latest.market_date,
    publishedAt: latest.published_at || '',
    day: latest.flows,
    recent: recent.map(row => ({ date: row.market_date, flows: row.flows })),
    recentTotals: totals(recent),
    months
  };
}

function flowsDescriptionParts(view, lang) {
  const f = makeFormat(lang);
  const names = PAGE_COPY[lang].marketNames;
  return FLOW_STOCK_MARKETS.map(market => {
    const [foreign, institution, individual] = FLOW_INVESTORS.map(investor => f.flow(view.day?.[market]?.investors?.[investor]?.net_buy));
    return { market: names[market], foreign, institution, individual };
  });
}

export function marketFlowsTitle(view, lang) {
  return FLOWS_COPY[lang === 'en' ? 'en' : 'ko'].title(view.date);
}

export function marketFlowsDescription(view, lang) {
  const key = lang === 'en' ? 'en' : 'ko';
  const parts = FLOWS_COPY[key].description(view.date, flowsDescriptionParts(view, key));
  let text = parts.join(' ');
  // Drop the closing line, then KOSDAQ, until it fits.
  while (text.length > 180 && parts.length > 2) {
    parts.pop();
    text = parts.join(' ');
  }
  return text;
}

export function renderMarketFlowsMain(view, lang, context = {}) {
  const key = lang === 'en' ? 'en' : 'ko';
  const copy = COPY[key];
  const pc = PAGE_COPY[key];
  const fc = FLOWS_COPY[key];
  const f = makeFormat(key);
  const base = key === 'en' ? '/en/market/' : '/market/';
  const value = v => `<span class="mk-flow-value ${f.signClass(v)}">${f.flow(v)}</span>`;
  const summary = FLOW_STOCK_MARKETS.map(market => {
    const net = view.day?.[market]?.investors?.['외국인']?.net_buy;
    return valid(net) ? `<span class="market-date-fact">${html(fc.fact(pc.marketNames[market]))} <b class="${f.signClass(net)}">${f.flow(net)}</b></span>` : '';
  }).filter(Boolean).join('<span class="market-date-sep" aria-hidden="true"> · </span>');

  const dayRows = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(market => ({ name: pc.marketNames[market], values: FLOW_INVESTORS.map(investor => view.day?.[market]?.investors?.[investor]?.net_buy) }));
  const dayBody = `${flowTable(dayRows, f, copy)}<p class="mk-unit">${html(pc.flowNote)} · <a href="${marketDatePath(view.date, key)}">${html(fc.session)} →</a></p>`;

  const headings = [fc.day, copy.foreign, copy.institution, copy.individual];
  const recentTable = market => {
    const rows = view.recent.map(item => [
      `<a href="${marketDatePath(item.date, key)}">${html(dayLabel(item.date, key))}</a>`,
      ...FLOW_INVESTORS.map(investor => value(item.flows?.[market]?.investors?.[investor]?.net_buy))
    ]);
    rows.push([`<b>${html(fc.total)}</b>`, ...FLOW_INVESTORS.map(investor => value(view.recentTotals[market][investor]))]);
    return `<div class="market-flows-market"><h3>${html(pc.marketNames[market])}</h3>${dataTable(headings, rows, 'compact market-flows-table')}</div>`;
  };
  const first = view.recent.at(-1);
  const recentBody = `<div class="market-flows-pair">${FLOW_STOCK_MARKETS.map(recentTable).join('')}</div><p class="unit-note">${html(fc.window(dotDate(first.date, key), dotDate(view.date, key), view.recent.length))}</p>`;

  const current = view.months[0];
  const monthRows = FLOW_STOCK_MARKETS.map(market => ({ name: pc.marketNames[market], values: FLOW_INVESTORS.map(investor => current.totals[market][investor]) }));
  const monthBody = `${flowTable(monthRows, f, copy)}<p class="unit-note">${html(fc.monthWindow(dotDate(current.start, key), dotDate(current.end, key), current.sessions, current.expected))}</p>`;

  const monthsTable = dataTable(
    [fc.month, pc.marketNames.KOSPI, pc.marketNames.KOSDAQ, fc.sessions],
    view.months.map(item => [html(fc.monthName(item.month)), value(item.totals.KOSPI['외국인']), value(item.totals.KOSDAQ['외국인']), html(fc.sessionsOf(item.sessions, item.expected))]),
    'compact market-flows-months'
  );
  const monthsBody = `${monthsTable}<p class="unit-note">${html(fc.monthsNote)}</p>`;

  const guide = FLOWS_GUIDE[key];
  const reads = guideReads(FLOWS_GUIDE, context.posts, key);
  const guideBody = `<div class="indicator-guide">${guide.paragraphs.map(item => `<p>${guideParagraph(item, key)}</p>`).join('')}${reads.length
    ? `<h3>${html(GUIDE_COPY[key].related)}</h3><ul class="indicator-guide-reads">${reads.map(read => `<li><a href="${html(read.href)}">${html(read.title)}</a></li>`).join('')}</ul>`
    : ''}</div>`;

  return `<main id="market-date-root" class="market-date-page market-flows-page" data-market-date="${html(view.date)}">
  ${pageHead({
    id: 'market-flows-heading',
    breadcrumb: `<a href="${key === 'en' ? '/en/' : '/'}">${html(copy.breadcrumbHome)}</a> › <a href="${base}">${html(copy.breadcrumbMarket)}</a> › ${html(fc.breadcrumb)}`,
    eyebrow: fc.eyebrow,
    title: fc.heading,
    summary,
    meta: [`${dotDate(view.date, key)} · ${fc.basis}`, fc.sign]
  })}
  <div class="market-wrap market-dashboard">
    <p class="market-sectors-lead">${html(fc.lead(view.date))}</p>
    ${section(1, fc.sections[0](view.date), dayBody)}
    ${section(2, fc.sections[1](), recentBody)}
    ${section(3, fc.sections[2](fc.monthName(current.month)), monthBody)}
    ${section(4, fc.sections[3](), monthsBody)}
    ${section(5, guide.title, guideBody)}
    <p class="market-archive-links"><a href="${marketDatePath(view.date, key)}">${html(fc.session)} →</a><a href="${marketArchivePath(key)}">${html(fc.archive)} →</a><a href="${marketSectorsPath(key)}">${html(copy.sectorsLink)} →</a></p>
    <div class="market-data-note"><p>${html(copy.source)}</p><p>${html(copy.disclaimer)}</p></div>
  </div>
</main>`;
}

export function marketFlowsPageHtml(shell, view, lang, context = {}) {
  const key = lang === 'en' ? 'en' : 'ko';
  const title = marketFlowsTitle(view, key);
  const description = marketFlowsDescription(view, key);
  const canonical = `${PRODUCTION_ORIGIN}${marketFlowsPath(key)}`;
  const copy = COPY[key];
  return applyMarketShell(shell, {
    lang: key,
    title,
    description,
    canonical,
    alternates: { ko: `${PRODUCTION_ORIGIN}${marketFlowsPath('ko')}`, en: `${PRODUCTION_ORIGIN}${marketFlowsPath('en')}` },
    jsonLd: pageJsonLd({
      lang: key,
      title,
      description,
      canonical,
      datePublished: String(view.publishedAt || '').slice(0, 10) || undefined,
      breadcrumb: [
        { name: copy.breadcrumbHome, url: `${PRODUCTION_ORIGIN}${key === 'en' ? '/en/' : '/'}` },
        { name: copy.breadcrumbMarket, url: `${PRODUCTION_ORIGIN}${key === 'en' ? '/en/market/' : '/market/'}` },
        { name: FLOWS_COPY[key].breadcrumb, url: canonical }
      ]
    }),
    main: renderMarketFlowsMain(view, key, context)
  });
}

/** Every final session's investor flows, newest first. */
export async function loadMarketFlows(env, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  return withinBudget((async () => {
    const db = await ensureMarketTable(env, { readOnly: true });
    const result = await db.prepare(`SELECT market_date, published_at, json_extract(payload_json, '$.krx_investor_trading.markets') AS flows
      FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC`).all();
    return (result?.results || [])
      .filter(row => ISO_DATE.test(String(row?.market_date || '')))
      .map(row => {
        let flows = row.flows;
        if (typeof flows === 'string') {
          try { flows = JSON.parse(flows); } catch (_) { flows = null; }
        }
        return { market_date: row.market_date, published_at: row.published_at || '', flows: flows && typeof flows === 'object' ? flows : null };
      });
  })(), budgetMs);
}

/* ------------------------------------------------------ indicator history */

// /market/{indicator}/ and /en/market/{indicator}/: one page per instrument the
// Market Close records (KOSPI … BITCOIN), listing every value it has stored,
// newest first, with the change, a chart, and the record's high and low.
//
// Nothing new is collected: each row is that instrument's item in a final
// Market Close row (D1), as the session page shows it. What a value is depends
// on the instrument and is said on the page:
//   krx      — KRX regular-session close (dated the KRX session)
//   us       — the U.S. close the record carries, dated the U.S. session
//   fx       — Hana Bank's posted rate, last round before 15:30 KST (via Naver Finance)
//   snapshot — the quote when the record was made, shortly after the Korea
//              close; its change is against the previous record, because the
//              provider's previous close is a different series (a settlement)

const INDICATOR_NAMES = {
  ko: {
    KOSPI: '코스피 지수', KOSDAQ: '코스닥 지수', NASDAQ: '나스닥 종합지수', DOW: '다우존스 지수', SP500: 'S&P 500 지수',
    NIKKEI225: '닛케이225 지수', SHANGHAI: '상해종합지수', TAIEX: '대만 가권지수',
    SOX: '필라델피아 반도체지수', VIX: 'VIX 변동성지수', VKOSPI: 'VKOSPI(코스피200 변동성지수)', US10Y: '미국 국채 10년물 금리', USDKRW: '원/달러 환율',
    JPYKRW: '원/엔 환율(100엔)', DXY: '달러인덱스', WTI: 'WTI 유가', GOLD: '금 선물 가격', BITCOIN: '비트코인 가격',
    CNYKRW: '원/위안 환율', EURKRW: '원/유로 환율', USDJPY: '엔/달러 환율', BRENT: '브렌트유 가격', NATGAS: '천연가스 선물 가격',
    SILVER: '은 선물 가격', COMEX_COPPER: '구리 선물 가격',
    KTB3Y: '국고채 3년물 금리', KTB10Y: '국고채 10년물 금리', CORPAA3Y: '회사채 AA- 3년물 금리', CD91: 'CD 91일물 금리',
    DEPOSITS: '투자자예탁금(고객예탁금)', CREDIT: '신용거래융자 잔고', FORCED_SALE: '반대매매 금액'
  },
  en: {
    KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', NASDAQ: 'NASDAQ Composite', DOW: 'Dow Jones Industrial Average', SP500: 'S&P 500',
    NIKKEI225: 'Nikkei 225', SHANGHAI: 'Shanghai Composite Index', TAIEX: 'TAIEX (Taiwan Weighted Index)',
    SOX: 'PHLX Semiconductor Index (SOX)', VIX: 'VIX Volatility Index', VKOSPI: 'VKOSPI (KOSPI 200 Volatility Index)', US10Y: 'US 10-Year Treasury Yield', USDKRW: 'USD/KRW Exchange Rate',
    JPYKRW: 'JPY/KRW Exchange Rate (per 100 yen)', DXY: 'US Dollar Index (DXY)', WTI: 'WTI Crude Oil', GOLD: 'Gold Futures', BITCOIN: 'Bitcoin',
    CNYKRW: 'CNY/KRW Exchange Rate', EURKRW: 'EUR/KRW Exchange Rate', USDJPY: 'USD/JPY Exchange Rate', BRENT: 'Brent Crude Oil',
    NATGAS: 'Natural Gas Futures', SILVER: 'Silver Futures', COMEX_COPPER: 'Copper Futures (COMEX)',
    KTB3Y: 'Korea Treasury Bond 3-Year Yield', KTB10Y: 'Korea Treasury Bond 10-Year Yield',
    CORPAA3Y: 'Korean Corporate Bond (AA-) 3-Year Yield', CD91: 'Korean CD 91-Day Rate',
    DEPOSITS: 'Korean Investor Deposits', CREDIT: 'Korean Margin Loan Balance', FORCED_SALE: 'Korean Forced Selling (Margin Liquidation)'
  }
};

// What a commodity price is quoted per, after the basis line.
const INDICATOR_UNITS = {
  ko: { WTI: '달러/배럴', BRENT: '달러/배럴', NATGAS: '달러/MMBtu', GOLD: '달러/트로이온스', SILVER: '달러/트로이온스', COMEX_COPPER: '달러/파운드(COMEX)' },
  en: { WTI: 'USD per barrel', BRENT: 'USD per barrel', NATGAS: 'USD per MMBtu', GOLD: 'USD per troy ounce', SILVER: 'USD per troy ounce', COMEX_COPPER: 'USD per pound (COMEX)' }
};

const INDICATOR_COPY = {
  ko: {
    eyebrow: '지표별 일별 기록',
    heading: name => `${name} 일별 기록`,
    noun: { krx: '일별 종가', krxvol: '일별 종가', us: '일별 종가', asia: '일별 종가', fx: '일별 기록', snapshot: '일별 기록', rate: '일별 기록', kofia: '일별 기록', funds: '일별 추이' },
    valueLabel: { krx: '종가', krxvol: '종가', us: '종가', asia: '종가', fx: '하나은행 고시', snapshot: '기록 시세', rate: '수익률', kofia: '수익률', funds: '금액' },
    basis: {
      krx: 'KRX 정규장 15:30 종가 기준 · 매 거래일 마감 후 갱신',
      krxvol: 'KRX 파생상품 정규장 15:45 마감 종가(코스피200 옵션 기준) · 매 거래일 마감 후 갱신',
      us: '미국 정규장 종가 · 날짜는 미국 거래일 · 한국 증시 마감 기록에 담긴 값',
      asia: '현지 정규장 종가 · 날짜는 현지 거래일 · 한국 증시 마감 기록에 담긴 값',
      NIKKEI225: '도쿄 정규장 15:30 종가(한국 시각 15:30) · 날짜는 일본 거래일 · 한국 증시 마감 기록에 담긴 값',
      SHANGHAI: '상하이 정규장 15:00 종가(한국 시각 16:00) · 날짜는 중국 거래일 · 한국 증시 마감 기록에 담긴 값 · 야후 파이낸스, 마감 기록 시점에 종가가 확정되지 않았으면 텐센트 증권 실시간 시세',
      TAIEX: '타이베이 정규장 13:30 종가(한국 시각 14:30) · 날짜는 대만 거래일 · 한국 증시 마감 기록에 담긴 값',
      fx: '하나은행 고시 매매기준율(15:30 직전 회차, 네이버 금융) · 대비는 전 거래일 고시값 대비 · 매 거래일 갱신',
      snapshot: '한국 증시 마감 직후(오후 4시 무렵 KST) 시세 · 변동은 직전 기록 대비',
      kofia: '금융투자협회 최종호가수익률 · 16:00 KST 기준 · 매 거래일 갱신 · 대비는 금융투자협회 전일 값 대비',
      DEPOSITS: '금융투자협회 증시자금 추이 · 장내파생상품 거래예수금 제외 · 거래일 마감 잔액 · 다음 영업일 공개 · 대비는 직전 거래일 대비',
      CREDIT: '금융투자협회 신용공여 잔고 추이 · 유가증권시장과 코스닥 합계 · 거래일 마감 잔고 · 다음 영업일 공개 · 대비는 직전 거래일 대비',
      FORCED_SALE: '금융투자협회 증시자금 추이 · 위탁매매 미수금에 대한 실제 반대매매 금액 · 다음 영업일 공개 · 대비는 직전 거래일 대비'
    },
    sections: ['요약', '추이'],
    latest: '최근', weekAgo: '1주 전 대비', monthAgo: '1개월 전 대비', since: date => `${date} 이후`, high: '기록 최고', low: '기록 최저',
    columns: { date: '날짜', value: '값', change: '대비', pct: '등락률', high: '고가', low: '저가' },
    changeVsPrev: { snapshot: '직전 기록 대비' },
    usDates: '날짜는 미국 거래일입니다. 날짜를 누르면 그 값을 기록한 한국 증시 마감 기록이 열립니다.',
    localDates: '날짜는 현지 거래일입니다. 현지 휴장일에는 직전 종가가 이어지므로 한 번만 적습니다. 날짜를 누르면 그 값을 처음 기록한 한국 증시 마감 기록이 열립니다.',
    krxDates: '날짜를 누르면 그날의 전체 마감 기록이 열립니다.',
    kofiaDates: '날짜를 누르면 그날의 전체 마감 기록이 열립니다. 마감 기록이 없는 날은 날짜만 표시합니다.',
    fundsDates: '날짜는 자금이 집계된 한국 거래일입니다. 금융투자협회는 다음 영업일에 공개합니다. 날짜를 누르면 그날의 전체 마감 기록이 열립니다.',
    gaps: '한국 증시 마감 기록이 게시된 날의 값만 담았습니다. 기록이 없는 날과, 한국 휴장일에 열린 해외 거래일은 빠질 수 있습니다.',
    kofiaGaps: '금융투자협회가 공시한 한국 거래일의 값입니다. 데이터 출처: 금융투자협회 채권정보센터.',
    fxSeoulBasis: '서울 외환시장 오후 3시 30분 기준가 · 한국은행 ECOS · 대비는 전 거래일 기준가 대비 · 매 거래일 갱신',
    fxSeoulValue: '15:30 기준가',
    fxSeoulGaps: '한국은행 경제통계시스템(ECOS)이 공개한 거래일의 서울 외환시장 오후 3시 30분 기준가입니다. 데이터 출처: 한국은행 ECOS.',
    fundsGaps: '금융투자협회가 공시한 한국 거래일의 값입니다. 데이터 출처: 금융투자협회 종합통계서비스(FreeSIS).',
    chartLabel: (name, first, last) => `${name} 추이, ${first}부터 ${last}까지`,
    chartNote: '거래일 순서로 그린 선입니다. 날짜별 값은 아래 표에 있습니다.',
    related: '다른 지표의 일별 기록', archive: '날짜별 전체 마감 기록', dashboard: '오늘의 마켓', breadcrumb: '지표별 기록',
    title: (short, noun, date, value, move) => `${short} ${noun} · ${date} ${value}${move ? `(${move})` : ''} | Snowshagal`,
    description: ({ name, noun, date, value, pct, month, high, low, start }) => [
      `${name}의 날짜별 기록과 추이.`,
      `${date} ${value}${pct ? `(${pct})` : ''}.`,
      month ? `1개월 전 대비 ${month}.` : '',
      high && low ? `기록 기간 최고 ${high}, 최저 ${low}.` : '',
      `${start}부터 매 거래일 갱신.`
    ]
  },
  en: {
    eyebrow: 'Indicator history',
    heading: name => `${name}: Daily History`,
    noun: { krx: 'Daily Close', krxvol: 'Daily Close', us: 'Daily Close', asia: 'Daily Close', fx: 'History', snapshot: 'History', rate: 'History', kofia: 'History', funds: 'History' },
    valueLabel: { krx: 'Close', krxvol: 'Close', us: 'Close', asia: 'Close', fx: 'Hana Bank rate', snapshot: 'Recorded price', rate: 'Yield', kofia: 'Yield', funds: 'Amount' },
    basis: {
      krx: 'KRX regular-session close, 15:30 KST · Updated after every session',
      krxvol: 'KRX derivatives-session close, 15:45 KST (from KOSPI 200 options) · Updated after every session',
      us: 'U.S. regular-session close · Dates are U.S. trading days · As carried by the Korea close record',
      asia: 'Local regular-session close · Dates are local trading days · As carried by the Korea close record',
      NIKKEI225: 'Tokyo regular-session close, 15:30 JST (15:30 KST) · Dates are Japanese trading days · As carried by the Korea close record',
      SHANGHAI: 'Shanghai regular-session close, 15:00 CST (16:00 KST) · Dates are Chinese trading days · As carried by the Korea close record · Yahoo Finance, or Tencent Securities real-time quotes when Yahoo had not confirmed the close by the record',
      TAIEX: 'Taipei regular-session close, 13:30 (14:30 KST) · Dates are Taiwanese trading days · As carried by the Korea close record',
      fx: 'Hana Bank posted rate, last round before 15:30 KST (via Naver Finance) · Change against the previous trading day’s posted rate · Updated every session',
      snapshot: 'Quote shortly after the Korea close (around 16:00 KST) · Change against the previous record',
      kofia: 'KOFIA final quote yield, 16:00 KST · Updated every Korean trading day · Change against KOFIA’s previous-day value',
      DEPOSITS: 'KOFIA market funds · Excludes exchange-traded derivatives deposits · End-of-day balance · Published the next business day · Change against the previous trading day',
      CREDIT: 'KOFIA credit balances · KOSPI and KOSDAQ combined · End-of-day balance · Published the next business day · Change against the previous trading day',
      FORCED_SALE: 'KOFIA market funds · Forced selling of unpaid margin · Published the next business day · Change against the previous trading day'
    },
    sections: ['Summary', 'Trend'],
    latest: 'Latest', weekAgo: 'vs. 1 week ago', monthAgo: 'vs. 1 month ago', since: date => `Since ${date}`, high: 'Record high', low: 'Record low',
    columns: { date: 'Date', value: 'Value', change: 'Change', pct: 'Change %', high: 'High', low: 'Low' },
    changeVsPrev: { snapshot: 'vs. previous record' },
    usDates: 'Dates are U.S. trading days. Each date opens the Korea close record that carried the value.',
    localDates: 'Dates are local trading days. On a local holiday the record carries the previous close, listed once. Each date opens the first Korea close record that carried the value.',
    krxDates: 'Each date opens that session’s full close record.',
    kofiaDates: 'Each linked date opens that session’s full close record; days without one are listed without a link.',
    fundsDates: 'Dates are the Korean trading days the figures describe; KOFIA publishes them the next business day. Each linked date opens that session’s full close record.',
    gaps: 'Only days with a published Korea close record are listed. Days without one, and overseas sessions held on Korean market holidays, may be missing.',
    kofiaGaps: 'Values for each Korean trading day KOFIA published. Source: KOFIA Bond Information Service.',
    fxSeoulBasis: 'Seoul FX market 3:30 p.m. KST rate · Bank of Korea ECOS · Change against the previous trading day’s rate · Updated every session',
    fxSeoulValue: '3:30 p.m. rate',
    fxSeoulGaps: 'The Seoul FX market’s 3:30 p.m. rate of each trading day the Bank of Korea published on ECOS. Source: Bank of Korea ECOS.',
    fundsGaps: 'Values for each Korean trading day KOFIA published. Source: KOFIA FreeSIS statistics.',
    chartLabel: (name, first, last) => `${name} from ${first} to ${last}`,
    chartNote: 'Plotted in trading-day order. Each day’s value is in the table below.',
    related: 'Daily history of other indicators', archive: 'All sessions by date', dashboard: 'Today’s market', breadcrumb: 'Indicator history',
    title: (short, noun, date, value, move) => `${short} ${noun}: ${value}${move ? ` (${move})` : ''} on ${date} | Snowshagal`,
    description: ({ name, noun, date, value, pct, month, high, low, start }) => [
      `${name} by date, with its trend.`,
      `${date}: ${value}${pct ? ` (${pct})` : ''}.`,
      month ? `1-month change ${month}.` : '',
      high && low ? `Record high ${high}, low ${low}.` : '',
      `Updated every session since ${start}.`
    ]
  }
};

// Short names for titles ("원/달러 환율", "USD/KRW").
const INDICATOR_SHORT_NAMES = {
  ko: { ...INDICATOR_NAMES.ko, KOSPI: '코스피', KOSDAQ: '코스닥', NASDAQ: '나스닥', DOW: '다우존스', SP500: 'S&P 500', VIX: 'VIX', VKOSPI: 'VKOSPI', JPYKRW: '원/엔 환율', GOLD: '금 선물', BITCOIN: '비트코인', BRENT: '브렌트유', NATGAS: '천연가스', SILVER: '은 선물', COMEX_COPPER: '구리 선물', KTB3Y: '국고채 3년 금리', KTB10Y: '국고채 10년 금리', CORPAA3Y: '회사채 AA- 3년 금리', CD91: 'CD 91일 금리', DEPOSITS: '투자자예탁금', CREDIT: '신용융자 잔고', FORCED_SALE: '반대매매' },
  en: { ...INDICATOR_NAMES.en, NASDAQ: 'NASDAQ', DOW: 'Dow Jones', SHANGHAI: 'Shanghai Composite', TAIEX: 'TAIEX', SOX: 'SOX', VIX: 'VIX', VKOSPI: 'VKOSPI', US10Y: 'US 10Y Yield', USDKRW: 'USD/KRW', JPYKRW: 'JPY/KRW', DXY: 'Dollar Index', WTI: 'WTI Crude', GOLD: 'Gold', CNYKRW: 'CNY/KRW', EURKRW: 'EUR/KRW', USDJPY: 'USD/JPY', BRENT: 'Brent Crude', NATGAS: 'Natural Gas', SILVER: 'Silver', COMEX_COPPER: 'Copper', KTB3Y: 'KTB 3Y Yield', KTB10Y: 'KTB 10Y Yield', CORPAA3Y: 'Corporate AA- 3Y Yield', CD91: 'CD 91-Day Rate', DEPOSITS: 'Investor Deposits', CREDIT: 'Margin Loans', FORCED_SALE: 'Forced Selling' }
};

const indicatorKind = (indicator) => (indicator.code === 'US10Y' ? 'rate' : indicator.kind);

/**
 * A domestic rate's series from the stored Domestic Rates days (DTOs), newest
 * first, in the shape marketIndicatorSeries returns. `recordDates`: the dates
 * with a final Market Close record, so a day links to its session page only
 * when there is one (a backfilled day may predate the records).
 */
export function domesticRateSeries(days, indicator, recordDates = new Set()) {
  const seen = new Map();
  for (const day of Array.isArray(days) ? days : []) {
    if (!ISO_DATE.test(String(day?.market_date || '')) || seen.has(day.market_date)) continue;
    const item = (day.items || []).find(entry => entry?.code === indicator.code);
    if (!item || !valid(item.value)) continue;
    seen.set(day.market_date, {
      date: day.market_date,
      recordDate: recordDates.has(day.market_date) ? day.market_date : null,
      publishedAt: day.published_at || '',
      close: item.value,
      change: valid(item.previous_value) ? item.value - item.previous_value : null,
      changePct: null,
      high: null,
      low: null
    });
  }
  return [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * A market fund's series from the stored Market Funds days (DTOs), newest
 * first, in the shape marketIndicatorSeries returns. The change is against the
 * previous trading day's figure that KOFIA's table carries with each day.
 */
export function marketFundSeries(days, indicator, recordDates = new Set()) {
  const seen = new Map();
  for (const day of Array.isArray(days) ? days : []) {
    if (!ISO_DATE.test(String(day?.market_date || '')) || seen.has(day.market_date)) continue;
    const item = (day.items || []).find(entry => entry?.code === indicator.code);
    if (!item || !valid(item.value)) continue;
    const before = valid(item.previous_value) ? item.previous_value : null;
    seen.set(day.market_date, {
      date: day.market_date,
      recordDate: recordDates.has(day.market_date) ? day.market_date : null,
      publishedAt: day.published_at || '',
      close: item.value,
      change: before === null ? null : item.value - before,
      changePct: before ? (item.value / before - 1) * 100 : null,
      high: null,
      low: null
    });
  }
  return [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * The stored series for one instrument, newest first: { date, recordDate,
 * close, change, changePct, high, low }. `date` is the instrument's own
 * session (the U.S. session for U.S. instruments) and `recordDate` the Market
 * Close row that carried it. A U.S. session carried by two records is listed
 * once, under the first record.
 */
/**
 * /market/usdkrw/ once FX Close holds days: the stored records (for session
 * links) with USD/KRW replaced by that day's ECOS 15:30 rate, ECOS days only.
 */
export function usdKrwFxRows(rows, fxDays) {
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const item = fxDays.get(String(row?.market_date || ''))?.items?.find(entry => entry?.code === 'USDKRW');
    if (!item || !valid(item.value) || !valid(item.previous_value)) return [];
    return [{ ...row, item: { close: item.value, previous_close: item.previous_value, data_state: 'final_close', source_date: row.market_date } }];
  });
}

export function marketIndicatorSeries(rows, indicator) {
  const seen = new Map();
  const ordered = (Array.isArray(rows) ? rows : [])
    .filter(row => ISO_DATE.test(String(row?.market_date || '')))
    .slice()
    .sort((a, b) => (a.market_date < b.market_date ? -1 : a.market_date > b.market_date ? 1 : 0));
  for (const row of ordered) {
    let item = row.item;
    if (typeof item === 'string') {
      try { item = JSON.parse(item); } catch (_) { item = null; }
    }
    if (!item || typeof item !== 'object' || item.data_state === 'unavailable' || !valid(item.close)) continue;
    const date = (indicator.kind === 'us' || indicator.kind === 'asia') && ISO_DATE.test(String(item.source_date || '')) ? item.source_date : row.market_date;
    if (seen.has(date)) continue;
    const trueClose = indicator.kind !== 'snapshot' && valid(item.previous_close) && item.previous_close > 0;
    seen.set(date, {
      date,
      recordDate: row.market_date,
      publishedAt: row.published_at || '',
      close: item.close,
      change: trueClose ? item.close - item.previous_close : null,
      changePct: trueClose ? (item.close / item.previous_close - 1) * 100 : null,
      high: valid(item.high) ? item.high : null,
      low: valid(item.low) ? item.low : null
    });
  }
  const series = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (indicator.kind === 'snapshot') {
    series.forEach((point, index) => {
      const before = series[index + 1];
      if (before && before.close > 0) {
        point.change = point.close - before.close;
        point.changePct = (point.close / before.close - 1) * 100;
      }
    });
  }
  return series;
}

function shiftIsoDate(value, { days = 0, months = 0 } = {}) {
  const { y, m, d } = dateParts(value);
  const date = new Date(Date.UTC(y, m - 1 + months, d + days));
  // 31 March minus a month is the last day of February, not 3 March.
  if (months && date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/** Latest point, the 1-week and 1-month references, the first point, high and low. */
export function marketIndicatorStats(series) {
  if (!series.length) return null;
  const latest = series[0];
  const onOrBefore = (date) => series.find(point => point.date <= date) || null;
  const weekRef = onOrBefore(shiftIsoDate(latest.date, { days: -7 }));
  const monthRef = onOrBefore(shiftIsoDate(latest.date, { months: -1 }));
  const first = series[series.length - 1];
  let high = latest;
  let low = latest;
  for (const point of series) {
    if (point.close > high.close) high = point;
    if (point.close < low.close) low = point;
  }
  return {
    latest,
    week: weekRef && weekRef !== latest ? weekRef : null,
    month: monthRef && monthRef !== latest ? monthRef : null,
    first: first !== latest ? first : null,
    high,
    low,
    count: series.length
  };
}

function indicatorFormat(indicator, f) {
  const code = indicator.code;
  const digits = code === 'BITCOIN' ? 0 : digitsOf(code);
  const value = (number) => f.valueUnit(code, number);
  const funds = isMarketFundIndicator(code);
  const change = (number) => {
    if (!valid(number)) return '--';
    if (isYield(code)) return `${f.signed(number * 100, 1)}bp`;
    if (funds) return globalThis.MARKET_LOCALE.marketFundChange(number, f.ko ? 'ko' : 'en').text;
    return f.signed(number, digits);
  };
  // The move from `from` to `to`: bp for a yield, % for everything else.
  const move = (to, from) => {
    if (!to || !from || !valid(to.close) || !valid(from.close) || from.close === 0) return null;
    if (isYield(code)) return { text: `${f.signed((to.close - from.close) * 100, 1)}bp`, sign: to.close - from.close };
    const pct = (to.close / from.close - 1) * 100;
    return { text: f.pct(pct), sign: pct };
  };
  return { value, change, move };
}

function niceStep(range, targetTicks = 3) {
  const raw = range / targetTicks;
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * A server-rendered line chart: the plot is an SVG stretched to its box (the
 * line keeps 2px), and every label is HTML, so text stays readable at any
 * width. Each trading day has a hover band with its value; the table below is
 * the full, accessible view.
 */
function indicatorChart(series, indicator, fmt, copy, lang) {
  const points = series.slice().reverse();
  if (points.length < 2) return '';
  const closes = points.map(point => point.close);
  let min = Math.min(...closes);
  let max = Math.max(...closes);
  if (min === max) { min -= 1; max += 1; }
  const step = niceStep(max - min);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const W = 1000;
  const H = 300;
  const x = (index) => (index / (points.length - 1)) * W;
  const y = (value) => H - ((value - lo) / (hi - lo)) * H;
  const pct = (value) => `${((y(value) / H) * 100).toFixed(2)}%`;
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point.close).toFixed(1)}`).join('');
  const area = `${path}L${W},${H}L0,${H}Z`;
  const ticks = [];
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(Number(value.toFixed(10)));
  const tickDigits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const tickText = (value) => (isYield(indicator.code) ? `${value.toFixed(tickDigits)}%`
    : isMarketFundIndicator(indicator.code) ? fundTick(value, step, lang)
      : new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ko-KR', { minimumFractionDigits: tickDigits, maximumFractionDigits: tickDigits }).format(value));
  const band = W / points.length;
  const hover = points.map((point, index) => `<rect x="${Math.max(0, x(index) - band / 2).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}"><title>${html(dotDate(point.date, lang))} ${html(stripTags(fmt.value(point.close)))}</title></rect>`).join('');
  const last = points[points.length - 1];
  const first = points[0];
  const label = copy.chartLabel(INDICATOR_NAMES[lang][indicator.code], dotDate(first.date, lang), dotDate(last.date, lang));
  return `<figure class="indicator-chart">
      <div class="indicator-chart-plot" role="img" aria-label="${html(label)}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          ${ticks.map(value => `<line class="indicator-chart-grid" x1="0" x2="${W}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}"/>`).join('')}
          <path class="indicator-chart-area" d="${area}"/>
          <path class="indicator-chart-line" d="${path}"/>
          <g class="indicator-chart-hover">${hover}</g>
        </svg>
        ${ticks.map(value => `<span class="indicator-chart-tick" style="top:${pct(value)}">${html(tickText(value))}</span>`).join('')}
        <span class="indicator-chart-dot" style="top:${pct(last.close)}"></span>
        <span class="indicator-chart-end" style="top:${pct(last.close)}">${fmt.value(last.close)}</span>
      </div>
      <div class="indicator-chart-axis"><span>${dotDate(first.date, lang)}</span><span>${dotDate(last.date, lang)}</span></div>
      <figcaption class="unit-note">${html(copy.chartNote)}</figcaption>
    </figure>`;
}

// A chart tick for an amount in KRW millions: 조/억 (tn/bn), as many decimals as the step needs.
function fundTick(millions, step, lang) {
  const tn = Math.abs(millions) >= 1e6 || step >= 1e6;
  const scale = lang === 'en' ? (tn ? 1e6 : 1e3) : (tn ? 1e6 : 100);
  const scaledStep = step / scale;
  const digits = scaledStep >= 1 ? 0 : scaledStep >= 0.1 ? 1 : 2;
  const text = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(millions / scale);
  return lang === 'en' ? `${text}${tn ? 'tn' : 'bn'}` : `${text}${tn ? '조' : '억'}`;
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, '');
}

function indicatorStatTile(label, value, sub = '', signValue = null, f = null) {
  const cls = f && signValue !== null ? f.signClass(signValue) : '';
  return `<article class="indicator-stat"><span>${html(label)}</span><strong class="${cls}">${value}</strong>${sub ? `<small>${sub}</small>` : ''}</article>`;
}

export function marketIndicatorTitle(indicator, series, lang) {
  const key = lang === 'en' ? 'en' : 'ko';
  const copy = INDICATOR_COPY[key];
  const f = makeFormat(key);
  const fmt = indicatorFormat(indicator, f);
  const latest = series[0];
  const { m, d } = dateParts(latest.date);
  const date = key === 'en' ? longDate(latest.date, 'en') : `${m}월 ${d}일`;
  const move = isYield(indicator.code)
    ? (valid(latest.change) ? `${f.signed(latest.change * 100, 1)}bp` : '')
    : (valid(latest.changePct) ? f.pct(latest.changePct) : '');
  return copy.title(INDICATOR_SHORT_NAMES[key][indicator.code], copy.noun[indicatorKind(indicator)], date, stripTags(fmt.value(latest.close)), move);
}

export function marketIndicatorDescription(indicator, series, lang) {
  const key = lang === 'en' ? 'en' : 'ko';
  const copy = INDICATOR_COPY[key];
  const f = makeFormat(key);
  const fmt = indicatorFormat(indicator, f);
  const stats = marketIndicatorStats(series);
  const latest = stats.latest;
  const dayMove = isYield(indicator.code)
    ? (valid(latest.change) ? `${f.signed(latest.change * 100, 1)}bp` : '')
    : (valid(latest.changePct) ? f.pct(latest.changePct) : '');
  const parts = copy.description({
    name: INDICATOR_NAMES[key][indicator.code],
    noun: copy.noun[indicatorKind(indicator)],
    date: longDate(latest.date, key),
    value: stripTags(fmt.value(latest.close)),
    pct: dayMove,
    month: stats.month ? fmt.move(latest, stats.month)?.text : '',
    high: stats.count > 1 ? `${stripTags(fmt.value(stats.high.close))}(${dotDate(stats.high.date, key)})` : '',
    low: stats.count > 1 ? `${stripTags(fmt.value(stats.low.close))}(${dotDate(stats.low.date, key)})` : '',
    start: longDate(series[series.length - 1].date, key)
  }).filter(Boolean);
  let text = parts.join(' ');
  while (text.length > 180 && parts.length > 2) {
    parts.splice(parts.length - 2, 1);
    text = parts.join(' ');
  }
  return text;
}

/*
 * Indicator guides: what a reader who arrives from search for one of these
 * pages asks next. Written by hand for the pages people search for (KOSPI
 * first, then KOSDAQ, VKOSPI, USD/KRW, investor deposits, margin loans and
 * forced selling, 2026-11-26),
 * never generated for every indicator, so no page carries boilerplate. A guide
 * adds two parts:
 * - a "latest close" block at the top: the session's one-line takeaway (the
 *   record's own line, else the Daily's, as on the share card) with links to
 *   that session's full record and its Daily report. A Market Funds page has
 *   none: KOFIA publishes a day later, so its newest day is not the session's;
 * - an "about" section after the chart: paragraphs where [[text|term]] links
 *   `term` in the glossary (the term must exist in that language's glossary),
 *   and related Market Basics reads named by their Korean post id (the English
 *   page links the translation, and drops a read without one).
 */
export const INDICATOR_GUIDES = Object.freeze({
  KOSPI: {
    related: ['2026-11-12-basics-17io0go', '2026-11-15-basics-yi9jg1', '2026-11-18-basics-gt1lmr', '2026-11-13-basics-1m6tqir'],
    ko: {
      title: '코스피란',
      paragraphs: [
        '코스피(KOSPI)는 한국거래소 유가증권시장에 상장된 보통주 전 종목을 [[시가총액 가중]] 방식으로 묶은 지수입니다. 1980년 1월 4일의 시가총액을 100으로 놓고, 지금 시가총액이 그 몇 배인지를 나타냅니다.',
        '이 페이지의 값은 [[정규장]] 마감(오후 3시 30분, KST) [[종가]]입니다. 종가는 마감 전 10분 동안의 단일가 매매로 정해지고, 그 뒤의 시간외 거래나 [[넥스트레이드]] 애프터마켓 거래는 이 값을 바꾸지 않습니다.',
        '등락은 직전 거래일 종가와 비교한 값이고, 새 값은 매 거래일 오후 4시 무렵 추가됩니다. 표의 날짜를 누르면 그날의 투자자별 매매동향, 시장 폭, 업종 등락까지 담긴 전체 마감 기록이 열립니다.'
      ]
    },
    en: {
      title: 'What is the KOSPI?',
      paragraphs: [
        'The KOSPI (Korea Composite Stock Price Index) covers every common stock listed on the Korea Exchange main board, combined by [[market-capitalization weighting]]. It sets the total market value on January 4, 1980 at 100 and expresses today\u2019s market value against that base.',
        'Values on this page are the close of [[regular trading hours]] at 3:30 p.m. KST: the [[closing price|Closing price]], set by a ten-minute single-price auction before the bell. After-hours trading and [[Nextrade|Nextrade (NXT)]] after-market trades do not change it.',
        'Each change is against the previous trading day\u2019s close, and a new value is added around 4 p.m. KST every trading day. Each date in the table opens that session\u2019s full close record, with investor flows, market breadth and sector moves.'
      ]
    }
  },
  KOSDAQ: {
    related: ['2026-11-12-basics-17io0go', '2026-08-11-basics-1e0xeuz', '2026-11-15-basics-yi9jg1', '2026-08-20-basics-1jqzwpd'],
    ko: {
      title: '코스닥이란',
      paragraphs: [
        '코스닥(KOSDAQ)은 한국거래소 코스닥시장에 상장된 종목을 [[시가총액 가중]] 방식으로 묶은 지수입니다. 1996년 7월 1일이 기준일이고, 2004년에 기준값을 100에서 1,000으로 바꿔 지금은 그날의 시가총액을 1,000으로 놓고 셉니다.',
        '바이오, 2차전지, 반도체 [[소부장]] 같은 성장 업종의 중소형주가 많고, [[개인·외국인·기관]] 가운데 개인의 거래 비중이 큰 시장입니다. 그래서 같은 날에도 코스피보다 등락 폭이 큰 경우가 많습니다.',
        '이 페이지의 값은 [[정규장]] 마감(오후 3시 30분, KST) [[종가]]이고, 등락은 직전 거래일 종가와 비교한 값입니다. 표의 날짜를 누르면 그날의 투자자별 매매동향과 시장 폭까지 담긴 전체 마감 기록이 열립니다.'
      ]
    },
    en: {
      title: 'What is the KOSDAQ?',
      paragraphs: [
        'The KOSDAQ index covers the stocks listed on the Korea Exchange\u2019s KOSDAQ market, combined by [[market-capitalization weighting]]. Its base date is July 1, 1996; in 2004 the base value was raised from 100 to 1,000, so the index now reads today\u2019s market value against 1,000 on that date.',
        'The market leans toward smaller growth companies in biotech, batteries and chip [[materials, parts and equipment|Materials, Parts & Equipment]], and individual investors account for a large share of its trading among the [[retail, foreign and institutional|retail · foreign · institutional]] groups. On the same day it often moves more than the KOSPI.',
        'Values on this page are the close of [[regular trading hours]] at 3:30 p.m. KST (the [[closing price|Closing price]]), and each change is against the previous trading day\u2019s close. Each date in the table opens that session\u2019s full close record, with investor flows and market breadth.'
      ]
    }
  },
  VKOSPI: {
    related: ['2026-11-23-basics-a5lumg', '2026-08-10-basics-1rhknmt', '2026-08-20-basics-1jqzwpd', '2026-11-13-basics-1m6tqir'],
    ko: {
      title: 'VKOSPI란',
      paragraphs: [
        '[[VKOSPI]]는 [[코스피200]] [[옵션]] 가격으로 계산한, 앞으로 30일 동안 코스피200이 얼마나 움직일지에 대한 시장의 예상치입니다. 미국 S&P 500 옵션으로 만드는 VIX와 같은 방식이며, 한국거래소가 발표합니다.',
        '값은 1년 기준 변동률(%)입니다. 20이면 1년에 위아래 20% 안팎, 한 달로 나누면 약 ±5.8%의 움직임을 예상한다는 뜻입니다. 주가가 급히 빠질 때 하락에 대비하는 [[풋옵션]] 수요가 몰려 값이 뛰는 경우가 많아 ‘공포지수’라고도 부릅니다.',
        '이 페이지의 값은 파생상품시장 정규장 마감(오후 3시 45분, KST) 종가이고, 등락은 직전 거래일 종가와 비교한 값입니다. 표의 날짜를 누르면 그날의 전체 마감 기록이 열립니다.'
      ]
    },
    en: {
      title: 'What is the VKOSPI?',
      paragraphs: [
        'The [[VKOSPI]] is the market\u2019s expectation of how much the [[KOSPI 200]] will move over the next 30 days, calculated from KOSPI 200 [[options]] prices. It follows the same method as the VIX, which is built from S&P 500 options, and is published by the Korea Exchange.',
        'The value is an annualized percentage. A reading of 20 means a move of roughly 20% either way over a year, or about \u00b15.8% over a month. When stocks drop quickly, demand for [[put options]] as protection tends to lift it, which is why it is often called a fear gauge.',
        'Values on this page are the derivatives-session close at 3:45 p.m. KST, and each change is against the previous trading day\u2019s close. Each date in the table opens that session\u2019s full close record.'
      ]
    }
  },
  USDKRW: {
    related: ['2026-08-13-basics-1qofo4f', '2026-11-18-basics-143x6rj', '2026-10-09-note-1a56yum', '2026-10-24-note-vgs0zy'],
    ko: {
      title: '원/달러 환율이란',
      paragraphs: [
        '[[원/달러]] 환율은 1달러를 사는 데 드는 원화 금액입니다. 숫자가 오르면 원화 가치가 내린 것(원화 약세)이고, 숫자가 내리면 [[원화 강세]]입니다.',
        '이 페이지의 값은 서울 외환시장의 오후 3시 30분 기준가도, 서울외국환중개가 고시하는 공식 [[매매기준율]]도 아닙니다. 하나은행이 오후 3시 30분 직전 회차에 낸 은행 고시 매매기준율을 네이버 금융에서 옮긴 값이라, 뉴스나 한국은행 통계의 오후 3시 30분 값과 조금 다를 수 있습니다. 등락은 전 거래일의 같은 고시값과 비교한 것입니다.',
        '환율은 외국인 투자자의 수익에 직접 닿습니다. 원화가 약해지면 같은 주가라도 달러로 환산한 값이 줄어들어, 외국인 매매와 함께 움직이는 날이 많습니다. 달러 자체의 힘은 [[달러인덱스]]로 따로 볼 수 있고, 표의 날짜를 누르면 그날의 외국인 매매가 담긴 전체 마감 기록이 열립니다.'
      ]
    },
    en: {
      title: 'What is the USD/KRW rate?',
      paragraphs: [
        'The [[USD/KRW]] rate is the number of won it takes to buy one U.S. dollar. A higher number means a weaker won; a lower number means [[a stronger won]].',
        'Values on this page are neither the Seoul FX market’s 3:30 p.m. rate nor the official [[reference rate|Base Exchange Rate]] set by Seoul Money Brokerage. They are Hana Bank’s own posted rate from its last round before 3:30 p.m. KST, as shown on Naver Finance, so they can differ slightly from the 3:30 p.m. figure in the news and Bank of Korea statistics. Each change is against the previous trading day’s posted rate.',
        'The exchange rate feeds straight into foreign investors\u2019 returns: when the won weakens, the same share price is worth less in dollars, so the rate and foreign flows often move together. The dollar\u2019s own strength is tracked by the [[U.S. Dollar Index]], and each date in the table opens that session\u2019s full close record, with foreign investors\u2019 trading.'
      ]
    },
    // FX Close live (contracts/fx_close/): the page shows the ECOS 15:30 rate.
    seoul: {
      ko: {
        title: '원/달러 환율이란',
        paragraphs: [
          '[[원/달러]] 환율은 1달러를 사는 데 드는 원화 금액입니다. 숫자가 오르면 원화 가치가 내린 것(원화 약세)이고, 숫자가 내리면 [[원화 강세]]입니다.',
          '이 페이지의 값은 서울 외환시장의 오후 3시 30분 기준가로, 뉴스와 한국은행 경제통계시스템(ECOS)이 쓰는 숫자입니다. 서울외국환중개가 고시하는 공식 [[매매기준율]]이나 은행이 회차마다 내는 고시 환율과는 다른 숫자이고, 등락은 전 거래일 오후 3시 30분 기준가와 비교한 것입니다.',
          '환율은 외국인 투자자의 수익에 직접 닿습니다. 원화가 약해지면 같은 주가라도 달러로 환산한 값이 줄어들어, 외국인 매매와 함께 움직이는 날이 많습니다. 달러 자체의 힘은 [[달러인덱스]]로 따로 볼 수 있고, 표의 날짜를 누르면 그날의 외국인 매매가 담긴 전체 마감 기록이 열립니다.'
        ]
      },
      en: {
        title: 'What is the USD/KRW rate?',
        paragraphs: [
          'The [[USD/KRW]] rate is the number of won it takes to buy one U.S. dollar. A higher number means a weaker won; a lower number means [[a stronger won]].',
          'Values on this page are the Seoul FX market\u2019s 3:30 p.m. KST rate, the figure the news and the Bank of Korea\u2019s ECOS statistics use. It is neither the official [[reference rate|Base Exchange Rate]] set by Seoul Money Brokerage nor a bank\u2019s posted rate; each change is against the previous trading day\u2019s 3:30 p.m. rate.',
          'The exchange rate feeds straight into foreign investors\u2019 returns: when the won weakens, the same share price is worth less in dollars, so the rate and foreign flows often move together. The dollar\u2019s own strength is tracked by the [[U.S. Dollar Index]], and each date in the table opens that session\u2019s full close record, with foreign investors\u2019 trading.'
        ]
      }
    }
  },
  DEPOSITS: {
    related: ['2026-06-04-basics-16di2bp', '2026-11-22-basics-1rhe030', '2026-11-25-basics-vdzvvf', '2026-08-11-basics-1e0xeuz'],
    ko: {
      title: '투자자예탁금이란',
      paragraphs: [
        '[[투자자예탁금]]은 주식을 사려고 증권사 계좌에 넣어 두었거나, 주식을 팔고 찾지 않아 계좌에 현금으로 남아 있는 돈의 합계입니다. 언제든 주식을 살 수 있는 돈이라 ‘증시 대기자금’이라고도 부릅니다.',
        '[[금융투자협회]]가 거래일마다 집계해 다음 영업일에 공개합니다. 이 페이지의 값은 장내파생상품 거래예수금을 뺀 금액이고, 날짜는 공개일이 아니라 자금이 집계된 거래일입니다.',
        '예탁금이 늘었다고 곧 살 돈이 늘었다고 단정할 수는 없습니다. 주식을 많이 판 날에도 판 돈이 계좌에 남으면 예탁금이 늘기 때문입니다. 빚을 내 투자한 규모는 [[신용융자 잔고]], 담보가 모자라 강제로 판 금액은 [[반대매매]] 기록에서 함께 볼 수 있습니다.'
      ]
    },
    en: {
      title: 'What are investor deposits?',
      paragraphs: [
        '[[Investor deposits|investor deposits]] are the cash customers hold at Korean brokerages: money put in to buy stocks, plus sale proceeds left in the account. Because it can buy shares at any moment, it is often called cash on the sidelines.',
        'The Korea Financial Investment Association (KOFIA) counts it every trading day and publishes it the next business day. Values on this page exclude deposits for exchange-traded derivatives, and each date is the trading day the money was counted, not the day it was published.',
        'A rise does not by itself mean more money is waiting to buy: on a day of heavy selling, proceeds left in accounts also lift the total. How much is borrowed to buy stocks shows in [[margin loans|Outstanding margin loans]], and shares sold for lack of collateral in [[forced selling]].'
      ]
    }
  },
  // Margin loans and forced selling (2026-11-26), in the terms of 시장 입문 20편
  // 「반대매매는 언제, 얼마에 나가나」 and 데이터 길잡이 2편: KOFIA's forced-selling
  // figure counts sales against unpaid settlement balances (미수) only.
  CREDIT: {
    related: ['2026-11-22-basics-1rhe030', '2026-11-25-basics-vdzvvf', '2026-08-20-basics-1jqzwpd', '2026-06-04-basics-16di2bp'],
    ko: {
      title: '신용융자 잔고란',
      paragraphs: [
        '[[신용융자]]는 주식을 사려고 증권사에서 빌린 돈이고, [[신용융자 잔고]]는 그 가운데 아직 갚지 않은 금액입니다. 빚을 내 투자한 규모를 가늠하는 숫자로, 이 페이지의 값은 유가증권시장과 코스닥을 합친 금액입니다.',
        '빌려서 산 주식은 그 대출의 담보가 됩니다. 주가가 내려 담보 가치가 [[담보유지비율]](보통 대출금의 140%) 아래로 떨어지면 증권사는 담보를 더 넣으라고 요구하고, 채우지 못하면 주식을 강제로 파는 [[반대매매]]에 나섭니다. 잔고가 많이 쌓인 상태에서 급락이 오면 매도가 매도를 부를 수 있는 까닭입니다.',
        '[[금융투자협회]]가 거래일마다 집계해 다음 영업일에 공개하며, 날짜는 공개일이 아니라 잔고가 집계된 거래일입니다. 잔고가 줄었다면 빚을 갚았거나 반대매매로 정리된 것인데, 둘은 이 숫자만으로 구분되지 않습니다.'
      ]
    },
    en: {
      title: 'What are margin loans?',
      paragraphs: [
        '[[Margin loans]] are money borrowed from a brokerage to buy shares, and the [[outstanding balance|Outstanding margin loans]] is the part not yet repaid. It gauges how much borrowing is behind stock investment; values on this page are the KOSPI and KOSDAQ markets combined.',
        'Shares bought on margin are the loan\u2019s collateral. When prices fall and the collateral drops below the [[maintenance ratio|Maintenance collateral ratio]], usually 140% of the loan, the broker asks for more collateral and, if it is not topped up, sells the shares: [[forced selling]]. A large balance meeting a sharp drop is how selling can feed more selling.',
        'The Korea Financial Investment Association (KOFIA) counts the balance every trading day and publishes it the next business day; each date is the trading day it describes. A falling balance means loans were repaid or closed out by forced sales, and this figure alone cannot tell which.'
      ]
    }
  },
  FORCED_SALE: {
    related: ['2026-11-22-basics-1rhe030', '2026-11-25-basics-vdzvvf', '2026-08-20-basics-1jqzwpd', '2026-06-04-basics-16di2bp'],
    ko: {
      title: '반대매매 금액이란',
      paragraphs: [
        '이 페이지의 값은 [[금융투자협회]]가 집계하는 위탁매매 [[미수]]에 대한 실제 반대매매 금액입니다. 미수는 주문 금액의 일부만 [[위탁증거금]]으로 내고 주식을 산 뒤, 나머지를 [[결제일]]까지 내지 못해 생긴 빚입니다.',
        '미수를 결제일까지 갚지 못하면 증권사는 산 날로부터 3영업일 뒤 아침에 그 주식을 강제로 팝니다. 미수를 낸 투자자는 다음 영업일부터 30일 동안 모든 증권사에서 현금 100%로만 주식을 살 수 있는 [[미수동결계좌]]가 됩니다.',
        '신용융자 담보가 모자라 나가는 반대매매는 이 숫자에 들어 있지 않습니다. 기사에 나오는 「반대매매 ○○억 원」도 대개 이 협회 통계라서, 빚을 낸 투자 전체의 강제 매도 규모로 읽으면 안 됩니다. 금액은 다음 영업일에 공개되고, 날짜는 집계된 거래일입니다.'
      ]
    },
    en: {
      title: 'What is the forced-selling figure?',
      paragraphs: [
        'Values on this page are KOFIA\u2019s count of [[forced selling]] actually carried out against an [[unpaid settlement balance|Unpaid settlement balance]]: shares bought with only part of the price paid up front, the rest still unpaid on the [[settlement day]].',
        'If the balance is not paid by the settlement day, the broker sells the shares on the morning of the third business day after the purchase. The investor then has a [[restricted cash-only account]] at every broker for 30 days.',
        'Forced sales of margin-loan collateral are not in this figure. News reports of \u201cforced selling of \u20a9X billion\u201d usually quote this KOFIA statistic, so it is not the whole of leveraged forced selling. KOFIA publishes it the next business day; each date is the trading day it describes.'
      ]
    }
  }
});

const GUIDE_COPY = {
  ko: { latestTitle: (m, d) => `${m}월 ${d}일 마감`, sessionLink: '그날 전체 마감 기록', dailyLink: '이날의 데일리 리포트', related: '함께 읽기' },
  en: { latestTitle: (m, d) => `Close on ${EN_MONTHS_SHORT[m - 1]} ${d}`, sessionLink: 'Full close record for the day', dailyLink: 'Daily report for the day', related: 'Related reading' }
};

/** A guide paragraph: escaped text, each [[text|term]] a glossary link (term defaults to text). */
function guideParagraph(text, lang) {
  return html(text).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (whole, label, term) => `<a class="mk-term" href="${html(glossaryTermHref(term || label, lang))}">${label}</a>`);
}

/** The guide's related reads in `lang`: [{ href, title }], from data/posts.json. */
export function guideReads(guide, posts, lang) {
  const list = Array.isArray(posts) ? posts : [];
  return (guide?.related || []).map(id => {
    const korean = list.find(post => post?.id === id);
    if (!korean) return null;
    const post = lang === 'en' ? findTranslationCounterpart(list, korean) : korean;
    if (!post?.href || !post?.title) return null;
    return { href: new URL(reportSiteUrl(post.href)).pathname, title: post.title };
  }).filter(Boolean);
}

/**
 * The "latest close" block: `latest` is { date, line, report } for the
 * newest session (line and report may be empty); '' without a guide.
 */
function guideLatestBlock(latest, lang) {
  if (!latest?.date) return '';
  const copy = GUIDE_COPY[lang];
  const { m, d } = dateParts(latest.date);
  const links = [
    `<a href="${marketDatePath(latest.date, lang)}">${html(copy.sessionLink)} →</a>`,
    latest.report?.url ? `<a href="${html(latest.report.url)}">${html(copy.dailyLink)} ↗</a>` : ''
  ].filter(Boolean).join('');
  return `<section class="indicator-latest" aria-labelledby="indicator-latest-title">
      <h2 id="indicator-latest-title">${html(copy.latestTitle(m, d))}</h2>
      ${latest.line ? `<p class="indicator-latest-line">${html(latest.line)}</p>` : ''}
      <p class="indicator-latest-links">${links}</p>
    </section>`;
}

function guideAboutBody(guide, lang, posts) {
  const text = guide?.[lang];
  if (!text) return '';
  const reads = guideReads(guide, posts, lang);
  return `<div class="indicator-guide">${text.paragraphs.map(item => `<p>${guideParagraph(item, lang)}</p>`).join('')}${reads.length
    ? `<h3>${html(GUIDE_COPY[lang].related)}</h3><ul class="indicator-guide-reads">${reads.map(read => `<li><a href="${html(read.href)}">${html(read.title)}</a></li>`).join('')}</ul>`
    : ''}</div>`;
}

export function renderMarketIndicatorMain(indicator, series, lang, available = availableIndicatorCodes([]), context = {}) {
  const key = lang === 'en' ? 'en' : 'ko';
  const copy = INDICATOR_COPY[key];
  const base = COPY[key];
  const f = makeFormat(key);
  const fmt = indicatorFormat(indicator, f);
  const kind = indicatorKind(indicator);
  const name = INDICATOR_NAMES[key][indicator.code];
  const valueLabel = context.fxSeoul ? copy.fxSeoulValue : copy.valueLabel[kind];
  const stats = marketIndicatorStats(series);
  const latest = stats.latest;
  const dayChange = isYield(indicator.code)
    ? (valid(latest.change) ? `${f.signed(latest.change * 100, 1)}bp` : '')
    : (valid(latest.changePct) ? f.pct(latest.changePct) : '');
  const summary = `<span class="market-date-fact">${html(dotDate(latest.date, key))} <b>${fmt.value(latest.close)}</b>${dayChange ? ` <span class="${f.signClass(latest.change)}">(${dayChange})</span>` : ''}</span>`;

  const moveTile = (label, ref) => {
    const move = fmt.move(latest, ref);
    return move ? indicatorStatTile(label, move.text, `${dotDate(ref.date, key)} ${fmt.value(ref.close)}`, move.sign, f) : '';
  };
  const tiles = [
    indicatorStatTile(`${copy.latest} ${valueLabel}`, fmt.value(latest.close), html(dotDate(latest.date, key))),
    stats.week ? moveTile(copy.weekAgo, stats.week) : '',
    stats.month ? moveTile(copy.monthAgo, stats.month) : '',
    stats.first ? moveTile(copy.since(dotDate(stats.first.date, key)), stats.first) : '',
    stats.count > 1 ? indicatorStatTile(copy.high, fmt.value(stats.high.close), html(dotDate(stats.high.date, key))) : '',
    stats.count > 1 ? indicatorStatTile(copy.low, fmt.value(stats.low.close), html(dotDate(stats.low.date, key))) : ''
  ].filter(Boolean).join('');

  const withRange = indicator.kind === 'krx' || indicator.kind === 'krxvol';
  const changeHeading = indicator.kind === 'snapshot' ? copy.changeVsPrev.snapshot : copy.columns.change;
  const headings = [copy.columns.date, valueLabel, changeHeading, copy.columns.pct, ...(withRange ? [copy.columns.high, copy.columns.low] : [])];
  const months = new Map();
  for (const point of series) {
    const month = point.date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(point);
  }
  const monthBlocks = [...months].map(([month, points]) => {
    const [y, m] = month.split('-').map(Number);
    const title = key === 'en' ? `${EN_MONTHS[m - 1]} ${y}` : `${y}년 ${m}월`;
    const rows = points.map(point => [
      point.recordDate ? `<a href="${marketDatePath(point.recordDate, key)}">${html(dayLabel(point.date, key))}</a>` : html(dayLabel(point.date, key)),
      fmt.value(point.close),
      `<span class="${f.signClass(point.change)}">${fmt.change(point.change)}</span>`,
      isYield(indicator.code) ? '' : `<span class="${f.signClass(point.changePct)}">${f.pct(point.changePct)}</span>`,
      ...(withRange ? [f.number(point.high, 2), f.number(point.low, 2)] : [])
    ]);
    const shownHeadings = isYield(indicator.code) ? headings.filter((_, index) => index !== 3) : headings;
    const shownRows = isYield(indicator.code) ? rows.map(row => row.filter((_, index) => index !== 3)) : rows;
    return `<section class="market-section" aria-labelledby="indicator-${month}"><h2 id="indicator-${month}">${html(title)}</h2>${dataTable(shownHeadings, shownRows, `market-indicator-table${withRange ? ' with-range' : ''}`)}</section>`;
  }).join('\n');

  const related = listedIndicators(available).filter(item => item.code !== indicator.code)
    .map(item => `<a href="${marketIndicatorPath(item.code, key)}">${html(INDICATOR_SHORT_NAMES[key][item.code])}</a>`).join('');
  const dashboardPath = key === 'en' ? '/en/market/' : '/market/';
  // USD/KRW from FX Close has its own guide wording (INDICATOR_GUIDES.USDKRW.seoul).
  const baseGuide = INDICATOR_GUIDES[indicator.code] || null;
  const guide = context.fxSeoul && baseGuide?.seoul ? { ...baseGuide, ko: baseGuide.seoul.ko, en: baseGuide.seoul.en } : baseGuide;
  const latestBlock = guide ? guideLatestBlock(context.latest, key) : '';
  const aboutBody = guide ? guideAboutBody(guide, key, context.posts) : '';

  return `<main id="market-date-root" class="market-date-page market-indicator-page" data-market-indicator="${indicator.slug}">
  ${pageHead({
    id: 'market-indicator-heading',
    breadcrumb: `<a href="${key === 'en' ? '/en/' : '/'}">${html(base.breadcrumbHome)}</a> › <a href="${dashboardPath}">${html(base.breadcrumbMarket)}</a> › <a href="${marketArchivePath(key)}#indicators">${html(copy.breadcrumb)}</a>`,
    eyebrow: copy.eyebrow,
    title: copy.heading(name),
    summary,
    meta: [`${context.fxSeoul ? copy.fxSeoulBasis : copy.basis[indicator.code] || copy.basis[indicator.kind]}${INDICATOR_UNITS[key][indicator.code] ? ` · ${INDICATOR_UNITS[key][indicator.code]}` : ''}`],
    after: indicator.code === 'USDKRW' ? `<p class="mk-guide-link">${usdkrwGuideLink(key)}</p>` : ''
  })}
  <div class="market-wrap market-dashboard">
    ${latestBlock}
    ${section(1, copy.sections[0], `<div class="indicator-stats">${tiles}</div>`)}
    ${series.length > 1 ? section(2, copy.sections[1], indicatorChart(series, indicator, fmt, copy, key)) : ''}
    ${aboutBody ? section(series.length > 1 ? 3 : 2, guide[key].title, aboutBody) : ''}
    <p class="unit-note indicator-table-note">${html(indicator.kind === 'us' ? copy.usDates : indicator.kind === 'asia' ? copy.localDates : indicator.kind === 'kofia' ? copy.kofiaDates : indicator.kind === 'funds' ? copy.fundsDates : copy.krxDates)}</p>
${monthBlocks}
    <nav class="indicator-links" aria-label="${html(copy.related)}"><h2>${html(copy.related)}</h2><div>${related}</div></nav>
    <p class="market-archive-links"><a href="${dashboardPath}">${html(copy.dashboard)} →</a><a href="${marketArchivePath(key)}">${html(copy.archive)} →</a></p>
    <div class="market-data-note"><p>${html(context.fxSeoul ? copy.fxSeoulGaps : indicator.kind === 'kofia' ? copy.kofiaGaps : indicator.kind === 'funds' ? copy.fundsGaps : `${base.source} · ${copy.gaps}`)}</p><p>${html(base.disclaimer)}</p></div>
  </div>
</main>`;
}

export function marketIndicatorPageHtml(shell, indicator, series, lang, available = availableIndicatorCodes([]), context = {}) {
  const key = lang === 'en' ? 'en' : 'ko';
  const title = marketIndicatorTitle(indicator, series, key);
  const description = marketIndicatorDescription(indicator, series, key);
  const canonical = `${PRODUCTION_ORIGIN}${marketIndicatorPath(indicator.code, key)}`;
  const base = COPY[key];
  return applyMarketShell(shell, {
    lang: key,
    title,
    description,
    canonical,
    alternates: { ko: `${PRODUCTION_ORIGIN}${marketIndicatorPath(indicator.code, 'ko')}`, en: `${PRODUCTION_ORIGIN}${marketIndicatorPath(indicator.code, 'en')}` },
    jsonLd: pageJsonLd({
      lang: key,
      title,
      description,
      canonical,
      datePublished: String(series[0]?.publishedAt || '').slice(0, 10) || undefined,
      breadcrumb: [
        { name: base.breadcrumbHome, url: `${PRODUCTION_ORIGIN}${key === 'en' ? '/en/' : '/'}` },
        { name: base.breadcrumbMarket, url: `${PRODUCTION_ORIGIN}${key === 'en' ? '/en/market/' : '/market/'}` },
        { name: INDICATOR_NAMES[key][indicator.code], url: canonical }
      ]
    }),
    main: renderMarketIndicatorMain(indicator, series, key, available, context)
  });
}

/** The last 20 sessions' closes up to `date` (functions/api/market/trend.js), or null. */
async function loadSessionTrend(env, date) {
  if (!env?.COMMENTS_DB) return null;
  const db = await ensureMarketTable(env, { readOnly: true });
  return loadTrend(db, date);
}

/** Every final row's item for one instrument, newest first. Throws on a database failure or timeout. */
export async function loadMarketIndicator(env, indicator, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  return withinBudget((async () => {
    const db = await ensureMarketTable(env, { readOnly: true });
    // The path is built from the fixed instrument list, never from the request.
    const path = `$.${indicator.group}.${indicator.code}`;
    const result = await db.prepare(`SELECT market_date, published_at, json_extract(payload_json, '${path}') AS item,
        ${OPTIONAL_INDICATOR_CLOSES_SQL} AS optional_closes
      FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC`).all();
    return (result?.results || []).filter(row => ISO_DATE.test(String(row?.market_date || '')));
  })(), budgetMs);
}

/**
 * A domestic rate page's data: every stored Domestic Rates day, and the final
 * Market Close rows (date and optional closes) for session links and the
 * related-indicator list. Throws on a Market Close failure or timeout; the
 * rates themselves fail soft (an empty list, so the page is a 404).
 */
export async function loadDomesticRateIndicator(env, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  return withinBudget((async () => {
    const db = await ensureMarketTable(env, { readOnly: true });
    const [days, result] = await Promise.all([
      loadDomesticRatesDays(env),
      db.prepare(`SELECT market_date, ${OPTIONAL_INDICATOR_CLOSES_SQL} AS optional_closes FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC`).all()
    ]);
    const rows = (result?.results || []).filter(row => ISO_DATE.test(String(row?.market_date || '')));
    return { days, rows };
  })(), budgetMs);
}

/** A final record's own one-line takeaway ({ ko, en }), or null. */
export async function loadRecordTakeaway(env, date) {
  if (!env?.COMMENTS_DB || !ISO_DATE.test(String(date || ''))) return null;
  const db = await ensureMarketTable(env, { readOnly: true });
  const row = await db.prepare(`SELECT takeaway_ko, takeaway_en FROM ${TABLE_NAME} WHERE market_date = ? AND status = 'final' LIMIT 1`).bind(date).first();
  return row ? { ko: String(row.takeaway_ko || ''), en: String(row.takeaway_en || '') } : null;
}

/**
 * A market fund page's data: every stored Market Funds day, and the final
 * Market Close rows (date and optional closes) for session links and the
 * related-indicator list. Throws on a Market Close failure or timeout; the
 * funds themselves fail soft (an empty list, so the page is a 404).
 */
export async function loadMarketFundIndicator(env, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  return withinBudget((async () => {
    const db = await ensureMarketTable(env, { readOnly: true });
    const [days, result] = await Promise.all([
      loadMarketFundsDays(env),
      db.prepare(`SELECT market_date, ${OPTIONAL_INDICATOR_CLOSES_SQL} AS optional_closes FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC`).all()
    ]);
    const rows = (result?.results || []).filter(row => ISO_DATE.test(String(row?.market_date || '')));
    return { days, rows };
  })(), budgetMs);
}

/** The domestic rate and market fund codes with a page; never throws (an empty set). */
function rateCodesWithin(env, budgetMs) {
  const rates = withinBudget(loadDomesticRateCodes(env), budgetMs).catch(() => new Set());
  const funds = withinBudget(loadMarketFundCodes(env), budgetMs).catch(() => new Set());
  return Promise.all([rates, funds]).then(([left, right]) => new Set([...left, ...right]));
}

/** The indicator links the archive lists under "지표별 기록": `available` from availableIndicatorCodes. */
export function marketIndicatorLinks(lang, available = availableIndicatorCodes([])) {
  const key = lang === 'en' ? 'en' : 'ko';
  return listedIndicators(available).map(item => ({ href: marketIndicatorPath(item.code, key), name: INDICATOR_SHORT_NAMES[key][item.code] }));
}
