'use client'

import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import type { ReportData, ReportHelpers } from './types'

// 사용자처럼 고유색이 없는 항목용 팔레트 (브랜드 시안 우선 + 구분 가능한 색들)
const PALETTE = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#facc15']
const OTHER_COLOR = '#52525b' // ive-text-dim
const MAX = 7

interface ShareItem {
  id: string
  name: string
  value: number
  color: string
  icon?: React.ReactNode
}

/** value 내림차순 정렬 → 상위 MAX + 기타 묶기 */
function buildItems<T>(
  rows: T[],
  getVal: (r: T) => number,
  getId: (r: T) => string,
  getName: (r: T) => string,
  getColor: (r: T, idx: number) => string,
  getIcon: (r: T) => React.ReactNode,
  othersLabel: (count: number) => string,
): { items: ShareItem[]; total: number } {
  const valued = rows.map(r => ({ r, v: getVal(r) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v)
  const total = valued.reduce((s, x) => s + x.v, 0)
  const head = valued.slice(0, MAX)
  const rest = valued.slice(MAX)
  const items: ShareItem[] = head.map((x, idx) => ({
    id: getId(x.r), name: getName(x.r), value: x.v, color: getColor(x.r, idx), icon: getIcon(x.r),
  }))
  if (rest.length > 0) {
    items.push({
      id: '__other__', name: othersLabel(rest.length),
      value: rest.reduce((s, x) => s + x.v, 0), color: OTHER_COLOR,
    })
  }
  return { items, total }
}

/**
 * 비중 막대 — 전체 합 대비 각 항목의 비율을 막대 길이로 비교.
 * 항목이 1개여도 꽉 찬 막대로 자연스럽고, 여러 개면 길이로 순위/비중이 한눈에 보인다.
 */
function ShareBars({ title, items, total, formatValue }: { title: string; items: ShareItem[]; total: number; formatValue: (n: number) => string }) {
  if (items.length === 0) return null
  return (
    <section className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
      <div className="text-xs font-bold text-ive-text-dim mb-2.5 uppercase tracking-wider">{title}</div>
      <div className="space-y-2">
        {items.map(it => {
          const pct = total > 0 ? Math.round((it.value / total) * 100) : 0
          const barW = total > 0 ? Math.max((it.value / total) * 100, 2) : 0
          return (
            <div key={it.id}>
              <div className="flex items-center gap-1.5 text-xs mb-1">
                {it.icon}
                <span className="truncate flex-1 min-w-0 text-ive-text font-bold">{it.name}</span>
                <span className="font-bold text-ive-text shrink-0">{formatValue(it.value)}</span>
                <span className="text-ive-text-dim shrink-0 w-9 text-right">{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-ive-bg-deep overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${barW}%`, backgroundColor: it.color }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface ShareProps {
  data: ReportData
  helpers: ReportHelpers
}

/** 프로젝트별 비용 비중 — "프로젝트별 흐름" 섹션 바로 아래에 둔다. */
export function ProjectCostShare({ data, helpers }: ShareProps) {
  const tr = useTranslations('report')
  const { items, total } = buildItems(
    data.byProject ?? [],
    p => p.cost,
    p => p.projectId,
    p => p.projectName,
    (p) => p.projectColor || '#22d3ee',
    (p) => p.projectAvatarUrl
      ? <img src={p.projectAvatarUrl} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
      : <i className={`fa-brands ${p.projectProvider === 'github' ? 'fa-github' : 'fa-gitlab'} text-[11px] shrink-0`} style={{ color: p.projectColor || '#4ade80' }} />,
    (count) => tr('distOthers', { count }),
  )
  return <ShareBars title={tr('distProjectCostTitle')} items={items} total={total} formatValue={helpers.fmtCost} />
}

/** 작업자별 검증 완료(승인+반려) 비중 — "담당자별 검증 현황" 섹션 바로 아래에 둔다. */
export function UserWorkShare({ data, helpers: _helpers }: ShareProps) {
  const tr = useTranslations('report')
  const users = (data.byUser ?? []).map(u => ({ ...u, work: (u.verifyApproved || 0) + (u.verifyRejected || 0) }))
  const { items, total } = buildItems(
    users,
    u => u.work,
    u => u.userId,
    u => u.userName,
    (_u, idx) => PALETTE[idx % PALETTE.length],
    (u) => u.userAvatar === 'photo' && (u.avatarUserId || u.userId)
      ? <img src={`/api/auth/avatar/image?id=${u.avatarUserId || u.userId}`} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
      : u.userAvatar
        ? <AgentAvatar avatar={u.userAvatar} size="xs" />
        : <i className="fa-solid fa-user text-[10px] text-ive-text-dim shrink-0" />,
    (count) => tr('distOthers', { count }),
  )
  return <ShareBars title={tr('distUserWorkTitle')} items={items} total={total} formatValue={(n) => tr('itemsUnit', { count: n })} />
}
