'use client'

/**
 * 보고서 화면 섹션 — 보고서 모델(lib/report-model)을 그리기만 한다. 숫자를 여기서 계산하지 않는다.
 * 디자인 가이드: 숫자는 흰색 톤, 색은 상태(실패=빨강·행동 필요=주황·대기/정상=시안)와 증감에만.
 */
import { useState, type ReactNode } from 'react'
import type {
  Held, ActionItems, HeldStage, HeldIssue, ProjectRow, Done, Cost, CompletedItem, FlowStage, StageTime, StageWork,
} from '@/lib/report-model/types'
import { fmtHours, pct, deltaTone, toneClass, agedCount, projectSwatchStyles, OTHERS_ID, PERSON_COLORS, type Tr } from './format'
import AgentAvatar from '@/components/agent/AgentAvatar'
import CountBump from '@/components/ui/CountBump'
import { StackedHBar, hoverHandlers } from './hbar'
import { ISSUE_STAGE_STYLE } from '@/lib/active-work'
import { HELD_STAGES } from '@/lib/report-model/types'

/** 보고서의 사람 줄 아바타 — 사람 키(u:<id>)면 그 사용자 아바타, 이름만 아는 사람(n:)은 기본 사람 아이콘 */
export function PersonFace({ personKey, avatars }: { personKey: string; avatars?: Record<string, string> }) {
  const userId = personKey.startsWith('u:') ? personKey.slice(2) : null
  return <AgentAvatar avatar={avatars?.[personKey] || 'person'} userId={userId} size="xs" />
}

export function Card({ children, highlight = false }: { children: ReactNode; highlight?: boolean }) {
  return <section className={`bg-ive-bg-card border ${highlight ? 'border-ive-cyan/50' : 'border-ive-border-subtle'} rounded-lg p-4 flex flex-col gap-3`}>{children}</section>
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 flex-wrap">
      <span className="text-base font-bold text-ive-text shrink-0">{children}</span>
      {right != null && <span className="text-xs font-bold text-ive-text-muted text-right">{right}</span>}
    </div>
  )
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className={strong ? 'font-bold text-ive-text' : 'font-bold text-ive-text-secondary'}>{label}</span>
      {/* 자동 갱신으로 값이 바뀌면 한 번 튄다(글자 값만 — 요소 값은 매번 새로 만들어져 비교할 수 없다) */}
      <span className="font-bold text-ive-text tabular-nums text-right">{typeof value === 'string' || typeof value === 'number' ? <CountBump value={value} /> : value}</span>
    </div>
  )
}

function Delta({ cur, prev, goodWhenUp, text }: { cur: number; prev: number | null | undefined; goodWhenUp: boolean; text: string }) {
  if (prev == null) return null
  const d = cur - prev
  const tone = deltaTone(cur, prev, goodWhenUp)
  // 숫자에는 색을 쓰지 않는다 — 증감 방향 화살표에만 의미색
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-ive-text-secondary">
      {d !== 0 && <i className={`fa-solid ${d > 0 ? 'fa-arrow-up' : 'fa-arrow-down'} ${toneClass[tone]}`} />}
      {d === 0 ? '±0' : Math.abs(d).toLocaleString()} · {text}
    </span>
  )
}

// 단계 배지·막대 색 = 앱 전체 단계 색(lib/active-work ISSUE_STAGE_STYLE) — 진행은 단계색, 그 단계 대기는 회색빛
const STAGE_BADGE = Object.fromEntries(HELD_STAGES.map(st => [st, `${ISSUE_STAGE_STYLE[st].bg} ${ISSUE_STAGE_STYLE[st].text}`])) as Record<HeldStage, string>
// 막대 조각 색 = 각 줄 앞 견본 점 색(범례 1:1). 조각마다 묶음 단계색 테두리 — 대기+진행 묶음 전체가 한 테두리로 보이고 그 안의 빈 칸이 대기
export const STAGE_BAR = Object.fromEntries(HELD_STAGES.map(st => [st, `${ISSUE_STAGE_STYLE[st].fill} ${ISSUE_STAGE_STYLE[st].outline}`.trim()])) as Record<HeldStage, string>

