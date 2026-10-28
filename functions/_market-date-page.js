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
  formatFlowAmount,
  formatIndexLevel,
  formatSignedPct,
  loadPosts,
  organizationStructuredData,
  serializeJsonLd,
  websiteStructuredData
} from './_seo.js';
import { TABLE_NAME, ensureMarketTable } from './api/market/_shared.js';
import { aggregateKrxGroups } from './api/market/_aggregate.js';

export const MARKET_DATE_TIME_BUDGET_MS = 5000;
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
 * or null for any other path. `canonical` is false when the path lacks the
 * trailing slash the canonical address has.
 */
export function parseMarketPagePath(pathname) {
  const match = String(pathname || '').match(/^\/(en\/)?market\/(\d{4}-\d{2}-\d{2}|archive|sectors)(\/?)$/);
  if (!match) return null;
  const lang = match[1] ? 'en' : 'ko';
  const canonical = match[3] === '/';
  if (match[2] === 'archive') return { lang, archive: true, canonical };
  if (match[2] === 'sectors') return { lang, sectors: true, canonical };
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

function makeFormat(lang) {
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
    if (key === 'USDKRW' || key === 'JPYKRW') return ko ? `${number(value, 2)}원` : `₩${number(value, 2)}`;
    if (key === 'WTI' || key === 'GOLD' || key === 'BITCOIN') return `$${number(value, key === 'BITCOIN' ? 0 : 2)}`;
    return number(value, 2);
  };
  return { ko, number, integer, signClass, signed, pct, ratioPct, won, flow, valueUnit };
}

/* ------------------------------------------------------------------- copy */

