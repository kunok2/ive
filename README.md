# Spring IVE

> **AI develops, humans manage value.**

An integrated automation platform where AI agents automatically handle GitLab/GitHub issues. From issue detection to code modification to MR/PR creation, the entire process is automated so humans can focus solely on direction and value judgment.

---

## Concept

```
GitLab/GitHub Issue (IVE label)
        |  Scanner detects
   Dev agent assigned
        |  Clone repo -> Modify code -> Create MR/PR
   Complete (status managed via local DB)
```

Once you attach the `IVE` label to an issue, AI handles everything from there.
Status management (waiting/in-progress/done/failed) is handled in the local DB, while only the `IVE` label is maintained on the remote issue.

---

## Key Features

- **Auto Scanner** — Detects GitLab issues at configured intervals and assigns them to AI agents
- **Auto Development** — Automatically handles code modification + MR/PR creation
- **Local DB Status Management** — Only the IVE label on remote issues; status tracked in local DB
- **Real-time Execution Tracking** — Monitor agent work logs in real-time via xterm.js terminal
- **Force Kill** — Instantly kill stuck executions (process group level)
- **Issue Creation** — Create GitLab issues directly from the app and assign for development
- **Access Token Encryption** — GitLab tokens stored with AES-256-GCM encryption

---

## Status Management

Issue status is managed in the **local DB**. The `IVE` label on remote issues is used only for tagging purposes.

| Status | Meaning |
|--------|---------|
| `waiting` | Waiting to be processed |
| `dev` | Development in progress |
| `done` | Completed |
| `dev_fail` | Development failed |

---

## Tech Stack

| Area | Technology |
|------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| UI | React 19, Tailwind CSS 4 |
| Terminal | xterm.js (SSE streaming) |
| DB | SQLite (better-sqlite3) |
| Auth | JWT (jsonwebtoken) |
| Encryption | AES-256-GCM (bcryptjs) |
| AI Agents | Claude, Gemini, Codex (CLI) |

---

## Getting Started

### Requirements

- Node.js 18+
- AI agent CLI (e.g., `claude` — Claude Code CLI)
- GitLab Personal Access Token (api scope) or GitHub Personal Access Token

### Installation & Running

```bash
git clone git@gitlab.com:kojoung/ive.git
cd ive
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

Default admin account:
- Email: `admin@ive.local`
- Password: `admin`

### Production Build

```bash
npm run build
npm start
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ENCRYPTION_KEY` | Encryption key for GitLab tokens | `spring-ive-dev-encryption-key-change-in-prod` |

> **Warning:** In production, make sure to change `ENCRYPTION_KEY` to a secure value.

---

## Usage

### 1. Register a Project

**Projects** tab → **New Project** → Enter GitLab repo URL and access token

### 2. Define Roles

Project details → **Add Role**
- **Development** role: Handles code modifications
- **Verification** role: Reviews deliverables
- Set max agent count (slots) to control parallel processing

### 3. Register & Assign Agents

**Agent** tab → Register AI agent CLI path → Assign agents to roles

Assigning the same agent to multiple slots enables parallel processing of multiple issues simultaneously.

### 4. Start Automation

- Attach the `IVE` label to a GitLab issue
- Scanner auto-detects and assigns an agent
- Or use the **Manual Scan** button on the project card for immediate execution

### 5. Monitoring

Project card → **Execution History** → View real-time terminal logs / Force kill

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/                  # Authentication (login, logout)
│   │   ├── agents/                # Agent CRUD
│   │   ├── projects/[id]/
│   │   │   ├── roles/             # Roles and agent assignments
│   │   │   ├── executions/        # Execution history
│   │   │   ├── issues/            # GitLab issue creation
│   │   │   └── scan/              # Manual scan trigger
│   │   └── executions/[id]/
│   │       ├── logs/              # SSE log streaming
│   │       └── kill/              # Force kill
│   └── projects/[id]/             # Project detail page
├── components/
│   ├── project/                   # ProjectCard, ExecutionTrace
│   ├── role/                      # RoleCard, RoleForm
│   ├── agent/                     # AgentCard, AgentAssignList
│   └── ui/                        # Modal, ConfirmModal
└── lib/
    ├── db.ts                      # SQLite schema and CRUD
    ├── scanner.ts                 # Background scanner and task execution
    ├── gitlab.ts                  # GitLab API integration
    ├── crypto.ts                  # Token encryption
    └── store.tsx                  # React global state
```

---

## Data Storage Locations

| Path | Contents |
|------|----------|
| `data/spring-ive.db` | SQLite database |
| `data/logs/*.log` | Agent execution logs |
| `workspaces/` | Temporary repos during work (auto-deleted after completion) |
