'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart, Line, Area, Cell,
} from 'recharts'
import AgentAvatar from '@/components/agent/AgentAvatar'

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

const tooltipStyle = {
  contentStyle: { background: '#1a1f2e', border: '1px solid #2a2f3e', borderRadius: 8, fontSize: 11, padding: '8px 12px' },
  labelStyle: { color: '#9ca3af', fontWeight: 700, marginBottom: 4 },
}

function formatCost(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pctChange(cur: number, prev: number): number | 'new' | null {
  if (prev === 0) return cur > 0 ? 'new' : null
  return Math.round(((cur - prev) / prev) * 100)
}

function Badge({ value, invert }: { value: number | 'new' | null; invert?: boolean }) {
  if (value == null) return null
  if (value === 'new') return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-ive-cyan bg-ive-cyan/10">NEW</span>
  const color = invert
    ? (value > 0 ? 'text-ive-red bg-ive-red/10' : value < 0 ? 'text-ive-green bg-ive-green/10' : 'text-ive-text-dim bg-white/5')
    : (value > 0 ? 'text-ive-green bg-ive-green/10' : value < 0 ? 'text-ive-red bg-ive-red/10' : 'text-ive-text-dim bg-white/5')
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      {value > 0 ? '+' : ''}{value.toLocaleString()}%
    </span>
  )
}

// ───────────── 일별 종합 트렌드 (건수 바 + 비용 라인 + 이전 기간 영역) ─────────────

interface DailyTrend {
  date: string; tasks: number | null; success: number | null; failed: number | null; cost: number | null
  waitAvg: number | null; procAvg: number | null
}
interface PrevDaily { date: string; tasks: number; cost: number }

export function DailyTrendChart({ data, prevData, type }: {
  data: DailyTrend[]; prevData: PrevDaily[]; type: string
}) {
  const merged = data.map((d, i) => {
    let label: string
    if (type === 'yearly') {
      // d.date = "YYYY-MM"
      label = `${parseInt(d.date.slice(5, 7))}월`
    } else {
      const dt = new Date(d.date)
      label = type === 'weekly' ? DAY_LABELS[dt.getDay()] : `${dt.getDate()}`
    }
    return {
      label,
      success: d.success,
      failed: d.failed,
      cost: d.cost,
      prevTasks: prevData[i]?.tasks ?? 0,
      prevCost: prevData[i]?.cost ?? 0,
    }
  })

  const totalCur = data.reduce((s, d) => s + (d.tasks ?? 0), 0)
  const totalPrev = prevData.reduce((s, d) => s + d.tasks, 0)
  const costCur = data.reduce((s, d) => s + (d.cost ?? 0), 0)
  const costPrev = prevData.reduce((s, d) => s + d.cost, 0)

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl p-3 space-y-2">
      {/* 요약 한 줄 */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-ive-text">건수 {totalCur.toLocaleString()}건</span>
        <Badge value={pctChange(totalCur, totalPrev)} />
        <span className="text-xs font-bold text-ive-amber ml-auto">${formatCost(costCur)}</span>
        <Badge value={pctChange(costCur, costPrev)} invert />
      </div>

      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={merged} barGap={0} barCategoryGap="15%">
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3e" />
          <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="tasks" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <YAxis yAxisId="cost" orientation="right" tick={{ fill: '#92702a', fontSize: 9 }} axisLine={false} tickLine={false} width={30} tickFormatter={v => `$${v}`} />
          <Tooltip {...tooltipStyle} />
          {/* 이전 기간 건수 — 회색 영역 */}
          <Area yAxisId="tasks" dataKey="prevTasks" name="이전 건수" fill="#6b7280" fillOpacity={0.12} stroke="#6b7280" strokeDasharray="3 3" strokeWidth={1} dot={false} />
          {/* 현재 건수 — 스택 바 */}
          <Bar yAxisId="tasks" dataKey="success" stackId="cur" name="성공" fill="#34d399" />
          <Bar yAxisId="tasks" dataKey="failed" stackId="cur" name="실패" fill="#f87171" radius={[2, 2, 0, 0]} />
          {/* 비용 라인 */}
          <Line yAxisId="cost" dataKey="cost" name="비용" stroke="#fbbf24" strokeWidth={2} dot={{ r: 2, fill: '#fbbf24' }} />
          <Line yAxisId="cost" dataKey="prevCost" name="이전 비용" stroke="#92702a" strokeDasharray="4 3" dot={false} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* 범례 */}
      <div className="flex items-center justify-center gap-3 text-[10px] text-ive-text-dim">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#34d399] mr-0.5" />성공</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#f87171] mr-0.5" />실패</span>
        <span><span className="inline-block w-3 h-0.5 bg-[#fbbf24] mr-0.5 align-middle" />비용</span>
        <span><span className="inline-block w-3 h-2 bg-[#6b7280]/20 border border-[#6b7280]/40 mr-0.5 align-middle" />이전</span>
      </div>
    </div>
  )
}

