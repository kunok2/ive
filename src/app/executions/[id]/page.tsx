'use client'

import { useState, useEffect, useRef, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import LogViewer from '@/components/ui/LogViewer'
import AgentAvatar from '@/components/agent/AgentAvatar'
import type { ToolActivity } from '@/lib/tool-activity'
import { useTranslations } from 'next-intl'
import { useStore } from '@/lib/store'

function formatDuration(startedAt: string): string {
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

interface ExecInfo {
  issueIid: number
  issueTitle: string
  startedAt: string
  agentName: string
  agentAvatar: string
  modelName: string
  status: string
  assigneeType: 'agent' | 'user'
  userName: string | null
  userAvatar: string | null
}

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [killing, setKilling] = useState(false)
  const [lineCount, setLineCount] = useState(0)
  const [connected, setConnected] = useState(false)
  const [execInfo, setExecInfo] = useState<ExecInfo | null>(null)
  const [activity, setActivity] = useState<ToolActivity | null>(null)
  const [tick, setTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const tc = useTranslations('common')
  const te = useTranslations('execution')
  const { state } = useStore()
  const userLocale = state.user?.locale
  const userTz = state.user?.timezone
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    fetch(`/api/executions/${id}/content`)
      .then(r => r.json())
      .then(data => {
        if (data.agentName || data.assigneeType === 'user') {
          setExecInfo({
            issueIid: data.issueIid,
            issueTitle: data.issueTitle,
            startedAt: data.startedAt,
            agentName: data.agentName,
            agentAvatar: data.agentAvatar,
            modelName: data.modelName ?? '',
            status: data.status,
            assigneeType: data.assigneeType ?? 'agent',
            userName: data.userName ?? null,
            userAvatar: data.userAvatar ?? null,
          })
        }
      })
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (!connected) return
    const fetchActivity = async () => {
      try {
        const res = await fetch('/api/activities')
        if (res.ok) {
          const list: ToolActivity[] = await res.json()
          if (list.length > 0) {
            setActivity(list[0])
          }
        }
      } catch { /* ignore */ }
    }
    fetchActivity()
    const timer = setInterval(fetchActivity, 2000)
    return () => clearInterval(timer)
  }, [connected])

  const handleKill = async () => {
    setKilling(true)
    try {
      await fetch(`/api/executions/${id}/kill`, { method: 'POST' })
    } finally {
      setKilling(false)
    }
  }

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current?.querySelector('[data-log-scroll]')
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])

  return (
    <div className="h-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      <div className="bg-ive-bg-card border-b border-ive-border-dark px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-lg bg-ive-bg-deep border border-ive-border-dark flex items-center justify-center text-ive-text-muted hover:text-ive-green transition-colors shrink-0"
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          {execInfo ? (
            <div className="flex items-center gap-2 min-w-0">
              {execInfo.assigneeType === 'user' ? (
                execInfo.userAvatar ? (
                  <img src={execInfo.userAvatar} alt="" className="w-7 h-7 rounded-full border border-ive-cyan/30 shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-ive-cyan/20 flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-user text-ive-cyan text-xs" />
                  </div>
                )
              ) : (
                <AgentAvatar
                  avatar={execInfo.agentAvatar}
                  size="sm"
                  toolBadge={connected && activity ? activity.category : null}
                />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-sm font-bold ${execInfo.assigneeType === 'user' ? 'text-ive-cyan' : 'text-ive-green'}`}>#{execInfo.issueIid}</span>
                  {execInfo.issueTitle && (
                    <span className="text-sm text-ive-text font-bold truncate">{execInfo.issueTitle}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-ive-text-dim">
                  {execInfo.assigneeType === 'user' ? (
                    <span className="font-bold text-ive-cyan"><i className="fa-solid fa-user mr-1" />{execInfo.userName}</span>
                  ) : (
                    <>
                      <span className="font-bold">{execInfo.agentName}</span>
                      {execInfo.modelName && (
                        <span className="font-mono text-ive-cyan bg-ive-cyan/10 border border-ive-cyan/20 px-1.5 py-0.5 rounded">
                          <i className="fa-solid fa-microchip mr-0.5" />{execInfo.modelName}
                        </span>
                      )}
                      {connected && activity && (
                        <span className="text-xs bg-ive-bg-deep px-1.5 py-0.5 rounded font-mono truncate max-w-[140px]">
                          {activity.tool === 'thinking' ? te('thinking') : activity.tool}
                        </span>
                      )}
                    </>
                  )}
                  <span className={`font-mono font-bold ${execInfo.assigneeType === 'user' ? 'text-ive-cyan' : 'text-ive-amber'}`}>
                    {formatDuration(execInfo.startedAt)}
                    {tick >= 0 ? '' : ''}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="text-base font-bold text-ive-green-pale truncate">
                <i className="fa-solid fa-terminal mr-1.5 text-ive-green" />
                Execution Trace
              </div>
              <div className="text-xs text-ive-text-dim font-mono truncate">{id}</div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {connected && execInfo?.assigneeType !== 'user' && (
            <button
              onClick={handleKill}
              disabled={killing}
              className="text-xs font-bold text-ive-red/70 border border-ive-red/30 px-3 py-1.5 rounded-lg bg-ive-bg-deep hover:bg-ive-red/10 transition-colors disabled:opacity-40"
            >
              {killing ? <i className="fa-solid fa-circle-notch fa-spin" /> : <><i className="fa-solid fa-skull-crossbones mr-1" />{te('forceStop')}</>}
            </button>
          )}
        </div>
      </div>

      {execInfo?.assigneeType === 'user' ? (
        <div ref={containerRef} className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4">
          <div className="text-center">
            {execInfo.userAvatar ? (
              <img src={execInfo.userAvatar} alt="" className="w-20 h-20 rounded-full mx-auto mb-3 border-2 border-ive-cyan/30" />
            ) : (
              <i className="fa-solid fa-user-circle text-6xl text-ive-cyan/50 mb-3 block" />
            )}
            <div className="text-lg font-bold text-ive-text">{execInfo.userName}</div>
            <div className="text-sm text-ive-cyan mt-2">
              <i className="fa-solid fa-user-check mr-1" />{te('assignedToUser')}
            </div>
            <div className={`text-xs mt-2 px-3 py-1 rounded-full inline-block font-bold ${
              execInfo.status === 'assigned' ? 'bg-ive-cyan/20 text-ive-cyan' :
              execInfo.status === 'success' ? 'bg-ive-green/20 text-ive-green' :
              'bg-ive-red/20 text-ive-red'
            }`}>
              {execInfo.status === 'assigned' ? te('assigned') : execInfo.status === 'success' ? te('completed') : te('failed')}
            </div>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 min-h-0">
          <LogViewer
            sseUrl={`/api/executions/${id}/logs`}
            initialFetchUrl={`/api/executions/${id}/content`}
            fontSize={13}
            maxLines={50000}
            className="h-full"
            onConnectionChange={setConnected}
            onLineCountChange={setLineCount}
            isLive={connected}
            timezone={userTz}
          />
        </div>
      )}

      <div className="bg-ive-bg-card border-t border-ive-border-dark px-4 py-2 flex items-center justify-between shrink-0">
        {execInfo?.assigneeType !== 'user' && (
          <div className="flex items-center gap-3 text-xs text-ive-text-dim">
            <span><i className="fa-solid fa-lines-leaning mr-1" />{lineCount} lines</span>
            <span className="text-ive-text-dim/30">|</span>
            <span className={connected ? 'text-ive-green' : 'text-ive-text-dim'}>
              <i className={`fa-solid ${connected ? 'fa-circle' : 'fa-circle-xmark'} mr-1`} />
              {connected ? te('connected') : te('terminated')}
            </span>
          </div>
        )}
        {execInfo?.assigneeType === 'user' && <div />}
        <button
          onClick={scrollToBottom}
          className="text-xs px-2 py-1 rounded border transition-colors text-ive-text-dim border-ive-border-dark hover:text-ive-green hover:border-ive-green/30"
        >
          <i className="fa-solid fa-arrow-down mr-1" />{tc('scrollToBottom')}
        </button>
      </div>
    </div>
  )
}
