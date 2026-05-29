# Springware IVE - Project Guide

## Overview
GitLab/GitHub 이슈를 AI CLI 에이전트(Claude, Gemini, Codex, OpenCode)가 자동 처리하는 웹 대시보드.
Next.js 16 + custom server (node-pty, WebSocket) + SQLite (better-sqlite3).

## Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Recharts, xterm.js
- **Backend**: Custom HTTP/WS server (`server.ts`), Next.js API Routes
- **DB**: SQLite via better-sqlite3 (`data/springware-ive.db`)
- **i18n**: next-intl (ko/en)
- **Auth**: JWT (bcryptjs), 쿠키 기반
- **Deploy**: Docker (port 3100→3000), GitLab CI/CD → 서버 로컬 빌드+재시작, Docker Hub push는 수동

## Directory Structure
```
server.ts              # 커스텀 서버 (HTTP/HTTPS + WebSocket + node-pty 터미널)
src/
  app/
    layout.tsx         # 루트 레이아웃
    page.tsx           # 메인 페이지
    api/               # API Routes
      activities/      # 활동 피드
      admin/           # 관리자 (activity-logs, env, mail, users)
      agents/          # 에이전트 CRUD ([id]/ 포함)
      auth/            # 인증 (login, logout, register, me, avatar, change-*)
      executions/      # 실행 관리
      projects/        # 프로젝트 CRUD ([id]/, test-connection)
      reports/         # 리포트
      settings/        # 설정 (cli-paths, locale, pricing)
    agents/            # 에이전트 페이지
    executions/        # 실행 상세 페이지
    issues/            # 이슈 페이지
    login/             # 로그인 페이지
    projects/          # 프로젝트 페이지
    register/          # 회원가입 페이지
  components/
    agent/             # AgentAvatar, AgentCard, AgentForm
    auth/              # AvatarCropEditor, ChangePasswordForm, IntroSlides, UserProfileForm
    execution/         # ExecutionList, ExecutionStats, LiveTracePanel
    layout/            # MobileTabBar
    mr/                # ConflictResolutionPanel, DiffViewer, MRReviewSection
    project/           # ExecutionTrace, ProjectCard, ProjectForm
    reports/           # ReportCharts
    tabs/              # AdminTab, AgentsTab, IssuesTab, ProjectsTab, ReportsTab, TerminalTab
    ui/                # ConfirmDialog, ConfirmModal, LanguageSwitcher, LogViewer, MarqueeText, Modal, PullToRefresh, Sparkline, Toast
  lib/
    activity.ts        # 활동 피드 로직
    auth.ts            # JWT 인증 헬퍼
    chat-agent.ts      # AI 에이전트 채팅 연동
    crypto.ts          # 암호화/복호화 (토큰 저장)
    date-utils.ts      # 날짜 유틸 (KST 변환 등)
    db.ts              # SQLite DB 초기화 + 모든 쿼리 함수
    format-date.ts     # 날짜 포맷
    mail.ts            # 이메일 발송 (nodemailer)
    provider.ts        # GitLab/GitHub API 연동
    report-mailer.ts   # 리포트 메일 발송
    report-scheduler.ts # 리포트 스케줄러
    scanner.ts         # 이슈 스캐너 (주기적 폴링 → 실행 생성)
    stats-collector.ts # 통계 스냅샷 수집
    store.tsx          # 클라이언트 상태 관리 (React Context)
    tab-context.tsx    # 탭 컨텍스트
    token-pricing.ts   # 토큰 가격 계산
    tool-activity.ts   # 도구 활동 추적
    xterm-touch.ts     # xterm 터치 이벤트 처리
  types/index.ts       # 모든 TypeScript 타입 정의
  messages/            # i18n 메시지 (ko.json, en.json)
workspaces/            # 에이전트 작업 디렉토리 (git clone)
data/                  # SQLite DB 파일 저장
```

## Key Types (src/types/index.ts)
- `User` - 사용자 (id, email, name, avatar, isAdmin, maxAgents, maxTurns, allowedClis)
- `Project` - 프로젝트 (repoUrl, provider, accessToken, labelTarget, checkInterval, scannerActive)
- `Agent` - AI 에이전트 (cliName, cliPath, maxTurns, status: available/busy/offline)
- `ProjectAssignment` - 프로젝트-에이전트 배정
- `TaskExecution` - 실행 기록 (issueIid, status, tokens, cost, turns)
- `CliName` = 'claude' | 'gemini' | 'codex' | 'opencode'

## Core Flow
1. **Scanner** (`scanner.ts`): 주기적으로 프로젝트의 GitLab/GitHub 이슈를 폴링
2. 대상 레이블이 있는 이슈 발견 → DB에 실행(TaskExecution) 생성
3. 배정된 에이전트가 CLI(claude, gemini 등)를 node-pty로 실행
4. WebSocket으로 실행 로그를 실시간 스트리밍 (xterm.js)
5. 완료 시 MR/PR 생성 또는 이슈 코멘트

## Design Guide
UI 컴포넌트 작성/수정 시 반드시 [DESIGN_GUIDE.md](DESIGN_GUIDE.md)를 따를 것.
핵심: rounded-lg 통일, font-bold 통일, shadow 금지, ive-* 색상만 사용.

## Scanner 원칙
- 스캐너는 DB 상태만으로 판단. 노트/레이블 기반 스케줄링 금지.
- 임시방편 덧대기 금지.