// ─── ① 지금 안고 있는 일 ───

export function HeldCard({ held, tr, prevLabel, tracking }: { held: Held; tr: Tr; prevLabel: string; tracking: string | null }) {
  const title = held.live ? tr('heldNow') : tr('heldEnd')
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {held.end == null ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-ive-text-secondary">{tr('heldNoRecord')}</span>
          <span className="text-xs font-bold text-ive-text-muted">{tracking ? tr('heldTrackingSince', { date: tracking }) : tr('heldTrackingSoon')}</span>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-bold text-ive-text tabular-nums leading-none"><CountBump value={held.end}>{held.end.toLocaleString()}</CountBump><span className="text-base ml-0.5">{tr('countUnit')}</span></span>
            {held.start != null && <Delta cur={held.end} prev={held.start} goodWhenUp={false} text={tr('vsPrevEnd', { label: prevLabel, n: held.start })} />}
          </div>
          {held.live && (
            <div className="text-sm font-bold text-ive-text-secondary">
              {/* 보유가 0이면 소진 일수도 0 — 「1일 미만이면 1일」로 올리면 「0건인데 1일치」가 된다 */}
              {held.end === 0 ? tr('drainNone') : held.drainDays != null ? tr('drainDays', { d: held.drainDays < 1 ? 1 : Math.round(held.drainDays) }) : tr('drainUnknown')}
              {' · '}
              {held.over7 ? tr('over7', { n: held.over7 }) : tr('over7None')}
              {held.over7 != null && <MiniDelta cur={held.over7} prev={held.prevOver7} goodWhenUp={false} className="ml-1" />}
            </div>
          )}
        </>
      )}
      {/* 보유 식 — 지난 기간 말 + 유입 − (완료 + 빠짐) = 지금. 지난 기간 말 기록이 없으면(도입 첫 주 등) 이력으로 다시 센 값 */}
      {held.start != null && (() => {
        // 연산자·괄호는 숫자와 같은 줄에 — 아래에 이름 줄 높이만큼 빈 칸을 둬 숫자 줄에 맞춘다
        const op = (o: string) => (
          <div className="flex flex-col shrink-0" aria-hidden="true">
            <span className="text-sm sm:text-base font-bold text-ive-text-muted">{o}</span>
            <span className="text-[10px] sm:text-xs invisible">·</span>
          </div>
        )
        const term = (v: number | null, l: string) => (
          <div className="flex flex-col min-w-0">
            <span className="text-sm sm:text-base font-bold text-ive-text tabular-nums">{v == null ? '—' : v.toLocaleString()}</span>
            <span className="text-[10px] sm:text-xs font-bold text-ive-text-muted truncate">{l}</span>
          </div>
        )
        const dropped = held.gap != null && held.gap > 0
        return (
          <div className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-2.5 sm:p-3 flex items-center justify-between text-center gap-1 sm:gap-2">
            {term(held.start, tr('eqStart', { label: prevLabel }))}
            {op('+')}
            {term(held.inflow, tr('eqInflow'))}
            {op('−')}
            {/* 나가는 것(완료·빠짐)은 괄호로 한 덩어리 — 괄호가 숫자에 붙게 안쪽은 좁은 간격 */}
            {dropped ? (
              <div className="flex items-center gap-0.5">
                {op('(')}{term(held.completed, tr('eqCompleted'))}{op('+')}{term(held.gap, tr('eqDropped'))}{op(')')}
              </div>
            ) : term(held.completed, tr('eqCompleted'))}
            {op('=')}
            {term(held.end, held.live ? tr('eqNow') : tr('eqEnd'))}
          </div>
        )
      })()}
      {held.gap != null && held.gap > 0 && (
        <span className="text-xs font-bold text-ive-text-muted">{tr('eqDroppedNote')}</span>
      )}
      {held.gap != null && held.gap < 0 && (
        <span className="text-xs font-bold text-ive-text-muted">{tr('eqGap', { n: Math.abs(held.gap) })}</span>
      )}
      {(held.startDerived || held.endDerived) && (
        <span className="text-xs font-bold text-ive-text-muted">{tr('eqDerived', { label: prevLabel })}</span>
      )}
    </Card>
  )
}

