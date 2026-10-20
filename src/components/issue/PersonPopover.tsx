'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { useStore } from '@/lib/store'
import { formatDateShort } from '@/lib/format-date'

/** 아바타를 누른 대상 — 사람(IVE 사용자·Git 계정) 또는 에이전트 한 명 */
export interface ProfileTarget {
  /** 이 작업에서 맡은 역할 이름(작성자·처리자·검증자·확인자) */
  roleLabel: string
  agentId?: string | null
  /** IVE 사용자 id */
  userId?: string | null
  /** Git 계정 이름 */
  username?: string | null
  name?: string | null
  /** 화면에 이미 그려진 아바타(URL·'av-XX'·'cli-…') — 정보를 불러오는 동안 먼저 큰 그림으로 보인다 */
  avatar?: string | null
}

interface Card {
  kind: 'person' | 'agent'
  name: string
  avatar: string | null
  userId?: string | null
  linked?: boolean
  email?: string | null
  memberSince?: string | null
  gitUsername?: string | null
  gitUrl?: string | null
  cliName?: string | null
  model?: string | null
  stats?: { days: number; verify: number; confirm: number; rejected: number } | null
}

const CACHE_MS = 60_000
const cache = new Map<string, { at: number; card: Card }>()

function keyOf(projectId: string, t: ProfileTarget): string {
  return [projectId, t.agentId ?? '', t.userId ?? '', t.username ?? '', t.name ?? ''].join('|')
}

async function loadCard(projectId: string, t: ProfileTarget): Promise<Card> {
  const key = keyOf(projectId, t)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.card
  const qs = new URLSearchParams()
  if (t.agentId) qs.set('agentId', t.agentId)
  if (t.userId) qs.set('userId', t.userId)
  if (t.username) qs.set('username', t.username)
  if (t.name) qs.set('name', t.name)
  const res = await fetch(`/api/projects/${projectId}/profile-card?${qs}`)
  if (!res.ok) throw new Error(String(res.status))
  const card = await res.json() as Card
  cache.set(key, { at: Date.now(), card })
  return card
}

const WIDTH = 288
const GAP = 8
const MARGIN = 12

interface Props {
  projectId: string
  target: ProfileTarget
  /** 아바타 그림 — 그대로 누르는 면이 된다 */
  children: ReactNode
  /** 누르는 면(버튼)의 클래스 — 아바타 둥근 틀·테두리 */
  className: string
  title?: string
  /** 있으면 카드 아래에 「변경」 단추를 둔다 — 지정·변경 창을 여는 동작 */
  onChange?: () => void
}

/**
 * 작업 상세의 아바타를 누르면 그 사람(또는 에이전트)의 간단한 정보를 큰 아바타와 함께 띄운다.
 * 바깥을 누르거나 Esc·스크롤하면 닫힌다. 팝오버는 Portal 로 그려 칩의 overflow 에 잘리지 않는다.
 */
