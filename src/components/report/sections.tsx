'use client'

/**
 * 보고서 화면 섹션 — 보고서 모델(lib/report-model)을 그리기만 한다. 숫자를 여기서 계산하지 않는다.
 * 디자인 가이드: 숫자는 흰색 톤, 색은 상태(실패=빨강·행동 필요=주황·대기/정상=시안)와 증감에만.
 */
import { useState, type ReactNode } from 'react'
import type {
  ReportModel, Held, ActionItems, HeldStage, ProjectRow, Done, Cost, CompletedItem, PersonRole,
} from '@/lib/report-model/types'
import { fmtHours, pct, deltaTone, toneClass, type Tr } from './format'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg p-4 flex flex-col gap-3 ${className}`}>{children}</section>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-bold text-ive-text-secondary">{children}</span>
      {right != null && <span className="text-xs font-bold text-ive-text-muted">{right}</span>}
    </div>
  )
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className={strong ? 'font-bold text-ive-text' : 'font-bold text-ive-text-secondary'}>{label}</span>
      <span className="font-bold text-ive-text tabular-nums text-right">{value}</span>
    </div>
  )
}

function Delta({ cur, prev, goodWhenUp, text }: { cur: number; prev: number | null | undefined; goodWhenUp: boolean; text: string }) {
  if (prev == null) return null
  const d = cur - prev
  const tone = deltaTone(cur, prev, goodWhenUp)
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${toneClass[tone]}`}>
      {d !== 0 && <i className={`fa-solid ${d > 0 ? 'fa-arrow-up' : 'fa-arrow-down'}`} />}
      {d === 0 ? '±0' : Math.abs(d).toLocaleString()} · {text}
    </span>
  )
}

const STAGE_BADGE: Record<HeldStage, string> = {
  waiting: 'bg-ive-cyan/20 text-ive-cyan',
  dev: 'bg-ive-amber/20 text-ive-amber',
  dev_fail: 'bg-ive-red/20 text-ive-red',
  verify_waiting: 'bg-ive-amber/20 text-ive-amber',
  verifying: 'bg-ive-amber/20 text-ive-amber',
  confirm_waiting: 'bg-ive-amber/20 text-ive-amber',
  confirming: 'bg-ive-amber/20 text-ive-amber',
}
const STAGE_BAR: Record<HeldStage, string> = {
  waiting: 'bg-ive-cyan/30', dev: 'bg-ive-cyan/90', dev_fail: 'bg-ive-red',
  verify_waiting: 'bg-ive-cyan/70', verifying: 'bg-ive-cyan/60', confirm_waiting: 'bg-ive-cyan/45', confirming: 'bg-ive-cyan/40',
}

// ─── ① 지금 안고 있는 일 ───

export function HeldCard({ held, tr, prevLabel, tracking }: { held: Held; tr: Tr; prevLabel: string; tracking: string | null }) {
  const title = held.live ? tr('heldNow') : tr('heldEnd')
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {held.end == null ? (
        <div className="flex flex-col gap-1">
          <span className="text-base font-bold text-ive-text-secondary">{tr('heldNoRecord')}</span>
          <span className="text-xs font-bold text-ive-text-muted">{tracking ? tr('heldTrackingSince', { date: tracking }) : tr('heldTrackingSoon')}</span>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-4xl font-bold text-ive-text tabular-nums leading-none">{held.end.toLocaleString()}<span className="text-lg ml-0.5">{tr('countUnit')}</span></span>
            {held.start != null && <Delta cur={held.end} prev={held.start} goodWhenUp={false} text={tr('vsPrevEnd', { label: prevLabel, n: held.start })} />}
          </div>
          {held.live && (
            <div className="text-sm font-bold text-ive-text-secondary">
              {held.drainDays != null ? tr('drainDays', { d: held.drainDays < 1 ? '1' : Math.round(held.drainDays) }) : tr('drainUnknown')}
              {' · '}
              {held.over7 ? tr('over7', { n: held.over7 }) : tr('over7None')}
            </div>
          )}
        </>
      )}
      <div className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3 flex items-center justify-between text-center">
        {[
          { v: held.start, l: tr('eqStart', { label: prevLabel }) },
          { op: '+' }, { v: held.inflow, l: tr('eqInflow') },
          { op: '−' }, { v: held.completed, l: tr('eqCompleted') },
          { op: '=' }, { v: held.end, l: held.live ? tr('eqNow') : tr('eqEnd') },
        ].map((x, i) => 'op' in x
          ? <span key={i} className="text-sm font-bold text-ive-text-muted">{x.op}</span>
          : (
            <div key={i} className="flex flex-col">
              <span className="text-base font-bold text-ive-text tabular-nums">{x.v == null ? '—' : x.v.toLocaleString()}</span>
              <span className="text-xs font-bold text-ive-text-muted">{x.l}</span>
            </div>
          ))}
      </div>
      {held.gap != null && held.gap !== 0 && (
        <span className="text-xs font-bold text-ive-text-muted">{tr('eqGap', { n: Math.abs(held.gap) })}</span>
      )}
    </Card>
  )
}

