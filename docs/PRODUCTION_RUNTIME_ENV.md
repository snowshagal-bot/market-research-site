# Production Runtime Environment & Secret Inventory

이 문서는 Cloudflare Pages Production 환경에서 사용되는 환경변수, Secret, D1 Database Binding의 표준 명세다.
보안 원칙에 따라 **실제 비밀값은 이 문서와 Git 저장소에 절대 기록하지 않는다.**

---

## 1. Environment Variables & Secrets Reference

| Variable Name | Purpose | Required / Optional | Consumer | Validation Method | Rotation Dependency |
|---|---|---|---|---|---|
| `GITHUB_TOKEN` | GitHub 저장소 리포트 파일 및 메타데이터 Commit/Push | **Required** | `/api/publish`, `/api/manage`, `/api/admin/runtime-status` | `GET /api/admin/runtime-status` (`githubTokenConfigured=true`, `githubRepoRead=true`, `githubHttpStatus=200`) | Standalone (Cloudflare Secret 갱신 후 Pages 재배포) |
| `AUTH_PEPPER` | Login rate limiting 및 audit log용 IP 해싱 server-side pepper (Password PBKDF2 salt는 credential별로 별도 저장되므로 비밀번호 자체와 무관) | **Required** | `functions/_auth.js`, `functions/api/comments.js` | `functions/_auth.js` (IP 해시 생성 및 로그인 rate limiting) | Low impact (변경 시에도 기존 사용자 비밀번호 재설정 불필요. 단, 기존 IP hash continuity 및 rate-limit 버킷만 초기화됨) |
| `ADMIN_KEY` | 레거시 보존 환경변수 (Active Authentication Consumer: **NONE**. Human 인증용으로 복구하지 않음) | **Optional** (Legacy retained) | `functions/api/comments.js` (fallback IP hash salt 용도 외 활성 인증 소비자 없음) | Inactive (인증 미사용) | Standalone |
| `MARKET_PUBLISH_KEY` | Market Close 데이터 자동 게시 머신 인증 키 | **Required** | `/api/market/publish`, `/api/admin/runtime-status` | `GET /api/admin/runtime-status` (`marketPublishKeyConfigured=true`) | **Coordinated** (Cloudflare Secret과 Market Close Publisher 클라이언트 설정을 동시에 갱신해야 함. 서버 단독 변경 금지) |
| `GEMINI_API_KEY` | 공시 분석용 Google Gemini LLM API 키 | **Required** (Disclosure feature) | `/api/disclosures/analyze`, `/api/disclosures/latest`, `/api/admin/runtime-status` | `GET /api/disclosures/latest` (`config.llmConfigured=true`), `GET /api/admin/runtime-status` (`geminiApiKeyConfigured=true`) | Standalone |
| `OPENDART_API_KEY` | 전자공시시스템(DART) 오픈API 연동 키 | **Required** (Disclosure feature) | `/api/disclosures/sync`, `/api/disclosures/latest`, `/api/admin/runtime-status` | `GET /api/disclosures/latest` (`config.sourceConfigured=true`), `GET /api/admin/runtime-status` (`openDartApiKeyConfigured=true`) | Standalone |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정 식별자 (Browser Rendering & GraphQL Analytics) | **Required** | `/api/generate-cover`, `/api/analytics`, `/api/admin/runtime-status` | `GET /api/admin/runtime-status` (`browserRenderingConfigured=true`, `analyticsConfigured=true`) | Standalone |
| `CLOUDFLARE_BROWSER_RENDERING_TOKEN` | Cloudflare Workers Browser Rendering REST API 인증 토큰 | **Required** (Browser cover capture) | `/api/generate-cover`, `/api/admin/runtime-status` | `GET /api/admin/runtime-status` (`browserRenderingConfigured=true`), HTML 커버 자동 캡처 | Standalone |
| `CLOUDFLARE_ANALYTICS_API_TOKEN` | Cloudflare GraphQL Analytics API 조회 토큰 | **Required** (Analytics) | `/api/analytics`, `/api/admin/runtime-status` | `GET /api/analytics?range=1` (HTTP 200), `GET /api/admin/runtime-status` (`analyticsConfigured=true`) | Standalone |
| `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG` | Cloudflare Web Analytics 사이트 식별 태그 | **Required** (Analytics) | `/api/analytics`, `/api/admin/runtime-status` | `GET /api/analytics?range=1` (HTTP 200), `GET /api/admin/runtime-status` (`analyticsConfigured=true`) | Standalone |
| `DISCLOSURE_SYNC_KEY` | 외부 스케줄러(cron) 머신 연동용 공시 동기화 키 | **Optional** (미사용) | `/api/disclosures/sync`, `/api/admin/runtime-status` | `GET /api/admin/runtime-status` (`disclosureSyncKeyConfigured=false`는 정상) | Standalone (외부 스케줄러 도입 시 생성) |

