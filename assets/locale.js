(function(root){
  const validLanguages = ['ko', 'en'];

  const copy = {
    ko: {
      categories: {
        daily: { label: '데일리', english: 'DAILY', description: '오늘 시장의 흐름과 수급을 기록합니다.' },
        weekly: { label: '위클리', english: 'WEEKLY', description: '한 주의 시장을 복기하고 다음 변수를 살핍니다.' },
        research: { label: '리서치', english: 'RESEARCH', description: '산업·기업·정책의 구조적 변화를 깊이 읽습니다.' },
        basics: { label: '시장 입문', english: 'MARKET BASICS', description: '경제와 투자의 기본 개념을 차분히 설명합니다.' },
        note: { label: '투자 노트', english: 'INVESTMENT NOTE', description: '데일리·위클리·리서치에 담기 애매하지만 놓치기 아까운 시장 변수와 투자 아이디어를 기록합니다.' }
      },
      themeDark: '다크 모드로 전환',
      themeLight: '라이트 모드로 전환',
      menuOpen: '메뉴 열기',
      menuClose: '메뉴 닫기',
      representative: '대표 리포트',
      coverAlt: '커버 이미지',
      registrationOrder: '홈페이지 등록일 최신순',
      reportOrder: '리포트 기준일 최신순',
      basicsEmpty: '시장 입문 글이 아직 없습니다.',
      empty: '조건에 맞는 글이 없습니다.',
      read: '읽기',
      archiveMore: '더 보기',
      takeawayLabel: '오늘의 한 줄'
    },
    en: {
      categories: {
        daily: { label: 'Daily', english: 'DAILY', description: 'Daily market direction, flows, and key signals.' },
        weekly: { label: 'Weekly', english: 'WEEKLY', description: 'A weekly review of market moves and the variables ahead.' },
        research: { label: 'Research', english: 'RESEARCH', description: 'Deeper analysis of structural shifts in industries, companies, and policy.' },
        basics: { label: 'Market Basics', english: 'MARKET BASICS', description: 'Clear explanations of economic and investing fundamentals.' },
        note: { label: 'Investment Note', english: 'INVESTMENT NOTE', description: 'Timely observations, market variables, and investment ideas.' }
      },
      themeDark: 'Switch to dark mode',
      themeLight: 'Switch to light mode',
      menuOpen: 'Open menu',
      menuClose: 'Close menu',
      representative: 'featured report',
      coverAlt: 'cover image',
      registrationOrder: 'Newest homepage registration first',
      reportOrder: 'Newest report date first',
      basicsEmpty: 'No Market Basics posts yet.',
      empty: 'No English reports match these filters yet.',
      read: 'Read',
      archiveMore: 'Show more',
      takeawayLabel: "Today's takeaway"
    }
  };

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MARKET_AVAILABILITY_COPY = {
    ko: {
      lastVerified: '마지막 검증 완료',
      date: (month, day) => `${month}월 ${day}일`,
      unavailable: date => `${date} Market Close 데이터셋은 검증 미완료로 제공하지 않습니다.`
    },
    en: {
      lastVerified: 'LAST VERIFIED CLOSE',
      date: (month, day) => `${SHORT_MONTHS[month - 1]} ${day}`,
      unavailable: date => `The ${date} Market Close dataset is unavailable pending validation.`
    }
  };

  // Keyed by the session the site expects. An entry may pin the exact
  // last-verified session it applies to (`latest`) and, when the outage is a
  // settled fact rather than pending validation, replace the generic
  // "unavailable pending validation" sentence with its own card
  // (`replacesNotice`). Once the next session is published the expectation
  // moves on and the card disappears on its own.
  const MARKET_TRANSPARENCY_NOTICES = {
    '2026-09-22': {
      latest: '2026-09-21',
      replacesNotice: true,
      ko: {
        title: '9월 22일 Market Close 안내',
        body: [
          '정규장 데이터 수집 구간 중 시스템 중단으로 9월 22일 Market Close는 발행하지 않았습니다.',
          '확인되지 않은 값을 소급해 채우지 않으며, 마지막 검증 완료 데이터인 9월 21일 종가를 표시합니다.'
        ]
      },
      en: {
        title: 'Market Close Notice — Sep 22',
        body: [
          'The Sep 22 Market Close was not published because the regular-session collection window was interrupted.',
          'Unverified values are not reconstructed retrospectively; Sep 21 remains the last verified close.'
        ]
      }
    },
    '2026-09-18': {
      ko: {
        title: '9월 18일 Market Close 안내',
        body: [
          '데이터 제공원 변경으로 인해 9월 18일 정규장 마감 데이터의 검증을 완료하지 못했습니다.',
          '검증되지 않은 값을 임의로 보완하지 않기 위해 해당 일자의 Market Close는 제공하지 않습니다.',
          '새로운 검증 절차를 적용 중이며 다음 거래일부터 정상 제공을 목표로 하고 있습니다.'
        ]
      },
      en: {
        title: 'Market Close Notice — Sep 18',
        body: [
          'Due to a change in one of our market data sources, we could not complete verification of the Sep 18 regular-session close.',
          'We do not publish unverified or reconstructed figures, so Market Close data for this date will remain unavailable.',
          'A revised verification process is being deployed for the next trading session.'
        ]
      }
    }
  };

  // A published session whose stored values keep a known limitation. The note is
  // shown only while that exact date is on screen; the payload itself is never
  // rewritten, and no other date carries it.
  const MARKET_INTEGRITY_NOTICES = {
    '2026-09-14': {
      ko: {
        title: '데이터 안내',
        body: [
          '2026년 9월 14일 Market Close는 당시 수집 방식의 한계로 일부 항목에 정규장 이후 거래가 포함되어 있습니다.',
          '정규장 기준 원천 스냅샷이 보존되지 않아 해당 값은 소급 수정하지 않았습니다.'
        ]
      },
      en: {
        title: 'Data Note',
        body: [
          'Some fields in the Sep 14, 2026 Market Close include post-close trading because of the collection method used at the time.',
          'The original regular-session snapshots were not retained, so these historical values have not been retrospectively altered.'
        ]
      }
    }
  };

  /**
   * Today's KRX session as /api/market/latest sends it (x-krx-session:
   * percent-encoded JSON from functions/_trading-calendar.js krxSessionStatus).
   * The holiday list and names live only there. Returns null for a missing or
   * malformed header, so the page keeps its ordinary display.
   */
  const KRX_SESSION_STATES = ['trading', 'holiday', 'weekend'];
  function parseKrxSessionHeader(value) {
    if (!value) return null;
    let data;
    try { data = JSON.parse(decodeURIComponent(String(value))); } catch (_) { return null; }
    return normalizeKrxSession(data);
  }

  /** The same shape check for a session that arrives already parsed (the homepage bootstrap). */
  function normalizeKrxSession(data) {
    if (!data || typeof data !== 'object') return null;
    if (!ISO_DATE.test(String(data.calendarDate || '')) || !KRX_SESSION_STATES.includes(data.state)) return null;
    const name = data.holidayName;
    const holidayName = name && typeof name.ko === 'string' && typeof name.en === 'string' && name.ko && name.en
      ? { ko: name.ko, en: name.en }
      : null;
    return {
      calendarDate: data.calendarDate,
      state: data.state,
      holidayName: data.state === 'holiday' ? holidayName : null,
      lastTradingDate: ISO_DATE.test(String(data.lastTradingDate || '')) ? data.lastTradingDate : null
    };
  }

  const KRX_SESSION_COPY = {
    ko: {
      closed: 'KRX 휴장',
      weekend: '주말',
      lastClose: '최근 종가',
      today: '오늘은 KRX 휴장일입니다.',
      basis: date => `국내 지수와 수급은 ${date} 마지막 거래일 기준입니다.`
    },
    en: {
      closed: 'KRX CLOSED',
      weekend: 'WEEKEND',
      lastClose: 'LAST CLOSE',
      today: 'The KRX is closed today.',
      basis: date => `Korean indices and investor flows reflect the ${date} last trading session.`
    }
  };

  /**
   * How a closed KRX day reads, or null on a trading day (or with no session
   * information), where the page keeps its TODAY display. It never judges
   * freshness: `latestDate` is the published close on screen, and the
   * "reflects the last trading session" sentence is added only when that close
   * is the last trading session — otherwise the stale notice explains the date.
   */
  function krxSessionDisplay(session, language, { latestDate } = {}) {
    if (!session || session.state === 'trading') return null;
    const lang = language === 'en' ? 'en' : 'ko';
    const text = KRX_SESSION_COPY[lang];
    const reason = session.state === 'holiday' && session.holidayName
      ? (lang === 'en' ? session.holidayName.en.toUpperCase() : session.holidayName.ko)
      : (session.state === 'weekend' ? text.weekend : '');
    const label = reason ? `${text.closed} · ${reason}` : text.closed;
    const last = session.lastTradingDate;
    const basis = last && latestDate === last
      ? text.basis(MARKET_AVAILABILITY_COPY[lang].date(Number(last.slice(5, 7)), Number(last.slice(8, 10))))
      : '';
    return {
      closed: true,
      state: session.state,
      label,
      lastCloseLabel: text.lastClose,
      sentences: [text.today, basis].filter(Boolean)
    };
  }

  /** The note for exactly this market date, or null for every other date. */
  function marketIntegrityNotice(marketDate, language) {
    const date = String(marketDate || '');
    if (!ISO_DATE.test(date)) return null;
    return MARKET_INTEGRITY_NOTICES[date]?.[language === 'en' ? 'en' : 'ko'] || null;
  }

  /**
   * Whether the published Market Close is behind the session the site should
   * already carry. `expectedDate` comes from /api/market/latest's
   * x-market-expected-date header, which the server derives from
   * functions/_trading-calendar.js (trading days and the publish cutoff). The
   * browser keeps no calendar of its own: without a valid expectation, or when
   * the latest date is not older than it, the page stays on TODAY.
   */
  function marketCloseAvailability(latestDate, expectedDate, language) {
    const latest = String(latestDate || '');
    const expected = String(expectedDate || '');
    if (!ISO_DATE.test(latest) || !ISO_DATE.test(expected) || latest >= expected) return { stale: false };
    const lang = language === 'en' ? 'en' : 'ko';
    const text = MARKET_AVAILABILITY_COPY[lang];
    const label = value => {
      const [, month, day] = value.split('-').map(Number);
      return text.date(month, day);
    };
    // The English badge follows the TODAY strip's own label (SEP 09); the
    // sentence keeps the plain form (Sep 9).
    const lastVerifiedDate = language === 'en'
      ? latest.slice(5).replace(/^(\d{2})-(\d{2})$/, (_, month, day) => `${SHORT_MONTHS[Number(month) - 1].toUpperCase()} ${day}`)
      : label(latest);
    const entry = MARKET_TRANSPARENCY_NOTICES[expected];
    const applies = !!entry && (!entry.latest || entry.latest === latest);
    const transparencyNotice = applies ? entry[lang] || null : null;
    return {
      stale: true,
      latestDate: latest,
      expectedDate: expected,
      tag: text.lastVerified,
      dateLabel: lastVerifiedDate,
      badge: `${text.lastVerified} · ${lastVerifiedDate}`,
      notice: transparencyNotice && entry.replacesNotice ? '' : text.unavailable(label(expected)),
      transparencyNotice
    };
  }

  function postLanguage(post) {
    return post?.lang === 'en' ? 'en' : 'ko';
  }

  function siteLanguage(doc) {
    const declared = doc?.documentElement?.dataset?.siteLang || doc?.documentElement?.lang;
    return declared === 'en' ? 'en' : 'ko';
  }

  function groupKey(post) {
    return String(post?.translationGroup || post?.id || '');
  }

  function normalizeReportPath(value) {
    let path = String(value || '').split(/[?#]/, 1)[0];
    try { path = decodeURIComponent(path); } catch (_) {}
    return path.replace(/^\/+/, '').replace(/\\/g, '/');
  }

  function localePosts(posts, language) {
    const locale = validLanguages.includes(language) ? language : 'ko';
    return (Array.isArray(posts) ? posts : []).filter(post => postLanguage(post) === locale);
  }

  function sortPosts(posts) {
    return (Array.isArray(posts) ? posts : []).slice().sort((left, right) => {
      const leftDate = String(left?.reportDate || left?.date || '');
      const rightDate = String(right?.reportDate || right?.date || '');
      if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
      return String(right?.registeredAt || '').localeCompare(String(left?.registeredAt || ''));
    });
  }

  function sortPostsByRegistration(posts) {
    return (Array.isArray(posts) ? posts : []).slice().sort((left, right) => {
      const leftRegistration = String(left?.registeredAt || left?.registeredDate || '');
      const rightRegistration = String(right?.registeredAt || right?.registeredDate || '');
      if (leftRegistration !== rightRegistration) return rightRegistration.localeCompare(leftRegistration);
      const leftDate = String(left?.reportDate || left?.date || '');
      const rightDate = String(right?.reportDate || right?.date || '');
      return rightDate.localeCompare(leftDate);
    });
  }

  function latestByCore(posts, language, coreTypes = ['daily', 'weekly', 'research', 'basics']) {
    const localized = sortPosts(localePosts(posts, language));
    return coreTypes.map(type => localized.find(post => post.type === type)).filter(Boolean);
  }

  function categoryCounts(posts, language, types = ['daily', 'weekly', 'research', 'basics', 'note']) {
    const counts = Object.fromEntries(types.map(type => [type, 0]));
    localePosts(posts, language).forEach(post => {
      if (Object.hasOwn(counts, post.type)) counts[post.type] += 1;
    });
    return counts;
  }

  function searchPosts(posts, language, query = '', type = 'all') {
    const needle = String(query || '').trim().toLowerCase();
    return localePosts(posts, language).filter(post => {
      if (type !== 'all' && post.type !== type) return false;
      if (!needle) return true;
      return `${post.title || ''} ${post.subtitle || ''} ${post.typeLabel || ''} ${post.description || ''}`.toLowerCase().includes(needle);
    });
  }

  function findCurrentPost(posts, pathname) {
    const path = normalizeReportPath(pathname);
    return (Array.isArray(posts) ? posts : []).find(post => normalizeReportPath(post?.href) === path) || null;
  }

  function findCounterpart(posts, currentPostOrPath, targetLanguage) {
    if (!validLanguages.includes(targetLanguage)) return null;
    const current = typeof currentPostOrPath === 'string'
      ? findCurrentPost(posts, currentPostOrPath)
      : currentPostOrPath;
    if (!current) return null;
    const key = groupKey(current);
    if (!key) return null;
    return (Array.isArray(posts) ? posts : []).find(post => postLanguage(post) === targetLanguage && groupKey(post) === key) || null;
  }

  function homepagePath(language, category = '') {
    const base = language === 'en' ? '/en/' : '/';
    return category ? `${base}?category=${encodeURIComponent(category)}` : base;
  }

  function pageLanguagePath(pathname, targetLanguage, search = '') {
    const category = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('category') || '';
    const path = String(pathname || '/');
    if (/^\/en\/about\/?$/i.test(path) || /^\/about\/?$/i.test(path)) {
      return targetLanguage === 'en' ? '/en/about/' : '/about/';
    }
    if (/^\/en\/market\/?$/i.test(path) || /^\/market\/?$/i.test(path)) {
      const searchParams = new URLSearchParams(String(search || '').replace(/^\?/, ''));
      const date = searchParams.get('date');
      const view = searchParams.get('view');
      const base = targetLanguage === 'en' ? '/en/market/' : '/market/';
      if (date) return `${base}?date=${encodeURIComponent(date)}`;
      if (view === '1w' || view === '1m') return `${base}?view=${encodeURIComponent(view)}`;
      return base;
    }
    const categoryMatch = path.match(/^\/(?:en\/)?(daily|weekly|research|basics|notes)\/?$/i);
    if (categoryMatch) {
      const slug = categoryMatch[1].toLowerCase();
      return targetLanguage === 'en' ? `/en/${slug}/` : `/${slug}/`;
    }
    return homepagePath(targetLanguage, category);
  }

  function preferredHomepageRedirect(currentLanguage, pathname, search, savedLanguage) {
    if (currentLanguage !== 'ko' || pathname !== '/' || savedLanguage !== 'en') return '';
    return pageLanguagePath(pathname, 'en', search);
  }

  // ---------------------------------------------------------------------------
  // User-facing timestamps (Market `generated_at` and similar collector stamps)
  //
  // Stored values keep whatever offset the collector PC wrote, e.g.
  // `2026-09-15T19:52:01.276638+07:00`. Every reader must see the same wall
  // clock regardless of their browser timezone, so the display is pinned to
  // Asia/Seoul and the raw ISO string never reaches the page. Invalid or
  // missing input yields null so callers can print `--` or hide the line.
  // ---------------------------------------------------------------------------
  const DISPLAY_TIMEZONE = 'Asia/Seoul';
  const EN_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/;

  // Parses an ISO-8601 timestamp without touching the host timezone. Fractional
  // seconds of any length are accepted (Python writes six digits); a value with
  // no offset is read as UTC rather than as browser-local time.
  function parseTimestamp(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    const match = ISO_TIMESTAMP.exec(text);
    if (!match) {
      const fallback = new Date(text);
      return Number.isFinite(fallback.getTime()) && /(Z|[+-]\d{2}:?\d{2})$/i.test(text) ? fallback : null;
    }
    const [, year, month, day, hour, minute, second = '0', fraction = '', offset = 'Z'] = match;
    // Date.UTC would silently roll `2026-13-45T99:99` into a real date; reject it.
    const inRange = (text, min, max) => { const n = Number(text); return Number.isInteger(n) && n >= min && n <= max; };
    if (!inRange(month, 1, 12) || !inRange(day, 1, 31) || !inRange(hour, 0, 23) || !inRange(minute, 0, 59) || !inRange(second, 0, 60)) return null;
    const millis = Number((fraction + '000').slice(0, 3));
    let utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millis);
    if (offset.toUpperCase() !== 'Z') {
      const sign = offset[0] === '-' ? -1 : 1;
      const digits = offset.slice(1).replace(':', '');
      utc -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60000;
    }
    const date = new Date(utc);
    if (!Number.isFinite(date.getTime())) return null;
    // Reject impossible calendar days such as Feb 30 instead of rolling over.
    const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return probe.getUTCMonth() === Number(month) - 1 && probe.getUTCDate() === Number(day) ? date : null;
  }

  function seoulParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: DISPLAY_TIMEZONE,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const pick = type => Number(parts.find(part => part.type === type)?.value);
    return { year: pick('year'), month: pick('month'), day: pick('day'), hour: pick('hour') % 24, minute: pick('minute') };
  }

  // `9월 15일 21:52 KST` / `Sep 15, 21:52 KST`; the year is added only when it
  // differs from the current year in Seoul (`2025년 12월 30일 16:06 KST` /
  // `Dec 30, 2025, 16:06 KST`). `options.now` exists so tests stay deterministic.
  function formatKstTimestamp(value, language = 'ko', options = {}) {
    const date = parseTimestamp(value);
    if (!date) return null;
    const stamp = seoulParts(date);
    const reference = parseTimestamp(options.now) || new Date();
    const showYear = options.alwaysYear === true || stamp.year !== seoulParts(reference).year;
    const hhmm = `${String(stamp.hour).padStart(2, '0')}:${String(stamp.minute).padStart(2, '0')}`;
    if ((language || 'ko') === 'en') {
      const monthDay = `${EN_SHORT_MONTHS[stamp.month - 1]} ${stamp.day}`;
      return showYear ? `${monthDay}, ${stamp.year}, ${hhmm} KST` : `${monthDay}, ${hhmm} KST`;
    }
    const monthDay = `${stamp.month}월 ${stamp.day}일`;
    return showYear ? `${stamp.year}년 ${monthDay} ${hhmm} KST` : `${monthDay} ${hhmm} KST`;
  }

  // The label that goes with a collector stamp. It says when the dataset was
  // refreshed, never what the prices are "as of": that basis stays with the
  // separate `15:30 KST` close notice.
  const dataUpdatedLabel = { ko: '데이터 갱신', en: 'Data updated' };
  function formatDataUpdated(value, language = 'ko', options = {}) {
    const stamp = formatKstTimestamp(value, language, options);
    if (!stamp) return null;
    return `${dataUpdatedLabel[language === 'en' ? 'en' : 'ko']} · ${stamp}`;
  }

  root.MARKET_LOCALE = {
    validLanguages,
    copy,
    postLanguage,
    siteLanguage,
    groupKey,
    normalizeReportPath,
    localePosts,
    sortPosts,
    sortPostsByRegistration,
    latestByCore,
    categoryCounts,
    searchPosts,
    findCurrentPost,
    findCounterpart,
    homepagePath,
    pageLanguagePath,
    preferredHomepageRedirect,
    DISPLAY_TIMEZONE,
    parseTimestamp,
    formatKstTimestamp,
    formatDataUpdated,
    dataUpdatedLabel,
    marketCloseAvailability,
    parseKrxSessionHeader,
    normalizeKrxSession,
    krxSessionDisplay,
    marketIntegrityNotice
  };
})(typeof window !== 'undefined' ? window : globalThis);
