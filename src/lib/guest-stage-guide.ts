/**
 * IVE 를 쓰지 않는 담당자(비회원)에게 단계 진행 방법을 알리는 노트.
 *
 * 검증·확인을 맡은 사람이 Git 이슈 화면만 쓰면 IVE 는 그가 일을 끝냈는지 알 수 없다. 그래서 그 사람이 담당자가
 * 되면 「라벨을 이렇게 바꾸면 다음 단계로 간다」를 이슈 코멘트로 알린다. 상태는 움직이지 않는다 —
 * 사람이 라벨을 바꾸면 스캐너가 그 변경을 따라간다(기존 동작).
 *
 * 한 번만 단다: (이슈, 단계, 사람) 조합을 DB 에 기록하고, 코멘트 내용은 읽지 않는다.
 */
import { getDb, getUserByOAuthId, getUserByGitUsername } from './db'
import { hasOpenHumanStageExec } from './stage-person'
import { addIssueComment } from './provider'
import { getIveBaseUrl } from './slack-notify'
import { resolveProjectLocale } from './scanner/stage-worker'
import { getLogger } from './logger'
import type { Project } from '@/types'

const slog = getLogger('GuestGuide')

export interface GuestAssignee { id?: number | string | null; username?: string | null; login?: string | null }

/** 안내 대상 단계 — 검증 중·확인 중(사람이 그 단계를 맡은 때) */
export function guideKindOf(stage: string | null | undefined): 'verify' | 'confirm' | null {
  return stage === 'verifying' ? 'verify' : stage === 'confirming' ? 'confirm' : null
}

function isBotLogin(login: string): boolean {
  return /\[bot\]$|-bot$|^project_\d+_bot/i.test(login)
}

/** IVE 계정과 연결되지 않은 Git 사용자인가 (봇은 제외) */
export function isGuestAssignee(provider: 'github' | 'gitlab', a: GuestAssignee | null | undefined): boolean {
  if (!a) return false
  const username = a.username || a.login || null
  const gitId = a.id != null && String(a.id) !== '' ? String(a.id) : null
  if (!username && !gitId) return false
  if (username && isBotLogin(username)) return false
  const u = (gitId ? getUserByOAuthId(provider, gitId) : null) || (username ? getUserByGitUsername(provider, username) : null)
  return !u
}

/** 안내 코멘트 본문 — 순수 함수 */
export function buildGuestGuide(opts: {
  kind: 'verify' | 'confirm'
  isKo: boolean
  username: string | null
  labels: { verifying: string; confirming: string; confirmWait: string; verifyWait: string; schedule: string; end: string }
  iveUrl: string
}): string {
  const { kind, isKo, username, labels: L, iveUrl } = opts
  const t = (ko: string, en: string) => (isKo ? ko : en)
  const who = username ? ` (@${username})` : ''
  const lines: string[] = ['<!-- ive-bot -->', '<!-- ive-guest-guide -->']
  if (kind === 'verify') {
    lines.push(`## 🙋 ${t('검증을 맡으셨습니다', 'You are assigned to verify this')}${who}`, '')
    lines.push(t('IVE 를 쓰지 않아도 진행할 수 있습니다. 이 이슈의 **라벨을 바꾸면** IVE 가 단계를 따라갑니다.', 'You do not need IVE. **Changing this issue\'s labels** moves its stage in IVE.'), '')
    lines.push(`- **${t('통과', 'Pass')}**: ${t('PR/MR 을 머지하고, 라벨', 'merge the PR/MR, then replace label')} \`${L.verifying}\` → \`${L.confirmWait}\`. ${t('이슈 **담당자를 확인할 사람으로 바꿔 주세요.**', 'Then **assign the issue to the person who will confirm it.**')}`)
    lines.push(`- **${t('반려', 'Reject')}**: ${t('라벨', 'replace label')} \`${L.verifying}\` → \`${L.schedule}\`, ${t('이유를 코멘트로 남기고 이슈 **담당자를 다시 고칠 사람으로 바꿔 주세요.**', 'leave the reason as a comment, and **assign the issue to the person who will rework it.**')}`)
  } else {
    lines.push(`## 🙋 ${t('확인을 맡으셨습니다', 'You are assigned to confirm this')}${who}`, '')
    lines.push(t('IVE 를 쓰지 않아도 진행할 수 있습니다. 이 이슈의 **라벨을 바꾸면** IVE 가 단계를 따라갑니다.', 'You do not need IVE. **Changing this issue\'s labels** moves its stage in IVE.'), '')
    lines.push(`- **${t('통과', 'Pass')}**: ${t('라벨', 'replace label')} \`${L.confirming}\` → \`${L.end}\``)
    lines.push(`- **${t('반려', 'Reject')}**: ${t('라벨', 'replace label')} \`${L.confirming}\` → \`${L.verifyWait}\`, ${t('이유를 코멘트로 남기고 이슈 **담당자를 다시 검증할 사람으로 바꿔 주세요.**', 'leave the reason as a comment, and **assign the issue to the person who will re-verify it.**')}`)
  }
  lines.push('', t('단계 라벨은 항상 하나만 남겨 주세요.', 'Keep exactly one stage label on the issue.'))
  if (iveUrl) lines.push('', `${t('IVE 에서 직접 처리하려면(Git 계정으로 로그인)', 'Prefer IVE? Sign in with your Git account')}: ${iveUrl}`)
  return lines.join('\n')
}

