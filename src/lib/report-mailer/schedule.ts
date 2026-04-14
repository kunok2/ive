import { ReportType } from '@/types'
import { getKSTTodayString } from '../date-utils'

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  weekly: '주간',
  monthly: '월간',
  yearly: '연간',
}

export const PREV_PERIOD_LABELS: Record<ReportType, string> = {
  weekly: '전주',
  monthly: '전월',
  yearly: '전년',
}

export function pad(n: number): string { return n.toString().padStart(2, '0') }
export function fmt(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

/** 보고서 기간 계산 (KST 기준 YYYY-MM-DD) */
export function calculateReportPeriod(reportType: ReportType, baseDate: Date = new Date()): { start: string; end: string } {
  // KST 기준 오늘
  const kstToday = getKSTTodayString(baseDate)
  const [y, m, d] = kstToday.split('-').map(Number)

  switch (reportType) {
    case 'weekly': {
      // 지난주 월~일
      const today = new Date(y, m - 1, d)
      const dayOfWeek = today.getDay() // 0=일 ~ 6=토
      const lastSunday = new Date(today)
      lastSunday.setDate(today.getDate() - (dayOfWeek === 0 ? 7 : dayOfWeek))
      const lastMonday = new Date(lastSunday)
      lastMonday.setDate(lastSunday.getDate() - 6)
      const endDay = new Date(lastSunday)
      endDay.setDate(endDay.getDate() + 1) // exclusive end
      return {
        start: fmt(lastMonday),
        end: fmt(endDay),
      }
    }
    case 'monthly': {
      // 지난달
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      return {
        start: `${prevYear}-${pad(prevMonth)}-01`,
        end: `${y}-${pad(m)}-01`,
      }
    }
    case 'yearly': {
      // 작년
      return {
        start: `${y - 1}-01-01`,
        end: `${y}-01-01`,
      }
    }
  }
}

/** 이전 기간 계산 (전주/전월/전년) */
export function calculatePreviousPeriod(reportType: ReportType, currentStart: string, currentEnd: string): { start: string; end: string } {
  const [sy, sm, sd] = currentStart.split('-').map(Number)
  const [ey, em, ed] = currentEnd.split('-').map(Number)
  const startDate = new Date(sy, sm - 1, sd)
  const endDate = new Date(ey, em - 1, ed)
  const diffMs = endDate.getTime() - startDate.getTime()
  const diffDays = Math.round(diffMs / 86400000)

  switch (reportType) {
    case 'weekly': {
      const prevStart = new Date(startDate)
      prevStart.setDate(prevStart.getDate() - 7)
      const prevEnd = new Date(endDate)
      prevEnd.setDate(prevEnd.getDate() - 7)
      return { start: fmt(prevStart), end: fmt(prevEnd) }
    }
    case 'monthly': {
      const prevStartMonth = sm - 1 === 0 ? 12 : sm - 1
      const prevStartYear = sm - 1 === 0 ? sy - 1 : sy
      const prevEndMonth = em - 1 === 0 ? 12 : em - 1
      const prevEndYear = em - 1 === 0 ? ey - 1 : ey
      return {
        start: `${prevStartYear}-${pad(prevStartMonth)}-${pad(sd)}`,
        end: `${prevEndYear}-${pad(prevEndMonth)}-${pad(ed)}`,
      }
    }
    case 'yearly': {
      return {
        start: `${sy - 1}-${pad(sm)}-${pad(sd)}`,
        end: `${ey - 1}-${pad(em)}-${pad(ed)}`,
      }
    }
  }
}
