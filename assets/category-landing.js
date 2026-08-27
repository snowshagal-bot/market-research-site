(function(){
  const localeApi = window.MARKET_LOCALE;
  const lang = localeApi?.siteLanguage(document) || (document.documentElement.lang === 'en' ? 'en' : 'ko');
  const category = document.body?.dataset?.category || '';
  const host = document.getElementById('category-report-list');
  if (!host || !category) return;

  const copy = localeApi?.copy?.[lang] || localeApi?.copy?.ko;
  const allPosts = Array.isArray(window.RESEARCH_POSTS) ? window.RESEARCH_POSTS : [];
  const posts = (localeApi?.sortPosts(localeApi?.localePosts(allPosts, lang)) || allPosts)
    .filter((post) => post?.type === category);

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function rootPath(path) {
    return `/${String(path || '').replace(/^\/+/, '')}`;
  }

  function readingTime(post) {
    const minutes = typeof post?.readingMinutes === 'number' && post.readingMinutes > 0 ? post.readingMinutes : 0;
    if (minutes <= 0) return '';
    return lang === 'en' ? ` · ${minutes} min read` : ` · 약 ${minutes}분`;
  }

  function tagLabel(key) {
    const entry = window.TAG_REGISTRY?.[key];
    return entry ? (entry[lang] || entry.ko || key) : key;
  }

  document.querySelectorAll('[data-nav-category]').forEach((link) => {
    const current = link.dataset.navCategory === category;
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (!posts.length) {
    host.innerHTML = `<div class="empty">${esc(lang === 'en' ? 'No reports in this category yet.' : '이 카테고리의 글이 아직 없습니다.')}</div>`;
    return;
  }

  host.innerHTML = posts.map((post, idx) => {
    const subtitle = String(post.subtitle || post.summary || post.description || '').trim();
    const subtitleMarkup = subtitle ? `<div class="report-subtitle">${esc(subtitle)}</div>` : '';
    const tags = Array.isArray(post.tags) ? post.tags.map(tagLabel).filter(Boolean).join(' · ') : '';
    const tagsMarkup = tags ? `<div class="report-tags">${esc(tags)}</div>` : '';
    const date = post.reportDate || post.date || '';
    const label = idx === 0 
      ? (lang === 'en' ? 'LATEST' : '최신 리포트')
      : (copy?.categories?.[post.type]?.label || (lang === 'en' ? 'Report' : '리포트'));
    const isLatestAttr = idx === 0 ? ' data-latest="true"' : '';

    return `<a class="report-item"${isLatestAttr} href="${esc(rootPath(post.href))}">
      <div><span class="report-type ${esc(post.type)}">${esc(label)}</span><span class="report-date">${esc(date)}${esc(readingTime(post))}</span></div>
      <div><div class="report-title">${esc(post.title)}</div>${subtitleMarkup}${tagsMarkup}</div>
      <span class="report-arrow"><span class="report-read-label">${lang === 'en' ? 'Read' : '읽기'}</span><span aria-hidden="true">→</span></span>
    </a>`;
  }).join('');
})();
