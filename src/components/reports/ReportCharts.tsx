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

// ───────────── 일별 현황 테이블 (주간 보고서 형식) ─────────────

interface DailyTrend { date: string; tasks: number | null; inflow: number | null; verified: number | null; success: number | null; failed: number | null; cost: number | null; waitAvg?: number | null; procAvg?: number | null; verifyAvg?: number | null }

function fmtCostLocal(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function DailyReportTable({ data, type, today }: {
  data: DailyTrend[]
  type: string
  today: string
}) {
  const tr = useTranslations('report')
  const dayLabels = tr.raw('dayLabels') as string[]

  const rows = data.map((d) => {
    let label: string
    if (type === 'yearly') label = tr('monthUnit', { month: parseInt(d.date.slice(5, 7)) })
    else if (type === 'weekly') { const dt = new Date(d.date); label = dayLabels[dt.getDay()] }
    else { label = `${new Date(d.date).getDate()}` }

    const isFuture = d.inflow === null || d.date > today
    const isToday = d.date === today

    return {
      date: d.date, label, isFuture, isToday,
      inflow: d.inflow ?? 0,
      processed: d.verified ?? 0,
      tasks: d.tasks ?? 0,
      cost: d.cost ?? 0,
    }
  })

  const pastRows = rows.filter(r => !r.isFuture)
  const totalInflow = pastRows.reduce((s, r) => s + r.inflow, 0)
  const totalProcessed = pastRows.reduce((s, r) => s + r.processed, 0)
  const totalTasks = pastRows.reduce((s, r) => s + r.tasks, 0)
  const totalCost = pastRows.reduce((s, r) => s + r.cost, 0)

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="grid gap-x-2 px-3 py-1.5 border-b border-ive-border-dark bg-ive-bg-deep font-bold text-ive-text-dim uppercase tracking-wider" style={{ fontSize: 10, gridTemplateColumns: '2rem 1fr 2.5rem 3.5rem' }}>
        <div />
        <div>{tr('dailyColInflow')}</div>
        <div className="text-right">{tr('dailyColTasks')}</div>
        <div className="text-right">{tr('dailyColCost')}</div>
      </div>

      {/* 데이터 행 */}
      {rows.map((row) => {
        if (row.isFuture) {
          return (
            <div key={row.date} className="grid gap-x-2 px-3 py-1.5 border-b border-ive-border-dark/20 last:border-0 text-xs" style={{ gridTemplateColumns: '2rem 1fr 2.5rem 3.5rem', opacity: 0.3 }}>
              <div className="font-bold text-ive-text-dim">{row.label}</div>
              <div className="text-ive-text-dim">—</div>
              <div className="text-right text-ive-text-dim">—</div>
              <div className="text-right text-ive-text-dim">—</div>
            </div>
          )
        }
        return (
          <div key={row.date} className={`grid gap-x-2 px-3 py-2 border-b border-ive-border-dark/30 last:border-0 text-xs ${row.isToday ? 'bg-ive-cyan/5' : ''}`} style={{ gridTemplateColumns: '2rem 1fr 2.5rem 3.5rem' }}>
            <div className={`font-bold ${row.isToday ? 'text-ive-cyan' : 'text-ive-text'}`}>{row.label}</div>
            <div>
              <span className="text-ive-text-muted">{row.inflow.toLocaleString()}</span>
              <span className="text-ive-text-dim/60 mx-1">→</span>
              <span className="font-bold text-ive-text">{row.processed.toLocaleString()}</span>
            </div>
            <div className="text-right text-ive-text-muted">{row.tasks.toLocaleString()}</div>
            <div className="text-right text-ive-text-dim">{row.cost > 0 ? `$${fmtCostLocal(row.cost)}` : '—'}</div>
          </div>
        )
      })}

      {/* 합계 행 */}
      {pastRows.length > 0 && (
        <div className="grid gap-x-2 px-3 py-2 border-t border-ive-border bg-ive-bg-deep text-xs font-bold" style={{ gridTemplateColumns: '2rem 1fr 2.5rem 3.5rem' }}>
          <div className="text-ive-text-dim" style={{ fontSize: 10 }}>{tr('dailyTotal')}</div>
          <div>
            <span className="text-ive-text-muted">{totalInflow.toLocaleString()}</span>
            <span className="text-ive-text-dim/60 mx-1">→</span>
            <span className="text-ive-text">{totalProcessed.toLocaleString()}</span>
          </div>
          <div className="text-right text-ive-text">{totalTasks.toLocaleString()}</div>
          <div className="text-right text-ive-text-muted">${fmtCostLocal(totalCost)}</div>
        </div>
      )}
    </div>
  )
}

