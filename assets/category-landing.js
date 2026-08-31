(function(){
  const localeApi = window.MARKET_LOCALE;
  const lang = localeApi?.siteLanguage(document) || (document.documentElement.lang === 'en' ? 'en' : 'ko');
  const category = document.body?.dataset?.category || '';
  const featuredSection = document.getElementById('category-featured-section');
  const featuredHost = document.getElementById('category-featured-cards');
  const archiveSection = document.getElementById('category-archive-section');
  const archiveHost = document.getElementById('category-report-list');
  if (!category || (!featuredHost && !archiveHost)) return;

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
  function cleanReportUrl(href) {
    const str = String(href || '').trim();
    const match = str.match(/^([^?#]*)([?#].*)?$/);
    const pathPart = (match && match[1]) || '';
    const suffix = (match && match[2]) || '';
    const p = rootPath(pathPart);
    return /^\/reports\//i.test(p) ? `${p.replace(/\.html?$/i, '')}${suffix}` : `${p}${suffix}`;
  }

  function readingTime(post) {
    const minutes = typeof post?.readingMinutes === 'number' && post.readingMinutes > 0 ? post.readingMinutes : 0;
    if (minutes <= 0) return '';
    return lang === 'en' ? ` · ${minutes} min read` : ` · 약 ${minutes}분`;
  }

  function formatReadingTime(mins, currentLang) {
    if (typeof mins !== 'number' || mins <= 0) return '';
    return currentLang === 'en' ? `${mins} min read` : `약 ${mins}분`;
  }

  function tagLabel(key) {
    const entry = window.TAG_REGISTRY?.[key];
    return entry ? (entry[lang] || entry.ko || key) : key;
  }

  const categoryMetaLabels = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    research: 'RESEARCH',
    basics: 'MARKET BASICS',
    note: 'INVESTMENT NOTE'
  };

  document.querySelectorAll('[data-nav-category]').forEach((link) => {
    const current = link.dataset.navCategory === category;
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (!posts.length) {
    if (featuredSection) featuredSection.hidden = true;
    if (archiveSection) archiveSection.hidden = false;
    if (archiveHost) {
      archiveHost.innerHTML = `<div class="empty">${esc(lang === 'en' ? 'No reports in this category yet.' : '이 카테고리의 글이 아직 없습니다.')}</div>`;
    }
    return;
  }

  const featuredPosts = posts.slice(0, 2);
  const archivePosts = posts.slice(2);

  // Render Featured Cards (1-2 cards)
  if (featuredHost) {
    if (featuredSection) featuredSection.hidden = false;
    featuredHost.innerHTML = featuredPosts.map((post) => {
      const summary = String(post.summary || post.description || post.subtitle || '').trim();
      const readLabel = lang === 'en' ? 'Read report' : '리포트 보기';
      const visual = post.coverImage
        ? `<span class="category-featured-cover"><img src="${esc(rootPath(post.coverImage))}" alt="" loading="lazy"></span>`
        : '<span class="category-featured-art" aria-hidden="true"></span>';
      const summaryCopy = summary ? `<p class="category-featured-summary">${esc(summary)}</p>` : '';
      const readingTimeStr = formatReadingTime(post.readingMinutes, lang);
      const readingSuffix = readingTimeStr ? ` · ${readingTimeStr}` : '';
      const tagsStr = Array.isArray(post.tags) ? post.tags.map(tagLabel).filter(Boolean).join(' · ') : '';
      const tagsHtml = tagsStr ? `<div class="category-featured-tags">${esc(tagsStr)}</div>` : '';
      const date = post.reportDate || post.date || '';
      const metaType = categoryMetaLabels[post.type] || post.type.toUpperCase();

      return `<a class="category-featured-card category-featured-card-${esc(post.type)}" href="${esc(cleanReportUrl(post.href))}">
        <span class="category-featured-cover-wrap">${visual}</span>
        <span class="category-featured-content">
          <span class="category-featured-meta">
            <b>${esc(metaType)}${esc(readingSuffix)}</b>
            <time datetime="${esc(date)}">${esc(date)}</time>
          </span>
          <strong class="category-featured-title">${esc(post.title)}</strong>
          ${summaryCopy}
          ${tagsHtml}
          <span class="category-featured-action"><span class="category-featured-read">${esc(readLabel)} <i aria-hidden="true">→</i></span></span>
        </span>
      </a>`;
    }).join('');
  }

  // Render Archive List
  if (archivePosts.length === 0) {
    if (archiveSection) archiveSection.hidden = true;
  } else {
    if (archiveSection) archiveSection.hidden = false;
    if (archiveHost) {
      archiveHost.innerHTML = archivePosts.map((post) => {
        const subtitle = String(post.subtitle || post.summary || post.description || '').trim();
        const subtitleMarkup = subtitle ? `<div class="report-subtitle">${esc(subtitle)}</div>` : '';
        const tags = Array.isArray(post.tags) ? post.tags.map(tagLabel).filter(Boolean).join(' · ') : '';
        const tagsMarkup = tags ? `<div class="report-tags">${esc(tags)}</div>` : '';
        const date = post.reportDate || post.date || '';
        const label = copy?.categories?.[post.type]?.label || (lang === 'en' ? 'Report' : '리포트');

        return `<a class="report-item" href="${esc(cleanReportUrl(post.href))}">
          <div><span class="report-type ${esc(post.type)}">${esc(label)}</span><span class="report-date">${esc(date)}${esc(readingTime(post))}</span></div>
          <div><div class="report-title">${esc(post.title)}</div>${subtitleMarkup}${tagsMarkup}</div>
          <span class="report-arrow"><span class="report-read-label">${lang === 'en' ? 'Read' : '읽기'}</span><span aria-hidden="true">→</span></span>
        </a>`;
      }).join('');
    }
  }
})();
