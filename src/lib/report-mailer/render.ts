/**
 * 보고서 메일 — 화면과 같은 보고서 모델(lib/report-model)을 받는 사람에 맞는 블록만 골라 그린다.
 * 숫자를 여기서 계산하지 않는다. 모든 숫자 칸에 data-metric(모델 경로)을 달아, 테스트가 메일 값과 모델 값을 대조한다.
 *
 * 메일 종류
 *  - member(주간·팀원): 내 손에 있는 일 · 팀 보유 한 줄 · 팀이 손쓸 것 · 지난주 끝낸 일
 *  - lead(주간·팀장):   팀 보유(식) · 손쓸 것 · 누구 손에 · 사람 시간이 쓰인 곳 · 지난주 끝낸 일
 *  - exec(월간·연간):   산출 추이 · 처리 기간 · 기간 말 보유 · 투입과 비용 · 사람 시간 비중 · 살펴볼 위험
 */
import ko from '@/messages/ko/reportV2.json'
import en from '@/messages/en/reportV2.json'
import type { ReportModel, HeldIssue } from '../report-model/types'

export type MailKind = 'member' | 'lead' | 'exec'

type Dict = Record<string, unknown>
function lookup(dict: Dict, key: string): string | undefined {
  let cur: unknown = dict
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object') cur = (cur as Dict)[part]
    else return undefined
  }
  return typeof cur === 'string' ? cur : undefined
}

export function mailTranslator(locale: string | null | undefined) {
  const dict = (locale === 'en' ? en : ko) as Dict
  return (key: string, params: Record<string, string | number> = {}) => {
    const s = lookup(dict, key) ?? lookup(ko as Dict, key) ?? key
    return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
  }
}
type T = ReturnType<typeof mailTranslator>

const COLOR = {
  ground: '#f4f4f5', card: '#ffffff', border: '#e4e4e7', text: '#18181b', secondary: '#52525b', muted: '#71717a',
  good: '#0891b2', bad: '#dc2626', warn: '#b45309',
}

const esc = (s: string | null | undefined) => (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function hours(t: T, h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return t('noRecord')
  if (h < 1) return t('durMin', { m: Math.max(1, Math.round(h * 60)) })
  if (h < 24) return t('durHour', { h: Math.round(h) })
  const d = Math.floor(h / 24), r = Math.round(h - d * 24)
  return r > 0 ? t('durDayHour', { d, h: r }) : t('durDay', { d })
}
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`)

/** 숫자 칸 — 모델 경로를 data-metric 으로 남긴다 */
function num(metric: string, text: string, color = COLOR.text): string {
  return `<span data-metric="${metric}" style="font-weight:700;color:${color};font-variant-numeric:tabular-nums">${esc(text)}</span>`
}

function deltaSpan(cur: number, prev: number | null | undefined, goodWhenUp: boolean): string {
  if (prev == null) return ''
  const d = cur - prev
  if (d === 0) return ` <span style="font-size:13px;color:${COLOR.muted}">±0</span>`
  const r = prev !== 0 ? Math.abs(d) / prev : 1
  const color = r <= 0.05 ? COLOR.muted : (d > 0) === goodWhenUp ? COLOR.good : COLOR.bad
  return ` <span style="font-size:13px;color:${color};font-weight:700">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>`
}

function block(title: string, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:8px;margin:0 0 12px">
<tr><td style="padding:16px">
<div style="font-size:12px;font-weight:700;color:${COLOR.secondary};margin:0 0 10px">${esc(title)}</div>
${body}
</td></tr></table>`
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 0;font-size:14px;font-weight:700;color:${COLOR.secondary}">${esc(label)}</td><td style="padding:4px 0;font-size:14px;text-align:right">${value}</td></tr>`
}
const rows = (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table>`

function shareBar(parts: { name: string; share: number }[]): string {
  const shades = ['#0891b2', '#38bdf8', '#7dd3fc', '#bae6fd']
  const cells = parts.filter(p => p.share > 0).map((p, i) =>
    `<td style="height:10px;background:${shades[Math.min(i, 3)]};width:${Math.max(1, Math.round(p.share * 100))}%"></td>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:5px;overflow:hidden;margin:4px 0 8px"><tr>${cells}</tr></table>`
}

function button(href: string, label: string): string {
  if (!href) return ''
  return `<a href="${esc(href)}" style="display:inline-block;background:${COLOR.good};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:10px 16px;border-radius:8px">${esc(label)}</a>`
}

// ─── 블록 ───

