(() => {
  const scriptEl = document.currentScript;
  const active = scriptEl?.dataset.category || '';
  // Mirrors the homepage: the 끄적끄적 entry point appears once a note exists.
  const hasNotes = scriptEl?.dataset.notes === '1';
  const locale = scriptEl?.dataset.lang === 'en' || /^\/reports\/en\//i.test(location.pathname) ? 'en' : 'ko';
  const targetLocale = locale === 'en' ? 'ko' : 'en';
  const localeApi = window.MARKET_LOCALE;
  const copy = locale === 'en' ? {
    navLabel: 'Report site menu', home: '← Home', daily: 'Daily', weekly: 'Weekly', research: 'Research', basics: 'Market Basics', note: 'Notes', market: 'Market', switchLabel: 'Read in Korean', switchText: 'KO',
    comments: 'Comments', write: 'Write a comment', close: 'Close', nickname: 'Nickname', password: 'Deletion password', body: 'Write a comment.', website: 'Website', noteText: 'No account required · The password is used only for deletion.', submit: 'Post comment', loading: 'Loading comments…', empty: 'No comments yet.', delete: 'Delete',
    loadError: 'Could not load comments.', dbTitle: 'Comments are being prepared', dbText: 'Comments will be available after the database is connected.', retry: 'Please try again later.', posting: 'Posting…', postError: 'Could not post the comment.', posted: 'Comment posted.', deletePrompt: 'Enter the deletion password.', deleteError: 'Could not delete the comment.',
    shareHeading: 'Share', sharePrompt: 'Share this report', shareAction: 'Share', shareCopy: 'Copy link',
    shareCopied: 'Link copied', shareCopyManual: 'Copy this link:', shareFailed: 'Could not share this report.',
    shareAppsHint: 'Use your device share menu for Instagram and other apps'
  } : {
    navLabel: '리포트 사이트 메뉴', home: '← 홈', daily: '데일리', weekly: '위클리', research: '리서치', basics: '시장 공부', note: '끄적끄적', market: '마켓', switchLabel: '영어로 읽기', switchText: 'EN',
    comments: '댓글', write: '댓글 쓰기', close: '닫기', nickname: '닉네임', password: '삭제용 비밀번호', body: '댓글을 입력하세요.', website: '웹사이트', noteText: '회원가입 없이 작성 · 비밀번호는 삭제할 때만 사용됩니다.', submit: '댓글 등록', loading: '댓글을 불러오는 중…', empty: '아직 댓글이 없습니다.', delete: '삭제',
    loadError: '댓글을 불러오지 못했습니다.', dbTitle: '댓글 기능 준비 중', dbText: '데이터베이스 연결 후 사용할 수 있습니다.', retry: '잠시 후 다시 시도해주세요.', posting: '등록 중…', postError: '댓글을 등록하지 못했습니다.', posted: '댓글이 등록되었습니다.', deletePrompt: '댓글 삭제 비밀번호를 입력하세요.', deleteError: '댓글을 삭제하지 못했습니다.',
    shareHeading: '공유', sharePrompt: '이 리포트를 공유하기', shareAction: '공유하기', shareCopy: '링크 복사',
    shareCopied: '링크를 복사했습니다', shareCopyManual: '아래 링크를 복사하세요:', shareFailed: '공유하지 못했습니다.',
    shareAppsHint: 'Instagram·KakaoTalk 등은 기기 공유 메뉴에서 선택'
  };
  const homePath = locale === 'en' ? '/en/' : '/';
  const marketPath = locale === 'en' ? '/en/market/' : '/market/';
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
        :host{all:initial}*{box-sizing:border-box}.bar{width:100%;height:52px;background:rgba(247,243,235,.97);border-bottom:1px solid #d8d0c2;box-shadow:0 1px 8px rgba(20,24,21,.05);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:Inter,Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,-apple-system,sans-serif}.inner{width:min(1180px,100%);height:100%;margin:0 auto;padding:0 22px;display:flex;align-items:center;gap:6px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}.inner::-webkit-scrollbar{display:none}a{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 12px;border-radius:999px;color:#535850;text-decoration:none;white-space:nowrap;font-size:14px;line-height:1;font-weight:700;letter-spacing:-.015em;border:1px solid transparent;transition:background .15s ease,color .15s ease,border-color .15s ease;cursor:pointer}a:hover{background:#ebe5da;color:#1f2420}.home{color:#1f2420;font-weight:850}.language{font-size:11px;font-weight:850;letter-spacing:.06em}.active{background:#222622;color:#fff;border-color:#222622}.active:hover{background:#222622;color:#fff}.divider{width:1px;height:20px;background:#d8d0c2;flex:0 0 auto;margin:0 3px}.brand{margin-left:auto;display:inline-flex;align-items:center;gap:7px;padding:0 4px;font-size:10px;font-weight:800;letter-spacing:.1em;color:#8a877f;white-space:nowrap}.brand img{display:block;width:24px;height:auto;flex:0 0 auto}@media(max-width:680px){.inner{width:100%;margin:0;padding:0 8px;gap:2px}a{min-height:32px;padding:0 10px;font-size:12px}.divider{margin:0 1px}.brand{display:none}}
      </style>
      <style>
        :host{--shell-bg:rgba(247,243,235,.97);--shell-panel:#ebe5da;--shell-text:#1f2420;--shell-text-2:#535850;--shell-muted:#666c67;--shell-line:#d8d0c2;--shell-active:#222622;--shell-active-text:#fff;--shell-focus:#344b40}
        :host([data-theme="dark"]){--shell-bg:rgba(28,31,28,.97);--shell-panel:#222622;--shell-text:#edf0ec;--shell-text-2:#b9c0ba;--shell-muted:#aab1aa;--shell-line:#3b423c;--shell-active:#edf0ec;--shell-active-text:#161816;--shell-focus:#a8c1b1}
        .bar{background:var(--shell-bg);border-bottom-color:var(--shell-line)}a{color:var(--shell-text-2)}a:hover{background:var(--shell-panel);color:var(--shell-text)}.home{color:var(--shell-text)}.active,.active:hover{background:var(--shell-active);color:var(--shell-active-text);border-color:var(--shell-active)}.divider{background:var(--shell-line)}.brand{color:var(--shell-muted)}:host([data-theme="dark"]) .brand img{filter:drop-shadow(0 1px 5px rgba(151,183,225,.16))}a:focus-visible{outline:2px solid var(--shell-focus);outline-offset:2px}
      </style>
      <nav class="bar" aria-label="${copy.navLabel}"><div class="inner">
        <a class="home" href="${homePath}">${copy.home}</a><span class="divider" aria-hidden="true"></span>
        <a href="${marketPath}">${copy.market}</a>
        <a class="${active === 'daily' ? 'active' : ''}" ${active === 'daily' ? 'aria-current="true"' : ''} href="${homePath}?category=daily">${copy.daily}</a>
        <a class="${active === 'weekly' ? 'active' : ''}" ${active === 'weekly' ? 'aria-current="true"' : ''} href="${homePath}?category=weekly">${copy.weekly}</a>
        <a class="${active === 'research' ? 'active' : ''}" ${active === 'research' ? 'aria-current="true"' : ''} href="${homePath}?category=research">${copy.research}</a>
        <a class="${active === 'basics' ? 'active' : ''}" ${active === 'basics' ? 'aria-current="true"' : ''} href="${homePath}?category=basics">${copy.basics}</a>
        ${hasNotes || active === 'note' ? `<a class="${active === 'note' ? 'active' : ''}" ${active === 'note' ? 'aria-current="true"' : ''} href="${homePath}?category=note">${copy.note}</a>` : ''}
        <a class="language" id="report-language-switch" href="${targetLocale === 'en' ? '/en/' : '/'}" aria-label="${copy.switchLabel}">${copy.switchText}</a>
        <a class="brand" href="${homePath}" aria-label="Snowshagal Market Research"><img src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true"><span>SNOWSHAGAL</span></a>
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

  /* Share ---------------------------------------------------------------------
     One editorial share section per report, injected between the report body
     and the comments. The URL builders are pure and exported on
     window.REPORT_SHELL so tests can assert real output instead of grepping
     this source; Korean titles and Korean report paths are the cases that
     actually break, and only real encoding catches them.
  -------------------------------------------------------------------------- */

  // Share the canonical URL, never the address bar: a report reached through
  // ?category= or #section must still share as one stable link.
  function canonicalShareUrl(doc = document, loc = location) {
    const link = doc.querySelector('link[rel="canonical"]');
    const declared = link?.getAttribute('href');
    if (declared) {
      try { return new URL(declared, loc.href).href; } catch (_) {}
    }
    try {
      const url = new URL(loc.href);
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (_) {
      return String(loc.href || '').split('#')[0].split('?')[0];
    }
  }

  function metaContent(doc, selector) {
    return (doc.querySelector(selector)?.getAttribute('content') || '').trim();
  }

  function shareTitle(doc = document) {
    return metaContent(doc, 'meta[property="og:title"]') || (doc.title || '').trim();
  }

  function shareText(doc = document) {
    return metaContent(doc, 'meta[name="description"]')
      || metaContent(doc, 'meta[property="og:description"]');
  }

  // Copy Link / X / Facebook / LinkedIn only. Everything else reaches its app
  // through the operating system share sheet.
  function shareLinks(url, title) {
    const query = (params) => new URLSearchParams(params).toString();
    return {
      x: `https://x.com/intent/tweet?${query({ text: title, url })}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?${query({ u: url })}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?${query({ url })}`
    };
  }

  // Capability, not user agent: a coarse pointer with no hover is a phone or a
  // tablet, where the system share sheet is the better experience. Desktop uses
  // the popover even where navigator.share exists.
  function prefersNativeShare(nav = typeof navigator === 'undefined' ? null : navigator) {
    if (typeof nav?.share !== 'function') return false;
    try { return matchMedia('(pointer: coarse) and (hover: none)').matches; }
    catch (_) { return false; }
  }

  async function copyText(value) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {}
    try {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.setProperty('position', 'fixed', 'important');
      field.style.setProperty('top', '-1000px', 'important');
      field.style.setProperty('opacity', '0', 'important');
      document.body.appendChild(field);
      field.select();
      field.setSelectionRange(0, value.length);
      const copied = document.execCommand('copy');
      field.remove();
      if (copied) return true;
    } catch (_) {}
    return false;
  }

  window.REPORT_SHELL = { canonicalShareUrl, shareTitle, shareText, shareLinks, prefersNativeShare };

  const SHARE_ICONS = {
    copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.1L4.7 21H1.5l7.5-8.6L1.2 3h6.6l4.5 5.6L17.5 3Zm-1.1 16h1.8L7.7 4.9H5.8l10.6 14.1Z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.7-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.7h.1c.5-1 1.8-2 3.7-2 3.9 0 4.6 2.6 4.6 5.9V21h-4v-5.6c0-1.3 0-3-1.9-3s-2.2 1.4-2.2 2.9V21h-4V9Z"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m8 8 4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>'
  };

  function mountShare() {
    if (document.getElementById('mrs-share-host')) return;

    const host = document.createElement('section');
    host.id = 'mrs-share-host';
    host.setAttribute('aria-label', copy.shareHeading);
    shellHosts.push(host);
    applyShellTheme();
    const hostStyles = {
      all: 'initial', display: 'block', position: 'relative', width: '100%', maxWidth: '100%',
      clear: 'both', flex: '0 0 100%', margin: '0', padding: '0', border: '0', boxSizing: 'border-box'
    };
    for (const [key, value] of Object.entries(hostStyles)) host.style.setProperty(key, value, 'important');
    document.body.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    const native = prefersNativeShare();

    root.innerHTML = `
      <style>
        :host{all:initial}*{box-sizing:border-box}.wrap{background:#f7f3eb;color:#22241f;border-top:1px solid #d8d0c2;padding:30px 20px;font-family:Inter,Pretendard,'Noto Sans KR','Apple SD Gothic Neo',system-ui,-apple-system,sans-serif;line-height:1.55}.inner{width:min(820px,100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}.lede{min-width:0}.eyebrow{display:block;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7d7d75}.prompt{margin:5px 0 0;font-size:14px;font-weight:700;letter-spacing:-.02em;color:#535850}.actions{position:relative;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 14px;border:1px solid #d8d0c2;border-radius:999px;background:#fbf8f1;color:#535850;font:inherit;font-size:12px;font-weight:800;letter-spacing:-.01em;cursor:pointer;text-decoration:none;white-space:nowrap}.btn:hover{background:#eee8dd;color:#22241f}.pop{position:absolute;right:0;bottom:calc(100% + 8px);z-index:5;min-width:186px;padding:6px;border:1px solid #d8d0c2;border-radius:12px;background:#fbf8f1;box-shadow:0 12px 34px rgba(20,24,21,.11);display:grid;gap:1px}.pop[hidden]{display:none}.pop a,.pop button{display:flex;align-items:center;gap:9px;width:100%;min-height:36px;padding:0 10px;border:0;border-radius:8px;background:none;color:#535850;font:inherit;font-size:12.5px;font-weight:700;text-align:left;text-decoration:none;cursor:pointer}.pop a:hover,.pop button:hover{background:#eee8dd;color:#22241f}.pop svg{flex:0 0 auto;opacity:.8}.sep{height:1px;margin:4px 2px;background:#d8d0c2}.hint{flex-basis:100%;margin:0;font-size:11px;color:#7d7d75}.status{width:min(820px,100%);margin:10px auto 0;min-height:17px;font-size:11px;color:#7d7d75}.status input{width:100%;margin-top:5px;padding:7px 9px;border:1px solid #d8d0c2;border-radius:8px;background:#fbf8f1;color:#22241f;font:inherit;font-size:11px}@media(max-width:600px){.wrap{padding:24px 14px}.inner{align-items:flex-start;flex-direction:column;gap:12px}.actions{width:100%}.btn{flex:1 1 auto;justify-content:center}.pop{right:auto;left:0;width:100%}}
      </style>
      <style>
        :host{--sh-bg:#f7f3eb;--sh-panel:#fbf8f1;--sh-hover:#eee8dd;--sh-text:#22241f;--sh-text-2:#535850;--sh-muted:#7d7d75;--sh-line:#d8d0c2;--sh-focus:#344b40}:host([data-theme="dark"]){--sh-bg:#1c1f1c;--sh-panel:#222622;--sh-hover:#2b302b;--sh-text:#edf0ec;--sh-text-2:#b9c0ba;--sh-muted:#8f968f;--sh-line:#3b423c;--sh-focus:#a8c1b1}.wrap{background:var(--sh-bg);color:var(--sh-text);border-top-color:var(--sh-line)}.eyebrow,.hint,.status{color:var(--sh-muted)}.prompt{color:var(--sh-text-2)}.btn{background:var(--sh-panel);color:var(--sh-text-2);border-color:var(--sh-line)}.btn:hover{background:var(--sh-hover);color:var(--sh-text)}.pop{background:var(--sh-panel);border-color:var(--sh-line)}:host([data-theme="dark"]) .pop{box-shadow:0 12px 34px rgba(0,0,0,.4)}.pop a,.pop button{color:var(--sh-text-2)}.pop a:hover,.pop button:hover{background:var(--sh-hover);color:var(--sh-text)}.sep{background:var(--sh-line)}.status input{background:var(--sh-panel);color:var(--sh-text);border-color:var(--sh-line)}.btn:focus-visible,.pop a:focus-visible,.pop button:focus-visible{outline:2px solid var(--sh-focus);outline-offset:2px}
      </style>
      <div class="wrap">
        <div class="inner">
          <div class="lede">
            <span class="eyebrow">${copy.shareHeading}</span>
            <p class="prompt">${copy.sharePrompt}</p>
          </div>
          <div class="actions">
            ${native ? `
              <button class="btn" type="button" id="share-native">${SHARE_ICONS.share}<span>${copy.shareAction}</span></button>
              <button class="btn" type="button" id="share-copy-solo">${SHARE_ICONS.copy}<span>${copy.shareCopy}</span></button>
              <p class="hint">${copy.shareAppsHint}</p>
            ` : `
              <button class="btn" type="button" id="share-trigger" aria-expanded="false" aria-controls="share-popover">${SHARE_ICONS.share}<span>${copy.shareAction}</span></button>
              <div class="pop" id="share-popover" role="group" aria-label="${copy.shareHeading}" hidden>
                <button type="button" data-share-copy>${SHARE_ICONS.copy}<span>${copy.shareCopy}</span></button>
                <div class="sep" aria-hidden="true"></div>
                <a data-share-net="x" href="#" target="_blank" rel="noopener noreferrer">${SHARE_ICONS.x}<span>X</span></a>
                <a data-share-net="facebook" href="#" target="_blank" rel="noopener noreferrer">${SHARE_ICONS.facebook}<span>Facebook</span></a>
                <a data-share-net="linkedin" href="#" target="_blank" rel="noopener noreferrer">${SHARE_ICONS.linkedin}<span>LinkedIn</span></a>
              </div>
            `}
          </div>
        </div>
        <p class="status" role="status" aria-live="polite"></p>
      </div>`;

    const statusEl = root.querySelector('.status');
    let statusTimer = 0;
    function setStatus(message) {
      clearTimeout(statusTimer);
      statusEl.textContent = message;
      if (message) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2400);
    }
    function showUrlForManualCopy(url) {
      clearTimeout(statusTimer);
      statusEl.textContent = copy.shareCopyManual;
      const field = document.createElement('input');
      field.type = 'text';
      field.readOnly = true;
      field.value = url;
      field.setAttribute('aria-label', copy.shareCopyManual);
      statusEl.appendChild(field);
      field.select();
    }

    async function runCopy() {
      const url = canonicalShareUrl();
      if (await copyText(url)) setStatus(copy.shareCopied);
      else showUrlForManualCopy(url);
    }

    root.getElementById('share-native')?.addEventListener('click', async () => {
      const url = canonicalShareUrl();
      const title = shareTitle();
      const text = shareText();
      const payload = { title, url };
      // Only add text when it says something the title does not, so targets that
      // concatenate the fields do not repeat themselves.
      if (text && text !== title) payload.text = text;
      try {
        await navigator.share(payload);
      } catch (error) {
        // Cancelling a share is not a failure.
        if (error?.name !== 'AbortError') setStatus(copy.shareFailed);
      }
    });
    root.getElementById('share-copy-solo')?.addEventListener('click', runCopy);

    const trigger = root.getElementById('share-trigger');
    const popover = root.getElementById('share-popover');
    if (trigger && popover) {
      const items = () => Array.from(popover.querySelectorAll('a,button'));

      function openPopover() {
        const url = canonicalShareUrl();
        const links = shareLinks(url, shareTitle());
        popover.querySelectorAll('[data-share-net]').forEach(link => {
          link.href = links[link.dataset.shareNet] || url;
        });
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        items()[0]?.focus();
      }

      function closePopover({ returnFocus = true } = {}) {
        if (popover.hidden) return;
        const hadFocus = root.activeElement && popover.contains(root.activeElement);
        popover.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (returnFocus || hadFocus) trigger.focus();
      }

      trigger.addEventListener('click', () => {
        if (popover.hidden) openPopover();
        else closePopover();
      });

      popover.querySelector('[data-share-copy]')?.addEventListener('click', async () => {
        closePopover();
        await runCopy();
      });
      popover.querySelectorAll('[data-share-net]').forEach(link => {
        link.addEventListener('click', () => { closePopover({ returnFocus: false }); });
      });

      root.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || popover.hidden) return;
        event.stopPropagation();
        closePopover();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closePopover({ returnFocus: false });
      });
      document.addEventListener('click', event => {
        if (popover.hidden) return;
        const path = event.composedPath ? event.composedPath() : [];
        if (path.includes(popover) || path.includes(trigger)) return;
        closePopover({ returnFocus: false });
      });
    }
  }

  function mount() {
    mountReportNav();
    mountShare();
    mountComments();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
