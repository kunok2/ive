'use client'

import { useState, useEffect, useCallback } from 'react'
import Sparkline from '@/components/ui/Sparkline'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { useTranslations } from 'next-intl'
import type { StatSnapshot } from '@/types'

export interface VerifierSummary {
  username: string
  name: string
  avatar: string
  provider: string
  verifying: number
  verifyWaiting: number
  approvedToday: number
  rejectedToday: number
  approved7d: number
  rejected7d: number
  avgVerifyMin: number
  oldestWaitMin: number
  assignedProjects: { id: string; name: string; color: string; provider: string }[]
  iveUser: { id: string; name: string; email: string; avatar: string } | null
}

interface QueueItem {
  projectId: string
  projectName: string
  projectColor: string
  issueIid: number
  issueTitle: string
  stage: string
  waitingSince: string | null
}

interface Props {
  verifier: VerifierSummary
}

function fmtDur(min: number): string {
  if (!min) return '-'
  if (min < 60) return `${Math.round(min)}분`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`
}

export default function VerifierCard({ verifier }: Props) {
  const t = useTranslations('agent')
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true
    return sessionStorage.getItem(`vc-collapsed-${verifier.provider}-${verifier.username}`) !== 'false'
  })
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      sessionStorage.setItem(`vc-collapsed-${verifier.provider}-${verifier.username}`, String(next))
      return next
    })
  }
  type PanelKey = 'waiting' | 'verifying' | 'approved' | 'rejected' | 'stats'
  const [expandedPanel, _setExpandedPanel] = useState<PanelKey | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = sessionStorage.getItem(`vc-panel-${verifier.provider}-${verifier.username}`)
    const valid: PanelKey[] = ['waiting', 'verifying', 'approved', 'rejected', 'stats']
    return saved && (valid as string[]).includes(saved) ? (saved as PanelKey) : null
  })
  const setExpandedPanel = (v: PanelKey | null) => {
    _setExpandedPanel(v)
    if (v) sessionStorage.setItem(`vc-panel-${verifier.provider}-${verifier.username}`, v)
    else sessionStorage.removeItem(`vc-panel-${verifier.provider}-${verifier.username}`)
  }
  const [snapshots, setSnapshots] = useState<StatSnapshot[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])

  const fetchData = useCallback(async () => {
    try {
      const [snapRes, queueRes] = await Promise.all([
        fetch(`/api/verifiers/${encodeURIComponent(verifier.username)}/snapshots?mode=daily_avg`),
        fetch(`/api/verifiers/${encodeURIComponent(verifier.username)}/queue`),
      ])
      if (snapRes.ok) setSnapshots(await snapRes.json())
      if (queueRes.ok) {
        const data = await queueRes.json()
        setQueue(data.items || [])
      }
    } catch { /* ignore */ }
  }, [verifier.username])

  useEffect(() => {
    let cancelled = false
    void (async () => { if (!cancelled) await fetchData() })()
    const timer = setInterval(fetchData, 15000)
    const onVisible = () => { if (document.visibilityState === 'visible') void fetchData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [fetchData])

  const verifyingCount = verifier.verifying
  const waitingCount = verifier.verifyWaiting
  const totalBacklog = verifyingCount + waitingCount
  const isOverloaded = waitingCount >= 6
  const isTight = waitingCount >= 3 && !isOverloaded

  const cardBorder = isOverloaded
    ? 'border-ive-red/50 bg-ive-red/[0.03]'
    : isTight
      ? 'border-ive-amber/40'
      : expandedPanel ? 'border-ive-cyan/30' : 'border-ive-border-subtle'

  const waitingQueue = queue.filter(q => q.stage === 'verify_waiting')
  const verifyingQueue = queue.filter(q => q.stage === 'verifying')

  const providerIcon = verifier.provider === 'github' ? 'fa-github' : 'fa-gitlab'

  return (
    <div className={`bg-ive-bg-card rounded-lg border overflow-hidden transition-colors duration-200 ${cardBorder}`}>
      {/* 헤더 */}
      <div
        onClick={toggleCollapsed}
        className={`p-3 flex items-center justify-between cursor-pointer active:bg-white/[0.02] transition-colors ${collapsed ? '' : 'border-b border-ive-border-dark'}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <AgentAvatar avatar={verifier.avatar} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className="text-base font-bold text-ive-cyan truncate">{verifier.name}</span>
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-purple/20 text-ive-purple">
                <i className="fa-solid fa-user-check" />{t('verifierBadge')}
              </span>
              {verifier.iveUser ? (
                <span
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-green/15 text-ive-green border border-ive-green/30"
                  title={`IVE 사용자: ${verifier.iveUser.name} (${verifier.iveUser.email})`}
                >
                  <i className="fa-solid fa-circle-check" />IVE
                </span>
              ) : (
                <span
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-text-dim/10 text-ive-text-dim border border-ive-text-dim/20"
                  title="IVE에 가입하지 않은 Git 사용자"
                >
                  <i className="fa-solid fa-user-slash" />Git 전용
                </span>
              )}
            </div>
            <div className="text-sm font-bold text-ive-text-muted truncate">
              <i className={`fa-brands ${providerIcon} mr-1`} />@{verifier.username}
            </div>
            {collapsed && verifier.assignedProjects.length > 0 && (
              <div className="text-xs font-bold text-ive-text-dim mt-0.5 truncate">
                {verifier.assignedProjects.map(p => p.name).join(', ')}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {totalBacklog > 0 && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold ${
              isOverloaded ? 'bg-ive-red/20 text-ive-red' : isTight ? 'bg-ive-amber/20 text-ive-amber' : 'bg-ive-cyan/20 text-ive-cyan'
            }`}>
              <i className="fa-solid fa-clock" />{totalBacklog}
            </span>
          )}
          <i className={`fa-solid fa-chevron-down text-sm text-ive-text-dim transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </div>

      {!collapsed && <>
        {/* 정보 */}
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="text-ive-text-muted shrink-0"><i className={`fa-brands ${providerIcon} w-4 text-center`} /> Git ID</span>
            <span className="text-ive-text">@{verifier.username}</span>
          </div>

          {verifier.avgVerifyMin > 0 && (
            <div className="flex items-center gap-2 text-sm font-bold">
              <span className="text-ive-text-muted shrink-0"><i className="fa-solid fa-gauge w-4 text-center" /> {t('avgVerifyTime')}</span>
              <span className="text-ive-text">{fmtDur(verifier.avgVerifyMin)}</span>
              <span className="text-xs font-bold text-ive-text-dim">({t('avgVerifyTimeHint')})</span>
            </div>
          )}

          {verifier.oldestWaitMin > 0 && (
            <div className="flex items-center gap-2 text-sm font-bold">
              <span className="text-ive-text-muted shrink-0"><i className="fa-solid fa-hourglass-half w-4 text-center" /> {t('oldestWait')}</span>
              <span className={`${verifier.oldestWaitMin > 60 * 24 ? 'text-ive-red' : verifier.oldestWaitMin > 60 * 4 ? 'text-ive-amber' : 'text-ive-text'}`}>{fmtDur(verifier.oldestWaitMin)}</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="text-ive-text-muted shrink-0"><i className="fa-solid fa-plug w-4 text-center" /> {t('assigned')}</span>
            {verifier.assignedProjects.length === 0 ? (
              <span className="text-ive-text-dim">{t('notAssigned')}</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {verifier.assignedProjects.map(p => (
                  <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-dark">
                    <i className={`fa-brands ${p.provider === 'github' ? 'fa-github' : 'fa-gitlab'}`} style={{ color: p.color }} />
                    <span className="text-ive-text">{p.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 대시보드 통계 바 — 검증중/승인/반려/대기/통계 */}
        <div className="flex items-stretch border-t border-ive-border-dark">
          <button
            onClick={() => setExpandedPanel(expandedPanel === 'verifying' ? null : 'verifying')}
            className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'verifying' ? 'bg-ive-amber/5' : 'hover:bg-white/[0.02]'}`}
          >
            <span className={`text-sm font-bold ${verifyingCount > 0 ? 'text-ive-amber animate-pulse' : 'text-ive-text-dim'}`}>{verifyingCount}</span>
            <Sparkline data={snapshots.map(s => s.running)} width={40} height={12} color="amber" />
            <span className="text-xs text-ive-text-dim font-bold">{t('verifyingLabel')}</span>
          </button>

          <button
            onClick={() => setExpandedPanel(expandedPanel === 'approved' ? null : 'approved')}
            className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'approved' ? 'bg-ive-green/5' : 'hover:bg-white/[0.02]'}`}
          >
            <span className={`text-sm font-bold ${verifier.approvedToday > 0 ? 'text-ive-green' : 'text-ive-text-dim'}`}>{verifier.approvedToday}</span>
            <Sparkline data={snapshots.map(s => s.completed)} width={40} height={12} color="green" />
            <span className="text-xs text-ive-text-dim font-bold">{t('approvedLabel')}</span>
          </button>

          <button
            onClick={() => setExpandedPanel(expandedPanel === 'rejected' ? null : 'rejected')}
            className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'rejected' ? 'bg-ive-red/5' : 'hover:bg-white/[0.02]'}`}
          >
            <span className={`text-sm font-bold ${verifier.rejectedToday > 0 ? 'text-ive-red' : 'text-ive-text-dim'}`}>{verifier.rejectedToday}</span>
            <Sparkline data={snapshots.map(s => s.failed)} width={40} height={12} color="red" />
            <span className="text-xs text-ive-text-dim font-bold">{t('rejectedLabel')}</span>
          </button>

          <button
            onClick={() => setExpandedPanel(expandedPanel === 'waiting' ? null : 'waiting')}
            className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'waiting' ? 'bg-ive-cyan/5' : 'hover:bg-white/[0.02]'}`}
          >
            <span className={`text-sm font-bold ${isOverloaded ? 'text-ive-red animate-pulse' : isTight ? 'text-ive-amber' : waitingCount > 0 ? 'text-ive-cyan' : 'text-ive-text-dim'}`}>{waitingCount}</span>
            <Sparkline data={snapshots.map(s => s.waiting)} width={40} height={12} color="cyan" />
            <span className="text-xs text-ive-text-dim font-bold">{t('verifyWaitingLabel')}</span>
          </button>

          <button
            onClick={() => setExpandedPanel(expandedPanel === 'stats' ? null : 'stats')}
            className={`flex-1 py-2.5 px-2 flex flex-col items-center gap-0.5 transition-all ${expandedPanel === 'stats' ? 'bg-ive-cyan/5' : 'hover:bg-white/[0.02]'}`}
          >
            <i className={`fa-solid fa-chart-bar text-sm ${expandedPanel === 'stats' ? 'text-ive-cyan' : 'text-ive-text-dim'}`} />
            <Sparkline data={snapshots.map(s => s.waiting + s.running)} width={40} height={12} color="cyan" />
            <span className="text-xs text-ive-text-dim font-bold">{t('statsLabel')}</span>
          </button>
        </div>

        {/* 대기 패널 */}
        {expandedPanel === 'waiting' && (
          <div className="border-t border-ive-cyan/20">
            <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
              <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
                <i className="fa-solid fa-clock mr-1" />{t('verifyWaitingCount', { count: waitingQueue.length })}
              </span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-ive-border-dark">
              {waitingQueue.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm font-bold text-ive-text-dim">{t('noWaitingVerification')}</div>
              ) : (
                waitingQueue.map(item => (
                  <a
                    key={`${item.projectId}-${item.issueIid}`}
                    href={`/issues/${item.projectId}/${item.issueIid}`}
                    className="flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-xs font-bold text-ive-green shrink-0">#{item.issueIid}</span>
                    <span className="text-sm font-bold text-ive-text flex-1 truncate">{item.issueTitle || '(제목 없음)'}</span>
                    <span className="text-xs font-bold text-ive-text-dim truncate max-w-32">{item.projectName}</span>
                  </a>
                ))
              )}
            </div>
          </div>
        )}

        {/* 검증중 패널 */}
        {expandedPanel === 'verifying' && (
          <div className="border-t border-ive-amber/20">
            <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
              <span className="text-xs font-bold text-ive-amber uppercase tracking-widest">
                <i className="fa-solid fa-magnifying-glass mr-1" />{t('verifyingCount', { count: verifyingQueue.length })}
              </span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto divide-y divide-ive-border-dark">
              {verifyingQueue.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm font-bold text-ive-text-dim">{t('noVerifyingInProgress')}</div>
              ) : (
                verifyingQueue.map(item => (
                  <a
                    key={`${item.projectId}-${item.issueIid}`}
                    href={`/issues/${item.projectId}/${item.issueIid}`}
                    className="flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-xs font-bold text-ive-green shrink-0">#{item.issueIid}</span>
                    <span className="text-sm font-bold text-ive-text flex-1 truncate">{item.issueTitle || '(제목 없음)'}</span>
                    <span className="text-xs font-bold text-ive-text-dim truncate max-w-32">{item.projectName}</span>
                  </a>
                ))
              )}
            </div>
          </div>
        )}

        {/* 승인 패널 */}
        {expandedPanel === 'approved' && (
          <div className="border-t border-ive-green/20">
            <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
              <span className="text-xs font-bold text-ive-green uppercase tracking-widest">
                <i className="fa-solid fa-circle-check mr-1" />{t('approvedToday')}: {verifier.approvedToday}건 / {t('last7Days')}: {verifier.approved7d}건
              </span>
            </div>
          </div>
        )}

        {/* 반려 패널 */}
        {expandedPanel === 'rejected' && (
          <div className="border-t border-ive-red/20">
            <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
              <span className="text-xs font-bold text-ive-red uppercase tracking-widest">
                <i className="fa-solid fa-circle-xmark mr-1" />{t('rejectedToday')}: {verifier.rejectedToday}건 / {t('last7Days')}: {verifier.rejected7d}건
              </span>
            </div>
          </div>
        )}

        {/* 통계 패널 */}
        {expandedPanel === 'stats' && (
          <div className="border-t border-ive-cyan/20">
            <div className="px-3 py-2 bg-ive-bg-deep/50 border-b border-ive-border-dark">
              <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
                <i className="fa-solid fa-chart-bar mr-1" />{t('performanceStats')}
              </span>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2 text-sm font-bold">
              <div className="bg-ive-bg-deep rounded-lg p-2">
                <div className="text-xs font-bold text-ive-text-dim">{t('avgVerifyTime')}</div>
                <div className="text-ive-text">{fmtDur(verifier.avgVerifyMin)}</div>
              </div>
              <div className="bg-ive-bg-deep rounded-lg p-2">
                <div className="text-xs font-bold text-ive-text-dim">{t('oldestWait')}</div>
                <div className="text-ive-text">{fmtDur(verifier.oldestWaitMin)}</div>
              </div>
              <div className="bg-ive-bg-deep rounded-lg p-2">
                <div className="text-xs font-bold text-ive-text-dim">{t('last7Days')} {t('approvedLabel')}</div>
                <div className="text-ive-green">{verifier.approved7d}건</div>
              </div>
              <div className="bg-ive-bg-deep rounded-lg p-2">
                <div className="text-xs font-bold text-ive-text-dim">{t('last7Days')} {t('rejectedLabel')}</div>
                <div className="text-ive-red">{verifier.rejected7d}건</div>
              </div>
            </div>
          </div>
        )}
      </>}
    </div>
  )
}
