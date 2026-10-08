'use client'

/**
 * 월간·연간(경영진용) 섹션 — 산출 추이, 보유 추세, 사람 시간 비중 추이, 위험, 작업 결과 평가.
 */
import { useState, type ReactNode } from 'react'
import type { MonthPoint, Risks, Held, Evaluation, Grade } from '@/lib/report-model/types'
import { GRADES, FLOW_STAGES } from '@/lib/report-model/types'
import { Card, SectionTitle, PersonFace, STAGE_BAR, stageGroup } from './sections'
import { MonthBars } from './charts'
import { fmtHours, pct, MIN_SAMPLE, projectSwatchStyles, OTHERS_ID, type Tr } from './format'
import { StackedHBar, hoverHandlers } from './hbar'

export function MonthsSection({ months, tr }: { months: MonthPoint[]; tr: Tr }) {
  if (months.length === 0) return null
  const last = months[months.length - 1]
  const prev = months.length > 1 ? months[months.length - 2] : null
  return (
    <Card>
      <SectionTitle>{tr('monthsTitle', { n: months.length })}</SectionTitle>
      <MonthBars months={months} tr={tr} />
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
  const withData = months.filter(m => m.projectShares.length > 0)
  if (withData.length === 0) return null
  // 범례: 가장 최근에 사람 시간이 있던 달 기준 상위 3개 프로젝트(프로젝트 id 로 구분 — 이름이 같아도 섞이지 않게)
  const ref = withData[withData.length - 1]
  const top = ref.projectShares.slice(0, 3)
  const shareOf = (m: MonthPoint, id: string) => m.projectShares.find(s => s.id === id)?.share ?? 0
  const otherOf = (m: MonthPoint) => {
    const o = 1 - top.reduce((s, p) => s + shareOf(m, p.id), 0)
    return m.projectShares.length > 0 && o > 0.005 ? o : 0
  }
  const hasOther = months.some(m => otherOf(m) > 0)
  const legend = [...top.map(p => ({ id: p.id, name: p.name, color: p.color })), ...(hasOther ? [{ id: OTHERS_ID, name: tr('others'), color: null }] : [])]
  // 조각 색 = 프로젝트 주제색 — 달이 바뀌어도 같은 프로젝트는 같은 색 (주간 화면·메일과 같은 규칙)
  const swatches = projectSwatchStyles(legend)
  const first = withData[0]
  const lead = top[0]
  return (
    <Card>
      <SectionTitle>{tr('shareTrendTitle', { n: months.length })}</SectionTitle>
      <div className="grid gap-2 h-28" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map(m => {
          const parts = [...top.map(p => shareOf(m, p.id)), ...(hasOther ? [otherOf(m)] : [])]
          return (
            <div key={m.start} className="flex flex-col gap-0.5 h-full justify-end">
              {m.projectShares.length === 0
                ? <div className="h-full rounded-lg border border-dashed border-ive-border" />
                : parts.map((v, i) => v > 0 && <div key={legend[i].id} style={{ ...swatches[i], flexGrow: v, flexBasis: 0 }} />)}
            </div>
          )
        })}
      </div>
      <div className="grid gap-2 text-center text-xs font-bold text-ive-text-muted" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
        {months.map(m => <span key={m.start}>{tr('monthShort', { m: Number(m.label.slice(5, 7)) })}</span>)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
        {legend.map((l, i) => (
          <span key={l.id} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={swatches[i]} />{l.name}</span>
        ))}
      </div>
      {lead && first !== ref && (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('shareMoved', {
          name: lead.name, from: pct(shareOf(first, lead.id)), to: pct(shareOf(ref, lead.id)),
          m1: Number(first.label.slice(5, 7)), m2: Number(ref.label.slice(5, 7)),
        })}</span>
      )}
    </Card>
  )
}

