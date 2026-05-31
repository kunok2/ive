import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { getSystemSetting, getProject, getAgentsByUser, countActiveExecutionsByAgent, updateChatSessionCliId, getStaleActiveChatSessions, getChatSession, endChatSession, updateExecutionStatus, updateAgentStatus } from './db'
import { decrypt } from './crypto'
import { defaultLocale } from '@/i18n/config'
import { Agent, Project } from '@/types'
import { resolveCliPath, buildCliInvocation } from './cli-invocation'

const execFile = promisify(require('child_process').execFile)

// Active chat agent processes (sessionId → ChildProcess)
declare global {
  var chatAgents: Map<string, ChildProcess> | undefined
}

function getAgentMap(): Map<string, ChildProcess> {
  if (!global.chatAgents) global.chatAgents = new Map()
  return global.chatAgents
}

export function isChatAgentRunning(sessionId: string): boolean {
  const child = getAgentMap().get(sessionId)
  return !!child && !child.killed && child.exitCode === null
}

/** sessionId가 주어진 접두사로 시작하는 실행 중 프로세스 수 (동시 인스턴스 상한용) */
export function countRunningAgents(prefix: string): number {
  let n = 0
  for (const [key, child] of getAgentMap()) {
    if (key.startsWith(prefix) && !child.killed && child.exitCode === null) n++
  }
  return n
}

export function killChatAgent(sessionId: string) {
  const child = getAgentMap().get(sessionId)
  if (child && !child.killed) {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM')
    } catch {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
    }
  }
  getAgentMap().delete(sessionId)
}

// ── 서버측 채팅 세션 idle 리퍼 ──
// 사용자가 페이지를 떠나면 클라이언트 idle-close 가 동작하지 않는다.
// 실행 중이지 않으면서 N분간 활동이 없는 active 세션을 정리해 에이전트/실행 점유를 푼다
// (스캐너가 에이전트를 다시 쓸 수 있도록 — /chat/end 와 동일한 정리 절차).
const CHAT_IDLE_TIMEOUT_MIN = 10
let chatReaperStarted = false

function reapChatSession(sessionId: string) {
  const session = getChatSession(sessionId)
  if (!session || session.status !== 'active') return
  killChatAgent(sessionId) // 안전망 (호출 시점엔 이미 실행 중이 아님)
  if (session.executionId) {
    try { updateExecutionStatus(session.executionId, 'success', new Date().toISOString()) } catch { /* ignore */ }
  }
  if (session.agentId) {
    try {
      if (countActiveExecutionsByAgent(session.agentId) === 0) updateAgentStatus(session.agentId, 'available')
    } catch { /* ignore */ }
  }
  endChatSession(sessionId)
  console.log(`[ChatReaper] Reaped idle chat session ${sessionId} (issue #${session.issueIid})`)
}

export function startChatSessionReaper() {
  if (chatReaperStarted) return
  chatReaperStarted = true
  setInterval(() => {
    try {
      for (const s of getStaleActiveChatSessions(CHAT_IDLE_TIMEOUT_MIN)) {
        if (isChatAgentRunning(s.id)) continue // 아직 생각 중이면 건드리지 않음
        reapChatSession(s.id)
      }
    } catch (e) {
      console.error('[ChatReaper] error:', e)
    }
  }, 60_000)
  console.log('[ChatReaper] Started')
}

/**
 * Pick an available agent from the requester user's pool.
 * An agent is available only if it has no active (running) executions.
 *
 * #272: 프로젝트 배정 폐기 → 채팅을 시작하는 사용자(requesterUserId)의 풀에서 선택.
 * 풀이 비어있거나 모두 바쁘면 null.
 */
export function pickAgentForChat(projectId: string, requesterUserId: string): { agent: Agent; token: string } | null {
  const project = getProject(projectId)
  if (!project) return null
  const userAgents = getAgentsByUser(requesterUserId)
  if (userAgents.length === 0) return null
  const decryptedToken = decrypt(project.accessToken)

  for (const a of userAgents) {
    const activeCount = countActiveExecutionsByAgent(a.id)
    if (activeCount === 0) {
      return { agent: a, token: decryptedToken }
    }
  }
  return null // All agents busy
}

interface ChatAgentOptions {
  sessionId: string
  cliSessionId: string | null  // null = first message, string = resume
  project: Project
  agent: Agent
  token: string
  issueIid: number
  issueTitle: string
  issueDescription: string
  userMessage: string
  workspacePath: string
  userLocale?: string
  generalMode?: boolean  // true = 이슈 미바인딩 일반 질문 (워크스페이스/이슈 컨텍스트 없음)
  availableProjects?: string[]  // 소유자의 프로젝트 이름 목록 (general 모드에서 "어떤 프로젝트?" 응답용)
}

