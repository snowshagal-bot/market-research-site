export const PRODUCTION_ORIGIN = 'https://snowshagal.com';

// Landscape 1200x630 card used wherever a page has no artwork of its own.
export const SOCIAL_FALLBACK_IMAGE = '/assets/social/snowshagal-home.jpg';

// Report covers are 900x1350 portrait, and a 1.91:1 unfurler keeps only the
// middle 35% of them, which cut the report title away on four of five sampled
// covers and sliced through the glyphs on one. So a report with a cover gets a
// 1200x630 card composed from it — the cover whole on the left, the brand and
// category on the right — written to this directory at publish time and named
// after the post id. A report without a cover falls back to the brand card.
//
// twitter:image is unaffected: X shows a summary thumbnail rather than a
// cropped band, so it keeps the cover itself.
export const SOCIAL_REPORT_CARD_DIR = 'covers/share';

export const CATEGORY_LANDINGS = Object.freeze({
  daily: {
    ko: {
      title: '한국 주식시장 데일리 리포트 | Snowshagal',
      description: '코스피·코스닥 마감 흐름과 투자자 수급, 주요 시장 변수를 정리한 Snowshagal 데일리 리포트입니다.',
      heading: '한국 주식시장 데일리 리포트',
      lead: '오늘 시장의 흐름과 수급, 다음 거래일에 살펴볼 변수를 기록합니다.'
    },
    en: {
      title: 'Korean Market Daily Reports | Snowshagal',
      description: 'Daily reviews of KOSPI and KOSDAQ moves, investor flows, and the market variables that matter next.',
      heading: 'Korean Market Daily Reports',
      lead: 'Daily reviews of market direction, investor flows, and the signals to watch next.'
    }
  },
  weekly: {
    ko: {
      title: '주간 시장 전망 및 위클리 리포트 | Snowshagal',
      description: '한 주의 한국 시장을 복기하고 금리·환율·수급 등 다음 주 핵심 변수를 정리한 위클리 리포트입니다.',
      heading: '주간 시장 전망 및 위클리 리포트',
      lead: '한 주의 시장을 복기하고 다음 흐름을 좌우할 변수를 살핍니다.'
    },
    en: {
      title: 'Korean Market Weekly Outlooks | Snowshagal',
      description: 'Weekly reviews and outlooks covering Korean market moves, rates, currencies, flows, and the variables ahead.',
      heading: 'Korean Market Weekly Outlooks',
      lead: 'Weekly reviews of market moves and the variables likely to shape the week ahead.'
    }
  },
  research: {
    ko: {
      title: '한국 시장 심층 리서치 | Snowshagal',
      description: '산업·기업·정책과 주요 경제·시장 이슈의 구조적 변화를 깊이 살펴보는 Snowshagal 리서치 아카이브입니다.',
      heading: '한국 시장 심층 리서치',
      lead: '산업·기업·정책과 시장의 구조적 변화를 한 걸음 더 깊이 읽습니다.'
    },
    en: {
      title: 'Korean Market Research | Snowshagal',
      description: 'In-depth Snowshagal research on structural shifts across industries, companies, policy, and major market issues.',
      heading: 'Korean Market Research',
      lead: 'Deeper research into structural shifts across industries, companies, policy, and markets.'
    }
  },
  basics: {
    ko: {
      title: '경제·주식시장 기초 설명 | Snowshagal 시장 공부',
      description: '경제와 주식시장이 낯선 투자자를 위해 시장의 기본 개념과 투자에 필요한 배경을 쉽게 설명합니다.',
      heading: '경제·주식시장 기초 설명',
      lead: '경제와 투자의 기본 개념을 부담 없이 이해할 수 있도록 차분히 설명합니다.'
    },
    en: {
      title: 'Market Basics & Investing Explainers | Snowshagal',
      description: 'Clear explanations of economic, market, and investing fundamentals for readers building their foundation.',
      heading: 'Market Basics & Investing Explainers',
      lead: 'Clear, approachable explanations of economic, market, and investing fundamentals.'
    }
  },
  note: {
    ko: {
      title: '시장과 투자에 관한 기록 | Snowshagal 끄적끄적',
      description: '시장과 투자에 관해 지나치기 쉬운 생각과 관찰을 짧게 기록한 Snowshagal 노트 아카이브입니다.',
      heading: '시장과 투자에 관한 기록',
      lead: '시장과 투자에 관해 지나치기 쉬운 생각과 관찰을 짧게 기록합니다.'
    },
    en: {
      title: 'Market & Investing Notes | Snowshagal',
      description: 'Short Snowshagal notes capturing observations and ideas about markets and investing.',
      heading: 'Market & Investing Notes',
      lead: 'Short observations and ideas about markets and investing.'
    }
  }
});

