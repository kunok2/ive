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

/** DM 발송이 확정된 수신자 1명. */
export interface StageRecipient {
  iveUserId: string
  slackUserId: string
  locale: 'ko' | 'en'
}

/**
 * 단계 종류에 따라 이슈 JSON 에서 DM 수신자(IVE 사용자) 목록을 해석한다.
 *  - verify/confirm = 현재 담당자(assignee), done = 이슈 생성자(author)
 *  - Git id → IVE 유저 매핑 후, Slack 연결 + 수신 허용(slack_notify) 인 사람만. id 중복 제거.
 */
export function resolveStageRecipients(project: Project, issue: any, kind: StageNotifyKind): StageRecipient[] {
  const gitUserIds = kind === 'done'
    ? (issue?.author?.id != null ? [String(issue.author.id)] : [])
    : extractAssigneeIds(issue)
  if (gitUserIds.length === 0) return []

  const seen = new Set<string>()
  return gitUserIds
    .map(id => getUserByOAuthId(project.provider, id))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .filter(u => u.slackNotify && !!u.slackUserId)
    .filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)))
    .map(u => ({ iveUserId: u.id, slackUserId: u.slackUserId as string, locale: pickLocale(u) }))
}

/** 이슈에서 메시지 링크 블록 구성 요소(IVE 링크 우선, 그 다음 provider 링크)를 만든다. */
function buildLinkOpts(project: Project, issue: any, iid: number) {
  const base = getIveBaseUrl()
  return {
    iveUrl: base ? `${base}/issues/${project.id}/${iid}` : '',
    webUrl: issue?.web_url || issue?.html_url || '',
    providerLabel: (project.provider === 'github' ? 'GitHub' : 'GitLab') as 'GitHub' | 'GitLab',
  }
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

    const recipients = resolveStageRecipients(project, issue, kind)
    if (recipients.length === 0) return

    const title = issue.title || `#${iid}`
    const linkOpts = buildLinkOpts(project, issue, iid)
    const workspaceId = project.slackWorkspaceId || ''

    await Promise.all(
      recipients.map(u =>
        sendSlackDM(workspaceId, u.slackUserId, buildStageMessage(kind, u.locale, { iid, title, ...linkOpts }))
          .catch(() => false),
      ),
    )
  } catch (e) {
    console.warn('[slack-notify] notifyStageTransition failed:', (e as Error)?.message || e)
  }
}

// ── 머지/배포 완료 알림 ──────────────────────────────────────────────
// 머지를 누른 본인에게는 배포 성공/실패를 알리고, 머지+CI 가 끝나 확인이 가능해진
// 시점에 확인자에게 "이제 확인하세요" 를 알린다. (검증자 알림과 같은 취지 — 들어와 처리하게)

/** 머지/배포 결과 메시지 종류. */
export type MergeNotifyStatus = 'success' | 'failed' | 'merged'

interface MergeMessageOpts { iid: number; title: string; iveUrl: string; webUrl: string; providerLabel: 'GitLab' | 'GitHub' }

/** 머지를 누른 본인에게 보내는 배포 결과 메시지. */
function buildInitiatorMergeMessage(status: MergeNotifyStatus, locale: 'ko' | 'en', opts: MergeMessageOpts): string {
  const { iid, title, iveUrl, webUrl, providerLabel } = opts
  const head = `#${iid} "${title}"`
  const links = [iveUrl ? `• IVE: ${iveUrl}` : '', webUrl ? `• ${providerLabel}: ${webUrl}` : ''].filter(Boolean).join('\n')
  const linkBlock = links ? `\n${links}` : ''
  const MSG = {
    ko: {
      success: `🚀 *배포 완료* — ${head}\n머지 후 파이프라인이 성공했습니다.${linkBlock}`,
      merged: `✅ *머지 완료* — ${head}\n머지가 완료됐습니다.${linkBlock}`,
      failed: `⚠️ *배포 실패* — ${head}\n머지 후 파이프라인이 실패했습니다. 확인이 필요합니다.${linkBlock}`,
    },
    en: {
      success: `🚀 *Deploy complete* — ${head}\nThe post-merge pipeline succeeded.${linkBlock}`,
      merged: `✅ *Merged* — ${head}\nThe merge is complete.${linkBlock}`,
      failed: `⚠️ *Deploy failed* — ${head}\nThe post-merge pipeline failed. Please check.${linkBlock}`,
    },
  } as const
  return MSG[locale][status]
}

