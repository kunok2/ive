# Spring IVE

> **AI가 개발을 하고, 사람은 가치를 관리한다.**

GitLab 이슈를 AI 에이전트가 자동으로 처리하는 통합 자동화 플랫폼입니다. 이슈 감지 → 코드 수정 → MR 생성 → 검증까지 전 과정을 자동화하여, 사람은 방향과 가치 판단에만 집중할 수 있게 합니다.

---

## 개념

```
GitLab 이슈 (IVE 레이블)
        ↓  스캐너가 감지
   개발 에이전트 배정
        ↓  레포 클론 → 코드 수정 → MR 생성
   IVE(D) → IVE(V) 전환
        ↓  검증 에이전트 배정
   검증 완료 → IVE(E) (완료)
```

이슈에 `IVE` 레이블을 붙이면, 이후 모든 과정은 AI가 처리합니다.

---

## 주요 기능

- **자동 스캐너** — 설정된 주기마다 GitLab 이슈를 감지하여 AI 에이전트에 배정
- **2단계 워크플로** — 개발(코드 수정 + MR) → 검증 단계 자동 전환
- **멀티슬롯 병렬 처리** — 같은 에이전트를 N개 슬롯으로 배정해 N개 이슈 동시 처리
- **실시간 실행 추적** — xterm.js 터미널로 에이전트 작업 로그 실시간 확인
- **강제 종료** — 고착된 실행을 즉시 kill (프로세스 그룹 단위)
- **이슈 등록** — 앱 내에서 GitLab 이슈 직접 생성 및 바로 개발 의뢰 지정
- **접근 토큰 암호화** — AES-256-GCM으로 GitLab 토큰 저장

---

## 워크플로 레이블

| 레이블 | 의미 | 기본값 |
|--------|------|--------|
| `IVE` | 처리 대상 (입력) | `IVE` |
| `IVE(D)` | 개발 진행 중 | `IVE(D)` |
| `IVE(DF)` | 개발 실패 | `IVE(DF)` |
| `IVE(V)` | 검증 대기/진행 중 | `IVE(V)` |
| `IVE(VF)` | 검증 실패 | `IVE(VF)` |
| `IVE(E)` | 완료 | `IVE(E)` |

레이블명은 프로젝트별로 변경 가능합니다.

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Next.js 16 (App Router) |
| 언어 | TypeScript 5 |
| UI | React 19, Tailwind CSS 4 |
| 터미널 | xterm.js (SSE 스트리밍) |
| DB | SQLite (better-sqlite3) |
| 인증 | JWT (jsonwebtoken) |
| 암호화 | AES-256-GCM (bcryptjs) |
| AI 에이전트 | Claude, Gemini, Codex (CLI) |

---

## 시작하기

### 요구사항

- Node.js 18+
- AI 에이전트 CLI (예: `claude` — Claude Code CLI)
- GitLab Personal Access Token (api 스코프)

### 설치 및 실행

```bash
git clone git@gitlab.com:kojoung/ive.git
cd ive
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속.

기본 관리자 계정:
- 이메일: `admin@ive.local`
- 비밀번호: `admin`

### 프로덕션 빌드

```bash
npm run build
npm start
```

---

## 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `ENCRYPTION_KEY` | GitLab 토큰 암호화 키 | `spring-ive-dev-encryption-key-change-in-prod` |

> **주의:** 프로덕션에서는 반드시 `ENCRYPTION_KEY`를 안전한 값으로 변경하세요.

---

## 사용 방법

### 1. 프로젝트 등록

**프로젝트** 탭 → **새 프로젝트** → GitLab 레포 URL과 액세스 토큰 입력

### 2. 역할 정의

프로젝트 상세 → **역할 추가**
- **개발** 역할: 코드 수정 담당
- **검증** 역할: 결과물 검토 담당
- 최대 에이전트 수(슬롯) 설정으로 병렬 처리 수 조절

### 3. 에이전트 등록 및 배정

**Agent** 탭 → AI 에이전트 CLI 경로 등록 → 역할에 에이전트 배정

같은 에이전트를 여러 슬롯으로 배정하면 병렬로 여러 이슈를 동시 처리합니다.

### 4. 자동화 시작

- GitLab 이슈에 `IVE` 레이블 부착
- 스캐너가 자동 감지 후 에이전트 배정
- 또는 프로젝트 카드의 **수동 스캔** 버튼으로 즉시 실행

### 5. 모니터링

프로젝트 카드 → **실행 기록** → 실시간 터미널 로그 확인 / 강제 종료

---

## 프로젝트 구조

```
src/
├── app/
│   ├── api/
│   │   ├── auth/                  # 인증 (로그인, 로그아웃)
│   │   ├── agents/                # 에이전트 CRUD
│   │   ├── projects/[id]/
│   │   │   ├── roles/             # 역할 및 에이전트 배정
│   │   │   ├── executions/        # 실행 기록 조회
│   │   │   ├── issues/            # GitLab 이슈 생성
│   │   │   └── scan/              # 수동 스캔 트리거
│   │   └── executions/[id]/
│   │       ├── logs/              # SSE 로그 스트리밍
│   │       └── kill/              # 강제 종료
│   └── projects/[id]/             # 프로젝트 상세 페이지
├── components/
│   ├── project/                   # ProjectCard, ExecutionTrace
│   ├── role/                      # RoleCard, RoleForm
│   ├── agent/                     # AgentCard, AgentAssignList
│   └── ui/                        # Modal, ConfirmModal
└── lib/
    ├── db.ts                      # SQLite 스키마 및 CRUD
    ├── scanner.ts                 # 백그라운드 스캐너 및 태스크 실행
    ├── gitlab.ts                  # GitLab API 연동
    ├── crypto.ts                  # 토큰 암호화
    └── store.tsx                  # React 전역 상태
```

---

## 데이터 저장 위치

| 경로 | 내용 |
|------|------|
| `data/spring-ive.db` | SQLite 데이터베이스 |
| `data/logs/*.log` | 에이전트 실행 로그 |
| `workspaces/` | 작업 중 임시 레포 (완료 후 자동 삭제) |
