// Report metadata rules shared by the admin publisher (browser) and the
// publish/manage functions (server), loaded the way assets/locale.js is: a
// <script> on the admin page, a side-effect import on the server.
//
// A post's description is the editor's own words for search and sharing, or
// nothing. The publisher used to fill it in by itself with one sentence per
// category, so 130 posts carry the same few lines. Those sentences are listed
// here, every one the publisher has ever written (git history of
// assets/admin.js), so that none of them is stored as a description again.
//
// Matching is exact after whitespace is collapsed: never a substring, a
// keyword or a resemblance. A description that merely reads like one of these
// is the editor's and is kept.
(function(root){
  const CATEGORY_DEFAULT_DESCRIPTIONS = Object.freeze([
    { lang: 'ko', type: 'daily', text: '당일 시장의 핵심 흐름과 수급, 업종, 매크로 변수를 정리한 데일리 리포트.' },
    { lang: 'ko', type: 'weekly', text: '지난주 흐름을 점검하고 다음 주 변수와 주도 업종의 조건을 정리한 위클리 리포트.' },
    { lang: 'ko', type: 'research', text: '특정 산업·기업·정책 이슈를 별도로 분석한 비정기 리서치.' },
    { lang: 'ko', type: 'basics', text: '경제와 투자, 시장 구조의 기본 개념을 이해하기 쉽게 정리한 시장 입문.' },
    { lang: 'ko', type: 'basics', text: '경제와 투자, 시장 구조의 기본 개념을 이해하기 쉽게 정리한 시장 공부.', retired: true },
    { lang: 'ko', type: 'note', text: '시장과 투자에 관한 생각을 자유롭게 정리한 투자 노트.' },
    { lang: 'ko', type: 'note', text: '시장과 투자에 관한 생각을 자유롭게 정리한 글.', retired: true },
    { lang: 'en', type: 'daily', text: 'A daily report on market trends, investor flows, sectors, and macro drivers.' },
    { lang: 'en', type: 'weekly', text: 'A weekly report reviewing recent market moves and the key variables for the week ahead.' },
    { lang: 'en', type: 'research', text: 'Independent research on specific industries, companies, policies, and market structure.' },
    { lang: 'en', type: 'basics', text: 'A clear guide to the essential concepts behind markets, economics, and investing.' },
    { lang: 'en', type: 'note', text: 'Notes and observations on markets and investing.' }
  ].map(Object.freeze));

  // Whitespace only: runs of spaces, tabs and line breaks become one space,
  // and zero-width break hints disappear. Nothing else about the text changes.
  function normalizeMetadataText(value) {
    return String(value ?? '')
      .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const BOILERPLATE = new Set(CATEGORY_DEFAULT_DESCRIPTIONS.map(entry => normalizeMetadataText(entry.text)));

  function isCategoryBoilerplate(value) {
    const text = normalizeMetadataText(value);
    return Boolean(text) && BOILERPLATE.has(text);
  }

  // The description to store: the value as given (trimmed), or '' when it is
  // empty or one of the category sentences above.
  function editorialDescription(value) {
    const text = String(value ?? '').trim();
    return isCategoryBoilerplate(text) ? '' : text;
  }

  // A report's own search title: the <title> its author wrote, as the editor
  // confirmed it at publish time. Only the categories whose <title> is not
  // built from Market Close numbers take one — a Daily or a Weekly keeps the
  // dated title with the day's close, in Korean and in English alike. The
  // site appends the brand itself, so a "| Snowshagal" the author already
  // wrote is dropped rather than doubled.
  const SEO_TITLE_TYPES = Object.freeze(['research', 'note', 'basics']);
  const SEO_TITLE_MAX = 150;
  const BRAND_SUFFIX = /\s*[|\-–—·:]\s*Snowshagal\s*$/i;

  function acceptsSeoTitle(type) {
    return SEO_TITLE_TYPES.includes(type);
  }

  function seoTitleText(value) {
    let text = normalizeMetadataText(value);
    while (BRAND_SUFFIX.test(text)) text = text.replace(BRAND_SUFFIX, '').trim();
    if (/^snowshagal$/i.test(text)) return '';
    return text.slice(0, SEO_TITLE_MAX).trim();
  }

  root.REPORT_METADATA = Object.freeze({
    CATEGORY_DEFAULT_DESCRIPTIONS,
    normalizeMetadataText,
    isCategoryBoilerplate,
    editorialDescription,
    SEO_TITLE_TYPES,
    acceptsSeoTitle,
    seoTitleText
  });
})(typeof window !== 'undefined' ? window : globalThis);