const COPY = {
  ko: {
    eyebrow: 'MARKET CLOSE · 일별 마감 기록',
    heading: date => `${longDate(date, 'ko')} 한국 증시 마감`,
    closeBasis: '15:30 KST 정규장 마감 기준',
    overseas: '* 해외 지수·원자재는 각 시장의 최신 거래일 종가',
    sections: ['주요 지수', '투자자별 매매동향 (당일)', '최근 5거래일 누적 수급', '금리 · 환율 · 변동성', '원자재 · 가상자산', '시장 폭', 'KRX 업종 · 테마 등락률', '시가총액 상위 10종목', '공매도 현황'],
    open: '시가', high: '고가', low: '저가', previous: '전일', closeState: '종가', fixedClose: '15:30 확정',
    market: '시장', foreign: '외국인', institution: '기관', individual: '개인', futures: '선물',
    fiveDays: (start, end) => `${start} – ${end}`,
    fiveDayIncomplete: (used, total) => `데이터 불완전 · ${used}/${total} 거래일 확보`,
    rise: '상승', fall: '하락', flat: '보합', upper: '상한가', lower: '하한가', riseRatio: '상승비율', fallRatio: '하락비율',
    breadthUnavailable: '이날 시장 폭 데이터 없음',
    sectors: '업종', themes: '테마', strongest: '상승 상위', weakest: '하락 상위',
    allSectors: n => `업종 전체 ${n}개 보기`, allThemes: n => `테마 전체 ${n}개 보기`,
    groupColumns: ['순위', '이름', '시장', '종가', '등락률'],
    capColumns: ['순위', '종목명', '종가', '등락률', '시가총액'],
    shortAmount: '공매도 거래대금', valueRatio: '거래대금 비중', shortValue: '공매도 거래대금 TOP5', shortRatio: '공매도 비중 TOP5', regularUnavailable: '정규장 기준 값 없음',
    prev: '이전 거래일', next: '다음 거래일', archive: '전체 마감 기록', dashboard: '대시보드에서 보기', latest: '최신 마감',
    report: '이날의 데일리 리포트', noReport: '이날 발행된 데일리 리포트가 없습니다.',
    breadcrumbHome: '홈', breadcrumbMarket: '마켓',
    source: '데이터 출처: KRX 한국거래소, 네이버 금융, 연합인포맥스, 야후 파이낸스',
    disclaimer: '투자 판단의 참고 자료이며, 매수·매도 권유가 아닙니다.',
    unit: '단위: 원 · 순매수는 매수-매도',
    sectorsPage: '업종·테마 5일·20일 순위', sectorsLink: '업종·테마 등락률 순위',
    noteTitle: '숫자 너머의 의미를 해석합니다.', noteBody: '이날 시장의 흐름과 배경은 Snowshagal 데일리 리포트에서 이어서 읽을 수 있습니다.'
  },
  en: {
    eyebrow: 'MARKET CLOSE · DAILY RECORD',
    heading: date => `Korea Stock Market Close: ${longDate(date, 'en')}`,
    closeBasis: 'Regular session close, 15:30 KST',
    overseas: '* Overseas indices and commodities use each market’s latest close.',
    sections: ['Major Indices', 'Investor Flows (Daily)', 'Cumulative Flows: Last 5 Sessions', 'Rates · FX · Volatility', 'Commodities · Crypto', 'Market Breadth', 'KRX Sectors & Themes', 'Top 10 by Market Cap', 'Short Selling'],
    open: 'Open', high: 'High', low: 'Low', previous: 'Prev.', closeState: 'Close', fixedClose: '15:30 fixing',
    market: 'Market', foreign: 'Foreign', institution: 'Institution', individual: 'Retail', futures: 'KOSPI 200 Futures',
    fiveDays: (start, end) => `${start} – ${end}`,
    fiveDayIncomplete: (used, total) => `Incomplete data · ${used}/${total} sessions available`,
    rise: 'Advancers', fall: 'Decliners', flat: 'Unchanged', upper: 'Limit up', lower: 'Limit down', riseRatio: 'Advance ratio', fallRatio: 'Decline ratio',
    breadthUnavailable: 'Market breadth unavailable for this session',
    sectors: 'Sectors', themes: 'Themes', strongest: 'Strongest', weakest: 'Weakest',
    allSectors: n => `All ${n} sectors`, allThemes: n => `All ${n} themes`,
    groupColumns: ['Rank', 'Name', 'Market', 'Close', 'Change'],
    capColumns: ['Rank', 'Company', 'Close', 'Change', 'Market cap'],
    shortAmount: 'Short value', valueRatio: 'Value ratio', shortValue: 'Top 5 by Short Value', shortRatio: 'Top 5 by Short Ratio', regularUnavailable: 'No regular-session value',
    prev: 'Previous session', next: 'Next session', archive: 'All sessions', dashboard: 'Open in the dashboard', latest: 'Latest close',
    report: 'Daily report for this session', noReport: 'No Daily report was published for this session.',
    breadcrumbHome: 'Home', breadcrumbMarket: 'Market',
    source: 'Sources: KRX, Naver Finance, Yonhap Infomax, Yahoo Finance',
    disclaimer: 'For reference only; not a recommendation to buy or sell.',
    unit: 'Net buying = buys minus sells',
    sectorsPage: 'Sector & theme 5- and 20-session rankings', sectorsLink: 'Sector & theme rankings',
    noteTitle: 'We interpret the meaning beyond the numbers.', noteBody: 'Continue with the Snowshagal Daily report for the story behind this session.'
  }
};

const INDEX_NAMES_EN = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', NASDAQ: 'NASDAQ Composite', DOW: 'Dow Jones', SP500: 'S&P 500', SOX: 'Philadelphia Semiconductor', VIX: 'VIX', US10Y: 'US 10Y', USDKRW: 'USD/KRW', JPYKRW: 'JPY/KRW (100)', DXY: 'Dollar Index', WTI: 'WTI Crude', GOLD: 'Gold', BITCOIN: 'Bitcoin' };
const INDEX_NAMES_KO = { KOSPI: '코스피', KOSDAQ: '코스닥', NASDAQ: '나스닥 종합', DOW: '다우존스', SP500: 'S&P 500', SOX: '필라델피아 반도체', VIX: 'VIX', US10Y: '미국 국채 10년', USDKRW: '원/달러', JPYKRW: '원/엔(100엔)', DXY: '달러 인덱스', WTI: 'WTI 원유', GOLD: '금', BITCOIN: '비트코인' };
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
    ? 'Every published Korea market close by date: KOSPI and KOSDAQ closes, foreign investor flows and USD/KRW, each linking to the full session record.'
    : '게시된 모든 거래일의 한국 증시 마감 기록. 날짜별 코스피·코스닥 종가와 등락률, 외국인 순매수, 원/달러 환율을 보고 그날의 전체 기록으로 이동합니다.';
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