// ───────────── 프로젝트별 요약 (차트 X, 깔끔한 테이블) ─────────────

interface CompareItem {
  name: string; color: string; avatar?: string; avatarUrl?: string; provider?: string
  tasks: number; cost: number; prevTasks: number; prevCost: number
}

export function CompareTable({ title, data, icon }: { title: string; data: CompareItem[]; icon: string }) {
  if (data.length === 0) return null

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold text-ive-text-dim border-b border-ive-border-dark flex items-center gap-1.5">
        <i className={`fa-solid ${icon} text-[10px]`} />
        {title}
      </div>
      {/* 헤더 */}
      <div className="grid grid-cols-[1fr_60px_50px_60px_50px] px-3 py-1.5 text-[10px] font-bold text-ive-text-dim border-b border-ive-border-dark/50">
        <span></span>
        <span className="text-right">건수</span>
        <span className="text-right">변동</span>
        <span className="text-right">비용</span>
        <span className="text-right">변동</span>
      </div>
      {/* 행 */}
      {data.map((d, i) => {
        const taskDiff = pctChange(d.tasks, d.prevTasks)
        const costDiff = pctChange(d.cost, d.prevCost)
        return (
          <div key={i} className="grid grid-cols-[1fr_60px_50px_60px_50px] items-center px-3 py-2 border-b border-ive-border-dark/30 last:border-b-0 hover:bg-white/[0.02]">
            <div className="flex items-center gap-1.5 min-w-0">
              {d.avatar ? (
                <AgentAvatar avatar={d.avatar} size="sm" className="!w-4 !h-4 !text-[8px]" />
              ) : d.avatarUrl ? (
                <img src={d.avatarUrl} alt="" className="w-4 h-4 rounded object-cover shrink-0" style={{ outline: `1.5px solid ${d.color || '#4ade80'}60`, outlineOffset: '0.5px' }} />
              ) : d.provider ? (
                <span className="w-4 h-4 rounded flex items-center justify-center shrink-0 bg-ive-bg-deep" style={{ outline: `1px solid ${d.color || '#4ade80'}40`, outlineOffset: '0.5px' }}>
                  <i className={`fa-brands ${d.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-[9px]`} style={{ color: d.color || '#4ade80' }} />
                </span>
              ) : null}
              <span className="text-xs font-bold text-ive-text truncate">{d.name}</span>
            </div>
            <span className="text-xs font-extrabold text-ive-text text-right">{d.tasks.toLocaleString()}</span>
            <div className="flex justify-end">
              <Badge value={taskDiff} />
            </div>
            <span className="text-xs font-extrabold text-ive-amber text-right">${formatCost(d.cost)}</span>
            <div className="flex justify-end">
              <Badge value={costDiff} invert />
            </div>
          </div>
        )
      })}
      {/* 합계 */}
      <div className="grid grid-cols-[1fr_60px_50px_60px_50px] items-center px-3 py-2 bg-ive-bg-deep/50 border-t border-ive-border-dark">
        <span className="text-xs font-bold text-ive-text-dim">합계</span>
        <span className="text-xs font-extrabold text-ive-text text-right">{data.reduce((s, d) => s + d.tasks, 0).toLocaleString()}</span>
        <div className="flex justify-end">
          <Badge value={pctChange(data.reduce((s, d) => s + d.tasks, 0), data.reduce((s, d) => s + d.prevTasks, 0))} />
        </div>
        <span className="text-xs font-extrabold text-ive-amber text-right">${formatCost(data.reduce((s, d) => s + d.cost, 0))}</span>
        <div className="flex justify-end">
          <Badge value={pctChange(data.reduce((s, d) => s + d.cost, 0), data.reduce((s, d) => s + d.prevCost, 0))} invert />
        </div>
      </div>
    </div>
  )
}
