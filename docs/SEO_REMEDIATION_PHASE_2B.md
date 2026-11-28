# Snowshagal SEO Phase 2B

2026-11-28 ICT. 로컬 구현과 검증을 완료했다. Preview 배포는 승인 대기 중이다.

- 작업트리 `market-research-seo-remediation-phase-2b` · 브랜치 `fix/seo-remediation-phase-2b`
- 기준 `origin/main` 및 Cloudflare Pages Production SHA `ced50a72b8c6f15fdaa4de1a14580613fa3bc9a9`. Pages API에서 Production 배포 `bf5a9a14-404b-473a-969b-8940f936d884` 성공을 확인했다.
- 기준 리포트 383편과 운영 사이트맵 595개. 다른 작업트리의 미커밋 Phase 2A 문서를 보존했다. 운영은 읽기 전용 HTTP 및 Analytics 조회로 확인했다.
- Workers Free와 기존 D1·Cache API·Pages 구성을 사용한다. 신규 월간 고정 운영비 **$0**.

## 확인한 병목

| 경로 | 확인한 원인 | 로컬 변경 |
|---|---|---|
| 리포트 언어 전환·관련 글 | 언어 전환이 `?langswitch=Date.now()` 및 `no-store`로 전체 목록을 받고, 관련 글이 같은 데이터에 별도 요청과 JSON 파싱을 수행 | 서버가 확인한 번역 주소를 리포트 셸에 전달. 관련 글과 서버 정보가 없을 때의 언어 전환은 동일한 목록 Promise 사용 |
| 목록이 없는 페이지 | 소개·용어집·공시·일정, 시장 상세, 관리자 공지·블로그도 430KB 목록 스크립트를 초기 로딩 | 국·영문 정적 페이지 8개와 관리자 2개, 서버 렌더링 시장 상세 셸에서 제거. 검색 인덱스 실패 시 공개 검색창에서 필요한 시점에만 목록을 가져옴 |
| 공개 검색·목록 캐시 | 운영이 ETag와 조건부 304를 지원해도 `no-store`로 인해 브라우저가 재방문에 기존 응답을 재사용할 수 없음 | 공개 목록 2개와 검색 메타 및 본문 3개에 개별 재검증 정책 적용 |
| 리포트 Worker | head 메타를 사전 생성하고 재생성하며 같은 번역 그룹을 여러 번 조회. 작은 인라인 이미지도 base64 정규식을 통과하고, 모든 이미지 콜백이 비동기 | 번역 상대를 한 번 찾아 head·footer·브라우저 셸에서 사용. head 대체 메타는 실패 시 계산. 작은 이미지 조기 종료, 실제로 이동하는 이미지에만 비동기 콜백, 동일 SHA-256 앞 16자리 유지 |
| Worker의 목록 로딩 | 리포트 자체는 목록을 요청당 한 번 파싱. 홈·카테고리는 태그 요청만 실패해도 성공한 목록을 재조회할 수 있었음. 링크 리라이터의 경로 인덱스는 필요 시 요청당 한 번 구축 | 태그 오류 시 성공한 목록 재사용. 고객별 또는 인스턴스별 교정 지연이 생기는 서버 전역 메모이제이션을 도입할 근거는 확보되지 않음 |

홈·카테고리·마켓 TODAY 및 게시 도구의 목록은 현재 기능에서 사용한다. 게시·교정 직후 새 커밋과 파일을 기다리는 관리자 폴링은 일반 리포트 열람과 목적이 달라 기존 강제 새 조회를 유지했다. 분리 검색은 기존처럼 검색창을 열 때 메타를, 검색어를 입력할 때 해당 언어의 본문만 받는다. 게시·교정이 갱신하는 전체 검색 인덱스는 GitHub 저장용이며 공개 리포트 Worker에서 읽지 않는다.

