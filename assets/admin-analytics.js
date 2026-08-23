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
    setStatus('Cloudflare Web Analytics 데이터를 불러오는 중입니다.');
    try {
      sessionStorage.setItem('mrs-admin-key', key);
      const response = await fetch(`/api/analytics?range=${selectedRange}`, {
        headers: { 'X-Admin-Key': key },
        cache: 'no-store'
      });
      const responseText = await response.text();
      let data;
      try { data = JSON.parse(responseText); }
      catch (_) {
        const contentType = response.headers.get('content-type') || 'unknown content-type';
        const cfRay = response.headers.get('cf-ray') || 'unknown';
        data = { message: `통계 API 응답 오류 · HTTP ${response.status} · ${contentType} · CF-Ray ${cfRay}` };
      }
      if (!response.ok) {
        const stage = data.stage && data.stage !== 'unknown' ? ` · 단계 ${data.stage}` : '';
        throw new Error(`${data.message || '통계 데이터를 불러오지 못했습니다.'}${stage}`);
      }
      render(data);
      rangeButtons.forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.range) === selectedRange)));
      setStatus(data.empty ? '조회는 정상적으로 완료됐지만 아직 수집된 데이터가 없습니다.' : '통계 조회가 완료됐습니다.');
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
  window.__adminAnalyticsTest = { formatNumber, displayCountry, render, loadAnalytics };
})();
