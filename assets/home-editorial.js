(function (root) {
  const copy = {
    ko: {
      label: '최신 데일리', read: '데일리 리포트 읽기', topics: '이 리포트의 주제',
      heading: '시장을 읽는 기준',
      lenses: [['가격', '지수의 방향과 시장 안의 차이를 봅니다.'], ['수급', '누가 사고팔았는지 흐름을 따라갑니다.'], ['변수', '금리·환율·실적을 함께 살핍니다.']],
      market: '시장 데이터와 기준 시점', about: 'Snowshagal 소개'
    },
    en: {
      label: 'LATEST DAILY', read: 'Read the daily report', topics: 'In this report',
      heading: 'How we read the market',
      lenses: [['Prices', 'The index direction and the differences beneath it.'], ['Flows', 'Who is buying, who is selling, and how that changes.'], ['Context', 'Rates, currencies and earnings, considered together.']],
      market: 'Market data & timestamps', about: 'About Snowshagal'
    }
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // One renderer for initial HTML and browser hydration. Never invent a daily
  // view or reuse the opposite locale when no published report is available.
  function render(posts, language, tags = {}) {
    const api = root.MARKET_LOCALE;
    const lang = language === 'en' ? 'en' : 'ko';
    const text = copy[lang];
    const post = api.sortPosts(api.localePosts(posts, lang)).find(item => item.type === 'daily');
    if (!post) return '';
    const path = api.normalizeReportPath(post.href);
    if (!path || !path.startsWith('reports/')) return '';
    const href = `/${path.replace(/\.html?$/i, '')}`;
    const date = post.reportDate || post.date || '';
    const blurb = api.editorialBlurb(post);
    const topics = (Array.isArray(post.tags) ? post.tags : [])
      .map(key => tags?.[key]?.[lang] || tags?.[key]?.ko || '').filter(Boolean).slice(0, 4);
    const prefix = lang === 'en' ? '/en' : '';
    return `<div class="site-wrap home-reading-grid"><article class="home-daily">
      <div class="home-daily-meta"><span>${text.label}</span><time datetime="${esc(date)}">${esc(date)}</time></div>
      <h2 id="home-editorial-heading"><a href="${esc(href)}">${esc(post.title)}</a></h2>
      ${blurb ? `<p class="home-daily-summary">${esc(blurb)}</p>` : ''}
      ${topics.length ? `<p class="home-daily-topics"><span>${text.topics}</span>${topics.map(esc).join(' · ')}</p>` : ''}
      <a class="home-reading-link" href="${esc(href)}">${text.read} <span aria-hidden="true">→</span></a>
    </article><aside class="home-reading-guide" aria-label="${text.heading}">
      <h3>${text.heading}</h3><dl>${text.lenses.map(([label, detail]) => `<div><dt>${label}</dt><dd>${detail}</dd></div>`).join('')}</dl>
      <div class="home-guide-links"><a href="${prefix}/market/">${text.market} <span aria-hidden="true">↗</span></a><a href="${prefix}/about/">${text.about} <span aria-hidden="true">↗</span></a></div>
    </aside></div>`;
  }
  // The second hero slide uses the same localized post selection on the server
  // and in the browser. The Research card keeps its existing hydration IDs.
  function renderFeatureCards(posts, language) {
    const api = root.MARKET_LOCALE;
    const lang = language === 'en' ? 'en' : 'ko';
    const labels = lang === 'en'
      ? { daily: 'DAILY', weekly: 'WEEKLY', note: 'INVESTMENT INSIGHTS', read: 'Read report' }
      : { daily: 'DAILY', weekly: 'WEEKLY', note: 'INVESTMENT INSIGHTS', read: '리포트 읽기' };
    const localized = api.sortPosts(api.localePosts(posts, lang));
    return ['daily', 'weekly', 'note'].map(type => {
      const post = localized.find(item => item.type === type);
      if (!post) return '';
      const path = api.normalizeReportPath(post.href);
      if (!path || !path.startsWith('reports/')) return '';
      const href = `/${path.replace(/\.html?$/i, '')}`;
      const date = post.reportDate || post.date || '';
      const blurb = api.editorialBlurb(post);
      const cover = String(post.coverImage || '').replace(/^\/+/, '');
      const thumb = /-450\.webp$/i.test(String(post.coverThumbnail || ''))
        ? String(post.coverThumbnail).replace(/^\/+/, '') : '';
      const image = cover
        ? `<img src="/${esc(thumb || cover)}"${thumb ? ` srcset="/${esc(thumb)} 450w, /${esc(cover)} 900w" sizes="(max-width: 760px) 48px, 78px"` : ''} alt="" loading="lazy" width="78" height="118">`
        : '<span class="hero-report-cover-fallback" aria-hidden="true">SNOWSHAGAL</span>';
      return `<article class="hero-report-card hero-report-${type}">
        <div class="featured-copy"><div class="featured-eyebrow"><span class="featured-badge">${labels[type]}</span><span class="featured-dot" aria-hidden="true">·</span><time datetime="${esc(date)}">${esc(date)}</time></div>
        <h2 class="featured-title"><a href="${esc(href)}">${esc(post.title || '')}</a></h2>
        ${blurb ? `<p class="featured-snippet">${esc(blurb)}</p>` : ''}
        <div class="featured-action"><a class="btn-editorial" href="${esc(href)}">${labels.read} <span aria-hidden="true">→</span></a></div></div>
        <div class="featured-art"><a class="featured-cover-wrap" href="${esc(href)}" tabindex="-1" aria-hidden="true">${image}</a></div>
      </article>`;
    }).join('');
  }
  root.HOME_EDITORIAL = { render, renderFeatureCards };
})(typeof window !== 'undefined' ? window : globalThis);
