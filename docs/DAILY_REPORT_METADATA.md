# Daily 리포트 head 메타데이터

Daily 리포트 HTML은 `reports/`에 그대로 올라가는 독립형 문서다. 홈페이지 TODAY 스트립의 "오늘의 한 줄"은 그 문서가 스스로 알려줄 때만 표시된다.

게시기(`assets/admin.js`의 `detectTakeaway`)는 다섯 곳을 이 순서로 본다.

| 순위 | 위치 | 용도 |
| --- | --- | --- |
| 1 | `meta[name="report-takeaway"]` | **장기 표준** |
| 2 | `[data-report-takeaway]` | 임의 요소 표시 |
| 3 | `.cv-line` | Editorial Ledger v2 커버의 전용 필드 |
| 4 | `.cover-hint .cv-one` | 2026-08-26까지의 커버 |
| 5 | `.cover-oneline` | 그 이전 커버 |

다섯 곳 어디에도 없으면 한 줄은 없다. 게시기는 `TODAY 한 줄 감지 없음`을 표시하지만 **게시 자체를 막지는 않는다.**

제목 / `description` / `summary` / 본문 첫 문장은 **어떤 경우에도 대체 사용하지 않는다.** 편집자가 쓰지 않은 문장을 홈페이지에 올리는 것보다, 그 행을 비워두는 편이 낫다.

Daily가 아닌 카테고리(Weekly / Research / Basics / Note)에는 한 줄을 만들지 않는다. 커버에 같은 마크업이 있어도 전송되지 않는다.

## Editorial Ledger v2 — `.cv-line`

2026-08-27부터의 커버는 한 줄에 자기 필드를 준다. 바로 위 `ONE LINE TODAY` 라벨과 짝을 이루므로 스타일 클래스가 아니라 명시적인 takeaway 필드다.

```html
<div class="cv-line-label">ONE LINE TODAY</div>
<p class="cv-line">Nearly reached it,<br/>but never broke through</p>
```

게시기가 이 필드를 직접 읽으므로, **v2 레이아웃으로 만든 Daily는 아무 추가 작업 없이 그대로 게시하면 된다.**

### `<br>` 처리

v2는 한 줄을 두 행으로 나눠 보여주려고 `<br>`을 쓴다. `textContent`를 그냥 읽으면 `it,but`처럼 단어가 붙는다. 게시기는 요소를 복제한 뒤 복제본의 `br`을 공백으로 바꾸고 읽는다 — 원본 문서는 건드리지 않는다. 결과는:

```
Nearly reached it, but never broke through
```

이후 공통 normalize가 적용된다: 연속 공백·줄바꿈은 한 칸으로, 앞뒤 공백 제거, zero-width 문자(`U+200B`–`U+200D`, `U+FEFF`) 삭제, 400자 상한.

## `report-takeaway` — 장기 표준

```html
<meta name="report-takeaway" content="지수는 되돌렸지만 거래대금은 따라오지 않았다.">
```

**신규 Daily 생성기는 가능하면 이 태그를 함께 생성하는 것이 장기 표준이다.** 커버 클래스는 레이아웃이 바뀌면 함께 바뀐다 — 실제로 `.cover-hint .cv-one`이 v2에서 `.cv-line`이 되면서 검출이 한 번 끊겼다. head의 메타 태그는 레이아웃과 무관하고 우선순위도 1위이므로, 태그가 있으면 **앞으로 또 커버가 바뀌어도 클래스 변경에 영향받지 않는다.**

값의 규칙:

- 값은 해당 리포트에서 편집자가 정한 오늘의 한 줄이다. v2라면 `.cv-line`과 같은 문장을 쓰면 된다.
- 최대 400자, 공백 normalize, 커버에서 가져올 때는 `<br>`을 먼저 공백으로 바꾼다.
- **값이 없으면 meta 자체를 만들지 않는다.**
- `"`, `<`, `>`, `&`는 속성 안에서 이스케이프한다.

## `scripts/stamp-daily-takeaway.mjs` — 긴급 보완용

**이 스크립트는 일상 발행 절차가 아니다.** 평소에는 v2 커버의 `.cv-line`이나 생성기가 만든 meta 태그로 자동 처리된다.

쓰는 경우는 두 가지뿐이다 — 생성기가 태그를 만들지 못한 **긴급 보완**, 그리고 마커가 없는 **과거 파일 보정**.

```bash
node scripts/stamp-daily-takeaway.mjs "reports/8월 27일 주식리포트_커버통합.html" "오늘의 한 줄"
node scripts/stamp-daily-takeaway.mjs "reports/8월 27일 주식리포트_커버통합.html" --check
```

태그 하나 외에는 문서를 건드리지 않는다. 이미 있으면 중복 추가 대신 교체하고, 파일의 줄바꿈 관례(CRLF/LF)를 유지하며, 빈 문구로는 만들지 않는다.

## 게시 전 확인

`/admin/`에서 HTML을 선택하면 홈페이지 요약 아래에 다음 중 하나가 표시된다:

- `TODAY 한 줄 자동 감지 · "…"` — 그대로 게시하면 홈 TODAY에 자동 연동된다.
- `TODAY 한 줄 감지 없음 · 홈페이지에서는 한 줄이 숨겨집니다.` — 의도한 것이 아니라면 게시 전에 커버 필드나 meta 태그를 확인한다.

## 홈페이지에서의 사용

저장된 값은 post metadata의 `takeaway`가 되고, 홈 TODAY는 locale별로 이 순서로 해석한다:

1. D1의 `takeaway_ko` / `takeaway_en` — `/admin/market/`의 수동 Override
2. 같은 `market_date` · 같은 locale의 Daily `takeaway`
3. 둘 다 없으면 행 숨김

날짜와 언어가 정확히 일치할 때만 쓴다. 자세한 내용은 [`contracts/market_close/MARKET_DATA_CONTRACT.md`](../contracts/market_close/MARKET_DATA_CONTRACT.md).
