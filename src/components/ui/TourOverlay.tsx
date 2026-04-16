'use client'

import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react'
import { useTranslations } from 'next-intl'

export interface TourStep {
  target: string
  titleKey: string
  contentKey: string
}

export const tourSteps: Record<string, TourStep[]> = {
  projects: [
    { target: 'tab-projects', titleKey: 'tabProjects', contentKey: 'tabProjectsDesc' },
    { target: 'projects-empty-add', titleKey: 'addProjectEmpty', contentKey: 'addProjectEmptyDesc' },
    { target: 'add-project', titleKey: 'addProject', contentKey: 'addProjectDesc' },
    { target: 'project-card-stats', titleKey: 'projectStats', contentKey: 'projectStatsDesc' },
    { target: 'project-scanner-toggle', titleKey: 'projectScanner', contentKey: 'projectScannerDesc' },
    { target: 'project-scan-now', titleKey: 'projectScan', contentKey: 'projectScanDesc' },
  ],
  agents: [
    { target: 'tab-agents', titleKey: 'tabAgents', contentKey: 'tabAgentsDesc' },
    { target: 'agents-filter', titleKey: 'agentsFilter', contentKey: 'agentsFilterDesc' },
    { target: 'agents-empty-add', titleKey: 'addAgentEmpty', contentKey: 'addAgentEmptyDesc' },
    { target: 'add-agent', titleKey: 'addAgent', contentKey: 'addAgentDesc' },
    { target: 'agent-card-header', titleKey: 'agentCard', contentKey: 'agentCardDesc' },
    { target: 'agent-card-stats', titleKey: 'agentStats', contentKey: 'agentStatsDesc' },
    { target: 'agent-interview', titleKey: 'agentInterview', contentKey: 'agentInterviewDesc' },
    { target: 'agent-test', titleKey: 'agentTest', contentKey: 'agentTestDesc' },
  ],
  issues: [
    { target: 'tab-issues', titleKey: 'tabIssues', contentKey: 'tabIssuesDesc' },
    { target: 'issues-project-select', titleKey: 'issuesProjectSelect', contentKey: 'issuesProjectSelectDesc' },
    { target: 'add-issue', titleKey: 'addIssue', contentKey: 'addIssueDesc' },
    { target: 'issues-filter', titleKey: 'issuesFilter', contentKey: 'issuesFilterDesc' },
  ],
  reports: [
    { target: 'tab-reports', titleKey: 'tabReports', contentKey: 'tabReportsDesc' },
    { target: 'reports-period', titleKey: 'reportsPeriod', contentKey: 'reportsPeriodDesc' },
  ],
  admin: [
    { target: 'tab-admin', titleKey: 'tabAdmin', contentKey: 'tabAdminDesc' },
    { target: 'admin-sub-tabs', titleKey: 'adminSubTabs', contentKey: 'adminSubTabsDesc' },
  ],
}

interface Props {
  steps: TourStep[]
  onClose: () => void
}

export default function TourOverlay({ steps, onClose }: Props) {
  const t = useTranslations('tour')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [tooltipStyle, setTooltipStyle] = useState<{ top: number; left: number; opacity: number }>({ top: -9999, left: 0, opacity: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  const activeSteps = useMemo(() =>
    steps.filter(s => document.querySelector(`[data-tour="${s.target}"]`)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps]
  )

  const step = activeSteps[currentIdx]

  // Close if no valid steps
  useEffect(() => {
    if (steps.length > 0 && activeSteps.length === 0) onClose()
  }, [steps.length, activeSteps.length, onClose])

  // Measure target element
  useEffect(() => {
    if (!step) return
    const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement
    if (!el) return

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })

    const measure = () => setTargetRect(el.getBoundingClientRect())
    measure()
    const timer = setTimeout(measure, 350)

    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [step])

  // Position tooltip
  useLayoutEffect(() => {
    if (!targetRect || !tooltipRef.current) return
    const tt = tooltipRef.current.getBoundingClientRect()
    const gap = 12
    const pad = 16

    const spaceBelow = window.innerHeight - targetRect.bottom
    const useBottom = spaceBelow >= tt.height + gap + pad

    let top = useBottom
      ? targetRect.bottom + gap
      : targetRect.top - tt.height - gap
    let left = targetRect.left + targetRect.width / 2 - tt.width / 2

    left = Math.max(pad, Math.min(left, window.innerWidth - tt.width - pad))
    top = Math.max(pad, Math.min(top, window.innerHeight - tt.height - pad))

    setTooltipStyle({ top, left, opacity: 1 })
  }, [targetRect, currentIdx])

  // Keyboard
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (currentIdx < activeSteps.length - 1) setCurrentIdx(i => i + 1)
        else onClose()
      }
      if (e.key === 'ArrowLeft') {
        if (currentIdx > 0) setCurrentIdx(i => i - 1)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [currentIdx, activeSteps.length, onClose])

  if (!step || activeSteps.length === 0 || !targetRect) return null

  const pad = 8

  return (
    <div className="fixed inset-0" style={{ zIndex: 60 }}>
      {/* Click catcher */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Spotlight */}
      <div
        className="absolute rounded-lg pointer-events-none"
        style={{
          top: targetRect.top - pad,
          left: targetRect.left - pad,
          width: targetRect.width + pad * 2,
          height: targetRect.height + pad * 2,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.75)',
          transition: 'all 0.3s ease-out',
        }}
      />

      {/* Spotlight ring */}
      <div
        className="absolute rounded-lg pointer-events-none border-2 border-ive-cyan/50"
        style={{
          top: targetRect.top - pad,
          left: targetRect.left - pad,
          width: targetRect.width + pad * 2,
          height: targetRect.height + pad * 2,
          transition: 'all 0.3s ease-out',
        }}
      />

      {/* Block clicks on spotlight area from dismissing */}
      <div
        className="absolute rounded-lg"
        style={{
          top: targetRect.top - pad,
          left: targetRect.left - pad,
          width: targetRect.width + pad * 2,
          height: targetRect.height + pad * 2,
        }}
        onClick={e => e.stopPropagation()}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute bg-ive-bg-card border border-ive-cyan/30 rounded-2xl shadow-2xl"
        style={{
          top: tooltipStyle.top,
          left: tooltipStyle.left,
          opacity: tooltipStyle.opacity,
          width: 288,
          transition: 'all 0.3s ease-out',
        }}
      >
        <div className="p-4 pb-2">
          <div className="text-sm font-bold text-ive-cyan mb-1">
            {t(step.titleKey as keyof IntlMessages['tour'])}
          </div>
          <div className="text-xs font-bold text-ive-text-muted leading-relaxed">
            {t(step.contentKey as keyof IntlMessages['tour'])}
          </div>
        </div>

        <div className="px-4 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {activeSteps.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentIdx ? 'bg-ive-cyan' : 'bg-ive-text-dim/30'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {currentIdx > 0 && (
              <button
                onClick={() => setCurrentIdx(i => i - 1)}
                className="text-xs font-bold text-ive-text-muted px-2 py-1 rounded-lg hover:bg-white/5 transition-colors"
              >
                {t('prev')}
              </button>
            )}
            <button
              onClick={() => {
                if (currentIdx < activeSteps.length - 1) setCurrentIdx(i => i + 1)
                else onClose()
              }}
              className="text-xs font-bold text-ive-bg-deep bg-ive-cyan px-3 py-1 rounded-lg hover:opacity-80 transition-colors"
            >
              {currentIdx < activeSteps.length - 1 ? t('next') : t('done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
