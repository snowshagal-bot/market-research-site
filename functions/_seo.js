export const PRODUCTION_ORIGIN = 'https://snowshagal.com';

// Landscape 1200x630 card used wherever a page has no artwork of its own.
export const SOCIAL_FALLBACK_IMAGE = '/assets/social/snowshagal-home.jpg';

// og:image for a report that has its own cover. Report covers are 900x1350
// portrait, and a 1.91:1 unfurler keeps only the middle 35% of them, which cut
// the report title away on four of five sampled covers and sliced through the
// glyphs on one. Open Graph carries a landscape card instead; the cover still
// reaches X through twitter:image, where the summary card does not crop it.
export const SOCIAL_REPORT_IMAGE = '/assets/social/market-close-share.jpg';

// Uploaded report HTML declares no icon, so the shared shell supplies one.
export const FAVICON_TAGS = '<link rel="icon" href="/favicon.ico" sizes="any">'
  + '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">'
  + '<link rel="apple-touch-icon" href="/apple-touch-icon.png">'
  + '<link rel="manifest" href="/site.webmanifest">';

export function postLanguage(post) {
  return post?.lang === 'en' ? 'en' : 'ko';
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
  const group = String(post?.translationGroup || '').trim();
  if (!group) return null;
  const lang = postLanguage(post);
  return posts.find((candidate) => (
    candidate !== post
    && String(candidate?.translationGroup || '').trim() === group
    && postLanguage(candidate) !== lang
  )) || null;
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

export function reportSeoTags(posts, post) {
  const canonical = reportSiteUrl(post.href);
  const lang = postLanguage(post);
  const description = String(post.summary || post.description || '').trim();
  const cover = post.coverImage ? absoluteSiteUrl(post.coverImage) : '';
  // og:image is always a 1200x630 landscape card, so nothing that crops to
  // 1.91:1 can behead the artwork.
  const ogImage = absoluteSiteUrl(cover ? SOCIAL_REPORT_IMAGE : SOCIAL_FALLBACK_IMAGE);
  // X keeps the report's own cover: the summary card shows a small thumbnail
  // rather than a cropped band, so the portrait artwork survives intact.
  const twitterImage = cover || absoluteSiteUrl(SOCIAL_FALLBACK_IMAGE);
  const twitterCard = cover ? 'summary' : 'summary_large_image';
  const counterpart = findTranslationCounterpart(posts, post);
  const alternates = reportAlternates(posts, post)
    .map((entry) => `<link rel="alternate" hreflang="${entry.lang}" href="${escapeHtml(entry.href)}">`)
    .join('');
  const descriptionTags = description
    ? `<meta name="description" content="${escapeHtml(description)}"><meta property="og:description" content="${escapeHtml(description)}"><meta name="twitter:description" content="${escapeHtml(description)}">`
    : '';
  const localeAlternate = counterpart
    ? `<meta property="og:locale:alternate" content="${postLanguage(counterpart) === 'en' ? 'en_US' : 'ko_KR'}">`
    : '';

  return `<link rel="canonical" href="${escapeHtml(canonical)}">${alternates}${descriptionTags}`
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
  const entries = [
    urlEntry(`${PRODUCTION_ORIGIN}/`, '', homeAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/en/`, '', homeAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/about/`, '', aboutAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/en/about/`, '', aboutAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/market/`, '', marketAlternates),
    urlEntry(`${PRODUCTION_ORIGIN}/en/market/`, '', marketAlternates),
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
