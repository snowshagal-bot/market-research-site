(function(root){
  const validLanguages = ['ko', 'en'];

  const copy = {
    ko: {
      categories: {
        daily: { label: '데일리', english: 'DAILY', description: '오늘 시장의 흐름과 수급을 기록합니다.' },
        weekly: { label: '위클리', english: 'WEEKLY', description: '한 주의 시장을 복기하고 다음 변수를 살핍니다.' },
        research: { label: '리서치', english: 'RESEARCH', description: '산업·기업·정책의 구조적 변화를 깊이 읽습니다.' },
        basics: { label: '시장 공부', english: 'MARKET BASICS', description: '경제와 투자의 기본 개념을 차분히 설명합니다.' },
        note: { label: '끄적끄적', english: 'NOTES', description: '시장과 투자에 관한 짧은 생각을 기록합니다.' }
      },
      themeDark: '다크 모드로 전환',
      themeLight: '라이트 모드로 전환',
      menuOpen: '메뉴 열기',
      menuClose: '메뉴 닫기',
      representative: '대표 리포트',
      coverAlt: '커버 이미지',
      registrationOrder: '홈페이지 등록일 최신순',
      reportOrder: '리포트 기준일 최신순',
      basicsEmpty: '시장 공부 글이 아직 없습니다.',
      empty: '조건에 맞는 글이 없습니다.',
      read: '읽기'
    },
    en: {
      categories: {
        daily: { label: 'Daily', english: 'DAILY', description: 'Daily market direction, flows, and key signals.' },
        weekly: { label: 'Weekly', english: 'WEEKLY', description: 'A weekly review of market moves and the variables ahead.' },
        research: { label: 'Research', english: 'RESEARCH', description: 'Deeper analysis of structural shifts in industries, companies, and policy.' },
        basics: { label: 'Market Basics', english: 'MARKET BASICS', description: 'Clear explanations of economic and investing fundamentals.' },
        note: { label: 'Notes', english: 'NOTES', description: 'Short observations about markets and investing.' }
      },
      themeDark: 'Switch to dark mode',
      themeLight: 'Switch to light mode',
      menuOpen: 'Open menu',
      menuClose: 'Close menu',
      representative: 'featured report',
      coverAlt: 'cover image',
      registrationOrder: 'Newest homepage registration first',
      reportOrder: 'Newest report date first',
      basicsEmpty: 'No Market Basics posts yet.',
      empty: 'No English reports match these filters yet.',
      read: 'Read'
    }
  };

  function postLanguage(post) {
    return post?.lang === 'en' ? 'en' : 'ko';
  }

  function siteLanguage(doc) {
    const declared = doc?.documentElement?.dataset?.siteLang || doc?.documentElement?.lang;
    return declared === 'en' ? 'en' : 'ko';
  }

  function groupKey(post) {
    return String(post?.translationGroup || post?.id || '');
  }

  function normalizeReportPath(value) {
    let path = String(value || '').split(/[?#]/, 1)[0];
    try { path = decodeURIComponent(path); } catch (_) {}
    return path.replace(/^\/+/, '').replace(/\\/g, '/');
  }

  function localePosts(posts, language) {
    const locale = validLanguages.includes(language) ? language : 'ko';
    return (Array.isArray(posts) ? posts : []).filter(post => postLanguage(post) === locale);
  }

  function sortPosts(posts) {
    return (Array.isArray(posts) ? posts : []).slice().sort((left, right) => {
      const leftDate = String(left?.reportDate || left?.date || '');
      const rightDate = String(right?.reportDate || right?.date || '');
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return String(right?.registeredAt || '').localeCompare(String(left?.registeredAt || ''));
    });
  }

  function sortPostsByRegistration(posts) {
    return (Array.isArray(posts) ? posts : []).slice().sort((left, right) => {
      const leftRegistration = String(left?.registeredAt || left?.registeredDate || '');
      const rightRegistration = String(right?.registeredAt || right?.registeredDate || '');
      if (leftRegistration !== rightRegistration) return rightRegistration.localeCompare(leftRegistration);
      const leftDate = String(left?.reportDate || left?.date || '');
      const rightDate = String(right?.reportDate || right?.date || '');
      return rightDate.localeCompare(leftDate);
    });
  }

  function latestByCore(posts, language, coreTypes = ['daily', 'weekly', 'research', 'basics']) {
    const localized = sortPosts(localePosts(posts, language));
    return coreTypes.map(type => localized.find(post => post.type === type)).filter(Boolean);
  }

  function categoryCounts(posts, language, types = ['daily', 'weekly', 'research', 'basics', 'note']) {
    const counts = Object.fromEntries(types.map(type => [type, 0]));
    localePosts(posts, language).forEach(post => {
      if (Object.hasOwn(counts, post.type)) counts[post.type] += 1;
    });
    return counts;
  }

  function searchPosts(posts, language, query = '', type = 'all') {
    const needle = String(query || '').trim().toLowerCase();
    return localePosts(posts, language).filter(post => {
      if (type !== 'all' && post.type !== type) return false;
      if (!needle) return true;
      return `${post.title || ''} ${post.subtitle || ''} ${post.typeLabel || ''} ${post.description || ''}`.toLowerCase().includes(needle);
    });
  }

  function findCurrentPost(posts, pathname) {
    const path = normalizeReportPath(pathname);
    return (Array.isArray(posts) ? posts : []).find(post => normalizeReportPath(post?.href) === path) || null;
  }

  function findCounterpart(posts, currentPostOrPath, targetLanguage) {
    if (!validLanguages.includes(targetLanguage)) return null;
    const current = typeof currentPostOrPath === 'string'
      ? findCurrentPost(posts, currentPostOrPath)
      : currentPostOrPath;
    if (!current) return null;
    const key = groupKey(current);
    if (!key) return null;
    return (Array.isArray(posts) ? posts : []).find(post => postLanguage(post) === targetLanguage && groupKey(post) === key) || null;
  }

  function homepagePath(language, category = '') {
    const base = language === 'en' ? '/en/' : '/';
    return category ? `${base}?category=${encodeURIComponent(category)}` : base;
  }

  function pageLanguagePath(pathname, targetLanguage, search = '') {
    const category = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('category') || '';
    const path = String(pathname || '/');
    if (/^\/en\/about\/?$/i.test(path) || /^\/about\/?$/i.test(path)) {
      return targetLanguage === 'en' ? '/en/about/' : '/about/';
    }
    return homepagePath(targetLanguage, category);
  }

  function preferredHomepageRedirect(currentLanguage, pathname, search, savedLanguage) {
    if (currentLanguage !== 'ko' || pathname !== '/' || savedLanguage !== 'en') return '';
    return pageLanguagePath(pathname, 'en', search);
  }

  root.MARKET_LOCALE = {
    validLanguages,
    copy,
    postLanguage,
    siteLanguage,
    groupKey,
    normalizeReportPath,
    localePosts,
    sortPosts,
    sortPostsByRegistration,
    latestByCore,
    categoryCounts,
    searchPosts,
    findCurrentPost,
    findCounterpart,
    homepagePath,
    pageLanguagePath,
    preferredHomepageRedirect
  };
})(typeof window !== 'undefined' ? window : globalThis);
