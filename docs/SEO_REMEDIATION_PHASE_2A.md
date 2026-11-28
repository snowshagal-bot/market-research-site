# Snowshagal SEO Phase 2A 로컬 검증 보고서

2026-11-28 ICT · Preview 배포 승인 대기

기준은 최신 `origin/main`과 실제 Cloudflare Production 배포가 일치한 `4880f9ab07cfd080b4ac8d6124034be93d62c62a`다. Cloudflare 배포 ID는 `a9edd6b4-3358-4c66-92f9-eb801bf88f6a`다. 운영에서 받은 게시 목록과 기준 커밋의 게시 목록이 일치했다. 국문 196편, 영문 187편과 운영 사이트맵 595개를 기준으로 `fix/seo-remediation-phase-2a` 별도 작업트리에서 검증했다. 신규 월간 고정 운영비는 **0달러**다.

## 감사 재검증

Antigravity의 감사 보고서, 개선 계획서, URL 인벤토리와 앵커·HTTP 근거를 최신 게시 목록, Git 원본, 운영 HTTP 응답과 대조했다. 링크 수는 실제 `<a>`의 출현 건수다. 같은 주소를 여러 곳에서 사용한 경우 주소 수와 링크 건수를 구분했다.

| 검증 항목 | 운영 기준 | 로컬 후보 |
| --- | ---: | ---: |
| 활성 리포트 링크의 목적지가 HTTP 404 | 46건 · 20개 주소 | 0건 |
| 구주소의 기존 HTTP 301을 거치는 본문 링크 | 3건 · 2개 주소 | 0건 |
| 영문 본문의 등록된 국문 리포트 링크 | 146건 · 50편 | 명시적 국문판·원문 인용 19건 · 12편 |
| 영문 본문의 국문 허브 링크 | 93건 · 78편 | 0건 |
| `www.snowshagal.com` 링크 | 369건 · 178편 | 0건 |
| 클릭 가능한 사이트 내부 앵커 전체, 각주·공통 링크 포함 | 22,455건 | 22,451건 |
| 페이지 안 각주와 같은 문서로 이동하는 앵커 | 14,417건 | 14,417건 |
| 발행 예정 22편 링크 | 404로 이동하는 4건 | 문구를 표시하는 비활성 링크 4건 |

- **SEO-01.** 감사의 106편에 가까운 조건으로 브랜드 홈과 `www`를 제외하고 등록된 국문 리포트·허브 링크를 센 결과는 105편이다. 실제 판본 변경은 리포트 130건, 허브 93건으로 총 223건이다. 기존 404 주소를 먼저 복구한 뒤 영문판으로 연결한 링크도 포함한다. 국문 `/`를 가리키는 사이트 브랜드 링크 187건은 목적지를 유지했다. 그중 `www` 표기는 대표 도메인으로 정리했다.
- **SEO-02.** 현재 운영 46건·20개 주소에는 감사 이후 생긴 11월 24일 리서치의 누락된 슬러그 2건·1개 주소가 포함된다. 등록 목록에서 찾을 수 없는 본문 주소는 총 49건·22개였으며, 나머지 3건·2개 주소는 운영에서 이미 301이었다. 404 가운데 42건은 본문에 확인된 최종 목적지를 연결했다. 미발행 22편 4건은 제목과 본문을 유지하고 `href`를 제거했다. 게시 목록에 해당 경로가 생기면 원래 링크가 활성화된다.
- **SEO-06.** 번역 짝 2쌍의 양쪽 페이지가 운영에서 200이고 자기 canonical을 제공했으나 hreflang은 없었다. 후보에서 각 문서 기존 canonical과 상호 hreflang, `x-default`, 화면 언어 링크를 검증했다.
- **언어 전환.** 마켓 지표 32종, 투자자별 수급, 공시 전환이 새 언어 홈으로 빠지는 문제를 복구했다. 공시는 날짜와 전체 보기 옵션을 전달한다. 주소의 `.html` 유무에 따라 기존 번역 짝도 홈으로 빠지는 문제가 Chrome에서 추가로 확인돼, clean URL과 Unicode 경로 비교를 바로잡았다. 시장 날짜별 기록·아카이브·업종·캘린더·소개·용어집·카테고리의 기존 경로도 대조했다.