/**
 * Spawn a chat agent subprocess and stream text responses.
 * First message: sends system prompt + user message, captures CLI session ID.
 * Subsequent messages: resumes CLI session with --resume / -s.
 */
/**
 * Prepare CLI spawn arguments and environment for a chat agent.
 * Shared by both the legacy SSE generator and the WebSocket callback version.
 */
async function prepareChatSpawn(opts: ChatAgentOptions) {
  const { cliSessionId, project, agent, token, issueIid, issueTitle, issueDescription, userMessage, workspacePath, userLocale, generalMode, availableProjects } = opts

  const locale = userLocale || getSystemSetting('locale') || defaultLocale
  const isKo = locale === 'ko'
  const langInstruction = isKo
    ? 'You MUST respond in the user\'s language: Korean (ko). 모든 출력 — 답변, 설명, 코드 코멘트, 요약 — 반드시 한국어로 작성하세요. All output MUST be written in Korean.'
    : 'You MUST respond in the user\'s language: English (en). All output must be in English.'

  const isFirstMessage = !cliSessionId
  const resolvedCliPath = await resolveCliPath(agent)
  const model = getSystemSetting(`cli.${agent.cliName}.model`) || null

  // 이슈 관리에 쓸 CLI (provider별). 토큰은 환경변수에 설정돼 있음.
  const issueCli = project.provider === 'github' ? 'gh' : 'glab'

  // Build prompt
  let prompt: string
  if (isFirstMessage && generalMode) {
    // 이슈 미바인딩 — 프로젝트 레포가 작업 디렉토리에 clone 되어 있음
    const projectsLine = availableProjects && availableProjects.length > 0
      ? `\nThe user owns these IVE projects: ${availableProjects.join(', ')}. If asked which projects exist / are available, list exactly these.\n`
      : ''
    prompt = `You are a helpful AI assistant working in the "${project.name}" project repository. ${langInstruction}

The project's repository is checked out in your current working directory — read and explore the actual code/files to answer accurately. Do NOT describe any other project's code; only this repository.
${projectsLine}
## User Message:
${userMessage}

## Instructions:
- Answer clearly and concisely, grounded in the actual files of this repository.
- You can manage this repository's issues with the \`${issueCli}\` CLI (auth token is already in your environment, run inside this repo). Use it to LIST issues (e.g. \`${issueCli} issue list\`), VIEW an issue (\`${issueCli} issue view <number>\`), or CREATE an issue when asked.
- When asked to create an issue: create it via \`${issueCli}\`, report the new issue's number and URL, then ASK the user whether you should start working on it now.
- If asked to make code changes, make them using git add (do NOT commit or push), then briefly list what you modified.
- IMPORTANT: ${langInstruction}`
  } else if (isFirstMessage) {
    prompt = `You are a helpful AI assistant for issue #${issueIid} "${issueTitle}". ${langInstruction}

You are in a chat session to help the user with questions, quick fixes, or explanations about this issue.

${issueDescription ? `## Original Issue:\n${issueDescription}\n` : ''}
## User Message:
${userMessage}

## Instructions:
- Answer questions clearly and concisely.
- If asked to make code changes, make them using git add (do NOT commit or push).
- After making changes, briefly list what you modified.
- Focus on answering the specific question — do not re-implement the entire issue.
- IMPORTANT: ${langInstruction}`
  } else {
    prompt = userMessage
  }

  // CLI별 명령/인자/환경 조립은 단일 모듈(cli-invocation)에 위임.
  // 채팅은 maxTurns 20 고정, resume(cliSessionId) 지원.
  const inv = buildCliInvocation({
    cliName: agent.cliName,
    resolvedCliPath,
    prompt,
    token,
    workspacePath,
    maxTurns: 20,
    model,
    cliSessionId,
  })

  return { mainCmd: inv.mainCmd, args: inv.args, spawnEnv: inv.env, cliName: agent.cliName, workspacePath, issueIid, stdinInput: inv.stdinInput }
}

/**
 * Run chat agent with a callback for each event (WebSocket-friendly).
 * No timeout — the WebSocket heartbeat keeps the connection alive.
 * If callback returns false, the agent process is killed.
 */
export async function runChatAgentWithCallback(
  opts: ChatAgentOptions,
  onEvent: (event: { type: 'text' | 'done' | 'error' | 'session_id'; content?: string }) => boolean,
): Promise<void> {
  const { sessionId, cliSessionId } = opts
  const { mainCmd, args, spawnEnv, cliName, workspacePath, issueIid, stdinInput } = await prepareChatSpawn(opts)

  const child = spawn(mainCmd, args, {
    cwd: workspacePath,
    stdio: [stdinInput !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    env: spawnEnv as NodeJS.ProcessEnv,
    detached: true,
  })

  // 프롬프트를 stdin으로 전달하는 CLI(opencode)는 여기서 써주고 닫는다.
  if (stdinInput !== undefined && child.stdin) {
    try { child.stdin.write(stdinInput); child.stdin.end() } catch { /* ignore */ }
  }

  getAgentMap().set(sessionId, child)

  let capturedCliSessionId: string | null = null

  return new Promise<void>((resolve) => {
    let stdoutBuffer = ''

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)

          // Capture CLI session ID
          if (!capturedCliSessionId && !cliSessionId) {
            const sid = extractSessionId(event, cliName)
            if (sid) {
              capturedCliSessionId = sid
              onEvent({ type: 'session_id', content: sid })
              updateChatSessionCliId(sessionId, sid)
            }
          }

          const text = extractTextFromEvent(event, cliName)
          if (text) {
            const shouldContinue = onEvent({ type: 'text', content: text })
            if (!shouldContinue) {
              // WebSocket closed — kill the agent
              try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* ignore */ }
              try { child.kill('SIGTERM') } catch { /* ignore */ }
            }
          }
        } catch { /* skip non-JSON */ }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.warn(`[Chat #${issueIid}] stderr: ${msg}`)
    })

    child.on('close', (code) => {
      getAgentMap().delete(sessionId)
      if (code && code !== 0) {
        onEvent({ type: 'error', content: `Process exited with code ${code}` })
      } else {
        onEvent({ type: 'done' })
      }
      resolve()
    })

    child.on('error', (err) => {
      getAgentMap().delete(sessionId)
      onEvent({ type: 'error', content: err.message })
      resolve()
    })
  })
}