SEO-05의 중복 요청은 재현했다. SEO-10의 4.5초는 `http_manifest.json` 55번의 단일 `elapsedMs` 값이다. 해당 관측만으로 첫 바이트, CPU, 전송 완료 중 어느 구간에서 지연이 생겼는지 확정할 수 없다. 인라인 폰트와 리포트 원본 수정, 리포트 전체 Edge Cache는 이번 변경 범위 밖이다. [감사 보고서](../../outputs/seo-forensic-audit-2026-11-27/seo_forensic_audit.md) · [감사 개선 계획](../../outputs/seo-forensic-audit-2026-11-27/seo_remediation_plan.md) · [Phase 2A 운영 보고서](../../market-research-seo-remediation-phase-2a/docs/SEO_REMEDIATION_PHASE_2A_PRODUCTION.md)

## CPU 356건과 단위

| 2026-11-28 ICT 시간대 | CPU 한도 초과 |
|---|---:|
| 05:00–05:59 | 49 |
| 06:00–06:59 | 120 |
| 07:00–07:59 | 184 |
| 08:00–08:59 | 3 |

기존 Functions 대시보드의 356 CPU 초과 및 0 메모리 초과를 확인했다. 이 계정의 Pages Analytics GraphQL에서도 같은 시간당 수치가 `exceededResources`로 집계됐다. Phase 1 배포는 약 04:05, 해당 배포의 GitHub Smoke와 Gate는 04:07 이전, 확인된 595 URL 점검 증거 파일의 마지막 저장은 04:16:46이었다. 읽기 전용 GitHub 이력의 05:00–09:00 구간에는 새 `main` 실행이 없었다. Antigravity의 SEO-10 표본은 전일 요청이며 Phase 2A 운영 배포는 14:58이었다. 확인된 이 시간대는 겹치지 않는다. 요청 URL·User-Agent·Ray ID가 없는 과거 집계이므로 별도의 자동화나 일반 방문이 356건 중 몇 건인지는 미확인이다. [Cloudflare 과거 집계](../../seo-phase-2b-2026-11-28/evidence/metrics-history.json) · [GitHub 실행 이력](../../seo-phase-2b-2026-11-28/evidence/read-only-ci-history.json)