function metric(label, value, extra = '') {
  return `<div class="market-metric"><span>${html(label)}</span><strong class="${extra}">${value}</strong></div>`;
}

function instrumentCard(key, item, f, copy, lang, major) {
  const isFx = key === 'USDKRW' || key === 'JPYKRW';
  const movementClass = f.signClass(item?.change);
  const arrow = movementClass === 'up' ? '▲' : movementClass === 'down' ? '▼' : '—';
  const change = key === 'US10Y'
    ? `${arrow} ${valid(item?.change) ? `${f.number(Math.abs(item.change * 100), 1)}bp` : '--'}`
    : isFx
      ? `${arrow} ${valid(item?.change) ? f.number(Math.abs(item.change), 2) : '--'} <span>(${f.pct(item?.change_pct)})</span>`
      : `${arrow} ${f.signed(item?.change, 2)} <span>(${f.pct(item?.change_pct)})</span>`;
  const detail = major
    ? `<dl class="market-ohlc"><div><dt>${copy.open}</dt><dd>${f.number(item?.open, 2)}</dd></div><div><dt>${copy.high}</dt><dd>${f.number(item?.high, 2)}</dd></div><div><dt>${copy.low}</dt><dd>${f.number(item?.low, 2)}</dd></div><div><dt>${copy.previous}</dt><dd>${f.number(item?.previous_close, 2)}</dd></div></dl>`
    : '';
  const state = isFx ? copy.fixedClose : copy.closeState;
  return `<article class="instrument-card${major ? ' major' : ''}">
      <div class="instrument-heading"><span>${html(instrumentName(key, lang))}</span>${item?.ticker ? `<small>${html(item.ticker)}</small>` : ''}</div>
      <strong class="instrument-value">${f.valueUnit(key, item?.close)}</strong>
      <div class="instrument-change ${movementClass}">${change}</div>
      ${detail}<div class="instrument-state">${dotDate(item?.source_date, lang)} · ${state}</div>
    </article>`;
}

function breadthCard(key, item, f, copy) {
  return `<article class="breadth-card"><h3>${key}</h3><div class="breadth-counts">
      ${metric(copy.rise, f.integer(item?.rise), 'up')}${metric(copy.fall, f.integer(item?.fall), 'down')}${metric(copy.flat, f.integer(item?.flat))}${metric(copy.upper, f.integer(item?.upper_limit), 'up')}${metric(copy.lower, f.integer(item?.lower_limit), 'down')}
    </div><div class="breadth-bar" aria-label="${copy.riseRatio} ${f.ratioPct(item?.rise_ratio)}, ${copy.fallRatio} ${f.ratioPct(item?.fall_ratio)}"><span class="advance" style="width:${valid(item?.rise_ratio) ? item.rise_ratio * 100 : 0}%"></span><span class="decline" style="width:${valid(item?.fall_ratio) ? item.fall_ratio * 100 : 0}%"></span></div><div class="breadth-ratios"><span class="up">${copy.riseRatio} ${f.ratioPct(item?.rise_ratio)}</span><span class="down">${copy.fallRatio} ${f.ratioPct(item?.fall_ratio)}</span></div></article>`;
}

function rankList(title, items, type, f, field = 'change_pct') {
  return `<div class="range-rank-block"><h4 class="range-rank-title ${type}">${html(title)}</h4><ul class="rank-list">${items.map(it => `<li><span><b>${html(it.name)}</b>${it.market ? `<small>${html(it.market)}</small>` : ''}</span><strong class="${f.signClass(it[field])}">${f.pct(it[field])}</strong></li>`).join('')}</ul></div>`;
}

// Rows for a ranked sector or theme list. Themes carry no market, so the
// market column is left out when no item has one.
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

function flowsTable(markets, pick, f, copy) {
  return dataTable([copy.market, copy.foreign, copy.institution, copy.individual], ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(key => {
    const name = key === 'KOSPI200선물' ? copy.futures : key;
    return [name, ...['외국인', '기관', '개인'].map(investor => {
      const value = pick(markets?.[key], investor);
      return `<span class="${f.signClass(value)}">${f.flow(value)}</span>`;
    })];
  }));
}

/* --------------------------------------------------------------- the page */

