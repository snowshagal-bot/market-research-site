(() => {
  const $ = (id) => document.getElementById(id);
  const keyInput = $('analytics-admin-key');
  const loadButton = $('analytics-load');
  const dashboard = $('analytics-dashboard');
  const status = $('analytics-status');
  const rangeButtons = [...document.querySelectorAll('[data-range]')];
  let selectedRange = 7;
  let loading = false;

  function formatNumber(value) {
    return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(Number(value || 0));
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Math.round(Number(value || 0) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}분 ${remainder}초` : `${remainder}초`;
  }

  function formatPercent(value) {
    return `${formatNumber(value)}%`;
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }

  function clearList(list) {
    while (list.firstChild) list.removeChild(list.firstChild);
  }

  function displayCountry(label) {
    const value = String(label || '알 수 없음');
    if (!/^[A-Z]{2}$/i.test(value)) return value;
    try { return new Intl.DisplayNames(['ko'], { type: 'region' }).of(value.toUpperCase()) || value; }
    catch (_) { return value; }
  }

  function renderRanking(id, items, mapLabel = (value) => value) {
    const list = $(id);
    clearList(list);
    if (!items?.length) {
      const empty = document.createElement('li');
      empty.className = 'ranking-empty';
      empty.textContent = '표시할 데이터가 없습니다.';
      list.appendChild(empty);
      return;
    }
    items.forEach((item, index) => {
      const row = document.createElement('li');
      const number = document.createElement('span');
      const label = document.createElement('span');
      const value = document.createElement('span');
      const views = document.createElement('strong');
      const visits = document.createElement('small');
      number.className = 'rank-number';
      label.className = 'rank-label';
      value.className = 'rank-value';
      number.textContent = String(index + 1).padStart(2, '0');
      label.textContent = mapLabel(item.label);
      label.title = mapLabel(item.label);
      views.textContent = formatNumber(item.pageViews);
      visits.textContent = `${formatNumber(item.visits)} visits`;
      value.append(views, visits);
      row.append(number, label, value);
      list.appendChild(row);
    });
  }

  function renderTrend(items) {
    const chart = $('trend-chart');
    clearList(chart);
    const max = Math.max(1, ...items.flatMap((item) => [Number(item.visits || 0), Number(item.pageViews || 0)]));
    items.forEach((item) => {
      const column = document.createElement('div');
      const bars = document.createElement('div');
      const visits = document.createElement('i');
      const views = document.createElement('i');
      const label = document.createElement('small');
      column.className = 'trend-column';
      bars.className = 'trend-bars';
      visits.className = 'trend-bar';
      views.className = 'trend-bar views';
      visits.style.height = `${Math.max(2, Number(item.visits || 0) / max * 100)}%`;
      views.style.height = `${Math.max(2, Number(item.pageViews || 0) / max * 100)}%`;
      visits.title = `${item.date} · Visits ${formatNumber(item.visits)}`;
      views.title = `${item.date} · Page views ${formatNumber(item.pageViews)}`;
      label.textContent = item.date.slice(5).replace('-', '.');
      bars.append(visits, views);
      column.append(bars, label);
      chart.appendChild(column);
    });
  }

  function render(data) {
    const allTraffic = data.allTrafficTotals || data.totals;
    $('metric-visits').textContent = formatNumber(data.totals.visits);
    $('metric-pageviews').textContent = formatNumber(data.totals.pageViews);
    $('metric-depth').textContent = data.totals.visits ? formatNumber(data.totals.pageViews / data.totals.visits) : '0';
    $('metric-visits-all').textContent = formatNumber(allTraffic.visits);
    $('metric-pageviews-all').textContent = formatNumber(allTraffic.pageViews);
    $('metric-depth-all').textContent = allTraffic.visits ? formatNumber(allTraffic.pageViews / allTraffic.visits) : '0';
    $('analytics-period').textContent = `${data.range.from} — ${data.range.to} · ${data.range.timezone} 기준`;
    $('analytics-empty').hidden = !data.empty;
    $('trend-chart').hidden = data.empty;
    renderTrend(data.trend || []);
    renderRanking('top-pages', data.topPages);
    renderRanking('top-referers', data.referrers);
    renderRanking('top-countries', data.countries, displayCountry);
    renderRanking('top-devices', data.devices);
    renderRanking('top-browsers', data.browsers);
    renderRanking('top-os', data.operatingSystems);
    $('analytics-source').textContent = `Cloudflare Web Analytics · Bots excluded: Exclude Bots = ${data.source.excludeBots || 'Yes'} · All traffic 비교 · ${data.source.dataset} · ${data.generatedAt}`;
    dashboard.hidden = false;
  }

  function appendCell(row, value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function renderEngagementTable(id, items, country = false) {
    const body = $(id);
    if (!body) return;
    clearList(body);
    if (!items?.length) {
      const row = document.createElement('tr');
      const cell = appendCell(row, '표시할 데이터가 없습니다.', 'table-empty');
      cell.setAttribute('colspan', country ? '5' : '8');
      body.appendChild(row);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('tr');
      if (country) {
        appendCell(row, `${displayCountry(item.country)} (${item.country})`);
      } else {
        const page = appendCell(row, '', 'page-cell');
        const title = document.createElement('strong');
        const path = document.createElement('small');
        title.textContent = item.title || item.path;
        path.textContent = item.path;
        page.append(title, path);
        appendCell(row, String(item.lang || '').toUpperCase());
      }
      appendCell(row, formatNumber(item.sessions));
      appendCell(row, formatDuration(item.medianActiveMs));
      appendCell(row, formatDuration(item.avgActiveMs));
      appendCell(row, formatPercent(item.avgMaxScroll));
      if (!country) {
        appendCell(row, formatPercent(item.over1mRate));
        appendCell(row, formatPercent(item.over90ScrollRate));
      }
      body.appendChild(row);
    });
  }

  function renderEngagement(data) {
    if (!data?.overall) throw new Error('읽기 행동 통계 응답 형식이 올바르지 않습니다.');
    const overall = data.overall;
    $('engagement-sessions').textContent = formatNumber(overall.sessions);
    $('engagement-average').textContent = formatDuration(overall.avgActiveMs);
    $('engagement-median').textContent = formatDuration(overall.medianActiveMs);
    $('engagement-scroll').textContent = formatPercent(overall.avgMaxScroll);
    $('engagement-30s').textContent = formatPercent(overall.over30sRate);
    $('engagement-1m').textContent = formatPercent(overall.over1mRate);
    $('engagement-3m').textContent = formatPercent(overall.over3mRate);
    $('engagement-90').textContent = formatPercent(overall.over90ScrollRate);
    $('engagement-empty').hidden = !data.empty;
    renderEngagementTable('engagement-pages', data.pages, false);
    renderEngagementTable('engagement-countries', data.countries, true);
    $('engagement-source').textContent = `Snowshagal Engagement · Reading sessions · ${data.range.from} — ${data.range.to} ${data.range.timezone} · ${data.generatedAt}`;
    dashboard.hidden = false;
  }

  async function responseData(response, label) {
    const responseText = await response.text();
    let data;
    try { data = JSON.parse(responseText); }
    catch (_) {
      const contentType = response.headers.get('content-type') || 'unknown content-type';
      const cfRay = response.headers.get('cf-ray') || 'unknown';
      data = { message: `${label} API 응답 오류 · HTTP ${response.status} · ${contentType} · CF-Ray ${cfRay}` };
    }
    if (!response.ok) {
      const stage = data.stage && data.stage !== 'unknown' ? ` · 단계 ${data.stage}` : '';
      throw new Error(`${data.message || `${label} 데이터를 불러오지 못했습니다.`}${stage}`);
    }
    return data;
  }

  async function loadAnalytics(range = selectedRange) {
    const key = keyInput.value.trim();
    if (!key) {
      setStatus('관리자 키를 입력해 주세요.', true);
      keyInput.focus();
      return;
    }
    if (loading) return;
    loading = true;
    selectedRange = Number(range);
    loadButton.disabled = true;
    rangeButtons.forEach((button) => { button.disabled = true; });
    setStatus('방문 및 읽기 행동 통계를 불러오는 중입니다.');
    if ($('engagement-status')) {
      $('engagement-status').textContent = '읽기 행동 통계를 불러오는 중입니다.';
      $('engagement-status').classList.toggle('error', false);
    }
    try {
      sessionStorage.setItem('mrs-admin-key', key);
      const options = { headers: { 'X-Admin-Key': key }, cache: 'no-store' };
      const [webResult, engagementResult] = await Promise.allSettled([
        fetch(`/api/analytics?range=${selectedRange}`, options).then((response) => responseData(response, '방문 통계')),
        fetch(`/api/engagement-stats?days=${selectedRange}`, options).then((response) => responseData(response, '읽기 행동 통계'))
      ]);
      if (webResult.status === 'fulfilled') render(webResult.value);
      let engagementError = engagementResult.status === 'rejected' ? engagementResult.reason : null;
      if (engagementResult.status === 'fulfilled') {
        try {
          renderEngagement(engagementResult.value);
          if ($('engagement-status')) $('engagement-status').textContent = engagementResult.value.empty ? '정상 조회됐으며 아직 수집된 읽기 세션이 없습니다.' : '읽기 행동 통계를 불러왔습니다.';
        } catch (error) { engagementError = error; }
      }
      if (engagementError && $('engagement-status')) {
        $('engagement-status').textContent = engagementError.message || '읽기 행동 통계를 불러오지 못했습니다.';
        $('engagement-status').classList.toggle('error', true);
      }
      if (webResult.status === 'rejected' && engagementError) throw webResult.reason;
      rangeButtons.forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.range) === selectedRange)));
      if (webResult.status === 'fulfilled') {
        setStatus(webResult.value.empty ? '통계 조회가 완료됐습니다. 방문 데이터는 아직 없습니다.' : '통계 조회가 완료됐습니다.');
      } else {
        setStatus(`읽기 행동 통계는 조회됐지만 방문 통계 조회에 실패했습니다. ${webResult.reason?.message || ''}`, true);
      }
    } catch (error) {
      setStatus(error.message || '통계 데이터를 불러오지 못했습니다.', true);
    } finally {
      loading = false;
      loadButton.disabled = false;
      rangeButtons.forEach((button) => { button.disabled = false; });
    }
  }

  loadButton.addEventListener('click', () => loadAnalytics(selectedRange));
  keyInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadAnalytics(selectedRange); });
  keyInput.addEventListener('change', () => { try { sessionStorage.setItem('mrs-admin-key', keyInput.value.trim()); } catch (_) {} });
  rangeButtons.forEach((button) => button.addEventListener('click', () => loadAnalytics(Number(button.dataset.range))));

  const themeButton = document.querySelector('[data-theme-toggle]');
  themeButton?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? '' : 'dark';
    try { localStorage.setItem('site-theme', dark ? 'light' : 'dark'); } catch (_) {}
  });

  try { keyInput.value = sessionStorage.getItem('mrs-admin-key') || ''; } catch (_) {}
  window.__adminAnalyticsTest = { formatNumber, formatDuration, formatPercent, displayCountry, render, renderEngagement, loadAnalytics };
})();
