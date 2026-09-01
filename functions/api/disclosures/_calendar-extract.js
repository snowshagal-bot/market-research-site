/**
 * Future company dates, taken from filings this site already stores.
 *
 * The daily OpenDART sync writes every filing into D1. Some of those filings
 * announce a date that has not happened yet — a briefing, a shareholder
 * meeting, a record date — and those are what the calendar wants. Nothing here
 * starts a second crawl: candidates are chosen from rows that are already
 * there, and only for companies an administrator has switched calendar
 * tracking on for.
 *
 * The list OpenDART returns carries the filing's title and its receipt date,
 * never the date the filing is about. OpenDART's structured APIs cover
 * periodic-report history rather than forward schedules, so the announced date
 * exists only inside the filed document. That leaves one rule, and it decides
 * the design: a candidate becomes a calendar event only when a labelled date
 * is read out of the document itself. A title that sounds like a shareholder
 * meeting is not a shareholder meeting date. Nothing is inferred from the
 * title, from the receipt date, or from what such filings "usually" mean —
 * a missing event is a smaller error than a wrong one.
 *
 * Identity is the receipt number, not the date. A filing that moves its own
 * date updates the event it already owns instead of creating a second one.
 */

const RECEIPT_NO = /^\d{14}$/;

/**
 * The filing types that announce a future date, with the label that date
 * carries inside the document and how the calendar should describe it.
 *
 * Each entry names its own labels rather than sharing a generic date hunt,
 * because "기준일" in a dividend filing and "개최일시" in a briefing are
 * different facts and only one of them belongs on the calendar.
 */
export const CALENDAR_FILING_RULES = Object.freeze([
  {
    key: 'ir',
    match: /기업설명회|IR\s*개최/,
    labels: ['개최일시', '개최일자', '일시'],
    category: 'corporate_event',
    titleKo: '기업설명회(IR)',
    titleEn: 'Investor Relations Briefing'
  },
  {
    key: 'earnings',
    match: /결산실적공시\s*예고|실적발표\s*예정|잠정실적\s*공시\s*예정/,
    labels: ['공시예정일', '실적발표예정일', '예정일자'],
    category: 'earnings',
    titleKo: '실적 발표 예정',
    titleEn: 'Earnings Announcement'
  },
  {
    key: 'shareholder_meeting',
    match: /주주총회\s*소집(결의|공고)/,
    labels: ['주주총회일', '주주총회 예정일자', '총회일시', '일시'],
    category: 'corporate_event',
    titleKo: '주주총회',
    titleEn: 'Shareholder Meeting'
  },
  {
    key: 'dividend_record',
    match: /배당(결정|기준일)|현금ㆍ?현물배당/,
    labels: ['배당기준일', '기준일'],
    category: 'corporate_event',
    titleKo: '배당 기준일',
    titleEn: 'Dividend Record Date'
  }
]);

/** A filing whose title marks it as a correction of an earlier one. */
export const CORRECTION_MARK = /\[(기재정정|첨부정정|첨부추가|정정)\]/;

/**
 * Which stored filings are worth opening. A candidate is not an event: it is a
 * filing whose title says it may carry a future date.
 */
export function selectCalendarCandidates(filings, calendarStockCodes) {
  const codes = calendarStockCodes instanceof Set ? calendarStockCodes : new Set(calendarStockCodes || []);
  const candidates = [];
  for (const filing of filings || []) {
    const stockCode = String(filing.stockCode || filing.stock_code || '').trim();
    // Calendar tracking is the only thing that admits a company here. A
    // disclosure-priority company that is not calendar-tracked is skipped.
    if (!stockCode || !codes.has(stockCode)) continue;

    const rceptNo = String(filing.rceptNo || filing.rcept_no || '').trim();
    if (!RECEIPT_NO.test(rceptNo)) continue;

    const reportName = String(filing.reportName || filing.report_nm || '').trim();
    const rule = CALENDAR_FILING_RULES.find(candidate => candidate.match.test(reportName));
    if (!rule) continue;

    candidates.push({
      rceptNo,
      stockCode,
      corpName: String(filing.corpName || filing.corp_name || '').trim(),
      reportName,
      receiptDate: String(filing.receiptDate || filing.rcept_dt || '').trim(),
      rule: rule.key,
      isCorrection: CORRECTION_MARK.test(reportName)
    });
  }
  return candidates;
}

