'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import AgentAvatar from '@/components/agent/AgentAvatar'
import { utcISOToKSTDateTime } from '@/lib/date-utils'
import type { ReportData, ReportHelpers } from './types'

interface IssueListSectionProps {
  data: ReportData
  helpers: ReportHelpers
}

export default function IssueListSection({ data, helpers }: IssueListSectionProps) {
  const tr = useTranslations('report')
  const router = useRouter()
  const { fmtCost, fmtDur } = helpers

  const [showIssues, setShowIssues] = useState(true)
  const [issueProjectFilter, setIssueProjectFilter] = useState('all')
  const [issueKeyword, setIssueKeyword] = useState('')
  const [issueSort, setIssueSort] = useState<'date' | 'duration' | 'cost'>('date')
  const [issueSortDir, setIssueSortDir] = useState<'desc' | 'asc'>('desc')
  const [visibleCount, setVisibleCount] = useState(20)

  if (!data.resolvedIssues || data.resolvedIssues.length === 0) return null

  const filteredIssues = data.resolvedIssues.filter(issue => {
    if (issueProjectFilter !== 'all' && issue.projectId !== issueProjectFilter) return false
    if (issueKeyword.trim()) {
      const kw = issueKeyword.trim().toLowerCase()
      if (!`#${issue.issueIid} ${issue.issueTitle} ${issue.agentName} ${issue.projectName}`.toLowerCase().includes(kw)) return false
    }
    return true
  }).sort((a, b) => {
    const dir = issueSortDir === 'desc' ? 1 : -1
    if (issueSort === 'date') return dir * b.startedAt.localeCompare(a.startedAt)
    if (issueSort === 'duration') return dir * (b.durationMin - a.durationMin)
    return dir * (b.cost - a.cost)
  })

  const uniqueProjects = [...new Map(data.resolvedIssues.map(i => [i.projectId, { id: i.projectId, name: i.projectName, color: i.projectColor }])).values()]

  return (
    <section>
      <button onClick={() => { setShowIssues(!showIssues); setVisibleCount(20) }} className="w-full flex items-center gap-2 text-xs font-bold text-ive-text-dim uppercase tracking-wider py-2">
        <i className={`fa-solid fa-chevron-${showIssues ? 'down' : 'right'} text-xs`} />
        {tr('resolvedIssues', { count: data.resolvedIssues.length })}
      </button>
      {showIssues && (
        <div className="space-y-2">
          {/* 필터 */}
          <div className="flex items-center gap-2">
            <select value={issueProjectFilter} onChange={e => setIssueProjectFilter(e.target.value)} className="bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1 text-xs text-ive-text">
              <option value="all">{tr('allFilter')}</option>
              {uniqueProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input value={issueKeyword} onChange={e => setIssueKeyword(e.target.value)} placeholder={tr('searchShort')} className="flex-1 bg-ive-bg-input border border-ive-border rounded-lg px-2 py-1 text-xs text-ive-text placeholder:text-ive-text-dim" />
          </div>
          {/* 정렬 */}
          <div className="flex gap-1">
            {([['date', tr('sortDate')], ['duration', tr('sortDuration')], ['cost', tr('sortCost')]] as const).map(([key, label]) => (
              <button key={key} onClick={() => { if (issueSort === key) setIssueSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setIssueSort(key); setIssueSortDir('desc') } }}
                className={`px-2 py-1 text-xs font-bold rounded-lg ${issueSort === key ? 'bg-ive-cyan/20 text-ive-cyan' : 'text-ive-text-dim'}`}>
                {label} {issueSort === key && (issueSortDir === 'desc' ? '\u2193' : '\u2191')}
              </button>
            ))}
          </div>
          {/* 목록 */}
          <div className="space-y-1">
            {filteredIssues.slice(0, visibleCount).map((issue, i) => (
              <div
                key={i}
                onClick={() => router.push(`/issues/${issue.projectId}/${issue.issueIid}`)}
                className="bg-ive-bg-card border border-ive-border-subtle rounded-lg px-3 py-2.5 space-y-1 cursor-pointer hover:border-ive-cyan/40 active:scale-[0.99] transition-all"
              >
                {/* 1행: #ID + 제목 */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-ive-text-dim shrink-0">#{issue.issueIid}</span>
                  <span className="text-ive-text font-bold flex-1 truncate">{issue.issueTitle}</span>
                  {issue.status === 'failed' && <i className="fa-solid fa-circle-xmark text-ive-red shrink-0" title={tr('failedIconTitle')} />}
                </div>

                {/* 2행: 프로젝트 + 처리일자 + 총시간 + 비용 + 회차 */}
                <div className="flex items-center gap-2 text-xs text-ive-text-dim">
                  <span className="inline-flex items-center gap-1 min-w-0 flex-1" title={issue.projectName}>
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${issue.projectColor || '#22d3ee'}20` }}
                    >
                      <i
                        className={`fa-brands ${issue.projectProvider === 'github' ? 'fa-github' : 'fa-gitlab'} text-[9px]`}
                        style={{ color: issue.projectColor || '#22d3ee' }}
                      />
                    </span>
                    <span className="truncate">{issue.projectName}</span>
                  </span>
                  {(() => {
                    const kstDt = utcISOToKSTDateTime(issue.resolvedAt)
                    const [date, time] = kstDt.split(' ')
                    const [, mm, dd] = date.split('-')
                    return (
                      <span
                        className="font-mono font-bold text-ive-text-muted shrink-0"
                        title={tr('resolvedAtTooltip', { date: kstDt })}
                      >
                        {parseInt(mm)}/{parseInt(dd)} {time}
                      </span>
                    )
                  })()}
                  <span
                    className="inline-flex items-center gap-1 font-mono font-bold text-ive-text shrink-0"
                    title={
                      issue.waitMin == null
                        ? tr('totalTimeTooltipSimple', { total: fmtDur(issue.totalMin) })
                        : issue.verifyMin != null
                          ? tr('totalTimeTooltipWithVerify', { total: fmtDur(issue.totalMin), wait: fmtDur(issue.waitMin), work: fmtDur(issue.durationMin), verify: fmtDur(issue.verifyMin) })
                          : tr('totalTimeTooltipWithBreakdown', { total: fmtDur(issue.totalMin), wait: fmtDur(issue.waitMin), work: fmtDur(issue.durationMin) })
                    }
                  >
                    <i className="fa-solid fa-clock text-ive-text-dim" />
                    {fmtDur(issue.totalMin)}
                  </span>
                  <span className="font-mono text-ive-text-muted shrink-0">${fmtCost(issue.cost)}</span>
                  {issue.attempts > 1 && (
                    <span className="text-ive-text-dim font-bold shrink-0" title={tr('attemptTooltip', { current: issue.attemptNo, total: issue.attempts })}>
                      {tr('attemptDisplay', { current: issue.attemptNo, total: issue.attempts })}
                    </span>
                  )}
                </div>

                {/* 3행: 처리 내용 */}
                <div className="flex items-center justify-center gap-1.5 text-xs text-ive-text-dim pt-1 border-t border-ive-border-dark/40">
                  <span className="inline-flex items-center gap-1 min-w-0" title={tr('agentWorkTooltip', { name: issue.agentName, duration: fmtDur(issue.durationMin) })}>
                    <AgentAvatar avatar={issue.agentAvatar} size="xs" />
                    <span className="truncate max-w-[160px] text-ive-text-muted">
                      {issue.agentName}<span className="text-ive-text-dim font-mono">({fmtDur(issue.durationMin)})</span>
                    </span>
                  </span>
                  {issue.verifierName && (
                    <>
                      <i className="fa-solid fa-arrow-right text-[9px] text-ive-text-dim/60 shrink-0" />
                      <span className="inline-flex items-center gap-1 min-w-0" title={issue.verifyMin != null ? tr('verifierWithTimeTooltip', { name: issue.verifierName, duration: fmtDur(issue.verifyMin) }) : tr('verifierSimpleTooltip', { name: issue.verifierName })}>
                        <AgentAvatar avatar={issue.verifierAvatar || 'av-01'} userId={issue.verifierUserId} size="xs" />
                        <span className="truncate max-w-[160px] text-ive-text-muted">
                          {issue.verifierName}
                          {issue.verifyMin != null && <span className="text-ive-text-dim font-mono">({fmtDur(issue.verifyMin)})</span>}
                        </span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
            {filteredIssues.length > visibleCount && (
              <div className="text-center text-xs text-ive-text-dim py-2">{tr('moreItems', { count: filteredIssues.length - visibleCount })}</div>
            )}
            {filteredIssues.length === 0 && <div className="text-center text-xs text-ive-text-dim py-4">{tr('noMatchFilter')}</div>}
          </div>
        </div>
      )}
    </section>
  )
}
