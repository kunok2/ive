## Commands

```bash
npm run dev          # Dev server (tsx server.ts — Next.js + WS + node-pty)
npm run build        # Next.js production build
npm run start        # Production: NODE_ENV=production tsx server.ts
npm run lint         # ESLint (no config flag, picks up eslint.config.*)
npm run test         # Vitest run (tests/**/*.test.ts)
npm run test:watch   # Vitest watch mode
npm run deploy       # Docker build + push (manual; CI/CD auto-deploys on main push)
npm run docker:up    # docker compose up -d
npm run docker:down  # docker compose down
```

## Tech Stack

- **Framework**: Next.js 16 (App Router) + custom `server.ts` (HTTP/HTTPS + WS + node-pty)
- **Frontend**: React 19, Tailwind CSS 4, xterm.js, Recharts, FontAwesome icons
- **DB**: SQLite — `data/springware-ive.db` via better-sqlite3 (module split: `src/lib/db/`)
- **i18n**: next-intl (ko/en) — plugin in `next.config.mjs` from `src/i18n/request.ts`
- **Auth**: JWT via `ive-token` cookie + bcryptjs
- **Provider**: GitLab + GitHub (dispatched via `src/lib/provider.ts`)
- **Deploy**: Docker (host 3100→container 3000), GitLab CI/CD auto-deploys on main push
- **Logging**: pino + pino-pretty + pino-roll → `data/logs/*.log`

## Architecture Notes

- **Custom server**: `server.ts` boots Next.js, then mounts two WS endpoints:
  - `/api/terminal` — spawns user shell via node-pty (auth by `ive-token` cookie)
  - `/api/chat` — chat WS handled by `src/lib/chat-ws.ts`
  - `/_next/` WS connections pass through (HMR)
- **DB layer**: `src/lib/db/index.ts` exports all query functions; schema in `src/lib/db/schema.ts`
- **Scanner**: `src/lib/scanner/` — polls GitLab/GitHub issues → creates `TaskExecution` → runs CLI via node-pty → creates MR/PR
- **Provider dispatch**: `src/lib/provider.ts` routes all GitLab/GitHub API calls by `project.provider`
- **State**: `src/lib/store.tsx` — React Context with 10s auto-refresh polling
- **Path alias**: `@/*` → `./src/*` (tsconfig + vitest)

## Key Directories

```
src/lib/db/          # SQLite: schema.ts + one file per entity
src/lib/scanner/     # Issue polling → execution pipeline
src/lib/gitlab/      # GitLab API integration
src/lib/github/      # GitHub API integration
src/lib/report-diagnosis/  # Report diagnosis logic
src/lib/report-mailer/     # Report email sending
src/app/api/         # API routes (agents, auth, executions, projects, reports, settings, verifiers, admin)
data/                # springware-ive.db + logs/
workspaces/          # Temp agent repos (auto-deleted after completion)
```

## Testing

- Framework: Vitest (node environment, globals enabled)
- Pattern: `tests/**/*.test.ts`
- Single test: `npm run test -- <pattern>`
- Config: `vitest.config.ts` — `@` alias maps to `./src`

## Scanner Principles

- Scanner decides solely by DB state — no label-based scheduling
- No workarounds or temporary fixes

## UI Development

Follow [DESIGN_GUIDE.md](DESIGN_GUIDE.md):

- Colors: use only `ive-*` tokens (no raw Tailwind palette, no hex literals)
- Rounding: `rounded-lg` (buttons/inputs/cards), `rounded-2xl` (modals), `rounded-full` (avatars)
- Typography: `font-bold` default — `font-semibold`, `font-medium`, `font-black`, `font-extrabold` forbidden
- No `shadow-*` except modals (`shadow-2xl`) and dropdowns (`shadow-lg`)
- Trend deltas: +good→`ive-cyan`, +bad→`ive-red`; ±5%→no color

## Env & Security

- `ENCRYPTION_KEY`: AES-256-GCM key for stored tokens (default: `springware-ive-dev-encryption-key-change-in-prod`)
- `JWT_SECRET`: default `springware-ive-dev-secret-change-in-production` — change in prod
- Sensitive env vars (`JWT_SECRET`, `ENCRYPTION_KEY`, `MAIL_SMTP_*`, `DATABASE_URL`) are stripped from PTY env via `getSafeEnv()` in `server.ts`
- Docker runs as non-root user `ive`

## CI/CD (GitLab)

- `test` stage: runs on main push before deploy
- `deploy` stage: auto build + docker compose restart on main push
- `publish-to-hub` stage: manual Docker Hub push
- Deploy target: `/home/ubuntu/ive` on remote server

<!-- ive:begin -->
## IVE 작업 등록

이 프로젝트는 **IVE** (Springware IVE 관리 대상)입니다.

사용자가 "IVE용 이슈로 정리해줘", "IVE에 등록해줘" 등의 요청을 하면
대화 맥락에서 의미 단위로 작업을 쪼개어 **Git 이슈를 직접 생성**하세요.
IVE 스캐너가 이슈를 자동 감지하여 보고서에 반영합니다.

### 이슈 생성 규칙

1. 작업 단위로 각각 **Git 이슈를 생성**한다 (GitLab/GitHub API 또는 `gh`/`glab` CLI 사용)
2. 이슈에 레이블 `ive`, `ive:done`을 부착한다. 이슈는 **열린 상태로 둔다** (닫지 않는다).
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

`started_at` / `ended_at` 은 **한국시간(KST, +09:00)** 으로 기재. UTC `Z` 표기 사용 금지.

### 작업시간 기록 (GitLab Time Tracking, 필수)

이슈 생성 후 `/spend` quick action을 코멘트로 추가하여 GitLab Time tracking에 반영하세요.

```
/spend <시간> [<날짜>]
```

예: `/spend 2h 45m`, `/spend 1h 2026-04-24`

### 참고

- IVE 서버 주소나 IVE 토큰은 **필요하지 않습니다**
- Git에 이슈를 만들기만 하면 IVE가 자동 인식합니다
- 이슈 생성 후 결과(이슈 번호, URL)를 사용자에게 보여주세요
<!-- ive:end -->
