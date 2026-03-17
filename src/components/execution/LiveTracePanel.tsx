'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TaskExecution, Agent } from '@/types'
import LogViewer from '@/components/ui/LogViewer'
import AgentAvatar from '@/components/agent/AgentAvatar'

function formatDuration(startedAt: string): string {
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

interface AgentTab {
  agent: Agent
  execution: TaskExecution | null
}

interface Props {
  agents: AgentTab[]
  onKill?: (id: string) => void
}

export default function LiveTracePanel({ agents, onKill }: Props) {
  const router = useRouter()
  const [activeIdx, setActiveIdx] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const runningAgents = agents.filter(a => a.execution?.status === 'running')

  if (runningAgents.length === 0) {
    return (
      <div className="text-center py-10 text-ive-text-dim text-sm">
        <i className="fa-solid fa-coffee text-xl mb-2 block" />
        작업 중인 개발자가 없습니다
      </div>
    )
  }

  const safeIdx = activeIdx < runningAgents.length ? activeIdx : 0
  const current = runningAgents[safeIdx]

  return (
    <div className="border-t border-ive-cyan/20 flex-1 flex flex-col min-h-0">
      {/* 에이전트 탭 */}
      <div className="flex border-b border-ive-border-dark bg-ive-bg-deep/50 shrink-0">
        {runningAgents.map((tab, idx) => (
            <button
              key={tab.agent.id}
              onClick={() => setActiveIdx(idx)}
              className={`flex-1 px-2 py-1.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
                idx === safeIdx
                  ? 'text-ive-cyan border-b-2 border-ive-cyan bg-ive-cyan/5'
                  : 'text-ive-text-dim hover:text-ive-text-muted'
              }`}
            >
              <div className="relative shrink-0">
                <AgentAvatar avatar={tab.agent.avatar} size="sm" />
                <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-ive-amber animate-pulse border border-ive-bg-deep" />
              </div>
              <span className="truncate">{tab.agent.name}</span>
            </button>
          ))}
      </div>

      {/* 현재 선택된 에이전트 내용 */}
      <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
        <div className="flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <span className="text-sm font-black text-ive-green">#{current.execution!.issueIid}</span>
            {current.execution!.issueTitle && (
              <span className="text-sm text-ive-text ml-1.5 font-semibold">{current.execution!.issueTitle}</span>
            )}
          </div>
          <span className="text-xs font-mono font-bold text-ive-amber shrink-0 ml-2">
            {formatDuration(current.execution!.startedAt)}
            {tick >= 0 ? '' : ''}
          </span>
        </div>

        <LogViewer
          sseUrl={`/api/executions/${current.execution!.id}/logs`}
          initialFetchUrl={`/api/executions/${current.execution!.id}/content`}
          fontSize={11}
          showLineNumbers
          maxLines={500}
          isLive
          className="rounded-lg flex-1 min-h-0"
        />

        <div className="flex gap-2 shrink-0">
          {onKill && (
            <button
              onClick={() => onKill(current.execution!.id)}
              className="flex-1 text-xs font-bold text-ive-red/70 border border-ive-red/30 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-red/10 transition-colors"
            >
              <i className="fa-solid fa-skull-crossbones mr-1" />강제종료
            </button>
          )}
          <button
            onClick={() => router.push(`/executions/${current.execution!.id}`)}
            className="flex-1 text-xs font-bold text-ive-cyan border border-ive-cyan/30 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-cyan/10 transition-colors"
          >
            <i className="fa-solid fa-expand mr-1" />전체화면
          </button>
        </div>
      </div>
    </div>
  )
}
