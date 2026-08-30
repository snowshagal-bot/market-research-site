export const AGGREGATION_VERSION = '1.0.0';

export const SUPPORTED_PERIODS = Object.freeze({
  '1w': 5,
  '1m': 20
});

const INSTRUMENT_GROUPS = Object.freeze(['indices', 'rates_fx_volatility', 'commodities_crypto']);
const FLOW_MARKETS = Object.freeze(['KOSPI', 'KOSDAQ', 'KOSPI200선물']);
const FLOW_INVESTORS = Object.freeze(['외국인', '기관', '개인']);
const BREADTH_MARKETS = Object.freeze(['KOSPI', 'KOSDAQ']);

function isFiniteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

/**
 * Period value rule:
 * - KOSPI, KOSDAQ, USDKRW, JPYKRW: use close (fixed 15:30 close)
 * - Other instruments: if data_state === 'intraday' and current is finite -> current; else close
 * - If unavailable / non-finite -> null
 */
export function getPeriodValue(key, item) {
  if (!item || typeof item !== 'object') return null;
  if (key === 'KOSPI' || key === 'KOSDAQ' || key === 'USDKRW' || key === 'JPYKRW') {
    return isFiniteNumber(item.close) ? item.close : null;
  }
  if (item.data_state === 'intraday' && isFiniteNumber(item.current)) {
    return item.current;
  }
  if (isFiniteNumber(item.close)) {
    return item.close;
  }
  if (isFiniteNumber(item.current)) {
    return item.current;
  }
  return null;
}

/**
 * Baseline value rule for multi-session returns:
 * - First session previous_close if finite
 * - Else if close & change are finite: close - change
 * - Else: null
 */
export function getBaselineValue(key, item) {
  if (!item || typeof item !== 'object') return null;
  if (isFiniteNumber(item.previous_close)) {
    return item.previous_close;
  }
  if (isFiniteNumber(item.close) && isFiniteNumber(item.change)) {
    return item.close - item.change;
  }
  return null;
}

function aggregateInstrumentCategory(categoryKey, snapshots, sessionsUsed) {
  // Collect all unique instrument keys in this category across all snapshots
  const instrumentKeys = new Set();
  for (const s of snapshots) {
    const group = s?.[categoryKey];
    if (group && typeof group === 'object') {
      for (const k of Object.keys(group)) {
        instrumentKeys.add(k);
      }
    }
  }

  const result = {};

  for (const key of instrumentKeys) {
    let observations = 0;
    let periodHigh = null;
    let periodLow = null;
    let firstObserved = null;
    let lastObserved = null;
    let firstSnapshotDate = null;
    let lastSnapshotDate = null;

    for (const snapshot of snapshots) {
      const item = snapshot?.[categoryKey]?.[key];
      if (!item || typeof item !== 'object') continue;

      const pVal = getPeriodValue(key, item);
      if (pVal !== null) {
        observations++;
        if (!firstObserved) {
          firstObserved = item;
          firstSnapshotDate = snapshot.meta?.market_date || item.source_date || null;
        }
        lastObserved = item;
        lastSnapshotDate = snapshot.meta?.market_date || item.source_date || null;
      }

      if (isFiniteNumber(item.high)) {
        periodHigh = periodHigh === null ? item.high : Math.max(periodHigh, item.high);
      }
      if (isFiniteNumber(item.low)) {
        periodLow = periodLow === null ? item.low : Math.min(periodLow, item.low);
      }
    }

    if (observations === 0 || !firstObserved || !lastObserved) {
      result[key] = {
        baseline_value: null,
        end_value: null,
        change: null,
        return_pct: null,
        period_high: periodHigh,
        period_low: periodLow,
        observations: 0,
        complete: false,
        start_market_date: null,
        end_market_date: null,
        start_source_date: null,
        end_source_date: null
      };
      if (key === 'US10Y') result[key].change_bp = null;
      continue;
    }

    const baselineValue = getBaselineValue(key, firstObserved);
    const endValue = getPeriodValue(key, lastObserved);

    let change = null;
    let returnPct = null;

    if (baselineValue !== null && endValue !== null) {
      change = endValue - baselineValue;
      if (baselineValue !== 0) {
        returnPct = ((endValue / baselineValue) - 1) * 100;
      }
    }

    const itemResult = {
      baseline_value: baselineValue,
      end_value: endValue,
      change,
      return_pct: returnPct,
      period_high: periodHigh,
      period_low: periodLow,
      observations,
      complete: observations === sessionsUsed,
      start_market_date: firstSnapshotDate,
      end_market_date: lastSnapshotDate,
      start_source_date: firstObserved.source_date || null,
      end_source_date: lastObserved.source_date || null
    };

    if (key === 'US10Y') {
      itemResult.change_bp = (baselineValue !== null && endValue !== null) ? (endValue - baselineValue) * 100 : null;
    }

    result[key] = itemResult;
  }

  return result;
}

