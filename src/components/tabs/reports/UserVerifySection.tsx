'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import Sparkline from '@/components/ui/Sparkline'
import ShareStack from './ShareStack'
import type { ReportData, ReportHelpers } from './types'

interface UserVerifySectionProps {
  data: ReportData
  helpers: ReportHelpers
}

export default function UserVerifySection({ data, helpers }: UserVerifySectionProps) {
  const tr = useTranslations('report')
  const { fmtDur, fmtCost, diffBadge, diffColor } = helpers
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())

  if (!data.byUser || data.byUser.length === 0) return null

  // 전체에서 비중이 큰 순(=작업시간 점유율, 누적 분배 막대와 동일 기준)으로 정렬.
  // 동률이면 검증 대기 → 검증 건수 → 처리 건수 순.
  const sortedUsers = [...data.byUser].sort((a, b) =>
    ((b.totalDurationMin ?? 0) - (a.totalDurationMin ?? 0)) ||
    (b.verifyWaiting - a.verifyWaiting) || (b.verifyTasks - a.verifyTasks) || (b.tasks - a.tasks))

  return (
    <section>
      <div className="text-xs font-bold text-ive-text-dim mb-2 uppercase tracking-wider">{tr('userVerifyTitle')}</div>
      <ShareStack title={tr('shareByDuration')} data={data.byUser.map(u => ({ id: u.userId, name: u.userName, value: u.totalDurationMin ?? 0 }))} />
      <div className="space-y-2">
        {sortedUsers.map(u => {
          const hasVerify = u.verifyTasks > 0 || u.verifyWaiting > 0
          const prev = data.prevByUser?.find(p => p.userId === u.userId)
          const approvalRate = u.verifyApproved + u.verifyRejected > 0 ? Math.round(u.verifyApproved / (u.verifyApproved + u.verifyRejected) * 100) : null
          const sev = u.annotation?.severity
          const bgClass = sev === 'critical' ? 'bg-ive-red/3' : sev === 'warning' ? 'bg-ive-amber/3' : sev === 'info' ? 'bg-ive-cyan/3' : ''
          return (
            <div key={u.userId} className={`bg-ive-bg-card border border-ive-border-subtle rounded-lg overflow-hidden ${bgClass}`}>
              <button onClick={() => { const n = new Set(expandedUsers); n.has(u.userId) ? n.delete(u.userId) : n.add(u.userId); setExpandedUsers(n) }}
                className="w-full px-3 py-2.5 text-left">
                <div className="flex items-center gap-2">
                  {u.userAvatar === 'photo' && (u.avatarUserId || u.userId) ? (
                    <img src={`/api/auth/avatar/image?id=${u.avatarUserId || u.userId}`} alt="" className="w-5 h-5 rounded-lg object-cover shrink-0 border border-ive-border" />
                  ) : u.userAvatar ? (
                    <AgentAvatar avatar={u.userAvatar} size="xs" />
                  ) : (
                    <div className="w-5 h-5 rounded-lg bg-ive-bg-deep border border-ive-border flex items-center justify-center shrink-0"><i className="fa-solid fa-user text-xs text-ive-text-dim" /></div>
                  )}
                  <span className="text-sm font-bold text-ive-text flex-1 truncate">{u.userName}</span>
                  {u.verifyWaiting > 0 && <span className={`text-xs font-bold ${u.verifyWaiting >= 5 ? 'text-ive-red' : u.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-cyan'}`}><i className="fa-solid fa-clock mr-0.5" />{tr('waitingCompact', { count: u.verifyWaiting })}</span>}
                  <span className="text-sm font-bold text-ive-text">{tr('processingCompact', { count: u.tasks })}</span>
                  {prev != null && (() => { const b = diffBadge(u.tasks, prev.tasks); return b ? <span className={`text-xs font-bold ${diffColor(u.tasks, prev.tasks)}`}>{b}</span> : null })()}
                  <i className={`fa-solid fa-chevron-${expandedUsers.has(u.userId) ? 'up' : 'down'} text-xs text-ive-text-dim`} />
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-ive-text-dim flex-wrap">
                  {hasVerify ? (<>
                    <span><span className="text-ive-green font-bold">{tr('approvedHeader')}</span> {u.verifyApproved}</span>
                    {u.verifyRejected > 0 && <span><span className="text-ive-red font-bold">{tr('rejectedHeader')}</span> {u.verifyRejected}</span>}
                    {u.avgVerifyMin > 0 && <span><span className="text-ive-text-dim font-bold">{tr('avgVerifyLabel2')}</span> {fmtDur(u.avgVerifyMin)}</span>}
                    {approvalRate != null && <span className={`font-bold ${approvalRate >= 80 ? 'text-ive-green' : approvalRate >= 50 ? 'text-ive-amber' : 'text-ive-red'}`}>{tr('approvalRatePct', { rate: approvalRate })}</span>}
                  </>) : (<>
                    <span className="font-bold text-ive-text">{tr('processedInPeriod', { count: u.tasks })}</span>
                    {u.avgDurationMin > 0 && <span>{tr('avgProcessInline', { duration: fmtDur(u.avgDurationMin) })}</span>}
                  </>)}
                  <span className="text-ive-text-muted ml-auto">{fmtCost(u.cost)}</span>
                </div>
                {u.annotation && (() => {
                  const s = u.annotation.severity
                  const color = s === 'critical' ? 'text-ive-red' : s === 'warning' ? 'text-ive-amber' : 'text-ive-cyan'
                  const icon = s === 'critical' ? 'fa-triangle-exclamation' : s === 'warning' ? 'fa-circle-exclamation' : 'fa-lightbulb'
                  const msg = tr(`userAnnotation.${u.annotation.key}` as any, u.annotation.params as any)
                  return (
                    <div className={`text-xs mt-1.5 leading-relaxed ${color}`}>
                      <i className={`fa-solid ${icon} mr-1`} />{msg}
                    </div>
                  )
                })()}
              </button>
              {expandedUsers.has(u.userId) && (
                <div className="px-3 pb-3 border-t border-ive-border-dark">
                  {hasVerify ? (<>
                    {/* 검증 상세 */}
                    <div className="grid grid-cols-4 gap-1 mt-2 text-center text-xs">
                      <div><div className="text-ive-text-dim">{tr('verifyHeader')}</div><div className="font-bold text-ive-text">{tr('countCases', { count: u.verifyTasks })}</div></div>
                      <div><div className="text-ive-text-dim">{tr('approvedHeader')}</div><div className="font-bold text-ive-green">{tr('countCases', { count: u.verifyApproved })}</div></div>
                      <div><div className="text-ive-text-dim">{tr('rejectedHeader')}</div><div className={`font-bold ${u.verifyRejected > 0 ? 'text-ive-red' : 'text-ive-text'}`}>{tr('countCases', { count: u.verifyRejected })}</div></div>
                      <div><div className="text-ive-text-dim">{tr('waitingNowHeader')}</div><div className={`font-bold ${u.verifyWaiting >= 5 ? 'text-ive-red' : u.verifyWaiting >= 3 ? 'text-ive-amber' : 'text-ive-text'}`}>{tr('countCases', { count: u.verifyWaiting })}</div></div>
                    </div>
                    <div className="grid grid-cols-3 gap-1 mt-2 text-center text-xs">
                      <div><div className="text-ive-text-dim">{tr('verifyTimeHeader')}</div><div className="font-bold text-ive-text">{u.avgVerifyMin > 0 ? fmtDur(u.avgVerifyMin) : '-'}</div></div>
                      <div><div className="text-ive-text-dim">{tr('verifyWaitHeader2')}</div><div className={`font-bold ${u.verifyAvgWaitMin > 60 ? 'text-ive-red' : u.verifyAvgWaitMin > 30 ? 'text-ive-amber' : 'text-ive-text'}`}>{u.verifyAvgWaitMin > 0 ? fmtDur(u.verifyAvgWaitMin) : '-'}</div></div>
                      <div><div className="text-ive-text-dim">{tr('assignedIssuesHeader')}</div><div className="font-bold text-ive-text">{tr('countCases', { count: u.tasks })}</div></div>
                    </div>
                  </>) : (<>
                    {/* 검증 데이터 없을 때 */}
                    <div className="grid grid-cols-2 gap-1 mt-2 text-center text-xs">
                      <div><div className="text-ive-text-dim">{tr('tasks')}</div><div className="font-bold text-ive-text">{tr('countCases', { count: u.tasks })}</div></div>
                      <div><div className="text-ive-text-dim">{tr('issuesHeader')}</div><div className="font-bold text-ive-text">{tr('countCases', { count: u.issueCount })}</div></div>
                    </div>
                    {u.avgWaitMin > 0 && (
                      <div className="mt-2 text-center text-xs">
                        <span className="text-ive-text-dim">{tr('issueWaitAvgLabel')}</span>
                        <span className="font-bold text-ive-text">{fmtDur(u.avgWaitMin)}</span>
                      </div>
                    )}
                  </>)}
                  {/* 추이 스파크라인 */}
                  {(() => {
                    const ut = data.userTrend?.find(t => t.userId === u.userId)
                    if (!ut || ut.daily.length < 2) return null
                    const hasVerifyData = ut.daily.some(d => (d.verified ?? 0) > 0)
                    return (
                      <div className="mt-2 bg-ive-bg-deep rounded-lg p-2">
                        <div className={`grid ${hasVerifyData ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                          <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkIssue')}</span><Sparkline data={ut.daily.map(d => d.tasks ?? 0)} width={80} height={20} color="auto" /></div>
                          {hasVerifyData && <div className="flex items-center gap-1.5"><span className="text-xs text-ive-text-dim shrink-0">{tr('sparkVerify')}</span><Sparkline data={ut.daily.map(d => d.verified ?? 0)} width={80} height={20} color="cyan" /></div>}
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
