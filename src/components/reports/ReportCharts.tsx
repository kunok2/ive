'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart, Line, Area, Cell, AreaChart,
} from 'recharts'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'

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
  if (value === 'new') return <span className="text-xs font-bold px-1.5 py-0.5 rounded text-ive-cyan bg-ive-cyan/10">NEW</span>
  const color = invert
    ? (value > 0 ? 'text-ive-red bg-ive-red/10' : value < 0 ? 'text-ive-green bg-ive-green/10' : 'text-ive-text-dim bg-white/5')
    : (value > 0 ? 'text-ive-green bg-ive-green/10' : value < 0 ? 'text-ive-red bg-ive-red/10' : 'text-ive-text-dim bg-white/5')
  return (
    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${color}`}>
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
  const t = useTranslations('report')
  const DAY_LABELS = t.raw('dayLabels') as string[]
  const merged = data.map((d, i) => {
    let label: string
    if (type === 'yearly') {
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
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 space-y-2">
      {/* 요약 한 줄 */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-ive-text">{t('count')} {totalCur.toLocaleString()}</span>
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
          <Area yAxisId="tasks" dataKey="prevTasks" name={t('prevCount')} fill="#6b7280" fillOpacity={0.12} stroke="#6b7280" strokeDasharray="3 3" strokeWidth={1} dot={false} />
          {/* 현재 건수 — 스택 바 */}
          <Bar yAxisId="tasks" dataKey="success" stackId="cur" name={t('success')} fill="#34d399" />
          <Bar yAxisId="tasks" dataKey="failed" stackId="cur" name={t('failed')} fill="#f87171" radius={[2, 2, 0, 0]} />
          <Line yAxisId="cost" dataKey="cost" name={t('cost')} stroke="#fbbf24" strokeWidth={2} dot={{ r: 2, fill: '#fbbf24' }} />
          <Line yAxisId="cost" dataKey="prevCost" name={t('prevCost')} stroke="#92702a" strokeDasharray="4 3" dot={false} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* 범례 */}
      <div className="flex items-center justify-center gap-3 text-xs text-ive-text-dim">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#34d399] mr-0.5" />{t('success')}</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-[#f87171] mr-0.5" />{t('failed')}</span>
        <span><span className="inline-block w-3 h-0.5 bg-[#fbbf24] mr-0.5 align-middle" />{t('cost')}</span>
        <span><span className="inline-block w-3 h-2 bg-[#6b7280]/20 border border-[#6b7280]/40 mr-0.5 align-middle" />{t('lastWeek')}</span>
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
  const t = useTranslations('report')
  if (data.length === 0) return null

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold text-ive-text-dim border-b border-ive-border-dark flex items-center gap-1.5">
        <i className={`fa-solid ${icon} text-xs`} />
        {title}
      </div>
      {/* 헤더 */}
      <div className="grid grid-cols-[1fr_60px_50px_60px_50px] px-3 py-1.5 text-xs font-bold text-ive-text-dim border-b border-ive-border-dark/50">
        <span></span>
        <span className="text-right">{t('count')}</span>
        <span className="text-right">{t('change')}</span>
        <span className="text-right">{t('cost')}</span>
        <span className="text-right">{t('change')}</span>
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
            <span className="text-xs font-bold text-ive-text text-right">{d.tasks.toLocaleString()}</span>
            <div className="flex justify-end">
              <Badge value={taskDiff} />
            </div>
            <span className="text-xs font-bold text-ive-amber text-right">${formatCost(d.cost)}</span>
            <div className="flex justify-end">
              <Badge value={costDiff} invert />
            </div>
          </div>
        )
      })}
      {/* 합계 */}
      <div className="grid grid-cols-[1fr_60px_50px_60px_50px] items-center px-3 py-2 bg-ive-bg-deep/50 border-t border-ive-border-dark">
        <span className="text-xs font-bold text-ive-text-dim">합계</span>
        <span className="text-xs font-bold text-ive-text text-right">{data.reduce((s, d) => s + d.tasks, 0).toLocaleString()}</span>
        <div className="flex justify-end">
          <Badge value={pctChange(data.reduce((s, d) => s + d.tasks, 0), data.reduce((s, d) => s + d.prevTasks, 0))} />
        </div>
        <span className="text-xs font-bold text-ive-amber text-right">${formatCost(data.reduce((s, d) => s + d.cost, 0))}</span>
        <div className="flex justify-end">
          <Badge value={pctChange(data.reduce((s, d) => s + d.cost, 0), data.reduce((s, d) => s + d.prevCost, 0))} invert />
        </div>
      </div>
    </div>
  )
}

// ───────────── 대기 건수 추이 (프로젝트별 스택 영역 차트) ─────────────

interface WaitingDay {
  date: string
  total: number
  byProject: { projectId: string; projectName: string; projectColor: string; waiting: number }[]
}

export function WaitingTrendChart({ data, prevData, type }: {
  data: WaitingDay[]; prevData: WaitingDay[]; type: string
}) {
  const t = useTranslations('report')
  const DAY_LABELS = t.raw('dayLabels') as string[]

  // 모든 프로젝트 추출 (색상 포함)
  const projectSet = new Map<string, { name: string; color: string }>()
  for (const d of data) {
    for (const p of d.byProject) {
      if (!projectSet.has(p.projectId)) {
        projectSet.set(p.projectId, { name: p.projectName, color: p.projectColor })
      }
    }
  }
  const projects = Array.from(projectSet.entries())

  // 미래 날짜는 축은 유지하되 데이터만 null 처리
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const pastData = type === 'yearly' ? data : data.filter(d => d.date <= todayKST)

  // 차트 데이터 구성 (날짜별 row, 프로젝트별 key)
  const chartData = data.map((d, i) => {
    let label: string
    if (type === 'yearly') {
      label = `${parseInt(d.date.slice(5, 7))}월`
    } else {
      const dt = new Date(d.date)
      label = type === 'weekly' ? DAY_LABELS[dt.getDay()] : `${dt.getDate()}`
    }
    const isFuture = type !== 'yearly' && d.date > todayKST
    const row: Record<string, unknown> = { label, total: isFuture ? null : d.total, prevTotal: prevData[i]?.total ?? 0 }
    for (const [pid] of projects) {
      if (isFuture) { row[pid] = null; continue }
      const found = d.byProject.find(p => p.projectId === pid)
      row[pid] = found?.waiting ?? 0
    }
    return row
  })

  // 현재/이전 기간 총 대기건수 평균 (과거 데이터만)
  const avgCur = pastData.length > 0 ? Math.round(pastData.reduce((s, d) => s + d.total, 0) / pastData.length * 10) / 10 : 0
  const avgPrev = prevData.length > 0 ? Math.round(prevData.reduce((s, d) => s + d.total, 0) / prevData.length * 10) / 10 : 0
  const latestTotal = pastData.length > 0 ? pastData[pastData.length - 1].total : 0
  const allZero = pastData.every(d => d.total === 0) && prevData.every(d => d.total === 0)

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 space-y-2">
      {/* 요약 한 줄 */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-ive-text">{t('waitingCurrent')} {latestTotal.toLocaleString()}{t('waitingUnit')}</span>
        <Badge value={pctChange(avgCur, avgPrev)} invert />
        <span className="text-xs text-ive-text-dim ml-auto">{t('waitingAvg')} {avgCur.toLocaleString()}</span>
      </div>

      {allZero ? (
        <div className="flex items-center justify-center py-4 text-xs text-ive-text-dim">
          {t('noWaitingHistory')}
        </div>
      ) : (<>
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3e" />
          <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <Tooltip
            {...tooltipStyle}
            formatter={(value: unknown, name: unknown) => {
              const proj = projects.find(([pid]) => pid === name)
              return [String(value), proj ? proj[1].name : String(name)]
            }}
          />
          {/* 이전 기간 대기건수 — 회색 점선 영역 */}
          <Area dataKey="prevTotal" name={t('prevWaiting')} fill="#6b7280" fillOpacity={0.08} stroke="#6b7280" strokeDasharray="3 3" strokeWidth={1} dot={false} />
          {/* 프로젝트별 스택 영역 */}
          {projects.map(([pid, info], idx) => (
            <Area
              key={pid}
              dataKey={pid}
              name={info.name}
              stackId="waiting"
              fill={info.color}
              fillOpacity={0.6}
              stroke={info.color}
              strokeWidth={1}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      {/* 범례 — 프로젝트별 */}
      <div className="flex items-center justify-center gap-3 flex-wrap text-xs text-ive-text-dim">
        {projects.map(([pid, info]) => (
          <span key={pid}>
            <span className="inline-block w-2 h-2 rounded-sm mr-0.5" style={{ background: info.color }} />
            {info.name}
          </span>
        ))}
        <span><span className="inline-block w-3 h-2 bg-[#6b7280]/20 border border-[#6b7280]/40 mr-0.5 align-middle" />{t('prevWaiting')}</span>
      </div>
      </>)}
    </div>
  )
}

// ───────────── 에이전트별 대기건수 추이 (스택 영역 차트) ─────────────

interface AgentWaitingDay {
  date: string
  total: number
  byAgent: { agentId: string; agentName: string; agentAvatar: string; waiting: number }[]
}

// 에이전트별 색상 팔레트 (고정)
const AGENT_COLORS = [
  '#34d399', '#60a5fa', '#fbbf24', '#f87171', '#a78bfa',
  '#38bdf8', '#fb923c', '#4ade80', '#e879f9', '#facc15',
]

export function WaitingByAgentChart({ data, prevData, type }: {
  data: AgentWaitingDay[]; prevData: AgentWaitingDay[]; type: string
}) {
  const t = useTranslations('report')
  const DAY_LABELS = t.raw('dayLabels') as string[]

  // 모든 에이전트 추출 (순서 유지)
  const agentSet = new Map<string, { name: string; avatar: string }>()
  for (const d of data) {
    for (const a of d.byAgent) {
      if (!agentSet.has(a.agentId)) {
        agentSet.set(a.agentId, { name: a.agentName, avatar: a.agentAvatar })
      }
    }
  }
  const agents = Array.from(agentSet.entries())

  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const pastData = type === 'yearly' ? data : data.filter(d => d.date <= todayKST)
  const allZero = pastData.every(d => d.total === 0) && prevData.every(d => d.total === 0)

  const chartData = data.map((d, i) => {
    let label: string
    if (type === 'yearly') {
      label = `${parseInt(d.date.slice(5, 7))}월`
    } else {
      const dt = new Date(d.date)
      label = type === 'weekly' ? DAY_LABELS[dt.getDay()] : `${dt.getDate()}`
    }
    const isFuture = type !== 'yearly' && d.date > todayKST
    const row: Record<string, unknown> = { label, total: isFuture ? null : d.total, prevTotal: prevData[i]?.total ?? 0 }
    for (const [aid] of agents) {
      if (isFuture) { row[aid] = null; continue }
      const found = d.byAgent.find(a => a.agentId === aid)
      row[aid] = found?.waiting ?? 0
    }
    return row
  })

  const avgCur = pastData.length > 0 ? Math.round(pastData.reduce((s, d) => s + d.total, 0) / pastData.length * 10) / 10 : 0
  const avgPrev = prevData.length > 0 ? Math.round(prevData.reduce((s, d) => s + d.total, 0) / prevData.length * 10) / 10 : 0
  const latestTotal = pastData.length > 0 ? pastData[pastData.length - 1].total : 0

  if (agents.length === 0) return null

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-ive-text">{t('waitingCurrent')} {latestTotal.toLocaleString()}{t('waitingUnit')}</span>
        <Badge value={pctChange(avgCur, avgPrev)} invert />
        <span className="text-xs text-ive-text-dim ml-auto">{t('waitingAvg')} {avgCur.toLocaleString()}</span>
      </div>

      {allZero ? (
        <div className="flex items-center justify-center py-4 text-xs text-ive-text-dim">
          {t('noWaitingHistory')}
        </div>
      ) : (<>
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3e" />
          <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          <Tooltip
            {...tooltipStyle}
            formatter={(value: unknown, name: unknown) => {
              const agent = agents.find(([aid]) => aid === name)
              return [String(value), agent ? agent[1].name : String(name)]
            }}
          />
          <Area dataKey="prevTotal" name={t('prevWaiting')} fill="#6b7280" fillOpacity={0.08} stroke="#6b7280" strokeDasharray="3 3" strokeWidth={1} dot={false} />
          {agents.map(([aid], idx) => (
            <Area
              key={aid}
              dataKey={aid}
              name={agentSet.get(aid)?.name ?? aid}
              stackId="waiting"
              fill={AGENT_COLORS[idx % AGENT_COLORS.length]}
              fillOpacity={0.6}
              stroke={AGENT_COLORS[idx % AGENT_COLORS.length]}
              strokeWidth={1}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      {/* 범례 — 에이전트별 아바타 + 이름 */}
      <div className="flex items-center justify-center gap-3 flex-wrap text-xs text-ive-text-dim">
        {agents.map(([aid, info], idx) => (
          <span key={aid} className="flex items-center gap-1">
            <AgentAvatar avatar={info.avatar} size="sm" className="!w-3 !h-3 !text-[7px]" />
            <span style={{ color: AGENT_COLORS[idx % AGENT_COLORS.length] }}>{info.name}</span>
          </span>
        ))}
        <span><span className="inline-block w-3 h-2 bg-[#6b7280]/20 border border-[#6b7280]/40 mr-0.5 align-middle" />{t('prevWaiting')}</span>
      </div>
      </>)}
    </div>
  )
}

// ───────────── 에이전트별/프로젝트별 현재 대기건수 요약 바 ─────────────

interface WaitingBarItem {
  name: string
  avatar?: string
  color?: string
  waiting: number
  prevWaiting: number
}

export function WaitingSummaryBar({ title, icon, data }: {
  title: string; icon: string; data: WaitingBarItem[]
}) {
  const t = useTranslations('report')
  const sorted = [...data].filter(d => d.waiting > 0 || d.prevWaiting > 0).sort((a, b) => b.waiting - a.waiting)
  if (sorted.length === 0) return null

  const maxWaiting = Math.max(...sorted.map(d => d.waiting), 1)

  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
      <div className="px-3 py-2 text-xs font-bold text-ive-text-dim border-b border-ive-border-dark flex items-center gap-1.5">
        <i className={`fa-solid ${icon} text-xs`} />
        {title}
      </div>
      <div className="divide-y divide-ive-border-dark/30">
        {sorted.map((d, i) => {
          const pct = Math.round((d.waiting / maxWaiting) * 100)
          const diff = pctChange(d.waiting, d.prevWaiting)
          return (
            <div key={i} className="px-3 py-2 hover:bg-white/[0.02]">
              <div className="flex items-center gap-2 mb-1">
                {d.avatar ? (
                  <AgentAvatar avatar={d.avatar} size="sm" className="!w-4 !h-4 !text-[8px]" />
                ) : d.color ? (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                ) : null}
                <span className="text-xs font-bold text-ive-text truncate flex-1">{d.name}</span>
                <span className="text-xs font-bold text-ive-amber">{d.waiting.toLocaleString()}{t('waitingUnit')}</span>
                <Badge value={diff} invert />
              </div>
              <div className="h-1.5 rounded-full bg-ive-bg-deep overflow-hidden">
                <div
                  className="h-full rounded-full bg-ive-amber/60 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
