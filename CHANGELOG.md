# Changelog

Springware IVE의 굵직한 변경 이력입니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

> 버전은 `package.json`을 단일 출처로 하며, [next.config.mjs](next.config.mjs)의 `APP_VERSION`을 통해 UI에 표시됩니다.
> 1.5.0 이전 버전은 git 태그가 없던 시기라 커밋 이력을 기반으로 소급 정리한 것으로, 날짜는 주요 변경이 머지된 시점입니다.

## [Unreleased]

### Added
- **메일 임시저장 + 발송메일 복제**: 메일을 작성 후 발송하지 않고 **임시저장**(메일 발송 화면의 '임시저장' 버튼 + '임시저장함' 목록에서 불러오기·수정·삭제). 임시저장에서 불러와 발송하면 해당 draft는 자동 정리. **발송 이력**에서 이미 보낸 메일을 **복제**하면 제목·본문이 임시저장으로 복사되고 메일 발송 화면으로 전환돼 **다른 수신자**를 골라 재발송. 신규 테이블 `mail_drafts`, 엔드포인트 `/api/admin/mail/drafts*`.
- **홍보(Promotion) — SNS 글 + 통합 성과**: 관리자 "메일" 탭을 **"홍보"**로 확장. 채널은 ① 메일 발송 ② **SNS 글 등록**(신규) 2가지. SNS 글은 작성·저장 후 **채널별(X·링크드인·페북 등) 추적 링크**를 받아 수기로 게시. 공개 링크 클릭은 익명 방문자 쿠키로 기록되고, 클릭한 방문자가 이후 **가입/로그인하면 전환으로 귀속**(last-touch, register/login/OAuth 모두). 홍보 패널에 **[성과]** 탭 추가 — 메일+SNS를 한 표에서 유입(클릭)·고유·전환으로 비교. 신규 테이블 `social_posts`/`social_post_links`/`social_clicks`, 엔드포인트 `/api/social/click`(공개 리다이렉트)·`/api/admin/social*`·`/api/admin/promotion/performance`. (직접 자동 게시는 향후 확장 — 상태/채널 구조만 선반영.)
- **메일 접속 추적·통계**: 발송 메일에 추적 가능한 **IVE 접속 링크**(하단 'IVE 접속하기' 버튼 + 본문 `{{link}}` 태그) 자동 삽입. 수신자가 링크로 IVE에 접속하면 발송·사용자·시각을 기록(`mail_broadcast_clicks`). 메일 발송이력 화면에 발송별 **접속 횟수 칩** 표시 → 클릭하면 **사용자별 접속 통계**(아바타+이름(이메일), 접속 횟수, 최근 접속 시각) 모달. 발송이력 삭제 시 접속 기록도 함께 정리.
- **메일 발송 개인화·수신거부**: 관리자 일괄 메일에 `{{name}}`·`{{email}}` 개인화 태그 지원(발송 시 수신자별 치환, 수신자 값은 HTML 이스케이프). 모든 발송 메일 하단에 수신자별 서명 토큰이 담긴 수신거부 링크 자동 삽입 → 비로그인 `/unsubscribe` 페이지에서 수신거부/재구독. `users.mail_unsubscribed` 컬럼 추가, 수신거부자는 일괄 발송 대상에서 항상 제외(발송 결과에 제외 인원 표시). 수신 여부는 **사용자 본인만** 변경 — 프로필 설정(아바타 메뉴)에 수신 on/off 토글 추가, 관리자는 임의로 재개할 수 없고 사용자 카드엔 수신거부 상태 배지만 표시.
- **사용자 선택/필터 UI 통일**: 메일 발송 수신자 선택을 검색·스크롤되는 피커로 교체(사용자가 늘어도 화면이 꽉 차지 않음). 사용자를 표시하는 선택/필터 UI(메일 수신자, 활동로그 필터, 리포트 수신자, Slack 기본 담당자)를 `아바타 + 이름(이메일)` 형태로 통일(`MultiSelectPicker`/`CustomSelect` 아바타 지원, `userToOption` 헬퍼).
- **이용약관·개인정보처리방침 도입**: `/legal/terms`, `/legal/privacy` 페이지(ko/en) 추가. 외부 공개 서비스 + OAuth 가입에 대응해 개인정보처리방침을 수립·공개(개인정보보호법 제30조). 로그인 화면 OAuth 버튼 아래·하단에 동의 고지문과 약관 링크, 회원가입 화면 가입 버튼 위에 동의 고지문 노출.
- **약관 동의 시점 기록**: `users.terms_agreed_at` 컬럼 추가. 이메일/소셜 가입 시점을 동의 시각으로 저장.
- **약관 설정 관리자화**: 관리자 설정에 "약관·개인정보" 그룹 추가. 로그인 화면 표시 on/off 토글(사내 전용 설치 시 끄기) + 운영주체 정보(회사명·주소·보호책임자·이메일·서비스 URL·시행일)를 설정에서 지정. 약관 본문(조항)은 i18n 템플릿으로 두고 회사별 값만 주입(`getLegalConfig`, 공개 엔드포인트 `/api/public/legal-config`).
- **오픈소스 라이선스 고지**: 납품(배포) 시 attribution 의무 대응. 프로덕션 의존성 라이선스·저작권 전문을 수집하는 `scripts/generate-third-party-notices.mjs`(npm `licenses`/`prebuild`로 빌드 시 자동 갱신) → `public/third-party-notices.txt`(동봉용 전문) + `src/data/third-party-licenses.json`(페이지용 메타). `/legal/licenses` 페이지(ko/en, 검색·라이선스별 집계·전문 링크) 추가, 약관·로그인 푸터에 링크 연결. (GPL/AGPL 0건 — 자사 소스 공개 의무 없음.)

