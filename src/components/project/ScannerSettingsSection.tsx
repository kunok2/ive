'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

export interface ScannerSettingsValues {
  checkInterval: number
  showToolUsage: boolean
  snapshotInterval: number
  sparklinePoints: number
  statsRetention: number
}

export interface ScannerSettingsSectionProps {
  values: ScannerSettingsValues
  onChange: <K extends keyof ScannerSettingsValues>(field: K, value: ScannerSettingsValues[K]) => void
}

export default function ScannerSettingsSection({ values, onChange }: ScannerSettingsSectionProps) {
  const t = useTranslations('project')
  const tc = useTranslations('common')
  const ta = useTranslations('agent')

  const [showMonitoring, setShowMonitoring] = useState(false)

  return (
    <>
      {/* Check interval */}
      <div>
        <label className="block text-base font-bold text-ive-text-muted mb-2">
          {t('checkInterval')} <span className="text-ive-text-dim font-normal">{t('checkIntervalUnit')}</span>
        </label>
        <div className="flex gap-1.5">
          {[1, 3, 5].map(n => (
            <button
              key={n}
              type="button"
              onClick={() => onChange('checkInterval', n)}
              className={`flex-1 py-3 rounded-lg text-base font-bold border transition-all ${
                values.checkInterval === n
                  ? 'bg-ive-green/10 border-ive-green text-ive-green'
                  : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'
              }`}
            >
              {`${n}m`}
            </button>
          ))}
        </div>
      </div>

      {/* Tool usage toggle */}
      <div className="border-t border-ive-border-dark pt-3">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-base font-bold text-ive-text-muted">
            <i className="fa-solid fa-wrench mr-1.5 text-sm" />
            {t('showToolUsage')}
          </span>
          <button
            type="button"
            onClick={() => onChange('showToolUsage', !values.showToolUsage)}
            className={`w-11 h-6 rounded-full transition-all relative ${values.showToolUsage ? 'bg-ive-green' : 'bg-ive-bg-deep border border-ive-border'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${values.showToolUsage ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </button>
        </label>
        <p className="text-xs text-ive-text-dim mt-1 ml-6">{t('showToolUsageHint')}</p>
      </div>

      {/* Monitoring settings */}
      <div className="border-t border-ive-border-dark pt-2">
        <button
          type="button"
          onClick={() => setShowMonitoring(!showMonitoring)}
          className="flex items-center gap-1.5 text-base font-bold text-ive-cyan mb-3"
        >
          <i className={`fa-solid ${showMonitoring ? 'fa-chevron-down' : 'fa-chevron-right'} text-sm`} />
          {ta('monitoring')}
        </button>

        {showMonitoring && (
          <div className="space-y-4 pb-2 animate-in fade-in slide-in-from-top-2">
            {/* Snapshot interval */}
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {ta('snapshotInterval')} <span className="text-ive-text-dim font-normal">({tc('minutes')})</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => onChange('snapshotInterval', Math.max(1, values.snapshotInterval - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{values.snapshotInterval}</span>
                  <button type="button" onClick={() => onChange('snapshotInterval', Math.min(60, values.snapshotInterval + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[1, 5, 10].map(v => (
                    <button key={v} type="button" onClick={() => onChange('snapshotInterval', v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${values.snapshotInterval === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}m</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sparkline points */}
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {ta('sparklinePoints')}
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => onChange('sparklinePoints', Math.max(10, values.sparklinePoints - 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{values.sparklinePoints}</span>
                  <button type="button" onClick={() => onChange('sparklinePoints', Math.min(200, values.sparklinePoints + 10))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[30, 60, 120].map(v => (
                    <button key={v} type="button" onClick={() => onChange('sparklinePoints', v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${values.sparklinePoints === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Data retention */}
            <div>
              <label className="block text-sm font-bold text-ive-text-muted mb-1.5 ml-1">
                {ta('dataRetention')} <span className="text-ive-text-dim font-normal">({tc('days')})</span>
              </label>
              <div className="flex items-center gap-2">
                <div className="flex bg-ive-bg-input border border-ive-border rounded-lg overflow-hidden">
                  <button type="button" onClick={() => onChange('statsRetention', Math.max(1, values.statsRetention - 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">−</button>
                  <span className="w-12 py-2 flex items-center justify-center text-base font-bold text-ive-text border-x border-ive-border">{values.statsRetention}</span>
                  <button type="button" onClick={() => onChange('statsRetention', Math.min(90, values.statsRetention + 1))} className="px-3 py-2 text-ive-text-muted hover:text-ive-cyan hover:bg-ive-cyan/10 transition-colors text-base font-bold">+</button>
                </div>
                <div className="flex gap-1 flex-1">
                  {[7, 14, 30].map(v => (
                    <button key={v} type="button" onClick={() => onChange('statsRetention', v)}
                      className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${values.statsRetention === v ? 'bg-ive-cyan/10 border-ive-cyan text-ive-cyan' : 'bg-ive-bg-card border-ive-border-subtle text-ive-text-dim'}`}
                    >{v}d</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