/** 달마다 끝낸 일의 단계별 시간 비중 — 색은 「어디서 시간이 걸렸나」와 같은 단계색(범례 1:1) */
export function StageTrendSection({ months, tr }: { months: MonthPoint[]; tr: Tr }) {
  // 강조 — 막대 조각을 호버하면 그 달에 툴팁, 범례를 호버하면 그 단계를 모든 달에서(툴팁 없이)
  const [hov, setHov] = useState<{ stage: string; month: string | null } | null>(null)
  if (!months.some(m => m.stageShares?.length)) return null
  const used = FLOW_STAGES.filter(st => months.some(m => (m.stageShares?.find(s => s.stage === st)?.share ?? 0) > 0))
  // 「어디서 시간이 걸렸나」와 같은 가로 묶음 막대를 달마다 한 줄 — 같은 단계색·같은 묶음(대기+진행)·같은 툴팁
  return (
    <Card>
      <SectionTitle>{tr('stageTrendTitle', { n: months.length })}</SectionTitle>
      <div className="flex flex-col gap-1">
        {months.map(m => (
          <div key={m.start} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 min-h-7">
            <span className="text-xs font-bold text-ive-text-secondary tabular-nums">{tr('monthShort', { m: Number(m.label.slice(5, 7)) })}</span>
            {m.stageShares?.length ? (
              <StackedHBar
                hovered={hov?.stage ?? null}
                showTip={hov?.month === m.start}
                onHover={k => setHov(k ? { stage: k, month: m.start } : null)}
                segments={used.map(st => {
                  const v = m.stageShares!.find(s => s.stage === st)?.share ?? 0
                  return { key: st, value: v, label: tr(`flow.${st}`), valueText: pct(v), className: STAGE_BAR[st], group: stageGroup(st) }
                })}
              />
            ) : (
              <span className="text-xs font-bold text-ive-text-muted">{tr('noRecord')}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
        {used.map(st => (
          <span key={st} {...hoverHandlers(st, k => setHov(k ? { stage: k, month: null } : null))}
            className={`inline-flex items-center gap-1 cursor-default transition-opacity ${hov && hov.stage !== st ? 'opacity-50' : ''}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_BAR[st]}`} />{tr(`flow.${st}`)}
          </span>
        ))}
      </div>
    </Card>
  )
}

/** 살펴볼 위험 — 메일(riskLines)과 같은 항목·같은 순서: 한 사람 의존(역할마다) → 반려율 상승 → 7일 넘은 일 */
export function RiskSection({ risks, held, tr }: { risks: Risks; held: Held; tr: Tr }) {
  const items: ReactNode[] = []
  for (const c of risks.concentrations) {
    items.push(<RiskCard key={`c-${c.role}`} icon="fa-triangle-exclamation" title={tr('riskConcentration', { role: tr(`role.${c.role}`), name: c.name, pct: pct(c.share) })} detail={tr('riskConcentrationDetail', { n: c.count, total: c.total })} />)
  }
  if (risks.rejectRate != null && risks.prevRejectRate != null && risks.rejectRate - risks.prevRejectRate >= 0.03) {
    items.push(<RiskCard key="r" icon="fa-triangle-exclamation" title={tr('riskReject', { v: pct(risks.rejectRate), p: pct(risks.prevRejectRate) })}
      detail={risks.rejectTopProject ? tr('riskRejectTop', { name: risks.rejectTopProject.name, v: pct(risks.rejectTopProject.rate) }) : ''} />)
  }
  if (held.over7) {
    items.push(<RiskCard key="a" icon="fa-clock" title={tr('riskAged', { n: held.over7 })}
      detail={held.prevOver7 != null ? tr('riskAgedPrev', { n: held.prevOver7 }) : ''} />)
  }
  // 다른 칸과 같은 짜임 — 카드 안에 제목, 항목은 그 안의 하위 상자(「지금 손쓸 것」과 같은 모양)
  return (
    <Card>
      <SectionTitle>{items.length ? tr('riskTitleN', { n: items.length }) : tr('riskTitle')}</SectionTitle>
      {items.length ? <div className="flex flex-col gap-2">{items}</div> : (
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-circle-check text-sm text-ive-cyan" />
          <span className="text-sm font-bold text-ive-text">{tr('riskNone')}</span>
        </div>
      )}
      {risks.rejectRate != null && (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('rejectRateLine', { v: pct(risks.rejectRate), p: risks.prevRejectRate != null ? pct(risks.prevRejectRate) : '—' })}</span>
      )}
    </Card>
  )
}

function RiskCard({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <div className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3 flex gap-2">
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

function GradeBar({ grades, tr }: { grades: Record<Grade, number>; tr: Tr }) {
  const total = GRADES.reduce((s, g) => s + grades[g], 0)
  return (
    <StackedHBar gapClass="gap-px"
      segments={GRADES.map(g => ({ key: g, value: grades[g], label: tr(`grade.${g}`), valueText: `${grades[g]} · ${pct(total ? grades[g] / total : 0)}`, className: GRADE_STYLE[g] }))} />
  )
}

export function EvaluationSection({ ev, avatars, tr }: { ev: Evaluation; avatars?: Record<string, string>; tr: Tr }) {
  const groups = ev.groups.filter(g => g.n > 0)
  return (
    <Card>
      <SectionTitle right={tr('evalWindow', { from: ev.windowStart.slice(5).replace('-', '.'), to: ev.windowEnd.slice(5).replace('-', '.') })}>{tr('evalTitle')}</SectionTitle>
      <span className="text-xs font-bold text-ive-text-muted leading-relaxed">{tr('evalIntro')}</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
        {GRADES.map(g => <span key={g} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${GRADE_STYLE[g]}`} />{tr(`grade.${g}`)}</span>)}
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
                  <GradeBar grades={g.grades} tr={tr} />
                </div>
              ))}
            </div>
          )}
          {ev.workers.length > 0 && <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-ive-text-secondary">{tr('evalWorkers')}</span>
            {ev.workers.map(w => (
              <div key={w.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2 text-sm font-bold">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {w.kind === 'person' && <PersonFace personKey={w.key} avatars={avatars} />}
                    <span className="truncate text-ive-text">{w.modelUnknown ? tr('modelUnknown', { cli: w.name }) : w.name}</span>
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary shrink-0">{tr(`evalKind.${w.kind}`)}</span>
                  </span>
                  {w.state === 'ok'
                    ? <span className="text-ive-text tabular-nums shrink-0">{tr('passOf', { v: pct(w.passRate), n: w.n })}</span>
                    : <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary shrink-0">{tr('collecting', { n: w.n, min: MIN_SAMPLE })}</span>}
                </div>
                {w.state === 'ok' ? <GradeBar grades={w.grades} tr={tr} /> : <div className="h-2.5 rounded-full border border-dashed border-ive-border" />}
              </div>
            ))}
          </div>}
          {ev.comparisons.map(c => (
            <div key={`${c.aKey}|${c.bKey}`} className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3 flex flex-col gap-1">
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
                  <span className="flex items-center gap-1.5 min-w-0">
                    {/* 모델(m:) 줄은 사람이 아니다 — 사람 줄에만 아바타 */}
                    {!v.key.startsWith('m:') && <PersonFace personKey={v.key} avatars={avatars} />}
                    <span className="text-ive-text truncate">{v.modelUnknown ? tr('modelUnknown', { cli: v.name }) : v.name}</span>
                  </span>
                  {v.state === 'ok'
                    ? <span className="text-ive-text tabular-nums">{tr('verifierLine', { v: pct(v.rate), n: v.approved, r: v.laterRejected })}</span>
                    : <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary">{tr('collecting', { n: v.approved, min: MIN_SAMPLE })}</span>}
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
