/**
 * 보고서 메일 발송 — 화면과 같은 보고서 모델(확정본)을 받는 사람의 범위·역할에 맞게 그려 보낸다.
 *
 *  - 데이터 범위 = 받는 사람이 화면에서 볼 수 있는 범위(그 사람이 소유·공유받은 프로젝트). 서버 전체를 보내지 않는다.
 *  - 숫자 = 그 기간 화면과 같은 확정본. 메일에서 따로 계산하지 않는다.
 *  - 받는 사람은 IVE 계정이 있어야 한다(범위를 정할 수 없으므로). 계정이 없는 주소는 보내지 않고 기록만 남긴다.
 *  - 주간: 프로젝트 소유자·편집자·관리자는 팀장 메일, 그 밖은 팀원 메일. 월간·연간: 경영진 메일.
 */
import { ReportSchedule, type User } from '@/types'
import { getDb, createReportSendLog, hasAlreadySent, getUserByEmail, mapUser } from '../db'
import { resolveUserCurrency } from '../currency-server'
import { formatMoney } from '../currency'
import { createTransporter, getFromAddress } from '../mail'
import { getIveBaseUrl } from '../slack-notify'
import { getReportModel, periodOf, previousPeriod, kstToday, type ReportType } from '../report-model'
import { renderReportMail, type MailKind } from './render'
import type { ReportModel, HeldIssue } from '../report-model/types'

export { renderReportMail, type MailKind } from './render'

/** 발송 대상 기간 — 방금 끝난 주·달·해. 수동 발송에서 시작일을 주면 그 날짜가 속한 기간. */
export function reportPeriodToSend(type: ReportType, periodStart?: string): { start: string; end: string } {
  const p = periodStart ? periodOf(type, periodStart) : previousPeriod(periodOf(type, kstToday()))
  return { start: p.start, end: p.end }
}

/** 주간 메일의 종류: 프로젝트를 소유·편집하거나 관리자면 팀장, 아니면 팀원 */
export function weeklyKindFor(user: Pick<User, 'id' | 'isAdmin'>): MailKind {
  if (user.isAdmin) return 'lead'
  const r = getDb().prepare(`
    SELECT 1 FROM projects WHERE user_id = ?
    UNION SELECT 1 FROM project_shares WHERE user_id = ? AND role = 'editor' LIMIT 1
  `).get(user.id, user.id)
  return r ? 'lead' : 'member'
}

/**
 * 그 사람 손에 있는 일 — 공유 범위와 무관하게(그 사람은 Git 담당자라 이미 볼 수 있는 일).
 * 전체 범위의 지금 보유를 한 번 계산해 발송 한 번 동안 재사용한다.
 */
function mineFrom(all: ReportModel | null, userId: string): HeldIssue[] {
  return (all?.held.issues ?? []).filter(i => i.personKey === `u:${userId}`)
}

/** 한 사람에게 갈 메일(미리보기·발송 공용). allNow: 전체 범위의 이번 주 모델(없으면 여기서 계산) */
export function buildReportMailFor(user: User, type: ReportType, periodStart: string, allNow?: ReportModel | null): { subject: string; html: string; kind: MailKind } {
  const closed = getReportModel(user.id, type, periodStart)
  const kind: MailKind = type === 'weekly' ? weeklyKindFor(user) : 'exec'
  const now = type === 'weekly' ? getReportModel(user.id, 'weekly', kstToday()) : null
  const mine = kind === 'member' ? mineFrom(allNow === undefined ? getReportModel(null, 'weekly', kstToday()) : allNow, user.id) : undefined
  const cur = resolveUserCurrency(user)
  const locale = user.locale ?? undefined
  const money = (usd: number) => formatMoney(usd, cur.code, cur.rate, locale)
  const { subject, html } = renderReportMail({
    kind, closed, now, money, baseUrl: getIveBaseUrl(), mine,
    recipient: { userId: user.id, name: user.name, locale: user.locale },
  })
  return { subject, html, kind }
}

/** 보고서를 생성하여 수신자들에게 발송 */
export async function sendReport(
  schedule: ReportSchedule,
  options?: { force?: boolean; periodStart?: string; periodEnd?: string }
): Promise<{ sent: number; skipped: number; failed: number }> {
  const force = options?.force ?? false
  const type = schedule.reportType as ReportType
  const { start: periodStart, end: periodEnd } = reportPeriodToSend(type, options?.periodStart)

  const transporter = createTransporter()
  const fromAddr = getFromAddress()
  let sent = 0, skipped = 0, failed = 0
  // 팀원 메일의 "내 손에 있는 일"용 — 전체 범위 이번 주 모델은 한 번만 계산
  let allNow: ReportModel | null | undefined
  const getAllNow = () => (allNow === undefined ? (allNow = type === 'weekly' ? getReportModel(null, 'weekly', kstToday()) : null) : allNow)

  for (const email of schedule.recipients) {
    if (!force && hasAlreadySent(schedule.id, periodStart, periodEnd, email)) {
      skipped++
      continue
    }
    const logId = `rsl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const log = (status: 'success' | 'failed', errorMessage?: string) => createReportSendLog({
      id: logId, scheduleId: schedule.id, reportType: schedule.reportType, periodStart, periodEnd,
      recipientEmail: email, status, errorMessage, sentAt: new Date().toISOString(),
    })
    const row = getUserByEmail(email)
    if (!row) {
      // 범위를 정할 수 없는 주소에는 보내지 않는다(종전엔 서버 전체 데이터를 보냈다)
      log('failed', 'IVE 계정이 없는 주소 — 보고서 범위를 정할 수 없어 보내지 않음')
      failed++
      continue
    }
    const user = mapUser(row)
    try {
      const { subject, html } = buildReportMailFor(user, type, periodStart, getAllNow())
      await transporter.sendMail({ from: `"Springware IVE" <${fromAddr}>`, to: email, subject, html })
      log('success')
      sent++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[ReportMailer] 발송 실패 (${email}):`, msg)
      log('failed', msg)
      failed++
    }
  }

  console.log(`[ReportMailer] ${type} 보고서(${periodStart}~${periodEnd}) 발송: sent=${sent}, skipped=${skipped}, failed=${failed}`)
  return { sent, skipped, failed }
}
