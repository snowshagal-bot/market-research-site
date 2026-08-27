# Snowshagal Market Close 데이터 계약

## 목적과 범위

이 계약은 개인용 글로벌 시장/KRX 대시보드가 Snowshagal 홈페이지의 **Market Close / EOD Snapshot**에 전달할 공개 JSON 형식을 고정한다. 실시간 시세 API가 아니며, 한국시장 거래일의 검증된 마감본만 `latest.json`으로 승격한다.

- 현재 버전: `1.0.1`
- 정식 스키마: `market_close.schema.json`
- 실제 형식 예제: `market_close.example.json`
- 운영 출력: `data/market_close/YYYY-MM-DD.json`, `data/market_close/latest.json`
- 제외 데이터: LME 구리, LME 알루미늄
- 금지 데이터: API key, token, credential, password, cookie 등 인증정보

## 버전 정책

계약 필드의 추가·삭제·이름 변경·단위 변경·의미 변경 시 반드시 다음 세 위치를 함께 갱신한다.

1. Exporter의 `SCHEMA_VERSION`
2. `market_close.schema.json`의 `$id`와 `meta.schema_version.const`
3. 이 문서와 `market_close.example.json`

호환되지 않는 변경은 major, 기존 필드를 유지한 선택 필드 추가는 minor, 의미를 바꾸지 않는 문서·검증 보완은 patch를 올린다. Snowshagal 수신 측은 알 수 없는 major 버전을 거부해야 한다.

## 생성 및 승격 규칙

Windows 작업 스케줄러가 14:00, 14:05, 14:10, 14:15, 14:20 ICT에 독립 실행형 Export 명령을 호출한다. 한국 PC 시간대에서도 동일한 실제 시각에 실행되도록 16시 보조 트리거가 함께 등록되며, 실행 파일 내부에서 실제 `Asia/Bangkok` 시각을 다시 검사한다.

예약 시각에 PC가 종료·절전 상태였던 경우를 위해 부팅 트리거와 사용자 로그온 트리거를 함께 등록한다. 두 복구 트리거는 네트워크 초기화를 기다리도록 정확히 2분(`PT2M`) 지연되며, 작업 설정의 `StartWhenAvailable`도 활성화한다.

- 14:00 ICT 이전 복구 호출: 즉시 종료하고 파일을 만들지 않는다.
- 14:00 ICT 이후 복구 호출: 같은 날짜 `final`이 없을 때만 KOSPI 거래일을 캐시 또는 Provider로 먼저 확인한다.
- 주말: Provider를 호출하기 전에 종료한다.
- 평일 휴장일: 확인된 최근 KOSPI 거래일이 대상일과 다르면 종료하며 날짜 파일을 만들지 않는다.
- 네트워크 초기화 중 거래일 확인 실패: 날짜 파일을 만들지 않고 실패 코드로 종료한다. Task Scheduler가 5분 간격으로 최대 3회 재시도한다.
- 거래일 확인 성공: 기존 Provider/Collector 수집과 전체 final 검증을 수행한다. 불완전하면 `latest.json`을 변경하지 않는다.
- 22:00 ICT 이후에는 한국이 다음 날짜이므로 예약 실행의 `market_date`는 KST 날짜가 아닌 ICT 날짜를 사용한다.
- 부팅과 로그온이 동시에 발생해도 `MultipleInstances=IgnoreNew`와 기존 final 잠금으로 중복 실행·덮어쓰기를 방지한다.

각 시도는 대시보드와 동일한 Provider, `MarketService`, KRX Collector 및 캐시 검증을 사용한다.

- 검증 실패: 날짜별 파일을 `status=incomplete`로 기록하거나 갱신한다. `latest.json`은 절대 변경하지 않는다.
- 검증 성공: 날짜별 파일을 `status=final`로 기록하고, 기존 latest보다 같거나 최신 날짜일 때만 `latest.json`을 원자적으로 교체한다.
- 확정본 불변성: 같은 `market_date`의 날짜별 파일이 이미 `final`이면 예약 실행과 일반 실행은 데이터 재수집 및 날짜별 파일/`latest.json` 쓰기를 모두 건너뛴다.
- 허용되는 자동 승격은 `incomplete → final`뿐이다. `final → final` 재생성은 명시적인 `--force`에서만 허용한다.
- 과거 날짜를 강제로 재생성해도 더 최신인 `latest.json`을 되돌리지 않는다.
- 쓰기 방식: 임시 파일 작성 → JSON 재파싱 → `os.replace` 원자적 교체.