function aggregateFlows(snapshots, sessionsUsed) {
  const markets = {};

  for (const market of FLOW_MARKETS) {
    markets[market] = {};
    for (const investor of FLOW_INVESTORS) {
      let sumNetBuy = 0;
      let observations = 0;

      for (const s of snapshots) {
        const netBuy = s?.krx_investor_trading?.markets?.[market]?.investors?.[investor]?.net_buy;
        if (isFiniteNumber(netBuy)) {
          sumNetBuy += netBuy;
          observations++;
        }
      }

      markets[market][investor] = {
        net_buy: observations > 0 ? sumNetBuy : null,
        observations,
        complete: observations === sessionsUsed
      };
    }
  }

  return {
    unit: 'KRW billion',
    sessions_used: sessionsUsed,
    markets
  };
}

function aggregateBreadth(snapshots, sessionsUsed) {
  const result = {};

  for (const market of BREADTH_MARKETS) {
    let sumRiseRatio = 0;
    let sumFallRatio = 0;
    let sumRiseCount = 0;
    let sumFallCount = 0;
    let advancerDominant = 0;
    let declinerDominant = 0;
    let neutralSessions = 0;
    let observations = 0;

    for (const s of snapshots) {
      const b = s?.market_breadth?.[market];
      if (b && isFiniteNumber(b.rise_count) && isFiniteNumber(b.fall_count)) {
        observations++;
        sumRiseCount += b.rise_count;
        sumFallCount += b.fall_count;
        if (isFiniteNumber(b.rise_ratio)) sumRiseRatio += b.rise_ratio;
        if (isFiniteNumber(b.fall_ratio)) sumFallRatio += b.fall_ratio;

        if (b.rise_count > b.fall_count) advancerDominant++;
        else if (b.fall_count > b.rise_count) declinerDominant++;
        else neutralSessions++;
      }
    }

    result[market] = {
      avg_rise_ratio: observations > 0 ? (sumRiseRatio / observations) : null,
      avg_fall_ratio: observations > 0 ? (sumFallRatio / observations) : null,
      avg_rise_count: observations > 0 ? (sumRiseCount / observations) : null,
      avg_fall_count: observations > 0 ? (sumFallCount / observations) : null,
      advancer_dominant_sessions: advancerDominant,
      decliner_dominant_sessions: declinerDominant,
      neutral_sessions: neutralSessions,
      observations,
      complete: observations === sessionsUsed
    };
  }

  return result;
}