export const CATEGORY_SLUGS = Object.freeze({
  daily: 'daily',
  weekly: 'weekly',
  research: 'research',
  basics: 'basics',
  note: 'notes'
});

// Having a cover does not mean a card exists: composing one can fail, and
// publishing continues without it. Only `shareCardImage`, written when a card
// was actually committed, may be trusted — and only when it names the card
// this post owns, so metadata can never point the crawler somewhere else.
export function reportCardPath(post) {
  const declared = String(post?.shareCardImage || '').replace(/^\/+/, '');
  if (!declared || !post?.id) return '';
  return declared === `${SOCIAL_REPORT_CARD_DIR}/${post.id}.jpg` ? declared : '';
}

// Uploaded report HTML declares no icon, so the shared shell supplies one.
export const FAVICON_TAGS = '<link rel="icon" href="/favicon.ico" sizes="any">'
  + '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">'
  + '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
  + '<link rel="manifest" href="/site.webmanifest">';

export function postLanguage(post) {
  return post?.lang === 'en' ? 'en' : 'ko';
}

export function categoryLandingPath(type, lang = 'ko') {
  const slug = CATEGORY_SLUGS[type];
  if (!slug) return '';
  return lang === 'en' ? `/en/${slug}/` : `/${slug}/`;
}

export function categoryLandingFromPath(pathname) {
  const normalized = `/${normalizeSitePath(pathname).replace(/\/+$/, '')}/`;
  const match = normalized.match(/^\/(en\/)?(daily|weekly|research|basics|notes)\/$/i);
  if (!match) return null;
  const lang = match[1] ? 'en' : 'ko';
  const slug = match[2].toLowerCase();
  const type = Object.keys(CATEGORY_SLUGS).find((key) => CATEGORY_SLUGS[key] === slug);
  return type ? { type, lang, path: categoryLandingPath(type, lang) } : null;
}

