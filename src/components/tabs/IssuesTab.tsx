'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import { useToast } from '@/components/ui/Toast'
import { formatDateMedium } from '@/lib/format-date'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useDialog } from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import type { CliName } from '@/types'

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
  assignMode?: string
  preferredAgentId?: string | null
  preferredAgentName?: string | null
  preferredAgentAvatar?: string | null
  preferredAgentCliName?: string | null
  assignees?: { id: number; username: string; name: string; avatarUrl: string }[]
}

interface ProjectAgent {
  agentId: string
  agent: { id: string; name: string; avatar: string; cliName: CliName; status: string }
}

const CLI_CONFIG: Record<CliName, { label: string; icon: string; color: string }> = {
  claude: { label: 'Claude', icon: 'fa-solid fa-atom', color: 'text-ive-amber' },
  gemini: { label: 'Gemini', icon: 'fa-brands fa-google', color: 'text-ive-cyan' },
  codex: { label: 'Codex', icon: 'fa-solid fa-brain', color: 'text-ive-green-light' },
  opencode: { label: 'OpenCode', icon: 'fa-solid fa-terminal', color: 'text-ive-cyan' },
}

export default function IssuesTab({ addTrigger }: { addTrigger?: number }) {
  const router = useRouter()
  const { confirm } = useDialog()
  const { state } = useStore()
  const { toast } = useToast()
  const { activeTab, setActiveTab, issuesProjectId, setIssuesProjectId, issuesFilter, setIssuesFilter, issuesSort, setIssuesSort } = useTab()
  const tStage = useTranslations('stage')
  const tFilter = useTranslations('filter')
  const tIssue = useTranslations('issue')
  const tSort = useTranslations('sort')
  const tProject = useTranslations('project')
  const tCommon = useTranslations('common')

  const STAGE_INFO: Record<string, { label: string; color: string; icon: string }> = useMemo(() => ({
    waiting:        { label: tStage('waiting'),        color: 'bg-ive-cyan/20 text-ive-cyan border-ive-cyan/30',     icon: 'fa-clock' },
    verify_waiting: { label: tStage('verify_waiting'), color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30',  icon: 'fa-hourglass-half' },
    dev:            { label: tStage('dev'),            color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30',  icon: 'fa-code' },
    dev_fail:       { label: tStage('dev_fail'),       color: 'bg-ive-red/20 text-ive-red border-ive-red/30',        icon: 'fa-circle-xmark' },
    verifying:      { label: tStage('verifying'),      color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30',  icon: 'fa-magnifying-glass' },
    done:           { label: tStage('done'),           color: 'bg-ive-green/20 text-ive-green border-ive-green/30',  icon: 'fa-circle-check' },
    closed:         { label: tStage('closed'),         color: 'bg-white/5 text-ive-text-muted border-ive-border-subtle', icon: 'fa-lock' },
    rejected:       { label: tStage('rejected'),       color: 'bg-ive-red/20 text-ive-red border-ive-red/30',        icon: 'fa-rotate-left' },
    unknown:        { label: tStage('unknown'),        color: 'bg-white/5 text-ive-text-dim border-ive-border-subtle', icon: 'fa-question' },
  }), [tStage])

  const FILTER_TABS = useMemo(() => [
    { key: 'all', label: tFilter('all') },
    { key: 'waiting', label: tFilter('waiting') },
    { key: 'active', label: tFilter('active') },
    { key: 'verifying', label: tFilter('verifying') },
    { key: 'failed', label: tFilter('failed') },
    { key: 'done', label: tFilter('done') },
    { key: 'history', label: tFilter('history') },
  ], [tFilter])

  // OAuth 로그인 유저의 Git provider user id (assignee 매칭용)
  const myGitUserId = state.user?.oauthUserId ? String(state.user.oauthUserId) : null
  const canFilterMine = !!myGitUserId

  // "내게 할당" 토글 — stage 필터와 교차 적용
  const [onlyMine, setOnlyMine] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return sessionStorage.getItem('issues-only-mine') === '1'
  })
  const toggleOnlyMine = () => {
    setOnlyMine(prev => {
      const next = !prev
      sessionStorage.setItem('issues-only-mine', next ? '1' : '0')
      return next
    })
  }

  // 이슈가 현재 로그인 유저에게 할당되어 있는지 (stage 무관)
  const isMine = useCallback((issue: IveIssue): boolean => {
    if (!myGitUserId) return false
    return !!issue.assignees?.some(a => a.id != null && String(a.id) === myGitUserId)
  }, [myGitUserId])

  const BULK_ACTIONS: Record<string, { action: string; label: string; icon: string; danger?: boolean }[]> = useMemo(() => ({
    waiting: [],
    verify_waiting: [
      { action: 'start_verification', label: tIssue('startVerification'), icon: 'fa-play' },
      { action: 'cancel', label: tIssue('cancelToWaiting'), icon: 'fa-rotate-left', danger: true },
    ],
    dev: [
      { action: 'cancel', label: tIssue('toWaiting'), icon: 'fa-rotate-left', danger: true },
    ],
    dev_fail: [
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
    verifying: [
      { action: 'approve', label: tIssue('approveVerify'), icon: 'fa-circle-check' },
      { action: 'reject', label: tIssue('rejectVerify'), icon: 'fa-rotate-left', danger: true },
    ],
    done: [
      { action: 'reopen', label: tIssue('reopenToWaiting'), icon: 'fa-rotate' },
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
    rejected: [
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
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
  const [closedIssues, setClosedIssues] = useState<IveIssue[]>([])
  const [closedLoading, setClosedLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [navigatingIid, setNavigatingIid] = useState<number | null>(null)
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
  const [issueSearchQuery, setIssueSearchQuery] = useState('')
  const [closing, setClosing] = useState<number | null>(null)
  const [preferredAgentId, setPreferredAgentId] = useState<string | null>(null) // null=자동배정, 'none'=배정안함, 'assignee'=담당자처리, agentId=지정
  const [projectAgents, setProjectAgents] = useState<ProjectAgent[]>([])
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const agentDropdownRef = useRef<HTMLDivElement>(null)
  const [gitMembers, setGitMembers] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  const [selectedAssignees, setSelectedAssignees] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  const [assigneeModalIids, setAssigneeModalIids] = useState<number[]>([]) // 빈 배열이면 닫힘, iid 목록이면 열림
  const [assigneeModalSearch, setAssigneeModalSearch] = useState('')
  const [assigneeModalPick, setAssigneeModalPick] = useState<{ id: number; username: string; name: string; avatarUrl: string } | null>(null)
  const [agentPickerIid, setAgentPickerIid] = useState<number | null>(null) // null이면 닫힘, iid면 열림
  const [agentPickerSaving, setAgentPickerSaving] = useState(false)

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

  const fetchProjectAgents = useCallback(() => {
    if (!selectedProjectId) { setProjectAgents([]); return }
    fetch(`/api/projects/${selectedProjectId}/agents`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setProjectAgents(data))
      .catch(() => setProjectAgents([]))
  }, [selectedProjectId])

  const fetchGitMembers = useCallback(() => {
    if (!selectedProjectId) { setGitMembers([]); return }
    fetch(`/api/projects/${selectedProjectId}/members`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setGitMembers(data))
      .catch(() => setGitMembers([]))
  }, [selectedProjectId])

  const fetchClosedIssues = useCallback(() => {
    if (!selectedProjectId) return Promise.resolve()
    setClosedLoading(true)
    return fetch(`/api/projects/${selectedProjectId}/issues?state=closed`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setClosedIssues(data))
      .finally(() => setClosedLoading(false))
  }, [selectedProjectId])

  // 프로젝트 변경 시 닫힌 이슈 초기화
  useEffect(() => {
    setClosedIssues([])
  }, [selectedProjectId])

  useEffect(() => { fetchIssues() }, [fetchIssues])

  useEffect(() => {
    if (filter === 'history' && selectedProjectId) {
      fetchClosedIssues()
    }
  }, [filter, selectedProjectId, fetchClosedIssues])

  useEffect(() => {
    if (activeTab === 'issues' && selectedProjectId) {
      fetchIssues()
      fetchProjectAgents()
      fetchGitMembers()
    }
  }, [activeTab])

  // 페이지 visibility 변화 시 자동 재조회 — 이슈 상세에서 검증·머지 후 돌아올 때 스테일 방지
  useEffect(() => {
    if (activeTab !== 'issues' || !selectedProjectId) return
    const refresh = () => {
      if (filter === 'history') fetchClosedIssues()
      else fetchIssues()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('refresh-counts', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('refresh-counts', refresh)
    }
  }, [activeTab, selectedProjectId, filter, fetchIssues, fetchClosedIssues])

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
      fetchProjectAgents()
      fetchGitMembers()
    } else {
      setNewBody('')
      setProjectAgents([])
      setGitMembers([])
    }
    setPreferredAgentId(null)
    setSelectedAssignees([])
  }, [selectedProjectId, fetchProjectAgents, fetchGitMembers])

  useEffect(() => {
    if (!agentDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [agentDropdownOpen])

  // 담당자 모달 확인 — 선택된 1명을 대상 이슈들에 적용
  const handleConfirmAssignee = async () => {
    const isCreateMode = assigneeModalIids.includes(-1)
    if (isCreateMode) {
      setSelectedAssignees(assigneeModalPick ? [assigneeModalPick] : [])
      setAssigneeModalIids([])
      return
    }
    if (!canEdit) {
      toast('담당자 변경 권한이 없습니다. (뷰어 권한)', 'error')
      setAssigneeModalIids([])
      return
    }
    const updated = assigneeModalPick ? [assigneeModalPick] : []
    // 낙관 업데이트를 위한 이전 상태 스냅샷
    const prevSnapshots = new Map<number, IveIssue['assignees']>()
    for (const iid of assigneeModalIids) {
      const cur = issues.find(i => i.iid === iid)
      if (cur) prevSnapshots.set(iid, cur.assignees)
    }
    // 낙관 업데이트
    setIssues(prev => prev.map(i => assigneeModalIids.includes(i.iid) ? { ...i, assignees: updated } : i))
    setAssigneeModalIids([])

    // 서버 적용 (실패 시 롤백)
    const results = await Promise.all(assigneeModalIids.map(async iid => {
      try {
        const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/assignees`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigneeIds: updated.map(a => a.id),
            assigneeUsernames: updated.map(a => a.username),
          }),
        })
        if (!res.ok) {
          let message = `담당자 변경 실패 (#${iid})`
          if (res.status === 403) message = `담당자 변경 권한이 없습니다 (#${iid})`
          else if (res.status === 401) message = '로그인이 필요합니다'
          else {
            try {
              const data = await res.json()
              if (data?.error) message = `${data.error} (#${iid})`
            } catch { /* ignore */ }
          }
          return { iid, ok: false, message }
        }
        return { iid, ok: true }
      } catch (e) {
        return { iid, ok: false, message: `네트워크 오류 (#${iid}): ${(e as Error).message}` }
      }
    }))

    const failed = results.filter(r => !r.ok)
    if (failed.length > 0) {
      // 실패한 이슈 롤백
      setIssues(prev => prev.map(i => {
        if (prevSnapshots.has(i.iid) && failed.some(f => f.iid === i.iid)) {
          return { ...i, assignees: prevSnapshots.get(i.iid)! }
        }
        return i
      }))
      toast(failed[0].message || '담당자 변경에 실패했습니다', 'error')
    }
  }

  // 모달 열 때 기존 담당자를 초기값으로 설정
  const openAssigneeModal = (iids: number[]) => {
    setAssigneeModalSearch('')
    if (iids.length === 1 && !iids.includes(-1)) {
      const issue = issues.find(i => i.iid === iids[0])
      setAssigneeModalPick(issue?.assignees?.[0] || null)
    } else if (iids.includes(-1)) {
      setAssigneeModalPick(selectedAssignees[0] || null)
    } else {
      setAssigneeModalPick(null)
    }
    setAssigneeModalIids(iids)
  }

  // 대기 이슈의 에이전트 변경
  const handleChangeIssueAgent = async (iid: number, mode: 'auto' | 'assignee' | 'agent', agentId: string | null) => {
    setAgentPickerSaving(true)
    try {
      const body: any = mode === 'agent' ? { assignMode: 'agent', agentId } : { assignMode: mode }
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/preferred-agent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        setIssues(prev => prev.map(i => i.iid === iid ? {
          ...i,
          assignMode: data.assignMode,
          preferredAgentId: data.preferredAgentId,
          preferredAgentName: data.preferredAgentName,
          preferredAgentAvatar: data.preferredAgentAvatar,
          preferredAgentCliName: data.preferredAgentCliName,
        } : i))
        setAgentPickerIid(null)
      } else {
        const data = await res.json().catch(() => ({}))
        toast(data.error || '설정 저장에 실패했습니다', 'error')
      }
    } catch (err: any) {
      toast(err.message || '네트워크 오류가 발생했습니다', 'error')
    } finally {
      setAgentPickerSaving(false)
    }
  }

  const isHistoryTab = filter === 'history'

  const filtered = (isHistoryTab ? closedIssues : issues.filter(issue => {
    if (filter === 'all') return true
    if (filter === 'waiting') return issue.stage === 'waiting' || issue.stage === 'verify_waiting'
    if (filter === 'active') return issue.stage === 'dev'
    if (filter === 'verifying') return issue.stage === 'verifying'
    if (filter === 'failed') return issue.stage === 'dev_fail' || issue.stage === 'rejected'
    if (filter === 'done') return issue.stage === 'done'
    return true
  })).filter(issue => {
    // "내게 할당" 토글 — stage 필터와 교차 적용
    if (onlyMine && canFilterMine && !isMine(issue)) return false
    if (!issueSearchQuery) return true
    const q = issueSearchQuery.toLowerCase()
    return issue.title.toLowerCase().includes(q) || String(issue.iid).includes(q) || (issue.author || '').toLowerCase().includes(q)
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
        if (!res.ok) {
          failed++
          const data = await res.json().catch(() => ({}))
          console.error(`[Bulk] #${issue.iid} failed:`, data.error || res.statusText)
        } else {
          done++
        }
      } catch (err) {
        failed++
        console.error(`[Bulk] #${issue.iid} error:`, err)
      }
      setBulkProgress({ total: selectedIssues.length, done: done + failed, failed })
    }

    if (failed > 0) {
      toast(`${failed}건의 작업이 실패했습니다.`, 'error')
    } else if (done > 0) {
      toast(`${done}건의 작업을 완료했습니다.`, 'success')
    }

    fetchIssues()
    window.dispatchEvent(new CustomEvent('refresh-counts'))
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
        body: JSON.stringify({
          title, description,
          asDev: preferredAgentId !== 'none',
          assignMode: preferredAgentId === 'assignee' ? 'assignee' : preferredAgentId === 'none' ? undefined : preferredAgentId ? 'agent' : 'auto',
          preferredAgentId: (preferredAgentId && preferredAgentId !== 'none' && preferredAgentId !== 'assignee') ? preferredAgentId : undefined,
          assigneeIds: selectedAssignees.length > 0 ? selectedAssignees.map(a => a.id) : undefined,
          assigneeUsernames: selectedAssignees.length > 0 ? selectedAssignees.map(a => a.username) : undefined,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        handleBodyChange('')
        setShowAddForm(false)
        setPreferredAgentId(null)
        setSelectedAssignees([])
        const selectedAgent = preferredAgentId ? projectAgents.find(a => a.agentId === preferredAgentId) : null
        const newIssue: IveIssue = {
          iid: created.iid,
          title: created.title,
          state: created.state || 'opened',
          stage: preferredAgentId === 'none' ? 'none' : 'waiting',
          labels: created.labels || [],
          createdAt: created.created_at || new Date().toISOString(),
          updatedAt: created.updated_at || new Date().toISOString(),
          author: created.author?.name || '',
          assignMode: preferredAgentId === 'assignee' ? 'assignee' : preferredAgentId && preferredAgentId !== 'none' ? 'agent' : 'auto',
          preferredAgentId: (preferredAgentId && preferredAgentId !== 'none' && preferredAgentId !== 'assignee') ? preferredAgentId : null,
          preferredAgentName: selectedAgent?.agent.name || null,
          preferredAgentAvatar: selectedAgent?.agent.avatar || null,
          preferredAgentCliName: selectedAgent?.agent.cliName || null,
        }
        setIssues(prev => {
          if (prev.some(i => i.iid === created.iid)) return prev
          return [newIssue, ...prev]
        })
        toast('이슈가 생성되었습니다', 'success')
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
      } else {
        const data = await res.json().catch(() => ({}))
        toast(data.error || '이슈 생성에 실패했습니다', 'error')
      }
    } catch (err: any) {
      toast(err.message || '네트워크 오류가 발생했습니다', 'error')
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
      if (res.ok) {
        fetchIssues()
        window.dispatchEvent(new CustomEvent('refresh-counts'))
        toast('이슈가 종료되었습니다', 'success')
      } else {
        const data = await res.json().catch(() => ({}))
        toast(data.error || '이슈 종료에 실패했습니다', 'error')
      }
    } catch (err: any) {
      toast(err.message || '네트워크 오류가 발생했습니다', 'error')
    } finally {
      setClosing(null)
    }
  }

  const selectedProject = state.projects.find(p => p.id === selectedProjectId)
  // 뷰어도 이슈 등록 및 담당자로서의 상태 변경은 가능해야 하므로 접근 권한이 있으면 허용
  const canEdit = !!selectedProject
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
    <PullToRefresh onRefresh={isHistoryTab ? fetchClosedIssues : fetchIssues} className="h-[calc(100dvh-3.5rem)] flex flex-col max-w-lg mx-auto px-4">
      <div className="pt-4 shrink-0">
        {state.projects.length > 1 && (
          <div ref={dropdownRef} className="relative mb-3">
            <button
              type="button"
              onClick={() => setProjectDropdownOpen(v => !v)}
              className="w-full appearance-none bg-none bg-ive-bg-card border border-ive-border-subtle rounded-lg px-4 py-3 text-left flex items-center justify-between focus:outline-none focus:border-ive-green/50 transition-colors"
            >
              <span className={`text-base font-bold ${selectedProjectId ? 'text-ive-text' : 'text-ive-text-dim'}`}>
                {selectedProject?.name || tProject('selectProject')}
              </span>
              <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {projectDropdownOpen && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg">
                {state.projects.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setSelectedProjectId(p.id); setProjectDropdownOpen(false) }}
                    className={`w-full px-4 py-3 text-left text-base font-bold transition-colors ${
                      p.id === selectedProjectId
                        ? 'bg-ive-cyan/10 text-ive-cyan'
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
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-lg active:scale-95 transition-transform"
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
              <div className="flex items-center gap-3 mb-3 bg-ive-bg-card border border-ive-border-subtle rounded-lg px-4 py-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${selectedProject.color || '#22d3ee'}15` }}>
                  <i className={`fa-brands ${selectedProject.provider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xl`}
                     style={{ color: selectedProject.color || '#22d3ee' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold text-ive-text truncate">{selectedProject.name}</div>
                  <div className="text-xs text-ive-text-dim truncate">{selectedProject.repoUrl}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-center">
                    <div className="text-lg font-bold text-ive-green-light">{issues.length}</div>
                    <div className="text-xs text-ive-text-dim">{tIssue('issues')}</div>
                  </div>
                  {canEdit && !bulkMode && (
                    <button
                      onClick={() => setShowAddForm(v => !v)}
                      className="w-9 h-9 rounded-full bg-ive-green/20 border border-ive-green/30 flex items-center justify-center text-ive-green hover:bg-ive-green/30 hover:scale-105 transition-all"
                      title={tIssue('addNewIssue')}
                    >
                      <i className="fa-solid fa-plus text-sm" />
                    </button>
                  )}
                  {canEdit && issues.length > 0 && !bulkMode && !isHistoryTab && (
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
                      onClick={isHistoryTab ? fetchClosedIssues : fetchIssues}
                      disabled={loading || closedLoading}
                      className="w-9 h-9 rounded-full bg-ive-bg-deep border border-ive-border-subtle flex items-center justify-center text-ive-text-dim hover:text-ive-green hover:border-ive-green/30 transition-all disabled:opacity-40"
                      title={tCommon('refresh')}
                    >
                      <i className={`fa-solid fa-arrows-rotate text-sm ${(loading || closedLoading) ? 'fa-spin' : ''}`} />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-1 mb-2 bg-ive-bg-card rounded-lg p-1 border border-ive-border-subtle">
              {FILTER_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setFilter(tab.key)
                    setSelected(new Set())
                    if (tab.key === 'history') fetchClosedIssues()
                  }}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${
                    filter === tab.key
                      ? tab.key === 'history' ? 'bg-ive-text-dim/20 text-ive-text-muted' : 'bg-ive-green/20 text-ive-green'
                      : 'text-ive-text-dim hover:text-ive-text-muted'
                  }`}
                >
                  {tab.label}
                  {(() => {
                    const mineFilter = (i: IveIssue) => !onlyMine || !canFilterMine || isMine(i)
                    const count = tab.key === 'all' ? issues.filter(mineFilter).length
                      : tab.key === 'waiting' ? issues.filter(i => (i.stage === 'waiting' || i.stage === 'verify_waiting') && mineFilter(i)).length
                      : tab.key === 'active' ? issues.filter(i => i.stage === 'dev' && mineFilter(i)).length
                      : tab.key === 'verifying' ? issues.filter(i => i.stage === 'verifying' && mineFilter(i)).length
                      : tab.key === 'failed' ? issues.filter(i => (i.stage === 'dev_fail' || i.stage === 'rejected') && mineFilter(i)).length
                      : tab.key === 'done' ? issues.filter(i => i.stage === 'done' && mineFilter(i)).length
                      : tab.key === 'history' ? closedIssues.filter(mineFilter).length
                      : 0
                    return count > 0 ? <span className="ml-1 text-xs opacity-60">{count}</span> : null
                  })()}
                </button>
              ))}
            </div>

            {/* 검색 + 내게 할당 + 정렬 */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 relative">
                <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-ive-text-dim" />
                <input
                  type="text"
                  value={issueSearchQuery}
                  onChange={e => setIssueSearchQuery(e.target.value)}
                  placeholder={tIssue('searchPlaceholder')}
                  className="w-full bg-ive-bg-card border border-ive-border-subtle rounded-lg pl-7 pr-7 py-1.5 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50 transition-colors"
                />
                {issueSearchQuery && (
                  <button onClick={() => setIssueSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-ive-text-dim hover:text-ive-text">
                    <i className="fa-solid fa-xmark text-[10px]" />
                  </button>
                )}
              </div>
              {canFilterMine && (
                <button
                  onClick={toggleOnlyMine}
                  className={`text-sm font-bold flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-all shrink-0 ${
                    onlyMine
                      ? 'bg-ive-green/20 text-ive-green border-ive-green/40'
                      : 'bg-ive-bg-card text-ive-text-dim border-ive-border-subtle hover:text-ive-text hover:border-ive-green/30'
                  }`}
                  title="내게 할당된 이슈만 보기"
                >
                  <i className={`fa-solid ${onlyMine ? 'fa-user-check' : 'fa-user'}`} />
                  내게
                </button>
              )}
              <button
                onClick={() => {
                  const next = sortOrder === 'newest' ? 'oldest' : 'newest'
                  setIssuesSort(next)
                }}
                className="text-sm font-bold text-ive-text-dim hover:text-ive-text flex items-center gap-1 px-3 py-1.5 rounded-lg bg-ive-bg-card border border-ive-border-subtle hover:border-ive-green/30 transition-all shrink-0"
              >
                <i className={`fa-solid ${sortOrder === 'newest' ? 'fa-arrow-down-wide-short' : 'fa-arrow-up-wide-short'}`} />
                {sortOrder === 'newest' ? tSort('newest') : tSort('oldest')}
              </button>
            </div>

            {/* 이슈 추가 폼 */}
            {showAddForm && (
              <div className="mb-3 bg-ive-bg-card border border-ive-green/30 rounded-lg p-3">
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
                {/* 담당자 */}
                {gitMembers.length > 0 && (
                  <div className="mb-2">
                    <label className="text-xs font-bold text-ive-text-dim mb-1 block">
                      <i className="fa-solid fa-user-tag mr-1" />{tIssue('assignee')}
                    </label>
                    <button
                      type="button"
                      onClick={() => openAssigneeModal([-1])}
                      className="w-full bg-ive-bg-deep border border-ive-border-dark border-dashed rounded-lg px-3 py-2 text-left flex items-center gap-2 text-sm focus:outline-none hover:border-ive-green/50 transition-colors"
                    >
                      {selectedAssignees.length > 0 ? (
                        <span className="flex items-center gap-1.5 flex-wrap">
                          {selectedAssignees.map(a => (
                            <span key={a.id} className="flex items-center gap-1 bg-ive-bg-card rounded px-1.5 py-0.5">
                              {a.avatarUrl ? <img src={a.avatarUrl} className="w-4 h-4 rounded-full" alt="" /> : <i className="fa-solid fa-user text-xs text-ive-text-dim" />}
                              <span className="text-ive-text font-bold text-xs">{a.name || a.username}</span>
                            </span>
                          ))}
                          <i className="fa-solid fa-pen text-[10px] text-ive-text-dim ml-auto" />
                        </span>
                      ) : (
                        <span className="text-ive-text-dim font-bold"><i className="fa-solid fa-user-plus mr-1.5" />{tIssue('selectAssignee')}</span>
                      )}
                    </button>
                  </div>
                )}
                {/* 에이전트 지정 드롭다운 */}
                <div ref={agentDropdownRef} className="relative mb-2">
                  <label className="text-xs font-bold text-ive-text-dim mb-1 block">
                    <i className="fa-solid fa-user-gear mr-1" />{tIssue('preferredAgent')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setAgentDropdownOpen(v => !v)}
                    className="w-full bg-ive-bg-card border border-ive-border-dark rounded-lg px-3 py-2 text-left flex items-center gap-2 text-sm focus:outline-none focus:border-ive-green/50 transition-colors"
                  >
                    {preferredAgentId === 'none' ? (
                      <>
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0 text-ive-text-muted"><i className="fa-solid fa-ban" /></span>
                        <span className="text-ive-text font-bold">{tIssue('noAssignment')}</span>
                      </>
                    ) : preferredAgentId === 'assignee' ? (
                      <>
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0 text-ive-cyan"><i className="fa-solid fa-user" /></span>
                        <span className="text-ive-text font-bold">{tIssue('assigneeHandles')}</span>
                      </>
                    ) : preferredAgentId ? (() => {
                      const pa = projectAgents.find(a => a.agentId === preferredAgentId)
                      if (!pa) return <span className="text-ive-text font-bold">{tIssue('noPreference')}</span>
                      const cli = CLI_CONFIG[pa.agent.cliName]
                      return <>
                        <AgentAvatar avatar={pa.agent.avatar} size="xs" />
                        <span className="text-ive-text font-bold">{pa.agent.name}</span>
                        <span className={`text-xs ${cli.color}`}><i className={`${cli.icon} mr-0.5`} />{cli.label}</span>
                      </>
                    })() : (
                      <>
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0 text-ive-green"><i className="fa-solid fa-shuffle" /></span>
                        <span className="text-ive-text font-bold">{tIssue('noPreference')}</span>
                      </>
                    )}
                    <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim ml-auto transition-transform ${agentDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {agentDropdownOpen && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-ive-bg-solid border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg">
                      <button
                        onClick={() => { setPreferredAgentId('none'); setAgentDropdownOpen(false) }}
                        className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                          preferredAgentId === 'none' ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
                        }`}
                      >
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-ban" /></span>
                        <span className="font-bold">{tIssue('noAssignment')}</span>
                      </button>
                      <button
                        onClick={() => { setPreferredAgentId(null); setAgentDropdownOpen(false) }}
                        className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                          preferredAgentId === null ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
                        }`}
                      >
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-shuffle" /></span>
                        <span className="font-bold">{tIssue('noPreference')}</span>
                      </button>
                      <button
                        onClick={() => { setPreferredAgentId('assignee'); setAgentDropdownOpen(false) }}
                        className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                          preferredAgentId === 'assignee' ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text-dim hover:bg-white/5'
                        }`}
                      >
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-user" /></span>
                        <span className="font-bold">{tIssue('assigneeHandles')}</span>
                      </button>
                      {projectAgents.map(pa => {
                        const cli = CLI_CONFIG[pa.agent.cliName]
                        const isOffline = pa.agent.status === 'offline'
                        return (
                          <button
                            key={pa.agentId}
                            onClick={() => { setPreferredAgentId(pa.agentId); setAgentDropdownOpen(false) }}
                            className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                              preferredAgentId === pa.agentId ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                            }`}
                          >
                            <AgentAvatar avatar={pa.agent.avatar} size="xs" />
                            <span className="font-bold">{pa.agent.name}</span>
                            <span className={`text-xs ${cli.color}`}><i className={`${cli.icon} mr-0.5`} />{cli.label}</span>
                            {isOffline && <span className="text-xs text-ive-red ml-auto"><i className="fa-solid fa-circle-exclamation mr-0.5" />{tIssue('agentOfflineWarning')}</span>}
                            {!isOffline && pa.agent.status === 'busy' && <span className="ml-auto w-2 h-2 rounded-full bg-ive-cyan animate-pulse" />}
                            {!isOffline && pa.agent.status === 'available' && <span className="ml-auto w-2 h-2 rounded-full bg-ive-green" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                {/* 담당자가 처리 모드인데 담당자 미지정 시 안내 */}
                {preferredAgentId === 'assignee' && selectedAssignees.length === 0 && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-ive-amber/10 border border-ive-amber/20 text-xs text-ive-amber">
                    <i className="fa-solid fa-triangle-exclamation mr-1" />
                    {tIssue('assigneeRequiredWarning')}
                  </div>
                )}
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
            {bulkMode && !isHistoryTab && (
              <div className="mb-3 bg-ive-bg-card border border-ive-amber/30 rounded-lg p-3">
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
                  <button onClick={exitBulkMode} className="text-sm text-ive-red font-bold px-3 py-1.5 rounded-lg border border-ive-red/30 bg-ive-bg-deep hover:bg-ive-red/10 transition-all active:scale-95">
                    <i className="fa-solid fa-xmark mr-1" />{tCommon('cancel')}
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
                    {gitMembers.length > 0 && (
                      <button
                        onClick={() => openAssigneeModal([...selected])}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg border text-ive-cyan border-ive-cyan/30 bg-ive-bg-deep hover:bg-ive-cyan/10 transition-all active:scale-95"
                      >
                        <i className="fa-solid fa-user-tag mr-1" />{tIssue('assignee')} ({selected.size})
                      </button>
                    )}
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
            {(isHistoryTab ? closedLoading : loading) && (isHistoryTab ? closedIssues : issues).length === 0 ? (
              <div className="text-center py-20 text-ive-text-muted">{tIssue('loadingIssues')}</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 bg-ive-bg/50 rounded-2xl border border-dashed border-ive-border-subtle">
                <i className="fa-solid fa-inbox text-4xl text-ive-text-dim mb-4 block" />
                <p className="text-base text-ive-text-muted">
                  {isHistoryTab ? tIssue('noFilterMatch') : issues.length === 0 ? tIssue('noIveIssues') : tIssue('noFilterMatch')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filtered.map(issue => {
                  const displayStage = issue.state === 'closed' && (!issue.stage || issue.stage === 'none') ? 'closed' : issue.stage
                  const stageInfo = STAGE_INFO[displayStage] || STAGE_INFO.unknown
                  const isSelected = selected.has(issue.iid)
                  return (
                    <div
                      key={issue.iid}
                      onClick={async () => {
                        if (bulkMode) { toggleSelect(issue.iid); return }
                        if (navigatingIid) return
                        const el = document.querySelector('[data-scroll-container="issues-list"]')
                        if (el) sessionStorage.setItem('issues-scroll', String(el.scrollTop))
                        setNavigatingIid(issue.iid)
                        try {
                          // 이슈 상세 + 노트를 prefetch하여 캐시
                          const [issueRes, notesRes] = await Promise.all([
                            fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}`),
                            fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}/notes`),
                          ])
                          if (issueRes.ok) sessionStorage.setItem(`issue-detail-${selectedProjectId}-${issue.iid}`, JSON.stringify(await issueRes.json()))
                          if (notesRes.ok) sessionStorage.setItem(`issue-notes-${selectedProjectId}-${issue.iid}`, JSON.stringify(await notesRes.json()))
                        } catch { /* 실패해도 이동 */ }
                        router.push(`/issues/${selectedProjectId}/${issue.iid}`)
                      }}
                      className={`bg-ive-bg-card border rounded-lg p-4 transition-all cursor-pointer active:scale-[0.98] ${
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
                            <span className="text-sm font-bold text-ive-green">#{issue.iid}</span>
                            <h3 className="text-base font-bold text-ive-text leading-snug mt-0.5 line-clamp-2">{issue.title}</h3>
                          </div>
                        </div>
                        {navigatingIid === issue.iid ? (
                          <i className="fa-solid fa-circle-notch fa-spin text-ive-green shrink-0" />
                        ) : issue.stage !== 'none' && (
                          <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg border ${stageInfo.color}`}>
                            <i className={`fa-solid ${stageInfo.icon} mr-1`} />
                            {stageInfo.label}
                          </span>
                        )}
                      </div>
                      {issue.stage === 'dev_fail' && issue.failReason && (
                        <div className="mb-1.5 px-2 py-1 rounded-lg bg-ive-red/10 border border-ive-red/20 text-xs text-ive-red">
                          <i className="fa-solid fa-triangle-exclamation mr-1" />
                          {issue.failReason}
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-xs text-ive-text-dim">
                        {(() => {
                          const agentEditable = canEdit && !bulkMode && issue.stage === 'waiting' && projectAgents.length > 0
                          const onClickEdit = agentEditable ? (e: React.MouseEvent) => { e.stopPropagation(); setAgentPickerIid(issue.iid) } : undefined
                          if (issue.assignMode === 'assignee') {
                            return (
                              <span
                                className={`flex items-center gap-1 text-ive-cyan ${agentEditable ? 'cursor-pointer hover:text-ive-cyan/80' : ''}`}
                                onClick={onClickEdit}
                              >
                                {issue.assignees?.[0]?.avatarUrl ? (
                                  <img src={issue.assignees[0].avatarUrl} className="w-4 h-4 rounded-full" alt="" />
                                ) : (
                                  <i className="fa-solid fa-user text-[10px]" />
                                )}
                                <span className="font-bold">{issue.assignees?.[0]?.name || issue.assignees?.[0]?.username || tIssue('assigneeHandles')}</span>
                                {agentEditable && <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />}
                              </span>
                            )
                          }
                          if (issue.preferredAgentId && issue.preferredAgentAvatar) {
                            return (
                              <span
                                className={`flex items-center gap-1 ${agentEditable ? 'cursor-pointer hover:text-ive-text' : ''}`}
                                onClick={onClickEdit}
                              >
                                <AgentAvatar avatar={issue.preferredAgentAvatar} size="xs" />
                                <span className="font-bold text-ive-text-muted">{issue.preferredAgentName}</span>
                                {issue.preferredAgentCliName && (() => {
                                  const cli = CLI_CONFIG[issue.preferredAgentCliName as CliName]
                                  return cli ? <i className={`${cli.icon} ${cli.color} text-[10px]`} /> : null
                                })()}
                                {agentEditable && <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />}
                              </span>
                            )
                          }
                          if (agentEditable) {
                            return (
                              <span
                                className="flex items-center gap-1 cursor-pointer text-ive-text-dim hover:text-ive-green"
                                onClick={onClickEdit}
                              >
                                <i className="fa-solid fa-user-gear text-[10px]" />
                                <span className="font-bold">{tIssue('noPreference')}</span>
                                <i className="fa-solid fa-pen-to-square text-[9px] opacity-60" />
                              </span>
                            )
                          }
                          return null
                        })()}
                        <span>
                          <i className="fa-solid fa-user mr-1" />
                          {issue.author}
                        </span>
                        {/* 담당자 아바타 + 편집 */}
                        {((issue.assignees && issue.assignees.length > 0) || (canEdit && !bulkMode && gitMembers.length > 0)) && (
                          <span className="flex items-center gap-1"
                            onClick={(e) => {
                              if (canEdit && !bulkMode && gitMembers.length > 0) {
                                e.stopPropagation()
                                openAssigneeModal([issue.iid])
                              }
                            }}
                          >
                            {(issue.assignees || []).map(a => (
                              <span key={a.id} className="flex items-center gap-0.5">
                                {a.avatarUrl ? <img src={a.avatarUrl} className="w-4 h-4 rounded-full" alt="" /> : <i className="fa-solid fa-user text-[10px]" />}
                                <span className="text-xs font-bold text-ive-text-muted">{a.name || a.username}</span>
                              </span>
                            ))}
                            {canEdit && !bulkMode && gitMembers.length > 0 && !(issue.assignees && issue.assignees.length > 0) && (
                              <i className="fa-solid fa-user-pen text-[10px] text-ive-text-dim hover:text-ive-green cursor-pointer transition-all" />
                            )}
                          </span>
                        )}
                        <span>
                          <i className="fa-solid fa-calendar-day mr-1" />
                          {formatDateMedium(issue.updatedAt, state.user?.locale, state.user?.timezone)}
                        </span>
                        {canEdit && !bulkMode && !isHistoryTab && (
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
      {/* 담당자 선택 모달 — 단일 선택 + 확인 */}
      <Modal open={assigneeModalIids.length > 0} onClose={() => setAssigneeModalIids([])} title={`${tIssue('assignee')}${assigneeModalIids.length > 1 && !assigneeModalIids.includes(-1) ? ` (${assigneeModalIids.length}${tCommon('items')})` : ''}`} size="sm">
        <div className="p-1.5 border-b border-ive-border-dark">
          <input
            type="text"
            value={assigneeModalSearch}
            onChange={e => setAssigneeModalSearch(e.target.value)}
            placeholder={tIssue('searchMember')}
            className="w-full bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50"
            autoFocus
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {/* 담당자 없음 옵션 */}
          <button
            onClick={() => setAssigneeModalPick(null)}
            className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
              !assigneeModalPick ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
            }`}
          >
            {!assigneeModalPick ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
            <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0">
              <i className="fa-solid fa-ban text-ive-text-dim text-xs" />
            </div>
            <span className="font-bold">{tIssue('noAssignee')}</span>
          </button>
          {gitMembers.filter(m => {
            if (!assigneeModalSearch) return true
            const q = assigneeModalSearch.toLowerCase()
            return (m.name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
          }).map(m => {
            const isPicked = assigneeModalPick?.id === m.id
            return (
              <button
                key={m.id}
                onClick={() => setAssigneeModalPick(m)}
                className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
                  isPicked ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                }`}
              >
                {isPicked ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
                {m.avatarUrl ? <img src={m.avatarUrl} className="w-7 h-7 rounded-full shrink-0" alt="" /> : <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0"><i className="fa-solid fa-user text-ive-text-dim text-xs" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate">{m.name || m.username}</div>
                  {m.name && m.name !== m.username && <div className="text-xs text-ive-text-dim truncate">@{m.username}</div>}
                </div>
              </button>
            )
          })}
        </div>
        <div className="p-3 border-t border-ive-border-dark flex gap-2">
          <button
            onClick={() => setAssigneeModalIids([])}
            className="flex-1 py-2 rounded-lg text-sm font-bold text-ive-text-dim border border-ive-border-subtle hover:bg-white/5 transition-all"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={handleConfirmAssignee}
            className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-green text-ive-bg-deep transition-all active:scale-[0.98]"
          >
            {tCommon('confirm')}
          </button>
        </div>
      </Modal>
      {/* 대기 이슈 에이전트 선택 모달 */}
      <Modal open={agentPickerIid !== null} onClose={() => setAgentPickerIid(null)} title={`#${agentPickerIid ?? ''} ${tIssue('preferredAgent')}`} size="sm">
        {(() => {
          const targetIssue = agentPickerIid !== null ? issues.find(i => i.iid === agentPickerIid) : null
          const currentMode = targetIssue?.assignMode || 'auto'
          const currentAgentId = targetIssue?.preferredAgentId || null
          return (
            <div className="max-h-[60vh] overflow-y-auto">
              <button
                disabled={agentPickerSaving}
                onClick={() => agentPickerIid !== null && handleChangeIssueAgent(agentPickerIid, 'auto', null)}
                className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
                  currentMode === 'auto' ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
                }`}
              >
                <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-shuffle" /></span>
                <span className="font-bold">{tIssue('noPreference')}</span>
              </button>
              <button
                disabled={agentPickerSaving}
                onClick={() => agentPickerIid !== null && handleChangeIssueAgent(agentPickerIid, 'assignee', null)}
                className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
                  currentMode === 'assignee' ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text-dim hover:bg-white/5'
                }`}
              >
                <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-user" /></span>
                <span className="font-bold">{tIssue('assigneeHandles')}</span>
              </button>
              {projectAgents.map(pa => {
                const cli = CLI_CONFIG[pa.agent.cliName]
                const isOffline = pa.agent.status === 'offline'
                const isPicked = currentMode === 'agent' && currentAgentId === pa.agentId
                return (
                  <button
                    key={pa.agentId}
                    disabled={agentPickerSaving}
                    onClick={() => agentPickerIid !== null && handleChangeIssueAgent(agentPickerIid, 'agent', pa.agentId)}
                    className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
                      isPicked ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                    }`}
                  >
                    <AgentAvatar avatar={pa.agent.avatar} size="xs" />
                    <span className="font-bold">{pa.agent.name}</span>
                    <span className={`text-xs ${cli.color}`}><i className={`${cli.icon} mr-0.5`} />{cli.label}</span>
                    {isOffline && <span className="text-xs text-ive-red ml-auto"><i className="fa-solid fa-circle-exclamation mr-0.5" />{tIssue('agentOfflineWarning')}</span>}
                    {!isOffline && pa.agent.status === 'busy' && <span className="ml-auto w-2 h-2 rounded-full bg-ive-cyan animate-pulse" />}
                    {!isOffline && pa.agent.status === 'available' && <span className="ml-auto w-2 h-2 rounded-full bg-ive-green" />}
                  </button>
                )
              })}
            </div>
          )
        })()}
      </Modal>
    </PullToRefresh>
  )
}
