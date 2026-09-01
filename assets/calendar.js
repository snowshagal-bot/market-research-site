(() => {
  const lang = document.documentElement.dataset.siteLang === 'en' ? 'en' : 'ko';
  const ko = lang === 'ko';

  const copy = ko ? {
    title: 'MARKET CALENDAR',
    subtitle: 'KRX · NYSE 거래 일정',
    todayBtn: '이번 달',
    prevMonth: '이전 달',
    nextMonth: '다음 달',
    filterAll: '전체 (ALL)',
    filterKrx: '한국 (KRX)',
    filterNyse: '미국 (NYSE)',
    legendKrx: 'KRX 휴장',
    legendNyse: 'NYSE 휴장',
    legendJoint: '양 시장 동시 휴장',
    legendSpecial: '특별 거래시간',
    weekdays: ['일', '월', '화', '수', '목', '금', '토'],
    monthFormat: (y, m) => `${y}년 ${m}월`,
    upcomingHeading: '다가오는 거래 일정',
    todayTag: '오늘',
    noEventsDay: '해당 일자는 정상 거래일입니다.',
    jointClosureDesc: '한국(KRX) 및 미국(NYSE) 양 시장 동시 휴장',
    krxTradingDay: 'KRX 정상 거래',
    nyseTradingDay: 'NYSE 정상 거래',
    weekendNotice: '주말 (휴장)',
    errorTitle: '캘린더를 불러오지 못했습니다.',
    errorDesc: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
    retryBtn: '다시 시도',
    deferredNotice: '2027년 및 이후 일정은 공식 확정 후 순차 업데이트됩니다.'
  } : {
    title: 'MARKET CALENDAR',
    subtitle: 'KRX · NYSE Trading Schedule',
    todayBtn: 'Current Month',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    filterAll: 'ALL',
    filterKrx: 'KRX',
    filterNyse: 'NYSE',
    legendKrx: 'KRX Holiday',
    legendNyse: 'NYSE Holiday',
    legendJoint: 'Joint Holiday',
    legendSpecial: 'Special Trading Session',
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthFormat: (y, m) => {
      const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return `${names[m - 1]} ${y}`;
    },
    upcomingHeading: 'Upcoming Trading Schedule',
    todayTag: 'Today',
    noEventsDay: 'Normal trading day for both markets.',
    jointClosureDesc: 'Joint full-day holiday for both KRX and NYSE',
    krxTradingDay: 'KRX Regular Trading',
    nyseTradingDay: 'NYSE Regular Trading',
    weekendNotice: 'Weekend (Closed)',
    errorTitle: 'Could not load market calendar.',
    errorDesc: 'A temporary error occurred. Please try again in a moment.',
    retryBtn: 'Try again',
    deferredNotice: 'Schedules for 2027 and beyond will be updated once officially confirmed.'
  };

  const state = {
    year: 2026,
    month: 9,
    filter: 'ALL', // 'ALL' | 'KRX' | 'NYSE'
    selectedDate: null,
    serverDate: null,
    calendarData: null,
    loading: false
  };

  const cache = new Map();

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseUrlState() {
    const params = new URLSearchParams(window.location.search);
    const y = Number(params.get('year'));
    const m = Number(params.get('month'));
    const market = params.get('market');

    if (Number.isInteger(y) && y >= 2026 && y <= 2027) {
      state.year = y;
    }
    if (Number.isInteger(m) && m >= 1 && m <= 12) {
      state.month = m;
    }
    if (['ALL', 'KRX', 'NYSE'].includes(market?.toUpperCase())) {
      state.filter = market.toUpperCase();
    }
  }

  function updateUrlState(replace = false) {
    const url = new URL(window.location.href);
    url.searchParams.set('year', String(state.year));
    url.searchParams.set('month', String(state.month));
    if (state.filter !== 'ALL') {
      url.searchParams.set('market', state.filter);
    } else {
      url.searchParams.delete('market');
    }

    if (replace) {
      window.history.replaceState({}, '', url.toString());
    } else {
      window.history.pushState({}, '', url.toString());
    }
  }

  async function fetchCalendar(year, month) {
    const key = `${year}-${month}`;
    if (cache.has(key)) return cache.get(key);

    const res = await fetch(`/api/calendar?year=${year}&month=${month}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cache.set(key, data);
    return data;
  }

  async function loadData() {
    const gridMount = document.getElementById('calendar-grid-mount');
    const monthLabel = document.getElementById('calendar-month-label');
    const upcomingMount = document.getElementById('calendar-upcoming-mount');

    state.loading = true;
    if (monthLabel) {
      monthLabel.textContent = copy.monthFormat(state.year, state.month);
    }

    try {
      const data = await fetchCalendar(state.year, state.month);
      state.calendarData = data;
      if (data.serverDate) {
        state.serverDate = data.serverDate;
      }

      renderCalendarGrid(data);
      renderUpcomingEvents(data.upcoming || []);
    } catch (err) {
      if (gridMount) {
        gridMount.innerHTML = `
          <div class="calendar-detail-card" style="text-align:center;padding:40px 20px;">
            <h3>${copy.errorTitle}</h3>
            <p style="color:var(--muted);">${copy.errorDesc}</p>
            <button type="button" class="calendar-today-btn" id="calendar-retry-btn" style="margin-top:12px;">${copy.retryBtn}</button>
          </div>
        `;
        document.getElementById('calendar-retry-btn')?.addEventListener('click', loadData);
      }
    } finally {
      state.loading = false;
    }
  }

  function renderCalendarGrid(data) {
    const gridMount = document.getElementById('calendar-grid-mount');
    if (!gridMount) return;

    if (!data.supported) {
      gridMount.innerHTML = `
        <div class="calendar-detail-card" style="text-align:center;padding:40px 20px;">
          <h3>${escapeHtml(data.message || copy.deferredNotice)}</h3>
          <p style="color:var(--muted);">${copy.deferredNotice}</p>
        </div>
      `;
      return;
    }

    const days = data.days || [];
    if (!days.length) return;

    const firstDayOfWeek = days[0].dayOfWeek; // 0 = Sun
    const weekdaysHtml = copy.weekdays.map((w, idx) => `
      <div class="calendar-weekday-cell ${idx === 0 || idx === 6 ? 'weekend' : ''}">${escapeHtml(w)}</div>
    `).join('');

    let cellsHtml = '';
    for (let i = 0; i < firstDayOfWeek; i++) {
      cellsHtml += `<div class="calendar-day-cell empty" aria-hidden="true"></div>`;
    }

    for (const day of days) {
      const isToday = state.serverDate === day.date;
      const isSelected = state.selectedDate === day.date;
      const isWeekend = day.isWeekend;

      let tagsHtml = '';

      if (!isWeekend) {
        if (day.isJointClosure && state.filter === 'ALL') {
          tagsHtml += `<span class="cal-tag joint">${ko ? '동시 휴장' : 'Joint Holiday'}</span>`;
        } else {
          if (day.krx.holiday && (state.filter === 'ALL' || state.filter === 'KRX')) {
            const label = day.krx.name ? (ko ? day.krx.name.ko : day.krx.name.en) : (ko ? 'KRX 휴장' : 'KRX Holiday');
            tagsHtml += `<span class="cal-tag krx" title="${escapeHtml(label)}">KRX ${escapeHtml(label)}</span>`;
          }
          if (day.nyse.holiday && (state.filter === 'ALL' || state.filter === 'NYSE')) {
            const label = day.nyse.name ? (ko ? day.nyse.name.ko : day.nyse.name.en) : (ko ? 'NYSE 휴장' : 'NYSE Holiday');
            tagsHtml += `<span class="cal-tag nyse" title="${escapeHtml(label)}">NYSE ${escapeHtml(label)}</span>`;
          }
        }

        if (day.krx.specialSession && (state.filter === 'ALL' || state.filter === 'KRX')) {
          const spec = day.krx.specialSession;
          const label = ko ? spec.nameKo : spec.nameEn;
          tagsHtml += `<span class="cal-tag special" title="${escapeHtml(label)}">KRX ${escapeHtml(spec.session)}</span>`;
        }
        if (day.nyse.specialSession && (state.filter === 'ALL' || state.filter === 'NYSE')) {
          const spec = day.nyse.specialSession;
          const label = ko ? spec.nameKo : spec.nameEn;
          tagsHtml += `<span class="cal-tag special" title="${escapeHtml(label)}">NYSE ${escapeHtml(spec.session)}</span>`;
        }
      }

      cellsHtml += `
        <div class="calendar-day-cell ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${day.date}" tabindex="0" role="button" aria-label="${day.date}">
          <div class="day-header">
            <span class="day-number">${day.day}</span>
            ${isToday ? `<span class="day-today-tag">${copy.todayTag}</span>` : ''}
          </div>
          <div class="day-events">
            ${tagsHtml}
          </div>
        </div>
      `;
    }

    gridMount.innerHTML = `
      <div class="calendar-card">
        <div class="calendar-weekdays-row">
          ${weekdaysHtml}
        </div>
        <div class="calendar-days-grid">
          ${cellsHtml}
        </div>
      </div>
      <div id="calendar-day-detail-mount"></div>
    `;

    if (state.selectedDate) {
      renderDayDetail(state.selectedDate);
    }
  }

  function renderDayDetail(dateStr) {
    const mount = document.getElementById('calendar-day-detail-mount');
    if (!mount || !state.calendarData || !state.calendarData.days) return;

    const day = state.calendarData.days.find(d => d.date === dateStr);
    if (!day) {
      mount.innerHTML = '';
      return;
    }

    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = copy.weekdays[dateObj.getUTCDay()];
    const dateDisplay = ko ? `${y}년 ${m}월 ${d}일 (${dayOfWeek})` : `${dateObj.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d}, ${y} (${dayOfWeek})`;

    let itemsHtml = '';

    if (day.isWeekend) {
      itemsHtml += `<div class="detail-item-row"><span class="detail-market-badge krx">CLOSED</span><span>${copy.weekendNotice}</span></div>`;
    } else if (day.isJointClosure) {
      const krxName = day.krx.name ? (ko ? day.krx.name.ko : day.krx.name.en) : '';
      const nyseName = day.nyse.name ? (ko ? day.nyse.name.ko : day.nyse.name.en) : '';
      itemsHtml += `
        <div class="detail-item-row">
          <span class="detail-market-badge joint">JOINT CLOSURE</span>
          <div>
            <strong>${copy.jointClosureDesc}</strong>
            <p style="margin:2px 0 0;font-size:12px;color:var(--text-2);">KRX: ${escapeHtml(krxName)} · NYSE: ${escapeHtml(nyseName)}</p>
          </div>
        </div>
      `;
    } else {
      // KRX
      if (day.krx.holiday) {
        const name = day.krx.name ? (ko ? day.krx.name.ko : day.krx.name.en) : (ko ? '휴장일' : 'Holiday');
        itemsHtml += `<div class="detail-item-row"><span class="detail-market-badge krx">KRX HOLIDAY</span><strong>${escapeHtml(name)}</strong></div>`;
      } else if (day.krx.specialSession) {
        const spec = day.krx.specialSession;
        const name = ko ? spec.nameKo : spec.nameEn;
        itemsHtml += `<div class="detail-item-row"><span class="detail-market-badge special">KRX SPECIAL</span><div><strong>${escapeHtml(name)}</strong><span style="font-size:12px;color:var(--text-2);margin-left:6px;">(${escapeHtml(spec.session)})</span></div></div>`;
      } else {
        itemsHtml += `<div class="detail-item-row"><span class="detail-market-badge" style="background:var(--panel-2);color:var(--text-2);">KRX</span><span>${copy.krxTradingDay} (09:00 - 15:30)</span></div>`;
      }

      // NYSE
      if (day.nyse.holiday) {
        const name = day.nyse.name ? (ko ? day.nyse.name.ko : day.nyse.name.en) : (ko ? '휴장일' : 'Holiday');
        itemsHtml += `<div class="detail-item-row"><span class="detail-market-badge nyse">NYSE HOLIDAY</span><strong>${escapeHtml(name)}</strong></div>`;
      } else if (day.nyse.specialSession) {
        const spec = day.nyse.specialSession;
        const name = ko ? spec.nameKo : spec.nameEn;
        itemsHtml += `<div class="detail-item-row"><span class="detail-market-badge special">NYSE SPECIAL</span><div><strong>${escapeHtml(name)}</strong><span style="font-size:12px;color:var(--text-2);margin-left:6px;">(${escapeHtml(spec.session)})</span></div></div>`;
      } else {
        itemsHtml += `<div class="detail-item-row"><span class="detail-market-badge" style="background:var(--panel-2);color:var(--text-2);">NYSE</span><span>${copy.nyseTradingDay} (09:30 - 16:00 ET)</span></div>`;
      }
    }

    mount.innerHTML = `
      <div class="calendar-detail-card">
        <div class="detail-card-head">
          <h3>${dateDisplay}</h3>
          <button type="button" class="calendar-today-btn" id="close-detail-btn">✕</button>
        </div>
        <div class="detail-items-list">
          ${itemsHtml}
        </div>
      </div>
    `;

    document.getElementById('close-detail-btn')?.addEventListener('click', () => {
      state.selectedDate = null;
      document.querySelectorAll('.calendar-day-cell.selected').forEach(el => el.classList.remove('selected'));
      mount.innerHTML = '';
    });
  }

  function renderUpcomingEvents(events) {
    const upcomingMount = document.getElementById('calendar-upcoming-mount');
    if (!upcomingMount) return;

    if (!events.length) {
      upcomingMount.innerHTML = '';
      return;
    }

    const filtered = events.filter(event => {
      if (state.filter === 'ALL') return true;
      if (state.filter === 'KRX') return event.krx.holiday || event.krx.specialSession;
      if (state.filter === 'NYSE') return event.nyse.holiday || event.nyse.specialSession;
      return true;
    });

    const cardsHtml = filtered.map(ev => {
      const [y, m, d] = ev.date.split('-').map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      const dayOfWeek = copy.weekdays[dateObj.getUTCDay()];
      const dateDisplay = ko ? `${y}년 ${m}월 ${d}일 (${dayOfWeek})` : `${dateObj.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d}, ${y} (${dayOfWeek})`;

      let eventRows = '';

      if (ev.isJointClosure) {
        eventRows += `<div class="detail-item-row"><span class="detail-market-badge joint">JOINT</span><strong>${copy.jointClosureDesc}</strong></div>`;
      } else {
        if (ev.krx.holiday && (state.filter === 'ALL' || state.filter === 'KRX')) {
          const name = ev.krx.name ? (ko ? ev.krx.name.ko : ev.krx.name.en) : (ko ? 'KRX 휴장' : 'KRX Holiday');
          eventRows += `<div class="detail-item-row"><span class="detail-market-badge krx">KRX</span><strong>${escapeHtml(name)}</strong></div>`;
        }
        if (ev.krx.specialSession && (state.filter === 'ALL' || state.filter === 'KRX')) {
          const spec = ev.krx.specialSession;
          const name = ko ? spec.nameKo : spec.nameEn;
          eventRows += `<div class="detail-item-row"><span class="detail-market-badge special">KRX</span><span>${escapeHtml(name)} (${escapeHtml(spec.session)})</span></div>`;
        }
        if (ev.nyse.holiday && (state.filter === 'ALL' || state.filter === 'NYSE')) {
          const name = ev.nyse.name ? (ko ? ev.nyse.name.ko : ev.nyse.name.en) : (ko ? 'NYSE 휴장' : 'NYSE Holiday');
          eventRows += `<div class="detail-item-row"><span class="detail-market-badge nyse">NYSE</span><strong>${escapeHtml(name)}</strong></div>`;
        }
        if (ev.nyse.specialSession && (state.filter === 'ALL' || state.filter === 'NYSE')) {
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

    upcomingMount.innerHTML = `
      <section class="calendar-upcoming-section">
        <h2>${copy.upcomingHeading}</h2>
        <div class="upcoming-events-grid">
          ${cardsHtml}
        </div>
      </section>
    `;
  }

  function bindEvents() {
    document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
      let m = state.month - 1;
      let y = state.year;
      if (m < 1) { m = 12; y--; }
      state.year = y;
      state.month = m;
      state.selectedDate = null;
      updateUrlState();
      loadData();
    });

    document.getElementById('cal-next-btn')?.addEventListener('click', () => {
      let m = state.month + 1;
      let y = state.year;
      if (m > 12) { m = 1; y++; }
      state.year = y;
      state.month = m;
      state.selectedDate = null;
      updateUrlState();
      loadData();
    });

    document.getElementById('cal-today-btn')?.addEventListener('click', () => {
      if (state.serverDate) {
        const [y, m] = state.serverDate.split('-').map(Number);
        state.year = y;
        state.month = m;
      } else {
        state.year = 2026;
        state.month = 9;
      }
      state.selectedDate = null;
      updateUrlState();
      loadData();
    });

    // Market filters
    document.querySelectorAll('.calendar-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        if (!filter) return;
        state.filter = filter;
        document.querySelectorAll('.calendar-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
        updateUrlState();
        if (state.calendarData) {
          renderCalendarGrid(state.calendarData);
          renderUpcomingEvents(state.calendarData.upcoming || []);
        }
      });
    });

    // Day cell click
    const gridMount = document.getElementById('calendar-grid-mount');
    gridMount?.addEventListener('click', (event) => {
      const cell = event.target.closest('.calendar-day-cell:not(.empty)');
      if (!cell) return;
      const date = cell.dataset.date;
      if (!date) return;

      state.selectedDate = (state.selectedDate === date) ? null : date;
      document.querySelectorAll('.calendar-day-cell').forEach(c => c.classList.toggle('selected', c.dataset.date === state.selectedDate));
      if (state.selectedDate) {
        renderDayDetail(state.selectedDate);
      } else {
        const detailMount = document.getElementById('calendar-day-detail-mount');
        if (detailMount) detailMount.innerHTML = '';
      }
    });

    window.addEventListener('popstate', () => {
      parseUrlState();
      loadData();
    });
  }

  function init() {
    parseUrlState();
    // Update active filter button
    document.querySelectorAll('.calendar-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === state.filter);
    });
    bindEvents();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
