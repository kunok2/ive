import { getAllReportSchedules } from './db'
import { sendReport } from './report-mailer'
import { refreshCurrencyRates } from './currency-server'

let schedulerStarted = false
let lastRateRefreshDate: string | null = null

export function startReportScheduler() {
  if (schedulerStarted) return
  schedulerStarted = true

  // 매 정시(1분 간격)에 발송 조건을 체크
  setInterval(() => {
    try {
      checkAndSendReports()
    } catch (e) {
      console.warn('[ReportScheduler] Error:', (e as Error).message)
    }
    try {
      maybeRefreshCurrencyRates()
    } catch (e) {
      console.warn('[ReportScheduler] Currency refresh error:', (e as Error).message)
    }
  }, 60 * 1000) // 1분마다 체크

  console.log('[ReportScheduler] Started')
}

/**
 * 환율 자동 갱신 — KST 기준 하루 1회.
 * 서버 기동 직후 첫 틱에서 1회, 이후 날짜가 바뀔 때마다 1회 갱신한다.
 * fetch 실패 시 currency.ts 가 기존 캐시(마지막 값)를 그대로 유지한다.
 */
function maybeRefreshCurrencyRates() {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const kstDate = kstNow.toISOString().slice(0, 10) // YYYY-MM-DD (KST)
  if (kstDate === lastRateRefreshDate) return
  lastRateRefreshDate = kstDate
  refreshCurrencyRates().catch(err => {
    console.warn('[Currency] 자동 갱신 실패:', (err as Error).message)
  })
}

function checkAndSendReports() {
  // KST 현재 시각 계산
  const now = new Date()
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const kstHour = kstNow.getUTCHours()
  const kstMinute = kstNow.getUTCMinutes()
  const kstDayOfWeek = kstNow.getUTCDay() // 0=일 ~ 6=토
  const kstDayOfMonth = kstNow.getUTCDate()
  const kstMonth = kstNow.getUTCMonth() + 1 // 1~12

  // 정시 0~4분 사이에만 체크 (중복 실행 방지)
  if (kstMinute > 4) return

  const schedules = getAllReportSchedules()

  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.recipients.length === 0) continue

    // 각 스케줄의 발송 시각 확인
    const sendHour = schedule.sendHour ?? 9
    if (kstHour !== sendHour) continue

    let shouldSend = false

    switch (schedule.reportType) {
      case 'weekly':
        // 매주 월요일 → 지난주(월~일) 보고서
        shouldSend = kstDayOfWeek === 1
        break
      case 'monthly':
        // 매월 1일 → 지난달 보고서
        shouldSend = kstDayOfMonth === 1
        break
      case 'yearly':
        // 매년 1월 1일 → 작년 보고서
        shouldSend = kstMonth === 1 && kstDayOfMonth === 1
        break
    }

    if (shouldSend) {
      console.log(`[ReportScheduler] ${schedule.reportType} 보고서 발송 트리거`)
      // 비동기 발송 (에러가 나도 다른 스케줄에 영향 없도록)
      sendReport(schedule).catch(err => {
        console.error(`[ReportScheduler] ${schedule.reportType} 발송 실패:`, err)
      })
    }
  }
}
