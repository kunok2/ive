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
