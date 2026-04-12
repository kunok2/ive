# Spring IVE - Project Guide

## Overview
GitLab/GitHub 이슈를 AI CLI 에이전트(Claude, Gemini, Codex, OpenCode)가 자동 처리하는 웹 대시보드.
Next.js 16 + custom server (node-pty, WebSocket) + SQLite (better-sqlite3).

## Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, Recharts, xterm.js
- **Backend**: Custom HTTP/WS server (`server.ts`), Next.js API Routes
- **DB**: SQLite via better-sqlite3 (`data/spring-ive.db`)
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

이 프로젝트는 **IVE** (Spring IVE 관리 대상)입니다.

사용자가 "IVE용 이슈로 정리해줘", "IVE에 등록해줘" 등의 요청을 하면
대화 맥락에서 의미 단위로 작업을 쪼개어 **Git 이슈를 직접 생성**하세요.
IVE 스캐너가 이슈를 자동 감지하여 보고서에 반영합니다.

### 이슈 생성 규칙

1. 작업 단위로 각각 **Git 이슈를 생성**한다 (GitLab/GitHub API 또는 `gh`/`glab` CLI 사용)
2. 이슈에 아래 **레이블을 반드시 부착**한다:
   - 완료된 작업: `IVE`, `IVE-W`
   - 아직 진행 중인 작업: `IVE`, `IVE-D`
3. `title`은 간결하게 (이슈 제목이 보고서에 표시됨)
4. 이슈 본문(description/body)에 포함할 것:
   - 변경한 파일 목록
   - 관련 커밋 SHA
   - 작업 요약 (마크다운)
5. 하나의 대화에서 여러 기능을 작업했다면 **의미 단위로 쪼개서 각각 이슈 생성**

### 메타데이터 (선택)

토큰 사용량과 비용 등을 IVE 보고서에 반영하려면, 이슈 본문 **맨 끝에** 아래 형식의 HTML 주석을 추가하세요.
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

### 참고

- IVE 서버 주소나 IVE 토큰은 **필요하지 않습니다**
- Git에 이슈를 만들기만 하면 IVE가 자동 인식합니다
- 이슈 생성 후 결과(이슈 번호, URL)를 사용자에게 보여주세요
<!-- ive:end -->
