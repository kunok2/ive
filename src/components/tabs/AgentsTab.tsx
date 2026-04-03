'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'
import AgentCard from '@/components/agent/AgentCard'
import ConfirmModal from '@/components/ui/ConfirmModal'
import PullToRefresh from '@/components/ui/PullToRefresh'
import { useTranslations } from 'next-intl'

export default function AgentsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, deleteAgent, refreshAgents } = useStore()
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)
  const t = useTranslations('agent')
  const tCommon = useTranslations('common')

  function getAssignedProjects(agentId: string): { id: string; name: string; color: string; provider: string }[] {
    const result: { id: string; name: string; color: string; provider: string }[] = []
    for (const project of state.projects) {
      if (project.assignedAgents?.some(pa => pa.agentId === agentId)) {
        result.push({ id: project.id, name: project.name, color: project.color, provider: project.provider })
      }
    }
    return result
  }

  return (
    <PullToRefresh onRefresh={refreshAgents} className="min-h-screen pb-20">
      <main className="px-4 py-4 max-w-lg mx-auto">
        {state.loading ? (
          <div className="text-center py-20 text-ive-text-muted text-base">
            <i className="fa-solid fa-circle-notch fa-spin text-2xl text-ive-green mb-3 block" />
            {t('loadingAgents')}
          </div>
        ) : state.agents.length === 0 ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-robot text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-2">{t('noAgents')}</p>
            <p className="text-sm text-ive-text-dim mb-5">{t('noAgentsHint')}</p>
            {onAdd && (
              <button
                onClick={onAdd}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-lg active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-plus" />{t('addDeveloper')}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {state.agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onDelete={(id) => setDeleteAgentId(id)}
                assignedProjects={getAssignedProjects(agent.id)}
              />
            ))}
          </div>
        )}
      </main>

      <ConfirmModal
        open={deleteAgentId !== null}
        onClose={() => setDeleteAgentId(null)}
        onConfirm={async () => {
          if (deleteAgentId) {
            await deleteAgent(deleteAgentId)
            setDeleteAgentId(null)
          }
        }}
        title={t('deleteAgent')}
        message={t('deleteAgentConfirm')}
        confirmLabel={tCommon('delete')}
        danger
      />
    </PullToRefresh>
  )
}
