/**
 * 재기동 재처리 — 처리(dev) 중이던 에이전트 실행이 서버 재기동으로 끊겨 처리 실패(dev_fail)로 남은 이슈를
 * 대기(IVE-S)로 되돌린다. 화면의 「재처리」(dev_fail → retry)와 같은 전이(applyStageAction)를 쓴다.
 *
 * 근거는 DB 의 실행 기록뿐이다 — 기동 정리(resetStuckExecutions)가 남긴 end_reason='restart'.
 * 되돌린 뒤엔 'restart_requeued' 로 바꿔 두 번 되돌리지 않는다. 연달아 끊기면(작업이 서버를 죽이는 경우 등)
 * MAX_RESTART_REQUEUE 에서 멈추고 이슈 안내(stage_worker_note)로 사람에게 넘긴다.
 *
 * Git 코멘트는 달지 않는다 — 봇 노트는 다음 실행이 「이전 처리 완료」로 세어 반복 차수를 올리고,
 * 그 앞에 달린 사용자 지시를 피드백에서 뺀다(execute.ts). 되돌린 사실은 사건 로그(reason=restart)에 남는다.
 *
 * 이력: #67 은 기동 때 issue_stages.stage 를 dev → waiting 으로 되돌렸으나, 단계를 라벨로 판정하게 바뀌면서(d63b7ea)
 * 그 줄이 지워져 재기동마다 처리 중이던 작업이 처리 실패로 굳었다(2026-10-03 운영 8건).
 */
import type { Project } from '@/types'
import { getLogger } from '../logger'
import { takeRestartRequeue, setExecutionEndReason, MAX_RESTART_REQUEUE, resetIssueScheduledAt, setStageWorkerNote } from '../db'
import { applyStageAction } from '../stage-apply'

const slog = getLogger('Scanner')

/** 재기동으로 처리가 연달아 끊겨 자동 재처리를 멈췄을 때의 안내 (처리 실패를 벗어나면 스캐너가 지운다) */
export const RESTART_GAVE_UP_NOTE = '처리 작업이 서버 재기동으로 연달아 끊겨 자동 재처리를 멈췄습니다 — 확인 후 「재처리」해 주세요'

/** 처리 실패(dev_fail)·활성 실행 없음인 이슈에만 부른다. */
export async function requeueRestartInterrupted(
  project: Project, iid: number, token: string,
): Promise<'requeued' | 'gave_up' | 'failed' | null> {
  const rq = takeRestartRequeue(project.id, iid)
  if (!rq) return null

  if (rq.streak > MAX_RESTART_REQUEUE) {
    setExecutionEndReason(rq.executionId, 'restart_gave_up')
    try { setStageWorkerNote(project.id, iid, RESTART_GAVE_UP_NOTE) } catch { /* 안내 실패는 무시 */ }
    slog.warn(`[RESTART-REQUEUE] Issue #${iid} — 재기동으로 ${rq.streak}회 연달아 끊김, 자동 재처리 중단`)
    return 'gave_up'
  }

  try {
    await applyStageAction(project, iid, token, 'dev_fail', 'retry', {
      source: 'scanner', executionId: rq.executionId, reason: 'restart',
    })
  } catch (e) {
    // 전이 실패 — end_reason 을 그대로 두어 다음 스캔에 다시 시도한다
    slog.warn(`[RESTART-REQUEUE] Issue #${iid} 전이 실패: ${(e as Error).message}`)
    return 'failed'
  }
  setExecutionEndReason(rq.executionId, 'restart_requeued')
  resetIssueScheduledAt(project.id, iid)
  slog.info(`[RESTART-REQUEUE] Issue #${iid} — 재기동으로 끊긴 처리(${rq.executionId}) 대기로 되돌림 (${rq.streak}/${MAX_RESTART_REQUEUE})`)
  return 'requeued'
}
