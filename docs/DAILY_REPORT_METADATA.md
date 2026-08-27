# Daily 리포트 head 메타데이터

Daily 리포트 HTML은 `reports/`에 그대로 올라가는 독립형 문서다. 홈페이지가 그 문서에서 무언가를 읽어야 한다면, 레이아웃이 바뀌어도 살아남는 자리에 있어야 한다.

## `report-takeaway`

홈페이지 TODAY 스트립의 "오늘의 한 줄"은 Daily 리포트가 스스로 알려줄 때만 표시된다. **모든 신규 Daily HTML의 `<head>`에 이 태그를 생성한다.**

```html
<meta name="report-takeaway" content="지수는 되돌렸지만 거래대금은 따라오지 않았다.">
```

규칙:

- 값은 **해당 리포트에서 편집자가 정한 오늘의 한 줄**이다.
- 제목을 자동 대체하지 않는다.
- `description` / `summary` / 본문 첫 문장을 자동 대체하지 않는다.
- 최대 400자. 넘으면 자른다.
- 공백을 normalize한다 — 연속 공백·줄바꿈은 한 칸으로, 앞뒤 공백은 제거, zero-width 문자(`U+200B`–`U+200D`, `U+FEFF`)는 삭제.
- 커버 요소에서 값을 가져올 때는 `<br>`을 **먼저 공백으로 바꾼다.** 신규 v2 레이아웃의 `.cv-line`은 `Nearly reached it,<br/>but never broke through`처럼 줄바꿈 태그를 쓰는데, 태그만 제거하면 `it,but`으로 붙는다.
- **값이 없으면 meta 자체를 만들지 않는다.** 홈페이지는 그 행을 숨기며, 그것이 의도된 결과다.

`"`, `<`, `>`, `&`는 속성 안에서 이스케이프한다.

### 왜 커버 마크업이 아니라 head인가

2026-08-26까지의 Daily는 커버의 `.cover-hint .cv-one`에 한 줄을 담고 있었고, 게시기가 그걸 읽었다. 커버 레이아웃이 바뀌면 그 경로는 조용히 끊긴다 — 실제로 2026-08-27 신규 레이아웃(`Editorial Ledger v2`)에서 끊겼다. v2 커버는 같은 문장을 `ONE LINE TODAY` 라벨과 함께 `.cv-line`에 담고 있지만, 클래스 이름이 다르다는 이유만으로 검출이 0이 된다.

선택자를 하나 더 늘리는 대신 head에 태그를 둔다. 다음 레이아웃에서 또 이름이 바뀌어도 같은 일이 반복되지 않는다.

`<head>`의 메타 태그는 레이아웃과 무관하다. 게시기의 검출 우선순위에서도 이 태그가 **최우선**이므로, 태그가 있으면 커버가 어떻게 바뀌든 동작한다.

### 검출 우선순위 (`assets/admin.js` `detectTakeaway`)

1. `meta[name="report-takeaway"]` ← **신규 Daily는 여기**
2. `[data-report-takeaway]` (속성값, 없으면 요소 텍스트)
3. `.cover-hint .cv-one` ← 기존 Daily 하위호환. 제거하지 않는다.
4. `.cover-oneline`

넷 중 어디에도 없으면 한 줄은 없다. 게시기는 `TODAY 한 줄 감지 없음`을 표시하지만 게시 자체를 막지는 않는다.

Daily가 아닌 카테고리(Weekly / Research / Basics / Note)에는 이 태그를 만들지 않는다. 만들어도 저장되지 않는다.

## 이미 만들어진 파일에 넣기

생성 경로에서 빠졌거나 과거 파일을 보완할 때는:

```bash
node scripts/stamp-daily-takeaway.mjs "reports/8월 27일 주식리포트_커버통합.html" "지수는 되돌렸지만 거래대금은 따라오지 않았다."
```

현재 값 확인:

```bash
node scripts/stamp-daily-takeaway.mjs "reports/8월 27일 주식리포트_커버통합.html" --check
```

이 스크립트는 위 규칙을 그대로 적용하고, 태그 하나 외에는 문서를 건드리지 않는다. 이미 태그가 있으면 중복 추가 대신 교체하며, 파일의 줄바꿈 관례(CRLF/LF)를 유지한다. 빈 문구로는 태그를 만들지 않는다.

## 게시 전 확인

`/admin/`에서 HTML을 선택하면 홈페이지 요약 아래에 다음 중 하나가 표시된다:

- `TODAY 한 줄 자동 감지 · "…"` — 그대로 게시하면 홈 TODAY에 자동 연동된다.
- `TODAY 한 줄 감지 없음 · 홈페이지에서는 한 줄이 숨겨집니다.` — 의도한 것이 아니라면 게시 전에 태그를 넣는다.

## 홈페이지에서의 사용

저장된 값은 post metadata의 `takeaway`가 되고, 홈 TODAY는 locale별로 이 순서로 해석한다:

1. D1의 `takeaway_ko` / `takeaway_en` — `/admin/market/`의 수동 Override
2. 같은 `market_date` · 같은 locale의 Daily `takeaway`
3. 둘 다 없으면 행 숨김

날짜와 언어가 정확히 일치할 때만 쓴다. 자세한 내용은 [`contracts/market_close/MARKET_DATA_CONTRACT.md`](../contracts/market_close/MARKET_DATA_CONTRACT.md).
