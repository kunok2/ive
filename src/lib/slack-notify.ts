// 작업완료 → Slack 알림 (DM + 채널 멘션)
//
// 트리거 규칙:
//  1. 이슈에 알림 라벨(project.labelNotify, 기본 IVE-N)이 붙어 있어야 발송한다. (라벨 = 트리거)
//  2. 수신자 = 이슈의 GitLab/GitHub 담당자 → IVE 사용자 매핑.
//  3. 담당자가 slackNotify=false 이면 라벨이 있어도 보내지 않는다. (사용자 veto)
//
// DM 은 im:write 권한이 필요하다(없으면 Slack API가 실패 → 조용히 무시). 채널 멘션은 현 권한으로 동작.
import { Project } from '@/types'
import { fetchSingleIssue } from './provider'
import { getUserByOAuthId } from './db'
import { sendSlackDM, sendSlackChannelMessage } from './slack'

export type NotifyStatus = 'success' | 'failed'

interface NotifyParams {
  project: Project
  iid: number
  token: string
  status: NotifyStatus
  agentName?: string
  durationStr?: string
  mrUrl?: string
  issueTitle?: string
}

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

/**
 * 작업이 종료(success/failed)됐을 때 호출. 라벨/담당자/veto 규칙을 적용해 DM·채널 알림을 보낸다.
 * 내부에서 모든 오류를 삼키므로 호출 측은 결과를 신경 쓸 필요가 없다(fire-and-forget 안전).
 */
export async function notifyIssueDone(params: NotifyParams): Promise<void> {
  const { project, iid, token, status } = params
  try {
    if (!token) return
    const issue = await fetchSingleIssue(project, iid, token).catch(() => null)
    if (!issue) return

    // 1) 트리거: 알림 라벨이 붙은 이슈만
    const notifyLabel = project.labelNotify || 'IVE-N'
    if (!extractLabels(issue).includes(notifyLabel)) return

    const title = params.issueTitle || issue.title || `#${iid}`
    const workspaceId = project.slackWorkspaceId || ''

    // 2) 수신자: 담당자 → IVE 사용자, 본인 veto(slackNotify=false)·미연결(slackUserId 빈값) 제외
    const recipients = extractAssigneeIds(issue)
      .map(id => getUserByOAuthId(project.provider, id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .filter(u => u.slackNotify && !!u.slackUserId)

    // 메시지 본문
    const icon = status === 'success' ? '✅' : '❌'
    const verb = status === 'success' ? '완료' : '실패'
    const meta = [params.agentName, params.durationStr].filter(Boolean).join(' · ')
    const tail = params.mrUrl ? `\n${params.mrUrl}` : ''
    const body = `${icon} #${iid} "${title}" ${verb}${meta ? ` — ${meta}` : ''}${tail}`

    // 3) DM (담당자 개인 → 폰 푸시)
    await Promise.all(
      recipients.map(u => sendSlackDM(workspaceId, u.slackUserId as string, body).catch(() => false)),
    )

    // 4) 채널 + 멘션 (프로젝트에 알림 채널이 설정된 경우)
    if (project.slackNotifyChannel) {
      const mentions = recipients.map(u => `<@${u.slackUserId}>`).join(' ')
      const channelText = mentions ? `${mentions} ${body}` : body
      await sendSlackChannelMessage(workspaceId, project.slackNotifyChannel, channelText).catch(() => false)
    }
  } catch (e) {
    console.warn('[slack-notify] notifyIssueDone failed:', (e as Error)?.message || e)
  }
}
