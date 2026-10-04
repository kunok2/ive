/**
 * 보고서 메일 — 화면과 같은 보고서 모델(lib/report-model)을 받는 사람에 맞는 블록만 골라 그린다.
 * 숫자를 여기서 계산하지 않는다. 모든 숫자 칸에 data-metric(모델 경로)과 data-value(값)를 달아, 테스트가 메일 값과 모델 값을 대조한다.
 *
 * 메일 종류
 *  - member(주간·팀원): 내 손에 있는 일 · 팀 보유(식) · 팀이 손쓸 것 · 지난주 끝낸 일
 *  - lead(주간·팀장):   팀 보유(식) · 손쓸 것 · 누구 손에 · 프로젝트별 현황(맡은 시간·완료·보유) · 지난주 끝낸 일 · 어디서 시간이 걸렸나
 *  - exec(월간·연간):   기간 말 보유(식·7일 넘은 일) · 산출 추이 · 처리 기간 · 어디서 시간이 걸렸나 · 투입과 비용 · 프로젝트별 현황과 맡은 시간 비중 추이 · 살펴볼 위험 · 작업 결과 평가(사람·AI 묶음, 모델별)
 * 막 끝나 아직 확정 전인 기간(provisional)은 끝에 잠정 값이라고 밝힌다.
 */
import { createTranslator } from 'next-intl'
import ko from '@/messages/ko/reportV2.json'
import en from '@/messages/en/reportV2.json'
import type { ReportModel, HeldIssue, FlowStage } from '../report-model/types'
import { fmtHours, pct, deltaTone, agedCount, MIN_SAMPLE, projectSwatches, OTHERS_ID, WHITE_PROJECT_COLOR, type Tr } from '../report-model/format'

export type MailKind = 'member' | 'lead' | 'exec'

/**
 * 메일 문구 — 화면과 같은 메시지(reportV2)를 화면과 같은 포매터(next-intl, ICU)로 만든다.
 * 단수·복수 같은 ICU 문법도 화면과 똑같이 처리된다.
 */
function mailTranslator(locale: string | null | undefined): Tr {
  const lang = locale === 'en' ? 'en' : 'ko'
  const tr = createTranslator({ locale: lang, messages: { reportV2: lang === 'en' ? en : ko } as never, namespace: 'reportV2' as never })
  return (key, params = {}) => (tr as unknown as (k: string, p: Record<string, string | number>) => string)(key, params)
}
type T = Tr

const COLOR = {
  ground: '#f4f4f5', card: '#ffffff', border: '#e4e4e7', text: '#18181b', secondary: '#52525b', muted: '#71717a',
  good: '#0891b2', bad: '#dc2626', warn: '#b45309',
}

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 숫자 칸의 근거 — [모델 경로, 그 값] */
type Src = [string, number | string | null | undefined]
const val = (v: Src[1]) => (v == null ? '' : String(v))

/**
 * 숫자 칸 — 그 글자에 든 숫자들의 모델 경로(data-metric)와 값(data-value)을 남긴다(여럿이면 | 로 잇는다).
 * 테스트가 모델의 그 경로 값과 대조한다. 숫자에는 색을 쓰지 않는다(디자인 가이드) — 색은 증감 화살표와 상태 점에만.
 */
function nums(srcs: Src[], text: string): string {
  return `<span data-metric="${esc(srcs.map(x => x[0]).join('|'))}" data-value="${esc(srcs.map(x => val(x[1])).join('|'))}" style="font-weight:700;color:${COLOR.text};font-variant-numeric:tabular-nums">${esc(text)}</span>`
}
const num = (metric: string, value: Src[1], text: string) => nums([[metric, value]], text)

/**
 * 증감 — 화면과 같은 규칙(deltaTone)으로 화살표에만 색. goodWhenUp 이 null 이면 좋고 나쁨이 없는 값(색 없음).
 * 비교한 지난 값의 모델 경로를 남긴다(prev). shown 은 화면에 보이는 대로 반올림한 두 값(사람 시간).
 */
