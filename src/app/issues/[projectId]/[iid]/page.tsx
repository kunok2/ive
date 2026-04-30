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

// 노트와 함께 stage 변경이 일어날 때 본문에 붙이는 prefix — "이전 → 다음" 라벨
// IVE-S(waiting) 은 처리 macro 의 waiting sub-stage 이므로 "처리대기" 로 표시.
// 'none' 은 아직 IVE 라벨이 안 붙은 신규 이슈(유입 macro) 에 해당.
const STAGE_NAMES_KO: Record<string, string> = {
  none: '유입',
  waiting: '처리대기', dev: '처리', dev_fail: '처리(실패)',
  verify_waiting: '검증대기', verifying: '검증',
  confirm_waiting: '확인대기', confirming: '확인',
  done: '완료', closed: '완료', rejected: '거부',
}
const STAGE_TRANSITION_DESTS: Record<string, Record<string, string>> = {
  none: { schedule: 'waiting' },
  waiting: { start_dev: 'dev' },
  dev: { complete: 'verify_waiting', cancel: 'waiting', retry: 'waiting' },
  verify_waiting: { start_verification: 'verifying', cancel: 'waiting', retry: 'waiting' },
  verifying: { approve: 'confirm_waiting', complete: 'confirm_waiting', reject: 'waiting', retry: 'waiting' },
  confirm_waiting: { start_confirmation: 'confirming', cancel: 'waiting', return_to_dev: 'verify_waiting', retry: 'waiting' },
  confirming: { accept: 'done', return_to_dev: 'verify_waiting', retry: 'waiting' },
  done: { reopen: 'confirm_waiting', retry: 'waiting' },
  rejected: { retry: 'waiting' },
}
function stageTransitionPrefix(fromStage: string | undefined | null, action: string): string {
  if (!fromStage) return ''
  const to = STAGE_TRANSITION_DESTS[fromStage]?.[action]
  if (!to) return ''
  const fromName = STAGE_NAMES_KO[fromStage] || fromStage
  const toName = STAGE_NAMES_KO[to] || to
  return `**${fromName} → ${toName}**\n\n`
}

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
  closedAt?: string | null
  dueDate?: string | null
  webUrl: string
  author: string
  authorId: number | null
  iveAuthorId: string | null
  authorAvatarUrl: string | null
  iveAuthorAvatar: string | null
  assignees?: IssueAssignee[]
  assigneeAuto?: boolean
  presetVerifier?: { mode: 'creator' | 'auto' | 'specific'; userId: string | null; username: string | null }
  presetConfirmer?: { mode: 'creator' | 'auto' | 'specific'; userId: string | null; username: string | null }
  actualProcessor?: { agentId: string | null; agentName: string | null; agentAvatar: string | null; cliName: string | null } | null
  actualVerifier?: { userId: string | null; name: string | null; avatar: string | null } | null
  actualConfirmer?: { userId: string | null; name: string | null; avatar: string | null } | null
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
  const confirmPopupShownRef = useRef(false)
  const [mrActionModal, setMrActionModal] = useState<{
    mr: { iid: number; title: string; web_url: string; has_conflicts?: boolean }
    finalApprove: () => Promise<void>
  } | null>(null)
  const [mrActionBusy, setMrActionBusy] = useState(false)

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

  const isAssignee = (() => {
    const myGitId = state.user?.oauthUserId ? String(state.user.oauthUserId) : null
    const assignees = issue?.assignees || []
    // 마커 fallback 활성 조건:
    //   - assignees 비어있음: 작성자를 담당자로 간주
    //   - 또는 로컬 계정(myGitId 없음): 마커가 유일한 신원 증거
    // OAuth 사용자가 assignees 에 없으면 마커가 있어도 false → 재배정 보호.
    const canMatchByMarker = assignees.length === 0 || !myGitId
    if (canMatchByMarker && state.user?.id && issue?.iveAuthorId && issue.iveAuthorId === state.user.id) return true
    if (myGitId) {
      if (assignees.some(a => a.id != null && String(a.id) === myGitId)) return true
      if (assignees.length === 0 && issue?.authorId != null && String(issue.authorId) === myGitId) return true
    }
    return false
  })()
  // 담당자/검증자/확인자 배정 변경은 관리자 또는 이슈 생성자만 가능
  const isCreator = (() => {
    if (!state.user || !issue) return false
    if (issue.iveAuthorId && issue.iveAuthorId === state.user.id) return true
    const myGitId = state.user.oauthUserId ? String(state.user.oauthUserId) : null
    if (myGitId && issue.authorId != null && String(issue.authorId) === myGitId) return true
    return false
  })()
  const canEditAssignees = !!state.user?.isAdmin || isCreator

  // 단계 진행 권한 — 검증/확인 단계에서는 지정 담당자(또는 미지정 시 작성자)만 진행 가능.
  // 그 외 단계(waiting/dev/dev_fail 등): 관리자/Git assignee/작성자.
  const canProgressStage = (() => {
    if (!issue) return false
    if (state.user?.isAdmin) return true
    if (issue.stage === 'verify_waiting' || issue.stage === 'verifying') {
      return canStartFor(issue.presetVerifier ?? null, issue.actualVerifier ?? null)
    }
    if (issue.stage === 'confirm_waiting' || issue.stage === 'confirming') {
      return canStartFor(issue.presetConfirmer ?? null, issue.actualConfirmer ?? null)
    }
    // dev/waiting/dev_fail 등: 기존 룰 (assignee 또는 creator)
    return isAssignee || isCreator
  })()

  const fetchIssue = useCallback(async () => {
    const cacheKey = `issue-detail-${projectId}-${iid}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      sessionStorage.removeItem(cacheKey)
      setIssue(JSON.parse(cached))
      setLoading(false)
      return
    }
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      setIssue(prev => (prev && JSON.stringify(prev) === JSON.stringify(data)) ? prev : data)
    }
    setLoading(false)
  }, [projectId, iid])

  // 노트 로딩 표시는 "최초 진입" 한 번만 보여준다. 액션 후 갱신 시에는
  // 기존 노트 목록을 그대로 둔 채 데이터만 조용히 교체해 화면 깜빡임을 막는다.
  const notesLoadedOnceRef = useRef(false)
  const fetchNotes = useCallback(async () => {
    const cacheKey = `issue-notes-${projectId}-${iid}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      sessionStorage.removeItem(cacheKey)
      setNotes(JSON.parse(cached))
      setNotesLoading(false)
      notesLoadedOnceRef.current = true
      return
    }
    if (!notesLoadedOnceRef.current) setNotesLoading(true)
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes?t=${Date.now()}`)
    if (res.ok) {
      const data = await res.json()
      setNotes(prev => {
        // 동일 데이터면 reference를 유지해 자식 리렌더 최소화
        if (prev.length === data.length && JSON.stringify(prev) === JSON.stringify(data)) return prev
        return data
      })
    }
    notesLoadedOnceRef.current = true
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
    // #272: 프로젝트별 배정 폐기. 의뢰자(현재 사용자) 의 에이전트 풀 사용.
    setProjectAgents(state.agents.map(a => ({
      agentId: a.id,
      agent: { id: a.id, name: a.name, avatar: a.avatar, cliName: a.cliName, status: a.status },
    })))
    fetch(`/api/projects/${projectId}/members`)
      .then(res => res.ok ? res.json() : [])
      .then(setGitMembers)
      .catch(() => setGitMembers([]))
  }, [fetchIssue, fetchNotes, fetchPreferredAgent, projectId, state.agents])

  // 백그라운드 폴링 — 에이전트 실행/스캐너 등 외부 상태 변화를 자동 반영.
  //   - 닫힌 이슈 / 종결 단계(done/rejected) 는 폴링 안 함
  //   - 탭이 가려져 있으면(visibilitychange) 폴링 중지, 다시 보이면 즉시 fetch
  useEffect(() => {
    if (!issue || issue.state === 'closed' || issue.stage === 'done' || issue.stage === 'rejected') return
    let cancelled = false
    const tick = async () => {
      if (cancelled || document.hidden) return
      await Promise.all([fetchIssue(), fetchNotes()])
    }
    const id = setInterval(tick, 10000)
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [issue?.state, issue?.stage, fetchIssue, fetchNotes])

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

  async function handleConfirmAssignee(pick: IssueAssignee | null, _auto: boolean) {
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
      const stageAction = issue?.stage === 'done' ? 'reopen'
        : issue?.stage === 'verifying' ? 'reject'
        : issue?.stage === 'confirming' ? 'return_to_dev'
        : issue?.stage === 'none' ? 'schedule'
        : 'retry'
      const noteBody = stageTransitionPrefix(issue?.stage, stageAction) + comment.trim()
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
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
        // stageAction 은 위에서 미리 계산 (note prefix 와 동일 값)
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
    if (!issue || !comment.trim() || postingRef.current) return
    // verifying → approve (확인 대기로), confirming → accept (이슈 종결)
    const isConfirming = issue.stage === 'confirming'
    const stageAction = isConfirming ? 'accept' : 'approve'
    const stageNow = issue.stage
    postingRef.current = true; setPosting(true); setPostingType('done')
    try {
      const noteBody = stageTransitionPrefix(stageNow, stageAction) + comment.trim()
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
      })
      if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || '코멘트 작성에 실패했습니다', 'error'); return }
      setComment(''); localStorage.removeItem(commentKey)
      pendingScrollToBottomRef.current = true; await fetchNotes()
      const doStage = async () => {
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: stageNow, action: stageAction }),
        })
        if (!stageRes.ok) { const errorData = await stageRes.json().catch(() => null); toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error'); return }
        await refreshAll()
        toast(isConfirming ? '확인 완료되었습니다' : '승인 완료되었습니다', 'success')
      }
      // verifying 의 approve 만 MR 체크 적용 (confirming 의 accept 는 단순 종결)
      if (isConfirming) await doStage()
      else await runApproveWithMRCheck(doStage)
    } catch (err: any) { toast(err.message || '네트워크 오류가 발생했습니다', 'error') }
    finally { postingRef.current = false; setPosting(false); setPostingType(null) }
  }

  const NEXT_STAGE: Record<string, { stage: string; action: string; label: string }> = {
    none:            { stage: 'none',            action: 'schedule',            label: '처리' },
    waiting:         { stage: 'waiting',         action: 'start_dev',           label: '개발 시작' },
    dev:             { stage: 'dev',             action: 'complete',            label: '검증대기' },
    verify_waiting:  { stage: 'verify_waiting',  action: 'start_verification',  label: '검증 시작' },
    verifying:       { stage: 'verifying',       action: 'approve',             label: '확인' },
    confirm_waiting: { stage: 'confirm_waiting', action: 'start_confirmation',  label: '확인 시작' },
    confirming:      { stage: 'confirming',      action: 'accept',              label: '완료' },
  }

  async function handleCommentAndNextStage() {
    if (!issue || postingRef.current) return
    const next = NEXT_STAGE[issue.stage]
    if (!next) return
    postingRef.current = true; setPosting(true); setPostingType('next')
    try {
      if (comment.trim()) {
        const noteBody = stageTransitionPrefix(issue.stage, next.action) + comment.trim()
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: noteBody }),
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

  async function handleDueDateChange(next: string | null) {
    // 낙관적 갱신 — 즉시 UI 반영, 실패 시 롤백.
    const prev = issue?.dueDate ?? null
    setIssue(curr => curr ? { ...curr, dueDate: next } : curr)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || tIssue('dueDateUpdateFailed'), 'error')
        setIssue(curr => curr ? { ...curr, dueDate: prev } : curr)
      }
    } catch (e: any) {
      toast(e?.message || tc('networkError'), 'error')
      setIssue(curr => curr ? { ...curr, dueDate: prev } : curr)
    }
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
        toast(data.error === 'noAgentAvailable' ? tIssue('chatNoAgent') : data.error, 'error')
      }
    } catch { toast(tIssue('chatError'), 'error') }
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
    } catch { setChatSending(false); toast(tIssue('chatError'), 'error') }
  }

  // ===================== Side effects =====================

  // Auto-scroll on chat changes
  useEffect(() => { if (mode === 'chat') notesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMessages, chatStreamText, mode])

  // Scroll to bottom after notes update when requested
  useEffect(() => {
    if (!pendingScrollToBottomRef.current) return
    pendingScrollToBottomRef.current = false
    requestAnimationFrame(() => notesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
  }, [notes])

  // 이슈가 바뀌면 popup 표시 플래그 리셋
  useEffect(() => { verifyPopupShownRef.current = false; confirmPopupShownRef.current = false }, [iid])
  // stage 가 바뀔 때마다 팝업 ref 리셋 — 검증대기/확인대기 로 재진입 시 팝업 다시 뜸
  useEffect(() => { verifyPopupShownRef.current = false; confirmPopupShownRef.current = false }, [issue?.stage])

  // 단계 시작 권한 — 검증자/확인자가 지정되었으면 그 사용자에게만, 미지정이면 작성자에게.
  //   1) 관리자: 항상
  //   2) preset.specific: 그 userId 가 현재 유저여야 함
  //   3) preset.auto + 자동배정 완료(actual.userId 결정됨): 그 userId 가 현재 유저여야 함
  //   4) preset.creator / 미지정 / auto 미해결: 작성자
  function canStartFor(
    preset: { mode: string; userId: string | null } | null | undefined,
    actual: { userId: string | null } | null | undefined,
  ): boolean {
    if (!state.user) return false
    if (state.user.isAdmin) return true
    const matchesUser = (uid: string | null | undefined) => !!(uid && (
      uid === state.user!.id
      || (state.user!.oauthUserId && String(state.user!.oauthUserId) === uid)
    ))
    if (preset?.mode === 'specific') {
      return matchesUser(preset.userId)
    }
    // 실제 단계를 시작/진행 중인 사람은 preset 모드와 무관하게 통과 (검증자/확인자 본인)
    if (actual?.userId && matchesUser(actual.userId)) return true
    if (preset?.mode === 'auto') return false
    // creator / 미지정 → 작성자
    return isCreator
  }
  const canStartVerification = !!issue && canStartFor(issue.presetVerifier ?? null, issue.actualVerifier ?? null)
  const canStartConfirmation  = !!issue && canStartFor(issue.presetConfirmer ?? null, issue.actualConfirmer ?? null)

  // Verify-waiting popup — 이슈당 1회 자동 트리거
  useEffect(() => {
    if (loading || !issue || issue.stage !== 'verify_waiting' || !canStartVerification || verifyPopupShownRef.current) return
    verifyPopupShownRef.current = true
    confirm({ title: tIssue('startVerificationPopupTitle'), message: tIssue('startVerificationPopupMessage'), confirmText: tIssue('startVerification'), cancelText: tc('cancel'), variant: 'info' })
      .then(ok => { if (ok) handleStageAction('start_verification') })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue, loading, canStartVerification])

  // Confirm-waiting popup — 이슈당 1회 자동 트리거
  useEffect(() => {
    if (loading || !issue || issue.stage !== 'confirm_waiting' || !canStartConfirmation || confirmPopupShownRef.current) return
    confirmPopupShownRef.current = true
    confirm({ title: tIssue('startConfirmationPopupTitle'), message: tIssue('startConfirmationPopupMessage'), confirmText: tIssue('startConfirmation'), cancelText: tc('cancel'), variant: 'info' })
      .then(ok => { if (ok) handleStageAction('start_confirmation') })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue, loading, canStartConfirmation])

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
        canEditAssignees={canEditAssignees}
        isCreator={isCreator}
        onDueDateChange={handleDueDateChange}
        isClosing={isClosing}
        editMode={editMode}
        editTitle={editTitle}
        editDesc={editDesc}
        saving={saving}
        showDesc={showDesc}
        projectId={projectId}
        gitMembers={gitMembers}
        preferredAgent={preferredAgent}
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
        onPresetVerifierChange={async (preset) => {
          const prevPreset = issue?.presetVerifier
          setIssue(prev => prev ? { ...prev, presetVerifier: preset } : prev)
          try {
            const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preset-roles`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ verifier: preset }),
            })
            if (!res.ok) {
              const d = await res.json().catch(() => ({}))
              toast(d.error || '검증자 변경 실패', 'error')
              setIssue(prev => prev ? { ...prev, presetVerifier: prevPreset } : prev)
            } else {
              window.dispatchEvent(new Event('refresh-counts'))
            }
          } catch (e: any) {
            toast(e?.message || '네트워크 오류', 'error')
            setIssue(prev => prev ? { ...prev, presetVerifier: prevPreset } : prev)
          }
        }}
        onPresetConfirmerChange={async (preset) => {
          const prevPreset = issue?.presetConfirmer
          setIssue(prev => prev ? { ...prev, presetConfirmer: preset } : prev)
          try {
            const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preset-roles`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ confirmer: preset }),
            })
            if (!res.ok) {
              const d = await res.json().catch(() => ({}))
              toast(d.error || '확인자 변경 실패', 'error')
              setIssue(prev => prev ? { ...prev, presetConfirmer: prevPreset } : prev)
            } else {
              window.dispatchEvent(new Event('refresh-counts'))
            }
          } catch (e: any) {
            toast(e?.message || '네트워크 오류', 'error')
            setIssue(prev => prev ? { ...prev, presetConfirmer: prevPreset } : prev)
          }
        }}
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
