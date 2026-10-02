/**
 * 보고서 모델 — 화면 API·메일·확정본이 함께 쓰는 단 하나의 진입점.
 *
 * 기간이 닫히면 그때 계산한 모델을 확정본으로 저장하고, 이후에는 저장본을 쓴다
 * (단가를 나중에 바꿔도 과거 보고서와 이미 보낸 메일의 숫자가 바뀌지 않는다).
 * 확정본은 종전 보고서와 섞이지 않도록 보고서 종류 뒤에 판(@v2)을 붙여 저장한다.
 */
import { getReportSnapshot, putReportSnapshot, deleteReportSnapshot } from '../db'
import { buildReportModel } from './build'
import { periodOf, isClosed, addDays, kstToday, FINALIZE_AFTER_DAYS, type ReportType } from './period'
import type { Scope } from './load'
import type { ReportModel } from './types'

export * from './types'
export { periodOf, previousPeriod, kstToday, FINALIZE_AFTER_DAYS, type ReportType, type Period } from './period'

const snapKind = (type: ReportType) => `${type}@v2`
/** 범위 없는 전체 보고서(관리자 메일 등)의 확정본 소유자 표기 */
const GLOBAL_SCOPE = '__all__'

/**
 * 보고서 모델을 얻는다. 끝나고 FINALIZE_AFTER_DAYS 가 지난 기간은 확정본(없으면 지금 계산해 확정),
 * 그 전(진행 중·막 끝남)은 매번 계산한다. 막 끝나 아직 확정 전인 기간은 provisional(잠정)로 표시한다.
 */
export function getReportModel(scope: Scope, type: ReportType, day: string, now: Date = new Date()): ReportModel {
  const p = periodOf(type, day)
  const owner = scope ?? GLOBAL_SCOPE
  if (isClosed(p, now) && kstToday(now) >= addDays(p.end, FINALIZE_AFTER_DAYS)) {
    const snap = getReportSnapshot(owner, snapKind(type), p.start, p.end)
    if (snap) return { ...(snap.payload as ReportModel), snapshotAt: snap.generatedAt }
    const model = buildReportModel(scope, type, day, now)
    const at = putReportSnapshot(owner, snapKind(type), p.start, p.end, model)
    // 동시에 두 번 계산됐으면 먼저 저장된 쪽이 확정본이다 — 그것을 다시 읽어 돌려준다
    const saved = getReportSnapshot(owner, snapKind(type), p.start, p.end)
    return saved ? { ...(saved.payload as ReportModel), snapshotAt: saved.generatedAt } : { ...model, snapshotAt: at }
  }
  const model = buildReportModel(scope, type, day, now)
  return isClosed(p, now) ? { ...model, provisional: true } : model
}

/** 확정본 재생성 — 지우면 다음 조회에서 지금의 계산·단가로 다시 확정된다 */
export function regenerateReportModel(scope: Scope, type: ReportType, day: string): void {
  const p = periodOf(type, day)
  deleteReportSnapshot(scope ?? GLOBAL_SCOPE, snapKind(type), p.start, p.end)
}
