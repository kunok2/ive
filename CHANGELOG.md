# Changelog

Springware IVE의 굵직한 변경 이력입니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

> 버전은 `package.json`을 단일 출처로 하며, [next.config.mjs](next.config.mjs)의 `APP_VERSION`을 통해 UI에 표시됩니다.
> 1.5.0 이전 버전은 git 태그가 없던 시기라 커밋 이력을 기반으로 소급 정리한 것으로, 날짜는 주요 변경이 머지된 시점입니다.

## [Unreleased]

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
