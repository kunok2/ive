import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  getProjectsByUser, getSharedProjectsForUser, getProjectAuthToken,
  getSystemSetting, getAgentsByUser,
  getSlackThreadSession, createSlackThreadSession, updateSlackThreadCliSession, resetSlackThreadProject,
} from './db'
import { decrypt } from './crypto'
import {
  prepareChatWorkspace, prepareProjectWorkspace,
  runChatAgentWithCallback, isChatAgentRunning, maskSecrets,
} from './chat-agent'
import { fetchSingleIssue } from './provider'
import { Agent } from '@/types'

const SLACK_API = 'https://slack.com/api'

// ── Slack 앱 자격증명 (앱 단위 1세트, OAuth 로그인·봇설치 공통) ──

/** 봇 설치(Add to Slack) 때 요청하는 bot scope */
// files:read — 멘션에 첨부된 이미지(url_private)를 봇 토큰으로 다운로드하기 위해 필요.
export const SLACK_BOT_SCOPES = 'app_mentions:read,chat:write,channels:history,groups:history,channels:read,groups:read,files:read'

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
function pickOwnerAgent(ownerUserId: string, preferVision = false): Agent | null {
  const list = getAgentsByUser(ownerUserId)
  if (preferVision) {
    // 이미지 첨부 시: 이미지(vision) 분석이 되는 CLI를 우선.
    // opencode 는 모델에 따라 이미지 미지원이라(기본 모델이 vision 아님) 후순위.
    for (const cli of ['claude', 'gemini', 'codex']) {
      const a = list.find(x => x.cliName === cli)
      if (a) return a
    }
  }
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

/** Slack 파일 첨부(이미지 등). app_mention 이벤트의 files 배열 요소. */
interface SlackFile {
  id?: string
  mimetype?: string
  filetype?: string
  name?: string
  url_private?: string
  url_private_download?: string
}

interface AppMentionEvent {
  type: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  channel?: string
  bot_id?: string
  subtype?: string
  files?: SlackFile[]
}

/**
 * app_mention 이벤트엔 첨부 files 가 비어 오므로(Slack 동작), 멘션된 메시지를
 * conversations.history(채널) / conversations.replies(스레드)로 재조회해 files 를 가져온다.
 * 스코프: channels:history, groups:history, files:read.
 */
async function fetchMentionFiles(botToken: string, channel: string, ts: string, threadTs?: string): Promise<SlackFile[]> {
  const method = threadTs ? 'conversations.replies' : 'conversations.history'
  const params: Record<string, string> = threadTs
    ? { channel, ts: threadTs, limit: '50' }
    : { channel, latest: ts, oldest: ts, inclusive: 'true', limit: '1' }
  try {
    const qs = new URLSearchParams(params).toString()
    const res = await fetch(`${SLACK_API}/${method}?${qs}`, { headers: { Authorization: `Bearer ${botToken}` } })
    const json: any = await res.json().catch(() => ({ ok: false, error: 'invalid_json' }))
    if (!json.ok) { console.warn(`[Slack] ${method} failed:`, json.error); return [] }
    const msgs: any[] = json.messages || []
    const msg = msgs.find(m => m.ts === ts) || msgs[0]
    return (msg?.files || []) as SlackFile[]
  } catch (e) {
    console.warn('[Slack] fetchMentionFiles error:', e)
    return []
  }
}

/**
 * Slack 첨부 이미지를 봇 토큰으로 다운로드해 destDir에 저장하고 저장 경로 배열을 반환.
 * url_private 는 인증이 필요해 Authorization: Bearer <botToken> 헤더로 받아야 한다.
 */
async function downloadSlackImages(botToken: string, files: SlackFile[], destDir: string): Promise<string[]> {
  const images = (files || []).filter(f => f.mimetype?.startsWith('image/') && (f.url_private_download || f.url_private))
  if (images.length === 0) return []
  try { fs.mkdirSync(destDir, { recursive: true }) } catch { /* ignore */ }
  const saved: string[] = []
  for (let i = 0; i < images.length; i++) {
    const f = images[i]
    const url = f.url_private_download || f.url_private!
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } })
      if (!res.ok) { console.error(`[Slack] image download failed (${res.status}) ${url}`); continue }
      // files:read 스코프가 없으면 url_private 가 실제 이미지 대신 HTML 로그인 페이지를 반환한다.
      // 그걸 이미지로 저장하면 에이전트가 "이미지 처리 불가"로 실패 → content-type 으로 걸러낸다.
      const ct = res.headers.get('content-type') || ''
      if (!ct.startsWith('image/')) {
        console.error(`[Slack] 첨부 다운로드가 이미지가 아님 (content-type=${ct}). 봇 토큰의 files:read 스코프(앱 재설치)를 확인하세요.`)
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      const ext = (f.filetype || f.mimetype?.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'
      const fp = path.join(destDir, `slack-image-${i + 1}.${ext}`)
      fs.writeFileSync(fp, buf)
      saved.push(fp)
    } catch (err) {
      console.error('[Slack] image download error:', err)
    }
  }
  return saved
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
    // app_mention 엔 files 가 비어 오므로 멘션 메시지를 재조회해 첨부를 보완한다.
    let mentionFiles: SlackFile[] = (event.files && event.files.length) ? event.files : []
    if (mentionFiles.length === 0 && channel && event.ts) {
      mentionFiles = await fetchMentionFiles(botToken, channel, event.ts, event.thread_ts).catch(() => [])
    }
    // 스레드(대화) 세션을 먼저 로드 — 이미 이 스레드를 처리한 CLI 가 있으면 그 CLI 에이전트를 유지한다.
    // 같은 스레드에서 CLI 가 바뀌면(claude→codex 등) 세션을 이어받지 못해 대화 맥락이 끊기므로,
    // 한번 시작한 CLI 로 고정한다. 기록이 없을 때만(첫 멘션) 새로 선택.
    let session = getSlackThreadSession(workspace.id, channel, convoId)
    const hasImages = mentionFiles.some(f => f.mimetype?.startsWith('image/'))
    const pinnedAgent = session?.cliName
      ? getAgentsByUser(ownerUserId).find(a => a.cliName === session!.cliName)
      : null
    const agent = pinnedAgent || pickOwnerAgent(ownerUserId, hasImages)
    if (!agent) {
      await sink.post(`소유자에게 사용할 수 있는 에이전트가 없어요. 관리자에게 문의해 주세요.`)
      return
    }

    // 소유 프로젝트 + 공유받은 프로젝트(프로젝트 화면과 동일 범위). id로 중복 제거.
    const owned = getProjectsByUser(ownerUserId)
    const shared = getSharedProjectsForUser(ownerUserId)
    const seen = new Set(owned.map(p => p.id))
    const ownerProjects = [...owned, ...shared.filter(p => !seen.has(p.id))]
    if (ownerProjects.length === 0) {
      await sink.post(`소유자에게 연결된 프로젝트가 없어요. 관리자에게 문의해 주세요.`)
      return
    }
    // 대상 프로젝트: 멘션에 이름이 있으면 그걸로, 없으면 소유자의 첫 프로젝트.
    // "무엇을 할지(조회/생성/설명…)"는 규칙으로 가르지 않고 에이전트가 대화로 판단한다.
    const namedProject = ownerProjects.find(p => p.name && cleanText.includes(p.name))
    const project = namedProject || ownerProjects[0]
    // 공유 프로젝트는 accessToken이 비어있을 수 있고 OAuth 토큰 케이스도 있어
    // getProjectAuthToken으로 해석(OAuth/일반 토큰 모두 처리).
    const token = getProjectAuthToken(project.id)

    // 스레드 단위 독립 대화: 세션/이슈바인딩/CLI세션을 thread_ts 기준으로 유지
    const sessionKey = `slack:${workspace.id}:${channel}:${convoId}`
    if (isChatAgentRunning(sessionKey)) {
      await sink.post(`아직 이전 메시지를 처리 중이에요. 잠시만요…`)
      return
    }

    // 스레드 첫 멘션에서 이슈 번호를 바인딩, 이후 멘션은 그 바인딩 유지(번호 재입력 불필요)
    // (session 은 위에서 이미 로드함)
    let issueIid: number | null
    if (!session) {
      issueIid = parseIssueNumber(cleanText)
      createSlackThreadSession({ workspaceId: workspace.id, channelId: channel, threadTs: convoId, issueIid, projectId: project.id })
      session = getSlackThreadSession(workspace.id, channel, convoId)
    } else {
      issueIid = session.issueIid ?? null
    }
    // resume 조건 (셋 다 충족해야 이전 CLI 세션 이어가기):
    //  1) 같은 CLI (claude=UUID, opencode=ses_… 등 형식 달라 호환 안 됨)
    //  2) 같은 프로젝트 — claude 세션은 워크스페이스(cwd)별로 저장되므로 프로젝트가 바뀌면
    //     이전 세션을 못 찾아 "No conversation found" 가 난다. 다르면 새 대화로 시작.
    let cliSessionId = (
      session?.cliSessionId &&
      session?.cliName === agent.cliName &&
      session?.projectId === project.id
    ) ? session.cliSessionId : null

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

    // 첨부 이미지 다운로드 (워크스페이스 하위에 저장 → 에이전트가 읽음)
    const attachedImages = await downloadSlackImages(
      botToken,
      mentionFiles,
      path.join(workspacePath, '.slack-attachments'),
    ).catch(() => [] as string[])

    // 처리 중 placeholder
    const placeholderBase = issueIid != null ? `:hourglass_flowing_sand: #${issueIid} 살펴보는 중…` : `:speech_balloon: …`
    const msgTs = await sink.post(attachedImages.length > 0 ? `:frame_with_picture: 이미지 ${attachedImages.length}장 확인 중…` : placeholderBase)

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

    const baseOpts = {
      sessionId: sessionKey,
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
      attachedImages,
    }
    let resumeLost = false
    const onEvent = (ev: { type: string; content?: string }) => {
      if (ev.type === 'session_id' && ev.content) {
        updateSlackThreadCliSession(workspace.id, channel, convoId, ev.content, agent.cliName, project.id)
      } else if (ev.type === 'text' && ev.content) {
        full += ev.content
        void flush(false)
      } else if (ev.type === 'done') {
        void flush(true)
      } else if (ev.type === 'error') {
        // resume 대상 세션이 사라진 경우(배포 재시작/워크스페이스 변경 등) → 표시하지 않고 새 대화로 재시도
        if (cliSessionId && /no conversation found|session .*not found|no such session/i.test(ev.content || '')) {
          resumeLost = true
        } else {
          full += `\n\n:warning: ${ev.content || '오류가 발생했습니다.'}`
          void flush(true)
        }
      }
      return true
    }

    await runChatAgentWithCallback({ ...baseOpts, cliSessionId }, onEvent)

    // resume 실패(세션 유실) → CLI 세션 초기화 후 새 대화로 1회 자동 재시도
    if (resumeLost && !full.trim()) {
      resetSlackThreadProject(workspace.id, channel, convoId, project.id)
      cliSessionId = null
      full = ''
      await runChatAgentWithCallback({ ...baseOpts, cliSessionId: null }, onEvent)
    }

    if (msgTs && !full.trim()) {
      await sink.update(msgTs, `(응답이 비어 있어요. 다시 한 번 말 걸어 주세요.)`)
    } else if (msgTs) {
      await sink.update(msgTs, full.trim().slice(0, 38000))
    }
  } catch (err) {
    console.error('[Slack] handleAppMention error:', err)
    const detail = maskSecrets(err instanceof Error ? err.message : String(err)).slice(0, 250)
    try {
      await sink.post(`처리 중 오류가 발생했어요.${detail ? `\n\`${detail}\`` : ' 잠시 후 다시 시도해 주세요.'}`)
    } catch { /* ignore */ }
  }
}
