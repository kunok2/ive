'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import AgentCard from '@/components/agent/AgentCard'
import AgentForm from '@/components/agent/AgentForm'
import MobileTabBar from '@/components/layout/MobileTabBar'
import Modal from '@/components/ui/Modal'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { ProjectRole } from '@/types'

export default function AgentsPage() {
  const router = useRouter()
  const { state, deleteAgent } = useStore()
  const [showNewAgent, setShowNewAgent] = useState(false)
  const [deleteAgentId, setDeleteAgentId] = useState<string | null>(null)

  useEffect(() => {
    if (state.authChecked && !state.user) {
      router.push('/login')
    }
  }, [state.authChecked, state.user, router])

  if (!state.authChecked || !state.user) {
    return <div className="min-h-screen flex items-center justify-center text-ive-text-muted text-sm">불러오는 중...</div>
  }

  // 각 Agent의 배정 수 계산
  function getAssignedCount(agentId: string): number {
    let count = 0
    for (const project of state.projects) {
      const roles = (project as any).roles || []
      for (const role of roles) {
        if (role.assignedAgents?.some((ra: any) => ra.agentId === agentId)) {
          count++
        }
      }
    }
    return count
  }

  return (
    <div className="min-h-screen pb-20">
      <header className="sticky top-0 z-40 bg-ive-bg-deep/95 backdrop-blur-sm border-b border-ive-border-dark">
        <div className="flex items-center justify-between px-4 py-3 max-w-lg mx-auto">
          <div>
            <h1 className="text-lg font-extrabold text-ive-green">
              <i className="fa-solid fa-robot mr-1.5" />AI Agent
            </h1>
            <p className="text-[10px] text-ive-text-muted">등록된 AI 개발자를 관리합니다</p>
          </div>
          <button
            onClick={() => setShowNewAgent(true)}
            className="w-9 h-9 rounded-full bg-ive-green flex items-center justify-center text-ive-bg-deep active:scale-95 transition-transform"
          >
            <i className="fa-solid fa-plus text-sm" />
          </button>
        </div>
      </header>

      <main className="px-4 py-4 max-w-lg mx-auto">
        {state.agents.length === 0 ? (
          <div className="text-center py-20">
            <i className="fa-solid fa-robot text-4xl text-ive-text-dim mb-4 block" />
            <p className="text-sm text-ive-text-muted mb-4">아직 등록된 Agent가 없습니다</p>
            <button
              onClick={() => setShowNewAgent(true)}
              className="inline-block bg-ive-green-dark text-white font-bold px-6 py-2.5 rounded-lg text-sm"
            >
              <i className="fa-solid fa-plus mr-1.5" />첫 Agent 추가하기
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {state.agents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onDelete={(id) => setDeleteAgentId(id)}
                assignedCount={getAssignedCount(agent.id)}
              />
            ))}
          </div>
        )}
      </main>

      <Modal open={showNewAgent} onClose={() => setShowNewAgent(false)} title="Agent 추가">
        <AgentForm onSuccess={() => setShowNewAgent(false)} />
      </Modal>

      <ConfirmModal
        open={deleteAgentId !== null}
        onClose={() => setDeleteAgentId(null)}
        onConfirm={async () => {
          if (deleteAgentId) {
            await deleteAgent(deleteAgentId)
            setDeleteAgentId(null)
          }
        }}
        title="Agent 삭제"
        message="이 Agent를 삭제하면 배정된 역할에서도 해제됩니다. 삭제하시겠습니까?"
        confirmLabel="삭제"
        danger
      />

      <MobileTabBar />
    </div>
  )
}