function deltaSpan(cur: number, prev: Src, goodWhenUp: boolean | null, shown?: [number, number]): string {
  const p = prev[1]
  if (p == null || typeof p !== 'number') return ''
  const [c, q] = shown ?? [cur, p]
  const d = c - q
  const attrs = `data-metric="${esc(prev[0])}" data-value="${esc(val(p))}"`
  if (d === 0) return ` <span ${attrs} style="font-size:13px;color:${COLOR.muted}">±0</span>`
  const tone = goodWhenUp == null ? 'neutral' : deltaTone(c, q, goodWhenUp)
  const arrow = tone === 'neutral' ? COLOR.muted : tone === 'good' ? COLOR.good : COLOR.bad
  return ` <span ${attrs} style="font-size:13px;font-weight:700;color:${COLOR.secondary}"><span style="color:${arrow}">${d > 0 ? '▲' : '▼'}</span>${Math.abs(d)}</span>`
}

/** 표시 점 — 상태(빨강=멈춤·주황=살펴볼 것)와 프로젝트 주제색. 의미색은 숫자가 아니라 여기에만 */
const dot = (color: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${color};margin-right:6px"></span>`

function block(title: string, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:8px;margin:0 0 12px">
<tr><td style="padding:16px">
<div style="font-size:12px;font-weight:700;color:${COLOR.secondary};margin:0 0 10px">${esc(title)}</div>
${body}
</td></tr></table>`
}

/** label 은 이미 이스케이프된 HTML(점 등 포함 가능) */
function row(labelHtml: string, value: string): string {
  return `<tr><td style="padding:4px 0;font-size:14px;font-weight:700;color:${COLOR.secondary}">${labelHtml}</td><td style="padding:4px 0;font-size:14px;text-align:right">${value}</td></tr>`
}
const rows = (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table>`
const line = (html: string) => `<div style="font-size:13px;font-weight:700;color:${COLOR.secondary};margin-top:4px">${html}</div>`

/**
 * 프로젝트별 비중 조각의 메일 색 — 화면과 같은 규칙(projectSwatches: 주제색, 같은 색이 겹치면 농도↓).
 * 메일 클라이언트마다 투명도 지원이 달라 농도는 흰 바탕과 미리 섞은 단색으로 낸다.
 * 흰색 주제색은 흰 바탕에서 사라지므로 회색으로, 「기타」는 옅은 회색.
 */
function mailSwatches(parts: { id: string; color?: string | null }[]): string[] {
  return projectSwatches(parts).map(s => {
    if (s.color == null) return '#d4d4d8'
    const hex = s.color === WHITE_PROJECT_COLOR ? '#a1a1aa' : s.color
    const m = /^#([0-9a-f]{6})$/i.exec(hex)
    if (!m || s.alpha >= 1) return hex
    const n = parseInt(m[1], 16)
    const mix = (c: number) => Math.round(c * s.alpha + 255 * (1 - s.alpha)).toString(16).padStart(2, '0')
    return `#${mix(n >> 16)}${mix((n >> 8) & 0xff)}${mix(n & 0xff)}`
  })
}
/** 보고서의 프로젝트 → 메일 색. 프로젝트 표 순서로 정해, 사람 시간 막대와 비중 추이가 같은 색을 쓴다 */
function projectMailColors(m: ReportModel): Map<string, string> {
  const parts = [...m.projects, { id: OTHERS_ID, color: null }]
  const colors = mailSwatches(parts)
  return new Map(parts.map((p, i) => [p.id, colors[i]]))
}

function shareBar(parts: { share: number; color: string }[]): string {
  const cells = parts.filter(p => p.share > 0).map(p =>
    `<td style="height:10px;background:${p.color};width:${Math.max(1, Math.round(p.share * 100))}%"></td>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:5px;overflow:hidden;margin:4px 0 8px"><tr>${cells}</tr></table>`
}

function button(href: string, label: string): string {
  if (!href) return ''
  return `<a href="${esc(href)}" style="display:inline-block;background:${COLOR.good};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:10px 16px;border-radius:8px">${esc(label)}</a>`
}

// ─── 블록 ───

/**
 * 안고 있는 일(화면 맨 위 HeldCard 와 같은 내용) — 진행 중이면 지금, 닫힌 기간이면 기간 말.
 * 지난 기간 말 + 유입 − 완료 = 지금(기간 말) 식을 함께 보인다.
 */
function heldBlock(t: T, m: ReportModel, at: 'now' | 'closed', prevLabel: string): string {
  const h = m.held
  const title = h.live ? t('heldNow') : t('heldEnd')
  if (h.end == null) return block(title, line(esc(t('heldNoRecord'))))
  const head = `<div style="font-size:28px;line-height:1.1;margin:0 0 6px">${num(`${at}.held.end`, h.end, t('countN', { n: h.end }))}${h.start != null
    ? `<span style="font-size:13px;color:${COLOR.secondary}"> ${esc(t('vsPrevEnd', { label: prevLabel, n: h.start }))}</span>${deltaSpan(h.end, [`${at}.held.start`, h.start], false)}` : ''}</div>`
  const parts: string[] = []
  if (h.live) {
    parts.push(h.drainDays != null
      ? num(`${at}.held.drainDays`, h.drainDays, t('drainDays', { d: h.drainDays < 1 ? 1 : Math.round(h.drainDays) }))
      : esc(t('drainUnknown')))
  }
  if (h.over7 != null) {
    parts.push((h.over7 ? num(`${at}.held.over7`, h.over7, t('over7', { n: h.over7 })) : esc(t('over7None')))
      + deltaSpan(h.over7, [`${at}.held.prevOver7`, h.prevOver7], false))
  }
  const sub = parts.length ? line(parts.join(' · ')) : ''
  const eq = h.start != null
    ? `<div style="font-size:13px;color:${COLOR.secondary};margin-top:8px">${esc(t('eqStart', { label: prevLabel }))} ${num(`${at}.held.start`, h.start, String(h.start))} + ${esc(t('eqInflow'))} ${num(`${at}.held.inflow`, h.inflow, String(h.inflow))} − ${esc(t('eqCompleted'))} ${num(`${at}.held.completed`, h.completed, String(h.completed))} = ${esc(h.live ? t('eqNow') : t('eqEnd'))} ${num(`${at}.held.end`, h.end, String(h.end))}</div>`
    : ''
  return block(title, head + sub + eq)
}

function actionsBlock(t: T, now: ReportModel): string {
  const a = now.actions
  if (!a) return ''
  const lines: string[] = []
  if (a.failed.length) lines.push(row(dot(COLOR.bad) + esc(t('mail.failed')), num('now.actions.failed.length', a.failed.length, t('countN', { n: a.failed.length }))))
  if (a.aged.length) lines.push(row(dot(COLOR.warn) + esc(t('mail.aged')), num('now.actions.aged.length', a.aged.length, t('countN', { n: a.aged.length }))))
  a.concentrations.forEach((c, i) => lines.push(row(dot(COLOR.warn) + esc(`${t('mail.concentrated')} · ${t(`role.${c.role}`)}`),
    nums([[`now.actions.concentrations.${i}.count`, c.count], [`now.actions.concentrations.${i}.roleTotal`, c.roleTotal]], t('mail.concentratedValue', { name: c.name, n: c.count, total: c.roleTotal })))))
  if (!lines.length) return block(t('mail.teamActions'), `<div style="font-size:14px;font-weight:700;color:${COLOR.text}">${esc(t('actNone'))}</div>`)
  return block(t('mail.teamActions'), rows(lines.join('')))
}

function myIssuesBlock(t: T, mine: HeldIssue[], baseUrl: string): string {
  if (!mine.length) return ''
  const top = mine.slice(0, 3).map((i, n) =>
    row(esc(`#${i.iid} ${i.title ?? ''}`), num(`mine.${n}.ageHours`, i.ageHours, t('mail.ageDays', { t: fmtHours(t, i.ageHours) })))).join('')
  // 화면(MineSection)과 같은 함수로 센다
  const aged = agedCount(mine)
  const more = mine.length > 3 ? line(esc(t('andMore', { n: mine.length - 3 })) + (aged ? ` · ${esc(t('mail.mineAged', { n: aged }))}` : '')) : ''
  // 보고서 화면의 "내 손에 있는 일"(같은 목록)로 연다
  return block(t('mail.mine', { n: mine.length }), rows(top) + more + `<div style="margin-top:12px">${button(baseUrl ? `${baseUrl}/?tab=reports&mine=1` : '', t('mail.openMine'))}</div>`)
}

function peopleBlock(t: T, now: ReportModel): string {
  const people = now.held.people
  if (!people || !people.length) return ''
  return block(t('peopleTitle'), rows(people.slice(0, 5).map((p, i) =>
    row(esc(`${p.name} · ${t(`role.${p.role}`)}`), nums([[`now.held.people.${i}.count`, p.count], [`now.held.people.${i}.oldestHours`, p.oldestHours]], t('personCount', { n: p.count, t: fmtHours(t, p.oldestHours) })))).join('')))
}

/** 프로젝트별 현황 — 화면 ProjectsSection 과 같은 줄(사람 시간·비중, 완료, 보유, 지난 기간 대비) */
function projectsBlock(t: T, m: ReportModel): string {
  if (!m.projects.length) return ''
  const withHours = m.projects.filter(p => p.humanHours > 0)
  const rest = withHours.slice(3).reduce((s, p) => s + p.share, 0)
  // 막대 조각·줄 이름 앞 점이 같은 프로젝트에 늘 같은 색 — 화면 ProjectsSection 과 같은 순서로 한 번에 정한다
  const colorOf = projectMailColors(m)
  const parts = [...withHours.slice(0, 3).map(p => ({ share: p.share, color: colorOf.get(p.id)! })), ...(rest > 0 ? [{ share: rest, color: colorOf.get(OTHERS_ID)! }] : [])]
  const body = m.projects.slice(0, 6).map((p, i) => {
    const at = `closed.projects.${i}`
    const hours = p.humanHours > 0 || p.prevHumanHours > 0
      ? nums([[`${at}.humanHours`, p.humanHours], [`${at}.share`, p.share]], p.humanHours > 0 ? `${Math.round(p.humanHours)}h · ${pct(p.share)}` : '0h')
        + deltaSpan(p.humanHours, [`${at}.prevHumanHours`, p.prevHumanHours], null, [Math.round(p.humanHours), Math.round(p.prevHumanHours)])
      : '—'
    const done = `${esc(t('colDone'))} ${num(`${at}.completed`, p.completed, String(p.completed))}${deltaSpan(p.completed, [`${at}.prevCompleted`, p.prevCompleted], true)}`
    const held = p.held == null ? '' : ` · ${esc(t('colHeld'))} ${num(`${at}.held`, p.held, String(p.held))}${deltaSpan(p.held, [`${at}.prevHeld`, p.prevHeld], false)}`
    return row(dot(colorOf.get(p.id)!) + esc(p.name), `${hours}<div style="font-size:12px;color:${COLOR.secondary}">${done}${held}</div>`)
  }).join('')
  return block(t('projectsTitle'), (parts.length ? shareBar(parts) : '') + rows(body))
}

function doneBlock(t: T, closed: ReportModel, prevLabel: string): string {
  const d = closed.done
  return block(t('mail.doneTitle', { label: prevLabel }), rows(
    row(esc(t('eqCompleted')), num('closed.done.total', d.total, t('countN', { n: d.total })) + deltaSpan(d.total, ['closed.done.prevTotal', d.prevTotal], true)) +
    row(esc(t('leadMedian')), num('closed.done.leadMedianH', d.leadMedianH, fmtHours(t, d.leadMedianH))) +
    row(esc(t('firstPass')), num('closed.done.firstPass', d.firstPass, d.firstPass == null ? t('notApplicable') : pct(d.firstPass))),
  ))
}

/** 흰 바탕과 미리 섞은 단색(메일 클라이언트마다 투명도 지원이 달라서) */
function onWhite(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0')
  return `#${mix(n >> 16)}${mix((n >> 8) & 0xff)}${mix(n & 0xff)}`
}
/** 단계색 — 화면(STAGE_BAR)과 같은 규칙: 처리 대기=시안, 처리 노랑·검증 보라·확인 분홍, 그 단계 대기는 옅게 */
const FLOW_COLOR: Record<FlowStage, string> = {
  waiting: '#22d3ee', dev: '#f59e0b',
  verify_waiting: onWhite('#a78bfa', 0.45), verifying: '#a78bfa',
  confirm_waiting: onWhite('#f472b6', 0.45), confirming: '#f472b6',
}
const WORK_STAGES: FlowStage[] = ['dev', 'verifying', 'confirming']

/** 어디서 시간이 걸렸나 — 화면 StageTimeSection 의 숫자판(단계별 건당 평균·비중) */
function stageTimeBlock(t: T, m: ReportModel): string {
  const at = 'closed'
  const st = m.stageTime
  if (!st || st.n === 0) return ''
  const shown = st.stages.map((s, i) => ({ s, i })).filter(x => x.s.share > 0)
  if (!shown.length) return ''
  const work = st.stages.filter(s => WORK_STAGES.includes(s.stage)).reduce((sum, s) => sum + s.share, 0)
  const longest = shown.reduce((a, b) => (b.s.share > a.s.share ? b : a))
  const head = `<div style="font-size:13px;font-weight:700;color:${COLOR.secondary};margin:0 0 4px">${nums([[`${at}.stageTime.n`, st.n], [`${at}.stageTime.avgH`, st.avgH]], t('stageTimeRight', { n: st.n, t: fmtHours(t, st.avgH) }))}</div>`
  return block(t('stageTimeTitle'), head
    + shareBar(shown.map(x => ({ share: x.s.share, color: FLOW_COLOR[x.s.stage] })))
    + line(esc(t('stageTimeSplit', { work: pct(work), wait: pct(1 - work), stage: t(`flow.${longest.s.stage}`) })))
    + rows(shown.map(({ s, i }) => row(
      `${dot(FLOW_COLOR[s.stage])}${esc(t(`flow.${s.stage}`))}`,
      `${num(`${at}.stageTime.stages.${i}.avgH`, s.avgH, fmtHours(t, s.avgH))} · ${num(`${at}.stageTime.stages.${i}.share`, s.share, pct(s.share))}`,
    )).join('')))
}

/** 월간·연간: 사람 시간 비중 추이(화면 ShareTrendSection 의 숫자판) — 달마다 상위 3개 프로젝트 */
function shareTrendBlock(t: T, m: ReportModel): string {
  const months = m.months ?? []
  if (!months.some(x => x.projectShares.length)) return ''
  const colorOf = projectMailColors(m)
  return block(t('shareTrendTitle', { n: months.length }), rows(months.map((x, i) => row(
    esc(t('monthShort', { m: Number(x.label.slice(5, 7)) })),
    x.projectShares.length === 0 ? esc(t('noRecord'))
      : x.projectShares.slice(0, 3).map((s, j) => `${dot(colorOf.get(s.id) ?? mailSwatches([s])[0])}${esc(s.name)} ${num(`closed.months.${i}.projectShares.${j}.share`, s.share, pct(s.share))}`).join(' · '),
  )).join('')))
}

/**
 * 작업 결과 평가 — 사람·AI 묶음과 AI(모델)별만 싣는다. 사람별 결과는 공개 범위 설정을 따르는 보고서 화면에서만 본다
 * (메일은 전달될 수 있으므로).
 */
function evaluationBlock(t: T, m: ReportModel): string {
  const ev = m.evaluation
  if (!ev) return ''
  const groups = ev.groups.map((g, i) => ({ g, i })).filter(x => x.g.n > 0)
  const models = ev.workers.map((w, i) => ({ w, i })).filter(x => x.w.key.startsWith('m:'))
  if (!groups.length && !models.length) return ''
  const pass = (at: string, rate: number | null, n: number) =>
    `${num(`${at}.passRate`, rate, pct(rate))} · ${num(`${at}.n`, n, t('countN', { n }))}`
  const body = [
    ...groups.map(({ g, i }) => row(esc(t(`evalGroup.${g.key}`)), pass(`closed.evaluation.groups.${i}`, g.passRate, g.n))),
    ...models.map(({ w, i }) => row(esc(w.modelUnknown ? t('modelUnknown', { cli: w.name }) : w.name),
      w.state === 'ok' ? pass(`closed.evaluation.workers.${i}`, w.passRate, w.n)
        : num(`closed.evaluation.workers.${i}.n`, w.n, t('collecting', { n: w.n, min: MIN_SAMPLE })))),
  ].join('')
  return block(t('evalTitle'), `<div style="font-size:12px;color:${COLOR.muted};margin:0 0 6px">${esc(t('grade.pass'))} · ${esc(t('evalWindow', { from: ev.windowStart.slice(5).replace('-', '.'), to: ev.windowEnd.slice(5).replace('-', '.') }))}</div>`
    + rows(body) + `<div style="font-size:12px;color:${COLOR.muted};margin-top:6px">${esc(t('mail.evalPeopleOnScreen'))}</div>`)
}

function execBlocks(t: T, m: ReportModel, money: (usd: number) => string, prevLabel: string): string {
  const out: string[] = []
  out.push(heldBlock(t, m, 'closed', prevLabel))
  const d = m.done
  const months = m.months ?? []
  const maxC = Math.max(1, ...months.map(x => x.completed))
  const bars = months.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0"><tr>${months.map((x, i) =>
      `<td style="vertical-align:bottom;text-align:center;padding:0 3px"><div style="font-size:11px;color:${COLOR.secondary}">${num(`closed.months.${i}.completed`, x.completed, String(x.completed))}</div><div style="height:${Math.max(2, Math.round((x.completed / maxC) * 60))}px;background:${i === months.length - 1 ? COLOR.good : '#7dd3fc'};border-radius:2px 2px 0 0"></div><div style="font-size:11px;color:${COLOR.muted}">${esc(t('monthShort', { m: Number(x.label.slice(5, 7)) }))}</div></td>`).join('')}</tr></table>`
    : ''
  out.push(block(t('mail.execDone'), `<div style="font-size:28px;line-height:1.1">${num('closed.done.total', d.total, t('countN', { n: d.total }))}${deltaSpan(d.total, ['closed.done.prevTotal', d.prevTotal], true)}</div>${bars}` + rows(
    row(esc(t('leadMedian')), num('closed.done.leadMedianH', d.leadMedianH, fmtHours(t, d.leadMedianH))),
  )))
  out.push(stageTimeBlock(t, m))
  const c = m.cost
  out.push(block(t('costTitle'), rows(
    row(esc(t('humanHours')), c.humanHours > 0 ? nums([['closed.cost.humanHours', c.humanHours], ['closed.cost.people', c.people]], t('hoursPeople', { h: Math.round(c.humanHours), p: c.people })) : esc(t('noRecord'))) +
    row(esc(t('humanCost')), c.humanRateSet ? num('closed.cost.humanCost', c.humanCost, money(c.humanCost)) : esc(t('humanRateUnset'))) +
    row(esc(t('aiActual')), num('closed.cost.aiActual', c.aiActual, money(c.aiActual))) +
    row(esc(t('perCompleted')), c.perCompleted == null ? '—' : num('closed.cost.perCompleted', c.perCompleted, money(c.perCompleted))),
  ) + `<div style="font-size:12px;color:${COLOR.muted};margin-top:6px">${num('closed.cost.aiNotional', c.aiNotional, t('notionalNote', { v: money(c.aiNotional) }))}</div>`))
  out.push(projectsBlock(t, m))
  out.push(shareTrendBlock(t, m))
  out.push(riskBlock(t, m))
  out.push(evaluationBlock(t, m))
  return out.join('')
}

/** 살펴볼 위험 — 화면(RiskSection)과 같은 항목·같은 순서: 한 사람 의존(역할마다) → 반려율 상승 → 7일 넘은 일, 끝에 반려율 한 줄 */
function riskBlock(t: T, m: ReportModel): string {
  const r = m.risks
  if (!r) return ''
  const item = (title: string, detail = '') => `<div style="font-size:14px;font-weight:700;color:${COLOR.text};margin:0 0 6px">${dot(COLOR.warn)}${title}${detail ? `<div style="font-size:12px;color:${COLOR.secondary};margin:2px 0 0 14px">${detail}</div>` : ''}</div>`
  const out: string[] = []
  r.concentrations.forEach((c, i) => out.push(item(
    num(`closed.risks.concentrations.${i}.share`, c.share, t('riskConcentration', { role: t(`role.${c.role}`), name: c.name, pct: pct(c.share) })),
    nums([[`closed.risks.concentrations.${i}.count`, c.count], [`closed.risks.concentrations.${i}.total`, c.total]], t('riskConcentrationDetail', { n: c.count, total: c.total })),
  )))
  if (r.rejectRate != null && r.prevRejectRate != null && r.rejectRate - r.prevRejectRate >= 0.03) {
    out.push(item(
      nums([['closed.risks.rejectRate', r.rejectRate], ['closed.risks.prevRejectRate', r.prevRejectRate]], t('riskReject', { v: pct(r.rejectRate), p: pct(r.prevRejectRate) })),
      r.rejectTopProject ? num('closed.risks.rejectTopProject.rate', r.rejectTopProject.rate, t('riskRejectTop', { name: r.rejectTopProject.name, v: pct(r.rejectTopProject.rate) })) : '',
    ))
  }
  if (m.held.over7) {
    out.push(item(num('closed.held.over7', m.held.over7, t('riskAged', { n: m.held.over7 })),
      m.held.prevOver7 != null ? num('closed.held.prevOver7', m.held.prevOver7, t('riskAgedPrev', { n: m.held.prevOver7 })) : ''))
  }
  const rateLine = r.rejectRate != null
    ? `<div style="font-size:12px;color:${COLOR.muted};margin-top:6px">${nums([['closed.risks.rejectRate', r.rejectRate], ['closed.risks.prevRejectRate', r.prevRejectRate]], t('rejectRateLine', { v: pct(r.rejectRate), p: r.prevRejectRate != null ? pct(r.prevRejectRate) : '—' }))}</div>`
    : ''
  return block(t('riskTitle'), (out.length ? out.join('') : line(esc(t('riskNone')))) + rateLine)
}

// ─── 조립 ───

export interface RenderInput {
  kind: MailKind
  /** 보고 대상(닫힌) 기간의 모델 */
  closed: ReportModel
  /** 주간 메일의 "지금" — 이번 주(진행 중) 모델. 월간·연간은 null */
  now: ReportModel | null
  recipient: { userId: string; name: string; locale?: string | null }
  /** 내 손에 있는 일(팀원 메일) — 공유 범위와 무관하게 그 사람이 확실히 식별되어 들고 있는 일(Git 담당자로 이미 볼 수 있는 일) */
  mine?: HeldIssue[]
  money: (usd: number) => string
  baseUrl: string
}

function periodText(t: T, m: ReportModel): string {
  const s = m.period.start
  const e = new Date(`${m.period.end}T00:00:00Z`); e.setUTCDate(e.getUTCDate() - 1)
  const ed = e.toISOString().slice(0, 10)
  if (m.type === 'weekly') return t('mail.periodWeek', { s: s.slice(5).replace('-', '.'), e: ed.slice(5).replace('-', '.') })
  if (m.type === 'monthly') return t('mail.periodMonth', { y: s.slice(0, 4), m: Number(s.slice(5, 7)) })
  return t('mail.periodYear', { y: s.slice(0, 4) })
}

export function renderReportMail(input: RenderInput): { subject: string; html: string } {
  const t = mailTranslator(input.recipient.locale)
  const { kind, closed, now } = input
  const mine = input.mine ?? []
  const prevLabel = t(`prev.${closed.type}`)
  const period = periodText(t, closed)

  let subject: string
  if (kind === 'exec') {
    const d = closed.done
    const change = d.prevTotal > 0 ? `${d.total >= d.prevTotal ? '+' : ''}${Math.round(((d.total - d.prevTotal) / d.prevTotal) * 100)}%` : t('mail.new')
    subject = t('mail.subjectExec', { period, n: d.total, change, cost: closed.cost.perCompleted == null ? '—' : input.money(closed.cost.perCompleted) })
  } else {
    const h = now?.held
    const held = h?.end == null ? t('mail.subjectNoHeld')
      : h.start != null ? t('mail.subjectHeld', { n: h.end, d: `${h.end - h.start >= 0 ? '+' : ''}${h.end - h.start}` })
      : t('mail.subjectHeldNoDelta', { n: h.end })
    subject = kind === 'member'
      ? t('mail.subjectMember', { held, mine: mine.length })
      : t('mail.subjectLead', { held, done: closed.done.total })
  }

  const parts: string[] = []
  parts.push(`<div style="font-size:16px;font-weight:700;color:${COLOR.text};margin:0 0 14px">${esc(t('mail.greeting', { name: input.recipient.name, period }))}</div>`)
  // 팀장·경영진: 활동이 전혀 없으면 블록 대신 한 줄
  const noActivity = kind !== 'member' && closed.done.total === 0 && closed.held.inflow === 0 && (now?.held.end ?? closed.held.end ?? 0) === 0
  if (noActivity) {
    parts.push(block(t('mail.noActivityTitle'), `<div style="font-size:14px;color:${COLOR.secondary}">${esc(t('mail.noActivity'))}</div>`))
  } else if (kind === 'member') {
    parts.push(myIssuesBlock(t, mine, input.baseUrl))
    if (now) { parts.push(heldBlock(t, now, 'now', prevLabel)); parts.push(actionsBlock(t, now)) }
    parts.push(doneBlock(t, closed, prevLabel))
  } else if (kind === 'lead') {
    if (now) { parts.push(heldBlock(t, now, 'now', prevLabel)); parts.push(actionsBlock(t, now)); parts.push(peopleBlock(t, now)) }
    parts.push(projectsBlock(t, closed))
    parts.push(doneBlock(t, closed, prevLabel))
    parts.push(stageTimeBlock(t, closed))
  } else {
    parts.push(execBlocks(t, closed, input.money, prevLabel))
  }
  // 같은 기간의 보고서 화면으로 연다
  const reportUrl = input.baseUrl ? `${input.baseUrl}/?tab=reports&rtype=${closed.type}&rdate=${closed.period.start}` : ''
  if (reportUrl) parts.push(`<div style="margin:6px 0 16px"><a href="${esc(reportUrl)}" style="font-size:14px;font-weight:700;color:${COLOR.good}">${esc(t('mail.openReport'))} →</a></div>`)
  const note = closed.snapshotAt ? t('mail.snapshotNote', { at: closed.snapshotAt.slice(0, 16).replace('T', ' ') })
    : closed.provisional ? t('mail.provisionalNote') : ''
  parts.push(`<div style="font-size:12px;color:${COLOR.muted};line-height:1.6">${esc(t('mail.footer'))}${note ? `<br>${esc(note)}` : ''}</div>`)

  const html = `<!doctype html><html lang="${input.recipient.locale === 'en' ? 'en' : 'ko'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.ground}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.ground}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif"><tr><td>
${parts.filter(Boolean).join('\n')}
</td></tr></table>
</td></tr></table>
</body></html>`
  return { subject, html }
}
