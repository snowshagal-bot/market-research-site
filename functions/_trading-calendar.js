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
    '2026-01-01': { ko: '신정 (New Year’s Day)', en: "New Year's Day" },
    '2026-01-19': { ko: '마틴 루터 킹의 날', en: 'Martin Luther King Jr. Day' },
    '2026-02-16': { ko: '워싱턴 탄생일 (대통령의 날)', en: "Washington's Birthday (Presidents' Day)" },
    '2026-04-03': { ko: '성금요일 (Good Friday)', en: 'Good Friday' },
    '2026-05-25': { ko: '메모리얼 데이', en: 'Memorial Day' },
    '2026-06-19': { ko: '준틴스 독립기념일', en: 'Juneteenth National Independence Day' },
    '2026-07-03': { ko: '독립기념일 대체휴일', en: 'Independence Day (Observed)' },
    '2026-09-07': { ko: '노동절 (Labor Day)', en: 'Labor Day' },
    '2026-11-26': { ko: '추수감사절', en: 'Thanksgiving Day' },
    '2026-12-25': { ko: '성탄절 (Christmas Day)', en: 'Christmas Day' }
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

export function expectedLatestKrxTradingDate(now = new Date(), closeGraceMinutes = 16 * 60 + 30) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Freshness check requires a valid current time.');
  const current = kstParts(now);
  if (isTradingDate(current.date, 'KRX') && current.minutes >= closeGraceMinutes) return current.date;
  return previousTradingDate(current.date, 'KRX');
}

export function getMonthlyTradingCalendar(year, month) {
  const yearNum = Number(year);
  const monthNum = Number(month);
  if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new Error(`Invalid year or month: ${year}-${month}`);
  }
  if (yearNum !== 2026) {
    return {
      supported: false,
      year: yearNum,
      month: monthNum,
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

    const krxHoliday = CALENDAR_HOLIDAYS.KRX[2026]?.includes(dateStr) || false;
    const nyseHoliday = CALENDAR_HOLIDAYS.NYSE[2026]?.includes(dateStr) || false;
    const krxSpecial = SPECIAL_SESSIONS.KRX[dateStr] || null;
    const nyseSpecial = SPECIAL_SESSIONS.NYSE[dateStr] || null;

    const krxTrading = !isWeekend && !krxHoliday;
    const nyseTrading = !isWeekend && !nyseHoliday;
    const isJointClosure = !isWeekend && krxHoliday && nyseHoliday;

    days.push({
      date: dateStr,
      day: d,
      dayOfWeek,
      isWeekend,
      krx: {
        trading: krxTrading,
        holiday: krxHoliday,
        name: HOLIDAY_NAMES.KRX[dateStr] || null,
        specialSession: krxSpecial
      },
      nyse: {
        trading: nyseTrading,
        holiday: nyseHoliday,
        name: HOLIDAY_NAMES.NYSE[dateStr] || null,
        specialSession: nyseSpecial
      },
      isJointClosure
    });
  }

  return {
    supported: true,
    year: yearNum,
    month: monthNum,
    days
  };
}

export function getUpcomingTradingEvents(fromDateStr = '2026-01-01', limit = 10) {
  const events = [];
  const allDates = new Set([
    ...(CALENDAR_HOLIDAYS.KRX[2026] || []),
    ...(CALENDAR_HOLIDAYS.NYSE[2026] || []),
    ...Object.keys(SPECIAL_SESSIONS.KRX),
    ...Object.keys(SPECIAL_SESSIONS.NYSE)
  ]);

  const sortedDates = [...allDates].sort();
  for (const date of sortedDates) {
    if (date < fromDateStr) continue;
    const krxHoliday = CALENDAR_HOLIDAYS.KRX[2026]?.includes(date) || false;
    const nyseHoliday = CALENDAR_HOLIDAYS.NYSE[2026]?.includes(date) || false;
    const krxSpecial = SPECIAL_SESSIONS.KRX[date] || null;
    const nyseSpecial = SPECIAL_SESSIONS.NYSE[date] || null;

    events.push({
      date,
      krx: {
        holiday: krxHoliday,
        name: HOLIDAY_NAMES.KRX[date] || null,
        specialSession: krxSpecial
      },
      nyse: {
        holiday: nyseHoliday,
        name: HOLIDAY_NAMES.NYSE[date] || null,
        specialSession: nyseSpecial
      },
      isJointClosure: krxHoliday && nyseHoliday
    });

    if (events.length >= limit) break;
  }

  return events;
}
