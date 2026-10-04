import fs from 'fs'
import path from 'path'
import { WebSocket } from 'ws'
import { getProject, getChatSession, saveChatMessage, getAgent, updateChatSessionActivity, getProjectAccess } from './db'
import { decrypt } from './crypto'
import { runChatAgentWithCallback, isChatAgentRunning } from './chat-agent'
import { fetchSingleIssue, downloadProjectUpload } from './provider'

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
export function handleChatWebSocket(ws: WebSocket, userId: string) {
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
      await handleSend(ws, msg, safeSend, userId)
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
  msg: {
    sessionId: string; projectId: string; issueIid: string; message: string; locale?: string
    // 첨부 이미지: 기존 /uploads 로 올린 뒤의 url 목록과(서버가 토큰으로 다시 다운로드),
    // 대화 기록에 남길 마크다운 목록(선택).
    imageUrls?: string[]; imageMarkdowns?: string[]
  },
  safeSend: (data: object) => void,
  userId: string,
) {
  const { sessionId, projectId, issueIid, message, locale, imageUrls, imageMarkdowns } = msg
  const hasImages = Array.isArray(imageUrls) && imageUrls.length > 0

  if (!sessionId || (!message?.trim() && !hasImages)) {
    safeSend({ type: 'error', content: 'sessionId and message (or image) required' })
    return
  }

  const session = getChatSession(sessionId)
  if (!session || session.status !== 'active') {
    safeSend({ type: 'error', content: '대화가 종료되었습니다. 새 대화를 시작해 주세요.' })
    return
  }
  // 세션 ID 만 알면 남의 프로젝트 대화에 보낼 수 있었다 — 세션의 프로젝트·작업과 맞는지, 보낸 사람이 그 프로젝트에 접근할 수 있는지 본다.
  // 프로젝트(=토큰)는 메시지가 아니라 세션에서 고른다.
  if (session.projectId !== projectId || String(session.issueIid) !== String(issueIid) || !getProjectAccess(session.projectId, userId)) {
    safeSend({ type: 'error', content: '이 대화에 메시지를 보낼 권한이 없습니다.' })
    return
  }
  const project = getProject(session.projectId)
  if (!project) {
    safeSend({ type: 'error', content: 'Project not found' })
    return
  }

  if (isChatAgentRunning(sessionId)) {
    safeSend({ type: 'error', content: '에이전트가 아직 이전 메시지에 답하는 중입니다. 답이 끝난 뒤 다시 보내 주세요.' })
    return
  }

  const decryptedToken = decrypt(project.accessToken)

  // 첨부 이미지: 프론트가 /uploads 로 올린 url 을 토큰으로 다시 다운로드해
  // 워크스페이스 하위에 저장하고, 그 경로를 에이전트에 넘긴다(Slack 과 동일 패턴).
  const attachedImages: string[] = []
  if (hasImages && session.workspacePath) {
    const destDir = path.join(session.workspacePath, '.chat-attachments')
    try { fs.mkdirSync(destDir, { recursive: true }) } catch { /* ignore */ }
    for (let i = 0; i < imageUrls!.length; i++) {
      try {
        const r = await downloadProjectUpload(project, decryptedToken, imageUrls![i])
        if (!r) continue
        const ext = (r.contentType.split(';')[0].split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
        const fp = path.join(destDir, `chat-image-${Date.now()}-${i + 1}.${ext}`)
        fs.writeFileSync(fp, r.buffer)
        attachedImages.push(fp)
      } catch (e) {
        console.error('[chat] image download error:', e)
      }
    }
  }

  // Save user message (이미지 마크다운 포함 — 대화 기록/표시용)
  const userContent = (imageMarkdowns && imageMarkdowns.length > 0)
    ? [message.trim(), ...imageMarkdowns].filter(Boolean).join('\n\n')
    : message.trim()
  saveChatMessage({
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    sessionId,
    role: 'user',
    content: userContent,
  })
  updateChatSessionActivity(sessionId)
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
        attachedImages,
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
