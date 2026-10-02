'use client'

/**
 * 월간·연간(경영진용) 섹션 — 산출 추이, 보유 추세, 사람 시간 비중 추이, 위험, 작업 결과 평가.
 */
import type { ReactNode } from 'react'
import type { MonthPoint, Risks, Evaluation, Grade } from '@/lib/report-model/types'
import { GRADES } from '@/lib/report-model/types'
import { Card, SectionTitle } from './sections'
import { MonthBars } from './charts'
import { fmtHours, pct, type Tr } from './format'

const SHARE_OPACITY = ['bg-ive-cyan', 'bg-ive-cyan/60', 'bg-ive-cyan/35', 'bg-ive-cyan/20']

export function MonthsSection({ months, tr }: { months: MonthPoint[]; tr: Tr }) {
  if (months.length === 0) return null
  const last = months[months.length - 1]
  const prev = months.length > 1 ? months[months.length - 2] : null
  return (
    <Card>
      <SectionTitle>{tr('monthsTitle', { n: months.length })}</SectionTitle>
      <MonthBars months={months} pick={m => m.completed} tr={tr} />
      <div className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3 flex flex-col gap-1.5 text-sm font-bold">
        <Line label={tr('leadMedian')} value={last.leadMedianH == null ? tr('noRecord') : fmtHours(tr, last.leadMedianH)}
          sub={prev?.leadMedianH != null ? tr('prevMonthShort', { v: fmtHours(tr, prev.leadMedianH) }) : undefined} />
        <Line label={tr('heldMonthEnd')} value={last.heldEnd == null ? tr('noRecord') : tr('countN', { n: last.heldEnd })}
          sub={prev?.heldEnd != null ? tr('prevMonthShort', { v: tr('countN', { n: prev.heldEnd }) }) : undefined} />
      </div>
      {months.some(m => m.heldEnd != null) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-ive-text-secondary">{tr('heldTrendTitle')}</span>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
            {months.map(m => (
              <div key={m.start} className="flex flex-col items-center gap-0.5">
                <span className="text-xs font-bold text-ive-text tabular-nums">{m.heldEnd ?? '—'}</span>
                <span className="text-xs font-bold text-ive-text-muted">{tr('monthShort', { m: Number(m.label.slice(5, 7)) })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function Line({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ive-text-secondary">{label}</span>
      <span className="text-ive-text tabular-nums">{value}{sub && <span className="text-ive-text-secondary text-xs ml-1">· {sub}</span>}</span>
    </div>
  )
}

export function ShareTrendSection({ months, tr }: { months: MonthPoint[]; tr: Tr }) {
  const any = months.some(m => m.projectShares.length > 0)
  if (!any) return null
  // 범례는 최근 달 기준 상위 3개 + 기타
  const lastShares = months[months.length - 1].projectShares
  const names = (lastShares.length ? lastShares : months.flatMap(m => m.projectShares)).slice(0, 3).map(s => s.name)
  const first = months.find(m => m.projectShares.length > 0)!
  const last = months[months.length - 1]
  const topName = names[0]
  const shareOf = (m: MonthPoint, n: string) => m.projectShares.find(s => s.name === n)?.share ?? 0
  return (
    <Card>
      <SectionTitle>{tr('shareTrendTitle', { n: months.length })}</SectionTitle>
      <div className="grid gap-2 h-28" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map(m => {
          const parts = names.map(n => shareOf(m, n))
          const other = Math.max(0, 1 - parts.reduce((s, v) => s + v, 0))
          return (
            <div key={m.start} className="flex flex-col gap-0.5 h-full justify-end">
              {m.projectShares.length === 0 ? <div className="h-full rounded-sm border border-dashed border-ive-border" /> : (
                [...parts, other].map((v, i) => v > 0 && <div key={i} className={`${SHARE_OPACITY[Math.min(i, 3)]} rounded-sm`} style={{ height: `${v * 100}%` }} />)
              )}
            </div>
          )
        })}
      </div>
      <div className="grid gap-2 text-center text-xs font-bold text-ive-text-muted" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map(m => <span key={m.start}>{tr('monthShort', { m: Number(m.label.slice(5, 7)) })}</span>)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
        {[...names, tr('others')].map((n, i) => (
          <span key={n} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${SHARE_OPACITY[Math.min(i, 3)]}`} />{n}</span>
        ))}
      </div>
      {topName && first !== last && (
        <span className="text-xs font-bold text-ive-text-muted">{tr('shareMoved', {
          name: topName, from: pct(shareOf(first, topName)), to: pct(shareOf(last, topName)),
          m1: Number(first.label.slice(5, 7)), m2: Number(last.label.slice(5, 7)),
        })}</span>
      )}
    </Card>
  )
}

export function RiskSection({ risks, tr }: { risks: Risks; tr: Tr }) {
  const items: ReactNode[] = []
  if (risks.concentration) {
    const c = risks.concentration
    items.push(<RiskCard key="c" icon="fa-triangle-exclamation" title={tr('riskConcentration', { role: tr(`role.${c.role}`), name: c.name, pct: pct(c.share) })} detail={tr('riskConcentrationDetail', { n: c.count, total: c.total })} />)
  }
  if (risks.rejectRate != null && risks.prevRejectRate != null && risks.rejectRate - risks.prevRejectRate >= 0.03) {
    items.push(<RiskCard key="r" icon="fa-triangle-exclamation" title={tr('riskReject', { v: pct(risks.rejectRate), p: pct(risks.prevRejectRate) })}
      detail={risks.rejectTopProject ? tr('riskRejectTop', { name: risks.rejectTopProject.name, v: pct(risks.rejectTopProject.rate) }) : ''} />)
  }
  if (risks.agedEnd != null && risks.agedEnd > 0) {
    items.push(<RiskCard key="a" icon="fa-clock" title={tr('riskAged', { n: risks.agedEnd })} detail="" />)
  }
  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs font-bold text-ive-text-secondary pt-1">{items.length ? tr('riskTitleN', { n: items.length }) : tr('riskTitle')}</span>
      {items.length ? items : (
        <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 flex items-center gap-2">
          <i className="fa-solid fa-circle-check text-sm text-ive-cyan" />
          <span className="text-sm font-bold text-ive-text">{tr('riskNone')}</span>
        </div>
      )}
      {risks.rejectRate != null && (
        <span className="text-xs font-bold text-ive-text-muted px-1">{tr('rejectRateLine', { v: pct(risks.rejectRate), p: risks.prevRejectRate != null ? pct(risks.prevRejectRate) : '—' })}</span>
      )}
    </section>
  )
}

function RiskCard({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 flex gap-2">
      <i className={`fa-solid ${icon} text-sm mt-0.5 text-ive-amber`} />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-bold text-ive-text">{title}</span>
        {detail && <span className="text-xs font-bold text-ive-text-secondary">{detail}</span>}
      </div>
    </div>
  )
}

// ─── 작업 결과 평가 ───

const GRADE_STYLE: Record<Grade, string> = {
  pass: 'bg-ive-cyan', rerun: 'bg-ive-cyan/45', rejected_pass: 'bg-ive-amber', rejected_repeat: 'bg-ive-red/60', overturned: 'bg-ive-red',
}

function GradeBar({ grades, n }: { grades: Record<Grade, number>; n: number }) {
  return (
    <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-ive-bg">
      {GRADES.map(g => grades[g] > 0 && <div key={g} className={GRADE_STYLE[g]} style={{ width: `${(grades[g] / n) * 100}%` }} />)}
    </div>
  )
}

export function EvaluationSection({ ev, tr }: { ev: Evaluation; tr: Tr }) {
  const groups = ev.groups.filter(g => g.n > 0)
  return (
    <Card>
      <SectionTitle right={tr('evalWindow', { from: ev.windowStart.slice(5).replace('-', '.'), to: ev.windowEnd.slice(5).replace('-', '.') })}>{tr('evalTitle')}</SectionTitle>
      <span className="text-xs font-bold text-ive-text-muted leading-relaxed">{tr('evalIntro')}</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
        {GRADES.map(g => <span key={g} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${GRADE_STYLE[g]}`} />{tr(`grade.${g}`)}</span>)}
      </div>
      {groups.length === 0 && ev.workers.length === 0 ? (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('evalEmpty')}</span>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-ive-text-secondary">{tr('evalGroups')}</span>
              {groups.map(g => (
                <div key={g.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm font-bold">
                    <span className="text-ive-text">{tr(`evalGroup.${g.key}`)}</span>
                    <span className="text-ive-text tabular-nums">{tr('passOf', { v: pct(g.passRate), n: g.n })}</span>
                  </div>
                  <GradeBar grades={g.grades} n={g.n} />
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-ive-text-secondary">{tr('evalWorkers')}</span>
            {ev.workers.map(w => (
              <div key={w.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-sm font-bold">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-ive-text">{w.name}</span>
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary shrink-0">{tr(`evalKind.${w.kind}`)}</span>
                  </span>
                  {w.state === 'ok'
                    ? <span className="text-ive-text tabular-nums shrink-0">{tr('passOf', { v: pct(w.passRate), n: w.n })}</span>
                    : <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary shrink-0">{tr('collecting', { n: w.n, min: 20 })}</span>}
                </div>
                {w.state === 'ok' ? <GradeBar grades={w.grades} n={w.n} /> : <div className="h-2.5 rounded-full border border-dashed border-ive-border" />}
              </div>
            ))}
          </div>
          {ev.comparisons.map(c => (
            <div key={`${c.a}|${c.b}`} className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3 flex flex-col gap-1">
              <span className="text-sm font-bold text-ive-text">{tr(c.state === 'clear' ? 'cmpClear' : 'cmpUnclear', { a: c.a, b: c.b })}</span>
              {c.state === 'unclear' && c.needMore != null && <span className="text-xs font-bold text-ive-text-secondary">{tr('cmpNeedMore', { n: c.needMore })}</span>}
              {c.differentProjects && <span className="text-xs font-bold text-ive-text-secondary">{tr('cmpDifferentProjects')}</span>}
            </div>
          ))}
          {ev.verifiers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-ive-text-secondary">{tr('evalVerifiers')}</span>
              {ev.verifiers.map(v => (
                <div key={v.key} className="flex items-center justify-between gap-2 text-sm font-bold">
                  <span className="text-ive-text truncate">{v.name}</span>
                  {v.state === 'ok'
                    ? <span className="text-ive-text tabular-nums">{tr('verifierLine', { v: pct(v.rate), n: v.approved, r: v.laterRejected })}</span>
                    : <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary">{tr('collecting', { n: v.approved, min: 20 })}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <span className="text-xs font-bold text-ive-text-muted leading-relaxed">{tr('evalNote')}</span>
    </Card>
  )
}
