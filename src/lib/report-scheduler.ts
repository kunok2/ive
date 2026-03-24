import { getAllReportSchedules } from './db'
import { sendReport } from './report-mailer'

let schedulerStarted = false

/** 고정 발송 시점 (KST 09:00) */
const SEND_HOUR = 9

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
  }, 60 * 1000) // 1분마다 체크

  console.log('[ReportScheduler] Started')
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

  // 발송 시각이 아니면 건너뜀
  if (kstHour !== SEND_HOUR) return

  const schedules = getAllReportSchedules()

  for (const schedule of schedules) {
    if (!schedule.enabled || schedule.recipients.length === 0) continue

    let shouldSend = false

    switch (schedule.reportType) {
      case 'weekly':
        // 매주 월요일 09시 → 지난주(월~일) 보고서
        shouldSend = kstDayOfWeek === 1
        break
      case 'monthly':
        // 매월 1일 09시 → 지난달 보고서
        shouldSend = kstDayOfMonth === 1
        break
      case 'yearly':
        // 매년 1월 1일 09시 → 작년 보고서
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
