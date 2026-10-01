/**
 * 스캐너가 라벨 변화로 감지한 단계 전이를 사건 로그(issue_events)에 남긴다.
 *
 * 이 경로가 잡는 것은 Git 화면이나 glab/gh 로 사람이 직접 라벨을 옮긴 전이다.
 * IVE 가 직접 옮긴 전이(화면 버튼·단계 작업자·에이전트 처리 완료)는 그 자리에서 작업자·실행과 함께 이미 남겼으므로,
 * 마지막 단계 사건이 이미 같은 도착 단계면 Git 라벨 이력을 조회하지 않고 건너뛴다.
 */
import type { Project } from '@/types'
import type { StageActor } from '../ive-author'
import { recordStageEvent, getLastStageEventTo, UNKNOWN_ACTOR, type EventActor } from '../db'
import { userActor, gitActor } from '../event-actor'

export interface ScannedStageChange {
  project: Pick<Project, 'id' | 'provider'>
  iid: number
  prevStage: string | null | undefined
  stage: string | null | undefined
  /** 이미 조회한 라벨 부착자(검증·확인 마커 처리에서 조회한 경우). undefined 면 필요할 때 resolveActor 로 조회 */
  knownActor?: StageActor | null
  /** 이 단계 라벨을 붙인 사람(라벨 이력 조회). 조회 실패·봇이면 null */
  resolveActor: () => Promise<StageActor | null>
  /** 작업자를 모를 때 참고로 남길 담당자 Git 계정 */
  assigneeUsername: () => string | null
}

/** @returns 기록했으면 true */
export async function recordScannedStageChange(c: ScannedStageChange): Promise<boolean> {
  const prev = c.prevStage ?? null
  const next = c.stage ?? null
  if (prev === next) return false
  if (getLastStageEventTo(c.project.id, c.iid) === next) return false

  const who = c.knownActor !== undefined ? c.knownActor : await c.resolveActor()
  const actor: EventActor = who
    ? (who.user ? userActor(who.user, who.username) : gitActor(c.project, { username: who.username }))
    : UNKNOWN_ACTOR
  // 라벨을 붙인 시각을 알면 그 시각이 전이 시각이다(스캔 주기만큼 늦은 스캔 시각보다 정확하다)
  const at = who?.createdAt && !isNaN(new Date(who.createdAt).getTime()) ? new Date(who.createdAt).toISOString() : undefined
  return recordStageEvent({
    projectId: c.project.id, issueIid: c.iid, fromStage: prev, toStage: next, actor, source: 'scanner',
    // 단계 기록이 없던 이슈가 곧바로 완료로 보이면 사후 기록(IVE-E)이다
    action: prev === null && next === 'done' ? 'external' : null,
    detail: who ? null : { assignee: c.assigneeUsername() },
    occurredAt: at,
  })
}
