'use client'

import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart,
} from 'recharts'

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
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
  const merged = data.map((d, i) => {
    let label: string
    if (type === 'yearly') label = `${parseInt(d.date.slice(5, 7))}월`
    else { const dt = new Date(d.date); label = type === 'weekly' ? DAY_LABELS[dt.getDay()] : `${dt.getDate()}` }
    // "작업" 바 = tasks, "검증" 바 = verified
    return {
      label,
      tasks: d.tasks ?? 0,
      verified: d.verified ?? 0,
      cost: d.cost,
      prevTasks: prevData[i]?.tasks ?? 0,
      prevVerified: prevData[i]?.verified ?? 0,
      prevCost: prevData[i]?.cost ?? 0,
    }
  })

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={merged} barGap={0} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="tasks" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <YAxis yAxisId="cost" orientation="right" tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} width={30} tickFormatter={v => `$${v}`} />
          <Tooltip {...tooltipStyle} />
          {/* 이전 기간 = 회색 옅게, 현재 기간 = 시안. 검증은 현재 시리즈 농도로 구분 */}
          <Bar yAxisId="tasks" dataKey="prevTasks" name="이전 작업" fill={C.textMuted} fillOpacity={0.15} radius={[2, 2, 0, 0]} />
          <Bar yAxisId="tasks" dataKey="prevVerified" name="이전 검증" fill={C.textMuted} fillOpacity={0.25} radius={[2, 2, 0, 0]} />
          <Bar yAxisId="tasks" dataKey="tasks" name="작업" fill={C.primary} fillOpacity={0.55} radius={[2, 2, 0, 0]} />
          <Bar yAxisId="tasks" dataKey="verified" name="검증" fill={C.primary} radius={[2, 2, 0, 0]} />
          <Line yAxisId="cost" dataKey="cost" name="비용" stroke={C.primary} strokeWidth={2} dot={{ r: 2, fill: C.primary }} />
          <Line yAxisId="cost" dataKey="prevCost" name="이전 비용" stroke={C.textMuted} strokeDasharray="4 3" dot={false} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-3 mt-1 text-xs text-ive-text-dim flex-wrap">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-cyan/55 mr-0.5" />작업</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-cyan mr-0.5" />검증</span>
        <span><span className="inline-block w-3 h-0.5 bg-ive-cyan mr-0.5 align-middle" />비용</span>
      </div>
    </div>
  )
}

// ───────────── 유입 vs 처리 비교 차트 ─────────────

interface FlowDay { label: string; inflow: number | null; throughput: number | null }

export function FlowCompareChart({ data, type }: { data: FlowDay[]; type: string }) {
  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          {/* 유입 = 회색(들어오는 일감), 처리 = 시안(우리가 한 일) */}
          <Area dataKey="inflow" name="유입" fill={C.textMuted} fillOpacity={0.15} stroke={C.textMuted} strokeWidth={2} dot={{ r: 2, fill: C.textMuted }} />
          <Area dataKey="throughput" name="처리" fill={C.primary} fillOpacity={0.18} stroke={C.primary} strokeWidth={2} dot={{ r: 2, fill: C.primary }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-3 mt-1 text-xs text-ive-text-dim">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-text-muted mr-0.5" />유입</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-ive-cyan mr-0.5" />처리</span>
      </div>
    </div>
  )
}
