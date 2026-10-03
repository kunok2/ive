/**
 * 검증 통과 즉시 머지 — 검증(③) 에이전트가 통과시킨 이슈의 MR 을 그 자리에서 머지한다.
 *
 * 프로젝트 설정 「자동 머지」(merge.agentMerge)가 켜져 있을 때만 머지한다. 꺼져 있으면 사람이 머지한다.
 * 머지한 뒤의 확인(④)은 stage-dispatch 가 종전처럼 「MR 머지 커밋이 staging 배포 커밋에 들어 있는가」로 기동한다.
 *
 * 머지하지 않고 사람에게 넘기는 경우(한 번만 시도한다 — 실패해도 다시 돌지 않는다):
 *   - MR 이 없거나 닫힘·이미 머지됨(이미 머지됐으면 할 일이 없다)
 *   - MR 대상 브랜치가 검증한 staging 브랜치와 다름 — 머지해도 staging 배포에 실리지 않는다
 *   - 검증한 뒤 MR 에 새 커밋이 올라옴 — 검증하지 않은 코드를 머지하지 않는다(머지 API 에도 sha 를 넘긴다)
 *   - 머지 API 실패(권한·충돌·파이프라인 필수 규칙 등)
 */
import { getLogger } from '../logger'
import { Project } from '@/types'
import { getProjectAutomation, setStageWorkerNote, takeLegacyQueuedItems, getLatestBundleItem, stageFromLabels, getDb } from '../db'
import { addIssueComment, fetchMRByBranch, mergeMR, isIssueClosedByGit, reopenIssue } from '../provider'
import { resolveStagingBranch } from '../staging-config'
import { resolveProjectLocale } from './stage-worker'
import { notifyConfirmerOnApprove } from '../merge-watcher'
import { maskSecrets } from '../secret-mask'

const slog = getLogger('AutoMerge')

export interface MergeVerifiedInput {
  project: Project
  token: string
  iid: number
  /** 검증한 커밋(dev-{iid} 머리) */
  sourceSha: string
  /** 검증한 대상 브랜치(staging) */
  targetBranch: string
  isKo: boolean
  log?: (msg: string, level?: 'system' | 'warn' | 'error') => void
}

export type MergeVerifiedResult =
  | { merged: true; mergeCommit: string | null }
  | { merged: false; reason: 'off' | 'already' | 'skipped' | 'failed'; note?: string }

export async function mergeVerified(input: MergeVerifiedInput): Promise<MergeVerifiedResult> {
  const { project, token, iid, sourceSha, targetBranch, isKo } = input
  const log = input.log ?? ((msg: string) => slog.info(`${project.name} #${iid} ${msg}`))
  const t = (ko: string, en: string) => (isKo ? ko : en)

  if (!getProjectAutomation(project.id).merge.agentMerge) {
    const note = t('검증 통과 — 자동 머지가 꺼져 있어 사람이 MR 을 머지하면 확인이 시작됩니다', 'Verified — auto-merge is off; confirmation starts once a person merges the MR')
    setStageWorkerNote(project.id, iid, note)
    log('자동 머지 꺼짐 — 사람이 머지', 'system')
    return { merged: false, reason: 'off', note }
  }

  const handOff = async (note: string, reason: 'skipped' | 'failed'): Promise<MergeVerifiedResult> => {
    setStageWorkerNote(project.id, iid, note)
    log(note, 'warn')
    try {
      await addIssueComment(project, iid, token, `<!-- ive-bot -->\n## ⚠️ ${t('자동 머지하지 않음 — 사람이 머지해 주세요', 'Not auto-merged — please merge manually')}\n\n${note}`)
    } catch { /* 코멘트 실패는 무시 — 노트가 화면에 남는다 */ }
    return { merged: false, reason, note }
  }

  let mr: any = null
  try { mr = await fetchMRByBranch(project, token, `dev-${iid}`) } catch (e) { return handOff(t(`MR 조회 실패: ${(e as Error).message}`, `MR lookup failed: ${(e as Error).message}`), 'failed') }
  if (!mr) return handOff(t(`dev-${iid} MR 이 없습니다`, `No MR for dev-${iid}`), 'skipped')
  if (mr.state === 'merged' || mr.merged_at) { log('MR 이 이미 머지됨', 'system'); return { merged: false, reason: 'already' } }
  if (mr.state === 'closed') return handOff(t(`dev-${iid} MR 이 닫혀 있습니다`, `MR for dev-${iid} is closed`), 'skipped')
  if (mr.target_branch && mr.target_branch !== targetBranch) {
    return handOff(t(`MR 대상(\`${mr.target_branch}\`)이 검증한 staging 브랜치(\`${targetBranch}\`)와 다릅니다 — 머지해도 staging 배포에 실리지 않습니다`,
      `MR targets \`${mr.target_branch}\`, not the verified staging branch \`${targetBranch}\``), 'skipped')
  }
  if (mr.sha && mr.sha !== sourceSha) {
    return handOff(t(`검증한 뒤 MR 에 새 커밋이 올라왔습니다(검증 \`${sourceSha.slice(0, 8)}\` · 지금 \`${String(mr.sha).slice(0, 8)}\`) — 검증하지 않은 코드는 머지하지 않습니다`,
      `New commits after verification (verified ${sourceSha.slice(0, 8)}, now ${String(mr.sha).slice(0, 8)})`), 'skipped')
  }

  const mrIid = mr.iid ?? mr.number
  let res: any
  try {
    res = await mergeMR(project, token, mrIid, { sha: sourceSha })
  } catch (e) {
    return handOff(t(`MR 머지 실패: ${maskSecrets((e as Error).message).slice(0, 300)}`, `MR merge failed: ${maskSecrets((e as Error).message).slice(0, 300)}`), 'failed')
  }
  const mergeCommit: string | null = res?.merge_commit_sha || res?.squash_commit_sha || (project.provider === 'github' ? res?.sha : null) || null
  setStageWorkerNote(project.id, iid, null)
  log(`MR !${mrIid} 머지${mergeCommit ? ` (${mergeCommit.slice(0, 12)})` : ''} — staging 배포를 기다려 확인합니다`, 'system')
  try {
    await addIssueComment(project, iid, token, `<!-- ive-bot -->\n## 🔀 ${t('검증 통과 — MR 머지', 'Verified — MR merged')}\n\n`
      + `- MR: ${maskSecrets(mr.web_url || mr.html_url || `!${mrIid}`)}\n`
      + `- ${t('검증한 커밋', 'Verified commit')}: \`${sourceSha.slice(0, 12)}\` → \`${targetBranch}\`${mergeCommit ? ` · ${t('머지 커밋', 'Merge commit')} \`${mergeCommit.slice(0, 12)}\`` : ''}\n\n`
      + t('staging 에 배포되면 확인(④)이 시작됩니다.', 'Confirmation starts once staging is deployed.'))
  } catch { /* 코멘트 실패는 무시 */ }
  // 확인자가 사람이면 「이제 확인하세요」 DM — MR 이 머지된 뒤에만 보낸다(종전 승인 경로와 같은 함수)
  void notifyConfirmerOnApprove(project, iid, token)
  return { merged: true, mergeCommit }
}

/**
 * 묶음 배포를 없애기 전 대기열에 올라 있던 이슈 — 한 번 바로 머지로 넘긴다(DB 에서 꺼낸 줄은 닫혀 다시 나오지 않는다).
 * 지금도 확인대기(P)인 이슈만 머지한다. 단계가 바뀐 이슈는 그대로 둔다.
 */
export async function handOffLegacyBundleQueue(project: Project, token: string, stageOf: Map<number, string | null>): Promise<void> {
  const items = takeLegacyQueuedItems(project.id)
  if (!items.length) return
  const targetBranch = await resolveStagingBranch(project, token)
  const { isKo } = resolveProjectLocale(project)
  for (const it of items) {
    if (stageOf.get(it.issueIid) !== 'confirm_waiting') continue
    slog.info(`[LEGACY] ${project.name} #${it.issueIid} — 묶음 대기열에서 바로 머지로 넘김`)
    await mergeVerified({ project, token, iid: it.issueIid, sourceSha: it.sourceSha, targetBranch, isKo })
  }
}

