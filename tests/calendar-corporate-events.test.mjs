import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CALENDAR_FILING_RULES,
  buildCorporateEvent,
  extractCorrectedReceiptNo,
  extractLabelledDate,
  selectCalendarCandidates
} from '../functions/api/disclosures/_calendar-extract.js';
import { normalizeEvent } from '../functions/_calendar-events.js';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const CALENDAR_CODES = new Set(['005930', '064350']);

const filing = (overrides = {}) => ({
  rcept_no: '20260901000001',
  stock_code: '005930',
  corp_name: '삼성전자',
  report_nm: '기업설명회(IR)개최(안내공시)',
  rcept_dt: '20260901',
  ...overrides
});

/* ------------------------------------------- who is even looked at */

test('only a calendar-tracked company produces candidates', () => {
  const candidates = selectCalendarCandidates([
    filing(),
    filing({ rcept_no: '20260901000002', stock_code: '000660', corp_name: 'SK하이닉스' })
  ], CALENDAR_CODES);

  assert.deepEqual(candidates.map(c => c.stockCode), ['005930']);
});

test('a disclosure-priority company that is not calendar-tracked is skipped', () => {
  // The two switches are independent, and this is the side that matters here:
  // being important for disclosures grants no calendar extraction.
  const candidates = selectCalendarCandidates([filing({ stock_code: '000660' })], CALENDAR_CODES);
  assert.deepEqual(candidates, []);
});

test('only filing types that announce a future date are candidates', () => {
  const candidates = selectCalendarCandidates([
    filing({ report_nm: '기업설명회(IR)개최(안내공시)' }),
    filing({ rcept_no: '20260901000002', report_nm: '주주총회소집결의' }),
    filing({ rcept_no: '20260901000003', report_nm: '현금ㆍ현물배당결정' }),
    filing({ rcept_no: '20260901000004', report_nm: '결산실적공시예고(안내공시)' }),
    // Everything else, however important to the disclosure feed.
    filing({ rcept_no: '20260901000005', report_nm: '분기보고서 (2026.06)' }),
    filing({ rcept_no: '20260901000006', report_nm: '주요사항보고서(유상증자결정)' }),
    filing({ rcept_no: '20260901000007', report_nm: '단일판매ㆍ공급계약체결' })
  ], CALENDAR_CODES);

  assert.deepEqual(candidates.map(c => c.rule),
    ['ir', 'shareholder_meeting', 'dividend_record', 'earnings']);
});

test('a malformed receipt number is not a candidate', () => {
  assert.deepEqual(selectCalendarCandidates([filing({ rcept_no: '123' })], CALENDAR_CODES), []);
  assert.deepEqual(selectCalendarCandidates([filing({ rcept_no: '' })], CALENDAR_CODES), []);
});

/* ----------------------------------- the date has to be in the document */

test('a date is taken only when it sits beside the label the filing uses', () => {
  const found = extractLabelledDate('<table><tr><th>개최일시</th><td>2026년 10월 15일 14시 00분</td></tr></table>', 'ir');
  assert.equal(found.date, '2026-10-15');
  assert.equal(found.label, '개최일시');
  assert.equal(found.time, '14:00');
});

test('the DART date forms are all read, and impossible dates are not', () => {
  assert.equal(extractLabelledDate('주주총회일 2027-03-20', 'shareholder_meeting').date, '2027-03-20');
  assert.equal(extractLabelledDate('주주총회일 2027.03.20', 'shareholder_meeting').date, '2027-03-20');
  assert.equal(extractLabelledDate('주주총회일 2027년 3월 20일', 'shareholder_meeting').date, '2027-03-20');
  assert.equal(extractLabelledDate('주주총회일 2027-02-31', 'shareholder_meeting'), null);
  assert.equal(extractLabelledDate('주주총회일 1899-01-01', 'shareholder_meeting'), null);
});

test('a date with no label is not used, however plausible it looks', () => {
  // The receipt date, a reporting period, a footnote: all dates, none of them
  // the announced event.
  assert.equal(extractLabelledDate('본 공시는 2026년 12월 1일에 제출되었습니다.', 'ir'), null);
  assert.equal(extractLabelledDate('2026년 10월 15일', 'ir'), null);
  assert.equal(extractLabelledDate('', 'ir'), null);
});