// ─── ② 지금 손쓸 것 ───

function ActionCard({ tone, icon, title, children }: { tone: 'red' | 'amber'; icon: string; title: string; children: ReactNode }) {
  return (
    <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 flex gap-2">
      <i className={`fa-solid ${icon} text-sm mt-0.5 ${tone === 'red' ? 'text-ive-red' : 'text-ive-amber'}`} />
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <span className="text-sm font-bold text-ive-text">{title}</span>
        {children}
      </div>
    </div>
  )
}

function IssueLine({ text, right, href }: { text: string; right: string; href: string }) {
  return (
    <a href={href} className="flex items-center justify-between gap-2 text-xs font-bold text-ive-text-secondary hover:text-ive-text">
      <span className="truncate">{text}</span>
      <span className="tabular-nums shrink-0">{right}</span>
    </a>
  )
}

const issueHref = (projectId: string, iid: number) => `/issues/${projectId}/${iid}`

export function ActionCards({ actions, tr }: { actions: ActionItems; tr: Tr }) {
  const items: ReactNode[] = []
  if (actions.failed.length > 0) {
    items.push(
      <ActionCard key="f" tone="red" icon="fa-circle-xmark" title={tr('actFailed', { n: actions.failed.length })}>
        {actions.failed.slice(0, 3).map(i => <IssueLine key={`${i.projectId}:${i.iid}`} href={issueHref(i.projectId, i.iid)} text={`#${i.iid} ${i.title ?? ''}`} right={tr('elapsed', { t: fmtHours(tr, i.hours) })} />)}
        {actions.failed.length > 3 && <span className="text-xs font-bold text-ive-text-muted">{tr('andMore', { n: actions.failed.length - 3 })}</span>}
      </ActionCard>,
    )
  }
  if (actions.aged.length > 0) {
    items.push(
      <ActionCard key="a" tone="amber" icon="fa-clock" title={tr('actAged', { n: actions.aged.length })}>
        {actions.aged.slice(0, 3).map(i => <IssueLine key={`${i.projectId}:${i.iid}`} href={issueHref(i.projectId, i.iid)} text={`#${i.iid} ${i.title ?? ''}${i.personName ? ` · ${i.personName}` : ''}`} right={fmtHours(tr, i.ageHours)} />)}
        {actions.aged.length > 3 && <span className="text-xs font-bold text-ive-text-muted">{tr('andMore', { n: actions.aged.length - 3 })}</span>}
      </ActionCard>,
    )
  }
  if (actions.concentration) {
    const c = actions.concentration
    items.push(
      <ActionCard key="c" tone="amber" icon="fa-triangle-exclamation" title={tr('actConcentration', { name: c.name })}>
        <span className="text-xs font-bold text-ive-text-secondary">{tr('actConcentrationDetail', { role: tr(`role.${c.role}`), people: c.roleHolders, total: c.roleTotal, n: c.count, t: fmtHours(tr, c.oldestHours) })}</span>
      </ActionCard>,
    )
  }
  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs font-bold text-ive-text-secondary pt-1">{items.length > 0 ? tr('actTitleN', { n: items.length }) : tr('actTitle')}</span>
      {items.length > 0 ? items : (
        <div className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 flex items-center gap-2">
          <i className="fa-solid fa-circle-check text-sm text-ive-cyan" />
          <span className="text-sm font-bold text-ive-text">{tr('actNone')}</span>
        </div>
      )}
    </section>
  )
}

