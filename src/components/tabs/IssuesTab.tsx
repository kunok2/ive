'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'

interface IveIssue {
  iid: number
  title: string
  stage: string
  state: string
  labels: string[]
  createdAt: string
  updatedAt: string
  author: string
}

const STAGE_INFO: Record<string, { label: string; color: string; icon: string }> = {
  waiting:    { label: '대기',     color: 'bg-ive-green/20 text-ive-green border-ive-green/30', icon: 'fa-clock' },
  dev:        { label: '개발 중',  color: 'bg-ive-cyan/20 text-ive-cyan border-ive-cyan/30', icon: 'fa-code' },
  dev_fail:   { label: '개발 실패', color: 'bg-ive-red/20 text-ive-red border-ive-red/30', icon: 'fa-circle-xmark' },
  validation: { label: '검증 대기', color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30', icon: 'fa-flask' },
  val_fail:   { label: '검증 실패', color: 'bg-ive-red/20 text-ive-red border-ive-red/30', icon: 'fa-triangle-exclamation' },
  done:       { label: '완료',     color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: 'fa-circle-check' },
  unknown:    { label: '알 수 없음', color: 'bg-white/10 text-ive-text-dim border-white/20', icon: 'fa-question' },
}

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '진행' },
  { key: 'failed', label: '실패' },
  { key: 'done', label: '완료' },
]

// 벌크 액션 정의
const BULK_ACTIONS: Record<string, { action: string; label: string; icon: string; danger?: boolean }[]> = {
  waiting: [],
  dev: [
    { action: 'cancel', label: '대기로', icon: 'fa-rotate-left', danger: true },
  ],
  dev_fail: [
    { action: 'retry', label: '대기로 (재시도)', icon: 'fa-rotate' },
  ],
  validation: [
    { action: 'reject', label: '대기로 (반려)', icon: 'fa-rotate-left', danger: true },
  ],
  val_fail: [
    { action: 'revalidate', label: '재검증', icon: 'fa-flask' },
    { action: 'retry', label: '대기로 (재개발)', icon: 'fa-rotate' },
  ],
  done: [
    { action: 'revalidate', label: '재검증', icon: 'fa-flask' },
    { action: 'reopen', label: '대기로 (다시 열기)', icon: 'fa-rotate' },
  ],
}

