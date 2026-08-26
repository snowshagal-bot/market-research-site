const OWNER = 'snowshagal-bot';
const REPO = 'market-research-site';
const BRANCH = 'main';
const PRODUCTION_HOSTNAME = 'snowshagal.com';
const API_VERSION = '2026-03-10';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;

const TYPE_LABELS = {
  daily: '주식 리포트',
  weekly: '위클리 리포트',
  research: '비정기 리서치',
  basics: '시장 공부',
  note: '끄적끄적'
};
const EN_TYPE_LABELS = {
  daily: 'Daily',
  weekly: 'Weekly',
  research: 'Research',
  basics: 'Market Basics',
  note: 'Notes'
};

function typeLabel(type, lang) {
  return lang === 'en' ? EN_TYPE_LABELS[type] : TYPE_LABELS[type];
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function encodeRepoPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value || '').replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function safeFilename(input) {
  let name = String(input || '').replace(/[\\/:*?"<>|\0]/g, '-').replace(/\s+/g, ' ').trim();
  if (!name) name = 'report.html';
  if (!/\.html?$/i.test(name)) name += '.html';
  return name.slice(0, 180);
}

function coverExtension(file) {
  const extension = String(file?.name || '').split('.').pop()?.toLowerCase() || '';
  const allowed = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp']
  };
  const mime = String(file?.type || '').toLowerCase();
  return allowed[mime]?.includes(extension) ? extension : '';
}

function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function kstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function simpleHash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

async function secretsMatch(a, b) {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const aa = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function githubHeaders(token) {
  return {
    'accept': 'application/vnd.github+json',
    'authorization': `Bearer ${token}`,
    'x-github-api-version': API_VERSION,
    'user-agent': 'market-research-site-publisher'
  };
}

async function gh(token, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { message: text }; }
  if (!response.ok) {
    const err = new Error(data?.message || `GitHub API ${response.status}`);
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

function extractSearchText(html) {
  if (!html) return '';
  let clean = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<dialog\b[\s\S]*?<\/dialog>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  const boilerplates = [
    /SNOWSHAGAL/gi,
    /MARKET RESEARCH/gi,
    /시장을 읽어주는 사이트/gi,
    /본 사이트의 리서치와 해설은 정보 제공을 목적으로 하며[^.]+투자자문[^.]+않습니다\.?/gi,
    /This site's research and commentary are for informational purposes only[^.]+investment advice[^.]*\.?/gi,
    /Scroll down for the report/gi,
    /Read report/gi,
    /리포트 보기/gi,
    /리포트 읽기/gi,
    /Tistory/gi
  ];
  for (const bp of boilerplates) clean = clean.replace(bp, ' ');
  return clean.replace(/\s+/g, ' ').trim();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (new URL(request.url).hostname !== PRODUCTION_HOSTNAME) {
    return reply({ error: 'PREVIEW_READ_ONLY', message: 'Preview와 로컬 환경에서는 게시할 수 없습니다.' }, 403);
  }

  if (!env.GITHUB_TOKEN || !env.ADMIN_KEY) {
    return reply({
      error: 'SERVER_NOT_CONFIGURED',
      message: 'Cloudflare에 GITHUB_TOKEN과 ADMIN_KEY 비밀값을 먼저 설정해야 합니다.'
    }, 503);
  }

  const suppliedKey = request.headers.get('x-admin-key') || '';
  if (!(await secretsMatch(suppliedKey, env.ADMIN_KEY))) {
    return reply({ error: 'UNAUTHORIZED', message: '관리자 키가 올바르지 않습니다.' }, 401);
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return reply({ error: 'BAD_FORM', message: '게시 데이터를 읽을 수 없습니다.' }, 400);
  }

  const file = form.get('file');
  const cover = form.get('cover');
  const type = String(form.get('type') || '').trim();
  const lang = String(form.get('lang') || '').trim();
  const translationGroup = String(form.get('translationGroup') || '').trim();
  const reportDate = String(form.get('reportDate') || '').trim();
  const title = String(form.get('title') || '').trim().slice(0, 180);
  const subtitle = String(form.get('subtitle') || '').trim().slice(0, 240);
  const description = String(form.get('description') || '').trim().slice(0, 700);
  const summary = String(form.get('summary') || '').trim().slice(0, 500);
  const filename = safeFilename(form.get('filename') || file?.name || 'report.html');

  if (!file || typeof file.text !== 'function') return reply({ error: 'NO_FILE', message: 'HTML 파일이 없습니다.' }, 400);
  if (!TYPE_LABELS[type]) return reply({ error: 'BAD_TYPE', message: '카테고리를 확인하세요.' }, 400);
  if (!['ko', 'en'].includes(lang)) return reply({ error: 'BAD_LANG', message: '언어는 ko 또는 en이어야 합니다.' }, 400);
  if (translationGroup && (!/^[A-Za-z0-9._:-]+$/.test(translationGroup) || translationGroup.length > 180)) {
    return reply({ error: 'BAD_TRANSLATION_GROUP', message: '번역 연결 정보를 확인하세요.' }, 400);
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(reportDate)) return reply({ error: 'BAD_DATE', message: '리포트 기준일을 확인하세요.' }, 400);
  if (!title) return reply({ error: 'NO_TITLE', message: '제목을 입력하세요.' }, 400);
  if (Number(file.size || 0) > MAX_FILE_BYTES) return reply({ error: 'FILE_TOO_LARGE', message: '현재 게시기는 5MB 이하 HTML 파일만 지원합니다.' }, 413);

  const hasCover = Boolean(cover && typeof cover.arrayBuffer === 'function' && Number(cover.size || 0) > 0);
  const coverExt = hasCover ? coverExtension(cover) : '';
  if (hasCover && !coverExt) return reply({ error: 'BAD_COVER_TYPE', message: '대표 커버는 JPG, PNG, WebP 이미지만 지원합니다.' }, 400);
  if (hasCover && Number(cover.size || 0) > MAX_COVER_BYTES) return reply({ error: 'COVER_TOO_LARGE', message: '대표 커버 이미지는 4MB 이하여야 합니다.' }, 413);

  const html = await file.text();
  if (!/<(?:!doctype\s+html|html\b)/i.test(html.slice(0, 10000))) {
    return reply({ error: 'NOT_HTML', message: '독립 실행형 HTML 파일인지 확인하세요.' }, 400);
  }

  const token = env.GITHUB_TOKEN;
  const reportPath = lang === 'en' ? `reports/en/${filename}` : `reports/${filename}`;
  const href = reportPath;
  const now = new Date();
  const registeredAt = now.toISOString();
  const registeredDate = kstDate(now);

  try {
    const postsFile = await gh(token, `/contents/${encodeRepoPath('data/posts.json')}?ref=${encodeURIComponent(BRANCH)}`);
    const postsText = decodeBase64Utf8(postsFile.content);
    let posts = JSON.parse(postsText);
    if (!Array.isArray(posts)) throw new Error('posts.json 형식이 올바르지 않습니다.');

    if (translationGroup) {
      const targetLanguage = lang === 'en' ? 'ko' : 'en';
      const pairedPost = posts.find(post => {
        const postLanguage = post?.lang === 'en' ? 'en' : 'ko';
        const postTranslationKey = String(post?.translationGroup || post?.id || '');
        return postLanguage === targetLanguage && postTranslationKey === translationGroup;
      });
      if (!pairedPost) {
        return reply({ error: 'BAD_TRANSLATION_GROUP', message: '선택한 번역 짝을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택하세요.' }, 400);
      }
      const pairedDate = String(pairedPost.reportDate || pairedPost.date || '');
      if (pairedDate !== reportDate) {
        return reply({ error: 'PAIR_DATE_MISMATCH', message: `리포트 기준일은 번역 짝과 같은 ${pairedDate || '날짜'}이어야 합니다.` }, 400);
      }
    }

    if (posts.some(p => p.href === href)) {
      return reply({ error: 'DUPLICATE', message: '같은 파일명의 리포트가 이미 등록되어 있습니다. 파일명을 확인하세요.' }, 409);
    }

    const id = `${reportDate}-${type}-${simpleHash(`${lang}|${filename}|${title}|${reportDate}`)}`;
    const coverPath = hasCover ? `covers/${id}.${coverExt}` : null;
    const post = {
      id,
      type,
      typeLabel: typeLabel(type, lang),
      lang,
      date: reportDate,
      reportDate,
      registeredDate,
      registeredAt,
      legacyImport: false,
      title,
      subtitle,
      description,
      ...(summary ? { summary } : {}),
      href,
      ...(translationGroup ? { translationGroup } : {}),
      ...(coverPath ? { coverImage: coverPath } : {})
    };

    posts.push(post);
    posts.sort((a, b) => {
      const da = String(a.reportDate || a.date || '');
      const db = String(b.reportDate || b.date || '');
      if (da !== db) return db.localeCompare(da);
      return String(b.registeredAt || '').localeCompare(String(a.registeredAt || ''));
    });

    const postsJson = `${JSON.stringify(posts, null, 2)}\n`;
    const postsJs = `window.RESEARCH_POSTS = ${JSON.stringify(posts, null, 2)};\n`;

    // Automatic Search Index update
    let searchIndex = [];
    try {
      const searchIndexFile = await gh(token, `/contents/${encodeRepoPath('data/search-index.json')}?ref=${encodeURIComponent(BRANCH)}`);
      searchIndex = JSON.parse(decodeBase64Utf8(searchIndexFile.content));
    } catch (_) {
      searchIndex = [];
    }

    const searchEntry = {
      id,
      lang,
      category: type,
      typeLabel: typeLabel(type, lang),
      title,
      subtitle,
      date: reportDate,
      registeredAt,
      summary: summary || description,
      tags: [],
      url: `/${href.replace(/^\/+/, '')}`,
      coverImage: coverPath ? `/${coverPath.replace(/^\/+/, '')}` : '',
      bodyText: extractSearchText(html)
    };

    searchIndex.push(searchEntry);
    searchIndex.sort((a, b) => {
      const da = String(a.date || '');
      const db = String(b.date || '');
      if (da !== db) return db.localeCompare(da);
      return String(b.registeredAt || '').localeCompare(String(a.registeredAt || ''));
    });

    const searchIndexJson = `${JSON.stringify(searchIndex, null, 2)}\n`;
    const searchIndexJs = `window.SEARCH_INDEX = ${JSON.stringify(searchIndex)};\n`;

    const ref = await gh(token, `/git/ref/heads/${encodeURIComponent(BRANCH)}`);
    const parentSha = ref.object.sha;
    const parentCommit = await gh(token, `/git/commits/${parentSha}`);
    const baseTree = parentCommit.tree.sha;

    let coverEntry = null;
    if (coverPath) {
      const coverBytes = new Uint8Array(await cover.arrayBuffer());
      const coverBlob = await gh(token, '/git/blobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: encodeBase64(coverBytes), encoding: 'base64' })
      });
      coverEntry = { path: coverPath, mode: '100644', type: 'blob', sha: coverBlob.sha };
    }

    const tree = await gh(token, '/git/trees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        base_tree: baseTree,
        tree: [
          { path: reportPath, mode: '100644', type: 'blob', content: html },
          ...(coverEntry ? [coverEntry] : []),
          { path: 'data/posts.json', mode: '100644', type: 'blob', content: postsJson },
          { path: 'data/posts.js', mode: '100644', type: 'blob', content: postsJs },
          { path: 'data/search-index.json', mode: '100644', type: 'blob', content: searchIndexJson },
          { path: 'data/search-index.js', mode: '100644', type: 'blob', content: searchIndexJs }
        ]
      })
    });

    const commit = await gh(token, '/git/commits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `Publish ${reportDate} ${typeLabel(type, lang)}: ${title}`,
        tree: tree.sha,
        parents: [parentSha]
      })
    });

    await gh(token, `/git/refs/heads/${encodeURIComponent(BRANCH)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sha: commit.sha, force: false })
    });

    return reply({
      ok: true,
      id,
      reportDate,
      registeredDate,
      registeredAt,
      reportUrl: `/${href.split('/').map(encodeURIComponent).join('/')}`,
      coverImage: coverPath,
      lang,
      translationGroup: translationGroup || null,
      commitSha: commit.sha
    });
  } catch (err) {
    console.error('publish failed', err);
    if (err.status === 401 || err.status === 403) {
      return reply({ error: 'GITHUB_AUTH', message: 'GitHub 토큰 권한을 확인하세요. 저장소 Contents 쓰기 권한이 필요합니다.' }, 502);
    }
    if (err.status === 409 || err.status === 422) {
      return reply({ error: 'GITHUB_CONFLICT', message: '동시에 저장소가 변경되었습니다. 새로고침 후 다시 게시하세요.' }, 409);
    }
    return reply({ error: 'PUBLISH_FAILED', message: err.message || '게시 처리 중 오류가 발생했습니다.' }, 500);
  }
}