// ─── ② 지금 손쓸 것 ───

/** 손쓸 것 한 가지 — 칸(Card) 안의 하위 상자(보유 식 상자와 같은 모양) */
function ActionCard({ tone, icon, title, children }: { tone: 'red' | 'amber'; icon: string; title: string; children: ReactNode }) {
  return (
    <div className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3 flex gap-2">
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
    <a href={href} className="flex items-center justify-between gap-2 text-sm font-bold text-ive-text-secondary hover:text-ive-text">
      <span className="truncate">{text}</span>
      <span className="tabular-nums shrink-0">{right}</span>
    </a>
  )
}

const issueHref = (projectId: string, iid: number) => `/issues/${projectId}/${iid}`
/** UTC 시각 → KST 월-일 (보고서 기간은 KST 기준) */
const kstMonthDay = (iso: string) => {
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime()
  return Number.isFinite(t) ? new Date(t + 9 * 3_600_000).toISOString().slice(5, 10) : ''
}

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
  for (const c of actions.concentrations) {
    items.push(
      <ActionCard key={`c-${c.role}`} tone="amber" icon="fa-triangle-exclamation" title={tr('actConcentration', { name: c.name })}>
        <span className="text-xs font-bold text-ive-text-secondary">{tr('actConcentrationDetail', { role: tr(`role.${c.role}`), people: c.roleHolders, total: c.roleTotal, n: c.count, t: fmtHours(tr, c.oldestHours) })}</span>
      </ActionCard>,
    )
  }
  // 다른 칸과 같은 짜임 — 카드 안에 제목, 항목은 그 안의 하위 상자(종전엔 이 칸만 제목이 카드 밖에 있었다)
  return (
    <Card>
      <SectionTitle>{items.length > 0 ? tr('actTitleN', { n: items.length }) : tr('actTitle')}</SectionTitle>
      {items.length > 0 ? <div className="flex flex-col gap-2">{items}</div> : (
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-circle-check text-sm text-ive-cyan" />
          <span className="text-sm font-bold text-ive-text">{tr('actNone')}</span>
        </div>
      )}
    </Card>
  )
}

/** 막대 조각 ↔ 아래 줄 강조 — 줄에 올리면 조각이, 조각에 올리면 줄이 함께 밝아진다 */
/** 단계 → 막대 묶음(처리대기+처리+처리 실패 · 검증대기+검증 · 확인대기+확인) — 묶음마다 둥글게 시작·끝 */
export const stageGroup = (st: string) => st.startsWith('verify') ? 'verify' : st.startsWith('confirm') ? 'confirm' : 'process'

const rowHover = (on: boolean) => `-mx-2 px-2 rounded-lg transition-colors ${on ? 'bg-white/[0.05]' : ''}`

// ─── ③ 어디에 있나 ───

