'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'
import AgentCard from '@/components/agent/AgentCard'
import ConfirmModal from '@/components/ui/ConfirmModal'
import PullToRefresh from '@/components/ui/PullToRefresh'

export default function AgentsTab({ onAdd }: { onAdd?: () => void }) {
  const { state, deleteAgent, refreshAgents } = useStore()
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)

  function getAssignedProject(agentId: string): string | null {
    for (const project of state.projects) {
      if (project.assignedAgents?.some(pa => pa.agentId === agentId)) {
        return project.name
      }
    }
    return null
  }

  return (
    <PullToRefresh onRefresh={refreshAgents} className="min-h-screen pb-20">
      <main className="px-4 py-4 max-w-lg mx-auto">
        {state.agents.length === 0 ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-robot text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-base text-ive-text-muted mb-2">아직 등록된 개발자가 없습니다</p>
            <p className="text-sm text-ive-text-dim mb-5">Claude, Gemini, Codex 등 AI CLI를 개발자로 등록하세요</p>
            {onAdd && (
              <button
                onClick={onAdd}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-ive-green text-ive-bg-deep font-bold text-sm rounded-xl active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-plus" />개발자 추가
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
                assignedProject={getAssignedProject(agent.id)}
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
        title="개발자 삭제"
        message="이 개발자를 삭제하면 배정된 프로젝트에서도 해제됩니다. 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
      />
    </PullToRefresh>
  )
}