function heldBlock(t: T, now: ReportModel, kind: MailKind): string {
  const h = now.held
  if (h.end == null) return block(t('heldNow'), `<div style="font-size:14px;color:${COLOR.secondary}">${esc(t('heldNoRecord'))}</div>`)
  const head = `<div style="font-size:28px;line-height:1.1;margin:0 0 6px">${num('now.held.end', t('countN', { n: h.end }))}${h.start != null ? `<span style="font-size:13px;color:${COLOR.secondary}"> ${esc(t('mail.vsStart', { n: h.start }))}</span>${deltaSpan(h.end, h.start, false)}` : ''}</div>`
  const sub = `<div style="font-size:13px;font-weight:700;color:${COLOR.secondary}">${h.drainDays != null ? esc(t('drainDays', { d: h.drainDays < 1 ? 1 : Math.round(h.drainDays) })) : esc(t('drainUnknown'))} · ${h.over7 ? esc(t('over7', { n: h.over7 })) : esc(t('over7None'))}</div>`
  const eq = kind === 'lead' && h.start != null
    ? `<div style="font-size:13px;color:${COLOR.secondary};margin-top:8px">${esc(t('mail.equation', { s: h.start, i: h.inflow, c: h.completed, e: h.end }))}</div>`
    : ''
  return block(t('heldNow'), head + sub + eq)
}

function actionsBlock(t: T, now: ReportModel): string {
  const a = now.actions
  if (!a) return ''
  const lines: string[] = []
  if (a.failed.length) lines.push(row(t('mail.failed'), num('now.actions.failed.length', t('countN', { n: a.failed.length }), COLOR.bad)))
  if (a.aged.length) lines.push(row(t('mail.aged'), num('now.actions.aged.length', t('countN', { n: a.aged.length }), COLOR.warn)))
  if (a.concentration) lines.push(row(t('mail.concentrated'), num('now.actions.concentration.count', t('mail.concentratedValue', { name: a.concentration.name, n: a.concentration.count, total: a.concentration.roleTotal }), COLOR.warn)))
  if (!lines.length) return block(t('mail.teamActions'), `<div style="font-size:14px;font-weight:700;color:${COLOR.text}">${esc(t('actNone'))}</div>`)
  return block(t('mail.teamActions'), rows(lines.join('')))
}

function myIssuesBlock(t: T, mine: HeldIssue[], baseUrl: string): string {
  if (!mine.length) return ''
  const top = mine.slice(0, 3).map(i =>
    row(`#${i.iid} ${i.title ?? ''}`, num('my.issue.age', t('mail.ageDays', { t: hours(t, i.ageHours) }), COLOR.secondary))).join('')
  const more = mine.length > 3 ? `<div style="font-size:13px;color:${COLOR.secondary};margin-top:4px">${esc(t('andMore', { n: mine.length - 3 }))}${mine.some(i => i.ageHours >= 168) ? ` · ${esc(t('mail.mineAged', { n: mine.filter(i => i.ageHours >= 168).length }))}` : ''}</div>` : ''
  return block(t('mail.mine', { n: mine.length }), rows(top) + more + `<div style="margin-top:12px">${button(baseUrl, t('mail.openMine'))}</div>`)
}

function peopleBlock(t: T, now: ReportModel): string {
  const people = now.held.people
  if (!people || !people.length) return ''
  return block(t('peopleTitle'), rows(people.slice(0, 5).map(p =>
    row(`${p.name} · ${t(`role.${p.role}`)}`, num('now.held.people.count', t('personCount', { n: p.count, t: hours(t, p.oldestHours) })))).join('')))
}

function projectsBlock(t: T, m: ReportModel, prefix: string): string {
  const withHours = m.projects.filter(p => p.humanHours > 0)
  if (!withHours.length) return ''
  const parts = withHours.slice(0, 3).map(p => ({ name: p.name, share: p.share }))
  const rest = withHours.slice(3).reduce((s, p) => s + p.share, 0)
  if (rest > 0) parts.push({ name: t('others'), share: rest })
  return block(t('projectsTitle'), shareBar(parts) + rows(withHours.slice(0, 5).map(p =>
    row(p.name, num(`${prefix}.projects.humanHours`, `${Math.round(p.humanHours)}h · ${pct(p.share)}`))).join('')))
}

function doneBlock(t: T, closed: ReportModel, prevLabel: string, prefix: string): string {
  const d = closed.done
  return block(t('mail.doneTitle', { label: prevLabel }), rows(
    row(t('eqCompleted'), num(`${prefix}.done.total`, t('countN', { n: d.total })) + deltaSpan(d.total, d.prevTotal, true)) +
    row(t('leadMedian'), num(`${prefix}.done.leadMedianH`, hours(t, d.leadMedianH))) +
    row(t('firstPass'), num(`${prefix}.done.firstPass`, d.firstPass == null ? t('notApplicable') : pct(d.firstPass))),
  ))
}

