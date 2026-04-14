'use client'

import { useTranslations } from 'next-intl'
import { DailyReportTable } from '@/components/reports/ReportCharts'
import type { ReportType, ReportData } from './types'

interface DailyTrendSectionProps {
  data: ReportData
  type: ReportType
  today: string
}

export default function DailyTrendSection({ data, type, today }: DailyTrendSectionProps) {
  const tr = useTranslations('report')

  if (data.dailyTrend.length === 0) return null

  return (
    <section>
      {type === 'weekly' && (
        <>
          <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('dailyStatusTitle')}</div>
          <DailyReportTable data={data.dailyTrend} type={type} today={today} />
        </>
      )}
    </section>
  )
}