## 데이터 흐름

```text
네이버 지수 / Yahoo / 네이버 하나은행 / KRX 공개자료
                         │
                         ▼
기존 Provider와 Collector의 날짜·상태·산식 검증
                         │
                         ▼
MarketSnapshot + KrxMarketOverviewResult + KrxReportResult
             ├──────────────► 기존 UI / Excel
             └──────────────► MarketCloseExporter
                                      │
                                      ▼
                         YYYY-MM-DD.json / latest.json
```

Exporter는 원천 웹 페이지를 직접 파싱하지 않는다. UI가 받는 세 최종 객체의 허용 필드만 명시적으로 직렬화한다.

## 최종 확정 조건

`meta.status=final`이 되려면 다음 조건을 모두 통과해야 한다.

- 14개 공개 시장 항목에 최종값과 미래가 아닌 `source_date`가 존재
- KOSPI·KOSDAQ의 `actual_date`가 `market_date`와 정확히 일치
- KOSPI·KOSDAQ이 장중 상태가 아니며 OHLC 논리 검증 통과
- USD/KRW·JPY/KRW의 당일 15:30 KST 하나은행 매매기준율 확정
- KOSPI·KOSDAQ·KOSPI200선물 투자자 수급이 모두 당일 `확정`
- KOSPI·KOSDAQ 시장 폭이 모두 당일 `확정`
- 최근 누적 수급이 당일 종료 기준 정확히 5개 거래일·9개 조합
- KOSPI·KOSDAQ 거래대금, 필수 수급 집중도 4개가 당일 `확정`
- KOSPI200 현물·선물·Basis와 차익·비차익·전체 프로그램이 당일 `확정`
- KOSPI·KOSDAQ 공매도 요약과 TOP5 원자료가 당일 확정
- 시가총액 상위 10개가 모두 당일 정규장 종가 확정

검증 실패 원인은 `validation.errors`에 기록한다. 전 거래일 KRX 값은 당일 값으로 승격되지 않는다.

## 최상위 구조

| 필드 | 의미 |
|---|---|
| `meta` | 시장 기준일, 생성시각, 시간대, 상태, 계약 버전 |
| `indices` | KOSPI, KOSDAQ, NASDAQ, DOW, SP500 |
| `rates_fx_volatility` | SOX, VIX, US10Y, USDKRW, JPYKRW, DXY |
| `commodities_crypto` | WTI, GOLD, BITCOIN |
| `krx_investor_trading` | 3개 시장 × 외국인·기관·개인의 매도/매수/순매수 |
| `recent_5d_flows` | 최근 5거래일 누적 순매수 |
| `market_breadth` | 상한가·상승·보합·하락·하한가와 상승/하락 비율 |
| `program_basis` | KOSPI200 현·선물, Basis, 만기, 프로그램 3구분 |
| `market_internals` | 시장 거래대금과 외국인·기관 매수/매도 집중도 |
| `short_selling` | 시장 요약, 거래대금 TOP5, 비중 TOP5 |
| `market_cap_top10` | KOSPI·KOSDAQ 통합 시가총액 상위 10 |
| `validation` | 최종 승격 여부와 실패 사유 |

## 시장 항목 의미

모든 시장 항목은 같은 공통 형태를 사용한다.

- `close`: 해당 항목의 마감 기준값. 환율은 네이버 금융 하나은행 15:30 KST 확정 매매기준율이다.
- `current`: 대시보드 카드의 큰 숫자와 동일한 최종 전달값. 환율은 Yahoo 장중/최근값일 수 있어 `close`와 다를 수 있다.
- `change`, `change_pct`: 대시보드가 표시하는 `current - previous_close` 산식을 그대로 사용한다.
- `open`, `high`, `low`: 현재 `MarketSnapshot` 보유값. 제공되지 않으면 `null`이다.
- `source_date`: 해당 시장 값의 실제 거래일. 해외시장은 한국 `market_date`보다 이전일 수 있다.
- `as_of`: 시장 값의 기준일 또는 환율 15:30 기준시각.
- `retrieved_at`: 대시보드가 값을 받은 시각.
- `data_state`: `final_close`, `intraday`, `unavailable` 중 하나.
- `is_cached`: 동일한 검증 완료값을 캐시에서 재사용했는지 표시한다.

해외시장 휴장일 차이를 감추기 위해 `source_date`를 절대 `market_date`로 덮어쓰지 않는다.

## 홈페이지 표시 규칙

