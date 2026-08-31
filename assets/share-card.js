/**
 * Per-report social card, 1200x630.
 *
 * Report covers are 900x1350 portrait and a 1.91:1 unfurl keeps only their
 * middle third, which beheads the title. This composes a landscape card that
 * carries the cover whole on the left with the brand lockup and the category on
 * the right.
 *
 * The report title is deliberately not re-typeset: the cover already carries it,
 * and setting Korean titles of unpredictable length would make the layout
 * fragile. Only the category and the date are drawn, both Latin, so Korean and
 * English reports lay out identically.
 *
 * The same layout is implemented once more in the backfill script that produced
 * the cards for reports published before this existed. Georgia is named in both
 * because it ships on Windows and macOS, so the two renderers agree.
 */
(function (root) {
  'use strict';

  const WIDTH = 1200;
  const HEIGHT = 630;
  const IVORY = '#f7f4ec';
  const NAVY = '#10284b';
  const NAVY2 = '#1e4e83';
  const MUTED = '#718091';
  const LINE = '#d8dfe2';
  const SERIF = 'Georgia, Constantia, "Times New Roman", serif';

  const COVER_BOX = { width: 372, height: 540 };
  const COVER_X = 84;
  const LOGO_SRC = '/assets/brand/snowshagal-logo.webp';
  const LOGO_WIDTH = 300;

  const LABELS = {
    daily: 'DAILY', weekly: 'WEEKLY', research: 'RESEARCH',
    basics: 'MARKET BASICS', note: 'INVESTMENT NOTE'
  };

  function categoryLabel(category) {
    return LABELS[category] || String(category || 'REPORT').toUpperCase();
  }

  function formatDate(value) {
    const text = String(value || '');
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10).replace(/-/g, '.') : '';
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image load failed: ' + source));
      image.src = source;
    });
  }

  function contain(image, boxWidth, boxHeight) {
    const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
    return { width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)) };
  }

  function tracked(context, text, x, y, tracking) {
    let cursor = x;
    for (const character of String(text)) {
      context.fillText(character, cursor, y);
      cursor += context.measureText(character).width + tracking;
    }
    return cursor - x - tracking;
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('canvas encode failed'))), 'image/jpeg', 0.86);
    });
  }

  /**
   * @param {Blob|File|string} cover the report cover, as an upload or a URL
   * @param {{category: string, date: string}} meta
   * @returns {Promise<Blob>} a 1200x630 JPEG
   */
  async function renderShareCard(cover, meta) {
    const coverUrl = typeof cover === 'string' ? cover : URL.createObjectURL(cover);
    try {
      const [coverImage, logo] = await Promise.all([loadImage(coverUrl), loadImage(LOGO_SRC)]);

      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext('2d');
      context.fillStyle = IVORY;
      context.fillRect(0, 0, WIDTH, HEIGHT);

      const size = contain(coverImage, COVER_BOX.width, COVER_BOX.height);
      const coverY = Math.round((HEIGHT - size.height) / 2);
      context.strokeStyle = LINE;
      context.lineWidth = 1;
      context.strokeRect(COVER_X - 0.5, coverY - 0.5, size.width + 1, size.height + 1);
      context.drawImage(coverImage, COVER_X, coverY, size.width, size.height);

      const textX = COVER_X + size.width + 84;
      const logoHeight = Math.round(logo.height * (LOGO_WIDTH / logo.width));
      context.drawImage(logo, textX, 196, LOGO_WIDTH, logoHeight);

      context.fillStyle = NAVY2;
      context.fillRect(textX, 317, 96, 2);

      const label = categoryLabel(meta && meta.category);
      const large = label.length <= 8;
      context.fillStyle = NAVY;
      context.textBaseline = 'alphabetic';
      context.font = `${large ? 44 : 32}px ${SERIF}`;
      tracked(context, label, textX, large ? 392 : 388, 5);

      const date = formatDate(meta && meta.date);
      if (date) {
        context.fillStyle = MUTED;
        context.font = `18px ${SERIF}`;
        tracked(context, date, textX, 434, 2.4);
      }

      return await toBlob(canvas);
    } finally {
      if (typeof cover !== 'string') URL.revokeObjectURL(coverUrl);
    }
  }

  root.SHARE_CARD = { renderShareCard, categoryLabel, formatDate, WIDTH, HEIGHT };
})(typeof window !== 'undefined' ? window : globalThis);