export function normalizeSitePath(value) {
  let path = String(value || '').split(/[?#]/, 1)[0].replace(/^\/+/, '');
  try { path = decodeURIComponent(path); } catch (_) {}
  return path.replace(/\\/g, '/');
}

export function absoluteSiteUrl(path) {
  const normalized = normalizeSitePath(path);
  return new URL(`/${normalized}`, PRODUCTION_ORIGIN).href;
}

export function reportSiteUrl(path) {
  const normalized = normalizeSitePath(path).replace(/\.html?$/i, '');
  return new URL(`/${normalized}`, PRODUCTION_ORIGIN).href;
}

export function findPostByPath(posts, pathname) {
  const normalized = normalizeSitePath(pathname).replace(/\.html?$/i, '');
  return posts.find((post) => normalizeSitePath(post?.href).replace(/\.html?$/i, '') === normalized) || null;
}

export function findTranslationCounterpart(posts, post) {
  const groupKey = (candidate) => String(candidate?.translationGroup || candidate?.id || '').trim();
  const group = groupKey(post);
  if (!group) return null;
  const lang = postLanguage(post);
  const grouped = (Array.isArray(posts) ? posts : []).filter((candidate) => (
    groupKey(candidate) === group
  ));
  const korean = grouped.filter((candidate) => postLanguage(candidate) === 'ko');
  const english = grouped.filter((candidate) => postLanguage(candidate) === 'en');
  if (korean.length !== 1 || english.length !== 1) return null;
  return lang === 'en' ? korean[0] : english[0];
}

export function reportAlternates(posts, post) {
  const counterpart = findTranslationCounterpart(posts, post);
  if (!counterpart) return [];
  const entries = [post, counterpart]
    .map((candidate) => ({ lang: postLanguage(candidate), href: reportSiteUrl(candidate.href) }))
    .sort((left, right) => left.lang.localeCompare(right.lang));
  const korean = entries.find((entry) => entry.lang === 'ko');
  if (korean) entries.push({ lang: 'x-default', href: korean.href });
  return entries;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isoDateParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
}

function reportDateLabel(post, lang) {
  const parts = isoDateParts(post?.reportDate || post?.date);
  if (!parts) return '';
  if (lang === 'ko') return `${parts.year}년 ${parts.month}월 ${parts.day}일`;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

export function reportSeoTitle(post) {
  const lang = postLanguage(post);
  const title = String(post?.title || '').replace(/\s+/g, ' ').trim();
  const date = reportDateLabel(post, lang);
  const type = CATEGORY_LANDINGS[post?.type]?.[lang]?.heading || (lang === 'en' ? 'Market Report' : '시장 리포트');
  let context = type;
  if (post?.type === 'daily') context = lang === 'en' ? 'Korean Market Daily Report' : '한국 주식시장 데일리';
  if (post?.type === 'weekly') context = lang === 'en' ? 'Korean Market Weekly Outlook' : '주간 시장 전망';
  const datedContext = date ? (lang === 'en' ? `${context} — ${date}` : `${date} ${context}`) : context;
  return [datedContext, title, 'Snowshagal'].filter(Boolean).join(' | ');
}

export function reportDescription(post) {
  const supplied = String(post?.summary || post?.description || post?.subtitle || '').replace(/\s+/g, ' ').trim();
  if (supplied) return supplied;
  const lang = postLanguage(post);
  const title = String(post?.title || '').replace(/\s+/g, ' ').trim();
  const category = CATEGORY_LANDINGS[post?.type]?.[lang]?.heading || (lang === 'en' ? 'market report' : '시장 리포트');
  return lang === 'en'
    ? `${title || 'This report'} — a Snowshagal ${category.toLowerCase()}.`
    : `${title || '이 글'} — Snowshagal의 ${category} 콘텐츠입니다.`;
}

function reportRowMarkup(post, lang) {
  const date = String(post?.reportDate || post?.date || '');
  const category = CATEGORY_LANDINGS[post?.type]?.[lang]?.heading || (lang === 'en' ? 'Report' : '리포트');
  const subtitle = String(post?.subtitle || '').trim();
  return `<a class="report-item" href="${escapeHtml(`/${normalizeSitePath(post?.href)}`)}">`
    + `<div><span class="report-type ${escapeHtml(post?.type || '')}">${escapeHtml(category)}</span>`
    + `<span class="report-date">${escapeHtml(date)}</span></div>`
    + `<div><div class="report-title">${escapeHtml(post?.title || '')}</div>`
    + `${subtitle ? `<div class="report-subtitle">${escapeHtml(subtitle)}</div>` : ''}</div>`
    + `<span class="report-arrow"><span class="report-read-label">${lang === 'en' ? 'Read' : '읽기'}</span><span aria-hidden="true">→</span></span></a>`;
}

export function categoryReportLinks(posts, type, lang) {
  return (Array.isArray(posts) ? posts : [])
    .filter((post) => postLanguage(post) === lang && post?.type === type && normalizeSitePath(post?.href))
    .sort((left, right) => {
      const byDate = String(right?.reportDate || right?.date || '').localeCompare(String(left?.reportDate || left?.date || ''));
      return byDate || String(right?.registeredAt || '').localeCompare(String(left?.registeredAt || ''));
    })
    .map((post) => reportRowMarkup(post, lang))
    .join('');
}

export function homepageReportLinks(posts, lang, limit = 20) {
  return (Array.isArray(posts) ? posts : [])
    .filter((post) => postLanguage(post) === lang && normalizeSitePath(post?.href))
    .sort((left, right) => {
      const byDate = String(right?.reportDate || right?.date || '').localeCompare(String(left?.reportDate || left?.date || ''));
      return byDate || String(right?.registeredAt || '').localeCompare(String(left?.registeredAt || ''));
    })
    .slice(0, limit)
    .map((post) => reportRowMarkup(post, lang))
    .join('');
}

export function homepageLatestLinks(posts, lang) {
  const localized = (Array.isArray(posts) ? posts : [])
    .filter((post) => postLanguage(post) === lang && normalizeSitePath(post?.href))
    .sort((left, right) => String(right?.reportDate || right?.date || '').localeCompare(String(left?.reportDate || left?.date || '')));
  return ['daily', 'weekly', 'research'].map((type) => localized.find((post) => post?.type === type)).filter(Boolean)
    .map((post) => {
      const summary = reportDescription(post);
      const cover = normalizeSitePath(post?.coverImage);
      const visual = cover
        ? `<span class="latest-card-cover"><img src="/${escapeHtml(cover)}" alt="" loading="lazy"></span>`
        : '<span class="latest-card-art" aria-hidden="true"></span>';
      return `<a class="latest-card latest-card-${escapeHtml(post.type)}" href="/${escapeHtml(normalizeSitePath(post.href))}">`
        + `<span class="latest-card-meta"><b>${escapeHtml(post.type.toUpperCase())}</b><time datetime="${escapeHtml(post.reportDate || post.date || '')}">${escapeHtml(post.reportDate || post.date || '')}</time></span>`
        + `<strong class="latest-card-title">${escapeHtml(post.title || '')}</strong>`
        + `<span class="latest-card-body">${visual}<span class="latest-card-copy"><p class="latest-card-summary">${escapeHtml(summary)}</p>`
        + `<span class="latest-card-read">${lang === 'en' ? 'Read report' : '리포트 보기'} <i aria-hidden="true">→</i></span></span></span></a>`;
    }).join('');
}

export function reportSeoTags(posts, post) {
  const canonical = reportSiteUrl(post.href);
  const lang = postLanguage(post);
  const title = reportSeoTitle(post);
  const description = reportDescription(post);
  const cover = post.coverImage ? absoluteSiteUrl(post.coverImage) : '';
  // og:image is always a 1200x630 landscape card, so nothing that crops to
  // 1.91:1 can behead the artwork.
  const card = reportCardPath(post);
  const ogImage = absoluteSiteUrl(card || SOCIAL_FALLBACK_IMAGE);
  // X keeps the report's own cover: the summary card shows a small thumbnail
  // rather than a cropped band, so the portrait artwork survives intact.
  const twitterImage = cover || absoluteSiteUrl(SOCIAL_FALLBACK_IMAGE);
  const twitterCard = cover ? 'summary' : 'summary_large_image';
  const counterpart = findTranslationCounterpart(posts, post);
  const alternates = reportAlternates(posts, post)
    .map((entry) => `<link rel="alternate" hreflang="${entry.lang}" href="${escapeHtml(entry.href)}">`)
    .join('');
  const descriptionTags = `<meta name="description" content="${escapeHtml(description)}"><meta property="og:description" content="${escapeHtml(description)}"><meta name="twitter:description" content="${escapeHtml(description)}">`;
  const localeAlternate = counterpart
    ? `<meta property="og:locale:alternate" content="${postLanguage(counterpart) === 'en' ? 'en_US' : 'ko_KR'}">`
    : '';

  return `<title>${escapeHtml(title)}</title><link rel="canonical" href="${escapeHtml(canonical)}">${alternates}${descriptionTags}`
    + `<meta property="og:type" content="article">`
    + `<meta property="og:site_name" content="Snowshagal">`
    + `<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'ko_KR'}">${localeAlternate}`
    + `<meta property="og:title" content="${escapeHtml(post.title)}">`
    + `<meta property="og:url" content="${escapeHtml(canonical)}">`
    + `<meta property="og:image" content="${escapeHtml(ogImage)}">`
    + `<meta property="og:image:width" content="1200">`
    + `<meta property="og:image:height" content="630">`
    + `<meta name="twitter:card" content="${twitterCard}">`
    + `<meta name="twitter:title" content="${escapeHtml(post.title)}">`
    + `<meta name="twitter:image" content="${escapeHtml(twitterImage)}">`;
}

export function sitemapXml(posts) {
  const validPosts = posts.filter((post) => (
    post && typeof post.href === 'string' && /^reports\/.+\.html?$/i.test(normalizeSitePath(post.href))
  ));
  const homeAlternates = [
    { lang: 'ko', href: `${PRODUCTION_ORIGIN}/` },
    { lang: 'en', href: `${PRODUCTION_ORIGIN}/en/` },
    { lang: 'x-default', href: `${PRODUCTION_ORIGIN}/` }
  ];
  const aboutAlternates = [
    { lang: 'ko', href: `${PRODUCTION_ORIGIN}/about/` },
    { lang: 'en', href: `${PRODUCTION_ORIGIN}/en/about/` },
    { lang: 'x-default', href: `${PRODUCTION_ORIGIN}/about/` }
  ];
  const marketAlternates = [
    { lang: 'ko', href: `${PRODUCTION_ORIGIN}/market/` },
    { lang: 'en', href: `${PRODUCTION_ORIGIN}/en/market/` },
    { lang: 'x-default', href: `${PRODUCTION_ORIGIN}/market/` }
  ];
  const urlEntry = (loc, lastmod, alternates = []) => {
    const alternateTags = alternates.map((entry) => (
      `<xhtml:link rel="alternate" hreflang="${entry.lang}" href="${escapeHtml(entry.href)}"/>`
    )).join('');
    const modified = /^\d{4}-\d{2}-\d{2}/.test(String(lastmod || ''))
      ? `<lastmod>${escapeHtml(String(lastmod).slice(0, 10))}</lastmod>`
      : '';
    return `<url><loc>${escapeHtml(loc)}</loc>${modified}${alternateTags}</url>`;
  };
  const categoryEntries = Object.keys(CATEGORY_SLUGS).flatMap((type) => {
    const ko = `${PRODUCTION_ORIGIN}${categoryLandingPath(type, 'ko')}`;
    const en = `${PRODUCTION_ORIGIN}${categoryLandingPath(type, 'en')}`;
    const alternates = [
      { lang: 'ko', href: ko },
      { lang: 'en', href: en },
      { lang: 'x-default', href: ko }
    ];
    return [urlEntry(ko, '', alternates), urlEntry(en, '', alternates)];
  });
  const entries = [
    urlEntry(`${PRODUCTION_ORIGIN}/`, '', homeAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/en/`, '', homeAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/about/`, '', aboutAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/en/about/`, '', aboutAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/market/`, '', marketAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/en/market/`, '', marketAlternates),
    ...categoryEntries,
    ...validPosts.map((post) => urlEntry(
      reportSiteUrl(post.href),
      post.updatedAt || post.registeredAt || post.reportDate || post.date,
      reportAlternates(validPosts, post)
    ))
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>\n`;
}

export async function loadPosts(request, env) {
  const url = new URL('/data/posts.json', request.url);
  const response = env?.ASSETS?.fetch
    ? await env.ASSETS.fetch(new Request(url, { headers: { accept: 'application/json' } }))
    : await fetch(url);
  if (!response.ok) throw new Error(`POSTS_FETCH_${response.status}`);
  const posts = await response.json();
  if (!Array.isArray(posts)) throw new Error('POSTS_INVALID');
  return posts;
}
