'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useDialog } from '@/components/ui/ConfirmDialog'

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
  done:       { label: '완료',     color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: 'fa-circle-check' },
  unknown:    { label: '알 수 없음', color: 'bg-white/10 text-ive-text-dim border-white/20', icon: 'fa-question' },
}

const FILTER_TABS = [
  { key: 'all', label: '전체' },
  { key: 'waiting', label: '대기' },
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
  done: [
    { action: 'reopen', label: '대기로 (다시 열기)', icon: 'fa-rotate' },
  ],
}

export default function IssuesTab() {
  const router = useRouter()
  const { confirm } = useDialog()
  const { state } = useStore()
  const { activeTab, setActiveTab, issuesProjectId, setIssuesProjectId, issuesFilter, setIssuesFilter } = useTab()
  const selectedProjectId = issuesProjectId ?? ''
  const filter = issuesFilter
  const [issues, setIssues] = useState<IveIssue[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem('issues-cache')
      if (cached) {
        try {
          const parsed = JSON.parse(cached)
          if (parsed.projectId === (issuesProjectId ?? '')) return parsed.issues
        } catch { /* ignore */ }
      }
    }
    return []
  })
  const [loading, setLoading] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkProgress, setBulkProgress] = useState<{ total: number; done: number; failed: number } | null>(null)
  const cancelRef = useRef(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newBody, setNewBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [closing, setClosing] = useState<number | null>(null)
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('ive-issues-sort') as 'newest' | 'oldest') || 'newest'
    }
    return 'newest'
  })

  const setSelectedProjectId = (id: string) => setIssuesProjectId(id)
  const setFilter = (f: string) => setIssuesFilter(f)

  const listRef = useRef<HTMLDivElement | null>(null)

  // 스크롤 위치 복원
  useEffect(() => {
    const saved = sessionStorage.getItem('issues-scroll')
    if (saved) {
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-scroll-container="issues-list"]')
        if (el) el.scrollTop = Number(saved)
      })
      sessionStorage.removeItem('issues-scroll')
    }
  }, [issues])

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

  // 선택된 프로젝트가 현재 목록에 없으면 초기화
  useEffect(() => {
    if (state.loading) return
    if (selectedProjectId && !state.projects.some(p => p.id === selectedProjectId)) {
      setSelectedProjectId('')
      setIssues([])
      sessionStorage.removeItem('issues-cache')
    }
  }, [state.projects, selectedProjectId, state.loading])

  // 프로젝트가 1개면 자동 선택
  useEffect(() => {
    if (state.projects.length === 1 && !selectedProjectId) {
      setSelectedProjectId(state.projects[0].id)
    }
  }, [state.projects, selectedProjectId])

  const fetchIssues = useCallback(() => {
    if (!selectedProjectId) return Promise.resolve()
    setLoading(true)
    return fetch(`/api/projects/${selectedProjectId}/issues`)
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        setIssues(data)
        sessionStorage.setItem('issues-cache', JSON.stringify({ projectId: selectedProjectId, issues: data }))
      })
      .finally(() => setLoading(false))
  }, [selectedProjectId])

  useEffect(() => { fetchIssues() }, [fetchIssues])

  // 탭 전환 시 자동 새로고침
  useEffect(() => {
    if (activeTab === 'issues' && selectedProjectId) fetchIssues()
  }, [activeTab])

  const filtered = issues.filter(issue => {
    if (filter === 'all') return true
    if (filter === 'waiting') return issue.stage === 'waiting'
    if (filter === 'active') return issue.stage === 'dev'
    if (filter === 'failed') return issue.stage === 'dev_fail'
    if (filter === 'done') return issue.stage === 'done'
    return true
  }).sort((a, b) => {
    if (sortOrder === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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
    const isClose = action === 'close'
    if (isClose) {
      const ok = await confirm({
        title: '이슈 일괄 닫기',
        message: `선택한 ${selectedIssues.length}개 이슈를 모두 닫으시겠습니까?`,
        confirmText: '닫기',
        cancelText: '취소',
        variant: 'warning',
      })
      if (!ok) return
    }
    cancelRef.current = false
    setBulkProgress({ total: selectedIssues.length, done: 0, failed: 0 })

    let done = 0
    let failed = 0
    for (const issue of selectedIssues) {
      if (cancelRef.current) break
      try {
        const url = isClose
          ? `/api/projects/${selectedProjectId}/issues/${issue.iid}/close`
          : `/api/projects/${selectedProjectId}/issues/${issue.iid}/stage`
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...(isClose ? {} : { body: JSON.stringify({ stage, action }) }),
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

  const handleCreateIssue = async () => {
    const lines = newBody.split('\n')
    const title = lines[0].trim()
    const description = lines.slice(1).join('\n').trim()
    if (!title || !selectedProjectId) return
    setCreating(true)
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, asDev: true }),
      })
      if (res.ok) {
        setNewBody('')
        setShowAddForm(false)
        fetchIssues()
      }
    } finally {
      setCreating(false)
    }
  }

  const handleCloseIssue = async (e: React.MouseEvent, iid: number) => {
    e.stopPropagation()
    if (closing) return
    const ok = await confirm({
      title: '이슈 닫기',
      message: `#${iid} 이슈를 닫으시겠습니까?`,
      confirmText: '닫기',
      cancelText: '취소',
      variant: 'warning',
    })
    if (!ok) return
    setClosing(iid)
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/close`, {
        method: 'POST',
      })
      if (res.ok) fetchIssues()
    } finally {
      setClosing(null)
    }
  }

  const selectedProject = state.projects.find(p => p.id === selectedProjectId)
  const bulkActions = getAvailableBulkActions()
  const stages = selectedStages()
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 드롭다운 바깥 클릭 시 닫기
  useEffect(() => {
    if (!projectDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [projectDropdownOpen])

  return (
    <PullToRefresh onRefresh={fetchIssues} className="h-[calc(100dvh-3.5rem)] flex flex-col max-w-lg mx-auto px-4">
      <div className="pt-4 shrink-0">
        {state.projects.length > 1 && (
          <div ref={dropdownRef} className="relative mb-3">
            <button
              type="button"
              onClick={() => setProjectDropdownOpen(v => !v)}
              className="w-full bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3 text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50 transition-colors"
            >
              <span className={`text-base font-bold ${selectedProjectId ? 'text-ive-text' : 'text-ive-text-dim'}`}>
                {selectedProject?.name || '프로젝트 선택'}
              </span>
              <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {projectDropdownOpen && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-ive-bg-card border border-ive-border-subtle rounded-xl overflow-hidden shadow-lg shadow-black/30">
                {state.projects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedProjectId(p.id); setProjectDropdownOpen(false) }}
                    className={`w-full px-4 py-3 text-left text-base font-bold transition-colors ${
                      p.id === selectedProjectId
                        ? 'bg-ive-green/10 text-ive-green'
                        : 'text-ive-text hover:bg-white/5'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {state.projects.length === 0 && !state.loading ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-2">등록된 프로젝트가 없습니다</p>
            <p className="text-sm text-ive-text-dim mb-5">프로젝트를 먼저 추가해야 이슈를 관리할 수 있습니다</p>
            <button
              onClick={() => setActiveTab('projects')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-xl active:scale-95 transition-transform"
            >
              <i className="fa-solid fa-plus" />프로젝트 추가하기
            </button>
          </div>
        ) : !selectedProjectId ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted">프로젝트를 선택하세요</p>
          </div>
        ) : (
          <>
            {selectedProject && (
              <div className="flex items-center gap-3 mb-3 bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3"
                   style={{ borderLeftWidth: '3px', borderLeftColor: selectedProject.color || '#4ade80' }}>
                <i className={`fa-brands ${selectedProject.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xl`}
                   style={{ color: selectedProject.color || '#4ade80' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold text-ive-text truncate">{selectedProject.name}</div>
                  <div className="text-xs text-ive-text-dim truncate">{selectedProject.repoUrl}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-center">
                    <div className="text-lg font-black text-ive-green-light">{issues.length}</div>
                    <div className="text-xs text-ive-text-dim">이슈</div>
                  </div>
                  {!bulkMode && (
                    <button
                      onClick={() => setShowAddForm(true)}
                      className="w-9 h-9 rounded-full bg-ive-green/20 border border-ive-green/30 flex items-center justify-center text-ive-green hover:bg-ive-green/30 transition-all"
                      title="이슈 추가"
                    >
                      <i className="fa-solid fa-plus text-sm" />
                    </button>
                  )}
                  {issues.length > 0 && !bulkMode && (
                    <button
                      onClick={() => setBulkMode(true)}
                      className="w-9 h-9 rounded-full bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-text hover:border-ive-green/30 transition-all"
                      title="일괄 수정"
                    >
                      <i className="fa-solid fa-list-check text-sm" />
                    </button>
                  )}
                  {!bulkMode && (
                    <button
                      onClick={fetchIssues}
                      disabled={loading}
                      className="w-9 h-9 rounded-full bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-green hover:border-ive-green/30 transition-all disabled:opacity-40"
                      title="새로고침"
                    >
                      <i className={`fa-solid fa-arrows-rotate text-sm ${loading ? 'fa-spin' : ''}`} />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-1 mb-2 bg-ive-bg-card rounded-xl p-1 border border-ive-border-subtle">
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

            {/* 정렬 */}
            <div className="flex items-center justify-end mb-3">
              <button
                onClick={() => {
                  const next = sortOrder === 'newest' ? 'oldest' : 'newest'
                  setSortOrder(next)
                  localStorage.setItem('ive-issues-sort', next)
                }}
                className="text-xs font-bold text-ive-text-dim hover:text-ive-text flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
              >
                <i className={`fa-solid ${sortOrder === 'newest' ? 'fa-arrow-down-wide-short' : 'fa-arrow-up-wide-short'}`} />
                {sortOrder === 'newest' ? '최신순' : '오래된순'}
              </button>
            </div>

            {/* 이슈 추가 폼 */}
            {showAddForm && (
              <div className="mb-3 bg-ive-bg-card border border-ive-green/30 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-ive-green">
                    <i className="fa-solid fa-plus mr-1" />새 이슈 추가
                  </span>
                  <button onClick={() => { setShowAddForm(false); setNewBody('') }} className="text-xs text-ive-text-dim hover:text-ive-text font-bold px-2 py-1 rounded-lg hover:bg-white/5 transition-all">
                    취소
                  </button>
                </div>
                <textarea
                  value={newBody}
                  onChange={e => setNewBody(e.target.value)}
                  placeholder="첫 줄이 제목이 됩니다&#10;두 번째 줄부터 본문입니다"
                  rows={4}
                  className="w-full mb-2 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-green/50"
                  autoFocus
                />
                <button
                  onClick={handleCreateIssue}
                  disabled={creating || !newBody.split('\n')[0].trim()}
                  className="w-full py-2 rounded-lg bg-ive-green text-ive-bg-deep text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
                >
                  {creating ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />생성 중...</> : <><i className="fa-solid fa-paper-plane mr-1" />이슈 생성</>}
                </button>
              </div>
            )}

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
                      <>
                        <span className="text-xs text-ive-amber py-1">같은 단계의 이슈만 선택하면 일괄 변경할 수 있습니다</span>
                        <button
                          onClick={() => handleBulkAction('close')}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-red/80 border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10 transition-all active:scale-95"
                        >
                          <i className="fa-solid fa-xmark mr-1" />닫기 ({selected.size})
                        </button>
                      </>
                    ) : (
                      <>
                        {bulkActions.map(act => (
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
                        ))}
                        <button
                          onClick={() => handleBulkAction('close')}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-red/80 border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10 transition-all active:scale-95"
                        >
                          <i className="fa-solid fa-xmark mr-1" />닫기 ({selected.size})
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

          </>
        )}
      </div>

      {/* 스크롤 가능한 리스트 영역 */}
      {selectedProjectId && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-4 custom-scrollbar" data-scroll-container="issues-list">
            {loading && issues.length === 0 ? (
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
                        const el = document.querySelector('[data-scroll-container="issues-list"]')
                        if (el) sessionStorage.setItem('issues-scroll', String(el.scrollTop))
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
                        {!bulkMode && (
                          <button
                            onClick={(e) => handleCloseIssue(e, issue.iid)}
                            disabled={closing === issue.iid}
                            className="ml-auto text-xs font-bold text-ive-text-dim hover:text-ive-red border border-ive-border-subtle hover:border-ive-red/30 px-2 py-0.5 rounded-lg transition-all active:scale-95 disabled:opacity-40"
                            title="이슈 닫기"
                          >
                            {closing === issue.iid ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-xmark mr-0.5" />닫기</>}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
        </div>
      )}
    </PullToRefresh>
  )
}
