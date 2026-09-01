/**
 * Canonical Server-Side Trading Calendar Module
 *
 * Single source of truth for Korean (KRX) and US (NYSE) market trading dates,
 * designated full-day closures, special trading sessions, and freshness boundaries.
 *
 * Sources:
 * - KRX: Korea Exchange (KRX) annual market operational notice & KASI official calendar.
 *   2026: Fully finalized and verified (16 holidays).
 *   2027: Pending official annual publication by KRX (fail-closed / pending).
 * - NYSE: New York Stock Exchange Official Holidays and Trading Hours
 *   (https://www.nyse.com/markets/hours-calendars)
 *   2026: Official schedule (10 holidays, 2 early-close sessions).
 *   2027: Official schedule (10 holidays, 1 early-close session).
 */

export const CALENDAR_SUPPORTED_YEARS = Object.freeze({
  KRX: Object.freeze([2026]),
  NYSE: Object.freeze([2026, 2027])
});

export const CALENDAR_HOLIDAYS = Object.freeze({
  KRX: Object.freeze({
    // KRX closes on Korean public holidays, Labor Day and its year-end
    // closing day. Keep this explicit list in sync with the annual KRX/KASI
    // calendar before the first trading day of a new year.
    2026: Object.freeze([
      '2026-01-01',
      '2026-02-16', '2026-02-17', '2026-02-18',
      '2026-03-02',
      '2026-05-01', '2026-05-05', '2026-05-25',
      '2026-06-03',
      '2026-08-17',
      '2026-09-24', '2026-09-25',
      '2026-10-05', '2026-10-09',
      '2026-12-25', '2026-12-31'
    ])
  }),
  NYSE: Object.freeze({
    // NYSE 2026 full-day market holidays. Early-close sessions are trading
    // days and therefore are intentionally absent.
    2026: Object.freeze([
      '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
      '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
      '2026-11-26', '2026-12-25'
    ]),
    // NYSE 2027 full-day market holidays.
    // Source: https://www.nyse.com/markets/hours-calendars
    2027: Object.freeze([
      '2027-01-01', // New Year's Day
      '2027-01-18', // Martin Luther King, Jr. Day
      '2027-02-15', // Washington's Birthday (Presidents' Day)
      '2027-03-26', // Good Friday
      '2027-05-31', // Memorial Day
      '2027-06-18', // Juneteenth National Independence Day (Observed)
      '2027-07-05', // Independence Day (Observed)
      '2027-09-06', // Labor Day
      '2027-11-25', // Thanksgiving Day
      '2027-12-24'  // Christmas Day (Observed)
    ])
  })
});

