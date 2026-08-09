(() => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('html-file');
  const dropZone = $('drop-zone');
  const fileInfo = $('file-info');
  const status = $('parse-status');
  const previewWrap = $('preview-wrap');
  const type = $('post-type');
  const date = $('post-date');
  const title = $('post-title');
  const subtitle = $('post-subtitle');
  const description = $('post-description');
  const filename = $('post-filename');
  const themeBtn = document.querySelector('[data-theme-toggle]');

  const labels = {
    daily: '주식 리포트',
    weekly: '위클리 리포트',
    research: '비정기 리서치',
    note: '끄적끄적'
  };

  function detectType(name, text) {
    const s = `${name} ${text.slice(0, 4000)}`;
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
      let m = s.match(/(20\d{2})[.\-_\/년\s]+(\d{1,2})[.\-_\/월\s]+(\d{1,2})/);
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

  function resetPreview() {
    const old = previewWrap.querySelector('iframe');
    if (old?.dataset.url) URL.revokeObjectURL(old.dataset.url);
    previewWrap.innerHTML = '<div class="preview-empty">파일을 넣으면 이곳에 원본 리포트가 표시됩니다.</div>';
  }

  async function parseFile(file) {
    if (!file || !/\.html?$/i.test(file.name)) {
      status.textContent = 'HTML 파일만 선택할 수 있습니다.';
      return;
    }
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
    description.value = detectedType ? `${labels[detectedType]} · 홈페이지 게시용 설명을 필요하면 수정하세요.` : '';
    filename.value = safeFilename(file.name);

    fileInfo.classList.add('on');
    fileInfo.innerHTML = `<b>${file.name}</b><br>${(file.size/1024).toFixed(1)} KB · ${detectedType ? labels[detectedType] : '카테고리 확인 필요'} · ${detectedDate}`;

    resetPreview();
    const blobUrl = URL.createObjectURL(file);
    const iframe = document.createElement('iframe');
    iframe.src = blobUrl;
    iframe.dataset.url = blobUrl;
    iframe.title = '리포트 원본 미리보기';
    previewWrap.innerHTML = '';
    previewWrap.appendChild(iframe);

    status.textContent = detectedType ? '자동 분석 완료. 게시 전에 항목을 확인하세요.' : '분석 완료. 카테고리는 직접 선택하세요.';
  }

  ['dragenter','dragover'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag'); }));
  dropZone.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) parseFile(f); });
  fileInput.addEventListener('change', () => parseFile(fileInput.files?.[0]));

  themeBtn?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    if (dark) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'dark';
    try { localStorage.setItem('site-theme', dark ? 'light' : 'dark'); } catch(e) {}
  });
})();