# Codex instructions

이 저장소는 개인 시장 리서치 웹사이트의 장기 운영 코드베이스다. 작업 전에 현재 코드와 `docs/` 문서를 먼저 읽고, 대화 기록보다 **저장소의 현재 상태를 우선 기준**으로 삼는다.

## 먼저 읽을 문서

- `docs/index.md` — 문서 지도
- `docs/PROJECT_STATE.md` — 현재 구현 상태와 파일 역할
- `docs/UI_RULES.md` — 디자인·반응형·UX 원칙
- `docs/DEPLOYMENT.md` — GitHub/Cloudflare/D1/비밀값 구성
- `docs/ROADMAP.md` — 현재 작업 지점과 이후 우선순위

## 필수 작업 원칙

1. 모바일과 데스크탑은 항상 한 세트로 검수한다. 모바일 수정 후 데스크탑, 데스크탑 수정 후 모바일을 반드시 확인한다.
2. `reports/`의 업로드된 원본 리포트 HTML은 특별한 이유가 없으면 직접 수정하지 않는다. 공통 UI는 middleware와 `assets/report-shell.js` 같은 사이트 레이어에서 처리한다.
3. 기존 리포트의 접힘/펼침, 툴팁, 애니메이션, 내부 JavaScript가 깨지지 않도록 한다.
4. 공통 UI가 리포트 고유 CSS와 충돌하지 않게 격리를 우선한다. 현재 리포트 상단바와 댓글 UI는 Shadow DOM을 사용한다.
5. 사이트는 Mobile First이지만 데스크탑 완성도를 희생하지 않는다. 가로 overflow, 고정 UI 겹침, hover/cursor, 터치 영역을 함께 본다.
6. 현재 공개 메뉴 명칭은 `데일리 / 위클리 / 비정기 / 시장 공부 / 끄적끄적`이다. 내부 타입은 `daily / weekly / research / basics / note`를 유지한다. `basics`는 핵심 카테고리이고 `note`는 별도 보조 카테고리다.
7. 인기글, 조회수, 랭킹 같은 기능은 현재 요구사항이 아니다. 미래 확장을 막지 않되 지금 임의로 추가하지 않는다.
8. 회원제는 현재 사용하지 않는다. 댓글은 게스트 방식이 기본이다.
9. 보안 비밀값의 실제 값은 절대 Git에 기록하지 않는다. `GITHUB_TOKEN`, `ADMIN_KEY`는 Cloudflare Secret이고, `COMMENTS_DB`는 D1 binding 이름이다.
10. 게시 데이터의 `reportDate`와 `registeredDate/registeredAt`을 구분한다. 아카이브 정렬은 리포트 기준일(`reportDate`)을 우선한다.
11. 리포트 게시 시 HTML 내부의 실제 제목을 우선 추출하며, 사용자가 게시 전에 수정할 수 있어야 한다.
12. 불필요한 프레임워크 도입이나 대규모 리라이트를 피한다. 현재 정적 HTML/CSS/JS + Cloudflare Pages Functions 구조를 가능한 한 유지한다.

## 변경 전후 확인

- 관련 문서를 읽고 현재 상태를 확인한다.
- 변경 범위를 최소화하고 기존 기능 회귀를 점검한다.
- 자동 테스트가 없는 영역은 가능한 범위에서 정적 검사와 브라우저/렌더링 확인을 수행한다.
- UI 변경은 최소한 모바일 폭(약 360~430px)과 데스크탑 폭(1280px 이상)을 모두 확인한다.
- 배포/환경 설정이 필요한 변경은 코드만 완료했다고 간주하지 말고 `docs/ROADMAP.md`에 남은 수동 단계를 갱신한다.
- 구조나 운영 방식이 바뀌면 관련 `docs/` 문서도 같은 작업에서 갱신한다.

## 현재 바로 이어서 할 작업

`docs/ROADMAP.md`의 "Next action"부터 시작한다. 현재 대표 DAILY/WEEKLY/RESEARCH WebP 커버 Draft PR의 Preview 검수가 다음 작업이며, 이후에는 운영 중 실제 필요가 관찰될 때 새 작업을 정한다.
