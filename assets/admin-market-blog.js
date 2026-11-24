// /admin/market/blog/: a published Market Close session as a blog post to paste.
// The text comes from /api/market/share and the picture from the session's own
// card address; the text on this page is saved nowhere. The Telegram card shows
// the session's channel post and can send it (/api/admin/market-telegram).
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

  const telegram = {
    badge: document.getElementById('blog-telegram-badge'),
    status: document.getElementById('blog-telegram-status'),
    caption: document.getElementById('blog-telegram-caption'),
    send: document.getElementById('blog-telegram-send')
  };
  const SEND_LABEL = '텔레그램에 올리기';
  let csrfToken = '';
  let armedUntil = 0;

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
      loadTelegram();
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

  /* -------------------------------------------------------------- telegram */

  function kstTime(value) {
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return '';
    return time.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }

  function disarm() {
    armedUntil = 0;
    telegram.send.textContent = telegram.send.dataset.label || SEND_LABEL;
  }

  function showTelegram(data, note = '') {
    const post = data.post;
    let badge = '아직 안 올림';
    let text = data.date === current.latest ? '장마감 게시 때 자동으로 올라갑니다. 지금 직접 올릴 수도 있습니다.' : '이 날짜는 채널에 올리지 않았습니다.';
    let canSend = Boolean(data.caption);
    let label = SEND_LABEL;
    if (!data.configured) {
      badge = '설정 안 됨';
      text = '텔레그램 봇 토큰과 채널이 아직 설정되지 않았습니다. 설정하면 장마감 게시 직후 자동으로 올라갑니다.';
      canSend = false;
    } else if (post?.status === 'sent') {
      badge = '올림';
      text = `${kstTime(post.postedAt)} KST에 올렸습니다 (${post.withCard ? '카드 포함' : '글만'}).`;
      canSend = false;
    } else if (post?.status === 'pending') {
      badge = '올리는 중';
      text = '올리는 중입니다. 잠시 뒤 다시 불러와 주세요.';
      canSend = false;
    } else if (post?.status === 'failed') {
      badge = '실패';
      text = `올리지 못했습니다${post.detail ? `: ${post.detail}` : '.'}`;
      label = '다시 올리기';
    } else if (!data.caption) {
      text = '이 날짜의 게시된 장마감 기록이 없습니다.';
    }
    telegram.badge.textContent = badge;
    telegram.badge.dataset.state = post?.status || (data.configured ? 'none' : 'off');
    telegram.status.textContent = note || text;
    telegram.caption.value = data.caption || '';
    telegram.caption.hidden = !data.caption;
    telegram.send.dataset.label = label;
    telegram.send.disabled = !canSend;
    disarm();
  }

  function telegramUnavailable(message) {
    telegram.badge.textContent = '확인 불가';
    telegram.badge.dataset.state = 'off';
    telegram.status.textContent = message;
    telegram.caption.hidden = true;
    telegram.send.disabled = true;
    disarm();
  }

  async function loadTelegram() {
    const date = current.date;
    telegram.badge.textContent = '확인 중';
    telegram.send.disabled = true;
    try {
      const response = await fetch(`/api/admin/market-telegram?date=${encodeURIComponent(date)}`, { cache: 'no-store', headers: { accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (date !== current.date) return;
      if (!response.ok) throw new Error(data.message || `상태를 불러오지 못했습니다 (${response.status}).`);
      showTelegram(data);
    } catch (error) {
      if (date === current.date) telegramUnavailable(error.message || '상태를 불러오지 못했습니다.');
    }
  }

  async function csrf() {
    if (csrfToken) return csrfToken;
    const response = await fetch('/api/auth/session', { cache: 'no-store', headers: { accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.authenticated || !body.csrfToken) throw new Error('관리자 세션을 확인할 수 없습니다. 다시 로그인해 주세요.');
    csrfToken = body.csrfToken;
    return csrfToken;
  }

  // A post to the channel is public and cannot be taken back from here, so the
  // button asks for a second press instead of opening a dialog.
  telegram.send.addEventListener('click', async () => {
    if (Date.now() > armedUntil) {
      armedUntil = Date.now() + 5000;
      telegram.send.textContent = '한 번 더 누르면 채널에 올립니다';
      setTimeout(() => { if (armedUntil && Date.now() >= armedUntil) disarm(); }, 5100);
      return;
    }
    const date = current.date;
    armedUntil = 0;
    telegram.send.disabled = true;
    telegram.send.textContent = '올리는 중';
    try {
      const response = await fetch('/api/admin/market-telegram', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': await csrf() },
        body: JSON.stringify({ date })
      });
      const data = await response.json().catch(() => ({}));
      if (date !== current.date) return;
      if (data.date) showTelegram(data, data.ok ? '' : data.message);
      else throw new Error(data.message || `올리지 못했습니다 (${response.status}).`);
    } catch (error) {
      if (date !== current.date) return;
      telegram.status.textContent = error.message || '올리지 못했습니다.';
      telegram.send.disabled = false;
      disarm();
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
