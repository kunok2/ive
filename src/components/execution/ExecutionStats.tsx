'use client'

import { useTranslations } from 'next-intl'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

interface Props {
  avgDurationSec: number
  avgTokensPerTask: number
  avgCostPerTask: number
  successRate: number
  tasksPerHour: number
  avgTurnsPerTask?: number
}

export default function ExecutionStats({ avgDurationSec, avgTokensPerTask, avgCostPerTask, successRate, tasksPerHour, avgTurnsPerTask }: Props) {
  const te = useTranslations('execution')
  const stats = [
    { label: te('avgTaskTime'), value: formatDuration(avgDurationSec), icon: 'fa-clock' },
    { label: te('avgTurnsPerTask'), value: `${avgTurnsPerTask ?? 0}`, icon: 'fa-rotate' },
    { label: te('avgTokensPerTask'), value: formatTokens(avgTokensPerTask), icon: 'fa-microchip' },
    { label: te('avgCostPerTask'), value: `$${avgCostPerTask.toFixed(4)}`, icon: 'fa-coins' },
    { label: te('successRate'), value: `${successRate}%`, icon: 'fa-bullseye', color: successRate >= 80 ? 'text-ive-green' : successRate >= 50 ? 'text-ive-amber' : 'text-ive-red' },
    { label: te('todayThroughput'), value: `${tasksPerHour} ${te('itemsPerHour')}`, icon: 'fa-gauge-high' },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {stats.map(stat => (
        <div key={stat.label} className="bg-ive-bg-deep rounded-lg p-2.5 border border-ive-border-dark">
          <div className="text-xs text-ive-text-dim mb-1">
            <i className={`fa-solid ${stat.icon} mr-1`} />{stat.label}
          </div>
          <div className={`text-base font-bold ${stat.color || 'text-ive-text'}`}>{stat.value}</div>
        </div>
      ))}
    </div>
  )
}
