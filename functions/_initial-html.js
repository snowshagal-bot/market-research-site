import { feedQuery, loadDisclosureFeed } from './api/disclosures/_feed-data.js';
import { currentKstYearMonth, loadCalendarMonth } from './_calendar-data.js';

/**
 * Initial HTML for /disclosures/ and /calendar/ (KO and EN).
 *
 * These pages used to ship a "loading…" placeholder and build everything in
 * the browser, so the HTTP response itself — what curl, View Source, a crawler
 * or a reader without JavaScript sees — carried no filings and no trading
 * days. The server now renders the same markup the page scripts render, from
 * the same data helpers the public APIs use, for every visitor alike.
 *
 * The markup and wording below deliberately mirror assets/disclosures.js and
 * assets/calendar.js; tests/initial-html-ssr.test.mjs runs those scripts on
 * the same data and requires identical output, so the page does not change
 * when the script takes over.
 *
 * Nothing here may break a page: any failure or a slow database returns null
 * and the untouched static shell is served, which the scripts then fill in as
 * before.
 */

export const INITIAL_HTML_TIME_BUDGET_MS = 1500;

export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Links out go only to DART over https; anything else renders as an inert link
// (the page script escapes the same field, and the collector only ever writes
// DART viewer URLs).
function dartHref(value) {
  const text = String(value || '');
  return /^https:\/\/dart\.fss\.or\.kr\//.test(text) ? text : '';
}

/* ------------------------------------------------------------ disclosures */

const DISCLOSURE_COPY = {
  ko: {
    countBadge: n => `${n}건`,
    noDisclosuresTitle: '선별된 주요 공시가 없습니다.',
    noDisclosuresDesc: '선택한 날짜에 게시된 주요 기업 공시가 없습니다.',
    viewAll: n => `오늘의 주요 공시 전체 보기 (${n}건) →`,
    viewLess: '접기 ▴',
    factHeading: '핵심 사실',
    whatItMeans: '무엇을 의미하나',
    watchPoints: '확인할 것',
    aiExplanation: 'AI 시장 해설',
    aiAssistNote: '이해 보조용 해석',
    dartOriginal: 'DART 원문 ↗',
    expandDetails: '해설 보기 ▾',
    weekdays: ['일', '월', '화', '수', '목', '금', '토']
  },
  en: {
    countBadge: n => `${n} ${n === 1 ? 'filing' : 'filings'}`,
    noDisclosuresTitle: 'No key disclosures selected.',
    noDisclosuresDesc: 'There are no selected key corporate filings for this date.',
    viewAll: n => `View all key filings (${n}) →`,
    viewLess: 'Collapse ▴',
    factHeading: 'Key Facts',
    whatItMeans: 'What It Means',
    watchPoints: 'Watch Points',
    aiExplanation: 'AI Market Insight',
    aiAssistNote: 'Reader assistance',
    dartOriginal: 'DART Original ↗',
    expandDetails: 'Details ▾',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  }
};

const EN_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateDisplay(dateStr, lang) {
  const copy = DISCLOSURE_COPY[lang];
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayOfWeek = copy.weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return lang === 'ko' ? `${y}년 ${m}월 ${d}일 (${dayOfWeek})` : `${EN_SHORT_MONTHS[m - 1]} ${d}, ${y} (${dayOfWeek})`;
}

/** The URL state exactly as assets/disclosures.js parses it. */
export function disclosuresUrlState(searchParams) {
  const dateParam = searchParams.get('date');
  const allParam = searchParams.get('all');
  return {
    selectedDate: dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null,
    isExpanded: allParam === '1' || allParam === 'true'
  };
}

export function disclosuresHydrationKey(state) {
  return `${state.selectedDate || ''}|${state.isExpanded ? 1 : 0}`;
}

