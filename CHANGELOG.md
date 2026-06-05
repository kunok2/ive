# Changelog

Springware IVE의 굵직한 변경 이력입니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

> 버전은 `package.json`을 단일 출처로 하며, [next.config.mjs](next.config.mjs)의 `APP_VERSION`을 통해 UI에 표시됩니다.
> 1.5.0 이전 버전은 git 태그가 없던 시기라 커밋 이력을 기반으로 소급 정리한 것으로, 날짜는 주요 변경이 머지된 시점입니다.

## [Unreleased]

### Added
- **메일 발송 개인화·수신거부**: 관리자 일괄 메일에 `{{name}}`·`{{email}}` 개인화 태그 지원(발송 시 수신자별 치환, 수신자 값은 HTML 이스케이프). 모든 발송 메일 하단에 수신자별 서명 토큰이 담긴 수신거부 링크 자동 삽입 → 비로그인 `/unsubscribe` 페이지에서 수신거부/재구독. `users.mail_unsubscribed` 컬럼 추가, 수신거부자는 일괄 발송 대상에서 항상 제외(발송 결과에 제외 인원 표시). 수신 여부는 **사용자 본인만** 변경 — 프로필 설정(아바타 메뉴)에 수신 on/off 토글 추가, 관리자는 임의로 재개할 수 없고 사용자 카드엔 수신거부 상태 배지만 표시.
- **사용자 선택/필터 UI 통일**: 메일 발송 수신자 선택을 검색·스크롤되는 피커로 교체(사용자가 늘어도 화면이 꽉 차지 않음). 사용자를 표시하는 선택/필터 UI(메일 수신자, 활동로그 필터, 리포트 수신자, Slack 기본 담당자)를 `아바타 + 이름(이메일)` 형태로 통일(`MultiSelectPicker`/`CustomSelect` 아바타 지원, `userToOption` 헬퍼).
- **이용약관·개인정보처리방침 도입**: `/legal/terms`, `/legal/privacy` 페이지(ko/en) 추가. 외부 공개 서비스 + OAuth 가입에 대응해 개인정보처리방침을 수립·공개(개인정보보호법 제30조). 로그인 화면 OAuth 버튼 아래·하단에 동의 고지문과 약관 링크, 회원가입 화면 가입 버튼 위에 동의 고지문 노출.
- **약관 동의 시점 기록**: `users.terms_agreed_at` 컬럼 추가. 이메일/소셜 가입 시점을 동의 시각으로 저장.
- **약관 설정 관리자화**: 관리자 설정에 "약관·개인정보" 그룹 추가. 로그인 화면 표시 on/off 토글(사내 전용 설치 시 끄기) + 운영주체 정보(회사명·주소·보호책임자·이메일·서비스 URL·시행일)를 설정에서 지정. 약관 본문(조항)은 i18n 템플릿으로 두고 회사별 값만 주입(`getLegalConfig`, 공개 엔드포인트 `/api/public/legal-config`).
- **오픈소스 라이선스 고지**: 납품(배포) 시 attribution 의무 대응. 프로덕션 의존성 라이선스·저작권 전문을 수집하는 `scripts/generate-third-party-notices.mjs`(npm `licenses`/`prebuild`로 빌드 시 자동 갱신) → `public/third-party-notices.txt`(동봉용 전문) + `src/data/third-party-licenses.json`(페이지용 메타). `/legal/licenses` 페이지(ko/en, 검색·라이선스별 집계·전문 링크) 추가, 약관·로그인 푸터에 링크 연결. (GPL/AGPL 0건 — 자사 소스 공개 의무 없음.)

### Fixed
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
