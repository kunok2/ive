'use client'

import { PriorityPicker, type Priority } from './Priority'
import { useState, useRef, useEffect, useMemo } from 'react'
import AgentAvatar from '@/components/agent/AgentAvatar'
import CliLogo from '@/components/ui/CliLogo'
import { useTranslations } from 'next-intl'
import { createImagePasteHandlers } from '@/lib/paste-upload'
import { getKSTTodayString } from '@/lib/date-utils'
import { useToast } from '@/components/ui/Toast'
import { CLI_CONFIG } from './types'
import type { ProjectAgent } from './types'
import { isAgentAvailableNow } from '@/types'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

type RoleMode = 'creator' | 'auto' | 'specific' | 'agent'

interface RoleAgent { id: string; name: string; avatar: string; cliName?: string | null }

interface IssueAddFormProps {
  selectedProjectId: string
  newBody: string
  onBodyChange: (value: string) => void
  creating: boolean
  onCreateIssue: (registerOnly?: boolean) => void
  creatingMode?: 'register' | 'process' | null
  onCancel: () => void
  preferredAgentId: string | null
  onPreferredAgentIdChange: (id: string | null) => void
  projectAgents: ProjectAgent[]
  gitMembers: GitMember[]
  // 확인자 후보 — 검증자(프로젝트 멤버)와 달리 provider 로 식별되는 모든 IVE 사용자. 미지정 시 gitMembers fallback.
  confirmerMembers?: GitMember[]
  selectedAssignees: GitMember[]
  autoAssign: boolean
  onOpenAssigneeModal: (iids: number[]) => void
  // 검증자/확인자 사전 배정
  verifierMode: RoleMode
  verifierUserId: string | null
  verifierUsername: string | null
  onVerifierChange: (mode: RoleMode, userId: string | null, username: string | null, agentId?: string | null) => void
  verifierAgentId?: string | null
  confirmerMode: RoleMode
  confirmerUserId: string | null
  confirmerUsername: string | null
  onConfirmerChange: (mode: RoleMode, userId: string | null, username: string | null, agentId?: string | null) => void
  confirmerAgentId?: string | null
  /** 역할 명부의 에이전트 — 검증자·확인자 후보 */
  roleAgents?: { verify: RoleAgent[]; confirm: RoleAgent[] }
  /** 「모든 단계 자동배정」 — 처리·검증·확인을 명부의 에이전트로 한꺼번에 */
  autoAllAgents?: boolean
  onAutoAllAgentsChange?: (v: boolean) => void
  // 마감일 (선택). 'YYYY-MM-DD' 또는 빈 문자열.
  dueDate: string
  onDueDateChange: (v: string) => void
  notify: boolean
  onNotifyChange: (v: boolean) => void
  priority: Priority
  onPriorityChange: (p: Priority) => void
}

interface RoleTriggerProps {
  label: string
  icon: string
  mode: RoleMode
  userId: string | null
  username: string | null
  members: GitMember[]
  agent?: RoleAgent | null
  onClick: () => void
  isOpen?: boolean
}

/**
 * 역할 picker 트리거 버튼 — 클릭하면 폼 본문 내 InlineRolePicker 가 펼쳐진다.
 * 표시: 미배정(생성자) / 자동배정 / 선택한 멤버 아바타+이름
 */