/**
 * The <main> for one session. `context`: { prev, next, report } where prev
 * and next are neighbouring published dates (or null) and report is the
 * Daily report post for this date in this language (or null).
 */
export function renderMarketDateMain(payload, lang, context = {}) {
  const copy = COPY[lang === 'en' ? 'en' : 'ko'];
  const f = makeFormat(lang);
  const date = payload.meta.market_date;
  const indices = payload.indices || {};
  const rates = payload.rates_fx_volatility || {};
  const commodities = payload.commodities_crypto || {};
  const flows = payload.krx_investor_trading?.markets || {};
  const five = payload.recent_5d_flows || {};
  const breadth = payload.market_breadth || {};
  const groups = payload.krx_groups || {};
  const caps = Array.isArray(payload.market_cap_top10) ? payload.market_cap_top10 : [];
  const shorts = payload.short_selling || {};
  const status = payload.meta?.schema_version === '1.2.0' ? payload.section_status || {} : {};

  const k = kospi(payload);
  const q = kosdaq(payload);
  const fx = rates.USDKRW;
  const inv = kospiFlows(payload);
  const summary = [
    valid(k?.close) ? `${lang === 'en' ? 'KOSPI' : '코스피'} <b>${f.number(k.close, 2)}</b> <span class="${f.signClass(k.change_pct)}">(${f.pct(k.change_pct)})</span>` : '',
    valid(q?.close) ? `${lang === 'en' ? 'KOSDAQ' : '코스닥'} <b>${f.number(q.close, 2)}</b> <span class="${f.signClass(q.change_pct)}">(${f.pct(q.change_pct)})</span>` : '',
    valid(inv['외국인']?.net_buy) ? `${copy.foreign} <b class="${f.signClass(inv['외국인'].net_buy)}">${f.flow(inv['외국인'].net_buy)}</b>` : '',
    valid(fx?.close) ? `${lang === 'en' ? 'USD/KRW' : '원/달러'} <b>${f.valueUnit('USDKRW', fx.close)}</b>` : ''
  ].filter(Boolean).map(item => `<span class="market-date-fact">${item}</span>`).join('<span class="market-date-sep" aria-hidden="true"> · </span>');
  const takeaway = String(payload.takeaway?.[lang === 'en' ? 'en' : 'ko'] || '').trim();

  const base = lang === 'en' ? '/en/market/' : '/market/';
  const nav = `<nav class="market-date-nav" aria-label="${html(copy.archive)}">
      ${context.prev ? `<a class="market-date-nav-link prev" href="${marketDatePath(context.prev, lang)}" rel="prev"><span aria-hidden="true">←</span> ${html(copy.prev)} <small>${html(dayLabel(context.prev, lang))}</small></a>` : '<span class="market-date-nav-link prev" aria-hidden="true"></span>'}
      <a class="market-date-nav-link archive" href="${marketArchivePath(lang)}">${html(copy.archive)}</a>
      ${context.next ? `<a class="market-date-nav-link next" href="${marketDatePath(context.next, lang)}" rel="next">${html(copy.next)} <small>${html(dayLabel(context.next, lang))}</small> <span aria-hidden="true">→</span></a>` : `<a class="market-date-nav-link next" href="${base}">${html(copy.latest)} <span aria-hidden="true">→</span></a>`}
    </nav>`;

  const majorCards = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'DOW', 'SP500'].filter(key => indices[key]).map(key => instrumentCard(key, indices[key], f, copy, lang, true)).join('');
  const rateCards = ['USDKRW', 'JPYKRW', 'DXY', 'US10Y', 'VIX', 'SOX'].filter(key => rates[key]).map(key => instrumentCard(key, rates[key], f, copy, lang, false)).join('');
  const commodityCards = ['WTI', 'GOLD', 'BITCOIN'].filter(key => commodities[key]).map(key => instrumentCard(key, commodities[key], f, copy, lang, false)).join('');

  const fiveStatus = status.five_day_flows;
  const fiveBody = fiveStatus && fiveStatus.status !== 'complete'
    ? `<div class="market-group-empty market-five-day-status" role="note"><p class="group-empty-title">${html(copy.fiveDayIncomplete(fiveStatus.available_sessions ?? 0, fiveStatus.expected_sessions ?? 5))}</p></div>`
    : five.markets
      ? `${flowsTable(five.markets, (market, investor) => market?.[investor], f, copy)}<p class="unit-note">${html(copy.fiveDays(dotDate(five.start_date, lang), dotDate(five.end_date, lang)))}</p>`
      : '';
  const flowsBody = `${flowsTable(flows, (market, investor) => market?.investors?.[investor]?.net_buy, f, copy)}<p class="unit-note">${html(copy.unit)}</p>`;

  const breadthBody = status.market_breadth?.status === 'unavailable'
    ? `<p class="unit-note">${html(copy.breadthUnavailable)}</p>`
    : `<div class="breadth-grid">${['KOSPI', 'KOSDAQ'].filter(key => breadth[key]).map(key => breadthCard(key, breadth[key], f, copy)).join('')}</div>`;

  const sectorBlock = groupBlock(copy.sectors, copy.allSectors, groups.sectors, f, copy);
  const themeBlock = groupBlock(copy.themes, copy.allThemes, groups.themes, f, copy);
  const groupsBody = sectorBlock || themeBlock
    ? `<div class="range-groups-grid">${sectorBlock}${themeBlock}</div><p class="market-archive-links"><a href="${marketSectorsPath(lang)}">${html(copy.sectorsPage)} →</a></p>`
    : '';

  const capRows = caps.map(item => [
    html(item?.rank ?? '--'),
    `<span class="stock-name"><b>${html(companyName(item, lang))}</b><small>${html(item?.market || '')} · ${html(item?.ticker || '')}</small></span>`,
    valid(item?.close) ? `${f.number(item.close, 0)}${f.ko ? '원' : ''}` : '--',
    `<span class="${f.signClass(item?.change_pct)}">${f.pct(item?.change_pct)}</span>`,
    f.won(item?.market_cap_won)
  ]);

  const shortSummary = shorts.market_summary || {};
  const shortList = (items, isRatio) => !(items || []).length
    ? `<p class="unit-note">${html(copy.regularUnavailable)}</p>`
    : `<ol class="rank-list">${items.map((item, index) => `<li><span>${index + 1}. <b>${html(companyName(item, lang))}</b><small>${html(item?.market || '')}</small></span><strong>${isRatio ? f.ratioPct(item?.short_value_ratio) : f.won(item?.short_value_won)}</strong></li>`).join('')}</ol>`;
  const shortBody = shortSummary.KOSPI || shortSummary.KOSDAQ
    ? `<div class="short-summary">${['KOSPI', 'KOSDAQ'].map(key => `<article><h3>${key}</h3>${metric(copy.shortAmount, f.won(shortSummary[key]?.short_value_won))}${metric(copy.valueRatio, f.ratioPct(shortSummary[key]?.short_value_ratio))}</article>`).join('')}</div><div class="short-ranks"><div><h3>${html(copy.shortValue)}</h3>${shortList(shorts.top5_by_value, false)}</div><div><h3>${html(copy.shortRatio)}</h3>${shortList(shorts.top5_by_ratio, true)}</div></div>`
    : '';

  const report = context.report
    ? `<a class="market-report-cta" href="${html(context.report.url)}"><span>${html(copy.report)}</span><span class="cta-date-badge" aria-hidden="true">${dotDate(date, lang)}</span><span aria-hidden="true">→</span></a>`
    : `<p class="market-report-unavailable">${html(copy.noReport)}</p>`;

  const links = `<aside class="market-note market-date-links"><span class="note-quote" aria-hidden="true">“</span><h2>${html(copy.noteTitle)}</h2><p>${html(copy.noteBody)}</p>${report}<a class="market-date-dashboard" href="${base}?date=${html(date)}">${html(copy.dashboard)} <span aria-hidden="true">→</span></a></aside>`;
  // Numbered in order of appearance; a section with no data is left out.
  let n = 0;
  const part = (index, body) => body ? section(++n, copy.sections[index], body) : '';
  const indicesPart = part(0, `<div class="major-index-grid">${majorCards}</div>`);
  const flowsPart = part(1, flowsBody);
  const fivePart = part(2, fiveBody);
  const ratesPart = part(3, rateCards && `<div class="mini-instrument-grid">${rateCards}</div>`);
  const commodityPart = part(4, commodityCards && `<div class="mini-instrument-grid commodity-grid">${commodityCards}</div>`);
  const breadthPart = part(5, breadthBody);
  const groupsPart = part(6, groupsBody);
  const capsPart = part(7, capRows.length ? dataTable(copy.capColumns, capRows, 'market-cap-table') : '');
  const shortPart = part(8, shortBody);
  const sections = [
    indicesPart,
    `<div class="market-pair market-pair-tables">${flowsPart}${fivePart}</div>`,
    `<div class="market-pair">${ratesPart}${commodityPart}</div>`,
    breadthPart,
    groupsPart,
    `<div class="market-bottom-grid">${capsPart}${links}</div>`,
    shortPart
  ].filter(Boolean).join('\n');

  return `<main id="market-date-root" class="market-date-page" data-market-date="${html(date)}">
  <section class="market-hero" aria-labelledby="market-date-heading">
    <div class="market-wrap market-hero-inner">
      <div class="market-hero-copy">
        <p class="market-breadcrumb"><a href="${lang === 'en' ? '/en/' : '/'}">${html(copy.breadcrumbHome)}</a> › <a href="${base}">${html(copy.breadcrumbMarket)}</a> › <a href="${marketArchivePath(lang)}">${html(copy.archive)}</a></p>
        <p class="market-eyebrow">${html(copy.eyebrow)}</p>
        <h1 id="market-date-heading">${html(copy.heading(date))}</h1>
        <p class="market-date-summary">${summary}</p>
        ${takeaway ? `<p class="market-subtitle">${html(takeaway)}</p>` : ''}
        <p class="market-date">${dotDate(date, lang)} · ${html(copy.closeBasis)}</p>
        <p class="market-overseas">${html(copy.overseas)}</p>
      </div>
      <div class="market-mountain" aria-hidden="true"></div>
    </div>
  </section>
  <div class="market-wrap">${nav}</div>
  <div class="market-wrap market-dashboard">
${sections}
    <div class="market-data-note"><p>${html(copy.source)}</p><p>${html(copy.disclaimer)}</p></div>
  </div>
  <div class="market-wrap">${nav}</div>
</main>`;
}