function aggregateKrxGroups(snapshots, sessionsUsed) {
  let sessionsWithData = 0;
  for (const s of snapshots) {
    if (s?.krx_groups && typeof s.krx_groups === 'object' && (Array.isArray(s.krx_groups.sectors) || Array.isArray(s.krx_groups.themes))) {
      sessionsWithData++;
    }
  }

  const coverageComplete = sessionsWithData === sessionsUsed && sessionsUsed > 0;

  function processGroupArray(kind) {
    // Map of index_code -> array of items per snapshot
    const codeMap = new Map();

    snapshots.forEach((s, snapIndex) => {
      const list = s?.krx_groups?.[kind];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item?.index_code) continue;
          if (!codeMap.has(item.index_code)) {
            codeMap.set(item.index_code, {
              index_code: item.index_code,
              name: item.name || '',
              market: item.market || null,
              itemsBySession: new Array(snapshots.length).fill(null)
            });
          }
          const record = codeMap.get(item.index_code);
          record.itemsBySession[snapIndex] = item;
          if (!record.name && item.name) record.name = item.name;
          if (!record.market && item.market) record.market = item.market;
        }
      }
    });

    const entries = [];

    for (const [code, record] of codeMap.entries()) {
      let observations = 0;
      let firstItem = null;
      let lastItem = null;

      for (let i = 0; i < record.itemsBySession.length; i++) {
        const item = record.itemsBySession[i];
        if (item && isFiniteNumber(item.close)) {
          observations++;
          if (!firstItem) firstItem = item;
          lastItem = item;
        }
      }

      const isComplete = observations === sessionsUsed;
      let baselineValue = null;
      let endValue = null;
      let returnPct = null;

      if (isComplete && firstItem && lastItem) {
        if (isFiniteNumber(firstItem.previous_close)) {
          baselineValue = firstItem.previous_close;
        } else if (isFiniteNumber(firstItem.close) && isFiniteNumber(firstItem.change)) {
          baselineValue = firstItem.close - firstItem.change;
        }
        endValue = lastItem.close;

        if (baselineValue !== null && baselineValue !== 0 && endValue !== null) {
          returnPct = ((endValue / baselineValue) - 1) * 100;
        }
      } else if (firstItem && lastItem) {
        if (isFiniteNumber(firstItem.previous_close)) {
          baselineValue = firstItem.previous_close;
        } else if (isFiniteNumber(firstItem.close) && isFiniteNumber(firstItem.change)) {
          baselineValue = firstItem.close - firstItem.change;
        }
        endValue = lastItem.close;
      }

      const entry = {
        index_code: code,
        name: record.name,
        baseline_value: baselineValue,
        end_value: endValue,
        return_pct: returnPct,
        observations,
        complete: isComplete
      };
      if (record.market) entry.market = record.market;

      entries.push(entry);
    }

    // Deterministic sorting
    if (kind === 'sectors') {
      entries.sort((a, b) => {
        const mComp = String(a.market || '').localeCompare(String(b.market || ''));
        if (mComp !== 0) return mComp;
        return a.index_code.localeCompare(b.index_code);
      });
    } else {
      entries.sort((a, b) => a.index_code.localeCompare(b.index_code));
    }

    return entries;
  }

  return {
    sessions_with_data: sessionsWithData,
    sessions_used: sessionsUsed,
    coverage_complete: coverageComplete,
    sectors: processGroupArray('sectors'),
    themes: processGroupArray('themes')
  };
}

/**
 * Computes multi-session market range aggregation.
 * @param {Array<Object>} snapshots Array of raw snapshots in chronological ASC order.
 * @param {string} period '1w' | '1m'
 * @param {number} requiredSessions 5 | 20
 */
export function computeMarketRange(snapshots, period, requiredSessions) {
  const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];
  const sessionsUsed = safeSnapshots.length;

  const dates = safeSnapshots.map(s => s.meta?.market_date).filter(Boolean);
  const startDate = dates.length > 0 ? dates[0] : null;
  const endDate = dates.length > 0 ? dates[dates.length - 1] : null;
  const isComplete = sessionsUsed === requiredSessions;

  // Schema versions breakdown
  const schemaVersions = {};
  for (const s of safeSnapshots) {
    const ver = s?.meta?.schema_version || 'unknown';
    schemaVersions[ver] = (schemaVersions[ver] || 0) + 1;
  }

  const instruments = {};
  for (const groupKey of INSTRUMENT_GROUPS) {
    instruments[groupKey] = aggregateInstrumentCategory(groupKey, safeSnapshots, sessionsUsed);
  }

  const flows = aggregateFlows(safeSnapshots, sessionsUsed);
  const breadth = aggregateBreadth(safeSnapshots, sessionsUsed);
  const krxGroups = aggregateKrxGroups(safeSnapshots, sessionsUsed);

  return {
    aggregation_version: AGGREGATION_VERSION,
    period,
    window: {
      start_date: startDate,
      end_date: endDate,
      dates,
      sessions_used: sessionsUsed,
      required_sessions: requiredSessions,
      complete: isComplete
    },
    coverage: {
      schema_versions: schemaVersions
    },
    instruments,
    flows,
    breadth,
    krx_groups: krxGroups
  };
}
