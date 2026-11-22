(() => {
  const OUTPUT_WIDTH = 900;
  const OUTPUT_HEIGHT = 1350;
  const CAPTURE_PADDING = 32;
  const DEFAULT_CAPTURE_BACKGROUND = '#ece7dc';
  const HEURISTIC_SELECTORS = [
    '.cvwrap > .cv',
    '.cvwrap .cv',
    '.cv',
    '.cover-frame',
    '.cover-page',
    '.mag-cover',
    '.cover-screen',
    '.report-cover',
    '.cover',
    '.page.cover',
    '.opener'
  ];
  const SAFE_SELECTOR_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  const COVER_CLASS_TOKEN = /(?:^|[-_])cover(?:$|[-_])/i;
  // A report without a cover (the Daily since 2026-11-11) declares
  // <meta name="report-cover-mode" content="first-screen">: the top 480×720 of
  // the page is the cover. It outranks report-cover-selector, which outranks
  // the heuristics, exactly as /api/generate-cover decides.
  const FIRST_SCREEN_MODE = 'first-screen';

  function selectorMeta(doc) {
    return (doc.querySelector('meta[name="report-cover-selector"]')?.content || '').trim();
  }

  function coverModeMeta(doc) {
    const mode = (doc.querySelector?.('meta[name="report-cover-mode"]')?.content || '').trim().toLowerCase();
    return mode === FIRST_SCREEN_MODE ? FIRST_SCREEN_MODE : '';
  }

  function usableCandidate(node, allowPlainText = true) {
    if (!node) return false;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const hasVisual = Boolean(node.querySelector?.('img,svg,canvas,video'));
    if (hasVisual) return true;
    if (!allowPlainText) return text.length >= 120 && (node.children?.length || 0) >= 3;
    return text.length >= 8;
  }

  function normalizeCaptureTarget(target, selector, source) {
    if (target?.matches?.('.cover-screen')) {
      const frame = target.querySelector('.cover-frame');
      if (usableCandidate(frame)) return { target: frame, selector: '.cover-frame', source };
    }
    if (target?.matches?.('.cvwrap')) {
      const cv = target.querySelector('.cv');
      if (usableCandidate(cv)) return { target: cv, selector: '.cv', source };
    }
    if (target?.matches?.('.cv')) {
      return { target, selector: '.cv', source };
    }
    return { target, selector, source };
  }

  function standaloneCoverSelector(node) {
    const classes = Array.from(node?.classList || []).filter(className => SAFE_SELECTOR_TOKEN.test(className));
    const coverClass = classes.find(className => COVER_CLASS_TOKEN.test(className));
    if (coverClass) return `.${coverClass}`;

    const label = node?.getAttribute?.('aria-label') || '';
    if (!/(?:cover|커버|표지)/i.test(label)) return '';
    const id = node?.id || '';
    if (SAFE_SELECTOR_TOKEN.test(id)) return `#${id}`;
    return classes[0] ? `.${classes[0]}` : '';
  }

  function findStandaloneImageCover(doc) {
    // A cover is not always a direct child of <body>: a report may wrap its
    // pages in a shell element first. Scan the same first twelve containers in
    // document order that /api/generate-cover scans, so the selector this side
    // suggests and the one the server would pick on its own stay the same.
    const candidates = Array.from(doc.querySelectorAll?.('body section, body div') || []).slice(0, 12);
    for (const target of candidates) {
      if (!usableCandidate(target)) continue;
      const selector = standaloneCoverSelector(target);
      if (selector) return { target, selector, source: 'heuristic' };
    }
    return null;
  }

  function findCaptureTarget(doc) {
    if (coverModeMeta(doc) === FIRST_SCREEN_MODE) {
      return { target: doc.body || null, selector: '', source: 'meta', mode: FIRST_SCREEN_MODE };
    }
    const declared = selectorMeta(doc);
    if (declared) {
      try {
        const target = doc.querySelector(declared);
        if (usableCandidate(target)) return normalizeCaptureTarget(target, declared, 'meta');
      } catch (_) {}
    }
    for (const selector of HEURISTIC_SELECTORS) {
      const target = doc.querySelector(selector);
      if (usableCandidate(target)) return normalizeCaptureTarget(target, selector, 'heuristic');
    }
    const standaloneCover = findStandaloneImageCover(doc);
    if (standaloneCover) return standaloneCover;
    return { target: null, selector: '', source: 'template' };
  }

  function fallbackSummary({ metaSummary = '', summary = '', description = '' } = {}) {
    return String(metaSummary || summary || description || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  function templateData(values = {}) {
    return {
      category: String(values.category || 'REPORT').trim(),
      date: String(values.date || '').trim(),
      title: String(values.title || 'Market Research').replace(/\s+/g, ' ').trim(),
      summary: fallbackSummary(values),
      brand: 'MARKET RESEARCH'
    };
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      const finish = (blob, extension) => blob
        ? resolve({ blob, extension })
        : reject(new Error('이미지 파일을 만들 수 없습니다.'));
      canvas.toBlob(blob => {
        if (blob?.type === 'image/webp') finish(blob, 'webp');
        else canvas.toBlob(png => finish(png, 'png'), 'image/png');
      }, 'image/webp', 0.9);
    });
  }

  function wrapLines(context, text, maxWidth, maxLines) {
    const characters = [...String(text || '')];
    const lines = [];
    let line = '';
    for (const character of characters) {
      const next = line + character;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line.trim());
        line = character;
        if (lines.length === maxLines) break;
      } else line = next;
    }
    if (lines.length < maxLines && line.trim()) lines.push(line.trim());
    if (lines.length === maxLines && characters.length) {
      let last = lines[maxLines - 1];
      while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last.replace(/[\s,.·]+$/, '')}…`;
    }
    return lines;
  }

  async function createTemplateCover(values) {
    const data = templateData(values);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas를 사용할 수 없습니다.');

    context.fillStyle = '#f3eddf';
    context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    context.fillStyle = '#123b35';
    context.fillRect(0, 0, 34, OUTPUT_HEIGHT);
    context.strokeStyle = '#b8b09f';
    context.lineWidth = 2;
    context.strokeRect(82, 82, 736, 1186);
    context.beginPath();
    context.moveTo(82, 310);
    context.lineTo(818, 310);
    context.stroke();

    context.fillStyle = '#173a35';
    context.font = '800 28px Arial, sans-serif';
    context.fillText(data.brand, 116, 148);
    context.fillStyle = '#6c746c';
    context.font = '700 25px Arial, sans-serif';
    context.fillText(data.category.toUpperCase(), 116, 246);
    context.textAlign = 'right';
    context.fillText(data.date, 784, 246);
    context.textAlign = 'left';

    context.fillStyle = '#151a18';
    context.font = '800 74px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
    const titleLines = wrapLines(context, data.title, 650, 5);
    titleLines.forEach((line, index) => context.fillText(line, 116, 440 + index * 94));

    if (data.summary) {
      const summaryTop = Math.max(850, 490 + titleLines.length * 94);
      context.fillStyle = '#46514c';
      context.font = '400 31px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
      const summaryLines = wrapLines(context, data.summary, 650, 5);
      summaryLines.forEach((line, index) => context.fillText(line, 116, summaryTop + index * 52));
    }

    context.fillStyle = '#173a35';
    context.fillRect(116, 1182, 94, 5);
    context.fillStyle = '#59635e';
    context.font = '600 22px Arial, sans-serif';
    context.fillText('INDEPENDENT RESEARCH ARCHIVE', 116, 1230);
    const { blob, extension } = await canvasBlob(canvas);
    return {
      file: new File([blob], `generated-cover.${extension}`, { type: blob.type || `image/${extension}` }),
      method: 'template',
      selector: '',
      data
    };
  }

  function imageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('렌더링 결과를 이미지로 읽을 수 없습니다.'));
      image.src = url;
    });
  }

  function containPlacement(sourceWidth, sourceHeight, padding = CAPTURE_PADDING) {
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = OUTPUT_WIDTH / OUTPUT_HEIGHT;
    const ratioDifference = Math.abs(sourceRatio - targetRatio) / targetRatio;
    const requestedPadding = ratioDifference <= 0.02 ? 0 : padding;
    const safePadding = Math.max(0, Math.min(Number(requestedPadding) || 0, OUTPUT_WIDTH / 4, OUTPUT_HEIGHT / 4));
    const availableWidth = OUTPUT_WIDTH - safePadding * 2;
    const availableHeight = OUTPUT_HEIGHT - safePadding * 2;
    const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    return {
      scale,
      drawWidth,
      drawHeight,
      x: (OUTPUT_WIDTH - drawWidth) / 2,
      y: (OUTPUT_HEIGHT - drawHeight) / 2
    };
  }

  // The first screen is already 2:3, and is meant to be the whole cover: it
  // fills 900×1350 edge to edge, cropping centrally if the capture is off by a
  // pixel, rather than sitting in a padded band of background.
  function fillPlacement(sourceWidth, sourceHeight) {
    const scale = Math.max(OUTPUT_WIDTH / sourceWidth, OUTPUT_HEIGHT / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    return {
      scale,
      drawWidth,
      drawHeight,
      x: (OUTPUT_WIDTH - drawWidth) / 2,
      y: (OUTPUT_HEIGHT - drawHeight) / 2
    };
  }

  function capturePlan(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      const target = findCaptureTarget(doc);
      if (target.mode === FIRST_SCREEN_MODE) return { mode: FIRST_SCREEN_MODE, selector: '' };
      return target.selector ? { mode: 'selector', selector: target.selector } : { mode: 'template', selector: '' };
    } catch (_) {
      return { mode: 'template', selector: '' };
    }
  }

  function preferredSelector(html) {
    return capturePlan(html).selector;
  }

  async function resizeServerCapture(blob, { fill = false } = {}) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await imageFromUrl(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_WIDTH;
      canvas.height = OUTPUT_HEIGHT;
      const context = canvas.getContext('2d');
      context.fillStyle = DEFAULT_CAPTURE_BACKGROUND;
      context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const placement = fill ? fillPlacement(width, height) : containPlacement(width, height);
      context.drawImage(image, placement.x, placement.y, placement.drawWidth, placement.drawHeight);
      return canvasBlob(canvas);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function serverCapture(html, selector, csrfToken, { mode = 'selector' } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = String(csrfToken || '');
    const response = await fetch('/api/generate-cover', {
      method: 'POST',
      headers,
      body: JSON.stringify({ html: String(html || ''), preferredSelector: selector, preferredMode: mode })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.message || 'Browser Rendering 커버 생성에 실패했습니다.');
      error.code = String(data.error || 'COVER_GENERATION_FAILED');
      error.status = response.status;
      if (Number.isInteger(data.upstreamStatus)) error.upstreamStatus = data.upstreamStatus;
      if (Number.isInteger(data.timeoutMs)) error.timeoutMs = data.timeoutMs;
      throw error;
    }
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/webp'].includes(type)) throw new Error('커버 이미지 응답 형식이 올바르지 않습니다.');
    const capturedMode = response.headers.get('x-cover-mode') || mode;
    const captured = await response.blob();
    const { blob, extension } = await resizeServerCapture(captured, { fill: capturedMode === FIRST_SCREEN_MODE });
    return {
      file: new File([blob], `generated-cover.${extension}`, { type: blob.type || `image/${extension}` }),
      method: 'browser-rendering',
      mode: capturedMode,
      selector: capturedMode === FIRST_SCREEN_MODE ? '' : (response.headers.get('x-cover-selector') || selector)
    };
  }

  // Why a capture did not happen, in words the editor can act on, with the
  // code and statuses that tell one failure from another.
  function describeCaptureError(error) {
    const message = String(error?.message || 'Browser Rendering 실패').trim();
    const detail = [
      error?.code,
      error?.status ? `HTTP ${error.status}` : '',
      error?.upstreamStatus ? `Cloudflare ${error.upstreamStatus}` : '',
      error?.timeoutMs ? `제한 ${Math.round(error.timeoutMs / 1000)}초` : ''
    ].filter(Boolean).join(' · ');
    return detail ? `${message} (${detail})` : message;
  }

  function canUseTemplateFallback(error) {
    const code = String(error?.code || '');
    return !code || [
      'COVER_TARGET_NOT_FOUND',
      'COVER_SELECTOR_INVALID',
      'BROWSER_RENDERING_FAILED',
      'BROWSER_RENDERING_TIMEOUT',
      'INVALID_RENDER_RESPONSE',
      'INVALID_RENDER_SIZE'
    ].includes(code);
  }

  // The template is only ever a stand-in for a capture that did not happen,
  // and it always says why: the target that was tried and the reason it failed.
  async function generate({ html, template, csrfToken, adminKey }) {
    const plan = capturePlan(html);
    const token = csrfToken || adminKey;
    if (plan.mode !== 'template') {
      try { return await serverCapture(html, plan.selector, token, { mode: plan.mode }); }
      catch (error) {
        if (!canUseTemplateFallback(error)) throw error;
        const fallback = await createTemplateCover(template);
        return {
          ...fallback,
          attemptedMode: plan.mode,
          attemptedSelector: plan.selector,
          captureError: describeCaptureError(error),
          captureErrorCode: String(error?.code || '')
        };
      }
    }
    const fallback = await createTemplateCover(template);
    return {
      ...fallback,
      attemptedMode: '',
      attemptedSelector: '',
      captureError: '캡처할 표지를 찾지 못했습니다 · head에 report-cover-mode 또는 report-cover-selector 메타가 없고 표지 구조도 감지되지 않았습니다',
      captureErrorCode: 'COVER_TARGET_NOT_FOUND'
    };
  }

  window.MARKET_COVER_GENERATOR = {
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT,
    HEURISTIC_SELECTORS,
    FIRST_SCREEN_MODE,
    selectorMeta,
    coverModeMeta,
    capturePlan,
    fillPlacement,
    describeCaptureError,
    normalizeCaptureTarget,
    standaloneCoverSelector,
    findStandaloneImageCover,
    findCaptureTarget,
    fallbackSummary,
    templateData,
    containPlacement,
    preferredSelector,
    serverCapture,
    canUseTemplateFallback,
    createTemplateCover,
    generate
  };
})();
