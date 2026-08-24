(function (root) {
  'use strict';

  const ko = document.documentElement.dataset.siteLang !== 'en';
  const copy = ko ? {
    title: 'MARKET CLOSE', subtitle: '오늘 시장은 어떻게 마감했나', closeBasis: '15:30 KST 마감 기준', overseas: '* 해외 시장은 각 시장의 최신 거래일 기준',
    sections: ['주요 지수', '금리 · 환율 · 변동성', '원자재 · 가상자산', '시장 폭', 'KRX 투자자 매매동향 (당일)', '최근 5거래일 누적 수급', '프로그램 & 베이시스', '시장 내부 지표', '공매도 현황', '시가총액 상위 10종목 (KOSPI)'],
    open: '시가', high: '고가', low: '저가', previous: '전일', close: '종가', current: '최신', intraday: '장중', recentClose: '최근 종가', unavailable: '데이터 없음',
    rise: '상승종목', fall: '하락종목', flat: '보합종목', upper: '상한가', lower: '하한가', riseRatio: '상승비율', fallRatio: '하락비율',
    foreign: '외국인', institution: '기관', individual: '개인', market: '시장', fiveDays: '5거래일', billion: '억원',
    arbitrage: '차익', nonArbitrage: '비차익', total: '전체', netBuy: '순매수', spot: 'KOSPI200 현물', future: '선물', basis: '베이시스',
    turnover: '거래대금', previousTurnover: '전일 거래대금', average5: '5일 평균', ratio5: '5일 평균 대비', concentration: '수급 집중도 (상위 비중)', foreignBuy: '외국인 매수', foreignSell: '외국인 매도', institutionBuy: '기관 매수', institutionSell: '기관 매도', top1: 'TOP1', top5: 'TOP5',
    shortSummary: '시장별 공매도', shortValue: '공매도 거래대금 TOP5', shortRatio: '공매도 비중 TOP5', valueRatio: '거래대금 비중', shortAmount: '공매도 거래대금',
    rank: '순위', stock: '종목명', price: '종가', change: '등락률', marketCap: '시가총액', source: '데이터 출처', generated: '생성', latestReport: '오늘의 리포트 보기',
    noteTitle: '숫자 너머의 의미를 해석합니다.', noteBody: '시장 전체 흐름과 한국시장 내부 구조를 한눈에 정리하고, 더 깊은 해설은 Snowshagal 리포트에서 이어갑니다.',
    loadError: '마감 데이터를 불러오지 못했습니다.', retry: '잠시 후 다시 시도해 주세요.'
  } : {
    title: 'MARKET CLOSE', subtitle: 'How did the market finish today?', closeBasis: 'Korea close as of 15:30 KST', overseas: '* Overseas markets use each market’s latest trading session.',
    sections: ['Major Indices', 'Rates · FX · Volatility', 'Commodities · Crypto', 'Market Breadth', 'KRX Investor Flows (Daily)', 'Cumulative Flows: Last 5 Sessions', 'Program Trading & Basis', 'Market Internals', 'Short Selling', 'Top 10 by Market Cap (KOSPI)'],
    open: 'Open', high: 'High', low: 'Low', previous: 'Prev.', close: 'Close', current: 'Latest', intraday: 'Intraday', recentClose: 'Recent close', unavailable: 'Unavailable',
    rise: 'Advancers', fall: 'Decliners', flat: 'Unchanged', upper: 'Limit up', lower: 'Limit down', riseRatio: 'Advance ratio', fallRatio: 'Decline ratio',
    foreign: 'Foreign', institution: 'Institution', individual: 'Retail', market: 'Market', fiveDays: '5 sessions', billion: 'KRW 100m',
    arbitrage: 'Arbitrage', nonArbitrage: 'Non-arbitrage', total: 'Total', netBuy: 'Net buy', spot: 'KOSPI 200 spot', future: 'Futures', basis: 'Basis',
    turnover: 'Turnover', previousTurnover: 'Previous', average5: '5-session avg.', ratio5: 'vs. 5-session avg.', concentration: 'Flow Concentration (Top Share)', foreignBuy: 'Foreign buy', foreignSell: 'Foreign sell', institutionBuy: 'Institution buy', institutionSell: 'Institution sell', top1: 'TOP1', top5: 'TOP5',
    shortSummary: 'Market Short Selling', shortValue: 'Top 5 by Short Value', shortRatio: 'Top 5 by Short Ratio', valueRatio: 'Value ratio', shortAmount: 'Short value',
    rank: 'Rank', stock: 'Company', price: 'Close', change: 'Change', marketCap: 'Market cap', source: 'Sources', generated: 'Generated', latestReport: 'Read today’s report',
    noteTitle: 'We interpret the meaning beyond the numbers.', noteBody: 'See the market’s broad direction and internal Korean-market structure at a glance, then continue with deeper context in Snowshagal reports.',
    loadError: 'Could not load the market close.', retry: 'Please try again shortly.'
  };

  const names = {
    NASDAQ: 'NASDAQ Composite', DOW: 'Dow Jones', SP500: 'S&P 500', SOX: 'Philadelphia Semiconductor', VIX: 'VIX', US10Y: 'US 10Y', USDKRW: 'USD/KRW', JPYKRW: 'JPY/KRW (100)', DXY: 'Dollar Index', WTI: 'WTI Crude', GOLD: 'Gold', BITCOIN: 'Bitcoin',
    KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', 'KOSPI200선물': 'KOSPI 200 Futures', '기관': 'Institution', '외국인': 'Foreign', '개인': 'Retail', '차익': 'Arbitrage', '비차익': 'Non-arbitrage', '전체': 'Total'
  };

  const html = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const valid = value => typeof value === 'number' && Number.isFinite(value);
  const number = (value, digits = 2) => valid(value) ? new Intl.NumberFormat(ko ? 'ko-KR' : 'en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) : '--';
  const integer = value => valid(value) ? new Intl.NumberFormat(ko ? 'ko-KR' : 'en-US', { maximumFractionDigits: 0 }).format(value) : '--';
  const signClass = value => !valid(value) || value === 0 ? 'neutral' : value > 0 ? 'up' : 'down';
  const signed = (value, digits = 2) => valid(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${number(Math.abs(value), digits)}` : '--';
  const pct = value => valid(value) ? `${signed(value, 2)}%` : '--';
  const ratioPct = value => valid(value) ? `${number(value * 100, 1)}%` : '--';
  const localName = value => ko ? value : (names[value] || value);
  const dateText = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return html(value || '--');
    const [y, m, d] = value.split('-').map(Number);
    return ko ? `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}` : new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  const won = value => {
    if (!valid(value)) return '--';
    const abs = Math.abs(value);
    if (ko) {
      if (abs >= 1e12) return `${number(value / 1e12, 2)}조원`;
      if (abs >= 1e8) return `${number(value / 1e8, 0)}억원`;
      return `${integer(value)}원`;
    }
    if (abs >= 1e12) return `KRW ${number(value / 1e12, 2)}tn`;
    if (abs >= 1e9) return `KRW ${number(value / 1e9, 1)}bn`;
    return `KRW ${integer(value)}`;
  };
  const flow = value => valid(value) ? `${signed(value, 0)}` : '--';
  const instrumentName = (key, item) => ko ? (item?.name || key) : (names[key] || key);
  const valueUnit = (key, value) => {
    if (!valid(value)) return '--';
    if (key === 'US10Y') return `${number(value, 3)}%`;
    if (key === 'USDKRW') return ko ? `${number(value, 2)}원` : `₩${number(value, 2)}`;
    if (key === 'JPYKRW') return ko ? `${number(value, 2)}원` : `₩${number(value, 2)}`;
    if (key === 'WTI' || key === 'GOLD' || key === 'BITCOIN') return `$${number(value, key === 'BITCOIN' ? 0 : 2)}`;
    return number(value, 2);
  };
  const displayValue = (key, item) => {
    if (!item || item.data_state === 'unavailable') return null;
    if (key === 'USDKRW' || key === 'JPYKRW' || key === 'KOSPI' || key === 'KOSDAQ') return item.close;
    return item.data_state === 'intraday' && valid(item.current) ? item.current : item.close;
  };
  const stateText = item => {
    if (!item || item.data_state === 'unavailable') return copy.unavailable;
    if (item.data_state === 'intraday') return copy.intraday;
    return copy.recentClose;
  };
  const metric = (label, value, extra = '') => `<div class="market-metric"><span>${html(label)}</span><strong class="${extra}">${value}</strong></div>`;
  const section = (numberValue, title, body, extra = '') => `<section class="market-section ${extra}" aria-labelledby="market-section-${numberValue}"><h2 id="market-section-${numberValue}"><span>${numberValue}.</span> ${html(title)}</h2>${body}</section>`;

  function instrumentCard(key, item, major = false) {
    const display = displayValue(key, item);
    const movement = item?.change;
    const movementClass = signClass(movement);
    const detail = major ? `<dl class="market-ohlc">
      <div><dt>${copy.open}</dt><dd>${number(item?.open, 2)}</dd></div><div><dt>${copy.high}</dt><dd>${number(item?.high, 2)}</dd></div><div><dt>${copy.low}</dt><dd>${number(item?.low, 2)}</dd></div><div><dt>${copy.previous}</dt><dd>${number(item?.previous_close, 2)}</dd></div>
    </dl>` : '';
    return `<article class="instrument-card ${major ? 'major' : ''}">
      <div class="instrument-heading"><span>${html(instrumentName(key, item))}</span>${item?.ticker ? `<small>${html(item.ticker)}</small>` : ''}</div>
      <strong class="instrument-value">${valueUnit(key, display)}</strong>
      <div class="instrument-change ${movementClass}">${movementClass === 'up' ? '▲' : movementClass === 'down' ? '▼' : '—'} ${signed(movement, key === 'US10Y' ? 3 : 2)} <span>(${pct(item?.change_pct)})</span></div>
      ${detail}<div class="instrument-state">${dateText(item?.source_date)} · ${stateText(item)}</div>
    </article>`;
  }

  function dataTable(headings, rows, className = '') {
    return `<div class="market-table-wrap"><table class="market-table ${className}"><thead><tr>${headings.map(item => `<th scope="col">${html(item)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function breadthCard(key, item) {
    return `<article class="breadth-card"><h3>${key}</h3><div class="breadth-counts">
      ${metric(copy.rise, integer(item?.rise), 'up')}${metric(copy.fall, integer(item?.fall), 'down')}${metric(copy.flat, integer(item?.flat))}${metric(copy.upper, integer(item?.upper_limit), 'up')}${metric(copy.lower, integer(item?.lower_limit), 'down')}
    </div><div class="breadth-bar" aria-label="${copy.riseRatio} ${ratioPct(item?.rise_ratio)}, ${copy.fallRatio} ${ratioPct(item?.fall_ratio)}"><span class="advance" style="width:${valid(item?.rise_ratio) ? item.rise_ratio * 100 : 0}%"></span><span class="decline" style="width:${valid(item?.fall_ratio) ? item.fall_ratio * 100 : 0}%"></span></div><div class="breadth-ratios"><span class="up">${copy.riseRatio} ${ratioPct(item?.rise_ratio)}</span><span class="down">${copy.fallRatio} ${ratioPct(item?.fall_ratio)}</span></div></article>`;
  }

  function render(data, target = document.getElementById('market-close-root')) {
    if (!target) return;
    const i = data.indices || {};
    const rate = data.rates_fx_volatility || {};
    const commodity = data.commodities_crypto || {};
    const investor = data.krx_investor_trading?.markets || {};
    const five = data.recent_5d_flows?.markets || {};
    const breadth = data.market_breadth || {};
    const program = data.program_basis || {};
    const internals = data.market_internals || {};
    const shorts = data.short_selling || {};
    const marketCap = Array.isArray(data.market_cap_top10) ? data.market_cap_top10 : [];
    const latest = latestDaily();
    const sourceSet = new Set();
    [...Object.values(i), ...Object.values(rate), ...Object.values(commodity)].forEach(item => item?.source && sourceSet.add(item.source));

    const investorRows = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(market => {
      const values = investor[market]?.investors || {};
      return [html(localName(market)), `<span class="${signClass(values['외국인']?.net_buy)}">${flow(values['외국인']?.net_buy)}</span>`, `<span class="${signClass(values['기관']?.net_buy)}">${flow(values['기관']?.net_buy)}</span>`, `<span class="${signClass(values['개인']?.net_buy)}">${flow(values['개인']?.net_buy)}</span>`];
    });
    const fiveRows = ['KOSPI', 'KOSDAQ', 'KOSPI200선물'].map(market => [html(localName(market)), ...['외국인', '기관', '개인'].map(kind => `<span class="${signClass(five[market]?.[kind])}">${flow(five[market]?.[kind])}</span>`)]);
    const programRows = ['차익', '비차익', '전체'].map(kind => [html(localName(kind)), `<span class="${signClass(program.program_trading?.[kind]?.net_buy_won)}">${won(program.program_trading?.[kind]?.net_buy_won)}</span>`]);
    const concentration = internals.concentration || {};
    const concentrationItems = [
      [copy.foreignBuy, concentration['외국인']?.buy], [copy.foreignSell, concentration['외국인']?.sell], [copy.institutionBuy, concentration['기관']?.buy], [copy.institutionSell, concentration['기관']?.sell]
    ];
    const shortList = (items, ratioMode = false) => `<ol class="rank-list">${(items || []).map(item => `<li><span><b>${html(item.name)}</b><small>${html(item.market)}</small></span><strong>${ratioMode ? ratioPct(item.short_value_ratio) : won(item.short_value_won)}</strong></li>`).join('')}</ol>`;
    const marketCapRows = marketCap.map(item => [integer(item.rank), `<span class="stock-name"><b>${html(item.name)}</b><small>${html(item.ticker)}</small></span>`, integer(item.close), `<span class="${signClass(item.change_pct)}">${pct(item.change_pct)}</span>`, won(item.market_cap_won)]);

    const output = `
      <section class="market-hero" aria-labelledby="market-close-heading"><div class="market-wrap market-hero-inner"><div class="market-hero-copy">
        <p class="market-eyebrow">SNOWSHAGAL</p><h1 id="market-close-heading">${copy.title}</h1><p class="market-subtitle">${copy.subtitle}</p>
        <p class="market-date">${dateText(data.meta?.market_date)} · ${copy.closeBasis}</p><p class="market-overseas">${copy.overseas}</p>
      </div><div class="market-mountain" aria-hidden="true"></div></div></section>
      <div class="market-wrap market-dashboard">
        ${section(1, copy.sections[0], `<div class="major-index-grid">${['KOSPI', 'KOSDAQ', 'NASDAQ', 'DOW', 'SP500'].map(key => instrumentCard(key, i[key], true)).join('')}</div>`, 'section-wide')}
        <div class="market-pair market-pair-top">
          ${section(2, copy.sections[1], `<div class="mini-instrument-grid">${['SOX', 'VIX', 'US10Y', 'USDKRW', 'JPYKRW', 'DXY'].map(key => instrumentCard(key, rate[key])).join('')}</div>`)}
          ${section(3, copy.sections[2], `<div class="mini-instrument-grid commodity-grid">${['WTI', 'GOLD', 'BITCOIN'].map(key => instrumentCard(key, commodity[key])).join('')}</div>`)}
        </div>
        ${section(4, copy.sections[3], `<div class="breadth-grid">${['KOSPI', 'KOSDAQ'].map(key => breadthCard(key, breadth[key])).join('')}</div>`)}
        <div class="market-pair market-pair-tables">
          ${section(5, copy.sections[4], `${dataTable([copy.market, copy.foreign, copy.institution, copy.individual], investorRows)}<p class="unit-note">${ko ? '단위: 억원' : 'Unit: KRW 100 million'}</p>`)}
          ${section(6, copy.sections[5], `${dataTable([copy.market, copy.foreign, copy.institution, copy.individual], fiveRows)}<p class="unit-note">${dateText(data.recent_5d_flows?.start_date)} – ${dateText(data.recent_5d_flows?.end_date)}</p>`)}
        </div>
        <div class="market-trio">
          ${section(7, copy.sections[6], `<div class="program-grid"><div><h3>${ko ? '프로그램 매매' : 'Program trading'}</h3>${dataTable(['', copy.netBuy], programRows, 'compact')}</div><div class="basis-panel">${metric(copy.spot, number(program.basis?.kospi200_spot, 2))}${metric(program.basis?.future_name || copy.future, number(program.basis?.future, 2))}${metric(copy.basis, signed(program.basis?.basis, 2), signClass(program.basis?.basis))}<span class="state-chip">${html(program.basis?.market_state || '--')}</span></div></div>`)}
          ${section(8, copy.sections[7], `<div class="turnover-grid">${['KOSPI', 'KOSDAQ'].map(key => `<article><h3>${key}</h3>${metric(copy.turnover, won(internals.turnover?.[key]?.value_won))}${metric(copy.average5, won(internals.turnover?.[key]?.average5_value_won))}${metric(copy.ratio5, valid(internals.turnover?.[key]?.ratio5) ? `${number(internals.turnover[key].ratio5, 2)}×` : '--')}</article>`).join('')}</div><h3 class="subsection-title">${copy.concentration}</h3><div class="concentration-grid">${concentrationItems.map(([label, item]) => `<div><span>${label}</span><b>${copy.top5} ${ratioPct(item?.top5_ratio)}</b><small>${html(item?.top_name || '--')}</small></div>`).join('')}</div>`)}
          ${section(9, copy.sections[8], `<div class="short-summary">${['KOSPI', 'KOSDAQ'].map(key => `<article><h3>${key}</h3>${metric(copy.shortAmount, won(shorts.market_summary?.[key]?.short_value_won))}${metric(copy.valueRatio, ratioPct(shorts.market_summary?.[key]?.short_value_ratio))}</article>`).join('')}</div><div class="short-ranks"><div><h3>${copy.shortValue}</h3>${shortList(shorts.top5_by_value)}</div><div><h3>${copy.shortRatio}</h3>${shortList(shorts.top5_by_ratio, true)}</div></div>`)}
        </div>
        <div class="market-bottom-grid">
          ${section(10, copy.sections[9], dataTable([copy.rank, copy.stock, copy.price, copy.change, copy.marketCap], marketCapRows, 'market-cap-table'))}
          <aside class="market-note"><span class="note-quote" aria-hidden="true">“</span><h2>${copy.noteTitle}</h2><p>${copy.noteBody}</p>${latest ? `<a class="market-report-cta" href="/${html(String(latest.href).replace(/^\/+/, ''))}">${copy.latestReport} <span aria-hidden="true">→</span></a>` : ''}</aside>
        </div>
        <div class="market-data-note"><p>${copy.source}: ${html(Array.from(sourceSet).map(item => item.split(' · ')[0]).filter((item, index, all) => all.indexOf(item) === index).join(', '))}</p><p>${copy.generated}: ${html(data.meta?.generated_at || '--')} · ${html(data.meta?.schema_version || '')}</p></div>
      </div>`;
    target.innerHTML = output;
  }

  function latestDaily() {
    const posts = Array.isArray(root.RESEARCH_POSTS) ? root.RESEARCH_POSTS : [];
    const localeApi = root.MARKET_LOCALE;
    const localized = localeApi ? localeApi.sortPosts(localeApi.localePosts(posts, ko ? 'ko' : 'en')) : posts;
    return localized.find(post => post.type === 'daily') || null;
  }

  function renderError(target = document.getElementById('market-close-root')) {
    if (!target) return;
    target.innerHTML = `<section class="market-state"><span aria-hidden="true">✦</span><h1>${copy.loadError}</h1><p>${copy.retry}</p></section>`;
  }

  async function init() {
    if (!document.getElementById('market-close-root')) return;
    const source = document.body.dataset.marketSource;
    if (!source) return renderError();
    try {
      const response = await fetch(source, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (_) { renderError(); }
  }

  root.MARKET_CLOSE = { render, format: { number, pct, ratioPct, won, flow }, displayValue };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
