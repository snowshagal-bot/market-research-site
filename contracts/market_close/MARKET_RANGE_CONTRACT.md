# MARKET RANGE AGGREGATION CONTRACT

- **Aggregation Schema Version**: `1.0.0`
- **Endpoint**: `GET /api/market/range?period=1w|1m[&end=YYYY-MM-DD]`
- **Status**: Production Authoritative Contract (Phase 2)

---

## 1. 개요 및 목적 (Overview)

Market Range Aggregation API는 Cloudflare D1에 영구 저장된 일별 Market Snapshot(`market_close_snapshots`)을 원천으로 하여, 클라이언트 요청 시점에 최근 5거래일(`1w`), 최근 20거래일(`1m`)의 파생 시계열 집계 데이터를 서버리스 엣지(Cloudflare Pages Functions)에서 온디맨드로 산출하는 고정밀 집계 계약이다.

### 핵심 설계 원칙
1. **DB Schema & Raw Contract 분리**: 원본 일별 스냅샷 계약(`schema_version: 1.0.1 / 1.1.0`)은 불변으로 유지하며, 집계 API는 독립된 `aggregation_version: "1.0.0"`을 사용한다.
2. **On-Request Aggregation**: 별도의 집계 테이블(`market_weekly`, `market_monthly`)이나 배치 precompute를 두지 않고, D1의 순수 일별 데이터로부터 단일 쿼리로 조회하여 메모리 상에서 결정론적(deterministic)으로 계산한다.
3. **No Off-By-One Return**: 멀티 세션 수익률은 첫 번째 세션의 `previous_close`를 baseline으로 삼아 세션 전체의 가격 변동을 정확히 포괄한다.
4. **Daily Raw Investor Flow Sum**: 기간별 투자자 순매수는 각 일별 스냅샷의 `krx_investor_trading` 원천 net_buy를 단순 합산하며, 기존 5일 누적 필드(`recent_5d_flows`)는 절대 참조하지 않는다.
5. **Strict Completeness & Null ≠ 0**: 데이터 부재나 불완전 관측치는 `0`으로 대체하지 않고 명시적으로 `null`과 `complete: false`로 보고한다.

---

## 2. 기간 정의 (Period Definitions)

지원하는 기간 파라미터는 다음 2종으로 엄격히 제한된다.

| Period | Required Sessions | 정의 | 비고 |
| :--- | :---: | :--- | :--- |
| `1w` | `5` | 최근 5개의 저장된 일별 거래 스냅샷 | 달력 7일(7d)이 아닌 5거래 세션 |
| `1m` | `20` | 최근 20개의 저장된 일별 거래 스냅샷 | 달력 1개월이 아닌 20거래 세션 |

> [!NOTE]
> `7d`, `30d`, `3m`, `ytd`, `custom` 등의 임의 기간은 지원하지 않으며 `HTTP 400 INVALID_PERIOD`를 반환한다.

---

## 3. 요청 규격 및 Validation (Request Specs & Error Handling)

### 3.1 쿼리 파라미터
- `period` (필수): `'1w'` 또는 `'1m'`
- `end` (선택): `YYYY-MM-DD` 형식의 기준 종료일.
  - 생략 시: D1에 저장된 가장 최신의 `market_date`를 기준으로 이전 N세션 조회.
  - 지정 시: 해당 `market_date`를 포함하여 이전 N세션 조회.

### 3.2 HTTP 상태 코드 및 에러 규격
| 상황 | HTTP Status | Error Code | Message |
| :--- | :---: | :--- | :--- |
| `period` 누락 또는 지원하지 않는 값 | `400` | `INVALID_PERIOD` | 지원하지 않는 기간 형식입니다 (1w, 1m). |
| `end` 날짜 포맷/달력 유효성 위반 | `400` | `INVALID_DATE` | 올바른 날짜 형식이 아닙니다 (YYYY-MM-DD). |
| 유효한 날짜이나 D1에 해당 날짜 데이터 없음 | `404` | `MARKET_DATE_NOT_FOUND` | 해당 종료 날짜의 Market Close 데이터가 없습니다. |
| D1 테이블에 데이터가 전혀 없음 | `404` | `NO_MARKET_DATA` | 아직 게시된 Market Close 데이터가 없습니다. |

> [!IMPORTANT]
> `end`로 지정된 날짜가 D1에 없으면 절대로 이전 날짜나 최신 데이터로 자동 fallback하지 않고 즉시 `404 MARKET_DATE_NOT_FOUND`를 반환한다.

---

## 4. 응답 구조 (Response Schema)