---

## 2. D1 Database Bindings

| Binding Name | Purpose | Required / Optional | Consumer |
|---|---|---|---|
| `AUTH_DB` | 관리자 계정(`users`, `password_credentials`), 세션(`sessions`), Rate limit(`auth_rate_limits`), 감사 로그(`audit_events`) 저장소 | **Required** | `functions/_auth.js`, `/api/auth/*` |
| `COMMENTS_DB` | 다중 기능 운영 데이터 저장소:<br>1. 게스트 댓글, 평가, 페이지 조회 세션 (`/api/comments`, `/api/engagement`, `/api/engagement-stats`)<br>2. Market Close 일별 스냅샷 및 아카이브 (`/api/market/*`)<br>3. 공시 데이터, 관심종목, 토큰 사용량, 동기화 상태 (`/api/disclosures/*`) | **Required** | `/api/comments`, `/api/engagement`, `/api/engagement-stats`, `/api/market/*`, `/api/disclosures/*` |

---

## 3. Production Cloudflare Configuration Safety Rules

1. **전체 Object Replace 금지**: Cloudflare Pages의 환경변수/Secret 설정 시 기존 객체를 통째로 덮어쓰거나 bulk rewrite하지 않는다.
2. **단일 키 변경**: 환경변수 작업은 반드시 필요한 키 하나씩 수정 또는 추가한다.
3. **변경 전 이름 확인**: 작업 전 본 문서의 목록과 대조하여 변수명의 대소문자 및 철자를 확인한다.
4. **Secret 원문 노출 금지**: Secret 원문은 채팅, 터미널 출력(stdout), 로그, Git 커밋, 스크린샷, 임시 파일에 일체 남기지 않는다.
5. **Secret 설정 후 재배포**: Cloudflare Pages Secret을 변경한 후에는 반드시 새 Production deployment를 생성하여 Functions 런타임에 바인딩이 반영되도록 한다.
6. **배포 후 Runtime Status 확인**: 배포 완료 즉시 `GET /api/admin/runtime-status`를 통해 각 기능별 바인딩 상태를 검증한다.
7. **Publisher 검증**: `githubTokenConfigured=true`, `githubRepoRead=true`, `githubHttpStatus=200`을 확인한다.
8. **Market 검증**: `marketPublishKeyConfigured=true`를 확인한다.
9. **Cover 검증**: `browserRenderingConfigured=true`를 확인한다.
10. **Disclosure 검증**: `GET /api/disclosures/latest?limit=1`에서 `sourceConfigured=true`, `llmConfigured=true`를 확인한다.
11. **Analytics 검증**: `GET /api/analytics?range=1`의 HTTP 200 응답을 확인한다.
12. **Optional Secret 상태 판정**: `disclosureSyncKeyConfigured=false`는 정상이며 장애로 취급하지 않는다.
13. **작업 분리**: Cloudflare 인프라/설정 변경과 애플리케이션 코드 변경은 동일 작업에서 혼합하지 않고 분리한다.
14. **작업 종료 전 보고**: Secret/환경변수 작업은 변경 전/후의 inventory 상태를 보고한 후 종료한다.