function RoleTrigger({ label, icon, mode, userId, username, members, agent, onClick, isOpen = false }: RoleTriggerProps) {
  const tIssue = useTranslations('issue')
  const member = mode === 'specific' && userId
    ? members.find(m => String(m.id) === userId)
    : null
  return (
    <div className={isOpen ? 'mb-0' : 'mb-2'}>
      <label className="text-xs font-bold text-ive-text-dim mb-1 block">
        <i className={`fa-solid ${icon} mr-1`} />{label}
      </label>
      <button
        type="button"
        onClick={onClick}
        className={`w-full bg-ive-bg-card border border-ive-border-dark px-3 py-2 text-left flex items-center gap-2 text-sm focus:outline-none hover:border-ive-green/50 transition-colors group ${
          isOpen ? 'rounded-t-lg border-b-transparent border-ive-green/50' : 'rounded-lg'
        }`}
      >
        {mode === 'agent' ? (
          <span className="flex items-center gap-1 bg-ive-bg-deep rounded px-1.5 py-0.5">
            <AgentAvatar avatar={agent?.avatar || 'av-01'} size="xs" />
            <span className="text-ive-text font-bold text-xs">{agent?.name || tIssue('roleModeAgent')}</span>
          </span>
        ) : mode === 'auto' ? (
          <span className="flex items-center gap-1 bg-ive-cyan/10 rounded px-1.5 py-0.5">
            <i className="fa-solid fa-shuffle text-xs text-ive-cyan" />
            <span className="text-ive-cyan font-bold text-xs">{tIssue('roleModeAuto')}</span>
          </span>
        ) : mode === 'specific' && member ? (
          <span className="flex items-center gap-1 bg-ive-bg-deep rounded px-1.5 py-0.5">
            {member.avatarUrl
              ? <img src={member.avatarUrl} className="w-4 h-4 rounded-lg" alt="" />
              : <i className="fa-solid fa-user text-xs text-ive-text-dim" />}
            <span className="text-ive-text font-bold text-xs">{member.name || member.username}</span>
          </span>
        ) : mode === 'specific' && username ? (
          <span className="flex items-center gap-1 bg-ive-bg-deep rounded px-1.5 py-0.5">
            <i className="fa-solid fa-user text-xs text-ive-text-dim" />
            <span className="text-ive-text font-bold text-xs">@{username}</span>
          </span>
        ) : (
          <span className="text-ive-text-dim font-bold">
            <i className="fa-solid fa-user-plus mr-1.5" />{tIssue('roleModeCreator')}
          </span>
        )}
        <span className="ml-auto w-6 h-6 flex items-center justify-center rounded text-ive-text-dim group-hover:text-ive-green group-hover:bg-ive-green/10 transition-colors">
          <i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} text-xs`} />
        </span>
      </button>
    </div>
  )
}

interface InlineRolePickerProps {
  mode: RoleMode
  userId: string | null
  agentId?: string | null
  agents?: RoleAgent[]
  gitMembers: GitMember[]
  search: string
  onSearchChange: (v: string) => void
  onPick: (mode: RoleMode, userId: string | null, username: string | null, agentId?: string | null) => void
  noneLabel: string
}

/**
 * 폼 본문 안에 펼쳐지는 인라인 picker — 모달이 아니라 일반 블록 요소.
 * - 페이지의 일반 흐름에 자리잡으므로, 폼이 길어지면 부모 스크롤 컨테이너 가 알아서 처리.
 * - 모바일 키보드가 올라와도 사용자가 스크롤하면 모든 옵션과 검색창에 접근 가능.
 */
function InlineRolePicker({ mode, userId, agentId, agents, gitMembers, search, onSearchChange, onPick, noneLabel }: InlineRolePickerProps) {
  const tIssue = useTranslations('issue')
  const filtered = gitMembers.filter(m => {
    if (!search) return true
    const q = search.toLowerCase()
    return (m.name || '').toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
  })
  const isNoneSelected = mode === 'creator'
  const isAutoSelected = mode === 'auto'
  const pickedId = mode === 'specific' ? userId : null

  return (
    <div className="mb-2 border border-ive-green/50 border-t-0 rounded-b-lg bg-ive-bg-deep/50 overflow-hidden">
      <div className="p-1.5 border-b border-ive-border-dark bg-ive-bg-card">
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={tIssue('searchMember')}
          className="w-full bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim focus:outline-none focus:border-ive-green/50"
        />
      </div>
      {/*
        리스트 자체에 max-h + overflow-y-auto 를 두지 않는다.
        부모(IssueList) 의 스크롤 컨테이너가 폼 전체 길이를 처리하므로, 여기서 따로
        내부 스크롤을 만들면 모바일 터치 시 어느 영역이 스크롤되는지 모호해진다.
      */}
      <div>
        <button
          type="button"
          onClick={() => onPick('creator', null, null)}
          className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
            isNoneSelected ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          {isNoneSelected ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
          <div className="w-7 h-7 rounded-lg bg-ive-bg-deep flex items-center justify-center shrink-0">
            <i className="fa-solid fa-ban text-ive-text-dim text-xs" />
          </div>
          <span className="font-bold">{noneLabel}</span>
        </button>
        <button
          type="button"
          onClick={() => onPick('auto', null, null)}
          className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
            isAutoSelected ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          {isAutoSelected ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
          <div className="w-7 h-7 rounded-lg bg-ive-bg-deep flex items-center justify-center shrink-0">
            <i className="fa-solid fa-shuffle text-ive-cyan text-xs" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-bold">{tIssue('autoAssign')}</div>
            <div className="text-xs text-ive-text-dim truncate">{tIssue('autoAssignDesc')}</div>
          </div>
        </button>
        {(agents || []).filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase())).length > 0 && (
          <>
            <div className="px-4 pt-2.5 pb-1 text-xs font-bold text-ive-text-dim"><i className="fa-solid fa-bolt mr-1" />{tIssue('pickerAgents')}</div>
            {(agents || []).filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase())).map(a => {
              const isPicked = mode === 'agent' && agentId === a.id
              return (
                <button
                  key={`agent-${a.id}`}
                  type="button"
                  onClick={() => onPick('agent', null, null, a.id)}
                  className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
                    isPicked ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                  }`}
                >
                  {isPicked ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
                  <AgentAvatar avatar={a.avatar || 'av-01'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold truncate">{a.name}</div>
                    {a.cliName && <div className="text-xs text-ive-text-dim truncate">{a.cliName}</div>}
                  </div>
                </button>
              )
            })}
            <div className="px-4 pt-2.5 pb-1 text-xs font-bold text-ive-text-dim"><i className="fa-solid fa-user mr-1" />{tIssue('pickerPeople')}</div>
          </>
        )}
        {filtered.map(m => {
          const isPicked = pickedId === String(m.id)
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick('specific', String(m.id), m.username)}
              className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 transition-colors ${
                isPicked ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
              }`}
            >
              {isPicked ? <i className="fa-solid fa-circle-dot text-xs shrink-0 w-4" /> : <i className="fa-regular fa-circle text-xs shrink-0 w-4 opacity-30" />}
              {m.avatarUrl
                ? <img src={m.avatarUrl} className="w-7 h-7 rounded-lg shrink-0" alt="" />
                : <div className="w-7 h-7 rounded-lg bg-ive-bg-deep flex items-center justify-center shrink-0"><i className="fa-solid fa-user text-ive-text-dim text-xs" /></div>}
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate">{m.name || m.username}</div>
                {m.name && m.name !== m.username && <div className="text-xs text-ive-text-dim truncate">@{m.username}</div>}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function IssueAddForm({
  selectedProjectId,
  newBody,
  onBodyChange,
  creating,
  creatingMode,
  onCreateIssue,
  onCancel,
  preferredAgentId,
  onPreferredAgentIdChange,
  projectAgents,
  gitMembers,
  confirmerMembers,
  verifierMode,
  verifierUserId,
  verifierUsername,
  onVerifierChange,
  confirmerMode,
  confirmerUserId,
  confirmerUsername,
  onConfirmerChange,
  verifierAgentId = null,
  confirmerAgentId = null,
  roleAgents,
  autoAllAgents = false,
  onAutoAllAgentsChange,
  dueDate,
  onDueDateChange,
  notify,
  onNotifyChange,
  priority,
  onPriorityChange,
}: IssueAddFormProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')
  const ta = useTranslations('automation')
  const { toast } = useToast()

  const agentDropdownRef = useRef<HTMLDivElement>(null)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const [assigneesExpanded, setAssigneesExpanded] = useState(false)

  // 검증자/확인자 picker — 폼 본문에 인라인으로 펼쳐지는 패널.
  // (이전: fixed-portal 모달 — 모바일에서 키보드가 뜨면 하단 확인 버튼이 가려져 스크롤 불가능했음)
  // 한 번에 하나만 열린다 (verifier ↔ confirmer 토글).
  const [openPicker, setOpenPicker] = useState<null | 'verifier' | 'confirmer'>(null)
  const [verifierSearch, setVerifierSearch] = useState('')
  const [confirmerSearch, setConfirmerSearch] = useState('')
  // 확인자 picker 목록 — IVE 사용자 후보(미지정 시 프로젝트 멤버로 fallback). 검증자는 항상 gitMembers.
  const confirmerList = confirmerMembers ?? gitMembers

  const openVerifierPicker = () => {
    setVerifierSearch('')
    setOpenPicker(prev => prev === 'verifier' ? null : 'verifier')
  }
  const openConfirmerPicker = () => {
    setConfirmerSearch('')
    setOpenPicker(prev => prev === 'confirmer' ? null : 'confirmer')
  }

  // 이미지 복/붙 업로드 핸들러
  const newBodyRef = useRef(newBody)
  useEffect(() => { newBodyRef.current = newBody }, [newBody])
  const pasteHandlers = useMemo(() => createImagePasteHandlers({
    projectId: selectedProjectId,
    getValue: () => newBodyRef.current,
    setValue: v => onBodyChange(v),
    onError: msg => toast(msg, 'error'),
  }), [selectedProjectId, onBodyChange, toast])

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

  return (
    <div className="mb-3 bg-ive-bg-card border border-ive-green/30 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-ive-green">
          <i className="fa-solid fa-plus mr-1" />{tIssue('addNewIssue')}
        </span>
        <button onClick={onCancel} className="text-xs text-ive-text-dim hover:text-ive-text font-bold px-2 py-1 rounded-lg hover:bg-white/5 transition-all">
          {tCommon('cancel')}
        </button>
      </div>
      <p className="text-xs text-ive-text-dim mb-1.5"><i className="fa-solid fa-info-circle mr-1" />{tIssue('firstLineTitle')}{newBody && <span className="ml-2 text-ive-green/60"><i className="fa-solid fa-floppy-disk mr-0.5" />{tIssue('autoSaved')}</span>}</p>
      <div className="flex gap-2 items-end mb-2">
        <textarea
          value={newBody}
          onChange={e => onBodyChange(e.target.value)}
          onPaste={pasteHandlers.onPaste}
          onDrop={pasteHandlers.onDrop}
          onDragOver={pasteHandlers.onDragOver}
          placeholder={`${tIssue('titlePlaceholder')}\n\n${tIssue('bodyPlaceholder')}`}
          rows={4}
          className="flex-1 desk:min-h-60 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-green/50"
          autoFocus
        />
      </div>
      {/* 마감일 (선택) */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <label className="text-xs font-bold text-ive-text-dim shrink-0">
          <i className="fa-solid fa-calendar-days mr-1" />{tIssue('dueDate')}
        </label>
        <input
          type="date"
          value={dueDate}
          onChange={e => onDueDateChange(e.target.value)}
          className="flex-1 min-w-0 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-2 py-1.5 text-xs text-ive-text focus:outline-none focus:border-ive-green/50"
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => onDueDateChange('')}
            className="shrink-0 text-xs font-bold text-ive-text-dim hover:text-ive-red px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
            title={tIssue('clearDueDate')}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDueDateChange(getKSTTodayString(new Date(Date.now() + 86400000)))}
          className="shrink-0 text-xs font-bold bg-ive-green/10 text-ive-green border border-ive-green/30 hover:bg-ive-green/20 px-2 py-1.5 rounded-lg transition-all"
        >
          {tIssue('dueDateTomorrow')}
        </button>
        <button
          type="button"
          onClick={() => onDueDateChange(getKSTTodayString(new Date(Date.now() + 7 * 86400000)))}
          className="shrink-0 text-xs font-bold bg-ive-green/10 text-ive-green border border-ive-green/30 hover:bg-ive-green/20 px-2 py-1.5 rounded-lg transition-all"
        >
          {tIssue('dueDateNextWeek')}
        </button>
      </div>
      {/* 우선순위 (선택) — 에이전트가 대기 작업을 높은 것부터 집는다 */}
      <div className="mb-2"><PriorityPicker value={priority} onChange={onPriorityChange} /></div>
      {/* 완료 알림 (선택) — 켜면 IVE-N 라벨이 부착되어 완료/실패 시 담당자에게 Slack 알림 */}
      <button
        type="button"
        onClick={() => onNotifyChange(!notify)}
        className={`w-full mb-2 px-3 py-2 rounded-lg border flex items-center justify-between gap-2 text-xs font-bold transition-colors ${notify ? 'bg-ive-green/10 border-ive-green/40 text-ive-green' : 'bg-ive-bg-card border-ive-border-dark text-ive-text-dim hover:border-ive-green/50'}`}
      >
        <span>
          <i className={`fa-solid ${notify ? 'fa-bell' : 'fa-bell-slash'} mr-1.5`} />
          {tIssue('notifyOnDone')}
          <span className="ml-1 text-[10px] font-normal text-ive-text-muted">({tIssue('assignmentOptional')})</span>
        </span>
        <i className={`fa-solid ${notify ? 'fa-toggle-on' : 'fa-toggle-off'} text-sm`} />
      </button>
      {/* 담당자 지정 영역 — 접혀있을 때는 dashed placeholder 카드로 "+추가" 패턴 */}
      {!assigneesExpanded ? (
        <button
          type="button"
          onClick={() => setAssigneesExpanded(true)}
          className="w-full mb-2 px-3 py-2.5 rounded-lg border border-dashed border-ive-border-dark text-ive-text-dim hover:border-ive-green/50 hover:text-ive-green hover:bg-ive-green/5 transition-colors flex items-center justify-center gap-1.5 text-xs font-bold"
        >
          <i className="fa-solid fa-plus" />
          {tIssue('assignmentToggleAdd')}
          <span className="text-[10px] font-normal text-ive-text-muted">({tIssue('assignmentOptional')})</span>
        </button>
      ) : (<>
      <button
        type="button"
        onClick={() => setAssigneesExpanded(false)}
        className="w-full flex items-center justify-between gap-2 mb-2 px-2 py-1 text-xs font-bold text-ive-text-dim hover:text-ive-text transition-colors"
      >
        <span><i className="fa-solid fa-users-gear mr-1" />{tIssue('preferredAgent')} · {tIssue('verifier')} · {tIssue('confirmer')}</span>
        <span><i className="fa-solid fa-chevron-up text-[10px] mr-1" />{tIssue('assignmentToggleHide')}</span>
      </button>
      {/* 「모든 단계 자동배정」 — 켜면 처리·검증·확인을 명부의 가장 한가한 에이전트로 한꺼번에 지정 */}
      {onAutoAllAgentsChange && (
        <button
          type="button"
          onClick={() => onAutoAllAgentsChange(!autoAllAgents)}
          className={`w-full mb-2 px-3 py-2 rounded-lg border flex items-center justify-between gap-2 text-xs font-bold transition-colors ${autoAllAgents ? 'bg-ive-green/10 border-ive-green/40 text-ive-green' : 'bg-ive-bg-card border-ive-border-dark text-ive-text-dim hover:border-ive-green/50'}`}
        >
          <span className="text-left"><i className="fa-solid fa-wand-magic-sparkles mr-1.5" />{ta('autoAllInForm')}</span>
          <i className={`fa-solid ${autoAllAgents ? 'fa-toggle-on' : 'fa-toggle-off'} text-sm`} />
        </button>
      )}
      {!autoAllAgents && (<>
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
              <span className={`text-xs inline-flex items-center gap-0.5 ${cli.color}`}><CliLogo cli={pa.agent.cliName} className="w-3 h-3" />{cli.label}</span>
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
              onClick={() => { onPreferredAgentIdChange('none'); setAgentDropdownOpen(false) }}
              className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                preferredAgentId === 'none' ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
              }`}
            >
              <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-ban" /></span>
              <span className="font-bold">{tIssue('noAssignment')}</span>
            </button>
            <button
              onClick={() => { onPreferredAgentIdChange(null); setAgentDropdownOpen(false) }}
              className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                preferredAgentId === null ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
              }`}
            >
              <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-shuffle" /></span>
              <span className="font-bold">{tIssue('noPreference')}</span>
            </button>
            <button
              onClick={() => { onPreferredAgentIdChange('assignee'); setAgentDropdownOpen(false) }}
              className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                preferredAgentId === 'assignee' ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text-dim hover:bg-white/5'
              }`}
            >
              <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-user" /></span>
              <span className="font-bold">{tIssue('assigneeHandles')}</span>
            </button>
            {projectAgents.map(pa => {
              const cli = CLI_CONFIG[pa.agent.cliName]
              const isDisabled = !isAgentAvailableNow(pa.agent)
              const isOffline = pa.agent.status === 'offline'
              return (
                <button
                  key={pa.agentId}
                  onClick={() => { onPreferredAgentIdChange(pa.agentId); setAgentDropdownOpen(false) }}
                  className={`w-full px-3 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${
                    preferredAgentId === pa.agentId ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                  }`}
                >
                  <AgentAvatar avatar={pa.agent.avatar} size="xs" />
                  <span className="font-bold">{pa.agent.name}</span>
                  <span className={`text-xs inline-flex items-center gap-0.5 ${cli.color}`}><CliLogo cli={pa.agent.cliName} className="w-3 h-3" />{cli.label}</span>
                  {isDisabled ? (
                    <span className="text-xs text-ive-amber ml-auto inline-flex items-center gap-0.5"><i className="fa-solid fa-power-off mr-0.5" />{tIssue('agentDisabled')}</span>
                  ) : isOffline ? (
                    <span className="text-xs text-ive-red ml-auto"><i className="fa-solid fa-circle-exclamation mr-0.5" />{tIssue('agentOfflineWarning')}</span>
                  ) : pa.agent.status === 'busy' ? (
                    <span className="ml-auto w-2 h-2 rounded-full bg-ive-cyan animate-pulse" />
                  ) : pa.agent.status === 'available' ? (
                    <span className="ml-auto w-2 h-2 rounded-full bg-ive-green" />
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {/* 검증자 / 확인자 사전 배정 — 인라인 패널 (폼 본문에 펼쳐짐) */}
      <RoleTrigger
        label={tIssue('verifier')}
        icon="fa-magnifying-glass"
        mode={verifierMode}
        userId={verifierUserId}
        username={verifierUsername}
        members={gitMembers}
        agent={roleAgents?.verify.find(a => a.id === verifierAgentId) ?? null}
        onClick={openVerifierPicker}
        isOpen={openPicker === 'verifier'}
      />
      {openPicker === 'verifier' && (
        <InlineRolePicker
          mode={verifierMode}
          userId={verifierUserId}
          agentId={verifierAgentId}
          agents={roleAgents?.verify}
          gitMembers={gitMembers}
          search={verifierSearch}
          onSearchChange={setVerifierSearch}
          onPick={(mode, userId, username, agentId) => {
            onVerifierChange(mode, userId, username, agentId)
            setOpenPicker(null)
          }}
          noneLabel={tIssue('roleModeCreator')}
        />
      )}
      <RoleTrigger
        label={tIssue('confirmer')}
        icon="fa-clipboard-check"
        mode={confirmerMode}
        userId={confirmerUserId}
        username={confirmerUsername}
        members={confirmerList}
        agent={roleAgents?.confirm.find(a => a.id === confirmerAgentId) ?? null}
        onClick={openConfirmerPicker}
        isOpen={openPicker === 'confirmer'}
      />
      {openPicker === 'confirmer' && (
        <InlineRolePicker
          mode={confirmerMode}
          userId={confirmerUserId}
          agentId={confirmerAgentId}
          agents={roleAgents?.confirm}
          gitMembers={confirmerList}
          search={confirmerSearch}
          onSearchChange={setConfirmerSearch}
          onPick={(mode, userId, username, agentId) => {
            onConfirmerChange(mode, userId, username, agentId)
            setOpenPicker(null)
          }}
          noneLabel={tIssue('roleModeCreator')}
        />
      )}
      </>)}
      </>)}

      <div className="flex gap-2">
        <button
          onClick={() => onCreateIssue(true)}
          disabled={creating || !newBody.split('\n')[0].trim()}
          className="flex-1 py-2 rounded-lg border border-ive-green/50 text-ive-green bg-ive-green/10 hover:bg-ive-green/15 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
        >
          {creating && creatingMode === 'register'
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tCommon('creating')}</>
            : <><i className="fa-solid fa-floppy-disk mr-1" />{tIssue('createIssueRegisterOnly')}</>}
        </button>
        <button
          onClick={() => onCreateIssue(false)}
          disabled={creating || !newBody.split('\n')[0].trim()}
          className="flex-1 py-2 rounded-lg bg-ive-green text-ive-bg-deep text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
        >
          {creating && creatingMode === 'process'
            ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tCommon('creating')}</>
            : <><i className="fa-solid fa-paper-plane mr-1" />{tIssue('createIssue')}</>}
        </button>
      </div>

    </div>
  )
}
