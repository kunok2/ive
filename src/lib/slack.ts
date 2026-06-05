import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp' // next 의 의존성으로 항상 설치됨(SVG→PNG 변환용). 별도 선언 불필요.
import {
  getProjectsByUser, getSharedProjectsForUser, getProjectAuthToken,
  getSlackProviderRaw, getAvailableAgentsByUser,
  getSlackThreadSession, createSlackThreadSession, updateSlackThreadCliSession, resetSlackThreadProject, switchSlackThreadProject,
  getSlackWorkspaceRawById, getAllSlackWorkspaces,
} from './db'
import { decrypt } from './crypto'
import {
  prepareChatWorkspace, prepareProjectWorkspace, prepareGeneralWorkspace,
  runChatAgentWithCallback, isChatAgentRunning, maskSecrets,
} from './chat-agent'
import { fetchSingleIssue } from './provider'
import { Agent } from '@/types'

const SLACK_API = 'https://slack.com/api'

// ── Slack 앱 자격증명 (앱 단위 1세트, OAuth 로그인·봇설치 공통) ──

/** 봇 설치(Add to Slack) 때 요청하는 bot scope */
// files:read  — 멘션 첨부 이미지(url_private) 다운로드.
// files:write — 에이전트가 만든 이미지(차트/도식)를 채널에 업로드(files.completeUploadExternal).
// users:read  — 멘션한 사용자의 언어 설정(locale)을 읽어 응답 언어를 맞추기 위해 필요.
// im:write    — 작업완료 알림을 담당자에게 DM으로 보내기 위해 1:1 대화(conversations.open)를 연다. 없으면 DM 알림 불가(채널 알림만 동작).
export const SLACK_BOT_SCOPES = 'app_mentions:read,chat:write,channels:history,groups:history,channels:read,groups:read,files:read,files:write,users:read,im:write'

export interface SlackAppConfig {
  clientId: string
  clientSecret: string
  signingSecret: string
}

