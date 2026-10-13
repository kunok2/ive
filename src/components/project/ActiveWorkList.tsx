'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { WORK_KINDS, STAGE_TONE, ageOf, ageText, type WorkKind } from '@/lib/active-work'
import MarqueeText from '@/components/ui/MarqueeText'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { ProgressLine } from '@/components/tabs/issues/IssueBadges'

export interface ActiveItem {
  key: string
  kind: WorkKind
  iid: number
  title: string
  /** 맡은 사람·에이전트 이름 */
  who?: string | null
  /** 아바타(에이전트는 도구 배지 포함) — 이름을 줄마다 보일 때만 쓴다 */
  avatar?: ReactNode
  /** 이 단계를 시작한 시각 — 모르면(라벨만 바뀐 경우) 경과를 쓰지 않는다 */
  startedAt?: string | null
  /** 본문 체크박스 진행률 — 있는 작업만 줄 아래에 막대로 */
  progress?: { done: number; total: number; percent: number } | null
  onClick: () => void
}

/**
 * 진행 중인 일 — 종류(처리 → 검증 → 확인 → 채팅)로 묶는다.
 * 한 묶음을 한 사람이 맡고 있으면 아바타·이름은 묶음 제목에 한 번만, 여럿이면 줄마다 보인다.
 * 사람은 아바타가 없어도 기본 사람 아이콘을 둔다(이름만 덩그러니 두지 않는다).
 * 줄은 「#번호 제목 · 경과」, 제목이 칸보다 길면 흐른다(MarqueeText — 긴 작업 이름을 끝까지 읽게, #64·#79). 묶음마다 maxPerKind 줄까지 보이고 나머지는 「더 보기」(onMore).
 */
// 아바타를 안 넘긴 사람 — 기본 사람 아이콘
const avatarOf = (it: ActiveItem) => it.avatar ?? (it.who ? <AgentAvatar avatar="person" size="sm" /> : null)

export default function ActiveWorkList({ items, maxPerKind = 3, onMore }: {
  items: ActiveItem[]
  maxPerKind?: number
  onMore?: (kind: WorkKind) => void
}) {
  const tp = useTranslations('project')
  // 경과는 분 단위로 보이므로 30초마다 다시 그리면 충분하다
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const groups = WORK_KINDS.map(kind => ({ kind, items: items.filter(i => i.kind === kind) })).filter(g => g.items.length > 0)
  if (groups.length === 0) return null

  return (
    <div className="border-t border-ive-border-dark px-3 py-2 flex flex-col gap-2.5">
      {groups.map(g => {
        const people = [...new Set(g.items.map(i => i.who || ''))]
        const singleWho = people.length === 1 && people[0] ? people[0] : null
        const shown = g.items.slice(0, maxPerKind)
        const rest = g.items.length - shown.length
        return (
          <div key={g.kind} className="flex flex-col">
            <div className="flex items-center gap-1.5 pb-1 mb-0.5 border-b border-ive-border-dark text-xs font-bold">
              <span className={`px-1.5 py-0.5 rounded-lg ${STAGE_TONE[g.kind].chip}`}>{tp(`activeKind.${g.kind}`)} {g.items.length}</span>
              {singleWho && avatarOf(g.items[0])}
              {singleWho && <span className="text-ive-text-secondary truncate">{singleWho}</span>}
            </div>
            {shown.map(it => {
              const age = it.startedAt ? ageOf(it.startedAt, now) : null
              return (
                <div key={it.key} className="flex flex-col">
                <button
                  type="button"
                  onClick={it.onClick}
                  className="flex items-center gap-1.5 min-h-8 text-xs font-bold text-left rounded-lg -mx-1 px-1 hover:bg-white/[0.04] transition-colors"
                >
                  {!singleWho && avatarOf(it)}
                  {!singleWho && it.who && <span className={`shrink-0 max-w-24 truncate ${STAGE_TONE[g.kind].text} opacity-80`}>{it.who}</span>}
                  <span className="shrink-0 font-bold text-ive-text-secondary">#{it.iid}</span>
                  <span className="flex-1 min-w-0"><MarqueeText className="text-ive-text-secondary">{it.title}</MarqueeText></span>
                  {age && (
                    <span className={`shrink-0 tabular-nums ${age.aged ? 'px-1.5 py-0.5 rounded-lg bg-ive-red/15 text-ive-red' : 'text-ive-text-secondary'}`}>
                      {ageText(tp, age)}
                    </span>
                  )}
                </button>
                {it.progress && <div className="pb-1"><ProgressLine p={it.progress} /></div>}
                </div>
              )
            })}
            {rest > 0 && (
              <button
                type="button"
                onClick={() => onMore?.(g.kind)}
                className="self-start min-h-7 text-xs font-bold text-ive-text-secondary hover:text-ive-text"
              >
                {tp('activeMore', { n: rest })} <i className="fa-solid fa-chevron-right text-[10px] ml-0.5" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
