'use client'

import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart,
} from 'recharts'

const tooltipStyle = {
  contentStyle: { background: '#1a1f2e', border: '1px solid #2a2f3e', borderRadius: 8, fontSize: 11, padding: '8px 12px' },
  labelStyle: { color: '#9ca3af', fontWeight: 700, marginBottom: 4 },
}

// ───────────── 일별 추이 차트 (건수 바 + 비용 라인 + 이전 기간) ─────────────

interface DailyTrend { date: string; tasks: number | null; success: number | null; failed: number | null; cost: number | null }
interface PrevDaily { date: string; tasks: number; cost: number }

export function DailyTrendChart({ data, prevData, type }: { data: DailyTrend[]; prevData: PrevDaily[]; type: string }) {
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']
  const merged = data.map((d, i) => {
    let label: string
    if (type === 'yearly') label = `${parseInt(d.date.slice(5, 7))}월`
    else { const dt = new Date(d.date); label = type === 'weekly' ? DAY_LABELS[dt.getDay()] : `${dt.getDate()}` }
    return { label, tasks: d.tasks, cost: d.cost, prevTasks: prevData[i]?.tasks ?? 0, prevCost: prevData[i]?.cost ?? 0 }
  })

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={merged} barGap={0} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3e" />
          <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="tasks" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <YAxis yAxisId="cost" orientation="right" tick={{ fill: '#92702a', fontSize: 9 }} axisLine={false} tickLine={false} width={30} tickFormatter={v => `$${v}`} />
          <Tooltip {...tooltipStyle} />
          <Area yAxisId="tasks" dataKey="prevTasks" name="이전 건수" fill="#6b7280" fillOpacity={0.12} stroke="#6b7280" strokeDasharray="3 3" strokeWidth={1} dot={false} />
          <Bar yAxisId="tasks" dataKey="tasks" name="처리" fill="#34d399" radius={[2, 2, 0, 0]} />
          <Line yAxisId="cost" dataKey="cost" name="비용" stroke="#fbbf24" strokeWidth={2} dot={{ r: 2, fill: '#fbbf24' }} />
          <Line yAxisId="cost" dataKey="prevCost" name="이전 비용" stroke="#92702a" strokeDasharray="4 3" dot={false} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-3 mt-1 text-xs text-ive-text-dim">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#34d399] mr-0.5" />처리</span>
        <span><span className="inline-block w-3 h-0.5 bg-[#fbbf24] mr-0.5 align-middle" />비용</span>
        <span><span className="inline-block w-3 h-2 bg-[#6b7280]/20 border border-[#6b7280]/40 mr-0.5 align-middle" />이전 기간</span>
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
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3e" />
          <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <Tooltip {...tooltipStyle} />
          <Area dataKey="inflow" name="유입" fill="#22d3ee" fillOpacity={0.15} stroke="#22d3ee" strokeWidth={2} dot={{ r: 2, fill: '#22d3ee' }} />
          <Area dataKey="throughput" name="처리" fill="#34d399" fillOpacity={0.15} stroke="#34d399" strokeWidth={2} dot={{ r: 2, fill: '#34d399' }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-3 mt-1 text-xs text-ive-text-dim">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#22d3ee] mr-0.5" />유입</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#34d399] mr-0.5" />처리</span>
      </div>
    </div>
  )
}