export default function PersonPopover({ projectId, target, children, className, title, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [failed, setFailed] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef(target)
  useEffect(() => { targetRef.current = target })

  const place = useCallback(() => {
    const b = btnRef.current
    if (!b) return
    const r = b.getBoundingClientRect()
    const h = popRef.current?.offsetHeight ?? 0
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - MARGIN)
    // 아래 공간이 모자라고 위가 넉넉하면 위로 띄운다
    const below = r.bottom + GAP
    const top = h && below + h > window.innerHeight - MARGIN && r.top - GAP - h > MARGIN ? r.top - GAP - h : below
    setPos({ left, top })
  }, [])

  useEffect(() => {
    if (!open) return
    let alive = true
    loadCard(projectId, targetRef.current).then(c => { if (alive) setCard(c) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [open, projectId])

  // 내용(정보)이 채워져 높이가 바뀌면 다시 자리를 잡는다
  useLayoutEffect(() => { if (open) place() }, [open, card, failed, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node
      if (popRef.current?.contains(n) || btnRef.current?.contains(n)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={e => { e.stopPropagation(); if (!open) { setCard(null); setFailed(false) } setOpen(o => !o) }}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={className}
      >
        {children}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          // Portal 이라도 React 이벤트는 부모 트리로 올라간다 — 카드(=작업 상세로 가는 면) 안에서 열렸을 때 카드 클릭으로 새지 않게
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-label={target.name ?? target.roleLabel}
          style={{ position: 'fixed', width: WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          className="z-50 bg-ive-bg-solid border border-ive-border-subtle rounded-lg shadow-lg p-4"
        >
          <CardBody target={target} card={card} failed={failed} onChange={onChange ? () => { setOpen(false); onChange() } : undefined} />
        </div>,
        document.body,
      )}
    </>
  )
}

function CardBody({ target, card, failed, onChange }: { target: ProfileTarget; card: Card | null; failed: boolean; onChange?: () => void }) {
  const t = useTranslations('issue')
  const { state } = useStore()
  const isAgent = card ? card.kind === 'agent' : !!target.agentId
  const name = card?.name || target.name || (isAgent && card ? t('profileAgentGone') : '-')
  // 불러오는 동안은 이미 그려진 아바타를, 다 불러오면 서버가 알려 준 아바타를(IVE 사용자의 업로드 사진 포함) 쓴다
  const avatar = (card?.avatar || target.avatar) || (isAgent ? 'av-01' : 'person')
  const kind = !card ? null : isAgent ? t('profileKindAgent') : card.linked ? t('profileKindUser') : t('profileKindGit')
  const rows: { label: string; value: ReactNode }[] = []
  if (card) {
    if (card.email) rows.push({ label: t('profileEmail'), value: <span className="break-all">{card.email}</span> })
    if (card.gitUsername) rows.push({
      label: t('profileGit'),
      value: card.gitUrl
        ? <a href={card.gitUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">@{card.gitUsername}</a>
        : <>@{card.gitUsername}</>,
    })
    if (card.cliName) rows.push({ label: t('profileCli'), value: card.cliName })
    if (card.model) rows.push({ label: t('profileModel'), value: <span className="break-all">{card.model}</span> })
    if (card.memberSince) rows.push({ label: t('profileSince'), value: formatDateShort(card.memberSince, state.user?.locale, state.user?.timezone) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <AgentAvatar avatar={avatar} userId={card?.userId} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-ive-text truncate">{name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-white/5 text-ive-text-secondary border border-ive-border-subtle">{target.roleLabel}</span>
            {kind && <span className="text-xs font-bold text-ive-text-muted">{kind}</span>}
          </div>
        </div>
      </div>

      {!card && !failed && (
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="h-3 rounded-lg bg-white/5 animate-pulse" />
          <div className="h-3 w-2/3 rounded-lg bg-white/5 animate-pulse" />
        </div>
      )}
      {failed && <div className="text-xs font-bold text-ive-text-muted">{t('profileLoadFailed')}</div>}

      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(r => (
            <div key={r.label} className="contents">
              <dt className="font-bold text-ive-text-muted">{r.label}</dt>
              <dd className="font-bold text-ive-text-secondary min-w-0">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card && card.kind === 'person' && (
        card.stats ? (
          <div className="bg-ive-bg/50 border border-ive-border-dark rounded-lg p-3">
            <div className="text-xs font-bold text-ive-text-muted">{t('profileStatsTitle', { days: card.stats.days })}</div>
            <div className="mt-1 text-sm font-bold text-ive-text tabular-nums">
              {t('profileStatVerify', { n: card.stats.verify })} · {t('profileStatConfirm', { n: card.stats.confirm })} · {t('profileStatRejected', { n: card.stats.rejected })}
            </div>
          </div>
        ) : (
          <div className="text-xs font-bold text-ive-text-muted">{t('profileNotLinked')}</div>
        )
      )}

      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="bg-white/5 text-ive-text-muted font-bold text-sm px-3 py-2 rounded-lg border border-ive-border-subtle hover:opacity-80"
        >
          {t('profileChange', { role: target.roleLabel })}
        </button>
      )}
    </div>
  )
}
