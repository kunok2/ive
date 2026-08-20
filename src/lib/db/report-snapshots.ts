/**
 * 확정된 보고서 스냅샷.
 *
 * 보고서는 단가(사람 월급·AI 구독료·모델 단가·단가 배수)를 입력으로 쓴다. 단가를 나중에
 * 바꾸면 과거 보고서 숫자가 통째로 소급 변경되어, 이미 메일로 보낸 수치와 화면이 어긋난다.
 *
 * 해결: **기간이 닫히면 그때 계산한 응답을 저장하고, 이후 조회는 저장본을 보여준다.**
 * 단가에 시간 개념을 넣어 매 계산을 시점 해석하는 방식보다 단순하고, 월간·연간·추세처럼
 * 재계산되는 뷰까지 한 번에 고정된다(응답 전체를 저장하므로).
 *
 * 진행 중인 기간은 저장하지 않는다 — 아직 확정이 아니라 매번 실시간으로 계산한다.
 */
import { getDb } from './connection'

export interface ReportSnapshot {
  payload: unknown
  generatedAt: string
}

function snapshotId(userId: string, reportType: string, periodStart: string, periodEnd: string): string {
  return `rs-${userId}-${reportType}-${periodStart}-${periodEnd}`
}

/** 확정 저장본 조회. 없으면 null. */
export function getReportSnapshot(userId: string, reportType: string, periodStart: string, periodEnd: string): ReportSnapshot | null {
  const r = getDb().prepare(
    'SELECT payload, generated_at FROM report_snapshots WHERE user_id = ? AND report_type = ? AND period_start = ? AND period_end = ?'
  ).get(userId, reportType, periodStart, periodEnd) as { payload: string; generated_at: string } | undefined
  if (!r) return null
  try {
    return { payload: JSON.parse(r.payload), generatedAt: r.generated_at }
  } catch {
    // 저장본이 깨졌으면 없는 것으로 보고 다시 계산하게 둔다.
    return null
  }
}

/**
 * 확정 저장. 이미 있으면 덮어쓰지 않는다 — 확정은 한 번뿐이어야 하고,
 * 동시 요청 두 건이 각자 계산해 서로 다른 값을 쓰는 것을 막는다.
 * 의도적인 재확정은 deleteReportSnapshot 으로 지운 뒤 다음 조회에서 다시 만든다.
 */
export function putReportSnapshot(userId: string, reportType: string, periodStart: string, periodEnd: string, payload: unknown): string {
  const generatedAt = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO report_snapshots (id, user_id, report_type, period_start, period_end, payload, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, report_type, period_start, period_end) DO NOTHING
  `).run(snapshotId(userId, reportType, periodStart, periodEnd), userId, reportType, periodStart, periodEnd, JSON.stringify(payload), generatedAt)
  return generatedAt
}

/** 재확정용 삭제. 계산 로직을 고쳤을 때 관리자가 다시 만들게 한다. */
export function deleteReportSnapshot(userId: string, reportType: string, periodStart: string, periodEnd: string): void {
  getDb().prepare(
    'DELETE FROM report_snapshots WHERE user_id = ? AND report_type = ? AND period_start = ? AND period_end = ?'
  ).run(userId, reportType, periodStart, periodEnd)
}
