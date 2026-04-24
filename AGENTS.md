## Commands

```bash
npm run dev        # Dev server (tsx server.ts — HTTP + WebSocket + node-pty)
npm run build     # Next.js production build
npm run start    # Production server
npm run lint     # ESLint
npm run test    # Vitest (tests/**/*.test.ts)
npm run test:watch  # Watch mode
npm run deploy   # Docker build + push (manual)
```

## Tech Stack

- **Framework**: Next.js 16 (App Router) + custom `server.ts` (HTTP/WS + node-pty)
- **Frontend**: React 19, Tailwind CSS 4, xterm.js, Recharts
- **DB**: SQLite — `data/springware-ive.db` via better-sqlite3
- **i18n**: next-intl (ko/en)
- **Auth**: JWT + bcryptjs
- **Deploy**: Docker (port 3100→3000), GitLab CI/CD triggers local build+restart

## Testing

- Run single test: `npm run test -- <pattern>` or vitest directly
- Test files: `tests/**/*.test.ts`

## Scanner Principles

- Scanner decides solely by DB state — no label-based scheduling
- No workarounds or temporary fixes

## UI Development

Follow [DESIGN_GUIDE.md](DESIGN_GUIDE.md):

- Colors: use only `ive-*` tokens (no raw `amber-*`, `red-*`)
- Rounding: `rounded-lg` (buttons/inputs/cards), `rounded-2xl` (modals), `rounded-full` (avatars)
- Typography: `font-bold` default — `font-semibold`, `font-medium` forbidden
- No `shadow-*` except modals/dropdowns

## Core Flow

1. Scanner (`lib/scanner.ts`) polls GitLab/GitHub issues periodically
2. Finds issues with target label → creates `TaskExecution` in DB
3. Assigned agent runs CLI (`claude`/`gemini`/`codex`/`opencode`) via node-pty
4. Logs stream in real-time via WebSocket (xterm.js)
5. On complete: creates MR/PR or adds issue comment

## Key Files

- `src/lib/db.ts` — SQLite schema + all queries
- `src/lib/scanner.ts` — Issue polling + task execution
- `src/lib/provider.ts` — GitLab/GitHub API
- `src/lib/store.tsx` — React client state

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

### 참고

- IVE 서버 주소나 IVE 토큰은 **필요하지 않습니다**
- Git에 이슈를 만들기만 하면 IVE가 자동 인식합니다
- 이슈 생성 후 결과(이슈 번호, URL)를 사용자에게 보여주세요
<!-- ive:end -->