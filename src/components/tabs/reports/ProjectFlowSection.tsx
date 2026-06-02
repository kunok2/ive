'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Sparkline from '@/components/ui/Sparkline'
import type { ReportData, DiagnosisResult, ReportHelpers } from './types'

interface ProjectFlowSectionProps {
  d: DiagnosisResult
  data: ReportData
  helpers: ReportHelpers
}

export default function ProjectFlowSection({ d, data, helpers }: ProjectFlowSectionProps) {
  const tr = useTranslations('report')
  const { fmtCost } = helpers
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())

  if (d.projects.length === 0) return null

  return (
    <section>
      <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('projectFlowTitle')}</div>
      <div className="space-y-2">
        {d.projects.sort((a, b) => b.throughput - a.throughput).map(p => (
          <div key={p.projectId} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden">
            <button onClick={() => { const n = new Set(expandedProjects); n.has(p.projectId) ? n.delete(p.projectId) : n.add(p.projectId); setExpandedProjects(n) }}
              className="w-full px-3 py-2.5 text-left">
              <div className="flex items-center gap-2">
                {p.projectAvatarUrl ? (
                  <img src={p.projectAvatarUrl} alt="" className="w-5 h-5 rounded-lg object-cover shrink-0" />
                ) : (
                  <span className="w-5 h-5 rounded-lg flex items-center justify-center shrink-0 bg-ive-bg-deep">
                    <i className={`fa-brands ${p.projectProvider === 'github' ? 'fa-github' : 'fa-gitlab'} text-xs`} style={{ color: p.projectColor || '#4ade80' }} />
                  </span>
                )}
                <span className="text-sm font-bold text-ive-text flex-1 truncate">{p.projectName}</span>
                <i className={`fa-solid fa-chevron-${expandedProjects.has(p.projectId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="text-ive-text-muted">{tr('inflowCompact', { count: p.inflow.toLocaleString() })}</span>
                <span className="text-ive-text-dim">→</span>
                <span className="text-ive-text-muted">{tr('throughputCompact', { count: p.throughput.toLocaleString() })}</span>
                {p.currentWaiting > 0 && <span className={`font-bold ${p.currentWaiting >= 6 ? 'text-ive-red' : p.currentWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text-muted'}`}>
                  {tr('waitingInProgressCount', { count: p.currentWaiting })}
                </span>}
                <span className="text-ive-text-muted ml-auto">{fmtCost(p.cost)}</span>
              </div>
              {p.annotation && (() => {
                const sev = p.annotation.severity
                const color = sev === 'critical' ? 'text-ive-red' : sev === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                const icon = sev === 'critical' ? 'fa-triangle-exclamation' : sev === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                const msg = tr(`annotation.${p.annotation.key}` as any, p.annotation.params as any)
                return (
                  <div className={`text-xs mt-1.5 ${color} leading-relaxed`}>
                    <i className={`fa-solid ${icon} mr-1`} />{msg}
                  </div>
                )
              })()}
            </button>
            {expandedProjects.has(p.projectId) && (
              <div className="px-3 pb-3 border-t border-ive-border-dark">
                <div className="grid grid-cols-2 gap-1 mt-2 text-center text-xs">
                  <div>
                    <div className="text-ive-text-dim">{tr('metric.costPerTask')}</div>
                    <div className="font-bold text-ive-text">{fmtCost(p.costPerTask)}</div>
                  </div>
                  <div>
                    <div className="text-ive-text-dim">{tr('metric.retryRate')}</div>
                    {(() => {
                      const r = p.retryRate
                      const label = r >= 30 ? tr('metric.retryHigh') : r >= 10 ? tr('metric.retryNormal') : tr('metric.retryLow')
                      const cls = r >= 30 ? 'text-ive-amber' : 'text-ive-text'
                      return (
                        <>
                          <div className={`font-bold ${cls}`}>{r.toLocaleString()}%</div>
                          <div className="text-[10px] text-ive-text-dim">{label}</div>
                        </>
                      )
                    })()}
                  </div>
                </div>
                {/* 프로젝트별 미니 추이 */}
                {(() => {
                  const pt = data.projectTrend?.find(t => t.projectId === p.projectId)
                  const pwt = data.waitingTrend?.map(d => d.byProject.find(bp => bp.projectId === p.projectId)?.waiting ?? 0) ?? []
                  if (!pt || pt.daily.length < 2) return null
                  return (
                    <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCount')}</span><Sparkline data={pt.daily.map(d => d.tasks)} width={80} height={20} color="auto" /></div>
                        <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkCost')}</span><Sparkline data={pt.daily.map(d => d.cost)} width={80} height={20} color="cyan" /></div>
                        <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkWaiting')}</span><Sparkline data={pwt.length > 0 ? pwt : [0]} width={80} height={20} color="cyan" /></div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
