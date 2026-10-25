(function(root) {
  const kinds = ['all', 'economic', 'earnings', 'corporate', 'expiry', 'trading'];
  const categories = {
    economic: ['monetary_policy', 'inflation', 'employment'],
    earnings: ['earnings'], corporate: ['corporate_event'], expiry: ['derivatives_expiry'], trading: []
  };
  const copy = {
    ko: { heading: '오늘 이후 주요 일정', scope: '선택한 달 · 한국시간(KST) 기준', empty: '선택한 조건에 해당하는 오늘 이후 일정이 없습니다.', unavailable: '시장 이벤트를 불러오지 못했습니다. 휴장·거래시간 일정은 계속 표시됩니다.', more: n => `나머지 ${n}건 보기`, tbc: '시간 미정', allDay: '종일', changed: '일정 변경', holiday: '휴장', session: '특별 거래시간' },
    en: { heading: 'Upcoming Key Events', scope: 'Selected month · Korea Standard Time (KST)', empty: 'No upcoming events match these filters in the selected month.', unavailable: 'Market events are unavailable. Holidays and trading hours are still shown.', more: n => `Show ${n} more`, tbc: 'Time TBC', allDay: 'All day', changed: 'Rescheduled', holiday: 'Market holiday', session: 'Special trading hours' }
  };
  const kind = value => kinds.includes(value) ? value : 'all';
  const matches = (event, value) => kind(value) === 'all' || categories[kind(value)].includes(event.category);
  const showTrading = value => ['all', 'trading'].includes(kind(value));
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  // Read-only projection of the existing monthly payload. No extra requests,
  // invented times or client-clock-dependent dates. Cancelled dates stay in
  // day details but are never advertised as upcoming events.
  function agendaItems(data, { lang = 'ko', filter = 'ALL', eventKind = 'all' } = {}) {
    const text = copy[lang] || copy.ko;
    const ko = lang !== 'en';
    const prefix = `${data.year}-${String(data.month).padStart(2, '0')}-`;
    const wanted = filter === 'KRX' ? 'KR' : filter === 'NYSE' ? 'US' : null;
    const inWindow = date => typeof date === 'string' && date.startsWith(prefix) && date >= data.serverDate;
    const items = (data.events || []).filter(e => e.status !== 'cancelled' && inWindow(e.display?.date)
      && (!wanted || e.market === wanted) && matches(e, eventKind)).map(e => {
      const company = e.company && ((!ko && e.company.nameEn) || e.company.name || e.company.stockCode);
      const title = (ko ? e.title?.ko : e.title?.en) || e.title?.ko || e.title?.en || '';
      return { date: e.display.date, time: e.display.time || null, market: e.market === 'KR' ? 'KRX' : 'NYSE',
        title: company ? `${company} · ${title}` : title, changed: e.status === 'changed',
        high: e.importance === 'high', id: e.id || title };
    });
    if (showTrading(eventKind)) for (const day of data.days || []) {
      if (!inWindow(day.date) || day.isWeekend) continue;
      for (const [market, key] of [['KRX', 'krx'], ['NYSE', 'nyse']]) {
        if (filter !== 'ALL' && filter !== market) continue;
        const schedule = day[key];
        if (!schedule?.supported || (!schedule.holiday && !schedule.specialSession)) continue;
        const spec = schedule.specialSession;
        const title = schedule.holiday
          ? ((ko ? schedule.name?.ko : schedule.name?.en) || text.holiday)
          : ((ko ? spec.nameKo : spec.nameEn) || text.session);
        items.push({ date: day.date, time: null, market, title, trading: true,
          session: spec?.session || '', high: true, id: `${day.date}:${market}` });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.high) - Number(a.high)
      || (a.time || '').localeCompare(b.time || '') || a.id.localeCompare(b.id));
  }

  function renderAgenda(data, options = {}) {
    const lang = options.lang === 'en' ? 'en' : 'ko';
    const text = copy[lang];
    const items = agendaItems(data, options);
    const unavailable = data.eventsStatus === 'unavailable' && options.eventKind !== 'trading';
    const row = item => `<li><button type="button" class="calendar-agenda-item" data-agenda-date="${escape(item.date)}"><span class="calendar-agenda-date">${escape(item.date.slice(5).replace('-', '/'))}<small>${escape(item.trading ? (item.session ? text.session : text.allDay) : item.time ? `${item.time} KST` : text.tbc)}</small></span><span class="detail-market-badge ${item.market === 'KRX' ? 'krx' : 'nyse'}">${item.market}</span><span class="calendar-agenda-title">${escape(item.title)}${item.session ? `<small>${escape(item.session)}</small>` : ''}${item.changed ? `<small>${text.changed}</small>` : ''}</span></button></li>`;
    const list = rows => `<ul class="calendar-agenda-list">${rows.map(row).join('')}</ul>`;
    const content = items.length ? list(items.slice(0, 8)) + (items.length > 8 ? `<details class="calendar-agenda-more"><summary>${text.more(items.length - 8)}</summary>${list(items.slice(8))}</details>` : '') : (unavailable ? '' : `<p class="calendar-agenda-empty">${text.empty}</p>`);
    const notice = unavailable
      ? `<p class="calendar-events-notice" role="status">${text.unavailable}</p>` : '';
    return `<section class="calendar-agenda" aria-labelledby="calendar-agenda-heading"><h2 id="calendar-agenda-heading">${text.heading}</h2><p class="calendar-agenda-scope">${text.scope}</p>${notice}${content}</section>`;
  }
  root.CALENDAR_VIEW = { kinds, kind, matches, showTrading, agendaItems, renderAgenda };
})(typeof window !== 'undefined' ? window : globalThis);
