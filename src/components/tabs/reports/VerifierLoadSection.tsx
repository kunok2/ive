'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import type { DiagnosisResult, ReportHelpers } from './types'

interface VerifierLoadSectionProps {
  d: DiagnosisResult
  helpers: ReportHelpers
}

export default function VerifierLoadSection({ d, helpers }: VerifierLoadSectionProps) {
  const tr = useTranslations('report')
  const { fmtDur } = helpers
  const [expandedVerifiers, setExpandedVerifiers] = useState<Set<string>>(new Set())

  if (!d.verifierLoads || d.verifierLoads.length === 0) return null

  return (
    <section>
      <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('verifierLoadTitle')}</div>
      <div className="space-y-2">
        {d.verifierLoads.map(v => {
          const sev = v.annotation?.severity
          const bgClass = sev === 'critical' ? 'bg-ive-red/3' : sev === 'warning' ? 'bg-ive-amber/3' : sev === 'info' ? 'bg-ive-cyan/3' : ''
          const totalBacklog = v.verifyWaiting + v.verifying
          return (
            <div key={v.username} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${bgClass}`}>
              <button onClick={() => { const n = new Set(expandedVerifiers); n.has(v.username) ? n.delete(v.username) : n.add(v.username); setExpandedVerifiers(n) }}
                className="w-full px-3 py-2.5 text-left">
                <div className="flex items-center gap-2">
                  <AgentAvatar avatar={v.avatar} size="xs" />
                  <span className="text-sm font-bold text-ive-text flex-1 truncate">{v.name}</span>
                  <span className="text-xs font-bold text-ive-text-dim">
                    <i className={`fa-brands ${v.provider === 'github' ? 'fa-github' : 'fa-gitlab'} mr-0.5`} />@{v.username}
                  </span>
                  <i className={`fa-solid fa-chevron-${expandedVerifiers.has(v.username) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs font-bold flex-wrap">
                  <span className="text-ive-green">{tr('approvedCompact', { count: v.approved })}</span>
                  {v.rejected > 0 && <span className="text-ive-red">{tr('rejectedCompact', { count: v.rejected })}</span>}
                  {v.dailyCapacity > 0 && <span className="text-ive-text-dim">{tr('dailyAvgCapacity', { count: v.dailyCapacity })}</span>}
                  {totalBacklog > 0 && (
                    <span className={`${v.verifyWaiting >= 6 ? 'text-ive-red' : v.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-cyan'}`}>
                      <i className="fa-solid fa-clock mr-0.5" />
                      {v.verifying > 0
                        ? tr('waitingAndVerifying', { waiting: v.verifyWaiting, verifying: v.verifying })
                        : tr('waitingOnly', { waiting: v.verifyWaiting })}
                    </span>
                  )}
                  {v.avgVerifyMin > 0 && <span className="text-ive-text-dim ml-auto">{tr('avgVerifyCompact', { duration: fmtDur(v.avgVerifyMin) })}</span>}
                </div>
                {v.annotation && (() => {
                  const s = v.annotation.severity
                  const color = s === 'critical' ? 'text-ive-red' : s === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                  const icon = s === 'critical' ? 'fa-triangle-exclamation' : s === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                  const msg = tr(`verifierAnnotation.${v.annotation.key}` as any, v.annotation.params as any)
                  return (
                    <div className={`text-xs mt-1.5 leading-relaxed ${color}`}>
                      <i className={`fa-solid ${icon} mr-1`} />{msg}
                    </div>
                  )
                })()}
              </button>
              {expandedVerifiers.has(v.username) && (
                <div className="px-3 pb-3 border-t border-ive-border-dark">
                  <div className="grid grid-cols-4 gap-1 mt-2 text-center text-xs font-bold">
                    <div>
                      <div className="text-ive-text-dim">{tr('verifyWaitHeader')}</div>
                      <div className={`${v.verifyWaiting >= 6 ? 'text-ive-red' : v.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text'}`}>{tr('countCases', { count: v.verifyWaiting })}</div>
                    </div>
                    <div>
                      <div className="text-ive-text-dim">{tr('verifyingHeader')}</div>
                      <div className="text-ive-text">{tr('countCases', { count: v.verifying })}</div>
                    </div>
                    <div>
                      <div className="text-ive-text-dim">{tr('approvedHeader')}</div>
                      <div className="text-ive-green">{tr('countCases', { count: v.approved })}</div>
                    </div>
                    <div>
                      <div className="text-ive-text-dim">{tr('rejectedHeader')}</div>
                      <div className={`${v.rejected > 0 ? 'text-ive-red' : 'text-ive-text'}`}>{tr('countCases', { count: v.rejected })}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 mt-2 text-center text-xs font-bold">
                    <div>
                      <div className="text-ive-text-dim">{tr('avgVerifyHeader')}</div>
                      <div className="text-ive-text">{v.avgVerifyMin > 0 ? fmtDur(v.avgVerifyMin) : '-'}</div>
                    </div>
                    <div>
                      <div className="text-ive-text-dim">{tr('oldestWaitHeader')}</div>
                      <div className={`${v.oldestWaitMin > 60 * 24 ? 'text-ive-red' : v.oldestWaitMin > 60 * 4 ? 'text-ive-amber' : 'text-ive-text'}`}>{v.oldestWaitMin > 0 ? fmtDur(v.oldestWaitMin) : '-'}</div>
                    </div>
                  </div>
                  {v.assignedProjectNames.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {v.assignedProjectNames.map(pn => (
                        <span key={pn} className="px-2 py-0.5 rounded-lg text-xs font-bold bg-ive-bg-deep border border-ive-border-dark text-ive-text-dim">{pn}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
