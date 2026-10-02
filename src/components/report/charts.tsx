'use client'

/**
 * 지난 기간 비교 차트 — 종전 보고서의 비교 방식을 그대로 쓴다:
 * 이번 기간은 실선+채움, 지난 기간은 점선. 유입=회색, 완료=시안(측정값이라 의미색을 쓰지 않는다).
 */
import { useEffect, useState } from 'react'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts'
import type { Trend, MonthPoint } from '@/lib/report-model/types'
import type { Tr } from './format'

const C = {
  border: 'var(--color-ive-border)',
  muted: 'var(--color-ive-text-muted)',
  secondary: 'var(--color-ive-text-secondary)',
  text: 'var(--color-ive-text)',
  primary: 'var(--color-ive-cyan)',
}

function useIsMobile(breakpoint = 768) {
  // 차트는 데이터를 받은 뒤(클라이언트)에만 그려지므로 첫 값을 바로 읽는다
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const h = (e: MediaQueryListEvent) => setM(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [breakpoint])
  return m
}

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-ive-border rounded-lg text-xs px-3 py-2" style={{ background: 'color-mix(in srgb, var(--color-ive-bg-solid) 92%, transparent)', backdropFilter: 'blur(8px)' }}>
      <div className="font-bold text-ive-text mb-1">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i}><span className="text-ive-text-secondary">{p.name}: </span><span className="font-bold text-ive-text">{p.value ?? '—'}</span></div>
      ))}
    </div>
  )
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; line?: boolean }[] }) {
  return (
    <div className="flex items-center justify-center flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1">
          {i.dashed || i.line
            ? <span className="inline-block w-3 align-middle" style={{ borderTop: `2px ${i.dashed ? 'dashed' : 'solid'} ${i.color}` }} />
            : <span className="inline-block w-2 h-2 rounded-full" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}

function labelFor(type: 'weekly' | 'monthly' | 'yearly', key: string, dayLabels: string[], tr: Tr): string {
  if (type === 'yearly') return tr('monthShort', { m: Number(key.slice(5, 7)) })
  if (type === 'weekly') return dayLabels[new Date(`${key}T00:00:00Z`).getUTCDay()]
  return String(Number(key.slice(8, 10)))
}

export function TrendCompare({ trend, type, tr, dayLabels, prevLabel }: { trend: Trend; type: 'weekly' | 'monthly' | 'yearly'; tr: Tr; dayLabels: string[]; prevLabel: string }) {
  const mobile = useIsMobile()
  const data = trend.labels.map((k, i) => ({
    label: labelFor(type, k, dayLabels, tr),
    inflow: trend.inflow[i], completed: trend.completed[i],
    prevInflow: trend.prevInflow[i] ?? null, prevCompleted: trend.prevCompleted[i] ?? null,
  }))
  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          {!mobile && <Tooltip content={<Tip />} />}
          <Area dataKey="prevInflow" name={tr('legPrevInflow', { label: prevLabel })} fill="none" stroke={C.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
          <Area dataKey="prevCompleted" name={tr('legPrevDone', { label: prevLabel })} fill="none" stroke={C.primary} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
          <Area dataKey="inflow" name={tr('legInflow')} fill={C.muted} fillOpacity={0.15} stroke={C.muted} strokeWidth={2} dot={{ r: 2, fill: C.muted }} />
          <Area dataKey="completed" name={tr('legDone')} fill={C.primary} fillOpacity={0.18} stroke={C.primary} strokeWidth={2} dot={{ r: 2, fill: C.primary }} />
        </AreaChart>
      </ResponsiveContainer>
      <Legend items={[
        { label: tr('legInflow'), color: C.muted }, { label: tr('legDone'), color: C.primary },
        { label: tr('legPrevInflow', { label: prevLabel }), color: C.muted, dashed: true },
        { label: tr('legPrevDone', { label: prevLabel }), color: C.primary, dashed: true },
      ]} />
    </div>
  )
}

export function HeldCompare({ trend, type, tr, dayLabels, prevLabel }: { trend: Trend; type: 'weekly' | 'monthly' | 'yearly'; tr: Tr; dayLabels: string[]; prevLabel: string }) {
  const mobile = useIsMobile()
  if (trend.held.every(v => v == null) && trend.prevHeld.every(v => v == null)) return null
  const data = trend.labels.map((k, i) => ({ label: labelFor(type, k, dayLabels, tr), held: trend.held[i], prevHeld: trend.prevHeld[i] ?? null }))
  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
          {!mobile && <Tooltip content={<Tip />} />}
          <Line dataKey="prevHeld" name={tr('legPrevHeld', { label: prevLabel })} stroke={C.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
          <Line dataKey="held" name={tr('legHeld')} stroke={C.text} strokeWidth={2} dot={{ r: 2, fill: C.text }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
      <Legend items={[{ label: tr('legHeld'), color: C.text, line: true }, { label: tr('legPrevHeld', { label: prevLabel }), color: C.muted, dashed: true }]} />
    </div>
  )
}

/** 월별 완료 막대(마지막 달 강조) */
export function MonthBars({ months, tr }: { months: MonthPoint[]; tr: Tr }) {
  const data = months.map((m, i) => ({ label: tr('monthShort', { m: Number(m.label.slice(5, 7)) }), v: m.completed, last: i === months.length - 1 }))
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 14, right: 4, left: 0, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis hide allowDecimals={false} />
        <Bar dataKey="v" radius={[2, 2, 0, 0]} label={{ position: 'top', fill: C.secondary, fontSize: 10 }}
          shape={(p: any) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={2} fill={C.primary} fillOpacity={p.payload.last ? 1 : 0.4} />} />
      </BarChart>
    </ResponsiveContainer>
  )
}