Snowshagal의 Market Close 화면은 다음 우선순위를 고정 규칙으로 사용한다.

| 대상 | 표시값 | 상태·일자 표시 규칙 |
|---|---|---|
| KOSPI·KOSDAQ | `close` | `meta.status=final`, `source_date=market_date`, `data_state=final_close`인 값만 한국시장 종가로 표시한다. `current`를 종가 대신 사용하지 않는다. |
| 글로벌 지수·금리·변동성·원자재·가상자산 | 한국시장 마감 시점에 payload가 보유한 최근 이용 가능 값 | `data_state=final_close`이면 `close`를 **최근 종가**로 표시하고 실제 `source_date`를 함께 보존한다. `data_state=intraday`이면 `current`를 **장중/최근값**으로 표시하며 종가라고 표기하지 않는다. `as_of`를 기준시각 또는 툴팁에 노출한다. |
| 해외 휴장 또는 거래일 불일치 | `source_date` 기준 최근값 | `source_date`가 `market_date`와 다르면 **최근 거래일 종가(YYYY-MM-DD)**처럼 실제 거래일을 명시한다. 한국 날짜로 치환하지 않는다. |
| USD/KRW·JPY/KRW | `close`가 15:30 KST 하나은행 매매기준율 | `current`를 함께 보여줄 경우 **현재 장중값**으로 별도 라벨링한다. 15:30 확정값과 장중값을 혼합하지 않는다. |
| `data_state=unavailable` 또는 값이 `null` | `--` | 이전값을 당일 값처럼 대체하지 않는다. `source_date`/`as_of`가 있으면 데이터 기준정보만 보존한다. |

`as_of`는 값의 기준시각이고 `retrieved_at`은 수집시각이다. 홈페이지는 수집시각이 늦다는 이유로 장중값을 종가로 승격해서는 안 된다.

## 숫자 단위와 formatter 규칙

아래 규칙은 원본 JSON 값에 다시 단위 변환이 중복 적용되는 것을 방지하기 위한 고정 계약이다.

| 필드/패턴 | JSON 원시 단위 | 의미 예시 | 홈페이지 formatter |
|---|---|---|---|
| `krx_investor_trading.unit`, `recent_5d_flows.unit` | `KRW billion` | `-3676` = `-3,676십억원` = `-3.676조원` | 원화 표시는 `value × 1,000,000,000`원으로 환산한 뒤 조/억원 단위로 축약한다. 이미 원 단위인 `*_won`과 혼용하지 않는다. |
| `*_won` | 원(KRW) | `2939900000000` = `2조 9,399억원` | 원시값을 그대로 원으로 간주해 조/억원을 붙인다. 추가로 10억을 곱하지 않는다. |
| `change_pct` | 퍼센트 포인트 값 | `1.25` = `+1.25%`, `-0.4` = `-0.40%` | 100을 곱하지 않고 `%`만 붙인다. 부호와 계약된 소수 자릿수를 적용한다. |
| `*_ratio`, `ratio` 성격 필드 | 0~1 비율 | `0.25` = `25%` | 화면에서만 100을 곱해 `%`로 표시한다. JSON 원시값은 0~1로 유지한다. 단, 거래대금의 `ratio5`는 5일 평균 대비 배수이므로 0~1 제한 비율이 아니다. |
| `close`, `current`, `change`, `open`, `high`, `low`, `previous_close`, `basis` | 항목 고유 단위 | 지수 포인트, 달러, 원, %, bp 등 | 자산별 기존 대시보드 정밀도를 따른다. 계약 수신 단계에서 임의 환산하지 않는다. |
| 수량·순위·종목 수 | 정수 | `rise=600`, `rank=1` | 천 단위 구분기호만 적용하고 단위 변환하지 않는다. |

`change_pct`와 0~1 비율은 모두 화면에서는 `%`를 사용하지만 JSON 의미가 다르다. 전자는 이미 퍼센트 포인트 값이고, 후자는 100을 곱해야 하는 비율이다.

## 계산 규칙

- KRX 시장 투자자 수급과 5거래일 누적: `KRW billion`(십억원), 기존 KRX 메인 화면 정수값 그대로
- 거래대금·프로그램·공매도·시가총액·집중도 금액: 원(`*_won`)
- `change_pct`: 퍼센트 숫자(예: `1.25`는 `+1.25%`)
- `rise_ratio`, `fall_ratio`, 공매도 비중, 집중도: 0~1 비율(예: `0.25`는 `25%`)
- 상승 종목 수: 기존 UI와 같이 상한가를 상승에 한 번만 포함한 `rise_count`
- 하락 종목 수: 하한가를 하락에 한 번만 포함한 `fall_count`
- 공매도 TOP5 정렬은 기존 UI와 동일하다.
  - 거래대금: `short_value_won` 내림차순, ticker 오름차순
  - 비중: `short_value_ratio` 내림차순, `total_value_won` 내림차순, ticker 오름차순