```json
{
  "aggregation_version": "1.0.0",
  "period": "1w",
  "window": {
    "start_date": "2026-08-25",
    "end_date": "2026-08-28",
    "dates": [
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28"
    ],
    "sessions_used": 4,
    "required_sessions": 5,
    "complete": false
  },
  "coverage": {
    "schema_versions": {
      "1.0.1": 4
    }
  },
  "instruments": {
    "indices": {
      "KOSPI": {
        "baseline_value": 6912.37,
        "end_value": 6788.88,
        "change": -123.49,
        "return_pct": -1.786507377353929,
        "period_high": 6901.78,
        "period_low": 6780.13,
        "observations": 4,
        "complete": false,
        "start_market_date": "2026-08-25",
        "end_market_date": "2026-08-28",
        "start_source_date": "2026-08-25",
        "end_source_date": "2026-08-28"
      }
    },
    "rates_fx_volatility": {
      "US10Y": {
        "baseline_value": 4.60,
        "end_value": 4.72,
        "change": 0.12,
        "change_bp": 12.0,
        "return_pct": 2.608695652173913,
        "period_high": 4.73,
        "period_low": 4.58,
        "observations": 4,
        "complete": false,
        "start_market_date": "2026-08-25",
        "end_market_date": "2026-08-28",
        "start_source_date": "2026-08-25",
        "end_source_date": "2026-08-28"
      }
    },
    "commodities_crypto": {
      "WTI": {
        "baseline_value": 83.53,
        "end_value": 82.87,
        "change": -0.66,
        "return_pct": -0.7901352807374597,
        "period_high": 84.10,
        "period_low": 82.20,
        "observations": 4,
        "complete": false,
        "start_market_date": "2026-08-25",
        "end_market_date": "2026-08-28",
        "start_source_date": "2026-08-25",
        "end_source_date": "2026-08-28"
      }
    }
  },
  "flows": {
    "unit": "KRW billion",
    "sessions_used": 4,
    "markets": {
      "KOSPI": {
        "외국인": {
          "net_buy": -1756,
          "observations": 4,
          "complete": false
        },
        "기관": {
          "net_buy": -284,
          "observations": 4,
          "complete": false
        },
        "개인": {
          "net_buy": 424,
          "observations": 4,
          "complete": false
        }
      },
      "KOSDAQ": { ... },
      "KOSPI200선물": { ... }
    }
  },
  "breadth": {
    "KOSPI": {
      "avg_rise_ratio": 0.65,
      "avg_fall_ratio": 0.31,
      "avg_rise_count": 610.5,
      "avg_fall_count": 290.0,
      "advancer_dominant_sessions": 3,
      "decliner_dominant_sessions": 1,
      "neutral_sessions": 0,
      "observations": 4,
      "complete": false
    },
    "KOSDAQ": { ... }
  },
  "krx_groups": {
    "sessions_with_data": 0,
    "sessions_used": 4,
    "coverage_complete": false,
    "sectors": [],
    "themes": []
  }
}
```

---

## 5. 집계 및 계산 규칙 상세 (Calculation Invariants)

### 5.1 Completeness 정의
- `window.complete = (sessions_used === required_sessions)`
- 본 Phase 2에서 completeness는 **"필요한 개수의 저장된 Daily Snapshot이 온전히 존재하는가"**로 정의된다. (거래소 휴일 달력 연속성 검증은 향후 캘린더 엔진 도입 시 확장 가능).

### 5.2 자산별 가격(Period Value) 및 기준가(Baseline Value) 결정 규칙
1. **Period Value (`end_value`)**:
   - `KOSPI`, `KOSDAQ`, `USDKRW`, `JPYKRW`: 한국 장 마감 확정치인 `close` 사용.
   - 기타 자산: `data_state === 'intraday'`이고 유효한 `current`가 존재하면 `current`, 아니면 `close`.
   - 누락/비정상치: `null`.
2. **Baseline Value (`baseline_value`)**:
   - 윈도우 내 첫 번째 관측 스냅샷의 `previous_close` (없으면 `close - change`).
3. **수익률 공식**:
   $$\text{change} = \text{end\_value} - \text{baseline\_value}$$
   $$\text{return\_pct} = \left(\frac{\text{end\_value}}{\text{baseline\_value}} - 1\right) \times 100$$
   - `baseline_value`가 `0`이거나 `null`이면 `return_pct = null`.
4. **Period High / Low**:
   - 윈도우 내 관측된 유한(finite) `high`의 최대값 및 `low`의 최소값. (관측치 부재 시 `null`).
5. **US10Y 국채 금리 (`change_bp`)**:
   $$\text{change\_bp} = (\text{end\_value} - \text{baseline\_value}) \times 100$$

### 5.3 투자자 수급 (Investor Flows)
- **원천**: 각 일별 스냅샷의 `krx_investor_trading.markets[market].investors[investor].net_buy`
- **단위**: `KRW billion` (십억원)
- **금지 사항**: 이미 rolling 누적된 `recent_5d_flows` 필드는 절대로 집계 원천으로 사용하지 않는다.

### 5.4 시장 심도 (Market Breadth)
- `avg_rise_ratio`, `avg_fall_ratio`, `avg_rise_count`, `avg_fall_count`: 유효 관측 세션 수 기준 산술 평균.
- `advancer_dominant_sessions`: $\text{rise\_count} > \text{fall\_count}$ 인 세션 수.
- `decliner_dominant_sessions`: $\text{fall\_count} > \text{rise\_count}$ 인 세션 수.
- `neutral_sessions`: $\text{rise\_count} = \text{fall\_count}$ 인 세션 수.

### 5.5 KRX 업종 및 테마 (KRX Groups)
- **식별자 (Identity)**: `index_code`를 유일 식별자로 사용.
- **Coverage**: 윈도우 내 모든 스냅샷에 `krx_groups`가 존재할 때만 `coverage_complete: true`.
- **개별 코드 산출**: 특정 `index_code`가 윈도우의 모든 세션에 존재하고 첫날과 마지막 날에 유효 가격이 있을 때만 `return_pct`를 산출하며, 하루라도 누락되면 `complete: false`, `return_pct: null`.
- **정렬**:
  - `sectors`: `market ASC, index_code ASC`
  - `themes`: `index_code ASC`

---

## 6. 캐시 및 ETag 전략 (Caching & ETag)

- **Cache-Control**: `public, max-age=30, s-maxage=120, stale-while-revalidate=300`
- **ETag 포맷**: `W/"market-range-{period}-{start_date}-{end_date}-{fingerprint}"`
- **Fingerprint 입력**: `period` 및 포함된 모든 일별 스냅샷의 `market_date:generated_at:published_at` 조합.
- 특정 날짜의 스냅샷이 re-publish되어 `generated_at` 또는 `published_at`이 변경되면 ETag가 즉시 갱신되어 캐시 일관성을 보장한다.
