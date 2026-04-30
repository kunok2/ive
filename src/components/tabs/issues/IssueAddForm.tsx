'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { useTranslations } from 'next-intl'
import { createImagePasteHandlers } from '@/lib/paste-upload'
import { useToast } from '@/components/ui/Toast'
import type { CliName } from '@/types'
import { CLI_CONFIG } from './types'
import type { ProjectAgent } from './types'
import AssigneePickerModal from './AssigneePickerModal'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

type RoleMode = 'creator' | 'auto' | 'specific'

interface IssueAddFormProps {
  selectedProjectId: string
  newBody: string
  onBodyChange: (value: string) => void
  creating: boolean
  onCreateIssue: () => void
  onCancel: () => void
  preferredAgentId: string | null
  onPreferredAgentIdChange: (id: string | null) => void
  projectAgents: ProjectAgent[]
  gitMembers: GitMember[]
  selectedAssignees: GitMember[]
  autoAssign: boolean
  onOpenAssigneeModal: (iids: number[]) => void
  // 검증자/확인자 사전 배정
  verifierMode: RoleMode
  verifierUserId: string | null
  verifierUsername: string | null
  onVerifierChange: (mode: RoleMode, userId: string | null, username: string | null) => void
  confirmerMode: RoleMode
  confirmerUserId: string | null
  confirmerUsername: string | null
  onConfirmerChange: (mode: RoleMode, userId: string | null, username: string | null) => void
}

interface RoleTriggerProps {
  label: string
  icon: string
  mode: RoleMode
  userId: string | null
  username: string | null
  members: GitMember[]
  onClick: () => void
}

/**
 * 역할 picker 트리거 버튼 — 클릭하면 AssigneePickerModal 이 뜬다.
 * 표시: 미배정(생성자) / 자동배정 / 선택한 멤버 아바타+이름
 */
function RoleTrigger({ label, icon, mode, userId, username, members, onClick }: RoleTriggerProps) {
  const tIssue = useTranslations('issue')
  const member = mode === 'specific' && userId
    ? members.find(m => String(m.id) === userId)
    : null
  return (
    <div className="mb-2">
      <label className="text-xs font-bold text-ive-text-dim mb-1 block">
        <i className={`fa-solid ${icon} mr-1`} />{label}
      </label>
      <button
        type="button"
        onClick={onClick}
        className="w-full bg-ive-bg-deep border border-ive-border-dark border-dashed rounded-lg px-3 py-2 text-left flex items-center gap-2 text-sm focus:outline-none hover:border-ive-green/50 transition-colors"
      >
        {mode === 'auto' ? (
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 bg-ive-cyan/10 rounded px-1.5 py-0.5">
              <i className="fa-solid fa-shuffle text-xs text-ive-cyan" />
              <span className="text-ive-cyan font-bold text-xs">{tIssue('roleModeAuto')}</span>
            </span>
            <i className="fa-solid fa-pen text-[10px] text-ive-text-dim ml-auto" />
          </span>
        ) : mode === 'specific' && member ? (
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 bg-ive-bg-card rounded px-1.5 py-0.5">
              {member.avatarUrl
                ? <img src={member.avatarUrl} className="w-4 h-4 rounded-full" alt="" />
                : <i className="fa-solid fa-user text-xs text-ive-text-dim" />}
              <span className="text-ive-text font-bold text-xs">{member.name || member.username}</span>
            </span>
            <i className="fa-solid fa-pen text-[10px] text-ive-text-dim ml-auto" />
          </span>
        ) : mode === 'specific' && username ? (
          // members 가 아직 로드 안 됐을 때 fallback
          <span className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 bg-ive-bg-card rounded px-1.5 py-0.5">
              <i className="fa-solid fa-user text-xs text-ive-text-dim" />
              <span className="text-ive-text font-bold text-xs">@{username}</span>
            </span>
            <i className="fa-solid fa-pen text-[10px] text-ive-text-dim ml-auto" />
          </span>
        ) : (
          <span className="text-ive-text-dim font-bold">
            <i className="fa-solid fa-user-plus mr-1.5" />{tIssue('roleModeCreator')}
          </span>
        )}
      </button>
    </div>
  )
}

