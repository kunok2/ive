import { WebSocket } from 'ws'
import { getProject, getProjectAccess, getChatSession, saveChatMessage, getAgent, updateChatSessionActivity } from './db'
import { decrypt } from './crypto'
import { runChatAgentWithCallback, isChatAgentRunning } from './chat-agent'
import { fetchSingleIssue } from './provider'

/**
 * Handle a WebSocket connection for chat.
 *
 * Protocol (JSON messages):
 *
 * Client → Server:
 *   { type: 'send', sessionId, projectId, issueIid, message, locale? }
 *   { type: 'pong' }  (response to server ping)
 *
 * Server → Client:
 *   { type: 'text', content }
 *   { type: 'done' }
 *   { type: 'error', content }
 *   { type: 'ping' }  (heartbeat — client should respond with pong)
 */
export function handleChatWebSocket(ws: WebSocket) {
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let alive = true

  // Heartbeat: send ping every 15s, close if no pong within 30s
  function startHeartbeat() {
    stopHeartbeat()
    alive = true
    heartbeatTimer = setInterval(() => {
      if (!alive) {
        // No pong received since last ping — connection dead
        ws.terminate()
        return
      }
      alive = false
      safeSend({ type: 'ping' })
    }, 15_000)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function safeSend(data: object) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  startHeartbeat()

  ws.on('message', async (raw: Buffer) => {
    let msg: any
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      safeSend({ type: 'error', content: 'Invalid JSON' })
      return
    }

    if (msg.type === 'pong') {
      alive = true
      return
    }

    if (msg.type === 'send') {
      await handleSend(ws, msg, safeSend)
      return
    }
  })

  ws.on('close', () => {
    stopHeartbeat()
  })

  ws.on('error', () => {
    stopHeartbeat()
  })

  // Also respond to native WebSocket pings
  ws.on('pong', () => {
    alive = true
  })
}

async function handleSend(
  ws: WebSocket,
  msg: { sessionId: string; projectId: string; issueIid: string; message: string; locale?: string },
  safeSend: (data: object) => void,
) {
  const { sessionId, projectId, issueIid, message, locale } = msg

  if (!sessionId || !message?.trim()) {
    safeSend({ type: 'error', content: 'sessionId and message required' })
    return
  }

  const project = getProject(projectId)
  if (!project) {
    safeSend({ type: 'error', content: 'Project not found' })
    return
  }

  const session = getChatSession(sessionId)
  if (!session || session.status !== 'active') {
    safeSend({ type: 'error', content: 'Session not found or ended' })
    return
  }

  if (isChatAgentRunning(sessionId)) {
    safeSend({ type: 'error', content: 'Agent is still processing' })
    return
  }

  // Save user message
  saveChatMessage({
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    sessionId,
    role: 'user',
    content: message.trim(),
  })
  updateChatSessionActivity(sessionId)

  const decryptedToken = decrypt(project.accessToken)
  let issueTitle = `Issue #${issueIid}`
  let issueDescription = ''
  if (!session.cliSessionId) {
    try {
      const issue = await fetchSingleIssue(project, Number(issueIid), decryptedToken)
      if (issue) {
        issueTitle = issue.title || issueTitle
        issueDescription = issue.description || ''
      }
    } catch { /* use defaults */ }
  }

  const agent = session.agentId ? getAgent(session.agentId) : null
  if (!agent) {
    safeSend({ type: 'error', content: 'Agent not found' })
    return
  }

  // Stream via callback — no timeout, heartbeat keeps connection alive
  let fullResponse = ''

  try {
    await runChatAgentWithCallback(
      {
        sessionId,
        cliSessionId: session.cliSessionId,
        project,
        agent,
        token: decryptedToken,
        issueIid: Number(issueIid),
        issueTitle,
        issueDescription,
        userMessage: message.trim(),
        workspacePath: session.workspacePath || '',
        userLocale: locale || '',
      },
      (event) => {
        // WS가 끊겨도(사용자가 다른 페이지로 이동) 실행을 중단하지 않는다.
        // 출력은 계속 누적해 완료 시 DB에 저장하고, 사용자가 돌아오면 복원/표시한다.
        // (safeSend 는 OPEN 일 때만 전송하므로 끊긴 소켓엔 무해)
        if (event.type === 'text' && event.content) {
          fullResponse += event.content
          safeSend({ type: 'text', content: event.content })
        } else if (event.type === 'done') {
          safeSend({ type: 'done' })
        } else if (event.type === 'error') {
          safeSend({ type: 'error', content: event.content })
        }
        return true // 항상 계속 — 절대 abort 하지 않음
      },
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    safeSend({ type: 'error', content: errMsg })
  }

  // Save assistant response
  if (fullResponse.trim()) {
    saveChatMessage({
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      sessionId,
      role: 'assistant',
      content: fullResponse.trim(),
    })
  }
  // 완료 시각 갱신 — 리퍼의 idle 기준이 응답 완료 이후부터 계산되도록
  updateChatSessionActivity(sessionId)
}