test('a label far away from a date is not treated as its label', () => {
  const far = '개최일시' + ' 미정입니다. 관련 참고사항은 아래와 같습니다. '.repeat(2) + '2026년 10월 15일';
  assert.equal(extractLabelledDate(far, 'ir'), null);
});

test('one filing type’s label does not read another type’s date', () => {
  // A dividend record date is not a briefing date, even in the same document.
  assert.equal(extractLabelledDate('배당기준일 2026년 12월 31일', 'ir'), null);
  assert.equal(extractLabelledDate('배당기준일 2026년 12월 31일', 'dividend_record').date, '2026-12-31');
});

test('a time is only taken when it is written beside the same label', () => {
  assert.equal(extractLabelledDate('개최일시 2026년 10월 15일', 'ir').time, null,
    'a date with no time stays a date');
  assert.equal(extractLabelledDate('개최일시 2026년 10월 15일. 접수는 09:00부터.', 'ir').time, null,
    'a time elsewhere in the document is not the event time');
});

/* --------------------------------------------- promotion, and refusal */

test('a candidate whose date cannot be read is not promoted', () => {
  const [candidate] = selectCalendarCandidates([filing()], CALENDAR_CODES);
  const result = buildCorporateEvent(candidate, '개최일시는 추후 공시 예정입니다.', { now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_LABELLED_DATE');
  assert.equal(result.event, undefined, 'nothing is written for an unreadable candidate');
});

test('a date that has already passed is history, not a calendar entry', () => {
  const [candidate] = selectCalendarCandidates([filing()], CALENDAR_CODES);
  const result = buildCorporateEvent(candidate, '개최일시 2026년 8월 1일', { now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'DATE_IN_PAST');
});

test('a promoted event carries the filing it came from and is ready to store', () => {
  const [candidate] = selectCalendarCandidates([filing()], CALENDAR_CODES);
  const { ok, event } = buildCorporateEvent(candidate, '개최일시 2026년 10월 15일 14시 00분', { now: NOW });
  assert.equal(ok, true);

  const stored = normalizeEvent(event);
  assert.equal(stored.eventDate, '2026-10-15');
  assert.equal(stored.eventTime, '14:00');
  assert.equal(stored.market, 'KR');
  assert.equal(stored.category, 'corporate_event');
  assert.equal(stored.companyStockCode, '005930');
  assert.equal(stored.companyName, '삼성전자');
  assert.equal(stored.sourceType, 'opendart');
  assert.match(stored.sourceUrl, /rcpNo=20260901000001/);
  // The Korean filing title is kept as filed, never translated.
  assert.equal(event.meta.reportName, '기업설명회(IR)개최(안내공시)');
  assert.equal(event.titleEn, 'Investor Relations Briefing', 'the English side uses our own category label');
});

/* ------------------------------------------------- identity is the filing */

test('the identity is the receipt number, so a moved date updates one event', () => {
  const [candidate] = selectCalendarCandidates([filing()], CALENDAR_CODES);
  const first = buildCorporateEvent(candidate, '개최일시 2026년 10월 15일', { now: NOW });
  const moved = buildCorporateEvent(candidate, '개최일시 2026년 10월 22일', { now: NOW });

  assert.equal(first.event.sourceEventId, 'dart:20260901000001');
  assert.equal(moved.event.sourceEventId, first.event.sourceEventId,
    'the announced date must not be part of the identity');
  assert.notEqual(moved.event.eventDate, first.event.eventDate);
  // And the identity carries no date at all.
  assert.doesNotMatch(first.event.sourceEventId, /2026-10/);
});

test('two filings from the same company are two events', () => {
  const candidates = selectCalendarCandidates([
    filing(),
    filing({ rcept_no: '20260901000009', report_nm: '주주총회소집결의' })
  ], CALENDAR_CODES);
  const ids = candidates.map(candidate =>
    buildCorporateEvent(candidate, '개최일시 2026년 10월 15일 주주총회일 2026년 10월 30일', { now: NOW })
  ).filter(result => result.ok).map(result => result.event.sourceEventId);
  assert.equal(new Set(ids).size, 2);
});

/* ------------------------------------------------------------ corrections */

test('a correction links to its original only when the document names it', () => {
  const [candidate] = selectCalendarCandidates([
    filing({ rcept_no: '20260910000001', report_nm: '[기재정정]기업설명회(IR)개최(안내공시)' })
  ], CALENDAR_CODES);
  assert.equal(candidate.isCorrection, true);

  const linked = buildCorporateEvent(candidate,
    '정정대상 공시 접수번호 20260901000001 개최일시 2026년 10월 22일', { now: NOW });
  assert.equal(linked.correctedRceptNo, '20260901000001');
  assert.equal(linked.event.meta.correctsRceptNo, '20260901000001');
});

test('a correction with no stated original is its own event, never merged by resemblance', () => {
  const [candidate] = selectCalendarCandidates([
    filing({ rcept_no: '20260910000002', report_nm: '[기재정정]기업설명회(IR)개최(안내공시)' })
  ], CALENDAR_CODES);

  // Same company, same filing type, a date one week from the original: every
  // similarity a merge heuristic would use, and still not evidence.
  const result = buildCorporateEvent(candidate, '개최일시 2026년 10월 22일', { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.correctedRceptNo, null);
  assert.equal(result.event.meta.correctsRceptNo, undefined);
  assert.equal(result.event.sourceEventId, 'dart:20260910000002', 'it keeps its own identity');
  assert.equal(result.event.meta.correction, true, 'but it is marked as a correction');
});

test('a receipt number is read only from a labelled reference', () => {
  assert.equal(extractCorrectedReceiptNo('정정대상 공시 접수번호 : 20260801000123'), '20260801000123');
  assert.equal(extractCorrectedReceiptNo('원공시 접수번호 20260801000123'), '20260801000123');
  // A bare fourteen-digit number is not a linkage claim.
  assert.equal(extractCorrectedReceiptNo('계약금액 20260801000123 원'), null);
  assert.equal(extractCorrectedReceiptNo(''), null);
});

/* ------------------------------------------------------- the rule table */

test('every rule names its own labels and both locale titles', () => {
  for (const rule of CALENDAR_FILING_RULES) {
    assert.ok(rule.labels.length, `${rule.key} must name the labels it reads`);
    assert.ok(rule.titleKo && rule.titleEn, `${rule.key} must be named in both locales`);
    assert.ok(['corporate_event', 'earnings'].includes(rule.category));
  }
  assert.deepEqual(CALENDAR_FILING_RULES.map(rule => rule.key),
    ['ir', 'earnings', 'shareholder_meeting', 'dividend_record']);
});

/* ------------------------- one filing, at most one event (a v1 invariant) */

test('a filing produces at most one calendar event', () => {
  // The identity is dart:<rceptNo> and nothing else, so one filing can only
  // ever own one row. A filing that announces two separate dates would need
  // dart:<rceptNo>:<kind> before it could carry both — and that is a change
  // to make deliberately, not something to discover from a duplicate.
  const filings = [
    filing({ report_nm: '기업설명회(IR)개최(안내공시)' }),
    filing({ rcept_no: '20260901000002', report_nm: '주주총회소집결의' }),
    filing({ rcept_no: '20260901000003', report_nm: '현금ㆍ현물배당결정' })
  ];
  const candidates = selectCalendarCandidates(filings, CALENDAR_CODES);
  assert.equal(candidates.length, 3);

  // A document that names several dates at once still yields one event.
  const crowded = '개최일시 2026년 10월 15일 주주총회일 2026년 10월 30일 배당기준일 2026년 12월 31일';
  const events = candidates
    .map(candidate => buildCorporateEvent(candidate, crowded, { now: NOW }))
    .filter(result => result.ok)
    .map(result => result.event);

  assert.equal(events.length, 3, 'three filings, three events');
  const ids = events.map(event => event.sourceEventId);
  assert.deepEqual(ids, ['dart:20260901000001', 'dart:20260901000002', 'dart:20260901000003']);
  assert.equal(new Set(ids).size, ids.length, 'one identity per filing');
  // And each identity is exactly the receipt number, with nothing appended.
  for (const id of ids) assert.match(id, /^dart:\d{14}$/);
});

test('one candidate yields one event and never a second for another date', () => {
  const [candidate] = selectCalendarCandidates([filing()], CALENDAR_CODES);
  const first = buildCorporateEvent(candidate, '개최일시 2026년 10월 15일', { now: NOW });
  const second = buildCorporateEvent(candidate, '개최일시 2026년 10월 15일 개최일시 2026년 11월 20일', { now: NOW });

  assert.equal(first.event.sourceEventId, second.event.sourceEventId);
  // The first labelled date wins; a second one does not become another event.
  assert.equal(second.event.eventDate, '2026-10-15');
});
