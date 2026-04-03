import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { getSystemSetting, getProject, getProjectAssignments, countActiveExecutionsByAgent, updateChatSessionCliId } from './db'
import { decrypt } from './crypto'
import { defaultLocale } from '@/i18n/config'
import { Agent, Project } from '@/types'

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

/**
 * Pick an available agent assigned to the project.
 * An agent is available only if it has no active (running) executions.
 */
export function pickAgentForChat(projectId: string): { agent: Agent; token: string } | null {
  const project = getProject(projectId)
  if (!project) return null
  const assignments = getProjectAssignments(projectId)
  if (assignments.length === 0) return null
  const decryptedToken = decrypt(project.accessToken)

  for (const pa of assignments) {
    const activeCount = countActiveExecutionsByAgent(pa.agentId)
    if (activeCount === 0) {
      let token = decryptedToken
      if (pa.accessToken) {
        try { token = decrypt(pa.accessToken) } catch { /* use project token */ }
      }
      return { agent: pa.agent, token }
    }
  }
  return null // All agents busy
}

/**
 * Resolve CLI path (same logic as scanner).
 */
async function resolveCliPath(agent: Agent): Promise<string> {
  const systemCliPath = getSystemSetting(`cli.${agent.cliName}.path`)
  let resolved = systemCliPath || agent.cliPath
  const mainBin = resolved.split(' ')[0]
  if (!fs.existsSync(mainBin)) {
    try {
      const { stdout } = await execFile('which', [path.basename(mainBin)])
      const detected = stdout.trim()
      if (detected) resolved = resolved.replace(mainBin, detected)
    } catch { /* keep original */ }
  }
  return resolved
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
  const { cliSessionId, project, agent, token, issueIid, issueTitle, issueDescription, userMessage, workspacePath, userLocale } = opts

  const locale = userLocale || getSystemSetting('locale') || defaultLocale
  const isKo = locale === 'ko'
  const langInstruction = isKo
    ? 'You MUST respond in the user\'s language: Korean (ko). 모든 출력 — 답변, 설명, 코드 코멘트, 요약 — 반드시 한국어로 작성하세요. All output MUST be written in Korean.'
    : 'You MUST respond in the user\'s language: English (en). All output must be in English.'

  const isFirstMessage = !cliSessionId
  const resolvedCliPath = await resolveCliPath(agent)
  const isOpenCode = agent.cliName === 'opencode'
  const cliParts = resolvedCliPath.split(' ')
  const mainCmd = cliParts[0]

  // MCP config
  const mcpConfigRaw = getSystemSetting('mcp.config')
  let mcpServers: Record<string, any> | null = null
  if (mcpConfigRaw) {
    try { mcpServers = JSON.parse(mcpConfigRaw) } catch { /* ignore */ }
  }

  // Build prompt
  let prompt: string
  if (isFirstMessage) {
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

  let args: string[]
  let spawnEnv: Record<string, string | undefined>

  if (isOpenCode) {
    const opencodeConfig: any = {
      agent: { coder: { steps: 20, permission: 'allow' } },
      compaction: { auto: true },
    }
    if (mcpServers) opencodeConfig.mcp = mcpServers

    args = [...cliParts.slice(1), 'run', '--format', 'json']
    if (cliSessionId) {
      args.push('-s', cliSessionId)
    }
    args.push(prompt)

    spawnEnv = {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig),
      IVE_GITLAB_TOKEN: token,
      IVE_GITHUB_TOKEN: token,
    }
  } else {
    // Claude Code MCP setup
    if (mcpServers) {
      const claudeMcp: Record<string, any> = {}
      for (const [name, cfg] of Object.entries(mcpServers)) {
        if ((cfg as any).type === 'local' && Array.isArray((cfg as any).command) && (cfg as any).command.length > 0) {
          claudeMcp[name] = { command: (cfg as any).command[0], args: (cfg as any).command.slice(1), ...((cfg as any).environment ? { env: (cfg as any).environment } : {}) }
        } else if ((cfg as any).type === 'remote' && (cfg as any).url) {
          claudeMcp[name] = { url: (cfg as any).url, ...((cfg as any).headers ? { headers: (cfg as any).headers } : {}) }
        }
      }
      if (Object.keys(claudeMcp).length > 0) {
        try { fs.writeFileSync(path.join(workspacePath, '.mcp.json'), JSON.stringify({ mcpServers: claudeMcp }, null, 2)) } catch { /* ignore */ }
      }
    }

    args = [
      ...cliParts.slice(1),
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', '20',
      '--allowedTools', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash', 'WebFetch',
    ]
    if (cliSessionId) {
      args.push('--resume', cliSessionId)
    }
    args.push('-p', prompt)

    spawnEnv = {
      ...process.env,
      GITLAB_TOKEN: token, GITLAB_API_TOKEN: token,
      GITHUB_TOKEN: token,
      IVE_GITLAB_TOKEN: token,
      IVE_GITHUB_TOKEN: token,
    }
  }

  return { mainCmd, args, spawnEnv, isOpenCode, workspacePath, issueIid }
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
  const { mainCmd, args, spawnEnv, isOpenCode, workspacePath, issueIid } = await prepareChatSpawn(opts)

  const child = spawn(mainCmd, args, {
    cwd: workspacePath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv as NodeJS.ProcessEnv,
    detached: true,
  })

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
            const sid = extractSessionId(event, isOpenCode)
            if (sid) {
              capturedCliSessionId = sid
              onEvent({ type: 'session_id', content: sid })
              updateChatSessionCliId(sessionId, sid)
            }
          }

          const text = extractTextFromEvent(event, isOpenCode)
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
  const { mainCmd, args, spawnEnv, isOpenCode, workspacePath, issueIid } = await prepareChatSpawn(opts)

  const child = spawn(mainCmd, args, {
    cwd: workspacePath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: spawnEnv as NodeJS.ProcessEnv,
    detached: true,
  })

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
            const sid = extractSessionId(event, isOpenCode)
            if (sid) {
              capturedCliSessionId = sid
              textChunks.push({ type: 'session_id', content: sid })
              updateChatSessionCliId(sessionId, sid)
            }
          }

          const text = extractTextFromEvent(event, isOpenCode)
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
function extractSessionId(event: any, isOpenCode: boolean): string | null {
  if (isOpenCode) {
    // OpenCode: session info in init/session event
    if (event.session?.id) return event.session.id
    if (event.sessionId) return event.sessionId
    if (event.type === 'session' && event.id) return event.id
  } else {
    // Claude Code: session_id in init or system event
    if (event.session_id) return event.session_id
    if (event.type === 'system' && event.session_id) return event.session_id
  }
  return null
}

/**
 * Extract text content from a CLI event (Claude Code or OpenCode).
 */
function extractTextFromEvent(event: any, isOpenCode: boolean): string | null {
  if (isOpenCode) {
    if (event.type === 'text') {
      return event.part?.text ?? event.content ?? event.text ?? null
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
