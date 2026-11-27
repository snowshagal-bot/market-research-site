import { MARKET_INDICATORS, OPTIONAL_INDICATOR_CLOSES_SQL, availableIndicatorCodes } from './_market-indicators.js';
import { domesticRateSeries, marketFundSeries, marketIndicatorSeries, usdKrwFxRows } from './_market-date-page.js';
import { TABLE_NAME } from './api/market/_shared.js';
import { domesticRateCodesIn } from './api/market/rates/_shared.js';
import { marketFundCodesIn } from './api/market/funds/_shared.js';

const SESSION_INDICATORS = MARKET_INDICATORS.filter(item => !item.domestic && !item.funds);
const INDICATOR_ITEMS_SQL = `json_extract(payload_json, ${SESSION_INDICATORS.map(item => `'$.${item.group}.${item.code}'`).join(', ')})`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The sitemap needs the final session dates and exactly the inputs of the history pages. */
export async function loadSitemapMarketSessions(env) {
  const db = env?.COMMENTS_DB;
  if (!db?.prepare) throw new Error('COMMENTS_DB is unavailable');
  const result = await db.prepare(`SELECT market_date, published_at,
      ${OPTIONAL_INDICATOR_CLOSES_SQL} AS optional_closes, ${INDICATOR_ITEMS_SQL} AS indicator_items
    FROM ${TABLE_NAME} WHERE status = 'final' ORDER BY market_date DESC`).all();
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('Invalid market sessions result');
  return result.results.map(row => {
    if (!ISO_DATE.test(String(row?.market_date || ''))) throw new Error('Invalid market session date');
    const items = JSON.parse(row.indicator_items);
    if (!Array.isArray(items) || items.length !== SESSION_INDICATORS.length) throw new Error('Invalid market indicators result');
    return { ...row, indicator_items: Object.fromEntries(SESSION_INDICATORS.map(({ code }, index) => [code, items[index]])) };
  });
}

function publicationTime(value) {
  // A date without a time zone is not evidence of when a point became public.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(String(value))) return 0;
  return Date.parse(value) || 0;
}

function seriesFor(indicator, { sessions, rateDays, fundDays, fxDays, recordDates, sessionPublications }) {
  if (indicator.domestic) return domesticRateSeries(rateDays, indicator, recordDates);
  if (indicator.funds) return marketFundSeries(fundDays, indicator, recordDates);
  const rows = sessions.map(({ market_date, published_at, indicator_items }) => ({
    market_date, published_at, item: indicator_items[indicator.code]
  }));
  if (indicator.code !== 'USDKRW' || !fxDays.size) return marketIndicatorSeries(rows, indicator);
  const fxRows = usdKrwFxRows(rows, fxDays);
  return marketIndicatorSeries(fxRows.map(row => ({
    ...row,
    published_at: fxDays.get(row.market_date)?.published_at
  })), indicator).map(point => ({
    ...point,
    // A new point also needs the final Market Close row before it can appear.
    sessionPublishedAt: sessionPublications.get(point.recordDate)
  }));
}

function indicatorSnapshot(indicator, series, previous, previousReadAt, readCompletedAt) {
  const points = [];
  const oldPoints = new Map(previous?.points);
  const changes = [];
  for (const point of series) {
    const range = indicator.kind === 'krx' || indicator.kind === 'krxvol' ? [point.high, point.low] : [];
    // Snapshot moves are computed from adjacent closes, so they need no separate stamp.
    const move = indicator.kind === 'snapshot' ? [] : [point.change, point.changePct];
    const value = JSON.stringify([point.close, ...move, ...range]);
    points.push([point.date, value]);
    if (oldPoints.get(point.date) !== value) {
      const publishedAt = publicationTime(point.publishedAt);
      const sessionPublishedAt = oldPoints.has(point.date) ? 0 : publicationTime(point.sessionPublishedAt);
      changes.push(Math.max(publishedAt, sessionPublishedAt));
    }
    oldPoints.delete(point.date);
  }
  if (!changes.length && !oldPoints.size) return { points, lastmod: previous?.lastmod || '' };
  // Shared rows may be republished without a change to this instrument. A cold
  // read or a disappearance by itself cannot establish a modification time.
  const known = previousReadAt && !oldPoints.size && changes.length
    && changes.every(time => time >= previousReadAt && time <= readCompletedAt);
  return { points, lastmod: known ? new Date(Math.max(...changes)).toISOString() : '' };
}

export function sitemapMarketMetadata({ sessions, rateDays, fundDays, fxDays }, previous, readCompletedAt) {
  // Preserve the sitemap's existing eligibility window for rates and funds.
  const rateCodes = domesticRateCodesIn(rateDays.slice(0, 10));
  const fundCodes = marketFundCodesIn(fundDays.slice(0, 10));
  const codes = [...rateCodes, ...fundCodes];
  const available = availableIndicatorCodes(sessions, codes);
  const sessionPublications = new Map(sessions.map(row => [row.market_date, row.published_at]));
  const recordDates = new Set(sessionPublications.keys());
  const indicatorState = {};
  const indicatorLastmods = {};
  for (const indicator of MARKET_INDICATORS) {
    if (!available.has(indicator.code)) continue;
    const series = seriesFor(indicator, { sessions, rateDays, fundDays, fxDays, recordDates, sessionPublications });
    const state = indicatorSnapshot(indicator, series, previous?.indicatorState[indicator.code], previous?.readAt, readCompletedAt);
    indicatorState[indicator.code] = state;
    if (state.lastmod) indicatorLastmods[indicator.code] = state.lastmod;
  }
  return {
    rateCodes: codes,
    indicatorState,
    indicatorLastmods,
    counts: { market: sessions.length ? 2 * (sessions.length + available.size + 3) : 0, rates: rateCodes.size * 2, funds: fundCodes.size * 2 }
  };
}
