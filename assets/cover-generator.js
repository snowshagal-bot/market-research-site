(() => {
  const OUTPUT_WIDTH = 900;
  const OUTPUT_HEIGHT = 1350;
  const CAPTURE_PADDING = 32;
  const DEFAULT_CAPTURE_BACKGROUND = '#ece7dc';
  const HEURISTIC_SELECTORS = [
    '.mag-cover',
    '.cover',
    '.cover-page',
    '.cover-frame',
    '.cover-screen',
    '.page.cover',
    '.report-cover',
    '.opener',
    '.page:first-of-type',
    'main'
  ];
  const SAFE_SELECTOR_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  const COVER_CLASS_TOKEN = /(?:^|[-_])cover(?:$|[-_])/i;

  function selectorMeta(doc) {
    return (doc.querySelector('meta[name="report-cover-selector"]')?.content || '').trim();
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
    const candidates = Array.from(doc.querySelectorAll?.('body > section, body > div') || []).slice(0, 12);
    for (const target of candidates) {
      if (!usableCandidate(target)) continue;
      const selector = standaloneCoverSelector(target);
      if (selector) return { target, selector, source: 'heuristic' };
    }
    return null;
  }

  function findCaptureTarget(doc) {
    const declared = selectorMeta(doc);
    if (declared) {
      try {
        const target = doc.querySelector(declared);
        if (usableCandidate(target)) return normalizeCaptureTarget(target, declared, 'meta');
      } catch (_) {}
    }
    for (const selector of HEURISTIC_SELECTORS.slice(0, -2)) {
      const target = doc.querySelector(selector);
      if (usableCandidate(target)) return normalizeCaptureTarget(target, selector, 'heuristic');
    }
    const standaloneCover = findStandaloneImageCover(doc);
    if (standaloneCover) return standaloneCover;
    for (const selector of HEURISTIC_SELECTORS.slice(-2)) {
      const target = doc.querySelector(selector);
      if (usableCandidate(target)) return normalizeCaptureTarget(target, selector, 'heuristic');
    }
    const body = doc.body;
    if (usableCandidate(body, false)) return { target: body, selector: 'body', source: 'heuristic' };
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

  function preferredSelector(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      return findCaptureTarget(doc).selector;
    } catch (_) {
      return '';
    }
  }

  async function resizeServerCapture(blob) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await imageFromUrl(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_WIDTH;
      canvas.height = OUTPUT_HEIGHT;
      const context = canvas.getContext('2d');
      context.fillStyle = DEFAULT_CAPTURE_BACKGROUND;
      context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
      const placement = containPlacement(image.naturalWidth || image.width, image.naturalHeight || image.height);
      context.drawImage(image, placement.x, placement.y, placement.drawWidth, placement.drawHeight);
      return canvasBlob(canvas);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function serverCapture(html, selector, adminKey) {
    const response = await fetch('/api/generate-cover', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': String(adminKey || '')
      },
      body: JSON.stringify({ html: String(html || ''), preferredSelector: selector })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.message || 'Browser Rendering 커버 생성에 실패했습니다.');
      error.code = String(data.error || 'COVER_GENERATION_FAILED');
      error.status = response.status;
      throw error;
    }
    const type = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/webp'].includes(type)) throw new Error('커버 이미지 응답 형식이 올바르지 않습니다.');
    const captured = await response.blob();
    const { blob, extension } = await resizeServerCapture(captured);
    return {
      file: new File([blob], `generated-cover.${extension}`, { type: blob.type || `image/${extension}` }),
      method: 'browser-rendering',
      selector: response.headers.get('x-cover-selector') || selector
    };
  }

  function canUseTemplateFallback(error) {
    const code = String(error?.code || '');
    return !code || [
      'BROWSER_RENDERING_FAILED',
      'BROWSER_RENDERING_TIMEOUT',
      'INVALID_RENDER_RESPONSE',
      'INVALID_RENDER_SIZE'
    ].includes(code);
  }

  async function generate({ html, template, adminKey }) {
    const selector = preferredSelector(html);
    if (selector) {
      try { return await serverCapture(html, selector, adminKey); }
      catch (error) {
        if (!canUseTemplateFallback(error)) throw error;
        const fallback = await createTemplateCover(template);
        return { ...fallback, attemptedSelector: selector, captureError: error?.message || 'Browser Rendering 실패' };
      }
    }
    const fallback = await createTemplateCover(template);
    return { ...fallback, attemptedSelector: '', captureError: '' };
  }

  window.MARKET_COVER_GENERATOR = {
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT,
    HEURISTIC_SELECTORS,
    selectorMeta,
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
