'use client'

import { useState, useEffect, useCallback } from 'react'
import { useStore } from '@/lib/store'
import AgentCard from '@/components/agent/AgentCard'
import VerifierCard, { type VerifierSummary } from '@/components/agent/VerifierCard'
import ConfirmModal from '@/components/ui/ConfirmModal'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useTranslations } from 'next-intl'

type FilterKey = 'all' | 'process' | 'verify' | 'confirm'

/** 예전 필터 값(worker/verifier) 호환 */
function readFilter(): FilterKey {
  const v = sessionStorage.getItem('agents-tab-filter')
  if (v === 'worker') return 'process'
  if (v === 'verifier') return 'verify'
  return v === 'process' || v === 'verify' || v === 'confirm' ? v : 'all'
}

export default function AgentsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, deleteAgent, refreshAgents } = useStore()
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>(() => {
    if (typeof window === 'undefined') return 'all'
    return readFilter()
  })
  const [verifiers, setVerifiers] = useState<VerifierSummary[]>([])
  const [verifiersLoaded, setVerifiersLoaded] = useState(false)
  const [confirmers, setConfirmers] = useState<VerifierSummary[]>([])
  const [processors, setProcessors] = useState<VerifierSummary[]>([])
  // 이름·아이디 검색과 더 보기 — 사람·에이전트가 많을 때 (한 번에 30장)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(30)
  const t = useTranslations('agent')
  const ta = useTranslations('automation')
  const tCommon = useTranslations('common')
  const tIssue = useTranslations('issue')

  const changeFilter = (k: FilterKey) => {
    setFilter(k)
    setShown(30)
    sessionStorage.setItem('agents-tab-filter', k)
  }

  const fetchVerifiers = useCallback(async () => {
    try {
      const [res, cRes, pRes] = await Promise.all([fetch('/api/verifiers'), fetch('/api/verifiers?role=confirm'), fetch('/api/verifiers?role=process')])
      if (res.ok) {
        setVerifiers(await res.json())
        setVerifiersLoaded(true)
      }
      if (cRes.ok) setConfirmers(await cRes.json())
      if (pRes.ok) setProcessors(await pRes.json())
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

  // #272: 프로젝트별 배정 폐기. 에이전트는 사용자 풀에 속하므로 특정 프로젝트와의 1:1 관계가 없다.
  // (실행 이력 기반의 "최근 작업 프로젝트" 표시는 후속 작업.)
  function getAssignedProjects(_agentId: string): { id: string; name: string; color: string; provider: string }[] {
    return []
  }

  // 역할별(역할은 프로젝트 역할 명부에서 정한다 — 카드의 「배정」 줄이 그 역할을 맡은 프로젝트):
  //   처리 = 모든 에이전트(의뢰자 풀·명부 처리 역할) + 처리 역할 사람, 검증·확인 = 그 역할의 사람 + 명부에서 그 역할을 가진 에이전트
  const verifyAgents = state.agents.filter(a => (a.roleSummary?.roles.verify || 0) > 0)
  const confirmAgents = state.agents.filter(a => (a.roleSummary?.roles.confirm || 0) > 0)
  const personKey = (v: VerifierSummary) => `${v.provider}:${v.username}`
  const verifierKeys = new Set(verifiers.map(personKey))
  const confirmOnly = confirmers.filter(c => !verifierKeys.has(personKey(c)))
  const confirmerKeys = new Set(confirmers.map(personKey))
  // 「전체」에는 사람을 한 번씩만 — 검증 카드 > 확인 카드 > 처리 카드 순으로 고른다
  const processOnly = processors.filter(p => !verifierKeys.has(personKey(p)) && !confirmerKeys.has(personKey(p)))
  const agentCount = state.agents.length
  const processCount = agentCount + processors.length
  const verifyCount = verifiers.length + verifyAgents.length
  const confirmCount = confirmers.length + confirmAgents.length
  const allCount = agentCount + verifiers.length + confirmOnly.length + processOnly.length
  const processBacklog = processors.reduce((s, v) => s + v.verifyWaiting + v.verifying, 0)
  const verifyBacklog = verifiers.reduce((s, v) => s + v.verifyWaiting + v.verifying, 0)
    + verifyAgents.reduce((s, a) => s + (a.roleSummary?.verifyWaiting || 0) + (a.roleSummary?.verifying || 0), 0)
  const confirmBacklog = confirmers.reduce((s, v) => s + v.verifyWaiting + v.verifying, 0)
    + confirmAgents.reduce((s, a) => s + (a.roleSummary?.confirmWaiting || 0) + (a.roleSummary?.confirming || 0), 0)
  const empty = state.agents.length === 0 && (verifiersLoaded && verifiers.length === 0 && confirmers.length === 0 && processors.length === 0)

  return (
    <PullToRefresh onRefresh={onRefresh} className="w-full flex-1 flex flex-col max-w-lg desk:max-w-[1360px] mx-auto px-4 desk:px-6 overflow-hidden">
      <div className="pt-4 shrink-0">
        {state.loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-ive-text-muted text-base">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl text-ive-green" />
            {t('loadingAgents')}
          </div>
        ) : empty ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-users-gear text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-2">{t('noAgents')}</p>
            <p className="text-sm text-ive-text-dim mb-5">{t('noAgentsHint')}</p>
            {onAdd && (
              <button
                data-tour="agents-empty-add"
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
            <div data-tour="agents-filter" className="flex gap-1 mb-3 desk:max-w-xl desk:mx-auto">
              {([
                { key: 'all', icon: '', label: t('filterAll'), count: allCount, backlog: 0 },
                { key: 'process', icon: 'fa-robot', label: ta('role_process'), count: processCount, backlog: processBacklog },
                { key: 'verify', icon: 'fa-user-check', label: ta('role_verify'), count: verifyCount, backlog: verifyBacklog },
                { key: 'confirm', icon: 'fa-circle-check', label: ta('role_confirm'), count: confirmCount, backlog: confirmBacklog },
              ] as { key: FilterKey; icon: string; label: string; count: number; backlog: number }[]).map(f => (
                <button
                  key={f.key}
                  onClick={() => changeFilter(f.key)}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${filter === f.key ? 'bg-ive-green text-ive-bg-deep' : 'bg-ive-bg-card text-ive-text-dim'}`}
                >
                  {f.icon && <i className={`fa-solid ${f.icon} mr-1`} />}{f.label} {f.count}
                  {f.backlog > 0 && (
                    <span className={`ml-1 inline-flex px-1.5 rounded-lg text-xs font-bold ${filter === f.key ? 'bg-ive-bg-deep/30 text-ive-bg-deep' : 'bg-ive-cyan/20 text-ive-cyan'}`}>{f.backlog}</span>
                  )}
                </button>
              ))}
            </div>
            {allCount > 8 && (
              <input type="text" value={query} onChange={e => { setQuery(e.target.value); setShown(30) }}
                placeholder={tIssue('searchMember')}
                className="w-full mb-3 desk:max-w-xl desk:mx-auto desk:block bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50" />
            )}
          </>
        )}
      </div>

      {!state.loading && !empty && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="pb-20 pad:pb-6">
          {(() => {
              // 정렬: 특이사항(대기/진행 중) 많은 순 → 이름순
              // Worker priority: pendingCount * 100 + (busy ? 10 : 0) + (offline ? -1000 : 0)
              // Verifier priority: (verifyWaiting + verifying) * 100
              type Item =
                | { kind: 'worker'; priority: number; name: string; agent: typeof state.agents[number] }
                | { kind: 'verifier'; priority: number; name: string; verifier: VerifierSummary; role: 'process' | 'verify' | 'confirm' }

              const items: Item[] = []
              const pushAgent = (a: typeof state.agents[number], backlog: number) => {
                const statusScore = a.status === 'busy' ? 10 : a.status === 'offline' ? -1000 : 0
                items.push({ kind: 'worker', priority: backlog * 100 + statusScore, name: a.name, agent: a })
              }
              const pushPerson = (v: VerifierSummary, role: 'process' | 'verify' | 'confirm') =>
                items.push({ kind: 'verifier', priority: (v.verifyWaiting + v.verifying) * 100, name: v.name, verifier: v, role })
              if (filter === 'all' || filter === 'process') {
                for (const a of state.agents) pushAgent(a, a.pendingCount || 0)
              }
              if (filter === 'verify') {
                for (const a of verifyAgents) pushAgent(a, (a.roleSummary?.verifyWaiting || 0) + (a.roleSummary?.verifying || 0))
              }
              if (filter === 'confirm') {
                for (const a of confirmAgents) pushAgent(a, (a.roleSummary?.confirmWaiting || 0) + (a.roleSummary?.confirming || 0))
              }
              if (filter === 'all' || filter === 'verify') for (const v of verifiers) pushPerson(v, 'verify')
              if (filter === 'confirm') for (const v of confirmers) pushPerson(v, 'confirm')
              if (filter === 'all') for (const v of confirmOnly) pushPerson(v, 'confirm')
              if (filter === 'process') for (const v of processors) pushPerson(v, 'process')
              if (filter === 'all') for (const v of processOnly) pushPerson(v, 'process')
              // 이름·아이디 검색 (검색어가 없으면 전부)
              const q = query.trim().toLowerCase()
              const shownItems = q
                ? items.filter(it => it.name.toLowerCase().includes(q) || (it.kind === 'verifier' ? it.verifier.username : it.agent.id).toLowerCase().includes(q))
                : items
              shownItems.sort((a, b) => {
                if (a.priority !== b.priority) return b.priority - a.priority
                return a.name.localeCompare(b.name)
              })

              return (
                // PC 3열 — 카드 폭은 폰과 같게 두고 칸 수만 늘린다(폰·패드는 1열 가운데)
                <div className="flex flex-col gap-3 desk:grid desk:grid-cols-3 desk:items-start">
                  {shownItems.slice(0, shown).map(item => item.kind === 'worker' ? (
                    <AgentCard
                      key={`w-${item.agent.id}`}
                      agent={item.agent}
                      onDelete={(id) => setDeleteAgentId(id)}
                      assignedProjects={getAssignedProjects(item.agent.id)}
                    />
                  ) : (
                    <VerifierCard
                      key={`${item.role}-${item.verifier.provider}-${item.verifier.username}`}
                      verifier={item.verifier}
                      role={item.role}
                    />
                  ))}
                  {shownItems.length > shown && (
                    <button type="button" onClick={() => setShown(n => n + 30)}
                      className="w-full desk:col-span-full py-2 text-sm font-bold text-ive-cyan border border-ive-cyan/30 rounded-lg hover:bg-ive-cyan/10 transition-all">
                      {ta('showMore', { count: shownItems.length - shown })}
                    </button>
                  )}
                  {filter === 'verify' && verifiersLoaded && verifyCount === 0 && (
                    <div className="desk:col-span-full text-center py-8 text-sm font-bold text-ive-text-dim">
                      <i className="fa-solid fa-user-check text-2xl text-ive-text-dim mb-2 block" />
                      {t('noVerifiers')}
                    </div>
                  )}
                  {filter === 'confirm' && verifiersLoaded && confirmCount === 0 && (
                    <div className="desk:col-span-full text-center py-8 text-sm font-bold text-ive-text-dim">
                      <i className="fa-solid fa-circle-check text-2xl text-ive-text-dim mb-2 block" />
                      {ta('noConfirmers')}
                    </div>
                  )}
                  {filter === 'process' && processCount === 0 && (
                    <div className="desk:col-span-full text-center py-8 text-sm font-bold text-ive-text-dim">
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
