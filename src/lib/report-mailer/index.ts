/**
 * 보고서 메일 발송 — 화면과 같은 보고서 모델을 받는 사람의 범위·역할에 맞게 그려 보낸다.
 *
 *  - 데이터 범위 = 받는 사람이 화면에서 볼 수 있는 범위(그 사람이 소유·공유받은 프로젝트). 서버 전체를 보내지 않는다.
 *  - 숫자 = 그 기간 화면과 같은 보고서 모델(getReportModel). 메일에서 따로 계산하지 않는다.
 *    정기 발송은 기간이 막 끝난 때라 아직 확정 전(잠정)이다 — 메일 끝에 그렇게 밝힌다. 화면은 며칠 뒤 확정본으로 굳는다.
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
import type { HeldIssue } from '../report-model/types'
import { liveHeldAll, mineFrom } from '../report-model/build'


/** 발송 대상 기간 — 방금 끝난 주·달·해 */
export function reportPeriodToSend(type: ReportType): { start: string; end: string } {
  const p = previousPeriod(periodOf(type, kstToday()))
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

export type SkipReason = 'unsubscribed' | 'nothing_for_member'

/**
 * 한 사람에게 갈 메일(미리보기·발송 공용). allHeld: 전체 지금 보유(없으면 필요할 때 여기서 계산).
 * skip 이 있으면 보내지 않는다 — 본인이 수신을 껐거나, 팀원인데 손에 든 일도 팀이 손쓸 것도 없을 때.
 */
export function buildReportMailFor(user: User, type: ReportType, periodStart: string, allHeld?: () => HeldIssue[]): { subject: string; html: string; kind: MailKind; skip: SkipReason | null } {
  const kind: MailKind = type === 'weekly' ? weeklyKindFor(user) : 'exec'
  if (user.reportMailUnsubscribed) return { subject: '', html: '', kind, skip: 'unsubscribed' }
  const closed = getReportModel(user.id, type, periodStart)
  const now = type === 'weekly' ? getReportModel(user.id, 'weekly', kstToday()) : null
  const mine = kind === 'member' ? mineFrom(allHeld ? allHeld() : liveHeldAll(), user.id) : undefined
  const cur = resolveUserCurrency(user)
  const locale = user.locale ?? undefined
  const money = (usd: number) => formatMoney(usd, cur.code, cur.rate, locale)
  const { subject, html } = renderReportMail({
    kind, closed, now, money, baseUrl: getIveBaseUrl(), mine,
    recipient: { userId: user.id, name: user.name, locale: user.locale },
  })
  const nothing = kind === 'member' && (mine?.length ?? 0) === 0
    && !(now?.actions && (now.actions.failed.length || now.actions.aged.length || now.actions.concentrations.length))
  return { subject, html, kind, skip: nothing ? 'nothing_for_member' : null }
}

/** 보고서를 생성하여 수신자들에게 발송 */
export async function sendReport(
  schedule: ReportSchedule,
  options?: { force?: boolean }
): Promise<{ sent: number; skipped: number; failed: number }> {
  const force = options?.force ?? false
  const type = schedule.reportType as ReportType
  const { start: periodStart, end: periodEnd } = reportPeriodToSend(type)
  // 스케줄러는 정시 0~4분에 매분 확인하므로 같은 발송이 겹쳐 불릴 수 있다 — 같은 스케줄·기간은 한 번에 하나만 돈다.
  // 자동 발송이 겹치면 겹친 쪽은 아무것도 보내지 않고(0건), 수동(강제) 발송은 돌고 있는 발송이 끝난 뒤 이어서 돈다.
  // (끝난 뒤 다시 불리면 이미 보낸 주소는 발송 기록으로 건너뛰고, 실패한 주소만 다시 시도한다)
  const lockKey = `${schedule.id}|${periodStart}`
  if (!force && runningSends.has(lockKey)) return { sent: 0, skipped: 0, failed: 0 }
  for (let running = runningSends.get(lockKey); running; running = runningSends.get(lockKey)) await running.catch(() => null)
  const p = sendReportLocked(schedule, type, periodStart, periodEnd, force)
  runningSends.set(lockKey, p)
  try {
    return await p
  } finally {
    if (runningSends.get(lockKey) === p) runningSends.delete(lockKey)
  }
}

const NO_ACCOUNT = 'IVE 계정이 없는 주소 — 보고서 범위를 정할 수 없어 보내지 않음'

function hasLoggedFailure(scheduleId: string, periodStart: string, periodEnd: string, email: string, message: string): boolean {
  return !!getDb().prepare(`
    SELECT 1 FROM report_send_logs WHERE schedule_id = ? AND period_start = ? AND period_end = ? AND recipient_email = ? AND status = 'failed' AND error_message = ? LIMIT 1
  `).get(scheduleId, periodStart, periodEnd, email, message)
}

const runningSends = new Map<string, Promise<{ sent: number; skipped: number; failed: number }>>()

async function sendReportLocked(
  schedule: ReportSchedule, type: ReportType, periodStart: string, periodEnd: string, force: boolean,
): Promise<{ sent: number; skipped: number; failed: number }> {

  const transporter = createTransporter()
  const fromAddr = getFromAddress()
  let sent = 0, skipped = 0, failed = 0
  // 팀원 메일의 "내 손에 있는 일"용 — 전체 지금 보유는 팀원이 있을 때 한 번만 계산
  let allHeld: HeldIssue[] | null = null
  const getAllHeld = () => (allHeld ??= liveHeldAll())

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
      // 범위를 정할 수 없는 주소에는 보내지 않는다(종전엔 서버 전체 데이터를 보냈다). 같은 기간에는 한 번만 기록한다
      if (!force && hasLoggedFailure(schedule.id, periodStart, periodEnd, email, NO_ACCOUNT)) { skipped++; continue }
      log('failed', NO_ACCOUNT)
      failed++
      continue
    }
    const user = mapUser(row)
    try {
      const { subject, html, skip } = buildReportMailFor(user, type, periodStart, getAllHeld)
      if (skip) { skipped++; continue }
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
