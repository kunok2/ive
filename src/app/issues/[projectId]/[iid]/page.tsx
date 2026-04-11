'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileTabBar from '@/components/layout/MobileTabBar'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import PullToRefresh from '@/components/ui/PullToRefresh'
import MRReviewSection from '@/components/mr/MRReviewSection'
import MarkdownNote, { cleanNoteBody } from '@/components/ui/MarkdownNote'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'
import { formatDateMedium, formatTime } from '@/lib/format-date'
import AgentAvatar from '@/components/agent/AgentAvatar'
import Modal from '@/components/ui/Modal'

interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface IssueAssignee {
  id: number
  username: string
  name: string
  avatarUrl: string
}

interface IssueDetail {
  iid: number
  title: string
  description: string
  stage: string
  state: string
  labels: string[]
  createdAt: string
  updatedAt: string
  webUrl: string
  author: string
  assignees?: IssueAssignee[]
}

interface Note {
  id: number
  body: string
  author: string
  avatarUrl: string
  iveAuthorAvatar?: string | null
  system: boolean
  createdAt: string
  isMine?: boolean
}

interface StageAction {
  action: string
  label: string
  icon: string
  danger?: boolean
}

export default function IssueDetailPage({ params }: { params: Promise<{ projectId: string; iid: string }> }) {
  const { projectId, iid } = use(params)
  const router = useRouter()
  const { confirm } = useDialog()
  const { toast } = useToast()
  const { state } = useStore()
  const tc = useTranslations('common')
  const tStage = useTranslations('stage')
  const tIssue = useTranslations('issue')
  const tAuth = useTranslations('auth')

  const STAGE_INFO: Record<string, { label: string; color: string; icon: string; bg: string }> = {
    waiting:        { label: tStage('waiting'),        color: 'text-ive-cyan',      icon: 'fa-clock',              bg: 'bg-ive-cyan/10' },
    verify_waiting: { label: tStage('verify_waiting'), color: 'text-ive-amber',     icon: 'fa-hourglass-half',     bg: 'bg-ive-amber/10' },
    dev:            { label: tStage('dev'),            color: 'text-ive-amber',     icon: 'fa-code',               bg: 'bg-ive-amber/10' },
    dev_fail:       { label: tStage('dev_fail'),       color: 'text-ive-red',       icon: 'fa-circle-xmark',       bg: 'bg-ive-red/10' },
    verifying:      { label: tStage('verifying'),      color: 'text-ive-amber',     icon: 'fa-magnifying-glass',   bg: 'bg-ive-amber/10' },
    done:           { label: tStage('done'),           color: 'text-ive-green',     icon: 'fa-circle-check',       bg: 'bg-ive-green/10' },
    closed:         { label: tStage('closed'),         color: 'text-ive-text-muted',icon: 'fa-lock',               bg: 'bg-white/5' },
    rejected:       { label: tStage('rejected'),       color: 'text-ive-red',       icon: 'fa-rotate-left',        bg: 'bg-ive-red/10' },
    unknown:        { label: tStage('unknown'),        color: 'text-ive-text-dim',  icon: 'fa-question',           bg: 'bg-white/5' },
  }

  const STAGE_ACTIONS: Record<string, StageAction[]> = {
    waiting: [],
    verify_waiting: [
      { action: 'start_verification', label: tIssue('startVerification'), icon: 'fa-play' },
      { action: 'cancel', label: tIssue('cancelToWaiting'), icon: 'fa-rotate-left', danger: true },
    ],
    dev: [
      { action: 'cancel', label: tIssue('cancelToDev'), icon: 'fa-rotate-left', danger: true },
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
  }
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [preferredAgent, setPreferredAgent] = useState<{ assignMode?: string; preferredAgentId: string | null; preferredAgentName: string | null; preferredAgentAvatar: string | null; preferredAgentCliName: string | null } | null>(null)
  const [projectAgents, setProjectAgents] = useState<{ agentId: string; agent: { id: string; name: string; avatar: string; cliName: string; status: string } }[]>([])
  const [retryAgentPickerOpen, setRetryAgentPickerOpen] = useState(false)
  const retryAgentPickerRef = useRef<HTMLDivElement>(null)
  const [gitMembers, setGitMembers] = useState<IssueAssignee[]>([])
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [assigneePick, setAssigneePick] = useState<IssueAssignee | null>(null)
  const [notesLoading, setNotesLoading] = useState(true)
  const commentKey = `issue-comment-${projectId}-${iid}`
  const [comment, setComment] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(commentKey) || ''
    return ''
  })
  const [posting, setPosting] = useState(false)
  const [postingType, setPostingType] = useState<'comment' | 'retry' | 'done' | 'next' | null>(null)
  const [stageChanging, setStageChanging] = useState(false)
  const [mrActionModal, setMrActionModal] = useState<{
    mr: { iid: number; title: string; web_url: string; has_conflicts?: boolean }
    finalApprove: () => Promise<void>
  } | null>(null)
  const [mrActionBusy, setMrActionBusy] = useState(false)
  const [showDesc, setShowDesc] = useState(true)
  const [isClosing, setIsClosing] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const notesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const postingRef = useRef(false)
  const pendingScrollToBottomRef = useRef(false)

  // Chat state
  const [mode, setMode] = useState<'comment' | 'chat'>('comment')
  const [chatSessionId, setChatSessionId] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatSendingStartTime, setChatSendingStartTime] = useState<number | null>(null)
  const [chatStarting, setChatStarting] = useState(false)
  const [chatStreamText, setChatStreamText] = useState('')
  const [chatAgentName, setChatAgentName] = useState<string | null>(null)
  const [chatAgentAvatar, setChatAgentAvatar] = useState<string | null>(null)
  const [chatHistoryOnly, setChatHistoryOnly] = useState(false) // read-only past chat
  const chatSessionRef = useRef<string | null>(null)
  const chatWsRef = useRef<WebSocket | null>(null)
  const chatWsResolveRef = useRef<(() => void) | null>(null)
  const chatStreamTextRef = useRef('')

  const fetchIssue = useCallback(async () => {
    // prefetch 캐시가 있으면 즉시 사용 (화면 깜빡임 방지)
    const cacheKey = `issue-detail-${projectId}-${iid}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      sessionStorage.removeItem(cacheKey)
      setIssue(JSON.parse(cached))
      setLoading(false)
      return
    }
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}`)
    if (res.ok) {
      setIssue(await res.json())
    }
    setLoading(false)
  }, [projectId, iid])

  const fetchNotes = useCallback(async () => {
    // prefetch 캐시가 있으면 즉시 사용
    const cacheKey = `issue-notes-${projectId}-${iid}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      sessionStorage.removeItem(cacheKey)
      setNotes(JSON.parse(cached))
      setNotesLoading(false)
      return
    }
    setNotesLoading(true)
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes?t=${Date.now()}`)
    if (res.ok) {
      const data = await res.json()
      setNotes(data)
    }
    setNotesLoading(false)
  }, [projectId, iid])

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchIssue(), fetchNotes()])
    window.dispatchEvent(new CustomEvent('refresh-counts'))
  }, [fetchIssue, fetchNotes])

  const fetchPreferredAgent = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preferred-agent`)
    if (res.ok) setPreferredAgent(await res.json())
  }, [projectId, iid])

  useEffect(() => {
    fetchIssue()
    fetchNotes()
    fetchPreferredAgent()
    fetch(`/api/projects/${projectId}/agents`)
      .then(res => res.ok ? res.json() : [])
      .then(setProjectAgents)
      .catch(() => setProjectAgents([]))
    fetch(`/api/projects/${projectId}/members`)
      .then(res => res.ok ? res.json() : [])
      .then(setGitMembers)
      .catch(() => setGitMembers([]))
  }, [fetchIssue, fetchNotes, fetchPreferredAgent, projectId])


  useEffect(() => {
    if (!retryAgentPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (retryAgentPickerRef.current && !retryAgentPickerRef.current.contains(e.target as Node)) {
        setRetryAgentPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [retryAgentPickerOpen])

  async function handleConfirmAssignee() {
    if (!issue) return
    const updated = assigneePick ? [assigneePick] : []
    setIssue({ ...issue, assignees: updated })
    setAssigneePickerOpen(false)
    await fetch(`/api/projects/${projectId}/issues/${iid}/assignees`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigneeIds: updated.map(a => a.id),
        assigneeUsernames: updated.map(a => a.username),
      }),
    })
  }

  async function handleChangePreferredAgent(agentIdOrMode: string | null) {
    let body: any
    if (agentIdOrMode === 'assignee') {
      body = { assignMode: 'assignee' }
    } else if (agentIdOrMode === null) {
      body = { assignMode: 'auto' }
    } else {
      body = { assignMode: 'agent', agentId: agentIdOrMode }
    }
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preferred-agent`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) setPreferredAgent(await res.json())
  }

  // 열린 MR이 있으면 사용자에게 선택(머지/닫기/상태만)을 먼저 묻는 approve 래퍼
  async function runApproveWithMRCheck(finalApprove: () => Promise<void>) {
    try {
      const mrRes = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`)
      if (mrRes.ok) {
        const data = await mrRes.json()
        const mr = data?.mr
        if (mr && mr.state === 'opened') {
          setMrActionModal({ mr: { iid: mr.iid, title: mr.title, web_url: mr.web_url, has_conflicts: mr.has_conflicts }, finalApprove })
          return
        }
      }
    } catch { /* MR 조회 실패 시 그냥 진행 */ }
    await finalApprove()
  }

  async function handleMrActionChoice(choice: 'merge' | 'close' | 'none') {
    if (!mrActionModal) return
    const { finalApprove } = mrActionModal
    setMrActionBusy(true)
    try {
      if (choice === 'merge') {
        // MR 머지 — 성공 시 서버의 syncLabelsToDone이 라벨/exec/verified 처리 전부 수행
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'merge' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          toast(err?.error || 'MR 머지에 실패했습니다', 'error')
          return
        }
        toast('MR 머지 후 완료 처리되었습니다', 'success')
        setMrActionModal(null)
        await refreshAll()
        return
      }
      if (choice === 'close') {
        // MR 닫기 → 그 후 라벨만 변경(approve)
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'close' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          toast(err?.error || 'MR 닫기에 실패했습니다', 'error')
          return
        }
      }
      // 'close' 이후 또는 'none' — 라벨만 변경하는 approve 수행
      setMrActionModal(null)
      await finalApprove()
    } finally {
      setMrActionBusy(false)
    }
  }

  async function handleStageAction(action: string) {
    if (!issue) return
    const doApprove = async () => {
      setStageChanging(true)
      try {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: issue.stage, action }),
        })
        if (res.ok) {
          pendingScrollToBottomRef.current = true
          await fetchIssue()
          await fetchNotes()
        } else {
          const errorData = await res.json().catch(() => null)
          toast(errorData?.error || `Error: ${res.status} ${res.statusText}`, 'error')
        }
      } catch (e: any) {
        toast(e.message || '네트워크 오류가 발생했습니다.', 'error')
      } finally {
        setStageChanging(false)
      }
    }
    // verifying 단계의 approve는 MR 처리 먼저 묻는다
    if (issue.stage === 'verifying' && action === 'approve') {
      await runApproveWithMRCheck(doApprove)
      return
    }
    await doApprove()
  }

  async function handleCloseIssue() {
    const ok = await confirm({
      title: tIssue('closeIssue'),
      message: tIssue('closeIssueConfirm', { iid }),
      confirmText: tc('close'),
      cancelText: tc('cancel'),
      variant: 'warning',
    })
    if (!ok) return
    setIsClosing(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/close`, {
        method: 'POST',
      })
      if (res.ok) {
        router.back()
        return
      }
    } finally {
      setIsClosing(false)
    }
  }

  async function handlePostComment() {
    if (!comment.trim() || postingRef.current) return
    postingRef.current = true
    setPosting(true)
    setPostingType('comment')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      })
      if (res.ok) {
        setComment(''); localStorage.removeItem(commentKey)
        setTimeout(() => refreshAll(), 500)
        toast(tIssue('commentRegistered'), 'success')
      } else {
        const data = await res.json().catch(() => ({}))
        toast(data.error || tIssue('commentFailed'), 'error')
      }
    } catch (err: any) {
      toast(err.message || tc('networkError'), 'error')
    } finally {
      postingRef.current = false
      setPosting(false)
      setPostingType(null)
    }
  }

  async function handleDeleteNote(noteId: number) {
    if (!(await confirm({ title: tIssue('deleteComment'), message: tIssue('deleteCommentConfirm'), confirmText: tc('delete'), variant: 'danger' }))) return
    
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes/${noteId}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        toast(tIssue('commentDeleted'), 'success')
        refreshAll()
      } else {
        const data = await res.json().catch(() => ({}))
        toast(data.error || tIssue('deleteCommentFailed'), 'error')
      }
    } catch (err) {
      toast(tIssue('deleteCommentFailed'), 'error')
    }
  }

  // 코멘트 작성 + 상태를 대기로 변경 (재실행 트리거)
  async function handleCommentAndRetry(agentId?: string | null) {
    if (!comment.trim() || postingRef.current) return
    postingRef.current = true
    setPosting(true)
    setPostingType('retry')
    try {
      // 1. 코멘트 등록
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || '코멘트 작성에 실패했습니다', 'error')
        return
      }
      setComment(''); localStorage.removeItem(commentKey)
      pendingScrollToBottomRef.current = true
      await fetchNotes() // 코멘트 성공 시 즉시 목록 갱신
      // 2. 선호 에이전트 변경 (지정된 경우)
      if (agentId !== undefined) {
        const agentRes = await fetch(`/api/projects/${projectId}/issues/${iid}/preferred-agent`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        })
        if (agentRes.ok) {
          setPreferredAgent(await agentRes.json())
        } else {
          const data = await agentRes.json().catch(() => ({}))
          toast(data.error || '에이전트 설정 변경에 실패했습니다', 'error')
        }
      }
      // 3. 스케줄 등록 (waiting이면 이미 스케줄이므로 스킵)
      if (issue?.stage !== 'waiting') {
        const stageAction = issue?.stage === 'done' ? 'reopen'
          : issue?.stage === 'verifying' ? 'reject'
          : issue?.stage === 'none' ? 'schedule'
          : 'retry'
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: issue?.stage, action: stageAction }),
        })
        if (!stageRes.ok) {
          const errorData = await stageRes.json().catch(() => null)
          toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error')
          return
        }
      }
      await refreshAll()
      toast('성공적으로 변경되었습니다', 'success')
    } catch (err: any) {
      toast(err.message || '네트워크 오류가 발생했습니다', 'error')
    } finally {
      postingRef.current = false
      setPosting(false)
      setPostingType(null)
    }
  }

  // 코멘트 작성 + 상태를 완료(IVE-E)로 변경
  async function handleCommentAndDone() {
    if (!comment.trim() || postingRef.current) return
    postingRef.current = true
    setPosting(true)
    setPostingType('done')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || '코멘트 작성에 실패했습니다', 'error')
        return
      }
      setComment(''); localStorage.removeItem(commentKey)
      pendingScrollToBottomRef.current = true
      await fetchNotes() // 코멘트 성공 시 즉시 목록 갱신

      const doApprove = async () => {
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: 'verifying', action: 'approve' }),
        })
        if (!stageRes.ok) {
          const errorData = await stageRes.json().catch(() => null)
          toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error')
          return
        }
        await refreshAll()
        toast('승인 완료되었습니다', 'success')
      }
      await runApproveWithMRCheck(doApprove)
    } catch (err: any) {
      toast(err.message || '네트워크 오류가 발생했습니다', 'error')
    } finally {
      postingRef.current = false
      setPosting(false)
      setPostingType(null)
    }
  }

  // 로그인 사용자가 이슈 담당자인지 확인 (OAuth provider user id 매칭)
  // users.oauth_user_id는 로그인한 Git provider에서의 숫자 ID — assignee.id와 일치 시 동일 인물
  const isAssignee = (() => {
    if (!issue?.assignees?.length || !state.user?.oauthUserId) return false
    const myGitId = String(state.user.oauthUserId)
    return issue.assignees.some(a => a.id != null && String(a.id) === myGitId)
  })()
  const canProgressStage = state.user?.isAdmin || isAssignee

  // 권한 없으면 채팅 모드 강제 해제 (코멘트만 허용)
  useEffect(() => {
    if (!canProgressStage && mode === 'chat') {
      setMode('comment')
    }
  }, [canProgressStage, mode])

  // 담당자 모드: 코멘트 작성 + 다음 단계로 진행
  const NEXT_STAGE: Record<string, { stage: string; action: string; label: string }> = {
    waiting:        { stage: 'waiting',        action: 'start_dev',          label: '개발 시작' },
    dev:            { stage: 'dev',            action: 'complete',           label: '검증대기' },
    verify_waiting: { stage: 'verify_waiting', action: 'start_verification', label: '검증 시작' },
    verifying:      { stage: 'verifying',      action: 'approve',           label: '완료' },
  }

  async function handleCommentAndNextStage() {
    if (!issue || postingRef.current) return
    const next = NEXT_STAGE[issue.stage]
    if (!next) return
    postingRef.current = true
    setPosting(true)
    setPostingType('next')
    try {
      if (comment.trim()) {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: comment.trim() }),
        })
        if (!res.ok) return
        setComment(''); localStorage.removeItem(commentKey)
        pendingScrollToBottomRef.current = true
        await fetchNotes() // 코멘트 성공 시 즉시 목록 갱신
      }
      const doNextStage = async () => {
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: next.stage, action: next.action }),
        })
        if (!stageRes.ok) {
          const errorData = await stageRes.json().catch(() => null)
          toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error')
          return
        }
        await refreshAll()
      }
      // verifying → approve 경로에서만 MR 처리를 먼저 묻는다
      if (next.stage === 'verifying' && next.action === 'approve') {
        await runApproveWithMRCheck(doNextStage)
      } else {
        await doNextStage()
      }
    } finally {
      postingRef.current = false
      setPosting(false)
      setPostingType(null)
    }
  }

  function startEdit() {
    if (!issue) return
    setEditTitle(issue.title)
    setEditDesc(issue.description || '')
    setEditMode(true)
  }

  async function handleSaveEdit() {
    if (!editTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), description: editDesc }),
      })
      if (res.ok) {
        setEditMode(false)
        await refreshAll()
      }
    } finally {
      setSaving(false)
    }
  }

  // Keep ref in sync for beforeunload handler
  useEffect(() => { chatSessionRef.current = chatSessionId }, [chatSessionId])

  // Check for existing chat session on mount
  useEffect(() => {
    fetch(`/api/projects/${projectId}/issues/${iid}/chat`)
      .then(r => r.json())
      .then(data => {
        if (data.session) {
          setChatSessionId(data.session.id)
          if (data.agentName) { setChatAgentName(data.agentName); setChatAgentAvatar(data.agentAvatar || null) }
          setMode('chat')
          loadChatMessages(data.session.id)
        } else if (data.lastChat?.messages?.length > 0) {
          // Show last ended chat as read-only history
          setChatMessages(data.lastChat.messages)
          setChatAgentName(data.lastChat.agentName || null)
          setChatAgentAvatar(data.lastChat.agentAvatar || null)
          setChatHistoryOnly(true)
          setMode('chat')
        }
      })
      .catch(() => {})
  }, [projectId, iid])

  // End chat session when leaving the page
  useEffect(() => {
    const endSession = () => {
      const sid = chatSessionRef.current
      if (!sid) return
      navigator.sendBeacon(
        `/api/projects/${projectId}/issues/${iid}/chat/end`,
        new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' })
      )
    }
    window.addEventListener('beforeunload', endSession)
    return () => {
      window.removeEventListener('beforeunload', endSession)
      // Close WebSocket on unmount
      if (chatWsRef.current) {
        try { chatWsRef.current.close() } catch { /* ignore */ }
        chatWsRef.current = null
      }
      // Also end on unmount (SPA navigation)
      endSession()
    }
  }, [projectId, iid])

  // Load messages and poll if agent is still processing
  async function loadChatMessages(sid: string) {
    const fetchMsgs = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/chat/messages?sessionId=${sid}`)
        const data = await res.json()
        if (data.messages && Array.isArray(data.messages)) {
          setChatMessages(data.messages)
        }
        return data.agentProcessing === true
      } catch { return false }
    }

    const processing = await fetchMsgs()
    if (processing) {
      setChatSending(true)
      setChatStreamText('...')
      // Poll until agent finishes
      const poll = setInterval(async () => {
        const stillProcessing = await fetchMsgs()
        if (!stillProcessing) {
          clearInterval(poll)
          setChatSending(false)
          setChatStreamText('')
        }
      }, 2000)
    }
  }

  async function handleStartChat(force = false) {
    setChatStarting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await res.json()

      // Another issue already has an active chat — ask user to confirm
      if (res.status === 409 && data.existingChatOnIssue) {
        setChatStarting(false)
        const ok = await confirm({
          title: tIssue('chatMode'),
          message: tIssue('chatExistingConfirm', { iid: data.existingChatOnIssue }),
          confirmText: tc('confirm'),
          cancelText: tc('cancel'),
          variant: 'info',
        })
        if (ok) {
          // End the other chat first, then retry with force
          await fetch(`/api/projects/${projectId}/issues/${data.existingChatOnIssue}/chat/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: data.existingSessionId }),
          }).catch(() => {})
          handleStartChat(true)
        }
        return
      }

      if (data.sessionId) {
        setChatSessionId(data.sessionId)
        setChatHistoryOnly(false)
        setChatMessages([])
        if (data.agentName) { setChatAgentName(data.agentName); setChatAgentAvatar(data.agentAvatar || null) }
        setMode('chat')
        if (data.existing) {
          loadChatMessages(data.sessionId)
        }
      } else if (data.error) {
        alert(data.error === 'noAgentAvailable' ? tIssue('chatNoAgent') : data.error)
      }
    } catch {
      alert(tIssue('chatError'))
    } finally {
      setChatStarting(false)
    }
  }

  async function handleEndChat() {
    if (!chatSessionId) return
    const ok = await confirm({
      title: tIssue('endChat'),
      message: tIssue('endChatConfirm'),
      confirmText: tc('confirm'),
      cancelText: tc('cancel'),
      variant: 'info',
    })
    if (!ok) return
    try {
      await fetch(`/api/projects/${projectId}/issues/${iid}/chat/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: chatSessionId }),
      })
    } catch { /* ignore */ }
    setChatSessionId(null)
    chatStreamTextRef.current = ''
    setChatStreamText('')
    // Keep messages visible as read-only history
    setChatHistoryOnly(true)
  }

  function getChatWs(): WebSocket {
    if (chatWsRef.current && chatWsRef.current.readyState === WebSocket.OPEN) {
      return chatWsRef.current
    }
    // Close stale connection
    if (chatWsRef.current) {
      try { chatWsRef.current.close() } catch { /* ignore */ }
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/api/chat`)
    chatWsRef.current = ws

    ws.onmessage = (e) => {
      let data: any
      try { data = JSON.parse(e.data) } catch { return }

      if (data.type === 'ping') {
        // Respond to server heartbeat
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
        return
      }
      if (data.type === 'text' && data.content) {
        chatStreamTextRef.current += data.content
        setChatStreamText(chatStreamTextRef.current)
      } else if (data.type === 'done') {
        // Finalize: move stream text to messages
        const text = chatStreamTextRef.current
        chatStreamTextRef.current = ''
        setChatStreamText('')
        
        if (text.trim()) {
          const assistantMsg: ChatMessage = {
            id: `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}-ai`,
            sessionId: chatSessionRef.current || '',
            role: 'assistant',
            content: text.trim(),
            createdAt: new Date().toISOString(),
          }
          setChatMessages(msgs => [...msgs, assistantMsg])
        }
        setChatSending(false)
        if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null }
      } else if (data.type === 'error') {
        chatStreamTextRef.current += `\n\n[Error: ${data.content}]`
        setChatStreamText(chatStreamTextRef.current)
        setChatSending(false)
        if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null }
      }
    }

    ws.onclose = () => {
      chatWsRef.current = null
      if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null }
    }
    ws.onerror = () => {
      chatWsRef.current = null
      if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null }
    }

    return ws
  }

  async function handleSendChatMessage() {
    if (!chatInput.trim() || !chatSessionId || chatSending) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatSending(true)
    setChatSendingStartTime(Date.now())
    chatStreamTextRef.current = ''
    setChatStreamText('')

    // Optimistically add user message
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      sessionId: chatSessionId,
      role: 'user',
      content: msg,
      createdAt: new Date().toISOString(),
    }
    setChatMessages(prev => [...prev, userMsg])

    const ws = getChatWs()

    const sendPayload = () => {
      ws.send(JSON.stringify({
        type: 'send',
        sessionId: chatSessionId,
        projectId,
        issueIid: iid,
        message: msg,
        locale: state.user?.locale || '',
      }))
    }

    try {
      if (ws.readyState === WebSocket.OPEN) {
        sendPayload()
      } else if (ws.readyState === WebSocket.CONNECTING) {
        // Wait for connection to open
        await new Promise<void>((resolve, reject) => {
          const onOpen = () => { ws.removeEventListener('error', onError); resolve() }
          const onError = () => { ws.removeEventListener('open', onOpen); reject(new Error('WebSocket connection failed')) }
          ws.addEventListener('open', onOpen, { once: true })
          ws.addEventListener('error', onError, { once: true })
        })
        sendPayload()
      } else {
        throw new Error('WebSocket not available')
      }
    } catch {
      setChatSending(false)
      alert(tIssue('chatError'))
    }
  }

  // Auto-scroll when chat messages change or stream updates
  useEffect(() => {
    if (mode === 'chat') {
      notesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatMessages, chatStreamText, mode])

  // 노트가 추가/갱신되어 DOM에 반영된 후, 요청된 경우 마지막 노트로 스크롤
  useEffect(() => {
    if (!pendingScrollToBottomRef.current) return
    pendingScrollToBottomRef.current = false
    // 레이아웃 확정 후 스크롤 (이미지/마크다운 렌더 여유)
    requestAnimationFrame(() => {
      notesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
  }, [notes])

  // Auto-close chat after 5 minutes of inactivity
  useEffect(() => {
    if (!chatSessionId || chatSending) return
    const timer = setTimeout(async () => {
      // Add farewell message locally
      const farewellMsg: ChatMessage = {
        id: `sys-${Date.now()}`,
        sessionId: chatSessionId,
        role: 'assistant',
        content: tIssue('chatIdleClose', { agent: chatAgentName || 'AI' }),
        createdAt: new Date().toISOString(),
      }
      setChatMessages(prev => [...prev, farewellMsg])
      // End the session
      try {
        await fetch(`/api/projects/${projectId}/issues/${iid}/chat/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: chatSessionId }),
        })
      } catch { /* ignore */ }
      setChatSessionId(null)
      // Keep messages as read-only history
      setChatHistoryOnly(true)
    }, 5 * 60 * 1000) // 5 minutes
    return () => clearTimeout(timer)
  // Reset timer on every new message
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSessionId, chatMessages.length, chatSending])

  if (!loading && !issue) {
    return (
      <div className="h-screen flex flex-col">
        <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 max-w-lg mx-auto">
            <button onClick={() => router.back()} className="text-ive-green font-bold p-1 hover:bg-ive-green/5 rounded shrink-0">
              <i className="fa-solid fa-arrow-left" />
            </button>
            <span className="text-base font-bold text-ive-text-muted shrink-0">#{iid}</span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-ive-text-muted mb-4">{tIssue('notFound')}</p>
            <button onClick={() => router.back()} className="text-ive-green font-bold">
              <i className="fa-solid fa-arrow-left mr-1" />{tAuth('goBack')}
            </button>
          </div>
        </div>
        <MobileTabBar />
      </div>
    )
  }

  if (!issue) {
    return (
      <div className="h-screen flex items-center justify-center">
        <i className="fa-solid fa-circle-notch fa-spin text-xl text-ive-green" />
      </div>
    )
  }

  const displayStage = issue.state === 'closed' ? 'closed' : issue.stage
  const stageInfo = STAGE_INFO[displayStage] || STAGE_INFO.unknown
  const actions = issue.state === 'closed' ? [] : (STAGE_ACTIONS[issue.stage] || [])
  const iterationCount = notes.filter(n => n.body.includes('<!-- ive-bot -->') || n.body.includes('IVE(봇)')).length

  return (
    <div className="h-screen flex flex-col">
      {/* 헤더: 뒤로가기 + 이슈번호 + 상태 + 외부링크 */}
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shrink-0">
        <div className="flex items-center gap-2 px-3 py-2 max-w-lg mx-auto">
          <button onClick={() => router.back()} className="text-ive-green font-bold p-1 hover:bg-ive-green/5 rounded shrink-0">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <span className="text-base font-bold text-ive-green shrink-0">#{issue.iid}</span>
          {issue.stage !== 'none' && (
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded border ${stageInfo.bg} ${stageInfo.color} border-current/20 shrink-0`}>
              <i className={`fa-solid ${stageInfo.icon} mr-0.5`} />{stageInfo.label}
            </span>
          )}
          {iterationCount > 0 && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded border bg-ive-cyan/10 text-ive-cyan border-ive-cyan/20 shrink-0" title={tIssue('iterationCount', { count: iterationCount })}>
              <i className="fa-solid fa-repeat mr-0.5" />{tIssue('iterationLabel', { count: iterationCount })}
            </span>
          )}
          <span className="text-xs text-ive-text-dim shrink-0"><i className="fa-solid fa-user mr-0.5" />{issue.author}</span>
          {/* 담당자 */}
          <button
            type="button"
            onClick={() => { setAssigneeSearch(''); setAssigneePick(issue.assignees?.[0] || null); setAssigneePickerOpen(true) }}
            className="flex items-center gap-1 text-xs text-ive-text-dim hover:text-ive-text transition-all shrink-0"
          >
            {(issue.assignees && issue.assignees.length > 0) ? (
              issue.assignees.map(a => (
                <span key={a.id} className="flex items-center gap-0.5">
                  {a.avatarUrl ? <img src={a.avatarUrl} className="w-4 h-4 rounded-full" alt="" /> : <i className="fa-solid fa-user mr-0.5" />}
                  {a.name || a.username}
                </span>
              ))
            ) : (
              <><i className="fa-solid fa-user-plus mr-0.5" />{tIssue('selectAssignee')}</>
            )}
          </button>
          <span className="text-xs text-ive-text-dim ml-auto shrink-0">
            {formatDateMedium(issue.updatedAt, state.user?.locale, state.user?.timezone)}
          </span>
          {issue.webUrl && (
            <button
              onClick={() => window.open(issue.webUrl, '_blank')}
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle hover:text-ive-cyan hover:border-ive-cyan/30 transition-all"
              title={tIssue('viewOnRemote')}
              aria-label={tIssue('openOriginal')}
            >
              <i className="fa-solid fa-arrow-up-right-from-square text-xs" />
            </button>
          )}
        </div>
        {/* 제목 + 설명 토글 + 단계 변경 */}
        <div className="px-3 pb-2 max-w-lg mx-auto">
          {editMode ? (
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm font-bold text-ive-text focus:outline-none focus:border-ive-green"
                  placeholder={tIssue('title')}
                  autoFocus
                />
              </div>
              <div className="flex gap-2 items-end">
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-3 py-1.5 text-sm text-ive-text resize-none focus:outline-none focus:border-ive-green"
                  placeholder={tIssue('descriptionOptional')}
                  rows={4}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={saving || !editTitle.trim()}
                  className="flex-1 text-xs font-bold text-ive-green border border-ive-green/30 py-1.5 rounded-lg hover:bg-ive-green/10 transition-colors disabled:opacity-40"
                >
                  {saving ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-check mr-1" />{tc('save')}</>}
                </button>
                <button
                  onClick={() => setEditMode(false)}
                  className="flex-1 text-xs font-bold text-ive-text-dim border border-ive-border py-1.5 rounded-lg hover:bg-ive-bg-deep transition-colors"
                >
                  {tc('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 flex-wrap">
                <h1 className="text-sm font-bold text-ive-text leading-snug flex-1 min-w-[70%]">{issue.title}</h1>
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  <button
                    onClick={startEdit}
                    className="w-7 h-7 rounded-lg flex items-center justify-center bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle hover:text-ive-green hover:border-ive-green/30 transition-all"
                    title={tc('edit')}
                  >
                    <i className="fa-solid fa-pen text-xs" />
                  </button>
                  {issue.description && (
                    <button onClick={() => setShowDesc(!showDesc)} className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${showDesc ? 'bg-ive-green/10 text-ive-green' : 'bg-ive-bg-card text-ive-text-dim border border-ive-border-subtle'}`} title={tIssue('viewDescription')}>
                      <i className={`fa-solid fa-file-lines text-xs`} />
                    </button>
                  )}
                  {canProgressStage && actions.map(act => (
                    <button
                      key={act.action}
                      onClick={() => handleStageAction(act.action)}
                      disabled={stageChanging}
                      className={`h-7 px-2 rounded-lg text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 ${
                        act.danger
                          ? 'text-ive-red/80 border-ive-red/30 bg-ive-bg-card hover:bg-ive-red/10'
                          : 'text-ive-green border-ive-green/30 bg-ive-bg-card hover:bg-ive-green/10'
                      }`}
                    >
                      {stageChanging ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className={`fa-solid ${act.icon} mr-0.5`} />{act.label}</>}
                    </button>
                  ))}
                  {canProgressStage && (
                    <button
                      onClick={handleCloseIssue}
                      disabled={isClosing || stageChanging}
                      className="h-7 px-2 rounded-lg text-xs font-bold border text-ive-red/80 border-ive-red/30 bg-ive-bg-card hover:bg-ive-red/10 transition-all active:scale-95 disabled:opacity-40"
                    >
                      {isClosing ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-xmark mr-0.5" />{tc('close')}</>}
                    </button>
                  )}
                  {!canProgressStage && (
                    <span className="text-xs text-ive-text-dim italic">
                      <i className="fa-solid fa-lock mr-1" />담당자만 변경 가능
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* 활동 기록 - 남은 공간 전체 사용 */}
      <div className="flex-1 flex flex-col min-h-0 max-w-lg mx-auto w-full">
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto pb-2 pl-3 pr-1">
          <PullToRefresh onRefresh={refreshAll} scrollContainerRef={scrollContainerRef}>
          {/* 이슈 본문 - 스크롤 영역 안에 배치 */}
          {showDesc && issue.description && (
            <div className="mt-1.5 mr-2 text-sm text-ive-text bg-ive-bg-card rounded-lg p-2.5 break-words leading-relaxed">
              <MarkdownNote body={cleanNoteBody(issue.description)} />
            </div>
          )}
          {/* MR 리뷰 섹션 - 담당자 또는 관리자만 표시 */}
          {canProgressStage && (issue.stage === 'done' || issue.stage === 'dev' || issue.stage === 'verify_waiting' || issue.stage === 'verifying') && (
            <div className="pr-2">
              <MRReviewSection projectId={projectId} issueIid={Number(iid)} />
            </div>
          )}

          <div className="py-1.5 pr-2 flex items-center justify-between mt-2 sticky top-0 z-10 bg-ive-bg-deep/95 backdrop-blur-sm">
            <span className="text-xs font-bold text-ive-text-dim uppercase tracking-widest">
              <i className="fa-solid fa-comments mr-1" />{tIssue('activityLog')}
              {!notesLoading && <span className="ml-1 opacity-50">({notes.length})</span>}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={refreshAll}
                disabled={loading || notesLoading}
                className="text-xs font-bold text-ive-text-dim hover:text-ive-green border border-ive-border-subtle hover:border-ive-green/30 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
                title={tc('refresh')}
              >
                <i className={`fa-solid fa-arrows-rotate mr-1 ${loading || notesLoading ? 'fa-spin' : ''}`} />{tc('refresh')}
              </button>
              {notes.length > 0 && (
                <button
                  onClick={() => notesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="text-xs font-bold text-ive-text-dim hover:text-ive-green border border-ive-border-subtle hover:border-ive-green/30 px-3 py-1.5 rounded-lg transition-all"
                  title={tIssue('lastNoteTooltip')}
                >
                  <i className="fa-solid fa-angles-down mr-1" />{tIssue('last')}
                </button>
              )}
            </div>
          </div>

          {notesLoading ? (
            <div className="text-center py-10 text-ive-text-dim text-sm">{tIssue('loadingNotes')}</div>
          ) : notes.length === 0 ? (
            <div className="text-center py-10 text-ive-text-dim text-sm">{tIssue('noActivity')}</div>
          ) : (
            <div className="space-y-1.5">
              {notes.map(note => {
                // iveAuthorAvatar가 있으면 IVE 사용자가 작성한 노트 → 봇이 아님
                const isIveUser = !!note.iveAuthorAvatar
                const isBot = !note.system && !isIveUser && (note.body.includes('<!-- ive-bot -->') || note.body.includes('IVE(봇)'))
                return (
                <div key={note.id} className={`rounded-lg px-3 py-2 ${
                  note.system
                    ? 'bg-white/[0.02]'
                    : isBot
                      ? 'bg-ive-bg-card border border-ive-border-subtle'
                      : 'bg-ive-green/[0.06] border border-ive-green/20'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold flex items-center gap-1 ${
                      note.system ? 'text-ive-text-dim' : isBot ? 'text-ive-cyan' : 'text-ive-green'
                    }`}>
                      {note.system ? (
                        <><i className="fa-solid fa-gear mr-0.5" />{tIssue('system')}</>
                      ) : isBot ? (
                        <><i className="fa-solid fa-robot mr-0.5" />{tIssue('iveBot')}</>
                      ) : (
                        <>
                          {isIveUser && note.iveAuthorAvatar ? (
                            <AgentAvatar avatar={note.iveAuthorAvatar} size="xs" />
                          ) : note.avatarUrl ? (
                            <img src={note.avatarUrl} alt="" className="w-4 h-4 rounded-full" />
                          ) : (
                            <i className="fa-solid fa-user" />
                          )}
                          {note.author}
                        </>
                      )}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-ive-text-dim">
                        {formatDateMedium(note.createdAt, state.user?.locale, state.user?.timezone)}
                      </span>
                      {note.isMine && (
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          className="text-ive-text-dim hover:text-ive-red transition-colors ml-1"
                          title={tc('delete')}
                        >
                          <i className="fa-solid fa-trash-can text-[10px]" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`text-sm leading-relaxed break-words ${note.system ? 'text-ive-text-dim italic' : 'text-ive-text-muted'}`}>
                    {note.body.length > 500 ? <NoteBody body={note.body} /> : <MarkdownNote body={cleanNoteBody(note.body)} />}
                  </div>
                </div>
                )
              })}

              {/* Chat messages inline in timeline */}
              {mode === 'chat' && (chatSessionId || chatHistoryOnly) && (
                <>
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 border-t border-ive-cyan/30" />
                    <span className="text-xs font-bold text-ive-cyan uppercase tracking-widest">
                      <i className="fa-solid fa-comments mr-1" />{tIssue('chatMode')}
                    </span>
                    <div className="flex-1 border-t border-ive-cyan/30" />
                  </div>

                  {/* Agent greeting */}
                  <div className="flex items-start gap-2">
                    <div className="shrink-0 mt-0.5">
                      <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
                    </div>
                    <div className="flex-1 rounded-lg px-3 py-2 bg-ive-cyan/5 border border-ive-cyan/15">
                      <div className="text-xs font-bold text-ive-cyan mb-1">{chatAgentName || 'AI'}</div>
                      <div className="text-sm leading-relaxed text-ive-text-muted">
                        {tIssue('chatGreeting', { agent: chatAgentName || 'AI', iid: iid })}
                      </div>
                    </div>
                  </div>

                  {chatMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'flex-row-reverse' : ''} items-start gap-2`}>
                      <div className="shrink-0 mt-0.5">
                        {msg.role === 'user' ? (
                          <AgentAvatar avatar={state.user?.avatar || 'av-01'} size="sm" />
                        ) : (
                          <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
                        )}
                      </div>
                      <div className={`rounded-lg px-3 py-2 ${msg.role === 'user' ? 'max-w-[80%]' : 'flex-1'} ${
                        msg.role === 'user'
                          ? 'bg-white/5 border border-ive-border-subtle'
                          : 'bg-ive-bg-card border border-ive-cyan/15'
                      }`}>
                        <div className={`flex items-center gap-2 mb-1 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                          <span className={`text-xs font-bold ${
                            msg.role === 'user' ? 'text-ive-text' : 'text-ive-cyan'
                          }`}>
                            {msg.role === 'user' ? (state.user?.name || 'You') : (chatAgentName || 'AI')}
                          </span>
                          <span className="text-xs text-ive-text-dim">
                            {formatTime(msg.createdAt, state.user?.locale, state.user?.timezone)}
                          </span>
                        </div>
                        <div className={`text-sm leading-relaxed break-words text-ive-text-muted ${msg.role === 'user' ? 'text-right' : ''}`}>
                          <MarkdownNote body={msg.content} />
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Streaming indicator */}
              {chatSending && chatStreamText && (
                <div className="flex items-start gap-2">
                  <div className="shrink-0 mt-0.5">
                    <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
                  </div>
                  <div className="flex-1 rounded-lg px-3 py-2 bg-ive-bg-card border border-ive-cyan/15">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-ive-cyan">
                        {chatAgentName || 'AI'}
                        <i className="fa-solid fa-circle-notch fa-spin ml-1.5 text-xs" />
                      </span>
                      <ElapsedTimer startTime={chatSendingStartTime} />
                    </div>
                    <div className="text-sm leading-relaxed break-words text-ive-text-muted">
                      <MarkdownNote body={chatStreamText} />
                    </div>
                  </div>
                </div>
              )}
              {chatSending && !chatStreamText && (
                <div className="flex items-center gap-2 py-3">
                  <div className="shrink-0">
                    <AgentAvatar avatar={chatAgentAvatar || 'av-01'} size="sm" />
                  </div>
                  <ElapsedTimer startTime={chatSendingStartTime} />
                </div>
              )}

              <div ref={notesEndRef} />
            </div>
          )}
          </PullToRefresh>
        </div>

        {/* 하단 입력 영역 */}
        <div className="shrink-0 px-3 pb-20 pt-2 border-t border-ive-border-dark bg-ive-bg-deep">
          {/* Mode tabs */}
          {(
            <div className="flex items-center gap-1 mb-2">
              <button
                onClick={() => setMode('comment')}
                className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all ${
                  mode === 'comment' ? 'bg-ive-green/15 text-ive-green' : 'text-ive-text-dim hover:text-ive-text'
                }`}
              >
                <i className="fa-solid fa-comment mr-1" />{tIssue('commentMode')}
              </button>
              {canProgressStage && (
                <button
                  onClick={() => {
                    if (chatHistoryOnly) {
                      // Already viewing history, toggle to show it
                      setMode('chat')
                    } else if (!chatSessionId) {
                      handleStartChat()
                    } else {
                      setMode('chat')
                    }
                  }}
                  disabled={chatStarting}
                  className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all ${
                    mode === 'chat' ? 'bg-ive-cyan/15 text-ive-cyan' : 'text-ive-text-dim hover:text-ive-text'
                  }`}
                >
                  {chatStarting ? (
                    <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tIssue('startingChat')}</>
                  ) : chatHistoryOnly && !chatSessionId ? (
                    <><i className="fa-solid fa-clock-rotate-left mr-1" />{tIssue('chatMode')}</>
                  ) : (
                    <><i className="fa-solid fa-comments mr-1" />{chatSessionId && chatAgentName ? `${tIssue('chatMode')}(${chatAgentName})` : tIssue('chatMode')}</>
                  )}
                </button>
              )}
              {canProgressStage && chatSessionId && mode === 'chat' && (
                <button
                  onClick={handleEndChat}
                  className="text-xs font-bold px-2 py-1 rounded-lg text-ive-red/70 hover:text-ive-red hover:bg-ive-red/10 transition-all"
                >
                  <i className="fa-solid fa-xmark mr-0.5" />{tIssue('endChat')}
                </button>
              )}
              {/* 작업자 선택 — 탭 행 우측 (권한 있는 경우에만) */}
              {canProgressStage && issue.stage !== 'dev' && projectAgents.length > 0 && (
                <div ref={retryAgentPickerRef} className="relative flex items-center ml-auto">
                  <button
                    type="button"
                    onClick={() => setRetryAgentPickerOpen(v => !v)}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-dashed border-ive-border-subtle hover:border-ive-green/30 transition-all"
                  >
                    <i className="fa-solid fa-user-gear text-ive-green" />
                    {preferredAgent?.assignMode === 'assignee' ? (
                      <span className="font-bold text-ive-cyan"><i className="fa-solid fa-user mr-0.5" />{tIssue('assigneeHandles')}</span>
                    ) : preferredAgent?.preferredAgentId ? (
                      <>
                        <AgentAvatar avatar={preferredAgent.preferredAgentAvatar || ''} size="xs" />
                        <span className="font-bold text-ive-text">{preferredAgent.preferredAgentName}</span>
                      </>
                    ) : (
                      <span className="text-ive-text-muted font-bold">{tIssue('noPreference')}</span>
                    )}
                    <i className="fa-solid fa-chevron-down text-[10px] text-ive-text-dim ml-0.5" />
                  </button>
                  {retryAgentPickerOpen && (
                    <div className="absolute z-50 bottom-full right-0 mb-1 bg-ive-bg-deep border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg shadow-black/30 min-w-[200px]">
                      <button
                        onClick={() => { setRetryAgentPickerOpen(false); handleChangePreferredAgent(null) }}
                        className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${
                          preferredAgent?.assignMode !== 'assignee' && !preferredAgent?.preferredAgentId ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                        }`}
                      >
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-shuffle" /></span>
                        <span className="font-bold">{tIssue('noPreference')}</span>
                      </button>
                      <button
                        onClick={() => { setRetryAgentPickerOpen(false); handleChangePreferredAgent('assignee') }}
                        className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${
                          preferredAgent?.assignMode === 'assignee' ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text hover:bg-white/5'
                        }`}
                      >
                        <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-user" /></span>
                        <span className="font-bold">{tIssue('assigneeHandles')}</span>
                      </button>
                      {projectAgents.map(pa => {
                        const isOffline = pa.agent.status === 'offline'
                        return (
                          <button
                            key={pa.agentId}
                            onClick={() => { setRetryAgentPickerOpen(false); handleChangePreferredAgent(pa.agentId) }}
                            className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${
                              preferredAgent?.preferredAgentId === pa.agentId ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                            }`}
                          >
                            <AgentAvatar avatar={pa.agent.avatar} size="xs" />
                            <span className="font-bold">{pa.agent.name}</span>
                            {isOffline && <span className="text-ive-red ml-auto"><i className="fa-solid fa-circle-exclamation" /></span>}
                            {!isOffline && pa.agent.status === 'busy' && <span className="ml-auto w-2 h-2 rounded-full bg-ive-cyan animate-pulse" />}
                            {!isOffline && pa.agent.status === 'available' && <span className="ml-auto w-2 h-2 rounded-full bg-ive-green" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Comment mode input */}
          {mode === 'comment' && (
            <div className="flex flex-col gap-2">
              <textarea
                value={comment}
                onChange={e => {
                  setComment(e.target.value)
                  localStorage.setItem(commentKey, e.target.value)
                  e.target.style.height = 'auto'
                  const h = Math.min(e.target.scrollHeight, 120)
                  e.target.style.height = h + 'px'
                  e.target.style.overflow = e.target.scrollHeight > 120 ? 'auto' : 'hidden'
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
                  if (isMobile) return
                  if (e.shiftKey) return
                  e.preventDefault()
                  handlePostComment()
                }}
                placeholder={tIssue('commentPlaceholder')}
                rows={1}
                className="w-full min-h-10 bg-ive-bg-card border border-ive-border rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-green/50 overflow-hidden"
              />
              <div className="flex gap-2 justify-end overflow-hidden">
                <button
                  onClick={handlePostComment}
                  disabled={posting || !comment.trim()}
                  className="shrink-0 h-10 px-3 rounded-lg bg-ive-green text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                  title={tIssue('postCommentOnly')}
                  aria-label={tIssue('postComment')}
                >
                  {postingType === 'comment' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-paper-plane" /><span>{tIssue('postCommentShort')}</span></>}
                </button>
                {preferredAgent?.assignMode === 'assignee' && NEXT_STAGE[issue.stage] ? (
                  canProgressStage && (
                    <button
                      onClick={handleCommentAndNextStage}
                      disabled={posting}
                      className="shrink-0 h-10 px-3 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                    >
                      {postingType === 'next' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-forward-step" /><span>{NEXT_STAGE[issue.stage].label}</span></>}
                    </button>
                  )
                ) : (
                  <>
                    {canProgressStage && issue.stage !== 'dev' && (
                      <button
                        onClick={() => handleCommentAndRetry()}
                        disabled={posting || !comment.trim()}
                        className="shrink-0 h-10 px-3 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                        title={tIssue('postAndRetryHint')}
                        aria-label={tIssue('postAndRetry')}
                      >
                        {postingType === 'retry' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-paper-plane" /><span>{issue.stage === 'none' ? tIssue('run') : tIssue('rerun')}</span></>}
                      </button>
                    )}
                    {canProgressStage && issue.stage === 'verifying' && (
                      <button
                        onClick={handleCommentAndDone}
                        disabled={posting || !comment.trim()}
                        className="shrink-0 h-10 px-3 rounded-lg bg-ive-green text-ive-bg-deep flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-40 text-xs font-bold whitespace-nowrap"
                        title={tIssue('postAndDoneHint')}
                        aria-label={tIssue('postAndDone')}
                      >
                        {postingType === 'done' ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-circle-check" /><span>{tIssue('done')}</span></>}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Chat mode input */}
          {mode === 'chat' && chatSessionId && (
            <div className="flex gap-2 items-end">
              <textarea
                value={chatInput}
                onChange={e => {
                  setChatInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter') return
                  const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
                  if (isMobile) return // mobile: Enter = newline, send via button
                  if (e.shiftKey) return // PC: Shift+Enter = newline
                  e.preventDefault()
                  handleSendChatMessage() // PC: Enter = send
                }}
                placeholder={tIssue('chatPlaceholder')}
                rows={1}
                disabled={chatSending}
                className="flex-1 min-h-10 bg-ive-bg-card border border-ive-cyan/30 rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-cyan/50 disabled:opacity-50"
                style={{ overflow: 'auto', scrollbarGutter: 'stable' }}
              />
              <button
                onClick={handleSendChatMessage}
                disabled={chatSending || !chatInput.trim()}
                className="shrink-0 w-10 h-10 rounded-lg bg-ive-cyan text-ive-bg-deep flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
              >
                {chatSending ? <i className="fa-solid fa-circle-notch fa-spin" /> : <i className="fa-solid fa-paper-plane" />}
              </button>
            </div>
          )}

          {/* Chat history-only: show "start new chat" prompt */}
          {mode === 'chat' && !chatSessionId && chatHistoryOnly && !chatStarting && (
            <div className="flex items-center justify-between py-2">
              <span className="text-xs text-ive-text-dim">
                <i className="fa-solid fa-clock-rotate-left mr-1" />{tIssue('chatEnded')}
              </span>
              <button
                onClick={() => {
                  setChatHistoryOnly(false)
                  setChatMessages([])
                  handleStartChat()
                }}
                className="text-xs font-bold text-ive-cyan hover:opacity-80 transition-opacity"
              >
                <i className="fa-solid fa-plus mr-1" />{tIssue('startNewChat')}
              </button>
            </div>
          )}

          {/* Chat start prompt (when mode=chat but no session yet and no history) */}
          {mode === 'chat' && !chatSessionId && !chatHistoryOnly && !chatStarting && (
            <div className="text-center py-2">
              <button
                onClick={() => handleStartChat()}
                className="text-sm font-bold text-ive-cyan hover:opacity-80 transition-opacity"
              >
                <i className="fa-solid fa-comments mr-1" />{tIssue('startChat')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 검증 완료 시 MR 처리 선택 모달 */}
      <Modal open={!!mrActionModal} onClose={() => !mrActionBusy && setMrActionModal(null)} title="열려 있는 MR 처리" size="sm">
        {mrActionModal && (
          <div className="p-4 space-y-4">
            <p className="text-sm text-ive-text-muted">
              이 이슈에 아직 열려 있는 MR이 있습니다. 검증을 완료하기 전에 MR을 어떻게 처리할지 선택해주세요.
            </p>
            <a
              href={mrActionModal.mr.web_url}
              target="_blank"
              rel="noreferrer"
              className="block bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 hover:border-ive-cyan/40 transition-colors"
            >
              <div className="text-xs font-mono text-ive-cyan font-bold">!{mrActionModal.mr.iid}</div>
              <div className="text-sm text-ive-text truncate">{mrActionModal.mr.title}</div>
              {mrActionModal.mr.has_conflicts && (
                <div className="text-xs text-ive-red font-bold mt-1">
                  <i className="fa-solid fa-triangle-exclamation mr-1" />충돌 있음
                </div>
              )}
            </a>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleMrActionChoice('merge')}
                disabled={mrActionBusy || mrActionModal.mr.has_conflicts}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-ive-cyan border border-ive-cyan/30 bg-ive-cyan/5 hover:bg-ive-cyan/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <i className="fa-solid fa-code-merge mr-1.5" />MR 머지 후 완료
              </button>
              <button
                onClick={() => handleMrActionChoice('close')}
                disabled={mrActionBusy}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-ive-red border border-ive-red/30 bg-ive-red/5 hover:bg-ive-red/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <i className="fa-solid fa-xmark mr-1.5" />MR 닫기 후 완료
              </button>
              <button
                onClick={() => handleMrActionChoice('none')}
                disabled={mrActionBusy}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-bold text-ive-text-dim border border-ive-border-dark bg-ive-bg-deep hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <i className="fa-solid fa-arrow-right mr-1.5" />MR 유지 · 상태만 변경
              </button>
              <button
                onClick={() => !mrActionBusy && setMrActionModal(null)}
                disabled={mrActionBusy}
                className="w-full px-3 py-2 rounded-lg text-xs font-bold text-ive-text-dim hover:text-ive-text transition-colors disabled:opacity-40"
              >
                취소
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 담당자 선택 모달 — 단일 선택 + 확인 */}
      <Modal open={assigneePickerOpen} onClose={() => setAssigneePickerOpen(false)} title={tIssue('assignee')} size="sm">
        <div className="p-1.5 border-b border-ive-border-dark">
          <input
            type="text"
            value={assigneeSearch}
            onChange={e => setAssigneeSearch(e.target.value)}
            placeholder={tIssue('searchMember')}
            className="w-full bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50"
            autoFocus
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {/* 담당자 없음 옵션 */}
          <button
            onClick={() => setAssigneePick(null)}
            className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
              !assigneePick ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
            }`}
          >
            {!assigneePick ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
            <div className="w-7 h-7 rounded-full bg-ive-bg-deep flex items-center justify-center shrink-0">
              <i className="fa-solid fa-ban text-ive-text-dim text-xs" />
            </div>
            <span className="font-bold">{tIssue('noAssignee')}</span>
          </button>
          {gitMembers.filter(m => {
            if (!assigneeSearch) return true
            const q = assigneeSearch.toLowerCase()
            return (m.name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
          }).map(m => {
            const isPicked = assigneePick?.id === m.id
            return (
              <button
                key={m.id}
                onClick={() => setAssigneePick(m)}
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
            onClick={() => setAssigneePickerOpen(false)}
            className="flex-1 py-2 rounded-lg text-sm font-bold text-ive-text-dim border border-ive-border-subtle hover:bg-white/5 transition-all"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={handleConfirmAssignee}
            className="flex-1 py-2 rounded-lg text-sm font-bold bg-ive-green text-ive-bg-deep transition-all active:scale-[0.98]"
          >
            {tc('confirm')}
          </button>
        </div>
      </Modal>

      <MobileTabBar />
    </div>
  )
}

// 경과 시간 표시 (예: "3초 생각중...")
function ElapsedTimer({ startTime }: { startTime: number | null }) {
  const [seconds, setSeconds] = useState(0)
  const tIssue = useTranslations('issue')
  useEffect(() => {
    if (!startTime) return
    const tick = () => setSeconds(Math.floor((Date.now() - startTime) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startTime])
  return (
    <span className="text-ive-cyan text-sm">
      {tIssue('chatThinking', { seconds })}
    </span>
  )
}


// 긴 노트를 접었다 펼 수 있는 컴포넌트
function NoteBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false)
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')
  const cleaned = cleanNoteBody(body)
  const display = expanded ? cleaned : cleaned.slice(0, 500) + '...'
  return (
    <>
      <MarkdownNote body={display} />
      <button
        onClick={() => setExpanded(!expanded)}
        className="block mt-1 text-xs text-ive-green hover:underline"
      >
        {expanded ? tc('collapse') : tIssue('viewAll')}
      </button>
    </>
  )
}
