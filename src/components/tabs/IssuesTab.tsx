'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useTranslations } from 'next-intl'

interface IveIssue {
  iid: number
  title: string
  stage: string
  failReason?: string | null
  state: string
  labels: string[]
  createdAt: string
  updatedAt: string
  author: string
}

export default function IssuesTab({ addTrigger }: { addTrigger?: number }) {
  const router = useRouter()
  const { confirm } = useDialog()
  const { state } = useStore()
  const { activeTab, setActiveTab, issuesProjectId, setIssuesProjectId, issuesFilter, setIssuesFilter, issuesSort, setIssuesSort } = useTab()
  const tStage = useTranslations('stage')
  const tFilter = useTranslations('filter')
  const tIssue = useTranslations('issue')
  const tSort = useTranslations('sort')
  const tProject = useTranslations('project')
  const tCommon = useTranslations('common')

  const STAGE_INFO: Record<string, { label: string; color: string; icon: string }> = useMemo(() => ({
    waiting:    { label: tStage('waiting'),   color: 'bg-ive-green/20 text-ive-green border-ive-green/30', icon: 'fa-clock' },
    dev:        { label: tStage('dev'),       color: 'bg-ive-cyan/20 text-ive-cyan border-ive-cyan/30', icon: 'fa-code' },
    dev_fail:   { label: tStage('dev_fail'),  color: 'bg-ive-red/20 text-ive-red border-ive-red/30', icon: 'fa-circle-xmark' },
    done:       { label: tStage('done'),      color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: 'fa-circle-check' },
    unknown:    { label: tStage('unknown'),   color: 'bg-white/10 text-ive-text-dim border-white/20', icon: 'fa-question' },
  }), [tStage])

  const FILTER_TABS = useMemo(() => [
    { key: 'all', label: tFilter('all') },
    { key: 'waiting', label: tFilter('waiting') },
    { key: 'active', label: tFilter('active') },
    { key: 'failed', label: tFilter('failed') },
    { key: 'done', label: tFilter('done') },
  ], [tFilter])

  const BULK_ACTIONS: Record<string, { action: string; label: string; icon: string; danger?: boolean }[]> = useMemo(() => ({
    waiting: [],
    dev: [
      { action: 'cancel', label: tIssue('toWaiting'), icon: 'fa-rotate-left', danger: true },
    ],
    dev_fail: [
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
    done: [
      { action: 'reopen', label: tIssue('reopenToWaiting'), icon: 'fa-rotate' },
    ],
  }), [tIssue])

  const selectedProjectId = issuesProjectId ?? ''
  const filter = issuesFilter
  const sortOrder = issuesSort as 'newest' | 'oldest'
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
  const [newBody, setNewBody] = useState(() => {
    if (typeof window !== 'undefined') {
      const pid = issuesProjectId ?? ''
      if (pid) return localStorage.getItem(`ive-issue-draft-${pid}`) || ''
    }
    return ''
  })
  const [creating, setCreating] = useState(false)
  const [closing, setClosing] = useState<number | null>(null)

  const setSelectedProjectId = (id: string) => setIssuesProjectId(id)
  const setFilter = (f: string) => setIssuesFilter(f)

  const listRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (state.loading) return
    if (!state.user) return
    if (selectedProjectId && !state.projects.some(p => p.id === selectedProjectId)) {
      setSelectedProjectId('')
      setIssues([])
      sessionStorage.removeItem('issues-cache')
    }
  }, [state.projects, selectedProjectId, state.loading, state.user])

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

  useEffect(() => {
    if (activeTab === 'issues' && selectedProjectId) fetchIssues()
  }, [activeTab])

  useEffect(() => {
    if (addTrigger && addTrigger > 0 && selectedProjectId) {
      setShowAddForm(true)
    }
  }, [addTrigger])

  const saveDraft = useCallback((value: string) => {
    if (!selectedProjectId) return
    if (value) {
      localStorage.setItem(`ive-issue-draft-${selectedProjectId}`, value)
    } else {
      localStorage.removeItem(`ive-issue-draft-${selectedProjectId}`)
    }
  }, [selectedProjectId])

  const handleBodyChange = useCallback((value: string) => {
    setNewBody(value)
    saveDraft(value)
  }, [saveDraft])

  useEffect(() => {
    if (selectedProjectId) {
      const draft = localStorage.getItem(`ive-issue-draft-${selectedProjectId}`)
      setNewBody(draft || '')
      if (draft) setShowAddForm(true)
    } else {
      setNewBody('')
    }
  }, [selectedProjectId])

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
        title: tIssue('bulkCloseTitle'),
        message: tIssue('bulkCloseConfirm', { count: selectedIssues.length }),
        confirmText: tCommon('close'),
        cancelText: tCommon('cancel'),
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
        const created = await res.json()
        handleBodyChange('')
        setShowAddForm(false)
        const newIssue: IveIssue = {
          iid: created.iid,
          title: created.title,
          state: created.state || 'opened',
          stage: 'waiting',
          labels: created.labels || [],
          createdAt: created.created_at || new Date().toISOString(),
          updatedAt: created.updated_at || new Date().toISOString(),
          author: created.author?.name || '',
        }
        setIssues(prev => {
          if (prev.some(i => i.iid === created.iid)) return prev
          return [newIssue, ...prev]
        })
        setTimeout(() => {
          if (!selectedProjectId) return
          fetch(`/api/projects/${selectedProjectId}/issues`)
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (!data) return
              setIssues(() => {
                const hasNew = data.some((i: IveIssue) => i.iid === created.iid)
                if (hasNew) return data
                return [newIssue, ...data]
              })
              sessionStorage.setItem('issues-cache', JSON.stringify({ projectId: selectedProjectId, issues: data }))
            })
        }, 1500)
      }
    } finally {
      setCreating(false)
    }
  }

  const handleCloseIssue = async (e: React.MouseEvent, iid: number) => {
    e.stopPropagation()
    if (closing) return
    const ok = await confirm({
      title: tIssue('closeIssue'),
      message: tIssue('closeIssueConfirm', { iid }),
      confirmText: tCommon('close'),
      cancelText: tCommon('cancel'),
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
  const canEdit = selectedProject ? !selectedProject.shareRole || selectedProject.shareRole === 'editor' : false
  const bulkActions = getAvailableBulkActions()
  const stages = selectedStages()
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
              className="w-full appearance-none bg-none bg-ive-bg-card border border-ive-border-subtle rounded-xl px-4 py-3 text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50 transition-colors"
            >
              <span className={`text-base font-bold ${selectedProjectId ? 'text-ive-text' : 'text-ive-text-dim'}`}>
                {selectedProject?.name || tProject('selectProject')}
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
            <p className="text-base text-ive-text-muted mb-2">{tProject('noRegisteredProjects')}</p>
            <p className="text-sm text-ive-text-dim mb-5">{tProject('addProjectFirst')}</p>
            <button
              onClick={() => setActiveTab('projects')}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-xl active:scale-95 transition-transform"
            >
              <i className="fa-solid fa-plus" />{tProject('addProjectAction')}
            </button>
          </div>
        ) : !selectedProjectId ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted">{tProject('selectAProject')}</p>
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
                    <div className="text-xs text-ive-text-dim">{tIssue('issues')}</div>
                  </div>
                  {canEdit && issues.length > 0 && !bulkMode && (
                    <button
                      onClick={() => setBulkMode(true)}
                      className="w-9 h-9 rounded-full bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-text hover:border-ive-green/30 transition-all"
                      title={tIssue('bulkEdit')}
                    >
                      <i className="fa-solid fa-list-check text-sm" />
                    </button>
                  )}
                  {!bulkMode && (
                    <button
                      onClick={fetchIssues}
                      disabled={loading}
                      className="w-9 h-9 rounded-full bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-green hover:border-ive-green/30 transition-all disabled:opacity-40"
                      title={tCommon('refresh')}
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
                  {(() => {
                    const count = tab.key === 'all' ? issues.length
                      : tab.key === 'waiting' ? issues.filter(i => i.stage === 'waiting').length
                      : tab.key === 'active' ? issues.filter(i => i.stage === 'dev').length
                      : tab.key === 'failed' ? issues.filter(i => i.stage === 'dev_fail').length
                      : tab.key === 'done' ? issues.filter(i => i.stage === 'done').length
                      : 0
                    return count > 0 ? <span className="ml-1 text-xs opacity-60">{count}</span> : null
                  })()}
                </button>
              ))}
            </div>

            {/* 정렬 */}
            <div className="flex items-center justify-end mb-3">
              <button
                onClick={() => {
                  const next = sortOrder === 'newest' ? 'oldest' : 'newest'
                  setIssuesSort(next)
                }}
                className="text-xs font-bold text-ive-text-dim hover:text-ive-text flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
              >
                <i className={`fa-solid ${sortOrder === 'newest' ? 'fa-arrow-down-wide-short' : 'fa-arrow-up-wide-short'}`} />
                {sortOrder === 'newest' ? tSort('newest') : tSort('oldest')}
              </button>
            </div>

            {/* 이슈 추가 폼 */}
            {showAddForm && (
              <div className="mb-3 bg-ive-bg-card border border-ive-green/30 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-ive-green">
                    <i className="fa-solid fa-plus mr-1" />{tIssue('addNewIssue')}
                  </span>
                  <button onClick={() => { setShowAddForm(false); handleBodyChange('') }} className="text-xs text-ive-text-dim hover:text-ive-text font-bold px-2 py-1 rounded-lg hover:bg-white/5 transition-all">
                    {tCommon('cancel')}
                  </button>
                </div>
                <p className="text-xs text-ive-text-dim mb-1.5"><i className="fa-solid fa-info-circle mr-1" />{tIssue('firstLineTitle')}{newBody && <span className="ml-2 text-ive-green/60"><i className="fa-solid fa-floppy-disk mr-0.5" />{tIssue('autoSaved')}</span>}</p>
                <div className="flex gap-2 items-end mb-2">
                  <textarea
                    value={newBody}
                    onChange={e => handleBodyChange(e.target.value)}
                    placeholder={`${tIssue('titlePlaceholder')}\n\n${tIssue('bodyPlaceholder')}`}
                    rows={4}
                    className="flex-1 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-green/50"
                    autoFocus
                  />
                </div>
                <button
                  onClick={handleCreateIssue}
                  disabled={creating || !newBody.split('\n')[0].trim()}
                  className="w-full py-2 rounded-lg bg-ive-green text-ive-bg-deep text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
                >
                  {creating ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tCommon('creating')}</> : <><i className="fa-solid fa-paper-plane mr-1" />{tIssue('createIssue')}</>}
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
                      {selected.size > 0 ? tIssue('selected', { count: selected.size }) : tIssue('selectIssues')}
                    </span>
                    {selected.size > 0 && stages.size === 1 && (
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${(STAGE_INFO[[...stages][0]] || STAGE_INFO.unknown).color}`}>
                        {(STAGE_INFO[[...stages][0]] || STAGE_INFO.unknown).label}
                      </span>
                    )}
                    {selected.size > 0 && stages.size > 1 && (
                      <span className="text-xs text-ive-amber font-bold">{tIssue('mixedStages')}</span>
                    )}
                  </div>
                  <button onClick={exitBulkMode} className="text-xs text-ive-text-dim hover:text-ive-text font-bold px-2 py-1 rounded-lg hover:bg-white/5 transition-all">
                    {tCommon('cancel')}
                  </button>
                </div>

                {/* 프로그레스 바 */}
                {bulkProgress && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-ive-text-muted font-bold">
                        {cancelRef.current ? tIssue('cancelled') : bulkProgress.done === bulkProgress.total ? tIssue('completed') : tCommon('processing')}
                        {' '}{bulkProgress.done}/{bulkProgress.total}
                        {bulkProgress.failed > 0 && <span className="text-ive-red ml-1">({tIssue('failed')} {bulkProgress.failed})</span>}
                      </span>
                      {bulkProgress.done < bulkProgress.total && !cancelRef.current && (
                        <button onClick={handleCancel} className="text-ive-red font-bold hover:underline">
                          {tIssue('stop')}
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
                        <span className="text-xs text-ive-amber py-1">{tIssue('sameStageHint')}</span>
                        <button
                          onClick={() => handleBulkAction('close')}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-red/80 border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10 transition-all active:scale-95"
                        >
                          <i className="fa-solid fa-xmark mr-1" />{tCommon('close')} ({selected.size})
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
                          <i className="fa-solid fa-xmark mr-1" />{tCommon('close')} ({selected.size})
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
        <div className="flex-1 min-h-0 overflow-y-auto pb-20 custom-scrollbar" data-scroll-container="issues-list">
            {loading && issues.length === 0 ? (
              <div className="text-center py-20 text-ive-text-muted">{tIssue('loadingIssues')}</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 bg-ive-bg/50 rounded-2xl border border-dashed border-ive-border-subtle">
                <i className="fa-solid fa-inbox text-4xl text-ive-text-dim mb-4 block" />
                <p className="text-base text-ive-text-muted">
                  {issues.length === 0 ? tIssue('noIveIssues') : tIssue('noFilterMatch')}
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
                      {issue.stage === 'dev_fail' && issue.failReason && (
                        <div className="mb-1.5 px-2 py-1 rounded-lg bg-ive-red/10 border border-ive-red/20 text-xs text-ive-red">
                          <i className="fa-solid fa-triangle-exclamation mr-1" />
                          {issue.failReason}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-xs text-ive-text-dim">
                        <span>
                          <i className="fa-solid fa-user mr-1" />
                          {issue.author}
                        </span>
                        <span>
                          <i className="fa-solid fa-calendar-day mr-1" />
                          {new Date(issue.updatedAt).toLocaleString('ko-KR', {
                            timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                          })}
                        </span>
                        {canEdit && !bulkMode && (
                          <button
                            onClick={(e) => handleCloseIssue(e, issue.iid)}
                            disabled={closing === issue.iid}
                            className="ml-auto text-xs font-bold text-ive-text-dim hover:text-ive-red border border-ive-border-subtle hover:border-ive-red/30 px-2 py-0.5 rounded-lg transition-all active:scale-95 disabled:opacity-40"
                            title={tIssue('closeIssue')}
                          >
                            {closing === issue.iid ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-xmark mr-0.5" />{tCommon('close')}</>}
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