## HTTP 301 매핑

신규 5개 모두 과거 Git 게시 목록에 실린 주소다. 삭제 커밋 직전 파일과 현재 파일의 바이트 및 SHA-256이 일치했다. 기존 3개를 포함해 모든 주소의 확장자 없는 형태와 `.html` 형태로 요청했다. 16개 응답에서 쿼리가 유지됐고 단일 301의 최종 응답은 올바른 언어의 HTTP 200이었다.

| 출발 경로 | 목적 canonical 경로 | 판본과 근거 |
| --- | --- | --- |
| `/reports/2026-09-21_KOSPI_Daily_Report_EN_publish` | `/reports/en/2026-09-21_KOSPI_Daily_Report_EN_publish` | EN, `2213a3f^` |
| `/reports/2026-10-03_Korea_Weekly_Report_EN` | `/reports/en/2026-10-03_Korea_Weekly_Report_EN` | EN, `e231056^` |
| `/reports/en/2026-10-29_Snowshagal_Daily` | `/reports/2026-10-29_Snowshagal_Daily` | KO, `0f5fb0d^` |
| `/reports/리서치_NO.11_중국D램은정말따라왔나_2026.10.26_커버통합` | `/reports/20261026_Research_NO11_China_DRAM_Catch_Up_Cover` | KO, `0df1299^` |
| `/reports/20261116_Snowshagal_Investment_Insight_No36_Korea_AI_Exposure_EN` | `/reports/en/20261116_Snowshagal_Investment_Insight_No36_Korea_AI_Exposure_EN` | EN, `ea43b32^` |
| `/reports/시장을읽는말들_13편_증시대기자금은어디로갔나` | `/reports/basics-13-deposits` | KO, 기존 |
| `/reports/시장을읽는말들_14편_자회사가상장하면모회사주주는손해일까` | `/reports/basics-14-subsidiary-ipo` | KO, 기존 |
| `/reports/en/2026-11-12_Snowshagal_Daily` | `/reports/2026-11-12_Snowshagal_Daily` | KO, Phase 1 Git 원본 확인 |

10월 29일 `/reports/en/2026-10-29_Snowshagal_Daily_EN`은 현재 영문 canonical로 운영 HTTP 200이다. 감사가 제안한 영문 목적 경로와 다르며 새 매핑을 추가하지 않았다. 11월 12일 구주소 역시 Git 원본은 국문이므로 Phase 1 목적지를 사용한다.

시장 입문 15·16편을 포함한 본문 오류 경로 19개는 링크 제목, 시리즈 회차, 문맥 및 게시된 원문으로 목적지를 확인했다. 과거 공개 주소로서의 원본이 확인되지 않아 응답에서 본문 링크만 고쳤다. 8월 28일 `/reports/en/2026-08-28_KOSPI_Daily_Report_EN_Benchmark`, 8월 20일 `/reports/8월 20일 주식리포트_커버통합 (1)`, 7월 31일 `/reports/7월 31일 주식리포트`는 원본 동일성 근거가 없어 404를 유지했다.

## 복구한 번역 그룹

| `translationGroup` | KO ID | EN ID | 동일 판본 근거 |
| --- | --- | --- | --- |
| `2026-11-24-research-1ylfgyu` | `2026-11-24-research-1ylfgyu` | `2026-11-24-research-at00qm` | 리서치 16편. CPCA 승용차 약 800만 대와 +74%, 12월 1일 EU 정책, 두 판의 자동차·철강·화학 섹션과 관세 표 수치가 대응 |
| `2026-08-03-daily-181n1pj` | `2026-08-03-daily-181n1pj` | `2026-08-03-daily-ely1wy` | 코스피 6,257.45, 시가 6,358.27, 고가 6,393.00, 저가 6,223.29, 동일한 지수·종목 방향 및 수급 전개 |

