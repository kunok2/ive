'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import { useToast } from '@/components/ui/Toast'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useTranslations } from 'next-intl'
import type { IveIssue, ProjectAgent, StageInfo } from '@/components/tabs/issues/types'
import ProjectSelector from '@/components/tabs/issues/ProjectSelector'
import ProjectHeader from '@/components/tabs/issues/ProjectHeader'
import FilterToolbar from '@/components/tabs/issues/FilterToolbar'
import IssueList from '@/components/tabs/issues/IssueList'
import IssueAddForm from '@/components/tabs/issues/IssueAddForm'
import BulkActionBar from '@/components/tabs/issues/BulkActionBar'
import AssigneePickerModal from '@/components/tabs/issues/AssigneePickerModal'
import AgentPickerModal from '@/components/tabs/issues/AgentPickerModal'
import LabelCheckModal from '@/components/tabs/issues/LabelCheckModal'

export default function IssuesTab({ addTrigger }: { addTrigger?: number }) {
  const router = useRouter()
  const { confirm, alert: showAlert } = useDialog()
  const { state } = useStore()
  const { toast } = useToast()
  const { activeTab, setActiveTab, issuesProjectId, setIssuesProjectId, issuesFilter, setIssuesFilter, issuesSort, setIssuesSort } = useTab()
  const tStage = useTranslations('stage')
  const tFilter = useTranslations('filter')
  const tIssue = useTranslations('issue')
  const tProject = useTranslations('project')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')

  // --- Constants ---
  const STAGE_INFO: Record<string, StageInfo> = useMemo(() => ({
    waiting:         { label: tStage('waiting'),         color: 'bg-ive-cyan/20 text-ive-cyan border-ive-cyan/30',     icon: 'fa-clock' },
    verify_waiting:  { label: tStage('verify_waiting'),  color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30', icon: 'fa-hourglass-half' },
    dev:             { label: tStage('dev'),             color: 'bg-ive-cyan/20 text-ive-cyan border-ive-cyan/30',    icon: 'fa-code' },
    dev_fail:        { label: tStage('dev_fail'),        color: 'bg-ive-red/20 text-ive-red border-ive-red/30',        icon: 'fa-circle-xmark' },
    verifying:       { label: tStage('verifying'),       color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30', icon: 'fa-magnifying-glass' },
    confirm_waiting: { label: tStage('confirm_waiting'), color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30', icon: 'fa-hourglass-half' },
    confirming:      { label: tStage('confirming'),      color: 'bg-ive-amber/20 text-ive-amber border-ive-amber/30', icon: 'fa-clipboard-check' },
    done:            { label: tStage('done'),            color: 'bg-ive-green/20 text-ive-green border-ive-green/30', icon: 'fa-circle-check' },
    closed:         { label: tStage('closed'),         color: 'bg-white/5 text-ive-text-muted border-ive-border-subtle', icon: 'fa-lock' },
    rejected:       { label: tStage('rejected'),       color: 'bg-ive-red/20 text-ive-red border-ive-red/30',        icon: 'fa-rotate-left' },
    unknown:        { label: tStage('unknown'),        color: 'bg-white/5 text-ive-text-dim border-ive-border-subtle', icon: 'fa-question' },
  }), [tStage])

  const FILTER_TABS = useMemo(() => [
    { key: 'all', label: tFilter('all') },
    { key: 'waiting', label: tFilter('waiting') },
    { key: 'active', label: tFilter('active') },
    { key: 'failed', label: tFilter('failed') },
    { key: 'done', label: tFilter('done') },
    { key: 'history', label: tFilter('history') },
  ], [tFilter])

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
    confirm_waiting: [
      { action: 'start_confirmation', label: tIssue('startConfirmation'), icon: 'fa-play' },
      { action: 'cancel', label: tIssue('cancelConfirmWait'), icon: 'fa-rotate-left', danger: true },
    ],
    confirming: [
      { action: 'accept', label: tIssue('acceptConfirm'), icon: 'fa-circle-check' },
      { action: 'return_to_dev', label: tIssue('returnToDev'), icon: 'fa-rotate-left', danger: true },
    ],
    done: [
      { action: 'reopen', label: tIssue('reopenToWaiting'), icon: 'fa-rotate' },
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
    rejected: [
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
  }), [tIssue])

  // --- "Only mine" filter ---
  const myGitUserId = state.user?.oauthUserId ? String(state.user.oauthUserId) : null
  const canFilterMine = !!myGitUserId
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
  const isMine = useCallback((issue: IveIssue): boolean => {
    if (!myGitUserId) return false
    return !!issue.assignees?.some(a => a.id != null && String(a.id) === myGitUserId)
  }, [myGitUserId])

  // --- Core state ---
  const selectedProjectId = issuesProjectId ?? ''
  const filter = issuesFilter
  const sortOrder = issuesSort as 'newest' | 'oldest'
  const setSelectedProjectId = (id: string) => setIssuesProjectId(id)
  const setFilter = (f: string) => setIssuesFilter(f)

  // #272: 프로젝트별 배정 폐기. 이슈 생성/지정 에이전트 picker는 "현재 로그인 사용자(의뢰자) 의 에이전트 풀"을 보여준다.
  // store의 state.agents 는 현재 사용자가 소유한 에이전트 목록. useMemo로 파생하여
  // store의 10초 폴링이 reference만 바꾸어도 effect 재실행/네트워크 요청을 유발하지 않게 한다.
  const projectAgents = useMemo<ProjectAgent[]>(() => state.agents.map(a => ({
    agentId: a.id,
    agent: { id: a.id, name: a.name, avatar: a.avatar, cliName: a.cliName, status: a.status, enabled: a.enabled, pausedUntil: a.pausedUntil },
  })), [state.agents])

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
  const previousActiveTabRef = useRef(activeTab)
  const handledAddTriggerRef = useRef(addTrigger ?? 0)
  const [newBody, setNewBody] = useState(() => {
    if (typeof window !== 'undefined') {
      const pid = issuesProjectId ?? ''
      if (pid) return localStorage.getItem(`ive-issue-draft-${pid}`) || ''
    }
    return ''
  })
  const [creating, setCreating] = useState(false)
  const [labelModalOpen, setLabelModalOpen] = useState(false)
  const [labelStatus, setLabelStatus] = useState<{ label: string; exists: boolean }[]>([])
  const [labelCreating, setLabelCreating] = useState(false)
  const [labelCreateMsg, setLabelCreateMsg] = useState<string | null>(null)
  const [pendingCreateAfterLabels, setPendingCreateAfterLabels] = useState(false)
  const [pendingRegisterOnly, setPendingRegisterOnly] = useState(false)
  const [creatingMode, setCreatingMode] = useState<'register' | 'process' | null>(null)
  const handleCreateIssueRef = useRef<(registerOnly?: boolean) => void>(() => {})
  const [issueSearchQuery, setIssueSearchQuery] = useState('')
  const [closing, setClosing] = useState<number | null>(null)
  const [preferredAgentId, setPreferredAgentId] = useState<string | null>(null)
  const [gitMembers, setGitMembers] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  // 확인자 후보 — 검증자/담당자(프로젝트 멤버)와 달리, provider 로 식별되는 모든 IVE 사용자.
  const [confirmerMembers, setConfirmerMembers] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  const [selectedAssignees, setSelectedAssignees] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  const [autoAssign, setAutoAssign] = useState(false)
  // 검증자/확인자 사전 배정 — 'creator' | 'auto' | 'specific'
  const [verifierMode, setVerifierMode] = useState<'creator' | 'auto' | 'specific'>('creator')
  const [verifierUserId, setVerifierUserId] = useState<string | null>(null)
  const [verifierUsername, setVerifierUsername] = useState<string | null>(null)
  const [confirmerMode, setConfirmerMode] = useState<'creator' | 'auto' | 'specific'>('creator')
  const [confirmerUserId, setConfirmerUserId] = useState<string | null>(null)
  const [confirmerUsername, setConfirmerUsername] = useState<string | null>(null)
  // 마감일 (YYYY-MM-DD). 빈 문자열이면 미설정.
  const [newDueDate, setNewDueDate] = useState<string>('')
  const [notifyOnDone, setNotifyOnDone] = useState(false)
  const [assigneeModalIids, setAssigneeModalIids] = useState<number[]>([])
  const [assigneeModalSearch, setAssigneeModalSearch] = useState('')
  const [assigneeModalPick, setAssigneeModalPick] = useState<{ id: number; username: string; name: string; avatarUrl: string } | null>(null)
  const [assigneeModalAuto, setAssigneeModalAuto] = useState(false)
  const [agentPickerIid, setAgentPickerIid] = useState<number | null>(null)
  const [agentPickerSaving, setAgentPickerSaving] = useState(false)

  // --- Scroll restoration ---
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

  // --- Bulk mode helpers ---
  const toggleSelect = (iid: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(iid)) next.delete(iid)
      else next.add(iid)
      return next
    })
  }
  const exitBulkMode = () => { setBulkMode(false); setSelected(new Set()); setBulkProgress(null) }
  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(i => i.iid)))
  }

  // --- Data fetching ---
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
    if (state.projects.length === 1 && !selectedProjectId) setSelectedProjectId(state.projects[0].id)
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

  const fetchGitMembers = useCallback(() => {
    if (!selectedProjectId) { setGitMembers([]); setConfirmerMembers([]); return }
    fetch(`/api/projects/${selectedProjectId}/members`).then(res => res.ok ? res.json() : []).then(setGitMembers).catch(() => setGitMembers([]))
    fetch(`/api/projects/${selectedProjectId}/confirmer-candidates`).then(res => res.ok ? res.json() : []).then(setConfirmerMembers).catch(() => setConfirmerMembers([]))
  }, [selectedProjectId])

  const fetchClosedIssues = useCallback(() => {
    if (!selectedProjectId) return Promise.resolve()
    setClosedLoading(true)
    return fetch(`/api/projects/${selectedProjectId}/issues?state=closed`)
      .then(res => res.ok ? res.json() : [])
      .then(data => setClosedIssues(data))
      .finally(() => setClosedLoading(false))
  }, [selectedProjectId])

  useEffect(() => { setClosedIssues([]) }, [selectedProjectId])
  useEffect(() => { fetchIssues() }, [fetchIssues])
  useEffect(() => { if (filter === 'history' && selectedProjectId) fetchClosedIssues() }, [filter, selectedProjectId, fetchClosedIssues])
  useEffect(() => { if (activeTab === 'issues' && selectedProjectId) { fetchIssues(); fetchGitMembers() } }, [activeTab])

  // 이슈 목록은 git 호출이 비싸 자동 갱신하지 않는다.
  // 사용자가 직접 새로고침 버튼/Pull-to-Refresh 를 누르거나, 본인이 수행한 액션 직후
  // (close/bulk 등에서 dispatch 되는 'refresh-counts')에만 다시 가져온다.
  useEffect(() => {
    if (activeTab !== 'issues' || !selectedProjectId) return
    const refresh = () => { if (filter === 'history') fetchClosedIssues(); else fetchIssues() }
    window.addEventListener('refresh-counts', refresh)
    return () => { window.removeEventListener('refresh-counts', refresh) }
  }, [activeTab, selectedProjectId, filter, fetchIssues, fetchClosedIssues])

  useEffect(() => {
    const previousActiveTab = previousActiveTabRef.current
    previousActiveTabRef.current = activeTab
    const enteredIssuesTab = activeTab === 'issues' && previousActiveTab !== 'issues'

    const trigger = addTrigger ?? 0
    if (trigger > handledAddTriggerRef.current && selectedProjectId) {
      handledAddTriggerRef.current = trigger
      setShowAddForm(true)
      return
    }

    if (enteredIssuesTab) setShowAddForm(false)
  }, [activeTab, addTrigger, selectedProjectId])

  // --- Draft persistence ---
  const saveDraft = useCallback((value: string) => {
    if (!selectedProjectId) return
    if (value) localStorage.setItem(`ive-issue-draft-${selectedProjectId}`, value)
    else localStorage.removeItem(`ive-issue-draft-${selectedProjectId}`)
  }, [selectedProjectId])

  const handleBodyChange = useCallback((value: string) => { setNewBody(value); saveDraft(value) }, [saveDraft])

  useEffect(() => {
    if (selectedProjectId) {
      const draft = localStorage.getItem(`ive-issue-draft-${selectedProjectId}`)
      setNewBody(draft || '')
      fetchGitMembers()
    } else {
      setNewBody('')
      setGitMembers([])
      setConfirmerMembers([])
    }
    setPreferredAgentId(null)
    setSelectedAssignees([])
    setAutoAssign(false)
  }, [selectedProjectId, fetchGitMembers])

  // --- Assignee modal ---
  const handleConfirmAssignee = async () => {
    const isCreateMode = assigneeModalIids.includes(-1)
    if (isCreateMode) {
      setSelectedAssignees(assigneeModalPick ? [assigneeModalPick] : [])
      setAutoAssign(assigneeModalAuto)
      setAssigneeModalIids([])
      return
    }
    if (!canEdit) { toast(tIssue('noEditPermissionViewer'), 'error'); setAssigneeModalIids([]); return }
    const updated = assigneeModalAuto ? [] : (assigneeModalPick ? [assigneeModalPick] : [])
    const prevSnapshots = new Map<number, IveIssue['assignees']>()
    const prevAutoMap = new Map<number, boolean>()
    for (const iid of assigneeModalIids) {
      const cur = issues.find(i => i.iid === iid)
      if (cur) {
        prevSnapshots.set(iid, cur.assignees)
        prevAutoMap.set(iid, !!cur.assigneeAuto)
      }
    }
    setIssues(prev => prev.map(i => assigneeModalIids.includes(i.iid) ? { ...i, assignees: updated, assigneeAuto: assigneeModalAuto } : i))
    setAssigneeModalIids([])

    const results = await Promise.all(assigneeModalIids.map(async iid => {
      try {
        const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/assignees`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigneeIds: updated.map(a => a.id),
            assigneeUsernames: updated.map(a => a.username),
            assigneeAuto: assigneeModalAuto,
          }),
        })
        if (!res.ok) {
          let message = `${tIssue('assigneeChangeFailed')} (#${iid})`
          if (res.status === 403) message = `${tIssue('noEditPermissionViewer')} (#${iid})`
          else if (res.status === 401) message = tErrors('loginRequired')
          else { try { const data = await res.json(); if (data?.error) message = `${data.error} (#${iid})` } catch { /* ignore */ } }
          return { iid, ok: false, message }
        }
        return { iid, ok: true }
      } catch (e) { return { iid, ok: false, message: `${tCommon('networkError')} (#${iid}): ${(e as Error).message}` } }
    }))
    const failed = results.filter(r => !r.ok)
    if (failed.length > 0) {
      setIssues(prev => prev.map(i => {
        if (prevSnapshots.has(i.iid) && failed.some(f => f.iid === i.iid)) {
          return { ...i, assignees: prevSnapshots.get(i.iid)!, assigneeAuto: prevAutoMap.get(i.iid) ?? false }
        }
        return i
      }))
      toast(failed[0].message || tIssue('assigneeChangeFailed'), 'error')
    }
  }

  const openAssigneeModal = (iids: number[]) => {
    setAssigneeModalSearch('')
    if (iids.length === 1 && !iids.includes(-1)) {
      const issue = issues.find(i => i.iid === iids[0])
      setAssigneeModalPick(issue?.assignees?.[0] || null)
      setAssigneeModalAuto(!!issue?.assigneeAuto)
    } else if (iids.includes(-1)) {
      setAssigneeModalPick(selectedAssignees[0] || null)
      setAssigneeModalAuto(autoAssign)
    } else {
      setAssigneeModalPick(null)
      setAssigneeModalAuto(false)
    }
    setAssigneeModalIids(iids)
  }

  // --- Agent picker ---
  // 처리자 picker — AI 에이전트(특정/자동) 또는 사람(담당자) 선택을 한 모달에서 처리.
  //   - mode='assignee' + assignee 가 있으면: 이슈의 git assignees 도 함께 업데이트.
  //   - 그 외: 기존대로 preferred-agent 만 업데이트.
  const handleChangeIssueAgent = async (
    iid: number,
    mode: 'auto' | 'assignee' | 'agent',
    agentId: string | null,
    assignee?: { id: number; username: string; name: string; avatarUrl: string } | null,
  ) => {
    setAgentPickerSaving(true)
    try {
      // 1) assignMode 업데이트
      const body: any = mode === 'agent' ? { assignMode: 'agent', agentId } : { assignMode: mode }
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/preferred-agent`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || tIssue('settingsSaveFailed'), 'error')
        return
      }
      const data = await res.json()
      setIssues(prev => prev.map(i => i.iid === iid ? {
        ...i, assignMode: data.assignMode, preferredAgentId: data.preferredAgentId,
        preferredAgentName: data.preferredAgentName, preferredAgentAvatar: data.preferredAgentAvatar,
        preferredAgentCliName: data.preferredAgentCliName,
      } : i))

      // 2) 사람(담당자) 직접 지정 — 이슈의 git assignees 도 함께 업데이트
      if (mode === 'assignee' && assignee) {
        const aRes = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/assignees`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigneeIds: [assignee.id],
            assigneeUsernames: [assignee.username],
            assigneeAuto: false,
          }),
        })
        if (!aRes.ok) {
          const d = await aRes.json().catch(() => ({}))
          toast(d.error || tIssue('assigneeChangeFailed'), 'error')
        } else {
          setIssues(prev => prev.map(i => i.iid === iid ? { ...i, assignees: [assignee], assigneeAuto: false } : i))
        }
      }
      setAgentPickerIid(null)
    } catch (err: any) { toast(err.message || tIssue('networkErrorOccurred'), 'error') }
    finally { setAgentPickerSaving(false) }
  }

  // --- Bulk actions ---
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
        title: tIssue('bulkCloseTitle'), message: tIssue('bulkCloseConfirm', { count: selectedIssues.length }),
        confirmText: tCommon('close'), cancelText: tCommon('cancel'), variant: 'warning',
      })
      if (!ok) return
    }
    cancelRef.current = false
    setBulkProgress({ total: selectedIssues.length, done: 0, failed: 0 })
    let done = 0, failed = 0
    for (const issue of selectedIssues) {
      if (cancelRef.current) break
      try {
        const url = isClose ? `/api/projects/${selectedProjectId}/issues/${issue.iid}/close` : `/api/projects/${selectedProjectId}/issues/${issue.iid}/stage`
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(isClose ? {} : { body: JSON.stringify({ stage, action }) }) })
        if (!res.ok) { failed++; const data = await res.json().catch(() => ({})); console.error(`[Bulk] #${issue.iid} failed:`, data.error || res.statusText) }
        else { done++ }
      } catch (err) { failed++; console.error(`[Bulk] #${issue.iid} error:`, err) }
      setBulkProgress({ total: selectedIssues.length, done: done + failed, failed })
    }
    if (failed > 0) toast(tIssue('bulkFailedCount', { count: failed }), 'error')
    else if (done > 0) toast(tIssue('bulkCompletedCount', { count: done }), 'success')
    if (action === 'waiting' && projectAgents.length === 0) {
      showAlert({ title: tIssue('noAgentWarningTitle'), message: tIssue('noAgentWarningDesc'), variant: 'error' })
    }
    fetchIssues()
    window.dispatchEvent(new CustomEvent('refresh-counts'))
    setTimeout(() => { exitBulkMode() }, cancelRef.current ? 500 : 1000)
  }

  // --- Label creation ---
  useEffect(() => {
    if (!labelModalOpen && pendingCreateAfterLabels) { setPendingCreateAfterLabels(false); handleCreateIssueRef.current(pendingRegisterOnly); setPendingRegisterOnly(false) }
  }, [labelModalOpen, pendingCreateAfterLabels, pendingRegisterOnly])

  const handleAutoCreateLabels = async () => {
    if (!selectedProjectId) return
    setLabelCreating(true); setLabelCreateMsg(null)
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/labels`, { method: 'POST' })
      const data = await res.json()
      setLabelStatus(data.results || [])
      if (data.success) { setLabelCreateMsg(null); setPendingCreateAfterLabels(true); setLabelModalOpen(false) }
      else setLabelCreateMsg(data.message || tProject('labelCreateFailed'))
    } catch { setLabelCreateMsg(tIssue('networkErrorOccurred')) }
    finally { setLabelCreating(false) }
  }

  // --- Issue creation ---
  const handleCreateIssue = async (registerOnly: boolean = false) => {
    const lines = newBody.split('\n')
    const title = lines[0].trim()
    const description = lines.slice(1).join('\n').trim()
    if (!title || !selectedProjectId) return
    setCreating(true); setCreatingMode(registerOnly ? 'register' : 'process')
    // 등록만: stage='none' (IVE 라벨만). 에이전트/배정 선택은 보존하여 추후 처리 시 사용.
    const effectiveAsDev = registerOnly ? false : preferredAgentId !== 'none'
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/issues`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, description,
          asDev: effectiveAsDev,
          assignMode: preferredAgentId === 'assignee' ? 'assignee' : preferredAgentId === 'none' ? undefined : preferredAgentId ? 'agent' : 'auto',
          preferredAgentId: (preferredAgentId && preferredAgentId !== 'none' && preferredAgentId !== 'assignee') ? preferredAgentId : undefined,
          assigneeIds: selectedAssignees.length > 0 ? selectedAssignees.map(a => a.id) : undefined,
          assigneeUsernames: selectedAssignees.length > 0 ? selectedAssignees.map(a => a.username) : undefined,
          assigneeAuto: autoAssign || undefined,
          verifierMode,
          verifierUserId: verifierMode === 'specific' ? verifierUserId : null,
          verifierUsername: verifierMode === 'specific' ? verifierUsername : null,
          confirmerMode,
          confirmerUserId: confirmerMode === 'specific' ? confirmerUserId : null,
          confirmerUsername: confirmerMode === 'specific' ? confirmerUsername : null,
          dueDate: newDueDate || undefined,
          notify: notifyOnDone || undefined,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        handleBodyChange(''); setShowAddForm(false); setPreferredAgentId(null); setSelectedAssignees([]); setAutoAssign(false)
        setVerifierMode('creator'); setVerifierUserId(null); setVerifierUsername(null)
        setConfirmerMode('creator'); setConfirmerUserId(null); setConfirmerUsername(null)
        setNewDueDate(''); setNotifyOnDone(false)
        const selectedAgent = preferredAgentId ? projectAgents.find(a => a.agentId === preferredAgentId) : null
        const newIssue: IveIssue = {
          iid: created.iid, title: created.title, state: created.state || 'opened',
          stage: effectiveAsDev ? 'waiting' : 'none',
          labels: created.labels || [], createdAt: created.created_at || new Date().toISOString(),
          updatedAt: created.updated_at || new Date().toISOString(), author: created.author?.name || '',
          assignMode: preferredAgentId === 'assignee' ? 'assignee' : preferredAgentId && preferredAgentId !== 'none' ? 'agent' : 'auto',
          preferredAgentId: (preferredAgentId && preferredAgentId !== 'none' && preferredAgentId !== 'assignee') ? preferredAgentId : null,
          preferredAgentName: selectedAgent?.agent.name || null, preferredAgentAvatar: selectedAgent?.agent.avatar || null,
          preferredAgentCliName: selectedAgent?.agent.cliName || null,
          assigneeAuto: autoAssign,
        }
        setIssues(prev => prev.some(i => i.iid === created.iid) ? prev : [newIssue, ...prev])
        toast(tIssue('issueCreated'), 'success')
        if (newIssue.stage === 'waiting' && projectAgents.length === 0) {
          showAlert({ title: tIssue('noAgentWarningTitle'), message: tIssue('noAgentWarningDesc'), variant: 'error' })
        }
        setTimeout(() => {
          if (!selectedProjectId) return
          fetch(`/api/projects/${selectedProjectId}/issues`).then(res => res.ok ? res.json() : null).then(data => {
            if (!data) return
            setIssues(() => data.some((i: IveIssue) => i.iid === created.iid) ? data : [newIssue, ...data])
            sessionStorage.setItem('issues-cache', JSON.stringify({ projectId: selectedProjectId, issues: data }))
          })
        }, 1500)
      } else {
        const data = await res.json().catch(() => ({}))
        if (data.labelMissing) {
          try { const lres = await fetch(`/api/projects/${selectedProjectId}/labels`); const ldata = await lres.json().catch(() => []); setLabelStatus(Array.isArray(ldata) ? ldata : []) }
          catch { setLabelStatus([]) }
          setLabelCreateMsg(null); setPendingRegisterOnly(registerOnly); setLabelModalOpen(true)
        } else { toast(data.error || tIssue('issueCreateFailed'), 'error') }
      }
    } catch (err: any) { toast(err.message || tIssue('networkErrorOccurred'), 'error') }
    finally { setCreating(false); setCreatingMode(null) }
  }
  handleCreateIssueRef.current = handleCreateIssue

  // --- Close issue ---
  const handleCloseIssue = async (e: React.MouseEvent, iid: number) => {
    e.stopPropagation()
    if (closing) return
    const ok = await confirm({
      title: tIssue('closeIssue'), message: tIssue('closeIssueConfirm', { iid }),
      confirmText: tCommon('close'), cancelText: tCommon('cancel'), variant: 'warning',
    })
    if (!ok) return
    setClosing(iid)
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/close`, { method: 'POST' })
      if (res.ok) { fetchIssues(); window.dispatchEvent(new CustomEvent('refresh-counts')); toast(tIssue('issueClosed'), 'success') }
      else { const data = await res.json().catch(() => ({})); toast(data.error || tIssue('issueCloseFailed'), 'error') }
    } catch (err: any) { toast(err.message || tIssue('networkErrorOccurred'), 'error') }
    finally { setClosing(null) }
  }

  // --- Navigate to issue detail ---
  const handleNavigate = useCallback(async (issue: IveIssue) => {
    if (navigatingIid) return
    const el = document.querySelector('[data-scroll-container="issues-list"]')
    if (el) sessionStorage.setItem('issues-scroll', String(el.scrollTop))
    setNavigatingIid(issue.iid)
    try {
      const [issueRes, notesRes] = await Promise.all([
        fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}`),
        fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}/notes`),
      ])
      if (issueRes.ok) sessionStorage.setItem(`issue-detail-${selectedProjectId}-${issue.iid}`, JSON.stringify(await issueRes.json()))
      if (notesRes.ok) sessionStorage.setItem(`issue-notes-${selectedProjectId}-${issue.iid}`, JSON.stringify(await notesRes.json()))
    } catch { /* proceed anyway */ }
    router.push(`/issues/${selectedProjectId}/${issue.iid}`)
  }, [navigatingIid, selectedProjectId, router])

  // --- Derived data ---
  const isHistoryTab = filter === 'history'
  const selectedProject = state.projects.find(p => p.id === selectedProjectId)
  const canEdit = !!selectedProject
  const bulkActions = getAvailableBulkActions()
  const stages = selectedStages()

  const filtered = (isHistoryTab ? closedIssues : issues.filter(issue => {
    if (filter === 'all') return true
    if (filter === 'waiting') return issue.stage === 'waiting'
    // 진행: 처리(dev) + 검증(verify_waiting/verifying) + 확인(confirm_waiting/confirming) 통합
    if (filter === 'active') return issue.stage === 'dev' || issue.stage === 'verify_waiting' || issue.stage === 'verifying' || issue.stage === 'confirm_waiting' || issue.stage === 'confirming'
    if (filter === 'failed') return issue.stage === 'dev_fail' || issue.stage === 'rejected'
    if (filter === 'done') return issue.stage === 'done'
    return true
  })).filter(issue => {
    if (onlyMine && canFilterMine && !isMine(issue)) return false
    if (!issueSearchQuery) return true
    const q = issueSearchQuery.toLowerCase()
    return issue.title.toLowerCase().includes(q) || String(issue.iid).includes(q) || (issue.author?.name || '').toLowerCase().includes(q)
  }).sort((a, b) => {
    if (sortOrder === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  // --- Render ---
  return (
    <PullToRefresh onRefresh={isHistoryTab ? fetchClosedIssues : fetchIssues} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden">
      <div className="pt-4 shrink-0">
        <ProjectSelector
          projects={state.projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />

        {state.projects.length === 0 && !state.loading ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-folder-open text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-2">{tProject('noRegisteredProjects')}</p>
            <p className="text-sm text-ive-text-dim mb-5">{tProject('addProjectFirst')}</p>
            <button onClick={() => setActiveTab('projects')} className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-lg active:scale-95 transition-transform">
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
              <ProjectHeader
                project={selectedProject}
                issueCount={issues.length}
                canEdit={canEdit}
                bulkMode={bulkMode}
                isHistoryTab={isHistoryTab}
                loading={loading}
                closedLoading={closedLoading}
                showAddForm={showAddForm}
                onToggleAddForm={() => setShowAddForm(v => !v)}
                onEnterBulkMode={() => setBulkMode(true)}
                onRefresh={isHistoryTab ? fetchClosedIssues : fetchIssues}
              />
            )}

            <FilterToolbar
              filterTabs={FILTER_TABS}
              filter={filter}
              onFilterChange={setFilter}
              onFetchClosedIssues={fetchClosedIssues}
              issues={issues}
              closedIssues={closedIssues}
              onClearSelected={() => setSelected(new Set())}
              issueSearchQuery={issueSearchQuery}
              onSearchQueryChange={setIssueSearchQuery}
              canFilterMine={canFilterMine}
              onlyMine={onlyMine}
              onToggleOnlyMine={toggleOnlyMine}
              isMine={isMine}
              sortOrder={sortOrder}
              onSortChange={(next) => setIssuesSort(next)}
            />

            {/*
              IssueAddForm 은 헤더(shrink-0) 가 아니라 IssueList 의 스크롤 컨테이너 안에 렌더한다.
              (issue #357 — 모바일에서 폼이 길어지면 키보드/뷰포트에 가려 스크롤이 불가능했던 문제)
              아래 IssueList 의 headerSlot 으로 전달한다.
            */}

            {bulkMode && !isHistoryTab && (
              <BulkActionBar
                selected={selected}
                filteredCount={filtered.length}
                stages={stages}
                stageInfo={STAGE_INFO}
                bulkActions={bulkActions}
                bulkProgress={bulkProgress}
                cancelRef={cancelRef}
                gitMembersCount={gitMembers.length}
                onToggleSelectAll={toggleSelectAll}
                onExitBulkMode={exitBulkMode}
                onBulkAction={handleBulkAction}
                onCancel={() => { cancelRef.current = true }}
                onOpenAssigneeModal={openAssigneeModal}
              />
            )}
          </>
        )}
      </div>

      {selectedProjectId && (
        <IssueList
          filtered={filtered}
          issues={issues}
          isHistoryTab={isHistoryTab}
          loading={loading}
          closedLoading={closedLoading}
          closedIssues={closedIssues}
          stageInfo={STAGE_INFO}
          selected={selected}
          bulkMode={bulkMode}
          navigatingIid={navigatingIid}
          canEdit={canEdit}
          isAdmin={!!state.user?.isAdmin}
          currentUserId={state.user?.id ?? null}
          currentUserGitId={myGitUserId}
          closing={closing}
          projectAgents={projectAgents}
          gitMembers={gitMembers}
          confirmerMembers={confirmerMembers}
          locale={state.user?.locale}
          timezone={state.user?.timezone}
          headerSlot={showAddForm ? (
            <IssueAddForm
              selectedProjectId={selectedProjectId}
              newBody={newBody}
              onBodyChange={handleBodyChange}
              creating={creating}
              creatingMode={creatingMode}
              onCreateIssue={handleCreateIssue}
              onCancel={() => { setShowAddForm(false); handleBodyChange('') }}
              preferredAgentId={preferredAgentId}
              onPreferredAgentIdChange={setPreferredAgentId}
              projectAgents={projectAgents}
              gitMembers={gitMembers}
              confirmerMembers={confirmerMembers}
              selectedAssignees={selectedAssignees}
              autoAssign={autoAssign}
              onOpenAssigneeModal={openAssigneeModal}
              verifierMode={verifierMode}
              verifierUserId={verifierUserId}
              verifierUsername={verifierUsername}
              onVerifierChange={(mode, userId, username) => {
                setVerifierMode(mode)
                setVerifierUserId(userId)
                setVerifierUsername(username)
              }}
              confirmerMode={confirmerMode}
              confirmerUserId={confirmerUserId}
              confirmerUsername={confirmerUsername}
              onConfirmerChange={(mode, userId, username) => {
                setConfirmerMode(mode)
                setConfirmerUserId(userId)
                setConfirmerUsername(username)
              }}
              dueDate={newDueDate}
              onDueDateChange={setNewDueDate}
              notify={notifyOnDone}
              onNotifyChange={setNotifyOnDone}
            />
          ) : null}
          onToggleSelect={toggleSelect}
          onNavigate={handleNavigate}
          onOpenAgentPicker={setAgentPickerIid}
          onOpenAssigneeModal={openAssigneeModal}
          onCloseIssue={handleCloseIssue}
          onPresetVerifierChange={async (iid, preset) => {
            const target = issues.find(i => i.iid === iid)
            const prev = target?.presetVerifier
            setIssues(list => list.map(i => i.iid === iid ? { ...i, presetVerifier: preset } : i))
            try {
              const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/preset-roles`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ verifier: preset }),
              })
              if (!res.ok) {
                const d = await res.json().catch(() => ({}))
                toast(d.error || tIssue('verifierChangeFailed') || '검증자 변경 실패', 'error')
                setIssues(list => list.map(i => i.iid === iid ? { ...i, presetVerifier: prev } : i))
              }
            } catch (e: any) {
              toast(e?.message || tCommon('networkError') || '네트워크 오류', 'error')
              setIssues(list => list.map(i => i.iid === iid ? { ...i, presetVerifier: prev } : i))
            }
          }}
          onPresetConfirmerChange={async (iid, preset) => {
            const target = issues.find(i => i.iid === iid)
            const prev = target?.presetConfirmer
            setIssues(list => list.map(i => i.iid === iid ? { ...i, presetConfirmer: preset } : i))
            try {
              const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/preset-roles`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmer: preset }),
              })
              if (!res.ok) {
                const d = await res.json().catch(() => ({}))
                toast(d.error || tIssue('confirmerChangeFailed') || '확인자 변경 실패', 'error')
                setIssues(list => list.map(i => i.iid === iid ? { ...i, presetConfirmer: prev } : i))
              }
            } catch (e: any) {
              toast(e?.message || tCommon('networkError') || '네트워크 오류', 'error')
              setIssues(list => list.map(i => i.iid === iid ? { ...i, presetConfirmer: prev } : i))
            }
          }}
        />
      )}

      <AssigneePickerModal
        open={assigneeModalIids.length > 0}
        onClose={() => setAssigneeModalIids([])}
        iids={assigneeModalIids}
        gitMembers={gitMembers}
        search={assigneeModalSearch}
        onSearchChange={setAssigneeModalSearch}
        pick={assigneeModalPick}
        onPickChange={setAssigneeModalPick}
        autoMode={assigneeModalAuto}
        onAutoModeChange={setAssigneeModalAuto}
        onConfirm={handleConfirmAssignee}
      />
      <AgentPickerModal
        iid={agentPickerIid}
        currentMode={(() => {
          const t = agentPickerIid !== null ? issues.find(i => i.iid === agentPickerIid) : null
          return (t?.assignMode as 'auto' | 'assignee' | 'agent' | undefined) || 'auto'
        })()}
        currentAgentId={(() => {
          const t = agentPickerIid !== null ? issues.find(i => i.iid === agentPickerIid) : null
          return t?.preferredAgentId || null
        })()}
        currentAssigneeIds={(() => {
          const t = agentPickerIid !== null ? issues.find(i => i.iid === agentPickerIid) : null
          return (t?.assignees || []).map(a => a.id)
        })()}
        projectAgents={projectAgents}
        gitMembers={gitMembers}
        saving={agentPickerSaving}
        onSelect={handleChangeIssueAgent}
        onClose={() => setAgentPickerIid(null)}
      />
      <LabelCheckModal
        open={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        labelStatus={labelStatus}
        labelCreating={labelCreating}
        labelCreateMsg={labelCreateMsg}
        selectedProjectId={selectedProjectId}
        onAutoCreate={handleAutoCreateLabels}
      />
    </PullToRefresh>
  )
}
