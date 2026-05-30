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
import { fetchSingleIssue, fetchAllProjectIssues } from './provider'
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

const ASK_VERB = /(있|어떤|무슨|뭐|목록|보여|알려|리스트|list|what|which|show)/i
/** "어떤 작업/이슈 있어?" 류 — 작업(이슈) 목록 조회 의도 */
function asksIssueList(text: string): boolean {
  return /(작업|이슈|issue|task)/i.test(text) && ASK_VERB.test(text)
}
/** "어떤 프로젝트 있어?" 류 — 프로젝트 목록 조회 의도 */
function asksProjectList(text: string): boolean {
  return /(프로젝트|project)/i.test(text) && ASK_VERB.test(text)
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
    // 워크스페이스 소유자(IVE 유저). 이 유저의 에이전트·프로젝트만 사용 (남의 것 접근 불가).
    const ownerUserId = workspace.defaultUserId
    if (!ownerUserId) {
      await postMessage(botToken, channel, `이 워크스페이스에 소유자(IVE 유저)가 지정되지 않았어요. 관리자에게 문의해 주세요.`, replyTs)
      return
    }
    const agent = pickOwnerAgent(ownerUserId)
    if (!agent) {
      await postMessage(botToken, channel, `소유자에게 사용할 수 있는 에이전트가 없어요. 관리자에게 문의해 주세요.`, replyTs)
      return
    }

    const ownerProjects = getProjectsByUser(ownerUserId)
    if (ownerProjects.length === 0) {
      await postMessage(botToken, channel, `소유자에게 연결된 프로젝트가 없어요. 관리자에게 문의해 주세요.`, replyTs)
      return
    }
    const projectListStr = ownerProjects.map(p => p.name).join(', ')
    const namedProject = ownerProjects.find(p => p.name && cleanText.includes(p.name))
    const issueIid = parseIssueNumber(cleanText)

    // ── 대화형 조회 (LLM 안 거치고 즉답) ──
    // 1) 작업(이슈) 목록 — 번호가 없을 때만
    if (issueIid == null && asksIssueList(cleanText)) {
      const proj = namedProject || (ownerProjects.length === 1 ? ownerProjects[0] : null)
      if (!proj) {
        await postMessage(botToken, channel, `어느 프로젝트의 작업을 볼까요? 프로젝트 이름을 알려주세요.\n프로젝트: ${projectListStr}`, replyTs)
        return
      }
      const issues = await fetchAllProjectIssues(proj, decrypt(proj.accessToken)).catch(() => [] as any[])
      const lines = (issues || []).slice(0, 20).map((i: any) => `• #${i.iid ?? i.number} ${i.title}`).join('\n')
      await postMessage(botToken, channel, lines ? `*${proj.name}* 작업 목록:\n${lines}` : `*${proj.name}* 에 열린 작업이 없어요.`, replyTs)
      return
    }
    // 2) 프로젝트 목록
    if (asksProjectList(cleanText)) {
      await postMessage(botToken, channel, `연결된 사용자(${ownerUserId === workspace.defaultUserId ? '소유자' : ''})의 프로젝트:\n${ownerProjects.map(p => `• ${p.name}`).join('\n')}`, replyTs)
      return
    }

    // ── 대화/작업 — 대상 프로젝트 결정 (모호하면 되묻기) ──
    const project = namedProject || (ownerProjects.length === 1 ? ownerProjects[0] : null)
    if (!project) {
      const what = issueIid != null ? `#${issueIid}` : '이 요청'
      await postMessage(botToken, channel, `${what} 은(는) 어느 프로젝트인가요? 프로젝트 이름을 함께 알려주세요.\n프로젝트: ${projectListStr}`, replyTs)
      return
    }
    const token = decrypt(project.accessToken)

    // 대화 연속성: 채널 + (이슈|일반) 단위로 CLI 세션 유지
    const convoKey = issueIid != null ? `i${issueIid}` : 'general'
    const threadKey = `${channel}:${convoKey}`
    const sessionKey = `slack:${workspace.id}:${channel}:${convoKey}`
    if (isChatAgentRunning(sessionKey)) {
      await postMessage(botToken, channel, `아직 이전 메시지를 처리 중이에요. 잠시만요…`, replyTs)
      return
    }

    let session = getSlackThreadSession(workspace.id, channel, threadKey)
    if (!session) {
      createSlackThreadSession({ workspaceId: workspace.id, channelId: channel, threadTs: threadKey, issueIid })
      session = getSlackThreadSession(workspace.id, channel, threadKey)
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
          await postMessage(botToken, channel, `프로젝트 *${project.name}* 에서 #${issueIid} 을(를) 못 찾았어요. 번호를 확인해 주세요.`, replyTs)
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
    const msgTs = await postMessage(botToken, channel, issueIid != null ? `:hourglass_flowing_sand: #${issueIid} 살펴보는 중…` : `:speech_balloon: …`, replyTs)

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
          updateSlackThreadCliSession(workspace.id, channel, threadKey, ev.content)
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