// ─── ③ 어디에 있나 ───

export function WhereSection({ held, tr }: { held: Held; tr: Tr }) {
  if (!held.byStage || !held.end) return null
  const rows = held.byStage.filter(s => s.count > 0)
  return (
    <Card>
      <SectionTitle right={tr('countN', { n: held.end })}>{tr('whereTitle')}</SectionTitle>
      <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5 bg-ive-bg">
        {rows.map(s => <div key={s.stage} className={STAGE_BAR[s.stage]} style={{ width: `${(s.count / held.end!) * 100}%` }} />)}
      </div>
      <div className="flex flex-col">
        {rows.map((s, i) => (
          <div key={s.stage} className={`flex items-center justify-between gap-2 min-h-10 ${i < rows.length - 1 ? 'border-b border-ive-border-dark' : ''}`}>
            <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${STAGE_BADGE[s.stage]}`}>{tr(`stage.${s.stage}`)}</span>
            <span className="flex gap-4 text-sm font-bold tabular-nums">
              <span className="text-ive-text">{tr('countN', { n: s.count })}</span>
              <span className="text-ive-text-secondary w-24 text-right">{tr('oldest', { t: fmtHours(tr, s.oldestHours) })}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── ④ 누구 손에 있나 ───

export function PeopleSection({ held, tr }: { held: Held; tr: Tr }) {
  if (!held.people) return null
  const people = held.people
  const max = Math.max(1, ...people.map(p => p.count))
  const notPeople = (held.end ?? 0) - (held.peopleTotal ?? 0)
  return (
    <Card>
      <SectionTitle right={tr('peopleRight', { n: held.peopleTotal ?? 0, p: new Set(people.map(p => p.key)).size })}>{tr('peopleTitle')}</SectionTitle>
      {people.length === 0 ? (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('peopleNone')}</span>
      ) : (
        <div className="flex flex-col gap-2.5">
          {people.map(p => (
            <div key={`${p.key}|${p.role}`} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-sm font-bold">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate text-ive-text">{p.name}</span>
                  <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary shrink-0">{tr(`role.${p.role}`)}</span>
                </span>
                <span className="tabular-nums text-ive-text shrink-0">{tr('personCount', { n: p.count, t: fmtHours(tr, p.oldestHours) })}</span>
              </div>
              <div className="h-1 rounded-full bg-ive-bg overflow-hidden"><div className="h-full rounded-full bg-ive-cyan" style={{ width: `${(p.count / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      {notPeople > 0 && <span className="text-xs font-bold text-ive-text-muted">{tr('peopleExcluded', { n: notPeople })}</span>}
    </Card>
  )
}

// ─── ⑤ 사람 시간이 쓰인 곳 ───

const SHARE_OPACITY = ['bg-ive-cyan', 'bg-ive-cyan/60', 'bg-ive-cyan/35', 'bg-ive-cyan/20']

export function ProjectsSection({ projects, cost, tr, prevLabel }: { projects: ProjectRow[]; cost: Cost; tr: Tr; prevLabel: string }) {
  if (projects.length === 0) return null
  const withHours = projects.filter(p => p.humanHours > 0)
  const top = withHours.slice(0, 3)
  const rest = withHours.slice(3)
  const restShare = rest.reduce((s, p) => s + p.share, 0)
  const shareParts = [...top.map(p => ({ name: p.name, share: p.share })), ...(rest.length ? [{ name: tr('others'), share: restShare }] : [])]
  // 지난 기간 대비 비중 변화가 가장 큰 프로젝트 한 줄
  const moved = withHours.filter(p => p.prevShare != null).map(p => ({ p, d: p.share - (p.prevShare ?? 0) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0]
  return (
    <Card>
      <SectionTitle right={cost.humanHours > 0 ? tr('hoursRight', { h: Math.round(cost.humanHours) }) : undefined}>{tr('projectsTitle')}</SectionTitle>
      {withHours.length > 0 ? (
        <>
          <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-ive-bg">
            {shareParts.map((s, i) => <div key={s.name} className={SHARE_OPACITY[Math.min(i, 3)]} style={{ width: `${s.share * 100}%` }} />)}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
            {shareParts.map((s, i) => (
              <span key={s.name} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${SHARE_OPACITY[Math.min(i, 3)]}`} />{s.name} {pct(s.share)}</span>
            ))}
          </div>
          {moved && Math.abs(moved.d) >= 0.05 && (
            <span className="text-xs font-bold text-ive-text-muted">{tr(moved.d > 0 ? 'shareUp' : 'shareDown', { name: moved.p.name, label: prevLabel, pp: Math.round(Math.abs(moved.d) * 100) })}</span>
          )}
        </>
      ) : (
        <span className="text-xs font-bold text-ive-text-muted">{tr('hoursNone')}</span>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-bold">
          <thead>
            <tr className="text-ive-text-muted">
              <th className="text-left py-1.5 pr-2">{tr('colProject')}</th>
              <th className="text-right py-1.5 px-1">{tr('colHours')}</th>
              <th className="text-right py-1.5 px-1">{tr('colDone')}</th>
              <th className="text-right py-1.5 pl-1">{tr('colHeld')}</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-t border-ive-border-dark">
                <td className="text-left py-1.5 pr-2 text-ive-text truncate max-w-[9rem]">{p.name}</td>
                <td className="text-right py-1.5 px-1 tabular-nums text-ive-text">{p.humanHours > 0 ? `${Math.round(p.humanHours)}h · ${pct(p.share)}` : '—'}</td>
                <td className="text-right py-1.5 px-1 tabular-nums text-ive-text">{p.completed} <MiniDelta cur={p.completed} prev={p.prevCompleted} goodWhenUp /></td>
                <td className="text-right py-1.5 pl-1 tabular-nums text-ive-text">{p.held == null ? '—' : <>{p.held} <MiniDelta cur={p.held} prev={p.prevHeld} goodWhenUp={false} /></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="text-xs font-bold text-ive-text-muted">{tr('projectsNote', { label: prevLabel })}</span>
    </Card>
  )
}

function MiniDelta({ cur, prev, goodWhenUp }: { cur: number; prev: number | null | undefined; goodWhenUp: boolean }) {
  if (prev == null || cur === prev) return null
  const up = cur > prev
  const good = up === goodWhenUp
  return <span className={good ? 'text-ive-cyan' : 'text-ive-red'}>{up ? '▲' : '▼'}{Math.abs(cur - prev)}</span>
}

// ─── ⑥ 끝낸 일 ───

export function DoneSection({ done, tr, prevLabel }: { done: Done; tr: Tr; prevLabel: string }) {
  return (
    <Card>
      <SectionTitle right={<Delta cur={done.total} prev={done.prevTotal} goodWhenUp text={tr('vsPrev', { label: prevLabel, n: done.prevTotal })} />}>{tr('doneTitle')}</SectionTitle>
      <span className="text-3xl font-bold text-ive-text tabular-nums leading-none">{done.total.toLocaleString()}<span className="text-base ml-0.5">{tr('countUnit')}</span></span>
      <div className="flex flex-col gap-1.5">
        <Row label={tr('form.agent')} value={tr('countN', { n: done.byForm.agent })} />
        <Row label={tr('form.human')} value={tr('countN', { n: done.byForm.human })} />
        <Row label={tr('form.direct')} value={tr('countN', { n: done.byForm.direct })} />
      </div>
      <div className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3 flex flex-col gap-1.5">
        <Row label={tr('leadMedian')} value={done.leadMedianH == null ? <NoRecord tr={tr} /> : fmtHours(tr, done.leadMedianH)} />
        <Row label={tr('leadP90')} value={done.leadP90H == null ? <NoRecord tr={tr} /> : tr('orMore', { t: fmtHours(tr, done.leadP90H) })} />
        <Row label={tr('humanWait')} value={done.humanWaitShare == null ? <NoRecord tr={tr} /> : pct(done.humanWaitShare)} />
        <Row
          label={tr('firstPass')}
          value={done.firstPass == null ? tr('notApplicable') : (
            <>{pct(done.firstPass)}{done.prevFirstPass != null && <span className="text-ive-text-secondary"> · {tr('prevShort', { label: prevLabel, v: pct(done.prevFirstPass) })}</span>}</>
          )}
        />
      </div>
      {done.leadMedianH == null && done.total > 0 && <span className="text-xs font-bold text-ive-text-muted">{tr('leadNoRecordHint')}</span>}
    </Card>
  )
}

function NoRecord({ tr }: { tr: Tr }) {
  return <span className="text-ive-text-secondary">{tr('noRecord')}</span>
}

// ─── ⑧ 투입과 비용 ───

export function CostSection({ cost, tr, fmtMoney, prevLabel }: { cost: Cost; tr: Tr; fmtMoney: (usd: number) => string; prevLabel: string }) {
  return (
    <Card>
      <SectionTitle>{tr('costTitle')}</SectionTitle>
      <div className="flex flex-col gap-1.5">
        <Row label={tr('humanHours')} value={cost.humanHours > 0 ? tr('hoursPeople', { h: Math.round(cost.humanHours), p: cost.people }) : <NoRecord tr={tr} />} />
        <Row label={tr('humanCost')} value={cost.humanRateSet ? fmtMoney(cost.humanCost) : <span className="text-ive-text-secondary">{tr('humanRateUnset')}</span>} />
        <Row label={tr('aiActual')} value={fmtMoney(cost.aiActual)} />
        <div className="border-t border-ive-border-dark pt-1.5">
          <Row strong label={tr('perCompleted')} value={cost.perCompleted == null ? '—' : (
            <>{fmtMoney(cost.perCompleted)}{cost.prevPerCompleted != null && (() => {
              const tone = deltaTone(cost.perCompleted, cost.prevPerCompleted, false)
              const up = cost.perCompleted > cost.prevPerCompleted
              return (
                <span className="ml-1 text-xs text-ive-text-secondary">
                  {tone !== 'neutral' && <i className={`fa-solid ${up ? 'fa-arrow-up' : 'fa-arrow-down'} mr-0.5 ${toneClass[tone]}`} />}
                  {tr('prevShort', { label: prevLabel, v: fmtMoney(cost.prevPerCompleted) })}
                </span>
              )
            })()}</>
          )} />
        </div>
      </div>
      <span className="text-xs font-bold text-ive-text-muted">{tr('notionalNote', { v: fmtMoney(cost.aiNotional) })}</span>
    </Card>
  )
}

// ─── 상세: 완료한 일 ───

export function CompletedList({ items, tr }: { items: CompletedItem[]; tr: Tr }) {
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(30)
  if (items.length === 0) return null
  return (
    <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg">
      <button onClick={() => setOpen(o => !o)} className="w-full min-h-12 px-4 flex items-center justify-between text-sm font-bold text-ive-text">
        <span>{tr('completedList')}</span>
        <span className="flex items-center gap-2 text-xs text-ive-text-muted">{tr('countN', { n: items.length })}<i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} /></span>
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-col">
          {items.slice(0, limit).map(i => (
            <a key={`${i.projectId}:${i.iid}`} href={issueHref(i.projectId, i.iid)} className="flex items-center justify-between gap-2 py-2 border-t border-ive-border-dark text-xs font-bold hover:bg-white/[0.03]">
              <span className="flex flex-col min-w-0">
                <span className="text-ive-text truncate">#{i.iid} {i.title ?? ''}</span>
                <span className="text-ive-text-muted truncate">{i.projectName} · {tr(`form.${i.form}`)}</span>
              </span>
              <span className="text-ive-text-secondary tabular-nums shrink-0">{i.leadH != null ? fmtHours(tr, i.leadH) : i.completedAt.slice(5, 10)}</span>
            </a>
          ))}
          {items.length > limit && (
            <button onClick={() => setLimit(l => l + 30)} className="mt-2 px-3 py-2 rounded-lg bg-white/5 border border-ive-border-subtle text-sm font-bold text-ive-text-muted">{tr('showMore')}</button>
          )}
        </div>
      )}
    </section>
  )
}

export type { ReportModel, PersonRole }
