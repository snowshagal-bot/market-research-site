(() => {
  const $ = (id) => document.getElementById(id);
  const TYPE_LABELS = { daily: '데일리', weekly: '위클리', research: '비정기', basics: '시장 공부', note: '끄적끄적' };
  const html = document.documentElement;
  const themeButton = document.querySelector('[data-theme-toggle]');
  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  const list = $('post-list');
  const count = $('post-count');
  const search = $('manage-search');
  const filters = [...document.querySelectorAll('[data-filter]')];
  const editorEmpty = $('editor-empty');
  const form = $('editor-form');
  const status = $('manage-status');
  const adminKey = $('manage-admin-key');
  const htmlInput = $('replacement-html');
  const htmlStatus = $('html-status');
  const htmlPreview = $('html-preview');
  const htmlFrame = $('html-preview-frame');
  const coverInput = $('replacement-cover');
  const coverFileField = $('cover-file-field');
  const coverStatus = $('cover-status');
  const coverImage = $('manage-cover-image');
  const coverFallback = $('manage-cover-fallback');
  const coverMeta = $('cover-meta');
  const coverName = $('cover-name');
  const coverDimensions = $('cover-dimensions');
  const coverSize = $('cover-size');
  const currentCoverLabel = $('current-cover-label');
  const previewModes = [...document.querySelectorAll('[data-preview-mode]')];
  const startDelete = $('start-delete');
  const deleteConfirmation = $('delete-confirmation');
  const deleteExpectedTitle = $('delete-expected-title');
  const deleteTitleConfirm = $('delete-title-confirm');
  const confirmDelete = $('confirm-delete');
  let posts = [];
  let activeFilter = 'all';
  let selectedPost = null;
  let selectedHtml = null;
  let selectedCover = null;
  let htmlObjectUrl = '';
  let coverObjectUrl = '';
  let saving = false;

  function savedTheme() {
    try { return localStorage.getItem('site-theme') || 'system'; } catch (_) { return 'system'; }
  }

  function applyTheme(preference) {
    const actual = preference === 'system' ? (themeMedia.matches ? 'dark' : 'light') : preference;
    html.dataset.theme = actual;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', actual === 'dark' ? '#161816' : '#f5f0e6');
    if (themeButton) {
      themeButton.textContent = actual === 'dark' ? '☀' : '◐';
      themeButton.setAttribute('aria-label', actual === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');
    }
  }

  function sortPosts(items) {
    return [...items].sort((left, right) => {
      const byDate = String(right.reportDate || right.date || '').localeCompare(String(left.reportDate || left.date || ''));
      return byDate || String(right.registeredAt || '').localeCompare(String(left.registeredAt || ''));
    });
  }

  function filteredPosts(items, query, filter) {
    const normalized = query.trim().toLocaleLowerCase('ko');
    return sortPosts(items).filter((post) => {
      if (filter !== 'all' && post.type !== filter) return false;
      if (!normalized) return true;
      return `${post.title || ''} ${post.href || ''}`.toLocaleLowerCase('ko').includes(normalized);
    });
  }

  function isPreviewHost(hostname) {
    return hostname.endsWith('.pages.dev') && hostname !== 'market-research-site.pages.dev';
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function validateHtml(file, source) {
    if (!file || !/\.html?$/i.test(file.name)) return 'HTML 파일만 선택할 수 있습니다.';
    if (file.size > 5 * 1024 * 1024) return 'HTML 파일은 5MB 이하여야 합니다.';
    if (!/<!doctype\s+html/i.test(source) || !/<html(?:\s|>)/i.test(source) || !/<\/html>/i.test(source)) return '독립 실행형 HTML 파일인지 확인해 주세요.';
    return '';
  }

  function validateCover(file) {
    if (!file) return '새 커버 이미지를 선택해 주세요.';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const allowed = { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] };
    if (!allowed[file.type]?.includes(ext)) return 'JPG, PNG 또는 WebP 파일을 선택해 주세요.';
    if (file.size > 4 * 1024 * 1024) return '커버 이미지는 4MB 이하여야 합니다.';
    return '';
  }

  function revokeHtmlUrl() {
    if (htmlObjectUrl) URL.revokeObjectURL(htmlObjectUrl);
    htmlObjectUrl = '';
    htmlFrame.removeAttribute('src');
    htmlPreview.hidden = true;
  }

  function revokeCoverUrl() {
    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = '';
  }

  function resetReplacementFiles() {
    selectedHtml = null;
    selectedCover = null;
    htmlInput.value = '';
    coverInput.value = '';
    revokeHtmlUrl();
    revokeCoverUrl();
    htmlStatus.textContent = '기존 공개 URL에 그대로 저장됩니다.';
    coverStatus.textContent = 'JPG, PNG, WebP · 최대 4MB';
  }

  function renderList() {
    const visible = filteredPosts(posts, search.value, activeFilter);
    count.textContent = `${visible.length}개`;
    list.innerHTML = '';
    if (!visible.length) {
      list.innerHTML = '<p class="empty-message">조건에 맞는 게시물이 없습니다.</p>';
      return;
    }
    visible.forEach((post) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'post-item';
      button.dataset.postId = post.id;
      button.setAttribute('aria-current', String(post.id === selectedPost?.id));
      button.innerHTML = `<span class="post-item-top"><span>${TYPE_LABELS[post.type] || post.type} · ${post.reportDate || post.date || ''}</span><span class="cover-badge">${post.coverImage ? '커버 있음' : 'fallback'}</span></span><strong></strong><small></small><span class="post-item-top"><span>등록 ${post.registeredDate || '-'}</span></span>`;
      button.querySelector('strong').textContent = post.title || '(제목 없음)';
      button.querySelector('small').textContent = post.href || '';
      button.addEventListener('click', () => selectPost(post.id));
      list.appendChild(button);
    });
  }

  function showCoverSource(src, name, fileSize = '') {
    coverFallback.hidden = true;
    coverImage.hidden = false;
    coverImage.alt = `${selectedPost?.title || '게시물'} 홈페이지 커버 미리보기`;
    coverName.textContent = name;
    coverDimensions.textContent = '확인 중…';
    coverSize.textContent = fileSize || '기존 파일';
    coverMeta.hidden = false;
    coverImage.onload = () => { coverDimensions.textContent = `${coverImage.naturalWidth} × ${coverImage.naturalHeight}px`; };
    coverImage.onerror = () => {
      if (coverObjectUrl && coverImage.src === coverObjectUrl) {
        selectedCover = null;
        coverInput.value = '';
        revokeCoverUrl();
        coverStatus.textContent = '이미지를 읽을 수 없습니다. 다른 JPG, PNG 또는 WebP 파일을 선택해 주세요.';
        showExistingCover();
        return;
      }
      coverImage.hidden = true;
      coverFallback.hidden = false;
      coverFallback.textContent = '커버 이미지를 불러올 수 없습니다.';
      coverMeta.hidden = true;
    };
    coverImage.src = src;
  }

  function showExistingCover() {
    revokeCoverUrl();
    if (selectedPost?.coverImage) {
      showCoverSource(`../../${selectedPost.coverImage}`, selectedPost.coverImage.split('/').pop());
      currentCoverLabel.textContent = selectedPost.coverImage;
    } else {
      coverImage.removeAttribute('src');
      coverImage.hidden = true;
      coverFallback.hidden = false;
      coverFallback.textContent = '현재 커버 없음 · 홈페이지 fallback cover 사용';
      coverMeta.hidden = true;
      currentCoverLabel.textContent = '현재 커버 없음';
    }
  }

  function coverAction() {
    return document.querySelector('input[name="cover-action"]:checked')?.value || 'keep';
  }

  function syncCoverAction() {
    const action = coverAction();
    coverFileField.hidden = action !== 'replace';
    if (action !== 'replace') {
      selectedCover = null;
      coverInput.value = '';
      coverStatus.textContent = 'JPG, PNG, WebP · 최대 4MB';
      showExistingCover();
    } else if (!selectedCover) {
      showExistingCover();
      coverStatus.textContent = '새 커버 이미지를 선택해 주세요.';
    }
    if (action === 'remove') {
      coverImage.hidden = true;
      coverFallback.hidden = false;
      coverFallback.textContent = '저장 후 홈페이지 fallback cover 사용';
      coverMeta.hidden = true;
    }
  }

  function selectPost(id) {
    const next = posts.find((post) => post.id === id);
    if (!next) return;
    selectedPost = next;
    resetReplacementFiles();
    editorEmpty.hidden = true;
    form.hidden = false;
    $('manage-id').value = next.id || '';
    $('manage-href').value = next.href || '';
    $('manage-registered-date').value = next.registeredDate || '';
    $('manage-registered-at').value = next.registeredAt || '';
    $('manage-type').value = next.type || '';
    $('manage-date').value = next.reportDate || next.date || '';
    $('manage-title').value = next.title || '';
    $('manage-subtitle').value = next.subtitle || '';
    $('manage-description').value = next.description || '';
    $('current-report-link').href = `../../${next.href}`;
    document.querySelector('input[name="cover-action"][value="keep"]').checked = true;
    deleteConfirmation.hidden = true;
    deleteTitleConfirm.value = '';
    deleteExpectedTitle.textContent = next.title || '';
    confirmDelete.disabled = true;
    status.textContent = isPreviewHost(location.hostname) ? 'Preview에서는 실제 저장·삭제가 비활성화됩니다.' : '';
    showExistingCover();
    renderList();
  }

  async function chooseHtml(file) {
    revokeHtmlUrl();
    selectedHtml = null;
    if (!file) { htmlStatus.textContent = '기존 공개 URL에 그대로 저장됩니다.'; return; }
    const source = await file.text();
    const error = validateHtml(file, source);
    if (error) { htmlInput.value = ''; htmlStatus.textContent = error; return; }
    selectedHtml = file;
    htmlObjectUrl = URL.createObjectURL(file);
    htmlFrame.src = htmlObjectUrl;
    htmlPreview.hidden = false;
    htmlStatus.textContent = `${file.name} · ${formatBytes(file.size)} · 기존 URL에 교체`;
  }

  function chooseCover(file) {
    revokeCoverUrl();
    selectedCover = null;
    const error = validateCover(file);
    if (error) { coverInput.value = ''; coverStatus.textContent = error; showExistingCover(); return; }
    selectedCover = file;
    coverObjectUrl = URL.createObjectURL(file);
    coverStatus.textContent = `${file.name} · ${formatBytes(file.size)}`;
    showCoverSource(coverObjectUrl, file.name, formatBytes(file.size));
  }

  function buildUpdateForm() {
    const body = new FormData();
    body.append('action', 'update');
    body.append('id', selectedPost.id);
    body.append('type', $('manage-type').value);
    body.append('reportDate', $('manage-date').value);
    body.append('title', $('manage-title').value.trim());
    body.append('subtitle', $('manage-subtitle').value.trim());
    body.append('description', $('manage-description').value.trim());
    body.append('coverAction', coverAction());
    if (selectedHtml) body.append('file', selectedHtml, selectedHtml.name);
    if (coverAction() === 'replace' && selectedCover) body.append('cover', selectedCover, selectedCover.name);
    return body;
  }

  async function mutate(body) {
    const key = adminKey.value.trim();
    if (!key) throw new Error('관리자 키를 입력해 주세요.');
    if (isPreviewHost(location.hostname)) throw new Error('Preview에서는 실제 저장·삭제를 실행할 수 없습니다.');
    try { sessionStorage.setItem('mrs-admin-key', key); } catch (_) {}
    const response = await fetch('/api/manage', { method: 'POST', headers: { 'X-Admin-Key': key }, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `처리 실패 (${response.status})`);
    return data;
  }

  async function save(event) {
    event.preventDefault();
    if (!selectedPost || saving) return;
    if (!$('manage-title').value.trim() || !$('manage-date').value || !$('manage-type').value) {
      status.textContent = '카테고리, 리포트 기준일과 제목을 확인해 주세요.';
      return;
    }
    if (coverAction() === 'replace' && !selectedCover) {
      status.textContent = '교체할 커버 이미지를 선택해 주세요.';
      return;
    }
    if (!confirm('변경사항을 main에 한 커밋으로 저장할까요?')) return;
    saving = true;
    $('save-post').disabled = true;
    status.textContent = '변경사항을 저장하는 중입니다…';
    try {
      const data = await mutate(buildUpdateForm());
      posts = posts.map((post) => post.id === data.post.id ? data.post : post);
      status.textContent = `저장 완료 · commit ${data.commit.slice(0, 7)}`;
      selectPost(data.post.id);
    } catch (error) {
      status.textContent = error.message || '저장하지 못했습니다.';
    } finally {
      saving = false;
      $('save-post').disabled = false;
    }
  }

  async function deletePost() {
    if (!selectedPost || saving || deleteTitleConfirm.value !== selectedPost.title) return;
    const body = new FormData();
    body.append('action', 'delete');
    body.append('id', selectedPost.id);
    saving = true;
    confirmDelete.disabled = true;
    status.textContent = '게시물을 삭제하는 중입니다…';
    try {
      const deletedId = selectedPost.id;
      const data = await mutate(body);
      posts = posts.filter((post) => post.id !== deletedId);
      selectedPost = null;
      form.hidden = true;
      editorEmpty.hidden = false;
      editorEmpty.textContent = `삭제 완료 · commit ${data.commit.slice(0, 7)}`;
      renderList();
    } catch (error) {
      status.textContent = error.message || '삭제하지 못했습니다.';
      confirmDelete.disabled = false;
    } finally {
      saving = false;
    }
  }

  async function loadPosts() {
    try {
      const response = await fetch('../../data/posts.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`목록 요청 실패 (${response.status})`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('게시물 목록 형식이 올바르지 않습니다.');
      posts = sortPosts(data);
      renderList();
    } catch (error) {
      list.innerHTML = `<p class="empty-message"></p>`;
      list.querySelector('p').textContent = error.message || '게시물 목록을 불러오지 못했습니다.';
    }
  }

  try { adminKey.value = sessionStorage.getItem('mrs-admin-key') || ''; } catch (_) {}
  applyTheme(savedTheme());
  themeMedia.addEventListener?.('change', () => { if (savedTheme() === 'system') applyTheme('system'); });
  themeButton?.addEventListener('click', () => {
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('site-theme', next); } catch (_) {}
    applyTheme(next);
  });
  search.addEventListener('input', renderList);
  filters.forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filters.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderList();
  }));
  htmlInput.addEventListener('change', () => chooseHtml(htmlInput.files?.[0] || null));
  coverInput.addEventListener('change', () => chooseCover(coverInput.files?.[0] || null));
  document.querySelectorAll('input[name="cover-action"]').forEach((input) => input.addEventListener('change', syncCoverAction));
  previewModes.forEach((button) => button.addEventListener('click', () => {
    $('manage-cover-preview').dataset.previewMode = button.dataset.previewMode;
    previewModes.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  }));
  form.addEventListener('submit', save);
  startDelete.addEventListener('click', () => {
    if (!selectedPost || !confirm(`“${selectedPost.title}” 게시물 삭제 절차를 시작할까요?`)) return;
    deleteConfirmation.hidden = false;
    deleteTitleConfirm.value = '';
    confirmDelete.disabled = true;
    deleteTitleConfirm.focus();
  });
  deleteTitleConfirm.addEventListener('input', () => { confirmDelete.disabled = !selectedPost || deleteTitleConfirm.value !== selectedPost.title; });
  confirmDelete.addEventListener('click', deletePost);
  window.addEventListener('pagehide', () => { revokeHtmlUrl(); revokeCoverUrl(); });

  window.__adminManageTest = { sortPosts, filteredPosts, validateHtml, validateCover, isPreviewHost };
  loadPosts();
})();