## Commands
```bash
npm run dev          # 개발 서버 (tsx server.ts)
npm run build        # Next.js 빌드
npm run start        # 프로덕션 서버
npm run deploy       # Docker 빌드 + 푸시 (수동 시에만, CI/CD가 자동 배포)
```

<!-- ive:begin -->
## IVE 작업 등록

이 프로젝트는 **IVE** (Springware IVE 관리 대상)입니다.

사용자가 "IVE용 이슈로 정리해줘", "IVE에 등록해줘" 등의 요청을 하면
대화 맥락에서 의미 단위로 작업을 쪼개어 **Git 이슈를 직접 생성**하세요.
IVE 스캐너가 이슈를 자동 감지하여 보고서에 반영합니다.

### 이슈 생성 규칙

1. 작업 단위로 각각 **Git 이슈를 생성**한다 (GitLab/GitHub API 또는 `gh`/`glab` CLI 사용)
2. 이슈에 레이블 `IVE`, `IVE-E`를 부착한다. 이슈는 **열린 상태로 둔다** (닫지 않는다).
   - IVE 스캐너가 이슈를 감지 → 유입으로 카운팅 → 처리 후 자동으로 닫는다.
3. `title`은 간결하게 (이슈 제목이 보고서에 표시됨)
4. 이슈 본문(description/body)에 포함할 것:
   - 변경한 파일 목록
   - 관련 커밋 SHA
   - 작업 요약 (마크다운)
5. 하나의 대화에서 여러 기능을 작업했다면 **의미 단위로 쪼개서 각각 이슈 생성**

### 메타데이터 (필수)

이슈 본문 **맨 끝에** 반드시 아래 형식의 HTML 주석을 추가하세요. IVE 보고서에서 토큰 사용량과 비용을 집계합니다.
GitLab/GitHub UI에서는 보이지 않으며, IVE 스캐너가 파싱합니다.

```
<!-- ive-meta
model: <모델명 (예: claude-opus-4-6)>
input_tokens: <숫자>
output_tokens: <숫자>
cost_usd: <숫자>
turns: <숫자>
started_at: <ISO 시각>
ended_at: <ISO 시각>
-->
```

`started_at` / `ended_at` 은 **한국시간(KST, +09:00)** 으로 기재. UTC `Z` 표기 사용 금지. 형식 예: `TZ=Asia/Seoul date +"%Y-%m-%dT%H:%M:%S+09:00"`

> ⚠️ **작업시간은 반드시 실측한다. 임의로 찍지 말 것.**
> `started_at` 은 *이 작업을 이번 세션에서 처음 다루기 시작한 시각*, `ended_at` 은 *이슈를 등록하는 현재 시각*이다. 둘 다 추측·반올림·관행적 값(예: 무조건 1h, 30m)으로 채우지 말고 실제 경과 시간을 측정해서 기입한다.
>
> 측정 방법:
> 1. 작업을 시작할 때(또는 늦어도 이슈 등록 직전에 회고할 때) 세션에서 그 작업을 처음 처리한 시각을 `started_at` 의 기준으로 잡는다. 세션 첫 메시지/첫 도구 실행 시각이 그 기준이다.
> 2. 이슈 등록 시점에 `ended_at = 현재 시각`(`TZ=Asia/Seoul date +"%Y-%m-%dT%H:%M:%S+09:00"`)을 찍는다.
> 3. `ended_at − started_at` 이 실제 소요 시간이며, 이 값을 그대로 `/spend` 에도 사용한다.
>
> 한 세션에서 여러 작업/이슈를 나눠 처리했다면, 각 이슈의 실제 처리 구간만큼만 분배해서 기재한다. 전체 세션 길이를 모든 이슈에 중복으로 찍지 않는다.

### 작업시간 기록 (GitLab Time Tracking, 필수)

GitLab UI의 **Time tracking** 패널에 작업시간이 표시되도록 이슈 생성 후 `/spend` quick action을 코멘트로 추가하세요. ive-meta의 `started_at`/`ended_at`만으로는 GitLab Time tracking에 반영되지 않습니다.

```
/spend <시간> [<날짜>]
```

`/spend` 에 넣는 값도 **실측값**이어야 한다. ive-meta의 `ended_at − started_at` 으로 계산한 실제 경과 시간을 그대로 적는다. 어림짐작이나 관행적인 고정값(예: 무조건 1h)을 적지 않는다.

예시:
- `/spend 2h 45m` — 2시간 45분 기록 (작성 시점 날짜)
- `/spend 1h 2026-04-24` — 특정 날짜에 1시간 기록
- `/estimate 3h` — 예상 시간 설정 (선택사항)

GitLab CLI로 추가하는 방법:
```
glab issue note <ID> -R <project> --message "/spend 2h 45m"
```

작업이 여러 이슈에 분산됐다면 각 이슈에 해당 부분만큼만 `/spend`. ive-meta의 시간 범위와 GitLab Time tracking 합계가 일치해야 합니다.

### 참고

- IVE 서버 주소나 IVE 토큰은 **필요하지 않습니다**
- Git에 이슈를 만들기만 하면 IVE가 자동 인식합니다
- 이슈 생성 후 결과(이슈 번호, URL)를 사용자에게 보여주세요
<!-- ive:end -->
