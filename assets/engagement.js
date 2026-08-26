(() => {
  const HOST = 'snowshagal.com';
  const ENDPOINT = '/api/engagement';
  const HEARTBEAT_MS = 30000;

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
    if (height <= viewport || height <= 0) return 100;
    const position = Math.max(0, win.scrollY || win.pageYOffset || root?.scrollTop || body?.scrollTop || 0);
    return Math.max(0, Math.min(100, Math.round(((position + viewport) / height) * 100)));
  }

  function createTracker(win, doc) {
    if (!shouldTrack(win.location) || !win.crypto?.randomUUID || !win.fetch) return null;
    const sessionId = win.crypto.randomUUID();
    let activeMs = 0;
    let maxScroll = scrollDepth(win, doc);
    let activeSince = null;
    let lastSentActive = -1;
    let lastSentScroll = -1;
    let stopped = false;

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
      maxScroll = Math.max(maxScroll, scrollDepth(win, doc));
      return { active: Math.max(0, Math.round(value)), scroll: maxScroll };
    }

    function send(force = false) {
      if (stopped && !force) return;
      const current = snapshot();
      if (!force && current.active === lastSentActive && current.scroll === lastSentScroll) return;
      if (force && current.active === lastSentActive && current.scroll === lastSentScroll) return;
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
      setActive(isForeground());
      if (!isForeground()) send();
    }

    function updateScroll() {
      maxScroll = Math.max(maxScroll, scrollDepth(win, doc));
    }

    function stop() {
      if (stopped) return;
      setActive(false);
      send(true);
      stopped = true;
      win.clearInterval(timer);
    }

    if (isForeground()) activeSince = now();
    doc.addEventListener('visibilitychange', updateForeground, { passive: true });
    win.addEventListener('focus', updateForeground, { passive: true });
    win.addEventListener('blur', updateForeground, { passive: true });
    win.addEventListener('scroll', updateScroll, { passive: true });
    win.addEventListener('pagehide', stop, { once: true });
    const timer = win.setInterval(() => send(), HEARTBEAT_MS);
    return { snapshot, send, stop, sessionId };
  }

  window.__snowshagalEngagementTest = { shouldTrack, isExcludedPath, scrollDepth, createTracker };
  createTracker(window, document);
})();
