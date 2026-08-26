const OWNER = "snowshagal-bot";
const REPO = "market-research-site";
const BRANCH = "main";
const PRODUCTION_HOSTNAME = "snowshagal.com";
const API_VERSION = "2026-03-10";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_COVER_BYTES = 4 * 1024 * 1024;

const TYPE_LABELS = {
  daily: "주식 리포트",
  weekly: "위클리 리포트",
  research: "비정기 리서치",
  basics: "시장 공부",
  note: "끄적끄적",
};
const EN_TYPE_LABELS = {
  daily: "Daily",
  weekly: "Weekly",
  research: "Research",
  basics: "Market Basics",
  note: "Notes",
};

function postLanguage(post) {
  return post?.lang === "en" ? "en" : "ko";
}

function typeLabel(type, lang) {
  return lang === "en" ? EN_TYPE_LABELS[type] : TYPE_LABELS[type];
}

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function encodeRepoPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function secretsMatch(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "market-research-site-admin",
  };
}

async function gh(token, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }

  if (!response.ok) {
    const error = new Error(body?.message || `GitHub API ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function isFile(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function";
}

function isStandaloneHtml(source) {
  return /<!doctype\s+html/i.test(source) && /<html(?:\s|>)/i.test(source) && /<\/html>/i.test(source);
}

function coverExtension(file) {
  const allowedExtensions = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
  };
  const filenameExtension = String(file?.name || "").split(".").pop()?.toLowerCase() || "";
  if (!allowedExtensions[file?.type]?.includes(filenameExtension)) return "";
  return file.type === "image/jpeg" ? "jpg" : filenameExtension;
}

function isManagedPath(path, root) {
  if (typeof path !== "string" || path.includes("\\") || path.startsWith("/") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.length >= 2
    && segments[0] === root
    && segments.slice(1).every((segment) => segment && segment !== "." && segment !== "..");
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

function sortPosts(posts) {
  return posts.sort((left, right) => {
    const dateOrder = String(right.reportDate || right.date || "").localeCompare(String(left.reportDate || left.date || ""));
    if (dateOrder) return dateOrder;
    return String(right.registeredAt || "").localeCompare(String(left.registeredAt || ""));
  });
}

function postsJavaScript(posts) {
  return `window.RESEARCH_POSTS = ${JSON.stringify(posts, null, 2)};\n`;
}

function metadataEntries(posts, searchIndex = null) {
  const entries = [
    {
      path: "data/posts.json",
      mode: "100644",
      type: "blob",
      content: `${JSON.stringify(posts, null, 2)}\n`,
    },
    {
      path: "data/posts.js",
      mode: "100644",
      type: "blob",
      content: postsJavaScript(posts),
    },
  ];

  if (Array.isArray(searchIndex)) {
    entries.push(
      {
        path: "data/search-index.json",
        mode: "100644",
        type: "blob",
        content: `${JSON.stringify(searchIndex, null, 2)}\n`,
      },
      {
        path: "data/search-index.js",
        mode: "100644",
        type: "blob",
        content: `window.SEARCH_INDEX = ${JSON.stringify(searchIndex)};\n`,
      }
    );
  }

  return entries;
}

function deletedEntry(path) {
  return { path, mode: "100644", type: "blob", sha: null };
}

async function currentRef(token) {
  return gh(token, `/git/ref/heads/${BRANCH}`);
}

async function createCommit(token, parentSha, baseTreeSha, entries, message) {
  const tree = await gh(token, "/git/trees", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  return gh(token, "/git/commits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
  });
}

async function updateRef(token, originalSha, commitSha) {
  const latestRef = await currentRef(token);
  if (latestRef.object.sha !== originalSha) return false;
  await gh(token, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  return true;
}

function validateEditableFields(form) {
  const type = String(form.get("type") || "");
  const reportDate = String(form.get("reportDate") || "");
  const title = String(form.get("title") || "").trim();
  if (!TYPE_LABELS[type]) return { error: "지원하지 않는 카테고리입니다." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return { error: "리포트 날짜를 확인해 주세요." };
  if (!title) return { error: "제목을 입력해 주세요." };
  return {
    type,
    reportDate,
    title,
    subtitle: String(form.get("subtitle") || "").trim(),
    description: String(form.get("description") || "").trim(),
    summaryProvided: form.has("summary"),
    summary: String(form.get("summary") || "").trim().slice(0, 500),
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (new URL(request.url).hostname !== PRODUCTION_HOSTNAME) {
    return reply({ ok: false, error: "PREVIEW_READ_ONLY", message: "Preview와 로컬 환경에서는 게시물을 변경할 수 없습니다." }, 403);
  }
  if (!env.ADMIN_KEY || !env.GITHUB_TOKEN) {
    return reply({ ok: false, error: "SERVER_NOT_CONFIGURED", message: "관리자 환경 변수가 설정되지 않았습니다." }, 503);
  }

  if (!secretsMatch(request.headers.get("X-Admin-Key") || "", env.ADMIN_KEY)) {
    return reply({ ok: false, error: "UNAUTHORIZED", message: "관리자 키가 올바르지 않습니다." }, 401);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply({ ok: false, error: "INVALID_FORM", message: "요청 형식을 확인해 주세요." }, 400);
  }

  const action = String(form.get("action") || "");
  const id = String(form.get("id") || "");
  if (!new Set(["update", "delete"]).has(action)) {
    return reply({ ok: false, error: "INVALID_ACTION", message: "지원하지 않는 작업입니다." }, 400);
  }
  if (!id) return reply({ ok: false, error: "INVALID_ID", message: "게시물 ID가 필요합니다." }, 400);

  let editFields = null;
  let replacementHtml = null;
  let coverFile = null;
  let coverAction = "keep";

  if (action === "update") {
    editFields = validateEditableFields(form);
    if (editFields.error) return reply({ ok: false, error: "INVALID_INPUT", message: editFields.error }, 400);

    const file = form.get("file");
    if (isFile(file) && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) return reply({ ok: false, error: "FILE_TOO_LARGE", message: "HTML 파일은 5MB 이하여야 합니다." }, 413);
      replacementHtml = await file.text();
      if (!isStandaloneHtml(replacementHtml)) {
        return reply({ ok: false, error: "INVALID_HTML", message: "독립 실행형 HTML 파일인지 확인해 주세요." }, 400);
      }
    }

    coverAction = String(form.get("coverAction") || "keep");
    if (!new Set(["keep", "replace", "remove"]).has(coverAction)) {
      return reply({ ok: false, error: "INVALID_COVER_ACTION", message: "커버 처리 방식을 확인해 주세요." }, 400);
    }
    const candidate = form.get("cover");
    if (isFile(candidate) && candidate.size > 0) coverFile = candidate;
    if (coverAction === "replace") {
      const extension = coverExtension(coverFile);
      if (!coverFile || !extension) return reply({ ok: false, error: "INVALID_COVER", message: "JPG, PNG 또는 WebP 커버를 선택해 주세요." }, 400);
      if (coverFile.size > MAX_COVER_BYTES) return reply({ ok: false, error: "COVER_TOO_LARGE", message: "커버 이미지는 4MB 이하여야 합니다." }, 413);
    } else if (coverFile) {
      return reply({ ok: false, error: "UNEXPECTED_COVER", message: "커버 교체를 선택한 경우에만 이미지를 첨부할 수 있습니다." }, 400);
    }
  }

  try {
    const ref = await currentRef(env.GITHUB_TOKEN);
    const baseSha = ref.object.sha;
    let parentCommit, postsFile, searchIndexFile;
    try {
      [parentCommit, postsFile, searchIndexFile] = await Promise.all([
        gh(env.GITHUB_TOKEN, `/git/commits/${baseSha}`),
        gh(env.GITHUB_TOKEN, `/contents/${encodeRepoPath("data/posts.json")}?ref=${encodeURIComponent(baseSha)}`),
        gh(env.GITHUB_TOKEN, `/contents/${encodeRepoPath("data/search-index.json")}?ref=${encodeURIComponent(baseSha)}`),
      ]);
    } catch (err) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_READ_FAILED",
        message: `저장소 데이터 또는 검색 인덱스를 읽는 중 오류가 발생했습니다: ${err.message}`
      }, 500);
    }

    const posts = JSON.parse(decodeBase64Utf8(postsFile.content));
    let searchIndex;
    try {
      searchIndex = JSON.parse(decodeBase64Utf8(searchIndexFile.content));
    } catch (err) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_READ_FAILED",
        message: `검색 인덱스 JSON 파싱에 실패했습니다: ${err.message}`
      }, 500);
    }

    if (!Array.isArray(posts) || !Array.isArray(searchIndex)) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_INTEGRITY_FAILED",
        message: "게시물 목록 또는 검색 인덱스가 배열 형식이 아닙니다."
      }, 500);
    }

    if (posts.length !== searchIndex.length) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_INTEGRITY_FAILED",
        message: `기존 게시물 수(${posts.length})와 검색 인덱스 수(${searchIndex.length})가 일치하지 않습니다.`
      }, 500);
    }

    const postIndex = posts.findIndex((post) => post.id === id);
    if (postIndex < 0) return reply({ ok: false, error: "POST_NOT_FOUND", message: "게시물을 찾을 수 없습니다." }, 404);
    const existing = posts[postIndex];

    const searchIdx = searchIndex.findIndex((item) => item && item.id === id);
    if (searchIdx < 0) {
      return reply({
        ok: false,
        error: "SEARCH_INDEX_INTEGRITY_FAILED",
        message: "검색 인덱스에서 해당 게시물 ID를 찾을 수 없습니다."
      }, 500);
    }

    if (!isManagedPath(existing.href, "reports")) {
      return reply({ ok: false, error: "UNSAFE_REPORT_PATH", message: "안전하지 않은 리포트 경로는 변경할 수 없습니다." }, 400);
    }
    if (existing.coverImage && !isManagedPath(existing.coverImage, "covers")) {
      return reply({ ok: false, error: "UNSAFE_COVER_PATH", message: "안전하지 않은 커버 경로는 변경할 수 없습니다." }, 400);
    }
    if (action === "delete" && String(form.get("confirmTitle") || "") !== existing.title) {
      return reply({ ok: false, error: "DELETE_CONFIRMATION_MISMATCH", message: "삭제 확인 제목이 현재 게시물 제목과 일치하지 않습니다." }, 400);
    }

    const entries = [];
    let commitMessage;
    let resultPost = null;

    if (action === "delete") {
      posts.splice(postIndex, 1);
      searchIndex.splice(searchIdx, 1);

      if (posts.length !== searchIndex.length) {
        return reply({
          ok: false,
          error: "SEARCH_INDEX_INTEGRITY_FAILED",
          message: "삭제 후 데이터 정합성 검증에 실패했습니다."
        }, 500);
      }

      entries.push(deletedEntry(existing.href));
      if (existing.coverImage) entries.push(deletedEntry(existing.coverImage));
      entries.push(...metadataEntries(sortPosts(posts), searchIndex));
      commitMessage = `Delete ${existing.title}`;
    } else {
      const updated = {
        ...existing,
        type: editFields.type,
        typeLabel: typeLabel(editFields.type, postLanguage(existing)),
        date: editFields.reportDate,
        reportDate: editFields.reportDate,
        title: editFields.title,
        subtitle: editFields.subtitle,
        description: editFields.description,
        updatedAt: new Date().toISOString(),
      };
      if (editFields.summaryProvided) {
        if (editFields.summary) updated.summary = editFields.summary;
        else delete updated.summary;
      }

      if (replacementHtml !== null) {
        entries.push({ path: existing.href, mode: "100644", type: "blob", content: replacementHtml });
      }

      if (coverAction === "remove") {
        if (existing.coverImage) entries.push(deletedEntry(existing.coverImage));
        delete updated.coverImage;
      } else if (coverAction === "replace") {
        if (!/^[A-Za-z0-9._-]+$/.test(existing.id)) {
          return reply({ ok: false, error: "UNSAFE_POST_ID", message: "안전하지 않은 게시물 ID에는 커버를 저장할 수 없습니다." }, 400);
        }
        const nextCoverPath = `covers/${existing.id}.${coverExtension(coverFile)}`;
        if (existing.coverImage && existing.coverImage !== nextCoverPath) entries.push(deletedEntry(existing.coverImage));
        const blob = await gh(env.GITHUB_TOKEN, "/git/blobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: encodeBase64(await coverFile.arrayBuffer()), encoding: "base64" }),
        });
        entries.push({ path: nextCoverPath, mode: "100644", type: "blob", sha: blob.sha });
        updated.coverImage = nextCoverPath;
      }

      posts[postIndex] = updated;

      searchIndex[searchIdx] = {
        ...searchIndex[searchIdx],
        category: updated.type,
        typeLabel: updated.typeLabel,
        title: updated.title,
        subtitle: updated.subtitle,
        date: updated.reportDate,
        summary: updated.summary || updated.description,
        coverImage: updated.coverImage ? `/${updated.coverImage.replace(/^\/+/, '')}` : '',
        ...(replacementHtml !== null ? { bodyText: extractSearchText(replacementHtml) } : {})
      };

      if (posts.length !== searchIndex.length) {
        return reply({
          ok: false,
          error: "SEARCH_INDEX_INTEGRITY_FAILED",
          message: "수정 후 데이터 정합성 검증에 실패했습니다."
        }, 500);
      }

      entries.push(...metadataEntries(sortPosts(posts), searchIndex));
      commitMessage = `Update ${updated.title}`;
      resultPost = updated;
    }

    const commit = await createCommit(env.GITHUB_TOKEN, baseSha, parentCommit.tree.sha, entries, commitMessage);
    if (!(await updateRef(env.GITHUB_TOKEN, baseSha, commit.sha))) {
      return reply({ ok: false, error: "REPOSITORY_CHANGED", message: "저장소가 변경되었습니다. 새로고침 후 다시 시도하세요." }, 409);
    }

    return reply({ ok: true, action, post: resultPost, commit: commit.sha, apiVersion: API_VERSION });
  } catch (error) {
    console.error("post management failed", { status: error?.status, message: error?.message });
    if (error?.status === 409 || error?.status === 422) {
      return reply({ ok: false, error: "REPOSITORY_CHANGED", message: "저장소가 변경되었습니다. 새로고침 후 다시 시도하세요." }, 409);
    }
    return reply({ ok: false, error: "MANAGE_FAILED", message: "게시물 처리에 실패했습니다." }, 500);
  }
}
