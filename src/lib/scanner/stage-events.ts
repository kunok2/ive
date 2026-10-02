/**
 * 스캐너가 라벨 변화로 감지한 단계 전이를 사건 로그(issue_events)에 남긴다.
 *
 * 이 경로가 잡는 것은 Git 화면이나 glab/gh 로 사람이 직접 라벨을 옮긴 전이다.
 * IVE 가 직접 옮긴 전이(화면 버튼·단계 작업자·에이전트 처리 완료)는 그 자리에서 작업자·실행과 함께 이미 남겼으므로,
 * 마지막 단계 사건이 이미 같은 도착 단계면 Git 라벨 이력을 조회하지 않고 건너뛴다.
 *
 * 규칙
 *  - 출발 단계는 사건 로그의 마지막 도착 단계를 따른다(로그가 끊기지 않게). 로그가 없으면 캐시된 단계.
 *  - 처리 실패(dev_fail)는 처리 중(dev)에서만 생긴다. 그 밖에서 dev_fail 로 보이면 담당자가 IVE-D 를 막 붙여
 *    실행이 아직 만들어지지 않은 순간이므로 처리 시작(dev)으로 남긴다.
 *  - 라벨이 바뀌지 않는 전이(처리 중 ↔ 처리 실패)와 처음 보는 이슈는 라벨 이력을 조회하지 않는다.
 *  - 라벨을 붙인 사람·시각은 그 시각이 마지막 사건보다 뒤일 때만 쓴다(앞 사이클의 라벨을 이번 전이로 오인하지 않게).
 *  - 단계 기록 없이 곧바로 완료로 보인 사후 기록(IVE-E)은 이슈를 만든 사람이 직접 처리하고 등록한 것이다 — 작업자는 이슈 작성자.
 */
import type { Project } from '@/types'
import type { StageActor } from '../ive-author'
import { getLastStageEvent, normStage as norm, recordStageEvent, UNKNOWN_ACTOR, type EventActor } from '../db'
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
  /** 이슈 작성자(Git) — 사후 기록(곧바로 완료)의 작업자 */
  author?: { username?: string | null; gitUserId?: string | number | null } | null
}

/** @returns 기록했으면 true */
export async function recordScannedStageChange(c: ScannedStageChange): Promise<boolean> {
  const last = getLastStageEvent(c.project.id, c.iid)
  const prev = last ? last.to : norm(c.prevStage)
  let next = norm(c.stage)
  if (next === 'dev_fail' && prev !== 'dev') next = 'dev'
  if (prev === next) return false

  const labelChanged = !((prev === 'dev' && next === 'dev_fail') || (prev === 'dev_fail' && next === 'dev'))
  const firstSighting = !last && norm(c.prevStage) === null
  let who: StageActor | null = null
  if (labelChanged && !firstSighting) {
    who = c.knownActor !== undefined ? c.knownActor : await c.resolveActor()
  }
  // 라벨 이벤트가 마지막 사건보다 앞이면 앞 사이클의 것이다 — 이번 전이의 작업자·시각으로 쓰지 않는다
  const whoAt = who?.createdAt && !isNaN(new Date(who.createdAt).getTime()) ? new Date(who.createdAt).toISOString() : null
  if (who && (!whoAt || (last && whoAt <= last.at))) who = null
  // 단계 기록이 없던 이슈가 곧바로 완료로 보이면 사후 기록(IVE-E)이다
  const external = prev === null && next === 'done'
  const authorActor = external && c.author ? gitActor(c.project, c.author) : null
  const actor: EventActor = who
    ? (who.user ? userActor(who.user, who.username) : gitActor(c.project, { username: who.username }))
    : authorActor && authorActor.type !== 'unknown' ? authorActor : UNKNOWN_ACTOR
  return recordStageEvent({
    projectId: c.project.id, issueIid: c.iid, fromStage: prev, toStage: next, actor, source: 'scanner',
    action: external ? 'external' : null,
    detail: who || actor !== UNKNOWN_ACTOR ? null : { assignee: c.assigneeUsername() },
    occurredAt: who ? whoAt! : undefined,
  })
}
