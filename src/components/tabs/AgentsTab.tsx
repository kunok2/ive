'use client'

import { useState, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import AgentCard from '@/components/agent/AgentCard'
import VerifierCard, { type VerifierSummary } from '@/components/agent/VerifierCard'
import ConfirmModal from '@/components/ui/ConfirmModal'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useTranslations } from 'next-intl'

type FilterKey = 'all' | 'worker' | 'verifier'

export default function AgentsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, deleteAgent, refreshAgents } = useStore()
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>(() => {
    if (typeof window === 'undefined') return 'all'
    return (sessionStorage.getItem('agents-tab-filter') as FilterKey) || 'all'
  })
  const [verifiers, setVerifiers] = useState<VerifierSummary[]>([])
  const [verifiersLoaded, setVerifiersLoaded] = useState(false)
  const t = useTranslations('agent')
  const tCommon = useTranslations('common')

  const changeFilter = (k: FilterKey) => {
    setFilter(k)
    sessionStorage.setItem('agents-tab-filter', k)
  }

  const fetchVerifiers = useCallback(async () => {
    try {
      const res = await fetch('/api/verifiers')
      if (res.ok) {
        setVerifiers(await res.json())
        setVerifiersLoaded(true)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => { if (!cancelled) await fetchVerifiers() })()
    const timer = setInterval(fetchVerifiers, 20000)
    const onVisible = () => { if (document.visibilityState === 'visible') void fetchVerifiers() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [fetchVerifiers])

  const onRefresh = async () => {
    await Promise.all([refreshAgents(), fetchVerifiers()])
  }

  function getAssignedProjects(agentId: string): { id: string; name: string; color: string; provider: string }[] {
    const result: { id: string; name: string; color: string; provider: string }[] = []
    for (const project of state.projects) {
      if (project.assignedAgents?.some(pa => pa.agentId === agentId)) {
        result.push({ id: project.id, name: project.name, color: project.color, provider: project.provider })
      }
    }
    return result
  }

  const agentCount = state.agents.length
  const verifierCount = verifiers.length
  const totalBacklog = verifiers.reduce((s, v) => s + v.verifyWaiting + v.verifying, 0)
  const showWorkers = filter === 'all' || filter === 'worker'
  const showVerifiers = filter === 'all' || filter === 'verifier'
  const empty = state.agents.length === 0 && (verifiersLoaded && verifiers.length === 0)

  return (
    <PullToRefresh onRefresh={onRefresh} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden">
      <div className="pt-4 shrink-0">
        {state.loading ? (
          <div className="text-center py-20 text-ive-text-muted text-base">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl text-ive-green mb-3 block" />
            {t('loadingAgents')}
          </div>
        ) : empty ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-users-gear text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-2">{t('noAgents')}</p>
            <p className="text-sm text-ive-text-dim mb-5">{t('noAgentsHint')}</p>
            {onAdd && (
              <button
                onClick={onAdd}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-lg active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-plus" />{t('addDeveloper')}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* 필터 탭 — ReportsTab과 동일 스타일 */}
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => changeFilter('all')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${filter === 'all' ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-dim'}`}
              >
                {t('filterAll')} {agentCount + verifierCount}
              </button>
              <button
                onClick={() => changeFilter('worker')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${filter === 'worker' ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-dim'}`}
              >
                <i className="fa-solid fa-robot mr-1" />{t('filterWorkers')} {agentCount}
              </button>
              <button
                onClick={() => changeFilter('verifier')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${filter === 'verifier' ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-dim'}`}
              >
                <i className="fa-solid fa-user-check mr-1" />{t('filterVerifiers')} {verifierCount}
                {totalBacklog > 0 && (
                  <span className={`ml-1 inline-flex px-1.5 rounded-lg text-xs font-bold ${filter === 'verifier' ? 'bg-ive-bg-deep/30 text-ive-bg-deep' : 'bg-ive-cyan/20 text-ive-cyan'}`}>{totalBacklog}</span>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {!state.loading && !empty && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="pb-20">
          {(() => {
              // 정렬: 특이사항(대기/진행 중) 많은 순 → 이름순
              // Worker priority: pendingCount * 100 + (busy ? 10 : 0) + (offline ? -1000 : 0)
              // Verifier priority: (verifyWaiting + verifying) * 100
              type Item =
                | { kind: 'worker'; priority: number; name: string; agent: typeof state.agents[number] }
                | { kind: 'verifier'; priority: number; name: string; verifier: VerifierSummary }

              const items: Item[] = []
              if (showWorkers) {
                for (const a of state.agents) {
                  const pending = a.pendingCount || 0
                  const statusScore = a.status === 'busy' ? 10 : a.status === 'offline' ? -1000 : 0
                  items.push({ kind: 'worker', priority: pending * 100 + statusScore, name: a.name, agent: a })
                }
              }
              if (showVerifiers) {
                for (const v of verifiers) {
                  items.push({ kind: 'verifier', priority: (v.verifyWaiting + v.verifying) * 100, name: v.name, verifier: v })
                }
              }
              items.sort((a, b) => {
                if (a.priority !== b.priority) return b.priority - a.priority
                return a.name.localeCompare(b.name)
              })

              return (
                <div className="flex flex-col gap-3">
                  {items.map(item => item.kind === 'worker' ? (
                    <AgentCard
                      key={`w-${item.agent.id}`}
                      agent={item.agent}
                      onDelete={(id) => setDeleteAgentId(id)}
                      assignedProjects={getAssignedProjects(item.agent.id)}
                    />
                  ) : (
                    <VerifierCard key={`v-${item.verifier.provider}-${item.verifier.username}`} verifier={item.verifier} />
                  ))}
                  {showVerifiers && verifiersLoaded && verifiers.length === 0 && filter !== 'all' && (
                    <div className="text-center py-8 text-sm font-bold text-ive-text-dim">
                      <i className="fa-solid fa-user-check text-2xl text-ive-text-dim mb-2 block" />
                      {t('noVerifiers')}
                    </div>
                  )}
                  {showWorkers && state.agents.length === 0 && filter !== 'all' && (
                    <div className="text-center py-8 text-sm font-bold text-ive-text-dim">
                      <i className="fa-solid fa-robot text-2xl text-ive-text-dim mb-2 block" />
                      {t('noAgents')}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteAgentId !== null}
        onClose={() => setDeleteAgentId(null)}
        onConfirm={async () => {
          if (deleteAgentId) {
            await deleteAgent(deleteAgentId)
            setDeleteAgentId(null)
          }
        }}
        title={t('deleteAgent')}
        message={t('deleteAgentConfirm')}
        confirmLabel={tCommon('delete')}
        danger
      />
    </PullToRefresh>
  )
}
