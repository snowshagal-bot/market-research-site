// The day's Market Close as a short Korean post to paste into a blog: a title,
// a plain-text body and a tag line. /admin/market/blog/ shows it beside the
// session's card image (functions/_market-card.js).
//
// Plain text only: a blog editor keeps line breaks from a paste, while pasted
// HTML is rewritten by each editor in its own way.
//
// Same rule as the card: only figures of the record's own 15:30 regular
// session. A missing figure leaves its line out; nothing is carried from
// another day, and nothing from after the close is added.
import { makeFormat, marketDatePath } from './_market-date-page.js';

const PRODUCTION_ORIGIN = 'https://snowshagal.com';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const INVESTORS = ['외국인', '기관', '개인'];
const TAGS = ['코스피', '코스닥', '증시마감', '오늘증시', '장마감', '원달러환율', '외국인순매수'];
const DISCLAIMER = '투자 판단의 참고 자료이며, 매수·매도 권유가 아닙니다.';

const valid = (value) => typeof value === 'number' && Number.isFinite(value);

function dateParts(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return { y, m, d, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] };
}

function indexLine(name, item, f) {
  if (!valid(item?.close)) return '';
  const change = [valid(item.change) ? f.signed(item.change, 2) : '', valid(item.change_pct) ? f.pct(item.change_pct) : ''].filter(Boolean).join(', ');
  return `${name} ${f.number(item.close, 2)}${change ? ` (${change})` : ''}`;
}

function indexInTitle(name, item, f) {
  if (!valid(item?.close)) return '';
  return `${name} ${f.number(item.close, 2)}${valid(item.change_pct) ? `(${f.pct(item.change_pct)})` : ''}`;
}

function flowLines(payload, market, f) {
  const investors = payload?.krx_investor_trading?.markets?.[market]?.investors || {};
  return INVESTORS.filter(name => valid(investors[name]?.net_buy)).map(name => `${name} ${f.flow(investors[name].net_buy)}`);
}

function section(heading, lines) {
  const kept = lines.filter(Boolean);
  return kept.length ? [`[${heading}]`, ...kept].join('\n') : '';
}

// Telegram's limit for the text under a photo.
export const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * The session as the short text under its card in a channel post: the two
 * closes, KOSPI net buying, the USD/KRW fixing, the day's one-line read when
 * there is one, and the session page's address. Plain text, never longer than
 * TELEGRAM_CAPTION_LIMIT (the one-line read is what gets cut).
 */
export function marketChannelCaption(payload, { takeaway = '' } = {}) {
  const f = makeFormat('ko');
  const date = String(payload?.meta?.market_date || '');
  const { m, d, weekday } = dateParts(date);
  const fx = payload?.rates_fx_volatility?.USDKRW;
  const closes = [['코스피', payload?.indices?.KOSPI], ['코스닥', payload?.indices?.KOSDAQ]]
    .filter(([, item]) => valid(item?.close))
    .map(([name, item]) => `${name} ${f.number(item.close, 2)}${valid(item.change_pct) ? ` (${f.pct(item.change_pct)})` : ''}`);
  const flows = flowLines(payload, 'KOSPI', f);
  const facts = [
    flows.length ? `코스피 순매수: ${flows.join(' · ')}` : '',
    valid(fx?.close) && fx?.data_state !== 'unavailable' ? `원/달러 ${f.valueUnit('USDKRW', fx.close)} (하나은행 고시)` : ''
  ].filter(Boolean);
  const head = `${m}월 ${d}일(${weekday}) 증시 마감 · 15:30 정규장 기준`;
  const link = `전체 기록: ${PRODUCTION_ORIGIN}${marketDatePath(date, 'ko')}`;
  const build = (line) => [head, closes.join('\n'), facts.join('\n'), line, link].filter(Boolean).join('\n\n');

  const line = String(takeaway || '').replace(/\s+/g, ' ').trim();
  const room = TELEGRAM_CAPTION_LIMIT - build('').length - 2;
  if (!line || room < 8) return build('');
  return build(line.length > room ? `${line.slice(0, room - 1).trimEnd()}…` : line);
}

/**
 * { title, body, tags, pageUrl } for a published session.
 * `takeaway` is the day's one-line read; `reportUrl` the path of that day's
 * Daily report. Both are optional and left out when empty.
 */
export function marketBlogPost(payload, { takeaway = '', reportUrl = '' } = {}) {
  const f = makeFormat('ko');
  const date = String(payload?.meta?.market_date || '');
  const { y, m, d, weekday } = dateParts(date);
  const kospi = payload?.indices?.KOSPI;
  const kosdaq = payload?.indices?.KOSDAQ;
  const fx = payload?.rates_fx_volatility?.USDKRW;
  const breadthOk = payload?.section_status?.market_breadth?.status !== 'unavailable';
  const breadth = breadthOk ? payload?.market_breadth?.KOSPI : null;
  const rise = breadth ? (breadth.rise_count ?? breadth.rise) : null;
  const fall = breadth ? (breadth.fall_count ?? breadth.fall) : null;
  const turnover = payload?.market_internals?.turnover?.KOSPI?.value_won;
  const pageUrl = `${PRODUCTION_ORIGIN}${marketDatePath(date, 'ko')}`;

  const closes = [indexInTitle('코스피', kospi, f), indexInTitle('코스닥', kosdaq, f)].filter(Boolean).join(' · ');
  const title = `${m}월 ${d}일(${weekday}) 증시 마감${closes ? ` | ${closes}` : ''}`;

  const line = String(takeaway || '').replace(/\s+/g, ' ').trim();
  const report = String(reportUrl || '').trim();
  const blocks = [
    `${y}년 ${m}월 ${d}일(${weekday}) 한국 증시 마감 기록입니다. 숫자는 모두 15:30 정규장 마감 기준입니다.`,
    section('지수', [indexLine('코스피', kospi, f), indexLine('코스닥', kosdaq, f)]),
    section('코스피 투자자별 순매수', flowLines(payload, 'KOSPI', f)),
    section('코스닥 투자자별 순매수', flowLines(payload, 'KOSDAQ', f)),
    section('환율 · 시장 폭 · 거래대금', [
      valid(fx?.close) && fx?.data_state !== 'unavailable' ? `원/달러 ${f.valueUnit('USDKRW', fx.close)} (하나은행 고시)` : '',
      valid(rise) && valid(fall) ? `코스피 상승 ${f.integer(rise)}종목 · 하락 ${f.integer(fall)}종목` : '',
      valid(turnover) ? `코스피 거래대금 ${f.won(turnover)}` : ''
    ]),
    line ? section('오늘의 한 줄', [line]) : '',
    `업종·테마 등락률, 시가총액 상위 종목, 금리와 해외 지표까지 이날 기록 전체는 아래에서 볼 수 있습니다.\n${pageUrl}`,
    report ? `이날의 데일리 리포트\n${report.startsWith('http') ? report : `${PRODUCTION_ORIGIN}${report}`}` : '',
    DISCLAIMER
  ];

  return {
    date,
    title,
    body: blocks.filter(Boolean).join('\n\n'),
    tags: TAGS.map(tag => `#${tag}`).join(' '),
    pageUrl
  };
}