export const HOLIDAY_NAMES = Object.freeze({
  KRX: Object.freeze({
    '2026-01-01': { ko: '신정 (새해 첫날)', en: "New Year's Day" },
    '2026-02-16': { ko: '설날 전날', en: 'Lunar New Year Eve' },
    '2026-02-17': { ko: '설날', en: 'Lunar New Year Day' },
    '2026-02-18': { ko: '설날 다음날', en: 'Lunar New Year Holiday' },
    '2026-03-02': { ko: '삼일절 대체공휴일', en: 'Independence Movement Day (Observed)' },
    '2026-05-01': { ko: '근로자의 날', en: "Labor Day" },
    '2026-05-05': { ko: '어린이날', en: "Children's Day" },
    '2026-05-25': { ko: '부처님오신날 대체공휴일', en: "Buddha's Birthday (Observed)" },
    '2026-06-03': { ko: '전국동시지방선거일', en: 'Local Election Day' },
    '2026-08-17': { ko: '광복절 대체공휴일', en: 'Liberation Day (Observed)' },
    '2026-09-24': { ko: '추석 전날', en: 'Chuseok Eve' },
    '2026-09-25': { ko: '추석', en: 'Chuseok Day' },
    '2026-10-05': { ko: '개천절 대체공휴일', en: 'National Foundation Day (Observed)' },
    '2026-10-09': { ko: '한글날', en: 'Hangul Day' },
    '2026-12-25': { ko: '기독탄신일 (성탄절)', en: 'Christmas Day' },
    '2026-12-31': { ko: '연말 폐장일', en: 'Year-End Market Closing Day' }
  }),
  NYSE: Object.freeze({
    // 2026
    '2026-01-01': { ko: '신정 (New Year’s Day)', en: "New Year's Day" },
    '2026-01-19': { ko: '마틴 루터 킹의 날', en: 'Martin Luther King Jr. Day' },
    '2026-02-16': { ko: '워싱턴 탄생일 (대통령의 날)', en: "Washington's Birthday (Presidents' Day)" },
    '2026-04-03': { ko: '성금요일 (Good Friday)', en: 'Good Friday' },
    '2026-05-25': { ko: '메모리얼 데이', en: 'Memorial Day' },
    '2026-06-19': { ko: '준틴스 독립기념일', en: 'Juneteenth National Independence Day' },
    '2026-07-03': { ko: '독립기념일 대체휴일', en: 'Independence Day (Observed)' },
    '2026-09-07': { ko: '노동절 (Labor Day)', en: 'Labor Day' },
    '2026-11-26': { ko: '추수감사절', en: 'Thanksgiving Day' },
    '2026-12-25': { ko: '성탄절 (Christmas Day)', en: 'Christmas Day' },
    // 2027
    '2027-01-01': { ko: '신정 (New Year’s Day)', en: "New Year's Day" },
    '2027-01-18': { ko: '마틴 루터 킹의 날', en: 'Martin Luther King Jr. Day' },
    '2027-02-15': { ko: '워싱턴 탄생일 (대통령의 날)', en: "Washington's Birthday (Presidents' Day)" },
    '2027-03-26': { ko: '성금요일 (Good Friday)', en: 'Good Friday' },
    '2027-05-31': { ko: '메모리얼 데이', en: 'Memorial Day' },
    '2027-06-18': { ko: '준틴스 독립기념일 대체휴일', en: 'Juneteenth National Independence Day (Observed)' },
    '2027-07-05': { ko: '독립기념일 대체휴일', en: 'Independence Day (Observed)' },
    '2027-09-06': { ko: '노동절 (Labor Day)', en: 'Labor Day' },
    '2027-11-25': { ko: '추수감사절', en: 'Thanksgiving Day' },
    '2027-12-24': { ko: '성탄절 대체휴일 (Christmas Day Observed)', en: 'Christmas Day (Observed)' }
  })
});

export const SPECIAL_SESSIONS = Object.freeze({
  KRX: Object.freeze({
    '2026-01-02': {
      type: 'delayed_open',
      session: '10:00 - 15:30',
      nameKo: '증시 개장식 (개장 1시간 지연)',
      nameEn: 'Opening Bell Ceremony (1h Delayed Open: 10:00 - 15:30)'
    },
    '2026-11-19': {
      type: 'delayed_open_close',
      session: '10:00 - 16:30',
      nameKo: '대학수학능력시험일 (1시간 순연)',
      nameEn: 'CSAT Exam Day (1h Delay: 10:00 - 16:30)'
    }
  }),
  NYSE: Object.freeze({
    '2026-11-27': {
      type: 'early_close',
      session: '09:30 - 13:00 ET',
      nameKo: '추수감사절 익일 조기 폐장 (13:00 ET)',
      nameEn: 'Day After Thanksgiving (Early Close at 13:00 ET)'
    },
    '2026-12-24': {
      type: 'early_close',
      session: '09:30 - 13:00 ET',
      nameKo: '크리스마스 이브 조기 폐장 (13:00 ET)',
      nameEn: 'Christmas Eve (Early Close at 13:00 ET)'
    },
    '2027-11-26': {
      type: 'early_close',
      session: '09:30 - 13:00 ET',
      nameKo: '추수감사절 익일 조기 폐장 (13:00 ET)',
      nameEn: 'Day After Thanksgiving (Early Close at 13:00 ET)'
    }
  })
});

