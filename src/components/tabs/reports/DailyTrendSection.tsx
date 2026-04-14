'use client'

import { useTranslations } from 'next-intl'
import { DailyTrendChart, FlowCompareChart, DailyReportTable } from '@/components/reports/ReportCharts'
import type { ReportType, ReportData } from './types'

interface FlowDay { label: string; inflow: number | null; throughput: number | null }
interface PrevFlowDay { label: string; prevInflow: number; prevThroughput: number }

interface DailyTrendSectionProps {
  data: ReportData
  type: ReportType
  today: string
  showTrend: boolean
  setShowTrend: (v: boolean) => void
  flowDays: FlowDay[]
  prevFlowDays: PrevFlowDay[]
}

export default function DailyTrendSection({ data, type, today, showTrend, setShowTrend, flowDays, prevFlowDays }: DailyTrendSectionProps) {
  const tr = useTranslations('report')

  if (data.dailyTrend.length === 0) return null

  return (
    <section>
      {type === 'weekly' ? (
        <>
          {/* 주간 -- 보고서 형식 일별 현황표 (상시 노출) */}
          <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('dailyStatusTitle')}</div>
          <DailyReportTable data={data.dailyTrend} type={type} today={today} />
          {/* 추이 차트 (접이식 보조) */}
          <button onClick={() => setShowTrend(!showTrend)} className="w-full flex items-center gap-2 text-xs font-bold text-ive-text-dim uppercase tracking-wider py-2 mt-1">
            <i className={`fa-solid fa-chevron-${showTrend ? 'down' : 'right'} text-xs`} />
            {tr('trendChartToggle')}
          </button>
          {showTrend && (
            <div className="space-y-2">
              <FlowCompareChart data={flowDays} prevData={prevFlowDays} type={type} />
              <DailyTrendChart data={data.dailyTrend} prevData={data.prevDailyTrend} type={type} />
            </div>
          )}
        </>
      ) : (
        <>
          {/* 월간/연간 -- 기존 접이식 차트 */}
          <button onClick={() => setShowTrend(!showTrend)} className="w-full flex items-center gap-2 text-xs font-bold text-ive-text-dim uppercase tracking-wider py-2">
            <i className={`fa-solid fa-chevron-${showTrend ? 'down' : 'right'} text-xs`} />
            {tr('trendChartToggle')}
          </button>
          {showTrend && (
            <div className="space-y-2">
              <FlowCompareChart data={flowDays} prevData={prevFlowDays} type={type} />
              <DailyTrendChart data={data.dailyTrend} prevData={data.prevDailyTrend} type={type} />
            </div>
          )}
        </>
      )}
    </section>
  )
}
