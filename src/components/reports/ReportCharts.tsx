'use client'

import { useState, useEffect } from 'react'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart,
} from 'recharts'
import { useTranslations } from 'next-intl'

function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    setMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])
  return mobile
}

// 차트는 측정값 표시. 의미색을 쓰지 않고 단색 시안 + 회색 대비로만 구분.
// (현재 데이터 = primary, 비교 데이터 = muted, 보조 시리즈 = primary 약화)
const C = {
  bgCard:    'var(--color-ive-bg-card)',
  border:    'var(--color-ive-border)',
  textMuted: 'var(--color-ive-text-muted)',
  textDim:   'var(--color-ive-text-dim)',
  primary:   'var(--color-ive-cyan)',
}

const tooltipStyle = {
  contentStyle: { background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, padding: '8px 12px' },
  labelStyle: { color: C.textMuted, fontWeight: 700, marginBottom: 4 },
}

// ───────────── 일별 추이 차트 (건수 바 + 비용 라인 + 이전 기간) ─────────────

interface DailyTrend { date: string; tasks: number | null; verified: number | null; success: number | null; failed: number | null; cost: number | null }
interface PrevDaily { date: string; tasks: number; verified?: number; cost: number }

export function DailyTrendChart({ data, prevData, type }: { data: DailyTrend[]; prevData: PrevDaily[]; type: string }) {
  const tr = useTranslations('report')
  const isMobile = useIsMobile()
  const dayLabels = tr.raw('dayLabels') as string[]
  const merged = data.map((d, i) => {
    let label: string
    if (type === 'yearly') label = tr('monthUnit', { month: parseInt(d.date.slice(5, 7)) })
    else { const dt = new Date(d.date); label = type === 'weekly' ? dayLabels[dt.getDay()] : `${dt.getDate()}` }
    return {
      label,
      tasks: d.tasks ?? 0,
      verified: d.verified ?? 0,
      cost: d.cost,
      prevTasks: prevData[i]?.tasks ?? 0,
      prevCost: prevData[i]?.cost ?? 0,
    }
  })

  /* 현재 작업 채움 막대를 먼저, 이전 작업 점선 막대를 나중에(위에) 그려서 항상 보이게 */
  const TaskBarWithPrev = ({ x, y, width, height, payload }: any) => {
    const prev = payload?.prevTasks ?? 0
    const cur = payload?.tasks ?? 0
    const bottomY = y + height
    const prevH = cur > 0 ? (prev / cur) * height : 0
    const prevY = bottomY - prevH
    return (
      <g>
        {height > 0 && <rect x={x} y={y} width={width} height={height} fill={C.primary} fillOpacity={0.55} rx={2} />}
        {prevH > 0 && <rect x={x} y={prevY} width={width} height={prevH} fill="none" stroke={C.textMuted} strokeDasharray="3 2" strokeWidth={1.5} rx={2} />}
      </g>
    )
  }

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={merged} barGap={0} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="tasks" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <YAxis yAxisId="cost" orientation="right" tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} width={30} tickFormatter={v => `$${v}`} />
          {!isMobile && <Tooltip {...tooltipStyle} />}
          {/* 현재 작업 막대 (이전 작업 점선 마커 겹침) + 검증 막대 */}
          <Bar yAxisId="tasks" dataKey="tasks" name={tr('chartTasks')} shape={<TaskBarWithPrev />} />
          <Bar yAxisId="tasks" dataKey="verified" name={tr('chartVerified')} fill={C.primary} radius={[2, 2, 0, 0]} />
          {/* Y축 도메인에 prevTasks 포함시키기 위한 투명 라인 */}
          <Line yAxisId="tasks" dataKey="prevTasks" name={tr('chartPrevTasks')} stroke="none" dot={false} activeDot={false} legendType="none" />
          {/* 비용: 현재=실선, 이전=점선 — 같은 라인 타입 */}
          <Line yAxisId="cost" dataKey="cost" name={tr('chartCost')} stroke={C.primary} strokeWidth={2} dot={{ r: 2, fill: C.primary }} />
          <Line yAxisId="cost" dataKey="prevCost" name={tr('chartPrevCost')} stroke={C.textMuted} strokeDasharray="4 3" dot={false} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-3 mt-1 text-xs text-ive-text-dim flex-wrap">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-cyan/55 mr-0.5" />{tr('chartTasks')}</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-cyan mr-0.5" />{tr('chartVerified')}</span>
        <span><span className="inline-block w-3 h-0.5 bg-ive-cyan mr-0.5 align-middle" />{tr('chartCost')}</span>
        <span className="text-ive-text-dim/60">|</span>
        <span><span className="inline-block w-3 h-0.5 border-t border-dashed border-ive-text-dim mr-0.5 align-middle" />{tr('chartPrevTasks')}</span>
        <span><span className="inline-block w-3 h-0.5 border-t border-dashed border-ive-text-dim mr-0.5 align-middle" />{tr('chartPrevCost')}</span>
      </div>
    </div>
  )
}

// ───────────── 유입 vs 처리 비교 차트 ─────────────

interface FlowDay { label: string; inflow: number | null; throughput: number | null }

export function FlowCompareChart({ data }: { data: FlowDay[]; type: string }) {
  const tr = useTranslations('report')
  const isMobile = useIsMobile()
  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          {!isMobile && <Tooltip {...tooltipStyle} />}
          {/* 유입 = 회색(들어오는 일감), 처리 = 시안(우리가 한 일) */}
          <Area dataKey="inflow" name={tr('chartInflow')} fill={C.textMuted} fillOpacity={0.15} stroke={C.textMuted} strokeWidth={2} dot={{ r: 2, fill: C.textMuted }} />
          <Area dataKey="throughput" name={tr('chartThroughput')} fill={C.primary} fillOpacity={0.18} stroke={C.primary} strokeWidth={2} dot={{ r: 2, fill: C.primary }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-3 mt-1 text-xs text-ive-text-dim">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-text-muted mr-0.5" />{tr('chartInflow')}</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-cyan mr-0.5" />{tr('chartThroughput')}</span>
      </div>
    </div>
  )
}