게시 시스템의 번역 짝 태그 규칙에 따라 8월 3일 영문판의 태그 순서와 목록을 기존 국문판의 `semiconductors`, `flows`에 맞췄다. 검색 인덱스의 같은 항목도 동기화했다. 리포트 발행·수정 시각은 기준과 동일하다.

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `functions/_middleware.js`, `functions/_report-links.js` | 기존 사이트 응답 레이어에서 앵커를 처리. Cloudflare HTMLRewriter와 Node 문자열 경로에서 같은 목적지 결정 로직 사용 |
| `functions/_report-link-targets.js`, `functions/_report-link-localizations.js` | Git 원본 확인 구주소, 본문 오타 목적지, 출처 글과 저장 리비전별로 검토한 영문 치환 목록 |
| `assets/locale.js`, `assets/disclosures.js` | 마켓·공시 경로, 공시 필터 및 탐색 상태, clean URL과 Unicode 인코딩 처리 |
| `data/posts.json`, `data/posts.js`, `data/search-index.json`, `data/search-index-meta.js` | 두 그룹과 8월 3일 태그 동기화 |
| `scripts/audit-seo.mjs`, `functions/api/publish.js`, `assets/admin.js` | 실제 응답의 끊긴 리포트 링크 확인. 구주소·국문판 의도·예정 글·번역 후보 경고. 발행 응답과 관리자 완료 화면에서 안내 |
| `tests/phase-2a-report-links.test.mjs`, `tests/audit-seo.test.mjs`, `tests/publish.test.mjs` | 판본 선택, 쿼리·앵커·Unicode·상대 주소, 게시 예정 링크, 발행 알림 및 실패 조건 회귀 검증 |
| 공개 및 관리자 HTML, `scripts/build-category-pages.mjs` | 변경된 JS 파일의 기존 방식 콘텐츠 해시 갱신 |

영문 치환은 검토한 게시물과 목적 URL에만 적용했다. 이미 지정된 국문판과 원문 인용, 외부 출처, 문서 내 앵커를 보존했다. 리포트 간 쿼리와 조각 식별자는 URL 수리 때도 유지한다. 판본을 바꿀 때는 상대 판본에 같은 의미의 쿼리나 앵커가 있어야 한다. 검토된 영문 치환 223건에는 이 조건을 추정해야 하는 사례가 없었다. 발행 예정 링크는 작성 시 `data-report-pending`을 표시할 수 있다. 일자·카테고리만 같은 번역 후보는 경고를 보내고 자동 연결을 생성하지 않는다.

## 회귀 검증