// ───────────── 일별 추이 차트 (건수 바 + 비용 라인 + 이전 기간) ─────────────
interface PrevDaily { date: string; tasks: number; verified?: number; cost: number }

export function DailyTrendChart({ data, prevData, type }: { data: DailyTrend[]; prevData: PrevDaily[]; type: string }) {
  const tr = useTranslations('report')
  const isMobile = useIsMobile()
  const dayLabels = tr.raw('dayLabels') as string[]

  // 현재·이전 기간 tasks/verified 최대값 → Y축 도메인 & 이전 막대 높이 계산 기준
  const yMax = Math.max(
    ...data.map(d => Math.max(d.tasks ?? 0, d.verified ?? 0)),
    ...prevData.map(d => Math.max(d.tasks ?? 0, d.verified ?? 0)),
    1
  )

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
      prevVerified: prevData[i]?.verified ?? 0,
      prevCost: prevData[i]?.cost ?? 0,
      yMax,
    }
  })

  /* 현재 작업 채움 막대 위에 이전 작업 점선 막대를 겹쳐 그린다.
   * background prop을 통해 Y축 전체 픽셀 높이(bgH)를 받아
   * cur=0인 미래 날짜에도 이전 데이터를 올바른 비율로 그린다. */
  const TaskBarWithPrev = ({ x, y, width, height, background, payload }: any) => {
    const prevTasks = payload?.prevTasks ?? 0
    const cur = payload?.tasks ?? 0
    const dataYMax = payload?.yMax ?? 1
    const bgH: number = background?.height ?? 0
    const bgY: number = background?.y ?? 0

    let prevTasksH = 0, prevTasksY = 0
    if (bgH > 0) {
      prevTasksH = (prevTasks / dataYMax) * bgH
      prevTasksY = bgY + bgH - prevTasksH
    } else if (cur > 0 && height > 0) {
      prevTasksH = (prevTasks / cur) * height
      prevTasksY = y + height - prevTasksH
    }

    return (
      <g>
        {height > 0 && <rect x={x} y={y} width={width} height={height} fill={C.primary} fillOpacity={0.55} rx={2} />}
        {prevTasksH > 0 && <rect x={x} y={prevTasksY} width={width} height={prevTasksH} fill="none" stroke={C.textMuted} strokeDasharray="3 2" strokeWidth={1.5} rx={2} />}
      </g>
    )
  }

  /* 현재 검증 채움 막대 위에 이전 검증 점선 막대를 겹쳐 그린다. */
  const VerifiedBarWithPrev = ({ x, y, width, height, background, payload }: any) => {
    const prevVerified = payload?.prevVerified ?? 0
    const cur = payload?.verified ?? 0
    const dataYMax = payload?.yMax ?? 1
    const bgH: number = background?.height ?? 0
    const bgY: number = background?.y ?? 0

    let prevVerifiedH = 0, prevVerifiedY = 0
    if (bgH > 0) {
      prevVerifiedH = (prevVerified / dataYMax) * bgH
      prevVerifiedY = bgY + bgH - prevVerifiedH
    } else if (cur > 0 && height > 0) {
      prevVerifiedH = (prevVerified / cur) * height
      prevVerifiedY = y + height - prevVerifiedH
    }

    return (
      <g>
        {height > 0 && <rect x={x} y={y} width={width} height={height} fill={C.primary} rx={2} />}
        {prevVerifiedH > 0 && <rect x={x} y={prevVerifiedY} width={width} height={prevVerifiedH} fill="none" stroke={C.textMuted} strokeDasharray="3 2" strokeWidth={1.5} rx={2} />}
      </g>
    )
  }

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={merged} barGap={0} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          {/* domain을 yMax로 고정하면 현재 tasks=0인 날도 이전 기간 비율이 정확하게 렌더됨 */}
          <YAxis yAxisId="tasks" domain={[0, yMax]} tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <YAxis yAxisId="cost" orientation="right" tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} width={36} tickFormatter={v => `$${(v as number).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`} />
          {!isMobile && <Tooltip {...tooltipStyle} />}
          {/* 현재 작업 막대 (background 전달 → 이전 작업 점선 마커 겹침) + 검증 막대 */}
          <Bar yAxisId="tasks" dataKey="tasks" name={tr('chartTasks')} background={{ fill: 'transparent' }} shape={<TaskBarWithPrev />} />
          <Bar yAxisId="tasks" dataKey="verified" name={tr('chartVerified')} background={{ fill: 'transparent' }} shape={<VerifiedBarWithPrev />} />
          {/* 비용: 현재=실선, 이전=점선 */}
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
interface PrevFlowDay { label: string; prevInflow: number; prevThroughput: number }

