'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { TaskExecution, Agent } from '@/types'
import { useStore } from '@/lib/store'
import { formatTime as formatTimeUtil } from '@/lib/format-date'
import type { ToolActivity } from '@/lib/tool-activity'
import LogViewer from '@/components/ui/LogViewer'
import AgentAvatar from '@/components/agent/AgentAvatar'
import MarqueeText from '@/components/ui/MarqueeText'

function ThinkingElapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(interval)
  }, [])
  return (
    <span className="text-purple-400 text-xs">
      {seconds}초 생각중...
    </span>
  )
}

interface ChatMsg { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }

function ChatViewer({ projectId, execution, agent }: { projectId: string; execution: TaskExecution; agent: Agent }) {
  const { state } = useStore()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [agentProcessing, setAgentProcessing] = useState(false)
  const [userAvatar, setUserAvatar] = useState<string>('av-01')
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = node.scrollHeight
  }, [])

  // Fetch user avatar once
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.avatar) setUserAvatar(d.avatar) }).catch(() => {})
  }, [])

  const fetchMessages = useCallback(async () => {
    try {
      const chatRes = await fetch(`/api/projects/${projectId}/issues/${execution.issueIid}/chat`)
      if (!chatRes.ok) return
      const chatData = await chatRes.json()
      if (!chatData.session) return
      const msgRes = await fetch(`/api/projects/${projectId}/issues/${execution.issueIid}/chat/messages?sessionId=${chatData.session.id}`)
      if (!msgRes.ok) return
      const data = await msgRes.json()
      if (data.messages) {
        setMessages(data.messages)
        setAgentProcessing(data.agentProcessing === true)
      }
    } catch { /* ignore */ }
  }, [projectId, execution.issueIid])

  useEffect(() => {
    fetchMessages()
    const timer = setInterval(fetchMessages, 3000)
    return () => clearInterval(timer)
  }, [fetchMessages])

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-2 rounded-lg bg-ive-bg-deep/50 border border-ive-border-dark p-2">
      {messages.length === 0 && !agentProcessing && (
        <div className="text-center text-ive-text-dim text-xs py-4">
          <i className="fa-solid fa-comments mr-1" />대화 내용이 없습니다
        </div>
      )}
      {messages.map(msg => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'flex-row-reverse' : ''} items-start gap-1.5`}>
          <div className="shrink-0 mt-0.5">
            <AgentAvatar avatar={msg.role === 'user' ? userAvatar : agent.avatar} size="sm" />
          </div>
          <div className={`rounded-lg px-2.5 py-1.5 text-xs ${msg.role === 'user' ? 'max-w-[80%]' : 'flex-1'} ${
            msg.role === 'user'
              ? 'bg-sky-500/[0.12] border border-sky-500/25'
              : 'bg-ive-bg-card border border-purple-500/10'
          }`}>
            <div className={`flex items-center gap-1.5 mb-0.5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <span className={`text-[10px] font-bold ${msg.role === 'user' ? 'text-sky-400' : 'text-purple-300'}`}>
                {msg.role === 'user' ? 'You' : agent.name}
              </span>
              <span className="text-[10px] text-ive-text-dim">
                {formatTimeUtil(msg.createdAt, state.user?.locale, state.user?.timezone)}
              </span>
            </div>
            <div className={`break-words whitespace-pre-wrap text-ive-text-muted ${msg.role === 'user' ? 'text-right' : ''}`}>
              {msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content}
            </div>
          </div>
        </div>
      ))}
      {agentProcessing && (
        <div className="flex items-center gap-1.5">
          <AgentAvatar avatar={agent.avatar} size="sm" />
          <ThinkingElapsed />
        </div>
      )}
    </div>
  )
}

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
  projectId: string
  onKill?: (id: string) => void
}

