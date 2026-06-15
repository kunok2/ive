// 서버측 머지 후 파이프라인(CI) 감시.
//
// 머지를 IVE 에서 누르면(알림 체크 ON) 이 감시자가 백그라운드에서 파이프라인 상태를
// 폴링하다가, 완료되는 순간 Slack DM 을 발송한다. 브라우저 탭이 닫혀 있어도 동작하므로
// "폰으로 알림" 의도에 부합한다. (클라이언트 toast 는 그대로 유지 — 탭이 열려 있을 때 즉시 피드백)
//
// 발송 정책은 notifyMergeOutcome 가 담당:
//   - 머지 누른 본인 → 배포 성공/실패
//   - 확인자 → 머지+CI 가 끝나 확인 가능해진 시점에 "이제 확인하세요" (확인대기 단계일 때만)
//
// 확인자 알림 타이밍 조율: 감시 중에는 stage/route 의 approve 경로가 확인자 DM 을 보내지
// 않고(isMergeWatchActive), 여기서 CI 완료 시 보낸다. 감시가 없으면(외부 머지 등) approve
// 경로가 "이미 머지됨" 을 확인하고 직접 보낸다.
import { Project } from '@/types'
import { getMergePipeline } from './merge-pipeline'
import { notifyMergeOutcome, notifyStageTransition, type MergeNotifyStatus } from './slack-notify'
import { fetchMRByBranch } from './provider'

export interface MergeWatchInitiator {
  slackWorkspaceId: string
  slackUserId: string
  locale: 'ko' | 'en'
}

// dev 핫리로드에도 살아남도록 global 사용(scanner 와 동일 패턴).
declare global {
  // eslint-disable-next-line no-var
  var __mergeWatchKeys: Set<string> | undefined
}
const activeKeys: Set<string> = (global.__mergeWatchKeys ??= new Set<string>())

const FIRST_DELAY_MS = 5000      // 머지 직후 파이프라인이 아직 안 생겼을 수 있어 첫 폴링은 지연
const POLL_INTERVAL_MS = 10000   // 이후 10초 간격
const MAX_ATTEMPTS = 60          // 최대 ~10분 (클라이언트 watchPipeline 과 동일)
const NO_PIPELINE_GRACE = 12     // 이 횟수(~2분) 동안 파이프라인이 한 번도 안 보이면 "CI 없음" 으로 간주

function key(projectId: string, iid: number) { return `${projectId}:${iid}` }

/** 해당 이슈에 대한 머지 감시가 진행 중인지. (approve 경로의 확인자 DM 조율용) */
export function isMergeWatchActive(projectId: string, iid: number): boolean {
  return activeKeys.has(key(projectId, iid))
}

/**
 * 머지 후 파이프라인 감시 시작(fire-and-forget). 이미 감시 중이면 무시.
 * @param token  폴링용 토큰(장시간 동작하므로 프로젝트 토큰 권장).
 */
export function watchMergePipeline(project: Project, token: string, iid: number, initiator: MergeWatchInitiator): void {
  const k = key(project.id, iid)
  if (activeKeys.has(k)) return
  if (!initiator.slackUserId) return // 받을 사람이 없으면 감시 의미 없음
  activeKeys.add(k)

  let attempts = 0
  let sawPipeline = false
  let timer: ReturnType<typeof setInterval> | null = null

  const finish = (status: MergeNotifyStatus | null) => {
    if (timer) clearInterval(timer)
    timer = null
    activeKeys.delete(k)
    if (status) {
      void notifyMergeOutcome(project, token, iid, initiator, status)
    }
  }

  const poll = async () => {
    attempts++
    try {
      const pipeline = await getMergePipeline(project, token, iid)
      if (pipeline) {
        sawPipeline = true
        const s = pipeline.status
        if (s === 'success') return finish('success')
        if (s === 'failed') return finish('failed')
        if (s === 'canceled' || s === 'cancelled') return finish('failed')
        // running/pending/created/manual 등 → 계속 폴링
      } else if (!sawPipeline && attempts >= NO_PIPELINE_GRACE) {
        // CI 가 없는 프로젝트 → 머지 자체로 완료 취급
        return finish('merged')
      }
    } catch {
      // 일시적 네트워크/권한 오류는 무시하고 계속 폴링
    }

    if (attempts >= MAX_ATTEMPTS) {
      // 시간 초과 — DM 없이 종료(클라이언트 toast 가 monitoringTimeout 으로 안내). 무한 폴링 방지.
      finish(null)
    }
  }

  setTimeout(() => {
    if (!activeKeys.has(k)) return // 그 사이 종료됐으면 스킵
    void poll()
    timer = setInterval(() => { void poll() }, POLL_INTERVAL_MS)
  }, FIRST_DELAY_MS)
}

/**
 * 확인대기(IVE-P) 진입 시점(verifier approve)에 호출. "이제 확인하세요" 발송 여부를 조율한다.
 *  - 머지 감시가 진행 중이면: 보내지 않음(감시자가 CI 완료 때 보냄).
 *  - MR 이 이미 머지됐고 감시가 없으면: 지금 발송(외부 머지/CI 이미 종료된 경우 누락 방지).
 *  - 아직 머지 전이면: 보내지 않음(IVE 로 머지하면 감시자가, 외부 머지면 다음 진입에 처리).
 */
export async function notifyConfirmerOnApprove(project: Project, iid: number, token: string): Promise<void> {
  try {
    if (isMergeWatchActive(project.id, iid)) return
    const mr = await fetchMRByBranch(project, token, `dev-${iid}`).catch(() => null)
    if (mr?.state === 'merged') {
      await notifyStageTransition(project, iid, token, 'confirm')
    }
  } catch (e) {
    console.warn('[merge-watcher] notifyConfirmerOnApprove failed:', (e as Error)?.message || e)
  }
}
