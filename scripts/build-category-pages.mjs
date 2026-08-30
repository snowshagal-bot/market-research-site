import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORY_LANDINGS,
  CATEGORY_SLUGS,
  PRODUCTION_ORIGIN,
  categoryLandingPath,
  categoryStructuredData,
  escapeHtml,
  structuredDataScript
} from '../functions/_seo.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FEATURED_HEADINGS = {
  daily: { ko: '최신 데일리 리포트', en: 'Latest Daily Reports' },
  weekly: { ko: '최신 위클리 리포트', en: 'Latest Weekly Reports' },
  research: { ko: '최신 리서치', en: 'Latest Research' },
  basics: { ko: '최신 시장 공부', en: 'Latest Market Basics' },
  note: { ko: '최신 끄적끄적', en: 'Latest Notes' }
};

const CATEGORY_EYEBROWS = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  research: 'RESEARCH',
  basics: 'MARKET BASICS',
  note: 'NOTES'
};

function nav(lang) {
  const labels = lang === 'en'
    ? { home: 'Home', market: 'Market', daily: 'Daily', weekly: 'Weekly', research: 'Research', basics: 'Market Basics', note: 'Notes' }
    : { home: '홈', market: '마켓', daily: '데일리', weekly: '위클리', research: '리서치', basics: '시장 공부', note: '끄적끄적' };
  const localePrefix = lang === 'en' ? '/en' : '';
  const homePath = lang === 'en' ? '/en/' : '/';
  return `<a data-nav-category="all" href="${homePath}">${labels.home}</a>
        <a href="${localePrefix}/market/">${labels.market}</a>
        ${Object.keys(CATEGORY_SLUGS).map((type) => `<a${type === 'note' ? ' class="nav-secondary"' : ''} data-nav-category="${type}" href="${categoryLandingPath(type, lang)}">${labels[type]}</a>`).join('\n        ')}`;
}

function searchDialog(lang) {
  const en = lang === 'en';
  return `<dialog id="search-dialog" class="search-dialog" aria-label="${en ? 'Search' : '검색'}">
  <div class="search-dialog-backdrop" data-search-close></div>
  <div class="search-dialog-content">
    <div class="search-dialog-header">
      <div class="search-input-wrap"><svg class="search-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><input id="global-search-input" type="search" class="search-dialog-input" placeholder="${en ? 'Search reports...' : '검색어를 입력하세요...'}" autocomplete="off"><button type="button" class="search-clear-btn" id="search-clear-btn" aria-label="${en ? 'Clear search' : '검색어 지우기'}" hidden>×</button></div>
      <button type="button" class="search-dialog-close" data-search-close aria-label="${en ? 'Close search' : '검색 닫기'}">ESC</button>
    </div>
    <div class="search-dialog-body"><div class="search-quick-tags" id="search-quick-tags"><span class="search-quick-title">${en ? 'Suggested searches' : '추천 검색어'}</span><div class="search-tag-cloud" id="search-tag-cloud"></div></div><div class="search-results-list" id="search-results-list" role="list"></div><div class="search-empty-state" id="search-empty-state" hidden><p class="search-empty-title">${en ? 'No results found.' : '검색 결과가 없습니다.'}</p><p class="search-empty-desc">${en ? 'Try another keyword or tag.' : '다른 검색어나 태그를 사용해보세요.'}</p></div></div>
  </div>
</dialog>`;
}