/**
 * Legacy SSE-based generator (kept for backward compatibility).
 * Uses the same prepareChatSpawn helper.
 */
export async function* runChatAgent(opts: ChatAgentOptions): AsyncGenerator<{ type: 'text' | 'done' | 'error' | 'session_id'; content?: string }> {
  const { sessionId, cliSessionId } = opts
  const { mainCmd, args, spawnEnv, cliName, workspacePath, issueIid, stdinInput } = await prepareChatSpawn(opts)

  const child = spawn(mainCmd, args, {
    cwd: workspacePath,
    stdio: [stdinInput !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    env: spawnEnv as NodeJS.ProcessEnv,
    detached: true,
  })

  if (stdinInput !== undefined && child.stdin) {
    try { child.stdin.write(stdinInput); child.stdin.end() } catch { /* ignore */ }
  }

  getAgentMap().set(sessionId, child)

  let stdoutBuffer = ''
  const textChunks: { type: 'text' | 'session_id'; content: string }[] = []
  let done = false
  let error: string | null = null
  let capturedCliSessionId: string | null = null

  const resultPromise = new Promise<void>((resolve) => {
    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)

          if (!capturedCliSessionId && !cliSessionId) {
            const sid = extractSessionId(event, cliName)
            if (sid) {
              capturedCliSessionId = sid
              textChunks.push({ type: 'session_id', content: sid })
              updateChatSessionCliId(sessionId, sid)
            }
          }

          const text = extractTextFromEvent(event, cliName)
          if (text) {
            textChunks.push({ type: 'text', content: text })
          }
        } catch { /* skip non-JSON */ }
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) console.warn(`[Chat #${issueIid}] stderr: ${msg}`)
    })

    child.on('close', (code) => {
      done = true
      if (code && code !== 0) error = `Process exited with code ${code}`
      getAgentMap().delete(sessionId)
      resolve()
    })

    child.on('error', (err) => {
      done = true
      error = err.message
      getAgentMap().delete(sessionId)
      resolve()
    })
  })

  // Yield text chunks as they arrive (no hard timeout — WebSocket heartbeat handles liveness)
  while (!done || textChunks.length > 0) {
    if (textChunks.length > 0) {
      const chunk = textChunks.shift()!
      yield chunk
    } else {
      await new Promise(r => setTimeout(r, 100))
    }
  }

  await resultPromise

  if (error) {
    yield { type: 'error', content: error }
  } else {
    yield { type: 'done' }
  }
}

/**
 * Extract CLI session ID from event.
 */