/** 확인 전에 IVE 가 머지한 이슈인가 — 마지막 검증이 에이전트 통과였거나, 예전 묶음으로 staging 에 푸시됐다(DB 기록) */
function mergedByIveBeforeConfirm(projectId: string, iid: number): boolean {
  const v = getDb().prepare(`
    SELECT assignee_type, stage_verdict FROM task_executions
    WHERE project_id = ? AND issue_iid = ? AND id LIKE 'ex-verify-%' ORDER BY started_at DESC LIMIT 1
  `).get(projectId, iid) as { assignee_type: string | null; stage_verdict: string | null } | undefined
  if (v?.assignee_type === 'agent' && v.stage_verdict === 'pass') return true
  return getLatestBundleItem(projectId, iid)?.status === 'pushed'
}

/**
 * 확인(④)을 기다리는 이슈를 IVE 의 머지 직후 Git 이 닫았으면(MR·커밋의 닫기 키워드) 다시 연다.
 * 이슈는 확인이 끝나 완료(E)가 될 때 IVE 가 닫는다. 사람이 직접 닫았거나 사람이 머지한 이슈는 건드리지 않는다.
 * @returns 다시 열었으면 true
 */
export async function reopenIfClosedBeforeConfirm(project: Project, token: string, iid: number, issue: any): Promise<boolean> {
  if (!issue || issue.state !== 'closed') return false
  const st = stageFromLabels(issue.labels || [], project, { hasActiveExec: false })
  if (st !== 'confirm_waiting' && st !== 'confirming') return false
  if (!mergedByIveBeforeConfirm(project.id, iid)) return false
  if ((await isIssueClosedByGit(project, iid, token)) !== true) return false
  const { isKo } = resolveProjectLocale(project)
  await reopenIssue(project, iid, token)
  slog.info(`${project.name} #${iid} reopened — closed by Git before confirmation`)
  try {
    await addIssueComment(project, iid, token, isKo
      ? `<!-- ive-bot -->\n## 🔓 이슈를 다시 열었습니다\n\n검증 통과로 MR 을 머지하면서 닫기 키워드로 Git 이 이 이슈를 닫았습니다. 아직 확인(④) 전이라 다시 엽니다 — 확인이 끝나 완료되면 IVE 가 닫습니다.`
      : `<!-- ive-bot -->\n## 🔓 Reopened\n\nGit closed this issue via a closing keyword when the verified MR was merged. Confirmation is still pending — IVE closes it when it is done.`)
  } catch { /* 코멘트 실패는 무시 */ }
  return true
}
