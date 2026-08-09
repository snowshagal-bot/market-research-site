(() => {
  const scriptEl = document.currentScript;
  const active = scriptEl?.dataset.category || '';
  const BAR_H = 52;

  function mountReportNav() {
    if (document.getElementById('mrs-nav-host')) return;

    const spacer = document.createElement('div');
    spacer.id = 'mrs-nav-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    for (const [key, value] of Object.entries({
      display: 'block', width: '100%', height: BAR_H + 'px', minHeight: BAR_H + 'px',
      maxHeight: BAR_H + 'px', margin: '0', padding: '0', border: '0', flex: '0 0 ' + BAR_H + 'px'
    })) spacer.style.setProperty(key, value, 'important');
    if (document.body.firstChild) document.body.insertBefore(spacer, document.body.firstChild);
    else document.body.appendChild(spacer);

    const host = document.createElement('div');
    host.id = 'mrs-nav-host';
    const hostStyles = {
      all: 'initial', position: 'fixed', top: '0', left: '0', right: '0', width: '100vw',
      height: BAR_H + 'px', zIndex: '2147483647', display: 'block', pointerEvents: 'auto',
      transform: 'none', zoom: '1'
    };
    for (const [key, value] of Object.entries(hostStyles)) host.style.setProperty(key, value, 'important');

    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}.bar{width:100%;height:52px;background:rgba(247,243,235,.97);border-bottom:1px solid #d8d0c2;box-shadow:0 1px 8px rgba(20,24,21,.05);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:Inter,Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,-apple-system,sans-serif}.inner{width:min(1180px,100%);height:100%;margin:0 auto;padding:0 22px;display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.inner::-webkit-scrollbar{display:none}a{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 12px;border-radius:999px;color:#535850;text-decoration:none;white-space:nowrap;font-size:13px;line-height:1;font-weight:700;letter-spacing:-.015em;border:1px solid transparent;transition:background .15s ease,color .15s ease,border-color .15s ease;cursor:pointer}a:hover{background:#ebe5da;color:#1f2420}.home{color:#1f2420;font-weight:850}.active{background:#222622;color:#fff;border-color:#222622}.active:hover{background:#222622;color:#fff}.divider{width:1px;height:20px;background:#d8d0c2;flex:0 0 auto;margin:0 3px}.brand{margin-left:auto;font-size:11px;font-weight:800;letter-spacing:.12em;color:#8a877f;white-space:nowrap}@media(max-width:680px){.inner{width:100%;margin:0;padding:0 8px;gap:2px}a{min-height:32px;padding:0 10px;font-size:12px}.divider{margin:0 1px}.brand{display:none}}
      </style>
      <nav class="bar" aria-label="리포트 사이트 메뉴"><div class="inner">
        <a class="home" href="/">← 홈</a><span class="divider" aria-hidden="true"></span>
        <a class="${active === 'daily' ? 'active' : ''}" href="/?category=daily">데일리</a>
        <a class="${active === 'weekly' ? 'active' : ''}" href="/?category=weekly">위클리</a>
        <a class="${active === 'research' ? 'active' : ''}" href="/?category=research">비정기</a>
        <a class="${active === 'note' ? 'active' : ''}" href="/?category=note">끄적끄적</a>
        <span class="brand">MARKET RESEARCH</span>
      </div></nav>`;
  }

  function reportKey() {
    try { return decodeURIComponent(location.pathname); }
    catch (_) { return location.pathname; }
  }

  function mountComments() {
    if (document.getElementById('mrs-comments-host')) return;

    const host = document.createElement('section');
    host.id = 'mrs-comments-host';
    host.setAttribute('aria-label', '댓글');
    const hostStyles = {
      all: 'initial', display: 'block', position: 'relative', width: '100%', maxWidth: '100%',
      clear: 'both', flex: '0 0 100%', margin: '0', padding: '0', border: '0', boxSizing: 'border-box'
    };
    for (const [key, value] of Object.entries(hostStyles)) host.style.setProperty(key, value, 'important');
    document.body.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}.wrap{background:#f7f3eb;color:#22241f;border-top:1px solid #d8d0c2;padding:54px 20px 70px;font-family:Inter,Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,-apple-system,sans-serif;line-height:1.55}.inner{width:min(820px,100%);margin:0 auto}.head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:15px;border-bottom:1px solid #d8d0c2}.head h2{margin:0;font-size:21px;line-height:1.2;letter-spacing:-.035em}.head-actions{display:flex;align-items:center;gap:10px}.count{font-size:12px;color:#77776f}.compose-toggle{display:none;min-height:32px;padding:0 12px;border:1px solid #d8d0c2;border-radius:999px;background:#fbf8f1;color:#333730;font:inherit;font-size:11px;font-weight:800;cursor:pointer}.compose-toggle:hover{background:#eee8dd}.compose-toggle:disabled{opacity:.45;cursor:default}.form{padding:20px 0 22px;border-bottom:1px solid #d8d0c2}.fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.input,.textarea{width:100%;border:1px solid #d8d0c2;border-radius:10px;background:#fbf8f1;color:#22241f;font:inherit;font-size:14px;outline:none}.input{height:42px;padding:0 12px}.textarea{min-height:96px;padding:11px 12px;resize:vertical;margin-top:10px}.input:focus,.textarea:focus{border-color:#6d786e;box-shadow:0 0 0 2px rgba(65,82,70,.07)}.form-bottom{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px}.note{font-size:11px;color:#7d7d75}.submit{min-height:38px;padding:0 18px;border:0;border-radius:999px;background:#222622;color:#fff;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.submit:hover{background:#343934}.submit:disabled{opacity:.45;cursor:default}.hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;overflow:hidden!important}.status{min-height:20px;padding-top:9px;font-size:11px;color:#786c58}.list{display:grid}.empty,.loading,.unavailable{padding:28px 0;color:#88877f;font-size:13px}.comment{padding:18px 0;border-bottom:1px solid #e0d9ce}.comment-head{display:flex;align-items:center;gap:9px;margin-bottom:7px}.nickname{font-size:13px;font-weight:850;color:#242722}.date{font-size:10px;color:#949088}.delete{margin-left:auto;border:0;background:none;padding:4px 0 4px 8px;color:#969189;font:inherit;font-size:10px;cursor:pointer}.delete:hover{color:#22241f}.body{margin:0;color:#41433e;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}.unavailable{padding:22px 0}.unavailable b{display:block;color:#555750;margin-bottom:3px}.disabled-form{opacity:.45;pointer-events:none}@media(max-width:600px){.wrap{padding:34px 14px 48px}.head{padding-bottom:13px}.head h2{font-size:19px}.head-actions{gap:8px}.compose-toggle{display:inline-flex;align-items:center;justify-content:center}.form{display:none;padding:16px 0 20px}.form.open{display:block}.fields{grid-template-columns:1fr}.form-bottom{align-items:flex-start;flex-direction:column}.submit{width:100%}.textarea{min-height:105px}.comment{padding:16px 0}.body{font-size:13px}.empty,.loading,.unavailable{padding:22px 0}}
      </style>
      <div class="wrap"><div class="inner">
        <div class="head"><h2>댓글</h2><div class="head-actions"><span class="count" id="count">0</span><button class="compose-toggle" id="compose-toggle" type="button" aria-expanded="false">댓글 쓰기</button></div></div>
        <form class="form" id="comment-form">
          <div class="fields"><input class="input" id="nickname" maxlength="20" placeholder="닉네임" autocomplete="nickname" required><input class="input" id="password" type="password" minlength="4" maxlength="64" placeholder="삭제용 비밀번호" autocomplete="new-password" required></div>
          <textarea class="textarea" id="body" maxlength="1000" placeholder="댓글을 입력하세요." required></textarea>
          <label class="hp" aria-hidden="true">웹사이트<input id="website" tabindex="-1" autocomplete="off"></label>
          <div class="form-bottom"><span class="note">회원가입 없이 작성 · 비밀번호는 삭제할 때만 사용됩니다.</span><button class="submit" id="submit" type="submit">댓글 등록</button></div>
          <div class="status" id="status" aria-live="polite"></div>
        </form>
        <div class="list" id="list"><div class="loading">댓글을 불러오는 중…</div></div>
      </div></div>`;

    const $ = id => root.getElementById(id);
    const form = $('comment-form');
    const nickname = $('nickname');
    const password = $('password');
    const body = $('body');
    const website = $('website');
    const submit = $('submit');
    const status = $('status');
    const list = $('list');
    const count = $('count');
    const composeToggle = $('compose-toggle');
    const key = reportKey();
    let comments = [];

    try { nickname.value = localStorage.getItem('mrs-comment-nickname') || ''; } catch (_) {}

    function isMobile() {
      return window.matchMedia('(max-width: 600px)').matches;
    }

    function setComposer(open, focus = false) {
      if (!isMobile()) return;
      form.classList.toggle('open', open);
      composeToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      composeToggle.textContent = open ? '닫기' : '댓글 쓰기';
      if (open && focus) setTimeout(() => nickname.focus(), 0);
    }

    composeToggle.addEventListener('click', () => {
      const open = !form.classList.contains('open');
      setComposer(open, open);
    });

    function formatDate(value) {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(d);
    }

    function render() {
      count.textContent = String(comments.length);
      list.innerHTML = '';
      if (!comments.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '아직 댓글이 없습니다.';
        list.appendChild(empty);
        return;
      }
      comments.forEach(comment => {
        const item = document.createElement('article');
        item.className = 'comment';
        const head = document.createElement('div');
        head.className = 'comment-head';
        const name = document.createElement('span');
        name.className = 'nickname';
        name.textContent = comment.nickname;
        const date = document.createElement('time');
        date.className = 'date';
        date.dateTime = comment.createdAt;
        date.textContent = formatDate(comment.createdAt);
        const del = document.createElement('button');
        del.className = 'delete';
        del.type = 'button';
        del.textContent = '삭제';
        del.addEventListener('click', () => deleteComment(comment));
        const text = document.createElement('p');
        text.className = 'body';
        text.textContent = comment.body;
        head.append(name, date, del);
        item.append(head, text);
        list.appendChild(item);
      });
    }

    async function load() {
      try {
        const res = await fetch('/api/comments?report=' + encodeURIComponent(key), { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.message || '댓글을 불러오지 못했습니다.'), { code: data.error });
        comments = Array.isArray(data.comments) ? data.comments : [];
        render();
      } catch (err) {
        list.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'unavailable';
        const b = document.createElement('b');
        b.textContent = err.code === 'DB_NOT_CONFIGURED' ? '댓글 기능 준비 중' : '댓글을 불러오지 못했습니다.';
        const small = document.createElement('span');
        small.textContent = err.code === 'DB_NOT_CONFIGURED' ? '데이터베이스 연결 후 사용할 수 있습니다.' : '잠시 후 다시 시도해주세요.';
        box.append(b, small);
        list.appendChild(box);
        form.classList.add('disabled-form');
        submit.disabled = true;
        composeToggle.disabled = true;
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;
      const payload = {
        report: key,
        nickname: nickname.value.trim(),
        password: password.value,
        body: body.value.trim(),
        website: website.value
      };
      submit.disabled = true;
      submit.textContent = '등록 중…';
      status.textContent = '';
      try {
        const res = await fetch('/api/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || '댓글을 등록하지 못했습니다.');
        if (data.comment) comments.push(data.comment);
        try { localStorage.setItem('mrs-comment-nickname', payload.nickname); } catch (_) {}
        body.value = '';
        password.value = '';
        status.textContent = '댓글이 등록되었습니다.';
        render();
        if (isMobile()) setComposer(false);
      } catch (err) {
        status.textContent = err.message || '댓글 등록 중 오류가 발생했습니다.';
      } finally {
        submit.disabled = false;
        submit.textContent = '댓글 등록';
      }
    });

    async function deleteComment(comment) {
      const pw = prompt('댓글 삭제 비밀번호를 입력하세요.');
      if (pw === null) return;
      try {
        const res = await fetch('/api/comments', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: comment.id, report: key, password: pw })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || '댓글을 삭제하지 못했습니다.');
        comments = comments.filter(c => c.id !== comment.id);
        render();
      } catch (err) {
        alert(err.message || '댓글 삭제 중 오류가 발생했습니다.');
      }
    }

    load();
  }

  function mount() {
    mountReportNav();
    mountComments();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
