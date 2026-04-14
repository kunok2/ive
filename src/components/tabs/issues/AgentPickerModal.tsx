'use client'

import Modal from '@/components/ui/Modal'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { useTranslations } from 'next-intl'
import { CLI_CONFIG } from './types'
import type { ProjectAgent, IveIssue } from './types'

interface AgentPickerModalProps {
  iid: number | null
  issues: IveIssue[]
  projectAgents: ProjectAgent[]
  saving: boolean
  onSelect: (iid: number, mode: 'auto' | 'assignee' | 'agent', agentId: string | null) => void
  onClose: () => void
}

export default function AgentPickerModal({
  iid,
  issues,
  projectAgents,
  saving,
  onSelect,
  onClose,
}: AgentPickerModalProps) {
  const tIssue = useTranslations('issue')

  const targetIssue = iid !== null ? issues.find(i => i.iid === iid) : null
  const currentMode = targetIssue?.assignMode || 'auto'
  const currentAgentId = targetIssue?.preferredAgentId || null

  return (
    <Modal open={iid !== null} onClose={onClose} title={`#${iid ?? ''} ${tIssue('preferredAgent')}`} size="sm">
      <div className="max-h-[60vh] overflow-y-auto">
        <button
          disabled={saving}
          onClick={() => iid !== null && onSelect(iid, 'auto', null)}
          className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
            currentMode === 'auto' ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-shuffle" /></span>
          <span className="font-bold">{tIssue('noPreference')}</span>
        </button>
        <button
          disabled={saving}
          onClick={() => iid !== null && onSelect(iid, 'assignee', null)}
          className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
            currentMode === 'assignee' ? 'bg-ive-cyan/10 text-ive-cyan' : 'text-ive-text-dim hover:bg-white/5'
          }`}
        >
          <span className="w-4 h-4 inline-flex items-center justify-center shrink-0"><i className="fa-solid fa-user" /></span>
          <span className="font-bold">{tIssue('assigneeHandles')}</span>
        </button>
        {projectAgents.map(pa => {
          const cli = CLI_CONFIG[pa.agent.cliName]
          const isOffline = pa.agent.status === 'offline'
          const isPicked = currentMode === 'agent' && currentAgentId === pa.agentId
          return (
            <button
              key={pa.agentId}
              disabled={saving}
              onClick={() => iid !== null && onSelect(iid, 'agent', pa.agentId)}
              className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors disabled:opacity-40 ${
                isPicked ? 'bg-ive-green/10 text-ive-green' : 'text-ive-text hover:bg-white/5'
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
    </Modal>
  )
}