- **Verification Gate 1,727/1,727.** 135개 스위트, JS/MJS 문법 파일 284개, 저장소 정합성, SEO 검사 모두 통과. SEO 하드 오류 0건. 권고 229건은 기존 제목 길이 138건, 설명 길이 87건, 22편 예정 링크 4건이다. 기존 발행 모의 테스트와 깨진 링크가 있어도 발행 커밋과 검토 경고가 함께 돌아오는 신규 테스트를 통과했다.
- **Workerd.** Miniflare 로컬 런타임으로 변경 전후 각각 공개 리포트 383편 HTTP 200을 확인했다. 원본 파일과 렌더링된 H1, CSS, 리포트 인라인 스크립트를 비교했고, 앵커의 텍스트와 링크 외 속성을 보존했다. 바뀐 639개 앵커의 최종 목적지, URL 쿼리와 조각 식별자를 대조했다. 검토 범위에서 언어 오치환 0건이다.
- **사이트맵.** 운영에서 받은 시장 세션 60일, 지표 가용 항목과 수정일을 동일한 입력으로 재현했다. 운영·기준 코드·후보 코드 모두 595개였고 URL 추가·누락·중복과 `lastmod` 차이는 0개다. 새로 연결한 4개 리포트의 hreflang 항목만 달라졌다. 로컬 코드 및 Workerd의 리포트 검증에서 canonical, hreflang, noindex 회귀 0건이다.
- **Chrome 157.** 너비 320·360·390·430·1366px에서 70개 페이지 상태를 확인했다. 국문·영문 리포트의 표지와 본문, 그림·차트, ETF 시뮬레이터 값·차트 변경과 초기화, 용어 툴팁, 각주 이동, Shadow DOM 메뉴를 확인했다. 리서치 양쪽 언어 버튼을 클릭해 실제 페이지 이동도 확인했다. 로컬 데이터로 수급·코스닥, 공시의 양방향 주소와 필터 상태를 확인했다. 320px 영문 투자자별 수급 페이지는 기준과 후보 모두 레이아웃 너비가 337px인 기존 가로 넘침이 있다. 이번 범위의 스타일 수정은 0건이다.
- **변경 범위.** 원본 `reports/*.html`, Phase 1 사이트맵·lastmod·캐시 코드, 색인 정책, Cloudflare 설정, 스키마의 변경은 0건이다. 로컬 후보의 검증 데이터와 브라우저는 운영 DB에 쓰지 않았다.

상세 증거는 작업트리와 같은 상위 폴더의 `seo-phase-2a-2026-11-28/evidence`에 있다. `production-http-before.json`, `production-targets.json`, `legacy-git-evidence.json`은 운영 및 Git 대조다. `all-internal-before.csv`, `all-internal-after.csv`, `anchor-deltas.json`, `language-deltas.json`은 전수 링크 목록과 차이다. `native-after.json`, `sitemap-comparison.json`, `verification-gate.log`, `browser.json`, `screenshots/`에 실행 결과를 보존했다.

## 남은 확인과 배포 절차

1. **Preview 승인 후.** 최신 `origin/main`과 게시 목록을 다시 대조하고, 새 리포트가 생기면 현재 등록 목록과 충돌 없이 후보에 반영한 뒤 Gate와 링크 검사를 재실행한다. Cloudflare Pages의 해당 브랜치 배포 대상, `COMMENTS_DB`와 `AUTH_DB`의 Preview 분리, Preview `noindex`를 확인하고 고정 Preview URL과 실제 배포 SHA를 기록한다. 5개 신규 301, Phase 1 구주소, 번역 짝 2쌍의 상호 연결, 신규 깨진 링크, 공시 필터와 모바일 전환을 실제 Preview HTTP와 브라우저로 검증한다. Preview 시장 데이터가 운영과 다른 경우 사이트맵은 같은 데이터셋에서 비교한다.
2. **별도 운영 승인 후.** Phase 2A 커밋을 최신 `main`의 게시 이력을 보존해 반영한다. 실제 Cloudflare Production 배포 SHA 및 Smoke 성공을 확인하고 운영 사이트맵, 최신 리포트, 301 목적지와 언어, 상호 hreflang, noindex, 기존 `X-Sitemap-Source`를 재확인한다. 외부 색인 요청이나 운영 데이터 장애 주입은 이 절차의 범위 밖이다.
3. **롤백.** 문제가 생기면 최신 `main` 위에서 Phase 2A 변경만 되돌리는 커밋을 만들어 배포한다. 이후 게시나 교정이 있으면 충돌 시 해당 변경을 보존하고, 두 번역 그룹·한 항목의 태그 및 검색 데이터와 링크 보정만 기준 상태로 복원한다. Gate와 Smoke를 다시 실행한다. 과거 전체 SHA로 브랜치를 되감으면 이후 게시물도 사라질 수 있다.

Cloudflare 호스트의 실제 Phase 2A Preview 응답, 배포 후 운영 트래픽과 색인 변화는 아직 검증 대상이다. 이번 단계는 로컬 검증으로 마쳤으며 원격 푸시, 병합, Preview 및 운영 배포는 실행하지 않았다.