## 운영 명령

수동 생성:

```powershell
.\dist\시장지표 대시보드.exe --export-market-close --market-close-date 2026-08-24
```

이미 존재하는 같은 날짜의 `final`을 운영자가 의도적으로 재생성할 때만 다음 명령을 사용한다.

```powershell
.\dist\시장지표 대시보드.exe --export-market-close --market-close-date 2026-08-24 --force
```

예약 작업에는 `--force`를 절대 넣지 않는다.

자동 작업 등록 또는 갱신:

```powershell
powershell -ExecutionPolicy Bypass -File .\register_market_close_task.ps1
```

등록 결과에는 정시 트리거 10개와 2분 지연된 부팅·로그온 복구 트리거 2개가 포함되어야 한다. Task Scheduler의 **예약된 시작을 놓친 경우 가능한 한 빨리 작업 실행**은 `StartWhenAvailable`로 활성화된다.

Snowshagal 자동 전송 단계에서는 `MarketCloseExporter.export()`가 `final`을 반환한 직후, 또는 `data/market_close/latest.json`을 읽는 별도 uploader를 연결한다. Exporter에는 네트워크 전송 책임을 추가하지 않는다.

## Publish envelope

`POST /api/market/publish` accepts either shape:

- the bare Market Close document, exactly as this contract describes it;
- or an envelope that carries the editorial one-liner alongside it:

```json
{
  "market": { "meta": { ... }, "indices": { ... } },
  "takeaway": { "ko": "…", "en": "…" }
}
```

Only `market` is validated against the schema, and only `market` is stored as
`payload_json`, so the machine-generated document stays exactly as produced. The
one-liner is written by hand, so it lives beside the session on the same row
rather than inside the contract.

Both fields are optional and each is capped at 400 characters. `GET
/api/market/latest` returns them as a top-level `takeaway` object, so a consumer
receives the sentence and the numbers it describes together and can never pair
one date's figures with another date's line. An empty language is left empty:
the homepage hides that row rather than substituting the other language.

### Which language a request may change

A language is written only when the request names it. This keeps the two
publishing paths from fighting over the same row:

| Request | `takeaway_ko` | `takeaway_en` |
| --- | --- | --- |
| bare document (no envelope) | unchanged | unchanged |
| `{ market, takeaway: { ko: "…" } }` | replaced | unchanged |
| `{ market, takeaway: { ko: "", en: "…" } }` | erased | replaced |

The unattended pipeline posts the bare document, so re-running it for a date
that already has an editorial line leaves that line alone. The admin form
names a language only when the editor has actually written in that box for
the date on screen: an untouched box is left out of the request entirely, and
a box the editor emptied is sent as `""` and erases. Surrounding whitespace is
trimmed first, so a line of spaces erases too.

`GET /api/market/latest` tags its response with the market date, the
generated and published timestamps, and the two lines. Republishing the same
document with a new line therefore changes the ETag, and a client holding the
previous tag is served the new body rather than a `304`.

### Where the TODAY one-liner comes from

With a live session the homepage strip resolves the line in this order, per
language:

1. `takeaway_ko` / `takeaway_en` on the D1 row — the manual override typed
   into `/admin/market/`. It exists only when someone chose to write one.
2. The `takeaway` field on that same day's Daily report, in that same
   language. Report publishing reads it out of the report HTML itself (a
   `report-takeaway` meta tag, a `data-report-takeaway` element, or the
   cover's `.cover-hint .cv-one`), so the everyday path needs no typing.
   New Dailies must carry the meta tag — see
   [`docs/DAILY_REPORT_METADATA.md`](../../docs/DAILY_REPORT_METADATA.md) — because
   the cover markup changes with the layout and the head does not.
3. Neither: the row is hidden and the numbers stand alone.

A Daily qualifies only on an exact `reportDate === market_date` match in the
reader's own language. A neighbouring date, the newest Daily, or the other
language never stands in. Only Dailies carry the field at all.

When `/api/market/latest` fails outright, `data/market-summary.js` answers as
one whole record — date, numbers and line together — and no Daily metadata is
mixed into it.

