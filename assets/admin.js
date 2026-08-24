(() => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('html-file');
  const dropZone = $('drop-zone');
  const fileInfo = $('file-info');
  const status = $('parse-status');
  const previewWrap = $('preview-wrap');
  const type = $('post-type');
  const categoryStatus = $('category-status');
  const categoryOptions = [...document.querySelectorAll('input[name="post-category"]')];
  const postLanguage = $('post-language');
  const languageOptions = [...document.querySelectorAll('input[name="post-language-choice"]')];
  const translationSource = $('translation-source');
  const translationSourceStatus = $('translation-source-status');
  const date = $('post-date');
  const registeredDate = $('registered-date');
  const title = $('post-title');
  const subtitle = $('post-subtitle');
  const description = $('post-description');
  const postSummary = $('post-summary');
  const filename = $('post-filename');
  const coverInput = $('cover-file');
  const coverInfo = $('cover-info');
  const generateCoverBtn = $('generate-cover-btn');
  const coverGeneratorStatus = $('cover-generator-status');
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
  let selectedHtmlText = '';
  let selectedHtmlDocument = null;
  let generatingCover = false;
  let coverGenerationVersion = 0;
  let coverDecodePending = false;
  let coverDecodeVersion = 0;
  let reportSelectionVersion = 0;
  let coverPreviewUrl = '';
  let publishing = false;
  const PRODUCTION_HOSTNAME = 'snowshagal.com';
  const localeApi = window.MARKET_LOCALE;

  const defaultCoverInfo = 'JPG, PNG, WebP · 최대 4MB · 원본 리포트 HTML과 별도로 저장됩니다.';
  const defaultCoverGeneratorStatus = '업로드한 리포트 HTML의 첫 화면을 기준으로 생성합니다. 결과는 게시 전에 미리보고 교체할 수 있습니다.';
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
    daily: '데일리',
    weekly: '위클리',
    research: '비정기',
    basics: '시장 공부',
    note: '끄적끄적'
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  }

  function normalizedLanguage(post) {
    return localeApi?.postLanguage(post) || (post?.lang === 'en' ? 'en' : 'ko');
  }

  function translationKey(post) {
    return localeApi?.groupKey(post) || String(post?.translationGroup || post?.id || '');
  }

  function pairedTranslationPost() {
    if (!translationSource?.value || !postLanguage) return null;
    const targetLanguage = postLanguage.value === 'en' ? 'ko' : 'en';
    return (window.RESEARCH_POSTS || []).find(post => (
      normalizedLanguage(post) === targetLanguage && translationKey(post) === translationSource.value
    )) || null;
  }

  function pairedReportDate(post = pairedTranslationPost()) {
    const value = String(post?.reportDate || post?.date || '');
    return /^20\d{2}-\d{2}-\d{2}$/.test(value) ? value : '';
  }

  function syncPairedReportDate() {
    const pair = pairedTranslationPost();
    if (!pair) {
      updatePublishState();
      return;
    }
    const pairDate = pairedReportDate(pair);
    if (!pairDate) {
      status.textContent = '선택한 번역 짝의 리포트 기준일을 확인할 수 없습니다.';
      updatePublishState();
      return;
    }
    date.value = pairDate;
    if (translationSourceStatus) {
      translationSourceStatus.textContent = `번역 짝의 리포트 기준일 ${pairDate}을 자동 적용했습니다.`;
    }
    updatePublishState();
  }

  function populateTranslationSources() {
    if (!translationSource || !postLanguage) return;
    const targetLanguage = postLanguage.value === 'en' ? 'ko' : 'en';
    const items = (window.RESEARCH_POSTS || []).filter(post => normalizedLanguage(post) === targetLanguage);
    translationSource.innerHTML = `<option value="">연결하지 않음</option>${items.map(post => `<option value="${escapeHtml(translationKey(post))}">${escapeHtml(post.title || post.id)} · ${escapeHtml(post.reportDate || post.date || '')}</option>`).join('')}`;
    translationSource.value = '';
    if (translationSourceStatus) {
      const targetLabel = targetLanguage === 'en' ? 'English' : '한국어';
      translationSourceStatus.textContent = items.length
        ? `${targetLabel} 게시물 ${items.length}개 중 번역 짝을 선택할 수 있습니다.`
        : `연결할 기존 ${targetLabel} 게시물이 없습니다. 연결 없이 게시할 수 있습니다.`;
    }
  }

  function setLanguage(value) {
    if (!postLanguage || !['ko', 'en'].includes(value)) return;
    postLanguage.value = value;
    languageOptions.forEach(option => { option.checked = option.value === value; });
    populateTranslationSources();
    updateCategoryDescription(type.value);
  }

  function isPreviewHost(hostname) {
    return Boolean(hostname) && hostname !== PRODUCTION_HOSTNAME;
  }

  const defaultDescriptions = {
    ko: {
      daily: '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트.',
      weekly: '지난주 흐름을 점검하고 다음 주 변수와 주도 업종의 조건을 정리한 위클리 리포트.',
      research: '특정 산업·기업·정책 이슈를 별도로 분석한 비정기 리서치.',
      basics: '경제와 투자, 시장 구조의 기본 개념을 이해하기 쉽게 정리한 시장 공부.',
      note: '시장과 투자에 관한 생각을 자유롭게 정리한 글.'
    },
    en: {
      daily: 'A daily report on market trends, investor flows, sectors, and macro drivers.',
      weekly: 'A weekly report reviewing recent market moves and the key variables for the week ahead.',
      research: 'Independent research on specific industries, companies, policies, and market structure.',
      basics: 'A clear guide to the essential concepts behind markets, economics, and investing.',
      note: 'Notes and observations on markets and investing.'
    }
  };

  function defaultDescription(typeValue, language = postLanguage?.value) {
    return defaultDescriptions[language === 'en' ? 'en' : 'ko'][typeValue] || '';
  }

  function isDefaultDescription(value) {
    return Object.values(defaultDescriptions).some(descriptions => Object.values(descriptions).includes(value));
  }

  try { adminKey.value = sessionStorage.getItem('mrs-admin-key') || ''; } catch (_) {}

  function detectType(name, doc, text) {
    const allowedTypes = ['daily', 'weekly', 'research', 'basics', 'note'];
    const declaredType = doc.querySelector('meta[name="report-type"]')?.content?.trim().toLowerCase();
    if (allowedTypes.includes(declaredType)) return declaredType;

    const strongSignals = `${name} ${doc.title || ''}`;
    if (/시장\s*공부|경제\s*공부|주식\s*공부|market\s*basics|investing\s*basics|explainer/i.test(strongSignals)) return 'basics';
    if (/위클리|weekly/i.test(strongSignals)) return 'weekly';
    if (/주식리포트|데일리|daily(?:\s+market)?|kospi\s+daily/i.test(strongSignals)) return 'daily';
    if (/비정기|소버린|technology\s*&\s*policy|research\s+(?:report|brief|analysis)/i.test(strongSignals) || /^research(?:[-_\s]*(?:report|brief|analysis))?\.html?$/i.test(name)) return 'research';
    if (/끄적|essay|(?:^|[\s_.-])notes?(?=$|[\s_.-])/i.test(strongSignals)) return 'note';

    const bodySignals = text.slice(0, 4000);
    if (/시장\s*공부|경제\s*공부|주식\s*공부|market\s*basics|investing\s*basics|explainer/i.test(bodySignals)) return 'basics';
    if (/위클리|weekly/i.test(bodySignals)) return 'weekly';
    if (/주식리포트|데일리|daily\s+market|kospi\s+daily/i.test(bodySignals)) return 'daily';
    if (/비정기|소버린|technology\s*&\s*policy|research\s+(?:report|brief|analysis)/i.test(bodySignals)) return 'research';
    if (/끄적|essay|(?:^|[\s_.-])notes?(?=$|[\s_.-])/i.test(bodySignals)) return 'note';
    return '';
  }

  function detectDate(name, doc, text) {
    const meta = doc.querySelector('meta[name="report-date"]')?.content?.trim();
    if (meta && /^\d{4}-\d{2}-\d{2}$/.test(meta)) return meta;
    const sources = [name, doc.title || '', text.slice(0, 5000)];
    const months = {
      january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
      may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
      september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
      december: 12, dec: 12
    };
    const formatDate = (year, month, day) => {
      const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) return '';
      return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    };
    for (const s of sources) {
      const m = s.match(/(20\d{2})[.\-_\/년\s]+(\d{1,2})[.\-_\/월\s]+(\d{1,2})/);
      if (m) {
        const found = formatDate(m[1], m[2], m[3]);
        if (found) return found;
      }
      const monthFirst = s.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/i);
      if (monthFirst) {
        const found = formatDate(monthFirst[3], months[monthFirst[1].toLowerCase()], monthFirst[2]);
        if (found) return found;
      }
      const dayFirst = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s*,?\s*(20\d{2})\b/i);
      if (dayFirst) {
        const found = formatDate(dayFirst[3], months[dayFirst[2].toLowerCase()], dayFirst[1]);
        if (found) return found;
      }
    }
    return '';
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

  function detectSummary(doc) {
    const declared = (doc.querySelector('meta[name="report-summary"]')?.content || '').trim();
    if (declared) return declared.slice(0, 500);
    for (const selector of ['.cover-oneline', '.opener .stand', '.cover-summary', '.cover-description', '[data-report-summary]']) {
      const text = (doc.querySelector(selector)?.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 500);
    }
    return '';
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

  function updateCategoryDescription(value) {
    if (!description.value.trim() || isDefaultDescription(description.value.trim())) {
      description.value = defaultDescription(value);
    }
  }

  function setCategory(value, source = '') {
    type.value = value;
    categoryOptions.forEach(option => { option.checked = option.value === value; });
    updateCategoryDescription(value);
    if (categoryStatus) {
      if (source === 'auto' && value) categoryStatus.textContent = `자동 인식: ${labels[value]} · 필요하면 직접 변경하세요.`;
      else if (source === 'manual' && value) categoryStatus.textContent = `직접 선택: ${labels[value]}`;
      else if (source === 'auto') categoryStatus.textContent = '카테고리를 자동으로 판단하지 못했습니다. 직접 선택해 주세요.';
    }
    updatePublishState();
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

  function resetCoverPreview(message = '대표 커버를 선택하면 홈페이지에서 보이는 영역을 확인할 수 있습니다.', invalidateDecode = true) {
    if (invalidateDecode) {
      coverDecodeVersion += 1;
      coverDecodePending = false;
      selectedCover = null;
    }
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
    updatePublishState();
  }

  function showCoverPreview(file, reportVersion = reportSelectionVersion) {
    if (reportVersion !== reportSelectionVersion) return;
    const decodeVersion = ++coverDecodeVersion;
    selectedCover = null;
    coverDecodePending = Boolean(file && coverPreviewImage);
    resetCoverPreview(undefined, false);
    if (!file || !coverPreviewImage) {
      coverDecodePending = false;
      updatePublishState();
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    coverPreviewUrl = objectUrl;
    coverPreviewName.textContent = file.name;
    coverPreviewDimensions.textContent = '확인 중…';
    coverPreviewSize.textContent = formatFileSize(file.size);
    coverPreviewNote.textContent = '커버 이미지 확인 중…';
    coverPreviewMeta.hidden = false;
    coverPreviewImage.onload = () => {
      if (decodeVersion !== coverDecodeVersion || reportVersion !== reportSelectionVersion || coverPreviewUrl !== objectUrl) return;
      selectedCover = file;
      coverDecodePending = false;
      coverPreviewDimensions.textContent = `${coverPreviewImage.naturalWidth} × ${coverPreviewImage.naturalHeight}px`;
      coverPreviewNote.textContent = '선택한 커버가 홈페이지에 사용됩니다.';
      updatePublishState();
    };
    coverPreviewImage.onerror = () => {
      if (decodeVersion !== coverDecodeVersion || reportVersion !== reportSelectionVersion || coverPreviewUrl !== objectUrl) return;
      selectedCover = null;
      coverDecodePending = false;
      coverInput.value = '';
      coverInfo.textContent = '이미지를 읽을 수 없습니다. 다른 JPG, PNG 또는 WebP 파일을 선택해 주세요.';
      resetCoverPreview(undefined, false);
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
    publishBtn.disabled = publishing || generatingCover || coverDecodePending || !ready;
    if (generateCoverBtn) generateCoverBtn.disabled = generatingCover || coverDecodePending || !selectedFile || !selectedHtmlText || !selectedHtmlDocument || !adminKey.value.trim();
  }

  async function generateCover() {
    if (generatingCover || !selectedHtmlText || !selectedHtmlDocument || !adminKey.value.trim() || !window.MARKET_COVER_GENERATOR) return;
    const generationVersion = ++coverGenerationVersion;
    const generationReportVersion = reportSelectionVersion;
    generatingCover = true;
    updatePublishState();
    generateCoverBtn.textContent = '커버 생성 중…';
    coverGeneratorStatus.textContent = 'HTML 첫 화면을 분석하고 커버 이미지를 만들고 있습니다.';
    try {
      const result = await window.MARKET_COVER_GENERATOR.generate({
        html: selectedHtmlText,
        adminKey: adminKey.value.trim(),
        template: {
          category: labels[type.value] || '리포트',
          date: date.value,
          title: title.value.trim(),
          metaSummary: detectSummary(selectedHtmlDocument),
          summary: postSummary.value.trim(),
          description: description.value.trim()
        }
      });
      if (generationVersion !== coverGenerationVersion || generationReportVersion !== reportSelectionVersion) return;
      coverInput.value = '';
      coverInfo.textContent = `${result.file.name} · ${(result.file.size / 1024).toFixed(1)} KB`;
      showCoverPreview(result.file, generationReportVersion);
      coverGeneratorStatus.textContent = result.method === 'template'
        ? `표준 템플릿 커버를 생성했습니다${result.attemptedSelector ? ` · ${result.attemptedSelector} 캡처 대체` : ''}${result.captureError ? ` · ${result.captureError}` : ''}. 수동 커버로 교체할 수도 있습니다.`
        : `브라우저 렌더링으로 커버를 생성했습니다${result.selector ? ` · ${result.selector}` : ''}.`;
      if (result.method === 'template' && result.captureError) console.warn('cover capture fallback:', result.captureError);
    } catch (error) {
      if (generationVersion !== coverGenerationVersion || generationReportVersion !== reportSelectionVersion) return;
      coverDecodeVersion += 1;
      coverDecodePending = false;
      const reason = String(error?.message || '').trim();
      const detail = [error?.code, error?.status ? `HTTP ${error.status}` : ''].filter(Boolean).join(' · ');
      coverGeneratorStatus.textContent = `커버 자동 생성에 실패했습니다${reason ? ` · ${reason}` : ''}${detail ? ` (${detail})` : ''}. 수동 커버를 업로드하거나 다시 시도해 주세요.`;
    } finally {
      if (generationVersion !== coverGenerationVersion || generationReportVersion !== reportSelectionVersion) return;
      generatingCover = false;
      generateCoverBtn.textContent = 'HTML에서 커버 자동 생성';
      updatePublishState();
    }
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

  async function waitForDeployment(postId, reportUrl, postType, registered, language) {
    const categoryUrl = language === 'en'
      ? `../en/?category=${encodeURIComponent(postType)}`
      : `../?category=${encodeURIComponent(postType)}`;
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
    const reportVersion = ++reportSelectionVersion;
    coverGenerationVersion += 1;
    generatingCover = false;
    generateCoverBtn.textContent = 'HTML에서 커버 자동 생성';
    coverGeneratorStatus.textContent = defaultCoverGeneratorStatus;
    coverInput.value = '';
    coverInfo.textContent = defaultCoverInfo;
    resetCoverPreview();
    selectedFile = file;
    selectedHtmlText = '';
    selectedHtmlDocument = null;
    registeredDate.value = '게시 시 자동 기록';
    status.textContent = 'HTML을 분석하는 중…';
    const text = await file.text();
    if (reportVersion !== reportSelectionVersion) return;
    const doc = new DOMParser().parseFromString(text, 'text/html');
    selectedHtmlText = text;
    selectedHtmlDocument = doc;
    const detectedType = detectType(file.name, doc, text);
    const detectedDate = detectDate(file.name, doc, text);
    const detectedTitle = detectTitle(file.name, doc);
    const detectedSubtitle = detectSubtitle(doc);
    const detectedSummary = detectSummary(doc);

    setCategory(detectedType, 'auto');
    date.value = detectedDate;
    if (translationSource?.value) syncPairedReportDate();
    title.value = detectedTitle;
    subtitle.value = detectedSubtitle;
    description.value = defaultDescription(detectedType);
    postSummary.value = detectedSummary;
    filename.value = safeFilename(file.name);

    fileInfo.classList.add('on');
    fileInfo.innerHTML = `<b>${file.name}</b><br>${(file.size/1024).toFixed(1)} KB · ${detectedType ? labels[detectedType] : '카테고리 확인 필요'} · ${date.value ? `리포트 기준일 ${date.value}` : '리포트 기준일 확인 필요'}`;

    resetPreview();
    const iframe = document.createElement('iframe');
    iframe.srcdoc = text;
    iframe.title = '리포트 원본 미리보기';
    iframe.setAttribute('sandbox', 'allow-scripts');
    previewWrap.innerHTML = '';
    previewWrap.appendChild(iframe);

    status.textContent = !date.value
      ? '리포트 기준일을 자동으로 찾지 못했습니다. 날짜를 직접 확인해 주세요.'
      : detectedType ? '자동 분석 완료. 게시 전에 항목을 확인하세요.' : '분석 완료. 카테고리는 직접 선택하세요.';
    updatePublishState();
  }

  async function publish() {
    if (publishing || publishBtn.disabled || !selectedFile) return;
    if (isPreviewHost(location.hostname)) {
      status.textContent = 'Preview와 로컬 환경에서는 실제 게시를 실행할 수 없습니다.';
      return;
    }
    const postType = type.value;
    const language = postLanguage?.value === 'en' ? 'en' : 'ko';
    const languageLabel = language === 'en' ? 'English' : '한국어';
    if (translationSource?.value) {
      const pair = pairedTranslationPost();
      const pairDate = pairedReportDate(pair);
      if (!pair || !pairDate) {
        status.textContent = '선택한 번역 짝의 연결 정보와 기준일을 확인해 주세요.';
        return;
      }
      if (date.value !== pairDate) {
        status.textContent = `리포트 기준일은 번역 짝과 같은 ${pairDate}이어야 합니다.`;
        return;
      }
    }
    const coverWarning = selectedCover ? '' : '\n\n대표 커버가 선택되지 않았습니다. 게시 후 홈페이지에서는 fallback cover가 사용됩니다.';
    const summary = `${date.value} · ${labels[postType]} · ${languageLabel}\n${title.value.trim()}${coverWarning}\n\n이 내용으로 홈페이지에 게시할까요?`;
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
    form.append('summary', postSummary.value.trim());
    form.append('filename', filename.value.trim());
    form.append('lang', language);
    if (translationSource?.value) form.append('translationGroup', translationSource.value);
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
      await waitForDeployment(data.id, data.reportUrl, postType, data.registeredDate || '등록 완료', language);
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
    coverInfo.textContent = file
      ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
      : defaultCoverInfo;
    if (file) showCoverPreview(file);
    else resetCoverPreview();
  });
  generateCoverBtn?.addEventListener('click', generateCover);
  coverPreviewModes.forEach(button => {
    button.addEventListener('click', () => setCoverPreviewMode(button.dataset.coverPreviewMode));
  });
  [date,title,subtitle,description,postSummary,adminKey].forEach(el => el?.addEventListener('input', updatePublishState));
  categoryOptions.forEach((option, index) => {
    option.addEventListener('change', () => {
      if (option.checked) setCategory(option.value, 'manual');
    });
    option.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = categoryOptions.length - 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + categoryOptions.length) % categoryOptions.length;
      else nextIndex = (index + 1) % categoryOptions.length;
      const nextOption = categoryOptions[nextIndex];
      nextOption.checked = true;
      nextOption.focus();
      setCategory(nextOption.value, 'manual');
    });
  });
  languageOptions.forEach(option => {
    option.addEventListener('change', () => {
      if (option.checked) setLanguage(option.value);
    });
  });
  translationSource?.addEventListener('change', syncPairedReportDate);
  adminKey?.addEventListener('change', () => { try { sessionStorage.setItem('mrs-admin-key', adminKey.value.trim()); } catch (_) {} });
  publishBtn?.addEventListener('click', publish);

  themeBtn?.addEventListener('click', () => {
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('site-theme', next); } catch (_) {}
    applyTheme(next);
  });

  window.addEventListener('pagehide', revokeCoverPreviewUrl);

  setLanguage(postLanguage?.value || 'ko');
  if (isPreviewHost(location.hostname)) status.textContent = 'Preview와 로컬 환경에서는 실제 게시가 비활성화됩니다.';
  updatePublishState();
})();
