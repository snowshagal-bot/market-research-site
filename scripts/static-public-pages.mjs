// The hand-written public pages that the sync scripts keep in step with the
// shared footer and the feed discovery link. Category landings are not here:
// scripts/build-category-pages.mjs regenerates them whole.
export const STATIC_PUBLIC_PAGES = [
  { file: 'index.html', lang: 'ko' },
  { file: 'en/index.html', lang: 'en' },
  { file: 'about/index.html', lang: 'ko' },
  { file: 'en/about/index.html', lang: 'en' },
  { file: 'market/index.html', lang: 'ko' },
  { file: 'en/market/index.html', lang: 'en' },
  { file: 'disclosures/index.html', lang: 'ko' },
  { file: 'en/disclosures/index.html', lang: 'en' },
  { file: 'calendar/index.html', lang: 'ko' },
  { file: 'en/calendar/index.html', lang: 'en' },
  { file: '404.html', lang: 'ko' }
];