### Fixed
- **메인 브랜치 머지로 닫힌 작업이 "실패"로 집계되던 문제**: 검증/확인 단계의 작업이 MR/PR 머지로 자동 닫히면(`Closes #iid` + 작업 브랜치 삭제) 이슈가 `IVE-E`(완료) 단계를 거치지 않고 스캔에서 사라진다. 스캐너의 stale(좀비) 정리가 이를 단순 좀비로 보고 잔류 execution을 `failed`로 마감해, 실제로는 머지·완료된 작업이 보고서에서 **실패**로 잡히던 문제 수정 (#467). 이제 스캔에서 사라진 이슈를 정리할 때 **메인 브랜치 머지로 닫힌 작업인지** 먼저 판정한다 — 이슈가 `closed` 상태이고 작업 브랜치(`dev-{iid}`)의 MR/PR이 `merged`이면 **완료(success)로 마감**하고, 검증이 진행 중이었으면(`verify_started_at` 존재) 머지 시각으로 `verified_at`을 기록(머지는 검증 통과를 의미)한다. 머지 흔적이 없는 경우(수동 닫기·라벨 제거)는 기존대로 실패 처리하며, 네트워크 조회 실패 시에도 보수적으로 실패 처리로 떨어져 잘못된 완료 처리를 방지(`reconcileClosedIssue`/`completeMergedIssue`).
- **보고서 '대기 건수'가 0으로 나오던 문제**: 보고서 흐름(Flow)의 '대기' 지표가 (1) 확인대기(IVE-P)를 아예 빼먹고, (2) 처리대기·검증대기를 **스캐너 캐시 컬럼**(`lastScannedIssueCount`/`lastVerifyWaitingCount`)에서 읽어 GitLab에서 수동으로 라벨/단계를 바꾼 건을 즉시 반영하지 못해, 대기 건이 있어도 0으로 표시되던 문제 수정 (#462). 1차로 확인대기를 스냅샷~대기추이 전 구간에 추가(`stat_snapshots.confirm_waiting`, `stat_daily_summaries.avg_confirm_waiting` 컬럼 신설·마이그레이션). 2차로 **통계 스냅샷 수집(`stats-collector.ts`)이 처리대기/검증대기/확인대기를 모두 권위 소스인 `issue_stages.cached_stage`에서 직접 집계**하도록 통일(프로젝트 카드 통계와 동일 기준) — 수동 단계 전환도 다음 스냅샷(최대 1분)에 반영. 이제 보고서 '현재 대기'·프로젝트별 대기·메일 보고서 대기 추이가 `처리대기 + 검증대기 + 확인대기` 합계로 정확히 집계됨.
- **메일 전체발송 안전장치**: 관리자 메일 발송에서 **수신자를 선택하지 않으면 전원 발송되던** 위험한 폴백 제거. 이제 미선택 시 발송이 차단되고, 전체 발송은 **'모두에게 발송' 체크박스**를 명시적으로 켰을 때만 가능. API도 `sendToAll=true` 없이 빈 수신자면 400 반환(구형 클라이언트 안전). 발송 버튼은 미선택+미체크 시 비활성.
- **Slack 에이전트 응답 마크다운 깨짐**: AI 에이전트가 표준 Markdown(`**굵게**`·`### 헤더`·`[t](u)`·`~~취소선~~`·표)을 그대로 보내 Slack 대화창에 태그가 문자 그대로 찍히던 문제 수정. 전송 직전 Slack `mrkdwn`으로 변환(`markdownToMrkdwn`) — 굵게 `*`, 기울임 `_`, 헤더는 굵게 줄, 링크 `<url|text>`, 불릿 `•`, 표는 Slack 에 표 문법이 없어 **열 너비를 맞춘 코드블록**으로(표시폭 한글·이모지=2칸 계산, 헤더 밑 `-+-` 구분선). 표 셀 안의 마크다운(`**`·`[]()`·백틱)은 코드블록에서 렌더 안 되므로 미리 제거. 코드펜스/인라인 코드 내부는 변형하지 않음. IVE 시스템 알림(단계 전이 DM)은 이미 mrkdwn 이라 영향 없음. (운영 봇으로 실제 채널 렌더링 검증 완료.)
- 프로젝트 카드 "완료(오늘)" 카운트가 KST 자정~오전 9시에 완료된 건을 누락해 0으로 표시되던 문제 수정 (#448). `issue_stages.updated_at`(`datetime('now')` 공백 포맷)과 오늘 시작 기준값(ISO `T`/`Z` 포맷)을 단순 문자열 비교하던 것을 `datetime()` 정규화 비교로 교체.

## [1.5.0] - 2026-06-03

Slack 통합과 비용 원가 모델을 도입한 릴리스.

### Added
- **Slack 통합**
  - 워크스페이스 봇 원클릭 설치(OAuth) + 워크스페이스 소유자 모델
  - 멘션으로 IVE 에이전트와 대화(에이전트 주도, 스레드 독립 세션)
  - 단계 전이별 작업 알림 DM (검증대기→검증자 / 확인대기→확인자 / 완료→생성자)
  - 작업완료 Slack 알림(DM + 채널 멘션), 멘션 사용자 언어(locale) 다국어 처리
  - Slack OAuth 로그인 통합 + 알림용 멤버 ID 자동 연결, 첨부 이미지 분석/업로드
- **이미지 입력 공통 지원**: 웹 채팅·Slack 멘션·이슈 본문/코멘트 첨부 이미지를 에이전트가 분석 (`-i`/`-f`/프롬프트 경로)
- **비용 원가 모델**: 작업시간을 ive-meta(`work_sec`) 기준으로 산정, 사용자별 단가 배수(`rate_multiplier`) 반영
- 사용자별 표시 통화·환율 변환, 리포트 비중 누적 분배 막대
- 에이전트 사용중지 토글(자동재개·선택 제외)

### Changed
- Claude 답변 토큰 단위 스트리밍, 페이지 이탈에도 대화 유지
- 관리자 설정 재편(OAuth/Slack/터미널 하위 이동), 확인 팝업을 클릭 지점 팝오버로 통일
- 기본 사용자(admin@ive.local)는 메일 인증 없이 비밀번호 변경 허용

## [1.0.0] - 2026-05-30

멀티 CLI 에이전트 정식 지원으로 첫 안정 버전.

### Added
- **Codex CLI** 에이전트 정식 지원 (#366)
- **Gemini CLI** 정식 지원 + CLI 브랜드 로고
- 기본 아바타로 CLI 회사 브랜드 로고 추가

## [0.10.0] - 2026-04-30

5단계 워크플로우와 외부 작업 접수 체계 확립.

### Added
- **5단계 워크플로우**(유입→처리→검증→확인→완료) + 역할 모델 정립 (#271)
- **작업 접수 페이지**(HMAC Signed Token 보안), 테마/언어 선택 UI, 이미지 붙여넣기 업로드
- 구조화된 로깅 시스템 + 관리자 로그 뷰어
- 작업 마감일·회차 정보, 프로젝트 테스트 사이트 URL 바로가기

## [0.9.0] - 2026-04-17

브랜딩 및 온보딩 개편.

### Changed
- **브랜딩 Spring IVE → Springware IVE** 전체 변경, 브랜드 색상 분리

### Added
- 인트로 슬라이드 리디자인, 가이드 투어/도움말 시스템
- PWA 설치 버튼, 아이콘/패비콘 주제색 최신화

## [0.8.0] - 2026-04-12

외부 AI 도구 작업 연동.

### Added
- 외부 AI 도구 작업의 IVE 자동 인식 + 가이드 설치(보호 브랜치 대응)
- 이슈 이미지 붙여넣기 업로드, 캐시 토큰 분리 기록
- i18n 파일 도메인별 분리

## [0.7.0] - 2026-04-11

OAuth 인증과 검증자 역할 도입.

### Added
- **GitLab/GitHub OAuth 로그인** + 검증자(verifier) 기능
- OAuth 기반 검증자-사용자 매칭, 이슈 권한 제어
- 이슈 선호 작업자(에이전트) 지정, Git 담당자 배정 (#156)
- 사람 실행·검증 비용 단가 모델, 보고서 검증시간 통계

## [0.6.0] - 2026-03-27

MR 충돌 처리 자동화.

### Added
- MR 충돌 감지를 에이전트 기반으로 구현 (#102)
- 채팅/UI 개선, MR 닫기 기능

## [0.5.0] - 2026-03-25

다국어 지원.

### Added
- **i18n**(next-intl, 한국어 + 영어), AI 프롬프트·결과 노트 locale 다국어화
- 사용자 locale DB 영속화 + 멀티 브라우저 UI 동기화

## [0.4.0] - 2026-03-21

OpenCode 작업자 및 모델 단가.

### Added
- **OpenCode** 작업자 실행 지원, MCP 서버 설정
- 실행 모델명 캡처 및 단가 계산, 사용자별 CLI 도구 사용 권한

## [0.3.0] - 2026-03-17

대규모 리팩토링과 핵심 기능 확장.

### Added
- 아바타 시스템·인터뷰, 보고서, 관리자 기능
- **GitHub provider** 지원, MR 리뷰/머지 기능
- PWA 지원(manifest/service worker/앱 아이콘), 모든 탭 pull-to-refresh

### Changed
- 역할 시스템 제거 대규모 리팩토링, 환경변수 탭 → DB 기반 시스템 설정

## [0.1.0] - 2026-03-15

초기 MVP.

### Added
- 프로젝트/슬롯 관리 시스템, 스캐너 자동화 + 에이전트 배정
- 실시간 실행 트레이싱(xterm.js), 웹 터미널(WebSocket + node-pty)
- Docker/docker-compose 컨테이너 배포, GitLab CI/CD 파이프라인
- Claude Code CLI 연동, 작업 완료 시 AI 대화 로그를 이슈 노트에 첨부

[Unreleased]: https://gitlab.com/kojoung/ive/-/compare/v1.5.0...main
[1.5.0]: https://gitlab.com/kojoung/ive/-/releases/v1.5.0
[1.0.0]: https://gitlab.com/kojoung/ive/-/releases/v1.0.0
[0.10.0]: https://gitlab.com/kojoung/ive/-/releases/v0.10.0
[0.9.0]: https://gitlab.com/kojoung/ive/-/releases/v0.9.0
[0.8.0]: https://gitlab.com/kojoung/ive/-/releases/v0.8.0
[0.7.0]: https://gitlab.com/kojoung/ive/-/releases/v0.7.0
[0.6.0]: https://gitlab.com/kojoung/ive/-/releases/v0.6.0
[0.5.0]: https://gitlab.com/kojoung/ive/-/releases/v0.5.0
[0.4.0]: https://gitlab.com/kojoung/ive/-/releases/v0.4.0
[0.3.0]: https://gitlab.com/kojoung/ive/-/releases/v0.3.0
[0.1.0]: https://gitlab.com/kojoung/ive/-/releases/v0.1.0