export default function IssuesTab() {
  const router = useRouter()
  const { state } = useStore()
  const { issuesProjectId, setIssuesProjectId, issuesFilter, setIssuesFilter } = useTab()
  const selectedProjectId = issuesProjectId ?? ''
  const filter = issuesFilter
  const [issues, setIssues] = useState<IveIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkProgress, setBulkProgress] = useState<{ total: number; done: number; failed: number } | null>(null)
  const cancelRef = useRef(false)

  const setSelectedProjectId = (id: string) => setIssuesProjectId(id)
  const setFilter = (f: string) => setIssuesFilter(f)

  const toggleSelect = (iid: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(iid)) next.delete(iid)
      else next.add(iid)
      return next
    })
  }

  const exitBulkMode = () => {
    setBulkMode(false)
    setSelected(new Set())
    setBulkProgress(null)
  }

  // 프로젝트가 1개면 자동 선택
  useEffect(() => {
    if (state.projects.length === 1 && !selectedProjectId) {
      setSelectedProjectId(state.projects[0].id)
    }
  }, [state.projects, selectedProjectId])

  const fetchIssues = useCallback(() => {
    if (!selectedProjectId) return
    setLoading(true)
    fetch(`/api/projects/${selectedProjectId}/issues`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setIssues(data))
      .finally(() => setLoading(false))
  }, [selectedProjectId])

  useEffect(() => { fetchIssues() }, [fetchIssues])

  const filtered = issues.filter(issue => {
    if (filter === 'all') return true
    if (filter === 'active') return ['waiting', 'dev', 'validation'].includes(issue.stage)
    if (filter === 'failed') return ['dev_fail', 'val_fail'].includes(issue.stage)
    if (filter === 'done') return issue.stage === 'done'
    return true
  })

  // 선택된 이슈들의 공통 stage 기반 벌크 액션 계산
  const getAvailableBulkActions = () => {
    if (selected.size === 0) return []
    const selectedIssues = issues.filter(i => selected.has(i.iid))
    const stages = new Set(selectedIssues.map(i => i.stage))
    if (stages.size !== 1) return []
    return BULK_ACTIONS[[...stages][0]] || []
  }

  const selectedStages = () => {
    const selectedIssues = issues.filter(i => selected.has(i.iid))
    return new Set(selectedIssues.map(i => i.stage))
  }

  const handleBulkAction = async (action: string) => {
    if (selected.size === 0) return
    const selectedIssues = issues.filter(i => selected.has(i.iid))
    const stage = selectedIssues[0].stage
    cancelRef.current = false
    setBulkProgress({ total: selectedIssues.length, done: 0, failed: 0 })

    let done = 0
    let failed = 0
    for (const issue of selectedIssues) {
      if (cancelRef.current) break
      try {
        const res = await fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage, action }),
        })
        if (!res.ok) failed++
        else done++
      } catch {
        failed++
      }
      setBulkProgress({ total: selectedIssues.length, done: done + failed, failed })
    }

    // 완료 후 새로고침
    fetchIssues()
    setTimeout(() => {
      exitBulkMode()
    }, cancelRef.current ? 500 : 1000)
  }

  const handleCancel = () => {
    cancelRef.current = true
  }

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(i => i.iid)))
  }

  const selectedProject = state.projects.find(p => p.id === selectedProjectId)
  const bulkActions = getAvailableBulkActions()
  const stages = selectedStages()

  return (
    <div className="min-h-screen pb-20">
      <main className="px-4 py-4 max-w-lg mx-auto">
        {state.projects.length > 1 && (
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="w-full mb-4 bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3 text-ive-text font-bold text-base focus:outline-none focus:border-ive-green/50"
          >
            <option value="">프로젝트 선택</option>
            {state.projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}

        {!selectedProjectId ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted">프로젝트를 선택하세요</p>
          </div>
        ) : (
          <>
            {selectedProject && (
              <div className="flex items-center gap-3 mb-4 bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3"
                   style={{ borderLeftWidth: '3px', borderLeftColor: selectedProject.color || '#4ade80' }}>
                <i className={`fa-brands ${selectedProject.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xl`}
                   style={{ color: selectedProject.color || '#4ade80' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold text-ive-text truncate">{selectedProject.name}</div>
                  <div className="text-xs text-ive-text-dim truncate">{selectedProject.repoUrl}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-lg font-black text-ive-green-light">{issues.length}</div>
                    <div className="text-xs text-ive-text-dim">이슈</div>
                  </div>
                  {issues.length > 0 && !bulkMode && (
                    <button
                      onClick={() => setBulkMode(true)}
                      className="w-8 h-8 rounded-full bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-text hover:border-ive-green/30 transition-all"
                      title="일괄 수정"
                    >
                      <i className="fa-solid fa-list-check text-sm" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-1 mb-4 bg-ive-bg-card rounded-xl p-1 border border-ive-border-subtle">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setFilter(tab.key); setSelected(new Set()) }}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                    filter === tab.key
                      ? 'bg-ive-green/20 text-ive-green'
                      : 'text-ive-text-dim hover:text-ive-text-muted'
                  }`}
                >
                  {tab.label}
                  {tab.key === 'all' && issues.length > 0 && (
                    <span className="ml-1 text-xs opacity-60">{issues.length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* 벌크 모드 툴바 */}
            {bulkMode && (
              <div className="mb-3 bg-ive-bg-card border border-ive-amber/30 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleSelectAll}
                      className="w-7 h-7 rounded-lg border flex items-center justify-center transition-all bg-ive-bg-deep border-ive-border-dark text-ive-text-dim hover:border-ive-green/50"
                    >
                      {selected.size === filtered.length && filtered.length > 0
                        ? <i className="fa-solid fa-square-check text-ive-green text-sm" />
                        : selected.size > 0
                          ? <i className="fa-solid fa-square-minus text-ive-amber text-sm" />
                          : <i className="fa-regular fa-square text-sm" />
                      }
                    </button>
                    <span className="text-sm font-bold text-ive-text">
                      {selected.size > 0 ? `${selected.size}개 선택` : '이슈를 선택하세요'}
                    </span>
                    {selected.size > 0 && stages.size === 1 && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${(STAGE_INFO[[...stages][0]] || STAGE_INFO.unknown).color}`}>
                        {(STAGE_INFO[[...stages][0]] || STAGE_INFO.unknown).label}
                      </span>
                    )}
                    {selected.size > 0 && stages.size > 1 && (
                      <span className="text-xs text-ive-amber font-bold">여러 단계 혼합</span>
                    )}
                  </div>
                  <button onClick={exitBulkMode} className="text-xs text-ive-text-dim hover:text-ive-text font-bold px-2 py-1 rounded-lg hover:bg-white/5 transition-all">
                    취소
                  </button>
                </div>

                {/* 프로그레스 바 */}
                {bulkProgress && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-ive-text-muted font-bold">
                        {cancelRef.current ? '취소됨' : bulkProgress.done === bulkProgress.total ? '완료' : '처리 중...'}
                        {' '}{bulkProgress.done}/{bulkProgress.total}
                        {bulkProgress.failed > 0 && <span className="text-ive-red ml-1">(실패 {bulkProgress.failed})</span>}
                      </span>
                      {bulkProgress.done < bulkProgress.total && !cancelRef.current && (
                        <button onClick={handleCancel} className="text-ive-red font-bold hover:underline">
                          중단
                        </button>
                      )}
                    </div>
                    <div className="w-full h-1.5 bg-ive-bg-deep rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${cancelRef.current ? 'bg-ive-amber' : bulkProgress.failed > 0 ? 'bg-ive-red' : 'bg-ive-green'}`}
                        style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* 벌크 액션 버튼들 */}
                {!bulkProgress && selected.size > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {stages.size > 1 ? (
                      <span className="text-xs text-ive-amber py-1">같은 단계의 이슈만 선택하면 일괄 변경할 수 있습니다</span>
                    ) : bulkActions.length === 0 ? (
                      <span className="text-xs text-ive-text-dim py-1">이 단계에서는 일괄 변경할 수 없습니다</span>
                    ) : (
                      bulkActions.map(act => (
                        <button
                          key={act.action}
                          onClick={() => handleBulkAction(act.action)}
                          className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all active:scale-95 ${
                            act.danger
                              ? 'text-ive-red/80 border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10'
                              : 'text-ive-green border-ive-green/30 bg-ive-bg-deep hover:bg-ive-green/10'
                          }`}
                        >
                          <i className={`fa-solid ${act.icon} mr-1`} />{act.label} ({selected.size})
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="text-center py-20 text-ive-text-muted">이슈 불러오는 중...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 bg-ive-bg/50 rounded-2xl border border-dashed border-ive-border-subtle">
                <i className="fa-solid fa-inbox text-4xl text-ive-text-dim mb-4 block" />
                <p className="text-base text-ive-text-muted">
                  {issues.length === 0 ? 'IVE 이슈가 없습니다' : '해당 필터에 맞는 이슈가 없습니다'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filtered.map(issue => {
                  const stageInfo = STAGE_INFO[issue.stage] || STAGE_INFO.unknown
                  const isSelected = selected.has(issue.iid)
                  return (
                    <div
                      key={issue.iid}
                      onClick={() => {
                        if (bulkMode) { toggleSelect(issue.iid); return }
                        router.push(`/issues/${selectedProjectId}/${issue.iid}`)
                      }}
                      className={`bg-ive-bg-card border rounded-xl p-4 transition-all cursor-pointer active:scale-[0.98] ${
                        isSelected
                          ? 'border-ive-green/50 bg-ive-green/5'
                          : 'border-ive-border-subtle hover:border-ive-green/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          {bulkMode && (
                            <div className="mt-0.5 shrink-0">
                              {isSelected
                                ? <i className="fa-solid fa-square-check text-ive-green text-lg" />
                                : <i className="fa-regular fa-square text-ive-text-dim text-lg" />
                              }
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <span className="text-sm font-black text-ive-green">#{issue.iid}</span>
                            <h3 className="text-base font-bold text-ive-text leading-snug mt-0.5 line-clamp-2">{issue.title}</h3>
                          </div>
                        </div>
                        <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg border ${stageInfo.color}`}>
                          <i className={`fa-solid ${stageInfo.icon} mr-1`} />
                          {stageInfo.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-ive-text-dim">
                        <span>
                          <i className="fa-solid fa-user mr-1" />
                          {issue.author}
                        </span>
                        <span>
                          <i className="fa-solid fa-calendar-day mr-1" />
                          {new Date(issue.updatedAt).toLocaleString('ko-KR', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                          })}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