/** oauth_providers의 type='slack' 행에서 Slack 앱 자격증명을 복호화해 반환 */
export function getSlackAppConfig(): SlackAppConfig {
  const raw = getSlackProviderRaw()
  if (!raw) return { clientId: '', clientSecret: '', signingSecret: '' }
  return {
    clientId: raw.client_id || '',
    clientSecret: decrypt(raw.client_secret || ''),
    signingSecret: decrypt(raw.signing_secret || ''),
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
  const list = getAvailableAgentsByUser(ownerUserId) // 사용중지 에이전트 제외
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
 * 표준 Markdown(에이전트 출력) → Slack mrkdwn 변환.
 *
 * 왜 필요한가: CLI 에이전트(claude/gemini 등)는 GitHub-flavored Markdown을 뱉지만,
 * Slack 의 text 필드는 그 방언이 아니라 mrkdwn 만 이해한다. 그대로 보내면
 * `**굵게**`·`### 헤더`·`[t](u)`·`~~취소선~~`·표가 문자 그대로 찍힌다.
 * 전송 직전 이 함수를 한 번 태워서 mrkdwn 으로 바꾼다.
 *
 * 보호: 코드펜스(``` ```)와 인라인 코드(` `) 내부는 절대 변형하지 않는다
 * (코드 예시 안의 `*`·`#` 까지 바뀌면 안 됨). placeholder 로 빼뒀다가 마지막에 복원.
 *
 * 스트리밍 안전: 닫히지 않은 `**bold`(아직 도착 중) 같은 토막은 매칭되지 않아
 * 그대로 남고, 다음 flush·최종 전송에서 완성되면 정상 변환된다.
 */
export function markdownToMrkdwn(md: string): string {
  if (!md) return md

  // 1) 코드 영역 보호 — 펜스 먼저, 그다음 인라인. placeholder  <idx>  로 치환.
  const guards: string[] = []
  const stash = (s: string): string => { guards.push(s); return ` ${guards.length - 1} ` }
  let t = md
    .replace(/```[\s\S]*?```/g, m => stash(m))
    .replace(/`[^`\n]+`/g, m => stash(m))

  // 2) 라인/블록 단위 변환 — 표·헤더·불릿. (Slack 은 표가 없어 표는 코드블록으로 정렬 보존)
  const isTableSep = (s: string): boolean => s.includes('|') && /-/.test(s) && /^[\s|:-]+$/.test(s)
  const fmtRow = (s: string): string =>
    s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()).join(' | ')
  const lines = t.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]
    // 표: 헤더행 + 구분행(|---|) 패턴이면 연속 행을 모아 코드블록으로. (생성한 블록도 stash 해 인라인 변환에서 보호)
    if (cur.includes('|') && isTableSep(lines[i + 1] ?? '')) {
      const rows = [fmtRow(cur)]
      i += 2
      while (i < lines.length && lines[i].includes('|')) { rows.push(fmtRow(lines[i])); i++ }
      i--
      out.push(stash('```\n' + rows.join('\n') + '\n```'))
      continue
    }
    // 헤더(#~######) → *굵게*. 굵게 sentinel()로 감싸 아래 기울임 변환에 안 먹히게 한다.
    const h = cur.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/)
    if (h) { out.push(`${h[1]}`); continue }
    // 불릿(-, *, +) → •  (들여쓰기 보존)
    out.push(cur.replace(/^(\s*)[-*+]\s+/, '$1• '))
  }
  t = out.join('\n')

  // 3) 인라인 변환 — 코드는 이미 빠져 있어 안전.
  // 링크/이미지: [text](url) / ![alt](url) → <url|text>
  t = t.replace(/!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text: string, url: string) =>
    text ? `<${url}|${text}>` : `<${url}>`)
  // 굵게: **x** / __x__ → sentinel(). 먼저 빼야 아래 기울임(*x*)과 충돌 안 함.
  t = t.replace(/\*\*([^*]+?)\*\*/g, '$1').replace(/__([^_]+?)__/g, '$1')
  // 기울임: *x* → _x_
  t = t.replace(/\*([^*\n]+?)\*/g, '_$1_')
  // sentinel → 슬랙 굵게(*)
  t = t.replace(//g, '*')
  // 취소선: ~~x~~ → ~x~
  t = t.replace(/~~([^~]+?)~~/g, '~$1~')

  // 4) 보호했던 코드/표 블록 복원
  return t.replace(/ (\d+) /g, (_m, n: string) => guards[Number(n)] ?? '')
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

/**
 * 메시지 텍스트에서 프로젝트 이름을 찾아 매칭(대소문자 무시, 단어 경계 기준). 못 찾으면 null.
 * 단어 경계(\b)로 막아 짧은 이름의 오매칭을 피한다 — 예: "IVE" 가 "give"/"live" 안에서 잡히지 않게.
 * (한글 음차 "스프링크"는 영문 "splink" 와 매칭되지 않음 — 알려진 한계. 영문 이름을 쓰면 됨.)
 */
export function matchProjectByName<P extends { name: string }>(projects: P[], text: string): P | null {
  const t = text || ''
  for (const p of projects) {
    if (!p.name) continue
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(t)) return p
  }
  return null
}

/**
 * 이 멘션에서 사용할 대상 프로젝트를 고른다 (순수 함수 — 회귀 테스트 대상).
 *
 * 설계: 스레드는 "프로젝트 없음(일반 대화)"으로 시작한다. 임의로 [0]을 잡거나 되묻지 않는다
 *  (예전 "되묻기"는 한글 이름 매칭 실패 시 빠져나올 수 없는 무한 루프를 만들었다).
 *  - 이번 메시지에 프로젝트 이름이 있으면 그 프로젝트 → 거기서 자연스럽게 바인딩/전환.
 *  - 아니면 이 스레드에 이미 고정된 프로젝트를 유지.
 *  - 둘 다 없으면 null → 어떤 레포에도 묶이지 않은 일반 대화.
 *  한번 프로젝트에 바인딩되면 다른 프로젝트 이름을 말하기 전까지 그 프로젝트로 유지된다.
 */
export function selectThreadProject<P extends { id: string; name: string }>(opts: {
  ownerProjects: P[]
  session: { projectId?: string | null } | null
  cleanText: string
}): P | null {
  const { ownerProjects, session, cleanText } = opts
  const named = matchProjectByName(ownerProjects, cleanText)
  if (named) return named
  return session?.projectId
    ? (ownerProjects.find(p => p.id === session.projectId) || null)
    : null
}

// ── 사용자 언어(locale) + 표시 메시지 ──

type SlackLocale = 'ko' | 'en'

/** 멘션한 슬랙 사용자의 언어 설정을 읽어 ko/en 으로 매핑. 실패 시 ko. (users:read 스코프 필요) */
async function fetchUserLocale(botToken: string, slackUserId: string): Promise<SlackLocale> {
  try {
    const qs = new URLSearchParams({ user: slackUserId, include_locale: 'true' }).toString()
    const res = await fetch(`${SLACK_API}/users.info?${qs}`, { headers: { Authorization: `Bearer ${botToken}` } })
    const json: any = await res.json().catch(() => ({ ok: false }))
    if (!json.ok) { console.warn('[Slack] users.info failed:', json.error); return 'ko' }
    const loc = String(json?.user?.locale || '').toLowerCase()
    return loc.startsWith('ko') ? 'ko' : 'en'
  } catch {
    return 'ko'
  }
}

/** 슬랙에 표시할 IVE 시스템 메시지 (멘션 사용자 언어별). 에이전트 응답이 아니라 IVE 자체 안내/오류 문구. */
const SLACK_MSG = {
  ko: {
    noOwner: '이 워크스페이스에 소유자(IVE 유저)가 지정되지 않았어요. 관리자에게 문의해 주세요.',
    noAgent: '소유자에게 사용할 수 있는 에이전트가 없어요. 관리자에게 문의해 주세요.',
    noProject: '소유자에게 연결된 프로젝트가 없어요. 관리자에게 문의해 주세요.',
    busy: '아직 이전 메시지를 처리 중이에요. 잠시만요…',
    issueNotFound: (p: string, iid: number) => `프로젝트 *${p}* 에서 #${iid} 을(를) 못 찾았어요. 번호를 확인해 주세요.`,
    placeholderIssue: (iid: number) => `:hourglass_flowing_sand: #${iid} 살펴보는 중…`,
    placeholderChat: ':speech_balloon: …',
    imageChecking: (n: number) => `:frame_with_picture: 이미지 ${n}장 확인 중…`,
    emptyResponse: '(응답이 비어 있어요. 다시 한 번 말 걸어 주세요.)',
    imagesAttached: (n: number) => `:frame_with_picture: 이미지 ${n}장을 첨부했어요.`,
    imageUploadFailed: ':warning: 이미지를 만들었지만 업로드에 실패했어요. 봇의 `files:write` 스코프와 앱 재설치를 확인해 주세요.',
    errorGeneric: '오류가 발생했습니다.',
    processingError: (detail: string) => `처리 중 오류가 발생했어요.${detail ? `\n\`${detail}\`` : ' 잠시 후 다시 시도해 주세요.'}`,
  },
  en: {
    noOwner: 'This workspace has no IVE owner assigned. Please contact your admin.',
    noAgent: 'The owner has no available agent. Please contact your admin.',
    noProject: 'The owner has no connected project. Please contact your admin.',
    busy: 'Still working on your previous message. One moment…',
    issueNotFound: (p: string, iid: number) => `Couldn't find #${iid} in project *${p}*. Please check the number.`,
    placeholderIssue: (iid: number) => `:hourglass_flowing_sand: Looking into #${iid}…`,
    placeholderChat: ':speech_balloon: …',
    imageChecking: (n: number) => `:frame_with_picture: Checking ${n} image(s)…`,
    emptyResponse: '(Empty response. Please mention me again.)',
    imagesAttached: (n: number) => `:frame_with_picture: Attached ${n} image(s).`,
    imageUploadFailed: ':warning: I created an image but failed to upload it. Please check the bot\'s `files:write` scope and reinstall the app.',
    errorGeneric: 'An error occurred.',
    processingError: (detail: string) => `Something went wrong.${detail ? `\n\`${detail}\`` : ' Please try again later.'}`,
  },
} as const

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

/** 이미지로 인식할 확장자(에이전트가 outbox 에 떨군 산출물 중 업로드 대상). */
const OUTBOX_IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i
/** 한 멘션에서 업로드할 최대 이미지 수(폭주 방지). 초과분은 로그로 남기고 버린다. */
const OUTBOX_UPLOAD_LIMIT = 10

/** outbox 폴더의 이미지 파일 → mtime(ms) 스냅샷. 실행 전후 비교로 "이번에 새로 생기거나 바뀐 것"만 골라낸다. */
// (이전 listOutboxImages 는 freshOutboxImages 로 대체 — 매 멘션마다 옛 이미지를 재업로드하지 않기 위함)
function snapshotOutbox(dir: string): Map<string, number> {
  const m = new Map<string, number>()
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!OUTBOX_IMAGE_RE.test(f)) continue
      try { m.set(f, fs.statSync(path.join(dir, f)).mtimeMs) } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return m
}

/** 실행 전 스냅샷(before) 대비 새로 생기거나 갱신된 이미지 경로만(이름순). 이전 산출물은 재업로드하지 않는다. */
function freshOutboxImages(dir: string, before: Map<string, number>): string[] {
  const out: string[] = []
  try {
    for (const f of fs.readdirSync(dir).sort()) {
      if (!OUTBOX_IMAGE_RE.test(f)) continue
      let mtime = 0
      try { mtime = fs.statSync(path.join(dir, f)).mtimeMs } catch { continue }
      const prev = before.get(f)
      if (prev === undefined || mtime > prev) out.push(path.join(dir, f))
    }
  } catch { /* ignore */ }
  return out
}

/**
 * 업로드용 이미지 준비. Slack 은 SVG 를 인라인 렌더하지 않으므로 SVG 는 sharp 로 PNG 로 변환한다
 * (그래야 채팅창에 그림으로 보인다). 그 외(png/jpg/gif/webp)는 그대로 올린다.
 */
export async function prepareImageForUpload(filePath: string): Promise<{ buffer: Buffer; filename: string }> {
  const base = path.basename(filePath)
  if (/\.svg$/i.test(filePath)) {
    const svgBuf = fs.readFileSync(filePath)
    try {
      const png = await sharp(svgBuf).png().toBuffer()
      return { buffer: png, filename: base.replace(/\.svg$/i, '.png') }
    } catch (e) {
      // 에이전트가 만든 SVG 가 깨진 XML(미닫힌 태그 등)이면 resvg 가 거부한다.
      // 완전 실패시키지 말고 원본 SVG 라도 올린다(클라이언트가 렌더할 수도 있음). 진단용으로 앞부분 로깅.
      const head = svgBuf.toString('utf8').slice(0, 300)
      console.warn(`[Slack] SVG→PNG 변환 실패, 원본 SVG 업로드로 폴백: ${(e as Error).message}\n  svg head: ${head}`)
      return { buffer: svgBuf, filename: base }
    }
  }
  return { buffer: fs.readFileSync(filePath), filename: base }
}

/**
 * 로컬 파일을 Slack 채널/스레드에 업로드한다 (files.getUploadURLExternal → 업로드 → completeUploadExternal).
 * files.upload 는 deprecated 라 외부 업로드 3단계 플로우를 쓴다. files:write 스코프 필요.
 * SVG 는 PNG 로 변환해서 올린다(Slack 인라인 렌더용).
 */
async function uploadFileToSlack(botToken: string, channel: string, filePath: string, threadTs?: string): Promise<boolean> {
  try {
    const { buffer: buf, filename } = await prepareImageForUpload(filePath)
    // 1) 업로드 URL 발급
    const form = new URLSearchParams({ filename, length: String(buf.length) })
    const r1 = await fetch(`${SLACK_API}/files.getUploadURLExternal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const j1: any = await r1.json().catch(() => ({ ok: false }))
    if (!j1.ok || !j1.upload_url || !j1.file_id) {
      console.warn('[Slack] files.getUploadURLExternal failed:', j1.error)
      return false
    }
    // 2) 발급된 URL 로 파일 바이트 업로드
    const r2 = await fetch(j1.upload_url, { method: 'POST', body: new Uint8Array(buf) })
    if (!r2.ok) {
      console.warn('[Slack] file upload POST failed:', r2.status)
      return false
    }
    // 3) 채널/스레드에 공유 (완료)
    const j3 = await slackApi(botToken, 'files.completeUploadExternal', {
      files: [{ id: j1.file_id, title: filename }],
      channel_id: channel,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    })
    return !!j3.ok
  } catch (e) {
    console.warn('[Slack] uploadFileToSlack error:', e)
    return false
  }
}