/**
 * Reads a labelled date out of a filed document.
 *
 * Only a date that sits next to one of the labels the rule names is accepted,
 * and only in the forms DART writes: 2026년 3월 20일, 2026-03-20, 2026.03.20.
 * A bare date somewhere in the document is not enough — it could be the filing
 * date, a past period, or a footnote.
 */
export function extractLabelledDate(documentText, ruleKey) {
  const rule = CALENDAR_FILING_RULES.find(candidate => candidate.key === ruleKey);
  if (!rule) return null;
  const text = String(documentText || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

  for (const label of rule.labels) {
    // The label, then at most a short run of separators, then the date. A long
    // gap means the two are not related.
    const pattern = new RegExp(`${escapeLabel(label)}[^0-9]{0,12}(\\d{4})[.\\-년/]\\s?(\\d{1,2})[.\\-월/]\\s?(\\d{1,2})`, 'g');
    const match = pattern.exec(text);
    if (!match) continue;
    const date = realDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!date) continue;
    return { date, label, time: extractLabelledTime(text, label) };
  }
  return null;
}

/** A time is taken only when it is written beside the same label. */
function extractLabelledTime(text, label) {
  // Only whitespace may separate the date from its time. DART writes the two
  // together — "2026년 10월 15일 14시 00분" — so anything else in between means
  // the clock belongs to a different sentence.
  const pattern = new RegExp(`${escapeLabel(label)}[^0-9]{0,12}\\d{4}[.\\-년/]\\s?\\d{1,2}[.\\-월/]\\s?\\d{1,2}일?\\s{0,3}(\\d{1,2})\\s?[:시]\\s?(\\d{2})`, 'g');
  const match = pattern.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function escapeLabel(label) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
}

function realDate(year, month, day) {
  if (!year || month < 1 || month > 12 || day < 1) return null;
  if (year < 2000 || year > 2100) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The receipt number a correction says it is correcting.
 *
 * A correction is linked to its original only when the document states the
 * original's receipt number. Matching on company, title and a nearby date
 * would merge two genuinely different announcements as often as it would
 * merge one, so an unlinked correction stays its own event.
 */
export function extractCorrectedReceiptNo(documentText) {
  const text = String(documentText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const match = /(정정대상\s*공시\s*접수번호|원공시\s*접수번호|접수번호)[^0-9]{0,12}(\d{14})/.exec(text);
  return match ? match[2] : null;
}

/**
 * Turns a candidate and its document into an event, or into a reason it was
 * not promoted. The caller stores events and counts the skips; nothing is
 * written for a candidate whose date could not be read.
 */
export function buildCorporateEvent(candidate, documentText, { now = new Date() } = {}) {
  const rule = CALENDAR_FILING_RULES.find(item => item.key === candidate.rule);
  if (!rule) return { ok: false, reason: 'UNKNOWN_RULE' };

  const found = extractLabelledDate(documentText, candidate.rule);
  if (!found) return { ok: false, reason: 'NO_LABELLED_DATE' };

  // A date that has already passed is history, not a calendar entry.
  const today = now.toISOString().slice(0, 10);
  if (found.date < today) return { ok: false, reason: 'DATE_IN_PAST', date: found.date };

  const correctedRceptNo = candidate.isCorrection ? extractCorrectedReceiptNo(documentText) : null;

  return {
    ok: true,
    correctedRceptNo,
    event: {
      eventDate: found.date,
      // Only a time written beside the same label is used.
      eventTime: found.time,
      timezone: 'Asia/Seoul',
      market: 'KR',
      category: rule.category,
      importance: 'normal',
      titleKo: rule.titleKo,
      titleEn: rule.titleEn,
      sourceType: 'opendart',
      sourceName: 'opendart',
      sourceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(candidate.rceptNo)}`,
      // Identity is the filing, never the date it announced: a filing that
      // moves its date updates the event it already owns.
      sourceEventId: `dart:${candidate.rceptNo}`,
      companyStockCode: candidate.stockCode,
      companyName: candidate.corpName,
      meta: {
        rceptNo: candidate.rceptNo,
        // The filing's own title, kept in Korean as filed. The English
        // calendar shows the category label and the company's registered
        // English name; this line is never machine-translated.
        reportName: candidate.reportName,
        dateLabel: found.label,
        ...(candidate.isCorrection ? { correction: true } : {}),
        ...(correctedRceptNo ? { correctsRceptNo: correctedRceptNo } : {})
      }
    }
  };
}

export const __test = { realDate, escapeLabel, extractLabelledTime };
