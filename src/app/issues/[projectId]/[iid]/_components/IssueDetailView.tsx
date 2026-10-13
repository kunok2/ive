'use client'

import type { PresetRole, RoleAgentCandidate } from '@/components/issue/RoleAvatarBar'
import IssueAutomationPanel from './IssueAutomationPanel'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileTabBar from '@/components/layout/MobileTabBar'
import { useDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { useTranslations } from 'next-intl'
import { useStageConfig, retryActionOf } from './StageActions'
import { transitionTarget } from '@/lib/stage-transitions'
import { useStore } from '@/lib/store'
import IssueHeader, { IssueProgressSection } from './IssueHeader'
import NotesList from './NotesList'
import { toggleCheckboxInBody, computeProgress } from '@/lib/stage-progress'
import BottomInputArea from './BottomInputArea'
import MrActionModal from './MrActionModal'
import AssigneePickerModal from './AssigneePickerModal'
import AgentPickerModal from '@/components/tabs/issues/AgentPickerModal'
import type { ProjectAgent } from '@/components/tabs/issues/types'

// 노트와 함께 stage 변경이 일어날 때 본문에 붙이는 prefix — "이전 → 다음" 라벨
// IVE-S(waiting) 은 처리 macro 의 waiting sub-stage 이므로 "처리대기" 로 표시.
// 'none' 은 아직 IVE 라벨이 안 붙은 신규 이슈(유입 macro) 에 해당.
// 코멘트 말머리용 — 화면 문구가 아니라 Git 이슈에 남는 공용 기록이라 보는 사람 언어와 무관하게 한국어로 둔다(IVE 봇 코멘트와 같은 언어)
const STAGE_NAMES_KO: Record<string, string> = {
  none: '유입',
  waiting: '처리대기', dev: '처리', dev_fail: '처리(실패)',
  verify_waiting: '검증대기', verifying: '검증',
  confirm_waiting: '확인대기', confirming: '확인',
  done: '완료', closed: '완료', rejected: '거부',
}
// 말머리의 도착 단계는 실제 전이 표(TRANSITIONS)에서 계산한다 — 따로 적은 표는 전이 표와 어긋났다(확인대기 재작업 → 검증대기로 적힘 등)
function stageTransitionPrefix(fromStage: string | undefined | null, action: string): string {
  if (!fromStage) return ''
  const to = transitionTarget(fromStage, action)
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
  /** 단계별 진입 횟수 — toProcess 는 처리 실행 수 */
  forwardCounts?: { toProcess: number; toVerify: number; toConfirm: number; toDone: number }
  /** 단계 작업자(에이전트)가 기동하지 못한 사유 — 있으면 사람이 직접 시작할 수 있게 안내 줄에 보인다 */
  stageWorkerNote?: string | null
  deployState?: 'unmerged' | 'deploying' | 'deployed' | 'failed' | null
  /** 지금 이 작업을 하고 있는 에이전트 실행 — 있는 동안 단계 버튼을 막는다(겹쳐 처리 방지) */
  agentWork?: { executionId: string; agentName: string | null; kind: 'process' | 'verify' | 'confirm' | 'chat' } | null
  /** 0 보통 · 1 높음 · 2 긴급 (IVE 에만 저장) */
  priority?: 0 | 1 | 2
  canEditPriority?: boolean
  title: string
  description: string
  /** 본문 체크박스를 눌러 바꿀 수 있는 사용자(조회 전용 제외) */
  canEditBody?: boolean
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
  presetVerifier?: PresetRole
  presetConfirmer?: PresetRole
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

/**
 * 이슈 상세 본문 — 이슈 페이지(/issues/[projectId]/[iid])와 PC 작업 탭의 옆 칸(embedded)이 같이 쓴다.
 * embedded 이면 하단 탭을 그리지 않고, 「뒤로」·삭제 후 이동은 onClose(옆 칸 닫기)로 바뀐다.
 */
export default function IssueDetailView({ projectId, iid, embedded = false, onClose }: {
  projectId: string
  iid: string
  embedded?: boolean
  onClose?: () => void
}) {
  const router = useRouter()
  const goBack = () => { if (embedded) onClose?.(); else router.back() }
  // 넓은 화면 작업 탭의 옆 칸이면 칸 전체 폭을 쓰고 ← 를 그리지 않는다(목록이 바로 옆에 있다)
  const widthCls = embedded ? 'max-w-none' : 'max-w-lg desk:max-w-3xl'
  const { confirm, choose } = useDialog()
  const { toast } = useToast()
  const { state } = useStore()
  const tc = useTranslations('common')
  const tIssue = useTranslations('issue')
  const tAuth = useTranslations('auth')
  const { STAGE_INFO, STAGE_ACTIONS } = useStageConfig()

  // --- Core state ---
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const issueRef = useRef<IssueDetail | null>(null)
  issueRef.current = issue
  const [notes, setNotes] = useState<Note[]>([])
  const notesRef = useRef<Note[]>([])
  useEffect(() => { notesRef.current = notes }, [notes])
  const [loading, setLoading] = useState(true)
  const [notesLoading, setNotesLoading] = useState(true)
  const [preferredAgent, setPreferredAgent] = useState<{ assignMode?: string; preferredAgentId: string | null; preferredAgentName: string | null; preferredAgentAvatar: string | null; preferredAgentCliName: string | null } | null>(null)
  const [projectAgents, setProjectAgents] = useState<ProjectAgent[]>([])
  const [gitMembers, setGitMembers] = useState<IssueAssignee[]>([])
  // 확인자 후보 — 검증자/담당자(프로젝트 멤버)와 달리 provider 로 식별되는 모든 IVE 사용자.
  const [confirmerMembers, setConfirmerMembers] = useState<IssueAssignee[]>([])
  // 역할 명부의 에이전트 — 검증자·확인자 picker 후보
  const [roleAgents, setRoleAgents] = useState<{ verify: RoleAgentCandidate[]; confirm: RoleAgentCandidate[] }>({ verify: [], confirm: [] })
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const [agentPickerSaving, setAgentPickerSaving] = useState(false)

  // --- Comment state ---
  const commentKey = `issue-comment-${projectId}-${iid}`
  const [comment, setComment] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem(commentKey) || ''
    return ''
  })
  const [posting, setPosting] = useState(false)
  const [postingType, setPostingType] = useState<'comment' | 'retry' | 'done' | 'next' | 'inflow' | null>(null)
  const postingRef = useRef(false)

  // --- Stage/edit state ---
  const [stageChanging, setStageChanging] = useState(false)
  // 검증·확인을 에이전트에게 맡기기 — 입력창 위에서 고른 작업자(에이전트), 없으면 서버가 맡을 수 있는 에이전트로 자동 배정
  const [handingOff, setHandingOff] = useState(false)
  const [showDesc, setShowDesc] = useState(true)
  const [isClosing, setIsClosing] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // --- MR action modal state ---
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
  // 자동 종료를 미룬 횟수 — 바뀌면 5분 타이머를 다시 건다
  const [chatIdleTick, setChatIdleTick] = useState(0)
  // 채팅 첨부 이미지: /uploads 로 올려 url/markdown 을 얻고, 전송 시 WS 로 함께 보낸다.
  const [chatImages, setChatImages] = useState<{ id: string; preview: string; url: string | null; markdown: string | null; uploading: boolean; error?: boolean }[]>([])
  const [chatStarting, setChatStarting] = useState(false)
  const [chatStreamText, setChatStreamText] = useState('')
  const [chatAgentName, setChatAgentName] = useState<string | null>(null)
  const [chatAgentAvatar, setChatAgentAvatar] = useState<string | null>(null)
  const [chatHistoryOnly, setChatHistoryOnly] = useState(false)
  const chatSessionRef = useRef<string | null>(null)
  const chatWsRef = useRef<WebSocket | null>(null)
  // WS 콜백·타이머 안에서 최신 값을 읽기 위한 거울 — 끊김 시 「보내는 중」이었는지 판단
  const chatSendingRef = useRef(false)
  useEffect(() => { chatSendingRef.current = chatSending }, [chatSending])
  // 응답 대기 폴링(페이지 재진입·WS 끊김 뒤) — 하나만 돌고, 화면을 떠나면 멈춘다
  const chatPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => { if (chatPollRef.current) clearInterval(chatPollRef.current) }, [])
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

  // 본문 체크박스 저장 상태 — 저장은 한 줄로 차례대로 보내고, 저장과 겹친 목록 응답은 버린다
  const checkboxEpochRef = useRef(0)
  const checkboxPendingRef = useRef(0)
  const checkboxQueueRef = useRef<Promise<void>>(Promise.resolve())

  // 열려 있는 작업의 진행률을 옆 목록 카드에 바로 알린다 — 체크박스를 누르는 즉시, 깃에서 바뀐 것을 폴링이 가져온 즉시
  useEffect(() => {
    if (!issue || issue.state === 'closed') return
    window.dispatchEvent(new CustomEvent('issue-progress', {
      detail: { projectId, iid: Number(iid), progress: computeProgress(issue.description) },
    }))
  }, [issue?.description, issue?.stage, issue?.state, projectId, iid]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchIssue = useCallback(async () => {
    const cacheKey = `issue-detail-${projectId}-${iid}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      sessionStorage.removeItem(cacheKey)
      setIssue(JSON.parse(cached))
      setLoading(false)
      return
    }
    // 네트워크 오류여도 로딩은 끝낸다 — 스피너가 끝없이 돌지 않게(이미 보이던 내용은 그대로 둔다)
    const epoch = checkboxEpochRef.current
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        // 체크박스 저장과 겹친 응답은 저장 전 본문일 수 있다 — 버려서 방금 켠 체크가 도로 꺼지지 않게 한다
        if (epoch !== checkboxEpochRef.current || checkboxPendingRef.current > 0) return
        setIssue(prev => (prev && JSON.stringify(prev) === JSON.stringify(data)) ? prev : data)
      }
    } catch { /* 다음 폴링에서 다시 시도 */ }
    finally { setLoading(false) }
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
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes?t=${Date.now()}`)
      if (res.ok) {
        const data = await res.json()
        const prev = notesRef.current
        // 동일 데이터면 reference를 유지해 자식 리렌더 최소화
        if (prev.length === data.length && JSON.stringify(prev) === JSON.stringify(data)) {
          // 노트가 그대로면 [notes] effect 가 돌지 않아 「맨 아래로」 예약이 남았다가, 몇 분 뒤 폴링에 새 노트가 오면
          // 위를 읽던 사람을 끌어내렸다 — 여기서 바로 처리하고 지운다
          if (pendingScrollToBottomRef.current) {
            pendingScrollToBottomRef.current = false
            requestAnimationFrame(() => notesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
          }
        } else {
          setNotes(data)
        }
      }
    } catch { /* 다음 폴링에서 다시 시도 */ }
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
      agent: { id: a.id, name: a.name, avatar: a.avatar, cliName: a.cliName, status: a.status, enabled: a.enabled, pausedUntil: a.pausedUntil },
    })))
    fetch(`/api/projects/${projectId}/members`)
      .then(res => res.ok ? res.json() : [])
      .then(setGitMembers)
      .catch(() => setGitMembers([]))
    fetch(`/api/projects/${projectId}/confirmer-candidates`)
      .then(res => res.ok ? res.json() : [])
      .then(setConfirmerMembers)
      .catch(() => setConfirmerMembers([]))
    fetch(`/api/projects/${projectId}/roles`)
      .then(res => res.ok ? res.json() : null)
      .then(d => {
        const agents = ((d?.roster || []) as { subjectType: string; subjectId: string; name: string; avatar: string; cliName?: string | null; roles: Record<'process' | 'verify' | 'confirm', boolean> }[])
          .filter(r => r.subjectType === 'agent')
        const pick = (k: 'verify' | 'confirm') => (d?.agentRoles?.[k] === false ? [] : agents.filter(a => a.roles[k])).map(a => ({ id: a.subjectId, name: a.name, avatar: a.avatar, cliName: a.cliName ?? null }))
        setRoleAgents({ verify: pick('verify'), confirm: pick('confirm') })
      })
      .catch(() => setRoleAgents({ verify: [], confirm: [] }))
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

  // 코멘트 + 단계 이동 — 코멘트를 올리기 전에 단계 이동이 받아들여질지 먼저 묻는다(dryRun: 검사만, 변경 없음).
  // 에이전트가 작업 중이거나 단계가 이미 바뀌었으면 코멘트(「검증 완료:」 같은 말머리 포함)를 올리지 않고
  // 입력창에 남긴 채 사유를 알린다 — 일어나지 않은 전이를 적은 코멘트가 남지 않게.
  async function precheckStage(stage: string, action: string): Promise<boolean> {
    const res = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, action, dryRun: true }),
    })
    if (res.ok) return true
    const data = await res.json().catch(() => null)
    toast(data?.error || `Error: ${res.status} ${res.statusText}`, 'error')
    if (res.status === 409) void fetchIssue()  // 바뀐 상태(에이전트 작업 중·다른 단계)를 화면에 반영해 버튼을 맞춘다
    return false
  }

  async function handleMrActionChoice(choice: 'merge' | 'close' | 'none') {
    if (!mrActionModal) return
    const { finalApprove } = mrActionModal
    setMrActionBusy(true)
    try {
      // merge/close 는 MR 처리만 담당. 검증 종료(stage 전이)는 항상 finalApprove 가 수행한다.
      if (choice === 'merge') {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'merge' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          toast(err?.error || tIssue('mrMergeFailed'), 'error'); return
        }
      }
      if (choice === 'close') {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/mr`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'close' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => null)
          toast(err?.error || tIssue('mrCloseFailed'), 'error'); return
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
        toast(e.message || tc('networkError'), 'error')
      } finally { setStageChanging(false) }
    }
    if (issue.stage === 'verifying' && action === 'approve') {
      await runApproveWithMRCheck(doApprove); return
    }
    await doApprove()
  }

  // 검증대기·검증 중·확인대기·확인 중인 작업의 그 단계 일을 에이전트에게 맡긴다 — 검증자/확인자를 그 에이전트로 바꾸고 작업자를 바로 띄운다
  // agent 가 null 이면 자동 배정(맡을 수 있는 에이전트를 서버가 고른다)
  async function handleStageHandOff(kind: 'verify' | 'confirm', agent: { id: string; name: string } | null) {
    if (!issue) return
    // 진행 중(V/C)이면 사람이 하던 검증·확인을 취소하게 된다 — 먼저 묻는다
    if (issue.stage === 'verifying' || issue.stage === 'confirming') {
      const ok = await confirm({
        title: tIssue('handOffButton'), message: agent ? tIssue(`handOffToAgent.${kind}.ask`, { agent: agent.name }) : tIssue(`handOffToAgent.${kind}.askAuto`),
        confirmText: tIssue('handOffButton'), cancelText: tc('cancel'), variant: 'warning',
      })
      if (!ok) return
    }
    setHandingOff(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/stage-agent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent ? { agentId: agent.id } : {}),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        toast(tIssue(`handOffToAgent.${kind}.done`, { agent: data?.agentName || agent?.name || tIssue('agentWorkingUnknown') }), 'success')
        window.dispatchEvent(new Event('refresh-counts'))
      } else {
        toast(data?.error || `Error: ${res.status} ${res.statusText}`, 'error')
      }
      await fetchIssue()  // 성공: 에이전트 작업 중 안내로 / 409: 바뀐 상태로 버튼을 맞춘다
    } catch (e: any) {
      toast(e?.message || tc('networkError'), 'error')
    } finally { setHandingOff(false) }
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
      if (res.ok) { goBack(); return }
      const data = await res.json().catch(() => ({})); toast(data.error || `${tIssue('closeIssue')}: ${res.status}`, 'error')
    } catch { toast(tc('networkError'), 'error') }
    finally { setIsClosing(false) }
  }

  async function handleConfirmAssignee(pick: IssueAssignee | null, _auto: boolean) {
    if (!issue) return
    const updated = pick ? [pick] : []
    const prevAssignees = issue.assignees
    setIssue({ ...issue, assignees: updated })
    setAssigneePickerOpen(false)
    // 화면을 먼저 바꾼다 — 실패하면 되돌리고 알린다(종전에는 실패해도 바뀐 것처럼 보였다)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/assignees`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeIds: updated.map(a => a.id), assigneeUsernames: updated.map(a => a.username) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setIssue(curr => curr ? { ...curr, assignees: prevAssignees } : curr)
        toast(data.error || tc('saveFailed'), 'error')
      }
    } catch {
      setIssue(curr => curr ? { ...curr, assignees: prevAssignees } : curr)
      toast(tc('networkError'), 'error')
    }
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

  // 처리자 picker (에이전트/사람 통합) — 선택 시:
  //   - assignMode 업데이트 (preferred-agent PATCH)
  //   - mode='assignee' + assignee 가 있으면 이슈의 git assignees 도 함께 업데이트
  async function handleAgentPickerSelect(
    _iidArg: number,
    mode: 'auto' | 'assignee' | 'agent',
    agentId: string | null,
    assignee?: IssueAssignee | null,
  ) {
    if (!issue) return
    setAgentPickerSaving(true)
    try {
      const body: any = mode === 'agent' ? { assignMode: 'agent', agentId } : { assignMode: mode }
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preferred-agent`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d.error || tIssue('settingsSaveFailed'), 'error')
        return
      }
      setPreferredAgent(await res.json())

      // 사람(담당자) 직접 지정 — git assignees 도 함께 변경
      if (mode === 'assignee' && assignee) {
        const aRes = await fetch(`/api/projects/${projectId}/issues/${iid}/assignees`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assigneeIds: [assignee.id],
            assigneeUsernames: [assignee.username],
            assigneeAuto: false,
          }),
        })
        if (aRes.ok) {
          setIssue(prev => prev ? { ...prev, assignees: [assignee] } : prev)
        } else {
          const d = await aRes.json().catch(() => ({}))
          toast(d.error || tIssue('assigneeChangeFailed'), 'error')
        }
      }
      setAgentPickerOpen(false)
    } catch (err: any) {
      toast(err?.message || tc('networkError'), 'error')
    } finally {
      setAgentPickerSaving(false)
    }
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
      const stageAction = retryActionOf(issue?.stage)
      if (issue?.stage !== 'waiting' && !(await precheckStage(issue?.stage ?? 'none', stageAction))) return
      const noteBody = stageTransitionPrefix(issue?.stage, stageAction) + comment.trim()
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
      })
      if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || tIssue('commentPostFailed'), 'error'); return }
      setComment(''); localStorage.removeItem(commentKey)
      pendingScrollToBottomRef.current = true; await fetchNotes()
      if (agentId !== undefined) {
        const agentRes = await fetch(`/api/projects/${projectId}/issues/${iid}/preferred-agent`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId }),
        })
        if (agentRes.ok) setPreferredAgent(await agentRes.json())
        else { const data = await agentRes.json().catch(() => ({})); toast(data.error || tIssue('agentSettingFailed'), 'error') }
      }
      if (issue?.stage !== 'waiting') {
        // stageAction 은 위에서 미리 계산 (note prefix 와 동일 값)
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: issue?.stage, action: stageAction }),
        })
        if (!stageRes.ok) { const errorData = await stageRes.json().catch(() => null); toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error'); return }
      }
      await refreshAll(); toast(tIssue('stageChanged'), 'success')
    } catch (err: any) { toast(err.message || tc('networkError'), 'error') }
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
      if (!(await precheckStage(stageNow, stageAction))) return
      const noteBody = stageTransitionPrefix(stageNow, stageAction) + comment.trim()
      // 코멘트는 실제로 승인하는 순간에 올린다 — 열린 MR 확인 창에서 취소하면 단계도 코멘트도 그대로(입력창 유지)
      const doStage = async () => {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: noteBody }),
        })
        if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || tIssue('commentPostFailed'), 'error'); return }
        setComment(''); localStorage.removeItem(commentKey)
        pendingScrollToBottomRef.current = true; await fetchNotes()
        const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage: stageNow, action: stageAction }),
        })
        if (!stageRes.ok) { const errorData = await stageRes.json().catch(() => null); toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error'); return }
        await refreshAll()
        toast(isConfirming ? tIssue('confirmDone') : tIssue('approveDone'), 'success')
      }
      // verifying 의 approve 만 MR 체크 적용 (confirming 의 accept 는 단순 종결)
      if (isConfirming) await doStage()
      else await runApproveWithMRCheck(doStage)
    } catch (err: any) { toast(err.message || tc('networkError'), 'error') }
    finally { postingRef.current = false; setPosting(false); setPostingType(null) }
  }

  async function handleCommentAndInflow() {
    if (!issue || !comment.trim() || postingRef.current) return
    const stageAction = 'to_inflow'
    const stageNow = issue.stage
    postingRef.current = true; setPosting(true); setPostingType('inflow')
    try {
      if (!(await precheckStage(stageNow, stageAction))) return
      const noteBody = stageTransitionPrefix(stageNow, stageAction) + comment.trim()
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
      })
      if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || tIssue('commentPostFailed'), 'error'); return }
      setComment(''); localStorage.removeItem(commentKey)
      pendingScrollToBottomRef.current = true; await fetchNotes()
      const stageRes = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stageNow, action: stageAction }),
      })
      if (!stageRes.ok) { const errorData = await stageRes.json().catch(() => null); toast(errorData?.error || `Error: ${stageRes.status} ${stageRes.statusText}`, 'error'); return }
      await refreshAll(); toast(tIssue('inflowDone'), 'success')
    } catch (err: any) { toast(err.message || tc('networkError'), 'error') }
    finally { postingRef.current = false; setPosting(false); setPostingType(null) }
  }

  const NEXT_STAGE: Record<string, { stage: string; action: string; label: string }> = {
    none:            { stage: 'none',            action: 'schedule',            label: tIssue('nextStage.none') },
    waiting:         { stage: 'waiting',         action: 'start_dev',           label: tIssue('nextStage.waiting') },
    dev:             { stage: 'dev',             action: 'complete',            label: tIssue('nextStage.dev') },
    verify_waiting:  { stage: 'verify_waiting',  action: 'start_verification',  label: tIssue('nextStage.verify_waiting') },
    verifying:       { stage: 'verifying',       action: 'approve',             label: tIssue('nextStage.verifying') },
    confirm_waiting: { stage: 'confirm_waiting', action: 'start_confirmation',  label: tIssue('nextStage.confirm_waiting') },
    confirming:      { stage: 'confirming',      action: 'accept',              label: tIssue('nextStage.confirming') },
  }

  async function handleCommentAndNextStage() {
    if (!issue || postingRef.current) return
    const next = NEXT_STAGE[issue.stage]
    if (!next) return
    // 검증대기·확인대기에서 코멘트와 함께 누르면 — 시작만 할지, 검증(확인)을 마친 것으로 보고 끝까지 넘길지 고르게 한다(버튼을 두 번 누르지 않게)
    const finish = issue.stage === 'verify_waiting' ? { mid: 'verifying', action: 'approve', kind: 'verify' as const }
      : issue.stage === 'confirm_waiting' ? { mid: 'confirming', action: 'accept', kind: 'confirm' as const } : null
    if (finish && comment.trim()) {
      const picked = await choose({
        title: tIssue(`startOrFinish.${finish.kind}.title`), message: tIssue(`startOrFinish.${finish.kind}.message`),
        altText: next.label, confirmText: NEXT_STAGE[finish.mid].label, cancelText: tc('cancel'),
      })
      if (!picked) return
      if (picked === 'confirm') { await startAndFinish(next, finish); return }
    }
    if (postingRef.current) return
    postingRef.current = true; setPosting(true); setPostingType('next')
    try {
      const noteBody = comment.trim() ? stageTransitionPrefix(issue.stage, next.action) + comment.trim() : null
      if (noteBody && !(await precheckStage(next.stage, next.action))) return
      // 코멘트는 실제로 단계를 옮기는 순간에 올린다 — 열린 MR 확인 창에서 취소하면 코멘트도 남지 않는다
      const doNextStage = async () => {
        if (noteBody) {
          const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: noteBody }),
          })
          if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || tIssue('commentPostFailed'), 'error'); return }
          setComment(''); localStorage.removeItem(commentKey)
          pendingScrollToBottomRef.current = true; await fetchNotes()
        }
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

  // 시작과 완료를 이어서 — 검증대기 → (검증 중) → 확인대기, 확인대기 → (확인 중) → 완료. 단계 기록은 두 번 누른 것과 같게 남는다
  async function startAndFinish(start: { stage: string; action: string }, finish: { mid: string; action: string; kind: 'verify' | 'confirm' }) {
    if (postingRef.current) return
    postingRef.current = true; setPosting(true); setPostingType('next')
    try {
      if (!(await precheckStage(start.stage, start.action))) return
      const postStage = async (stage: string, action: string) => {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/stage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stage, action }),
        })
        if (res.ok) return true
        const errorData = await res.json().catch(() => null)
        toast(errorData?.error || `Error: ${res.status} ${res.statusText}`, 'error')
        return false
      }
      const noteBody = stageTransitionPrefix(finish.mid, finish.action) + comment.trim()
      // 열린 MR 확인 창에서 취소하면 시작도 하지 않는다(단계·코멘트 그대로)
      const run = async () => {
        if (!(await postStage(start.stage, start.action))) return
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/notes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: noteBody }),
        })
        // 코멘트가 실패하면 시작한 단계(검증 중·확인 중)에 머문다 — 입력한 글은 남아 있어 그 단계의 완료 버튼으로 다시 넘길 수 있다
        if (!res.ok) { const data = await res.json().catch(() => ({})); toast(data.error || tIssue('commentPostFailed'), 'error'); await refreshAll(); return }
        setComment(''); localStorage.removeItem(commentKey)
        pendingScrollToBottomRef.current = true
        if (!(await postStage(finish.mid, finish.action))) { await refreshAll(); return }
        await refreshAll()
        toast(finish.kind === 'confirm' ? tIssue('confirmDone') : tIssue('approveDone'), 'success')
      }
      if (finish.kind === 'verify') await runApproveWithMRCheck(run)
      else await run()
    } catch (err: any) { toast(err.message || tc('networkError'), 'error') }
    finally { postingRef.current = false; setPosting(false); setPostingType(null) }
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
      else { const data = await res.json().catch(() => ({})); toast(data.error || tc('saveFailed'), 'error') }  // 편집 내용은 그대로 둔다
    } catch { toast(tc('networkError'), 'error') }
    finally { setSaving(false) }
  }

  /** 본문 체크박스 — 저장소 본문을 고쳐 쓰고, 화면은 먼저 바꿔 둔다(실패하면 그 칸만 되돌림) */
  function handleToggleCheckbox(index: number, checked: boolean) {
    const cur = issueRef.current?.description ?? ''
    const next = toggleCheckboxInBody(cur, index, checked)
    if (next === null) return
    issueRef.current = issueRef.current ? { ...issueRef.current, description: next } : issueRef.current
    setIssue(curr => curr ? { ...curr, description: next } : curr)
    checkboxEpochRef.current++
    checkboxPendingRef.current++
    const undo = () => setIssue(curr => {
      const back = curr ? toggleCheckboxInBody(curr.description || '', index, !checked) : null
      return curr && back !== null ? { ...curr, description: back } : curr
    })
    // 연속으로 눌러도 서버에는 누른 순서대로 하나씩 — 동시에 보내면 서로의 저장을 덮어쓴다
    checkboxQueueRef.current = checkboxQueueRef.current.then(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/checkbox`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ index, checked }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast(data.error || tIssue('checkboxSaveFailed'), 'error')
          undo()
        }
      } catch (e: any) {
        toast(e?.message || tc('networkError'), 'error')
        undo()
      } finally {
        checkboxEpochRef.current++
        if (--checkboxPendingRef.current === 0) {
          // 옆 칸의 작업 카드·보드 진행률도 바뀌도록 목록을 다시 가져오게 한다
          window.dispatchEvent(new CustomEvent('refresh-counts'))
        }
      }
    })
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

  async function handlePriorityChange(next: 0 | 1 | 2) {
    // 낙관적 갱신 — 즉시 UI 반영, 실패 시 롤백
    const prev = issue?.priority ?? 0
    setIssue(curr => curr ? { ...curr, priority: next } : curr)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/priority`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast(data.error || tIssue('priorityChangeFailed'), 'error')
        setIssue(curr => curr ? { ...curr, priority: prev } : curr)
      }
    } catch (e: any) {
      toast(e?.message || tc('networkError'), 'error')
      setIssue(curr => curr ? { ...curr, priority: prev } : curr)
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
    // 페이지를 떠나도(다른 페이지로 이동·탭 닫기) 채팅 세션을 종료하지 않는다.
    // 진행 중인 에이전트는 서버에서 계속 돌아 응답을 끝까지 DB에 저장하고,
    // 돌아오면 세션이 복원되며 아직 생각 중이면 "생각중" 상태로 이어 보여준다.
    // WS만 닫아 구독을 해제하고, 세션 정리는 서버측 idle 리퍼 + 명시적 "대화 종료" 버튼이 담당.
    return () => {
      // ref 를 먼저 비워, 이 close 를 onclose 가 「끊김」으로 오인해 폴링을 시작하지 않게 한다
      const ws = chatWsRef.current; chatWsRef.current = null
      if (ws) { try { ws.close() } catch {} }
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
      // 답을 기다리는 중 — 재진입이면 시작 시각을 몰라 지금부터 잰다(0초에 멈춰 보이지 않게)
      setChatSending(true); setChatStreamText('...'); setChatSendingStartTime(t => t ?? Date.now())
      if (chatPollRef.current) clearInterval(chatPollRef.current)
      chatPollRef.current = setInterval(async () => {
        const stillProcessing = await fetchMsgs()
        if (!stillProcessing) {
          if (chatPollRef.current) { clearInterval(chatPollRef.current); chatPollRef.current = null }
          chatStreamTextRef.current = ''; setChatSending(false); setChatStreamText('')
        }
      }, 2000)
    } else if (chatSendingRef.current) {
      // 끊긴 사이 답이 이미 끝났다 — 저장된 대화로 바꿨으니 대기 표시만 푼다
      chatStreamTextRef.current = ''; setChatSending(false); setChatStreamText('')
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
      } else if (data.type === 'error') {
        // 응답 말풍선은 보내는 중에만 그려지므로, 받은 부분과 오류를 대화에 남겨야 보인다(스피너만 사라지고 답이 없던 것)
        const partial = chatStreamTextRef.current.trim(); chatStreamTextRef.current = ''; setChatStreamText('')
        setChatMessages(msgs => [...msgs, { id: `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}-err`, sessionId: chatSessionRef.current || '', role: 'assistant', content: `${partial ? partial + '\n\n' : ''}⚠️ ${data.content || tIssue('chatError')}`, createdAt: new Date().toISOString() }])
        setChatSending(false)
      }
    }
    // 끊김(화면 꺼짐·서버 재기동·네트워크 전환) — 서버는 답을 끝까지 DB 에 저장하므로, 보내는 중이었다면 폴링으로 이어 받는다.
    // 우리가 일부러 닫은 경우(교체·화면 떠남)는 ref 가 이미 다른 값이라 무시한다. error 뒤에는 늘 close 가 온다.
    ws.onclose = () => {
      if (chatWsRef.current !== ws) return
      chatWsRef.current = null
      const sid = chatSessionRef.current
      if (chatSendingRef.current && sid) void loadChatMessages(sid)
    }
    return ws
  }

  // 채팅 첨부 이미지 추가: 즉시 /uploads 로 올려 url/markdown 확보(미리보기는 로컬 objectURL)
  async function addChatImages(files: File[]) {
    for (const file of files) {
      const id = `ci-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const preview = URL.createObjectURL(file)
      setChatImages(prev => [...prev, { id, preview, url: null, markdown: null, uploading: true }])
      try {
        const fd = new FormData(); fd.append('file', file)
        const res = await fetch(`/api/projects/${projectId}/uploads`, { method: 'POST', body: fd })
        if (!res.ok) throw new Error(`upload ${res.status}`)
        const data = await res.json()
        setChatImages(prev => prev.map(c => c.id === id ? { ...c, url: String(data.url || ''), markdown: String(data.markdown || ''), uploading: false } : c))
      } catch {
        setChatImages(prev => prev.map(c => c.id === id ? { ...c, uploading: false, error: true } : c))
        toast(tIssue('imageUploadFailed'), 'error')
      }
    }
  }
  function removeChatImage(id: string) {
    setChatImages(prev => { const t = prev.find(c => c.id === id); if (t) { try { URL.revokeObjectURL(t.preview) } catch {} } return prev.filter(c => c.id !== id) })
  }

  async function handleSendChatMessage() {
    if (!chatSessionId || chatSending) return
    if (chatImages.some(c => c.uploading)) { toast(tIssue('imageUploading'), 'error'); return }
    const ready = chatImages.filter(c => c.url && !c.error)
    if (!chatInput.trim() && ready.length === 0) return
    const msg = chatInput.trim(); setChatInput(''); setChatSending(true); setChatSendingStartTime(Date.now())
    const imageUrls = ready.map(c => c.url!).filter(Boolean)
    const imageMarkdowns = ready.map(c => c.markdown || '').filter(Boolean)
    setChatImages([])
    chatStreamTextRef.current = ''; setChatStreamText('')
    const tempContent = [msg, ...imageMarkdowns].filter(Boolean).join('\n\n')
    setChatMessages(prev => [...prev, { id: `temp-${Date.now()}`, sessionId: chatSessionId, role: 'user', content: tempContent, createdAt: new Date().toISOString() }])
    const ws = getChatWs()
    const sendPayload = () => { ws.send(JSON.stringify({ type: 'send', sessionId: chatSessionId, projectId, issueIid: iid, message: msg, locale: state.user?.locale || '', imageUrls, imageMarkdowns })) }
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

  // 검증·확인을 에이전트에게 맡기기 — 하단 「자동 검증」·「자동 확인」 버튼(검증대기·검증 중·확인대기·확인 중, 에이전트가 이 작업을 하고 있지 않을 때).
  // 작업자가 사람(담당자가 직접)으로 선택된 작업에는 내놓지 않는다.
  const handOffKind: 'verify' | 'confirm' | null = !issue || issue.agentWork || preferredAgent?.assignMode === 'assignee' ? null
    : issue.stage === 'verify_waiting' || issue.stage === 'verifying' ? 'verify'
    : issue.stage === 'confirm_waiting' || issue.stage === 'confirming' ? 'confirm' : null
  // 입력창 위에서 고른 작업자(에이전트)가 있으면 그 에이전트에게, 없으면 자동 배정.
  // 자기 작업을 자기가 검증하지 않는다 — 고른 에이전트가 이 작업을 처리한 에이전트면 검증은 자동 배정으로 넘긴다(서버도 막는다)
  const handOffTarget = handOffKind && preferredAgent?.assignMode === 'agent' && preferredAgent.preferredAgentId
    && !(handOffKind === 'verify' && preferredAgent.preferredAgentId === issue?.actualProcessor?.agentId)
    ? { id: preferredAgent.preferredAgentId, name: preferredAgent.preferredAgentName || '' } : null

  // Force comment mode if not authorized
  useEffect(() => { if (!canProgressStage && mode === 'chat') setMode('comment') }, [canProgressStage, mode])

  // Auto-close chat after 5 minutes inactivity
  useEffect(() => {
    if (!chatSessionId || chatSending) return
    const IDLE_MS = 5 * 60 * 1000
    const timer = setTimeout(async () => {
      // 닫기 전에 서버에 묻는다 — 다른 탭·기기에서 대화를 이어가는 중이면(답을 만드는 중이거나 최근 메시지가 있으면)
      // 이 탭의 타이머가 그 세션을 끊으면 안 된다. 그 경우 최신 대화로 바꿔 타이머를 다시 건다.
      try {
        const res = await fetch(`/api/projects/${projectId}/issues/${iid}/chat/messages?sessionId=${chatSessionId}`)
        const data = await res.json()
        const msgs: ChatMessage[] = Array.isArray(data.messages) ? data.messages : []
        // chat_messages.created_at 은 SQLite datetime('now') — UTC 인데 Z 가 없어 그대로 읽으면 브라우저 시간대로 해석된다
        const utcMs = (v: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z').getTime()
        const lastAt = msgs.length ? utcMs(msgs[msgs.length - 1].createdAt) : 0
        if (data.agentProcessing === true || Date.now() - lastAt < IDLE_MS) {
          if (msgs.length) setChatMessages(msgs)
          if (data.agentProcessing === true) void loadChatMessages(chatSessionId)
          setChatIdleTick(n => n + 1)
          return
        }
      } catch { /* 조회 실패 — 종전대로 닫는다 */ }
      setChatMessages(prev => [...prev, { id: `sys-${Date.now()}`, sessionId: chatSessionId, role: 'assistant', content: tIssue('chatIdleClose', { agent: chatAgentName || 'AI' }), createdAt: new Date().toISOString() }])
      try { await fetch(`/api/projects/${projectId}/issues/${iid}/chat/end`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: chatSessionId }) }) } catch {}
      setChatSessionId(null); setChatHistoryOnly(true)
    }, IDLE_MS)
    return () => clearTimeout(timer)
  // 입력 중(chatInput)도 활동으로 본다 — 긴 글을 쓰는 사이 세션이 닫히지 않게
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSessionId, chatMessages.length, chatSending, chatInput, chatIdleTick])

  // ===================== Render =====================

  if (!loading && !issue) {
    return (
      <div className="h-full flex flex-col">
        <header className={`sticky top-0 z-40 w-full ${widthCls} mx-auto bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark shrink-0`}>
          <div className="flex items-center gap-2 px-3 py-2">
            {!embedded && (
              <button onClick={() => goBack()} className="text-ive-green font-bold p-1 hover:bg-ive-green/5 rounded shrink-0">
                <i className="fa-solid fa-arrow-left" />
              </button>
            )}
            <span className="text-base font-bold text-ive-text-secondary shrink-0">#{iid}</span>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-ive-text-muted mb-4">{tIssue('notFound')}</p>
            <button onClick={() => goBack()} className="text-ive-green font-bold">
              <i className="fa-solid fa-arrow-left mr-1" />{tAuth('goBack')}
            </button>
          </div>
        </div>
        {!embedded && <MobileTabBar />}
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
  // 처리 횟수 — 실제 처리 실행 수(카드의 ↻ 와 같은 근거). 봇 코멘트 수를 세면 검증·확인 결과까지 더해져 한 번에 통과해도 「4차」가 된다
  const iterationCount = issue.forwardCounts?.toProcess ?? 0

  // 검증자·확인자 미리 지정 — 낙관 반영 후 서버 저장값으로 맞추고, 실패하면 되돌린다
  const handlePresetVerifierChange = async (preset: PresetRole) => {
    const prevPreset = issue?.presetVerifier
    setIssue(prev => prev ? { ...prev, presetVerifier: preset } : prev)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preset-roles`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifier: preset }),
      })
      if (res.ok) {
        // 서버 저장값(에이전트 이름·아바타 포함)으로 맞춘다
        const saved = await res.clone().json().catch(() => null)
        if (saved?.verifier) setIssue(prev => prev ? { ...prev, presetVerifier: saved.verifier } : prev)
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d.error || tIssue('verifierChangeFailed'), 'error')
        setIssue(prev => prev ? { ...prev, presetVerifier: prevPreset } : prev)
      } else {
        window.dispatchEvent(new Event('refresh-counts'))
      }
    } catch (e: any) {
      toast(e?.message || tc('networkError'), 'error')
      setIssue(prev => prev ? { ...prev, presetVerifier: prevPreset } : prev)
    }
  }
  const handlePresetConfirmerChange = async (preset: PresetRole) => {
    const prevPreset = issue?.presetConfirmer
    setIssue(prev => prev ? { ...prev, presetConfirmer: preset } : prev)
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${iid}/preset-roles`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmer: preset }),
      })
      if (res.ok) {
        // 서버 저장값(에이전트 이름·아바타 포함)으로 맞춘다
        const saved = await res.clone().json().catch(() => null)
        if (saved?.confirmer) setIssue(prev => prev ? { ...prev, presetConfirmer: saved.confirmer } : prev)
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast(d.error || tIssue('confirmerChangeFailed'), 'error')
        setIssue(prev => prev ? { ...prev, presetConfirmer: prevPreset } : prev)
      } else {
        window.dispatchEvent(new Event('refresh-counts'))
      }
    } catch (e: any) {
      toast(e?.message || tc('networkError'), 'error')
      setIssue(prev => prev ? { ...prev, presetConfirmer: prevPreset } : prev)
    }
  }

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
        isClosing={isClosing}
        editMode={editMode}
        editTitle={editTitle}
        editDesc={editDesc}
        saving={saving}
        showDesc={showDesc}
        projectId={projectId}
        onBack={embedded ? undefined : () => goBack()}
        widthCls={widthCls}
        onStageAction={handleStageAction}
        onCloseIssue={handleCloseIssue}
        onStartEdit={startEdit}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={() => setEditMode(false)}
        onSetEditTitle={setEditTitle}
        onSetEditDesc={setEditDesc}
        onSetShowDesc={setShowDesc}
        onToast={toast}
      />

      <div className={editMode ? 'hidden' : 'contents'}>
      <NotesList
        widthCls={widthCls}
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
        onToggleCheckbox={issue.canEditBody && issue.state !== 'closed' ? handleToggleCheckbox : undefined}
        // 진행막대·마감일·우선순위는 고정 머리가 아니라 내용 스크롤 영역 맨 위 — 함께 스크롤되어 내용 보기 높이가 커진다(폭과 무관)
        headSlot={!editMode ? (
          <div className="pt-2 pb-1 pr-2">
            <IssueProgressSection
              issue={issue}
              canEditAssignees={canEditAssignees}
              isCreator={isCreator}
              gitMembers={gitMembers}
              confirmerMembers={confirmerMembers}
              roleAgents={roleAgents}
              preferredAgent={preferredAgent}
              onOpenAssigneePicker={() => setAssigneePickerOpen(true)}
              onOpenAgentPicker={() => setAgentPickerOpen(true)}
              onPresetVerifierChange={handlePresetVerifierChange}
              onPresetConfirmerChange={handlePresetConfirmerChange}
              onDueDateChange={handleDueDateChange}
              onPriorityChange={issue.canEditPriority ? handlePriorityChange : undefined}
            />
          </div>
        ) : undefined}
        topSlot={
          <IssueAutomationPanel
            projectId={projectId}
            iid={iid}
            stage={issue.state === 'closed' ? 'closed' : issue.stage}
            canEditRoles={canEditAssignees}
            onChanged={() => { void fetchIssue(); void fetchPreferredAgent() }}
          />
        }
      />

      </div>
      <div className={editMode ? 'hidden' : 'contents'}>
      <BottomInputArea
        widthCls={widthCls}
        issue={issue}
        mode={mode}
        canProgressStage={canProgressStage}
        agentWork={issue.agentWork ?? null}
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
        chatImages={chatImages}
        chatAgentName={chatAgentName}
        preferredAgent={preferredAgent}
        projectAgents={projectAgents}
        NEXT_STAGE={NEXT_STAGE}
        onSetMode={setMode}
        onSetComment={setComment}
        onSetChatInput={setChatInput}
        onAddChatImages={addChatImages}
        onRemoveChatImage={removeChatImage}
        onPostComment={handlePostComment}
        onAgentWorkStopped={() => { void fetchIssue() }}
        onCommentAndRetry={handleCommentAndRetry}
        onCommentAndDone={handleCommentAndDone}
        onCommentAndNextStage={handleCommentAndNextStage}
        onCommentAndInflow={handleCommentAndInflow}
        onStartChat={handleStartChat}
        onEndChat={handleEndChat}
        onSendChatMessage={handleSendChatMessage}
        onChangePreferredAgent={handleChangePreferredAgent}
        handOff={handOffKind ? {
          kind: handOffKind,
          target: handOffTarget,
          note: issue.stageWorkerNote ?? null,
          busy: handingOff || stageChanging,
          onCall: () => handleStageHandOff(handOffKind, handOffTarget),
        } : null}
        onToast={toast}

      />
      </div>

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

      <AgentPickerModal
        iid={agentPickerOpen ? issue.iid : null}
        currentMode={(preferredAgent?.assignMode as 'auto' | 'assignee' | 'agent' | undefined) || 'auto'}
        currentAgentId={preferredAgent?.preferredAgentId || null}
        currentAssigneeIds={(issue.assignees || []).map(a => a.id)}
        projectAgents={projectAgents}
        gitMembers={gitMembers}
        saving={agentPickerSaving}
        onSelect={handleAgentPickerSelect}
        onClose={() => setAgentPickerOpen(false)}
      />

      {!embedded && !editMode && <MobileTabBar />}
    </div>
  )
}