/** 머지+CI 가 끝나 확인이 가능해진 시점에 확인자에게 보내는 메시지. */
function buildConfirmReadyMessage(locale: 'ko' | 'en', opts: MergeMessageOpts): string {
  const { iid, title, iveUrl, webUrl, providerLabel } = opts
  const head = `#${iid} "${title}"`
  const links = [iveUrl ? `• IVE: ${iveUrl}` : '', webUrl ? `• ${providerLabel}: ${webUrl}` : ''].filter(Boolean).join('\n')
  const linkBlock = links ? `\n${links}` : ''
  return locale === 'en'
    ? `☑️ *Confirmation needed* — ${head}\nThe merge and deployment are complete. Please review the result now.${linkBlock}`
    : `☑️ *확인 요청* — ${head}\n머지와 배포가 완료됐습니다. 이제 결과를 확인해 주세요.${linkBlock}`
}

/**
 * 머지/배포가 끝난 시점에 발송한다. (merge-watcher 가 CI 완료 시 호출)
 *  - initiator(머지 누른 본인): 배포 성공/실패 DM. (체크박스로 명시 동의 — IVE-N 라벨과 무관)
 *  - 확인자: status 가 ready(성공/머지)이고 이슈가 확인대기(IVE-P)이며 IVE-N 라벨이 있을 때만 "이제 확인하세요".
 *  - initiator 와 확인자가 같은 사람이면 중복 발송하지 않는다(확인 메시지를 우선).
 * 모든 오류를 내부에서 삼킨다.
 */
export async function notifyMergeOutcome(
  project: Project,
  token: string,
  iid: number,
  initiator: { slackWorkspaceId: string; slackUserId: string; locale: 'ko' | 'en' },
  status: MergeNotifyStatus,
): Promise<void> {
  try {
    const issue = await fetchSingleIssue(project, iid, token).catch(() => null)
    const title = issue?.title || `#${iid}`
    const linkOpts = issue ? buildLinkOpts(project, issue, iid) : { iveUrl: getIveBaseUrl() ? `${getIveBaseUrl()}/issues/${project.id}/${iid}` : '', webUrl: '', providerLabel: (project.provider === 'github' ? 'GitHub' : 'GitLab') as 'GitHub' | 'GitLab' }
    const msgOpts: MergeMessageOpts = { iid, title, ...linkOpts }
    const workspaceId = project.slackWorkspaceId || ''
    const ready = status === 'success' || status === 'merged'

    // 확인자 수신자 해석 — ready + 확인대기(IVE-P) + 알림 라벨(IVE-N) 일 때만
    let confirmers: StageRecipient[] = []
    if (ready && issue) {
      const labels = extractLabels(issue)
      const notifyLabel = project.labelNotify || 'IVE-N'
      const confirmWaitLabel = project.labelConfirmWait || 'IVE-P'
      if (labels.includes(notifyLabel) && labels.includes(confirmWaitLabel)) {
        confirmers = resolveStageRecipients(project, issue, 'confirm')
      }
    }
    const confirmerSlackIds = new Set(confirmers.map(c => c.slackUserId))

    const jobs: Promise<unknown>[] = []
    // 확인자에게 "이제 확인하세요"
    for (const c of confirmers) {
      jobs.push(sendSlackDM(workspaceId, c.slackUserId, buildConfirmReadyMessage(c.locale, msgOpts)).catch(() => false))
    }
    // 머지 누른 본인에게 배포 결과 — 단, 본인이 확인자(이미 확인 메시지 받음)면 생략
    if (initiator.slackUserId && !(ready && confirmerSlackIds.has(initiator.slackUserId))) {
      jobs.push(sendSlackDM(initiator.slackWorkspaceId || workspaceId, initiator.slackUserId, buildInitiatorMergeMessage(status, initiator.locale, msgOpts)).catch(() => false))
    }
    await Promise.all(jobs)
  } catch (e) {
    console.warn('[slack-notify] notifyMergeOutcome failed:', (e as Error)?.message || e)
  }
}
