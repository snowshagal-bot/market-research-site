import {
  FILINGS_TABLE, STATE_TABLE, WATCHLIST_TABLE, disclosureConfig, ensureDisclosureSchema,
  kstDate, reserveRequest, setState
} from './_shared.js';
import { recordSourceRun } from '../../_calendar-events.js';

// Official company overview: corp_name_eng is the registered English name.
// https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002
const COMPANY_URL = 'https://opendart.fss.or.kr/api/company.json';
const SOURCE = 'opendart-company-names';
const STATE_PREFIX = 'calendar-company-name:';
export const MAX_COMPANY_NAMES_PER_RUN = 8;
class CompanyLookupError extends Error {
  constructor(reason, httpStatus = null) { super(reason); this.httpStatus = httpStatus; }
}

/**
 * Fill missing names once during the existing daily sync, never on a public
 * request. Existing/admin names win. Failed/empty lookups rotate to the back
 * of the queue and are tried at most once per Seoul day.
 *
 * At most eight requests in its own invocation, independent of the official
 * schedule/document pass. Both still share the daily OpenDART budget.
 */
export async function syncCompanyNames(db, { env = {}, fetchImpl = fetch, now = new Date() } = {}) {
  const result = { sourceName: SOURCE, status: 'ok', attempted: 0, updated: 0, unavailable: 0, requests: 0, budgetExhausted: false };
  if (!env.OPENDART_API_KEY) return { ...result, status: 'pending', note: 'OpenDART key not configured' };

  await ensureDisclosureSchema({ ...env, COMMENTS_DB: db });
  const usageDate = kstDate(now);
  const config = disclosureConfig(env);
  const candidates = await db.prepare(`WITH missing AS (
    SELECT w.stock_code, w.corp_code AS registered_code, w.sort_order, s.state_value,
      COALESCE((
        SELECT f.corp_code FROM ${FILINGS_TABLE} f WHERE f.stock_code = w.stock_code
          AND LENGTH(f.corp_code) = 8 AND f.corp_code NOT GLOB '*[^0-9]*'
        ORDER BY f.rcept_dt DESC, f.rcept_no DESC LIMIT 1
      ), NULLIF(TRIM(w.corp_code), '')) AS corp_code
    FROM ${WATCHLIST_TABLE} w
    LEFT JOIN ${STATE_TABLE} s ON s.state_key = ? || w.stock_code
    WHERE w.active = 1 AND w.calendar_enabled = 1 AND TRIM(w.corp_name_en) = ''
      AND (s.state_value IS NULL OR s.state_value < ?)
    ) SELECT stock_code, registered_code, corp_code FROM missing
    WHERE LENGTH(corp_code) = 8 AND corp_code NOT GLOB '*[^0-9]*'
    ORDER BY COALESCE(state_value, ''), sort_order, stock_code LIMIT ?`)
    .bind(STATE_PREFIX, usageDate, MAX_COMPANY_NAMES_PER_RUN).all();

  for (const company of candidates?.results || []) {
    const budget = await reserveRequest(db, usageDate, 'source:opendart', config.dartDailyBudget);
    if (!budget.allowed) { result.budgetExhausted = true; break; }
    await setState(db, STATE_PREFIX + company.stock_code, usageDate);
    result.attempted += 1;
    result.requests += 1;
    let name;
    try {
      const url = new URL(COMPANY_URL);
      url.searchParams.set('crtfc_key', env.OPENDART_API_KEY);
      url.searchParams.set('corp_code', company.corp_code);
      const response = await fetchImpl(url, {
        // Match the existing disclosure collector: OpenDART redirects Workers
        // requests without a User-Agent to /error1.html instead of its API.
        headers: { accept: 'application/json', 'user-agent': 'snowshagal-disclosure-monitor/1.0' },
        // Workers does not support redirect:'error'. Manual mode returns 3xx
        // to the !ok guard below, so credentials never follow a redirect.
        redirect: 'manual',
        signal: AbortSignal.timeout(4000)
      });
      if (!response.ok) {
        const status = Number.isInteger(response.status) ? response.status : null;
        throw new CompanyLookupError(status ? `HTTP ${status}` : 'HTTP failure', status);
      }
      const payload = await response.json();
      if (payload?.status !== '000') {
        const code = /^\d{3}$/.test(String(payload?.status)) ? payload.status : 'invalid response';
        throw new CompanyLookupError(`OpenDART ${code}`);
      }
      // Do not persist a mismatched company or a translated/invented name.
      if (payload.stock_code !== company.stock_code ||
          (payload.corp_code && payload.corp_code !== company.corp_code)) {
        throw new CompanyLookupError('company identifier mismatch');
      }
      name = String(payload.corp_name_eng || '').trim();
      if (!name || name.length > 200 || !/[A-Za-z]/.test(name) || /[\u0000-\u001f\u007f]/.test(name)) {
        result.unavailable += 1;
        continue;
      }
    } catch (error) {
      // Never log a fetch error or upstream payload: it can contain the key
      // from the request URL or unrelated company-contact information.
      result.status = 'error';
      const reason = error instanceof CompanyLookupError ? error.message
        : ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'network or invalid JSON';
      result.error = `Official company name lookup failed (${reason}); existing names preserved`;
      result.httpStatus = error instanceof CompanyLookupError ? error.httpStatus : null;
      result.stage = 'fetch';
      continue;
    }
    // Recheck in case an administrator supplied a name while fetch was pending.
    const write = await db.prepare(`UPDATE ${WATCHLIST_TABLE} SET corp_name_en = ?, updated_at = ?
      WHERE stock_code = ? AND corp_code = ? AND TRIM(corp_name_en) = ''
      RETURNING stock_code`)
      .bind(name, now.toISOString(), company.stock_code, company.registered_code).all();
    result.updated += write?.results?.length || 0;
  }
  await recordSourceRun(db, {
    sourceName: SOURCE, sourceUrl: COMPANY_URL, status: result.status,
    eventCount: 0, error: result.error || '',
    note: `names updated: ${result.updated}; attempted: ${result.attempted}; unavailable: ${result.unavailable}; budget exhausted: ${result.budgetExhausted}`
  }, now);
  return result;
}