export function FlowCompareChart({ data, prevData, type }: { data: FlowDay[]; prevData?: PrevFlowDay[]; type: string }) {
  const tr = useTranslations('report')
  const isMobile = useIsMobile()

  // 현재 기간과 이전 기간 데이터를 같은 x 인덱스로 병합
  const merged = data.map((d, i) => ({
    label: d.label,
    inflow: d.inflow,
    throughput: d.throughput,
    prevInflow: prevData?.[i]?.prevInflow ?? null,
    prevThroughput: prevData?.[i]?.prevThroughput ?? null,
  }))

  const hasPrev = (prevData?.length ?? 0) > 0

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={merged}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          {!isMobile && <Tooltip {...tooltipStyle} />}
          {/* 이전 기간 (점선, 채움 없음) — 현재 기간보다 먼저 렌더링해 배경에 위치 */}
          {hasPrev && (
            <Area dataKey="prevInflow" name={tr('chartPrevInflow')} fill="none" stroke={C.textMuted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
          )}
          {hasPrev && (
            <Area dataKey="prevThroughput" name={tr('chartPrevThroughput')} fill="none" stroke={C.primary} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
          )}
          {/* 현재 기간 (실선 + 채움) */}
          <Area dataKey="inflow" name={tr('chartInflow')} fill={C.textMuted} fillOpacity={0.15} stroke={C.textMuted} strokeWidth={2} dot={{ r: 2, fill: C.textMuted }} />
          <Area dataKey="throughput" name={tr('chartThroughput')} fill={C.primary} fillOpacity={0.18} stroke={C.primary} strokeWidth={2} dot={{ r: 2, fill: C.primary }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-3 mt-1 text-xs text-ive-text-dim flex-wrap">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-text-muted mr-0.5" />{tr('chartInflow')}</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-cyan mr-0.5" />{tr('chartThroughput')}</span>
        {hasPrev && (
          <>
            <span className="text-ive-text-dim/60">|</span>
            <span><span className="inline-block w-3 h-0.5 border-t border-dashed border-ive-text-muted mr-0.5 align-middle" />{tr('chartPrevInflow')}</span>
            <span><span className="inline-block w-3 h-0.5 border-t border-dashed border-ive-cyan mr-0.5 align-middle" />{tr('chartPrevThroughput')}</span>
          </>
        )}
      </div>
    </div>
  )
}
