// Structured facts a report's <title> and meta description may quote.
//
// Every number here comes from the published Market Close row for the
// report's date (D1 `market_close_snapshots`, the same row /api/market/date
// serves). Nothing is read out of the report HTML, and a field that is not
// present, not final, or not from the regular session is simply absent, so
// the SEO layer falls back to wording without that number.
import { TABLE_NAME, ensureMarketTable } from './api/market/_shared.js';

export const FLOW_UNIT = 'KRW billion';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function finalIndex(payload, key) {
  const item = payload?.indices?.[key];
  if (!item || item.data_state !== 'final_close') return null;
  if (!finite(item.close) || !finite(item.change_pct)) return null;
  return { close: item.close, pct: item.change_pct };
}

/**
 * Daily facts from one Market Close payload plus its row's takeaway columns.
 * Returns null unless the snapshot is final and carries a final KOSPI close.
 */
export function extractDailyFacts(payload, row = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const marketDate = String(payload.meta?.market_date || '');
  if (!ISO_DATE.test(marketDate) || payload.meta?.status !== 'final') return null;
  const kospi = finalIndex(payload, 'KOSPI');
  if (!kospi) return null;
  const kosdaq = finalIndex(payload, 'KOSDAQ');

  const trading = payload.krx_investor_trading;
  const kospiFlows = trading?.markets?.KOSPI;
  const flowsUsable = trading?.unit === FLOW_UNIT
    && kospiFlows
    && kospiFlows.source_date === marketDate;
  const net = (investor) => (flowsUsable && finite(kospiFlows.investors?.[investor]?.net_buy)
    ? kospiFlows.investors[investor].net_buy
    : null);

  return {
    kind: 'daily',
    marketDate,
    kospi,
    kosdaq,
    flowUnit: FLOW_UNIT,
    foreignNet: net('외국인'),
    institutionNet: net('기관'),
    individualNet: net('개인'),
    takeaway: {
      ko: String(row?.takeaway_ko || '').replace(/\s+/g, ' ').trim(),
      en: String(row?.takeaway_en || '').replace(/\s+/g, ' ').trim()
    }
  };
}

function utcDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The Monday–Friday week a Weekly report covers, from its report date. A
 * report dated on the weekend covers the week that just ended.
 */
export function weeklyPeriod(reportDate) {
  const date = utcDate(reportDate);
  if (!date) return null;
  const day = date.getUTCDay();
  const toMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(date.getTime() - toMonday * 86400000);
  const friday = new Date(monday.getTime() + 4 * 86400000);
  return { start: isoOf(monday), end: isoOf(friday) };
}

/**
 * Weekly facts from Market Close rows sorted by date: the last final KOSPI
 * close inside the period against the last final close before it.
 */
export function extractWeeklyFacts(rows, period) {
  if (!period || !Array.isArray(rows)) return null;
  let previous = null;
  let last = null;
  for (const row of rows) {
    const date = String(row?.market_date || '');
    if (!ISO_DATE.test(date)) continue;
    let payload;
    try { payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json; }
    catch (_) { continue; }
    if (payload?.meta?.status !== 'final') continue;
    const kospi = finalIndex(payload, 'KOSPI');
    if (!kospi) continue;
    if (date < period.start) previous = { date, close: kospi.close };
    else if (date <= period.end) last = { date, close: kospi.close };
  }
  if (!previous || !last || previous.close <= 0) return null;
  return {
    kind: 'weekly',
    period,
    previousClose: previous.close,
    previousDate: previous.date,
    close: last.close,
    closeDate: last.date,
    pct: (last.close / previous.close - 1) * 100
  };
}

async function marketDb(env) {
  if (!env?.COMMENTS_DB) return null;
  return ensureMarketTable(env);
}

export async function loadDailyFacts(env, reportDate) {
  if (!ISO_DATE.test(String(reportDate || ''))) return null;
  const db = await marketDb(env);
  if (!db) return null;
  const row = await db.prepare(`SELECT market_date, payload_json, takeaway_ko, takeaway_en FROM ${TABLE_NAME} WHERE market_date = ? LIMIT 1`)
    .bind(reportDate).first();
  if (!row) return null;
  let payload;
  try { payload = JSON.parse(row.payload_json); } catch (_) { return null; }
  return extractDailyFacts(payload, row);
}

export async function loadWeeklyFacts(env, reportDate) {
  const period = weeklyPeriod(reportDate);
  if (!period) return null;
  const db = await marketDb(env);
  if (!db) return null;
  const lookback = isoOf(new Date(utcDate(period.start).getTime() - 10 * 86400000));
  const result = await db.prepare(`SELECT market_date, payload_json FROM ${TABLE_NAME} WHERE market_date BETWEEN ? AND ? ORDER BY market_date ASC`)
    .bind(lookback, period.end).all();
  return extractWeeklyFacts(result?.results || [], period);
}

/**
 * Facts for one post, or null. Never throws: a missing binding, a D1 error,
 * or a date without a published close all mean "no numbers", and the SEO
 * layer then writes the fallback wording.
 */
export async function loadReportFacts(env, post) {
  try {
    const reportDate = String(post?.reportDate || post?.date || '').slice(0, 10);
    if (post?.type === 'daily') return await loadDailyFacts(env, reportDate);
    if (post?.type === 'weekly') return await loadWeeklyFacts(env, reportDate);
    return null;
  } catch (error) {
    console.error('report facts unavailable', error);
    return null;
  }
}
