/**
 * 보고서 모델 — 화면 API·메일·확정본이 함께 쓰는 단 하나의 진입점.
 *
 * 기간이 닫히면 그때 계산한 모델을 확정본으로 저장하고, 이후에는 저장본을 쓴다
 * (단가를 나중에 바꿔도 과거 보고서와 이미 보낸 메일의 숫자가 바뀌지 않는다).
 * 확정본은 종전 보고서와 섞이지 않도록 보고서 종류 뒤에 판(@v2)을 붙여 저장한다.
 */
import { getReportSnapshot, putReportSnapshot, deleteReportSnapshot, getDb } from '../db'
import { buildReportModel, stageTimeForPeriod, stageWorkForPeriod } from './build'
import { periodOf, isClosed, addDays, kstToday, FINALIZE_AFTER_DAYS, type ReportType } from './period'
import { scopeKey, avatarsOfPersonKeys, type Scope } from './load'
import type { ReportModel } from './types'
import { DEFAULT_PROJECT_COLOR } from './format'

export * from './types'
export type { Scope, FilteredScope } from './load'
export { periodOf, previousPeriod, kstToday, FINALIZE_AFTER_DAYS, type ReportType, type Period } from './period'

const snapKind = (type: ReportType) => `${type}@v2`
/** 범위 없는 전체 보고서(관리자 메일 등)의 확정본 소유자 표기 */
const GLOBAL_SCOPE = '__all__'

/**
 * 확정본에 지금의 프로젝트 주제색을 입힌다. 색은 기록된 숫자가 아니라 표시 속성이라 확정하지 않는다
 * (프로젝트 색을 바꾸면 지난 보고서도 따라 바뀌고, 색 도입 전에 저장된 확정본도 주제색으로 그려진다).
 */
function withProjectColors(model: ReportModel): ReportModel {
  const colors = new Map((getDb().prepare('SELECT id, color FROM projects').all() as { id: string; color: string | null }[])
    .map(r => [r.id, r.color || DEFAULT_PROJECT_COLOR]))
  const colorOf = (id: string) => colors.get(id) ?? DEFAULT_PROJECT_COLOR
  return {
    ...model,
    projects: model.projects.map(p => ({ ...p, color: colorOf(p.id) })),
    months: model.months?.map(m => ({ ...m, projectShares: m.projectShares.map(s => ({ ...s, color: colorOf(s.id) })) })),
  }
}

/**
 * 단계별 시간이 생기기 전에 확정된 보고서 — 읽을 때 채운다(저장본은 그대로 둔다).
 * 근거인 실행 기록은 지난 기간에 대해 바뀌지 않으므로 확정 당시 계산과 같은 값이다.
 */
function withStageTime(model: ReportModel, scope: Scope, type: ReportType, day: string): ReportModel {
  const m = model.stageTime ? model : { ...model, stageTime: stageTimeForPeriod(scope, type, day) }
  if (m.stageWork) return m
  // 누가 검증·확인했나도 같은 까닭으로 읽을 때 채운다 — 아바타도 함께
  const stageWork = stageWorkForPeriod(scope, type, day)
  return { ...m, stageWork, avatars: { ...(m.avatars ?? {}), ...avatarsOfPersonKeys(stageWork.people.map(p => p.key)) } }
}

/**
 * 보고서 모델을 얻는다. 끝나고 FINALIZE_AFTER_DAYS 가 지난 기간은 확정본(없으면 지금 계산해 확정),
 * 그 전(진행 중·막 끝남)은 매번 계산한다. 막 끝나 아직 확정 전인 기간은 provisional(잠정)로 표시한다.
 */
export function getReportModel(scope: Scope, type: ReportType, day: string, now: Date = new Date()): ReportModel {
  const p = periodOf(type, day)
  const owner = scopeKey(scope, GLOBAL_SCOPE)
  if (isClosed(p, now) && kstToday(now) >= addDays(p.end, FINALIZE_AFTER_DAYS)) {
    const snap = getReportSnapshot(owner, snapKind(type), p.start, p.end)
    if (snap) return { ...withStageTime(withProjectColors(snap.payload as ReportModel), scope, type, day), snapshotAt: snap.generatedAt }
    const model = buildReportModel(scope, type, day, now)
    const at = putReportSnapshot(owner, snapKind(type), p.start, p.end, model)
    // 동시에 두 번 계산됐으면 먼저 저장된 쪽이 확정본이다 — 그것을 다시 읽어 돌려준다
    const saved = getReportSnapshot(owner, snapKind(type), p.start, p.end)
    return saved ? { ...withStageTime(withProjectColors(saved.payload as ReportModel), scope, type, day), snapshotAt: saved.generatedAt } : { ...model, snapshotAt: at }
  }
  const model = buildReportModel(scope, type, day, now)
  return isClosed(p, now) ? { ...model, provisional: true } : model
}

/** 확정본 재생성 — 지우면 다음 조회에서 지금의 계산·단가로 다시 확정된다 */
export function regenerateReportModel(scope: Scope, type: ReportType, day: string): void {
  const p = periodOf(type, day)
  deleteReportSnapshot(scopeKey(scope, GLOBAL_SCOPE), snapKind(type), p.start, p.end)
}
