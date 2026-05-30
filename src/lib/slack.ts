import crypto from 'crypto'
import {
  getProjectsByUser,
  getSlackThreadSession, createSlackThreadSession, updateSlackThreadCliSession,
} from './db'
import {
  pickAgentForChat, prepareGeneralWorkspace,
  runChatAgentWithCallback, isChatAgentRunning,
} from './chat-agent'

const SLACK_API = 'https://slack.com/api'

/** 서명 검증·API 호출에 필요한, 복호화된 워크스페이스 정보 */
export interface DecryptedWorkspace {
  id: string
  teamId: string
  botToken: string
  signingSecret: string
  botUserId: string
  defaultUserId: string | null
}

// ── 서명 검증 (Slack → IVE 위조 차단) ──

/**
 * Slack 요청 서명 검증 (HMAC-SHA256).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(opts: {
  signingSecret: string
  timestamp: string | null
  signature: string | null
  rawBody: string
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = opts
  if (!timestamp || !signature) return false

  // Replay 방지: ±5분
  const ts = parseInt(timestamp, 10)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false

  const base = `v0:${timestamp}:${rawBody}`
  const hmac = crypto.createHmac('sha256', signingSecret).update(base).digest('hex')
  const expected = `v0=${hmac}`
  try {
    const a = Buffer.from(expected)
    const b = Buffer.from(signature)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── Slack Web API ──

async function slackApi(botToken: string, method: string, payload: Record<string, any>): Promise<any> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }))
  if (!json.ok) {
    console.warn(`[Slack] ${method} failed:`, json.error)
  }
  return json
}

/** 봇 토큰으로 워크스페이스 정보 조회 (team_id, 봇 user id 자동 발견용) */
export async function slackAuthTest(botToken: string): Promise<{ ok: boolean; teamId?: string; teamName?: string; botUserId?: string; error?: string }> {
  const res = await fetch(`${SLACK_API}/auth.test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}` },
  })
  const json = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }))
  if (!json.ok) return { ok: false, error: json.error || 'auth_failed' }
  return { ok: true, teamId: json.team_id, teamName: json.team, botUserId: json.user_id }
}

async function postMessage(botToken: string, channel: string, text: string, threadTs?: string): Promise<string | null> {
  const json = await slackApi(botToken, 'chat.postMessage', {
    channel, text, ...(threadTs ? { thread_ts: threadTs } : {}),
  })
  return json.ok ? (json.ts as string) : null
}

async function updateMessage(botToken: string, channel: string, ts: string, text: string): Promise<void> {
  await slackApi(botToken, 'chat.update', { channel, ts, text })
}

// ── 텍스트 파싱 ──

/** `<@U123>` 형태의 봇 멘션을 제거하고 트림 */
export function stripBotMention(text: string, botUserId: string): string {
  return text
    .replace(new RegExp(`<@${botUserId}>`, 'g'), '')
    .replace(/<@[A-Z0-9]+>/g, '') // 다른 멘션도 정리
    .trim()
}

/**
 * 메시지에서 첫 이슈 번호를 추출. 못 찾으면 null.
 * `#20`, `이슈 20`, `20번 작업`, GitLab/GitHub URL `/issues/20`
 */
