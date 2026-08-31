# Project docs

이 디렉터리는 `market-research-site`의 장기 운영용 문서다. Codex와 사람이 같은 기준으로 작업하기 위한 저장소 내 시스템 오브 레코드다.

## 문서 지도

- [`PROJECT_STATE.md`](./PROJECT_STATE.md) — 현재 구현 상태, 주요 파일, 데이터 흐름
- [`UI_RULES.md`](./UI_RULES.md) — 디자인, 반응형, 모바일/데스크탑 검수 원칙
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — GitHub, Cloudflare Pages, D1, Secret/Binding 구성
- [`ROADMAP.md`](./ROADMAP.md) — 현재 작업 지점과 다음 우선순위
- [`DAILY_REPORT_METADATA.md`](./DAILY_REPORT_METADATA.md) — Daily HTML이 반드시 담아야 하는 head 메타데이터
- [`DISCLOSURES.md`](./DISCLOSURES.md) — OpenDART 공시 모니터, 무료 API 예산, LLM/데이터 공급자 교체 방식
- [`ADMIN_ORIGIN_ISOLATION.md`](./ADMIN_ORIGIN_ISOLATION.md) — 관리자 origin host 정책, API 분류, Preview 및 Cloudflare cutover/rollback 절차

## 사용 원칙

대화 기록과 문서가 충돌하면 먼저 저장소의 실제 코드를 확인한다. 코드와 문서가 다르면 코드를 기준으로 현 상태를 판단하되, 작업을 마치면서 문서를 최신 상태로 갱신한다.

새 기능을 추가할 때는 기능 자체보다 기존 구조와의 충돌 여부를 먼저 확인한다. 특히 `reports/`의 독립형 HTML은 각자 CSS와 JavaScript를 포함하므로 공통 UI는 가능한 한 원본과 분리해서 구현한다.
