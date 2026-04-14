'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { useTranslations } from 'next-intl'
import { createImagePasteHandlers } from '@/lib/paste-upload'
import { useToast } from '@/components/ui/Toast'
import type { CliName } from '@/types'
import { CLI_CONFIG } from './types'
import type { ProjectAgent } from './types'

interface GitMember {
  id: number
  username: string
  name: string
  avatarUrl: string
}

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
  onOpenAssigneeModal: (iids: number[]) => void
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
  onOpenAssigneeModal,
}: IssueAddFormProps) {
  const tIssue = useTranslations('issue')
  const tCommon = useTranslations('common')
  const { toast } = useToast()

  const agentDropdownRef = useRef<HTMLDivElement>(null)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)

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
      {/* 담당자 */}
      {gitMembers.length > 0 && (
        <div className="mb-2">
          <label className="text-xs font-bold text-ive-text-dim mb-1 block">
            <i className="fa-solid fa-user-tag mr-1" />{tIssue('assignee')}
          </label>
          <button
            type="button"
            onClick={() => onOpenAssigneeModal([-1])}
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
      {/* 담당자가 처리 모드인데 담당자 미지정 시 안내 */}
      {preferredAgentId === 'assignee' && selectedAssignees.length === 0 && (
        <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-ive-amber/10 border border-ive-amber/20 text-xs text-ive-amber">
          <i className="fa-solid fa-triangle-exclamation mr-1" />
          {tIssue('assigneeRequiredWarning')}
        </div>
      )}
      <button
        onClick={onCreateIssue}
        disabled={creating || !newBody.split('\n')[0].trim()}
        className="w-full py-2 rounded-lg bg-ive-green text-ive-bg-deep text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40"
      >
        {creating ? <><i className="fa-solid fa-circle-notch fa-spin mr-1" />{tCommon('creating')}</> : <><i className="fa-solid fa-paper-plane mr-1" />{tIssue('createIssue')}</>}
      </button>
    </div>
  )
}