export default function LiveTracePanel({ agents, projectId, onKill }: Props) {
  const router = useRouter()
  const [activeIdx, setActiveIdx] = useState(0)
  const [tick, setTick] = useState(0)
  const [activities, setActivities] = useState<Record<string, ToolActivity>>({})

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/activities')
      if (res.ok) {
        const list: ToolActivity[] = await res.json()
        const map: Record<string, ToolActivity> = {}
        for (const a of list) map[a.agentId] = a
        setActivities(map)
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchActivities()
    const timer = setInterval(fetchActivities, 2000)
    return () => clearInterval(timer)
  }, [fetchActivities])

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
      <div className="flex border-b border-ive-border-dark bg-ive-bg-deep/50 shrink-0">
        {runningAgents.map((tab, idx) => {
          const activity = activities[tab.agent.id]
          const tabIsChat = tab.execution?.id.startsWith('exec-chat-')
          const activeColor = tabIsChat ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/5' : 'text-ive-cyan border-b-2 border-ive-cyan bg-ive-cyan/5'
          return (
            <button
              key={tab.agent.id}
              onClick={() => setActiveIdx(idx)}
              className={`flex-1 px-2 py-1.5 text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
                idx === safeIdx ? activeColor : 'text-ive-text-dim hover:text-ive-text-muted'
              }`}
            >
              <AgentAvatar
                avatar={tab.agent.avatar}
                size="sm"
                toolBadge={tabIsChat ? null : (activity?.category ?? null)}
              />
              <span className="truncate min-w-0"><MarqueeText className="text-sm">{tab.agent.name}</MarqueeText></span>
            </button>
          )
        })}
      </div>

      {(() => {
        const isChat = current.execution!.id.startsWith('exec-chat-')
        return (
          <div key={current.execution!.id} className="flex-1 flex flex-col min-h-0 p-3 gap-2">
            <div className="flex items-center justify-between shrink-0">
              <div className="min-w-0 flex-1">
                <MarqueeText className="text-sm font-semibold text-ive-text">
                  {isChat ? (
                    <span className="font-black text-purple-400">💬 #{current.execution!.issueIid}</span>
                  ) : (
                    <span className="font-black text-ive-green">#{current.execution!.issueIid}</span>
                  )}
                  {current.execution!.issueTitle && !isChat && (
                    <span className="ml-1.5">{current.execution!.issueTitle}</span>
                  )}
                  {isChat && <span className="ml-1.5">채팅 진행 중</span>}
                </MarqueeText>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {!isChat && (() => {
                  const activity = activities[current.agent.id]
                  if (!activity) return null
                  return (
                    <span className="text-[10px] text-ive-text-dim bg-ive-bg-deep px-1.5 py-0.5 rounded font-mono truncate max-w-[140px]">
                      {activity.tool === 'thinking' ? '생각 중...' : activity.tool}
                    </span>
                  )
                })()}
                <span className={`text-xs font-mono font-bold ${isChat ? 'text-purple-400' : 'text-ive-amber'}`}>
                  {formatDuration(current.execution!.startedAt)}
                  {tick >= 0 ? '' : ''}
                </span>
              </div>
            </div>

            {isChat ? (
              <ChatViewer projectId={projectId} execution={current.execution!} agent={current.agent} />
            ) : (
              <LogViewer
                sseUrl={`/api/executions/${current.execution!.id}/logs`}
                initialFetchUrl={`/api/executions/${current.execution!.id}/content`}
                fontSize={11}
                showLineNumbers
                maxLines={500}
                isLive
                className="rounded-lg flex-1 min-h-0"
              />
            )}

            <div className="flex gap-2 shrink-0">
              {onKill && (
                <button
                  onClick={() => onKill(current.execution!.id)}
                  className={`flex-1 text-xs font-bold py-1.5 rounded-lg bg-ive-bg-deep transition-colors ${
                    isChat ? 'text-purple-400/70 border border-purple-500/30 hover:bg-purple-500/10' : 'text-ive-red/70 border border-ive-red/30 hover:bg-ive-red/10'
                  }`}
                >
                  {isChat ? (
                    <><i className="fa-solid fa-xmark mr-1" />채팅 종료</>
                  ) : (
                    <><i className="fa-solid fa-skull-crossbones mr-1" />강제종료</>
                  )}
                </button>
              )}
              <button
                onClick={() => {
                  if (isChat) {
                    router.push(`/issues/${projectId}/${current.execution!.issueIid}`)
                  } else {
                    router.push(`/executions/${current.execution!.id}`)
                  }
                }}
                className="flex-1 text-xs font-bold text-ive-cyan border border-ive-cyan/30 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-cyan/10 transition-colors"
              >
                {isChat ? (
                  <><i className="fa-solid fa-comments mr-1" />채팅 열기</>
                ) : (
                  <><i className="fa-solid fa-expand mr-1" />전체화면</>
                )}
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
