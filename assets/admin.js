(() => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('html-file');
  const dropZone = $('drop-zone');
  const fileInfo = $('file-info');
  const status = $('parse-status');
  const previewWrap = $('preview-wrap');
  const type = $('post-type');
  const date = $('post-date');
  const registeredDate = $('registered-date');
  const title = $('post-title');
  const subtitle = $('post-subtitle');
  const description = $('post-description');
  const filename = $('post-filename');
  const coverInput = $('cover-file');
  const coverInfo = $('cover-info');
  const coverPreviewCanvas = $('cover-preview-canvas');
  const coverPreviewImage = $('cover-preview-image');
  const coverPreviewEmpty = $('cover-preview-empty');
  const coverPreviewMeta = $('cover-preview-meta');
  const coverPreviewName = $('cover-preview-name');
  const coverPreviewDimensions = $('cover-preview-dimensions');
  const coverPreviewSize = $('cover-preview-size');
  const coverPreviewCaption = $('cover-preview-caption');
  const coverPreviewNote = $('cover-preview-note');
  const coverPreviewModes = [...document.querySelectorAll('[data-cover-preview-mode]')];
  const adminKey = $('admin-key');
  const publishBtn = $('publish-btn');
  const themeBtn = document.querySelector('[data-theme-toggle]');
  const overlay = $('publish-overlay');
  const overlayTitle = $('publish-state-title');
  const overlayText = $('publish-state-text');
  const overlayDetail = $('publish-state-detail');
  const overlayLinks = $('publish-links');
  const reportLink = $('published-report-link');
  const homeLink = $('published-home-link');
  const html = document.documentElement;
  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  let selectedFile = null;
  let selectedCover = null;
  let coverPreviewUrl = '';
  let publishing = false;

  const defaultCoverInfo = 'JPG, PNG, WebP · 최대 4MB · 원본 리포트 HTML과 별도로 저장됩니다.';
  const defaultCoverPreviewNote = '커버 미선택 · 게시 후 홈페이지에서는 fallback cover 사용';
  const coverModeLabels = {
    1280: 'PC 1280',
    430: '모바일 430',
    360: '모바일 360'
  };

  function savedTheme() {
    try { return localStorage.getItem('site-theme') || 'system'; }
    catch (_) { return 'system'; }
  }

  function applyTheme(preference) {
    const actual = preference === 'system' ? (themeMedia.matches ? 'dark' : 'light') : preference;
    html.dataset.theme = actual;
    html.dataset.themePreference = preference;
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', actual === 'dark' ? '#161816' : '#f5f0e6');
    if (themeBtn) {
      themeBtn.setAttribute('aria-label', actual === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
      themeBtn.textContent = actual === 'dark' ? '☀' : '◐';
    }
  }

  applyTheme(savedTheme());
  themeMedia.addEventListener?.('change', () => {
    if (savedTheme() === 'system') applyTheme('system');
  });

  const labels = {
    daily: '주식 리포트',
    weekly: '위클리 리포트',
    research: '비정기 리서치',
    basics: '시장 공부',
    note: '끄적끄적'
  };

  const defaultDescriptions = {
    daily: '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트.',
    weekly: '지난주 흐름을 점검하고 다음 주 변수와 주도 업종의 조건을 정리한 위클리 리포트.',
    research: '특정 산업·기업·정책 이슈를 별도로 분석한 비정기 리서치.',
    basics: '경제와 투자, 시장 구조의 기본 개념을 이해하기 쉽게 정리한 시장 공부.',
    note: '시장과 투자에 관한 생각을 자유롭게 정리한 글.'
  };

  try { adminKey.value = sessionStorage.getItem('mrs-admin-key') || ''; } catch (_) {}

  function detectType(name, text) {
    const s = `${name} ${text.slice(0, 4000)}`;
    if (/시장\s*공부|경제\s*공부|주식\s*공부|market\s*basics|investing\s*basics|explainer/i.test(s)) return 'basics';
    if (/비정기|소버린|technology\s*&\s*policy|research/i.test(s)) return 'research';
    if (/위클리|weekly/i.test(s)) return 'weekly';
    if (/주식리포트|데일리|daily market report|kospi daily/i.test(s)) return 'daily';
    if (/끄적|essay|note/i.test(s)) return 'note';
    return '';
  }

  function detectDate(name, doc, text) {
    const meta = doc.querySelector('meta[name="report-date"]')?.content?.trim();
    if (meta && /^\d{4}-\d{2}-\d{2}$/.test(meta)) return meta;
    const sources = [name, doc.title || '', text.slice(0, 5000)];
    for (const s of sources) {
      const m = s.match(/(20\d{2})[.\-_\/년\s]+(\d{1,2})[.\-_\/월\s]+(\d{1,2})/);
      if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    }
    return new Date().toISOString().slice(0,10);
  }

  function cleanTitle(s) {
    if (!s) return '';
    return s.replace(/\s*[|·｜]\s*(market research|daily market report|weekly).*$/i,'').replace(/_커버통합|\.html?$/gi,'').replace(/_/g,' ').trim();
  }

  function detectTitle(name, doc) {
    const meta = doc.querySelector('meta[name="report-title"]')?.content?.trim();
    if (meta) return meta;
    const candidates = [
      doc.querySelector('h1')?.textContent,
      doc.querySelector('.cover-title')?.textContent,
      doc.querySelector('.title')?.textContent,
      doc.title
    ].map(v => cleanTitle(v || '')).filter(Boolean);
    if (candidates.length) return candidates[0].replace(/\s+/g,' ');
    return cleanTitle(name);
  }

  function detectSubtitle(doc) {
    const meta = doc.querySelector('meta[name="report-subtitle"]')?.content?.trim();
    if (meta) return meta;
    const node = doc.querySelector('.subtitle,.cover-subtitle,[class*="subtitle"]');
    return node ? node.textContent.replace(/\s+/g,' ').trim().slice(0,120) : '';
  }

  function safeFilename(original) {
    return original.replace(/[\\/:*?"<>|]/g,'-').replace(/\s+/g,' ').trim();
  }

  function validateCover(file) {
    if (!file) return '';
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const allowed = {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp']
    };
    if (!allowed[file.type]?.includes(extension)) return 'JPG, PNG, WebP 이미지만 선택할 수 있습니다.';
    if (file.size > 4 * 1024 * 1024) return '대표 커버 이미지는 4MB 이하여야 합니다.';
    return '';
  }

  function formatFileSize(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function revokeCoverPreviewUrl() {
    if (!coverPreviewUrl) return;
    URL.revokeObjectURL(coverPreviewUrl);
    coverPreviewUrl = '';
  }

  function resetCoverPreview(message = '대표 커버를 선택하면 홈페이지에서 보이는 영역을 확인할 수 있습니다.') {
    revokeCoverPreviewUrl();
    coverPreviewImage?.removeAttribute('src');
    if (coverPreviewImage) coverPreviewImage.hidden = true;
    if (coverPreviewEmpty) {
      coverPreviewEmpty.textContent = message;
      coverPreviewEmpty.hidden = false;
    }
    if (coverPreviewMeta) coverPreviewMeta.hidden = true;
    if (coverPreviewName) coverPreviewName.textContent = '';
    if (coverPreviewDimensions) coverPreviewDimensions.textContent = '';
    if (coverPreviewSize) coverPreviewSize.textContent = '';
    if (coverPreviewNote) coverPreviewNote.textContent = defaultCoverPreviewNote;
  }

  function showCoverPreview(file) {
    resetCoverPreview();
    if (!file || !coverPreviewImage) return;
    const objectUrl = URL.createObjectURL(file);
    coverPreviewUrl = objectUrl;
    coverPreviewName.textContent = file.name;
    coverPreviewDimensions.textContent = '확인 중…';
    coverPreviewSize.textContent = formatFileSize(file.size);
    coverPreviewNote.textContent = '커버 이미지 확인 중…';
    coverPreviewMeta.hidden = false;
    coverPreviewImage.onload = () => {
      if (coverPreviewUrl !== objectUrl) return;
      coverPreviewDimensions.textContent = `${coverPreviewImage.naturalWidth} × ${coverPreviewImage.naturalHeight}px`;
      coverPreviewNote.textContent = '선택한 커버가 홈페이지에 사용됩니다.';
    };
    coverPreviewImage.onerror = () => {
      if (coverPreviewUrl !== objectUrl) return;
      selectedCover = null;
      coverInput.value = '';
      coverInfo.textContent = '이미지를 읽을 수 없습니다. 다른 JPG, PNG 또는 WebP 파일을 선택해 주세요.';
      resetCoverPreview();
    };
    coverPreviewImage.src = objectUrl;
    coverPreviewImage.hidden = false;
    coverPreviewEmpty.hidden = true;
  }

  function setCoverPreviewMode(mode) {
    if (!coverModeLabels[mode] || !coverPreviewCanvas) return;
    coverPreviewCanvas.dataset.coverMode = mode;
    coverPreviewCaption.textContent = `홈페이지 커버 표시 영역 · ${coverModeLabels[mode]}`;
    coverPreviewModes.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.coverPreviewMode === mode));
    });
  }

  function resetPreview() {
    const old = previewWrap.querySelector('iframe');
    if (old?.dataset.url) URL.revokeObjectURL(old.dataset.url);
    previewWrap.innerHTML = '<div class="preview-empty">파일을 넣으면 이곳에 원본 리포트가 표시됩니다.</div>';
  }

  function updatePublishState() {
    const ready = selectedFile && type.value && /^\d{4}-\d{2}-\d{2}$/.test(date.value) && title.value.trim() && filename.value.trim() && adminKey.value.trim();
    publishBtn.disabled = publishing || !ready;
  }

  function showOverlay(titleText, bodyText, detailText = '') {
    if (!overlay) return;
    overlay.classList.add('on');
    overlay.classList.remove('done');
    overlayTitle.textContent = titleText;
    overlayText.textContent = bodyText;
    overlayDetail.textContent = detailText;
    overlayLinks.hidden = true;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForDeployment(postId, reportUrl, postType, registered) {
    const categoryUrl = `../?category=${encodeURIComponent(postType)}`;
    homeLink.href = categoryUrl;
    reportLink.href = reportUrl || '#';
    overlayTitle.textContent = '홈페이지 반영 중';
    overlayText.textContent = 'GitHub 게시가 끝났습니다. Cloudflare가 새 버전을 배포하고 있습니다.';
    overlayDetail.textContent = `홈페이지 등록일 ${registered} · 새 배포 확인 중`;

    for (let attempt = 1; attempt <= 40; attempt++) {
      try {
        const res = await fetch(`/data/posts.json?deploycheck=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const posts = await res.json();
          if (Array.isArray(posts) && posts.some(p => p.id === postId)) {
            overlay.classList.add('done');
            overlayTitle.textContent = '홈페이지 반영 완료';
            overlayText.textContent = `${labels[postType] || '리포트'} 목록에 새 글이 등록됐습니다. 잠시 후 자동으로 이동합니다.`;
            overlayDetail.textContent = `홈페이지 등록일 ${registered}`;
            overlayLinks.hidden = false;
            setTimeout(() => { location.href = categoryUrl; }, 1400);
            return;
          }
        }
      } catch (_) {}

      if (attempt % 4 === 0) {
        overlayDetail.textContent = `홈페이지 등록일 ${registered} · Cloudflare 배포 확인 중…`;
      }
      await sleep(2500);
    }

    overlayTitle.textContent = '게시는 완료됐습니다';
    overlayText.textContent = 'Cloudflare 반영 확인이 예상보다 늦어지고 있습니다. 게시 자체는 완료됐으니 아래 버튼으로 이동해도 됩니다.';
    overlayDetail.textContent = `홈페이지 등록일 ${registered}`;
    overlayLinks.hidden = false;
  }

  async function parseFile(file) {
    if (!file || !/\.html?$/i.test(file.name)) {
      status.textContent = 'HTML 파일만 선택할 수 있습니다.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      status.textContent = '현재 게시기는 5MB 이하 HTML 파일만 지원합니다.';
      return;
    }
    selectedFile = file;
    registeredDate.value = '게시 시 자동 기록';
    status.textContent = 'HTML을 분석하는 중…';
    const text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const detectedType = detectType(file.name, text);
    const detectedDate = detectDate(file.name, doc, text);
    const detectedTitle = detectTitle(file.name, doc);
    const detectedSubtitle = detectSubtitle(doc);

    type.value = detectedType;
    date.value = detectedDate;
    title.value = detectedTitle;
    subtitle.value = detectedSubtitle;
    description.value = defaultDescriptions[detectedType] || '';
    filename.value = safeFilename(file.name);

    fileInfo.classList.add('on');
    fileInfo.innerHTML = `<b>${file.name}</b><br>${(file.size/1024).toFixed(1)} KB · ${detectedType ? labels[detectedType] : '카테고리 확인 필요'} · 리포트 기준일 ${detectedDate}`;

    resetPreview();
    const iframe = document.createElement('iframe');
    iframe.srcdoc = text;
    iframe.title = '리포트 원본 미리보기';
    iframe.setAttribute('sandbox', 'allow-scripts');
    previewWrap.innerHTML = '';
    previewWrap.appendChild(iframe);

    status.textContent = detectedType ? '자동 분석 완료. 게시 전에 항목을 확인하세요.' : '분석 완료. 카테고리는 직접 선택하세요.';
    updatePublishState();
  }

  async function publish() {
    if (publishing || publishBtn.disabled || !selectedFile) return;
    const postType = type.value;
    const coverWarning = selectedCover ? '' : '\n\n대표 커버가 선택되지 않았습니다. 게시 후 홈페이지에서는 fallback cover가 사용됩니다.';
    const summary = `${date.value} · ${labels[postType]}\n${title.value.trim()}${coverWarning}\n\n이 내용으로 홈페이지에 게시할까요?`;
    if (!confirm(summary)) return;

    publishing = true;
    updatePublishState();
    publishBtn.textContent = '게시 중…';
    status.textContent = 'HTML과 게시 목록을 GitHub에 반영하는 중…';
    showOverlay('게시 처리 중', '리포트 HTML과 홈페이지 목록을 GitHub에 저장하고 있습니다.', '창을 닫지 않아도 됩니다.');

    const form = new FormData();
    form.append('file', selectedFile, filename.value.trim());
    form.append('type', postType);
    form.append('reportDate', date.value);
    form.append('title', title.value.trim());
    form.append('subtitle', subtitle.value.trim());
    form.append('description', description.value.trim());
    form.append('filename', filename.value.trim());
    if (selectedCover) form.append('cover', selectedCover, selectedCover.name);

    try {
      const key = adminKey.value.trim();
      try { sessionStorage.setItem('mrs-admin-key', key); } catch (_) {}
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'X-Admin-Key': key },
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || `게시 실패 (${res.status})`);

      registeredDate.value = data.registeredDate || '등록 완료';
      status.textContent = `게시 완료 · 등록일 ${data.registeredDate}. Cloudflare 재배포 확인 중…`;
      publishBtn.textContent = '게시 완료';
      publishBtn.disabled = true;
      await waitForDeployment(data.id, data.reportUrl, postType, data.registeredDate || '등록 완료');
    } catch (err) {
      if (overlay) overlay.classList.remove('on');
      status.textContent = err.message || '게시 중 오류가 발생했습니다.';
      publishBtn.textContent = '게시';
      publishing = false;
      updatePublishState();
      return;
    }
    publishing = false;
  }

  ['dragenter','dragover'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag'); }));
  dropZone.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) parseFile(f); });
  dropZone.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => parseFile(fileInput.files?.[0]));
  coverInput?.addEventListener('change', () => {
    const file = coverInput.files?.[0] || null;
    const error = validateCover(file);
    if (error) {
      selectedCover = null;
      coverInput.value = '';
      coverInfo.textContent = error;
      resetCoverPreview();
      return;
    }
    selectedCover = file;
    coverInfo.textContent = file
      ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
      : defaultCoverInfo;
    if (file) showCoverPreview(file);
    else resetCoverPreview();
  });
  coverPreviewModes.forEach(button => {
    button.addEventListener('click', () => setCoverPreviewMode(button.dataset.coverPreviewMode));
  });
  [type,date,title,subtitle,description,adminKey].forEach(el => el?.addEventListener('input', updatePublishState));
  type?.addEventListener('change', () => {
    if (!description.value.trim() || Object.values(defaultDescriptions).includes(description.value.trim())) {
      description.value = defaultDescriptions[type.value] || '';
    }
    updatePublishState();
  });
  adminKey?.addEventListener('change', () => { try { sessionStorage.setItem('mrs-admin-key', adminKey.value.trim()); } catch (_) {} });
  publishBtn?.addEventListener('click', publish);

  themeBtn?.addEventListener('click', () => {
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('site-theme', next); } catch (_) {}
    applyTheme(next);
  });

  window.addEventListener('pagehide', revokeCoverPreviewUrl);

  updatePublishState();
})();