export function parseIssueNumber(text: string): number | null {
  const patterns: RegExp[] = [
    /\/(?:issues|-\/issues)\/(\d+)/, // URL
    /#(\d+)/,
    /이슈\s*(\d+)/,
    /(\d+)\s*번\s*(?:작업|이슈)/,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

// ── 멘션 처리 (백그라운드) ──

interface AppMentionEvent {
  type: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  channel?: string
  bot_id?: string
  subtype?: string
}

/**
 * app_mention 이벤트 처리. events 라우트가 200 ACK 후 fire-and-forget으로 호출.
 * 커스텀 long-running 서버라 응답 이후에도 안전하게 백그라운드 실행됨.
 */
export async function handleAppMention(workspace: DecryptedWorkspace, event: AppMentionEvent): Promise<void> {
  const { botToken } = workspace
  const channel = event.channel
  const slackUser = event.user
  if (!channel || !slackUser) return

  // 봇 자기 멘션/봇 메시지 무한루프 차단
  if (event.bot_id || event.subtype || slackUser === workspace.botUserId) return

  // 답변 포스팅 대상: 스레드 안에서 부른 경우에만 스레드, 평소엔 채널에 바로 답.
  const replyTs = event.thread_ts
  const cleanText = stripBotMention(event.text || '', workspace.botUserId)

  try {
    // ── [1단계] 그냥 대화 ──
    // 목표: 초대 → 멘션 → 채널에 바로 답 → 같은 채널이면 대화 이어짐.
    // 프로젝트/이슈 바인딩 같은 고도화는 후속 단계에서.

    // 멘션을 처리할 IVE 유저 = 워크스페이스 기본 유저
    const iveUserId = workspace.defaultUserId
    if (!iveUserId) {
      await postMessage(botToken, channel, `관리자 설정에서 이 워크스페이스의 기본 IVE 유저를 먼저 지정해 주세요.`, replyTs)
      return
    }

    // 에이전트 풀 + 작업 디렉토리를 위해 유저의 프로젝트 하나를 사용
    const projects = getProjectsByUser(iveUserId)
    const project = projects[0]
    if (!project) {
      await postMessage(botToken, channel, `대화에 사용할 프로젝트/에이전트가 아직 없어요. 관리자에게 문의해 주세요.`, replyTs)
      return
    }

    // 대화 연속성: 채널 단위로 CLI 세션 유지 (같은 채널이면 이어서 대화)
    const sessionKey = `slack:${workspace.id}:${channel}`
    if (isChatAgentRunning(sessionKey)) {
      await postMessage(botToken, channel, `아직 이전 메시지를 처리 중이에요. 잠시만요…`, replyTs)
      return
    }

    let session = getSlackThreadSession(workspace.id, channel, channel)
    if (!session) {
      createSlackThreadSession({ workspaceId: workspace.id, channelId: channel, threadTs: channel, issueIid: null })
      session = getSlackThreadSession(workspace.id, channel, channel)
    }
    const cliSessionId = session?.cliSessionId ?? null

    const picked = pickAgentForChat(project.id, iveUserId)
    if (!picked) {
      await postMessage(botToken, channel, `지금은 응답 가능한 에이전트가 없어요. 잠시 후 다시 말 걸어 주세요.`, replyTs)
      return
    }
    const { agent, token } = picked
    const workspacePath = prepareGeneralWorkspace(project.id)

    // 처리 중 placeholder
    const msgTs = await postMessage(botToken, channel, `:speech_balloon: …`, replyTs)

    // CLI 구동 + Slack 스트리밍 (throttled chat.update)
    let full = ''
    let lastUpdate = 0
    const flush = async (force: boolean) => {
      if (!msgTs) return
      const now = Date.now()
      if (!force && now - lastUpdate < 1500) return
      lastUpdate = now
      const text = full.trim()
      if (text) await updateMessage(botToken, channel, msgTs, text.slice(0, 38000))
    }

    await runChatAgentWithCallback(
      {
        sessionId: sessionKey,
        cliSessionId,
        project,
        agent,
        token,
        issueIid: 0,
        issueTitle: '',
        issueDescription: '',
        userMessage: cleanText,
        workspacePath,
        generalMode: true,
      },
      (ev) => {
        if (ev.type === 'session_id' && ev.content) {
          updateSlackThreadCliSession(workspace.id, channel, channel, ev.content)
        } else if (ev.type === 'text' && ev.content) {
          full += ev.content
          void flush(false)
        } else if (ev.type === 'done') {
          void flush(true)
        } else if (ev.type === 'error') {
          full += `\n\n:warning: ${ev.content || '오류가 발생했습니다.'}`
          void flush(true)
        }
        return true
      },
    )

    if (msgTs && !full.trim()) {
      await updateMessage(botToken, channel, msgTs, `(응답이 비어 있어요. 다시 한 번 말 걸어 주세요.)`)
    } else if (msgTs) {
      await updateMessage(botToken, channel, msgTs, full.trim().slice(0, 38000))
    }
  } catch (err) {
    console.error('[Slack] handleAppMention error:', err)
    try {
      await postMessage(botToken, channel, `처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.`, replyTs)
    } catch { /* ignore */ }
  }
}