export default function IssueAddForm({
  selectedProjectId,
  newBody,
  onBodyChange,
  creating,
  onCreateIssue,
  onCancel,
  preferredAgentId,
  onPreferredAgentIdChange,
  projectAgents,
  gitMembers,
  selectedAssignees,
  autoAssign,
  onOpenAssigneeModal,
  verifierMode,
  verifierUserId,
  verifierUsername,
  onVerifierChange,
  confirmerMode,
  confirmerUserId,
  confirmerUsername,
  onConfirmerChange,
}: IssueAddFormProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')
  const { toast } = useToast()

  const agentDropdownRef = useRef<HTMLDivElement>(null)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)

  // 검증자/확인자 모달 (프로젝트 멤버가 많을 수 있어 콤보 대신 풀화면 모달 사용)
  const [verifierModalOpen, setVerifierModalOpen] = useState(false)
  const [verifierSearch, setVerifierSearch] = useState('')
  const [verifierPick, setVerifierPick] = useState<GitMember | null>(null)
  const [verifierAuto, setVerifierAuto] = useState(false)
  const [confirmerModalOpen, setConfirmerModalOpen] = useState(false)
  const [confirmerSearch, setConfirmerSearch] = useState('')
  const [confirmerPick, setConfirmerPick] = useState<GitMember | null>(null)
  const [confirmerAuto, setConfirmerAuto] = useState(false)

  // 부모 상태 → 모달 상태 동기화 (열 때 현재 값 미리 선택)
  const openVerifierModal = () => {
    setVerifierAuto(verifierMode === 'auto')
    setVerifierPick(verifierMode === 'specific' && verifierUserId
      ? gitMembers.find(m => String(m.id) === verifierUserId) || null
      : null)
    setVerifierSearch('')
    setVerifierModalOpen(true)
  }
  const openConfirmerModal = () => {
    setConfirmerAuto(confirmerMode === 'auto')
    setConfirmerPick(confirmerMode === 'specific' && confirmerUserId
      ? gitMembers.find(m => String(m.id) === confirmerUserId) || null
      : null)
    setConfirmerSearch('')
    setConfirmerModalOpen(true)
  }
  const confirmVerifier = () => {
    if (verifierAuto) onVerifierChange('auto', null, null)
    else if (verifierPick) onVerifierChange('specific', String(verifierPick.id), verifierPick.username)
    else onVerifierChange('creator', null, null)
    setVerifierModalOpen(false)
  }
  const confirmConfirmer = () => {
    if (confirmerAuto) onConfirmerChange('auto', null, null)
    else if (confirmerPick) onConfirmerChange('specific', String(confirmerPick.id), confirmerPick.username)
    else onConfirmerChange('creator', null, null)
    setConfirmerModalOpen(false)
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
          className="flex-1 bg-ive-bg-deep border border-ive-border-dark rounded-lg px-3 py-2 text-sm text-ive-text placeholder-ive-text-dim resize-none focus:outline-none focus:border-ive-green/50"
          autoFocus
        />
      </div>
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
      {/* 검증자 / 확인자 사전 배정 — 모달 트리거 */}
      <RoleTrigger
        label={tIssue('verifier')}
        icon="fa-magnifying-glass"
        mode={verifierMode}
        userId={verifierUserId}
        username={verifierUsername}
        members={gitMembers}
        onClick={openVerifierModal}
      />
      <RoleTrigger
        label={tIssue('confirmer')}
        icon="fa-clipboard-check"
        mode={confirmerMode}
        userId={confirmerUserId}
        username={confirmerUsername}
        members={gitMembers}
        onClick={openConfirmerModal}
      />

      <button
        onClick={onCreateIssue}
        disabled={creating || !newBody.split('\n')[0].trim()}
        className="w-full py-2 rounded-lg bg-ive-green text-ive-bg-deep text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
      >
        {creating ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tCommon('creating')}</> : <><i className="fa-solid fa-paper-plane mr-1" />{tIssue('createIssue')}</>}
      </button>

      {/* 검증자 picker 모달 */}
      <AssigneePickerModal
        open={verifierModalOpen}
        onClose={() => setVerifierModalOpen(false)}
        iids={[-1]}
        gitMembers={gitMembers}
        search={verifierSearch}
        onSearchChange={setVerifierSearch}
        pick={verifierPick}
        onPickChange={setVerifierPick}
        autoMode={verifierAuto}
        onAutoModeChange={setVerifierAuto}
        onConfirm={confirmVerifier}
        title={tIssue('verifier')}
        noneLabel={tIssue('roleModeCreator')}
      />

      {/* 확인자 picker 모달 */}
      <AssigneePickerModal
        open={confirmerModalOpen}
        onClose={() => setConfirmerModalOpen(false)}
        iids={[-1]}
        gitMembers={gitMembers}
        search={confirmerSearch}
        onSearchChange={setConfirmerSearch}
        pick={confirmerPick}
        onPickChange={setConfirmerPick}
        autoMode={confirmerAuto}
        onAutoModeChange={setConfirmerAuto}
        onConfirm={confirmConfirmer}
        title={tIssue('confirmer')}
        noneLabel={tIssue('roleModeCreator')}
      />
    </div>
  )
}