export function renderDisclosureFeed(data, { lang, isExpanded }) {
  const copy = DISCLOSURE_COPY[lang];
  const ko = lang === 'ko';
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    return `
        <div class="disclosures-state-box">
          <h3>${copy.noDisclosuresTitle}</h3>
          <p>${copy.noDisclosuresDesc}</p>
        </div>
      `;
  }

  const displayItems = (!isExpanded && items.length > 5) ? items.slice(0, 5) : items;

  const cardsHtml = displayItems.map(item => {
    const hasAi = Boolean(item.ai && item.ai.status === 'done');
    const fact = item.fact || item;
    const rceptNo = escapeHtml(item.rceptNo || fact.rceptNo || '');
    const corpName = escapeHtml(fact.corpName || '');
    const stockCode = escapeHtml(fact.stockCode || '');
    const reportName = escapeHtml(fact.reportName || '');
    const isCorrection = Boolean(fact.isCorrection);
    const correctionType = escapeHtml(fact.correctionType || (ko ? '[기재정정]' : '[Correction]'));
    const sourceUrl = escapeHtml(dartHref(fact.sourceUrl));
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
          ${isExpanded ? copy.viewLess : copy.viewAll(data.totalPublished || items.length)}
        </button>
      </div>
    ` : '';

  return `<div class="disclosures-feed-list">${cardsHtml}</div>${toggleAllHtml}`;
}

async function disclosuresEdits(url, env, lang, now) {
  const state = disclosuresUrlState(url.searchParams);
  // The same query the page script sends to /api/disclosures/feed.
  const params = new URLSearchParams();
  if (state.selectedDate) params.set('date', state.selectedDate);
  if (state.isExpanded) params.set('all', '1');
  const { queryDate, showAll } = feedQuery(params);
  const data = await loadDisclosureFeed(env, { queryDate, showAll, now });
  const copy = DISCLOSURE_COPY[lang];
  const edits = [
    { id: 'disclosures-current-date', text: formatDateDisplay(data.date, lang) },
    { id: 'disclosures-count-badge', text: copy.countBadge(data.totalPublished || (data.items ? data.items.length : 0)) },
    {
      id: 'disclosures-mount',
      html: renderDisclosureFeed(data, { lang, isExpanded: state.isExpanded }),
      attrs: { 'data-ssr-key': disclosuresHydrationKey(state) }
    }
  ];
  return { edits, classToggles: [] };
}

/* --------------------------------------------------------------- calendar */

const CALENDAR_COPY = {
  ko: {
    weekdays: ['일', '월', '화', '수', '목', '금', '토'],
    monthFormat: (y, m) => `${y}년 ${m}월`,
    upcomingHeading: '다가오는 거래 일정',
    todayTag: '오늘',
    jointClosureDesc: '한국(KRX) 및 미국(NYSE) 양 시장 동시 휴장',
    deferredNotice: '해당 연도 일정은 공식 확정 후 순차 업데이트됩니다.',
    eventsUnavailable: '시장 이벤트 일정을 일시적으로 불러오지 못했습니다.',
    eventMore: (n) => `+${n}건 더`,
    krxPendingBanner: 'KRX(한국) 2027년 거래 일정은 한국거래소 공식 발표 후 순차 반영 예정입니다. (미국 NYSE 2027 일정 정상 제공)',
    krxPendingOnlyBanner: 'KRX(한국) 2027년 연간 거래 일정은 한국거래소의 공식 공시 발표 후 업데이트됩니다.',
    krxPendingStatus: 'KRX 2027 공식 일정 확정 대기'
  },
  en: {
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthFormat: (y, m) => {
      const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return `${names[m - 1]} ${y}`;
    },
    upcomingHeading: 'Upcoming Trading Schedule',
    todayTag: 'Today',
    jointClosureDesc: 'Joint full-day holiday for both KRX and NYSE',
    deferredNotice: 'Schedules for this year will be updated once officially confirmed.',
    eventsUnavailable: 'Market events are temporarily unavailable.',
    eventMore: (n) => `+${n} more`,
    krxPendingBanner: 'KRX 2027 official schedule is pending publication by KRX. (NYSE 2027 schedule is officially confirmed & provided)',
    krxPendingOnlyBanner: 'KRX 2027 full annual schedule will be updated once officially released by Korea Exchange.',
    krxPendingStatus: 'KRX 2027 schedule pending official release'
  }
};

/**
 * The URL state exactly as assets/calendar.js parses it: a year outside
 * 2020–2030, a month outside 1–12 or an unknown market is ignored in favour of
 * the current Seoul month and ALL.
 */
export function calendarUrlState(searchParams, now = new Date()) {
  const current = currentKstYearMonth(now);
  const y = Number(searchParams.get('year'));
  const m = Number(searchParams.get('month'));
  const market = String(searchParams.get('market') || '').toUpperCase();
  return {
    year: searchParams.has('year') && Number.isInteger(y) && y >= 2020 && y <= 2030 ? y : current.year,
    month: searchParams.has('month') && Number.isInteger(m) && m >= 1 && m <= 12 ? m : current.month,
    filter: ['ALL', 'KRX', 'NYSE'].includes(market) ? market : 'ALL'
  };
}

const FILTER_MARKETS = { ALL: null, KRX: 'KR', NYSE: 'US' };
const MAX_CELL_EVENTS = 2;

function eventTitle(event, ko) {
  const preferred = ko ? event.title?.ko : event.title?.en;
  return preferred || event.title?.ko || event.title?.en || '';
}

function eventCompany(event, ko) {
  if (!event.company) return '';
  if (!ko && event.company.nameEn) return event.company.nameEn;
  return event.company.name || event.company.stockCode || '';
}

export function renderCalendarGrid(data, { lang, filter }) {
  const copy = CALENDAR_COPY[lang];
  const ko = lang === 'ko';

  if (!data.supported) {
    return `
        <div class="calendar-detail-card" style="text-align:center;padding:40px 20px;">
          <h3>${escapeHtml(data.message || copy.deferredNotice)}</h3>
          <p style="color:var(--muted);">${copy.deferredNotice}</p>
        </div>
      `;
  }

  const krxSupported = Boolean(data.marketSupport?.krx);

  if (filter === 'KRX' && !krxSupported) {
    return `
        <div class="calendar-detail-card" style="text-align:center;padding:40px 20px;">
          <h3>${copy.krxPendingStatus}</h3>
          <p style="color:var(--muted);">${copy.krxPendingOnlyBanner}</p>
        </div>
      `;
  }

  const days = data.days || [];
  if (!days.length) return null;

  const wanted = FILTER_MARKETS[filter];
  const eventsForDate = dateStr => (data.events || [])
    .filter(event => event.display?.date === dateStr)
    .filter(event => !wanted || event.market === wanted);

  const cellEventsHtml = dateStr => {
    const events = eventsForDate(dateStr).filter(event => event.status !== 'cancelled');
    if (!events.length) return '';
    const shown = events.slice(0, MAX_CELL_EVENTS).map(event => {
      const company = eventCompany(event, ko);
      const label = company || eventTitle(event, ko);
      return `<span class="cal-event-chip ${event.market === 'KR' ? 'kr' : 'us'}" title="${escapeHtml(eventTitle(event, ko))}">${escapeHtml(label)}</span>`;
    }).join('');
    const rest = events.length - MAX_CELL_EVENTS;
    return shown + (rest > 0 ? `<span class="cal-event-more">${escapeHtml(copy.eventMore(rest))}</span>` : '');
  };

  const firstDayOfWeek = days[0].dayOfWeek;
  const weekdaysHtml = copy.weekdays.map((w, idx) => `
      <div class="calendar-weekday-cell ${idx === 0 || idx === 6 ? 'weekend' : ''}">${escapeHtml(w)}</div>
    `).join('');

  let cellsHtml = '';
  for (let i = 0; i < firstDayOfWeek; i++) {
    cellsHtml += `<div class="calendar-day-cell empty" aria-hidden="true"></div>`;
  }

  for (const day of days) {
    const isToday = data.serverDate === day.date;
    const isWeekend = day.isWeekend;
    let tagsHtml = '';

    if (!isWeekend) {
      if (day.isJointClosure && filter === 'ALL') {
        tagsHtml += `<span class="cal-tag joint">${ko ? '동시 휴장' : 'Joint Holiday'}</span>`;
      } else {
        if (day.krx?.holiday && (filter === 'ALL' || filter === 'KRX')) {
          const label = day.krx.name ? (ko ? day.krx.name.ko : day.krx.name.en) : (ko ? 'KRX 휴장' : 'KRX Holiday');
          tagsHtml += `<span class="cal-tag krx" title="${escapeHtml(label)}">KRX ${escapeHtml(label)}</span>`;
        }
        if (day.nyse?.holiday && (filter === 'ALL' || filter === 'NYSE')) {
          const label = day.nyse.name ? (ko ? day.nyse.name.ko : day.nyse.name.en) : (ko ? 'NYSE 휴장' : 'NYSE Holiday');
          tagsHtml += `<span class="cal-tag nyse" title="${escapeHtml(label)}">NYSE ${escapeHtml(label)}</span>`;
        }
      }

      if (day.krx?.specialSession && (filter === 'ALL' || filter === 'KRX')) {
        const spec = day.krx.specialSession;
        const label = ko ? spec.nameKo : spec.nameEn;
        tagsHtml += `<span class="cal-tag special" title="${escapeHtml(label)}">KRX ${escapeHtml(spec.session)}</span>`;
      }
      if (day.nyse?.specialSession && (filter === 'ALL' || filter === 'NYSE')) {
        const spec = day.nyse.specialSession;
        const label = ko ? spec.nameKo : spec.nameEn;
        tagsHtml += `<span class="cal-tag special" title="${escapeHtml(label)}">NYSE ${escapeHtml(spec.session)}</span>`;
      }
    }

    cellsHtml += `
        <div class="calendar-day-cell ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} " data-date="${escapeHtml(day.date)}" tabindex="0" role="button" aria-label="${escapeHtml(day.date)}">
          <div class="day-header">
            <span class="day-number">${escapeHtml(day.day)}</span>
            ${isToday ? `<span class="day-today-tag">${copy.todayTag}</span>` : ''}
          </div>
          <div class="day-events">
            ${tagsHtml}
            ${cellEventsHtml(day.date)}
          </div>
        </div>
      `;
  }

  const pendingNoticeBanner = (!krxSupported && filter === 'ALL') ? `
      <div style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--text-2);display:flex;align-items:center;gap:8px;">
        <span style="font-size:14px;">ℹ️</span>
        <span>${copy.krxPendingBanner}</span>
      </div>
    ` : '';

  const eventsUnavailable = data.eventsStatus === 'unavailable'
    ? `<p class="calendar-events-notice" role="status">${escapeHtml(copy.eventsUnavailable)}</p>`
    : '';

  return `
      ${pendingNoticeBanner}
      <div class="calendar-card">
        <div class="calendar-weekdays-row">
          ${weekdaysHtml}
        </div>
        <div class="calendar-days-grid">
          ${cellsHtml}
        </div>
      </div>
      ${eventsUnavailable}
      <div id="calendar-day-detail-mount"></div>
    `;
}

export function renderUpcomingEvents(events, { lang, filter, year }) {
  const copy = CALENDAR_COPY[lang];
  const ko = lang === 'ko';
  if (!events.length) return '';

  const filtered = events.filter(event => {
    if (filter === 'ALL') return true;
    if (filter === 'KRX') return event.krx?.supported && (event.krx.holiday || event.krx.specialSession);
    if (filter === 'NYSE') return event.nyse?.supported && (event.nyse.holiday || event.nyse.specialSession);
    return true;
  });

  if (!filtered.length) {
    if (filter === 'KRX' && year >= 2027) {
      return `
          <section class="calendar-upcoming-section">
            <h2>${copy.upcomingHeading}</h2>
            <p style="font-size:12px;color:var(--muted);">${copy.krxPendingOnlyBanner}</p>
          </section>
        `;
    }
    return '';
  }

  const cardsHtml = filtered.map(ev => {
    const [y, m, d] = ev.date.split('-').map(Number);
    const dayOfWeek = copy.weekdays[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    const dateDisplay = ko ? `${y}년 ${m}월 ${d}일 (${dayOfWeek})` : `${EN_SHORT_MONTHS[m - 1]} ${d}, ${y} (${dayOfWeek})`;

    let eventRows = '';
    if (ev.isJointClosure) {
      eventRows += `<div class="detail-item-row"><span class="detail-market-badge joint">JOINT</span><strong>${copy.jointClosureDesc}</strong></div>`;
    } else {
      if (ev.krx?.supported && ev.krx.holiday && (filter === 'ALL' || filter === 'KRX')) {
        const name = ev.krx.name ? (ko ? ev.krx.name.ko : ev.krx.name.en) : (ko ? 'KRX 휴장' : 'KRX Holiday');
        eventRows += `<div class="detail-item-row"><span class="detail-market-badge krx">KRX</span><strong>${escapeHtml(name)}</strong></div>`;
      }
      if (ev.krx?.supported && ev.krx.specialSession && (filter === 'ALL' || filter === 'KRX')) {
        const spec = ev.krx.specialSession;
        const name = ko ? spec.nameKo : spec.nameEn;
        eventRows += `<div class="detail-item-row"><span class="detail-market-badge special">KRX</span><span>${escapeHtml(name)} (${escapeHtml(spec.session)})</span></div>`;
      }
      if (ev.nyse?.supported && ev.nyse.holiday && (filter === 'ALL' || filter === 'NYSE')) {
        const name = ev.nyse.name ? (ko ? ev.nyse.name.ko : ev.nyse.name.en) : (ko ? 'NYSE 휴장' : 'NYSE Holiday');
        eventRows += `<div class="detail-item-row"><span class="detail-market-badge nyse">NYSE</span><strong>${escapeHtml(name)}</strong></div>`;
      }
      if (ev.nyse?.supported && ev.nyse.specialSession && (filter === 'ALL' || filter === 'NYSE')) {
        const spec = ev.nyse.specialSession;
        const name = ko ? spec.nameKo : spec.nameEn;
        eventRows += `<div class="detail-item-row"><span class="detail-market-badge special">NYSE</span><span>${escapeHtml(name)} (${escapeHtml(spec.session)})</span></div>`;
      }
    }

    return `
        <div class="upcoming-event-card">
          <div class="upcoming-event-date">${dateDisplay}</div>
          <div class="upcoming-event-items">
            ${eventRows}
          </div>
        </div>
      `;
  }).join('');

  return `
      <section class="calendar-upcoming-section">
        <h2>${copy.upcomingHeading}</h2>
        <div class="upcoming-events-grid">
          ${cardsHtml}
        </div>
      </section>
    `;
}

async function calendarEdits(url, env, lang, now) {
  const state = calendarUrlState(url.searchParams, now);
  const data = await loadCalendarMonth(env, { year: state.year, month: state.month, now });
  const grid = renderCalendarGrid(data, { lang, filter: state.filter });
  if (grid === null) return null;
  return {
    edits: [
      { id: 'calendar-month-label', text: CALENDAR_COPY[lang].monthFormat(state.year, state.month) },
      {
        id: 'calendar-grid-mount',
        html: grid,
        attrs: {
          'data-ssr-year': String(state.year),
          'data-ssr-month': String(state.month),
          'data-ssr-filter': state.filter,
          'data-ssr-server-date': data.serverDate
        }
      },
      { id: 'calendar-upcoming-mount', html: renderUpcomingEvents(data.upcoming || [], { lang, filter: state.filter, year: state.year }) }
    ],
    classToggles: [{ selector: 'calendar-filter-btn', attr: 'data-filter', active: state.filter }]
  };
}

/* --------------------------------------------------------------- routing */

const PAGE_PATTERN = /^\/(en\/)?(disclosures|calendar)\/(?:index\.html)?$/;

export function initialHtmlPage(pathname) {
  const match = PAGE_PATTERN.exec(pathname);
  return match ? { lang: match[1] ? 'en' : 'ko', page: match[2] } : null;
}

function withinBudget(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })
  ]);
}

/**
 * The edits for one request, or null when the page is not one of these four,
 * when anything fails, or when the data takes longer than the budget.
 */
export async function buildInitialHtml(url, env, { now = new Date(), budgetMs = INITIAL_HTML_TIME_BUDGET_MS } = {}) {
  const target = initialHtmlPage(url.pathname);
  if (!target) return null;
  try {
    const build = target.page === 'disclosures'
      ? disclosuresEdits(url, env, target.lang, now)
      : calendarEdits(url, env, target.lang, now);
    return await withinBudget(build, budgetMs);
  } catch (error) {
    console.error('initial html unavailable', target.page, error?.message || error);
    return null;
  }
}

/* ---------------------------------------------------------- application */

function attributeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Replaces the children of the element with the given id, counting nested
 * tags of the same name so a mount that already holds nested markup is
 * replaced whole. Used where HTMLRewriter is not available (tests).
 */
function replaceById(body, { id, html, text, attrs, removeAttrs }) {
  const open = new RegExp(`<([a-zA-Z][\\w-]*)\\b([^>]*\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*)>`);
  const match = open.exec(body);
  if (!match) return body;
  const tag = match[1].toLowerCase();
  let attributes = match[2];
  for (const [name, value] of Object.entries(attrs || {})) {
    const existing = new RegExp(`\\s${name}(?:=["'][^"']*["'])?(?![\\w-])`);
    attributes = attributes.replace(existing, '');
    attributes += value === '' ? ` ${name}` : ` ${name}="${attributeText(value)}"`;
  }
  for (const name of removeAttrs || []) {
    attributes = attributes.replace(new RegExp(`\\s${name}(?:=["'][^"']*["'])?(?![\\w-])`), '');
  }
  const openTag = `<${match[1]}${attributes}>`;
  const start = match.index;
  const contentStart = start + match[0].length;
  if (html === undefined && text === undefined) {
    return body.slice(0, start) + openTag + body.slice(contentStart);
  }
  const tagPattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let close;
  while ((close = tagPattern.exec(body))) {
    if (close[0].endsWith('/>')) continue;
    depth += close[1] ? -1 : 1;
    if (depth === 0) break;
  }
  if (!close) return body;
  const inner = html !== undefined ? html : escapeHtml(text);
  return body.slice(0, start) + openTag + inner + body.slice(close.index);
}

function toggleClassInString(body, { selector, attr, active }) {
  const pattern = new RegExp(`<([a-zA-Z]+)([^>]*\\bclass=["'])([^"']*\\b${selector}\\b[^"']*)(["'][^>]*)>`, 'g');
  return body.replace(pattern, (whole, tag, before, classes, after) => {
    const valueMatch = new RegExp(`\\b${attr}=["']([^"']*)["']`).exec(whole);
    const list = classes.split(/\s+/).filter(name => name && name !== 'active');
    if (valueMatch && valueMatch[1] === active) list.push('active');
    return `<${tag}${before}${list.join(' ')}${after}>`;
  });
}

export function applyInitialHtmlToString(body, initial) {
  let out = body;
  for (const edit of initial.edits) out = replaceById(out, edit);
  for (const toggle of initial.classToggles) out = toggleClassInString(out, toggle);
  return out;
}

export function applyInitialHtmlToRewriter(rewriter, initial) {
  let out = rewriter;
  for (const edit of initial.edits) {
    out = out.on(`#${edit.id}`, {
      element(element) {
        for (const [name, value] of Object.entries(edit.attrs || {})) element.setAttribute(name, value);
        for (const name of edit.removeAttrs || []) element.removeAttribute(name);
        if (edit.html !== undefined) element.setInnerContent(edit.html, { html: true });
        else if (edit.text !== undefined) element.setInnerContent(edit.text);
      }
    });
  }
  for (const toggle of initial.classToggles) {
    out = out.on(`.${toggle.selector}`, {
      element(element) {
        const list = String(element.getAttribute('class') || '').split(/\s+/).filter(name => name && name !== 'active');
        if (element.getAttribute(toggle.attr) === toggle.active) list.push('active');
        element.setAttribute('class', list.join(' '));
      }
    });
  }
  return out;
}