/** The <main> for the list of sessions, newest first, grouped by month. */
export function renderMarketArchiveMain(rows, lang) {
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
  <section class="market-hero" aria-labelledby="market-archive-heading">
    <div class="market-wrap market-hero-inner">
      <div class="market-hero-copy">
        <p class="market-breadcrumb"><a href="${lang === 'en' ? '/en/' : '/'}">${html(copy.breadcrumbHome)}</a> › <a href="${base}">${html(copy.breadcrumbMarket)}</a></p>
        <p class="market-eyebrow">MARKET CLOSE · ARCHIVE</p>
        <h1 id="market-archive-heading">${html(heading)}</h1>
        <p class="market-subtitle">${html(lead)}</p>
        <p class="market-date">${html(copy.closeBasis)}</p>
      </div>
      <div class="market-mountain" aria-hidden="true"></div>
    </div>
  </section>
  <div class="market-wrap market-dashboard">
${blocks}
    <p class="market-archive-links"><a href="${marketSectorsPath(lang)}">${html(copy.sectorsLink)} →</a></p>
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
    main: renderMarketDateMain(payload, lang, context)
  });
}

export function marketArchivePageHtml(shell, rows, lang) {
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
    main: renderMarketArchiveMain(rows, lang)
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

/**
 * { payload, prev, next, publishedAt } for a final session, or null when the
 * date has no final row. Throws on a database failure or timeout.
 */
export async function loadMarketDate(env, date, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  return withinBudget((async () => {
    const db = await ensureMarketTable(env);
    const row = await db.prepare(`SELECT market_date, status, published_at, payload_json, takeaway_ko, takeaway_en,
        (SELECT MAX(market_date) FROM ${TABLE_NAME} WHERE market_date < ?1 AND status = 'final') AS prev_date,
        (SELECT MIN(market_date) FROM ${TABLE_NAME} WHERE market_date > ?1 AND status = 'final') AS next_date
      FROM ${TABLE_NAME} WHERE market_date = ?1 LIMIT 1`).bind(date).first();
    if (!row || row.status !== 'final') return null;
    let payload;
    try { payload = JSON.parse(row.payload_json); } catch (_) { return null; }
    if (payload?.meta?.market_date !== date || payload?.meta?.status !== 'final') return null;
    payload.takeaway = { ko: String(row.takeaway_ko || ''), en: String(row.takeaway_en || '') };
    return { payload, prev: row.prev_date || null, next: row.next_date || null, publishedAt: row.published_at || '' };
  })(), budgetMs);
}

/** Every final session, newest first, with the figures the archive lists. */
export async function loadMarketArchive(env, { budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  return withinBudget((async () => {
    const db = await ensureMarketTable(env);
    const result = await db.prepare(`SELECT market_date, published_at,
        json_extract(payload_json, '$.indices.KOSPI.close') AS kospi_close,
        json_extract(payload_json, '$.indices.KOSPI.change_pct') AS kospi_pct,
        json_extract(payload_json, '$.indices.KOSDAQ.close') AS kosdaq_close,
        json_extract(payload_json, '$.indices.KOSDAQ.change_pct') AS kosdaq_pct,
        json_extract(payload_json, '$.krx_investor_trading.markets.KOSPI.investors."외국인".net_buy') AS foreign_net,
        json_extract(payload_json, '$.rates_fx_volatility.USDKRW.close') AS usdkrw
      FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC`).all();
    return (result?.results || []).filter(row => ISO_DATE.test(String(row?.market_date || '')));
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

function unavailable(lang) {
  const text = lang === 'en'
    ? 'Market data is temporarily unavailable. Please try again shortly.'
    : '시장 데이터를 잠시 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.';
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Snowshagal</title><p>${text}</p><p><a href="${lang === 'en' ? '/en/market/' : '/market/'}">MARKET</a></p>`, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60', 'x-robots-tag': 'noindex' }
  });
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
export async function onMarketPageRequest(context, { loadPostsFn, budgetMs = MARKET_DATE_TIME_BUDGET_MS } = {}) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = parseMarketPagePath(url.pathname);
  if (!route) return context.next();
  if (!route.canonical) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);

  try {
    if (route.sectors) {
      const [rows, shell] = await Promise.all([loadMarketSectors(env, { budgetMs }), loadShell(env, url, route.lang)]);
      const view = marketSectorsView(rows);
      if (!view) return notFound(env, url);
      return htmlResponse(marketSectorsPageHtml(shell, view, route.lang));
    }
    if (route.archive) {
      const [rows, shell] = await Promise.all([loadMarketArchive(env, { budgetMs }), loadShell(env, url, route.lang)]);
      if (!rows.length) return notFound(env, url);
      return htmlResponse(marketArchivePageHtml(shell, rows, route.lang));
    }
    const postsPromise = Promise.resolve().then(() => (loadPostsFn || loadPosts)(request, env)).catch(() => []);
    const [data, shell, posts] = await Promise.all([loadMarketDate(env, route.date, { budgetMs }), loadShell(env, url, route.lang), postsPromise]);
    if (!data) return notFound(env, url);
    return htmlResponse(marketDatePageHtml(shell, data.payload, route.lang, {
      prev: data.prev,
      next: data.next,
      publishedAt: data.publishedAt,
      report: dailyReportFor(posts, route.date, route.lang)
    }));
  } catch (error) {
    console.error('market date page unavailable', error);
    return unavailable(route.lang);
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
    eyebrow: 'KRX SECTORS & THEMES',
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
    eyebrow: 'KRX SECTORS & THEMES',
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
  <section class="market-hero" aria-labelledby="market-sectors-heading">
    <div class="market-wrap market-hero-inner">
      <div class="market-hero-copy">
        <p class="market-breadcrumb"><a href="${lang === 'en' ? '/en/' : '/'}">${html(copy.breadcrumbHome)}</a> › <a href="${base}">${html(copy.breadcrumbMarket)}</a> › ${html(sc.breadcrumb)}</p>
        <p class="market-eyebrow">${html(sc.eyebrow)}</p>
        <h1 id="market-sectors-heading">${html(sc.heading)}</h1>
        <p class="market-date-summary">${summary}</p>
        <p class="market-date">${dotDate(view.date, lang)} · ${html(sc.basis)}</p>
        <p class="market-overseas">${html(sc.note)}</p>
      </div>
      <div class="market-mountain" aria-hidden="true"></div>
    </div>
  </section>
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
    const db = await ensureMarketTable(env);
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
