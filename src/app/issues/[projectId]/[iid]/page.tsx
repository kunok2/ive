'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileTabBar from '@/components/layout/MobileTabBar'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useTranslations } from 'next-intl'
import { useStageConfig } from './_components/StageActions'
import { useStore } from '@/lib/store'
import IssueHeader from './_components/IssueHeader'
import NotesList from './_components/NotesList'
import BottomInputArea from './_components/BottomInputArea'
import MrActionModal from './_components/MrActionModal'
import AssigneePickerModal from './_components/AssigneePickerModal'

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

export default function IssueDetailPage({ params }: { params: Promise<{ projectId: string; iid: string }> }) {
  const { projectId, iid } = use(params)
  const router = useRouter()
  const { confirm } = useDialog()
  const { toast } = useToast()
  const { state } = useStore()
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')
  const tAuth = useTranslations('auth')
  const { STAGE_INFO, STAGE_ACTIONS } = useStageConfig()

  // --- Core state ---
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [notesLoading, setNotesLoading] = useState(true)
  const [preferredAgent, setPreferredAgent] = useState<{ assignMode?: string; preferredAgentId: string | null; preferredAgentName: string | null; preferredAgentAvatar: string | null; preferredAgentCliName: string | null } | null>(null)
  const [projectAgents, setProjectAgents] = useState<{ agentId: string; agent: { id: string; name: string; avatar: string; cliName: string; status: string } }[]>([])
  const [gitMembers, setGitMembers] = useState<IssueAssignee[]>([])
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)

  // --- Comment state ---
  const commentKey = `issue-comment-${projectId}-${iid}`
  const [comment, setComment] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(commentKey) || ''
    return ''
  })
  const [posting, setPosting] = useState(false)
  const [postingType, setPostingType] = useState<'comment' | 'retry' | 'done' | 'next' | null>(null)
  const postingRef = useRef(false)

  // --- Stage/edit state ---
  const [stageChanging, setStageChanging] = useState(false)
  const [showDesc, setShowDesc] = useState(true)
  const [isClosing, setIsClosing] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // --- MR action modal state ---
  const verifyPopupShownRef = useRef(false)
  const [mrActionModal, setMrActionModal] = useState<{
    mr: { iid: number; title: string; web_url: string; has_conflicts?: boolean }
    finalApprove: () => Promise<void>
  } | null>(null)
  const [mrActionBusy, setMrActionBusy] = useState(false)

  // --- MR bottom buttons state ---
  const [mrInfo, setMrInfo] = useState<{
    iid: number
    title: string
    state: string
    source_branch: string
    target_branch: string
    merge_status: string
    has_conflicts: boolean
    web_url: string
  } | null>(null)
  const [mrLoading, setMrLoading] = useState(false)
  const [mrMerging, setMrMerging] = useState(false)
  const [mrClosing, setMrClosing] = useState(false)

  // --- Scroll/UI refs ---
  const notesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pendingScrollToBottomRef = useRef(false)

  // --- Chat state ---
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
  const [chatHistoryOnly, setChatHistoryOnly] = useState(false)
  const chatSessionRef = useRef<string | null>(null)
  const chatWsRef = useRef<WebSocket | null>(null)
  const chatWsResolveRef = useRef<(() => void) | null>(null)
  const chatStreamTextRef = useRef('')

  // ===================== Data fetching =====================

  const fetchIssue = useCallback(async () => {
    const cacheKey = `issue-detail-${projectId}-${iid}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      sessionStorage.removeItem(cacheKey)
      setIssue(JSON.parse(cached))
      setLoading(false)
      return
    }
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}`)
    if (res.ok) setIssue(await res.json())
    setLoading(false)
  }, [projectId, iid])

  const fetchNotes = useCallback(async () => {
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
    if (res.ok) setNotes(await res.json())
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

  const fetchMRInfo = useCallback(async () => {
    if (!canProgressStage) return
    if (issue?.stage !== 'done' && issue?.stage !== 'dev' && issue?.stage !== 'verify_waiting' && issue?.stage !== 'verifying') return
    setMrLoading(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`)
      if (res.ok) {
        const data = await res.json()
        setMrInfo(data.mr || null)
      }
    } catch { setMrInfo(null) }
    finally { setMrLoading(false) }
  }, [projectId, iid, canProgressStage, issue?.stage])

  const handleMergeMR = useCallback(async () => {
    setMrMerging(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge' }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'MR 머지에 실패했습니다', 'error'); return }
      toast('MR이 성공적으로 머지되었습니다', 'success')
      await fetchMRInfo()
    } finally { setMrMerging(false) }
  }, [projectId, iid, fetchMRInfo, toast])

  const handleCloseMR = useCallback(async () => {
    setMrClosing(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'MR 닫기에 실패했습니다', 'error'); return }
      toast('MR이 닫혔습니다', 'success')
      await fetchMRInfo()
    } finally { setMrClosing(false) }
  }, [projectId, iid, fetchMRInfo, toast])

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
  }, [fetchIssue, fetchNotes, fetchPreferredAgent, fetchMRInfo, projectId])

  // ===================== Stage/issue handlers =====================

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
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'merge' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          toast(err?.error || 'MR 머지에 실패했습니다', 'error'); return
        }
        toast('MR 머지 후 완료 처리되었습니다', 'success')
        setMrActionModal(null); await refreshAll(); return
      }
      if (choice === 'close') {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'close' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          toast(err?.error || 'MR 닫기에 실패했습니다', 'error'); return
        }
      }
      setMrActionModal(null); await finalApprove()
    } finally { setMrActionBusy(false) }
  }

  async function handleStageAction(action: string) {
    if (!issue) return
    const doApprove = async () => {
      setStageChanging(true)
      try {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: issue.stage, action }),
        })
        if (res.ok) {
          pendingScrollToBottomRef.current = true
          await fetchIssue(); await fetchNotes()
        } else {
          const errorData = await res.json().catch(() => null)
          toast(errorData?.error || `Error: ${res.status} ${res.statusText}`, 'error')
        }
      } catch (e: any) {
        toast(e.message || '네트워크 오류가 발생했습니다.', 'error')
      } finally { setStageChanging(false) }
    }
    if (issue.stage === 'verifying' && action === 'approve') {
      await runApproveWithMRCheck(doApprove); return
    }
    await doApprove()
  }

  async function handleCloseIssue() {
    const ok = await confirm({
      title: tIssue('closeIssue'), message: tIssue('closeIssueConfirm', { iid }),
      confirmText: tc('close'), cancelText: tc('cancel'), variant: 'warning',
    })
    if (!ok) return
    setIsClosing(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/close`, { method: 'POST' })
      if (res.ok) { router.back(); return }
    } finally { setIsClosing(false) }
  }

  async function handleConfirmAssignee(pick: IssueAssignee | null) {
    if (!issue) return
    const updated = pick ? [pick] : []
    setIssue({ ...issue, assignees: updated })
    setAssigneePickerOpen(false)
    await fetch(`/api/projects/${projectId}/issues/${iid}/assignees`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeIds: updated.map(a => a.id), assigneeUsernames: updated.map(a => a.username) }),
    })
  }

  async function handleChangePreferredAgent(agentIdOrMode: string | null) {
    let body: any
    if (agentIdOrMode === 'assignee') body = { assignMode: 'assignee' }
    else if (agentIdOrMode === null) body = { assignMode: 'auto' }
    else body = { assignMode: 'agent', agentId: agentIdOrMode }
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preferred-agent`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) setPreferredAgent(await res.json())
  }

  // ===================== Comment handlers =====================

  async function handlePostComment() {
    if (!comment.trim() || postingRef.current) return
    postingRef.current = true; setPosting(true); setPostingType('comment')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    } finally { postingRef.current = false; setPosting(false); setPostingType(null) }
  }

  async function handleDeleteNote(noteId: number) {
    if (!(await confirm({ title: tIssue('deleteComment'), message: tIssue('deleteCommentConfirm'), confirmText: tc('delete'), variant: 'danger' }))) return
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes/${noteId}`, { method: 'DELETE' })
      if (res.ok) { toast(tIssue('commentDeleted'), 'success'); refreshAll() }
      else { const data = await res.json().catch(() => ({})); toast(data.error || tIssue('deleteCommentFailed'), 'error') }
    } catch { toast(tIssue('deleteCommentFailed'), 'error') }
  }

  async function handleCommentAndRetry(agentId?: string | null) {
    if (!comment.trim() || postingRef.current) return
    postingRef.current = true; setPosting(true); setPostingType('retry')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      })
      if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || '코멘트 작성에 실패했습니다', 'error'); return }
      setComment(''); localStorage.removeItem(commentKey)
      pendingScrollToBottomRef.current = true; await fetchNotes()
      if (agentId !== undefined) {
        const agentRes = await fetch(`/api/projects/${projectId}/issues/${iid}/preferred-agent`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        })
        if (agentRes.ok) setPreferredAgent(await agentRes.json())
        else { const data = await agentRes.json().catch(() => ({})); toast(data.error || '에이전트 설정 변경에 실패했습니다', 'error') }
      }
      if (issue?.stage !== 'waiting') {
        const stageAction = issue?.stage === 'done' ? 'reopen' : issue?.stage === 'verifying' ? 'reject' : issue?.stage === 'none' ? 'schedule' : 'retry'
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: issue?.stage, action: stageAction }),
        })
        if (!stageRes.ok) { const errorData = await stageRes.json().catch(() => null); toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error'); return }
      }
      await refreshAll(); toast('성공적으로 변경되었습니다', 'success')
    } catch (err: any) { toast(err.message || '네트워크 오류가 발생했습니다', 'error') }
    finally { postingRef.current = false; setPosting(false); setPostingType(null) }
  }

  async function handleCommentAndDone() {
    if (!comment.trim() || postingRef.current) return
    postingRef.current = true; setPosting(true); setPostingType('done')
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: comment.trim() }),
      })
      if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || '코멘트 작성에 실패했습니다', 'error'); return }
      setComment(''); localStorage.removeItem(commentKey)
      pendingScrollToBottomRef.current = true; await fetchNotes()
      const doApprove = async () => {
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: 'verifying', action: 'approve' }),
        })
        if (!stageRes.ok) { const errorData = await stageRes.json().catch(() => null); toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error'); return }
        await refreshAll(); toast('승인 완료되었습니다', 'success')
      }
      await runApproveWithMRCheck(doApprove)
    } catch (err: any) { toast(err.message || '네트워크 오류가 발생했습니다', 'error') }
    finally { postingRef.current = false; setPosting(false); setPostingType(null) }
  }

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
    postingRef.current = true; setPosting(true); setPostingType('next')
    try {
      if (comment.trim()) {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: comment.trim() }),
        })
        if (!res.ok) return
        setComment(''); localStorage.removeItem(commentKey)
        pendingScrollToBottomRef.current = true; await fetchNotes()
      }
      const doNextStage = async () => {
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: next.stage, action: next.action }),
        })
        if (!stageRes.ok) { const errorData = await stageRes.json().catch(() => null); toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error'); return }
        await refreshAll()
      }
      if (next.stage === 'verifying' && next.action === 'approve') { await runApproveWithMRCheck(doNextStage) }
      else { await doNextStage() }
    } finally { postingRef.current = false; setPosting(false); setPostingType(null) }
  }

  // ===================== Edit handlers =====================

  function startEdit() {
    if (!issue) return
    setEditTitle(issue.title); setEditDesc(issue.description || ''); setEditMode(true)
  }

  async function handleSaveEdit() {
    if (!editTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), description: editDesc }),
      })
      if (res.ok) { setEditMode(false); await refreshAll() }
    } finally { setSaving(false) }
  }

  // ===================== Chat logic =====================

  useEffect(() => { chatSessionRef.current = chatSessionId }, [chatSessionId])

  useEffect(() => {
    fetch(`/api/projects/${projectId}/issues/${iid}/chat`)
      .then(r => r.json())
      .then(data => {
        if (data.session) {
          setChatSessionId(data.session.id)
          if (data.agentName) { setChatAgentName(data.agentName); setChatAgentAvatar(data.agentAvatar || null) }
          setMode('chat'); loadChatMessages(data.session.id)
        } else if (data.lastChat?.messages?.length > 0) {
          setChatMessages(data.lastChat.messages)
          setChatAgentName(data.lastChat.agentName || null)
          setChatAgentAvatar(data.lastChat.agentAvatar || null)
          setChatHistoryOnly(true); setMode('chat')
        }
      }).catch(() => {})
  }, [projectId, iid])

  useEffect(() => {
    const endSession = () => {
      const sid = chatSessionRef.current; if (!sid) return
      navigator.sendBeacon(`/api/projects/${projectId}/issues/${iid}/chat/end`,
        new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' }))
    }
    window.addEventListener('beforeunload', endSession)
    return () => {
      window.removeEventListener('beforeunload', endSession)
      if (chatWsRef.current) { try { chatWsRef.current.close() } catch {} chatWsRef.current = null }
      endSession()
    }
  }, [projectId, iid])

  async function loadChatMessages(sid: string) {
    const fetchMsgs = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/chat/messages?sessionId=${sid}`)
        const data = await res.json()
        if (data.messages && Array.isArray(data.messages)) setChatMessages(data.messages)
        return data.agentProcessing === true
      } catch { return false }
    }
    const processing = await fetchMsgs()
    if (processing) {
      setChatSending(true); setChatStreamText('...')
      const poll = setInterval(async () => {
        const stillProcessing = await fetchMsgs()
        if (!stillProcessing) { clearInterval(poll); setChatSending(false); setChatStreamText('') }
      }, 2000)
    }
  }

  async function handleStartChat(force = false) {
    setChatStarting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await res.json()
      if (res.status === 409 && data.existingChatOnIssue) {
        setChatStarting(false)
        const ok = await confirm({ title: tIssue('chatMode'), message: tIssue('chatExistingConfirm', { iid: data.existingChatOnIssue }), confirmText: tc('confirm'), cancelText: tc('cancel'), variant: 'info' })
        if (ok) {
          await fetch(`/api/projects/${projectId}/issues/${data.existingChatOnIssue}/chat/end`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: data.existingSessionId }),
          }).catch(() => {})
          handleStartChat(true)
        }
        return
      }
      if (data.sessionId) {
        setChatSessionId(data.sessionId); setChatHistoryOnly(false); setChatMessages([])
        if (data.agentName) { setChatAgentName(data.agentName); setChatAgentAvatar(data.agentAvatar || null) }
        setMode('chat')
        if (data.existing) loadChatMessages(data.sessionId)
      } else if (data.error) {
        alert(data.error === 'noAgentAvailable' ? tIssue('chatNoAgent') : data.error)
      }
    } catch { alert(tIssue('chatError')) }
    finally { setChatStarting(false) }
  }

  async function handleEndChat() {
    if (!chatSessionId) return
    const ok = await confirm({ title: tIssue('endChat'), message: tIssue('endChatConfirm'), confirmText: tc('confirm'), cancelText: tc('cancel'), variant: 'info' })
    if (!ok) return
    try {
      await fetch(`/api/projects/${projectId}/issues/${iid}/chat/end`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: chatSessionId }),
      })
    } catch {}
    setChatSessionId(null); chatStreamTextRef.current = ''; setChatStreamText(''); setChatHistoryOnly(true)
  }

  function getChatWs(): WebSocket {
    if (chatWsRef.current && chatWsRef.current.readyState === WebSocket.OPEN) return chatWsRef.current
    if (chatWsRef.current) { try { chatWsRef.current.close() } catch {} }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${window.location.host}/api/chat`)
    chatWsRef.current = ws
    ws.onmessage = (e) => {
      let data: any; try { data = JSON.parse(e.data) } catch { return }
      if (data.type === 'ping') { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong' })); return }
      if (data.type === 'text' && data.content) { chatStreamTextRef.current += data.content; setChatStreamText(chatStreamTextRef.current) }
      else if (data.type === 'done') {
        const text = chatStreamTextRef.current; chatStreamTextRef.current = ''; setChatStreamText('')
        if (text.trim()) {
          setChatMessages(msgs => [...msgs, { id: `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}-ai`, sessionId: chatSessionRef.current || '', role: 'assistant', content: text.trim(), createdAt: new Date().toISOString() }])
        }
        setChatSending(false)
        if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null }
      } else if (data.type === 'error') {
        chatStreamTextRef.current += `\n\n[Error: ${data.content}]`; setChatStreamText(chatStreamTextRef.current); setChatSending(false)
        if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null }
      }
    }
    ws.onclose = () => { chatWsRef.current = null; if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null } }
    ws.onerror = () => { chatWsRef.current = null; if (chatWsResolveRef.current) { chatWsResolveRef.current(); chatWsResolveRef.current = null } }
    return ws
  }

  async function handleSendChatMessage() {
    if (!chatInput.trim() || !chatSessionId || chatSending) return
    const msg = chatInput.trim(); setChatInput(''); setChatSending(true); setChatSendingStartTime(Date.now())
    chatStreamTextRef.current = ''; setChatStreamText('')
    setChatMessages(prev => [...prev, { id: `temp-${Date.now()}`, sessionId: chatSessionId, role: 'user', content: msg, createdAt: new Date().toISOString() }])
    const ws = getChatWs()
    const sendPayload = () => { ws.send(JSON.stringify({ type: 'send', sessionId: chatSessionId, projectId, issueIid: iid, message: msg, locale: state.user?.locale || '' })) }
    try {
      if (ws.readyState === WebSocket.OPEN) { sendPayload() }
      else if (ws.readyState === WebSocket.CONNECTING) {
        await new Promise<void>((resolve, reject) => {
          const onOpen = () => { ws.removeEventListener('error', onError); resolve() }
          const onError = () => { ws.removeEventListener('open', onOpen); reject(new Error('WebSocket connection failed')) }
          ws.addEventListener('open', onOpen, { once: true }); ws.addEventListener('error', onError, { once: true })
        })
        sendPayload()
      } else { throw new Error('WebSocket not available') }
    } catch { setChatSending(false); alert(tIssue('chatError')) }
  }

  // ===================== Side effects =====================

  // Permission check
  const isAssignee = (() => {
    if (!issue?.assignees?.length || !state.user?.oauthUserId) return false
    const myGitId = String(state.user.oauthUserId)
    return issue.assignees.some(a => a.id != null && String(a.id) === myGitId)
  })()
  const canProgressStage = state.user?.isAdmin || isAssignee

  // Auto-scroll on chat changes
  useEffect(() => { if (mode === 'chat') notesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages, chatStreamText, mode])

  // Scroll to bottom after notes update when requested
  useEffect(() => {
    if (!pendingScrollToBottomRef.current) return
    pendingScrollToBottomRef.current = false
    requestAnimationFrame(() => notesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
  }, [notes])

  // Verify-waiting popup
  useEffect(() => {
    if (loading || !issue || issue.stage !== 'verify_waiting' || !canProgressStage || verifyPopupShownRef.current) return
    verifyPopupShownRef.current = true
    confirm({ title: tIssue('startVerificationPopupTitle'), message: tIssue('startVerificationPopupMessage'), confirmText: tIssue('startVerification'), cancelText: tc('cancel'), variant: 'info' })
      .then(ok => { if (ok) handleStageAction('start_verification') })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue, loading, canProgressStage])

  // Force comment mode if not authorized
  useEffect(() => { if (!canProgressStage && mode === 'chat') setMode('comment') }, [canProgressStage, mode])

  // Auto-close chat after 5 minutes inactivity
  useEffect(() => {
    if (!chatSessionId || chatSending) return
    const timer = setTimeout(async () => {
      setChatMessages(prev => [...prev, { id: `sys-${Date.now()}`, sessionId: chatSessionId, role: 'assistant', content: tIssue('chatIdleClose', { agent: chatAgentName || 'AI' }), createdAt: new Date().toISOString() }])
      try { await fetch(`/api/projects/${projectId}/issues/${iid}/chat/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: chatSessionId }) }) } catch {}
      setChatSessionId(null); setChatHistoryOnly(true)
    }, 5 * 60 * 1000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSessionId, chatMessages.length, chatSending])

  // ===================== Render =====================

  if (!loading && !issue) {
    return (
      <div className="h-full flex flex-col">
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
      <div className="h-full flex items-center justify-center">
        <i className="fa-solid fa-circle-notch fa-spin text-xl text-ive-green" />
      </div>
    )
  }

  const displayStage = issue.state === 'closed' ? 'closed' : issue.stage
  const stageInfo = STAGE_INFO[displayStage] || STAGE_INFO.unknown
  const actions = issue.state === 'closed' ? [] : (STAGE_ACTIONS[issue.stage] || [])
  const iterationCount = notes.filter(n => n.body.includes('<!-- ive-bot -->') || n.body.includes('IVE(봇)')).length

  return (
    <div className="h-full flex flex-col">
      <IssueHeader
        issue={issue}
        stageInfo={stageInfo}
        actions={actions}
        stageChanging={stageChanging}
        iterationCount={iterationCount}
        canProgressStage={canProgressStage}
        isClosing={isClosing}
        editMode={editMode}
        editTitle={editTitle}
        editDesc={editDesc}
        saving={saving}
        showDesc={showDesc}
        projectId={projectId}
        onBack={() => router.back()}
        onStageAction={handleStageAction}
        onCloseIssue={handleCloseIssue}
        onStartEdit={startEdit}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => setEditMode(false)}
        onSetEditTitle={setEditTitle}
        onSetEditDesc={setEditDesc}
        onSetShowDesc={setShowDesc}
        onOpenAssigneePicker={() => setAssigneePickerOpen(true)}
        onToast={toast}
      />

      <NotesList
        issue={issue}
        notes={notes}
        notesLoading={notesLoading}
        loading={loading}
        showDesc={showDesc}
        canProgressStage={canProgressStage}
        projectId={projectId}
        iid={iid}
        mode={mode}
        chatSessionId={chatSessionId}
        chatHistoryOnly={chatHistoryOnly}
        chatMessages={chatMessages}
        chatAgentName={chatAgentName}
        chatAgentAvatar={chatAgentAvatar}
        chatSending={chatSending}
        chatSendingStartTime={chatSendingStartTime}
        chatStreamText={chatStreamText}
        scrollContainerRef={scrollContainerRef}
        notesEndRef={notesEndRef}
        onRefreshAll={refreshAll}
        onDeleteNote={handleDeleteNote}
      />

      <BottomInputArea
        issue={issue}
        mode={mode}
        canProgressStage={canProgressStage}
        projectId={projectId}
        comment={comment}
        commentKey={commentKey}
        posting={posting}
        postingType={postingType}
        chatSessionId={chatSessionId}
        chatHistoryOnly={chatHistoryOnly}
        chatStarting={chatStarting}
        chatSending={chatSending}
        chatInput={chatInput}
        chatAgentName={chatAgentName}
        preferredAgent={preferredAgent}
        projectAgents={projectAgents}
        NEXT_STAGE={NEXT_STAGE}
        onSetMode={setMode}
        onSetComment={setComment}
        onSetChatInput={setChatInput}
        onPostComment={handlePostComment}
        onCommentAndRetry={handleCommentAndRetry}
        onCommentAndDone={handleCommentAndDone}
        onCommentAndNextStage={handleCommentAndNextStage}
        onStartChat={handleStartChat}
        onEndChat={handleEndChat}
        onSendChatMessage={handleSendChatMessage}
        onChangePreferredAgent={handleChangePreferredAgent}
        onToast={toast}
        mr={mrInfo}
        mrLoading={mrLoading}
        mrMerging={mrMerging}
        mrClosing={mrClosing}
        onMergeMR={handleMergeMR}
        onCloseMR={handleCloseMR}
      />

      <MrActionModal
        open={!!mrActionModal}
        mr={mrActionModal?.mr ?? null}
        busy={mrActionBusy}
        onChoice={handleMrActionChoice}
        onClose={() => setMrActionModal(null)}
      />

      <AssigneePickerModal
        open={assigneePickerOpen}
        gitMembers={gitMembers}
        initialPick={issue.assignees?.[0] || null}
        onConfirm={handleConfirmAssignee}
        onClose={() => setAssigneePickerOpen(false)}
      />

      <MobileTabBar />
    </div>
  )
}
