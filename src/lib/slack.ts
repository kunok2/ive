import crypto from 'crypto'
import {
  getProjectsByUser, getSystemSetting, getAgentsByUser,
  getSlackThreadSession, createSlackThreadSession, updateSlackThreadCliSession,
} from './db'
import { decrypt } from './crypto'
import {
  prepareChatWorkspace, prepareProjectWorkspace,
  runChatAgentWithCallback, isChatAgentRunning,
} from './chat-agent'
import { fetchSingleIssue } from './provider'
import { Agent } from '@/types'

const SLACK_API = 'https://slack.com/api'

// ── Slack 앱 자격증명 (앱 단위 1세트, OAuth 로그인·봇설치 공통) ──

/** 봇 설치(Add to Slack) 때 요청하는 bot scope */
export const SLACK_BOT_SCOPES = 'app_mentions:read,chat:write,channels:history,groups:history,channels:read,groups:read'

export interface SlackAppConfig {
  clientId: string
  clientSecret: string
  signingSecret: string
}

/** system_settings에 저장된 Slack 앱 자격증명을 복호화해 반환 */
export function getSlackAppConfig(): SlackAppConfig {
  return {
    clientId: getSystemSetting('slack.client_id') || '',
    clientSecret: decrypt(getSystemSetting('slack.client_secret') || ''),
    signingSecret: decrypt(getSystemSetting('slack.signing_secret') || ''),
  }
}

/** Add to Slack authorize URL */
export function buildInstallUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_BOT_SCOPES,
    redirect_uri: redirectUri,
    state,
  })
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

/** 설치 콜백의 code → 봇 토큰 교환 (oauth.v2.access) */
export async function exchangeInstallCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<{
  ok: boolean; error?: string;
  botToken?: string; teamId?: string; teamName?: string; botUserId?: string; authedUserId?: string;
}> {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const j = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }))
  if (!j.ok) return { ok: false, error: j.error || 'oauth_failed' }
  return {
    ok: true,
    botToken: j.access_token,
    teamId: j.team?.id,
    teamName: j.team?.name,
    botUserId: j.bot_user_id,
    authedUserId: j.authed_user?.id,
  }
}

/** 서명 검증·API 호출에 필요한, 복호화된 워크스페이스 정보 */
export interface DecryptedWorkspace {
  id: string
  teamId: string
  botToken: string
  signingSecret: string
  botUserId: string
  defaultUserId: string | null   // 워크스페이스 소유자(IVE 유저)
}

/** 소유자의 에이전트 중 하나를 선택 (OpenCode 우선, 없으면 첫 에이전트). 남의 에이전트는 쓰지 않음. */
function pickOwnerAgent(ownerUserId: string): Agent | null {
  const list = getAgentsByUser(ownerUserId)
  return list.find(a => a.cliName === 'opencode') || list[0] || null
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
export async function slackAuthTest(botToken: string): Promise<{ ok: boolean; teamId?: string; teamName?: string; teamUrl?: string; botUserId?: string; error?: string }> {
  const res = await fetch(`${SLACK_API}/auth.test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${botToken}` },
  })
  const json = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }))
  if (!json.ok) return { ok: false, error: json.error || 'auth_failed' }
  return { ok: true, teamId: json.team_id, teamName: json.team, teamUrl: json.url, botUserId: json.user_id }
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
 * 응답 출력 싱크 — Slack 포스팅을 추상화해서 로컬 테스트(콘솔)로도 구동 가능하게 함.
 * post: 새 메시지(placeholder/응답) 게시, 메시지 id 반환. update: 그 메시지를 갱신(스트리밍).
 */
export interface MentionSink {
  post(text: string): Promise<string | null>
  update(id: string, text: string): Promise<void>
}

/**
 * app_mention 이벤트 처리. events 라우트가 200 ACK 후 fire-and-forget으로 호출.
 * 커스텀 long-running 서버라 응답 이후에도 안전하게 백그라운드 실행됨.
 * sink 미지정 시 Slack으로 포스팅. 로컬 테스트는 콘솔 sink를 주입.
 */
