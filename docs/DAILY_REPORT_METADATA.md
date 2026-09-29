# Daily 리포트 head 메타데이터

Daily 리포트 HTML은 `reports/`에 그대로 올라가는 독립형 문서다. 홈페이지 TODAY 스트립의 "오늘의 한 줄"은 그 문서가 스스로 알려줄 때만 표시된다.

게시기(`assets/admin.js`의 `readTakeaway`)는 일곱 곳을 이 순서로 본다.

| 순위 | 위치 | 용도 |
| --- | --- | --- |
| 1 | `meta[name="report-takeaway"]` | **장기 표준** |
| 2 | `[data-report-takeaway]` | 임의 요소 표시 |
| 3 | `.dcv-one .oc` | 2026-09-09부터의 Daily 커버. `<br>`은 공백으로 읽는다 |
| 4 | `.dcv-one .dcv-ol` | 2026-09-01~09-04의 Daily 커버. 줄마다 `<i>`(display:block)이며 공백으로 이어 읽는다 |
| 5 | `.cv-line` | Editorial Ledger v2 커버의 전용 필드 |
| 6 | `.cover-hint .cv-one` | 2026-08-26까지의 커버 |
| 7 | `.cover-oneline` | 그 이전 커버 |

일곱 곳 어디에도 없으면 한 줄은 없다. 게시기는 `TODAY 한 줄 감지 없음`을 표시하지만 **게시 자체를 막지는 않는다.**

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

- `TODAY 한 줄 자동 감지 · "…" · 출처` — 그대로 게시하면 홈 TODAY에 자동 연동된다. 출처는 위 표의 위치(예: `표지 .dcv-one .oc`, `report-takeaway 메타`)다.
- `TODAY 한 줄 감지 없음 · 홈페이지에서는 한 줄이 숨겨집니다.` — 의도한 것이 아니라면 게시 전에 커버 필드나 meta 태그를 확인한다.

게시 화면의 한 줄은 **읽기 전용**이다. 이미 게시된 Daily의 한 줄은 `/admin/manage/`의 `TODAY 한 줄` 필드에서 고친다.

## 설명(description)과 요약(summary)

세 필드는 서로 다른 값이다. 게시기는 리포트가 그 필드라고 표시한 곳만 읽고, 본문에서 추론하지 않는다. 게시 화면은 각 필드 아래에 어디서 읽었는지를 표시하며, 설명과 요약은 게시 전에 고칠 수 있다.

**description** — 검색·공유용으로 편집자가 쓴 고유 설명, 또는 빈칸.

- 리포트의 `<meta name="description">`만 읽는다.
- 게시기가 예전에 스스로 채우던 카테고리 기본 문장(`assets/report-metadata.js`의 12개, 과거 문구 포함)과 공백을 정리한 뒤 **정확히** 같으면 버린다. 부분 일치나 비슷한 문장은 편집자의 것으로 보고 그대로 둔다.
- 카테고리나 언어를 바꿔도 설명은 채워지거나 바뀌지 않는다.
- 서버도 같은 목록으로 막는다. `/api/publish`는 기본 문장을 빈 값으로 저장하고, `/api/manage`는 게시물에 이미 있던 기본 문장을 그대로 두는 저장만 허용한다(과거 글은 별도 보정 작업에서 정리한다).
- 빈 설명은 `description: ""`로 저장한다.

**summary** — 독자에게 글의 핵심을 알려주는 짧은 편집 요약. 이 순서로 읽는다.

1. `meta[name="report-summary"]`
2. `[data-report-summary]` (속성 값, 없으면 요소의 글)
3. Daily만: `section.hero` 안의 `.quote` (`div.quote`, `p.quote` 모두). 다른 리포트의 `.quote`는 인용문이며 hero 안에 있지도 않다.
4. `.opener .stand`, `.cover-summary`, `.cover-description`
5. 없으면 빈칸

`.cover-oneline`은 옛 커버의 한 줄(takeaway)이므로 요약으로 읽지 않는다.

**장기 표준** — 커버 class는 레이아웃과 함께 바뀐다(2026-09에만 두 번 바뀌었다). 생성기는 head에 `report-summary`, `report-takeaway`, `description`을 명시하는 것이 기준이고, 커버 class는 fallback이다.

## 홈페이지에서의 사용

저장된 값은 post metadata의 `takeaway`가 되고, 홈 TODAY는 locale별로 이 순서로 해석한다:

1. D1의 `takeaway_ko` / `takeaway_en` — `/admin/market/`의 수동 Override
2. 같은 `market_date` · 같은 locale의 Daily `takeaway`
3. 둘 다 없으면 행 숨김

날짜와 언어가 정확히 일치할 때만 쓴다. 자세한 내용은 [`contracts/market_close/MARKET_DATA_CONTRACT.md`](../contracts/market_close/MARKET_DATA_CONTRACT.md).