function execBlocks(t: T, m: ReportModel, money: (usd: number) => string): string {
  const out: string[] = []
  const d = m.done
  const months = m.months ?? []
  const maxC = Math.max(1, ...months.map(x => x.completed))
  const bars = months.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0"><tr>${months.map((x, i) =>
      `<td style="vertical-align:bottom;text-align:center;padding:0 3px"><div style="font-size:11px;color:${COLOR.secondary}">${x.completed}</div><div style="height:${Math.max(2, Math.round((x.completed / maxC) * 60))}px;background:${i === months.length - 1 ? COLOR.good : '#7dd3fc'};border-radius:2px 2px 0 0"></div><div style="font-size:11px;color:${COLOR.muted}">${esc(t('monthShort', { m: Number(x.label.slice(5, 7)) }))}</div></td>`).join('')}</tr></table>`
    : ''
  out.push(block(t('mail.execDone'), `<div style="font-size:28px;line-height:1.1">${num('closed.done.total', t('countN', { n: d.total }))}${deltaSpan(d.total, d.prevTotal, true)}</div>${bars}` + rows(
    row(t('leadMedian'), num('closed.done.leadMedianH', hours(t, d.leadMedianH))) +
    row(t('heldEnd'), num('closed.held.end', d && m.held.end != null ? t('countN', { n: m.held.end }) : t('noRecord'))),
  )))
  const c = m.cost
  out.push(block(t('costTitle'), rows(
    row(t('humanHours'), num('closed.cost.humanHours', c.humanHours > 0 ? t('hoursPeople', { h: Math.round(c.humanHours), p: c.people }) : t('noRecord'))) +
    row(t('humanCost'), num('closed.cost.humanCost', c.humanRateSet ? money(c.humanCost) : t('humanRateUnset'))) +
    row(t('aiActual'), num('closed.cost.aiActual', money(c.aiActual))) +
    row(t('perCompleted'), num('closed.cost.perCompleted', c.perCompleted == null ? '—' : money(c.perCompleted))),
  ) + `<div style="font-size:12px;color:${COLOR.muted};margin-top:6px">${esc(t('notionalNote', { v: money(c.aiNotional) }))}</div>`))
  out.push(projectsBlock(t, m, 'closed'))
  const r = m.risks
  if (r) {
    const lines: string[] = []
    if (r.concentration) lines.push(`<div style="font-size:14px;font-weight:700;color:${COLOR.text};margin:0 0 6px">⚠ ${esc(t('riskConcentration', { role: t(`role.${r.concentration.role}`), name: r.concentration.name, pct: pct(r.concentration.share) }))}</div>`)
    if (r.rejectRate != null && r.prevRejectRate != null && r.rejectRate - r.prevRejectRate >= 0.03) lines.push(`<div style="font-size:14px;font-weight:700;color:${COLOR.text};margin:0 0 6px">⚠ ${esc(t('riskReject', { v: pct(r.rejectRate), p: pct(r.prevRejectRate) }))}</div>`)
    out.push(block(t('riskTitle'), lines.length ? lines.join('') : `<div style="font-size:14px;color:${COLOR.secondary}">${esc(t('riskNone'))}</div>`))
  }
  return out.join('')
}

// ─── 조립 ───

export interface RenderInput {
  kind: MailKind
  /** 보고 대상(닫힌) 기간의 모델 */
  closed: ReportModel
  /** 주간 메일의 "지금" — 이번 주(진행 중) 모델. 월간·연간은 null */
  now: ReportModel | null
  recipient: { userId: string; name: string; locale?: string | null }
  /** 내 손에 있는 일 — 공유 범위와 무관하게 그 사람이 들고 있는 일(Git 담당자로 이미 볼 수 있는 일). 없으면 now 에서 찾는다 */
  mine?: HeldIssue[]
  money: (usd: number) => string
  baseUrl: string
}

export function periodText(t: T, m: ReportModel): string {
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
  const me = `u:${input.recipient.userId}`
  const mine = input.mine ?? (now?.held.issues ?? []).filter(i => i.personKey === me)
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
  if (kind === 'member') {
    parts.push(myIssuesBlock(t, mine, input.baseUrl))
    if (now) { parts.push(heldBlock(t, now, kind)); parts.push(actionsBlock(t, now)) }
    parts.push(doneBlock(t, closed, prevLabel, 'closed'))
  } else if (kind === 'lead') {
    if (now) { parts.push(heldBlock(t, now, kind)); parts.push(actionsBlock(t, now)); parts.push(peopleBlock(t, now)) }
    parts.push(projectsBlock(t, closed, 'closed'))
    parts.push(doneBlock(t, closed, prevLabel, 'closed'))
  } else {
    parts.push(execBlocks(t, closed, input.money))
  }
  if (input.baseUrl) parts.push(`<div style="margin:6px 0 16px"><a href="${esc(input.baseUrl)}" style="font-size:14px;font-weight:700;color:${COLOR.good}">${esc(t('mail.openReport'))} →</a></div>`)
  parts.push(`<div style="font-size:12px;color:${COLOR.muted};line-height:1.6">${esc(t('mail.footer'))}${closed.snapshotAt ? `<br>${esc(t('mail.snapshotNote', { at: closed.snapshotAt.slice(0, 16).replace('T', ' ') }))}` : ''}</div>`)

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
