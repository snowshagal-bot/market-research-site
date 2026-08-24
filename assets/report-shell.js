(() => {
  const scriptEl = document.currentScript;
  const active = scriptEl?.dataset.category || '';
  const locale = scriptEl?.dataset.lang === 'en' || /^\/reports\/en\//i.test(location.pathname) ? 'en' : 'ko';
  const targetLocale = locale === 'en' ? 'ko' : 'en';
  const localeApi = window.MARKET_LOCALE;
  const copy = locale === 'en' ? {
    navLabel: 'Report site menu', home: '← Home', daily: 'Daily', weekly: 'Weekly', research: 'Research', basics: 'Market Basics', note: 'Notes', about: 'About', switchLabel: 'Read in Korean', switchText: 'KO',
    comments: 'Comments', write: 'Write a comment', close: 'Close', nickname: 'Nickname', password: 'Deletion password', body: 'Write a comment.', website: 'Website', noteText: 'No account required · The password is used only for deletion.', submit: 'Post comment', loading: 'Loading comments…', empty: 'No comments yet.', delete: 'Delete',
    loadError: 'Could not load comments.', dbTitle: 'Comments are being prepared', dbText: 'Comments will be available after the database is connected.', retry: 'Please try again later.', posting: 'Posting…', postError: 'Could not post the comment.', posted: 'Comment posted.', deletePrompt: 'Enter the deletion password.', deleteError: 'Could not delete the comment.'
  } : {
    navLabel: '리포트 사이트 메뉴', home: '← 홈', daily: '데일리', weekly: '위클리', research: '리서치', basics: '시장 공부', note: '끄적끄적', about: '소개', switchLabel: '영어로 읽기', switchText: 'EN',
    comments: '댓글', write: '댓글 쓰기', close: '닫기', nickname: '닉네임', password: '삭제용 비밀번호', body: '댓글을 입력하세요.', website: '웹사이트', noteText: '회원가입 없이 작성 · 비밀번호는 삭제할 때만 사용됩니다.', submit: '댓글 등록', loading: '댓글을 불러오는 중…', empty: '아직 댓글이 없습니다.', delete: '삭제',
    loadError: '댓글을 불러오지 못했습니다.', dbTitle: '댓글 기능 준비 중', dbText: '데이터베이스 연결 후 사용할 수 있습니다.', retry: '잠시 후 다시 시도해주세요.', posting: '등록 중…', postError: '댓글을 등록하지 못했습니다.', posted: '댓글이 등록되었습니다.', deletePrompt: '댓글 삭제 비밀번호를 입력하세요.', deleteError: '댓글을 삭제하지 못했습니다.'
  };
  const homePath = locale === 'en' ? '/en/' : '/';
  const aboutPath = locale === 'en' ? '/en/about/' : '/about/';
  const BAR_H = 52;
  const themeMedia = matchMedia('(prefers-color-scheme: dark)');
  const shellHosts = [];

  function savedTheme() {
    try { return localStorage.getItem('site-theme') || 'system'; }
    catch (_) { return 'system'; }
  }

  function resolvedTheme() {
    const preference = savedTheme();
    return preference === 'system' ? (themeMedia.matches ? 'dark' : 'light') : preference;
  }

  function applyShellTheme() {
    const theme = resolvedTheme();
    shellHosts.forEach(host => { host.dataset.theme = theme; });
  }

  themeMedia.addEventListener?.('change', () => {
    if (savedTheme() === 'system') applyShellTheme();
  });
  window.addEventListener('storage', event => {
    if (event.key === 'site-theme') applyShellTheme();
  });

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
    shellHosts.push(host);
    applyShellTheme();
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
        :host{all:initial}*{box-sizing:border-box}.bar{width:100%;height:52px;background:rgba(247,243,235,.97);border-bottom:1px solid #d8d0c2;box-shadow:0 1px 8px rgba(20,24,21,.05);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:Inter,Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,-apple-system,sans-serif}.inner{width:min(1180px,100%);height:100%;margin:0 auto;padding:0 22px;display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.inner::-webkit-scrollbar{display:none}a{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 12px;border-radius:999px;color:#535850;text-decoration:none;white-space:nowrap;font-size:13px;line-height:1;font-weight:700;letter-spacing:-.015em;border:1px solid transparent;transition:background .15s ease,color .15s ease,border-color .15s ease;cursor:pointer}a:hover{background:#ebe5da;color:#1f2420}.home{color:#1f2420;font-weight:850}.language{font-size:11px;font-weight:850;letter-spacing:.06em}.active{background:#222622;color:#fff;border-color:#222622}.active:hover{background:#222622;color:#fff}.divider{width:1px;height:20px;background:#d8d0c2;flex:0 0 auto;margin:0 3px}.brand{margin-left:auto;font-size:11px;font-weight:800;letter-spacing:.12em;color:#8a877f;white-space:nowrap}@media(max-width:680px){.inner{width:100%;margin:0;padding:0 8px;gap:2px}a{min-height:32px;padding:0 10px;font-size:12px}.divider{margin:0 1px}.brand{display:none}}
      </style>
      <style>
        :host{--shell-bg:rgba(247,243,235,.97);--shell-panel:#ebe5da;--shell-text:#1f2420;--shell-text-2:#535850;--shell-muted:#666c67;--shell-line:#d8d0c2;--shell-active:#222622;--shell-active-text:#fff;--shell-focus:#344b40}
        :host([data-theme="dark"]){--shell-bg:rgba(28,31,28,.97);--shell-panel:#222622;--shell-text:#edf0ec;--shell-text-2:#b9c0ba;--shell-muted:#aab1aa;--shell-line:#3b423c;--shell-active:#edf0ec;--shell-active-text:#161816;--shell-focus:#a8c1b1}
        .bar{background:var(--shell-bg);border-bottom-color:var(--shell-line)}a{color:var(--shell-text-2)}a:hover{background:var(--shell-panel);color:var(--shell-text)}.home{color:var(--shell-text)}.active,.active:hover{background:var(--shell-active);color:var(--shell-active-text);border-color:var(--shell-active)}.divider{background:var(--shell-line)}.brand{color:var(--shell-muted)}a:focus-visible{outline:2px solid var(--shell-focus);outline-offset:2px}
      </style>
      <nav class="bar" aria-label="${copy.navLabel}"><div class="inner">
        <a class="home" href="${homePath}">${copy.home}</a><span class="divider" aria-hidden="true"></span>
        <a class="${active === 'daily' ? 'active' : ''}" ${active === 'daily' ? 'aria-current="true"' : ''} href="${homePath}?category=daily">${copy.daily}</a>
        <a class="${active === 'weekly' ? 'active' : ''}" ${active === 'weekly' ? 'aria-current="true"' : ''} href="${homePath}?category=weekly">${copy.weekly}</a>
        <a class="${active === 'research' ? 'active' : ''}" ${active === 'research' ? 'aria-current="true"' : ''} href="${homePath}?category=research">${copy.research}</a>
        <a class="${active === 'basics' ? 'active' : ''}" ${active === 'basics' ? 'aria-current="true"' : ''} href="${homePath}?category=basics">${copy.basics}</a>
        <a class="${active === 'note' ? 'active' : ''}" ${active === 'note' ? 'aria-current="true"' : ''} href="${homePath}?category=note">${copy.note}</a>
        <a href="${aboutPath}">${copy.about}</a>
        <a class="language" id="report-language-switch" href="${targetLocale === 'en' ? '/en/' : '/'}" aria-label="${copy.switchLabel}">${copy.switchText}</a>
        <span class="brand">MARKET RESEARCH</span>
      </div></nav>`;

    const languageLink = root.getElementById('report-language-switch');
    languageLink?.addEventListener('click', () => {
      try { localStorage.setItem('site-language', targetLocale); } catch (_) {}
    });
    void resolveReportLanguageLink(languageLink);
  }

  async function resolveReportLanguageLink(link) {
    if (!link || !localeApi) return;
    const fallback = localeApi.homepagePath(targetLocale);
    link.href = fallback;
    try {
      const response = await fetch(`/data/posts.json?langswitch=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      const posts = await response.json();
      const counterpart = localeApi.findCounterpart(posts, location.pathname, targetLocale);
      if (counterpart?.href) link.href = `/${String(counterpart.href).replace(/^\/+/, '')}`;
    } catch (_) {}
  }

  function reportKey() {
    try { return decodeURIComponent(location.pathname); }
    catch (_) { return location.pathname; }
  }

  function mountComments() {
    if (document.getElementById('mrs-comments-host')) return;

    const host = document.createElement('section');
    host.id = 'mrs-comments-host';
    host.setAttribute('aria-label', copy.comments);
    shellHosts.push(host);
    applyShellTheme();
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
      <style>
        :host{--comments-bg:#f7f3eb;--comments-panel:#fbf8f1;--comments-hover:#eee8dd;--comments-text:#22241f;--comments-text-2:#41433e;--comments-muted:#666c67;--comments-line:#d8d0c2;--comments-primary:#222622;--comments-primary-text:#fff;--comments-focus:#344b40;--comments-status:#6d5b3e}
        :host([data-theme="dark"]){--comments-bg:#1c1f1c;--comments-panel:#222622;--comments-hover:#2b302b;--comments-text:#edf0ec;--comments-text-2:#c2c8c2;--comments-muted:#aab1aa;--comments-line:#3b423c;--comments-primary:#edf0ec;--comments-primary-text:#161816;--comments-focus:#a8c1b1;--comments-status:#d5bd96}
        .wrap{background:var(--comments-bg);color:var(--comments-text);border-top-color:var(--comments-line)}.head,.form{border-bottom-color:var(--comments-line)}.count,.note,.empty,.loading,.unavailable,.date,.delete{color:var(--comments-muted)}.compose-toggle,.input,.textarea{background:var(--comments-panel);color:var(--comments-text);border-color:var(--comments-line)}.input::placeholder,.textarea::placeholder{color:var(--comments-muted);opacity:1}.compose-toggle:hover{background:var(--comments-hover)}.input:focus,.textarea:focus{border-color:var(--comments-focus)}.submit{background:var(--comments-primary);color:var(--comments-primary-text)}.submit:hover{background:var(--comments-primary);filter:brightness(.92)}.status{color:var(--comments-status)}.comment{border-bottom-color:var(--comments-line)}.nickname{color:var(--comments-text)}.delete:hover{color:var(--comments-text)}.body,.unavailable b{color:var(--comments-text-2)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--comments-focus);outline-offset:2px}
      </style>
      <div class="wrap"><div class="inner">
        <div class="head"><h2>${copy.comments}</h2><div class="head-actions"><span class="count" id="count">0</span><button class="compose-toggle" id="compose-toggle" type="button" aria-expanded="false">${copy.write}</button></div></div>
        <form class="form" id="comment-form">
          <div class="fields"><input class="input" id="nickname" maxlength="20" placeholder="${copy.nickname}" aria-label="${copy.nickname}" autocomplete="nickname" required><input class="input" id="password" type="password" minlength="4" maxlength="64" placeholder="${copy.password}" aria-label="${copy.password}" autocomplete="new-password" required></div>
          <textarea class="textarea" id="body" maxlength="1000" placeholder="${copy.body}" aria-label="${copy.body}" required></textarea>
          <label class="hp" aria-hidden="true">${copy.website}<input id="website" tabindex="-1" autocomplete="off"></label>
          <div class="form-bottom"><span class="note">${copy.noteText}</span><button class="submit" id="submit" type="submit">${copy.submit}</button></div>
          <div class="status" id="status" aria-live="polite"></div>
        </form>
        <div class="list" id="list"><div class="loading">${copy.loading}</div></div>
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
      composeToggle.textContent = open ? copy.close : copy.write;
      if (open && focus) setTimeout(() => nickname.focus(), 0);
    }

    composeToggle.addEventListener('click', () => {
      const open = !form.classList.contains('open');
      setComposer(open, open);
    });

    function formatDate(value) {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ko-KR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(d);
    }

    function render() {
      count.textContent = String(comments.length);
      list.innerHTML = '';
      if (!comments.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = copy.empty;
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
        del.textContent = copy.delete;
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
        if (!res.ok) throw Object.assign(new Error(locale === 'en' ? copy.loadError : (data.message || copy.loadError)), { code: data.error });
        comments = Array.isArray(data.comments) ? data.comments : [];
        render();
      } catch (err) {
        list.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'unavailable';
        const b = document.createElement('b');
        b.textContent = err.code === 'DB_NOT_CONFIGURED' ? copy.dbTitle : copy.loadError;
        const small = document.createElement('span');
        small.textContent = err.code === 'DB_NOT_CONFIGURED' ? copy.dbText : copy.retry;
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
      submit.textContent = copy.posting;
      status.textContent = '';
      try {
        const res = await fetch('/api/comments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(locale === 'en' ? copy.postError : (data.message || copy.postError));
        if (data.comment) comments.push(data.comment);
        try { localStorage.setItem('mrs-comment-nickname', payload.nickname); } catch (_) {}
        body.value = '';
        password.value = '';
        status.textContent = copy.posted;
        render();
        if (isMobile()) setComposer(false);
      } catch (err) {
        status.textContent = err.message || copy.postError;
      } finally {
        submit.disabled = false;
        submit.textContent = copy.submit;
      }
    });

    async function deleteComment(comment) {
      const pw = prompt(copy.deletePrompt);
      if (pw === null) return;
      try {
        const res = await fetch('/api/comments', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: comment.id, report: key, password: pw })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(locale === 'en' ? copy.deleteError : (data.message || copy.deleteError));
        comments = comments.filter(c => c.id !== comment.id);
        render();
      } catch (err) {
        alert(err.message || copy.deleteError);
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
