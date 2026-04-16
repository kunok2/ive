'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import Sparkline from '@/components/ui/Sparkline'
import type { ReportData, DiagnosisResult, ReportHelpers } from './types'

interface AgentLoadSectionProps {
  d: DiagnosisResult
  data: ReportData
  helpers: ReportHelpers
}

export default function AgentLoadSection({ d, data, helpers }: AgentLoadSectionProps) {
  const tr = useTranslations('report')
  const { fmtCost, fmtDur } = helpers
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())

  if (d.agents.length === 0) return null

  return (
    <section>
      <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('agentLoadTitle')}</div>
      <div className="space-y-2">
        {d.agents.sort((a, b) => b.tasks - a.tasks).map(a => {
          const sev = a.annotation?.severity
          const bgClass = sev === 'critical' ? 'bg-ive-red/3' : sev === 'warning' ? 'bg-ive-amber/3' : sev === 'info' ? 'bg-ive-cyan/3' : ''
          return (
          <div key={a.agentId} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${bgClass}`}>
            <button onClick={() => { const n = new Set(expandedAgents); n.has(a.agentId) ? n.delete(a.agentId) : n.add(a.agentId); setExpandedAgents(n) }}
              className="w-full px-3 py-2.5 text-left">
              <div className="flex items-center gap-2">
                <AgentAvatar avatar={a.agentAvatar} size="xs" />
                <span className="text-sm font-bold text-ive-text flex-1 truncate">{a.agentName}</span>
                {a.assignedProjectName && <span className="text-xs text-ive-text-dim truncate max-w-[80px]">→ {a.assignedProjectName}</span>}
                <i className={`fa-solid fa-chevron-${expandedAgents.has(a.agentId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs">
                <span className="text-ive-text font-bold">{tr('processedInPeriod', { count: a.tasks.toLocaleString() })}</span>
                <span className="text-ive-text-dim">{tr('dailyAvgCapacity', { count: a.dailyCapacity })}</span>
                {a.currentWaiting > 0 && <span className={`font-bold ${a.currentWaiting >= 6 ? 'text-ive-red' : a.currentWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text-muted'}`}>{tr('waitingCompact', { count: a.currentWaiting })}</span>}
                <span className="text-ive-text-muted ml-auto">${fmtCost(a.cost)}</span>
              </div>
              {a.annotation && (() => {
                const s = a.annotation.severity
                const color = s === 'critical' ? 'text-ive-red' : s === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                const icon = s === 'critical' ? 'fa-triangle-exclamation' : s === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                const msg = tr(`agentAnnotation.${a.annotation.key}` as any, a.annotation.params as any)
                return (
                  <div className={`text-xs mt-1.5 leading-relaxed ${color}`}>
                    <i className={`fa-solid ${icon} mr-1`} />{msg}
                  </div>
                )
              })()}
            </button>
            {expandedAgents.has(a.agentId) && (
              <div className="px-3 pb-3 border-t border-ive-border-dark">
                {(() => {
                  const at = data.agentTrend?.find(t => t.agentId === a.agentId)
                  const awt = data.agentWaitingTrend?.map(d => d.byAgent.find(ba => ba.agentId === a.agentId)?.waiting ?? 0) ?? []
                  if (!at || at.daily.length < 2) return null
                  return (
                    <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCount')}</span><Sparkline data={at.daily.map(d => d.tasks)} width={80} height={20} color="auto" /></div>
                        <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCost')}</span><Sparkline data={at.daily.map(d => d.cost)} width={80} height={20} color="cyan" /></div>
                        <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkWaiting')}</span><Sparkline data={awt.length > 0 ? awt : [0]} width={80} height={20} color="cyan" /></div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
          )
        })}
      </div>
    </section>
  )
}
