'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useTab } from '@/lib/tab-context'

interface HelpModalProps {
  open: boolean
  onClose: () => void
  onShowIntro: () => void
  onStartTour: (tabKey: string) => void
}

const tabSections = [
  { key: 'projects', icon: 'fa-solid fa-folder', steps: 7 },
  { key: 'agents', icon: 'fa-solid fa-robot', steps: 7 },
  { key: 'issues', icon: 'fa-solid fa-list-check', steps: 5 },
  { key: 'reports', icon: 'fa-solid fa-chart-line', steps: 3 },
  { key: 'admin', icon: 'fa-solid fa-gear', steps: 4 },
] as const

export default function HelpModal({ open, onClose, onShowIntro, onStartTour }: HelpModalProps) {
  const t = useTranslations('help')
  const tt = useTranslations('tour')
  const { activeTab } = useTab()
  const [expandedKey, setExpandedKey] = useState('')

  useEffect(() => {
    if (open) setExpandedKey(activeTab || 'projects')
  }, [open, activeTab])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-none" />
      <div className="relative w-full max-w-md bg-ive-bg-card border border-ive-border rounded-2xl max-h-[85vh] flex flex-col animate-slide-up overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ive-border-dark shrink-0">
          <h2 className="text-base font-bold text-ive-text">
            <i className="fa-solid fa-circle-question text-ive-cyan mr-2" />
            {t('title')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-ive-text-muted hover:bg-ive-bg-deep transition-colors text-xl"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-2">
            {tabSections.map(({ key, icon, steps }) => {
              const isExpanded = expandedKey === key
              return (
                <div
                  key={key}
                  className={`rounded-lg transition-colors ${
                    isExpanded
                      ? 'bg-ive-cyan/5 border border-ive-cyan/20'
                      : 'bg-ive-bg/50 border border-ive-border-dark'
                  }`}
                >
                  {/* Section header */}
                  <button
                    onClick={() => setExpandedKey(isExpanded ? '' : key)}
                    className="w-full flex items-center justify-between p-3"
                  >
                    <h3 className={`text-sm font-bold ${isExpanded ? 'text-ive-cyan' : 'text-ive-text'}`}>
                      <i className={`${icon} mr-1.5`} />
                      {t(key as 'projects' | 'agents' | 'issues' | 'reports' | 'admin')}
                    </h3>
                    <i className={`fa-solid fa-chevron-down text-xs text-ive-text-dim transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-3 pb-3">
                      {/* Description */}
                      <p className="text-xs font-bold text-ive-text-secondary mb-2.5">
                        {t(`${key}Desc` as keyof IntlMessages['help'])}
                      </p>

                      {/* Steps */}
                      <ol className="flex flex-col gap-2 mb-2.5">
                        {Array.from({ length: steps }, (_, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs font-bold text-ive-text-muted">
                            <span className="shrink-0 w-5 h-5 rounded-lg bg-ive-cyan/15 text-ive-cyan flex items-center justify-center text-xs">
                              {i + 1}
                            </span>
                            <span className="pt-0.5 leading-relaxed">
                              {t(`${key}Step${i + 1}` as keyof IntlMessages['help'])}
                            </span>
                          </li>
                        ))}
                      </ol>

                      {/* Tip */}
                      <div className="flex items-start gap-1.5 text-xs font-bold text-ive-text-dim bg-ive-bg-deep/50 rounded-lg px-2.5 py-2 mb-2.5">
                        <i className="fa-solid fa-lightbulb text-ive-amber shrink-0 mt-0.5" />
                        <span className="leading-relaxed">
                          {t(`${key}Tip` as keyof IntlMessages['help'])}
                        </span>
                      </div>

                      {/* Start guide tour button */}
                      <button
                        onClick={() => onStartTour(key)}
                        className="w-full py-2 rounded-lg text-xs font-bold text-ive-cyan border border-ive-cyan/20 hover:bg-ive-cyan/10 transition-colors"
                      >
                        <i className="fa-solid fa-route mr-1.5" />
                        {tt('startGuide')}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-ive-border-dark shrink-0">
          <button
            onClick={() => { onClose(); onShowIntro() }}
            className="w-full py-2.5 rounded-lg text-sm font-bold text-ive-cyan border border-ive-cyan/30 hover:bg-ive-cyan/10 transition-colors"
          >
            <i className="fa-solid fa-circle-play mr-1.5" />
            {t('showIntro')}
          </button>
        </div>
      </div>
    </div>
  )
}