계정의 공식 GraphQL 스키마에서 Pages CPU 차트 원시 분위수는 **µs**로 확인했다. 기존 대시보드 캡처의 20,185 / 81,611은 20.185ms / 81.611ms에 해당한다. Wrangler Tail의 `cpuTime`과 `wallTime`은 **ms**다. 기존 Phase 2A 운영 Tail에는 목록 10ms, 대형 국문 리포트 32ms, 사이트맵 71ms 등의 개별 CPU 관측이 있다. TTFB는 클라이언트의 첫 바이트까지 걸린 시간이며, 전체 응답 시간은 본문 수신까지 포함한다. Tail의 벽시계 시간은 별도 지표다. [계정 스키마 증거](../../seo-phase-2b-2026-11-28/evidence/analytics-schema.json) · [Cloudflare Pages 지표](https://developers.cloudflare.com/pages/functions/metrics/) · [Cloudflare 런타임의 Tail 단위](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/trace.c%2B%2B) · [기존 Tail](../../seo-phase-2a-2026-11-28/evidence/production/deployment-probe-tail.json)

## 브라우저 요청과 전송량

동일 PC의 Chrome과 로컬 SQLite 데이터에서 모바일 390px·CPU 4배 제한, 데스크탑 1366px로 각 경로의 첫 방문과 재방문을 측정했다. 총 120회다. 표에는 모바일의 실제 로컬 HTTP 요청 수와 본문을 합산했다. 괄호 안은 gzip을 포함한 전송량이며, 단위는 KiB다. 캐시가 응답한 리소스의 본문과 HTTP 헤더는 전송량에 포함하지 않았다. 외부 요청은 양쪽에서 차단했고, 로컬에서 연결하지 않은 댓글·일정 API와 빈 금리·증시자금 데이터의 404는 양쪽 원자료에 남겼다.

| 표본 | 첫 방문 요청 전 → 후 | 첫 방문 압축 전 (전송) 전 → 후 | 재방문 요청 전 → 후 | 재방문 전송 전 → 후 |
|---|---:|---:|---:|---:|
| 일반 국문 리포트 | 10 → 9 | 1,261.1 (386.1) → 840.9 (297.9) | 5 → 4 | 316.7 → 140.2 |
| 일반 영문 리포트 | 10 → 9 | 1,264.0 (386.4) → 843.7 (298.2) | 5 → 4 | 317.1 → 140.6 |
| 대형 국문 리포트 | 10 → 9 | 1,386.0 (384.6) → 965.8 (296.4) | 5 → 4 | 315.2 → 138.8 |
| 대형 영문 리포트 | 10 → 9 | 1,390.4 (384.4) → 970.2 (296.1) | 5 → 4 | 315.0 → 138.5 |
| 홈 | 23 → 23 | 933.2 (408.6) → 933.2 (408.6) | 5 → 5 | 101.9 → 13.6 |
| 영문 리서치 카테고리 | 19 → 19 | 834.2 (329.6) → 834.3 (329.7) | 4 → 4 | 97.4 → 9.1 |
| 마켓 TODAY | 20 → 20 | 909.6 (237.9) → 909.7 (237.9) | 3 → 3 | 100.3 → 12.0 |
| 영문 마켓 아카이브 | 13 → 12 | 721.8 (192.5) → 301.5 (104.3) | 2 → 1 | 88.3 → 0.0 |
| 영문 용어집 | 12 → 11 | 622.8 (173.9) → 202.5 (85.6) | 3 → 2 | 93.0 → 4.8 |
| 공시 | 15 → 14 | 695.1 (189.6) → 274.8 (101.3) | 4 → 3 | 94.7 → 6.4 |
| 영문 일정 | 16 → 15 | 730.2 (197.1) → 309.9 (108.8) | 4 → 3 | 94.1 → 5.8 |
| 소개 | 12 → 11 | 626.1 (175.2) → 205.8 (87.0) | 3 → 2 | 94.4 → 6.1 |
| 관리자 게시물 관리 | 11 → 11 | 525.3 (121.0) → 525.7 (121.1) | 10 → 10 | 116.4 → 116.6 |
| 관리자 공지 | 11 → 10 | 588.5 (141.3) → 168.2 (53.1) | 10 → 9 | 136.8 → 48.5 |
| 관리자 장마감 블로그 | 12 → 11 | 592.0 (143.1) → 171.7 (54.8) | 11 → 10 | 138.5 → 50.3 |

리포트의 `posts.json`은 2→1회, 목록을 쓰지 않는 표본의 `posts.js`는 1→0회였다. 홈·카테고리·마켓 TODAY는 동일 파일을 한 번 요청하며, 로컬 재방문에는 304로 바뀌었다. 영문 검색 반복에서 메타·본문 요청은 각각 한 번 유지했고, 합계 6,429,854B 원본 / 2,172,152B gzip의 재전송이 두 건의 304로 바뀌었다. 검색 메타에만 503을 주는 격리된 픽스처에서 503 뒤 `posts.js` 200과 검색 결과 복구를 확인했다.

모바일 첫 방문 LCP는 일반 KO 932→908ms, 대형 EN 624→568ms, 마켓 TODAY 732→852ms였다. CLS는 표본에서 0이었다. 브라우저 Long Task 관측으로 계산한 차단 시간은 일반 KO 822→866ms, 대형 EN 87→90ms, 마켓 TODAY 564→511ms였다. 이는 탐색 완료 후 450ms까지의 제한된 관측이다. 각 페이지·조건의 단일 관측값이라 전체 LCP·TBT 개선 여부는 판단할 수 없다. 요청 수와 본문 바이트는 데스크탑에서도 같은 방향이었다.

360px와 1366px에서 국·영문 시뮬레이터의 차트 변경·초기화, 툴팁, 각주 이동, Shadow DOM 언어 전환을 확인했다. 인증된 관리자 픽스처에서 세션, 게시물 목록, 공지, 장마감 공유 텍스트와 텔레그램 상태 조회는 200 및 `private, no-store`였다. [브라우저 측정 및 대조 원자료](../../seo-phase-2b-2026-11-28/evidence/browser-perf.json)

## 로컬 서버 성능

실제 HTMLRewriter를 실행하는 로컬 Workerd와 동일 파일, 동일 PC에서 경로별 전후 32회씩 측정했다. 쌍별로 측정 순서를 교차했고 각 경로의 첫 요청도 결과에 포함했다. 모든 응답은 200이었다. 정적 자산을 대조군으로 포함했다.

| 표본 | TTFB 중앙값 전 → 후 | TTFB p90 전 → 후 | 전체 응답 중앙값 전 → 후 |
|---|---:|---:|---:|
| 일반 KO | 6.34 → 6.15ms | 7.04 → 7.32ms | 11.49 → 11.26ms |
| 일반 EN | 6.51 → 6.31ms | 10.00 → 7.22ms | 12.57 → 12.10ms |
| 대형 KO No.10 | 8.30 → 8.21ms | 10.60 → 9.41ms | 30.96 → 31.01ms |
| 대형 EN No.10 | 8.96 → 8.91ms | 10.88 → 9.98ms | 32.25 → 32.05ms |
| 감사 표본 EN No.08 | 10.07 → 9.54ms | 12.35 → 11.02ms | 35.17 → 33.64ms |
| 정적 WebP 대조군 | 1.89 → 1.51ms | 2.58 → 2.10ms | 1.93 → 1.55ms |

별도 로컬 Workerd 프로세스에서 표본당 24회씩 정순·역순 총 두 번을 실행하고 Windows 프로세스 CPU 누적 시간으로 평균을 계산했다. 대형 No.10 영문은 각각 32.55→31.25ms, 31.25→26.69ms였다. 감사 표본 EN No.08은 34.51→39.06ms, 29.30→30.60ms로 늘었다. 전체 프로세스 피크 작업 집합은 정순 174.1→172.6MiB, 역순 138.4→139.6MiB였다. 이는 로컬 프로세스 전체의 수치로 Cloudflare 요청별 실행 한도나 메모리 사용량과 직접 비교할 수 없다. 정적 대조군의 시간도 움직였고 대형 리포트의 개선 방향이 일관되지 않았다.

Node 문자열 변환 경로에서 목록 1회 파싱은 약 0.9ms, 대형 EN 리포트의 마지막 이동 이미지 조회는 약 9ms, 교정용 전체 링크 진단은 약 2.6ms였다. 감사 표본 No.08에는 이동하는 WebP 7장이 있다. 이미지 캐시 미스마다 원본 HTML을 읽고 후보 해시를 계산하는 남은 경로가 대형 문서에서 비용을 크게 만드는 것으로 확인했다. 이번 변경으로 실제 운영 CPU 한도 초과가 감소하는지는 Preview 이후에만 검증할 수 있다. [Workerd TTFB 원자료](../../seo-phase-2b-2026-11-28/evidence/phase2b-ttfb-local.json) · [Workerd CPU 표본](../../seo-phase-2b-2026-11-28/evidence/native-cpu-after.json) · [Node 비용 분해](../../seo-phase-2b-2026-11-28/evidence/server-profile-after.json)

## 캐시 정책과 최신성

- 운영 정적 `report-shell.js`는 `public, max-age=14400, must-revalidate`와 ETag를 반환했다. 현재 `?v=0e81e3d23c`, 과거에 사용된 `?v=b59a7b24a9`, 임의 쿼리는 같은 SHA-256의 본문을 반환했다. 쿼리의 해시는 참조 갱신용이며 과거 바이트를 고정하는 주소가 아니다. [실제 과거 버전 점검](../../seo-phase-2b-2026-11-28/evidence/retired-version-probe.json)
- 공개 `/data/posts.js`, `posts.json`, `search-index-meta.js`, `search-index-body-ko.js`, `search-index-body-en.js`만 `no-cache, must-revalidate`를 지정했다. 브라우저는 기존 응답을 보존할 수 있으며, 사용 전 매번 이를 검증한다. 운영의 기존 공개 파일은 직접 구 ETag를 보냈을 때 304를 반환했다. 로컬에서 현 ETag는 304와 0바이트, 같은 주소의 버전이 바뀐 파일에 그 ETag를 보내면 새 ETag를 가진 200을 확인했다.
- 정적 `_headers`와 Functions 응답의 헤더는 별도다. 운영 `/api/market/dates`는 자체 ETag와 `max-age=30, s-maxage=60` 정책을 쓴다. 인증·관리자 응답의 `private, no-store, max-age=0`는 기존 호스트 정책에서 설정한다. 시장 요약과 태그 및 기존 통합 검색 JSON의 규칙은 유지한다.
- `/report-img/`는 해시 검증으로 주소에 해당하는 이미지 바이트만 반환하는 기존 장기 캐시 경로다. 이번 변경 뒤 이미지 주소와 출력은 동일했다. [운영 HTTP 원자료](../../seo-phase-2b-2026-11-28/evidence/production-cache-baseline.json) · [Pages 정적 헤더 문서](https://developers.cloudflare.com/pages/configuration/headers/)

## Phase 2A 링크 보정

검토 대상 95편의 기존 보정표와 매핑을 유지했다. 관리 도구의 메타데이터 전용 변경은 기존 활성 보정이 있는 경우 새 `updatedAt`과 짝지은 `reportLinkReviewAt`을 같은 커밋에 쓴다. 그 이후 다른 리비전에는 마커가 효력을 잃는다. HTML 파일을 교체하면 새 편집 의도를 안전하게 판정할 수 없어 마커를 지운다. 링크를 건드리지 않은 HTML 재업로드에도 이 보수적 조건이 적용된다. 보정이 이미 해제된 과거 편집본은 새로 활성화하지 않는다.

영문에서 국문 허브를 가리키면 발행, HTML 교체 교정, SEO 감사에서 검토 경고를 낸다. 명시한 국문판·원문 인용과 브랜드 홈은 기존 동작을 유지한다. 기존 본문의 메타데이터만 교정할 때는 경고 생성을 위해 대형 HTML을 추가로 다운로드하지 않는다. 공개 리포트 요청에는 진단을 실행하지 않는다.

## 회귀 검증

- `node scripts/verify.mjs` 5단계 통과. 자동 테스트 1,730/1,730. SEO 감사 실패 0, 기준 버전과 같은 경고 229건. 국문 허브 항목은 새 편집 시 검토용이다.
- 로컬 Workerd로 리포트 383편을 전후 비교했다. HTTP 200, canonical·hreflang·본문·활성 링크·이동 이미지 주소가 동일했다. 달라진 HTML은 셸 스크립트 버전과 번역 주소 속성이다. 374편은 정확한 번역 주소를 받았고, 번역판 없는 9편은 기존 언어별 홈으로 연결된다.
- 기존 주소 8개를 확장자 유무로 각각 검사해 16건 모두 단일 301 → 의도한 언어의 200을 확인했다. 8월 28일 미확인 구주소는 기존 404였다.
- 운영 사이트맵은 HTTP 200, `X-Sitemap-Source: fresh`, 595개였다. 운영에서 관측한 거래일 60일과 지표 32개의 가용성 및 lastmod 입력을 양쪽에 동일하게 제공했다. 로컬 XML 전후 동일, 운영과 URL 집합 차이 0, 중복 0. Phase 1의 시계열·실패·복구 로직은 변경하지 않았고 기존 자동 테스트가 해당 동작을 검증했다.
- 로컬 Preview 호스트에서 홈·영문 홈·소개·리포트·공개 목록에 `X-Robots-Tag: noindex, nofollow`를 확인했다. Admin 호스트 정책은 전체 Gate에서 검증했다. 발행·교정·검색·사이트맵 테스트는 모의 GitHub/D1을 사용했다. [실행 로그](../../seo-phase-2b-2026-11-28/evidence/verification-gate-final.log) · [URL 및 네이티브 출력 대조](../../seo-phase-2b-2026-11-28/evidence/regression.json)

## 수정 파일

- 리포트 및 서버 렌더링 `assets/report-shell.js`, `functions/_middleware.js`, `functions/_seo.js`, `functions/_market-date-page.js`, `functions/_report-images.js`
- 리포트 발행·교정 검토 `functions/_report-links.js`, `functions/api/manage.js`, `assets/admin.js`, `assets/admin-manage.js`, `scripts/audit-seo.mjs`
- 리소스 및 캐시 `_headers`, `assets/site.js`, 국·영문 정적 셸과 관리자 셸, `scripts/build-category-pages.mjs`. 공통 스크립트 참조 해시는 저장소 스탬퍼로 갱신했다.
- 검증 `tests/asset-versions.test.mjs`, `tests/home-v2.test.mjs`, `tests/announcements.test.mjs`, `tests/archive-search-scale.test.mjs`, `tests/search-index-lazy-body.test.mjs`, `tests/helpers/search-harness.mjs`, `tests/manage.test.mjs`, `tests/phase-2a-report-links.test.mjs`. 검색 실패의 기존 정규식 검사를 실제 브라우저 코드 동작 검증으로 옮겼다. 관리자 공지 테스트는 화면과 스크립트 순서 검증을 유지하며 미사용 목록이 제거됐는지 검사한다.
- `reports/`, `data/`, 사이트맵·lastmod 구현, robots와 호스트 정책 파일은 변경 0건.

## 배포 검증 및 롤백

1. Preview 승인 후 최신 `origin/main`과 실제 Production SHA, 게시 리포트와 메타데이터를 대조한다. Preview 브랜치 정책, 별도 D1, 색인 차단, 관리자 쓰기 제한을 확인한 뒤 승인된 후보만 올린다.
2. Preview에서 일반·대형 국문/영문 리포트와 허브, 공개 탐색 및 사이트맵을 확인한다. 실제 Cloudflare 응답에서 새 파일 200, 동일 ETag 304, 갱신된 ETag 200, 관리자 `private, no-store`를 확인한다. 검색, 번역 전환과 관련 글을 모바일·데스크탑 첫 방문과 재방문에서 확인한다. 검증용 데이터 변경이 필요한 경우 게시·교정과 분리된 격리 환경을 사용한다.
3. 일반·대형 표본의 첫 응답을 유지하며 낮은 빈도로 Tail의 CPU·wall·상태를 수집한다. 대형 No.08과 Phase 2A의 1102 표본, 이미지 캐시 미스를 집중 비교한다. 페이지별 ETag, Worker CPU·메모리 한도 초과, D1/캐시 차이와 네트워크 지연을 구분한다.
4. Production은 별도 승인 후 반영한다. 배포 SHA, Smoke와 사이트맵 집합, 운영 색인 정책, 첫 요청의 1102/503, Free 요금제를 검증한다. 오류가 후보에 기인하면 최신 공개 리포트 데이터를 보존한 현재 main에서 Phase 2B 코드 커밋만 revert한다. 과거 Pages 스냅샷으로 일괄 회귀하면 이후 발행이 사라질 수 있다. Phase 2B 적용 중 교정된 일부 리포트는 롤백 기간에 마커가 해석되지 않아 보정이 해제될 수 있으므로, 그 리포트만 따로 확인하며 메타데이터 원본은 보존한다.

남은 미확인 사항은 운영의 데이터센터별 정적 캐시 동작과 게시 직후 전파, 실제 Worker CPU·메모리 부하, 실사용자 Core Web Vitals, 장기 1102 추세다. 대형 리포트와 검색 본문이 계속 커질 경우 이미지 캐시 미스와 검색 본문 초기 파싱 비용을 따로 관찰한다.
