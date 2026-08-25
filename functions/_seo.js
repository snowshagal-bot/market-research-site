export const PRODUCTION_ORIGIN = 'https://snowshagal.com';

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
  const image = post.coverImage ? absoluteSiteUrl(post.coverImage) : '';
  const alternates = reportAlternates(posts, post)
    .map((entry) => `<link rel="alternate" hreflang="${entry.lang}" href="${escapeHtml(entry.href)}">`)
    .join('');
  const descriptionTags = description
    ? `<meta name="description" content="${escapeHtml(description)}"><meta property="og:description" content="${escapeHtml(description)}">`
    : '';
  const imageTag = image ? `<meta property="og:image" content="${escapeHtml(image)}">` : '';

  return `<link rel="canonical" href="${escapeHtml(canonical)}">${alternates}${descriptionTags}<meta property="og:type" content="article"><meta property="og:site_name" content="Market Research"><meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'ko_KR'}"><meta property="og:title" content="${escapeHtml(post.title)}"><meta property="og:url" content="${escapeHtml(canonical)}">${imageTag}`;
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
