'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { isAgentAvailableNow } from '@/types'

interface PreferredAgent {
  assignMode?: string
  preferredAgentId: string | null
  preferredAgentName: string | null
  preferredAgentAvatar: string | null
  preferredAgentCliName: string | null
}

interface ProjectAgent {
  agentId: string
  agent: { id: string; name: string; avatar: string; cliName: string; status: string; enabled?: boolean; pausedUntil?: string | null }
}

interface Person { id: number; username: string; name: string; avatarUrl: string }

interface AgentPickerDropdownProps {
  /** 프로젝트 Git 멤버 — 처리자로 지정할 수 있는 사람 */
  gitMembers?: Person[]
  /** 지금 이슈의 Git 담당자 — 사람 처리일 때 트리거에 이름을 보인다 */
  assignees?: Person[]
  onPickPerson?: (person: Person) => void
  preferredAgent: PreferredAgent | null
  projectAgents: ProjectAgent[]
  onChangePreferredAgent: (agentIdOrMode: string | null) => void
}

export default function AgentPickerDropdown({
  preferredAgent, projectAgents, onChangePreferredAgent, gitMembers = [], assignees = [], onPickPerson,
}: AgentPickerDropdownProps) {
  const tIssue = useTranslations('issue')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isPerson = preferredAgent?.assignMode === 'assignee'
  const currentPerson = isPerson ? assignees[0] ?? null : null
  // 이슈 담당자 객체에는 아바타가 없을 수 있다 — 프로젝트 멤버 목록에서 같은 사람을 찾아 쓴다
  const currentPersonAvatar = currentPerson
    ? (currentPerson.avatarUrl || (currentPerson as { avatar_url?: string }).avatar_url
      || gitMembers.find(m => m.id === currentPerson.id || m.username === currentPerson.username)?.avatarUrl || '')
    : ''

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative flex items-center ml-auto min-w-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="min-w-0 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-dashed border-ive-border-subtle hover:border-ive-green/30 transition-all"
      >
        <i className="fa-solid fa-user-gear text-ive-green" />
        {preferredAgent?.assignMode === 'assignee' ? (
          <>
            {currentPersonAvatar
              ? <img src={currentPersonAvatar} className="w-4 h-4 rounded-lg shrink-0 object-cover" alt="" />
              : <i className="fa-solid fa-user text-ive-cyan" />}
            <span className="truncate font-bold text-ive-cyan">{currentPerson ? (currentPerson.name || currentPerson.username) : tIssue('assigneeHandles')}</span>
          </>
        ) : preferredAgent?.preferredAgentId ? (
          <>
            <AgentAvatar avatar={preferredAgent.preferredAgentAvatar || ''} size="xs" />
            <span className="truncate font-bold text-ive-text">{preferredAgent.preferredAgentName}</span>
          </>
        ) : (
          <span className="truncate text-ive-text-muted font-bold">{tIssue('noPreference')}</span>
        )}
        <i className="fa-solid fa-chevron-down text-[10px] text-ive-text-dim ml-0.5" />
      </button>
      {open && (
        <div className="absolute z-50 bottom-full right-0 mb-1 bg-ive-bg-deep border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg shadow-black/30 min-w-[200px] max-h-72 overflow-y-auto">
          <button
            onClick={() => { setOpen(false); onChangePreferredAgent(null) }}
            className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${
              preferredAgent?.assignMode !== 'assignee' && !preferredAgent?.preferredAgentId ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
            }`}
          >
            <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-shuffle" /></span>
            <span className="font-bold">{tIssue('noPreference')}</span>
          </button>
          <button
            onClick={() => { setOpen(false); onChangePreferredAgent('assignee') }}
            className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${
              isPerson && !currentPerson ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text hover:bg-white/5'
            }`}
          >
            <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-user" /></span>
            <span className="font-bold">{tIssue('assigneeHandles')}</span>
          </button>
          {projectAgents.map(pa => {
            const isDisabled = !isAgentAvailableNow(pa.agent)
            const isOffline = pa.agent.status === 'offline'
            return (
              <button
                key={pa.agentId}
                onClick={() => { setOpen(false); onChangePreferredAgent(pa.agentId) }}
                className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${
                  preferredAgent?.preferredAgentId === pa.agentId ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
                }`}
              >
                <AgentAvatar avatar={pa.agent.avatar} size="xs" />
                <span className="font-bold">{pa.agent.name}</span>
                {isDisabled ? (
                  <span className="ml-auto text-[10px] font-bold text-ive-amber inline-flex items-center gap-0.5"><i className="fa-solid fa-power-off" />{tIssue('agentDisabled')}</span>
                ) : isOffline ? (
                  <span className="text-ive-red ml-auto"><i className="fa-solid fa-circle-exclamation" /></span>
                ) : pa.agent.status === 'busy' ? (
                  <span className="ml-auto w-2 h-2 rounded-full bg-ive-cyan animate-pulse" />
                ) : pa.agent.status === 'available' ? (
                  <span className="ml-auto w-2 h-2 rounded-full bg-ive-green" />
                ) : null}
              </button>
            )
          })}
          {onPickPerson && gitMembers.length > 0 && (
            <div className="px-3 pt-2.5 pb-1 text-xs font-bold text-ive-text-dim border-t border-ive-border-subtle"><i className="fa-solid fa-user mr-1" />{tIssue('pickerPeople')}</div>
          )}
          {onPickPerson && gitMembers.map(m => (
            <button
              key={`person-${m.id}`}
              onClick={() => { setOpen(false); onPickPerson(m) }}
              className={`w-full px-3 py-2.5 text-left text-xs flex items-center gap-2 transition-colors ${
                currentPerson?.id === m.id ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text hover:bg-white/5'
              }`}
            >
              {m.avatarUrl
                ? <img src={m.avatarUrl} className="w-4 h-4 rounded-lg shrink-0" alt="" />
                : <span className="w-4 h-4 inline-flex items-center justify-center shrink-0 text-ive-text-dim"><i className="fa-solid fa-user" /></span>}
              <span className="font-bold truncate">{m.name || m.username}</span>
              {m.name && m.name !== m.username && <span className="text-ive-text-dim truncate">@{m.username}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
