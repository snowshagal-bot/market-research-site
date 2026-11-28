(() => {
  const HOST = 'snowshagal.com';
  const ENDPOINT = '/api/engagement';
  const HEARTBEAT_MS = 30000;
  const SCROLL_INPUT_WINDOW_MS = 1500;
  const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

  function isExcludedPath(path) {
    return /^\/(?:admin|api|cdn-cgi)(?:\/|$)/i.test(String(path || ''));
  }

  function shouldTrack(location) {
    return location?.hostname === HOST && !isExcludedPath(location.pathname);
  }

  function scrollDepth(win, doc) {
    const root = doc.documentElement;
    const body = doc.body;
    const height = Math.max(root?.scrollHeight || 0, root?.offsetHeight || 0, body?.scrollHeight || 0, body?.offsetHeight || 0);
    const viewport = Math.max(0, win.innerHeight || root?.clientHeight || 0);
    if (height <= viewport) return 0;
    const position = Math.max(0, win.scrollY ?? win.pageYOffset ?? root?.scrollTop ?? body?.scrollTop ?? 0);
    return Math.min(100, Math.round((position / (height - viewport)) * 100));
  }

  function createTracker(win, doc) {
    if (!shouldTrack(win.location) || !win.crypto?.randomUUID || !win.fetch) return null;
    const sessionId = win.crypto.randomUUID();
    let activeMs = 0;
    let maxScroll = 0;
    let scrollInputUntil = -Infinity;
    let activeSince = null;
    let lastSentActive = -1;
    let lastSentScroll = -1;
    let paused = false;
    let timer;

    const now = () => win.performance?.now ? win.performance.now() : Date.now();
    const isForeground = () => !doc.hidden && (typeof doc.hasFocus !== 'function' || doc.hasFocus());

    function setActive(next) {
      const timestamp = now();
      if (activeSince !== null) activeMs += Math.max(0, timestamp - activeSince);
      activeSince = next ? timestamp : null;
    }

    function snapshot() {
      const timestamp = now();
      const value = activeMs + (activeSince === null ? 0 : Math.max(0, timestamp - activeSince));
      return { active: Math.max(0, Math.round(value)), scroll: maxScroll };
    }

    function send() {
      if (paused) return;
      const current = snapshot();
      if (current.active === lastSentActive && current.scroll === lastSentScroll) return;
      lastSentActive = current.active;
      lastSentScroll = current.scroll;
      try {
        const request = win.fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'omit',
          cache: 'no-store',
          keepalive: true,
          body: JSON.stringify({ session_id: sessionId, path: win.location.pathname, active_ms: current.active, max_scroll: current.scroll })
        });
        if (request?.catch) request.catch(() => {});
      } catch (_) {}
    }

    function updateForeground() {
      if (paused) return;
      const foreground = isForeground();
      setActive(foreground);
      if (!foreground) send();
    }

    function noteScrollInput(event) {
      if (!event.isTrusted || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.type === 'keydown' && (!SCROLL_KEYS.has(event.key)
        || event.target?.isContentEditable || event.target?.closest?.('input, textarea, select, button'))) return;
      scrollInputUntil = now() + SCROLL_INPUT_WINDOW_MS;
    }

    function updateScroll(event) {
      if (!paused && event.isTrusted && isForeground() && now() <= scrollInputUntil) {
        maxScroll = Math.max(maxScroll, scrollDepth(win, doc));
      }
    }

    function stop() {
      if (paused) return;
      setActive(false);
      send();
      paused = true;
      scrollInputUntil = -Infinity;
      win.clearInterval(timer);
    }

    function resume(event) {
      if (!event.persisted || !paused) return;
      paused = false;
      updateForeground();
      timer = win.setInterval(send, HEARTBEAT_MS);
    }

    if (isForeground()) activeSince = now();
    doc.addEventListener('visibilitychange', updateForeground, { passive: true });
    win.addEventListener('focus', updateForeground, { passive: true });
    win.addEventListener('blur', updateForeground, { passive: true });
    for (const input of ['wheel', 'touchmove', 'keydown']) {
      win.addEventListener(input, noteScrollInput, { passive: true });
    }
    win.addEventListener('scroll', updateScroll, { passive: true });
    win.addEventListener('pagehide', stop);
    win.addEventListener('pageshow', resume);
    timer = win.setInterval(send, HEARTBEAT_MS);
    return { snapshot, send, stop, sessionId };
  }

  window.__snowshagalEngagementTest = { shouldTrack, isExcludedPath, scrollDepth, createTracker };
  createTracker(window, document);
})();
