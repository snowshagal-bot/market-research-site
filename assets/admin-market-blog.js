// /admin/market/blog/: a published Market Close session as a blog post to paste.
// The text comes from /api/market/share and the picture from the session's own
// card address; nothing on this page is saved anywhere.
(() => {
  'use strict';

  const dateSelect = document.getElementById('blog-date');
  if (!dateSelect) return;

  const fields = {
    title: document.getElementById('blog-title'),
    body: document.getElementById('blog-body'),
    tags: document.getElementById('blog-tags')
  };
  const status = document.getElementById('blog-status');
  const bodyCount = document.getElementById('blog-body-count');
  const pageLink = document.getElementById('blog-page-link');
  const reload = document.getElementById('blog-reload');
  const image = document.getElementById('blog-image');
  const imageEmpty = document.getElementById('blog-image-empty');
  const imageCopy = document.getElementById('blog-image-copy');
  const imageSave = document.getElementById('blog-image-save');
  const imageRetry = document.getElementById('blog-image-retry');
  const imageStatus = document.getElementById('blog-image-status');

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  let current = { date: '', latest: '' };
  let cardBlob = null;
  let cardUrl = '';
  let loadToken = 0;

  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `blog-status${kind ? ` ${kind}` : ''}`;
  };

  function dateLabel(date) {
    const [y, m, d] = date.split('-').map(Number);
    return `${date} (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
  }

  function updateCount() {
    bodyCount.textContent = `${fields.body.value.length.toLocaleString('ko-KR')}자`;
  }

  /* ------------------------------------------------------------------ text */

  async function loadPost(date = '') {
    const token = ++loadToken;
    setStatus('불러오는 중입니다.');
    reload.disabled = true;
    try {
      const response = await fetch(`/api/market/share${date ? `?date=${encodeURIComponent(date)}` : ''}`, { cache: 'no-store', headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (token !== loadToken) return;
      if (!response.ok) throw new Error(data.message || `불러오지 못했습니다 (${response.status}).`);
      current = { date: data.date, latest: data.latest };
      fields.title.value = data.title || '';
      fields.body.value = data.body || '';
      fields.tags.value = data.tags || '';
      updateCount();
      pageLink.href = data.pageUrl || pageLink.href;
      dateSelect.replaceChildren(...(data.dates || [data.date]).map(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value === data.latest ? `${dateLabel(value)} · 최신` : dateLabel(value);
        return option;
      }));
      dateSelect.value = data.date;
      dateSelect.disabled = false;
      setStatus(`${dateLabel(data.date)} 장마감 기록으로 만들었습니다.`);
      loadCard();
    } catch (error) {
      if (token !== loadToken) return;
      setStatus(error.message || '불러오지 못했습니다.', 'error');
    } finally {
      if (token === loadToken) reload.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ copy */

  async function writeText(text) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* fall through to the selection copy */ }
    }
    return false;
  }

  // The older selection copy: works where the clipboard API is refused.
  function copyFromField(field) {
    field.focus();
    field.select();
    try { return document.execCommand('copy'); } catch (_) { return false; }
  }

  function flash(button, text) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = text;
    clearTimeout(button._flash);
    button._flash = setTimeout(() => { button.textContent = original; }, 1600);
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const field = document.getElementById(button.dataset.copy);
    if (!field || !field.value) return;
    const done = await writeText(field.value) || copyFromField(field);
    flash(button, done ? '복사했습니다' : '복사 실패');
    if (!done) setStatus('복사하지 못했습니다. 칸을 눌러 전체 선택한 뒤 직접 복사해 주세요.', 'error');
  });

  /* ------------------------------------------------------------------ card */

  function showCard(blob) {
    if (cardUrl) URL.revokeObjectURL(cardUrl);
    cardBlob = blob;
    cardUrl = blob ? URL.createObjectURL(blob) : '';
    image.hidden = !blob;
    imageEmpty.hidden = Boolean(blob);
    if (blob) {
      image.src = cardUrl;
      image.alt = `${current.date} 장마감 요약 카드`;
      imageSave.href = cardUrl;
      imageSave.download = `snowshagal-market-${current.date}.jpg`;
      imageSave.removeAttribute('aria-disabled');
    } else {
      image.removeAttribute('src');
      imageSave.removeAttribute('href');
      imageSave.setAttribute('aria-disabled', 'true');
    }
    imageCopy.disabled = !blob;
  }

  async function loadCard() {
    const date = current.date;
    showCard(null);
    imageRetry.hidden = true;
    imageStatus.textContent = '';
    imageEmpty.textContent = '카드를 확인하는 중입니다.';
    try {
      // Without a stored card the address answers with a redirect to the
      // site's default share image; only the session's own JPEG counts.
      const response = await fetch(`/market/${date}/card.jpg?t=${Date.now()}`, { cache: 'no-store', redirect: 'manual' });
      if (date !== current.date) return;
      const type = response.headers.get('content-type') || '';
      if (response.status !== 200 || !type.startsWith('image/')) throw new Error('no card');
      const blob = await response.blob();
      if (date !== current.date) return;
      showCard(blob);
      imageStatus.textContent = `1200×630 · ${Math.round(blob.size / 1024).toLocaleString('ko-KR')}KB`;
    } catch (_) {
      if (date !== current.date) return;
      const latest = date === current.latest;
      imageEmpty.textContent = latest
        ? '이 날짜의 카드가 아직 없습니다. 지금 만들기 시작했으니 1분쯤 뒤 다시 확인해 주세요.'
        : '이 날짜에는 카드가 없습니다. 카드는 최신 거래일부터 만들어집니다.';
      imageRetry.hidden = !latest;
    }
  }

  async function pngOf(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('png')), 'image/png'));
  }

  imageCopy.addEventListener('click', async () => {
    if (!cardBlob) return;
    try {
      // Browsers put only PNG on the clipboard, so the JPEG is redrawn once.
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(cardBlob) })]);
      flash(imageCopy, '복사했습니다');
      imageStatus.textContent = '이미지를 복사했습니다. 블로그 본문에서 붙여 넣으세요.';
    } catch (_) {
      flash(imageCopy, '복사 실패');
      imageStatus.textContent = '이 브라우저에서는 이미지 복사가 되지 않습니다. 파일로 저장한 뒤 사진으로 올려 주세요.';
    }
  });

  imageSave.addEventListener('click', (event) => {
    if (imageSave.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });
  imageRetry.addEventListener('click', loadCard);
  dateSelect.addEventListener('change', () => loadPost(dateSelect.value));
  reload.addEventListener('click', () => loadPost(current.date));
  fields.body.addEventListener('input', updateCount);

  loadPost();
})();