export function WhereSection({ held, tr }: { held: Held; tr: Tr }) {
  const [hov, setHov] = useState<string | null>(null)
  if (!held.byStage || !held.end) return null
  const rows = held.byStage.filter(s => s.count > 0)
  return (
    <Card>
      <SectionTitle right={tr('countN', { n: held.end })}>{tr('whereTitle')}</SectionTitle>
      <StackedHBar hovered={hov} onHover={setHov}
        segments={rows.map(s => ({ key: s.stage, value: s.count, label: tr(`stage.${s.stage}`), valueText: tr('countN', { n: s.count }), className: STAGE_BAR[s.stage], group: stageGroup(s.stage) }))} />
      <div className="flex flex-col">
        {rows.map((s, i) => (
          <div key={s.stage} {...hoverHandlers(s.stage, setHov)}
            className={`flex items-center justify-between gap-2 min-h-10 ${rowHover(hov === s.stage)} ${i < rows.length - 1 ? 'border-b border-ive-border-dark' : ''}`}>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${STAGE_BAR[s.stage]}`} aria-hidden="true" />
              <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${STAGE_BADGE[s.stage]}`}>{tr(`stage.${s.stage}`)}</span>
            </span>
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

// ─── 어디서 시간이 걸렸나 ───

const WORK_STAGES: FlowStage[] = ['dev', 'verifying', 'confirming']

/** 끝낸 일의 접수 → 완료를 단계별로 — 막대·줄 색은 「어디에 있나」와 같은 단계색(범례 1:1) */
export function StageTimeSection({ st, tr, prevLabel }: { st: StageTime | undefined; tr: Tr; prevLabel: string }) {
  const [hov, setHov] = useState<string | null>(null)
  if (!st) return null
  const rows = st.stages.filter(s => s.share > 0)
  const prevOf = (stage: FlowStage) => st.prevStages?.find(p => p.stage === stage)?.avgH ?? null
  const work = st.stages.filter(s => WORK_STAGES.includes(s.stage)).reduce((sum, s) => sum + s.share, 0)
  const longest = rows.reduce<StageTime['stages'][number] | null>((m, s) => (!m || s.share > m.share ? s : m), null)
  const prevAvg = st.prevStages ? st.prevStages.reduce((sum, s) => sum + s.avgH, 0) : null
  return (
    <Card>
      <SectionTitle right={st.n > 0 && st.avgH != null ? tr('stageTimeRight', { n: st.n, t: fmtHours(tr, st.avgH) }) : undefined}>{tr('stageTimeTitle')}</SectionTitle>
      {rows.length === 0 ? (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('stageTimeNone')}</span>
      ) : (
        <>
          <StackedHBar hovered={hov} onHover={setHov}
            segments={rows.map(s => ({ key: s.stage, value: s.share, label: tr(`flow.${s.stage}`), valueText: `${pct(s.share)} · ${fmtHours(tr, s.avgH)}`, className: STAGE_BAR[s.stage], group: stageGroup(s.stage) }))} />
          {longest && (
            <span className="text-sm font-bold text-ive-text-secondary">
              {tr('stageTimeSplit', { work: pct(work), wait: pct(1 - work), stage: tr(`flow.${longest.stage}`) })}
            </span>
          )}
          <div className="flex flex-col">
            {rows.map((s, i) => {
              const prev = prevOf(s.stage)
              const tone = prev != null ? deltaTone(s.avgH, prev, false) : 'neutral'
              return (
                <div key={s.stage} {...hoverHandlers(s.stage, setHov)}
                  className={`flex items-center justify-between gap-2 min-h-10 ${rowHover(hov === s.stage)} ${i < rows.length - 1 ? 'border-b border-ive-border-dark' : ''}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${STAGE_BAR[s.stage]}`} aria-hidden="true" />
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${STAGE_BADGE[s.stage]}`}>{tr(`flow.${s.stage}`)}</span>
                  </span>
                  <span className="flex items-center gap-4 text-sm font-bold tabular-nums">
                    <span className="text-ive-text" title={prev != null ? tr('prevShort', { label: prevLabel, v: fmtHours(tr, prev) }) : undefined}>
                      {fmtHours(tr, s.avgH)}
                      {tone !== 'neutral' && <i className={`fa-solid ${s.avgH > (prev ?? 0) ? 'fa-arrow-up' : 'fa-arrow-down'} text-xs ml-1 ${toneClass[tone]}`} />}
                    </span>
                    <span className="text-ive-text-secondary w-10 text-right">{pct(s.share)}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
      {prevAvg != null && (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('stageTimePrev', { label: prevLabel, n: st.prevN, t: fmtHours(tr, prevAvg) })}</span>
      )}
      <span className="text-xs font-bold text-ive-text-muted">{tr('stageTimeNote')}</span>
    </Card>
  )
}

// ─── ④ 누구 손에 있나 ───

export function PeopleSection({ held, avatars, tr }: { held: Held; avatars?: Record<string, string>; tr: Tr }) {
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
            <div key={`${p.key}|${p.role}`} className="group flex flex-col gap-1 -mx-2 px-2 py-1 -my-1 rounded-lg transition-colors hover:bg-white/[0.05]">
              <div className="flex items-center justify-between gap-2 text-sm font-bold">
                <span className="flex items-center gap-1.5 min-w-0">
                  <PersonFace personKey={p.key} avatars={avatars} />
                  <span className="truncate text-ive-text">{p.name}</span>
                  <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary shrink-0">{tr(`role.${p.role}`)}</span>
                </span>
                <span className="tabular-nums text-ive-text shrink-0">{tr('personCount', { n: p.count, t: fmtHours(tr, p.oldestHours) })}</span>
              </div>
              <div className="h-1 rounded-full bg-ive-bg overflow-hidden"><div className="h-full rounded-full bg-ive-cyan/80 transition-[background-color] duration-150 group-hover:bg-ive-cyan" style={{ width: `${(p.count / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      {notPeople > 0 && <span className="text-xs font-bold text-ive-text-muted">{tr('peopleExcluded', { n: notPeople })}</span>}
    </Card>
  )
}

// ─── 누가 검증·확인했나 ───

/**
 * 그 기간 사람이 내린 검증·확인 판정 — 누가 얼마나 맡았는지 비중(「프로젝트별 현황」의 맡은 시간 비중과 같은 짜임)과
 * 사람별 검증·확인 건수(반려 포함), 지난 기간 건수. 비중은 판정 건수 기준. 에이전트 판정은 아래 한 줄 합계로만.
 */
export function StageWorkSection({ work, avatars, tr, prevLabel }: { work: StageWork | undefined; avatars?: Record<string, string>; tr: Tr; prevLabel: string }) {
  const [hov, setHov] = useState<string | null>(null)
  if (!work) return null
  const people = work.people
  const sum = (p: StageWork['people'][number]) => p.verifyApproved + p.verifyRejected + p.confirmAccepted + p.confirmRejected
  const total = people.reduce((n, p) => n + sum(p), 0)
  const totalV = people.reduce((n, p) => n + p.verifyApproved + p.verifyRejected, 0)
  const totalC = people.reduce((n, p) => n + p.confirmAccepted + p.confirmRejected, 0)
  // 막대: 많이 한 사람 다섯까지 제 색, 나머지는 「기타」 한 조각(중립색) — 줄의 색 점도 같은 색
  const top = people.slice(0, PERSON_COLORS.length)
  const rest = people.slice(PERSON_COLORS.length)
  const restN = rest.reduce((n, p) => n + sum(p), 0)
  const colorOf = new Map(top.map((p, i) => [p.key, PERSON_COLORS[i]]))
  const othersStyle = { background: 'var(--color-ive-text-muted)', opacity: 0.35 }
  const swatch = (key: string) => (colorOf.has(key) ? { background: colorOf.get(key) } : othersStyle)
  const segments = [
    ...top.map(p => ({ key: p.key, value: sum(p), label: p.name, valueText: `${pct(sum(p) / total)} · ${tr('countN', { n: sum(p) })}`, style: swatch(p.key) })),
    ...(restN > 0 ? [{ key: OTHERS_ID, value: restN, label: tr('others'), valueText: `${pct(restN / total)} · ${tr('countN', { n: restN })}`, style: othersStyle }] : []),
  ]
  return (
    <Card>
      <SectionTitle right={people.length ? tr('workRight', { v: totalV, c: totalC }) : undefined}>{tr('workTitle')}</SectionTitle>
      {people.length === 0 ? (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('workNone')}</span>
      ) : (
        <>
          <StackedHBar heightClass="h-3" hovered={hov} onHover={setHov} segments={segments} />
          <div className="flex flex-col">
            {people.map((p, i) => {
              const v = p.verifyApproved + p.verifyRejected
              const c = p.confirmAccepted + p.confirmRejected
              const rejected = [
                p.verifyRejected ? tr('workVerifyRejected', { n: p.verifyRejected }) : '',
                p.confirmRejected ? tr('workConfirmRejected', { n: p.confirmRejected }) : '',
              ].filter(Boolean).join(' · ')
              const segKey = colorOf.has(p.key) ? p.key : OTHERS_ID
              return (
                <div key={p.key} {...hoverHandlers(segKey, setHov)}
                  className={`flex flex-col gap-0.5 py-2 ${rowHover(hov === segKey)} ${i < people.length - 1 ? 'border-b border-ive-border-dark' : ''}`}>
                  <div className="flex items-center justify-between gap-2 text-sm font-bold">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={swatch(p.key)} aria-hidden="true" />
                      <PersonFace personKey={p.key} avatars={avatars} />
                      <span className="truncate text-ive-text">{p.name}</span>
                    </span>
                    <span className="flex items-center gap-3 tabular-nums shrink-0">
                      <span className={v ? 'text-ive-text' : 'text-ive-text-muted'}>{tr('workVerify', { n: v })}</span>
                      <span className={c ? 'text-ive-text' : 'text-ive-text-muted'}>{tr('workConfirm', { n: c })}</span>
                      <span className="text-ive-text-secondary w-10 text-right">{pct(sum(p) / total)}</span>
                    </span>
                  </div>
                  <span className="text-xs font-bold text-ive-text-secondary">
                    {[rejected, tr('prevShort', { label: prevLabel, v: tr('countN', { n: p.prevVerify + p.prevConfirm }) })].filter(Boolean).join(' · ')}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
      {(work.agentVerify > 0 || work.agentConfirm > 0) && (
        <span className="text-xs font-bold text-ive-text-muted">{tr('workAgentLine', { v: work.agentVerify, c: work.agentConfirm })}</span>
      )}
    </Card>
  )
}

// ─── ⑤ 프로젝트별 현황(맡은 시간·완료·보유) ───

export function ProjectsSection({ projects, cost, tr, prevLabel }: { projects: ProjectRow[]; cost: Cost; tr: Tr; prevLabel: string }) {
  const [hov, setHov] = useState<string | null>(null)
  if (projects.length === 0) return null
  const withHours = projects.filter(p => p.humanHours > 0)
  const top = withHours.slice(0, 3)
  const rest = withHours.slice(3)
  const restShare = rest.reduce((s, p) => s + p.share, 0)
  const shareParts = [...top.map(p => ({ id: p.id, name: p.name, color: p.color, share: p.share })), ...(rest.length ? [{ id: OTHERS_ID, name: tr('others'), color: null, share: restShare }] : [])]
  // 조각 색 = 프로젝트 주제색(월간 비중 추이·메일과 같은 규칙). 표 전체 순서로 한 번에 정해
  // 막대·범례·표의 이름 앞 점이 같은 프로젝트에 늘 같은 색을 쓴다(주제색이 겹치면 뒤 프로젝트가 옅어진다)
  const colorParts = [...projects, { id: OTHERS_ID, color: null }]
  const swatchOf = new Map(projectSwatchStyles(colorParts).map((st, i) => [colorParts[i].id, st]))
  const swatches = shareParts.map(s => swatchOf.get(s.id)!)
  // 지난 기간 대비 비중 변화가 가장 큰 프로젝트 한 줄
  const moved = withHours.filter(p => p.prevShare != null).map(p => ({ p, d: p.share - (p.prevShare ?? 0) }))
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0]
  return (
    <Card>
      <SectionTitle right={cost.humanHours > 0 ? tr('hoursRight', { h: Math.round(cost.humanHours) }) : undefined}>{tr('projectsTitle')}</SectionTitle>
      {withHours.length > 0 ? (
        <>
          <StackedHBar heightClass="h-3" hovered={hov} onHover={setHov}
            segments={shareParts.map((s, i) => {
              const row = projects.find(p => p.id === s.id)
              return { key: s.id, value: s.share, label: s.name, valueText: row ? `${pct(s.share)} · ${Math.round(row.humanHours)}h` : pct(s.share), style: swatches[i] }
            })} />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-ive-text-secondary">
            {shareParts.map((s, i) => (
              <span key={s.id} {...hoverHandlers(s.id, setHov)}
                className={`inline-flex items-center gap-1 rounded-lg -mx-1 px-1 transition-colors ${hov === s.id ? 'bg-white/[0.05] text-ive-text' : ''}`}><span className="w-2 h-2 rounded-full shrink-0" style={swatches[i]} />{s.name} {pct(s.share)}</span>
            ))}
          </div>
          {moved && Math.abs(moved.d) >= 0.05 && (
            <span className="text-sm font-bold text-ive-text-secondary">{tr(moved.d > 0 ? 'shareUp' : 'shareDown', { name: moved.p.name, label: prevLabel, pp: Math.round(Math.abs(moved.d) * 100) })}</span>
          )}
        </>
      ) : (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('hoursNone')}</span>
      )}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-sm font-bold border-collapse">
          <thead>
            <tr className="text-ive-text-muted text-xs border-b border-ive-border-dark">
              <th className="text-left py-2 pr-2 font-bold">{tr('colProject')}</th>
              <th className="text-right py-2 px-1.5 font-bold">{tr('colHours')}</th>
              <th className="text-right py-2 px-1.5 font-bold">{tr('colDone')}</th>
              <th className="text-right py-2 pl-1.5 font-bold">{tr('colHeld')}</th>
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} {...hoverHandlers(p.id, setHov)}
                className={`border-t border-ive-border-dark transition-colors ${hov === p.id ? 'bg-white/[0.05]' : ''}`}>
                <td className="text-left py-2 pr-2 text-ive-text align-top">
                  <div className="flex items-center gap-1.5 min-w-0 pt-0.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={swatchOf.get(p.id)} />
                    <span className="truncate max-w-[7rem] sm:max-w-36" title={p.name}>{p.name}</span>
                  </div>
                </td>
                <td className="text-right py-2 px-1.5 align-top">
                  {p.humanHours > 0 || p.prevHumanHours > 0 ? (
                    <div className="flex flex-col items-end leading-tight">
                      <span className="text-sm font-bold text-ive-text tabular-nums">
                        {p.humanHours > 0 ? `${Math.round(p.humanHours)}h · ${pct(p.share)}` : '0h'}
                      </span>
                      <MiniDelta cur={Math.round(p.humanHours)} prev={Math.round(p.prevHumanHours)} goodWhenUp={null} className="mt-0.5" />
                    </div>
                  ) : (
                    <span className="text-sm font-bold text-ive-text-muted tabular-nums">—</span>
                  )}
                </td>
                <td className="text-right py-2 px-1.5 align-top">
                  <div className="flex flex-col items-end leading-tight">
                    <span className="text-sm font-bold text-ive-text tabular-nums">{p.completed}</span>
                    <MiniDelta cur={p.completed} prev={p.prevCompleted} goodWhenUp className="mt-0.5" />
                  </div>
                </td>
                <td className="text-right py-2 pl-1.5 align-top">
                  {p.held == null ? (
                    <span className="text-sm font-bold text-ive-text-muted tabular-nums">—</span>
                  ) : (
                    <div className="flex flex-col items-end leading-tight">
                      <span className="text-sm font-bold text-ive-text tabular-nums">{p.held}</span>
                      <MiniDelta cur={p.held} prev={p.prevHeld} goodWhenUp={false} className="mt-0.5" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="text-xs font-bold text-ive-text-muted">{tr('projectsNote', { label: prevLabel })}</span>
    </Card>
  )
}

/** 표 안의 작은 증감 — 화살표에만 의미색. goodWhenUp 이 null 이면 좋고 나쁨이 없는 값(사람 시간)이라 색 없음 */
function MiniDelta({ cur, prev, goodWhenUp, className = '' }: { cur: number; prev: number | null | undefined; goodWhenUp: boolean | null; className?: string }) {
  if (prev == null || cur === prev) return null
  const up = cur > prev
  const color = goodWhenUp == null ? 'text-ive-text-muted' : up === goodWhenUp ? 'text-ive-cyan' : 'text-ive-red'
  return (
    <span className={`inline-flex items-center text-xs font-bold tabular-nums text-ive-text-secondary whitespace-nowrap ${className}`}>
      <span className={`${color} mr-0.5 text-[10px] leading-none`}>{up ? '▲' : '▼'}</span>
      {Math.abs(cur - prev).toLocaleString()}
    </span>
  )
}

// ─── ⑥ 끝낸 일 ───

export function DoneSection({ done, tr, prevLabel }: { done: Done; tr: Tr; prevLabel: string }) {
  return (
    <Card>
      <SectionTitle right={<Delta cur={done.total} prev={done.prevTotal} goodWhenUp text={tr('vsPrev', { label: prevLabel, n: done.prevTotal })} />}>{tr('doneTitle')}</SectionTitle>
      <span className="text-3xl font-bold text-ive-text tabular-nums leading-none"><CountBump value={done.total}>{done.total.toLocaleString()}</CountBump><span className="text-base ml-0.5">{tr('countUnit')}</span></span>
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
        {cost.humanHoursPerCompleted != null && (
          <Row label={tr('hoursPerCompleted')} value={tr('hoursValue', { h: cost.humanHoursPerCompleted.toFixed(1) })} />
        )}
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
      <button onClick={() => setOpen(o => !o)} className="w-full min-h-12 px-4 flex items-center justify-between text-base font-bold text-ive-text">
        <span>{tr('completedList')}</span>
        <span className="flex items-center gap-2 text-xs font-bold text-ive-text-muted">{tr('countN', { n: items.length })}<i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} /></span>
      </button>
      {/* PC 다단: 펼친 목록이 단 높이를 키워 다른 카드를 다른 단으로 밀지 않도록 카드 안에서 스크롤한다 */}
      {open && (
        <div className="px-4 pb-3 flex flex-col desk:max-h-[480px] desk:overflow-y-auto">
          {items.slice(0, limit).map(i => (
            <a key={`${i.projectId}:${i.iid}:${i.completedAt}`} href={issueHref(i.projectId, i.iid)} className="flex items-center justify-between gap-2 py-2 border-t border-ive-border-dark font-bold hover:bg-white/[0.03]">
              <span className="flex flex-col min-w-0">
                <span className="text-sm text-ive-text truncate">#{i.iid} {i.title ?? ''}</span>
                <span className="text-xs text-ive-text-muted truncate">{i.projectName} · {tr(`form.${i.form}`)}</span>
              </span>
              <span className="text-sm text-ive-text-secondary tabular-nums shrink-0">{i.leadH != null ? fmtHours(tr, i.leadH) : kstMonthDay(i.completedAt)}</span>
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

// ─── 내 손에 있는 일 ───

/** 지금 내가 들고 있는 일(확실히 식별된 담당만, 공유 범위 밖 프로젝트 포함) — 메일의 "내 손에 있는 일"과 같은 목록 */
export function MineSection({ mine, tr, highlight }: { mine: HeldIssue[]; tr: Tr; highlight: boolean }) {
  const [limit, setLimit] = useState(10)
  if (mine.length === 0 && !highlight) return null
  const aged = agedCount(mine)
  return (
    <Card highlight={highlight}>
      <SectionTitle right={aged > 0 ? tr('over7', { n: aged }) : undefined}>{tr('mineTitle', { n: mine.length })}</SectionTitle>
      {mine.length === 0 ? (
        <span className="text-sm font-bold text-ive-text-secondary">{tr('mineNone')}</span>
      ) : (
        <div className="flex flex-col">
          {mine.slice(0, limit).map(i => (
            <a key={`${i.projectId}:${i.iid}`} href={issueHref(i.projectId, i.iid)} className="flex items-center justify-between gap-2 py-2 border-t border-ive-border-dark first:border-t-0 font-bold hover:bg-white/[0.03]">
              <span className="flex flex-col min-w-0">
                <span className="text-sm text-ive-text truncate">#{i.iid} {i.title ?? ''}</span>
                <span className="text-xs text-ive-text-muted truncate">{i.projectName} · {tr(`stage.${i.stage}`)}{i.role ? ` · ${tr(`role.${i.role}`)}` : ''}</span>
              </span>
              <span className="text-sm text-ive-text-secondary tabular-nums shrink-0">{tr('elapsed', { t: fmtHours(tr, i.ageHours) })}</span>
            </a>
          ))}
          {mine.length > limit && (
            <button onClick={() => setLimit(l => l + 20)} className="mt-2 px-3 py-2 rounded-lg bg-white/5 border border-ive-border-subtle text-sm font-bold text-ive-text-muted">{tr('showMore')}</button>
          )}
        </div>
      )}
    </Card>
  )
}