export async function handleAppMention(workspace: DecryptedWorkspace, event: AppMentionEvent, providedSink?: MentionSink): Promise<void> {
  const { botToken } = workspace
  const channel = event.channel
  const slackUser = event.user
  if (!channel || !slackUser) return

  // 봇 자기 멘션/봇 메시지 무한루프 차단
  if (event.bot_id || event.subtype || slackUser === workspace.botUserId) return

  // 답변 위치: 스레드 안에서 부르면 그 스레드, 채널 최상위면 채널에 그대로 답(스레드 강제 안 함).
  const replyTs = event.thread_ts
  // 대화 단위 키: 스레드 안이면 thread_ts(스레드별 독립), 채널 최상위면 channel(채널 단위 연속).
  const convoId = event.thread_ts || channel
  const cleanText = stripBotMention(event.text || '', workspace.botUserId)

  // Slack 기본 sink (테스트에서는 providedSink로 콘솔 출력 등 주입)
  const sink: MentionSink = providedSink ?? {
    post: (text) => postMessage(botToken, channel, text, replyTs),
    update: (id, text) => updateMessage(botToken, channel, id, text),
  }

  try {
    // 워크스페이스 소유자(IVE 유저). 이 유저의 에이전트·프로젝트만 사용 (남의 것 접근 불가).
    const ownerUserId = workspace.defaultUserId
    if (!ownerUserId) {
      await sink.post(`이 워크스페이스에 소유자(IVE 유저)가 지정되지 않았어요. 관리자에게 문의해 주세요.`)
      return
    }
    const agent = pickOwnerAgent(ownerUserId)
    if (!agent) {
      await sink.post(`소유자에게 사용할 수 있는 에이전트가 없어요. 관리자에게 문의해 주세요.`)
      return
    }

    const ownerProjects = getProjectsByUser(ownerUserId)
    if (ownerProjects.length === 0) {
      await sink.post(`소유자에게 연결된 프로젝트가 없어요. 관리자에게 문의해 주세요.`)
      return
    }
    // 대상 프로젝트: 멘션에 이름이 있으면 그걸로, 없으면 소유자의 첫 프로젝트.
    // "무엇을 할지(조회/생성/설명…)"는 규칙으로 가르지 않고 에이전트가 대화로 판단한다.
    const namedProject = ownerProjects.find(p => p.name && cleanText.includes(p.name))
    const project = namedProject || ownerProjects[0]
    const token = decrypt(project.accessToken)

    // 스레드 단위 독립 대화: 세션/이슈바인딩/CLI세션을 thread_ts 기준으로 유지
    const sessionKey = `slack:${workspace.id}:${channel}:${convoId}`
    if (isChatAgentRunning(sessionKey)) {
      await sink.post(`아직 이전 메시지를 처리 중이에요. 잠시만요…`)
      return
    }

    // 스레드 첫 멘션에서 이슈 번호를 바인딩, 이후 멘션은 그 바인딩 유지(번호 재입력 불필요)
    let session = getSlackThreadSession(workspace.id, channel, convoId)
    let issueIid: number | null
    if (!session) {
      issueIid = parseIssueNumber(cleanText)
      createSlackThreadSession({ workspaceId: workspace.id, channelId: channel, threadTs: convoId, issueIid })
      session = getSlackThreadSession(workspace.id, channel, convoId)
    } else {
      issueIid = session.issueIid ?? null
    }
    const cliSessionId = session?.cliSessionId ?? null

    // 이슈 모드(레포 + dev-N 브랜치) / 프로젝트 모드(레포 기본 브랜치) — 둘 다 실제 레포 clone
    let workspacePath: string
    let issueTitle = ''
    let issueDescription = ''
    const generalMode = issueIid == null
    if (issueIid != null) {
      if (!cliSessionId) {
        const issue = await fetchSingleIssue(project, issueIid, token).catch(() => null)
        if (!issue) {
          await sink.post(`프로젝트 *${project.name}* 에서 #${issueIid} 을(를) 못 찾았어요. 번호를 확인해 주세요.`)
          return
        }
        issueTitle = issue.title || `Issue #${issueIid}`
        issueDescription = issue.description || ''
      }
      workspacePath = await prepareChatWorkspace(project, issueIid, token)
    } else {
      workspacePath = await prepareProjectWorkspace(project, token)
    }

    // 처리 중 placeholder
    const msgTs = await sink.post(issueIid != null ? `:hourglass_flowing_sand: #${issueIid} 살펴보는 중…` : `:speech_balloon: …`)

    // CLI 구동 + Slack 스트리밍 (throttled chat.update)
    let full = ''
    let lastUpdate = 0
    const flush = async (force: boolean) => {
      if (!msgTs) return
      const now = Date.now()
      if (!force && now - lastUpdate < 1500) return
      lastUpdate = now
      const text = full.trim()
      if (text) await sink.update(msgTs, text.slice(0, 38000))
    }

    await runChatAgentWithCallback(
      {
        sessionId: sessionKey,
        cliSessionId,
        project,
        agent,
        token,
        issueIid: issueIid ?? 0,
        issueTitle,
        issueDescription,
        userMessage: cleanText,
        workspacePath,
        generalMode,
        availableProjects: ownerProjects.map(p => p.name),
      },
      (ev) => {
        if (ev.type === 'session_id' && ev.content) {
          updateSlackThreadCliSession(workspace.id, channel, convoId, ev.content)
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
      await sink.update(msgTs, `(응답이 비어 있어요. 다시 한 번 말 걸어 주세요.)`)
    } else if (msgTs) {
      await sink.update(msgTs, full.trim().slice(0, 38000))
    }
  } catch (err) {
    console.error('[Slack] handleAppMention error:', err)
    try {
      await sink.post(`처리 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.`)
    } catch { /* ignore */ }
  }
}
