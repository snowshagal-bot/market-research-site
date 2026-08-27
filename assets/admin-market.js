(() => {
  'use strict';
  const MAX_BYTES = 512 * 1024;
  const REQUIRED = ['meta', 'indices', 'rates_fx_volatility', 'commodities_crypto', 'krx_investor_trading', 'recent_5d_flows', 'market_breadth', 'program_basis', 'market_internals', 'short_selling', 'market_cap_top10', 'validation'];
  const fileInput = document.getElementById('market-json-file');
  const drop = document.getElementById('market-json-drop');
  const fileName = document.getElementById('market-file-name');
  const date = document.getElementById('market-meta-date');
  const version = document.getElementById('market-meta-version');
  const status = document.getElementById('market-meta-status');
  const validationMeta = document.getElementById('market-meta-validation');
  const validationBox = document.getElementById('market-validation');
  const keyInput = document.getElementById('market-admin-key');
  const publishButton = document.getElementById('market-publish-button');
  const publishStatus = document.getElementById('market-publish-status');
  const preview = document.getElementById('market-preview-root');
  let raw = '';
  let payload = null;
  let valid = false;

  try { keyInput.value = sessionStorage.getItem('market-admin-key') || ''; } catch (_) {}

  const updateButton = () => { publishButton.disabled = !valid || !keyInput.value.trim(); };
  const reset = message => {
    raw = ''; payload = null; valid = false;
    date.textContent = version.textContent = status.textContent = validationMeta.textContent = '—';
    validationBox.className = 'market-validation invalid';
    validationBox.textContent = message;
    preview.className = 'market-close-page market-preview-empty';
    preview.textContent = '유효한 JSON을 선택하면 실제 Market Close 레이아웃으로 표시합니다.';
    updateButton();
  };

  const clientErrors = data => {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ['최상위 값이 JSON object여야 합니다.'];
    REQUIRED.forEach(key => { if (!Object.hasOwn(data, key)) errors.push(`${key} 필드가 없습니다.`); });
    if (data.meta?.schema_version !== '1.0.1') errors.push('schema_version은 1.0.1이어야 합니다.');
    if (data.meta?.status !== 'final') errors.push('status가 final인 파일만 게시할 수 있습니다.');
    if (data.validation?.passed !== true) errors.push('validation.passed가 true여야 합니다.');
    if (!Array.isArray(data.validation?.errors) || data.validation.errors.length) errors.push('validation.errors가 빈 배열이어야 합니다.');
    return errors;
  };

  async function selectFile(file) {
    publishStatus.textContent = '';
    if (!file) return reset('파일을 선택해 주세요.');
    fileName.textContent = `${file.name} · ${new Intl.NumberFormat('ko-KR').format(file.size)} bytes`;
    if (file.size > MAX_BYTES) return reset('파일이 512KB를 초과합니다.');
    try { raw = await file.text(); payload = JSON.parse(raw); }
    catch (_) { return reset('올바른 JSON 파일이 아닙니다.'); }
    date.textContent = payload.meta?.market_date || '—';
    version.textContent = payload.meta?.schema_version || '—';
    status.textContent = payload.meta?.status || '—';
    validationMeta.textContent = payload.validation?.passed === true && payload.validation?.errors?.length === 0 ? 'PASSED' : 'FAILED';
    const errors = clientErrors(payload);
    valid = errors.length === 0;
    validationBox.className = `market-validation ${valid ? 'valid' : 'invalid'}`;
    validationBox.textContent = valid ? '기본 게시 조건을 통과했습니다. 서버에서 JSON Schema 전체 검증 후 저장합니다.' : errors.join('\n');
    preview.className = 'market-close-page';
    window.MARKET_CLOSE?.render(payload, preview);
    adoptTakeawayDate(payload.meta?.market_date);
    renderTakeawayState();
    updateButton();
    loadStoredTakeaway(payload.meta?.market_date);
  }

  fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
  drop.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', event => selectFile(event.dataTransfer?.files?.[0]));
  keyInput.addEventListener('input', () => { try { sessionStorage.setItem('market-admin-key', keyInput.value); } catch (_) {} updateButton(); });

  // The one-liner is written by hand and travels with the machine-generated
  // payload, so both reach D1 under the same market_date.
  const takeawayKo = document.getElementById('market-takeaway-ko');
  const takeawayEn = document.getElementById('market-takeaway-en');
  const takeawayCount = document.getElementById('market-takeaway-count');
  const takeawayDate = document.getElementById('market-takeaway-date');
  const takeawayLoaded = document.getElementById('market-takeaway-loaded');
  const takeawayFields = { ko: takeawayKo, en: takeawayEn };
  // Which date the boxes currently belong to, which languages the editor has
  // actually written in for that date, and a counter that retires the answer
  // to a lookup the editor has already moved past.
  let takeawayDateKey = null;
  let prefillToken = 0;
  const touched = new Set();

  // Switching to another day starts over. Carrying yesterday's sentence into
  // today's boxes would file it under the wrong market_date on publish.
  function adoptTakeawayDate(marketDate) {
    const key = marketDate || null;
    prefillToken += 1;
    if (key === takeawayDateKey) return;
    takeawayDateKey = key;
    touched.clear();
    if (takeawayKo) takeawayKo.value = '';
    if (takeawayEn) takeawayEn.value = '';
    if (takeawayLoaded) { takeawayLoaded.hidden = true; takeawayLoaded.textContent = ''; }
  }

  function renderTakeawayState() {
    if (takeawayDate) takeawayDate.textContent = payload?.meta?.market_date || 'market date';
    if (!takeawayCount) return;
    const parts = [];
    for (const [lang, field] of Object.entries(takeawayFields)) {
      const label = lang === 'ko' ? '한국어' : 'English';
      const home = lang === 'ko' ? 'KO' : 'EN';
      const text = field?.value.trim() || '';
      if (text) parts.push(`${label} ${text.length}자`);
      // An untouched box is left out of the request entirely, so the stored
      // line survives; an emptied one is sent as '' and erases it.
      else if (touched.has(lang)) parts.push(`${label} 삭제 — ${home} 홈에서 한 줄 숨김`);
      else parts.push(`${label} 입력 없음 — 저장된 문구 유지`);
    }
    takeawayCount.textContent = parts.join(' · ');
  }
  Object.entries(takeawayFields).forEach(([lang, field]) => field?.addEventListener('input', () => {
    touched.add(lang);
    renderTakeawayState();
  }));

  async function loadStoredTakeaway(marketDate) {
    if (takeawayLoaded) takeawayLoaded.hidden = true;
    if (!marketDate) return;
    const token = prefillToken;
    let stored;
    try {
      const response = await fetch('/api/market/latest', { headers: { 'cache-control': 'no-cache' } });
      if (!response.ok) return;
      const body = await response.json();
      if (body?.meta?.market_date !== marketDate) return;
      stored = body.takeaway;
    } catch (_) { return; }
    // A slow answer for a day the editor has left must not land in the boxes
    // now showing another one.
    if (token !== prefillToken || marketDate !== takeawayDateKey) return;
    if (payload?.meta?.market_date !== marketDate || !stored) return;
    const filled = [];
    for (const [lang, field] of Object.entries(takeawayFields)) {
      if (!field || touched.has(lang) || !stored[lang]) continue;
      field.value = stored[lang];
      filled.push(lang.toUpperCase());
    }
    renderTakeawayState();
    if (!takeawayLoaded || !filled.length) return;
    takeawayLoaded.hidden = false;
    takeawayLoaded.textContent = `${marketDate}에 저장된 ${filled.join('/')} 문구를 불러왔습니다. 그대로 두면 유지되고, 지우고 게시하면 삭제됩니다.`;
  }
  renderTakeawayState();

  publishButton.addEventListener('click', async () => {
    if (!valid || !raw) return;
    publishButton.disabled = true;
    publishStatus.className = 'market-publish-status';
    publishStatus.textContent = '서버 계약 검증과 D1 저장을 진행 중입니다…';
    try {
      // Only a language the editor actually wrote in for this date is sent.
      // An untouched box says nothing, and the server keeps what it has; an
      // emptied box says '' and erases it.
      const sameDate = payload?.meta?.market_date === takeawayDateKey;
      const takeaway = {};
      for (const [lang, field] of Object.entries(takeawayFields)) {
        if (!sameDate || !touched.has(lang)) continue;
        takeaway[lang] = field?.value.trim() || '';
      }
      const envelope = JSON.stringify({ market: payload, takeaway });
      const response = await fetch('/api/market/publish', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': keyInput.value.trim() }, body: envelope });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error([result.message, ...(result.details || []).slice(0, 3)].filter(Boolean).join(' · ') || `게시 실패 (${response.status})`);
      publishStatus.className = 'market-publish-status success';
      const saved = [result.takeaway?.ko ? 'KO' : null, result.takeaway?.en ? 'EN' : null].filter(Boolean);
      const takeawayNote = saved.length ? ` · 한 줄 ${saved.join('/')}` : ' · 한 줄 없음';
      publishStatus.textContent = `${result.market_date} 저장 완료 · ${result.action === 'created' ? '신규' : '동일 날짜 갱신'}${result.is_latest ? ' · latest 반영' : ' · 과거 날짜 보관'}${takeawayNote}`;
    } catch (error) {
      publishStatus.className = 'market-publish-status error';
      publishStatus.textContent = error.message || '게시하지 못했습니다.';
    } finally { updateButton(); }
  });
})();
