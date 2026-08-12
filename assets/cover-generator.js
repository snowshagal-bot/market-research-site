(() => {
  const OUTPUT_WIDTH = 900;
  const OUTPUT_HEIGHT = 1350;
  const HEURISTIC_SELECTORS = [
    '.cover',
    '.cover-page',
    '.cover-screen',
    '.page.cover',
    '.page:first-of-type',
    '.report-cover',
    'main'
  ];

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

  function findCaptureTarget(doc) {
    const declared = selectorMeta(doc);
    if (declared) {
      try {
        const target = doc.querySelector(declared);
        if (usableCandidate(target)) return { target, selector: declared, source: 'meta' };
      } catch (_) {}
    }
    for (const selector of HEURISTIC_SELECTORS) {
      const target = doc.querySelector(selector);
      if (usableCandidate(target)) return { target, selector, source: 'heuristic' };
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

  function cloneWithComputedStyles(node, view) {
    const clone = node.cloneNode(true);
    const sources = [node, ...node.querySelectorAll('*')];
    const clones = [clone, ...clone.querySelectorAll('*')];
    sources.forEach((source, index) => {
      const target = clones[index];
      if (!target?.style) return;
      const computed = view.getComputedStyle(source);
      target.style.cssText = [...computed].map(property => `${property}:${computed.getPropertyValue(property)};`).join('');
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    return clone;
  }

  function imageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('렌더링 결과를 이미지로 읽을 수 없습니다.'));
      image.src = url;
    });
  }

  async function captureTarget(doc, candidate) {
    const rect = candidate.target.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || candidate.target.scrollWidth || doc.documentElement.clientWidth));
    const height = Math.max(1, Math.round(rect.height || candidate.target.scrollHeight || doc.documentElement.clientHeight));
    if (width < 80 || height < 80) throw new Error('캡처 영역이 너무 작습니다.');
    const styledClone = cloneWithComputedStyles(candidate.target, doc.defaultView);
    const markup = new XMLSerializer().serializeToString(styledClone);
    const serialized = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
    {
      const image = await imageFromUrl(svgUrl);
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_WIDTH;
      canvas.height = OUTPUT_HEIGHT;
      const context = canvas.getContext('2d');
      context.fillStyle = '#f3eddf';
      context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
      const scale = Math.max(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      context.drawImage(image, (OUTPUT_WIDTH - drawWidth) / 2, 0, drawWidth, drawHeight);
      const { blob, extension } = await canvasBlob(canvas);
      return {
        file: new File([blob], `generated-cover.${extension}`, { type: blob.type || `image/${extension}` }),
        method: candidate.source,
        selector: candidate.selector
      };
    }
  }

  function waitForFrame(iframe) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTML 렌더링 시간이 초과됐습니다.')), 8000);
      iframe.onload = async () => {
        clearTimeout(timer);
        try {
          const doc = iframe.contentDocument;
          if (!doc) throw new Error('HTML 렌더링 문서에 접근할 수 없습니다.');
          await doc.fonts?.ready;
          await Promise.all([...doc.images].map(image => image.complete
            ? Promise.resolve()
            : new Promise(done => { image.onload = image.onerror = done; })));
          resolve(doc);
        } catch (error) { reject(error); }
      };
    });
  }

  async function generate({ html, template, host = document.body }) {
    let iframe;
    let captureError = '';
    try {
      iframe = document.createElement('iframe');
      iframe.className = 'cover-capture-frame';
      iframe.title = '자동 커버 생성용 HTML 렌더링';
      iframe.setAttribute('sandbox', 'allow-same-origin');
      iframe.setAttribute('aria-hidden', 'true');
      const ready = waitForFrame(iframe);
      iframe.srcdoc = String(html || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      host.appendChild(iframe);
      const doc = await ready;
      const candidate = findCaptureTarget(doc);
      if (candidate.target) {
        try { return await captureTarget(doc, candidate); }
        catch (error) { captureError = error?.message || 'HTML 캡처 실패'; }
      }
      const fallback = await createTemplateCover(template);
      return { ...fallback, attemptedSelector: candidate.selector, captureError };
    } catch (error) {
      const fallback = await createTemplateCover(template);
      return { ...fallback, attemptedSelector: '', captureError: error?.message || 'HTML 렌더링 실패' };
    } finally {
      iframe?.remove();
    }
  }

  window.MARKET_COVER_GENERATOR = {
    OUTPUT_WIDTH,
    OUTPUT_HEIGHT,
    HEURISTIC_SELECTORS,
    selectorMeta,
    findCaptureTarget,
    fallbackSummary,
    templateData,
    createTemplateCover,
    generate
  };
})();
