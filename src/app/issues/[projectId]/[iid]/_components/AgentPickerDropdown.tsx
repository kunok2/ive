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

interface AgentPickerDropdownProps {
  preferredAgent: PreferredAgent | null
  projectAgents: ProjectAgent[]
  onChangePreferredAgent: (agentIdOrMode: string | null) => void
}

export default function AgentPickerDropdown({
  preferredAgent, projectAgents, onChangePreferredAgent,
}: AgentPickerDropdownProps) {
  const tIssue = useTranslations('issue')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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
          <span className="truncate font-bold text-ive-cyan"><i className="fa-solid fa-user mr-0.5" />{tIssue('assigneeHandles')}</span>
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
        <div className="absolute z-50 bottom-full right-0 mb-1 bg-ive-bg-deep border border-ive-border-subtle rounded-lg overflow-hidden shadow-lg shadow-black/30 min-w-[200px]">
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
              preferredAgent?.assignMode === 'assignee' ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text hover:bg-white/5'
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
        </div>
      )}
    </div>
  )
}
