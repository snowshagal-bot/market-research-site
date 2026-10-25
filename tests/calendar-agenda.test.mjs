import assert from 'node:assert/strict';
import test from 'node:test';
import '../assets/calendar-view.js';
import { buildInitialHtml } from '../functions/_initial-html.js';
import { seededDatabase, SEED_NOW } from './helpers/initial-html-fixtures.mjs';

const view = globalThis.CALENDAR_VIEW;
const event = (id, date, overrides = {}) => ({
  id, market: 'US', category: 'inflation', title: { ko: '미국 물가', en: 'US Inflation' },
  display: { date, time: '21:30', timezone: 'Asia/Seoul' }, importance: 'normal', status: 'scheduled', ...overrides
});
const payload = events => ({ year: 2026, month: 10, serverDate: '2026-10-25', eventsStatus: 'ok', events, days: [] });

test('upcoming means the server Seoul date onward inside the selected month, excluding cancellations', () => {
  const events = [event('old', '2026-10-24'), event('today', '2026-10-25'), event('future', '2026-10-29'),
    event('next-month', '2026-11-01'), event('cancelled', '2026-10-30', { status: 'cancelled' })];
  assert.deepEqual(view.agendaItems(payload(events)).map(e => e.id), ['today', 'future']);
});

test('market and kind filters compose without mixing economic and company events', () => {
  const events = [event('cpi', '2026-10-29'), event('earnings', '2026-10-29', { market: 'KR', category: 'earnings' }),
    event('ir', '2026-10-29', { market: 'KR', category: 'corporate_event' }), event('expiry', '2026-10-29', { category: 'derivatives_expiry' })];
  for (const [eventKind, expected] of [['economic', 'cpi'], ['earnings', 'earnings'], ['corporate', 'ir'], ['expiry', 'expiry']]) {
    assert.deepEqual(view.agendaItems(payload(events), { eventKind }).map(e => e.id), [expected]);
  }
  assert.deepEqual(view.agendaItems(payload(events), { eventKind: 'economic', filter: 'KRX' }), []);
  assert.equal(view.kind('untrusted'), 'all');
});

test('upcoming uses converted display dates, so US releases crossing midnight appear on the Seoul day', () => {
  const data = payload([event('fomc', '2026-10-29', {
    date: '2026-10-28', source: { date: '2026-10-28', time: '14:00', timezone: 'America/New_York' },
    display: { date: '2026-10-29', time: '03:00', timezone: 'Asia/Seoul' }
  })]);
  assert.match(view.renderAgenda(data, { lang: 'en' }), /10\/29/);
  assert.match(view.renderAgenda(data, { lang: 'en' }), /03:00 KST/);
  assert.doesNotMatch(view.renderAgenda(data, { lang: 'en' }), /10\/28/);
});

test('holiday and special-session rows respect exchange filters and hide under economic filters', () => {
  const data = { ...payload([]), days: [{ date: '2026-10-26', isWeekend: false,
    krx: { supported: true, holiday: true, name: { ko: '휴장', en: 'Holiday' } },
    nyse: { supported: true, specialSession: { nameKo: '조기 폐장', nameEn: 'Early Close', session: '09:30 - 13:00 ET' } }
  }] };
  assert.equal(view.agendaItems(data).length, 2);
  assert.equal(view.agendaItems(data, { filter: 'NYSE' })[0].title, '조기 폐장');
  assert.deepEqual(view.agendaItems(data, { eventKind: 'economic' }), []);
  assert.equal(view.agendaItems(data, { lang: 'en', eventKind: 'trading' })[1].title, 'Early Close');
});

test('important releases lead other events on the same date, with deterministic ordering', () => {
  const data = payload([event('ir', '2026-10-29', { display: { date: '2026-10-29', time: null } }),
    event('fomc', '2026-10-29', { importance: 'high' }), event('sooner', '2026-10-28')]);
  assert.deepEqual(view.agendaItems(data).map(e => e.id), ['sooner', 'fomc', 'ir']);
});

test('long lists keep all events reachable with an explicit remaining count', () => {
  const html = view.renderAgenda(payload(Array.from({ length: 11 }, (_, i) => event(`item${i}`, '2026-10-29'))), { lang: 'en' });
  assert.match(html, /<details/);
  assert.match(html, /Show 3 more/);
  assert.equal((html.match(/data-agenda-date=/g) || []).length, 11);
});

test('company names and rescheduled states are localized and all data is escaped', () => {
  const data = payload([event('x', '2026-10-29', { status: 'changed', company: { name: '삼성전자', nameEn: 'Samsung & Co <test>' },
    title: { ko: '기업설명회', en: 'IR <script>' }, display: { date: '2026-10-29', time: null } })]);
  const html = view.renderAgenda(data, { lang: 'en' });
  assert.match(html, /Samsung &amp; Co &lt;test&gt; · IR &lt;script&gt;/);
  assert.match(html, /Rescheduled/);
  assert.match(html, /Time TBC/);
  assert.doesNotMatch(html, /삼성전자|<script>/);
  assert.match(view.renderAgenda(data, { lang: 'ko' }), /삼성전자/);
});

test('an outage is distinguishable from an empty month and does not claim missing events are absent', () => {
  const html = view.renderAgenda({ ...payload([]), eventsStatus: 'unavailable' }, { lang: 'en' });
  assert.match(html, /Market events are unavailable/);
  assert.doesNotMatch(html, /No upcoming events match/);
  assert.match(view.renderAgenda(payload([]), { lang: 'ko' }), /해당하는 오늘 이후 일정이 없습니다/);
});

test('server initial HTML uses the same agenda and category selection as the browser helper', async () => {
  const db = await seededDatabase();
  try {
    const result = await buildInitialHtml(new URL('https://snowshagal.com/en/calendar/?year=2026&month=9&kind=economic'), { COMMENTS_DB: db }, { now: SEED_NOW });
    const agenda = result.edits.find(e => e.id === 'calendar-agenda-mount').html;
    assert.match(agenda, /Upcoming Key Events/);
    assert.match(agenda, /FOMC/);
    assert.doesNotMatch(agenda, /Options Expiration/);
    assert.deepEqual(result.edits.find(e => e.id === 'calendar-kind-economic').attrs, { selected: '' });
    assert.equal(result.edits.find(e => e.id === 'calendar-upcoming-mount').html, '');
  } finally { db.close(); }
});
