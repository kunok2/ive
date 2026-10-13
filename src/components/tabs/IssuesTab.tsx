'use client'

import type { Priority } from './issues/Priority'
import type { RoleAgentCandidate, PresetRole } from '@/components/issue/RoleAvatarBar'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useTab } from '@/lib/tab-context'
import { parseIidSearch } from '@/lib/closed-issues'
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
import Modal from '@/components/ui/Modal'
import AgentPickerModal from '@/components/tabs/issues/AgentPickerModal'
import LabelCheckModal from '@/components/tabs/issues/LabelCheckModal'
import IssueDetailView from '@/app/issues/[projectId]/[iid]/_components/IssueDetailView'
import { useIsDesk } from '@/lib/use-media'
import { issueStageStyle } from '@/lib/active-work'

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
  // 단계 배지 색 = 앱 전체 단계 색(진행 = 단계색, 그 단계 대기 = 회색빛) — lib/active-work ISSUE_STAGE_STYLE
  const stageBadge = (st: string) => { const x = issueStageStyle(st); return `${x.bg} ${x.text} ${x.border}` }
  const STAGE_INFO: Record<string, StageInfo> = useMemo(() => ({
    waiting:         { label: tStage('waiting'),         color: stageBadge('waiting'),     icon: 'fa-clock' },
    verify_waiting:  { label: tStage('verify_waiting'),  color: stageBadge('verify_waiting'), icon: 'fa-hourglass-half' },
    dev:             { label: tStage('dev'),             color: stageBadge('dev'),    icon: 'fa-code' },
    dev_fail:        { label: tStage('dev_fail'),        color: stageBadge('dev_fail'),        icon: 'fa-circle-xmark' },
    verifying:       { label: tStage('verifying'),       color: stageBadge('verifying'), icon: 'fa-magnifying-glass' },
    confirm_waiting: { label: tStage('confirm_waiting'), color: stageBadge('confirm_waiting'), icon: 'fa-hourglass-half' },
    confirming:      { label: tStage('confirming'),      color: stageBadge('confirming'), icon: 'fa-clipboard-check' },
    done:            { label: tStage('done'),            color: stageBadge('done'), icon: 'fa-circle-check' },
    closed:         { label: tStage('closed'),         color: stageBadge('closed'), icon: 'fa-lock' },
    rejected:       { label: tStage('rejected'),       color: stageBadge('rejected'), icon: 'fa-rotate-left' },
    unknown:        { label: tStage('unknown'),        color: stageBadge('none'), icon: 'fa-question' },
  }), [tStage])

  const FILTER_TABS = useMemo(() => [
    { key: 'all', label: tFilter('all') },
    { key: 'waiting', label: tFilter('waiting') },
    { key: 'active', label: tFilter('active') },
    { key: 'failed', label: tFilter('failed') },
    { key: 'done', label: tFilter('done') },
    { key: 'history', label: tFilter('history') },
  ], [tFilter])

  // 단계별 일괄 동작 — 서버 전이 표(lib/stage-transitions TRANSITIONS)에 있는 것만. 작업 상세에서 하나씩 하는 단계 이동과 같은 API
  const BULK_ACTIONS: Record<string, { action: string; label: string; icon: string; danger?: boolean }[]> = useMemo(() => ({
    none: [
      { action: 'schedule', label: tIssue('nextStage.none'), icon: 'fa-play' },
    ],
    waiting: [
      { action: 'start_dev', label: tIssue('nextStage.waiting'), icon: 'fa-play' },
    ],
    verify_waiting: [
      { action: 'start_verification', label: tIssue('startVerification'), icon: 'fa-play' },
      { action: 'to_inflow', label: tIssue('inflowShort'), icon: 'fa-inbox' },
      { action: 'cancel', label: tIssue('cancelToWaiting'), icon: 'fa-rotate-left', danger: true },
    ],
    dev: [
      { action: 'complete', label: tIssue('nextStage.dev'), icon: 'fa-circle-check' },
      { action: 'cancel', label: tIssue('toWaiting'), icon: 'fa-rotate-left', danger: true },
    ],
    dev_fail: [
      { action: 'retry', label: tIssue('retryToWaiting'), icon: 'fa-rotate' },
    ],
    verifying: [
      { action: 'approve', label: tIssue('approveVerify'), icon: 'fa-circle-check' },
      { action: 'to_inflow', label: tIssue('inflowShort'), icon: 'fa-inbox' },
      { action: 'reject', label: tIssue('rejectVerify'), icon: 'fa-rotate-left', danger: true },
    ],
    confirm_waiting: [
      { action: 'start_confirmation', label: tIssue('startConfirmation'), icon: 'fa-play' },
      { action: 'return_to_dev', label: tIssue('returnToDev'), icon: 'fa-rotate-left', danger: true },
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
  // PC 폭: 이슈를 누르면 페이지를 옮기지 않고 오른쪽 칸에 상세를 연다
  const isDesk = useIsDesk()
  // 프로젝트와 짝지어 둔다 — 프로젝트를 바꾸면 열려 있던 상세는 저절로 닫힌다.
  // 탭 공용 상태라 다른 화면(보드·이슈 주소)에서도 여기에 열 수 있다(openIssueInTab)
  const { issuesOpened: opened, setIssuesOpened: setOpened } = useTab()
  const openIid = opened && opened.projectId === selectedProjectId ? opened.iid : null
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
  // 이력(닫힌 이슈)은 한 페이지씩 받는다 — 전체를 받으면 이슈가 쌓일수록 수십 초가 걸린다.
  const [closedHasMore, setClosedHasMore] = useState(false)
  const [closedTotal, setClosedTotal] = useState<number | null>(null)
  const [closedLoadingMore, setClosedLoadingMore] = useState(false)
  const closedPageRef = useRef(1)
  const closedReqSeqRef = useRef(0)
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
  // 이력 탭 검색은 서버(Git)로 보낸다 — 타이핑마다 요청하지 않게 300ms 디바운스.
  const [closedSearch, setClosedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setClosedSearch(issueSearchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [issueSearchQuery])
  const [closing, setClosing] = useState<number | null>(null)
  const [preferredAgentId, setPreferredAgentId] = useState<string | null>(null)
  const [gitMembers, setGitMembers] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  // 확인자 후보 — 검증자/담당자(프로젝트 멤버)와 달리, provider 로 식별되는 모든 IVE 사용자.
  const [confirmerMembers, setConfirmerMembers] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  // 역할 명부의 에이전트 — 검증자·확인자 picker 후보
  const [roleAgents, setRoleAgents] = useState<{ verify: RoleAgentCandidate[]; confirm: RoleAgentCandidate[]; process: RoleAgentCandidate[] }>({ verify: [], confirm: [], process: [] })
  const [selectedAssignees, setSelectedAssignees] = useState<{ id: number; username: string; name: string; avatarUrl: string }[]>([])
  const [autoAssign, setAutoAssign] = useState(false)
  // 검증자/확인자 사전 배정 — 'creator' | 'auto' | 'specific' | 'agent'
  const [verifierMode, setVerifierMode] = useState<PresetRole['mode']>('creator')
  const [verifierAgentId, setVerifierAgentId] = useState<string | null>(null)
  const [verifierUserId, setVerifierUserId] = useState<string | null>(null)
  const [verifierUsername, setVerifierUsername] = useState<string | null>(null)
  const [confirmerMode, setConfirmerMode] = useState<PresetRole['mode']>('creator')
  const [confirmerAgentId, setConfirmerAgentId] = useState<string | null>(null)
  // 「모든 단계 자동배정」, 등록 폼에서 역할을 직접 골랐는지(골랐으면 프로젝트 기본 배정이 덮어쓰지 않는다)
  const [autoAllAgents, setAutoAllAgents] = useState(false)
  const [rolesTouched, setRolesTouched] = useState(false)
  const [confirmerUserId, setConfirmerUserId] = useState<string | null>(null)
  const [confirmerUsername, setConfirmerUsername] = useState<string | null>(null)
  // 마감일 (YYYY-MM-DD). 빈 문자열이면 미설정.
  const [newDueDate, setNewDueDate] = useState<string>('')
  const [newPriority, setNewPriority] = useState<Priority>(0)
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

  // 조용한 갱신 — 스피너 없이 데이터만 바꾼다(주기 갱신용). 내용이 같으면 상태를 건드리지 않아 화면이 깜빡이지 않는다
  const refreshIssuesQuietly = useCallback(() => {
    if (!selectedProjectId) return
    fetch(`/api/projects/${selectedProjectId}/issues`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return
        setIssues(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data)
        try { sessionStorage.setItem('issues-cache', JSON.stringify({ projectId: selectedProjectId, issues: data })) } catch { /* 용량 초과 등 — 캐시만 포기 */ }
      })
      .catch(() => { /* 다음 주기에 다시 */ })
  }, [selectedProjectId])

  const fetchGitMembers = useCallback(() => {
    if (!selectedProjectId) { setGitMembers([]); setConfirmerMembers([]); setRoleAgents({ verify: [], confirm: [], process: [] }); return }
    fetch(`/api/projects/${selectedProjectId}/roles`).then(res => res.ok ? res.json() : null).then(d => {
      const agents = ((d?.roster || []) as { subjectType: string; subjectId: string; name: string; avatar: string; cliName?: string | null; roles: Record<'process' | 'verify' | 'confirm', boolean> }[])
        .filter(r => r.subjectType === 'agent')
      const pick = (k: 'process' | 'verify' | 'confirm') => (d?.agentRoles?.[k] === false ? [] : agents.filter(a => a.roles[k])).map(a => ({ id: a.subjectId, name: a.name, avatar: a.avatar, cliName: a.cliName ?? null }))
      setRoleAgents({ verify: pick('verify'), confirm: pick('confirm'), process: pick('process') })
    }).catch(() => setRoleAgents({ verify: [], confirm: [], process: [] }))
    fetch(`/api/projects/${selectedProjectId}/members`).then(res => res.ok ? res.json() : []).then(setGitMembers).catch(() => setGitMembers([]))
    fetch(`/api/projects/${selectedProjectId}/confirmer-candidates`).then(res => res.ok ? res.json() : []).then(setConfirmerMembers).catch(() => setConfirmerMembers([]))
  }, [selectedProjectId])

  const closedPageUrl = useCallback((page: number) => {
    const q = new URLSearchParams({ state: 'closed', page: String(page), sort: sortOrder === 'oldest' ? 'asc' : 'desc' })
    if (closedSearch) q.set('q', closedSearch)
    return `/api/projects/${selectedProjectId}/issues?${q.toString()}`
  }, [selectedProjectId, sortOrder, closedSearch])

  /** 이력 첫 페이지부터 다시 받는다 (프로젝트·정렬·검색어가 바뀌거나 새로고침할 때). */
  const fetchClosedIssues = useCallback(() => {
    if (!selectedProjectId) return Promise.resolve()
    const seq = ++closedReqSeqRef.current
    setClosedLoading(true)
    return fetch(closedPageUrl(1))
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (seq !== closedReqSeqRef.current) return // 더 새 요청이 나갔으면 버린다
        closedPageRef.current = 1
        setClosedIssues(data?.items ?? [])
        setClosedHasMore(!!data?.hasMore)
        setClosedTotal(data?.total ?? null)
      })
      .finally(() => { if (seq === closedReqSeqRef.current) setClosedLoading(false) })
  }, [selectedProjectId, closedPageUrl])

  /** 다음 페이지를 이어 붙인다 (목록 끝 도달 / 더 보기). */
  const loadMoreClosedIssues = useCallback(() => {
    if (!selectedProjectId || closedLoading || closedLoadingMore || !closedHasMore) return
    const seq = closedReqSeqRef.current
    const nextPage = closedPageRef.current + 1
    setClosedLoadingMore(true)
    fetch(closedPageUrl(nextPage))
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (seq !== closedReqSeqRef.current || !data) return
        closedPageRef.current = nextPage
        setClosedIssues(prev => {
          const seen = new Set(prev.map(i => i.iid))
          return [...prev, ...(data.items as IveIssue[]).filter(i => !seen.has(i.iid))]
        })
        setClosedHasMore(!!data.hasMore)
        if (data.total != null) setClosedTotal(data.total)
      })
      .finally(() => setClosedLoadingMore(false))
  }, [selectedProjectId, closedLoading, closedLoadingMore, closedHasMore, closedPageUrl])

  useEffect(() => { setClosedIssues([]); setClosedTotal(null); setClosedHasMore(false) }, [selectedProjectId])
  // 프로젝트를 바꾸면 이전 프로젝트 명부의 에이전트 선택을 비운다(다른 프로젝트 명부엔 없는 에이전트라 등록이 거절된다)
  useEffect(() => {
    setVerifierMode(m => (m === 'agent' ? 'creator' : m)); setVerifierAgentId(null)
    setConfirmerMode(m => (m === 'agent' ? 'creator' : m)); setConfirmerAgentId(null)
    setAutoAllAgents(false)
  }, [selectedProjectId])
  useEffect(() => { fetchIssues() }, [fetchIssues])
  useEffect(() => { if (filter === 'history' && selectedProjectId) fetchClosedIssues() }, [filter, selectedProjectId, fetchClosedIssues])
  useEffect(() => { if (activeTab === 'issues' && selectedProjectId) { fetchIssues(); fetchGitMembers() } }, [activeTab])

  // 본인이 수행한 액션 직후(close/bulk 등에서 dispatch 되는 'refresh-counts')와
  // 새로고침 버튼/Pull-to-Refresh 는 즉시 다시 가져온다. 그 밖에는 아래 60초 조용한 갱신이 맡는다.
  useEffect(() => {
    if (activeTab !== 'issues' || !selectedProjectId) return
    const refresh = () => { if (filter === 'history') fetchClosedIssues(); else fetchIssues() }
    window.addEventListener('refresh-counts', refresh)
    return () => { window.removeEventListener('refresh-counts', refresh) }
  }, [activeTab, selectedProjectId, filter, fetchIssues, fetchClosedIssues])

  // 옆 칸에 열린 작업이 알려 주는 진행률 — 목록을 다시 가져오지 않고 그 카드만 바로 바꾼다(체크박스 클릭·폴링으로 바뀐 값)
  useEffect(() => {
    const onProgress = (e: Event) => {
      const d = (e as CustomEvent<{ projectId: string; iid: number; progress: IveIssue['progress'] }>).detail
      if (!d || d.projectId !== selectedProjectId) return
      setIssues(prev => prev.some(i => i.iid === d.iid && JSON.stringify(i.progress) !== JSON.stringify(d.progress))
        ? prev.map(i => i.iid === d.iid ? { ...i, progress: d.progress } : i)
        : prev)
    }
    window.addEventListener('issue-progress', onProgress)
    return () => window.removeEventListener('issue-progress', onProgress)
  }, [selectedProjectId])

  // 목록 자동 갱신 — 화면이 보이는 동안 60초마다. GitLab·GitHub 에서 직접 바꾼 체크·단계도 따라온다.
  // 탭을 가리면 멈추고, 다시 보이는 순간 한 번 가져온다. 이력 탭은 닫힌 작업이라 바뀔 일이 적어 제외.
  useEffect(() => {
    if (activeTab !== 'issues' || !selectedProjectId || filter === 'history') return
    const tick = () => { if (document.visibilityState === 'visible') refreshIssuesQuietly() }
    const id = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [activeTab, selectedProjectId, filter, refreshIssuesQuietly])

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
  // 저장 핵심 — 실패하면 사유를, 성공하면 null. 하나 바꾸기(알림)와 일괄(사유를 모아 한 번에)이 같이 쓴다
  const saveIssueAgent = async (
    iid: number,
    mode: 'auto' | 'assignee' | 'agent',
    agentId: string | null,
    assignee?: { id: number; username: string; name: string; avatarUrl: string } | null,
  ): Promise<string | null> => {
    try {
      // 1) assignMode 업데이트
      const body: any = mode === 'agent' ? { assignMode: 'agent', agentId } : { assignMode: mode }
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${iid}/preferred-agent`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return data.error || tIssue('settingsSaveFailed')
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
          return d.error || tIssue('assigneeChangeFailed')
        }
        setIssues(prev => prev.map(i => i.iid === iid ? { ...i, assignees: [assignee], assigneeAuto: false } : i))
      }
      return null
    } catch (err: any) { return err.message || tIssue('networkErrorOccurred') }
  }

  const handleChangeIssueAgent = async (
    iid: number,
    mode: 'auto' | 'assignee' | 'agent',
    agentId: string | null,
    assignee?: { id: number; username: string; name: string; avatarUrl: string } | null,
  ) => {
    setAgentPickerSaving(true)
    try {
      const err = await saveIssueAgent(iid, mode, agentId, assignee)
      if (err) { toast(err, 'error'); return }
      setAgentPickerIid(null)
    } finally { setAgentPickerSaving(false) }
  }

  // --- Bulk actions ---
  // 「다음 단계로」 — 작업마다 자기 단계의 다음(작업 상세의 다음 단계 버튼과 같은 동작). 끝난·실패 단계는 다음이 없다
  const NEXT_ACTION: Record<string, string> = {
    none: 'schedule', waiting: 'start_dev', dev: 'complete', verify_waiting: 'start_verification',
    verifying: 'approve', confirm_waiting: 'start_confirmation', confirming: 'accept',
  }
  // 에이전트가 시작할 일을 사람이 시작하지 않는다 — 처리 대기를 에이전트가 맡으면 개발 시작은 라벨만 바꿔 처리 실패가 되고,
  // 검증·확인 대기의 에이전트 담당은 단계 작업자가 띄운다(작업 상세도 이때 시작 버튼을 내놓지 않는다). 넘기면 사유, 아니면 null
  const agentStartsReason = (issue: IveIssue, action: string): string | null => {
    if (action === 'start_dev' && issue.assignMode !== 'assignee') return tIssue('bulkAgentStarts')
    if (action === 'start_verification' && issue.presetVerifier?.mode === 'agent') return tIssue('bulkAgentStarts')
    if (action === 'start_confirmation' && issue.presetConfirmer?.mode === 'agent') return tIssue('bulkAgentStarts')
    return null
  }
  const getAvailableBulkActions = () => {
    if (selected.size === 0) return []
    const selectedIssues = issues.filter(i => selected.has(i.iid))
    const stages = new Set(selectedIssues.map(i => i.stage))
    if (stages.size !== 1) return []
    const stage = [...stages][0]
    // 다음 단계와 같은 동작은 「다음 단계로」 하나로(항상 보인다) — 같은 일을 두 버튼으로 두지 않는다
    return (BULK_ACTIONS[stage] || []).filter(a => a.action !== NEXT_ACTION[stage])
  }
  const selectedStages = () => {
    const selectedIssues = issues.filter(i => selected.has(i.iid))
    return new Set(selectedIssues.map(i => i.stage))
  }

  // 일괄 결과 알림 — 실패는 건수만이 아니라 어느 작업이 왜(앞의 3건) 실패했는지. 실패한 작업만 선택에 남겨 다시 시도할 수 있게 한다
  const finishBulk = (done: number, failures: { iid: number; reason: string }[]) => {
    if (failures.length > 0) {
      const reasons = failures.slice(0, 3).map(f => `#${f.iid} ${f.reason}`).join(' · ') + (failures.length > 3 ? ' …' : '')
      toast(`${tIssue('bulkFailedCount', { count: failures.length })} ${reasons}`, 'error')
    } else if (done > 0) toast(tIssue('bulkCompletedCount', { count: done }), 'success')
    fetchIssues()
    window.dispatchEvent(new CustomEvent('refresh-counts'))
    if (failures.length > 0) {
      setSelected(new Set(failures.map(f => f.iid)))
      setTimeout(() => setBulkProgress(null), 1000)
    } else {
      setTimeout(() => { exitBulkMode() }, cancelRef.current ? 500 : 1000)
    }
  }
  const reasonOf = async (res: Response) => {
    const data = await res.json().catch(() => ({}))
    return (data?.error as string) || res.statusText || String(res.status)
  }

  // 선택한 작업마다 한 번씩 — 진행 막대·중단(cancelRef)·실패 사유 모음은 모든 일괄 동작이 같다
  const runBulk = async (targets: IveIssue[], run: (issue: IveIssue) => Promise<string | null>) => {
    cancelRef.current = false
    setBulkProgress({ total: targets.length, done: 0, failed: 0 })
    let done = 0
    const failures: { iid: number; reason: string }[] = []
    for (const issue of targets) {
      if (cancelRef.current) break
      let reason: string | null
      try { reason = await run(issue) } catch (err) { reason = (err as Error).message || tIssue('networkErrorOccurred') }
      if (reason) failures.push({ iid: issue.iid, reason })
      else done++
      setBulkProgress({ total: targets.length, done: done + failures.length, failed: failures.length })
    }
    finishBulk(done, failures)
  }

  const handleBulkPriority = async (priority: 0 | 1 | 2) => {
    const targets = issues.filter(i => selected.has(i.iid))
    if (targets.length === 0) return
    await runBulk(targets, async issue => {
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}/priority`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority }),
      })
      return res.ok ? null : await reasonOf(res)
    })
  }

  // 처리 담당 일괄 — 하나 바꾸기와 같은 선택 창(AgentPickerModal)에서 고른 것을 선택한 작업 모두에
  const [bulkAgentPickerOpen, setBulkAgentPickerOpen] = useState(false)
  const handleBulkAgent = async (
    mode: 'auto' | 'assignee' | 'agent',
    agentId: string | null,
    assignee?: { id: number; username: string; name: string; avatarUrl: string } | null,
  ) => {
    setBulkAgentPickerOpen(false)
    const targets = issues.filter(i => selected.has(i.iid))
    if (targets.length === 0) return
    await runBulk(targets, issue => saveIssueAgent(issue.iid, mode, agentId, assignee))
  }

  // 검증자·확인자 일괄 — 카드의 지정 창(AssigneePickerModal)을 그대로. 고른 값을 선택한 작업 모두에(작업마다 PATCH preset-roles)
  const [bulkRole, setBulkRole] = useState<'verifier' | 'confirmer' | null>(null)
  const [bulkRoleSearch, setBulkRoleSearch] = useState('')
  const [bulkRolePick, setBulkRolePick] = useState<{ id: number; username: string; name: string; avatarUrl: string } | null>(null)
  const [bulkRoleAuto, setBulkRoleAuto] = useState(false)
  const [bulkRoleAgentPick, setBulkRoleAgentPick] = useState<string | null>(null)
  const openBulkRole = (role: 'verifier' | 'confirmer') => {
    setBulkRoleSearch(''); setBulkRolePick(null); setBulkRoleAuto(false); setBulkRoleAgentPick(null)
    setBulkRole(role)
  }
  const handleBulkRoleConfirm = async () => {
    const role = bulkRole
    if (!role) return
    // 카드 지정 창과 같은 규칙 — 에이전트 > 자동 > 특정 사람 > 미배정(생성자)
    const preset: PresetRole = bulkRoleAgentPick ? { mode: 'agent', userId: null, username: null, agentId: bulkRoleAgentPick }
      : bulkRoleAuto ? { mode: 'auto', userId: null, username: null }
      : bulkRolePick ? { mode: 'specific', userId: String(bulkRolePick.id), username: bulkRolePick.username }
      : { mode: 'creator', userId: null, username: null }
    setBulkRole(null)
    const targets = issues.filter(i => selected.has(i.iid))
    if (targets.length === 0) return
    await runBulk(targets, async issue => {
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}/preset-roles`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [role]: preset }),
      })
      return res.ok ? null : await reasonOf(res)
    })
  }

  // 마감일 일괄 — 작업 상세의 마감일 입력과 같은 값(YYYY-MM-DD, 지우면 null). PUT 이슈 { dueDate }
  const [bulkDueOpen, setBulkDueOpen] = useState(false)
  const [bulkDueDraft, setBulkDueDraft] = useState('')
  const handleBulkDue = async (dueDate: string | null) => {
    setBulkDueOpen(false)
    const targets = issues.filter(i => selected.has(i.iid))
    if (targets.length === 0) return
    await runBulk(targets, async issue => {
      const res = await fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dueDate }),
      })
      return res.ok ? null : await reasonOf(res)
    })
  }

  const handleBulkAction = async (action: string) => {
    if (selected.size === 0) return
    const selectedIssues = issues.filter(i => selected.has(i.iid))
    if (action === 'auto_all') {
      // 모든 단계 자동배정 — 작업 상세의 같은 버튼과 같은 요청. 권한·완료·처리 중은 서버가 작업마다 거절한다(사유로 남는다)
      await runBulk(selectedIssues, async issue => {
        const res = await fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}/roles`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auto_all' }),
        })
        return res.ok ? null : await reasonOf(res)
      })
      return
    }
    if (action === 'next') {
      await runBulk(selectedIssues, async issue => {
        const next = NEXT_ACTION[issue.stage]
        if (!next) return tIssue('bulkNoNextStage')
        const skip = agentStartsReason(issue, next)
        if (skip) return skip
        const res = await fetch(`/api/projects/${selectedProjectId}/issues/${issue.iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: issue.stage, action: next }),
        })
        return res.ok ? null : await reasonOf(res)
      })
      return
    }
    const stage = selectedIssues[0].stage
    const isClose = action === 'close'
    if (isClose) {
      const ok = await confirm({
        title: tIssue('bulkCloseTitle'), message: tIssue('bulkCloseConfirm', { count: selectedIssues.length }),
        confirmText: tCommon('close'), cancelText: tCommon('cancel'), variant: 'warning',
      })
      if (!ok) return
    }
    await runBulk(selectedIssues, async issue => {
      const skip = isClose ? null : agentStartsReason(issue, action)
      if (skip) return skip
      const url = isClose ? `/api/projects/${selectedProjectId}/issues/${issue.iid}/close` : `/api/projects/${selectedProjectId}/issues/${issue.iid}/stage`
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(isClose ? {} : { body: JSON.stringify({ stage, action }) }) })
      return res.ok ? null : await reasonOf(res)
    })
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
          // 「모든 단계 자동배정」이면 숨겨진 개별 선택은 보내지 않는다(서버가 세 역할을 명부에서 고른다)
          assignMode: autoAllAgents ? 'auto' : preferredAgentId === 'assignee' ? 'assignee' : preferredAgentId === 'none' ? undefined : preferredAgentId ? 'agent' : 'auto',
          preferredAgentId: (!autoAllAgents && preferredAgentId && preferredAgentId !== 'none' && preferredAgentId !== 'assignee') ? preferredAgentId : undefined,
          assigneeIds: selectedAssignees.length > 0 ? selectedAssignees.map(a => a.id) : undefined,
          assigneeUsernames: selectedAssignees.length > 0 ? selectedAssignees.map(a => a.username) : undefined,
          assigneeAuto: autoAssign || undefined,
          verifierMode: autoAllAgents ? 'creator' : verifierMode,
          verifierUserId: !autoAllAgents && verifierMode === 'specific' ? verifierUserId : null,
          verifierUsername: !autoAllAgents && verifierMode === 'specific' ? verifierUsername : null,
          confirmerMode: autoAllAgents ? 'creator' : confirmerMode,
          confirmerUserId: !autoAllAgents && confirmerMode === 'specific' ? confirmerUserId : null,
          confirmerUsername: !autoAllAgents && confirmerMode === 'specific' ? confirmerUsername : null,
          verifierAgentId: !autoAllAgents && verifierMode === 'agent' ? verifierAgentId : null,
          confirmerAgentId: !autoAllAgents && confirmerMode === 'agent' ? confirmerAgentId : null,
          autoAllAgents: autoAllAgents || undefined,
          rolesExplicit: rolesTouched || undefined,
          dueDate: newDueDate || undefined,
          priority: newPriority || undefined,
          notify: notifyOnDone || undefined,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        handleBodyChange(''); setShowAddForm(false); setPreferredAgentId(null); setSelectedAssignees([]); setAutoAssign(false)
        setVerifierMode('creator'); setVerifierUserId(null); setVerifierUsername(null); setVerifierAgentId(null)
        setConfirmerMode('creator'); setConfirmerUserId(null); setConfirmerUsername(null); setConfirmerAgentId(null)
        setAutoAllAgents(false); setRolesTouched(false)
        setNewDueDate(''); setNewPriority(0); setNotifyOnDone(false)
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
        // PC 폭: 오른쪽 칸에서 쓰던 그 자리에 방금 만든 이슈를 연다
        if (isDesk && selectedProjectId) setOpened({ projectId: selectedProjectId, iid: created.iid })
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
    if (isDesk) { setShowAddForm(false); setOpened({ projectId: selectedProjectId, iid: issue.iid }); return }
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
  }, [isDesk, navigatingIid, selectedProjectId, router])

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
    // 이력은 서버가 제목·본문으로 이미 검색했다 — 로컬에서 다시 거르면 본문 일치 건이 빠진다.
    if (isHistoryTab || !issueSearchQuery) return true
    // 「#1870」·「1870」은 이슈 번호로 찾는다 — 이력 탭(서버 검색)과 같은 규칙
    const iid = parseIidSearch(issueSearchQuery)
    if (iid != null) return issue.iid === iid
    const q = issueSearchQuery.trim().toLowerCase()
    return issue.title.toLowerCase().includes(q) || (issue.author?.name || '').toLowerCase().includes(q)
  }).sort((a, b) => {
    // 이력은 서버(Git)가 최근 갱신순으로 준 순서 그대로 — 생성일로 다시 정렬하면 오늘 닫은 오래된 일이 묻힌다
    if (isHistoryTab) return 0
    if (sortOrder === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  // --- Render ---
  // 새 작업 입력 폼 — 폰·패드는 목록 위(headerSlot), PC 폭은 오른쪽 칸에 같은 폼을 띄운다
  const addForm = selectedProjectId ? (
    <IssueAddForm
      selectedProjectId={selectedProjectId}
      newBody={newBody}
      onBodyChange={handleBodyChange}
      creating={creating}
      creatingMode={creatingMode}
      onCreateIssue={handleCreateIssue}
      onCancel={() => { setShowAddForm(false); handleBodyChange('') }}
      preferredAgentId={preferredAgentId}
      onPreferredAgentIdChange={(id) => { setPreferredAgentId(id); setRolesTouched(true) }}
      projectAgents={projectAgents}
      gitMembers={gitMembers}
      confirmerMembers={confirmerMembers}
      selectedAssignees={selectedAssignees}
      autoAssign={autoAssign}
      onOpenAssigneeModal={openAssigneeModal}
      verifierMode={verifierMode}
      verifierUserId={verifierUserId}
      verifierUsername={verifierUsername}
      onVerifierChange={(mode, userId, username, agentId) => {
        setVerifierMode(mode)
        setVerifierUserId(userId)
        setVerifierUsername(username)
        setVerifierAgentId(agentId ?? null)
        setRolesTouched(true)
      }}
      verifierAgentId={verifierAgentId}
      confirmerMode={confirmerMode}
      confirmerUserId={confirmerUserId}
      confirmerUsername={confirmerUsername}
      onConfirmerChange={(mode, userId, username, agentId) => {
        setConfirmerMode(mode)
        setConfirmerUserId(userId)
        setConfirmerUsername(username)
        setConfirmerAgentId(agentId ?? null)
        setRolesTouched(true)
      }}
      confirmerAgentId={confirmerAgentId}
      roleAgents={roleAgents}
      autoAllAgents={autoAllAgents}
      onAutoAllAgentsChange={(roleAgents.process.length + roleAgents.confirm.length) > 0 ? setAutoAllAgents : undefined}
      dueDate={newDueDate}
      onDueDateChange={setNewDueDate}
      notify={notifyOnDone}
      onNotifyChange={setNotifyOnDone}
      priority={newPriority}
      onPriorityChange={setNewPriority}
    />
  ) : null

  const list = (
    <PullToRefresh onRefresh={isHistoryTab ? fetchClosedIssues : fetchIssues} className="w-full flex-1 flex flex-col max-w-lg mx-auto px-4 overflow-hidden desk:w-[460px] desk:flex-none desk:mx-0 desk:border-r desk:border-ive-border-dark">
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
              closedTotal={closedTotal}
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
                canPickAgent={projectAgents.length > 0 || gitMembers.length > 0}
                onOpenAgentPicker={() => setBulkAgentPickerOpen(true)}
                onBulkPriority={handleBulkPriority}
                onOpenRolePicker={openBulkRole}
                canAutoAll={projectAgents.length > 0 || roleAgents.verify.length > 0 || roleAgents.confirm.length > 0}
                onOpenDueDate={() => { setBulkDueDraft(''); setBulkDueOpen(true) }}
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
          closedHasMore={closedHasMore}
          closedLoadingMore={closedLoadingMore}
          onLoadMoreClosed={loadMoreClosedIssues}
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
          roleAgents={roleAgents}
          locale={state.user?.locale}
          timezone={state.user?.timezone}
          // 새 작업 입력: 폰·패드는 목록 위, PC 폭은 오른쪽 칸(아래 desk 배치)
          headerSlot={showAddForm && !isDesk ? addForm : null}
          onToggleSelect={toggleSelect}
          onNavigate={handleNavigate}
          // 오른쪽 칸이 입력 폼을 보이는 동안에는 목록에서 열린 이슈를 강조하지 않는다
          openIid={isDesk && !showAddForm ? openIid : null}
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
              if (res.ok) {
                // 서버가 돌려준 저장값(에이전트 이름·아바타 포함)으로 맞춘다
                const saved = await res.json().catch(() => null)
                if (saved?.verifier) setIssues(list => list.map(i => i.iid === iid ? { ...i, presetVerifier: saved.verifier } : i))
              } else {
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
              if (res.ok) {
                // 서버가 돌려준 저장값(에이전트 이름·아바타 포함)으로 맞춘다
                const saved = await res.json().catch(() => null)
                if (saved?.confirmer) setIssues(list => list.map(i => i.iid === iid ? { ...i, presetConfirmer: saved.confirmer } : i))
              } else {
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
      {/* 일괄 — 같은 선택 창, 고르면 선택한 작업 모두에 */}
      <AgentPickerModal
        iid={bulkAgentPickerOpen ? -1 : null}
        title={tIssue('bulkPreferredAgentTitle', { count: selected.size })}
        currentMode={null}
        projectAgents={projectAgents}
        gitMembers={gitMembers}
        saving={false}
        onSelect={(_iid, mode, agentId, assignee) => { void handleBulkAgent(mode, agentId, assignee) }}
        onClose={() => setBulkAgentPickerOpen(false)}
      />
      {/* 일괄 검증자·확인자 — 카드와 같은 지정 창(후보: 검증자는 Git 멤버, 확인자는 확인자 후보, 에이전트는 역할 명부) */}
      <AssigneePickerModal
        open={bulkRole !== null}
        onClose={() => setBulkRole(null)}
        iids={[...selected]}
        gitMembers={bulkRole === 'confirmer' ? confirmerMembers : gitMembers}
        search={bulkRoleSearch}
        onSearchChange={setBulkRoleSearch}
        pick={bulkRolePick}
        onPickChange={setBulkRolePick}
        autoMode={bulkRoleAuto}
        onAutoModeChange={setBulkRoleAuto}
        onConfirm={() => { void handleBulkRoleConfirm() }}
        agents={bulkRole === 'confirmer' ? roleAgents.confirm : roleAgents.verify}
        agentPick={bulkRoleAgentPick}
        onAgentPickChange={setBulkRoleAgentPick}
        title={bulkRole === 'confirmer' ? tIssue('confirmer') : tIssue('verifier')}
        noneLabel={tIssue('roleModeCreator')}
      />
      {/* 일괄 마감일 — 작업 상세의 마감일 입력 줄과 같은 모양(날짜 · 저장 · 해제) */}
      <Modal open={bulkDueOpen} onClose={() => setBulkDueOpen(false)} title={`${tIssue('dueDate')} (${selected.size}${tCommon('items')})`} size="sm">
        <div className="flex items-center gap-2 p-3">
          <i className="fa-solid fa-calendar-days text-ive-cyan text-xs" />
          <input
            type="date"
            value={bulkDueDraft}
            onChange={e => setBulkDueDraft(e.target.value)}
            className="flex-1 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-2 py-1 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
            autoFocus
          />
          <button
            type="button"
            onClick={() => { void handleBulkDue(bulkDueDraft || null) }}
            disabled={!bulkDueDraft}
            className="text-xs font-bold text-ive-green border border-ive-green/30 px-2 py-1 rounded-lg hover:bg-ive-green/10 transition-colors disabled:opacity-40"
          >
            {tCommon('save')}
          </button>
          <button
            type="button"
            onClick={() => { void handleBulkDue(null) }}
            className="text-xs font-bold text-ive-text-dim border border-ive-border-subtle px-2 py-1 rounded-lg hover:bg-ive-red/10 hover:text-ive-red hover:border-ive-red/30 transition-colors"
            title={tIssue('clearDueDate')}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </Modal>
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
  if (!isDesk) return list

  // PC 폭: 왼쪽 목록(폰과 같은 폭) + 오른쪽 상세
  return (
    <div className="w-full flex-1 flex min-h-0">
      {list}
      <section className="flex-1 min-w-0 flex flex-col" aria-label={tIssue('detailPaneLabel')}>
        {showAddForm && addForm ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-5 pb-6">
            <div className="max-w-3xl mx-auto">{addForm}</div>
          </div>
        ) : openIid != null && selectedProjectId ? (
          <IssueDetailView
            key={`${selectedProjectId}-${openIid}`}
            projectId={selectedProjectId}
            iid={String(openIid)}
            embedded
            onClose={() => { setOpened(null); fetchIssues() }}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ive-text-dim">
            <i className="fa-solid fa-list-check text-3xl" />
            <span className="text-sm font-bold">{tIssue('detailPanePlaceholder')}</span>
          </div>
        )}
      </section>
    </div>
  )
}