function page(type, lang) {
  const text = CATEGORY_LANDINGS[type][lang];
  const canonicalPath = categoryLandingPath(type, lang);
  const koPath = categoryLandingPath(type, 'ko');
  const enPath = categoryLandingPath(type, 'en');
  const en = lang === 'en';
  const home = en ? '/en/' : '/';
  const featuredHeading = FEATURED_HEADINGS[type]?.[lang] || (en ? 'Latest Reports' : '최신 리포트');
  const eyebrow = CATEGORY_EYEBROWS[type] || type.toUpperCase();
  return `<!doctype html>
<html lang="${lang}" data-site-lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#f7f4ec">
<title>${escapeHtml(text.title)}</title>
<meta name="description" content="${escapeHtml(text.description)}">
<link rel="canonical" href="${PRODUCTION_ORIGIN}${canonicalPath}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Snowshagal"><meta property="og:locale" content="${en ? 'en_US' : 'ko_KR'}"><meta property="og:title" content="${escapeHtml(text.title)}"><meta property="og:description" content="${escapeHtml(text.description)}"><meta property="og:url" content="${PRODUCTION_ORIGIN}${canonicalPath}"><meta property="og:image" content="${PRODUCTION_ORIGIN}/assets/social/snowshagal-home.jpg"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(text.title)}"><meta name="twitter:description" content="${escapeHtml(text.description)}"><meta name="twitter:image" content="${PRODUCTION_ORIGIN}/assets/social/snowshagal-home.jpg">
${structuredDataScript(categoryStructuredData(type, lang))}
<link rel="stylesheet" href="/assets/site.css?v=1efc69cb5c"><link rel="stylesheet" href="/assets/brand.css?v=890e1e5732"><link rel="stylesheet" href="/assets/language.css?v=0c4ca7f4fc"><link rel="stylesheet" href="/assets/category-state.css?v=4328e4b8c2"><link rel="stylesheet" href="/assets/ui-polish.css?v=26a4fe9976"><link rel="stylesheet" href="/assets/home-v2.css?v=5342d21ef9"><link rel="stylesheet" href="/assets/category-landing.css?v=6da877e833">
<script>try{const t=localStorage.getItem('site-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.dataset.theme='dark'}catch(e){}</script>
</head>
<body class="home-page category-page" data-category="${type}">
<header class="site-header"><div class="site-wrap"><div class="header-row"><a class="brand snowshagal-brand" href="${home}" aria-label="Snowshagal Market Research"><img class="brand-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true"><span class="brand-copy"><strong>SNOWSHAGAL</strong><small>MARKET RESEARCH</small></span></a><nav class="main-nav" aria-label="${en ? 'Main menu' : '주 메뉴'}">${nav(lang)}</nav><div class="header-actions"><button class="icon-btn search-trigger" type="button" data-search-trigger aria-label="${en ? 'Search' : '검색'}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button><a class="language-pill" data-language-choice="${en ? 'ko' : 'en'}" href="${en ? koPath : enPath}" aria-label="${en ? '한국어로 보기' : 'Read in English'}">${en ? 'KO' : 'EN'}</a><button class="icon-btn" type="button" data-theme-toggle aria-label="${en ? 'Switch theme' : '다크 모드 전환'}">◐</button></div></div><nav class="mobile-quick-nav" aria-label="${en ? 'Main menu' : '주 메뉴'}">${nav(lang)}</nav></div></header>
<main><section class="category-landing-hero"><div class="site-wrap"><p class="category-landing-eyebrow">${eyebrow}</p><h1>${escapeHtml(text.heading)}</h1><p class="category-landing-lead">${escapeHtml(text.lead)}</p></div></section><section class="category-landing-featured-section" id="category-featured-section" aria-labelledby="category-featured-heading"><div class="site-wrap"><div class="category-landing-list-head"><h2 id="category-featured-heading">${escapeHtml(featuredHeading)}</h2></div><div id="category-featured-cards" class="category-featured-grid" data-category-featured-cards></div></div></section><section class="category-landing-list-section" id="category-archive-section" aria-labelledby="category-list-heading"><div class="site-wrap"><div class="category-landing-list-head"><h2 id="category-list-heading">${en ? 'Previous Reports' : '지난 리포트'}</h2><a class="category-landing-home" href="${home}">${en ? 'All reports' : '전체 리포트'} <span aria-hidden="true">→</span></a></div><div id="category-report-list" class="report-list" data-category-report-list data-category="${type}"></div></div></section></main>
<footer class="footer"><div class="site-wrap"><div class="footer-primary"><div class="footer-brand-col"><span class="footer-brand"><img class="footer-brand-owl" src="/assets/brand/snowshagal-owl.webp" alt="" width="232" height="256" aria-hidden="true"><span>SNOWSHAGAL</span></span><p class="footer-tagline">${en ? 'A clearer read on the market.' : '시장을 읽어주는 사이트.'}</p></div><div class="footer-nav-col"><nav class="footer-links" aria-label="${en ? 'Site links' : '사이트 링크'}"><a href="${en ? '/en/about/' : '/about/'}">${en ? 'About' : '소개'}</a><a href="${en ? '/en/about/#contact' : '/about/#contact'}">${en ? 'Contact' : '문의'}</a></nav><a class="footer-email" href="mailto:contact@snowshagal.com">contact@snowshagal.com</a></div></div><div class="footer-meta"><p class="footer-disclaimer">${en ? 'Snowshagal provides research and commentary for informational purposes only and does not offer personalized investment advice or recommendations to buy or sell financial products.' : '본 사이트의 리서치와 해설은 정보 제공을 목적으로 하며, 특정 금융투자상품에 대한 투자자문 또는 매수·매도 권유를 제공하지 않습니다.'}</p><p class="footer-copy">© 2026 SNOWSHAGAL</p></div></div></footer>
${searchDialog(lang)}
<script src="/data/tags.js?v=636e50700f"></script><script src="/data/posts.js"></script><script src="/assets/locale.js?v=c9e75896a6"></script><script src="/assets/site.js?v=b21afb2c92"></script><script src="/assets/category-landing.js?v=756ea5a912"></script>
</body></html>
`;
}

for (const type of Object.keys(CATEGORY_SLUGS)) {
  for (const lang of ['ko', 'en']) {
    const destination = path.join(root, ...(lang === 'en' ? ['en'] : []), CATEGORY_SLUGS[type], 'index.html');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, page(type, lang), 'utf8');
  }
}
