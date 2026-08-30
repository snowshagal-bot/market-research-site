import {
  DisclosureError,
  compactDate,
  dateDaysAgo,
  disclosureConfig,
  kstDate,
  normalizeFiling,
  reserveRequest
} from './_shared.js';

const OPENDART_LIST_URL = 'https://opendart.fss.or.kr/api/list.json';
const REQUEST_TIMEOUT_MS = 12000;
const PAGE_COUNT = 100;

function sourceProvider(env = {}) {
  const configured = String(env.DISCLOSURE_SOURCE_PROVIDER || 'opendart').trim().toLowerCase();
  return configured || 'opendart';
}

function buildOpenDartUrl(apiKey, { beginDate, endDate, corpClass, pageNo }) {
  const url = new URL(OPENDART_LIST_URL);
  url.searchParams.set('crtfc_key', apiKey);
  url.searchParams.set('bgn_de', beginDate);
  url.searchParams.set('end_de', endDate);
  url.searchParams.set('corp_cls', corpClass);
  url.searchParams.set('page_no', String(pageNo));
  url.searchParams.set('page_count', String(PAGE_COUNT));
  url.searchParams.set('sort', 'date');
  url.searchParams.set('sort_mth', 'desc');
  return url;
}

async function openDartRequest(env, db, config, usageDate, query) {
  if (!env.OPENDART_API_KEY) throw new DisclosureError('OPENDART_NOT_CONFIGURED', 'OPENDART_API_KEY가 설정되지 않았습니다.', 503);
  const budget = await reserveRequest(db, usageDate, 'source:opendart', config.dartDailyBudget);
  if (!budget.allowed) {
    throw new DisclosureError('SOURCE_BUDGET_EXHAUSTED', `OpenDART 내부 일일 호출 예산(${budget.limit})에 도달했습니다.`, 429);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildOpenDartUrl(env.OPENDART_API_KEY, query), {
      headers: { accept: 'application/json', 'user-agent': 'snowshagal-disclosure-monitor/1.0' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new DisclosureError('OPENDART_HTTP_ERROR', `OpenDART HTTP ${response.status}`, response.status === 429 ? 429 : 502);
    }
    let payload;
    try { payload = await response.json(); }
    catch (_) { throw new DisclosureError('OPENDART_BAD_RESPONSE', 'OpenDART JSON 응답을 읽지 못했습니다.', 502); }

    const status = String(payload?.status || '');
    if (status === '013') return { list: [], totalPage: 0, totalCount: 0 };
    if (status !== '000') {
      const safeMessage = String(payload?.message || 'OpenDART 요청 실패').slice(0, 180);
      throw new DisclosureError('OPENDART_API_ERROR', `${safeMessage} (${status || 'unknown'})`, status === '020' ? 429 : 502);
    }
    return {
      list: Array.isArray(payload.list) ? payload.list : [],
      totalPage: Math.max(1, Number(payload.total_page || 1)),
      totalCount: Math.max(0, Number(payload.total_count || 0))
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new DisclosureError('OPENDART_TIMEOUT', 'OpenDART 응답이 지연되고 있습니다.', 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOpenDart({ env, db, config, beginDate, endDate, usageDate }) {
  const seen = new Map();
  const classes = [];
  let truncated = false;

  for (const corpClass of config.corpClasses) {
    let pageNo = 1;
    let totalPage = 1;
    let fetchedRows = 0;
    let reportedTotal = 0;
    do {
      const payload = await openDartRequest(env, db, config, usageDate, { beginDate, endDate, corpClass, pageNo });
      totalPage = payload.totalPage;
      reportedTotal = payload.totalCount;
      for (const item of payload.list) {
        const filing = normalizeFiling(item);
        if (filing.rceptNo) seen.set(filing.rceptNo, filing);
      }
      fetchedRows += payload.list.length;
      pageNo += 1;
      if (pageNo > config.maxPagesPerClass && pageNo <= totalPage) truncated = true;
    } while (pageNo <= totalPage && pageNo <= config.maxPagesPerClass);

    classes.push({ corpClass, totalPage, reportedTotal, fetchedRows });
  }

  return {
    provider: 'opendart',
    beginDate,
    endDate,
    filings: [...seen.values()],
    classes,
    truncated
  };
}

export async function fetchDisclosureSource({ env, db, beginDate = '', endDate = '', now = new Date() }) {
  const config = disclosureConfig(env);
  const provider = sourceProvider(env);
  const usageDate = kstDate(now);
  const resolvedEnd = compactDate(endDate || usageDate);
  const resolvedBegin = compactDate(beginDate) || dateDaysAgo(config.lookbackDays - 1, now);

  if (!/^20\d{6}$/.test(resolvedBegin) || !/^20\d{6}$/.test(resolvedEnd) || resolvedBegin > resolvedEnd) {
    throw new DisclosureError('BAD_DATE_RANGE', '공시 조회 날짜 범위를 확인해 주세요.', 400);
  }

  if (provider === 'opendart') {
    return fetchOpenDart({ env, db, config, beginDate: resolvedBegin, endDate: resolvedEnd, usageDate });
  }
  throw new DisclosureError('SOURCE_PROVIDER_UNSUPPORTED', `지원하지 않는 공시 공급자입니다: ${provider}`, 503);
}

export const __test = { OPENDART_LIST_URL, PAGE_COUNT, sourceProvider, buildOpenDartUrl };