/** 이 조합에 안내를 단 기록이 없으면 기록하고 true. 이미 있으면 false. */
function claim(projectId: string, iid: number, stage: string, personKey: string): boolean {
  return getDb().prepare('INSERT OR IGNORE INTO guest_stage_guides (project_id, issue_iid, stage, person_key) VALUES (?, ?, ?, ?)')
    .run(projectId, iid, stage, personKey).changes > 0
}
function unclaim(projectId: string, iid: number, stage: string, personKey: string) {
  getDb().prepare('DELETE FROM guest_stage_guides WHERE project_id = ? AND issue_iid = ? AND stage = ? AND person_key = ?').run(projectId, iid, stage, personKey)
}

/**
 * 검증 중·확인 중인 이슈의 담당자가 비회원이고 사람이 그 단계를 맡았으면(에이전트 아님) 안내를 한 번 단다.
 * 코멘트가 실패하면 기록을 지워 다음 스캔에서 다시 시도한다. 달았으면 true.
 */
export async function postGuestGuideIfNeeded(project: Project, token: string, iid: number, stage: string | null | undefined, assignees: GuestAssignee[] | null | undefined): Promise<boolean> {
  const kind = guideKindOf(stage)
  if (!kind || !stage) return false
  const provider = project.provider === 'github' ? 'github' : 'gitlab'
  const a = assignees?.[0]
  if (!isGuestAssignee(provider, a)) return false
  if (!hasOpenHumanStageExec(project.id, iid, kind)) return false
  const username = a?.username || a?.login || null
  const personKey = String(a?.id ?? username)
  if (!claim(project.id, iid, stage, personKey)) return false
  try {
    const { isKo } = resolveProjectLocale(project)
    const base = getIveBaseUrl()
    const body = buildGuestGuide({
      kind, isKo, username,
      labels: { verifying: project.labelVerify, confirming: project.labelConfirm, confirmWait: project.labelConfirmWait, verifyWait: project.labelVerifyWait, schedule: project.labelSchedule, end: project.labelEnd },
      iveUrl: base ? `${base}/issues/${project.id}/${iid}` : '',
    })
    await addIssueComment(project, iid, token, body)
    slog.info(`${project.name} #${iid} ${stage} — 비회원 담당자(${username}) 진행 안내 노트`)
    return true
  } catch (e) {
    unclaim(project.id, iid, stage, personKey)
    slog.warn(`${project.name} #${iid} 안내 노트 실패: ${(e as Error).message}`)
    return false
  }
}