function extractSessionId(event: any, cliName: string): string | null {
  if (cliName === 'opencode') {
    // OpenCode: 각 이벤트에 sessionID(대문자 ID)가 박혀 있음. part 안에도 존재.
    if (event.sessionID) return event.sessionID
    if (event.part?.sessionID) return event.part.sessionID
    if (event.session?.id) return event.session.id
    if (event.sessionId) return event.sessionId
    if (event.type === 'session' && event.id) return event.id
  } else if (cliName === 'codex') {
    // Codex: thread.started 이벤트의 thread_id가 resume에 쓰이는 세션 id
    if (event.type === 'thread.started' && event.thread_id) return event.thread_id
  } else {
    // Claude Code: session_id in init or system event
    if (event.session_id) return event.session_id
    if (event.type === 'system' && event.session_id) return event.session_id
  }
  return null
}

/**
 * Extract text content from a CLI event (Claude Code / OpenCode / Codex).
 */
function extractTextFromEvent(event: any, cliName: string): string | null {
  if (cliName === 'opencode') {
    if (event.type === 'text') {
      return event.part?.text ?? event.content ?? event.text ?? null
    }
  } else if (cliName === 'codex') {
    // Codex: 완료된 agent_message 아이템의 text만 사용자에게 전달
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      return event.item.text ?? null
    }
  } else if (cliName === 'gemini') {
    // Gemini stream-json: assistant 메시지의 content
    if (event.type === 'message' && event.role === 'assistant') {
      return (event.content ?? '').toString() || null
    }
  } else {
    // Claude Code
    if (event.type === 'assistant') {
      const parts = event.message?.content || []
      const texts: string[] = []
      for (const part of parts) {
        if (part.type === 'text' && part.text?.trim()) {
          texts.push(part.text)
        }
      }
      return texts.length > 0 ? texts.join('\n') : null
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta
      if (delta?.type === 'text_delta' && delta.text) return delta.text
    }
  }
  return null
}

/**
 * Prepare a lightweight workspace for an issue-less general chat (no clone).
 * The CLI just needs a cwd; no repository context is provided.
 */
export function prepareGeneralWorkspace(projectId: string): string {
  const workspacePath = path.join(process.cwd(), 'workspaces', projectId, 'chat-general')
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true })
  }
  return workspacePath
}

/**
 * Prepare workspace for chat session (clone + checkout dev branch).
 */
export async function prepareChatWorkspace(project: Project, issueIid: number, token: string): Promise<string> {
  const workspacePath = path.join(process.cwd(), 'workspaces', project.id, `chat-${issueIid}`)

  if (fs.existsSync(workspacePath)) {
    try {
      await execFile('git', ['pull', '--rebase'], { cwd: workspacePath })
      return workspacePath
    } catch {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  }

  fs.mkdirSync(workspacePath, { recursive: true })

  let repoUrl: string
  if (project.authType === 'basic') {
    repoUrl = project.repoUrl.replace('https://', `https://${encodeURIComponent(project.gitUsername)}:${encodeURIComponent(token)}@`)
  } else if (project.provider === 'github') {
    repoUrl = project.repoUrl.replace('https://', `https://x-access-token:${token}@`)
  } else {
    repoUrl = project.repoUrl.replace('https://', `https://oauth2:${token}@`)
  }

  await execFile('git', ['clone', repoUrl, '.'], { cwd: workspacePath })

  const branchName = `dev-${issueIid}`
  try {
    await execFile('git', ['fetch', 'origin', branchName], { cwd: workspacePath })
    await execFile('git', ['checkout', branchName], { cwd: workspacePath })
  } catch {
    console.log(`[Chat] Branch ${branchName} not found, staying on default branch`)
  }

  return workspacePath
}

/** project.repoUrl에 토큰을 끼운 clone URL */
function authedRepoUrl(project: Project, token: string): string {
  if (project.authType === 'basic') {
    return project.repoUrl.replace('https://', `https://${encodeURIComponent(project.gitUsername)}:${encodeURIComponent(token)}@`)
  } else if (project.provider === 'github') {
    return project.repoUrl.replace('https://', `https://x-access-token:${token}@`)
  }
  return project.repoUrl.replace('https://', `https://oauth2:${token}@`)
}

/**
 * 이슈 미바인딩 — 프로젝트 레포(기본 브랜치)를 clone한 작업 디렉토리.
 * 빈 디렉토리(IVE 호스트 레포 노출) 대신 실제 프로젝트 레포를 cwd로 둔다.
 */
export async function prepareProjectWorkspace(project: Project, token: string): Promise<string> {
  const workspacePath = path.join(process.cwd(), 'workspaces', project.id, 'chat-project')

  if (fs.existsSync(workspacePath)) {
    try {
      await execFile('git', ['pull', '--rebase'], { cwd: workspacePath })
      return workspacePath
    } catch {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  }

  fs.mkdirSync(workspacePath, { recursive: true })
  await execFile('git', ['clone', authedRepoUrl(project, token), '.'], { cwd: workspacePath })
  return workspacePath
}