export function parseDate(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateString ? date : null;
}

export function shiftDate(dateString, days) {
  const date = parseDate(dateString);
  if (!date) throw new Error(`Invalid market date: ${dateString}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isMarketYearSupported(market, year) {
  const y = Number(year);
  return Array.isArray(CALENDAR_SUPPORTED_YEARS[market]) && CALENDAR_SUPPORTED_YEARS[market].includes(y);
}

export function calendarHolidays(market, year) {
  const dates = CALENDAR_HOLIDAYS[market]?.[year];
  if (!dates) throw new Error(`${market} trading calendar is not configured for ${year}`);
  return new Set(dates);
}

export function isTradingDate(dateString, market) {
  const date = parseDate(dateString);
  if (!date) throw new Error(`Invalid market date: ${dateString}`);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !calendarHolidays(market, date.getUTCFullYear()).has(dateString);
}

export function previousTradingDate(dateString, market) {
  let candidate = shiftDate(dateString, -1);
  for (let attempts = 0; attempts < 370; attempts += 1) {
    if (isTradingDate(candidate, market)) return candidate;
    candidate = shiftDate(candidate, -1);
  }
  throw new Error(`Unable to resolve previous ${market} trading date from ${dateString}`);
}

export function kstParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    minutes: Number(value.hour) * 60 + Number(value.minute)
  };
}

/**
 * Returns KRX session timings and automation boundaries for a given date.
 * - Normal session: 09:00 - 15:30 KST (closeGraceMinutes: 16:30, publishEligible: 16:05)
 * - CSAT delayed close (2026-11-19): 10:00 - 16:30 KST (closeGraceMinutes: 17:30, publishEligible: 17:05)
 * Both apply the identical 1-hour grace period after session close.
 */
export function getKrxSessionTimes(dateString) {
  const special = SPECIAL_SESSIONS.KRX[dateString];
  if (special && special.type === 'delayed_open_close') {
    return {
      openMinutes: 10 * 60,                // 10:00 KST
      closeMinutes: 16 * 60 + 30,          // 16:30 KST
      closeTime: '16:30',
      publishEligibleMinutes: 17 * 60 + 5, // 17:05 KST (35 min after close)
      freshnessGraceMinutes: 17 * 60 + 30, // 17:30 KST (1 hour after close)
      alertMinutes: 18 * 60                // 18:00 KST
    };
  }
  return {
    openMinutes: (special && special.type === 'delayed_open') ? 10 * 60 : 9 * 60,
    closeMinutes: 15 * 60 + 30,            // 15:30 KST
    closeTime: '15:30',
    publishEligibleMinutes: 16 * 60 + 5,   // 16:05 KST (35 min after close)
    freshnessGraceMinutes: 16 * 60 + 30,   // 16:30 KST (1 hour after close)
    alertMinutes: 17 * 60                  // 17:00 KST
  };
}

export function expectedLatestKrxTradingDate(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Freshness check requires a valid current time.');
  const current = kstParts(now);
  if (isTradingDate(current.date, 'KRX')) {
    const sessionTimes = getKrxSessionTimes(current.date);
    if (current.minutes >= sessionTimes.freshnessGraceMinutes) return current.date;
  }
  return previousTradingDate(current.date, 'KRX');
}

export function getMonthlyTradingCalendar(year, month) {
  const yearNum = Number(year);
  const monthNum = Number(month);
  if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new Error(`Invalid year or month: ${year}-${month}`);
  }

  const krxSupported = isMarketYearSupported('KRX', yearNum);
  const nyseSupported = isMarketYearSupported('NYSE', yearNum);

  if (!krxSupported && !nyseSupported) {
    return {
      supported: false,
      year: yearNum,
      month: monthNum,
      marketSupport: { krx: false, nyse: false },
      message: `${yearNum} calendar deferred — official schedule incomplete`
    };
  }

  const daysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
  const days = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(`${dateStr}T00:00:00Z`);
    const dayOfWeek = dateObj.getUTCDay(); // 0: Sun, 6: Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let krxData;
    if (krxSupported) {
      const krxHoliday = CALENDAR_HOLIDAYS.KRX[yearNum]?.includes(dateStr) || false;
      const krxSpecial = SPECIAL_SESSIONS.KRX[dateStr] || null;
      const krxTrading = !isWeekend && !krxHoliday;
      krxData = {
        supported: true,
        trading: krxTrading,
        holiday: krxHoliday,
        name: HOLIDAY_NAMES.KRX[dateStr] || null,
        specialSession: krxSpecial
      };
    } else {
      krxData = {
        supported: false,
        status: 'pending',
        trading: false,
        holiday: false,
        name: null,
        specialSession: null
      };
    }

    let nyseData;
    if (nyseSupported) {
      const nyseHoliday = CALENDAR_HOLIDAYS.NYSE[yearNum]?.includes(dateStr) || false;
      const nyseSpecial = SPECIAL_SESSIONS.NYSE[dateStr] || null;
      const nyseTrading = !isWeekend && !nyseHoliday;
      nyseData = {
        supported: true,
        trading: nyseTrading,
        holiday: nyseHoliday,
        name: HOLIDAY_NAMES.NYSE[dateStr] || null,
        specialSession: nyseSpecial
      };
    } else {
      nyseData = {
        supported: false,
        status: 'pending',
        trading: false,
        holiday: false,
        name: null,
        specialSession: null
      };
    }

    const isJointClosure = !isWeekend && krxSupported && nyseSupported && krxData.holiday && nyseData.holiday;

    days.push({
      date: dateStr,
      day: d,
      dayOfWeek,
      isWeekend,
      krx: krxData,
      nyse: nyseData,
      isJointClosure
    });
  }

  return {
    supported: true,
    year: yearNum,
    month: monthNum,
    marketSupport: {
      krx: krxSupported,
      nyse: nyseSupported
    },
    krxPendingMessage: krxSupported ? null : 'KRX 2027 calendar pending official KRX release',
    days
  };
}

export function getUpcomingTradingEvents(fromDateStr = '2026-01-01', limit = 12) {
  const events = [];
  const allDates = new Set([
    ...(CALENDAR_HOLIDAYS.KRX[2026] || []),
    ...(CALENDAR_HOLIDAYS.NYSE[2026] || []),
    ...(CALENDAR_HOLIDAYS.NYSE[2027] || []),
    ...Object.keys(SPECIAL_SESSIONS.KRX),
    ...Object.keys(SPECIAL_SESSIONS.NYSE)
  ]);

  const sortedDates = [...allDates].sort();
  for (const date of sortedDates) {
    if (date < fromDateStr) continue;
    const y = Number(date.slice(0, 4));
    const krxSupported = isMarketYearSupported('KRX', y);
    const nyseSupported = isMarketYearSupported('NYSE', y);

    const krxHoliday = krxSupported ? (CALENDAR_HOLIDAYS.KRX[y]?.includes(date) || false) : false;
    const nyseHoliday = nyseSupported ? (CALENDAR_HOLIDAYS.NYSE[y]?.includes(date) || false) : false;
    const krxSpecial = SPECIAL_SESSIONS.KRX[date] || null;
    const nyseSpecial = SPECIAL_SESSIONS.NYSE[date] || null;

    events.push({
      date,
      krx: {
        supported: krxSupported,
        holiday: krxHoliday,
        name: HOLIDAY_NAMES.KRX[date] || null,
        specialSession: krxSpecial
      },
      nyse: {
        supported: nyseSupported,
        holiday: nyseHoliday,
        name: HOLIDAY_NAMES.NYSE[date] || null,
        specialSession: nyseSpecial
      },
      isJointClosure: krxSupported && nyseSupported && krxHoliday && nyseHoliday
    });

    if (events.length >= limit) break;
  }

  return events;
}
