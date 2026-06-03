// 단계 전이 → Slack DM 알림 (사람 사용자 대상)
//
// 원칙: 작업 상태가 다음 단계로 넘어가는 시점에, 그 단계를 맡은 "사람 사용자"에게 DM 한다.
//  - 검증대기 진입(처리 완료) → 검증자에게  "검증해 주세요"
//  - 확인대기 진입(검증 완료) → 확인자에게  "확인해 주세요"
//  - 완료 진입               → 이슈 생성자에게 "작업이 완료됐습니다"
//
// 트리거: 이슈에 알림 라벨(project.labelNotify, 기본 IVE-N)이 있을 때만 발송. (등록 시 '알림 발송' 체크 = 이 라벨)
// 수신자 해석: 대상자의 Git(GitLab/GitHub) 사용자 id → IVE 사용자 매핑(getUserByOAuthId).
//   매핑되고 slack_user_id 연결 + slack_notify=true 인 사람에게만 DM. 아니면 조용히 스킵.
// 언어: 수신자(IVE 사용자)의 locale 을 따른다(없으면 ko).
// im:write 권한 필요(없으면 Slack API 실패 → 조용히 무시).
import { Project, User } from '@/types'
import { fetchSingleIssue } from './provider'
import { getUserByOAuthId, getSystemSetting } from './db'
import { sendSlackDM } from './slack'

/** IVE 공개 베이스 URL. system_settings['oauth.redirect_base'] → env → 빈 값(스킵). 백그라운드(스캐너)에서도 동작. */
function getIveBaseUrl(): string {
  const stored = getSystemSetting('oauth.redirect_base') // oauth.ts OAUTH_REDIRECT_BASE_KEY 와 동일 키
  if (stored && stored.trim()) return stored.trim().replace(/\/+$/, '')
  const env = process.env.OAUTH_REDIRECT_BASE
  if (env) return env.replace(/\/+$/, '')
  return ''
}

/** 단계 전이 종류 — 발송 대상과 메시지를 결정한다. */
export type StageNotifyKind = 'verify' | 'confirm' | 'done'

/** 이슈 JSON에서 레이블 이름 배열 추출 (GitLab=string[], GitHub={name}[]) */
function extractLabels(issue: any): string[] {
  const raw = issue?.labels
  if (!Array.isArray(raw)) return []
  return raw.map((l: any) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
}

/** 이슈 JSON에서 담당자 provider 측 user id 배열 추출 (GitLab/GitHub 공통) */
function extractAssigneeIds(issue: any): string[] {
  const arr = Array.isArray(issue?.assignees)
    ? issue.assignees
    : issue?.assignee ? [issue.assignee] : []
  return arr
    .map((a: any) => (a?.id != null ? String(a.id) : ''))
    .filter((id: string) => !!id)
}

/** 수신자(IVE 사용자)의 언어. locale 미지정이면 ko. */
function pickLocale(u: User): 'ko' | 'en' {
  return u.locale === 'en' ? 'en' : 'ko'
}

/** 단계별 DM 본문 (수신자 언어 + 링크). IVE(우리 시스템) 링크를 먼저, 그 다음 provider 링크. */
export function buildStageMessage(
  kind: StageNotifyKind,
  locale: 'ko' | 'en',
  opts: { iid: number; title: string; iveUrl: string; webUrl: string; providerLabel: 'GitLab' | 'GitHub' },
): string {
  const { iid, title, iveUrl, webUrl, providerLabel } = opts
  const head = `#${iid} "${title}"`
  // 링크 블록: IVE 먼저(우리 시스템), 그 다음 GitLab/GitHub. 설정 없으면 해당 줄 생략.
  const links = [
    iveUrl ? `• IVE: ${iveUrl}` : '',
    webUrl ? `• ${providerLabel}: ${webUrl}` : '',
  ].filter(Boolean).join('\n')
  const linkBlock = links ? `\n${links}` : ''
  const MSG = {
    ko: {
      verify: `🔍 *검증 요청* — ${head}\n처리가 완료됐습니다. 결과를 확인하고 검증해 주세요.${linkBlock}`,
      confirm: `☑️ *확인 요청* — ${head}\n검증이 완료됐습니다. 결과를 확인해 주세요.${linkBlock}`,
      done: `🎉 *작업 완료* — ${head}\n요청하신 작업이 완료됐습니다.${linkBlock}`,
    },
    en: {
      verify: `🔍 *Verification needed* — ${head}\nProcessing is complete. Please review and verify.${linkBlock}`,
      confirm: `☑️ *Confirmation needed* — ${head}\nVerification is complete. Please review.${linkBlock}`,
      done: `🎉 *Task complete* — ${head}\nThe task you requested has been completed.${linkBlock}`,
    },
  } as const
  return MSG[locale][kind]
}

/**
 * 단계 전이 시 해당 단계의 담당자(사람)에게 DM 발송.
 * 모든 오류를 내부에서 삼키므로 호출 측은 fire-and-forget 으로 안전하게 부른다.
 *
 * @param kind 'verify'  → 검증대기 진입: 수신자 = 현재 담당자(검증자)
 *             'confirm' → 확인대기 진입: 수신자 = 현재 담당자(확인자)
 *             'done'    → 완료 진입:     수신자 = 이슈 생성자(author)
 */
export async function notifyStageTransition(project: Project, iid: number, token: string, kind: StageNotifyKind): Promise<void> {
  try {
    if (!token) return
    const issue = await fetchSingleIssue(project, iid, token).catch(() => null)
    if (!issue) return

    // 트리거: 알림 라벨(IVE-N)이 붙은 이슈만 (등록 시 '알림 발송' 체크)
    const notifyLabel = project.labelNotify || 'IVE-N'
    if (!extractLabels(issue).includes(notifyLabel)) return

    // 수신자 Git user id: 검증/확인 = 현재 담당자, 완료 = 이슈 생성자
    const gitUserIds = kind === 'done'
      ? (issue?.author?.id != null ? [String(issue.author.id)] : [])
      : extractAssigneeIds(issue)
    if (gitUserIds.length === 0) return

    // Git id → IVE 사용자 매핑 후, Slack 연결 + 수신 켜진 사람만 (본인 veto 존중). id 중복 제거.
    const seen = new Set<string>()
    const recipients = gitUserIds
      .map(id => getUserByOAuthId(project.provider, id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .filter(u => u.slackNotify && !!u.slackUserId)
      .filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)))
    if (recipients.length === 0) return

    const title = issue.title || `#${iid}`
    const webUrl = issue.web_url || issue.html_url || ''
    const providerLabel = project.provider === 'github' ? 'GitHub' : 'GitLab'
    const base = getIveBaseUrl()
    const iveUrl = base ? `${base}/issues/${project.id}/${iid}` : ''
    const workspaceId = project.slackWorkspaceId || ''

    await Promise.all(
      recipients.map(u =>
        sendSlackDM(workspaceId, u.slackUserId as string, buildStageMessage(kind, pickLocale(u), { iid, title, iveUrl, webUrl, providerLabel }))
          .catch(() => false),
      ),
    )
  } catch (e) {
    console.warn('[slack-notify] notifyStageTransition failed:', (e as Error)?.message || e)
  }
}
