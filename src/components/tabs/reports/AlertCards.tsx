'use client'

import { useRouter } from 'next/navigation'
import type { DiagnosisResult, ReportHelpers } from './types'

interface AlertCardsProps {
  d: DiagnosisResult
  helpers: ReportHelpers
}

export default function AlertCards({ d, helpers }: AlertCardsProps) {
  const router = useRouter()
  const { resolveMsg } = helpers

  if (d.alerts.length === 0) return null

  return (
    <section className="space-y-2">
      {d.alerts.map((alert, i) => (
        <div key={i} className="bg-ive-bg-card border border-ive-border-subtle rounded-lg p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-ive-text mb-0.5">
            {alert.severity === 'critical' && <i className="fa-solid fa-circle-exclamation text-ive-red" />}
            {alert.severity === 'warning' && <i className="fa-solid fa-triangle-exclamation text-ive-amber" />}
            {alert.severity === 'info' && <i className="fa-solid fa-circle-info text-ive-cyan" />}
            <span>{resolveMsg(alert.title)}</span>
          </div>
          <div className="text-xs text-ive-text-dim mb-1.5">{resolveMsg(alert.detail)}</div>
          {alert.actionTarget ? (
            <button onClick={() => router.push(alert.actionTarget!)} className="text-xs font-bold text-ive-green hover:underline">
              {resolveMsg(alert.action)} →
            </button>
          ) : (
            <div className="text-xs font-bold text-ive-text-muted">{resolveMsg(alert.action)}</div>
          )}
        </div>
      ))}
    </section>
  )
}