/**
 * 응답 출력 싱크 — Slack 포스팅을 추상화해서 로컬 테스트(콘솔)로도 구동 가능하게 함.
 * post: 새 메시지(placeholder/응답) 게시, 메시지 id 반환. update: 그 메시지를 갱신(스트리밍).
 * uploadImage: 에이전트가 만든 이미지 파일을 채널에 업로드(선택적 — 미구현 sink 는 무시).
 */
export interface MentionSink {
  post(text: string): Promise<string | null>
  update(id: string, text: string): Promise<void>
  uploadImage?(filePath: string): Promise<boolean>
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
    uploadImage: (filePath) => uploadFileToSlack(botToken, channel, filePath, replyTs),
  }

  // 멘션한 사용자의 언어로 IVE 시스템 메시지를 표시(에이전트 응답 언어도 이 locale 을 따른다).
  const locale = await fetchUserLocale(botToken, slackUser)
  const M = SLACK_MSG[locale]

  try {
    // 워크스페이스 소유자(IVE 유저). 이 유저의 에이전트·프로젝트만 사용 (남의 것 접근 불가).
    const ownerUserId = workspace.defaultUserId
    if (!ownerUserId) {
      await sink.post(M.noOwner)
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
    // 스레드 고정 에이전트도 사용중지면 재사용하지 않는다(아래 pickOwnerAgent 로 폴백).
    const pinnedAgent = session?.cliName
      ? getAvailableAgentsByUser(ownerUserId).find(a => a.cliName === session!.cliName)
      : null
    const agent = pinnedAgent || pickOwnerAgent(ownerUserId, hasImages)
    if (!agent) {
      await sink.post(M.noAgent)
      return
    }

    // 소유 프로젝트 + 공유받은 프로젝트(프로젝트 화면과 동일 범위). id로 중복 제거.
    const owned = getProjectsByUser(ownerUserId)
    const shared = getSharedProjectsForUser(ownerUserId)
    const seen = new Set(owned.map(p => p.id))
    const ownerProjects = [...owned, ...shared.filter(p => !seen.has(p.id))]
    // 프로젝트가 없어도 막지 않는다 — 아래 projectless(일반 대화) 모드로 응답한다.
    // (프로젝트가 있으면 이름 매칭 시 바인딩, 없으면 그냥 일반 대화로 진행)
    // 대상 프로젝트 선택. 스레드는 "프로젝트 없음(일반 대화)"으로 시작하고, 사용자가 프로젝트
    // 이름을 거론하면 그때 자연스럽게 바인딩/전환된다(selectThreadProject). 임의 단정·되묻기 없음.
    const project = selectThreadProject({ ownerProjects, session, cleanText })
    const projectless = project == null
    // 공유 프로젝트는 accessToken이 비어있을 수 있고 OAuth 토큰 케이스도 있어 getProjectAuthToken으로 해석.
    const token = project ? getProjectAuthToken(project.id) : ''

    // 스레드 단위 독립 대화: 세션/이슈바인딩/CLI세션을 thread_ts 기준으로 유지
    const sessionKey = `slack:${workspace.id}:${channel}:${convoId}`
    if (isChatAgentRunning(sessionKey)) {
      await sink.post(M.busy)
      return
    }

    // 세션 생성/전환. project_id 가 null 이면 "프로젝트 없음" 상태로 고정된다.
    // 이번 멘션에서 프로젝트가 바뀌면(없음→바인딩 또는 다른 프로젝트로 전환) 이슈 바인딩과
    // CLI 세션을 함께 초기화한다(프로젝트가 바뀌면 cwd·세션이 달라 resume 불가, 옛 이슈도 무효).
    const newProjectId = project?.id ?? null
    let issueIid: number | null
    if (!session) {
      issueIid = project ? parseIssueNumber(cleanText) : null
      createSlackThreadSession({ workspaceId: workspace.id, channelId: channel, threadTs: convoId, issueIid, projectId: newProjectId })
      session = getSlackThreadSession(workspace.id, channel, convoId)
    } else if (newProjectId !== (session.projectId ?? null)) {
      issueIid = project ? parseIssueNumber(cleanText) : null
      switchSlackThreadProject(workspace.id, channel, convoId, newProjectId, issueIid)
      session = getSlackThreadSession(workspace.id, channel, convoId)
    } else {
      issueIid = session.issueIid ?? null
    }

    // resume 조건: 같은 CLI + 같은 프로젝트(없음 null 포함). claude 세션은 cwd 별 저장이라
    // 프로젝트가 바뀌면 이전 세션을 못 찾는다(전환 시 위에서 cli_session 이 초기화됨).
    let cliSessionId = (
      session?.cliSessionId &&
      session?.cliName === agent.cliName &&
      (session?.projectId ?? null) === newProjectId
    ) ? session.cliSessionId : null

    // 워크스페이스: 프로젝트 없음 → clone 없는 일반 scratch / 이슈 모드 → dev 브랜치 / 프로젝트 모드 → 기본 브랜치.
    let workspacePath: string
    let issueTitle = ''
    let issueDescription = ''
    const generalMode = issueIid == null
    if (!project) {
      // 대화별로 격리된 scratch 디렉토리(동시 대화가 같은 cwd 를 안 쓰도록 convo 키로 분리).
      workspacePath = prepareGeneralWorkspace(path.join('_general', convoId.replace(/[^A-Za-z0-9_-]/g, '_')))
    } else if (issueIid != null) {
      if (!cliSessionId) {
        const issue = await fetchSingleIssue(project, issueIid, token).catch(() => null)
        if (!issue) {
          await sink.post(M.issueNotFound(project.name, issueIid))
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

    // 나가는 이미지 폴더(.slack-outbox): 에이전트가 차트/도식을 여기 저장하면 실행 후 업로드한다.
    // 파괴적으로 비우지 않고(이전 산출물 보존 — "그거 다시 보여줘"·후속 변환 대비) 실행 전 스냅샷만
    // 떠서, 실행 후 "새로 생기거나 바뀐 이미지"만 업로드한다.
    const outboxRel = '.slack-outbox'
    const outboxDir = path.join(workspacePath, outboxRel)
    try { fs.mkdirSync(outboxDir, { recursive: true }) } catch { /* ignore */ }
    const outboxBefore = snapshotOutbox(outboxDir)

    // 처리 중 placeholder
    const placeholderBase = issueIid != null ? M.placeholderIssue(issueIid) : M.placeholderChat
    const msgTs = await sink.post(attachedImages.length > 0 ? M.imageChecking(attachedImages.length) : placeholderBase)

    // CLI 구동 + Slack 스트리밍 (throttled chat.update)
    let full = ''
    let lastUpdate = 0
    const flush = async (force: boolean) => {
      if (!msgTs) return
      const now = Date.now()
      if (!force && now - lastUpdate < 1500) return
      lastUpdate = now
      const text = full.trim()
      if (text) await sink.update(msgTs, markdownToMrkdwn(text).slice(0, 38000))
    }

    const baseOpts = {
      sessionId: sessionKey,
      project,
      projectless,
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
      userLocale: locale,
      imageOutbox: outboxRel,
    }
    let resumeLost = false
    const onEvent = (ev: { type: string; content?: string }) => {
      if (ev.type === 'session_id' && ev.content) {
        updateSlackThreadCliSession(workspace.id, channel, convoId, ev.content, agent.cliName, newProjectId)
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
          full += `\n\n:warning: ${ev.content || M.errorGeneric}`
          void flush(true)
        }
      }
      return true
    }

    await runChatAgentWithCallback({ ...baseOpts, cliSessionId }, onEvent)

    // resume 실패(세션 유실) → CLI 세션 초기화 후 새 대화로 1회 자동 재시도
    if (resumeLost && !full.trim()) {
      resetSlackThreadProject(workspace.id, channel, convoId, newProjectId)
      cliSessionId = null
      full = ''
      await runChatAgentWithCallback({ ...baseOpts, cliSessionId: null }, onEvent)
    }

    // 에이전트가 이번 실행에 outbox 에 만든(또는 바꾼) 이미지를 채널에 업로드(SVG 는 PNG 로 변환됨).
    let attemptedImages = 0
    let uploadedImages = 0
    if (sink.uploadImage) {
      const outImages = freshOutboxImages(outboxDir, outboxBefore)
      if (outImages.length > OUTBOX_UPLOAD_LIMIT) {
        console.warn(`[Slack] outbox 이미지 ${outImages.length}장 중 ${OUTBOX_UPLOAD_LIMIT}장만 업로드(초과분 무시)`)
      }
      for (const img of outImages.slice(0, OUTBOX_UPLOAD_LIMIT)) {
        attemptedImages++
        try {
          if (await sink.uploadImage(img)) uploadedImages++
        } catch (e) {
          console.warn('[Slack] outbox 이미지 업로드 실패:', img, e)
        }
      }
    }
    // 이미지를 만들었는데 한 장도 못 올렸으면(스코프/네트워크 등) 조용히 넘기지 말고 알린다.
    const uploadAllFailed = attemptedImages > 0 && uploadedImages === 0

    if (msgTs && !full.trim()) {
      // 텍스트가 비어도 이미지를 올렸으면 "비었음"이 아니라 첨부 안내로 마무리.
      const note = uploadedImages > 0 ? M.imagesAttached(uploadedImages)
        : uploadAllFailed ? M.imageUploadFailed
        : M.emptyResponse
      await sink.update(msgTs, note)
    } else if (msgTs) {
      // 에이전트 응답(full)만 mrkdwn 변환. suffix(M.imageUploadFailed)는 이미 mrkdwn 이라 그대로.
      const suffix = uploadAllFailed ? `\n\n${M.imageUploadFailed}` : ''
      await sink.update(msgTs, (markdownToMrkdwn(full.trim()) + suffix).slice(0, 38000))
    }
  } catch (err) {
    console.error('[Slack] handleAppMention error:', err)
    const detail = maskSecrets(err instanceof Error ? err.message : String(err)).slice(0, 250)
    try {
      await sink.post(M.processingError(detail))
    } catch { /* ignore */ }
  }
}

// ── 아웃바운드 알림 (작업완료 → DM / 채널 멘션) ────────────────────────────

/**
 * 워크스페이스 id로 복호화된 봇 토큰을 얻는다.
 * id가 비었거나 못 찾으면, 활성 워크스페이스가 정확히 하나일 때 그것으로 폴백한다.
 */
function resolveBotToken(workspaceId?: string): string | null {
  let raw = workspaceId ? getSlackWorkspaceRawById(workspaceId) : null
  if (!raw || raw.enabled !== 1) {
    const enabled = getAllSlackWorkspaces().filter(w => w.enabled)
    if (enabled.length === 1) raw = getSlackWorkspaceRawById(enabled[0].id)
  }
  if (!raw || !raw.bot_token) return null
  try { return decrypt(raw.bot_token) || null } catch { return null }
}

/** 담당자 Slack member ID로 1:1 DM 발송 (conversations.open → chat.postMessage). im:write 필요. */
export async function sendSlackDM(workspaceId: string, slackUserId: string, text: string): Promise<boolean> {
  const botToken = resolveBotToken(workspaceId)
  if (!botToken || !slackUserId) return false
  const open = await slackApi(botToken, 'conversations.open', { users: slackUserId })
  const dmChannel = open?.ok ? open.channel?.id : null
  if (!dmChannel) return false
  return !!(await postMessage(botToken, dmChannel, text))
}

/** 채널에 메시지 발송 (멘션 `<@U…>` 포함 가능). 봇이 그 채널 멤버여야 함. */
export async function sendSlackChannelMessage(workspaceId: string, channelId: string, text: string): Promise<boolean> {
  const botToken = resolveBotToken(workspaceId)
  // 저장값이 채널 링크여도 동작하도록 ID만 추출 (UI에서 정규화하지만 방어적으로 한 번 더)
  const ch = (channelId.match(/[CGD][A-Z0-9]{6,}/)?.[0]) || channelId.trim()
  if (!botToken || !ch) return false
  return !!(await postMessage(botToken, ch, text))
}

/** 알림 발송이 가능한 활성 워크스페이스가 하나라도 있는지 (UI/판단용). */
export function hasEnabledSlackWorkspace(): boolean {
  return getAllSlackWorkspaces().some(w => w.enabled)
}
