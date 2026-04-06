'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { TaskExecution } from '@/types'
import MarqueeText from '@/components/ui/MarqueeText'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateShort, formatTimeWithSeconds } from '@/lib/format-date'

function formatDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  const s = Math.floor((end - start) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

interface Props {
  executions: TaskExecution[]
  showAgent?: boolean
  onKill?: (id: string) => void
  killing?: string | null
  scrollKey?: string
}

export default function ExecutionList({ executions, showAgent = true, onKill, killing, scrollKey }: Props) {
  const router = useRouter()
  const listRef = useRef<HTMLDivElement>(null)
  const te = useTranslations('execution')
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone

  // 마운트 시 저장된 스크롤 위치 복원
  useEffect(() => {
    if (!scrollKey || !listRef.current) return
    const saved = sessionStorage.getItem(`scroll-${scrollKey}`)
    if (saved) {
      const scrollParent = listRef.current.closest('[data-scroll-container]') || listRef.current.parentElement
      if (scrollParent) {
        requestAnimationFrame(() => { scrollParent.scrollTop = Number(saved) })
      }
    }
  }, [scrollKey])

  const saveScroll = () => {
    if (!scrollKey || !listRef.current) return
    const scrollParent = listRef.current.closest('[data-scroll-container]') || listRef.current.parentElement
    if (scrollParent) {
      sessionStorage.setItem(`scroll-${scrollKey}`, String(scrollParent.scrollTop))
    }
  }

  if (executions.length === 0) {
    return (
      <div className="text-center py-10 text-ive-text-dim text-sm">
        <i className="fa-solid fa-inbox text-2xl mb-2 block" />
        {te('noRecords')}
      </div>
    )
  }

  return (
    <div ref={listRef} className="space-y-2 p-3">
      {executions.map(ex => (
        <div
          key={ex.id}
          onClick={() => { saveScroll(); router.push(`/executions/${ex.id}`) }}
          className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3 hover:border-ive-green/40 transition-all cursor-pointer active:scale-[0.98]"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 min-w-0">
              {showAgent && ex.agentName && (
                <span className="text-xs font-bold text-ive-green/70 bg-ive-green/10 border border-ive-green/20 px-1.5 py-0.5 rounded shrink-0">
                  <i className="fa-solid fa-robot mr-0.5" />{ex.agentName}
                </span>
              )}
              <span className="text-sm font-bold text-ive-green">#{ex.issueIid}</span>
              <span className="text-xs font-mono font-bold text-ive-text-muted">{formatTimeWithSeconds(ex.startedAt, userLocale, userTz)}</span>
              {ex.modelName && (
                <span className="text-xs font-mono text-ive-cyan bg-ive-cyan/10 border border-ive-cyan/20 px-1 py-0.5 rounded shrink-0">
                  <i className="fa-solid fa-microchip mr-0.5" />{ex.modelName}
                </span>
              )}
            </div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              ex.status === 'running' ? 'bg-ive-amber/20 text-ive-amber animate-pulse' :
              ex.status === 'success' ? 'bg-ive-green/20 text-ive-green' :
              'bg-ive-red/20 text-ive-red'
            }`}>
              {ex.status === 'running' ? te('running') : ex.status === 'success' ? te('completed') : te('failed')}
            </span>
          </div>

          {ex.issueTitle && (
            <div className="mb-1">
              <MarqueeText className="text-sm text-ive-text font-bold">{ex.issueTitle}</MarqueeText>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-ive-text-dim">
            <span>
              <i className="fa-solid fa-calendar-day mr-0.5" />
              {formatDateShort(ex.startedAt, userLocale, userTz)}
            </span>
            <span className={`font-mono font-bold ${ex.status === 'running' ? 'text-ive-amber' : ''}`}>
              {formatDuration(ex.startedAt, ex.endedAt)}
            </span>
            {ex.turns > 0 && (
              <span><i className="fa-solid fa-rotate mr-0.5" />{ex.turns} {te('turns')}</span>
            )}
            {(ex.inputTokens + ex.outputTokens > 0) && (
              <span>{formatTokens(ex.inputTokens + ex.outputTokens)} tok</span>
            )}
            {ex.costUsd > 0 && (
              <span>${ex.costUsd.toFixed(4)}</span>
            )}
          </div>

          {ex.status === 'running' && onKill && (
            <div className="mt-2 pt-2 border-t border-ive-border-dark">
              <button
                onClick={(e) => { e.stopPropagation(); onKill(ex.id) }}
                disabled={killing === ex.id}
                className="w-full text-xs font-bold text-ive-red/70 border border-ive-red/30 px-2 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-red/10 transition-colors disabled:opacity-40"
              >
                {killing === ex.id
                  ? <i className="fa-solid fa-circle-notch fa-spin" />
                  : <><i className="fa-solid fa-skull-crossbones mr-1" />{te('forceStop')}</>
                }
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
