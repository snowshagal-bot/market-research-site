(() => {
  'use strict';

  const form = document.getElementById('announcement-form');
  if (!form) return;

  const fields = {
    type: document.getElementById('announcement-type'),
    audience: document.getElementById('announcement-audience'),
    targetGroup: document.getElementById('announcement-target-group'),
    title: document.getElementById('announcement-title'),
    content: document.getElementById('announcement-content'),
    start: document.getElementById('announcement-start'),
    end: document.getElementById('announcement-end')
  };
  const targetWrap = document.getElementById('announcement-target-wrap');
  const editorHeading = document.getElementById('announcement-editor-heading');
  const cancelEdit = document.getElementById('announcement-cancel-edit');
  const formStatus = document.getElementById('announcement-form-status');
  const contentCount = document.getElementById('announcement-content-count');
  const search = document.getElementById('announcement-search');
  const filters = document.getElementById('announcement-filters');
  const list = document.getElementById('announcement-list');
  const total = document.getElementById('announcement-total');
  let csrfToken = '';
  let announcements = [];
  let editingId = '';
  let activeFilter = 'all';

  const labels = {
    type: { major: '주요', general: '일반' },
    status: { draft: 'Draft', scheduled: 'Scheduled', published: 'Published', expired: 'Expired' }
  };

  function toUtcFromKst(value) {
    if (!value) return null;
    const date = new Date(`${value}:00+09:00`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function toKstInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
  }

  function kstNowInput() {
    return toKstInput(new Date().toISOString());
  }

  function formatKst(value) {
    if (!value) return '없음';
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(value));
  }

  function setStatus(message, kind = '') {
    formStatus.className = `form-status${kind ? ` ${kind}` : ''}`;
    formStatus.textContent = message;
  }

  function setBusy(busy) {
    for (const button of form.querySelectorAll('button[type="submit"]')) button.disabled = busy;
    cancelEdit.disabled = busy;
  }

  function syncAudience() {
    const grouped = fields.audience.value === 'group';
    targetWrap.hidden = !grouped;
    fields.targetGroup.required = grouped;
    if (!grouped) fields.targetGroup.value = '';
  }

  function syncContentCount() {
    contentCount.textContent = `${fields.content.value.length.toLocaleString('ko-KR')} / 20,000`;
  }

  function resetForm() {
    editingId = '';
    form.reset();
    fields.type.value = 'major';
    fields.audience.value = 'all';
    fields.start.value = kstNowInput();
    editorHeading.textContent = '새 공지 작성';
    cancelEdit.hidden = true;
    syncAudience();
    syncContentCount();
    setStatus('');
  }

  async function api(path, options = {}) {
    const headers = { accept: 'application/json', ...(options.headers || {}) };
    if (options.method && options.method !== 'GET') {
      headers['content-type'] = 'application/json';
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }
    const response = await fetch(path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `요청 실패 (${response.status})`);
    return body;
  }

  async function loadAuth() {
    const response = await fetch('/api/auth/session', { headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.authenticated || body.user?.role !== 'admin') throw new Error('관리자 세션을 확인할 수 없습니다.');
    csrfToken = body.csrfToken || '';
    if (!csrfToken) throw new Error('CSRF 토큰을 확인할 수 없습니다.');
  }

  async function loadAnnouncements() {
    const body = await api('/api/admin/announcements');
    announcements = Array.isArray(body.items) ? body.items : [];
    renderList();
  }

  function appendCell(row, label, text, className = '') {
    const cell = document.createElement('td');
    cell.dataset.label = label;
    if (className) cell.className = className;
    cell.textContent = text;
    row.append(cell);
    return cell;
  }

  function editAnnouncement(item) {
    editingId = item.id;
    fields.type.value = item.noticeType;
    fields.audience.value = item.audience;
    syncAudience();
    fields.targetGroup.value = item.targetGroup || '';
    fields.title.value = item.title;
    fields.content.value = item.content;
    fields.start.value = toKstInput(item.exposureStartAt);
    fields.end.value = toKstInput(item.exposureEndAt);
    editorHeading.textContent = '공지 수정';
    cancelEdit.hidden = false;
    syncContentCount();
    setStatus(`${labels.status[item.status]} 상태의 공지를 수정합니다.`);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fields.title.focus({ preventScroll: true });
  }

  async function removeAnnouncement(item) {
    if (!confirm(`“${item.title}” 공지를 삭제할까요? 삭제 후 복구할 수 없습니다.`)) return;
    try {
      await api(`/api/admin/announcements?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (editingId === item.id) resetForm();
      await loadAnnouncements();
    } catch (error) {
      setStatus(error.message || '공지를 삭제하지 못했습니다.', 'error');
    }
  }

  function renderList() {
    const query = search.value.trim().toLocaleLowerCase('ko-KR');
    const visible = announcements.filter(item => {
      if (query && !item.title.toLocaleLowerCase('ko-KR').includes(query)) return false;
      if (activeFilter === 'major' || activeFilter === 'general') return item.noticeType === activeFilter;
      if (['draft', 'scheduled', 'published', 'expired'].includes(activeFilter)) return item.status === activeFilter;
      return item.status !== 'expired';
    });
    total.textContent = `${visible.length.toLocaleString('ko-KR')}건`;
    list.replaceChildren();
    if (!visible.length) {
      const row = document.createElement('tr');
      const cell = appendCell(row, '', '조건에 맞는 공지가 없습니다.', 'empty-row');
      cell.colSpan = 8;
      list.append(row);
      return;
    }

    for (const item of visible) {
      const row = document.createElement('tr');
      const typeCell = appendCell(row, '유형', labels.type[item.noticeType] || item.noticeType);
      typeCell.className = `type-label ${item.noticeType}`;
      appendCell(row, '제목', item.title, 'title-cell');
      appendCell(row, '대상', item.audience === 'all' ? '전체' : `그룹 · ${item.targetGroup || ''}`);
      const statusCell = appendCell(row, '상태', labels.status[item.status] || item.status);
      statusCell.className = `status-label ${item.status}`;
      appendCell(row, '노출 시작', formatKst(item.exposureStartAt));
      appendCell(row, '노출 종료', formatKst(item.exposureEndAt));
      appendCell(row, '작성 / 수정', `${formatKst(item.createdAt)}\n${formatKst(item.updatedAt)}`);
      const actions = document.createElement('td');
      actions.dataset.label = '작업';
      actions.className = 'actions-cell';
      const wrap = document.createElement('div');
      wrap.className = 'row-actions';
      const edit = document.createElement('button');
      edit.type = 'button'; edit.textContent = '수정'; edit.addEventListener('click', () => editAnnouncement(item));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '삭제'; remove.className = 'danger'; remove.addEventListener('click', () => removeAnnouncement(item));
      wrap.append(edit, remove); actions.append(wrap); row.append(actions); list.append(row);
    }
  }

  fields.audience.addEventListener('change', syncAudience);
  fields.content.addEventListener('input', syncContentCount);
  cancelEdit.addEventListener('click', resetForm);
  search.addEventListener('input', renderList);
  filters.addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    activeFilter = button.dataset.filter;
    for (const candidate of filters.querySelectorAll('[data-filter]')) candidate.setAttribute('aria-pressed', String(candidate === button));
    renderList();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const publishState = event.submitter?.value === 'published' ? 'published' : 'draft';
    if (!form.reportValidity()) return;
    const exposureStartAt = toUtcFromKst(fields.start.value);
    const exposureEndAt = fields.end.value ? toUtcFromKst(fields.end.value) : null;
    if (!exposureStartAt || (fields.end.value && !exposureEndAt)) return setStatus('노출 시각을 확인해 주세요.', 'error');
    if (exposureEndAt && exposureEndAt < exposureStartAt) return setStatus('노출 종료 시각은 시작 시각보다 빠를 수 없습니다.', 'error');
    const payload = {
      id: editingId || undefined,
      noticeType: fields.type.value,
      title: fields.title.value,
      content: fields.content.value,
      audience: fields.audience.value,
      targetGroup: fields.audience.value === 'group' ? fields.targetGroup.value : null,
      publishState,
      exposureStartAt,
      exposureEndAt
    };
    setBusy(true);
    setStatus(publishState === 'draft' ? '임시 저장 중입니다…' : '게시 상태를 저장 중입니다…');
    try {
      await api('/api/admin/announcements', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      const message = editingId ? '공지를 수정했습니다.' : (publishState === 'draft' ? 'Draft로 저장했습니다.' : '게시 설정을 저장했습니다.');
      resetForm();
      setStatus(message, 'success');
      await loadAnnouncements();
    } catch (error) {
      setStatus(error.message || '공지를 저장하지 못했습니다.', 'error');
    } finally { setBusy(false); }
  });

  resetForm();
  (async () => {
    try {
      await loadAuth();
      await loadAnnouncements();
    } catch (error) {
      list.replaceChildren();
      const row = document.createElement('tr');
      const cell = appendCell(row, '', error.message || '공지 목록을 불러오지 못했습니다.', 'empty-row');
      cell.colSpan = 8;
      list.append(row);
      setStatus(error.message || '관리자 세션을 확인할 수 없습니다.', 'error');
      setBusy(true);
    }
  })();
})();
