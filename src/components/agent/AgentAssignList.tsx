'use client'

import { Agent } from '@/types'
import { cliConfig, statusConfig } from './AgentCard'

interface Props {
  agents: Agent[]
  assignedAgentIds: string[]
  onAssign: (agentId: string) => void
  onUnassign: (agentId: string) => void
  maxAgents: number
  currentCount: number
}

export default function AgentAssignList({ agents, assignedAgentIds, onAssign, onUnassign, maxAgents, currentCount }: Props) {
  // 에이전트별 슬롯 수 집계
  const slotCounts = new Map<string, number>()
  for (const id of assignedAgentIds) {
    slotCounts.set(id, (slotCounts.get(id) || 0) + 1)
  }

  const assignedAgents = agents.filter(a => (slotCounts.get(a.id) || 0) > 0)
  const availableAgents = agents.filter(a => (slotCounts.get(a.id) || 0) === 0)
  const isFull = currentCount >= maxAgents

  return (
    <div className="flex flex-col gap-4">
      {/* 현재 배정된 Agent */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-base font-semibold text-ive-text-muted">
            <i className="fa-solid fa-plug mr-1" />배정된 Agent
          </label>
          <span className="text-sm text-ive-text-dim">
            {currentCount} / {maxAgents}
          </span>
        </div>

        {assignedAgents.length === 0 ? (
          <div className="text-center py-6 bg-ive-bg-card rounded-xl border border-dashed border-ive-border">
            <i className="fa-solid fa-plug text-3xl text-ive-text-dim mb-2 block" />
            <p className="text-base text-ive-text-muted">배정된 Agent가 없습니다</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {assignedAgents.map(agent => {
              const cli = cliConfig[agent.cliName]
              const status = statusConfig[agent.status]
              const slots = slotCounts.get(agent.id) || 0
              return (
                <div key={agent.id} className="flex items-center gap-3 bg-ive-green/5 rounded-lg p-3 border border-ive-green/20">
                  <div className="w-8 h-8 rounded-lg bg-ive-bg flex items-center justify-center shrink-0">
                    <i className={`${cli.icon} ${cli.color} text-base`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-bold text-ive-green-pale truncate">{agent.name}</div>
                    <div className="text-sm text-ive-text-muted truncate">{cli.label}</div>
                  </div>
                  <div className="flex items-center gap-1.5 mr-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                  </div>
                  {/* 슬롯 수 표시 및 +/- 컨트롤 */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onUnassign(agent.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-ive-red/20 text-ive-red/60 active:bg-ive-red/10 transition-colors text-base font-bold"
                    >
                      <i className="fa-solid fa-minus" />
                    </button>
                    <span className="w-8 text-center text-base font-black text-ive-green">{slots}개</span>
                    <button
                      onClick={() => onAssign(agent.id)}
                      disabled={isFull}
                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-ive-green/30 text-ive-green active:bg-ive-green/10 transition-colors text-base font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <i className="fa-solid fa-plus" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 배정 가능한 Agent */}
      <div>
        <label className="block text-base font-semibold text-ive-text-muted mb-2">
          <i className="fa-solid fa-robot mr-1" />배정 가능한 Agent
        </label>

        {availableAgents.length === 0 ? (
          <div className="text-center py-6 bg-ive-bg-card rounded-xl border border-dashed border-ive-border">
            <i className="fa-solid fa-robot text-3xl text-ive-text-dim mb-2 block" />
            <p className="text-base text-ive-text-muted">
              {agents.length === 0 ? '등록된 Agent가 없습니다' : '모든 Agent가 이미 배정되었습니다'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {availableAgents.map(agent => {
              const cli = cliConfig[agent.cliName]
              const status = statusConfig[agent.status]
              return (
                <div key={agent.id} className="flex items-center gap-3 bg-ive-bg-card rounded-lg p-3 border border-ive-border-subtle">
                  <div className="w-8 h-8 rounded-lg bg-ive-bg flex items-center justify-center shrink-0">
                    <i className={`${cli.icon} ${cli.color} text-base`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-bold text-ive-green-pale truncate">{agent.name}</div>
                    <div className="text-sm text-ive-text-muted truncate">{cli.label}</div>
                  </div>
                  <div className="flex items-center gap-1.5 mr-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                  </div>
                  <button
                    onClick={() => onAssign(agent.id)}
                    disabled={isFull}
                    className="text-sm font-bold text-ive-green px-4 py-1.5 rounded-lg border border-ive-green/30 active:bg-ive-green/10 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <i className="fa-solid fa-plus mr-0.5" />배정
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {isFull && availableAgents.length > 0 && (
          <p className="text-sm text-ive-amber mt-2">
            <i className="fa-solid fa-triangle-exclamation mr-1" />
            최대 Agent 수({maxAgents}개)에 도달했습니다
          </p>
        )}
      </div>
    </div>
  )
}
