export const SSR_DATA_BUDGET_MS = 1500;

export function withinSsrBudget(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); })
  ]).finally(() => clearTimeout(timer));
}

export function temporaryPage(body, originalHeaders) {
  const headers = new Headers(originalHeaders);
  headers.delete('content-length');
  headers.delete('etag');
  headers.delete('last-modified');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('retry-after', '60');
  return new Response(body, { status: 503, headers });
}

export function temporaryDataPage(page, lang) {
  const copy = {
    market: {
      ko: ['시장 데이터를 잠시 불러올 수 없습니다.', '/market/archive/', '시장 기록'],
      en: ['Market data is temporarily unavailable.', '/en/market/archive/', 'Market Archive']
    },
    disclosures: {
      ko: ['공시 데이터를 잠시 불러올 수 없습니다.', '/', '홈'],
      en: ['Disclosure filings are temporarily unavailable.', '/en/', 'Home']
    }
  }[page][lang];
  const [message, href, label] = copy;
  return temporaryPage(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${message} | Snowshagal</title><main><h1>${message}</h1><p><a href="${href}">${label}</a></p></main></html>`);
}
